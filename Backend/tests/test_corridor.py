import copy
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app
from corridor import (TripError, UTC, analyze_routes, evaluate_candidate, iso, lookup_forecast,
                      parse_time, sample_route, score_weather, validate_request)
from providers import BoundedCache, ProviderError

START = datetime(2026, 10, 24, 21, tzinfo=UTC)


def route():
    return {"id": "test", "geometry": {"type": "LineString", "coordinates": [[-83, 40], [-82, 40], [-81, 40]]},
            "edgeDurationsSeconds": [600, 1800], "distanceMeters": 170000}


def series(precipitation=0):
    times = [(START + timedelta(minutes=minute)).timestamp() for minute in range(-30, 241, 15)]
    row = {"temperatureC": 14, "precipitationMm": precipitation, "visibilityM": 16000,
           "windKph": 10, "gustKph": 20, "windDirectionDeg": 90}
    return {"times": times, "values": {key: [value] * len(times) for key, value in row.items()}, "intervalSeconds": 900}


def payload(mode="demo"):
    return {"origin": {"name": "Columbus", "coordinates": [-82.9988, 39.9612]},
            "destination": {"name": "Cleveland", "coordinates": [-81.6944, 41.4993]},
            "departureStart": iso(START), "departureEnd": iso(START + timedelta(hours=2)),
            "dataMode": mode, "timeZone": "America/New_York", "includeAlternatives": True}


class SamplingTests(unittest.TestCase):
    def test_checkpoint_uses_edge_time_not_uniform_distance(self):
        sampled = sample_route(route())
        self.assertEqual([p["offsetSeconds"] for p in sampled["checkpoints"]], [0, 900, 1800, 2400])
        self.assertAlmostEqual(sampled["checkpoints"][1]["coordinates"][0], -82 + 1 / 6)
        self.assertEqual(sampled["checkpoints"][-1]["coordinates"], [-81, 40])
        self.assertEqual(sum(s["durationSeconds"] for s in sampled["segments"]), 2400)

    def test_segments_retain_road_vertices(self):
        sampled = sample_route(route())
        self.assertIn([-82, 40], sampled["segments"][0]["coordinates"])
        for index, segment in enumerate(sampled["segments"]):
            self.assertEqual(segment["coordinates"][0], sampled["checkpoints"][index]["coordinates"])
            self.assertEqual(segment["coordinates"][-1], sampled["checkpoints"][index + 1]["coordinates"])

    def test_zero_duration_edges_and_short_route(self):
        item = route()
        item["edgeDurationsSeconds"] = [0, 80]
        sampled = sample_route(item)
        self.assertEqual(len(sampled["checkpoints"]), 2)
        self.assertEqual(sampled["durationSeconds"], 80)
        self.assertEqual(sampled["checkpoints"][0]["coordinates"], [-83, 40])

    def test_adaptive_sampling_caps_long_trips_while_preserving_short_cadence(self):
        # 4-hour route (14,400s) -> 15 min (900s) step -> 17 checkpoints
        r4 = {"id": "4h", "distanceMeters": 300000, "geometry": {"coordinates": [[-83, 40], [-80, 40]]},
              "edgeDurationsSeconds": [14400]}
        s4 = sample_route(r4)
        self.assertEqual(len(s4["checkpoints"]), 17)
        self.assertEqual(s4["checkpoints"][1]["offsetSeconds"], 900)

        # 50-hour cross-country route (180,000s) -> capped at ~41 checkpoints with ~75-90 min step
        r50 = {"id": "50h", "distanceMeters": 4000000, "geometry": {"coordinates": [[-70, 45], [-118, 34]]},
               "edgeDurationsSeconds": [180000]}
        s50 = sample_route(r50)
        self.assertLessEqual(len(s50["checkpoints"]), 45)
        self.assertGreaterEqual(len(s50["checkpoints"]), 35)
        self.assertEqual(s50["checkpoints"][1]["offsetSeconds"], 4500)

    def test_bad_annotations_or_excessive_route_rejected(self):
        for durations in ([2], [1, None], [0, 0], [-2, 100]):
            with self.subTest(durations=durations), self.assertRaises(TripError):
                sample_route(route() | {"edgeDurationsSeconds": durations})


class ForecastTests(unittest.TestCase):
    def test_preceding_accumulation_boundaries(self):
        forecast = series()
        weather = lookup_forecast(forecast, START + timedelta(seconds=1))
        self.assertEqual(weather["validStart"], iso(START))
        self.assertEqual(weather["validEnd"], iso(START + timedelta(minutes=15)))
        self.assertEqual(lookup_forecast(forecast, START)["validEnd"], iso(START))

    def test_no_extrapolation_or_carry_forward(self):
        self.assertIsNone(lookup_forecast(series(), START + timedelta(hours=5)))
        self.assertIsNone(lookup_forecast(series(), START - timedelta(hours=2)))

    def test_rain_conversion_and_crosswind_projection(self):
        weather = lookup_forecast(series(2), START)
        parallel = score_weather(weather, 90)
        perpendicular = score_weather(weather, 0)
        self.assertEqual(parallel["weather"]["rainMmPerHour"], 8)
        self.assertEqual(parallel["weather"]["crosswindGustKph"], 0)
        self.assertEqual(perpendicular["weather"]["crosswindGustKph"], 20)
        self.assertEqual(parallel["level"], "higher")

    def test_bearing_wraps(self):
        weather = lookup_forecast(series(), START) | {"windDirectionDeg": 360}
        self.assertEqual(score_weather(weather, 0)["weather"]["crosswindGustKph"], 0)

    def test_unknown_or_negative_values_do_not_score_lower(self):
        weather = lookup_forecast(series(), START)
        for bad in (None, float("nan"), -1):
            self.assertEqual(score_weather(weather | {"visibilityM": bad}, 90)["level"], "unknown")
        self.assertEqual(score_weather(None, 90)["level"], "unknown")

    def test_wet_near_freezing_is_a_flag_not_probability(self):
        weather = lookup_forecast(series(.1), START) | {"temperatureC": 1}
        result = score_weather(weather, 90)
        self.assertEqual(result["level"], "higher")
        self.assertTrue(any("pavement state unknown" in text for text in result["reasons"]))

    def test_known_hazard_retained_next_to_unknown(self):
        sampled = sample_route(route())
        forecasts = [series(3), series(), series(), series()]
        forecasts[1]["values"]["visibilityM"] = [None] * len(forecasts[1]["times"])
        result = evaluate_candidate(sampled, forecasts, START)
        self.assertFalse(result["complete"])
        self.assertEqual(result["segmentLevels"][0], "higher")
        self.assertGreater(result["higherMinutes"], 0)
        self.assertGreater(result["unknownMinutes"], 0)


class RankingTests(unittest.TestCase):
    def test_tie_prefers_earlier_arrival_and_includes_exact_end(self):
        sampled = sample_route(route())
        forecasts = {"test": [series()] * len(sampled["checkpoints"])}
        candidates, recommendation = analyze_routes([sampled], forecasts, START, START + timedelta(minutes=12))
        self.assertEqual(len(candidates), 4)
        self.assertEqual(candidates[-1]["departure"], iso(START + timedelta(minutes=12)))
        self.assertEqual(recommendation["candidateId"], candidates[0]["id"])

    def test_all_missing_has_no_recommendation(self):
        sampled = sample_route(route())
        forecast = series()
        forecast["values"]["visibilityM"] = []
        _, recommendation = analyze_routes([sampled], {"test": [forecast] * len(sampled["checkpoints"])}, START, START)
        self.assertIsNone(recommendation["candidateId"])

    def test_all_high_is_explicit(self):
        sampled = sample_route(route())
        _, recommendation = analyze_routes([sampled], {"test": [series(4)] * len(sampled["checkpoints"])}, START, START)
        self.assertTrue(recommendation["allHigherExposure"])


class ValidationAndApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_offsets_represent_same_instant(self):
        self.assertEqual(parse_time("2026-10-24T17:00:00-04:00"), parse_time("2026-10-24T21:00:00Z"))
        self.assertEqual(parse_time("2026-11-01T01:30:00-04:00") + timedelta(hours=1), parse_time("2026-11-01T01:30:00-05:00"))

    def test_validation_rejects_bad_requests(self):
        bad = [None, [], payload() | {"departureStart": "2026-10-24T17:00"}, payload() | {"timeZone": "invalid"},
               payload() | {"departureEnd": iso(START - timedelta(minutes=1))},
               payload() | {"includeAlternatives": "false"},
               payload() | {"origin": {"coordinates": [True, 40]}}, payload() | {"dataMode": "recorded"}]
        for item in bad:
            with self.subTest(item=item):
                self.assertEqual(self.client.post('/api/trips/analyze', json=item).status_code, 400)
        wide = self.client.post('/api/trips/analyze', json=payload() | {"departureEnd": iso(START + timedelta(hours=3))})
        self.assertEqual(wide.status_code, 200)

    def test_startup_and_demo_do_not_access_database(self):
        with patch("app.connect", side_effect=AssertionError("No DB should be used")):
            self.assertEqual(self.client.get('/api/health').status_code, 200)
            response = self.client.post('/api/trips/analyze', json=payload())
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertEqual(result["dataMode"], "demo")
        self.assertEqual(len(result["routes"]), 2)
        self.assertEqual(len(result["candidates"]), 50)
        self.assertIn("Synthetic", result["sources"][0]["model"])
        initial = result["candidates"][0]
        chosen = next(item for item in result["candidates"] if item["id"] == result["recommendation"]["candidateId"])
        self.assertLess(chosen["weightedExposure"], initial["weightedExposure"])
        self.assertNotEqual(initial["segmentLevels"], result["candidates"][24]["segmentLevels"])

    def test_demo_one_route_and_wrong_corridor(self):
        self.assertEqual(len(self.client.post('/api/trips/analyze', json=payload() | {"includeAlternatives": False}).get_json()["routes"]), 1)
        item = copy.deepcopy(payload())
        item["origin"]["coordinates"] = [-83.5, 40]
        self.assertEqual(self.client.post('/api/trips/analyze', json=item).status_code, 400)

    def test_live_provider_failure_never_becomes_simulation(self):
        item = payload("live")
        now = datetime.now(UTC) + timedelta(minutes=30)
        item.update(departureStart=iso(now), departureEnd=iso(now + timedelta(hours=1)))
        with patch("trips.fetch_routes", side_effect=ProviderError("upstream timeout", 504)):
            response = self.client.post('/api/trips/analyze', json=item)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.get_json()["dataMode"], "live")
        self.assertNotIn("candidates", response.get_json())

    def test_live_past_or_far_future_rejected(self):
        with self.assertRaises(TripError):
            validate_request(payload("live"), now=START + timedelta(days=1))
        with self.assertRaises(TripError):
            validate_request(payload("live"), now=START - timedelta(days=8))

    def test_cache_reuses_results_and_bounds_memory(self):
        cache = BoundedCache(maximum=2)
        self.assertEqual(cache.get_or_load("one", lambda: 1), 1)
        self.assertEqual(cache.get_or_load("one", lambda: 99), 1)
        cache.get_or_load("two", lambda: 2)
        cache.get_or_load("three", lambda: 3)
        self.assertEqual(len(cache.items), 2)
        self.assertNotIn("one", cache.items)


if __name__ == '__main__':
    unittest.main()
