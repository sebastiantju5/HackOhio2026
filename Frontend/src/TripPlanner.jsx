import { useEffect, useRef, useState } from 'react'
import RouteMap from './RouteMap.jsx'
import DepartureScrubber from './DepartureScrubber.jsx'
import { LEVELS, TIME_ZONE, clock, day, duration, fromWallInput, miles, toWallInput } from './format.js'
import PlaceField from './PlaceField.jsx'
import { geocodeAddress, mapsKey } from './googleMaps.js'
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
  const [selectedPoint, setSelectedPoint] = useState(3)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [routingProvider, setRoutingProvider] = useState('OSRM')
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
  const pointIndex = Math.min(selectedPoint, (route?.checkpoints.length || 1) - 1)
  const recommended = analysis?.candidates.find(item => item.id === analysis.recommendation?.candidateId)
  const baseline = analysis?.candidates.find(item => item.routeId === analysis.routes[0].id)

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

        {/* Clean Integrated Trip Capsule Form */}
        <form onSubmit={submit} className="trip-capsule-form">
          <fieldset className="capsule-mode-picker" disabled={busy}>
            <legend className="sr-only">Data mode</legend>
            <button type="button" aria-pressed={form.mode === 'demo'} onClick={() => changeMode('demo')}>
              Simulated
            </button>
            <button type="button" aria-pressed={form.mode === 'live'} onClick={() => changeMode('live')}>
              Live forecast
            </button>
          </fieldset>

          <div className="capsule-locations">
            {form.mode === 'demo' ? <>
              <label className="capsule-input-pair">
                <span className="field-hint">From</span>
                <select value={form.origin} disabled>
                  {PLACES.map(place => <option key={place.name}>{place.name}</option>)}
                </select>
              </label>
              <span className="capsule-divider" aria-hidden="true">→</span>
              <label className="capsule-input-pair">
                <span className="field-hint">To</span>
                <select value={form.destination} disabled>
                  {PLACES.map(place => <option key={place.name}>{place.name}</option>)}
                </select>
              </label>
            </> : mapsKey() ? <>
              <PlaceField hint="From" value={form.origin} disabled={busy} onText={text => editPlace('origin', text)} onPlace={place => choosePlace('origin', place)} />
              <span className="capsule-divider" aria-hidden="true">→</span>
              <PlaceField hint="To" value={form.destination} disabled={busy} onText={text => editPlace('destination', text)} onPlace={place => choosePlace('destination', place)} />
            </> : <p className="place-key-note">Add VITE_GOOGLE_MAPS_API_KEY to Frontend/.env, enable Maps JavaScript, Places, Geocoding, and Directions, then restart the site.</p>}
          </div>

          <div className="capsule-times">
            <label className="capsule-time-input">
              <span className="field-hint">Leave</span>
              <input type="datetime-local" required value={form.leave} disabled={busy} onChange={event => update('leave', event.target.value)} />
            </label>
            <label className="capsule-window">
              <span className="field-hint">Before & after</span>
              <input
                type="range"
                min="0"
                max="360"
                step="15"
                value={form.windowMinutes}
                disabled={busy}
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={form.windowMinutes}
                aria-valuetext={form.windowMinutes ? `${windowLabel(form.windowMinutes)} before and after` : 'Exact leave time'}
                onChange={event => update('windowMinutes', Number(event.target.value))}
              />
              <span className="window-size">{describeWindow(form.leave, form.windowMinutes)}</span>
            </label>
          </div>

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
                <span className="pinned-pill-tag">Optimal: {clock(recommended.departure, analysis?.timeZone)} ET</span>
              )}
              <span className={`data-mode-tag ${analysis?.dataMode === 'live' ? 'live' : ''}`}>
                <i />{analysis?.dataMode === 'live' ? 'LIVE FORECAST' : 'SIMULATED'}
              </span>
            </div>
          </div>

          {/* Alternative Routes Selector */}
          {analysis && analysis.routes.length > 1 && (
            <div className="route-options-bar" aria-label="Choose route">
              {analysis.routes.map(item => (
                <button type="button" key={item.id} aria-pressed={routeId === item.id} onClick={() => { setRouteId(item.id); setDepartureIndex(0); setSelectedPoint(0) }}>
                  <span className="route-choice-dot" />
                  <strong>{item.name}</strong>
                  <span>{duration(item.durationSeconds)} · {miles(item.distanceMeters)} mi</span>
                </button>
              ))}
            </div>
          )}

          {/* Map & Checkpoint Split */}
          <div className="bone-split-layout">
            <RouteMap route={route} candidate={candidate} selectedPoint={pointIndex} onSelect={setSelectedPoint} origin={analysis?.origin.name} destination={analysis?.destination.name} originPlace={form.originPlace} destinationPlace={form.destinationPlace} />
          </div>

          {/* Metrics & Scrubber Details */}
          {candidate && (
            <>
              <div className="bone-trip-metrics">
                <Metric label="On the road">{duration(route.durationSeconds)}</Metric>
                <Metric label="Estimated arrival">{clock(candidate.arrival, analysis.timeZone)} <small>{day(candidate.arrival, analysis.timeZone)}</small></Metric>
                <Metric label="Higher exposure">{Math.round(candidate.higherMinutes)} <small>min</small></Metric>
                <Metric label="Forecast coverage">{candidate.complete ? 'Complete' : `${Math.round(candidate.unknownMinutes)} min unknown`}</Metric>
              </div>

              <div className="bone-scrubber-section">
                <DepartureScrubber candidates={candidates} selectedIndex={departureIndex} onChange={setDepartureIndex} recommendedId={analysis.recommendation?.candidateId} timeZone={analysis.timeZone} />

                {/* Recommendation Banner */}
                <div className="bone-rec-bar" aria-live="polite">
                  <span className="rec-star-quiet" aria-hidden="true">★</span>
                  <div className="rec-bar-content">
                    <span className="rec-kicker">{analysis.recommendation?.allHigherExposure ? 'HIGHER EXPOSURE ACROSS WINDOW' : 'RECOMMENDED DEPARTURE WINDOW'}</span>
                    {recommended ? (
                      <>
                        <h4>{clock(analysis.recommendation.windowStart, analysis.timeZone)}{analysis.recommendation.windowStart !== analysis.recommendation.windowEnd && `–${clock(analysis.recommendation.windowEnd, analysis.timeZone)}`} ET <span>· {analysis.routes.find(item => item.id === recommended.routeId)?.name}</span></h4>
                        <p>{Math.round(recommended.higherMinutes)} higher-exposure minutes, compared with {Math.round(baseline?.higherMinutes || 0)} at the earliest departure on the direct route. Arrives {clock(recommended.arrival, analysis.timeZone)} ET.{analysis.recommendation.timingSensitive && ' Sensitive to a ±15-minute change in arrival timing.'}</p>
                      </>
                    ) : (
                      <p>{analysis.recommendation?.reason}</p>
                    )}
                  </div>
                  {recommended && (
                    <button type="button" className="rec-lock-btn" onClick={useRecommendation}>
                      Explore this departure →
                    </button>
                  )}
                </div>

                {/* All Checkpoints Drawer */}
                <details className="checkpoints-list-bone">
                  <summary>All {route?.checkpoints.length || 0} checkpoints <span>15-minute travel intervals + destination</span></summary>
                  <div className="checkpoint-buttons-grid">
                    {route?.checkpoints.map((point, index) => (
                      <button type="button" key={point.id} className={candidate.checkpoints[index]?.level} aria-pressed={pointIndex === index} onClick={() => setSelectedPoint(index)}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong>{clock(candidate.checkpoints[index]?.arrival, analysis.timeZone)}</strong>
                        <small>Mile {miles(point.distanceMeters)} · {LEVELS[candidate.checkpoints[index]?.level]?.label}</small>
                      </button>
                    ))}
                  </div>
                </details>

                {/* Methodology Details */}
                <details className="methodology-bone">
                  <summary>Methodology & Atmospheric Data Sources</summary>
                  <p>{analysis.recommendation?.reason}</p>
                  <ul>{analysis.limitations?.map(item => <li key={item}>{item}</li>)}</ul>
                  <p>Demonstration thresholds: rain caution ≥1 mm/h, higher ≥7.5 mm/h; projected crosswind gust caution ≥25 km/h, higher ≥45 km/h; visibility caution below 3 km, higher below 1 km. Wet conditions with air temperature ≤2°C trigger possible freezing conditions. Unknown data cannot earn a clear label. Scoring: {analysis.scoringVersion}.</p>
                  <p>{analysis.sources?.filter(item => item.trafficNote).map(item => item.trafficNote).join(' ')}</p>
                  <p><a href="https://open-meteo.com/en/docs/gfs-api" target="_blank" rel="noreferrer">Open-Meteo / NOAA HRRR</a> · <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM Demo Routing</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p>
                </details>
              </div>
            </>
          )}

          {!analysis && !busy && (
            <div className="no-analysis-pane">
              <h3>Your next drive starts here.</h3>
              <p>Choose a departure window and analyze a trip. The simulated scenario works without external API keys.</p>
            </div>
          )}

          <footer className="bone-card-footer">
            <span>WEATHER AT ARRIVAL · FORESIGHT FOR THE ROAD</span>
            <span>{analysis ? `Analyzed ${clock(analysis.generatedAt, analysis.timeZone)} ET · ${analysis.coverageStatus} coverage` : `${routingProvider} routing + HRRR point forecasts`}</span>
          </footer>
        </section>
      </main>
    </div>
  )
}
