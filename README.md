# Weatherway · HackOhio 2026

A spatio-temporal road-trip weather planner built with React/Vite, Leaflet, and Flask. Compare weather at estimated route-checkpoint arrival times, then scrub departure times to find a lower-exposure window.

## Run locally (PowerShell)

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r Backend/requirements.txt
.\.venv\Scripts\python.exe Backend/app.py
```

In another terminal:

```powershell
cd Frontend
npm ci
npm run dev
```

Open the Vite URL, normally http://localhost:5173. Vite proxies `/api` to Flask on port 5001. The planner does not need a PostgreSQL database or a login.

If your Python installation cannot bootstrap pip into a virtual environment, use `python -m pip --python .venv install -r Backend/requirements.txt` after creating the environment. This was the installation path used during development on this Windows machine.

## What works

- Ohio city presets, earliest/latest departures, and optional alternative routes.
- Checkpoints at the origin, every 15 minutes of cumulative road travel time, and the destination.
- Map segments colored by forecast rain, visibility, projected crosswind gust, and possible freezing conditions.
- Five-minute departure candidates, a departure slider, checkpoint inspection, and a recommended departure window.
- ETA sensitivity evaluated at ±15 minutes, explicit unknown coverage, and forecast provenance.
- Clear separation between simulated and live analysis. Live failures never silently substitute simulated conditions.
- Existing account UI remains accessible through the Account button.

## Data modes

**Simulated scenario** starts automatically. Its authored Columbus–Cleveland corridors and moving rain band require no external weather/routing services. Geometry is illustrative and weather is synthetic, not recorded or observed. Basemap tiles and web fonts still need internet access; route overlays remain available if tiles fail.

**Live forecast** uses public OSRM demo routing by default (no live traffic), plus Open-Meteo's HRRR model (`gfs_hrrr`) with 15-minute returned weather series. Select another Ohio city pair or retain Columbus–Cleveland, then click **Find my weather window**. Public providers have usage limits and no demo availability guarantee; use a hosted/self-managed routing service for production.

To use Mapbox traffic-aware baseline routing, create `Backend/.env` using `.env.example` and set `MAPBOX_ACCESS_TOKEN`. Restart Flask after changing environment settings. No token is sent to the browser. Route geometry and travel times are fixed at the earliest departure for the comparison; weather-dependent speed prediction is not implemented.

Live inputs are restricted to the Ohio region, a two-hour departure window, routes up to four hours, and departures within the next 12 hours. Returned forecast coverage is checked point by point. Some variables at a 15-minute returned cadence may be derived or interpolated; the UI does not claim exact-minute forecast accuracy.

## API

- `GET /api/health`: planner readiness without querying optional account storage.
- `GET /api/trips/config`: city presets, limits, routing provider, and simulation description.
- `POST /api/trips/analyze`: origin/destination objects containing `name` and `[longitude, latitude]` coordinates, `departureStart`/`departureEnd` timestamps with offsets, `timeZone`, `includeAlternatives`, and `dataMode` (`demo` or `live`). Returns routes, checkpoints, all departure candidates, source metadata, and recommendation.

Provider caches are bounded, in-memory, and process-local: five minutes for routing, ten minutes for forecast snapshots. A batch weather request covers the checkpoint locations across the whole comparison window. Scrubbing uses precomputed candidates with no provider calls.

## Optional account database

Set `DATABASE_URL` in `Backend/.env`, then initialize the existing account schema explicitly:

```powershell
.\.venv\Scripts\python.exe Backend/app.py --init-db
```

Then start the backend normally. Authentication endpoints still use Postgres, but importing or starting the planner no longer connects to it. Existing demo account credentials are preserved in the sign-in screen.

## Verify

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s Backend/tests -v
cd Frontend
npm test
npm run build
```

Tests cover travel-time sampling, forecast accumulation boundaries, no extrapolation, missing/invalid data, rain units, crosswind projection, possible freezing flags, ranking, request validation, cache behavior, provider failure behavior, and Eastern daylight-saving transitions.

## Limits and next steps

Exposure labels use **uncalibrated demonstration heuristics**. They are not probabilities of hydroplaning, icing, or collision, and lower exposure is not a guarantee of safe driving. Fifteen-minute samples can miss brief or localized hazards. Details and thresholds are visible under **How the comparison works**.

Next integrations: OHGO timestamped pavement observations, official alert overlays, a genuine captured provider scenario for replay, and a grounded AI explanation. Radar imagery, camera classification, calibrated pavement-freezing models, arbitrary-address geocoding, and predicted weather slowdowns are not implemented.

The broader product scope, proposed contracts, and implementation gates are in [docs/roadtrip-mvp.md](docs/roadtrip-mvp.md).

Provider references: [Open-Meteo HRRR](https://open-meteo.com/en/docs/gfs-api), [OSRM](https://project-osrm.org/docs/v5.24.0/api/), [Mapbox Directions](https://docs.mapbox.com/api/navigation/directions/), [Leaflet](https://leafletjs.com/reference.html), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
