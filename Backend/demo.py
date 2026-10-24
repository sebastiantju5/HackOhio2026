"""Synthetic scenario, deliberately independent of current weather and live APIs."""

import json
from datetime import timedelta
from pathlib import Path

from corridor import distance

FIXTURE = Path(__file__).with_name("fixtures") / "ohio-simulation.json"


def scenario():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def demo_routes(include_alternatives=True):
    data = scenario()
    routes = []
    for item in data["routes"][:2 if include_alternatives else 1]:
        coords = item["coordinates"]
        lengths = [distance(a, b) for a, b in zip(coords, coords[1:])]
        total = sum(lengths)
        routes.append({"id": item["id"], "name": item["name"], "geometry": {"type": "LineString", "coordinates": coords},
                       "distanceMeters": round(total), "edgeDurationsSeconds": [item["durationMinutes"] * 60 * length / total for length in lengths],
                       "provider": "Illustrative corridor", "trafficAware": False})
    return routes


def demo_forecasts(routes, start):
    """A fixed moving rain band; departure times are relative to the chosen window."""
    result = {}
    for route in routes:
        series = []
        for checkpoint in route["checkpoints"]:
            times, values = [], {field: [] for field in ("temperatureC", "precipitationMm", "visibilityM", "windKph", "gustKph", "windDirectionDeg")}
            north = (checkpoint["coordinates"][1] - 39.96) / 1.54
            for minute in range(-60, 481, 15):
                # The band crosses the I-71 corridor early, then moves east.
                peak = 55 + north * 40
                intensity = max(0, 1 - abs(minute - peak) / 48)
                if route["id"] == "demo-west":
                    intensity *= 0.42
                times.append((start + timedelta(minutes=minute)).timestamp())
                row = {"temperatureC": round(14 - north * 2, 1), "precipitationMm": round(3.6 * intensity, 2),
                       "visibilityM": round(16000 - 15400 * intensity), "windKph": round(12 + 22 * intensity, 1),
                       "gustKph": round(18 + 44 * intensity, 1), "windDirectionDeg": 280}
                for field in values:
                    values[field].append(row[field])
            series.append({"times": times, "values": values, "intervalSeconds": 900})
        result[route["id"]] = series
    return result
