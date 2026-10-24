import { useEffect, useRef, useState } from 'react'
import RouteMap from './RouteMap.jsx'
import DepartureScrubber from './DepartureScrubber.jsx'
import CheckpointPanel from './CheckpointPanel.jsx'
import { LEVELS, TIME_ZONE, clock, day, duration, fromWallInput, miles, toWallInput } from './format.js'
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

function defaults() {
  const start = new Date(Math.ceil((Date.now() + 30 * 60000) / 900000) * 900000)
  return { origin: 'Columbus, OH', destination: 'Cleveland, OH', start: toWallInput(start), end: toWallInput(new Date(start.getTime() + 7200000)), alternatives: true, mode: 'demo' }
}

async function getAnalysis(form, signal) {
  const response = await fetch('/api/trips/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ origin: PLACES.find(place => place.name === form.origin), destination: PLACES.find(place => place.name === form.destination),
      departureStart: fromWallInput(form.start), departureEnd: fromWallInput(form.end), timeZone: TIME_ZONE,
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

export default function TripPlanner({ onAccount }) {
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
    setForm(current => ({ ...current, mode, ...(mode === 'demo' ? { origin: PLACES[0].name, destination: PLACES[1].name } : {}) }))
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
      const data = await getAnalysis(form, controller.signal)
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
  const recommended = analysis?.candidates.find(item => item.id === analysis.recommendation.candidateId)
  const source = analysis?.sources.find(item => item.model)
  const baseline = analysis?.candidates.find(item => item.routeId === analysis.routes[0].id)

  function useRecommendation() {
    if (!recommended) return
    setRouteId(recommended.routeId)
    setDepartureIndex(analysis.candidates.filter(item => item.routeId === recommended.routeId).findIndex(item => item.id === recommended.id))
  }

  return <div className="planner-app">
    <header className="planner-header">
      <a className="wordmark" href="#main"><span className="brand-symbol" aria-hidden="true">w.</span>weatherway<span className="brand-rule" /><span className="brand-caption">A little foresight goes a long way.</span></a>
      <div className="header-actions"><span className="edition">HACKOHIO / 2026</span><button className="account-button" onClick={onAccount}>Account ↗</button></div>
    </header>
    <main id="main" className="planner-layout">
      <aside className="planning-sidebar">
        <div className="sidebar-intro"><span className="mini-label">THE ROAD AHEAD, REIMAGINED</span><h1>Good timing.{' '}<br /><em>Better travels.</em></h1><p>The weather moves.{' '}<br />Plan your drive around it.</p></div>
        <form onSubmit={submit} className="trip-form">
          <fieldset className="mode-picker" disabled={busy}><legend className="sr-only">Data mode</legend><button type="button" aria-pressed={form.mode === 'demo'} onClick={() => changeMode('demo')}>Simulated scenario</button><button type="button" aria-pressed={form.mode === 'live'} onClick={() => changeMode('live')}>Live forecast</button></fieldset>
          <div className="location-fields"><label><span className="field-label"><i className="origin-dot" />Starting from</span><select value={form.origin} disabled={form.mode === 'demo' || busy} onChange={event => update('origin', event.target.value)}>{PLACES.map(place => <option key={place.name}>{place.name}</option>)}</select></label><span className="location-connector" aria-hidden="true" /><label><span className="field-label"><i className="destination-dot" />Heading to</span><select value={form.destination} disabled={form.mode === 'demo' || busy} onChange={event => update('destination', event.target.value)}>{PLACES.map(place => <option key={place.name}>{place.name}</option>)}</select></label></div>
          <div className="departure-inputs"><label><span className="field-label">Earliest departure</span><input type="datetime-local" required value={form.start} disabled={busy} onChange={event => update('start', event.target.value)} /></label><label><span className="field-label">Latest departure</span><input type="datetime-local" required value={form.end} disabled={busy} onChange={event => update('end', event.target.value)} /></label></div>
          <p className="input-hint">Eastern time · departure window up to 2 hours</p>
          <label className="alternatives-check"><input type="checkbox" checked={form.alternatives} disabled={busy} onChange={event => update('alternatives', event.target.checked)} />Compare alternative routes</label>
          <button className="analyze-button" type="submit" disabled={busy}>{busy ? <><span className="spinner" />Reading the road ahead…</> : <>Find my weather window <span aria-hidden="true">↗</span></>}</button>
          {error && <p className="planner-error" role="alert">{error}</p>}
          {dirty && analysis && <p className="pending-note" role="status">Inputs changed. Analyze to update the results shown.</p>}
        </form>
        <div className="sidebar-note"><span className="note-symbol" aria-hidden="true">↗</span><div><strong>Weather where you’ll be.</strong><p>Each checkpoint pairs your arrival time with the forecast at that location.</p></div></div>
        <div className="provider-note"><span className="mini-label">UNDER THE HOOD</span><p>{form.mode === 'demo' ? 'Synthetic weather · illustrative Ohio corridors. No live conditions or navigation geometry.' : `${routingProvider} routing + Open-Meteo HRRR. ${routingProvider === 'OSRM' ? 'Public demo routing; no traffic data.' : 'Traffic-aware baseline; fixed across departures.'}`}</p></div>
      </aside>
      <section className="journey-workspace" aria-busy={busy}>
        <div className="journey-topline"><div><span className="mini-label">YOUR WEATHER CORRIDOR</span><h2>{analysis ? <>{analysis.origin.name.split(',')[0]} <span className="route-arrow">→</span> {analysis.destination.name.split(',')[0]}</> : 'Explore the road ahead'}</h2></div><span className={`data-mode-label ${analysis?.dataMode === 'live' ? 'live' : ''}`}><i />{analysis?.dataMode === 'live' ? 'LIVE FORECAST' : 'SIMULATED SCENARIO'}</span></div>
        {analysis && <div className="route-options" aria-label="Choose route">{analysis.routes.map(item => <button type="button" key={item.id} aria-pressed={routeId === item.id} onClick={() => { setRouteId(item.id); setDepartureIndex(0); setSelectedPoint(0) }}><span className="route-choice-mark" /><strong>{item.name}</strong><span>{duration(item.durationSeconds)} · {miles(item.distanceMeters)} mi</span></button>)}</div>}
        <div className="map-and-details"><RouteMap route={route} candidate={candidate} selectedPoint={pointIndex} onSelect={setSelectedPoint} origin={analysis?.origin.name} destination={analysis?.destination.name} /><CheckpointPanel checkpoint={route?.checkpoints[pointIndex]} condition={candidate?.checkpoints[pointIndex]} source={source} timeZone={analysis?.timeZone} /></div>
        {candidate && <><div className="trip-metrics"><Metric label="On the road">{duration(route.durationSeconds)}</Metric><Metric label="Estimated arrival">{clock(candidate.arrival, analysis.timeZone)} <small>{day(candidate.arrival, analysis.timeZone)}</small></Metric><Metric label="Higher exposure">{Math.round(candidate.higherMinutes)} <small>min</small></Metric><Metric label="Forecast coverage">{candidate.complete ? 'Complete' : `${Math.round(candidate.unknownMinutes)} min unknown`}</Metric></div>
          <DepartureScrubber candidates={candidates} selectedIndex={departureIndex} onChange={setDepartureIndex} recommendedId={analysis.recommendation.candidateId} timeZone={analysis.timeZone} />
          <div className="recommendation" aria-live="polite"><span className="recommendation-symbol" aria-hidden="true">↗</span><div><span className="mini-label">{analysis.recommendation.allHigherExposure ? 'HIGHER EXPOSURE ACROSS THE WINDOW' : 'YOUR FORECAST WINDOW'}</span>{recommended ? <><h3>{clock(analysis.recommendation.windowStart, analysis.timeZone)}{analysis.recommendation.windowStart !== analysis.recommendation.windowEnd && `–${clock(analysis.recommendation.windowEnd, analysis.timeZone)}`} ET <span>· {analysis.routes.find(item => item.id === recommended.routeId).name}</span></h3><p>{Math.round(recommended.higherMinutes)} higher-exposure minutes, compared with {Math.round(baseline.higherMinutes)} at the earliest departure on the direct route. Arrive {clock(recommended.arrival, analysis.timeZone)} ET.{analysis.recommendation.timingSensitive && ' Sensitive to a ±15-minute change in arrival timing.'}</p></> : <p>{analysis.recommendation.reason}</p>}</div>{recommended && <button type="button" onClick={useRecommendation}>Explore this departure <span aria-hidden="true">→</span></button>}</div>
          <details className="checkpoints-list"><summary>All {route.checkpoints.length} checkpoints <span>15-minute travel intervals + destination</span></summary><div className="checkpoint-buttons">{route.checkpoints.map((point, index) => <button type="button" key={point.id} className={candidate.checkpoints[index].level} aria-pressed={pointIndex === index} onClick={() => setSelectedPoint(index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{clock(candidate.checkpoints[index].arrival, analysis.timeZone)}</strong><small>Mile {miles(point.distanceMeters)} · {LEVELS[candidate.checkpoints[index].level].label}</small></button>)}</div></details>
          <details className="methodology"><summary>How the comparison works</summary><p>{analysis.recommendation.reason}</p><ul>{analysis.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>Demonstration thresholds: rain caution ≥1 mm/h, higher ≥7.5 mm/h; projected crosswind gust caution ≥25 km/h, higher ≥45 km/h; visibility caution below 3 km, higher below 1 km. Wet conditions with air temperature ≤2°C trigger possible freezing conditions. Unknown data cannot earn a clear label. Scoring: {analysis.scoringVersion}.</p><p>Each route interval uses the worse endpoint class. Exposure minutes are sampled estimates. Temperature and wind are matched to the returned forecast timestamp; precipitation is a preceding 15-minute accumulation.</p><p>{analysis.sources.filter(item => item.trafficNote).map(item => item.trafficNote).join(' ')}</p><p><a href="https://open-meteo.com/en/docs/gfs-api" target="_blank" rel="noreferrer">Open-Meteo / NOAA data</a> · <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p></details>
        </>}
        {!analysis && !busy && <div className="no-analysis"><h3>Your next drive starts here.</h3><p>Choose a departure window and analyze a trip. The simulated scenario works without external API keys.</p></div>}
        <footer className="workspace-footer"><span>PLAN WITH PERSPECTIVE.</span><span>{analysis ? `Analyzed ${clock(analysis.generatedAt, analysis.timeZone)} ET · ${analysis.coverageStatus} coverage` : 'Weather at arrival. A clearer view ahead.'}</span></footer>
      </section>
    </main>
  </div>
}
