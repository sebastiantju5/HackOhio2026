import test from 'node:test'
import assert from 'node:assert/strict'
import { compactRoute } from './routeGeometry.js'

test('compacting Google geometry retains endpoints and scales cumulative step timing', () => {
  const route = compactRoute([
    { path: [[-83, 40], [-82.9, 40], [-82.8, 40]], seconds: 600 },
    { path: [[-82.8, 40], [-82, 40]], seconds: 1800 },
  ], 3000, 100000, 3)
  assert.deepEqual(route.coordinates, [[-83, 40], [-82.8, 40], [-82, 40]])
  assert.deepEqual(route.durations, [750, 2250])
  assert.equal(route.distanceMeters, 100000)
})

test('two compact routes fit within the existing 16 KB request body limit', () => {
  const path = Array.from({ length: 4000 }, (_, i) => [-179.99877 + i / 100000, -79.99877 + i / 100000])
  const route = compactRoute([{ path, seconds: 14400 }], 14400, 200000)
  assert.equal(route.coordinates.length, 140)
  const body = JSON.stringify({ googleRoutes: [route, route], origin: { name: 'Origin', coordinates: path[0] },
    destination: { name: 'Destination', coordinates: path.at(-1) }, departureStart: '2026-10-24T21:00:00Z', departureEnd: '2026-10-24T23:00:00Z' })
  assert.ok(Buffer.byteLength(body) < 16 * 1024)
  assert.ok(Math.abs(route.durations.reduce((a, b) => a + b) - 14400) < 1)
})
