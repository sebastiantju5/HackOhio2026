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


MAKE_ALIASES = {"chevy": "chevrolet", "vw": "volkswagen", "mercedes": "mercedesbenz", "benz": "mercedesbenz"}


def compact_name(value):
    return "".join(ch for ch in value.lower() if ch.isalnum())


def menu_rows(data):
    items = data.get("menuItem", []) if isinstance(data, dict) else []
    if isinstance(items, dict):
        items = [items]
    return [item for item in items if isinstance(item, dict) and item.get("text") and item.get("value")]


def configuration_options(data):
    return [{"id": str(item["value"]), "label": item["text"]} for item in menu_rows(data)
            if str(item.get("value", "")).isdigit()][:40]


def matching_menu_rows(typed, rows):
    needle = MAKE_ALIASES.get(compact_name(typed), compact_name(typed))
    exact = [row for row in rows if compact_name(row["text"]) == needle]
    if exact:
        return exact
    starts = [row for row in rows if compact_name(row["text"]).startswith(needle)]
    if starts:
        return starts
    return [row for row in rows if needle and needle in compact_name(row["text"])]


def vehicle_options(year, make, model):
    year = vehicle_year(year)
    make, model = text_field({"make": make}, "make"), text_field({"model": model}, "model")

    def load():
        direct = configuration_options(request_json(BASE + "menu/options?" + urlencode({"year": year, "make": make, "model": model}), "FuelEconomy.gov"))
        if direct:
            return direct
        makes = matching_menu_rows(make, menu_rows(request_json(BASE + f"menu/make?year={year}", "FuelEconomy.gov")))
        if len(makes) != 1:
            return []
        canonical_make = makes[0]["value"]
        models = matching_menu_rows(model, menu_rows(request_json(
            BASE + "menu/model?" + urlencode({"year": year, "make": canonical_make}), "FuelEconomy.gov")))
        found = []
        for item in models[:12]:
            label_prefix = f"{item['text']} · " if len(models) > 1 else ""
            for option in configuration_options(request_json(
                    BASE + "menu/options?" + urlencode({"year": year, "make": canonical_make, "model": item["value"]}), "FuelEconomy.gov")):
                found.append({"id": option["id"], "label": label_prefix + option["label"]})
                if len(found) >= 40:
                    return found
        return found
    return catalog_cache.get_or_load(("options", year, compact_name(make), compact_name(model)), load)


def published_tank_gallons(data):
    """US gallons implied by FuelEconomy.gov range and combined MPG. Conventional cars publish 0 miles, so they have no tank size."""
    try:
        miles = float(data.get("range") or 0)
        rate = float(data.get("comb08") or 0)
        alternate = float(data.get("rangeA") or 0)
    except (TypeError, ValueError):
        return None
    if 0 < alternate < miles:
        miles -= alternate
    if miles <= 0 or rate <= 0:
        return None
    gallons = round(miles / rate, 1)
    if 1 <= gallons <= 80:
        return gallons
    return None


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
            profile = {"year": int(data["year"]), "make": data["make"], "model": data["model"],
                       "mpg": mpg, "mpgSource": "EPA highway MPG", "epaId": vehicle_id,
                       "configuration": f"{data.get('trany', '')} · {data.get('cylinders', '?')} cyl · {data.get('displ', '?')} L",
                       "fuelType": fuel}
            tank = published_tank_gallons(data)
            if tank is not None:
                profile["tankGallons"] = tank
                profile["tankSource"] = "FuelEconomy.gov published range"
            return profile
        except TripError:
            raise
        except (KeyError, TypeError, ValueError):
            raise ProviderError("FuelEconomy.gov returned an incomplete vehicle rating.") from None
    return catalog_cache.get_or_load(("vehicle", vehicle_id), load)


def validate_vehicle(data):
    if not isinstance(data, dict):
        raise TripError("Expected a vehicle profile.")
    if data.get("epaId"):
        vehicle_year(data.get("year"))
        text_field(data, "make")
        text_field(data, "model")
        epa_id = data["epaId"] if isinstance(data["epaId"], str) else ""
        return epa_vehicle(epa_id)
    fuel = data.get("fuelType", "Regular Gasoline")
    if fuel not in ("Regular Gasoline", "Premium Gasoline", "Midgrade Gasoline", "Diesel"):
        raise TripError("Choose gasoline or diesel.")
    vehicle = {"year": vehicle_year(data.get("year")), "make": text_field(data, "make"),
               "model": text_field(data, "model"), "fuelType": fuel}
    if "mpg" not in data and "tankGallons" not in data:
        return vehicle
    capacity = data.get("tankGallons")
    if not finite_number(capacity) or not 1 <= capacity <= 80:
        raise TripError("Enter fuel tank capacity between 1 and 80 US gallons.")
    mpg = data.get("mpg")
    if not finite_number(mpg) or not 5 <= mpg <= 150:
        raise TripError("Enter estimated highway fuel economy between 5 and 150 MPG.")
    return {**vehicle, "mpg": float(mpg), "mpgSource": "Your highway MPG estimate",
            "epaId": None, "configuration": "Manually entered", "tankGallons": float(capacity)}


PRICE_SERIES = {
    "EMM_EPMR_PTE_SOH_DPG": ("Regular Gasoline", "Ohio"),
    "EMM_EPMM_PTE_SOH_DPG": ("Midgrade Gasoline", "Ohio"),
    "EMM_EPMP_PTE_SOH_DPG": ("Premium Gasoline", "Ohio"),
    "EMD_EPD2DXL0_PTE_NUS_DPG": ("Diesel", "U.S."),
}
price_cache = BoundedCache(maximum=4, ttl=6 * 3600)


def retail_fuel_prices():
    """Latest EIA weekly retail averages. Gasoline is Ohio; diesel is the U.S. average."""
    def load():
        query = urlencode([
            ("api_key", "DEMO_KEY"),
            ("frequency", "weekly"),
            ("data[0]", "value"),
            ("sort[0][column]", "period"),
            ("sort[0][direction]", "desc"),
            ("length", "8"),
            *[("facets[series][]", series) for series in PRICE_SERIES],
        ])
        payload = request_json(f"https://api.eia.gov/v2/petroleum/pri/gnd/data/?{query}", "EIA")
        prices = {}
        period = None
        for row in payload.get("response", {}).get("data", []):
            mapped = PRICE_SERIES.get(row.get("series"))
            if not mapped or mapped[0] in prices:
                continue
            try:
                value = float(row["value"])
            except (TypeError, ValueError):
                continue
            if not 0.5 <= value <= 20:
                continue
            prices[mapped[0]] = {"dollarsPerGallon": round(value, 3), "area": mapped[1]}
            period = period or row.get("period")
        if "Regular Gasoline" not in prices:
            raise ProviderError("EIA did not return a gasoline price.")
        return {"period": period, "prices": prices, "source": "EIA weekly retail average"}

    try:
        return price_cache.get_or_load("retail", load)
    except ProviderError:
        return None
