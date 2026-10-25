import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from corridor import TripError, sample_route
from google_routes import read_google_routes

ORIGIN = {"coordinates": [-83, 40]}
DESTINATION = {"coordinates": [-82, 41]}
ROUTE = {"coordinates": [[-83, 40], [-82.5, 40.5], [-82, 41]], "durations": [2400, 3000], "distanceMeters": 180000}


class GoogleRouteTests(unittest.TestCase):
    def test_google_geometry_and_timing_feed_forecast_checkpoints(self):
        routes, source = read_google_routes([ROUTE, ROUTE], ORIGIN, DESTINATION, True)
        self.assertEqual(len(routes), 2)
        route = sample_route(routes[0])
        self.assertEqual(route["durationSeconds"], 5400)
        self.assertEqual(route["checkpoints"][-1]["distanceMeters"], 180000)
        self.assertEqual(route["checkpoints"][-1]["coordinates"], [-82, 41])
        self.assertEqual(source["provider"], "Google Routes")
        self.assertEqual(len(read_google_routes([ROUTE, ROUTE], ORIGIN, DESTINATION, False)[0]), 1)

    def test_untrusted_geometry_is_bounded_and_matches_endpoints(self):
        for item in (None, [], {}, ROUTE | {"coordinates": [[True, 40], [-82, 41]]},
                     ROUTE | {"durations": [1]}, ROUTE | {"durations": [False, 1]},
                     ROUTE | {"coordinates": [[0, 0], [1, 1]], "durations": [1]},
                     ROUTE | {"distanceMeters": -1}, ROUTE | {"coordinates": [[-83, 40]] * 141}):
            with self.subTest(item=item), self.assertRaises(TripError):
                read_google_routes([item], ORIGIN, DESTINATION, True)
        routes, _ = read_google_routes([ROUTE | {"durations": [0, 0]}], ORIGIN, DESTINATION, True)
        with self.assertRaises(TripError):
            sample_route(routes[0])


if __name__ == '__main__':
    unittest.main()
