"""Pure route sampling, forecast matching and departure comparison.

Exposure classes are demo heuristics, not calibrated safety probabilities.
All internal times and API timestamps are UTC; all units are SI.
"""

from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from math import atan2, cos, degrees, isfinite, radians, sin, sqrt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
SCORING_VERSION = "heuristic-1"
CLASS_NAMES = ["lower", "caution", "higher"]
FIELDS = ("temperatureC", "precipitationMm", "visibilityM", "windKph", "gustKph", "windDirectionDeg")


class TripError(ValueError):
    pass


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(UTC)
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise TripError("Departure times must include an explicit UTC offset.") from None


def finite_number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value)


def validate_request(data, now=None):
    if not isinstance(data, dict):
        raise TripError("Expected a JSON object.")
    mode = data.get("dataMode", "demo")
    if mode not in ("demo", "live"):
        raise TripError("Choose demo or live mode.")
    start, end = parse_time(data.get("departureStart")), parse_time(data.get("departureEnd"))
    if end < start:
        raise TripError("The ending time must be at or after the starting time.")
    zone = data.get("timeZone", "America/New_York")
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise TripError("Choose a valid IANA time zone.") from None
    points = []
    for key in ("origin", "destination"):
        point = data.get(key)
        if not isinstance(point, dict):
            raise TripError(f"{key.title()} must include name and coordinates.")
        coordinate = point.get("coordinates")
        if not isinstance(coordinate, list) or len(coordinate) != 2 or not all(map(finite_number, coordinate)):
            raise TripError(f"{key.title()} coordinates must be [longitude, latitude].")
        lon, lat = coordinate
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise TripError(f"{key.title()} coordinates must be a real longitude and latitude.")
        name = point.get("name", key.title())
        if not isinstance(name, str) or not name.strip() or len(name) > 180:
            raise TripError("Place names must be between 1 and 180 characters.")
        points.append({"name": name.strip(), "coordinates": coordinate})
    if points[0]["coordinates"] == points[1]["coordinates"]:
        raise TripError("Choose different origin and destination locations.")
    if mode == "live":
        now = now or datetime.now(UTC)
        if start < now - timedelta(minutes=15) or end > now + timedelta(hours=12):
            raise TripError("For live forecasts, depart between now and the next 12 hours.")
    alternatives = data.get("includeAlternatives", True)
    if not isinstance(alternatives, bool):
        raise TripError("includeAlternatives must be a boolean.")
    return {"dataMode": mode, "start": start, "end": end, "timeZone": zone,
            "origin": points[0], "destination": points[1], "includeAlternatives": alternatives}


def distance(a, b):
    lat1, lat2 = radians(a[1]), radians(b[1])
    dlat, dlon = lat2 - lat1, radians(b[0] - a[0])
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 6371000 * 2 * atan2(sqrt(h), sqrt(max(0, 1 - h)))


def bearing(a, b):
    lat1, lat2 = radians(a[1]), radians(b[1])
    dl = radians(b[0] - a[0])
    return degrees(atan2(sin(dl) * cos(lat2), cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dl))) % 360


def sample_route(route, interval_seconds=900):
    coords, durations = route["geometry"]["coordinates"], route["edgeDurationsSeconds"]
    if len(coords) < 2 or len(durations) != len(coords) - 1:
        raise TripError("Routing provider returned mismatched geometry and edge durations.")
    if not all(finite_number(t) and t >= 0 for t in durations) or sum(durations) <= 0:
        raise TripError("The routing provider returned invalid travel times.")
    cumulative, distances = [0.0], [0.0]
    for i, duration in enumerate(durations):
        cumulative.append(cumulative[-1] + duration)
        distances.append(distances[-1] + distance(coords[i], coords[i + 1]))
    if distances[-1] <= 0:
        raise TripError("Routing provider returned a route without distance.")
    # Google geometry is compacted for transport; keep provider road mileage.
    scale = route["distanceMeters"] / distances[-1]
    distances = [value * scale for value in distances]
    total = cumulative[-1]
    offsets = list(range(0, int(total), interval_seconds)) + [total]
    checkpoints = []
    for i, offset in enumerate(offsets):
        edge = 0 if offset == 0 else min(bisect_right(cumulative, offset) - 1, len(durations) - 1)
        fraction = 0 if offset == 0 else (min(1, max(0, (offset - cumulative[edge]) / durations[edge])) if durations[edge] else 1)
        point = [coords[edge][axis] + fraction * (coords[edge + 1][axis] - coords[edge][axis]) for axis in (0, 1)]
        checkpoints.append({"id": f"{route['id']}-cp-{i}", "index": i, "coordinates": point,
                            "offsetSeconds": round(offset, 3), "bearingDeg": round(bearing(coords[edge], coords[edge + 1]), 2),
                            "distanceMeters": round(distances[edge] + fraction * (distances[edge + 1] - distances[edge])),
                            "edgeIndex": edge})
    segments = []
    for left, right in zip(checkpoints, checkpoints[1:]):
        points = [left["coordinates"]] + coords[left["edgeIndex"] + 1:right["edgeIndex"] + 1] + [right["coordinates"]]
        segments.append({"coordinates": points, "durationSeconds": right["offsetSeconds"] - left["offsetSeconds"]})
    return {k: v for k, v in route.items() if k != "edgeDurationsSeconds"} | {
        "durationSeconds": round(total), "checkpoints": checkpoints, "segments": segments}


def lookup_forecast(series, arrival):
    """Precipitation represents (validEnd - interval, validEnd]; no extrapolation."""
    times = series["times"]
    stamp = arrival.timestamp()
    # A preceding-interval sum uses the first ending timestamp at or after arrival.
    from bisect import bisect_left
    index = bisect_left(times, stamp)
    if index >= len(times):
        return None
    interval = series["intervalSeconds"]
    if stamp <= times[index] - interval:
        return None
    values = {field: series["values"].get(field, [])[index]
              if index < len(series["values"].get(field, [])) else None for field in FIELDS}
    return values | {"validStart": iso(datetime.fromtimestamp(times[index] - interval, UTC)),
                     "validEnd": iso(datetime.fromtimestamp(times[index], UTC)), "intervalSeconds": interval}


def score_weather(weather, road_bearing):
    if weather is None:
        return {"level": "unknown", "severity": None, "reasons": ["Forecast does not cover this arrival time."], "weather": None}
    missing = [field for field in FIELDS if not finite_number(weather.get(field))]
    invalid = any(weather.get(field) is not None and finite_number(weather[field]) and weather[field] < 0
                  for field in ("precipitationMm", "visibilityM", "windKph", "gustKph"))
    if missing or invalid:
        return {"level": "unknown", "severity": None, "reasons": ["Incomplete or invalid forecast measurements."], "weather": weather}
    rain = weather["precipitationMm"] * 3600 / weather["intervalSeconds"]
    crosswind = abs(weather["gustKph"] * sin(radians(weather["windDirectionDeg"] - road_bearing)))
    severity, reasons = 0, []
    # Versioned demonstration thresholds; not vehicle-specific driving limits.
    for value, caution, higher, reason in (
        (rain, 1.0, 7.5, "Rain intensity"), (crosswind, 25, 45, "Projected crosswind gust"),
    ):
        level = 2 if value >= higher else 1 if value >= caution else 0
        severity = max(severity, level)
        if level:
            reasons.append(f"{reason}: {value:.1f} {'mm/h' if reason == 'Rain intensity' else 'km/h'}.")
    visibility = weather["visibilityM"]
    if visibility < 3000:
        severity = max(severity, 2 if visibility < 1000 else 1)
        reasons.append(f"Reduced visibility: {visibility / 1000:.1f} km.")
    if weather["temperatureC"] <= 2 and rain > 0:
        severity = max(severity, 2)
        reasons.append("Possible freezing conditions: precipitation and air temperature near freezing; pavement state unknown.")
    weather = weather | {"rainMmPerHour": round(rain, 2), "crosswindGustKph": round(crosswind, 1)}
    return {"level": CLASS_NAMES[severity], "severity": severity,
            "reasons": reasons or ["No demonstration exposure thresholds exceeded."], "weather": weather}


def evaluate_candidate(route, series, departure, shift_minutes=0):
    points = []
    for checkpoint, forecast in zip(route["checkpoints"], series):
        arrival = departure + timedelta(seconds=checkpoint["offsetSeconds"], minutes=shift_minutes)
        points.append({"checkpointId": checkpoint["id"], "arrival": iso(arrival),
                       **score_weather(lookup_forecast(forecast, arrival), checkpoint["bearingDeg"])})
    high, caution, unknown, weighted, segment_levels = 0.0, 0.0, 0.0, 0.0, []
    for i, segment in enumerate(route["segments"]):
        pair = points[i:i + 2]
        minutes = segment["durationSeconds"] / 60
        known = [p["severity"] for p in pair if p["severity"] is not None]
        # Known hazards remain visible even when the other endpoint is unknown.
        severity = max(known, default=0)
        incomplete = len(known) < 2
        level = CLASS_NAMES[severity] if severity > 0 or not incomplete else "unknown"
        segment_levels.append(level)
        if incomplete:
            unknown += minutes
        if severity == 2:
            high += minutes
        elif severity == 1:
            caution += minutes
        weighted += severity * minutes
    worst = max((p["severity"] for p in points if p["severity"] is not None), default=0)
    complete = all(p["severity"] is not None for p in points)
    return {"routeId": route["id"], "departure": iso(departure),
            "arrival": iso(departure + timedelta(seconds=route["durationSeconds"])), "checkpoints": points,
            "segmentLevels": segment_levels, "higherMinutes": round(high, 1), "cautionMinutes": round(caution, 1),
            "unknownMinutes": round(unknown, 1), "weightedExposure": round(weighted, 2),
            "complete": complete, "worstSeverity": worst,
            "level": CLASS_NAMES[worst] if complete or worst > 0 else "unknown"}


def candidate_rank(candidate):
    return (not candidate["complete"], candidate["worstSeverity"], candidate["higherMinutes"],
            candidate["weightedExposure"], candidate["arrival"])


def analyze_routes(routes, all_series, start, end):
    departures, cursor = [], start
    while cursor <= end:
        departures.append(cursor)
        cursor += timedelta(minutes=5)
    if departures[-1] != end:
        departures.append(end)
    candidates = []
    for route in routes:
        for i, departure in enumerate(departures):
            candidate = evaluate_candidate(route, all_series[route["id"]], departure)
            candidate["id"] = f"{route['id']}-d-{i}"
            candidates.append(candidate)
    complete = [candidate for candidate in candidates if candidate["complete"]]
    if not complete:
        return candidates, {"candidateId": None, "reason": "No departure has complete forecast coverage. Unknown conditions are not treated as clear."}
    best = min(complete, key=candidate_rank)
    route = next(r for r in routes if r["id"] == best["routeId"])
    series = all_series[route["id"]]
    perturbed = [evaluate_candidate(route, series, parse_time(best["departure"]), shift) for shift in (-15, 15)]
    sensitive = any(not p["complete"] or p["worstSeverity"] != best["worstSeverity"]
                    or abs(p["higherMinutes"] - best["higherMinutes"]) >= 15 for p in perturbed)
    # Contiguous departures on the chosen route, at most five weighted minutes worse.
    same_route = [c for c in complete if c["routeId"] == best["routeId"]]
    index = same_route.index(best)
    left = right = index
    def similar(candidate):
        return candidate["worstSeverity"] == best["worstSeverity"] and candidate["weightedExposure"] <= best["weightedExposure"] + 5
    while left > 0 and parse_time(same_route[left]["departure"]) - parse_time(same_route[left - 1]["departure"]) <= timedelta(minutes=5) and similar(same_route[left - 1]):
        left -= 1
    while right + 1 < len(same_route) and parse_time(same_route[right + 1]["departure"]) - parse_time(same_route[right]["departure"]) <= timedelta(minutes=5) and similar(same_route[right + 1]):
        right += 1
    return candidates, {"candidateId": best["id"], "routeId": best["routeId"],
                        "windowStart": same_route[left]["departure"], "windowEnd": same_route[right]["departure"],
                        "timingSensitive": sensitive, "allHigherExposure": all(c["worstSeverity"] == 2 for c in complete),
                        "reason": "Ranked by peak class, higher-exposure minutes, weighted exposure, then earliest arrival. Window tolerance: 5 weighted minutes."}
