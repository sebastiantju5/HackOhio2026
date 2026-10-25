import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RouteMap from './RouteMap.jsx'
import DepartureScrubber from './DepartureScrubber.jsx'
import JourneyAgent from './JourneyAgent.jsx'
import AddedStops from './AddedStops.jsx'
import { planMatchesSelection } from './stopPresentation.js'
import { LEVELS, TIME_ZONE, clock, day, duration, miles, toWallInput } from './format.js'
import PlaceField from './PlaceField.jsx'
import { geocodeAddress, geocodeCheckpoint, getGoogleRoutes, mapsKey } from './googleMaps.js'
import { analyzeTrip, candidateWithStops, departureRange } from './tripAnalysis.js'
import './TripPlanner.css'

const CURRENT_YEAR = new Date().getFullYear()
const EMPTY_PLACES = []
const EMPTY_FOCUS = { stopIndex: null, venueId: null, sequence: 0 }

const COLUMBUS = { name: 'Columbus, OH', coordinates: [-82.9988, 39.9612] }
const CLEVELAND = { name: 'Cleveland, OH', coordinates: [-81.6944, 41.4993] }

function windowLabel(minutes) {
  if (!minutes) return 'Exact'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}h ${rest}m`
  if (hours) return `${hours}h`
  return `${rest}m`
}

function describeRange(leave, minutes) {
  try {
    const range = departureRange(leave, minutes)
    const start = clock(range.start)
    if (!minutes) return start
    const end = clock(range.end)
    const nextDay = day(range.start) !== day(range.end) ? ' +1d' : ''
    const sameMeridiem = start.slice(-2) === end.slice(-2)
    return `${sameMeridiem ? start.slice(0, -3) : start}–${end}${nextDay}`
  } catch {
    return ''
  }
}

function defaults() {
  const start = new Date(Math.ceil((Date.now() + 30 * 60000) / 900000) * 900000)
  return {
    origin: COLUMBUS.name, destination: CLEVELAND.name, originPlace: COLUMBUS, destinationPlace: CLEVELAND,
    leave: toWallInput(new Date(start.getTime() + 3600000)), windowMinutes: 60, alternatives: true, mode: 'live',
  }
}

async function resolvePlaces(form) {
  const originPlace = form.originPlace?.coordinates && form.originPlace.name === form.origin
    ? form.originPlace
    : await geocodeAddress(form.origin)
  const destinationPlace = form.destinationPlace?.coordinates && form.destinationPlace.name === form.destination
    ? form.destinationPlace
    : await geocodeAddress(form.destination)
  return { ...form, origin: originPlace.name, destination: destinationPlace.name, originPlace, destinationPlace }
}

async function getAnalysis(form, signal) {
  return analyzeTrip(form, { signal, mapsAvailable: Boolean(mapsKey()), getRoutes: getGoogleRoutes, timeZone: TIME_ZONE })
}

function Metric({ label, children, note }) {
  return <div className="trip-metric"><span>{label}</span><strong>{children}</strong>{note && <small>{note}</small>}</div>
}

function dollars(amount) {
  return `$${amount.toFixed(2)}`
}

function driveFuel(route, vehicle, fuelPrices) {
  const mpg = Number(vehicle?.mpg)
  if (!route || !Number.isFinite(mpg) || mpg <= 0) return null
  const gallons = Math.round(route.distanceMeters / 1609.344 / mpg * 10) / 10
  const quote = fuelPrices?.prices?.[vehicle.fuelType]
  return { gallons, cost: quote ? gallons * quote.dollarsPerGallon : null, quote, mpg }
}

function fahrenheit(celsius) {
  return Math.round(celsius * 9 / 5 + 32)
}

function worstStretch(candidate, route, timeZone) {
  const points = candidate.checkpoints || []
  const worst = Math.max(0, ...points.map(point => point.severity).filter(Number.isFinite))
  if (!worst) return ''
  const point = points.find(item => item.severity === worst)
  const meters = route?.checkpoints.find(item => item.id === point.checkpointId)?.distanceMeters
  const mile = Math.round(meters / 1609.344)
  const where = !Number.isFinite(meters) ? '' : mile < 1 ? ', right at the start of the drive' : `, about ${mile} miles in`
  return ` The worst stretch hits around ${clock(point.arrival, timeZone)}${where}.`
}

function compareToRecommended(candidate, recommended, timeZone) {
  if (!recommended) return ''
  if (candidate.id === recommended.id) return ' This is the recommended departure.'
  const saved = Math.round(candidate.higherMinutes - recommended.higherMinutes)
  if (saved > 0) return ` Leaving at ${clock(recommended.departure, timeZone)} instead would cut about ${saved} minutes of higher exposure.`
  return ` About as good as the recommended ${clock(recommended.departure, timeZone)} departure.`
}

function summarizeDrive(candidate, timeZone, route, recommended) {
  const readings = (candidate?.checkpoints || []).map(point => point.weather).filter(Boolean)
  if (!readings.length) return `Forecast coverage is incomplete for a ${clock(candidate.departure, timeZone)} departure, so the weather along the drive is not available yet.`
  const numbers = (key) => readings.map(reading => reading[key]).filter(Number.isFinite)
  const temps = numbers('temperatureC')
  const maxRain = Math.max(0, ...numbers('rainMmPerHour'))
  const maxWind = Math.max(0, ...numbers('crosswindGustKph')) / 1.609344
  const visibility = numbers('visibilityM')
  const minVisibility = visibility.length ? Math.min(...visibility) / 1609.344 : null
  const conditions = []
  if (maxRain >= 7.5) conditions.push('heavy rain')
  else if (maxRain >= 1) conditions.push('light rain')
  else if (maxRain > 0.1) conditions.push('a little rain')
  if (maxWind >= 28) conditions.push('strong crosswinds')
  else if (maxWind >= 15) conditions.push('breezy crosswinds')
  if (minVisibility != null && minVisibility < 2) conditions.push('low visibility')
  else if (minVisibility != null && minVisibility < 6) conditions.push('reduced visibility')
  const outlook = candidate.level === 'higher' ? 'Rough weather on part of this drive' : candidate.level === 'caution' ? 'Mostly manageable, with a few cautions' : candidate.level === 'unknown' ? 'Only part of this drive has a forecast' : 'A mostly calm drive'
  const listed = conditions.length <= 1 ? conditions[0] : conditions.length === 2 ? `${conditions[0]} and ${conditions[1]}` : `${conditions.slice(0, -1).join(', ')}, and ${conditions.at(-1)}`
  const weather = conditions.length === 0 ? 'no notable rain, crosswind, or visibility problems' : `expect ${listed}`
  const temperature = !temps.length ? '' : Math.min(...temps) === Math.max(...temps) ? `, around ${fahrenheit(temps[0])}°F` : `, ${fahrenheit(Math.min(...temps))}–${fahrenheit(Math.max(...temps))}°F`
  const exposure = candidate.higherMinutes > 0 ? ` Higher exposure lasts about ${Math.round(candidate.higherMinutes)} minutes.` : ''
  const when = candidate.departure ? `Leave at ${clock(candidate.departure, timeZone)}${candidate.arrival ? `, arrive around ${clock(candidate.arrival, timeZone)}` : ''}. ` : ''
  return `${when}${outlook}: ${weather}${temperature}.${exposure}${worstStretch(candidate, route, timeZone)}${compareToRecommended(candidate, recommended, timeZone)}`
}

export default function TripPlanner({ session, onAccount, onLogout: _onLogout, vehicle }) {
  const [form, setForm] = useState(defaults)
  const [analysis, setAnalysis] = useState(null)
  const [routeId, setRouteId] = useState(null)
  const [departureIndex, setDepartureIndex] = useState(0)
  const [_selectedPoint, setSelectedPoint] = useState(3)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [_routingProvider, setRoutingProvider] = useState('OSRM')
  const [fuelPrices, setFuelPrices] = useState(null)
  const [stopPlan, setStopPlan] = useState(null)
  const [stopVisibility, setStopVisibility] = useState({ plan: null, hidden: [] })
  const visibilityRef = useRef(stopVisibility)
  useEffect(() => { visibilityRef.current = stopVisibility }, [stopVisibility])
  const [mapFocus, setMapFocus] = useState({ stopIndex: null, venueId: null, sequence: 0 })
  const [nearbyPlaces, setNearbyPlaces] = useState([])
  const [pinnedVenue, setPinnedVenue] = useState(null)
  const [checkpointStatus, setCheckpointStatus] = useState('')
  const focusRef = useRef(mapFocus)
  const pinRequest = useRef(0)
  useEffect(() => { focusRef.current = mapFocus }, [mapFocus])
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
    fetch('/api/trips/config', { signal: controller.signal }).then(response => response.json()).then(data => {
      setRoutingProvider(data.routingProvider || 'OSRM')
      if (data.fuelPrices) setFuelPrices(data.fuelPrices)
    }).catch(() => {})
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

  function swapPlaces() {
    setForm(current => ({
      ...current,
      origin: current.destination, destination: current.origin,
      originPlace: current.destinationPlace, destinationPlace: current.originPlace,
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
  const minLeave = toWallInput(new Date(mountTime - 10 * 60000))
  const maxLeave = toWallInput(new Date(mountTime + 7 * 86400000 - Number(form.windowMinutes) * 60000))

  const route = analysis?.routes.find(item => item.id === routeId)
  const candidates = analysis?.candidates.filter(item => item.routeId === routeId) || []
  const candidate = candidates[departureIndex] || candidates[0]
  const activePlan = planMatchesSelection(stopPlan, analysis?.analysisId, candidate, route) ? stopPlan : null
  const hiddenStops = activePlan && stopVisibility.plan === activePlan ? stopVisibility.hidden : EMPTY_PLACES
  const displayCandidate = useMemo(() => candidateWithStops(candidate, activePlan), [candidate, activePlan])
  const mapPlaces = useMemo(() => {
    const otherPlaces = nearbyPlaces.filter(item => item.kind !== 'restaurant' && !item.pinned && item.id !== pinnedVenue?.id)
    return pinnedVenue ? [...otherPlaces, pinnedVenue] : otherPlaces
  }, [nearbyPlaces, pinnedVenue])
  const weatherSource = analysis?.sources.find(source => source.model)
  const coverageComplete = displayCandidate?.complete

  const recommended = analysis?.candidates.find(item => item.id === analysis.recommendation?.candidateId)
  const fuel = driveFuel(route, vehicle, fuelPrices)

  const selectMapStop = useCallback((index, venueId = null) => {
    if (venueId == null && focusRef.current.stopIndex !== index) setNearbyPlaces([])
    const next = { stopIndex: index, venueId, sequence: focusRef.current.sequence + 1 }
    focusRef.current = next
    setMapFocus(next)
  }, [])
  const revealMap = useCallback(() => mapRegion.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), [])
  const applyPlan = useCallback(plan => {
    if (plan === null) {
      setStopPlan(null); setNearbyPlaces([]); setPinnedVenue(null); selectMapStop(null)
      return
    }
    if (!planMatchesSelection(plan, analysis?.analysisId, candidate, route)) return
    const hidden = visibilityRef.current.plan === plan ? visibilityRef.current.hidden : []
    setStopVisibility({ plan, hidden })
    setStopPlan(plan); setNearbyPlaces([]); setPinnedVenue(null)
    const first = plan.stops.findIndex((_, index) => !hidden.includes(index))
    selectMapStop(first >= 0 ? first : null)
    if (plan.stops.length) requestAnimationFrame(revealMap)
  }, [analysis?.analysisId, candidate, route, selectMapStop, revealMap])
  const showPlanStop = useCallback((plan, index) => {
    applyPlan(plan)
    setStopVisibility(current => ({ plan, hidden: current.plan === plan ? current.hidden.filter(item => item !== index) : [] }))
    selectMapStop(index)
    requestAnimationFrame(revealMap)
  }, [applyPlan, selectMapStop, revealMap])
  const showRestaurant = useCallback((plan, stopIndex, place) => {
    if (!place?.id || !place.name) return
    const requestId = ++pinRequest.current
    setCheckpointStatus(`Locating ${place.name} with Google Geocoding…`)
    geocodeCheckpoint(place).then(located => {
      if (requestId !== pinRequest.current) return
      const marker = { ...place, ...located, stopIndex, kind: place.kind || 'restaurant', pinned: true, geocoded: true }
      if (plan && stopPlan !== plan) applyPlan(plan)
      const next = { stopIndex, venueId: marker.id, sequence: focusRef.current.sequence + 1 }
      focusRef.current = next
      setMapFocus(next)
      setPinnedVenue(marker)
      setNearbyPlaces(current => current.some(item => item.id === marker.id) ? current.map(item => item.id === marker.id ? marker : item) : [...current, marker])
      setCheckpointStatus('')
      requestAnimationFrame(revealMap)
    }).catch(() => {
      if (requestId !== pinRequest.current) return
      setCheckpointStatus(`Google Geocoding could not locate ${place.name}. The stop is still on the map.`)
    })
  }, [applyPlan, revealMap, stopPlan])
  const [addedStops, setAddedStops] = useState([])
  const addStop = useCallback((plan, stopIndex, place = null) => {
    const stop = plan?.stops?.[stopIndex]
    if (!stop) return
    const key = `${plan.analysisId}:${plan.candidateId}:${stop.checkpointIndex}`
    setAddedStops(current => {
      const existing = current.find(entry => entry.key === key)
      const places = place ? { ...existing?.places, [place.kind || 'restaurant']: place } : existing?.places || {}
      const entry = { key, plan, stopIndex, stop, places, place: place || existing?.place || null }
      return existing ? current.map(item => item.key === key ? entry : item) : [...current, entry]
    })
  }, [])
  const visibleAddedStops = addedStops.filter(entry => planMatchesSelection(entry.plan, analysis?.analysisId, candidate, route))

  return (
    <div className="planner-app">
      {/* Editorial Hero Stage */}
      <header className="hero-stage">
        <div className="sr-only">
          <div className="hero-kicker">OHIO HIGHWAY WEATHER CORRIDORS</div>
          <h1 className="hero-headline">
            Know when the road <em>clears</em>.
          </h1>
          <p className="hero-sub">Type any starting point and destination. Forecasts follow the drive.</p>
        </div>

        {/* Clean Integrated Trip Capsule Form */}
        <form onSubmit={submit} className="trip-capsule-form">
          <div className="capsule-locations">
            <PlaceField hint="From" marker="origin" value={form.origin} disabled={busy} onText={text => editPlace('origin', text)} onPlace={place => choosePlace('origin', place)} />
            <button type="button" className="capsule-swap" disabled={busy} onClick={swapPlaces} aria-label="Swap starting point and destination" title="Swap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" />
              </svg>
            </button>
            <PlaceField hint="To" marker="destination" value={form.destination} disabled={busy} onText={text => editPlace('destination', text)} onPlace={place => choosePlace('destination', place)} />
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
              <div className="capsule-window-head">
                <span className="field-hint">Before & after</span>
                <span className="window-size" aria-hidden="true">
                  <strong>{form.windowMinutes ? `±${windowLabel(form.windowMinutes)}` : 'Exact'}</strong>
                  <span className="window-range">{describeRange(form.leave, form.windowMinutes)}</span>
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="15"
                value={form.windowMinutes}
                disabled={busy}
                style={{ '--fill': `${(form.windowMinutes / 360) * 100}%` }}
                aria-label="Departure window slider"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={form.windowMinutes}
                aria-valuetext={form.windowMinutes ? `${windowLabel(form.windowMinutes)} before and after` : 'Exact leave time'}
                onChange={event => update('windowMinutes', Number(event.target.value))}
              />
            </div>
          </div>

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

      {/* 3-Board Dashboard Grid */}
      <main id="main" className="main-stage-container">
        <div className="dashboard-grid">
          {/* Left Board: Main Map, Metrics, Scrubber */}
          <section className="unified-bone-card left-map-board" aria-busy={busy} aria-label="Main route map and departure analysis">
            {/* Card Topbar */}
            <div className="bone-card-header">
              <div className="route-spec-heading">
                <h2>{analysis ? <>{analysis.origin.name.split(',')[0]} <span className="route-arrow">→</span> {analysis.destination.name.split(',')[0]}</> : 'Explore the road ahead'}</h2>
                <p>{route ? `${miles(route.distanceMeters)} miles · ${duration(route.durationSeconds)} travel time` : 'Select endpoints and evaluate arrival weather'}</p>
              </div>
            </div>

            {analysis && displayCandidate && (
              <div className="bone-top-briefing">
                <div className="top-rec-column">
                  {recommended ? (
                    <div className="bone-rec-bar">
                      <span className="rec-star-quiet" aria-hidden="true">★</span>
                      <div className="rec-bar-content">
                        <span className="rec-kicker">RECOMMENDED DEPARTURE WINDOW</span>
                        <h4>Leave around {clock(recommended.departure, analysis?.timeZone)} ET for best corridor weather</h4>
                      </div>
                    </div>
                  ) : (
                    <div className="bone-rec-notice">
                      <p className="analysis-notice" role="status">
                        {analysis.recommendation?.reason || 'No complete forecast comparison is available.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {analysis?.routingNotice && <p className="analysis-notice" role="status">{analysis.routingNotice}</p>}
            {analysis && !coverageComplete && <p className="analysis-coverage partial" role="status">Forecast coverage{activePlan ? ' with breaks' : ''}: Partial · {Math.round(displayCandidate?.unknownMinutes || 0)} driving minutes unknown. {weatherSource?.note}</p>}

            {/* Compared Alternatives */}
            {analysis?.routes?.length > 1 && (
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
                hiddenStops={hiddenStops}
                focus={activePlan ? mapFocus : EMPTY_FOCUS}
                onStopSelect={selectMapStop}
                places={activePlan ? mapPlaces : EMPTY_PLACES}
                timeZone={analysis?.timeZone}
                onSelect={setSelectedPoint}
                originPlace={analysis?.origin || form.originPlace}
                destinationPlace={analysis?.destination || form.destinationPlace}
              />
              {checkpointStatus && <p className="analysis-notice" role="status">{checkpointStatus}</p>}
            </div>

            {/* Quick Metrics Bar */}
            <div className="bone-trip-metrics">
              <Metric label="Travel Duration">{route ? duration(route.durationSeconds) : '—'}</Metric>
              <Metric label={activePlan ? 'Arrival with breaks · before detours' : 'Estimated Arrival'}>
                {displayCandidate?.arrival ? `${clock(displayCandidate.arrival, analysis?.timeZone)} ET` : '—'}
              </Metric>
              <Metric label="Higher Exposure">
                {displayCandidate ? (displayCandidate.higherMinutes > 0 ? `${displayCandidate.higherMinutes} min` : '0 min') : '—'}
              </Metric>
              <Metric label="Peak Condition">
                {displayCandidate?.level && LEVELS[displayCandidate.level] ? LEVELS[displayCandidate.level].label : '—'}
              </Metric>
              <Metric label="Expected fuel" note={fuel ? `${fuel.mpg} highway MPG` : ''}>
                {fuel ? `${fuel.gallons.toFixed(1)} gal` : '—'}
              </Metric>
              {fuel?.cost != null && (
                <Metric label="Expected gas cost" note={fuel.quote ? `${fuel.quote.area} avg $${fuel.quote.dollarsPerGallon.toFixed(3)}/gal` : ''}>
                  {dollars(fuel.cost)}
                </Metric>
              )}
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
              {analysis && displayCandidate && (
                <div className="top-drive-summary scrubber-drive-summary" aria-live="polite">
                  <span className="mini-label">ALONG THIS DRIVE · LEAVING {clock(displayCandidate.departure, analysis.timeZone)} ET</span>
                  <p className="top-drive-weather-copy">{summarizeDrive(displayCandidate, analysis.timeZone, route, recommended)}</p>
                </div>
              )}
            </div>
          </section>

          {/* Right Column Stack */}
          <div className="right-boards-stack">
            {/* Top-Right Board: Journey Agent */}
            <section className="unified-bone-card right-agent-board" aria-label="Journey agent">
              {analysis && candidate ? (
                <JourneyAgent
                  analysis={analysis}
                  candidate={candidate}
                  session={session}
                  vehicle={vehicle}
                  route={route}
                  onAccount={onAccount}
                  onApply={applyPlan}
                  onShowStop={showPlanStop}
                  onShowRestaurant={showRestaurant}
                  onAddStop={addStop}
                  appliedPlan={activePlan}
                  focusedVenueId={mapFocus.venueId}
                />
              ) : (
                <div className="journey-agent">
                  <div className="journey-heading">
                    <div>
                      <span className="journey-kicker">YOUR JOURNEY, WITH CONTEXT</span>
                      <h3>Ask the road ahead.</h3>
                      <p>Analyze a route to ask questions about your departure's forecast, computed stop options, and cited travel guidance.</p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {analysis && candidate && (
              <section className="unified-bone-card" aria-label="Added stops">
                <AddedStops
                  entries={visibleAddedStops}
                  timeZone={analysis.timeZone}
                  onShow={entry => entry.place ? showRestaurant(entry.plan, entry.stopIndex, entry.place) : showPlanStop(entry.plan, entry.stopIndex)}
                  onRemove={key => setAddedStops(current => current.filter(entry => entry.key !== key))}
                  onClear={() => setAddedStops(current => current.filter(entry => !visibleAddedStops.includes(entry)))}
                />
              </section>
            )}
          </div>
        </div>
      </main>

      <footer className="planner-footer" role="contentinfo">
        <div className="planner-footer-inner">
          <div className="footer-masthead">
            <div className="footer-brand">
              <span className="footer-symbol" aria-hidden="true">w.</span>
              <span className="footer-brand-name">WeatherWay</span>
              <span className="footer-copyright">
                &copy; {CURRENT_YEAR} &middot; HackOHIO 2026 &middot; The Ohio State University
              </span>
            </div>
            <button
              type="button"
              className="footer-back-to-top"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <span>Back to top</span>
              <span className="back-arrow" aria-hidden="true">&uarr;</span>
            </button>
          </div>
          <p className="footer-disclaimer">
            WeatherWay is an experimental project. Forecast exposure along your route does not replace official DOT notices, highway patrol advisories, or emergency travel warnings.
          </p>
        </div>
      </footer>
    </div>
  )
}
