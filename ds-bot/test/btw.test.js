import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { BTW_MARKER, trimToolBoundary } from '../src/host/btw.js'
import { fakeContext } from './fake-ctx.js'

const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (...blocks) => ({ role: 'assistant', content: blocks })
const call = (id, name = 'read') => ({ type: 'tool-call', id, name, arguments: '{}' })
const result = (id, text = 'ok') => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text }] })
const stop = text => [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
const toolCall = (id = 'c1') => [
  { type: 'tool-call-delta', index: 0, id, name: 'read', argumentsDelta: '{}' },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const promptOf = request => request.messages.at(-1).content.find(block => block.type === 'text').text

const team = (extra = {}) => ({
  version: 1,
  mainBotIds: ['b1'],
  whaleStored: true,
  revision: 3,
  bots: {
    b1: {
      id: 'b1', sessionId: 's-now', name: 'Chief', capabilities: [], color: 'deepseek', createdAt: 1,
      segments: [{ sessionId: 's-old', endedAt: 1 }],
    },
  },
  rooms: {
    r1: {
      id: 'r1', named: true, name: 'Launch', members: ['b1'], admin: 'b1', mode: 'everyone', notice: '',
      sessions: { b1: 'g-now' }, segments: { b1: [{ sessionId: 'g-old', endedAt: 1 }] },
    },
  },
  agents: {},
  capabilities: { items: {} },
  exchanges: [],
  exchangeTurns: {},
  works: {},
  questions: {},
  views: {},
  prefs: {},
  ...extra,
})

function makeSession(id, { messages, header, seq = 4, toolHistory, events }) {
  // The anchor fold reads this log. `eventAt` is closed to new callers.
  const history = events ?? []
  const session = {
    id,
    seq,
    events: events ?? [{ seq: 1, type: 'user/message' }],
    writes: 0,
    derived: 0,
    messages,
    header,
    history: toolHistory,
    inheritedEventCount: 0,
    deriveMessages() {
      session.derived += 1
      return session.messages.map(message => ({
        ...message,
        content: Array.isArray(message.content) ? message.content.map(block => ({ ...block })) : message.content,
      }))
    },
    toolHistory() { return session.history },
    requestHeader() { return session.header },
    snapshotEvents() { return history },
    eventAt() { throw new Error('eventAt is closed to new callers') },
    append() { session.writes += 1; session.events.push({ type: 'append' }) },
    followup() { session.writes += 1; session.events.push({ type: 'followup' }) },
  }
  return session
}

// The same register / stateOf face as ctx.sessionProjections: fold the unit
// the host registers over snapshotEvents().
function projectionRegistry(ctx) {
  const units = new Map()
  return {
    register(definition) {
      ctx.effect(() => {
        units.set(definition.key, definition)
        return () => { units.delete(definition.key) }
      }, 'sessionProjections.register()')
    },
    stateOf(session, key) {
      const definition = units.get(key)
      if (definition === undefined) return undefined
      let state = definition.init(session.header, session.inheritedEventCount)
      for (const event of session.snapshotEvents()) state = definition.apply(state, event)
      return state
    },
  }
}

function deferred() {
  let resolve
  let reject
  let settled = false
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return {
    promise,
    resolve() { if (!settled) { settled = true; resolve() } },
    reject(error) { if (!settled) { settled = true; reject(error) } },
  }
}

// `gate` holds each model call open so a test can see the card while it is still
// answering. `scripts` are the chunk lists for successive calls; anything further
// gets a short stop. `btw` seeds card files: { botId: { partId: [cards] } }.
async function setup({ state = team(), scripts = [], gate = false, messages, seq = 4, events, foreignLock = false, btw = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-btw-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  for (const [botId, parts] of Object.entries(btw)) {
    for (const [partId, list] of Object.entries(parts)) {
      mkdirSync(join(home, 'btw', botId), { recursive: true })
      writeFileSync(join(home, 'btw', botId, `${partId}.json`), JSON.stringify(list))
    }
  }
  if (foreignLock) writeFileSync(join(home, 'state.lock'), JSON.stringify({ pid: process.ppid, host: hostname(), token: 'other' }))
  const header = {
    config: { provider: 'deepseek', model: 'aside-model', reasoningEffort: 'high', maxTokens: 8000, temperature: 0.2, stop: ['END'] },
    tools: [{ name: 'read' }, { name: 'pwsh' }],
  }
  const toolHistory = [{ name: 'read' }]
  const session = makeSession('s-now', { messages: messages ?? [user('Look at the file')], header, seq, toolHistory, events })
  const sessions = new Map([[session.id, session]])
  const requests = []
  const resolved = []
  const gates = []
  const queue = [...scripts]
  const services = {}
  const ctx = fakeContext({ services })
  services.sessionProjections = projectionRegistry(ctx)
  ctx.llm = {
    listProviders: () => [],
    listModels: async () => [],
    resolveModelInfo: async () => ({ reasoning: { efforts: [] } }),
    async* stream(options) {
      requests.push(options)
      if (gate) {
        const hold = deferred()
        gates.push(hold)
        const abort = () => hold.reject(Object.assign(new Error('This aside was cancelled.'), { name: 'AbortError' }))
        options.signal?.addEventListener('abort', abort, { once: true })
        try {
          if (options.signal?.aborted) abort()
          await hold.promise
        } finally {
          options.signal?.removeEventListener('abort', abort)
        }
      }
      for (const chunk of queue.shift() ?? stop('Because of the snapshot.')) yield chunk
    },
  }
  ctx.sessionController = {
    resolveAgent: async (sessionId) => {
      resolved.push(sessionId)
      const found = sessions.get(sessionId)
      if (found === undefined) throw new Error(`no session ${sessionId}`)
      return { agent: { id: sessionId, session: found } }
    },
    list: async () => ({ items: [] }),
    projections: async () => null,
    page: async () => ({ records: [], hasMore: false }),
    selectModel: async () => {},
    prompt: async () => {},
  }
  ctx.sessions = { flush: async () => {}, messageProjections: [] }
  ctx.workspaceRegistry = { archiveSession: async () => {} }
  ctx.sessionTitle = { rename: async () => {} }
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  let notices = 0
  const saved = rt.stateSaved
  rt.stateSaved = () => { notices += 1; saved?.() }
  await rt.load()
  const callEndpoint = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stopRuntime = async () => {
    for (const hold of gates) hold.resolve()
    for (const card of Object.values(rt.btwView?.() ?? {}).flat()) await rt.btwJoin(card.id)
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { home, ctx, rt, session, sessions, header, toolHistory, requests, resolved, gates, call: callEndpoint, notices: () => notices, stop: stopRuntime }
}

const cardsOf = rt => rt.btwView?.().b1 ?? []
const cardsFile = (home, botId = 'b1', partId = 's-now') => JSON.parse(readFileSync(join(home, 'btw', botId, `${partId}.json`), 'utf8'))
const totals = (view) => {
  const sums = {}
  for (const [, owner, , kind, input, cacheRead, cacheWrite, output] of view.rows) {
    const name = view.owners[owner].name ?? view.owners[owner].key
    sums[`${name}/${view.kinds[kind]}`] = (sums[`${name}/${view.kinds[kind]}`] ?? 0) + input + cacheRead + cacheWrite + output
  }
  return sums
}

test('a snapshot drops an unfinished tool batch and keeps a finished one', () => {
  const pending = [user('Look'), assistant({ type: 'text', text: 'Reading.' }, call('c1'))]
  assert.deepEqual(trimToolBoundary(pending), [pending[0]])
  const partial = [user('Look'), assistant(call('a'), call('b')), result('a', 'half')]
  assert.deepEqual(trimToolBoundary(partial), [partial[0]])
  const balanced = [user('Look'), assistant(call('a'), call('b')), result('a'), result('b')]
  assert.equal(trimToolBoundary(balanced), balanced)
  const plain = [user('Look'), assistant({ type: 'text', text: 'Done.' })]
  assert.equal(trimToolBoundary(plain), plain)
  const followed = [user('Look'), assistant(call('c1')), user('And now?')]
  assert.equal(trimToolBoundary(followed), followed)
  assert.deepEqual(trimToolBoundary([]), [])
})

test('an aside uses the session route, drops the pending tool call, and writes nothing into the session', async (t) => {
  const env = await setup({
    gate: true,
    messages: [user('Look at the file'), assistant({ type: 'text', text: 'Reading it.' }, call('c1'))],
  })
  t.after(() => env.stop())
  const { rt, session, requests, header, toolHistory } = env
  assert.equal(rt.state.revision, 3)
  const before = JSON.stringify(session.events)
  const response = await env.call('btw', { sessionId: 's-now', text: 'what changed?' })
  assert.equal(response.ok, true)
  assert.equal(typeof response.value.id, 'string')
  const card = cardsOf(rt)[0]
  assert.equal(card.id, response.value.id)
  assert.equal(card.status, 'answering')
  assert.equal(card.botId, 'b1')
  assert.equal(card.partId, 's-now')
  assert.equal(card.atSeq, 3)
  assert.equal(card.anchorSeq, null)
  assert.equal(card.turn, null)
  assert.equal(card.question, 'what changed?')
  assert.equal(card.answer, '')
  assert.equal(rt.state.revision, 4)
  assert.equal(env.notices(), 1)
  assert.equal(session.writes, 0)
  assert.equal(JSON.stringify(session.events), before)
  assert.equal(session.messages.length, 2)
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.equal(request.provider, 'deepseek')
  assert.equal(request.model, 'aside-model')
  assert.equal(request.reasoningEffort, 'high')
  assert.equal(request.maxTokens, header.config.maxTokens)
  assert.equal(request.temperature, 0.2)
  assert.deepEqual(request.stop, ['END'])
  assert.equal(request.sessionId, 's-now')
  assert.equal(request.purpose, undefined)
  assert.equal(request.toolHistory, toolHistory)
  assert.notEqual(request.tools, header.tools)
  assert.deepEqual(request.tools.map(tool => tool.name), ['read', 'pwsh'])
  assert.deepEqual(request.messages.slice(0, -1).map(message => message.role), ['user'])
  assert.equal(request.messages[0].content[0].text, 'Look at the file')
  const prompt = promptOf(request)
  assert.equal(prompt.startsWith(`${BTW_MARKER}\n`), true)
  for (const line of [
    'Answer briefly from the conversation so far, based on progress up to this snapshot.',
    'Do not call any tool.',
    'If the answer needs information that is not in the conversation, say so.',
    'Never claim to have done anything.',
  ]) assert.ok(prompt.includes(line), line)
  assert.ok(prompt.endsWith('what changed?'))
  assert.equal(rt.ownRequest(request), true)
  env.gates[0].resolve()
  await rt.btwJoin(card.id)
  assert.equal(card.status, 'done')
  assert.equal(card.answer, 'Because of the snapshot.')
  assert.equal(typeof card.finishedAt, 'number')
  assert.equal(card.error, undefined)
  assert.equal(card.finish, undefined)
  assert.equal(session.writes, 0)
  assert.equal(JSON.stringify(session.events), before)
  assert.equal(rt.state.revision, 5)
  assert.equal(env.notices(), 2)
})

test('a partial parallel tool batch is left out of the aside', async (t) => {
  const env = await setup({
    messages: [user('Look'), assistant(call('a'), call('b')), result('a', 'half')],
  })
  t.after(() => env.stop())
  const response = await env.call('btw', { sessionId: 's-now', text: 'status?' })
  await env.rt.btwJoin(response.value.id)
  assert.deepEqual(env.requests[0].messages.slice(0, -1).map(message => message.role), ['user'])
  assert.equal(env.requests[0].messages[0].content[0].text, 'Look')
  assert.equal(env.session.writes, 0)
})

test('a finished tool batch and its tool history go through unchanged', async (t) => {
  const env = await setup({
    messages: [user('Look'), assistant(call('a'), call('b')), result('a'), result('b'), user('Thanks')],
  })
  t.after(() => env.stop())
  const response = await env.call('btw', { sessionId: 's-now', text: 'status?' })
  await env.rt.btwJoin(response.value.id)
  assert.deepEqual(env.requests[0].messages.slice(0, -1).map(message => [message.role, message.toolCallId]), [
    ['user', undefined], ['assistant', undefined], ['tool', 'a'], ['tool', 'b'], ['user', undefined],
  ])
  assert.equal(env.requests[0].toolHistory, env.toolHistory)
})

test('a Bot id or an earlier private part asks the current part', async (t) => {
  const env = await setup({ seq: 0 })
  t.after(() => env.stop())
  const past = await env.call('btw', { sessionId: 's-old', text: 'from the old part' })
  const bot = await env.call('btw', { sessionId: 'b1', text: 'from the bot' })
  await env.rt.btwJoin(past.value.id)
  await env.rt.btwJoin(bot.value.id)
  assert.deepEqual(env.resolved, ['s-now', 's-now'])
  assert.deepEqual(cardsOf(env.rt).map(card => card.partId), ['s-now', 's-now'])
  assert.equal(cardsOf(env.rt)[0].atSeq, null)
})

test('group chats, an empty question, and a missing route are refused, while further asides start', async (t) => {
  const env = await setup({ gate: true })
  t.after(() => env.stop())
  const { session } = env
  const refuse = async (payload, message, code = 'bot/refused') => {
    const response = await env.call('btw', payload)
    assert.equal(response.ok, false)
    assert.equal(response.error.message, message)
    assert.equal(response.error.code, code)
  }
  await refuse({ sessionId: 'g-now', text: 'in the group' }, 'btw is only available in a Bot\'s private chat.')
  await refuse({ sessionId: 'g-old', text: 'in the old group part' }, 'btw is only available in a Bot\'s private chat.')
  await refuse({ sessionId: 'r1', text: 'in the room' }, 'btw is only available in a Bot\'s private chat.')
  await refuse({ text: 'no session' }, 'Nothing to ask', 'bot/invalid')
  await refuse({ sessionId: 's-now', text: '   ' }, 'Write a question after /btw.', 'bot/invalid')
  await refuse({ sessionId: 'missing', text: 'hello' }, 'Unknown Bot')
  assert.equal(session.derived, 0)
  assert.deepEqual(env.resolved, [])
  assert.equal(env.requests.length, 0)
  const saved = env.header.config
  env.header.config = {}
  await refuse({ sessionId: 's-now', text: 'hello' }, 'This Bot has not called a model yet. Send a normal message first.')
  env.header.config = saved
  assert.equal(session.derived, 1)
  assert.equal(env.requests.length, 0)
  assert.equal(cardsOf(env.rt).length, 0)
  const first = await env.call('btw', { sessionId: 'b1', text: 'one' })
  const second = await env.call('btw', { sessionId: 's-now', text: 'two' })
  const third = await env.call('btw', { sessionId: 's-now', text: 'three' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(third.ok, true)
  assert.equal(env.requests.length, 3)
  assert.equal(session.derived, 4)
  assert.equal(cardsOf(env.rt).length, 3)
  assert.equal(session.writes, 0)
})

test('a tool call is asked again once, then the card fails if it calls a tool again', async (t) => {
  const once = await setup({ scripts: [toolCall('c1'), stop('The file is ready.')] })
  t.after(() => once.stop())
  const asked = await once.call('btw', { sessionId: 's-now', text: 'where is it?' })
  await once.rt.btwJoin(asked.value.id)
  assert.equal(once.requests.length, 2)
  assert.equal(promptOf(once.requests[0]).includes('Answer in text only.'), false)
  assert.equal(promptOf(once.requests[1]).includes('Do not call any tool. Answer in text only.'), true)
  assert.equal(promptOf(once.requests[1]).startsWith(`${BTW_MARKER}\n`), true)
  assert.equal(once.rt.ownRequest(once.requests[0]), true)
  assert.equal(once.rt.ownRequest(once.requests[1]), true)
  assert.equal(cardsOf(once.rt)[0].status, 'done')
  assert.equal(cardsOf(once.rt)[0].answer, 'The file is ready.')
  assert.equal(once.session.writes, 0)
  const meter = once.ctx.listeners.get('llm/stream').at(-1)
  for (const options of once.requests) {
    for await (const chunk of meter(options, async function* () {
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
    })) assert.equal(chunk.type, 'usage')
  }
  const usage = await once.call('usage', { timeZone: 'UTC' })
  assert.equal(usage.ok, true)
  assert.equal(totals(usage.value)['Chief/btw'], 30)

  const twice = await setup({ scripts: [toolCall('c1'), toolCall('c2')] })
  t.after(() => twice.stop())
  const again = await twice.call('btw', { sessionId: 's-now', text: 'try the tool' })
  await twice.rt.btwJoin(again.value.id)
  const failed = cardsOf(twice.rt)[0]
  assert.equal(twice.requests.length, 2)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.answer, '')
  assert.equal(failed.error, 'The model called a tool again after being told not to, so this aside was not answered.')
  assert.equal(twice.session.writes, 0)
  assert.deepEqual(twice.session.events, [{ seq: 1, type: 'user/message' }])
})

test('cancel aborts the call, and the freed slot can be used again', async (t) => {
  const env = await setup({ gate: true })
  t.after(() => env.stop())
  const held = await env.call('btw', { sessionId: 's-now', text: 'hold' })
  assert.equal(held.ok, true)
  const card = cardsOf(env.rt)[0]
  assert.equal(card.status, 'answering')
  const cancelled = await env.call('btw-cancel', { sessionId: 's-now', id: card.id })
  assert.deepEqual(cancelled, { ok: true, value: { answering: true } })
  assert.equal(card.status, 'cancelled')
  assert.equal(typeof card.finishedAt, 'number')
  assert.equal(env.requests[0].signal.aborted, true)
  await env.rt.btwJoin(card.id)
  assert.equal(card.status, 'cancelled')
  assert.equal(env.session.writes, 0)
  const again = await env.call('btw-cancel', { sessionId: 'b1', id: card.id })
  assert.deepEqual(again, { ok: true, value: { answering: false } })
  const missing = await env.call('btw-cancel', { sessionId: 's-now', id: 'gone' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.message, 'This aside question is no longer here.')
  const blank = await env.call('btw-cancel', { sessionId: 's-now' })
  assert.equal(blank.error.message, 'Nothing to cancel')
  const next = await env.call('btw', { sessionId: 's-now', text: 'after cancel' })
  assert.equal(next.ok, true)
  assert.equal(cardsOf(env.rt).find(item => item.id === next.value.id).status, 'answering')
})

test('questions and answers are kept whole, newest first, unbounded, in the part file', async (t) => {
  const question = `${'q'.repeat(2000)}END-OF-QUESTION`
  const answer = `${'a'.repeat(2000)}END-OF-ANSWER`
  const env = await setup({ scripts: [stop(answer)] })
  t.after(() => env.stop())
  const long = await env.call('btw', { sessionId: 's-now', text: question })
  await env.rt.btwJoin(long.value.id)
  const card = cardsOf(env.rt)[0]
  assert.equal(card.id, long.value.id)
  assert.equal(card.question, question)
  assert.equal(card.answer, answer)
  assert.equal(card.status, 'done')
  assert.equal(promptOf(env.requests[0]).endsWith(question), true)
  for (let index = 0; index < 25; index += 1) {
    const response = await env.call('btw', { sessionId: 's-now', text: `item ${String(index).padStart(2, '0')}` })
    await env.rt.btwJoin(response.value.id)
  }
  const cards = cardsOf(env.rt)
  assert.equal(cards.length, 26)
  assert.equal(cards[0].question, 'item 24')
  assert.equal(cards.at(-1).id, long.value.id)
  const file = cardsFile(env.home)
  assert.equal(file.length, 26)
  assert.equal(file[0].id, cards[0].id)
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.equal('btwCards' in saved, false)
  const view = await env.call('state', {})
  assert.equal(view.ok, true, view.error?.message)
  assert.equal(view.value.btwCards.b1.length, 26)
  assert.equal(view.value.btwCards.b1[0].id, cards[0].id)
})

test('a restart marks an aside that was still answering as failed', async (t) => {
  const env = await setup({
    btw: {
      b1: {
        's-now': [
          { id: 'live', botId: 'b1', partId: 's-now', atSeq: 2, question: 'Still going?', answer: '', status: 'answering', createdAt: 10 },
          { id: 'old', botId: 'b1', partId: 's-now', atSeq: 1, question: 'Earlier?', answer: 'Yes.', status: 'done', createdAt: 9, finishedAt: 11 },
        ],
      },
    },
  })
  t.after(() => env.stop())
  const [live, old] = cardsOf(env.rt)
  assert.equal(live.status, 'failed')
  assert.equal(live.error, 'DS Bot restarted before this answer finished.')
  assert.equal(typeof live.finishedAt, 'number')
  assert.equal(live.question, 'Still going?')
  assert.equal(old.status, 'done')
  assert.equal(old.answer, 'Yes.')
  assert.equal(old.finishedAt, 11)
  const file = cardsFile(env.home)
  assert.equal(file[0].status, 'failed')
  assert.equal(file[0].error, 'DS Bot restarted before this answer finished.')
  assert.equal(file[1].status, 'done')
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.equal('btwCards' in saved, false)
  assert.equal(saved.revision, 3)
})

test('an empty answer and a provider abort fail the card', async (t) => {
  const empty = await setup({ scripts: [[{ type: 'text-delta', index: 0, text: '  \n' }, { type: 'finish', reason: { kind: 'stop' } }]] })
  t.after(() => empty.stop())
  const blank = await empty.call('btw', { sessionId: 's-now', text: 'anything?' })
  await empty.rt.btwJoin(blank.value.id)
  assert.equal(cardsOf(empty.rt)[0].status, 'failed')
  assert.equal(cardsOf(empty.rt)[0].error, 'The model wrote nothing.')
  assert.equal(cardsOf(empty.rt)[0].answer, '')

  const aborted = await setup({
    scripts: [[{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'the provider stopped' } } }]],
  })
  t.after(() => aborted.stop())
  const stopped = await aborted.call('btw', { sessionId: 's-now', text: 'hello' })
  await aborted.rt.btwJoin(stopped.value.id)
  assert.equal(cardsOf(aborted.rt)[0].status, 'failed')
  assert.equal(cardsOf(aborted.rt)[0].error, 'the provider stopped')
  assert.equal(aborted.session.writes, 0)
})

test('a second host does not fail an aside the writer is still answering', async (t) => {
  const env = await setup({
    foreignLock: true,
    btw: {
      b1: {
        's-now': [
          { id: 'live', botId: 'b1', partId: 's-now', atSeq: 2, question: 'Still going?', answer: '', status: 'answering', createdAt: 10 },
          { id: 'old', botId: 'b1', partId: 's-now', atSeq: 1, question: 'Earlier?', answer: 'Yes.', status: 'done', createdAt: 9, finishedAt: 11 },
        ],
      },
    },
  })
  t.after(() => env.stop())
  assert.equal(typeof env.rt.readOnly(), 'string')
  const [live, old] = cardsOf(env.rt)
  assert.equal(live.status, 'answering')
  assert.equal(live.error, undefined)
  assert.equal(live.finishedAt, undefined)
  assert.equal(old.status, 'done')
  assert.equal(old.answer, 'Yes.')
  const file = cardsFile(env.home)
  assert.equal(file[0].status, 'answering')
  assert.equal(file[1].status, 'done')
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.equal('btwCards' in saved, false)
  assert.equal(saved.revision, 3)
  assert.equal(env.rt.state.revision, 3)
  assert.equal(env.notices(), 0)
})

test('deleting a Bot aborts its aside and clears the card', async (t) => {
  const state = team()
  state.bots.b2 = { id: 'b2', sessionId: 's-b2', name: 'Side', capabilities: [], color: 'deepseek', createdAt: 2 }
  const env = await setup({ state, gate: true })
  t.after(() => env.stop())
  env.sessions.set('s-b2', makeSession('s-b2', {
    messages: [user('Side work')],
    header: env.header,
    seq: 3,
    toolHistory: [],
  }))
  const response = await env.call('btw', { sessionId: 'b2', text: 'hold this' })
  assert.equal(response.ok, true, response.error?.message)
  const card = env.rt.btwView().b2[0]
  const signal = env.requests[0].signal
  assert.equal(card.status, 'answering')
  await env.rt.deleteBot('b2')
  assert.equal(signal.aborted, true)
  assert.equal(env.rt.botOf('b2'), undefined)
  assert.equal(env.rt.btwView().b2, undefined)
  await env.rt.btwJoin(card.id)
  assert.notEqual(card.status, 'done')
  assert.equal(existsSync(join(env.home, 'btw', 'b2')), false)
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.equal(saved.bots.b2, undefined)
  assert.equal('btwCards' in saved, false)
  assert.equal(saved.bots.b1.id, 'b1')
})

test('unloading the plugin aborts an aside that is still answering', async (t) => {
  const env = await setup({ gate: true })
  t.after(() => env.stop())
  const response = await env.call('btw', { sessionId: 's-now', text: 'hold this' })
  assert.equal(response.ok, true, response.error?.message)
  const card = cardsOf(env.rt)[0]
  const signal = env.requests[0].signal
  const revision = env.rt.state.revision
  await env.ctx.dispose()
  assert.equal(signal.aborted, true)
  await env.rt.btwJoin(card.id)
  assert.equal(card.status, 'answering')
  assert.equal(env.rt.state.revision, revision)
  const file = cardsFile(env.home)
  assert.equal(file[0].id, card.id)
  assert.equal(file[0].status, 'answering')
  const saved = JSON.parse(readFileSync(join(env.home, 'state.json'), 'utf8'))
  assert.equal('btwCards' in saved, false)
  assert.equal(saved.revision, revision)
})

test('a running aside stays cancellable after newer cards arrive', async (t) => {
  const env = await setup({ gate: true })
  t.after(() => env.stop())
  const held = await env.call('btw', { sessionId: 's-now', text: 'hold this' })
  assert.equal(held.ok, true, held.error?.message)
  const heldId = held.value.id
  for (let index = 0; index < 25; index += 1) {
    const response = await env.call('btw', { sessionId: 's-now', text: `short ${index}` })
    assert.equal(response.ok, true, response.error?.message)
    const gate = env.gates.at(-1)
    assert.notEqual(gate, env.gates[0])
    gate.resolve()
    await env.rt.btwJoin(response.value.id)
  }
  const cards = cardsOf(env.rt)
  assert.equal(cards.length, 26)
  assert.equal(cards.at(-1).id, heldId)
  assert.equal(cards.at(-1).status, 'answering')
  assert.equal(env.requests[0].signal.aborted, false)
  const cancelled = await env.call('btw-cancel', { sessionId: 's-now', id: heldId })
  assert.deepEqual(cancelled, { ok: true, value: { answering: true } })
  assert.equal(env.requests[0].signal.aborted, true)
  assert.equal(cardsOf(env.rt).some(card => card.id === heldId && card.status === 'cancelled'), true)
})

test('a max-tokens finish keeps the partial answer and says it was cut off', async (t) => {
  const cut = await setup({
    scripts: [[
      { type: 'text-delta', index: 0, text: 'Partial answer' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]],
  })
  t.after(() => cut.stop())
  const response = await cut.call('btw', { sessionId: 's-now', text: 'go on' })
  await cut.rt.btwJoin(response.value.id)
  const card = cardsOf(cut.rt)[0]
  assert.equal(card.status, 'failed')
  assert.equal(card.answer, 'Partial answer')
  assert.equal(card.error, 'Answer cut off at the output limit.')
  assert.equal(card.finish, 'max-tokens')
  assert.notEqual(card.error, 'The model wrote nothing.')
  assert.equal(cut.session.writes, 0)

  const empty = await setup({
    scripts: [[{ type: 'finish', reason: { kind: 'max-tokens' } }]],
  })
  t.after(() => empty.stop())
  const blank = await empty.call('btw', { sessionId: 's-now', text: 'go on' })
  await empty.rt.btwJoin(blank.value.id)
  assert.equal(cardsOf(empty.rt)[0].status, 'failed')
  assert.equal(cardsOf(empty.rt)[0].answer, '')
  assert.equal(cardsOf(empty.rt)[0].error, 'Answer cut off at the output limit.')
  assert.equal(cardsOf(empty.rt)[0].finish, 'max-tokens')
})

test('a log-only tail anchors the aside to the turn, not the tail', async (t) => {
  const closed = [
    { seq: 1, type: 'turn/start', data: { turn: 99 } },
    { seq: 2, type: 'user/message' },
    { seq: 3, type: 'assistant/message' },
    { seq: 4, type: 'turn/end' },
    { seq: 5, type: 'model/selection' },
  ]
  const env = await setup({ seq: 6, events: closed })
  t.after(() => env.stop())
  const response = await env.call('btw', { sessionId: 's-now', text: 'where are we?' })
  await env.rt.btwJoin(response.value.id)
  const card = cardsOf(env.rt)[0]
  assert.equal(card.atSeq, 5)
  assert.equal(card.anchorSeq, 1)
  assert.equal(card.turn, 99)

  const tail = [
    { seq: 1, type: 'user/message' },
    { seq: 2, type: 'assistant/message' },
    { seq: 3, type: 'model/selection' },
  ]
  const open = await setup({
    seq: 4,
    events: tail,
  })
  t.after(() => open.stop())
  const second = await open.call('btw', { sessionId: 's-now', text: 'and now?' })
  await open.rt.btwJoin(second.value.id)
  assert.equal(cardsOf(open.rt)[0].atSeq, 3)
  assert.equal(cardsOf(open.rt)[0].anchorSeq, 2)
  assert.equal(cardsOf(open.rt)[0].turn, null)

  const running = [
    { seq: 1, type: 'turn/start', data: { turn: 3 } },
    { seq: 2, type: 'user/message' },
    { seq: 3, type: 'assistant/message' },
    { seq: 4, type: 'model/selection' },
  ]
  const mid = await setup({ seq: 5, events: running })
  t.after(() => mid.stop())
  const third = await mid.call('btw', { sessionId: 's-now', text: 'mid turn?' })
  await mid.rt.btwJoin(third.value.id)
  assert.equal(cardsOf(mid.rt)[0].atSeq, 4)
  assert.equal(cardsOf(mid.rt)[0].anchorSeq, 1)
  assert.equal(cardsOf(mid.rt)[0].turn, 3)
})

test('the team view carries only the current part\'s cards', async (t) => {
  const env = await setup({
    btw: {
      b1: {
        's-old': [{ id: 'gone', botId: 'b1', partId: 's-old', atSeq: 1, question: 'From the old part?', answer: 'Old.', status: 'done', createdAt: 5, finishedAt: 6 }],
      },
    },
  })
  t.after(() => env.stop())
  const response = await env.call('btw', { sessionId: 's-now', text: 'in the new part' })
  await env.rt.btwJoin(response.value.id)
  const cards = cardsOf(env.rt)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].partId, 's-now')
  const view = await env.call('state', {})
  assert.equal(view.ok, true, view.error?.message)
  assert.equal(view.value.btwCards.b1.length, 1)
  assert.equal(view.value.btwCards.b1[0].partId, 's-now')
  assert.equal(view.value.btwCards.b1.some(card => card.id === 'gone'), false)
})

test('an earlier part page carries that part\'s cards, read from its file', async (t) => {
  const old = [
    { id: 'there', botId: 'b1', partId: 's-old', atSeq: 1, question: 'From the old part?', answer: 'Old.', status: 'done', createdAt: 5, finishedAt: 6 },
    { id: 'left', botId: 'b1', partId: 's-old', atSeq: 2, question: 'Never done?', answer: '', status: 'answering', createdAt: 7 },
  ]
  const env = await setup({ btw: { b1: { 's-old': old } } })
  t.after(() => env.stop())
  env.sessions.set('s-old', makeSession('s-old', { messages: [user('Old work')], header: env.header, seq: 2, toolHistory: [] }))
  const view = await env.call('state', {})
  assert.equal(view.value.btwCards.b1, undefined)
  const page = await env.call('earlier', { sessionId: 's-now' })
  assert.equal(page.ok, true, page.error?.message)
  assert.equal(page.value.btw.length, 2)
  assert.equal(page.value.btw[0].id, 'there')
  // The owning host's lazy read still records the restart this file kept.
  assert.equal(page.value.btw[1].status, 'failed')
  assert.equal(page.value.btw[1].error, 'DS Bot restarted before this answer finished.')
  const file = cardsFile(env.home, 'b1', 's-old')
  assert.equal(file[1].status, 'failed')
})
