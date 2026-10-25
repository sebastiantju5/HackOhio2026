import { useEffect, useRef, useState } from 'react'
import { clock, duration } from './format.js'
import { findStopPlaces, mapsKey } from './googleMaps.js'
import './StopPlanner.css'

function StopCard({ stop, index, demo, timeZone, onSelect }) {
  const [places, setPlaces] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const kind = stop.fuel ? (stop.food ? 'Fuel + food break' : 'Fuel stop') : stop.food ? 'Food break' : 'Weather break'
  const searchUrl = type => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${type} near ${stop.coordinates[1]},${stop.coordinates[0]}`)}`
  async function search(fuel) {
    setBusy(true); setError('')
    try {
      const found = await findStopPlaces(stop, fuel)
      if (alive.current) { setPlaces(found); if (!found.length) setError('No matching venues within 1.5 km. Try the map search or choose a different break.') }
    } catch { if (alive.current) setError('Nearby search is unavailable. Enable Places API (New), or use the map search link.') }
    finally { if (alive.current) setBusy(false) }
  }
  return <article className="stop-card">
    <div className="stop-card-heading"><span className="stop-order">{index + 1}</span><div><h4>{kind}</h4><span>Mile {stop.mile} · near checkpoint {stop.checkpointIndex + 1}</span></div><button type="button" onClick={() => onSelect(stop.checkpointIndex)}>View on map ↑</button></div>
    <div className="stop-times"><strong>{clock(stop.arrival, timeZone)} → {clock(stop.resume, timeZone)}</strong><span>{stop.durationMinutes} min break</span></div>
    <p>{stop.reason}</p>
    <p className="stop-fineprint">Arrival: {stop.arrivalLevel} exposure. {demo ? 'Illustrative search area on the simulated route.' : 'Search area within 1.5 km. Verify road access, fuel type, hours and indoor seating.'}</p>
    <div className="stop-place-actions">
      {!demo && mapsKey() && <button type="button" disabled={busy} onClick={() => search(stop.fuel)}>{busy ? 'Finding places…' : `Find nearby ${stop.fuel ? 'gas' : 'food'}`}</button>}
      {!demo && mapsKey() && stop.fuel && stop.food && <button type="button" disabled={busy} onClick={() => search(false)}>Find food separately</button>}
      <a href={searchUrl(stop.fuel ? 'gas stations' : 'restaurants')} target="_blank" rel="noreferrer">Search Google Maps ↗</a>
    </div>
    {error && <p role="status">{error}</p>}
    {places?.length > 0 && <div className="stop-venues"><small>Google Maps · nearby places, detours & opening hours unverified</small>{places.map(place => <a key={place.id} href={place.url || searchUrl(place.name)} target="_blank" rel="noreferrer"><strong>{place.name} ↗</strong><span>{place.address}</span></a>)}</div>}
  </article>
}

export default function StopPlanner({ analysis, candidate, vehicle, vehicleError, vehicleReady, session, onAccount, onApply, applied, onSelect }) {
  const [startingFuel, setStartingFuel] = useState(75)
  const [includeFood, setIncludeFood] = useState(true)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)

  useEffect(() => {
    request.current?.abort(); setPlan(null); setError(''); setBusy(false); onApply?.(null)
    return () => request.current?.abort()
  }, [analysis?.analysisId, candidate?.id, vehicle, startingFuel, includeFood, onApply])

  if (!analysis || !candidate) return null

  async function generate() {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setPlan(null); onApply(null)
    try {
      const response = await fetch('/api/trips/stop-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ analysisId: analysis.analysisId, candidateId: candidate.id, vehicle,
          startingFuel: startingFuel / 100, includeFood }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not plan stops.')
      if (!controller.signal.aborted) setPlan(data)
    } catch (err) { if (err.name !== 'AbortError') setError(err.message) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="stop-planner" aria-labelledby="stops-title">
    <div className="stop-intro"><div><span className="stop-kicker">A LITTLE ROOM TO PAUSE</span><h3 id="stops-title">Make the weather your break.</h3><p>Compare fuel and food stops for your {clock(candidate.departure, analysis.timeZone)} departure.</p></div><button className="stop-text-button" type="button" onClick={onAccount}>{vehicle ? 'Edit your car ↗' : session ? 'Add your car ↗' : 'Sign in & add a car ↗'}</button></div>
    <div className="stop-controls">
      <div className="stop-vehicle"><strong>{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Weather & food breaks'}</strong><span>{vehicle ? `${vehicle.mpg} highway MPG · ${vehicle.tankGallons} gal tank · ${vehicle.mpgSource}` : 'Save a gasoline or diesel car to include fuel stops.'}</span>{vehicleError && <span role="status">{vehicleError}</span>}</div>
      {vehicle && <label className="stop-fuel-label">Starting tank <strong>{startingFuel}%</strong><input aria-label="Starting tank percentage" type="range" min="5" max="100" step="5" value={startingFuel} onChange={e => setStartingFuel(Number(e.target.value))} /></label>}
      <label className="stop-food-check"><input type="checkbox" checked={includeFood} onChange={e => setIncludeFood(e.target.checked)} />Include a food break</label>
      <button className="stop-primary" type="button" disabled={busy || !vehicleReady} onClick={generate}>{busy ? 'Comparing stops…' : 'Plan my stops →'}</button>
    </div>
    {error && <p className="stop-error" role="alert">{error}</p>}
    {plan && <div className="stop-results" aria-live="polite">
      {plan.status === 'unreachable' ? <p className="stop-error">{plan.reason}</p> : <>
        <div className="stop-summary"><div><strong>{plan.weatherImproved ? (plan.higherMinutesAvoided > 0 ? `${plan.higherMinutesAvoided} fewer minutes of higher exposure` : 'Lower forecast exposure with a break') : plan.stops.length ? 'Your fuel & break plan' : 'Keep your current timing'}</strong><p>{plan.reason}</p></div>{plan.stops.length > 0 && <button className="stop-primary" type="button" onClick={() => onApply(applied ? null : plan)}>{applied ? 'Show drive without stops' : 'Preview breaks on map'}</button>}</div>
        <div className="stop-metrics"><div><span>Break time</span><strong>{duration(plan.totalStopMinutes * 60)}</strong></div><div><span>Arrival · before detours</span><strong>{clock(plan.arrival, analysis.timeZone)}</strong></div><div><span>Higher exposure</span><strong>{plan.baselineHigherMinutes} → {plan.higherMinutes} min</strong></div>{plan.fuel && <div><span>Estimated fuel used</span><strong>{plan.fuel.estimatedGallons} gal</strong></div>}</div>
        {plan.fuel && <p className="stop-fineprint">Planning at {plan.fuel.planningMpg} MPG · {plan.fuel.startingRangeMiles} mi available before reserve · estimated arrival tank {plan.fuel.arrivalTankPercent}%. {plan.fuel.note}</p>}
        {includeFood && !plan.mealIncluded && analysis.routes.find(route => route.id === candidate.routeId)?.durationSeconds >= 5400 && <p className="stop-fineprint">A food break did not fit the best exposure and fuel plan within the stop budget.</p>}
        {plan.stops.map((stop, index) => <StopCard key={`${candidate.id}-${stop.checkpointIndex}-${stop.durationMinutes}`} stop={stop} index={index} demo={analysis.dataMode === 'demo'} timeZone={analysis.timeZone} onSelect={() => onSelect(plan, index)} />)}
        {!plan.complete && <p className="stop-error">Forecast coverage is incomplete after these stops. No weather improvement is claimed.</p>}
        <details className="stop-assumptions"><summary>How break timing works</summary><p>Compares up to three stops and 90 minutes total waiting. Food breaks are considered on drives over 90 minutes. A wait is considered before a higher-exposure segment, at a checkpoint whose arrival exposure is below the higher threshold. All later forecast arrival times are shifted.</p><ul>{plan.assumptions.map(note => <li key={note}>{note}</li>)}</ul></details>
      </>}
    </div>}
  </section>
}
