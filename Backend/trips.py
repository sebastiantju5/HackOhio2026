"""Anonymous trip analysis routes; no database or account dependency."""

from datetime import datetime
from uuid import uuid4
from time import monotonic

from flask import Blueprint, jsonify, request

from corridor import SCORING_VERSION, TripError, UTC, analyze_routes, iso, sample_route, validate_request
from demo import demo_forecasts, demo_routes, scenario
from providers import ProviderError, fetch_forecasts, fetch_routes, routing_provider
from providers import BoundedCache
from google_routes import read_google_routes
from stops import plan_stops
from vehicles import retail_fuel_prices, validate_vehicle

trips = Blueprint("trips", __name__)
analyses = BoundedCache(maximum=16, ttl=900)


def selected_analysis(analysis_id, candidate_id):
    with analyses.lock:
        item = analyses.items.get(analysis_id)
        if not item or monotonic() - item[0] >= analyses.ttl:
            return None
        snapshot = item[1]
    candidate = next((c for c in snapshot['candidates'] if c['id'] == candidate_id), None)
    if not candidate:
        raise TripError('Choose a departure from this analysis.')
    route = next(r for r in snapshot['routes'] if r['id'] == candidate['routeId'])
    return snapshot, route, candidate

PLACES = [
    {"name": "Columbus, OH", "coordinates": [-82.9988, 39.9612]},
    {"name": "Cleveland, OH", "coordinates": [-81.6944, 41.4993]},
    {"name": "Cincinnati, OH", "coordinates": [-84.5120, 39.1031]},
    {"name": "Dayton, OH", "coordinates": [-84.1916, 39.7589]},
    {"name": "Toledo, OH", "coordinates": [-83.5552, 41.6639]},
    {"name": "Akron, OH", "coordinates": [-81.5190, 41.0814]},
    {"name": "Mansfield, OH", "coordinates": [-82.5154, 40.7584]},
]


@trips.get("/api/trips/config")
def config():
    payload = {"places": PLACES, "routingProvider": routing_provider(), "demo": {
        "origin": PLACES[0], "destination": PLACES[1], "description": scenario()["description"]},
        "limits": {"departureStepMinutes": 5, "checkpointMinutes": 15}}
    prices = retail_fuel_prices()
    if prices:
        payload["fuelPrices"] = prices
    return jsonify(payload)


@trips.post("/api/trips/analyze")
def analyze():
    try:
        body = request.get_json(silent=True)
        trip = validate_request(body)
        is_demo = trip["dataMode"] == "demo"
        if is_demo:
            if any(trip[key]["coordinates"] != PLACES[index]["coordinates"] for key, index in (("origin", 0), ("destination", 1))):
                raise TripError("The simulated scenario is Columbus to Cleveland. Choose live mode for other trips.")
            raw_routes = demo_routes(trip["includeAlternatives"])
            routes = [sample_route(route) for route in raw_routes]
            forecasts = demo_forecasts(routes, trip["start"])
            sources = [{"provider": "Authored simulation", "model": "Synthetic moving rain band", "cadenceMinutes": 15,
                        "retrievedAt": None, "note": "Simulated weather and illustrative corridor geometry; not a recorded forecast or navigation route."}]
        else:
            if "googleRoutes" in body:
                raw_routes, route_source = read_google_routes(body["googleRoutes"], trip["origin"], trip["destination"], trip["includeAlternatives"])
            else:
                raw_routes, route_source = fetch_routes(trip["origin"], trip["destination"], trip["start"], trip["includeAlternatives"])
            routes = [sample_route(route) for route in raw_routes]
            forecasts, weather_source = fetch_forecasts(routes, trip["start"], trip["end"])
            sources = [route_source, weather_source]
        candidates, recommendation = analyze_routes(routes, forecasts, trip["start"], trip["end"])
        # Preserve forecast grid locations for a point's provenance, if supplied.
        for route in routes:
            for point, series in zip(route["checkpoints"], forecasts[route["id"]]):
                point["forecastGridCoordinates"] = series.get("gridCoordinates")
        analysis_id = str(uuid4())
        analyses.get_or_load(analysis_id, lambda: {'routes': routes, 'forecasts': forecasts, 'candidates': candidates,
                                                 'isDemo': is_demo, 'origin': trip['origin']['name'],
                                                 'destination': trip['destination']['name'], 'timeZone': trip['timeZone'],
                                                 'sources': sources, 'generatedAt': iso(datetime.now(UTC))})
        return jsonify({"analysisId": analysis_id, "generatedAt": iso(datetime.now(UTC)), "dataMode": trip["dataMode"],
                        "timeZone": trip["timeZone"], "origin": trip["origin"], "destination": trip["destination"],
                        "scoringVersion": SCORING_VERSION, "sources": sources, "routes": routes, "candidates": candidates,
                        "recommendation": recommendation,
                        "coverageStatus": "complete" if all(c["complete"] for c in candidates) else "partial",
                        "limitations": ["Exposure classes use uncalibrated demonstration rules, not probabilities or driving advice.",
                                        "15-minute checkpoints can miss localized or brief hazards.",
                                        "Baseline travel times are fixed across departure candidates and do not predict weather slowdowns."]})
    except TripError as error:
        return jsonify({"error": str(error)}), 400
    except ProviderError as error:
        return jsonify({"error": str(error), "dataMode": "live"}), error.status


@trips.post("/api/trips/stop-plan")
def stop_plan():
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get("analysisId"), str):
            raise TripError("Analyze a trip before planning stops.")
        selected = selected_analysis(data['analysisId'], data.get('candidateId'))
        if selected is None:
            return jsonify({"error": "This analysis expired. Click Find Window to refresh forecasts."}), 410
        snapshot, route, candidate = selected
        vehicle = validate_vehicle(data["vehicle"]) if data.get("vehicle") is not None else None
        plan = plan_stops(route, snapshot['forecasts'][route["id"]], candidate, vehicle,
                          data.get("startingFuel", 1), data.get("includeFood", True))
        return jsonify(plan | {"analysisId": data["analysisId"], "candidateId": candidate["id"],
                               "dataMode": "demo" if snapshot['isDemo'] else "live"})
    except TripError as error:
        return jsonify({"error": str(error)}), 400
    except ProviderError as error:
        return jsonify({"error": str(error)}), error.status
