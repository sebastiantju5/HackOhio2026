import test from 'node:test'
import assert from 'node:assert/strict'
import { journeyPlans, planMatchesSelection, stopKind, stopLabel, visibleStopEntries } from './stopPresentation.js'

const route = { id: 'route', checkpoints: [{ coordinates: [-83, 40] }, { coordinates: [-82, 41] }], segments: [{}] }
const candidate = { id: 'departure', routeId: 'route' }
const plan = { status: 'planned', analysisId: 'analysis', candidateId: 'departure', journeyPlanId: 'one',
  checkpointConditions: [{}, {}], segmentLevels: ['lower'], stops: [{ checkpointIndex: 0, coordinates: [-83, 40],
    arrival: '2026-10-25T03:00:00Z', resume: '2026-10-25T03:30:00Z', durationMinutes: 30, mile: 0, fuel: true, food: false }] }

test('hiding a stop keeps remaining pin identities and optimizer output unchanged', () => {
  const stops = [plan.stops[0], { ...plan.stops[0], mile: 100 }, { ...plan.stops[0], mile: 200 }]
  const original = structuredClone(stops)
  const visible = visibleStopEntries(stops, [0, 2])
  assert.deepEqual(visible.map(entry => entry.index), [1])
  assert.equal(visible[0].stop, stops[1])
  assert.match(stopLabel(visible[0].stop, visible[0].index, 'America/New_York'), /^S2/)
  assert.deepEqual(visibleStopEntries(stops, [0, 1, 2]), [])
  assert.deepEqual(visibleStopEntries(stops, []).map(entry => entry.index), [0, 1, 2])
  assert.deepEqual(stops, original)
})

test('map accepts the exact optimizer stop coordinates for the selected route and departure', () => {
  assert.equal(planMatchesSelection(plan, 'analysis', candidate, route), true)
  assert.equal(planMatchesSelection({ ...plan, analysisId: 'old' }, 'analysis', candidate, route), false)
  assert.equal(planMatchesSelection(plan, 'analysis', { ...candidate, id: 'another-departure' }, route), false)
  assert.equal(planMatchesSelection(plan, 'analysis', candidate, { ...route, id: 'another-route' }), false)
})

test('map rejects fabricated, invalid or mismatched stop geometry and exposure arrays', () => {
  for (const changes of [{ checkpointIndex: 5 }, { coordinates: [-90, 35] }, { coordinates: [NaN, 40] }, { coordinates: null }, { arrival: 'invalid' }]) {
    assert.equal(planMatchesSelection({ ...plan, stops: [{ ...plan.stops[0], ...changes }] }, 'analysis', candidate, route), false)
  }
  assert.equal(planMatchesSelection({ ...plan, segmentLevels: [] }, 'analysis', candidate, route), false)
  assert.equal(planMatchesSelection(plan, 'analysis', candidate, null), false)
})

test('all computed agent options remain available even when the model omits its selected plan reference', () => {
  const second = { ...plan, journeyPlanId: 'two' }
  assert.deepEqual(journeyPlans({ plan: null, planOptions: [plan, second] }), [plan, second])
  assert.deepEqual(journeyPlans({ plan, planOptions: [plan, second] }), [plan, second])
  assert.deepEqual(journeyPlans({ plan: null }), [])
})

test('stop labels consistently identify fuel, food and weather breaks with local timing', () => {
  assert.equal(stopKind(plan.stops[0]), 'Fuel stop')
  assert.equal(stopKind({ fuel: true, food: true }), 'Fuel + food break')
  assert.equal(stopKind({ food: true }), 'Food break')
  assert.equal(stopKind({}), 'Weather break')
  assert.match(stopLabel(plan.stops[0], 0, 'America/New_York'), /S1 · Fuel stop · Mile 0 · 11:00 PM · 30 min/)
})
