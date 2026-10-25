import test from 'node:test'
import assert from 'node:assert/strict'
import { compareFuelStations, defaultFuelGrade, fuelPriceLabel, reportedFuelPrice, PRICE_MAX_AGE_MS } from './fuelPrices.js'
import { findStopFuelPrices } from './googleMaps.js'

const now = Date.parse('2026-10-25T03:00:00Z')
const quote = (units, nanos = 0, overrides = {}) => ({ type: 'REGULAR_UNLEADED',
  price: { units, nanos, currencyCode: 'USD' }, updateTime: new Date(now - 3600000), ...overrides })

test('price comparison uses exact grade, currency and freshness without treating missing prices as zero', () => {
  const stations = [{ id: 'unknown' }, { id: 'premium', fuelPrices: [quote(1, 0, { type: 'PREMIUM' })] },
    { id: 'expensive', fuelPrices: [quote(4, 500000000)] }, { id: 'cheap', fuelPrices: [quote('3', 199000000)] },
    { id: 'stale', fuelPrices: [quote(1, 0, { updateTime: new Date(now - PRICE_MAX_AGE_MS - 1) })] },
    { id: 'CAD', fuelPrices: [quote(1, 0, { price: { units: 1, currencyCode: 'CAD' } })] }]
  const result = compareFuelStations(stations, 'REGULAR_UNLEADED', now)
  assert.deepEqual(result.slice(0, 2).map(item => item.id), ['cheap', 'expensive'])
  assert.equal(result[0].fuelPrice.amount, 3.199)
  assert.match(fuelPriceLabel(result[0]), /\$3\.199/)
  assert.match(fuelPriceLabel(result.find(item => item.id === 'stale')), /Stale/)
  assert.match(fuelPriceLabel(result.find(item => item.id === 'unknown')), /unavailable/)
  assert.equal(stations[0].fuelPrice, undefined)
})

test('invalid or future-dated prices never become cheap recommendations', () => {
  for (const bad of [quote(0), quote(-3), quote(NaN), quote(null), quote(''), quote(3, -1), quote(3, 1e9),
    quote(3, 0, { updateTime: 'unknown' }), quote(3, 0, { updateTime: new Date(now + 3600000) })]) {
    assert.equal(reportedFuelPrice([bad], 'REGULAR_UNLEADED', now), null)
  }
  const selected = reportedFuelPrice([quote(2), quote(4, 0, { updateTime: new Date(now - 1800000) })], 'REGULAR_UNLEADED', now)
  assert.equal(selected.amount, 4, 'use the latest quote rather than an obsolete lower price')
})

test('saved fuel specification selects grade without substituting regular for premium or diesel', () => {
  assert.equal(defaultFuelGrade({ fuelType: 'Premium Gasoline' }), 'PREMIUM')
  assert.equal(defaultFuelGrade({ fuelType: 'Diesel' }), 'DIESEL')
  assert.equal(defaultFuelGrade(null), 'REGULAR_UNLEADED')
})

test('tied quotes retain their provider order and carry no fabricated savings', () => {
  const results = compareFuelStations([{ id: 'nearest', fuelPrices: [quote(4, 500000000)] },
    { id: 'next', fuelPrices: [quote(4, 500000000)] }], 'REGULAR_UNLEADED', now)
  assert.deepEqual(results.map(place => place.id), ['nearest', 'next'])
  assert.equal(results[0].fuelPrice.amount, results[1].fuelPrice.amount)
  assert.equal(results[0].savings, undefined)
})

test('Google price lookup is bounded around the planned stop and requests actual fuel fields', async () => {
  let requested
  const google = { maps: { importLibrary: async () => ({ SearchNearbyRankPreference: { DISTANCE: 'distance' },
    Place: { searchNearby: async options => { requested = options; return { places: [{ id: 'station', displayName: 'Station',
      formattedAddress: 'Address', location: { lng: () => -83, lat: () => 40 }, fuelOptions: { fuelPrices: [quote(3)] } }] } } } }) } }
  const results = await findStopFuelPrices({ coordinates: [-83, 40] }, 'REGULAR_UNLEADED', google)
  assert.ok(requested.fields.includes('fuelOptions'))
  assert.equal(requested.maxResultCount, 10)
  assert.equal(requested.locationRestriction.radius, 1500)
  assert.deepEqual(requested.locationRestriction.center, { lat: 40, lng: -83 })
  assert.deepEqual(results[0].coordinates, [-83, 40])
})
