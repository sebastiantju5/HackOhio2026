import { useEffect, useRef, useState } from 'react'
import RouteMap from './RouteMap.jsx'
import DepartureScrubber from './DepartureScrubber.jsx'
import { LEVELS, TIME_ZONE, clock, day, duration, fromWallInput, miles, toWallInput } from './format.js'
import PlaceField from './PlaceField.jsx'
import { geocodeAddress } from './googleMaps.js'
import './TripPlanner.css'

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
  if (!minutes) return 'Exact time'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}h ${rest}m`
  if (hours === 1) return '1 hour'
  if (hours) return `${hours} hours`
  return `${minutes} min`
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
    const span = day(range.start) === day(range.end)
      ? `${clock(range.start)}–${clock(range.end)}`
      : `${day(range.start)} ${clock(range.start)} – ${day(range.end)} ${clock(range.end)}`
    return `${windowLabel(minutes)} · ${span}`
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
  const response = await fetch('/api/trips/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ origin: form.originPlace, destination: form.destinationPlace,
      departureStart: range.start, departureEnd: range.end, timeZone: TIME_ZONE,
      includeAlternatives: form.alternatives, dataMode: form.mode }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'The planner is unavailable. Check that the Flask backend is running on port 5001.')
  if (!data.routes?.length || !data.candidates?.length) throw new Error('The server returned no usable route comparisons.')
  return data
}

function Metric({ label, children }) {
  return <div className="trip-metric"><span>{label}</span><strong>{children}</strong></div>
}

export default function TripPlanner() {
  const [form, setForm] = useState(defaults)
  const [analysis, setAnalysis] = useState(null)
  const [routeId, setRouteId] = useState(null)
  const [departureIndex, setDepartureIndex] = useState(0)
  const [_selectedPoint, setSelectedPoint] = useState(3)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [_routingProvider, setRoutingProvider] = useState('OSRM')
  const request = useRef(null)
  const initialForm = useRef(form)

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

  const route = analysis?.routes.find(item => item.id === routeId)
  const candidates = analysis?.candidates.filter(item => item.routeId === routeId) || []
  const candidate = candidates[departureIndex] || candidates[0]
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
              <input type="datetime-local" required value={form.leave} disabled={busy} onChange={event => update('leave', event.target.value)} />
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
                <button type="button" className="bone-rec-badge" onClick={useRecommendation}>
                  <span className="badge-kicker">OPTIMAL: {clock(recommended.departureTime)} ET</span>
                </button>
              )}
              <span className="bone-meta-pill">
                <i className="status-dot" /> {form.mode === 'live' ? 'LIVE FORECAST' : 'SIMULATED'}
              </span>
            </div>
          </div>

          {/* Map Layout */}
          <div className="bone-split-layout">
            <RouteMap route={route} candidate={candidate} onSelect={setSelectedPoint} originPlace={form.originPlace} destinationPlace={form.destinationPlace} />
          </div>

          {/* Metrics & Scrubber Details */}
          <div className="bone-details-flow">
            {/* Interactive Timeline Scrubber */}
            <div className="bone-scrubber-module">
              <DepartureScrubber
                candidates={candidates}
                selectedIndex={departureIndex}
                recommendedId={recommended?.id}
                onSelect={setDepartureIndex}
              />
            </div>

            {/* Quick Metrics Bar */}
            <div className="bone-metrics-row">
              <Metric label="Travel Duration">{route ? duration(route.durationSeconds) : '—'}</Metric>
              <Metric label="Exposure Index">
                {candidate ? `${Math.round(candidate.exposureScore * 100)} / 100` : '—'}
              </Metric>
              <Metric label="Peak Condition">
                {candidate ? LEVELS[candidate.worstLevel].label : '—'}
              </Metric>
              <Metric label="Departure Time">
                {candidate ? `${clock(candidate.departureTime)} ET` : '—'}
              </Metric>
            </div>

            {/* Compared Alternatives */}
            {form.alternatives && analysis?.routes?.length > 1 && (
              <div className="alternatives-summary-callout">
                <h4>Route Alternatives Analyzed</h4>
                <div className="alternatives-chips">
                  {analysis.routes.map(r => {
                    const bestForR = analysis.candidates
                      .filter(c => c.routeId === r.id)
                      .sort((a, b) => a.exposureScore - b.exposureScore)[0]
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`alt-chip ${r.id === routeId ? 'active' : ''}`}
                        onClick={() => {
                          setRouteId(r.id)
                          setDepartureIndex(0)
                        }}
                      >
                        <span className="alt-title">{r.title}</span>
                        <span className="alt-meta">{miles(r.distanceMeters)} mi · best score {Math.round(bestForR?.exposureScore * 100)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Atmospheric Footer */}
      <footer className="planner-footer">
        <p>WeatherWay Ohio Corridor Dispatch &middot; Open-Meteo &middot; NOAA HRRR &middot; Mapbox / OSRM &middot; Leaflet</p>
      </footer>
    </div>
  )
}
