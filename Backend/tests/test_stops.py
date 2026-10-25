import copy
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app
from corridor import UTC, evaluate_candidate, iso, parse_time, sample_route
from demo import demo_forecasts, demo_routes
from stops import plan_stops

START = datetime(2026, 10, 24, 21, tzinfo=UTC)
CAR = {"mpg": 30, "tankGallons": 14, "mpgSource": "Your highway MPG estimate"}


class StopPlanningTests(unittest.TestCase):
    def setUp(self):
        self.route = sample_route(demo_routes(False)[0])
        self.series = demo_forecasts([self.route], START)[self.route["id"]]
        self.candidate = evaluate_candidate(self.route, self.series, START)

    def test_wait_before_storm_improves_and_shifts_every_downstream_arrival(self):
        plan = plan_stops(self.route, self.series, self.candidate, food=False)
        self.assertTrue(plan["weatherImproved"])
        self.assertGreater(plan["higherMinutesAvoided"], 0)
        self.assertLess(plan["higherMinutes"], self.candidate["higherMinutes"])
        self.assertLess(plan['worstSeverity'], self.candidate['worstSeverity'])
        self.assertNotEqual(plan['level'], self.candidate['level'])
        self.assertEqual(plan['level'], ['lower', 'caution', 'higher'][plan['worstSeverity']])
        self.assertGreater(len(plan["stops"]), 0)
        for stop in plan["stops"]:
            self.assertIn(stop["arrivalLevel"], ("lower", "caution"))
            self.assertEqual((parse_time(stop["resume"]) - parse_time(stop["arrival"])).total_seconds(), stop["durationMinutes"] * 60)
        for index, point in enumerate(self.route["checkpoints"]):
            delay = sum(s["durationMinutes"] for s in plan["stops"] if s["checkpointIndex"] < index)
            expected = START + timedelta(seconds=point["offsetSeconds"], minutes=delay)
            self.assertEqual(plan["checkpointConditions"][index]["arrival"], iso(expected))
        self.assertEqual(parse_time(plan["arrival"]), parse_time(self.candidate["arrival"]) + timedelta(minutes=plan["totalStopMinutes"]))

    def test_full_tank_never_generates_unnecessary_refuels_as_waits(self):
        plan = plan_stops(self.route, self.series, self.candidate, CAR, 1, False)
        self.assertFalse(any(s["fuel"] for s in plan["stops"]))
        self.assertGreaterEqual(plan["fuel"]["arrivalTankPercent"], 15)

    def test_low_tank_has_reachable_refuel_and_reserve_at_destination(self):
        plan = plan_stops(self.route, self.series, self.candidate, CAR, .25, False)
        fuel_stops = [s for s in plan["stops"] if s["fuel"]]
        self.assertEqual(len(fuel_stops), 1)
        self.assertLessEqual(fuel_stops[0]["mile"], plan["fuel"]["startingRangeMiles"] + 1)
        self.assertGreaterEqual(plan["fuel"]["arrivalTankPercent"], 15)
        self.assertAlmostEqual(plan["fuel"]["planningMpg"], 25.5)

    def test_below_reserve_refuels_at_origin(self):
        plan = plan_stops(self.route, self.series, self.candidate, CAR, .05, False)
        self.assertTrue(plan["stops"][0]["fuel"])
        self.assertEqual(plan["stops"][0]["checkpointIndex"], 0)

    def test_tiny_tank_cannot_reach_next_checkpoint(self):
        car = CAR | {"mpg": 5, "tankGallons": 1}
        plan = plan_stops(self.route, self.series, self.candidate, car, .05)
        self.assertEqual(plan["status"], "unreachable")
        self.assertEqual(plan["stops"], [])

    def test_clear_weather_no_wait_without_food_and_meal_when_requested(self):
        clear = copy.deepcopy(self.series)
        for forecast in clear:
            for field, value in (("precipitationMm", 0), ("visibilityM", 16000), ("gustKph", 5)):
                forecast["values"][field] = [value] * len(forecast["times"])
        baseline = evaluate_candidate(self.route, clear, START)
        plan = plan_stops(self.route, clear, baseline, CAR, 1, False)
        self.assertEqual(plan["stops"], [])
        meal = plan_stops(self.route, clear, baseline, CAR, 1, True)
        self.assertTrue(meal["mealIncluded"])
        self.assertEqual(len(meal["stops"]), 1)
        self.assertEqual(meal["totalStopMinutes"], 30)
        self.assertFalse(meal["weatherImproved"])

    def test_missing_later_forecast_cannot_earn_weather_improvement(self):
        short = copy.deepcopy(self.series)
        for forecast in short:
            keep = [i for i, stamp in enumerate(forecast["times"]) if stamp <= START.timestamp() + self.route["durationSeconds"]]
            forecast["times"] = [forecast["times"][i] for i in keep]
            forecast["values"] = {k: [v[i] for i in keep] for k, v in forecast["values"].items()}
        baseline = evaluate_candidate(self.route, short, START)
        plan = plan_stops(self.route, short, baseline, food=False)
        self.assertFalse(plan["weatherImproved"])

    def test_no_plan_drives_to_known_higher_exposure_for_weather_wait(self):
        for forecast in self.series:
            forecast["values"]["precipitationMm"] = [4] * len(forecast["times"])
        baseline = evaluate_candidate(self.route, self.series, START)
        plan = plan_stops(self.route, self.series, baseline, food=True)
        self.assertFalse(plan["weatherImproved"])
        self.assertEqual(plan["stops"], [])

    def test_limits_are_obeyed(self):
        plan = plan_stops(self.route, self.series, self.candidate, CAR, .25)
        self.assertLessEqual(len(plan["stops"]), 3)
        self.assertLessEqual(plan["totalStopMinutes"], 90)


class StopApiTests(unittest.TestCase):
    def test_plan_uses_server_analysis_not_client_forecasts(self):
        client = app.test_client()
        data = {"origin": {"name": "Columbus", "coordinates": [-82.9988, 39.9612]},
                "destination": {"name": "Cleveland", "coordinates": [-81.6944, 41.4993]},
                "departureStart": iso(START), "departureEnd": iso(START), "dataMode": "demo"}
        analysis = client.post('/api/trips/analyze', json=data).get_json()
        body = {"analysisId": analysis["analysisId"], "candidateId": analysis["candidates"][0]["id"], "includeFood": False}
        response = client.post('/api/trips/stop-plan', json=body)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["weatherImproved"])
        for invalid in ({"startingFuel": False}, {"startingFuel": 1.2}, {"includeFood": "true"}, {"candidateId": "missing"}, {"vehicle": {}}):
            with self.subTest(invalid=invalid):
                self.assertEqual(client.post('/api/trips/stop-plan', json=body | invalid).status_code, 400)
        self.assertEqual(client.post('/api/trips/stop-plan', json=body | {"analysisId": "expired"}).status_code, 410)


if __name__ == '__main__':
    unittest.main()
