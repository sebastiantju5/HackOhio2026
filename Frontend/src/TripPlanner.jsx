import { useEffect, useRef, useState } from 'react'
import RouteMap from './RouteMap.jsx'
import DepartureScrubber from './DepartureScrubber.jsx'
import StopPlanner from './StopPlanner.jsx'
import { LEVELS, TIME_ZONE, clock, day, duration, fromWallInput, miles, toWallInput } from './format.js'
import PlaceField from './PlaceField.jsx'
import { geocodeAddress, getGoogleRoutes, mapsKey } from './googleMaps.js'
import './TripPlanner.css'

const CURRENT_YEAR = new Date().getFullYear()

const PLACES = [
  { name: 'Columbus, OH', coordinates: [-82.9988, 39.9612] },
  { name: 'Cleveland, OH', coordinates: [-81.6944, 41.4993] },
  { name: 'Cincinnati, OH', coordinates: [-84.512, 39.1031] },
  { name: 'Dayton, OH', coordinates: [-84.1916, 39.7589] },
  { name: 'Toledo, OH', coordinates: [-83.5552, 41.6639] },
  { name: 'Akron, OH', coordinates: [-81.519, 41.0814] },
  { name: 'Mansfield, OH', coordinates: [-82.5154, 40.7584] },
]

function windowLabel(minutes) {
  if (!minutes) return 'Exact'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}h ${rest}m`
  if (hours) return `${hours}h`
  return `${rest}m`
}

function departureRange(leave, minutes) {
  const center = new Date(fromWallInput(leave)).getTime()
  return {
    start: new Date(center - minutes * 60000).toISOString(),
    end: new Date(center + minutes * 60000).toISOString(),
  }
}

function describeWindow(leave, minutes) {
  try {
    const range = departureRange(leave, minutes)
    if (!minutes) return `Exact · ${clock(range.start)}`
    const nextDay = day(range.start) !== day(range.end) ? ' (+1d)' : ''
    return `±${windowLabel(minutes)} · ${clock(range.start)}–${clock(range.end)}${nextDay}`
  } catch {
    return windowLabel(minutes)
  }
}

function defaults() {
  const start = new Date(Math.ceil((Date.now() + 30 * 60000) / 900000) * 900000)
  return {
    origin: 'Columbus, OH', destination: 'Cleveland, OH', originPlace: PLACES[0], destinationPlace: PLACES[1],
    leave: toWallInput(new Date(start.getTime() + 3600000)), windowMinutes: 60, alternatives: true, mode: 'demo',
  }
}

async function resolvePlaces(form) {
  if (form.mode !== 'live') return form
  const originPlace = form.originPlace?.coordinates && form.originPlace.name === form.origin
    ? form.originPlace
    : await geocodeAddress(form.origin)
  const destinationPlace = form.destinationPlace?.coordinates && form.destinationPlace.name === form.destination
    ? form.destinationPlace
    : await geocodeAddress(form.destination)
  return { ...form, origin: originPlace.name, destination: destinationPlace.name, originPlace, destinationPlace }
}

async function getAnalysis(form, signal) {
  if (!form.originPlace?.coordinates || !form.destinationPlace?.coordinates) {
    throw new Error('Choose a starting point and a destination.')
  }
  const range = departureRange(form.leave, Number(form.windowMinutes))
  const googleRoutes = form.mode === 'live' && mapsKey() ? await getGoogleRoutes(form).catch(() => undefined) : undefined
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const response = await fetch('/api/trips/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ origin: form.originPlace, destination: form.destinationPlace,
      departureStart: range.start, departureEnd: range.end, timeZone: TIME_ZONE,
      includeAlternatives: form.alternatives, dataMode: form.mode, googleRoutes }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'The planner is unavailable. Check that the Flask backend is running on port 5001.')
  if (!data.routes?.length || !data.candidates?.length) throw new Error('The server returned no usable route comparisons.')
  return data
}

function Metric({ label, children }) {
  return <div className="trip-metric"><span>{label}</span><strong>{children}</strong></div>
}

export default function TripPlanner({ session, onAccount, onLogout: _onLogout, vehicle, vehicleError, vehicleReady }) {
  const [form, setForm] = useState(defaults)
  const [analysis, setAnalysis] = useState(null)
  const [routeId, setRouteId] = useState(null)
  const [departureIndex, setDepartureIndex] = useState(0)
  const [_selectedPoint, setSelectedPoint] = useState(3)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [_routingProvider, setRoutingProvider] = useState('OSRM')
  const [stopPlan, setStopPlan] = useState(null)
  const request = useRef(null)
  const initialForm = useRef(form)
  const mapRegion = useRef(null)

  function accept(data) {
    setAnalysis(data)
    setRouteId(data.routes[0].id)
    setDepartureIndex(0)
    setSelectedPoint(Math.min(3, data.routes[0].checkpoints.length - 1))
    setDirty(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    fetch('/api/trips/config', { signal: controller.signal }).then(response => response.json()).then(data => setRoutingProvider(data.routingProvider || 'OSRM')).catch(() => {})
    getAnalysis(initialForm.current, controller.signal).then(accept).catch(err => {
      if (err.name !== 'AbortError') setError(err instanceof TypeError ? 'Cannot reach the planner. Start the Flask backend on port 5001, then try again.' : err.message)
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [])

  function update(field, value) {
    setForm(current => ({ ...current, [field]: value }))
    setDirty(true)
    setError('')
  }

  function changeMode(mode) {
    setForm(current => ({
      ...current,
      mode,
      ...(mode === 'demo' ? { origin: PLACES[0].name, destination: PLACES[1].name, originPlace: PLACES[0], destinationPlace: PLACES[1] } : {}),
    }))
    setDirty(true)
    setError('')
  }

  function editPlace(field, text) {
    const placeField = field === 'origin' ? 'originPlace' : 'destinationPlace'
    setForm(current => ({
      ...current,
      [field]: text,
      [placeField]: current[placeField]?.name === text ? current[placeField] : null,
    }))
    setDirty(true)
    setError('')
  }

  function choosePlace(field, place) {
    setForm(current => ({
      ...current,
      [field]: place.name,
      [field === 'origin' ? 'originPlace' : 'destinationPlace']: place,
    }))
    setDirty(true)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      if (form.mode === 'live') {
        const range = departureRange(form.leave, Number(form.windowMinutes))
        const now = Date.now()
        const startTime = new Date(range.start).getTime()
        const endTime = new Date(range.end).getTime()
        if (startTime < now - 15 * 60000) {
          setError('Departure time is in the past. Choose a time from now onwards.')
          setBusy(false)
          return
        }
        if (endTime > now + 7 * 86400000) {
          setError('For live forecasts, choose a departure window within the next 7 days.')
          setBusy(false)
          return
        }
      }
      const ready = await resolvePlaces(form)
      if (controller.signal.aborted) return
      setForm(ready)
      const data = await getAnalysis(ready, controller.signal)
      if (!controller.signal.aborted) accept(data)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err instanceof TypeError ? 'Cannot reach the planner. Start the Flask backend on port 5001, then try again.' : err.message)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const [mountTime] = useState(() => Date.now())
  const minLeave = form.mode === 'live' ? toWallInput(new Date(mountTime - 10 * 60000)) : undefined
  const maxLeave = form.mode === 'live' ? toWallInput(new Date(mountTime + 7 * 86400000 - Number(form.windowMinutes) * 60000)) : undefined

  const route = analysis?.routes.find(item => item.id === routeId)
  const candidates = analysis?.candidates.filter(item => item.routeId === routeId) || []
  const candidate = candidates[departureIndex] || candidates[0]
  const activePlan = stopPlan?.candidateId === candidate?.id && stopPlan?.analysisId === analysis?.analysisId ? stopPlan : null
  const displayCandidate = activePlan ? {
    ...candidate,
    arrival: activePlan.arrival,
    higherMinutes: activePlan.higherMinutes,
    checkpoints: activePlan.checkpointConditions,
    segmentLevels: activePlan.segmentLevels,
  } : candidate

  const recommended = analysis?.candidates.find(item => item.id === analysis.recommendation?.candidateId)

  function useRecommendation() {
    if (!recommended) return
    setRouteId(recommended.routeId)
    setDepartureIndex(analysis.candidates.filter(item => item.routeId === recommended.routeId).findIndex(item => item.id === recommended.id))
  }

  return (
    <div className="planner-app">
      {/* Editorial Hero Stage */}
      <header className="hero-stage">
        <div className="hero-kicker">OHIO HIGHWAY WEATHER CORRIDORS</div>
        <h1 className="hero-headline">
          Your clearest drive starts with <em>better timing.</em>
        </h1>
        <p className="hero-sub">
          {form.mode === 'live'
            ? 'Type any starting point and destination. Forecasts follow the drive.'
            : 'A simulated Columbus to Cleveland drive. Switch to Live forecast to search any place.'}
        </p>

        {/* Dedicated Mode Selector Bar */}
        <div className="planner-mode-bar" role="toolbar" aria-label="Forecast data mode">
          <div className="capsule-mode-picker">
            <button
              type="button"
              className={form.mode === 'demo' ? 'active' : ''}
              aria-pressed={form.mode === 'demo'}
              onClick={() => changeMode('demo')}
            >
              <span className="mode-dot demo" />
              Simulated
            </button>
            <button
              type="button"
              className={form.mode === 'live' ? 'active' : ''}
              aria-pressed={form.mode === 'live'}
              onClick={() => changeMode('live')}
            >
              <span className="mode-dot live" />
              Live forecast
            </button>
          </div>
        </div>

        {/* Clean Integrated Trip Capsule Form */}
        <form onSubmit={submit} className="trip-capsule-form">
          <div className="capsule-locations">
            {form.mode === 'demo' ? (
              <>
                <div className="place-field-wrapper">
                  <label className="capsule-input-pair">
                    <span className="field-hint">From</span>
                    <select value={form.origin} disabled>
                      {PLACES.map(place => <option key={place.name}>{place.name}</option>)}
                    </select>
                  </label>
                </div>
                <span className="capsule-arrow" aria-hidden="true">→</span>
                <div className="place-field-wrapper">
                  <label className="capsule-input-pair">
                    <span className="field-hint">To</span>
                    <select value={form.destination} disabled>
                      {PLACES.map(place => <option key={place.name}>{place.name}</option>)}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <>
                <PlaceField hint="From" value={form.origin} disabled={busy} onText={text => editPlace('origin', text)} onPlace={place => choosePlace('origin', place)} />
                <span className="capsule-arrow" aria-hidden="true">→</span>
                <PlaceField hint="To" value={form.destination} disabled={busy} onText={text => editPlace('destination', text)} onPlace={place => choosePlace('destination', place)} />
              </>
            )}
          </div>

          <div className="capsule-v-divider" aria-hidden="true" />

          <div className="capsule-times">
            <label className="capsule-time-input">
              <span className="field-hint">Leave</span>
              <input
                type="datetime-local"
                required
                value={form.leave}
                disabled={busy}
                min={minLeave}
                max={maxLeave}
                onChange={event => update('leave', event.target.value)}
              />
            </label>
            <div className="capsule-window">
              <span className="field-hint">Before & after</span>
              <div className="capsule-window-body">
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="15"
                  value={form.windowMinutes}
                  disabled={busy}
                  aria-label="Departure window slider"
                  aria-valuemin={0}
                  aria-valuemax={360}
                  aria-valuenow={form.windowMinutes}
                  aria-valuetext={form.windowMinutes ? `${windowLabel(form.windowMinutes)} before and after` : 'Exact leave time'}
                  onChange={event => update('windowMinutes', Number(event.target.value))}
                />
                <span className="window-size">{describeWindow(form.leave, form.windowMinutes)}</span>
              </div>
            </div>
          </div>

          <div className="capsule-v-divider" aria-hidden="true" />

          <label className="capsule-alt-check">
            <input type="checkbox" checked={form.alternatives} disabled={busy} onChange={event => update('alternatives', event.target.checked)} />
            <span>Alternatives</span>
          </label>

          <button className="capsule-submit-btn" type="submit" disabled={busy}>
            {busy ? (
              <span className="spinner" />
            ) : (
              <>
                <span>Find Window</span> <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </form>

        {error && <p className="planner-error-banner" role="alert">{error}</p>}
        {dirty && analysis && <p className="pending-note-hero" role="status">Inputs changed. Click Find Window to re-evaluate.</p>}
      </header>

      {/* Main Unified Bone Card */}
      <main id="main" className="main-stage-container">
        <section className="unified-bone-card" aria-busy={busy}>
          {/* Card Topbar */}
          <div className="bone-card-header">
            <div className="route-spec-heading">
              <h2>{analysis ? <>{analysis.origin.name.split(',')[0]} <span className="route-arrow">→</span> {analysis.destination.name.split(',')[0]}</> : 'Explore the road ahead'}</h2>
              <p>{route ? `${miles(route.distanceMeters)} miles · ${duration(route.durationSeconds)} travel time` : 'Select endpoints and evaluate arrival weather'}</p>
            </div>

            <div className="header-badges-wrap">
              {recommended && (
                <button type="button" className="pinned-pill-tag" onClick={useRecommendation} title="Jump to optimal departure">
                  OPTIMAL: {clock(recommended.departure, analysis?.timeZone)} ET
                </button>
              )}
              <span className={`data-mode-tag ${form.mode === 'live' ? 'live' : ''}`}>
                <i /> {form.mode === 'live' ? 'LIVE FORECAST' : 'SIMULATED'}
              </span>
            </div>
          </div>

          {/* Compared Alternatives */}
          {form.alternatives && analysis?.routes?.length > 1 && (
            <div className="route-options-bar" role="tablist" aria-label="Route alternatives">
              {analysis.routes.map(r => {
                const bestForR = analysis.candidates
                  .filter(c => c.routeId === r.id)
                  .sort((a, b) => a.weightedExposure - b.weightedExposure)[0]
                const active = r.id === routeId
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-pressed={active}
                    aria-selected={active}
                    onClick={() => {
                      setRouteId(r.id)
                      setDepartureIndex(0)
                    }}
                  >
                    <span className="route-choice-dot" />
                    <strong>{r.name}</strong>
                    <span>{miles(r.distanceMeters)} mi · {duration(r.durationSeconds)}</span>
                    {bestForR && LEVELS[bestForR.level] && (
                      <span className="route-choice-exposure">· {LEVELS[bestForR.level].label}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Map Layout */}
          <div className="bone-split-layout" ref={mapRegion}>
            <RouteMap
              route={route}
              candidate={displayCandidate}
              stops={activePlan?.stops}
              onSelect={setSelectedPoint}
              originPlace={form.originPlace}
              destinationPlace={form.destinationPlace}
            />
          </div>

          {/* Quick Metrics Bar */}
          <div className="bone-trip-metrics">
            <Metric label="Travel Duration">{route ? duration(route.durationSeconds) : '—'}</Metric>
            <Metric label={activePlan ? 'Arrival with breaks' : 'Estimated Arrival'}>
              {displayCandidate?.arrival ? `${clock(displayCandidate.arrival, analysis?.timeZone)} ET` : '—'}
            </Metric>
            <Metric label="Higher Exposure">
              {displayCandidate ? (displayCandidate.higherMinutes > 0 ? `${displayCandidate.higherMinutes} min` : '0 min') : '—'}
            </Metric>
            <Metric label="Peak Condition">
              {displayCandidate?.level && LEVELS[displayCandidate.level] ? LEVELS[displayCandidate.level].label : '—'}
            </Metric>
          </div>

          {/* Interactive Timeline Scrubber */}
          <div className="bone-scrubber-section">
            <DepartureScrubber
              candidates={candidates}
              selectedIndex={departureIndex}
              recommendedId={recommended?.id}
              onChange={setDepartureIndex}
              timeZone={analysis?.timeZone}
            />

            {recommended && (
              <div className="bone-rec-bar">
                <span className="rec-star-quiet" aria-hidden="true">★</span>
                <div className="rec-bar-content">
                  <span className="rec-kicker">RECOMMENDED DEPARTURE WINDOW</span>
                  <h4>Leave around {clock(recommended.departure, analysis?.timeZone)} ET for best corridor weather</h4>
                  <p>
                    {analysis.recommendation?.minutesSaved > 0
                      ? `Saves ${analysis.recommendation.minutesSaved} minutes of storm exposure compared to earlier timing.`
                      : 'Offers the lowest risk profile and smoothest conditions along the Ohio corridor.'}
                  </p>
                </div>
                <button type="button" className="rec-lock-btn" onClick={useRecommendation}>
                  Jump to {clock(recommended.departure, analysis?.timeZone)}
                </button>
              </div>
            )}
          </div>

          {/* Weather-Aware Break Stops Module */}
          {analysis && candidate && (
            <StopPlanner
              analysis={analysis}
              candidate={candidate}
              vehicle={vehicle}
              vehicleError={vehicleError}
              vehicleReady={vehicleReady}
              session={session}
              onAccount={onAccount}
              onApply={setStopPlan}
              applied={Boolean(activePlan)}
              onSelect={(cpIndex) => {
                setSelectedPoint(cpIndex)
                mapRegion.current?.scrollIntoView({ behavior: 'smooth' })
              }}
            />
          )}

          {/* Card Footer */}
          <div className="bone-card-footer">
            <span>CORRIDOR WEATHER DISPATCH &middot; OHIO INTERSTATE SYSTEM</span>
            <span>5-MIN STEP FORECAST SAMPLING</span>
          </div>
        </section>
      </main>

      {/* Editorial Corridor Dispatch Footer */}
      <footer className="planner-footer" role="contentinfo">
        <div className="planner-footer-inner">
          {/* Top Tier: Masthead, Brand Statement & Operational Status */}
          <div className="footer-masthead">
            <div className="footer-brand-lockup">
              <div
                className="footer-brand"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <span className="footer-symbol" aria-hidden="true">w.</span>
                <div className="footer-brand-title">
                  <span className="footer-brand-name">WeatherWay</span>
                  <span className="footer-brand-sub">OHIO CORRIDOR DISPATCH</span>
                </div>
              </div>
              <p className="footer-mission">
                Arrival-matched highway weather forecasting and departure window optimization across Ohio and North American interstates. Synchronizing high-resolution NOAA simulations, EPA vehicle ranges, and precision hazard analysis.
              </p>
            </div>

            <div className="footer-status-card">
              <div className="footer-status-pill">
                <span className="status-dot-pulse" aria-hidden="true" />
                <span className="status-text-live">All Corridor Engines Nominal</span>
              </div>
              <div className="footer-meta-tags">
                <span className="meta-tag">NOAA HRRR (3km)</span>
                <span className="meta-tag">Open-Meteo 15-Min</span>
                <span className="meta-tag">Mapbox &middot; OSRM</span>
                <span className="meta-tag">EPA FuelEconomy</span>
              </div>
            </div>
          </div>

          {/* Middle Tier: Directory Grid */}
          <div className="footer-directory">
            <div className="footer-column">
              <h4 className="footer-column-heading">Monitored Corridors</h4>
              <ul className="footer-links">
                <li><span className="corridor-bullet">I-71</span> Cincinnati &middot; Columbus &middot; Cleveland</li>
                <li><span className="corridor-bullet">I-75</span> Dayton &middot; Findlay &middot; Toledo</li>
                <li><span className="corridor-bullet">I-90</span> Lake Erie Turnpike &middot; Ashtabula</li>
                <li><span className="corridor-bullet">I-70</span> Richmond &middot; Springfield &middot; Wheeling</li>
              </ul>
            </div>

            <div className="footer-column">
              <h4 className="footer-column-heading">Meteorological Sources</h4>
              <ul className="footer-links">
                <li><a href="https://rapidrefresh.noaa.gov/hrrr/" target="_blank" rel="noreferrer">NOAA HRRR Rapid Refresh</a></li>
                <li><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo Weather APIs</a></li>
                <li><a href="https://www.weather.gov/" target="_blank" rel="noreferrer">National Weather Service (NWS)</a></li>
                <li><a href="https://fueleconomy.gov/" target="_blank" rel="noreferrer">FuelEconomy.gov Vehicle Specs</a></li>
              </ul>
            </div>

            <div className="footer-column">
              <h4 className="footer-column-heading">Dispatcher Navigation</h4>
              <ul className="footer-links">
                <li>
                  <button type="button" className="footer-action-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    Departure Window Scrubber &uarr;
                  </button>
                </li>
                <li>
                  <button type="button" className="footer-action-link" onClick={onAccount}>
                    {session?.user ? 'Operator Profile & Garage' : 'Dispatcher Sign In / Register'}
                  </button>
                </li>
                <li>
                  <button type="button" className="footer-action-link" onClick={() => changeMode(form.mode === 'demo' ? 'live' : 'demo')}>
                    Mode: {form.mode === 'demo' ? 'Simulated (Click for Live)' : 'Live Forecast (Click for Sim)'}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="footer-action-link"
                    onClick={() => {
                      const el = document.querySelector('.stop-planner')
                      if (el) el.scrollIntoView({ behavior: 'smooth' })
                      else window.scrollTo({ top: 400, behavior: 'smooth' })
                    }}
                  >
                    Fuel &amp; Food Stop Planner
                  </button>
                </li>
              </ul>
            </div>

            <div className="footer-column">
              <h4 className="footer-column-heading">HackOHIO Dispatch</h4>
              <p className="footer-edition-text">
                Designed and engineered for HackOHIO 2026. Built with precision geographic coordinate interpolation, dynamic route caching, and the Terracotta Editorial visual framework.
              </p>
              <div className="footer-edition-badges">
                <span className="edition-badge">HackOHIO / 2026</span>
                <span className="edition-badge">The Ohio State University</span>
              </div>
            </div>
          </div>

          {/* Bottom Tier: Colophon & Legal Rail */}
          <div className="footer-colophon">
            <div className="footer-legal">
              <p className="footer-disclaimer">
                Safety Notice: WeatherWay exposure indices model ambient weather along road segments and do not supersede official ODOT, state highway patrol, or emergency travel bans.
              </p>
              <p className="footer-copyright">
                &copy; {CURRENT_YEAR} WeatherWay &middot; Ohio Interstate Dispatch System.
              </p>
            </div>

            <button
              type="button"
              className="footer-back-to-top"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label="Back to top of dispatch"
            >
              <span>Back to top</span>
              <span className="back-arrow" aria-hidden="true">&uarr;</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
