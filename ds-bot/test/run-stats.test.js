import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runStatsOf } from '../src/client/text.js'

const texts = values => runStatsOf(values).map(entry => entry.text)

test('the figures read as DSH counts them', () => {
  const values = {
    sessionStats: { turns: 12, decodeMs: 4000, decodeTokens: 150 },
    tokenUsage: { uncachedInputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 50, outputTokens: 400 },
    contextPressure: { pressureTokens: 41_000, contextWindow: 100_000 },
  }
  assert.deepEqual(texts(values), ['12 turns', '38 tok/s', 'Cache hit 90%', 'Context 41%'])
  assert.equal(runStatsOf(values).at(-1).title, '41.0K of 100.0K tokens of context in use')
})

test('a slow speed keeps a decimal, and a projected count wins over the last measure', () => {
  const values = {
    sessionStats: { turns: 1, decodeMs: 2000, decodeTokens: 9 },
    contextPressure: { pressureTokens: 10, projectedTokens: 30, contextWindow: 100 },
  }
  assert.deepEqual(texts(values), ['1 turn', '4.5 tok/s', 'Context 30%'])
})

test('a cache hit short of whole never reads 100%', () => {
  const hit = cacheReadTokens => texts({ tokenUsage: { uncachedInputTokens: 1000 - cacheReadTokens, cacheReadTokens } })
  assert.deepEqual(hit(996), ['Cache hit 99.6%'])
  assert.deepEqual(hit(1000), ['Cache hit 100%'])
  assert.deepEqual(hit(0), ['Cache hit 0%'])
})

test('nothing to count leaves the line empty', () => {
  assert.deepEqual(runStatsOf(null), [])
  assert.deepEqual(runStatsOf({ sessionStats: { turns: 0, decodeMs: 0, decodeTokens: 0 }, tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }), [])
  assert.deepEqual(texts({ contextPressure: { contextWindow: 100 } }), [])
})
