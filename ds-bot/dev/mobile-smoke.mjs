// Real DSH integration, using only the isolated mock bench and the mobile protocol.
// MOBILE_PORT=8789 CONTEXT_WINDOW=100000 dev/bench.sh mobile-smoke 3098 8798 reset
// node dev/mobile-smoke.mjs mobile-smoke 3098 8789
// MOBILE_PARITY=1 also exercises the original panels and the explicitly loaded
// dev/parity-approval-fixture.mjs (see that file's isolated-bench guard).
// dev/bench.sh mobile-smoke 3098 8798 stop
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import WebSocket from 'ws'
import { MobileClient, MemoryTokenStore } from '../../packages/mobile-sdk/index.js'

const [name, webPort, mobilePort] = process.argv.slice(2)
const portValid = value => /^\d+$/.test(value ?? '') && Number(value) >= 1024 && Number(value) <= 65535 && Number(value) !== 3080
if (!/^[a-z0-9-]+$/.test(name ?? '') || !portValid(webPort) || !portValid(mobilePort) || webPort === mobilePort) {
  console.error('usage: node dev/mobile-smoke.mjs <isolated-bench-name> <web-port> <mobile-port>')
  process.exit(2)
}
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const benchHome = join(root, `.dsh-test-${name}`)
const webBase = `http://127.0.0.1:${webPort}`
const mobileBase = `http://127.0.0.1:${mobilePort}`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const sockets = []
class TestWebSocket extends WebSocket {
  constructor(url) { super(url); sockets.push(this) }
}
const tokenStore = new MemoryTokenStore()
const mobile = new MobileClient({ baseUrl: mobileBase, tokenStore, allowInsecure: true, WebSocket: TestWebSocket, reconnectDelayMs: 100 })
const createdBots = []
const createdRooms = []
const connections = []
const createdTasks = []
const createdSecrets = []
const createdAgents = []
const createdAgentSessions = []
let passed = 0

function fixtureImage() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 2
  const chunks = [['IHDR', header], ['IDAT', deflateSync(Buffer.from([0, 32, 64, 96]))], ['IEND', Buffer.alloc(0)]]
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks.map(([type, data]) => {
    const chunk = Buffer.alloc(data.length + 12)
    chunk.writeUInt32BE(data.length)
    chunk.write(type, 4)
    data.copy(chunk, 8)
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
    return chunk
  })])
}

async function waitFor(predicate, message, timeout = 45_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await predicate()
    if (result) return result
    await pause(100)
  }
  throw new Error(message)
}
async function step(title, run) {
  const started = Date.now()
  try { await run() } catch (error) { throw new Error(`${title}: ${error.message}`) }
  passed += 1
  console.log(`ok   ${title} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
}
async function rejected(operation, statuses, message) {
  let status
  try { await operation() } catch (error) { status = error.status }
  assert.ok(statuses.includes(status), message)
}
async function login() {
  const log = await readFile(join(benchHome, 'web.log'), 'utf8')
  const url = log.match(new RegExp(`http://127\\.0\\.0\\.1:${webPort}/\\?token=[^\\s]+`))?.[0]
  if (!url) throw new Error('No login URL in this isolated bench log')
  const response = await fetch(url, { redirect: 'manual' })
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0])
  if (cookies.length === 0) throw new Error('The isolated bench login did not return a cookie')
  return cookies.join('; ')
}
let cookie
async function desktop(endpoint, payload = {}) {
  const response = await fetch(`${webBase}/api/bot`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ endpoint, payload }),
  })
  const result = await response.json()
  if (!result.ok) throw new Error(`Desktop ${endpoint} refused the test request`)
  return result.value
}
const operator = (endpoint, payload = {}) => desktop('mobile', { endpoint, payload })
async function settle() {
  let quietSince = Date.now()
  await waitFor(async () => {
    const state = await mobile.state()
    if (Object.keys(state.activity ?? {}).length) quietSince = Date.now()
    return Date.now() - quietSince >= 1500
  }, 'The mock Bot team did not become idle', 60_000)
}
async function send(conversationId, text, attachments) {
  const target = await mobile.target(conversationId)
  const input = { ...target, requestId: randomUUID(), text, ...(attachments ? { attachments } : {}) }
  await mobile.submit(input)
  return input
}
function follow(conversationId) {
  const events = [], statuses = [], errors = []
  const connection = mobile.connect({ conversationId, onEvent: event => events.push(event), onStatus: status => statuses.push(status), onError: error => errors.push(error) })
  connections.push(connection)
  return { connection, events, statuses, errors }
}

async function parity(botId) {
  await step('roster flags and original appearance preferences persist without changing other settings', async () => {
    const state = await mobile.state()
    const motion = state.prefs?.motion ?? 'normal'
    await mobile.action('set-flags', { id: botId, pinned: true, hidden: true })
    let bot = (await mobile.state()).bots.find(item => item.id === botId)
    assert.ok(bot.pinned && bot.hidden, 'Bot flags were not saved')
    await mobile.action('set-flags', { id: botId, hidden: false })
    bot = (await mobile.state()).bots.find(item => item.id === botId)
    assert.ok(bot.pinned && !bot.hidden, 'Changing visibility lost the pin')
    try {
      await mobile.action('set-prefs', { motion: 'quiet' })
      const changed = (await mobile.state()).prefs
      assert.equal(changed.motion, 'quiet')
    } finally {
      await mobile.action('set-prefs', { motion })
    }
    await rejected(() => mobile.action('set-flags', { id: 'unowned-session', pinned: true }), [404], 'An unrelated conversation accepted roster flags')
  })
  await step('parts and full-history search return safe cursors and exact message context', async () => {
    const text = `parity-history-${randomUUID()}`
    await send(botId, text)
    await settle()
    const catalog = await mobile.action('parts', { conversationId: botId })
    const current = catalog.parts.find(part => part.current)
    assert.ok(current?.cursor && current.sessionId === catalog.currentSessionId, 'Current part did not provide a history cursor')
    const page = await mobile.messages(botId, { cursor: current.cursor })
    const searched = await mobile.action('search', { conversationId: botId, query: text, limit: 30 })
    const found = searched.messages.find(message => message.role === 'user' && message.text.includes(text))
    assert.ok(found && page.messages.some(message => message.id === found.id), 'Search omitted the actual message from its part')
    const context = await mobile.action('context', { conversationId: botId, sessionId: found.sessionId, seq: found.seq, limit: 10 })
    assert.ok(context.messages.some(message => message.id === found.id) && context.focusId === found.id, 'Context failed to locate the selected message')
    await rejected(() => mobile.messages(createdBots[1], { cursor: current.cursor }), [400], 'A part cursor was accepted for another Bot')
    await rejected(() => mobile.action('context', { conversationId: botId, sessionId: 'unowned-session', seq: 0 }), [404], 'Context exposed an unrelated Session')
    await rejected(() => mobile.action('search', { conversationId: botId, query: '', limit: 30 }), [400], 'Empty full-history search was accepted')
  })
  await step('all four schedule forms use real DSH tasks and delete only the selected task', async () => {
    const view = await mobile.action('schedules')
    assert.equal(view.available, true, 'The test profile must provide the public Schedule service')
    const title = `parity-task-${randomUUID()}`
    const forms = [
      { kind: 'at', at: new Date(Date.now() + 86_400_000).toISOString() },
      { kind: 'daily', time: '13:47', timeZone: 'UTC' },
      { kind: 'weekly', time: '13:47', timeZone: 'UTC', weekdays: [1, 4] },
      { kind: 'every', minutes: 1440 },
    ]
    for (const when of forms) {
      const result = await mobile.action('schedule-create', { target: botId, title: `${title}-${when.kind}`, prompt: 'Harmless mock scheduled prompt.', when })
      const task = result.tasks.find(item => item.title === `${title}-${when.kind}`)
      assert.ok(task?.id && task.botId === botId && task.kind === when.kind, 'The saved task did not match its target or timing')
      createdTasks.push({ id: task.id, sessionId: task.sessionId })
    }
    const first = createdTasks[0]
    await rejected(() => mobile.action('schedule-delete', { id: first.id, sessionId: 'unowned-session' }), [404], 'Task deletion accepted a different Session')
    const after = await mobile.action('schedule-delete', first)
    createdTasks.shift()
    assert.ok(!after.tasks.some(item => item.id === first.id) && createdTasks.every(task => after.tasks.some(item => item.id === task.id)), 'Deleting one scheduled task altered another task')
    for (const task of createdTasks.splice(0)) await mobile.action('schedule-delete', task)
  })
  await step('memory editing, summary generation and token accounting use original host data', async () => {
    const text = `parity-memory-${randomUUID()}`
    const result = await mobile.action('memory-ask', { botId, text: `remember ${text}` })
    const entry = result.view.entries.find(item => item.text.includes(text))
    assert.ok(entry && result.changes.some(item => item.ok), 'Memory ask did not save the requested entry')
    const summarized = await waitFor(async () => {
      const view = await mobile.action('memory-view', { botId, summarize: true })
      return view.fresh && view.summary ? view : null
    }, 'Memory summary did not complete')
    assert.ok(summarized.summary.text.includes(text) && summarized.sizes.own > 0, 'Memory summary or character count omitted the saved entry')
    const forgotten = await mobile.action('memory-forget', { botId, scope: entry.scope, topic: entry.topic, text: entry.text })
    assert.ok(!forgotten.entries.some(item => item.text.includes(text)), 'Memory removal did not persist')
    const usage = await waitFor(async () => {
      const value = await mobile.action('usage', { timeZone: 'UTC' })
      return value.scanning ? null : value
    }, 'Usage history scan did not finish')
    const index = usage.owners.findIndex(owner => owner.id === botId)
    const rows = usage.rows.filter(row => row[1] === index)
    assert.ok(index >= 0 && rows.length && rows.every(row => row.length === 9 && Number.isFinite(row[8])), 'Usage did not expose the real hourly nine-field tuples')
    assert.ok(rows.reduce((sum, row) => sum + row[4] + row[5] + row[6] + row[7], 0) > 0, 'Completed model calls produced no token usage')
  })
  await step('secret metadata never returns values and pending secret cards can be cancelled', async () => {
    const name = `PARITY_${randomUUID().replaceAll('-', '').toUpperCase()}`
    const value = `ds-bot-test-${randomUUID()}`
    const result = await mobile.action('secret-set', { name, value, purpose: 'Synthetic mobile parity fixture', scope: [botId] })
    createdSecrets.push(name)
    const state = await mobile.state()
    assert.ok(state.secrets.some(secret => secret.name === name), 'Saved secret metadata is absent')
    assert.ok(!JSON.stringify({ result, state }).includes(value), 'A synthetic secret value leaked into a response')
    await rejected(() => mobile.action('secret-update', { name, scope: ['unowned-session'] }), [404], 'A secret was scoped to an unrelated Bot')
    await mobile.action('secret-delete', { name })
    createdSecrets.pop()
    await send(botId, `要密钥 ${name}`)
    await settle()
    const pending = (await mobile.state()).secretRequests?.[botId]?.find(request => request.name === name && request.status === 'pending')
    assert.ok(pending?.id && !('meta' in pending), 'Pending secret request was absent or exposed private metadata')
    await mobile.action('secret-cancel', { requestId: pending.id })
    await rejected(() => mobile.action('secret-allow', { requestId: pending.id }), [409], 'A settled secret card accepted a second answer')
    await rejected(() => mobile.action('secret-set', { name, value: 'not-a-synthetic-credential', scope: [botId] }), [403], 'HTTP development accepted a non-test credential')
    await rejected(() => mobile.action('connector-connect', { id: 'not-configured', token: 'ds-bot-test-connector' }), [404], 'An unconfigured connector accepted a token')
  })
  await step('host settings expose public schemas while HTTP mutation and credential leakage are blocked', async () => {
    const described = await mobile.action('settings-describe')
    assert.ok(Array.isArray(described.namespaces), 'Settings did not return the public namespace schema')
    const first = described.namespaces[0]
    assert.ok(first && Number.isSafeInteger(first.revision), 'Settings omitted their revision for conflict checks')
    await rejected(() => mobile.action('settings-update', { ns: first.ns, expectedRevision: first.revision, patch: {} }), [403], 'HTTP settings update bypassed the HTTPS requirement')
    await rejected(() => mobile.action('settings-mutate', { ns: first.ns, expectedRevision: first.revision - 1, ops: [{ op: 'set', path: ['value'], value: false }] }), [403], 'HTTP settings mutation bypassed the HTTPS requirement')
    const credentials = await mobile.action('credentials-describe', { refs: ['DEEPSEEK_API_KEY', 'DS_BOT_PARITY_UNUSED'] })
    assert.ok(Object.values(credentials).length === 2 && Object.values(credentials).every(value => typeof value.configured === 'boolean' && typeof value.writable === 'boolean'), 'Credential descriptions omitted configured or writable state')
    assert.ok(!JSON.stringify(credentials).includes('mock-key'), 'Credential state returned an actual value')
    const browser = await mobile.action('browser-pages')
    assert.ok(typeof browser.available === 'boolean' && Array.isArray(browser.pages), 'Browser capability did not report its actual availability')
    await rejected(() => mobile.action('credentials-describe', { refs: ['../../outside'] }), [400], 'An invalid credential reference was accepted')
  })
  await step('DSH Agent session creation, title, streaming runtime and archive use the public controller', async () => {
    const state = await mobile.state()
    let agent = state.agents[0]
    if (!agent) {
      agent = await mobile.action('add-agent')
      createdAgents.push(agent.id)
    }
    const { sessionId } = await mobile.action('agent-session', { agentId: agent.id })
    const record = { agentId: agent.id, sessionId }
    createdAgentSessions.push(record)
    const conversationId = `agent:${agent.id}:${sessionId}`
    await mobile.action('agent-rename', { ...record, title: 'Mobile parity Agent' })
    const live = follow(conversationId)
    await waitFor(() => live.events.some(event => event.type === 'reset'), 'The DSH Agent did not provide an initial snapshot')
    const text = `parity-agent-${randomUUID()}`
    await send(conversationId, text)
    await waitFor(() => live.events.some(event => event.type === 'status' && event.running === true), 'The DSH Agent did not publish running=true')
    await waitFor(() => live.events.some(event => event.type === 'status' && event.running === false && event.eventSeq !== undefined), 'The DSH Agent did not publish a completed turn')
    const history = await mobile.messages(conversationId)
    assert.ok(history.messages.some(message => message.role === 'assistant' && message.text.includes(text)), 'The DSH Agent reply was absent')
    await rejected(() => mobile.action('agent-archive', { agentId: agent.id, sessionId: 'unowned-session' }), [404], 'DSH Agent archived an unrelated Session')
    await mobile.action('agent-archive', record)
    createdAgentSessions.pop()
    await rejected(() => mobile.target(conversationId), [404], 'An archived DSH Agent Session stayed addressable')
    live.connection.close()
    for (const id of createdAgents.splice(0)) await mobile.action('remove-agent', { agentId: id })
  })
  await step('desktop and mobile share one approval request, first answer wins, and cancellation withdraws it', async () => {
    const live = follow(botId)
    await waitFor(() => live.events.some(event => event.type === 'reset'), 'Approval conversation did not connect')
    for (const decision of ['allowed-once', 'rejected', 'cancelled']) {
      const before = live.events.length
      await send(botId, 'ds-bot-test-approval')
      const request = await waitFor(async () => (await mobile.action('approvals')).requests.find(item => item.conversationId === botId), 'The explicit approval fixture did not publish a request')
      const desktopRequest = (await operator('approvals.list')).requests.find(item => item.id === request.id)
      assert.ok(desktopRequest && request.toolName === 'ds_bot_test_approval', 'Desktop and mobile did not share the same approval identity')
      assert.ok(live.events.slice(before).some(event => event.type === 'status' && event.running === true), 'Pending approval lost its running state')
      if (decision === 'allowed-once') await mobile.action('approval-resolve', { id: request.id, decision })
      else if (decision === 'rejected') await operator('approvals.resolve', { id: request.id, decision })
      else await mobile.cancel(botId)
      await waitFor(async () => !(await mobile.action('approvals')).requests.some(item => item.id === request.id), 'Settled approval remained pending')
      await rejected(() => mobile.action('approval-resolve', { id: request.id, decision: 'allowed-once' }), [409], 'A second client answered a settled approval')
      await settle()
      if (decision !== 'cancelled') {
        const history = await mobile.messages(botId)
        assert.ok(history.messages.some(message => message.role === 'assistant' && message.text.includes(`Mock approval outcome: ${decision}`)), 'The tool did not receive the selected approval decision')
      }
    }
    live.connection.close()
  })
}

try {
  cookie = await login()
  let info, chief, model
  await step('anonymous discovery exposes protocol identity, protected state requires pairing', async () => {
    info = await mobile.info()
    assert.equal(info.protocolVersion, 1)
    const response = await fetch(`${mobileBase}/mobile/v1/state`)
    assert.equal(response.status, 401)
    const status = await operator('status')
    assert.ok(status.enabled && !status.error, 'Mobile access did not start on the isolated bench')
  })
  await step('a pairing code requires an explicit desktop approval', async () => {
    const code = await operator('pairing.create')
    assert.ok(code.serverId === info.serverId && code.url === mobileBase, 'Pairing identity did not match discovery')
    const claim = await mobile.pair(code.code, 'Mobile smoke device')
    const pending = await mobile.completePairing(claim.claimToken)
    assert.equal(pending.status, 'pending')
    assert.equal(await tokenStore.get(), null)
    const status = await operator('status')
    assert.ok(status.pending.some(item => item.requestId === claim.requestId), 'Desktop did not list the pending device')
    await operator('pairing.approve', { requestId: claim.requestId })
    const session = await mobile.completePairing(claim.claimToken)
    assert.ok(session.deviceId && session.serverId === info.serverId, 'Approved device session was not issued')
    await rejected(() => mobile.pair(code.code, 'Code replay'), [400, 404], 'Pairing code was reusable')
  })
  await step('declined pairing stays unauthorized', async () => {
    const code = await operator('pairing.create')
    const claim = await mobile.pair(code.code, 'Declined smoke device')
    await operator('pairing.deny', { requestId: claim.requestId })
    await rejected(() => mobile.completePairing(claim.claimToken), [403], 'Declined device was able to pair')
  })
  await step('the SDK refreshes expiring credentials and rotated tokens cannot be replayed', async () => {
    const previous = await tokenStore.get()
    await tokenStore.set({ ...previous, expiresAt: Date.now() - 1 })
    await mobile.state()
    const current = await tokenStore.get()
    assert.ok(current.accessToken !== previous.accessToken && current.refreshToken !== previous.refreshToken, 'The SDK did not store rotated credentials')
    assert.ok(current.deviceId === previous.deviceId && current.serverId === previous.serverId, 'Refresh changed the device identity')
    const response = await fetch(`${mobileBase}/mobile/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: previous.refreshToken }) })
    assert.equal(response.status, 401)
  })
  await step('mobile bootstraps the existing team and selects a vision-capable mock model', async () => {
    const state = await mobile.state()
    assert.ok(Array.isArray(state.bots) && state.bots.length > 0, 'No mobile Bot team')
    assert.ok(!('diagnostics' in state), 'Host diagnostics leaked into ordinary mobile state')
    assert.ok((state.secrets ?? []).every(secret => !('value' in secret)), 'Secret values leaked into mobile state')
    assert.ok((state.connectors ?? []).every(connector => !('token' in connector)), 'Connector tokens leaked into mobile state')
    chief = state.bots.find(bot => state.mainBotIds.includes(bot.id))
    model = state.models.find(item => item.ref.includes('deepseek-flash')) ?? state.models[0]
    assert.ok(chief && model, 'No Chief or mock model in the team')
    await mobile.action('update-bot', { id: chief.id, model: model.ref })
    await settle()
    const conversations = (await mobile.conversations()).conversations
    assert.ok(conversations.some(item => item.id === chief.id && item.kind === 'bot'), 'Chief is absent from logical conversations')
  })
  await step('arbitrary Sessions, host secrets and malformed cursors are rejected', async () => {
    await rejected(() => mobile.messages('unowned-session'), [404], 'An unrelated Session was readable')
    await rejected(() => mobile.target('unowned-session'), [404], 'An unrelated Session was addressable')
    await rejected(() => mobile.action('secret-set', { name: 'SMOKE_SECRET', value: 'mock-only' }), [403, 404], 'Host secret mutation was exposed')
    await rejected(() => mobile.messages(chief.id, { cursor: 'invalid-cursor' }), [400], 'A malformed history cursor was accepted')
    const target = await mobile.target(chief.id)
    await rejected(() => mobile.submit({ ...target, sessionId: 'unowned-session', requestId: randomUUID(), text: 'Wrong target' }), [409], 'A mismatched current Session was accepted')
  })
  let stream
  await step('WebSocket snapshot, real mock response and stable submission deduplication', async () => {
    stream = follow(chief.id)
    await waitFor(() => stream.events.some(event => event.type === 'reset'), 'No opening mobile snapshot')
    const target = await mobile.target(chief.id)
    const text = `mobile-smoke-${randomUUID()}`
    const submission = { ...target, requestId: randomUUID(), text }
    const receipts = await Promise.all([mobile.submit(submission), mobile.submit(submission)])
    assert.ok(receipts.every(receipt => receipt.requestId === submission.requestId), 'Repeated request did not return the original receipt')
    const known = await mobile.submission(submission.requestId)
    assert.ok(known.requestId === submission.requestId, 'Submission lookup did not recover the request')
    await settle()
    const history = await mobile.messages(chief.id)
    assert.equal(history.messages.filter(message => message.role === 'user' && message.text.includes(text)).length, 1)
    assert.ok(history.messages.some(message => message.role === 'assistant' && message.text.includes(text)), 'The real mock reply did not reach history')
    await waitFor(() => stream.events.some(event => event.type === 'message' && event.message?.role === 'assistant' && event.message.text.includes(text)), 'The final reply did not arrive over WebSocket')
    assert.ok(stream.events.some(event => event.type === 'delta'), 'The mock response did not produce stream deltas')
    await rejected(() => mobile.submit({ ...submission, text: 'Changed request contents' }), [409], 'A reused request ID accepted changed content')
  })
  await step('transport reconnect and foreground return restore history without duplicates', async () => {
    const resets = stream.events.filter(event => event.type === 'reset').length
    sockets.at(-1).terminate()
    await waitFor(() => stream.events.filter(event => event.type === 'reset').length > resets, 'WebSocket did not reconnect with a new snapshot')
    assert.ok(stream.statuses.includes('reconnecting'), 'The SDK did not report reconnection')
    stream.connection.close()
    const text = `offline-catchup-${randomUUID()}`
    const target = await mobile.target(chief.id)
    await desktop('send', { sessionId: target.sessionId, text })
    await settle()
    stream = follow(chief.id)
    await waitFor(() => stream.events.some(event => event.type === 'reset' && event.messages.some(message => message.text.includes(text))), 'Foreground snapshot omitted messages sent while disconnected')
    const cached = await mobile.getCachedMessages(chief.id)
    assert.equal(cached.filter(message => message.role === 'user' && message.text.includes(text)).length, 1)
    assert.equal(new Set(cached.map(message => message.id)).size, cached.length)
    await mobile.setDraft(chief.id, 'Unsent mobile draft')
    assert.equal(await mobile.getDraft(chief.id), 'Unsent mobile draft')
    await mobile.setDraft(chief.id, '')
  })
  await step('question cards, memory and usage reuse existing team actions', async () => {
    await send(chief.id, '卡片 0')
    await settle()
    const state = await mobile.state()
    const target = await mobile.target(chief.id)
    const question = state.questions?.[target.sessionId]
    assert.ok(question?.id, 'The real mock question card did not reach mobile state')
    await mobile.action('answer-question', { sessionId: target.sessionId, questionId: question.id, answer: { selected: [], custom: 'First define the goal' } })
    await settle()
    await rejected(() => mobile.action('answer-question', { sessionId: target.sessionId, questionId: question.id, answer: { selected: [], custom: 'Duplicate answer' } }), [400, 409], 'An already answered question accepted a second answer')
    const memory = await mobile.action('memory-view', { botId: chief.id, summarize: false })
    assert.ok(memory && typeof memory === 'object', 'Memory view is unavailable')
    const usage = await mobile.action('usage', { timeZone: 'UTC' })
    assert.ok(usage && typeof usage === 'object', 'Usage view is unavailable')
  })
  await step('TXT and image uploads are admitted by the real DSH Session', async () => {
    const target = await mobile.target(chief.id)
    const textFile = await mobile.upload({ ...target, name: 'mobile-smoke.txt', mediaType: 'text/plain', body: Buffer.from('Mobile attachment integration fixture.\n') })
    const imageFile = await mobile.upload({ ...target, name: 'mobile-smoke.png', mediaType: 'image/png', body: fixtureImage() })
    assert.ok(textFile.receiptId && imageFile.receiptId, 'Upload receipts were not issued')
    const text = `attachments-${randomUUID()}`
    await send(chief.id, text, [{ receiptId: textFile.receiptId }, { receiptId: imageFile.receiptId }])
    await settle()
    const history = await mobile.messages(chief.id)
    const message = history.messages.find(item => item.role === 'user' && item.text.includes(text))
    assert.ok(message && message.attachments?.length >= 2, 'Attached files were omitted from canonical history')
    const image = message.attachments.find(attachment => attachment.type === 'image')
    assert.ok(image?.id, 'The admitted image has no download identity')
    const download = await mobile.attachment(chief.id, message.sessionId, image.id)
    const file = message.attachments.find(attachment => attachment.type === 'file')
    assert.ok(file?.id, 'Uploaded text file reference was omitted')
    const fileDownload = await mobile.attachment(chief.id, message.sessionId, file.id, { seq: message.seq })
    assert.equal(await fileDownload.text(), 'Mobile attachment integration fixture.\n', 'File download did not return the exact admitted bytes')
    await rejected(() => mobile.attachment(chief.id, message.sessionId, file.id, { seq: message.seq + 1 }), [404], 'File download accepted another message position')
    assert.ok(download.size > 0 && download.type.startsWith('image/'), 'The authenticated image download did not return image bytes')
    await rejected(() => mobile.upload({ ...target, name: 'fake.png', mediaType: 'image/png', body: Buffer.from('not an image') }), [415], 'Invalid image content was accepted')
    const corrupt = await mobile.upload({ ...target, name: 'truncated.png', mediaType: 'image/png', body: fixtureImage().subarray(0, 20) })
    const corruptRequest = { ...target, requestId: randomUUID(), text: 'Invalid image test', attachments: [{ receiptId: corrupt.receiptId }] }
    await rejected(() => mobile.submit(corruptRequest), [422], 'DSH image decoding failure was not reported as a rejected submission')
    assert.equal((await mobile.submission(corruptRequest.requestId)).status, 'rejected')
    await rejected(() => mobile.upload({ ...target, sessionId: 'unowned-session', name: 'wrong.txt', mediaType: 'text/plain', body: Buffer.from('wrong target') }), [409], 'An upload was accepted for another Session')
  })
  await step('optional speech reports unavailable when the host has no ASR service', async () => {
    await rejected(() => mobile.transcribe({ name: 'recording.wav', mediaType: 'audio/wav', body: Buffer.alloc(44) }), [503], 'Missing speech service did not produce a clear unavailable response')
  })
  await step('mobile creates Bots and a group; member replies appear in the shared conversation', async () => {
    for (const [botName, role] of [['Mobile Writer', 'Writer'], ['Mobile Coder', 'Engineer']]) {
      const bot = await mobile.action('create-bot', { name: botName, role, instructions: 'Reply briefly to the mock integration test.', model: model.ref })
      assert.ok(bot.id, 'Bot creation returned no identifier')
      createdBots.push(bot.id)
    }
    const room = await mobile.action('create-room', { name: 'Mobile Smoke Group', members: createdBots })
    assert.ok(room.id, 'Group creation returned no identifier')
    createdRooms.push(room.id)
    await mobile.action('update-room', { id: room.id, notice: 'Integration test group', mode: 'everyone' })
    const text = `group-smoke-${randomUUID()}`
    await send(room.id, text)
    await settle()
    const history = await mobile.messages(room.id)
    assert.ok(history.messages.some(message => message.role === 'user' && message.text.includes(text)), 'Group omitted the user message')
    assert.ok(history.messages.some(message => message.role === 'assistant' && message.author), 'Group omitted attributed member replies')
    const list = (await mobile.conversations()).conversations
    assert.ok(list.some(item => item.id === room.id && item.kind === 'room'), 'Group is absent from mobile conversations')
    const state = await mobile.state()
    assert.equal(list.length, state.bots.length + state.rooms.length + (state.agents ?? []).reduce((sum, agent) => sum + agent.sessions.length, 0))
  })
  await step('group permission overrides persist and clear through the mobile API', async () => {
    const options = (await mobile.state()).permissions?.options ?? []
    const preset = options.find(option => option.value === 'workspace-write') ?? options.find(option => option.value !== 'auto')
    assert.ok(preset, 'The host did not expose a persistent permission preset')
    const roomId = createdRooms[0]
    await mobile.action('update-room', { id: roomId, permission: preset.value })
    assert.equal((await mobile.state()).rooms.find(room => room.id === roomId).permission, preset.value)
    await mobile.action('update-room', { id: roomId, permission: null })
    assert.equal((await mobile.state()).rooms.find(room => room.id === roomId).permission, undefined)
    await rejected(() => mobile.action('update-room', { id: roomId, permission: 'auto' }), [400], 'Auto review was accepted as a permanent group preset')
  })
  await step('group members expose their current task and post progress before their final result', async () => {
    const members = []
    for (const botName of ['SyncAdmin', 'SyncWorker']) {
      const bot = await mobile.action('create-bot', { name: botName, model: model.ref })
      members.push(bot.id)
      createdBots.push(bot.id)
    }
    const room = await mobile.action('create-room', { name: 'Mobile Progress Group', members, admin: members[0] })
    createdRooms.push(room.id)
    await settle()
    await send(room.id, '分步 2')
    const working = await waitFor(async () => {
      const state = await mobile.state()
      return state.work?.rooms?.[room.id]?.find(entry => entry.botId === members[1] && entry.said)
    }, 'The member never exposed actual task progress')
    assert.ok(working.said.includes('目录') || working.said.includes('整理'), 'Work status did not describe the task')
    const live = await waitFor(async () => {
      const rounds = await mobile.action('room-progress', { roomId: room.id })
      return rounds.flatMap(round => round.replies).find(reply => reply.text?.includes('收到，我先看看目录。'))
    }, 'The group did not expose progress before completion')
    assert.equal(live.botId, members[1])
    assert.ok(Object.keys((await mobile.state()).activity ?? {}).length, 'Progress arrived only after work completed')
    await settle()
    const { messages } = await mobile.messages(room.id)
    const progress = messages.findIndex(message => message.role === 'assistant' && message.text.includes('收到，我先看看目录。'))
    const final = messages.findIndex(message => message.role === 'assistant' && message.text.includes('分步干完了：'))
    assert.ok(progress >= 0 && final > progress, 'The group did not receive progress followed by the final result')
  })
  if (process.env.MOBILE_PARITY === '1') await parity(createdBots[0])
  await step('cancel parks the queue; a later send resumes the retained request', async () => {
    await settle()
    const before = stream.events.length
    await send(chief.id, '慢慢说')
    await waitFor(() => stream.events.slice(before).some(event => event.type === 'delta'), 'The slow turn did not begin streaming')
    const queuedText = `queued-after-cancel-${randomUUID()}`
    const retained = await send(chief.id, queuedText)
    const removedText = `remove-from-queue-${randomUUID()}`
    const removed = await send(chief.id, removedText)
    const cancelled = await mobile.cancel(chief.id)
    assert.equal(cancelled.queueCleared, false)
    await settle()
    const queued = await mobile.action('queue', { conversationId: chief.id })
    const removal = queued.items.find(item => item.text.includes(removedText))
    assert.ok(removal && queued.items.some(item => item.text.includes(queuedText)), 'Cancellation did not preserve both pending queue entries')
    assert.ok(queued.items.some(item => item.requestId === retained.requestId), 'Queue receipt identity does not match the submitting device')
    await waitFor(() => stream.events.slice(before).some(event => event.type === 'status' && event.queue?.some(item => item.text.includes(queuedText))), 'Queued messages did not arrive over the live stream')
    await mobile.action('queue-remove', { conversationId: chief.id, sessionId: removed.sessionId, itemId: removal.id })
    const remaining = await mobile.action('queue', { conversationId: chief.id })
    assert.ok(!remaining.items.some(item => item.id === removal.id) && remaining.items.some(item => item.text.includes(queuedText)), 'Removing one queue entry changed another entry')
    await rejected(() => mobile.action('queue-remove', { conversationId: chief.id, sessionId: removed.sessionId, itemId: removal.id }), [409], 'A stale queue removal was accepted')
    const wakeText = `resume-after-cancel-${randomUUID()}`
    await send(chief.id, wakeText)
    await settle()
    const history = await mobile.messages(chief.id)
    assert.ok(history.messages.some(message => message.role === 'user' && message.text.includes(queuedText)), 'Cancellation removed the queued user message')
    assert.ok(!history.messages.some(message => message.role === 'user' && message.text.includes(removedText)), 'The removed queue entry was executed')
    assert.ok(history.messages.some(message => message.role === 'assistant' && message.text.includes(wakeText)), 'The parked queue did not resume after a new send')
  })
  await step('small history pages preserve stable IDs and read markers', async () => {
    const first = await mobile.messages(chief.id, { limit: 2 })
    assert.ok(first.messages.length > 0 && first.cursor, 'History did not provide a previous page cursor')
    const previous = await mobile.messages(chief.id, { cursor: first.cursor, limit: 2 })
    assert.ok(previous.messages.length > 0, 'Previous history page was empty')
    assert.ok(previous.messages.every(message => !first.messages.some(item => item.id === message.id)), 'History pages overlap')
    await mobile.markRead(chief.id, Math.max(...first.messages.map(message => message.seq)))
  })
  await step('team mutations persist and clean up through the same mobile API', async () => {
    while (createdRooms.length) {
      await mobile.action('delete-room', { id: createdRooms[0] })
      createdRooms.shift()
    }
    while (createdBots.length) {
      await mobile.action('delete-bot', { id: createdBots[0] })
      createdBots.shift()
    }
    const state = await mobile.state()
    assert.ok(!state.bots.some(bot => bot.name.startsWith('Mobile ')), 'Created Bots survived deletion')
    assert.ok(!state.rooms.some(room => room.name === 'Mobile Smoke Group'), 'Created group survived deletion')
  })
  await step('device revocation closes the live connection and invalidates refresh', async () => {
    const session = await tokenStore.get()
    const devices = await mobile.devices()
    assert.ok(devices.devices.some(device => device.id === session.deviceId), 'The paired device is not listed')
    await operator('device.revoke', { deviceId: session.deviceId, id: session.deviceId })
    await rejected(() => mobile.state(), [401, 403], 'A revoked device retained access')
    await waitFor(() => stream.statuses.includes('unauthorized') || stream.statuses.includes('closed'), 'Revoked WebSocket was not closed')
  })
  console.log(`\nmobile smoke: all ${passed} steps passed`)
} catch (error) {
  console.error(`FAIL mobile smoke after ${passed} steps: ${error.message}`)
  process.exitCode = 1
} finally {
  for (const connection of connections) connection.close()
  for (const task of createdTasks) await desktop('schedule-delete', task).catch(() => {})
  for (const name of createdSecrets) await desktop('secret-delete', { name }).catch(() => {})
  for (const record of createdAgentSessions) await desktop('agent-archive', record).catch(() => {})
  for (const agentId of createdAgents) await desktop('remove-agent', { agentId }).catch(() => {})
  if (createdRooms.length || createdBots.length) {
    // Cleanup also works after the test device was revoked or its network failed.
    for (const id of createdRooms) await desktop('delete-room', { id }).catch(() => {})
    for (const id of createdBots) await desktop('delete-bot', { id }).catch(() => {})
  }
  const remainingSession = await tokenStore.get()
  if (remainingSession) await operator('device.revoke', { id: remainingSession.deviceId }).catch(() => {})
  mobile.dispose()
}
