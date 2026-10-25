"""EPA fuel-economy lookup and validated account vehicle profiles (US gallons)."""

from datetime import datetime
from urllib.parse import urlencode

from corridor import TripError, finite_number
from providers import BoundedCache, ProviderError, request_json

catalog_cache = BoundedCache(maximum=128, ttl=86400)
BASE = "https://www.fueleconomy.gov/ws/rest/vehicle/"


def text_field(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 100:
        raise TripError(f"Enter a valid vehicle {key} (up to 100 characters).")
    return value.strip()


def vehicle_year(value):
    if not isinstance(value, int) or isinstance(value, bool) or not 1984 <= value <= datetime.now().year + 1:
        raise TripError("Choose a vehicle year from 1984 through next model year.")
    return value


def vehicle_options(year, make, model):
    year = vehicle_year(year)
    make, model = text_field({"make": make}, "make"), text_field({"model": model}, "model")
    query = urlencode({"year": year, "make": make, "model": model})

    def load():
        data = request_json(BASE + "menu/options?" + query, "FuelEconomy.gov")
        items = data.get("menuItem", []) if isinstance(data, dict) else []
        if isinstance(items, dict):
            items = [items]
        return [{"id": str(item["value"]), "label": item["text"]} for item in items
                if isinstance(item, dict) and str(item.get("value", "")).isdigit() and item.get("text")][:40]
    return catalog_cache.get_or_load(("options", year, make.lower(), model.lower()), load)


def epa_vehicle(vehicle_id):
    if not isinstance(vehicle_id, str) or not vehicle_id.isdigit() or len(vehicle_id) > 8:
        raise TripError("Choose a valid EPA vehicle configuration.")

    def load():
        data = request_json(BASE + vehicle_id, "FuelEconomy.gov")
        try:
            fuel = data["fuelType1"]
            if fuel not in ("Regular Gasoline", "Premium Gasoline", "Midgrade Gasoline", "Diesel"):
                raise TripError("Gas-stop planning supports gasoline and diesel vehicles. Electric/alternative-fuel range is not supported yet.")
            mpg = float(data["highway08"])
            if not 5 <= mpg <= 150:
                raise ValueError()
            return {"year": int(data["year"]), "make": data["make"], "model": data["model"],
                    "mpg": mpg, "mpgSource": "EPA highway MPG", "epaId": vehicle_id,
                    "configuration": f"{data.get('trany', '')} · {data.get('cylinders', '?')} cyl · {data.get('displ', '?')} L",
                    "fuelType": fuel}
        except TripError:
            raise
        except (KeyError, TypeError, ValueError):
            raise ProviderError("FuelEconomy.gov returned an incomplete vehicle rating.") from None
    return catalog_cache.get_or_load(("vehicle", vehicle_id), load)


def validate_vehicle(data):
    if not isinstance(data, dict):
        raise TripError("Expected a vehicle profile.")
    capacity = data.get("tankGallons")
    if not finite_number(capacity) or not 1 <= capacity <= 80:
        raise TripError("Enter fuel tank capacity between 1 and 80 US gallons.")
    if data.get("epaId"):
        vehicle = epa_vehicle(data["epaId"])
    else:
        mpg = data.get("mpg")
        if not finite_number(mpg) or not 5 <= mpg <= 150:
            raise TripError("Enter estimated highway fuel economy between 5 and 150 MPG.")
        fuel = data.get("fuelType", "Regular Gasoline")
        if fuel not in ("Regular Gasoline", "Premium Gasoline", "Midgrade Gasoline", "Diesel"):
            raise TripError("Choose gasoline or diesel for gas-stop planning.")
        vehicle = {"year": vehicle_year(data.get("year")), "make": text_field(data, "make"),
                   "model": text_field(data, "model"), "mpg": float(mpg), "mpgSource": "Your highway MPG estimate",
                   "epaId": None, "configuration": "Manually entered", "fuelType": fuel}
    return vehicle | {"tankGallons": float(capacity)}
