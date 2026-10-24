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
- **Live forecast**: Uses public OSRM demo routing by default (no live traffic), plus Open-Meteo's HRRR model (`gfs_hrrr`) with 15-minute weather series.
- **Optional Mapbox routing**: Create `Backend/.env` based on `Backend/.env.example` and set `MAPBOX_ACCESS_TOKEN` for traffic-aware baseline routing.

---

## Verification & Tests

Run all unit tests and verify the production build:

```bash
# Backend unit tests (27 tests)
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
