import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeTrip, candidateWithStops, departureRange } from './tripAnalysis.js'
import { getGoogleRoutes } from './googleMaps.js'

const form = { mode: 'live', leave: '2026-10-27T12:00', windowMinutes: 60, alternatives: true,
  originPlace: { name: 'Columbus', coordinates: [-83, 40] }, destinationPlace: { name: 'Cleveland', coordinates: [-82, 41] } }
const analysis = { analysisId: 'test', dataMode: 'live', routes: [{ id: 'one', provider: 'OSRM' }], candidates: [{ id: 'd0' }] }
const signal = () => new AbortController().signal

test('new leave input produces a symmetric departure window in Eastern time', () => {
  assert.deepEqual(departureRange(form.leave, form.windowMinutes), { start: '2026-10-27T15:00:00.000Z', end: '2026-10-27T17:00:00.000Z' })
})

test('Google receives the earliest compared departure and its route reaches the server', async () => {
  const routes = [{ coordinates: [[-83, 40], [-82, 41]], durations: [1000], distanceMeters: 150000 }]
  let payload
  const result = await analyzeTrip(form, { signal: signal(), mapsAvailable: true, timeZone: 'America/New_York',
    getRoutes: async (input, departure) => { assert.equal(input.leave, form.leave); assert.equal(departure, '2026-10-27T15:00:00.000Z'); return routes },
    fetchImpl: async (_, request) => { payload = JSON.parse(request.body); return { ok: true, json: async () => analysis } } })
  assert.deepEqual(payload.googleRoutes, routes)
  assert.equal(payload.departureStart, '2026-10-27T15:00:00.000Z')
  assert.equal(result.routingNotice, null)
})

test('Google SDK adapter uses the explicit departure without the removed form.start field', async () => {
  let request
  const google = { maps: { importLibrary: async () => ({ Route: { computeRoutes: async input => {
    request = input
    return { routes: [{ legs: [{ steps: [{ path: [{ lng: -83, lat: 40 }, { lng: -82, lat: 41 }], staticDurationMillis: 1000000 }] }], durationMillis: 1200000, distanceMeters: 150000 }] }
  } } }) } }
  const routes = await getGoogleRoutes(form, '2026-10-27T15:00:00.000Z', google)
  assert.equal(request.departureTime.toISOString(), '2026-10-27T15:00:00.000Z')
  assert.equal(routes[0].durations[0], 1200)
  await assert.rejects(getGoogleRoutes(form, undefined, google), /valid route departure/)
})

test('a routing failure reports the actual fallback provider without pretending Google succeeded', async () => {
  let payload
  const result = await analyzeTrip(form, { signal: signal(), mapsAvailable: true,
    getRoutes: async () => { throw new Error('provider unavailable') },
    fetchImpl: async (_, request) => { payload = JSON.parse(request.body); return { ok: true, json: async () => analysis } } })
  assert.equal(payload.googleRoutes, undefined)
  assert.match(result.routingNotice, /Google routing was unavailable.*OSRM/)
})

test('simulation keeps its provenance and never calls Google routing', async () => {
  const result = await analyzeTrip({ ...form, mode: 'demo' }, { signal: signal(), mapsAvailable: true,
    getRoutes: async () => { assert.fail('simulation must not call Google') },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...analysis, dataMode: 'demo' }) }) })
  assert.equal(result.dataMode, 'demo')
  assert.equal(result.routingNotice, null)
})

test('aborted analysis does not fall back or submit another request', async () => {
  await assert.rejects(analyzeTrip(form, { signal: signal(), mapsAvailable: true,
    getRoutes: async () => { throw new DOMException('Aborted', 'AbortError') },
    fetchImpl: async () => { assert.fail('an aborted route must not submit analysis') } }), { name: 'AbortError' })
})

test('previewing stops updates peak, coverage and exposure together without changing the baseline', () => {
  const baseline = { id: 'one', level: 'higher', worstSeverity: 2, higherMinutes: 75, complete: true }
  const plan = { arrival: '2026-10-27T19:00:00Z', level: 'caution', worstSeverity: 1, higherMinutes: 0,
    unknownMinutes: 0, complete: true, checkpointConditions: [{ level: 'caution' }], segmentLevels: ['caution'] }
  const preview = candidateWithStops(baseline, plan)
  assert.equal(preview.level, 'caution')
  assert.equal(preview.worstSeverity, 1)
  assert.equal(preview.higherMinutes, 0)
  assert.equal(preview.complete, true)
  assert.deepEqual(preview.checkpoints, plan.checkpointConditions)
  assert.equal(baseline.level, 'higher')
  assert.equal(candidateWithStops(baseline, null), baseline)
  assert.equal(candidateWithStops(baseline, { ...plan, complete: false, level: 'unknown', unknownMinutes: 30 }).level, 'unknown')
})
