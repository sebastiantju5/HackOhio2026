import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from corridor import UTC, lookup_forecast, score_weather
from providers import BoundedCache, ProviderError, fetch_forecasts, fetch_routes, request_json

START = datetime(2026, 10, 24, 21, tzinfo=UTC)


def weather_response(lon=-83):
    fields = {"temperature_2m": [12, 13], "precipitation": [0, 1], "visibility": [10000, 9000],
              "wind_speed_10m": [10, 11], "wind_gusts_10m": [20, 22], "wind_direction_10m": [90, 100]}
    return {"longitude": lon, "latitude": 40, "minutely_15": {
        "time": [START.timestamp(), (START + timedelta(minutes=15)).timestamp()], **fields}}


class ProviderTests(unittest.TestCase):
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
        self.assertEqual(source["cadenceMinutes"], 15)
        self.assertEqual(forecasts["one"][0]["gridCoordinates"], [-83, 40])
        self.assertEqual(forecasts, again)

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

    def test_expired_cache_loads_again(self):
        cache = BoundedCache(ttl=10)
        with patch("providers.monotonic", side_effect=[0, 20, 20]):
            self.assertEqual(cache.get_or_load("key", lambda: "old"), "old")
            self.assertEqual(cache.get_or_load("key", lambda: "new"), "new")


if __name__ == '__main__':
    unittest.main()
