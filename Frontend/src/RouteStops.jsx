import { useEffect, useRef, useState } from 'react'
import { clock, day } from './format.js'
import { findStopFuelPrices, findStopPlaces, mapsKey } from './googleMaps.js'
import { FUEL_GRADES, fuelPriceLabel } from './fuelPrices.js'
import { stopKind, stopLabel } from './stopPresentation.js'
import './RouteStops.css'

export default function RouteStops({ plan, route, dataMode, timeZone, focus, hiddenStops, onToggleStop, onSelect, onOverview, onClear, onPlaces, onVenueSelect }) {
  const selectedIndex = focus.stopIndex ?? plan.stops.findIndex((_, index) => !hiddenStops.includes(index))
  const stop = plan.stops[selectedIndex]
  const [places, setPlaces] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [priceComparison, setPriceComparison] = useState(null)
  const [gradeOverride, setGradeOverride] = useState(null)
  const grade = gradeOverride?.plan === plan ? gradeOverride.grade : plan.fuelSearch?.grade || 'REGULAR_UNLEADED'
  const request = useRef(0)
  useEffect(() => {
    const version = ++request.current
    setPlaces([]); setError(''); setBusy(false); setPriceComparison(null); onPlaces([])
    if (!stop?.food || !mapsKey()) return () => { request.current += 1 }
    setBusy(true)
    findStopPlaces(stop, false).then(found => {
      if (version !== request.current) return
      const valid = found.filter(place => place.coordinates?.length === 2 && place.coordinates.every(Number.isFinite)).map(place => ({ ...place, stopIndex: selectedIndex, kind: 'restaurant' }))
      setPlaces(valid); onPlaces(valid)
      if (!valid.length) setError('No restaurants were returned near this meal break. The stop area is still shown on the map.')
    }).catch(() => {
      if (version === request.current) setError('Restaurant search is unavailable. The meal stop remains on the map; nearby businesses and hours are unverified.')
    }).finally(() => { if (version === request.current) setBusy(false) })
    return () => { request.current += 1 }
  }, [plan, selectedIndex, onPlaces, stop])

  async function search(fuel, comparePrices = false) {
    const version = ++request.current
    setBusy(true); setError(''); setPlaces([]); setPriceComparison(null); onPlaces([])
    try {
      const found = comparePrices ? await findStopFuelPrices(stop, grade) : await findStopPlaces(stop, fuel)
      if (version !== request.current) return
      const valid = found.filter(place => place.coordinates?.length === 2 && place.coordinates.every(Number.isFinite)).map(place => ({ ...place, stopIndex: selectedIndex, kind: comparePrices || fuel ? 'fuel' : 'restaurant' }))
      setPlaces(valid); onPlaces(valid)
      if (comparePrices) {
        const quoted = valid.filter(place => place.fuelPrice?.recent)
        const lowest = quoted.length ? Math.min(...quoted.map(place => place.fuelPrice.amount)) : null
        setPriceComparison({ grade, priced: quoted.length, total: valid.length, lowest, lowestCount: quoted.filter(place => place.fuelPrice.amount === lowest).length })
      }
      if (!valid.length) setError('No nearby places were returned. The optimizer stop area is still shown on the map.')
    } catch { if (version === request.current) setError(comparePrices ? 'Gas price lookup is unavailable. Try Find nearby gas for stations without prices. No price or savings estimate is available.' : 'Nearby search is unavailable. The computed stop remains on the map; business access and hours are unverified.') }
    finally { if (version === request.current) setBusy(false) }
  }

  return <section className="route-stops" aria-labelledby="route-stops-title">
    <div className="route-stops-heading"><div><span className="route-stops-kicker">{plan.journeyPlanId ? 'JOURNEY AGENT PLAN' : 'STOP PLANNER'}</span><h3 id="route-stops-title">Your stops on this route</h3><p>{route.name} · {plan.stops.length} {plan.stops.length === 1 ? 'stop' : 'stops'} · {plan.totalStopMinutes} min of breaks · {dataMode === 'demo' ? 'Simulated stop areas' : 'Optimizer stop areas'}</p></div><div className="route-stops-actions"><button type="button" onClick={onOverview}>Show whole route</button><button type="button" onClick={onClear}>Hide stops</button></div></div>
    <p className="route-stop-note" role="status">{plan.stops.length - hiddenStops.length} of {plan.stops.length} stops visible on map. Hiding a pin keeps the stop in the computed itinerary; arrival times, fuel and weather estimates still include every stop.</p>
    <div className="route-stop-tabs" aria-label="Choose a recommended stop">{plan.stops.map((item, index) => <div className={`route-stop-choice ${hiddenStops.includes(index) ? 'is-hidden' : ''}`} key={`${item.checkpointIndex}-${index}`}><button disabled={hiddenStops.includes(index)} type="button" aria-pressed={focus.stopIndex === index} onClick={() => onSelect(index)} aria-label={`Show ${stopLabel(item, index, timeZone)} on map`}><span>S{index + 1}</span><strong>{stopKind(item)}</strong><small>Mile {item.mile} · {clock(item.arrival, timeZone)} · {item.durationMinutes} min{hiddenStops.includes(index) ? ' · Hidden on map' : ''}</small></button><button type="button" className="route-stop-toggle" onClick={() => onToggleStop(index)} aria-label={`${hiddenStops.includes(index) ? 'Show' : 'Hide'} stop S${index + 1} on map`}>{hiddenStops.includes(index) ? 'Show pin' : 'Hide pin'}</button></div>)}</div>
    {stop && <div className="route-stop-detail" aria-label={`Stop S${selectedIndex + 1} details`}>
      <h4>S{selectedIndex + 1} · {stopKind(stop)} at mile {stop.mile}</h4>
      <p><strong>{day(stop.arrival, timeZone)} · {clock(stop.arrival, timeZone)}–{clock(stop.resume, timeZone)}</strong> · {stop.durationMinutes} min · arrival exposure: {stop.arrivalLevel}</p>
      <p>{stop.reason}</p>
      <p className="route-stop-note">{plan.weatherImproved ? `${plan.higherMinutesAvoided} fewer higher-exposure driving minutes across the computed plan. ` : ''}Timing comes from the existing optimizer for this route and departure. {dataMode === 'demo' ? 'The location is illustrative.' : 'The pin marks the planned stop area.'} Venue detours and hours are not included.</p>
      <div className="route-stop-search">{dataMode !== 'demo' && mapsKey() && <><button type="button" disabled={busy} onClick={() => search(stop.fuel)}>{busy ? 'Finding nearby places…' : `Find nearby ${stop.fuel ? 'gas' : 'food'} on map`}</button>{stop.fuel && stop.food && <button type="button" disabled={busy} onClick={() => search(false)}>Find food options</button>}</>}<span>{stop.coordinates[1].toFixed(4)}, {stop.coordinates[0].toFixed(4)}</span></div>
      {stop.fuel && dataMode !== 'demo' && mapsKey() && <div className="route-fuel-comparison"><strong>{plan.fuelSearch?.preferCheaperGas ? 'Cheaper gas preference enabled' : 'Compare reported gas prices'}</strong><p>Up to 10 stations within 1.5 km of this stop. Same-grade USD quotes updated within 48 hours are ranked lowest first. Detour costs, access and hours are unverified; the route and fuel estimates stay unchanged.</p><label>Fuel grade<select aria-label="Stop comparison fuel grade" value={grade} disabled={busy} onChange={event => setGradeOverride({ plan, grade: event.target.value })}>{Object.entries(FUEL_GRADES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="button" disabled={busy} onClick={() => search(true, true)}>{busy ? 'Checking stations…' : 'Compare gas prices'}</button></div>}
      {stop.fuel && dataMode === 'demo' && plan.fuelSearch?.preferCheaperGas && <p>Gas-price comparison is available with Live forecast; simulated trips do not use real station prices.</p>}
      {stop.food && busy && <p role="status">Looking for restaurants near this meal break…</p>}
      {error && <p role="status">{error}</p>}
      {priceComparison && <p role="status" className="fuel-price-status">{priceComparison.priced >= 2 ? `${priceComparison.priced} recent ${FUEL_GRADES[priceComparison.grade]} quotes among ${priceComparison.total} returned stations; lowest reported price first.${priceComparison.lowestCount === priceComparison.priced ? ' All recent quotes are tied; no lower-priced option was identified.' : ''}` : priceComparison.priced === 1 ? 'Only one recent quote returned; there is not enough price data to identify a cheaper station.' : `No recent ${FUEL_GRADES[priceComparison.grade]} prices returned. Stations are not ranked by price.`} Reported pump prices may change; verify grade, price and unit at the station. Google Maps.</p>}
      {places.length > 0 && <div className="route-stop-places"><p>{stop.food && !priceComparison ? 'Restaurants near this meal break · Google Maps · hours and detours unverified' : 'Google Maps nearby options · blue V pins · access, suitability and hours unverified'}</p>{places.map((place, index) => <button type="button" key={place.id} aria-pressed={focus.venueId === place.id} onClick={event => { event.preventDefault(); event.stopPropagation(); onVenueSelect(place, selectedIndex) }}><span>V{index + 1}</span><strong>{place.name}</strong><small>{place.address}{priceComparison && <><br />{place.fuelPrice?.recent && place.fuelPrice.amount === priceComparison.lowest && priceComparison.priced >= 2 ? `${priceComparison.lowestCount > 1 ? 'Tied lowest' : 'Lowest'} reported price among these quotes · ` : ''}{fuelPriceLabel(place)}{place.fuelPrice && <><br />Updated {new Date(place.fuelPrice.updatedAt).toLocaleString()}</>}</>}</small></button>)}</div>}
    </div>}
  </section>
}
