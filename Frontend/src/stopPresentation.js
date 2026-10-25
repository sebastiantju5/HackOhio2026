import { clock, day } from './format.js'
import { fuelPriceLabel } from './fuelPrices.js'

export function stopKind(stop) {
  return stop.fuel ? (stop.food ? 'Fuel + food break' : 'Fuel stop') : stop.food ? 'Food break' : 'Weather break'
}

// Keep original stop indices so hiding S1 never relabels S2 or changes timing.
export function visibleStopEntries(stops = [], hidden = []) {
  return stops.flatMap((stop, index) => hidden.includes(index) ? [] : [{ stop, index }])
}

export function stopLabel(stop, index, timeZone) {
  return `S${index + 1} · ${stopKind(stop)} · Mile ${stop.mile} · ${clock(stop.arrival, timeZone)} · ${stop.durationMinutes} min`
}

// Only display optimizer output for the exact route and departure being viewed.
export function planMatchesSelection(plan, analysisId, candidate, route) {
  if (!plan || !candidate || !route || plan.status !== 'planned' || plan.analysisId !== analysisId || plan.candidateId !== candidate.id || route.id !== candidate.routeId) return false
  if (!Array.isArray(plan.stops) || plan.checkpointConditions?.length !== route.checkpoints.length || plan.segmentLevels?.length !== route.segments.length) return false
  return plan.stops.every(stop => {
    const checkpoint = route.checkpoints[stop.checkpointIndex]
    return Number.isInteger(stop.checkpointIndex) && checkpoint && Array.isArray(stop.coordinates) && stop.coordinates.length === 2
      && stop.coordinates.every((value, axis) => Number.isFinite(value) && Math.abs(value - checkpoint.coordinates[axis]) < 0.00001)
      && Number.isFinite(stop.durationMinutes) && Number.isFinite(Date.parse(stop.arrival)) && Number.isFinite(Date.parse(stop.resume))
  })
}

export function journeyPlans(turn) {
  const options = [turn.plan, ...(turn.planOptions || [])].filter(Boolean)
  return options.filter((plan, index) => index === options.findIndex(other => other.journeyPlanId === plan.journeyPlanId))
}

// DOM text nodes keep place names and reasons out of HTML interpolation.
export function stopPopup(stop, index, timeZone) {
  const element = document.createElement('div')
  element.className = 'route-stop-popup'
  const heading = document.createElement('strong')
  heading.textContent = `S${index + 1} · ${stopKind(stop)}`
  const timing = document.createElement('p')
  timing.textContent = `${day(stop.arrival, timeZone)} · ${clock(stop.arrival, timeZone)}–${clock(stop.resume, timeZone)} · ${stop.durationMinutes} min`
  const detail = document.createElement('p')
  detail.textContent = `Mile ${stop.mile}. ${stop.reason}`
  element.append(heading, timing, detail)
  return element
}

export function venuePopup(place, onClose) {
  const element = document.createElement('div')
  if (place.kind === 'restaurant' || place.pinned) {
    element.className = 'checkpoint-bubble'
    const address = document.createElement('span')
    address.textContent = place.name || place.address
    const close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', () => onClose?.())
    element.append(address, close)
    return element
  }
  element.className = 'route-stop-popup'
  const title = document.createElement('strong')
  title.textContent = `Nearby option · ${place.name}`
  const address = document.createElement('p')
  address.textContent = place.address
  const note = document.createElement('p')
  note.textContent = 'Verify road access and hours. Detours are not included in this stop plan.'
  element.append(title, address, note)
  if (Object.hasOwn(place, 'fuelPrice')) {
    const price = document.createElement('p')
    price.textContent = `${fuelPriceLabel(place)}${place.fuelPrice ? ` · Updated ${new Date(place.fuelPrice.updatedAt).toLocaleString()}` : ''} · Google Maps`
    element.append(price)
  }
  return element
}
