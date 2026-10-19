import assert from 'node:assert/strict'
import { test } from 'node:test'
import { elapsedLabel } from '../src/client/text.js'

test('the work clock counts seconds, then minutes and seconds, then hours, minutes and seconds', () => {
  assert.equal(elapsedLabel(-5_000), '0s')
  assert.equal(elapsedLabel(1_000), '1s')
  assert.equal(elapsedLabel(59_999), '59s')
  assert.equal(elapsedLabel(60_000), '1m 0s')
  assert.equal(elapsedLabel(68_400), '1m 8s')
  assert.equal(elapsedLabel(3_599_000), '59m 59s')
  assert.equal(elapsedLabel(3_600_000), '1h 0m 0s')
  assert.equal(elapsedLabel(3_723_000), '1h 2m 3s')
})
