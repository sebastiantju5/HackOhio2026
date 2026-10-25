"""Validate compact Google Routes geometry produced by the browser SDK."""

from datetime import datetime

from corridor import TripError, UTC, distance, finite_number, iso


def read_google_routes(items, origin, destination, alternatives):
    if not isinstance(items, list) or not 1 <= len(items) <= 2:
        raise TripError("Google Routes must supply one or two routes.")
    result = []
    for index, item in enumerate(items[:2 if alternatives else 1]):
        if not isinstance(item, dict):
            raise TripError("Invalid Google route.")
        coords, durations = item.get("coordinates"), item.get("durations")
        if not isinstance(coords, list) or not 2 <= len(coords) <= 140:
            raise TripError("Google route geometry is missing or too large.")
        for point in coords:
            if not isinstance(point, list) or len(point) != 2 or not all(map(finite_number, point)) or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                raise TripError("Invalid Google route coordinates.")
        if not isinstance(durations, list) or len(durations) != len(coords) - 1 or not all(finite_number(t) and t >= 0 for t in durations):
            raise TripError("Google route travel-time annotations do not match its geometry.")
        meters = item.get("distanceMeters")
        if not finite_number(meters) or not 0 < meters <= 2_000_000:
            raise TripError("Invalid Google route distance.")
        if distance(coords[0], origin["coordinates"]) > 5000 or distance(coords[-1], destination["coordinates"]) > 5000:
            raise TripError("Google route does not match the selected endpoints.")
        result.append({"id": f"google-{index}", "name": "Direct route" if index == 0 else "Alternative route",
                       "geometry": {"type": "LineString", "coordinates": coords}, "distanceMeters": round(meters),
                       "edgeDurationsSeconds": durations, "provider": "Google Routes", "trafficAware": True})
    return result, {"provider": "Google Routes", "retrievedAt": iso(datetime.now(UTC)),
                    "trafficNote": "Google step times scaled to the traffic-aware leg duration at the earliest departure. Compact geometry and within-step timing are approximate; baseline times stay fixed across departures."}
