# WeatherWay Design System: Terracotta Immersive Editorial

Approved design direction: **Variation 2B Immersive (Clean Terracotta Editorial)**.

This document records the visual identity, token architecture, typography hierarchy, and implementation specifications for the WeatherWay road-trip weather corridor planner and authentication portal.

---

## 1. Product Context & Design Vision

**Product Promise**: *See the forecast where you will be when you get there, then compare when to leave.*

WeatherWay is a decision instrument for drivers on multi-hour interstate road trips (initially Ohio corridors such as Columbus ↔ Cleveland on I-71). The design language communicates:
- **Calm, authoritative foresight**: Replacing weather anxiety with clear, actionable departure timing.
- **Editorial elegance**: Drawing inspiration from Scandinavian cartography and high-fashion editorial print layout, moving far away from generic SaaS cards or retro arcade cliches.
- **Restraint and clarity**: Every element serves navigation, arrival forecasting, or account management. Distracting decorative widgets (floating toolbars, fake AI menus, extraneous badges) are eliminated in favor of clean information hierarchy.

---

## 2. Design Tokens & Palette

### Color Tokens

| Token Name | Hex Value | Role & Usage |
|---|---|---|
| `--terracotta` | `#6f281a` | Primary canvas backdrop, hero immersion, brand accents, primary buttons |
| `--terracotta-dark` | `#541d11` | Hover/active states on terracotta buttons, deep contrast borders |
| `--terracotta-soft` | `#fbf1ed` | Soft terracotta tint for recommendation bars and callouts |
| `--paper` | `#f8f5ee` | Warm bone linen surface for the main unified folio card |
| `--paper-card` | `#ffffff` | Pure white for elevated inputs, cards, and active scrubber steps |
| `--ink` | `#1b1b1e` | Deep charcoal/espresso text on light bone surfaces |
| `--ink-dim` | `#54524f` | Secondary text, field labels, metadata annotations |
| `--spruce` | `#1d5b43` | Route polyline, low-exposure indicator, "clear" condition badges |
| `--amber` | `#c87508` | Caution exposure indicator (moderate rain, crosswinds) |
| `--hazard-red` | `#b91c1c` | Higher exposure indicator (heavy rain front, squalls) |
| `--tag-blue` | `#93c5fd` | Pinned optimal departure badge background |
| `--tag-blue-dark` | `#1e3a8a` | Text color on pinned departure badge |
| `--border` | `#dfd8cc` | Hairline divider rules on light surfaces |
| `--border-dark` | `#c4bcb0` | Focused input borders and interactive card outlines |

### Typography Scale & Pairing

1. **Display & Headlines**: `Newsreader`, Georgia, serif
   - Role: Editorial headlines, hero statement, corridor titles, checkpoint names.
   - Weights: `400` (Regular) and `500` (Medium). Italic style used for emotional emphasis words (*"better timing."*).
2. **User Interface & Body**: `Plus Jakarta Sans`, -apple-system, sans-serif
   - Role: Body copy, navigation links, form labels, button labels, city markers.
   - Weights: `400` (Regular), `500` (Medium), `600` (Semi-bold), `700` (Bold).
3. **Data Telemetry & Units**: `DM Mono`, monospace
   - Role: Speeds (`km/h`), precipitation rates (`mm/h`), timestamps (`3:15 PM ET`), checkpoint numbers (`CP 04`).
   - Weights: `400` (Regular), `500` (Medium).

---

## 3. Structural Components

### 3.1 Floating Capsule Header (`.capsule-nav`)
- Floats horizontally centered at the top of the viewport with generous margin (`padding: 24px 20px 10px`).
- Translucent backdrop filter with frosted white glass border (`border-radius: 9999px; background: rgba(255, 255, 255, 0.12); backdrop-filter: blur(16px)`).
- Contains:
  - Circular brand mark (`w.`) with white fill and terracotta monogram.
  - Brand wordmark: **WeatherWay Dispatch**.
  - Corridor navigation links in soft apricot (`#fed7aa`).
  - User presence pill / button showing the authenticated user's name and initials or a "Sign In" trigger.

### 3.2 Editorial Hero Section
- Centered layout with generous whitespace.
- Headline: *"Your clearest drive starts with better timing."* with the last two words in warm apricot italic serif.
- Subtitle explaining the arrival-matched forecast principle.
- Form inputs for origin, destination, departure window, and alternative routes integrated seamlessly.

### 3.3 Unified Bone Folio Card (`.unified-bone-card`)
- A single, cohesive card surface in warm bone linen (`#f8f5ee`) with large rounded corners (`border-radius: 24px`) and deep shadow (`box-shadow: 0 25px 60px rgba(0,0,0,0.35)`).
- **Header**: Route title (*Columbus → Cleveland Corridor*), distance, baseline travel time, and the pinned blue tag (`Optimal: 3:15 PM ET`).
- **Map & Checkpoint Split**:
  - Left pane: Leaflet interactive map with custom terracotta-and-spruce styling, road polyline, and checkpoint markers.
  - Right pane: 15-minute checkpoint details panel showing arrival time, precipitation, crosswind component, visibility, and air temperature.
- **Scrubber Deck**:
  - Horizontal cards for each 5-minute departure step across the 2-hour window.
  - Color-coded exposure classes (`spruce` for clear, `amber` for caution, `terracotta` for higher exposure).
  - Selected departure highlight with star indicator (`★ 3:15 PM ET`).
- **Recommendation Ribbon**:
  - Quiet, tinted callout summarizing the recommended window, minutes of storm exposure saved, and one-click action to jump to that departure.

### 3.4 Matched Authentication Portal (`SignIn.jsx`)
- Seamlessly lives in the same terracotta immersive environment.
- Elegant bone card centered on the screen.
- Tabbed switcher for "Sign In" vs "Create Account".
- 1-click **Auto-fill** button for the demo account (`alex@weatherway.app` / `neighborhood`).
- Signed-in view with user avatar initials, email, active database session indicator, and "Return to Trip Planner" button.
- "← Back to trip planner" navigation link to return at any moment.

---

## 4. Verification & Implementation Checklist

- [x] Font imports for `Newsreader`, `Plus Jakarta Sans`, and `DM Mono` added to `Frontend/index.html`.
- [x] Global styling updated in `Frontend/src/index.css`.
- [x] Main app header and layout updated in `Frontend/src/TripPlanner.jsx` and `Frontend/src/TripPlanner.css`.
- [x] Authentication page updated in `Frontend/src/SignIn.jsx` and `Frontend/src/SignIn.css`.
- [x] Production build tested and verified (`npm run build`).
- [x] Automated test suites verified (Backend 27/27 tests, Frontend 2/2 tests).
- [x] Interactive browser verification of trip planning, departure scrubber, and login/logout flows.
