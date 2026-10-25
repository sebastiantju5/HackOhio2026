import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app
from corridor import TripError
from providers import BoundedCache, ProviderError
from vehicles import epa_vehicle, validate_vehicle, vehicle_options

MANUAL = {"year": 2020, "make": "Toyota", "model": "Camry", "mpg": 39, "tankGallons": 14.5}
EPA = {"year": 2020, "make": "Toyota", "model": "Camry", "highway08": 39,
       "fuelType1": "Regular Gasoline", "trany": "Automatic 8-spd", "cylinders": 4, "displ": 2.5}


class VehicleTests(unittest.TestCase):
    def test_manual_profile_has_explicit_provenance(self):
        profile = validate_vehicle(MANUAL)
        self.assertEqual(profile["mpgSource"], "Your highway MPG estimate")
        self.assertIsNone(profile["epaId"])

    def test_invalid_profile_rejected(self):
        for body in (None, [], MANUAL | {"year": True}, MANUAL | {"year": 1800}, MANUAL | {"make": ""},
                     MANUAL | {"mpg": float('nan')}, MANUAL | {"mpg": True}, MANUAL | {"tankGallons": 0},
                     MANUAL | {"tankGallons": "14"}, MANUAL | {"fuelType": "Electricity"}):
            with self.subTest(body=body), self.assertRaises(TripError):
                validate_vehicle(body)

    def test_single_and_multiple_menu_results_and_no_match(self):
        for payload, count in (({"menuItem": {"value": "123", "text": "Automatic"}}, 1),
                               ({"menuItem": [{"value": "123", "text": "Auto"}, {"value": "456", "text": "Manual"}]}, 2), ({}, 0)):
            with patch('vehicles.catalog_cache', BoundedCache()), patch('vehicles.request_json', return_value=payload):
                self.assertEqual(len(vehicle_options(2020, 'Toyota', 'Camry')), count)

    def test_epa_rating_is_canonical_and_does_not_trust_client_mpg(self):
        with patch('vehicles.catalog_cache', BoundedCache()), patch('vehicles.request_json', return_value=EPA):
            profile = validate_vehicle(MANUAL | {"epaId": "123", "mpg": 100, "make": "fake"})
        self.assertEqual(profile["mpg"], 39)
        self.assertEqual(profile["make"], "Toyota")
        self.assertEqual(profile["mpgSource"], "EPA highway MPG")

    def test_mpge_is_not_gasoline_mpg(self):
        with patch('vehicles.catalog_cache', BoundedCache()), patch('vehicles.request_json', return_value=EPA | {"fuelType1": "Electricity", "highway08": 120}):
            with self.assertRaises(TripError):
                epa_vehicle('123')

    def test_lookup_outage_and_no_token_errors_are_clear(self):
        client = app.test_client()
        for method in ('get', 'put', 'delete'):
            self.assertEqual(getattr(client, method)('/api/account/vehicle').status_code, 401)
        with patch('app.vehicle_options', side_effect=ProviderError('EPA unavailable', 503)):
            self.assertEqual(client.get('/api/vehicles/options?year=2020&make=Toyota&model=Camry').status_code, 503)
        self.assertEqual(client.get('/api/vehicles/options?year=oops').status_code, 400)

    def test_profile_queries_use_authenticated_account_only(self):
        client = app.test_client()
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = {"profile": MANUAL}
        with patch('app.connect') as connect, patch('app.account_for_token', return_value={"id": 7}):
            connect.return_value.__enter__.return_value = conn
            headers = {"Authorization": "Bearer test-token"}
            self.assertEqual(client.get('/api/account/vehicle?account_id=999', headers=headers).get_json()["vehicle"], MANUAL)
            self.assertEqual(conn.execute.call_args.args[1], (7,))
            self.assertEqual(client.put('/api/account/vehicle', headers=headers, json=MANUAL | {"account_id": 999}).status_code, 200)
            self.assertEqual(conn.execute.call_args.args[1][0], 7)
            self.assertEqual(client.delete('/api/account/vehicle?account_id=999', headers=headers).status_code, 200)
            self.assertEqual(conn.execute.call_args.args[1], (7,))
        with patch('app.connect') as connect, patch('app.account_for_token', return_value=None):
            self.assertEqual(client.get('/api/account/vehicle', headers=headers).status_code, 401)


if __name__ == '__main__':
    unittest.main()
