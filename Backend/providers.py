"""Bounded, cached HTTP adapters. Provider failures never substitute demo data."""

import json
import os
import socket
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import RLock
from time import monotonic, sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from corridor import FIELDS, UTC, finite_number, iso


class ProviderError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class BoundedCache:
    def __init__(self, maximum=32, ttl=600):
        self.maximum, self.ttl = maximum, ttl
        self.items = OrderedDict()
        self.locations = OrderedDict()
        self.lock = RLock()

    def get_location(self, key):
        with self.lock:
            val = self.locations.get(key)
            if val and monotonic() - val[0] < self.ttl:
                self.locations.move_to_end(key)
                return val[1]
            return None

    def set_location(self, key, value):
        with self.lock:
            self.locations[key] = (monotonic(), value)
            self.locations.move_to_end(key)
            while len(self.locations) > 500:
                self.locations.popitem(last=False)

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


def request_json(url, provider, retries=1):
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": "Weatherway-HackOhio/0.1 (local development)", "Accept": "application/json"})
            with urlopen(request, timeout=18) as response:
                payload = response.read(8_000_001)
                if len(payload) > 8_000_000:
                    raise ProviderError(f"{provider} response exceeded the supported size.")
                return json.loads(payload)
        except HTTPError as error:
            if error.code == 429 and attempt < retries and provider == "Open-Meteo":
                retry_after = error.headers.get("Retry-After") if hasattr(error, "headers") and error.headers else None
                try:
                    wait_seconds = float(retry_after) if retry_after else (1.5 * (attempt + 1))
                except (ValueError, TypeError):
                    wait_seconds = 1.5 * (attempt + 1)
                sleep(min(wait_seconds, 10.0))
                continue
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


def forecast_model(locations, last=None, now=None):
    """Use HRRR only while the whole trip fits its short 15-minute horizon.

    Its published horizon is 18h; leave 2h for model publication lag. GFS
    provides the longer-range series, returned at an interpolated 15m cadence.
    """
    def in_hrrr(lon, lat):
        return -134 <= lon <= -60 and 21 <= lat <= 53
    within_horizon = last is None or last <= (now or datetime.now(UTC)) + timedelta(hours=16)
    if within_horizon and locations and all(in_hrrr(lon, lat) for lon, lat in locations):
        return "gfs_hrrr", "NOAA HRRR (gfs_hrrr)"
    return "gfs_seamless", "NOAA GFS (gfs_seamless)"


def fetch_forecasts(routes, start, end, *, now=None):
    points = [p for route in routes for p in route["checkpoints"]]
    # Keep sensitivity lookups covered and align preceding-sum endpoints to quarter hours.
    first = start - timedelta(minutes=30)
    first = first.replace(minute=(first.minute // 15) * 15, second=0, microsecond=0)
    # Cover up to 90 minutes of breaks plus arrival-time sensitivity.
    last = end + timedelta(seconds=max(r["durationSeconds"] for r in routes), minutes=120)
    last = last.replace(second=0, microsecond=0) + timedelta(minutes=(15 - last.minute % 15) % 15)
    locations = list(dict.fromkeys(tuple(p["coordinates"]) for p in points))
    model, model_label = forecast_model(locations, last, now)
    key = (tuple(locations), iso(first), iso(last), model)

    def load():
        cached_by_loc = {}
        missing_locations = []
        first_stamp, last_stamp = first.timestamp(), last.timestamp()
        for loc in locations:
            cached = weather_cache.get_location((loc, model))
            if cached and cached["times"][0] <= first_stamp and cached["times"][-1] >= last_stamp:
                cached_by_loc[loc] = cached
            else:
                missing_locations.append(loc)

        if missing_locations:
            names = {"temperatureC": "temperature_2m", "precipitationMm": "precipitation", "visibilityM": "visibility",
                     "windKph": "wind_speed_10m", "gustKph": "wind_gusts_10m", "windDirectionDeg": "wind_direction_10m"}

            query_end = max(last, first + timedelta(hours=12))

            def fetch_chunk(chunk):
                params = {"latitude": ",".join(str(round(p[1], 4)) for p in chunk),
                          "longitude": ",".join(str(round(p[0], 4)) for p in chunk),
                          "minutely_15": ",".join(names.values()), "models": model, "timezone": "GMT",
                          "timeformat": "unixtime", "temperature_unit": "celsius", "wind_speed_unit": "kmh",
                          "precipitation_unit": "mm", "start_minutely_15": first.strftime("%Y-%m-%dT%H:%M"),
                          "end_minutely_15": query_end.strftime("%Y-%m-%dT%H:%M")}
                data = request_json("https://api.open-meteo.com/v1/forecast?" + urlencode(params), "Open-Meteo")
                return data if isinstance(data, list) else [data]

            chunk_size = 50
            chunks = [missing_locations[i:i + chunk_size] for i in range(0, len(missing_locations), chunk_size)]
            if len(chunks) == 1:
                responses = fetch_chunk(chunks[0])
            else:
                with ThreadPoolExecutor(max_workers=min(len(chunks), 4)) as pool:
                    responses = [item for sublist in pool.map(fetch_chunk, chunks) for item in sublist]

            if len(responses) != len(missing_locations):
                raise ProviderError("Open-Meteo returned a different number of forecast locations than requested.")

            for location, item in zip(missing_locations, responses):
                block = item.get("minutely_15", {}) if isinstance(item, dict) else {}
                times = block.get("time", [])
                if not times or any(not isinstance(t, (float, int)) for t in times) or any(b - a != 900 for a, b in zip(times, times[1:])):
                    raise ProviderError("Open-Meteo did not return a regular 15-minute time series.")
                values = {field: block.get(name) or block.get(f"{name}_{model}") or [] for field, name in names.items()}
                series = {"times": times, "values": values, "intervalSeconds": 900,
                          "gridCoordinates": [item.get("longitude"), item.get("latitude")]}
                cached_by_loc[location] = series
                weather_cache.set_location((location, model), series)

        by_location = {loc: cached_by_loc[loc] for loc in locations}
        fetched = iso(datetime.now(UTC))
        # Timestamp slots can exist while every value is null beyond a model's
        # horizon. Report only timestamps with all required measurements at all
        # locations as usable coverage, and keep gaps explicitly partial.
        valid_sets = []
        for series in by_location.values():
            valid_sets.append({stamp for index, stamp in enumerate(series["times"])
                               if all(index < len(series["values"][field]) and finite_number(series["values"][field][index])
                                      for field in FIELDS)})
        valid_times = set.intersection(*valid_sets)
        expected_times = set(range(int(first.timestamp()), int(last.timestamp()) + 1, 900))
        source = {"provider": "Open-Meteo", "model": model_label, "retrievedAt": fetched,
                  "validStart": iso(datetime.fromtimestamp(min(valid_times), UTC)) if valid_times else None,
                  "validEnd": iso(datetime.fromtimestamp(max(valid_times), UTC)) if valid_times else None,
                  "coverageStatus": "complete" if expected_times <= valid_times else "partial", "cadenceMinutes": 15,
                  "note": ("Short-range HRRR forecast; some measurements are derived or interpolated. " if model == "gfs_hrrr" else
                           "GFS selected for longer-range or out-of-area coverage. Returned 15-minute values are interpolated from coarser model data. ")
                          + "Model issue time not supplied. Missing measurements remain unknown."}
        return by_location, source

    by_location, source = weather_cache.get_or_load(key, load)
    return {route["id"]: [by_location[tuple(p["coordinates"])] for p in route["checkpoints"]] for route in routes}, source
