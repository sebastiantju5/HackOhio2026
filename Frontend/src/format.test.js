import { strict as assert } from 'node:assert'
import test from 'node:test'
import { fromWallInput, toWallInput } from './format.js'

test('Eastern wall time converts without depending on the host time zone', () => {
  assert.equal(fromWallInput('2026-10-24T17:00'), '2026-10-24T21:00:00.000Z')
  assert.equal(fromWallInput('2026-12-24T17:00'), '2026-12-24T22:00:00.000Z')
  assert.equal(toWallInput(new Date('2026-10-24T21:00Z')), '2026-10-24T17:00')
})

test('rejects DST gaps and ambiguous departure times', () => {
  assert.throws(() => fromWallInput('2026-03-08T02:30'), /ambiguous or skipped/)
  assert.throws(() => fromWallInput('2026-11-01T01:30'), /ambiguous or skipped/)
  assert.throws(() => fromWallInput(''), /Enter both/)
})
