// Daily budgets: a Bot that has spent its own limit for the day takes no new work, and
// says why; the count is what the usage ledger has read for that Bot today.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const DAY = '2026-10-17'

const team = ({ dailyTokens, caps } = {}) => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief-chat', name: 'Chief', capabilities: [], createdAt: 1 },
    writer: { id: 'writer', sessionId: 'writer-chat', name: 'Writer', capabilities: [], createdAt: 2, ...(dailyTokens === undefined ? {} : { dailyTokens }) },
  },
  rooms: { room: { id: 'room', name: 'Crew', named: true, members: ['chief', 'writer'], sessions: { writer: 'room-writer' }, admin: 'chief', mode: 'everyone' } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  ...(caps === undefined ? {} : { caps }),
  revision: 1,
})

// The ledger is a scan of Session logs; these tests say what it read instead of writing
// Sessions a scan could read.
async function setup({ state = team(), spent = {}, day = DAY } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-budget-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  ctx.sessionTitle = { rename: async () => {} }
  const prompts = []
  ctx.sessionController = { ...ctx.sessionController, prompt: async request => { prompts.push(request); return { accepted: true } } }
  const delivered = []
  await rt.load()
  rt.ensureCapabilities = async () => {}
  ctx.sessions = { flush: async () => {} }
  // The Session protocol answers with the agent or an error, as DSH does.
  ctx.sessionController.resolveAgent = async sessionId => ({ agent: {
    session: { id: sessionId },
    followup: message => { delivered.push({ sessionId, message }) },
    steer: message => { delivered.push({ sessionId, message, steer: true }) },
  } })
  rt.usageToday = async () => ({ day, totals: new Map(Object.entries(spent).map(([owner, tokens]) => [owner, { tokens, calls: 1 }])) })
  return {
    rt, ctx, home, prompts, delivered,
    setSpent: tokens => { rt.usageToday = async () => ({ day, totals: new Map([['writer', { tokens, calls: 1 }]]) }) },
    send: text => rt.teamCall('send', { sessionId: 'writer', text }),
    cleanup: async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true }) },
  }
}

test('a Bot with no budget is never stopped', async () => {
  const env = await setup()
  try {
    assert.equal(await env.rt.budgetBlocks(env.rt.botOf('chief')), undefined)
    const answer = await env.send('work on it')
    assert.equal(answer.ok, true)
    assert.equal(env.prompts.length, 1)
  } finally {
    await env.cleanup()
  }
})

test('a message to a Bot under its budget goes through', async () => {
  const env = await setup({ state: team({ dailyTokens: 1000 }), spent: { writer: 400 } })
  try {
    const answer = await env.send('work on it')
    assert.equal(answer.ok, true)
    assert.equal(env.prompts.length, 1)
    assert.deepEqual(await env.rt.budgetsView(), { day: DAY, bots: [
      { id: 'chief', name: 'Chief', used: 0 },
      { id: 'writer', name: 'Writer', cap: 1000, used: 400 },
    ] })
  } finally {
    await env.cleanup()
  }
})

test('a message to a Bot that has spent its budget is refused, and says why', async () => {
  const env = await setup({ state: team({ dailyTokens: 1000 }), spent: { writer: 1000 } })
  try {
    const answer = await env.send('more work')
    assert.equal(answer.ok, false)
    assert.equal(answer.error.code, 'bot/capped')
    assert.match(answer.error.message, /Writer has reached its daily budget of 1000 tokens \(1000 used on 2026-10-17\)/)
    assert.deepEqual(env.prompts, [], 'no turn may start')
    // The team view carries the setting and that the day is spent, without a scan.
    assert.deepEqual(env.rt.capsView(), { writer: { cap: 1000, blocked: true } })
    // And the block is recorded once for the day, not on every message.
    assert.deepEqual(env.rt.state.caps.reached, [{ botId: 'writer', day: '2026-10-17' }])
    const reported = (await env.rt.diagnostics.entries()).filter(entry => entry.source === 'budget')
    assert.equal(reported.length, 1)
    assert.match(reported[0].text, /Writer reached its daily budget of 1000 tokens/)
    await env.send('again')
    assert.equal((await env.rt.diagnostics.entries()).filter(entry => entry.source === 'budget').length, 1)
  } finally {
    await env.cleanup()
  }
})

test('a capped Bot refuses what another Bot sends it, in the group too', async () => {
  const env = await setup({ state: team({ dailyTokens: 10 }), spent: { writer: 10 } })
  try {
    await assert.rejects(env.rt.deliver({ fromId: 'chief', toId: 'writer', text: 'hello', role: 'request' }), error => error.code === 'bot/capped' && /daily budget/.test(error.message))
    await assert.rejects(env.rt.deliver({ fromId: undefined, toId: 'writer', sessionId: 'room-writer', roomId: 'room', text: 'go', role: 'room', note: 'new message' }), error => error.code === 'bot/capped')
    // A secret card is not model work, so it still arrives.
    await env.rt.deliver({ toId: 'writer', role: 'secret', text: 'A key is needed' })
  } finally {
    await env.cleanup()
  }
})

test('a new day clears the spent budget and lets the Bot work again', async () => {
  const env = await setup({ state: team({ dailyTokens: 1000, caps: { day: DAY, reached: [{ botId: 'writer', day: DAY }] } }), spent: { writer: 1000 } })
  try {
    assert.deepEqual(env.rt.capsView(), { writer: { cap: 1000, blocked: true } })
    env.rt.usageToday = async () => ({ day: '2026-10-18', totals: new Map([['writer', { tokens: 500, calls: 2 }]]) })
    const answer = await env.send('the next day')
    assert.equal(answer.ok, true)
    assert.deepEqual(env.rt.capsView(), { writer: { cap: 1000 } })
    assert.deepEqual(await env.rt.budgetsView(), { day: '2026-10-18', bots: [
      { id: 'chief', name: 'Chief', used: 0 },
      { id: 'writer', name: 'Writer', cap: 1000, used: 500 },
    ] })
  } finally {
    await env.cleanup()
  }
})

test('a budget is set, checked and cleared', async () => {
  const env = await setup()
  try {
    assert.deepEqual(await env.rt.budgetEndpoint('budget-set', { id: 'writer', tokens: 25_000 }), { id: 'writer', cap: 25_000 })
    assert.equal(env.rt.state.bots.writer.dailyTokens, 25_000)
    assert.deepEqual(env.rt.capsView(), { writer: { cap: 25_000 } })
    for (const bad of [0, -5, 1.5, 'many', 100_000_001]) {
      await assert.rejects(env.rt.budgetEndpoint('budget-set', { id: 'writer', tokens: bad }), /whole tokens|under 100000000/)
    }
    assert.equal(env.rt.state.bots.writer.dailyTokens, 25_000)
    await assert.rejects(env.rt.budgetEndpoint('budget-set', { id: 'ghost', tokens: 10 }), /no Bot with that id/)
    await assert.rejects(env.rt.budgetEndpoint('budget-set', { id: 'writer', tokens: 10, actorId: 'writer' }), /cannot set its own/)
    assert.deepEqual(await env.rt.budgetEndpoint('budget-set', { id: 'writer', tokens: null }), { id: 'writer', cap: undefined })
    assert.equal(env.rt.state.bots.writer.dailyTokens, undefined)
    assert.deepEqual(env.rt.capsView(), {})
    assert.deepEqual(await env.rt.budgetEndpoint('budget-clear', { id: 'writer' }), { id: 'writer', cap: undefined })
  } finally {
    await env.cleanup()
  }
})

test('a watch-only host reads budgets but does not change them', async () => {
  const env = await setup({ state: team({ dailyTokens: 1000 }) })
  try {
    env.rt.readOnly = () => 'Another DS Bot host holds this team'
    assert.equal((await env.rt.budgetEndpoint('budgets', {})).bots.length, 2)
    await assert.rejects(env.rt.budgetEndpoint('budget-set', { id: 'writer', tokens: 10 }), /owns this Bot team/)
  } finally {
    await env.cleanup()
  }
})

test('the time zone the user sends decides which day is counted', async () => {
  const env = await setup()
  try {
    await env.rt.teamCall('usage', { timeZone: 'Asia/Riyadh' })
    assert.equal(env.rt.state.prefs.timeZone, 'Asia/Riyadh')
    await env.rt.teamCall('usage', { timeZone: 'not a time zone!' })
    assert.equal(env.rt.state.prefs.timeZone, 'Asia/Riyadh', 'an unusable zone is ignored')
  } finally {
    await env.cleanup()
  }
})

test('a team saved with an unreadable caps value still starts', async () => {
  const env = await setup({ state: { ...team(), caps: 'yesterday' } })
  try {
    assert.deepEqual(env.rt.capsView(), {})
    assert.deepEqual((await env.rt.budgetEndpoint('budgets', {})).bots.length, 2)
  } finally {
    await env.cleanup()
  }
})
