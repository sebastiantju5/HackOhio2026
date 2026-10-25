"""Bounded dynamic programming over route checkpoints, break duration and fuel.

Stops are corridor areas, not verified businesses. Only driving exposure is
scored; a wait assumes the traveler has reached an appropriate indoor venue.
"""

from datetime import timedelta

from corridor import CLASS_NAMES, TripError, finite_number, iso, lookup_forecast, parse_time, score_weather

MILE = 1609.344
RESERVE = .15
MPG_FACTOR = .85
MAX_WAIT = 90


def plan_stops(route, series, candidate, vehicle=None, starting_fuel=1, food=True):
    if not finite_number(starting_fuel) or not .05 <= starting_fuel <= 1:
        raise TripError("Starting fuel must be between 5% and 100%.")
    if not isinstance(food, bool):
        raise TripError("includeFood must be a boolean.")
    departure = parse_time(candidate["departure"])
    points = route["checkpoints"]
    # MPG estimates are discounted 15%; refuel before reaching a 15% tank reserve.
    has_fuel = bool(vehicle) and finite_number(vehicle.get("mpg")) and finite_number(vehicle.get("tankGallons"))
    mpg = vehicle["mpg"] * MPG_FACTOR if has_fuel else None
    capacity = vehicle["tankGallons"] if has_fuel else None
    initial_range = max(0, starting_fuel - RESERVE) * capacity * mpg if has_fuel else float("inf")
    full_range = (1 - RESERVE) * capacity * mpg if has_fuel else float("inf")
    want_meal = food and route["durationSeconds"] >= 90 * 60
    conditions = {}

    def condition(index, delay):
        key = (index, delay)
        if key not in conditions:
            point = points[index]
            arrival = departure + timedelta(seconds=point["offsetSeconds"], minutes=delay)
            conditions[key] = {"checkpointId": point["id"], "arrival": iso(arrival),
                               **score_weather(lookup_forecast(series[index], arrival), point["bearingDeg"])}
        return conditions[key]

    def rank(state, final=False):
        # Require complete data before claiming lower exposure. Food is a user
        # preference used to break equal-weather ties, never a safety claim.
        return (state["unknown"] > 0, state["worst"], round(state["high"], 4), round(state["weighted"], 4),
                int(want_meal and not state["meal"]) if final else 0, state["delay"], len(state["stops"]))

    states = [{"delay": 0, "refuel": -1, "meal": False, "weatherBreak": False, "stops": [],
               "high": 0, "weighted": 0, "unknown": 0, "worst": 0, "levels": [], "arrivals": [condition(0, 0)]}]
    for index, segment in enumerate(route["segments"]):
        next_states = {}
        for state in states:
            here = condition(index, state["delay"])
            minutes_driven = points[index]["offsetSeconds"] / 60
            choices = [(0, False, False, False)]
            # Never suggest driving deeper into a known hazard to wait it out.
            ahead = condition(index + 1, state["delay"])
            can_wait = index > 0 and here["severity"] is not None and here["severity"] < 2
            weather_opportunity = can_wait and ahead["severity"] == 2 and not state["weatherBreak"]
            remaining_drive = (route["durationSeconds"] - points[index]["offsetSeconds"]) / 60
            meal_opportunity = can_wait and want_meal and not state["meal"] and 45 <= minutes_driven <= 200 and remaining_drive >= 30
            previous_fuel_mile = points[state["refuel"]]["distanceMeters"] / MILE if state["refuel"] >= 0 else 0
            here_mile = points[index]["distanceMeters"] / MILE
            remaining_range = (full_range if state["refuel"] >= 0 else initial_range) - (here_mile - previous_fuel_mile)
            to_next = (points[index + 1]["distanceMeters"] - points[index]["distanceMeters"]) / MILE
            to_destination = route["distanceMeters"] / MILE - here_mile
            # Refuel only for a genuine range need. Otherwise extra refuels could
            # masquerade as arbitrary weather waits and consume the stop budget.
            fuel_opportunity = has_fuel and remaining_range < to_destination and (
                remaining_range < to_next if index == 0 else remaining_range <= max(40, 2 * to_next))
            if len(state["stops"]) < 3:
                if fuel_opportunity:
                    # Fuel is constrained by reachable distance, independently of weather.
                    choices.append((15, True, False, False))
                if meal_opportunity or weather_opportunity:
                    for wait in (30, 45, 60):
                        choices.append((wait, False, meal_opportunity, weather_opportunity))
                        if fuel_opportunity:
                            choices.append((wait, True, meal_opportunity, weather_opportunity))
                if weather_opportunity:
                    choices.append((15, False, False, True))
            for wait, refuel, meal, weather_break in choices:
                delay = state["delay"] + wait
                if delay > MAX_WAIT:
                    continue
                last_refuel = index if refuel else state["refuel"]
                next_mile = points[index + 1]["distanceMeters"] / MILE
                refuel_mile = points[last_refuel]["distanceMeters"] / MILE if last_refuel >= 0 else 0
                if next_mile - refuel_mile > (full_range if last_refuel >= 0 else initial_range) + .001:
                    continue
                left, right = condition(index, delay), condition(index + 1, delay)
                known = [p["severity"] for p in (left, right) if p["severity"] is not None]
                severity = max(known, default=0)
                incomplete = len(known) < 2
                minutes = segment["durationSeconds"] / 60
                stops = state["stops"]
                if wait:
                    stops = stops + [{"checkpointIndex": index, "coordinates": points[index]["coordinates"],
                                      "mile": round(points[index]["distanceMeters"] / MILE, 1),
                                      "arrival": here["arrival"], "resume": left["arrival"], "durationMinutes": wait,
                                      "fuel": refuel, "food": meal, "weatherBreak": weather_break,
                                      "arrivalLevel": here["level"], "resumeLevel": left["level"],
                                      "reason": ("Refuel to a full tank before the 15% reserve. " if refuel else "")
                                                + ("Meal break. " if meal else "")
                                                + ("Wait before the next higher-exposure segment; downstream forecasts are recalculated." if weather_break else "")}]
                new = {"delay": delay, "refuel": last_refuel, "meal": state["meal"] or meal,
                       "weatherBreak": state["weatherBreak"] or weather_break, "stops": stops,
                       "high": state["high"] + (minutes if severity == 2 else 0),
                       "weighted": state["weighted"] + severity * minutes,
                       "unknown": state["unknown"] + (minutes if incomplete else 0),
                       "worst": max(state["worst"], severity),
                       "levels": state["levels"] + [CLASS_NAMES[severity] if severity or not incomplete else "unknown"],
                       "arrivals": state["arrivals"] + [right]}
                key = (delay, last_refuel, new["meal"], new["weatherBreak"], len(stops), new["worst"], new["unknown"] > 0)
                if key not in next_states or rank(new) < rank(next_states[key]):
                    next_states[key] = new
        states = list(next_states.values())
        if not states:
            return {"status": "unreachable", "stops": [], "reason": "No checkpoint-based plan preserves your fuel reserve. Refuel before departure or choose a closer station; do not rely on this corridor spacing for low fuel."}
    best = min(states, key=lambda state: rank(state, True))
    complete = best["unknown"] == 0 and all(p["severity"] is not None for p in best["arrivals"])
    # Waits are a weather recommendation only if the whole trip's exposure improves.
    improved = complete and candidate["complete"] and (
        best["worst"], round(best["high"], 1), round(best["weighted"], 2)
    ) < (candidate["worstSeverity"], candidate["higherMinutes"], candidate["weightedExposure"])
    result = {"status": "planned", "stops": best["stops"], "complete": complete,
              "departure": candidate["departure"], "arrival": best["arrivals"][-1]["arrival"],
              "totalStopMinutes": best["delay"], "higherMinutes": round(best["high"], 1),
              "baselineHigherMinutes": candidate["higherMinutes"], "weatherImproved": improved,
              "higherMinutesAvoided": round(max(0, candidate["higherMinutes"] - best["high"]), 1) if improved else 0,
              "mealIncluded": best["meal"], "checkpointConditions": best["arrivals"], "segmentLevels": best["levels"],
              "reason": "A break reduces forecast driving exposure." if improved else
                        "No weather-reducing break found within 90 minutes. Fuel and meal stops may still be included.",
              "assumptions": ["Stop locations are search areas near route checkpoints. Verify road access, hours and suitable indoor shelter.",
                              "Times exclude venue detours. A selected business is not a verified shelter or a rerouted itinerary.",
                              "Forecasts are evaluated after every stop; stationary exposure and weather slowdowns are not modeled."]}
    if has_fuel:
        distance_miles = route["distanceMeters"] / MILE
        last = best["refuel"]
        remaining_miles = distance_miles - (points[last]["distanceMeters"] / MILE if last >= 0 else 0)
        arrival_gallons = capacity * (1 if last >= 0 else starting_fuel) - remaining_miles / mpg
        result["fuel"] = {"ratedMpg": vehicle["mpg"], "planningMpg": round(mpg, 1),
                          "estimatedGallons": round(distance_miles / mpg, 1), "startingRangeMiles": round(initial_range),
                          "arrivalTankPercent": round(100 * arrival_gallons / capacity), "reservePercent": 15,
                          "source": vehicle["mpgSource"], "note": "15% MPG reduction and 15% tank reserve; no idling or detour fuel modeled."}
    return result
