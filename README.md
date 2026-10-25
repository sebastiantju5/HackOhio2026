# WeatherWay · HackOhio 2026

A spatio-temporal road-trip weather planner built with React/Vite, Leaflet, Flask, and PostgreSQL. Compare weather at estimated route-checkpoint arrival times, then scrub departure times to find a lower-exposure window.

Styled in the **Terracotta Immersive Editorial** design system with a floating capsule navigation bar, high-contrast serif typography, unified bone folio workspace, and integrated account authentication.

---

## Quickstart

### 1. Start the PostgreSQL Database (Docker Compose)

From the repository root, start the containerized PostgreSQL database:

```bash
docker compose up -d
```

*(On Windows PowerShell: `docker compose up -d`)*

- Uses PostgreSQL 16 Alpine on port `5433` (preventing conflicts with any local PostgreSQL on port `5432`).
- Automatically initializes table schemas (`accounts` and `sessions`) and seeds the demo account on first start.
- Persists data to the `postgres_data` volume.

To check container health:
```bash
docker compose ps
```

### 2. Run the Backend (`uv`)

Using [`uv`](https://docs.astral.sh/uv/):

```bash
uv run python Backend/app.py
```

*(Or on Windows PowerShell: `uv run python Backend/app.py`)*

The Flask backend runs on `http://127.0.0.1:5001`. It connects to PostgreSQL via `DATABASE_URL=postgresql://weatherway:weatherway@localhost:5433/weatherway` (configured in `Backend/.env`).

> **Note**: If not using `uv`, you can also use a standard virtual environment:
> ```bash
> python -m venv .venv
> source .venv/bin/activate  # Or on Windows: .\.venv\Scripts\Activate.ps1
> pip install -e .
> python Backend/app.py
> ```

### 3. Run the Frontend (Vite)

In a separate terminal:

```bash
cd Frontend
npm install
npm run dev
```

Open **`http://localhost:5173`** in your browser. Vite proxies `/api` requests to Flask on port 5001.

---

## Authentication & Demo Account

The trip planner connects directly to the authentication portal:

- Click **Sign in ↗** in the floating capsule navbar to open the login portal.
- Use the 1-click **Auto-fill** button to load the seeded demo credentials:
  - **Email**: `alex@weatherway.app`
  - **Password**: `neighborhood`
- Or create a new account via the **Create Account** tab.
- Once signed in, your user badge (`AR Alex`) appears in the capsule navbar with quick sign-out and profile viewing.
- Open your profile to add one car: make, model, year, highway MPG and tank size in **US gallons**. **Look up EPA mileage** finds engine/transmission configurations from FuelEconomy.gov; select the matching configuration for its highway MPG. If no rating is available, enter your own MPG estimate. Tank size is entered from your owner's manual; it is not inferred from the EPA rating. Gasoline and diesel vehicles are supported; EV/alternative-fuel MPGe is not treated as gas mileage.
- Vehicle profiles persist in PostgreSQL, scoped to the signed-in account. The new `account_vehicles` table is created idempotently on backend startup. For an existing Compose volume, restart the backend or run `uv run python Backend/app.py --init-db`; **do not remove the database volume**.

## Fuel, Food & Weather Breaks

After choosing a route and departure with the scrubber, use **Plan my stops**. Set the starting tank level and whether to include a food break. Without a saved car, weather and food planning still works.

The planner searches checkpoint locations and 15/30/45/60-minute waits, up to three stops and 90 minutes total. A weather wait starts before an upcoming higher-exposure segment, at a checkpoint whose arrival exposure is lower or caution. The optimizer shifts every later arrival, rechecks the forecast, and ranks complete coverage, peak exposure, higher-exposure minutes, weighted exposure, meal preference, then delay. Fuel stops must be reachable while retaining a 15% tank reserve. Fuel estimates use 85% of highway MPG to allow a planning margin; this is a heuristic, not a weather-dependent mileage model.

**Preview breaks on map** shows stop markers, adjusted route colors, checkpoint arrivals and total arrival time. Only a complete forecast comparison can claim a weather improvement. If waiting does not improve exposure, the result says so; fuel/meal stops can still be included. If checkpoint spacing cannot support the fuel range, the planner reports that instead of inventing a reachable station.

For live trips, **Find nearby gas/food** retrieves up to three Google Places within 1.5 km of a proposed stop area. Enable **Places API (New)** alongside the existing Maps JavaScript, Places, Geocoding and Routes API services for `VITE_GOOGLE_MAPS_API_KEY` in `Frontend/.env`. Requests happen only when the traveler clicks to find venues. API failures and empty results offer a Google Maps search link; they do not fabricate businesses. The simulation labels all stop areas as illustrative and does not fetch real venues.

These are corridor recommendations: opening hours, indoor shelter, diesel availability and road access must be checked. Venue detours, stationary exposure, idling fuel, and weather-induced traffic slowdowns are not included in ETA/fuel estimates. Picking a venue does not yet recalculate a waypoint itinerary.

Analysis snapshots expire after 15 minutes or a server restart (bounded in-memory storage); click **Find Window** to refresh an expired analysis. Changing departure, route, vehicle, starting fuel or food preference clears the previous stop plan.

---

## What works

- **Ohio Corridor Presets**: Columbus ↔ Cleveland, Cincinnati, Dayton, Toledo, Akron, and Mansfield.
- **Dynamic Checkpoints**: 15-minute cumulative driving intervals paired with arrival-matched weather.
- **Exposure Scrubbing**: 5-minute departure candidate steps, real-time exposure recalculation, and recommended departure window callout.
- **Grounded Exposure Heuristics**: Rain intensity, crosswind component projection, visibility reduction, and near-freezing moisture flags.
- **Docker Compose Database**: PostgreSQL container with persistent volume and auto-initialized tables.
- **Design Variations Gallery**: Interactive showcase of 8 design directions in `design-variations/index.html`.

---

## Data Modes

- **Simulated scenario**: Starts automatically. Its authored Columbus–Cleveland corridors and moving rain band require no external weather/routing services. Route overlays remain fully interactive offline.
- **Live forecast**: The browser uses Google Routes when its Maps key is configured, sends compact route geometry and cumulative step timing to Flask, and matches Open-Meteo weather to those same route checkpoints. Traffic-aware leg durations scale the per-step times. Geometry is capped at 140 vertices per route to retain the existing 16 KB API request limit; positions and within-step timing are approximate. HRRR (`gfs_hrrr`) is used inside its US coverage, GFS elsewhere. Forecasts cover up to 90 minutes of additional stops. Backend-only clients without Google route data retain OSRM (or configured Mapbox) routing.
- **Optional Mapbox routing**: Create `Backend/.env` based on `Backend/.env.example` and set `MAPBOX_ACCESS_TOKEN` for traffic-aware baseline routing.

---

## Verification & Tests

Run all unit tests and verify the production build:

```bash
# Backend unit tests (vehicle ownership/validation, routing, forecasts, stop timing & fuel)
uv run python -m unittest discover -s Backend/tests -v

# Frontend unit tests & production bundle
cd Frontend
npm test
npm run build
```

---

## Design System

WeatherWay uses the **Terracotta Immersive Editorial** design language:
- **Design Specifications & Tokens**: Detailed in [`docs/design.md`](docs/design.md).
- **Interactive Variations Gallery**: Open [`design-variations/index.html`](design-variations/index.html) in your browser (`python3 -m http.server -d design-variations 8080`) to inspect all 8 design directions and color palettes.

The broader product scope and architecture document is recorded in [`docs/roadtrip-mvp.md`](docs/roadtrip-mvp.md).
