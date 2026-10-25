import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from corridor import UTC, lookup_forecast, score_weather
from providers import BoundedCache, ProviderError, fetch_forecasts, fetch_routes, forecast_model, request_json

START = datetime(2026, 10, 24, 21, tzinfo=UTC)


def weather_response(lon=-83):
    fields = {"temperature_2m": [12, 13], "precipitation": [0, 1], "visibility": [10000, 9000],
              "wind_speed_10m": [10, 11], "wind_gusts_10m": [20, 22], "wind_direction_10m": [90, 100]}
    return {"longitude": lon, "latitude": 40, "minutely_15": {
        "time": [START.timestamp(), (START + timedelta(minutes=15)).timestamp()], **fields}}


class ProviderTests(unittest.TestCase):
    def test_model_selection_covers_full_horizon_and_geography(self):
        self.assertEqual(forecast_model([(-83, 40)], START + timedelta(hours=16), START)[0], 'gfs_hrrr')
        self.assertEqual(forecast_model([(-83, 40)], START + timedelta(hours=16, seconds=1), START)[0], 'gfs_seamless')
        self.assertEqual(forecast_model([(-83, 40)], START + timedelta(days=7), START)[0], 'gfs_seamless')
        self.assertEqual(forecast_model([(-1, 51)], START + timedelta(hours=1), START)[0], 'gfs_seamless')

    def test_route_duration_and_stop_buffer_can_require_gfs(self):
        routes = [{"id": "one", "durationSeconds": 3600, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch('providers.weather_cache', BoundedCache()), patch('providers.request_json', return_value=weather_response()) as get:
            _, source = fetch_forecasts(routes, START + timedelta(hours=10), START + timedelta(hours=14), now=START)
        query = parse_qs(urlparse(get.call_args.args[0]).query)
        self.assertEqual(query['models'], ['gfs_seamless'])
        self.assertIn('GFS', source['model'])
        self.assertIn('interpolated', source['note'])

    def test_long_range_gfs_preserves_all_required_weather_fields(self):
        response = weather_response()
        future = START + timedelta(days=7)
        response['minutely_15']['time'] = [future.timestamp(), (future + timedelta(minutes=15)).timestamp()]
        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch('providers.weather_cache', BoundedCache()), patch('providers.request_json', return_value=response) as get:
            forecasts, source = fetch_forecasts(routes, future, future, now=START)
        self.assertEqual(parse_qs(urlparse(get.call_args.args[0]).query)['models'], ['gfs_seamless'])
        condition = score_weather(lookup_forecast(forecasts['one'][0], future), 90)
        self.assertEqual(condition['level'], 'lower')
        self.assertEqual(source['validStart'], future.isoformat().replace('+00:00', 'Z'))

    def test_null_timestamp_slots_do_not_claim_usable_forecast_coverage(self):
        response = weather_response()
        for field in response['minutely_15']:
            if field != 'time':
                response['minutely_15'][field] = [None, None]
        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch('providers.weather_cache', BoundedCache()), patch('providers.request_json', return_value=response):
            forecasts, source = fetch_forecasts(routes, START, START, now=START)
        self.assertEqual(source['coverageStatus'], 'partial')
        self.assertIsNone(source['validStart'])
        self.assertIsNone(source['validEnd'])
        self.assertEqual(score_weather(lookup_forecast(forecasts['one'][0], START), 90)['level'], 'unknown')

    def test_weather_batches_unique_locations_and_keeps_grid_metadata(self):
        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}, {"coordinates": [-82, 40]}]},
                  {"id": "two", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch("providers.weather_cache", BoundedCache()), patch("providers.request_json", return_value=[weather_response(), weather_response(-82)]) as get:
            forecasts, source = fetch_forecasts(routes, START, START + timedelta(hours=1))
            again, _ = fetch_forecasts(routes, START, START + timedelta(hours=1))
        self.assertEqual(get.call_count, 1)
        query = parse_qs(urlparse(get.call_args.args[0]).query)
        self.assertEqual(query["longitude"], ["-83,-82"])
        self.assertEqual(query["models"], ["gfs_hrrr"])
        self.assertEqual(forecast_model([(-1.25, 51.75)])[0], "gfs_seamless")
        self.assertEqual(source["cadenceMinutes"], 15)
        self.assertEqual(forecasts["one"][0]["gridCoordinates"], [-83, 40])
        self.assertEqual(forecasts, again)

    def test_weather_chunks_large_route_into_multiple_requests(self):
        # 120 checkpoints to force chunking across multiple 50-location requests
        checkpoints = [{"coordinates": [-80 - (i * 0.1), 40 + (i * 0.05)]} for i in range(120)]
        routes = [{"id": "long-route", "durationSeconds": 120 * 900, "checkpoints": checkpoints}]
        calls = []

        def mock_request(url, provider):
            query = parse_qs(urlparse(url).query)
            coords = query["longitude"][0].split(",")
            calls.append(len(coords))
            return [weather_response(float(c)) for c in coords]

        with patch("providers.weather_cache", BoundedCache()), patch("providers.request_json", side_effect=mock_request):
            forecasts, source = fetch_forecasts(routes, START, START + timedelta(hours=1))

        self.assertEqual(sorted(calls), [20, 50, 50])
        self.assertEqual(len(forecasts["long-route"]), 120)
        self.assertEqual([f["gridCoordinates"][0] for f in forecasts["long-route"]],
                         [round(c["coordinates"][0], 4) for c in checkpoints])

    def test_location_caching_skips_api_calls_on_window_adjustments(self):
        # 12-hour response
        fields = {"temperature_2m": [12] * 49, "precipitation": [0] * 49, "visibility": [10000] * 49,
                  "wind_speed_10m": [10] * 49, "wind_gusts_10m": [20] * 49, "wind_direction_10m": [90] * 49}
        stamps = [(START + timedelta(minutes=15 * i)).timestamp() for i in range(49)]
        resp = {"longitude": -83, "latitude": 40, "minutely_15": {"time": stamps, **fields}}

        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch("providers.weather_cache", BoundedCache()), patch("providers.request_json", return_value=resp) as get:
            # First call for initial window
            fetch_forecasts(routes, START, START + timedelta(hours=1))
            self.assertEqual(get.call_count, 1)

            # User adjusts departure slider forward by 2 hours (different cache key in whole-trip cache)
            fetch_forecasts(routes, START + timedelta(hours=2), START + timedelta(hours=3))
            # Location cache serves the data without an extra network call
            self.assertEqual(get.call_count, 1)

    def test_missing_provider_field_is_unknown(self):
        response = weather_response()
        del response["minutely_15"]["visibility"]
        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        with patch("providers.weather_cache", BoundedCache()), patch("providers.request_json", return_value=response):
            forecasts, _ = fetch_forecasts(routes, START, START)
        condition = score_weather(lookup_forecast(forecasts["one"][0], START), 90)
        self.assertEqual(condition["level"], "unknown")

    def test_wrong_location_count_or_irregular_time_rejected(self):
        routes = [{"id": "one", "durationSeconds": 900, "checkpoints": [{"coordinates": [-83, 40]}]}]
        wrong_time = weather_response()
        wrong_time["minutely_15"]["time"][1] += 60
        for response in ([], wrong_time):
            with patch("providers.weather_cache", BoundedCache()), patch("providers.request_json", return_value=response):
                with self.assertRaises(ProviderError):
                    fetch_forecasts(routes, START, START)

    def test_routing_extracts_edge_annotations_and_no_traffic_for_osrm(self):
        response = {"code": "Ok", "routes": [{"geometry": {"type": "LineString", "coordinates": [[-83, 40], [-82, 40]]},
                                              "distance": 85000, "legs": [{"annotation": {"duration": [1000]}}]}]}
        point = {"coordinates": [-83, 40]}
        with patch.dict("os.environ", {"MAPBOX_ACCESS_TOKEN": ""}), patch("providers.route_cache", BoundedCache()), patch("providers.request_json", return_value=response):
            routes, source = fetch_routes(point, {"coordinates": [-82, 40]}, START)
        self.assertEqual(routes[0]["edgeDurationsSeconds"], [1000])
        self.assertFalse(routes[0]["trafficAware"])
        self.assertEqual(source["provider"], "OSRM")

    def test_http_errors_redact_credentials(self):
        secret_url = "https://api.mapbox.com/test?access_token=secret-token"
        for code, status in ((401, 503), (429, 503), (500, 502)):
            error = HTTPError(secret_url, code, "failure", {}, None)
            with patch("providers.urlopen", side_effect=error), self.assertRaises(ProviderError) as result:
                request_json(secret_url, "Mapbox")
            self.assertEqual(result.exception.status, status)
            self.assertNotIn("secret-token", str(result.exception))

    def test_open_meteo_429_retries_and_succeeds(self):
        url = "https://api.open-meteo.com/v1/forecast?test=1"
        error_429 = HTTPError(url, 429, "Too Many Requests", {"Retry-After": "0.01"}, None)

        from unittest.mock import MagicMock
        success_resp = MagicMock()
        success_resp.read.return_value = b'{"status": "ok"}'
        success_resp.__enter__.return_value = success_resp

        with patch("providers.urlopen", side_effect=[error_429, success_resp]), patch("providers.sleep") as mock_sleep:
            data = request_json(url, "Open-Meteo")

        self.assertEqual(data, {"status": "ok"})
        mock_sleep.assert_called_once_with(0.01)

    def test_expired_cache_loads_again(self):
        cache = BoundedCache(ttl=10)
        with patch("providers.monotonic", side_effect=[0, 20, 20]):
            self.assertEqual(cache.get_or_load("key", lambda: "old"), "old")
            self.assertEqual(cache.get_or_load("key", lambda: "new"), "new")


if __name__ == '__main__':
    unittest.main()
