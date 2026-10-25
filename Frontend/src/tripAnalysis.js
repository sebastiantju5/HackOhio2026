import { fromWallInput } from './format.js'

export function departureRange(leave, minutes) {
  const center = new Date(fromWallInput(leave)).getTime()
  return { start: new Date(center - minutes * 60000).toISOString(), end: new Date(center + minutes * 60000).toISOString() }
}

export async function analyzeTrip(form, { signal, mapsAvailable, getRoutes, fetchImpl = fetch, timeZone }) {
  if (!form.originPlace?.coordinates || !form.destinationPlace?.coordinates) {
    throw new Error('Choose a starting point and a destination.')
  }
  const range = departureRange(form.leave, Number(form.windowMinutes))
  let googleRoutes, routingFallback = false
  if (form.mode === 'live' && mapsAvailable) {
    try {
      // Route at the first departure being compared, using the new leave input.
      googleRoutes = await getRoutes(form, range.start)
    } catch (error) {
      if (error.name === 'AbortError') throw error
      routingFallback = true
    }
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const response = await fetchImpl('/api/trips/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ origin: form.originPlace, destination: form.destinationPlace,
      departureStart: range.start, departureEnd: range.end, timeZone,
      includeAlternatives: form.alternatives, dataMode: form.mode, googleRoutes }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'The planner is unavailable. Check that the Flask backend is running on port 5001.')
  if (!data.routes?.length || !data.candidates?.length) throw new Error('The server returned no usable route comparisons.')
  return { ...data, routingNotice: routingFallback
    ? `Google routing was unavailable. This analysis uses ${data.routes[0].provider || 'the fallback routing provider'}.` : null }
}

export function candidateWithStops(candidate, plan) {
  if (!plan) return candidate
  return { ...candidate, arrival: plan.arrival, higherMinutes: plan.higherMinutes,
    level: plan.level, worstSeverity: plan.worstSeverity, complete: plan.complete,
    unknownMinutes: plan.unknownMinutes, weightedExposure: plan.weightedExposure,
    checkpoints: plan.checkpointConditions, segmentLevels: plan.segmentLevels }
}
