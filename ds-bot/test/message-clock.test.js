import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockLabel, messageClock } from '../src/client/text.js'

// A time in the machine's own zone, some days back, so the test does not depend on the zone.
const at = (daysAgo, hour, minute) => {
  const today = new Date()
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).getTime()
}
const clockOf = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

test('a message shows the clock today, and the day it came in before that', () => {
  const today = at(0, 14, 5)
  assert.equal(messageClock(today), clockOf(today))
  const yesterday = at(1, 9, 3)
  assert.equal(messageClock(yesterday), `Yesterday ${clockOf(yesterday)}`)
  const older = at(5, 9, 3)
  const date = new Date(older)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  assert.equal(messageClock(older), `${day} ${clockOf(older)}`)
  // The hover title always names the day.
  assert.equal(clockLabel(today), `Today ${clockOf(today)}`)
  assert.equal(clockLabel(yesterday), `Yesterday ${clockOf(yesterday)}`)
  assert.equal(clockLabel(older), messageClock(older))
})
