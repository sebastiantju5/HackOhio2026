# WeatherWay · HackOhio 2026

A spatio-temporal road-trip weather planner built with React/Vite, Leaflet, Google Maps, Flask, and PostgreSQL. Compare weather at estimated route-checkpoint arrival times, then scrub departure times to find a lower-exposure window.

Styled in the **Terracotta Immersive Editorial** design system with a centered top navigation bar, high-contrast serif typography, responsive search capsule, unified bone folio workspace, weather-aware break planning, and integrated multi-user account authentication.

---

## Quickstart

### 1. Start the PostgreSQL Database (Docker Compose)

From the repository root, start the containerized PostgreSQL database:

```bash
docker compose up -d
```

*(On Windows PowerShell: `docker compose up -d`)*

- Uses PostgreSQL 16 Alpine on port `5433` (preventing conflicts with any local PostgreSQL on port `5432`).
- Automatically initializes table schemas (`accounts`, `sessions`, and `account_vehicles`) and seeds the demo account on first start.
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

## Core Features & What Works

- **Search Capsule with Responsive Layout**:
  - Full-width, unclipped inputs for **From** and **To** with intelligent city autocomplete (Google Places API New with OpenStreetMap / Nominatim fallback).
  - Single departure time (`Leave`) coupled with an interactive `Before & after` window slider (from exact departure up to ±6 hours).
  - Alternatives checkbox and primary action button cleanly contained inside the capsule with balanced margins and padding across 1080p desktop and mobile viewports.
  - Floating pill bar above the capsule for one-click toggling between **Simulated** and **Live forecast** modes.

- **Dual-Engine Interactive Route Map**:
  - Automatically loads **Google Maps** if an API key is available.
  - Catches `gm_authFailure` and unauthorized API responses gracefully, switching immediately to **Leaflet / OpenStreetMap** without intrusive blocking modals.
  - Shows direct pre-analysis preview lines, full route exposure polyline coloring (emerald green for lower exposure, amber for caution, crimson for higher exposure), and stop markers.

- **Departure Time Scrubber & Weather Heuristics**:
  - 5-minute candidate departure intervals with arrival-matched weather along the corridor.
  - Optimal departure window ribbon highlighting minutes saved from storm exposure.
  - Realistic meteorological hazard scoring: precipitation rate, crosswind gust projection, visibility impairment, and near-freezing moisture flags.

- **Multi-User Authentication & Garage Vehicle Profiles**:
  - Top navigation bar featuring `Home`, `Profile`, and `Sign out`.
  - Account registration and login powered by PostgreSQL and bcrypt password hashing.
  - User session isolation: each user maintains their own vehicle specifications (year, make, model, highway MPG, tank size).
  - EPA FuelEconomy.gov configuration lookup alongside custom fuel and tank specifications.

- **Weather-Aware Break Planning (StopPlanner)**:
  - Generates recommended food, fuel, or storm-avoidance stops along the route.
  - Calculates fuel consumption against vehicle highway MPG with an automatic 15% safety reserve.
  - Previews suggested breaks (`S1`, `S2`) directly on the map with adjusted arrival times.

- **Route Alternatives**:
  - Analyzes parallel corridor options (e.g., I-71 vs. Western corridor) with one-click switching and instant exposure comparison.

---

## Data Modes

- **Simulated scenario**: Author-crafted Columbus ↔ Cleveland corridors and dynamic rain band. Runs completely offline without external APIs.
- **Live forecast**: Supports search between any two places nationwide (e.g. Cleveland ↔ Columbus, Columbus ↔ Chicago, Chicago ↔ New York). Queries Google Routes / OSRM for road geometry and Open-Meteo (NOAA HRRR / GFS) for 15-minute point forecasts.

---

## Verification & Tests

Run all unit tests and verify the production build:

```bash
# Backend unit tests (routes, validation, corridor forecasts, stop timing, vehicles)
python3 -m unittest discover -s Backend/tests -v

# Frontend unit tests, linting, and production bundle
cd Frontend
npm test
npm run lint
npm run build
```

---

## Design System

WeatherWay uses the **Terracotta Immersive Editorial** design language:
- **Design Specifications & Tokens**: Detailed in [`docs/design.md`](docs/design.md).
- **Interactive Variations Gallery**: Open [`design-variations/index.html`](design-variations/index.html) in your browser (`python3 -m http.server -d design-variations 8080`) to inspect all 8 design directions and color palettes.

The broader product scope and architecture document is recorded in [`docs/roadtrip-mvp.md`](docs/roadtrip-mvp.md).
