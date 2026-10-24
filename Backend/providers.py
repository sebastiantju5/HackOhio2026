"""Bounded, cached HTTP adapters. Provider failures never substitute demo data."""

import json
import os
import socket
from collections import OrderedDict
from datetime import datetime, timedelta
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from corridor import UTC, iso


class ProviderError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class BoundedCache:
    def __init__(self, maximum=32, ttl=600):
        self.maximum, self.ttl = maximum, ttl
        self.items = OrderedDict()
        self.lock = Lock()

    def get_or_load(self, key, loader):
        # One loader at a time also deduplicates identical concurrent requests.
        # Appropriate for this single-process hackathon server, not a distributed cache.
        with self.lock:
            value = self.items.get(key)
            if value and monotonic() - value[0] < self.ttl:
                self.items.move_to_end(key)
                return value[1]
            result = loader()
            self.items[key] = (monotonic(), result)
            self.items.move_to_end(key)
            while len(self.items) > self.maximum:
                self.items.popitem(last=False)
            return result


route_cache = BoundedCache(ttl=300)
weather_cache = BoundedCache()


def request_json(url, provider):
    try:
        request = Request(url, headers={"User-Agent": "Weatherway-HackOhio/0.1 (local development)", "Accept": "application/json"})
        with urlopen(request, timeout=18) as response:
            payload = response.read(8_000_001)
            if len(payload) > 8_000_000:
                raise ProviderError(f"{provider} response exceeded the supported size.")
            return json.loads(payload)
    except HTTPError as error:
        if error.code in (401, 403):
            raise ProviderError(f"{provider} access was denied. Check the configured provider credentials.", 503) from None
        if error.code == 429:
            raise ProviderError(f"{provider} rate limit reached. Wait before retrying.", 503) from None
        raise ProviderError(f"{provider} returned HTTP {error.code}. Try again or select the simulated scenario.") from None
    except (socket.timeout, TimeoutError):
        raise ProviderError(f"{provider} timed out. Try again or select the simulated scenario.", 504) from None
    except (URLError, OSError, ValueError):
        raise ProviderError(f"Cannot reach {provider} or read its response. Live data was not replaced with a simulation.", 503) from None


def routing_provider():
    return "Mapbox" if os.environ.get("MAPBOX_ACCESS_TOKEN") else "OSRM"


def fetch_routes(origin, destination, departure, alternatives=True):
    provider = routing_provider()
    key = (provider, tuple(origin["coordinates"]), tuple(destination["coordinates"]),
           iso(departure) if provider == "Mapbox" else None, alternatives)

    def load():
        coordinates = ";".join(",".join(str(v) for v in point["coordinates"]) for point in (origin, destination))
        params = {"geometries": "geojson", "overview": "full", "annotations": "duration,distance", "steps": "false",
                  "alternatives": "true" if alternatives else "false"}
        if provider == "Mapbox":
            base = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/"
            params.update({"depart_at": iso(departure), "access_token": os.environ["MAPBOX_ACCESS_TOKEN"]})
        else:
            base = "https://router.project-osrm.org/route/v1/driving/"
        data = request_json(base + coordinates + "?" + urlencode(params), provider)
        if not isinstance(data, dict) or data.get("code") != "Ok" or not data.get("routes"):
            raise ProviderError(f"{provider} could not find a drivable route between these locations.")
        result = []
        for index, route in enumerate(data["routes"][:2]):
            try:
                durations = [value for leg in route["legs"] for value in leg["annotation"]["duration"]]
                result.append({"id": f"live-{index}", "name": "Direct route" if index == 0 else "Alternative route",
                               "geometry": route["geometry"], "distanceMeters": round(route["distance"]),
                               "edgeDurationsSeconds": durations, "provider": provider,
                               "trafficAware": provider == "Mapbox"})
            except (KeyError, TypeError, ValueError):
                raise ProviderError(f"{provider} returned a route without usable travel-time annotations.") from None
        return result, {"provider": provider, "retrievedAt": iso(datetime.now(UTC)),
                        "trafficNote": "Travel times frozen at the earliest departure; not weather-adjusted."
                        if provider == "Mapbox" else "OSRM demo routing; no live traffic. Travel times frozen across departures."}

    return route_cache.get_or_load(key, load)


def forecast_model(locations):
    """HRRR covers the continental US. Anywhere else uses the global GFS model."""
    def in_hrrr(lon, lat):
        return -134 <= lon <= -60 and 21 <= lat <= 53
    if locations and all(in_hrrr(lon, lat) for lon, lat in locations):
        return "gfs_hrrr", "NOAA HRRR (gfs_hrrr)"
    return "gfs_seamless", "NOAA GFS (gfs_seamless)"


def fetch_forecasts(routes, start, end):
    points = [p for route in routes for p in route["checkpoints"]]
    # Keep sensitivity lookups covered and align preceding-sum endpoints to quarter hours.
    first = start - timedelta(minutes=30)
    first = first.replace(minute=(first.minute // 15) * 15, second=0, microsecond=0)
    last = end + timedelta(seconds=max(r["durationSeconds"] for r in routes), minutes=30)
    last = last.replace(second=0, microsecond=0) + timedelta(minutes=(15 - last.minute % 15) % 15)
    locations = list(dict.fromkeys(tuple(p["coordinates"]) for p in points))
    model, model_label = forecast_model(locations)
    key = (tuple(locations), iso(first), iso(last), model)

    def load():
        names = {"temperatureC": "temperature_2m", "precipitationMm": "precipitation", "visibilityM": "visibility",
                 "windKph": "wind_speed_10m", "gustKph": "wind_gusts_10m", "windDirectionDeg": "wind_direction_10m"}
        params = {"latitude": ",".join(str(p[1]) for p in locations),
                  "longitude": ",".join(str(p[0]) for p in locations),
                  "minutely_15": ",".join(names.values()), "models": model, "timezone": "GMT",
                  "timeformat": "unixtime", "temperature_unit": "celsius", "wind_speed_unit": "kmh",
                  "precipitation_unit": "mm", "start_minutely_15": first.strftime("%Y-%m-%dT%H:%M"),
                  "end_minutely_15": last.strftime("%Y-%m-%dT%H:%M")}
        data = request_json("https://api.open-meteo.com/v1/forecast?" + urlencode(params), "Open-Meteo")
        responses = data if isinstance(data, list) else [data]
        if len(responses) != len(locations):
            raise ProviderError("Open-Meteo returned a different number of forecast locations than requested.")
        by_location = {}
        for location, item in zip(locations, responses):
            block = item.get("minutely_15", {}) if isinstance(item, dict) else {}
            times = block.get("time", [])
            if not times or any(not isinstance(t, (float, int)) for t in times) or any(b - a != 900 for a, b in zip(times, times[1:])):
                raise ProviderError("Open-Meteo did not return a regular 15-minute time series.")
            values = {field: block.get(name) or block.get(f"{name}_{model}") or [] for field, name in names.items()}
            by_location[location] = {"times": times, "values": values, "intervalSeconds": 900,
                                     "gridCoordinates": [item.get("longitude"), item.get("latitude")]}
        fetched = iso(datetime.now(UTC))
        all_times = [stamp for series in by_location.values() for stamp in series["times"]]
        source = {"provider": "Open-Meteo", "model": model_label, "retrievedAt": fetched,
                  "validStart": iso(datetime.fromtimestamp(min(all_times), UTC)),
                  "validEnd": iso(datetime.fromtimestamp(max(all_times), UTC)), "cadenceMinutes": 15,
                  "note": "15-minute returned cadence; some variables may be derived or interpolated. Model issue time not supplied."}
        return by_location, source

    by_location, source = weather_cache.get_or_load(key, load)
    return {route["id"]: [by_location[tuple(p["coordinates"])] for p in route["checkpoints"]] for route in routes}, source
