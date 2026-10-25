# WeatherWay · HackOhio 2026

A spatio-temporal road-trip weather planner built with React/Vite, Leaflet, Google Maps, Flask, and PostgreSQL. Compare weather at estimated route-checkpoint arrival times, then scrub departure times to find a lower-exposure window.

Styled in the **Terracotta Immersive Editorial — 3-Board Dispatch Dashboard (Variation C)** design system with a centered top navigation bar, high-contrast serif typography, responsive search capsule, map-dominant telemetry workspace, real-time streaming journey agent, and integrated multi-user account authentication.

---

## Quickstart

### 1. Configure Environment Variables

Template files are provided inside `Backend` and `Frontend`:
- **Backend Template**: [`Backend/.env.template`](Backend/.env.template)
- **Frontend Template**: [`Frontend/.env.template`](Frontend/.env.template)

Copy the templates to create your local `.env` files:

```bash
cp Backend/.env.template Backend/.env
cp Frontend/.env.template Frontend/.env
```

Key environment settings:
- **`DATABASE_URL`**: PostgreSQL connection string (defaults to `postgresql://weatherway:weatherway@localhost:5433/weatherway`).
- **`MAPBOX_ACCESS_TOKEN`**: Optional. When omitted, live routes query Google Routes or fallback to OSRM.
- **`USE_LOCAL_LLM`**: Set to `true` to send Journey Agent requests to a local OpenAI-compatible server instead of OpenRouter.
- **`LOCAL_LLM_BASE_URL`**: Base URL for that server. The fast 8k-context endpoint is `http://192.168.1.142:11434/v1`. A 32k-context alternative is `http://192.168.1.211:11434/v1`.
- **`LOCAL_LLM_MODEL`**: Model id served at that endpoint. The local server uses `/models/Ling-3.0-tiny-Q5_K_M.gguf`.
- **`OPENROUTER_API_KEY`**: Server-only API key, used only when `USE_LOCAL_LLM` is `false`. Never expose it as a frontend `VITE_` variable.
- **`OPENROUTER_MODEL`**: OpenRouter model when local mode is off. `openrouter/free` routes across free models; `openai/gpt-4.1-mini` is another option.
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
  - Full-width inputs for **From** and **To** with origin/destination route markers and a one-click **Swap button (`⇄`)** to invert directions without retyping.
  - Intelligent city autocomplete powered by Google Places API (New) with OpenStreetMap / Nominatim fallback.
  - Single departure time (`Leave`) coupled with an interactive `Before & after` window slider (from exact departure up to ±6 hours) with readable wall-time range labels.
  - Primary "Find Window →" action button with inline loading state.
  - Defaults to nationwide live forecasts with automatic place geocoding and routing.

- **3-Board Asymmetric Dispatch Dashboard (Variation C)**:
  - **Left Board (Main Route Map & Telemetry, 62% width)**:
    - Expanded interactive map canvas (`min-height: 560px`) featuring route polyline colored by meteorological exposure (emerald green for lower exposure, amber for caution, crimson for higher exposure).
    - Dual-engine fallback: Google Maps JavaScript API with graceful degradation to Leaflet / OpenStreetMap upon auth failure.
    - Top briefing ribbon highlighting the recommended departure window and minutes of storm exposure saved.
    - Interactive 5-minute departure time scrubber synced with an "Along this drive" contextual weather outlook and worst stretch timing.
    - Route alternatives tablist (e.g., I-71 vs Western corridor) for instant comparison and selection.
    - Interactive stop pins (`S1`, `S2`) and venue pins (`V1`, `V2`).
  - **Right Column Stack (38% width)**:
    - **Top-Right Board: Journey Agent ("Ask the road ahead")**: Conversational RAG assistant with real-time Server-Sent Events (SSE) streaming, live thinking status, tool trace logs, vehicle fuel tank slider (5–100%), pre-built prompt buttons, and Google Places restaurant / gas station discovery.
    - **Bottom-Right Board: Added Stops ("Your Picks")**: Dedicated card aggregating all stops, meal breaks, and gas stations picked from agent responses, with direct map zoom and one-click removal.

- **Dual-Engine Interactive Route Map**:
  - Automatically loads **Google Maps** if an API key is available.
  - Catches `gm_authFailure` and unauthorized API responses gracefully, switching immediately to **Leaflet / OpenStreetMap** without intrusive blocking modals.
  - Shows direct pre-analysis preview lines, full route exposure polyline coloring (emerald green for lower exposure, amber for caution, crimson for higher exposure), stop markers (`S1`, `S2`), and venue markers (`V1`, `V2`).

- **Departure Time Scrubber & Weather Heuristics**:
  - 5-minute candidate departure intervals with arrival-matched weather along the corridor.
  - Optimal departure window ribbon highlighting minutes saved from storm exposure.
  - Realistic meteorological hazard scoring: precipitation rate, crosswind gust projection, visibility impairment, and near-freezing moisture flags.

- **Multi-User Authentication & Garage Vehicle Profiles**:
  - Simplified, centered single-card authentication layout for Sign In and Sign Up.
  - One-click demo credentials autofill ("Alex (Demo)") for instant evaluation.
  - Top navigation bar featuring `Home`, `Profile`, and `Sign out`.
  - Account registration and login powered by PostgreSQL and bcrypt password hashing.
  - User session isolation: each user maintains their own vehicle specifications (year, make, model, highway MPG, tank size, fuel grade).
  - EPA FuelEconomy.gov configuration lookup alongside custom fuel and tank specifications.

- **Weather-Aware Break Planning & Route Stops**:
  - Generates recommended food, fuel, or storm-avoidance stops along the route.
  - Calculates fuel consumption against vehicle highway MPG with an automatic 15% safety reserve.
  - Previews suggested breaks (`S1`, `S2`) directly on the map with adjusted arrival times and downstream weather recalculation.

- **Route Alternatives**:
  - Analyzes parallel corridor options (e.g., I-71 vs. Western corridor) with one-click switching and instant exposure comparison.

---

## Data Modes

- **Simulated scenario**: Author-crafted Columbus ↔ Cleveland corridors and dynamic rain band. Runs completely offline without external APIs.
- **Live forecast**: Supports search between any two places nationwide (e.g. Cleveland ↔ Columbus, Columbus ↔ Chicago, Chicago ↔ New York). Queries Google Routes / OSRM for road geometry and Open-Meteo (NOAA HRRR / GFS) for 15-minute point forecasts.

Live departures can be compared within the next seven days. The forecast adapter checks the entire departure window, route duration and break buffer before choosing a model. It uses HRRR only inside its US coverage when the last needed timestamp is within 16 hours of now (allowing publication lag within the 18-hour horizon); otherwise it selects longer-range GFS. GFS values returned every 15 minutes are interpolated from coarser model data. Missing measurements remain unknown, and usable coverage is displayed alongside the actual model.

Google routing uses the earliest departure in the comparison window. If it is unavailable, a notice names the fallback provider; the route header also states whether its baseline includes traffic. Data-mode badges describe the completed analysis, so changing an input does not relabel an old simulation as live. Break previews update arrival, peak condition, exposure and coverage together.

---

## Journey Agent & RAG

The **Ask the road ahead** panel runs a journey agent on a local OpenAI-compatible model. Sign in, analyze a trip, select a departure, set the starting tank and maximum break time, then ask a question or click **Plan stops & show on map**. Either action makes a model request.

Set these server-only variables in the ignored `Backend/.env`, then restart with `uv run python Backend/app.py`:

```dotenv
USE_LOCAL_LLM=true
LOCAL_LLM_BASE_URL=http://192.168.1.142:11434/v1
LOCAL_LLM_MODEL=/models/Ling-3.0-tiny-Q5_K_M.gguf
```

`LOCAL_LLM_BASE_URL` is the fast 8k-context server at `192.168.1.142:11434`. For a longer context window, point it at `http://192.168.1.211:11434/v1` instead. The model id must match a file that server is serving.

Set `USE_LOCAL_LLM=false` to use OpenRouter instead. That path needs `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (for example `openrouter/free` or `openai/gpt-4.1-mini`). OpenRouter routing requires parameter support and sets `data_collection=deny`. The key is never returned by the app or placed in a frontend `VITE_` variable.

The workflow retrieves relevant passages with **BM25**, combines them with the server's selected forecast snapshot and authenticated vehicle fuel specs, runs bounded tool calls, and returns a structured answer with source IDs and an optional computed stop plan. This initial RAG uses lexical retrieval, not embeddings or a vector database. Its versioned corpus is `Backend/knowledge/travel-guidance.json`: WeatherWay methodology and curated, paraphrased NWS/FuelEconomy.gov guidance. Edit that file and restart the backend to update the corpus. No arbitrary website crawling or document uploads are enabled.

The four bounded tools are:
1. **`retrieve_guidance`**: Retrieves relevant passages from the curated travel guidance knowledge base via BM25 lexical ranking.
2. **`compare_break_options`**: Computes an optimal stop plan for the selected route and departure using the deterministic optimizer and the user's break budget and vehicle fuel specifications.
3. **`edit_stop`**: Edits an existing stop (e.g. `stopNumber: 1` for S1) to adjust duration (15–90 min), move to nearest checkpoint for a target mile, or update fuel/food/weather break flags with full arrival recalculation.
4. **`delete_stop`**: Removes a specific stop or clears all stops (`stopNumber: 0`), updating downstream arrival times and weather exposures.

### Real-Time Streaming & Interaction Flow

- **Server-Sent Events (SSE) Streaming**: Journey queries stream through `/api/journey/chat` with live phase indicators:
  - `thinking`: Real-time spinner showing agent thought progression.
  - `tool`: Immediate trace feedback when tools (`retrieve_guidance`, `compare_break_options`, `edit_stop`, `delete_stop`) are executing.
  - `delta`: Incremental answer text streamed token-by-token.
  - `done`: Final structured payload including cited source IDs, computed stop plan, and options.
  - Automatic fallback to non-streaming `/api/journey/chat` and resilient parsing if stream responses are interrupted.
- **One-Click Prompt Suggestions**: Quick prompt buttons for common inquiries ("Would a food break help avoid the rain?", "Can I finish with this fuel?") and a dedicated **Plan stops & show on map →** action.
- **Nearby Places & Fuel Stations**:
  - Asking about meals searches Google Places restaurants within 10 km of the planned food stop.
  - Asking about gas or fuel searches Google Places stations within 8 km of planned stops.
  - Selecting any venue highlights it on the map (`V1`, `V2`) and adds it to the **Added stops** board.
- **Added Stops Board ("Your Picks")**:
  - Gathers all planned stops and selected venue recommendations.
  - Displays stop type (Fuel, Food, Weather), checkpoint mile, arrival/resume window, break duration, and venue address.
  - One-click zoom to center the venue on the map, individual removal (`×`), or "Clear all".

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
