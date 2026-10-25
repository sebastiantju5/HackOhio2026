# WeatherWay · HackOhio 2026

A spatio-temporal road-trip weather planner built with React/Vite, Leaflet, Google Maps, Flask, and PostgreSQL. Compare weather at estimated route-checkpoint arrival times, then scrub departure times to find a lower-exposure window.

Styled in the **Terracotta Immersive Editorial** design system with a centered top navigation bar, high-contrast serif typography, responsive search capsule, unified bone folio workspace, weather-aware break planning, and integrated multi-user account authentication.

---

## Quickstart

### 1. Configure Environment Variables

Template files are provided for all components:
- **Root Template**: [`.env.template`](.env.template)
- **Backend Template**: [`Backend/.env.template`](Backend/.env.template)
- **Frontend Template**: [`Frontend/.env.template`](Frontend/.env.template)

Copy the templates to create your local `.env` files:

```bash
cp Backend/.env.template Backend/.env
cp Frontend/.env.template Frontend/.env
```

Key environment settings:
- **`DATABASE_URL`**: PostgreSQL connection string (defaults to `postgresql://weatherway:weatherway@localhost:5433/weatherway`).
- **`OPENROUTER_API_KEY`**: Server-only API key for the Journey Agent LLM.
- **`OPENROUTER_MODEL`**: Set to `openrouter/free` for zero-cost routing across available free models, or choose a model such as `openai/gpt-4.1-mini`.
- **`VITE_GOOGLE_MAPS_API_KEY`**: Browser key for Google Maps JavaScript API, Places API (New), Geocoding, and Routes API. (Gracefully falls back to Leaflet & Nominatim when omitted).

### 2. Start the PostgreSQL Database (Docker Compose)

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

### 3. Run the Backend (`uv`)

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

### 4. Run the Frontend (Vite)

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

Live departures can be compared within the next seven days. The forecast adapter checks the entire departure window, route duration and break buffer before choosing a model. It uses HRRR only inside its US coverage when the last needed timestamp is within 16 hours of now (allowing publication lag within the 18-hour horizon); otherwise it selects longer-range GFS. GFS values returned every 15 minutes are interpolated from coarser model data. Missing measurements remain unknown, and usable coverage is displayed alongside the actual model.

Google routing uses the earliest departure in the comparison window. If it is unavailable, a notice names the fallback provider; the route header also states whether its baseline includes traffic. Data-mode badges describe the completed analysis, so changing an input does not relabel an old simulation as live. Break previews update arrival, peak condition, exposure and coverage together.

---

## Journey Agent & RAG (OpenRouter)

The **Ask the road ahead** panel runs a journey agent through OpenRouter. Sign in, analyze a trip, select a departure, set the starting tank and maximum break time, then ask a question or click **Plan stops & show on map**. Either action makes a model request.

Set these server-only variables in the ignored `Backend/.env`, then restart with `uv run python Backend/app.py`:

```dotenv
OPENROUTER_API_KEY=your-key-here
OPENROUTER_MODEL=openai/gpt-4.1-mini
```

The default model supports tool calling and JSON-schema responses. A compatible OpenRouter model such as `openai/gpt-4o` can be selected through `OPENROUTER_MODEL`. Provider routing requires parameter support and sets `data_collection=deny`. OpenRouter/model-provider processing and API usage still apply. The key is never returned by the app or placed in a frontend `VITE_` variable.

The workflow retrieves relevant passages with **BM25**, combines them with the server's selected forecast snapshot and authenticated vehicle fuel specs, runs bounded tool calls, and returns a structured answer with source IDs and an optional computed stop plan. This initial RAG uses lexical retrieval, not embeddings or a vector database. Its versioned corpus is `Backend/knowledge/travel-guidance.json`: WeatherWay methodology and curated, paraphrased NWS/FuelEconomy.gov guidance. Edit that file and restart the backend to update the corpus. No arbitrary website crawling or document uploads are enabled.

The tools are `retrieve_guidance` and `compare_break_options`. The latter calls the existing deterministic optimizer and enforces the UI's stop budget. Its selected plan appears automatically as **S1/S2** pins on either Google Maps or the Leaflet fallback. Select a pin or a stop in the answer to zoom to its location, arrival/resume time and reason. The itinerary below the map offers a whole-route view and hide control; changing route or departure removes incompatible plans. All computed tool options remain selectable even if the model omits its selected plan reference. Stop rankings, route geometry and weather scoring are unchanged.

Each stop in the map itinerary has a **Hide pin / Show pin** toggle. It hides only that stop's marker and its nearby venues, preserves S1/S2 identities, and can be reversed. Hidden stops remain in the computed itinerary, including arrival, fuel and weather estimates; this control does not remove a stop from the optimizer's plan. Choosing a hidden stop from the agent's answer restores only that stop.

The Journey Agent also offers **Prefer cheaper gas** and a fuel-grade selector (regular, midgrade, premium or diesel). This preference accompanies the computed plan without changing the weather/fuel optimizer. For live fuel stops, **Compare gas prices** requests Google Places `fuelOptions` for up to 10 stations within 1.5 km, sorts recent same-grade USD quotes lowest first, and shows timestamps and map pins. Only quotes updated within 48 hours participate; stale/missing quotes remain labeled, and fewer than two recent quotes cannot establish a cheaper station. This compares reported pump prices, not total trip cost or prices across the entire route. Venue detours, access, fuel availability and opening hours remain unverified. The LLM receives no station-price data and is instructed not to invent prices or savings. Price requests use the existing browser Maps key and require Places API (New), with billing determined by the requested fields; no new provider key is added. See [Google fuel-price fields](https://developers.google.com/maps/documentation/javascript/reference/place#FuelOptions) and [field billing tiers](https://developers.google.com/maps/documentation/places/web-service/data-fields). Simulated trips never query real fuel prices.

For live trips, **Find nearby gas/food on map** adds blue **V1/V2** business options from Google Places around the selected stop area. These are separate from the optimizer's highway checkpoints: selecting a venue does not change its stop timing or the route. Business access, suitability, hours, detour times and shelter are unverified. Guidance does not establish current closures or official warnings. Simulated trips stay labeled simulated and do not search real venues.

Source IDs and plan references are validated against evidence actually retrieved or computed. The UI shows source excerpts and actual tool activity separately from generated prose. Citations make the answer inspectable; they do not guarantee every model statement is correct. Trip and account identity fields are minimized: the model receives selected trip information and fuel specifications, not account email, session token or password.

The endpoint requires login and reads the saved vehicle from that account. Single-process limits allow one active request per account, two active requests globally, six questions per account per ten minutes, and thirty questions globally per hour. Each question has at most four model calls, 1,200 output tokens per call and two computed stop options. Follow-up context is kept only in bounded memory for fifteen minutes, isolated by account, analysis, departure, fuel level and break budget. Limits/history reset on restart; use shared persistent controls before a multi-process deployment. Analysis snapshots also expire after fifteen minutes. Provider failures return explicit errors instead of fabricated answers.

## Verification & Tests

Run all unit tests and verify the production build:

```bash
# Backend unit tests (routes, validation, corridor forecasts, stop timing, vehicles)
uv run python -m unittest discover -s Backend/tests -v

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
