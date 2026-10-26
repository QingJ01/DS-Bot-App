import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAdapter } from '../src/mobile/adapter.js'
import { createTextAccumulator, projectRecords } from '../src/mobile/projection.js'

const user = (seq, text, more = {}) => ({ type: 'event', event: { type: 'user/message', seq, time: 1000 + seq,
  data: { content: [{ type: 'text', text }], source: { kind: 'user', rpcId: `request-${seq}` }, ...more } } })
const assistant = (seq, text, turn = 1) => ({ type: 'event', event: { type: 'assistant/message', seq, time: 1000 + seq,
  data: { turn, message: { content: [{ type: 'text', text }] } } } })
const snapshot = (records = [], more = {}) => ({ type: 'snapshot', cursor: records.at(-1)?.event.seq ?? -1, records, hasMore: false, ...more })
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString())
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/alUAAAAASUVORK5CYII=', 'base64')

function fixture() {
  const view = { revision: 4, mainBotIds: ['b1'],
    bots: [{ id: 'b1', name: 'Chief', sessionId: 'new', parts: ['old'], model: 'p/m' }, { id: 'b2', name: 'Peer', sessionId: 'peer', parts: [] }],
    rooms: [{ id: 'room', name: 'Group', members: ['b1', 'b2'], parts: ['hidden-member-session'] }],
    models: [{ ref: 'p/m', id: 'm' }], activity: { b1: 'thinking' }, questions: {},
    secrets: ['do-not-expose'], secretRequests: {}, connectors: ['do-not-expose'], agents: [{ id: 'ordinary-agent' }],
  }
  const calls = []
  const pages = new Map([['new', snapshot([user(4, 'newest')])], ['old', snapshot([user(1, 'earliest')])], ['room', snapshot()]])
  const extra = []
  const rt = {
    state: { exchangeTurns: {} }, readOnly: () => undefined,
    teamCall: async (endpoint, payload) => { calls.push(['team', endpoint, payload]); return { ok: true, value: view } },
    ctx: { sessionController: {
      async *follow(request, signal) {
        calls.push(['follow', request])
        try {
          signal.throwIfAborted()
          yield pages.get(request.address.sessionId) ?? snapshot()
          yield* extra
        } finally { calls.push(['closed', request.address.sessionId]) }
      },
      page: async request => { calls.push(['page', request]); return { records: [user(0, 'older page')], hasMore: false } },
      prompt: async request => { calls.push(['prompt', request]); return { accepted: true } },
      cancel: async request => { calls.push(['cancel', request]); return { accepted: true } },
      attachment: async request => { calls.push(['attachment', request]); return { attachment: { mediaType: 'image/png' }, data: png.toString('base64') } },
    }, fileUploads: { uploadStream: async request => { calls.push(['file', request]); return { receiptId: 'dsh-receipt' } } } },
  }
  return { rt, view, calls, pages, extra, adapter: createAdapter(rt) }
}

test('conversation activity timestamps come only from the owned public session summary', async () => {
  const { rt, view, adapter } = fixture()
  view.agents = [{id:'agent-one',name:'Agent',sessions:['agent-chat']}]
  rt.ctx.sessionController.list = async () => ({items:[
    {sessionId:'new',updatedAt:100,running:false},
    {sessionId:'room',updatedAt:'2026-10-14T08:00:00Z',running:true},
    {sessionId:'agent-chat',updatedAt:300,running:false},
    {sessionId:'foreign',updatedAt:900,private:'do-not-expose'},
  ]})
  const { conversations } = await adapter.conversations()
  assert.equal(conversations.find(item=>item.id==='b1').updatedAt,100)
  assert.equal(conversations.find(item=>item.id==='room').updatedAt,'2026-10-14T08:00:00Z')
  assert.equal(conversations.find(item=>item.kind==='agent').updatedAt,300)
  assert.equal(conversations.some(item=>item.sessionId==='foreign'),false)
  assert.equal(JSON.stringify(conversations).includes('do-not-expose'),false)
})

test('mobile resumes only an owned writable group and projects the returned state', async () => {
  const { rt, view, adapter, calls } = fixture()
  view.rooms[0].paused = [{ id: 'b1', name: 'Chief' }]
  const result = await adapter.action('room-continue', { roomId: 'room', ignored: 'private' })
  assert.deepEqual(calls.find(call => call[1] === 'room-continue'), ['team', 'room-continue', { roomId: 'room' }])
  assert.deepEqual(result.rooms[0].paused, view.rooms[0].paused)
  assert.deepEqual(result.rooms[0].parts, [])
  assert.equal(JSON.stringify(result).includes('do-not-expose'), false)
  await assert.rejects(adapter.action('room-continue', { roomId: 'foreign' }), { status: 404 })
  rt.readOnly = () => 'Another host owns this team'
  await assert.rejects(adapter.action('room-continue', { roomId: 'room' }), { status: 409 })
  assert.equal(calls.filter(call => call[1] === 'room-continue').length, 1)
})

test('mobile working folders forward only reviewed fields and validate team ownership', async () => {
  const { adapter, calls } = fixture()
  await adapter.action('update-bot', { id: 'b1', workDir: '/srv/project', ignored: 'private' })
  assert.deepEqual(calls.at(-1), ['team', 'update-bot', { id: 'b1', workDir: '/srv/project' }])
  await adapter.action('update-room', { id: 'room', workDir: '' })
  assert.deepEqual(calls.at(-1), ['team', 'update-room', { id: 'room', workDir: '' }])
  await assert.rejects(adapter.action('update-bot', { id: 'other', workDir: '/srv/project' }), { status: 404 })
  for (const workDir of [null, [], 12, 'a'.repeat(4097)]) await assert.rejects(adapter.action('update-bot', { id: 'b1', workDir }), { status: 400 })
  await assert.rejects(adapter.action('folder-pick'), { status: 404 })
})

test('mobile folder browsing passes cancellation and never offers a host-native chooser', async () => {
  const { rt, adapter } = fixture()
  rt.teamCall = async (endpoint, payload, signal) => {
    assert.ok(signal instanceof AbortSignal)
    if (endpoint === 'folders') return { ok: true, value: { team: '/srv/team', picker: 'native', folders: [] } }
    assert.equal(endpoint, 'folder-list'); assert.deepEqual(payload, { path: '/srv/project' })
    return { ok: true, value: { path: payload.path, entries: [], crumbs: [] } }
  }
  assert.equal((await adapter.action('folders')).picker, null)
  assert.equal((await adapter.action('folder-list', { path: '/srv/project' })).path, '/srv/project')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(adapter.action('folder-list', {}, controller.signal), { name: 'AbortError' })
})

function fileFixture({ bytes = 4, records, chunks = [Buffer.from('test')] } = {}) {
  const value = fixture()
  const ref = { attachmentId: 'owned-file', name: '资料.txt', bytes }
  const record = user(12, 'visible attachment')
  record.event.data.content.push({ type: 'file', attachment: ref })
  value.rt.ctx.sessionController.page = async request => {
    value.calls.push(['file-page', request]); return { records: records ?? [record], hasMore: false }
  }
  value.rt.ctx.attachments = { async *readFileStream(actual, signal) {
    value.calls.push(['read-file', actual]); signal.throwIfAborted(); yield* chunks
  } }
  return { ...value, ref, record }
}
test('file download uses the exact visible message reference and verified public stream', async () => {
  const { adapter, calls, ref } = fileFixture()
  const result = await adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 12 })
  assert.equal(result.file, true)
  assert.equal(Buffer.from(result.data, 'base64').toString(), 'test')
  assert.equal(result.attachment.name, '资料.txt')
  assert.deepEqual(calls.find(call => call[0] === 'file-page')[1], { address: { kind: 'session', sessionId: 'new' }, throughSeq: 12, maxMessages: 1 })
  assert.deepEqual(calls.find(call => call[0] === 'read-file')[1], ref)
})
test('file download rejects foreign Sessions, IDs and message positions before reading bytes', async () => {
  const { adapter, calls } = fileFixture()
  await assert.rejects(adapter.attachment('b1', 'peer', 'owned-file', undefined, { seq: 12 }), { status: 404 })
  await assert.rejects(adapter.attachment('b1', 'new', 'foreign-file', undefined, { seq: 12 }), { status: 404 })
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 13 }), { status: 404 })
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: -1 }), { status: 400 })
  assert.equal(calls.some(call => call[0] === 'read-file'), false)
})
test('file downloads never expose hidden internal messages', async () => {
  const { adapter, record, calls } = fileFixture()
  record.event.data.source = { kind: 'tool', name: 'bot_chat' }
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 12 }), { status: 404 })
  assert.equal(calls.some(call => call[0] === 'read-file'), false)
})
test('file downloads verify size and completion before exposing any bytes', async () => {
  for (const options of [{ bytes: 5 }, { bytes: 3 }, { bytes: 21 * 1024 * 1024 }]) {
    const { adapter } = fileFixture(options)
    await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 12 }), { status: options.bytes > 20 * 1024 * 1024 ? 413 : 503 })
  }
  const { adapter, rt } = fileFixture()
  rt.ctx.attachments.readFileStream = async function* () { yield Buffer.from('test'); throw new Error('/private/path: integrity failure') }
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 12 }), err => err.status === 503 && !err.message.includes('/private/path'))
})
test('file downloads honour caller cancellation and recheck Session ownership', async () => {
  const { adapter, rt, view } = fileFixture()
  const controller = new AbortController(); controller.abort()
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', controller.signal, { seq: 12 }), { name: 'AbortError' })
  rt.ctx.attachments.readFileStream = async function* () { yield Buffer.from('test'); view.bots[0].sessionId = 'replacement' }
  await assert.rejects(adapter.attachment('b1', 'new', 'owned-file', undefined, { seq: 12 }), { status: 404 })
})

test('mobile state and mutation responses expose administration metadata without credential values or hidden Sessions', async () => {
  const { adapter } = fixture()
  for (const value of [await adapter.state(), await adapter.action('delete-bot', { id: 'b2' })]) {
    assert.deepEqual(value.secrets, [])
    assert.deepEqual(value.secretRequests, {})
    assert.deepEqual(value.connectors, [])
    assert.deepEqual(value.agents, [])
    assert.deepEqual(value.rooms[0].parts, [])
  }
  const { conversations } = await adapter.conversations()
  assert.equal(conversations.length, 3)
  assert.equal(conversations[0].activity, 'thinking')
  assert.deepEqual(conversations.find(item => item.kind === 'room').parts, [])
})

test('mobile state projects private views and owned side chats without model HTML or secrets', async () => {
  const { rt, view, adapter } = fixture()
  rt.redactSecrets = value => value.replaceAll('SECRET', '[redacted]')
  view.views = {
    new: { id: 'view-1', title: 'SECRET title', askedAt: 10, view: { type: 'stack', children: [
      { type: 'text', text: 'SECRET summary' },
      { type: 'html', html: '<script>SECRET</script>', summary: 'SECRET summary' },
      { type: 'sources', items: [{ label: 'SECRET source', url: 'https://example.test/path?token=SECRET' }] },
    ] } },
    'hidden-member-session': { id: 'foreign', title: 'foreign', askedAt: 11, view: { type: 'text', text: 'foreign' } },
  }
  view.sideChats = {
    b1: [{ id: 'chat-1', botId: 'b1', createdAt: 1, updatedAt: 2, entries: [
      { id: 'entry-1', question: 'SECRET question', answer: 'SECRET answer', status: 'done', createdAt: 1, finishedAt: 2, error: 'SECRET error' },
      { id: 'bad', question: 3, answer: 'hidden', status: 'done' },
    ] }],
    unknown: [{ id: 'foreign-chat', botId: 'unknown', entries: [] }],
  }
  const state = await adapter.state()
  assert.equal(state.sideChatAvailable, true)
  assert.equal(state.views.new.conversationId, 'b1')
  assert.equal(state.views.new.view.children[1].html, '<p>HTML view is unavailable on mobile.</p>')
  assert.equal(state.views.new.view.children[1].summary, '[redacted] summary')
  assert.equal(state.views.new.view.children[2].items[0].url, 'https://example.test/path')
  assert.equal(state.views.new.view.children[2].items.length, 1)
  assert.equal(state.views['hidden-member-session'], undefined)
  assert.equal(state.sideChats.unknown, undefined)
  assert.equal(state.sideChats.b1[0].entries.length, 1)
  assert.equal(JSON.stringify(state).includes('SECRET'), false)
})

test('mobile view and side actions require private ownership and preserve the side host delegation', async () => {
  const { rt, view, adapter, calls } = fixture()
  view.views = { new: { id: 'view-1', title: 'Question', askedAt: 10, view: { type: 'confirm', id: 'confirm-1' } } }
  view.sideChats = { b1: [{ id: 'chat-1', botId: 'b1', entries: [{ id: 'entry-1', question: 'q', answer: '', status: 'answering' }] }] }
  await adapter.action('view-reply', { sessionId: 'new', viewId: 'view-1', action: 'confirm', values: {} })
  assert.deepEqual(calls.at(-1), ['team', 'view-reply', { sessionId: 'new', viewId: 'view-1', action: 'confirm', values: {} }])
  await adapter.action('dismiss-view', { sessionId: 'old', viewId: 'view-1' })
  assert.deepEqual(calls.at(-1), ['team', 'dismiss-view', { sessionId: 'new', viewId: 'view-1' }])
  await adapter.action('side-ask', { sessionId: 'new', chatId: 'chat-1', text: 'follow up' })
  assert.deepEqual(calls.at(-1), ['team', 'side-ask', { sessionId: 'new', chatId: 'chat-1', text: 'follow up' }])
  await assert.rejects(adapter.action('side-cancel', { sessionId: 'peer', chatId: 'chat-1', entryId: 'entry-1' }), { status: 404 })
  await assert.rejects(adapter.action('side-close', { sessionId: 'peer', chatId: 'chat-1' }), { status: 404 })
  await assert.rejects(adapter.action('side-close', { sessionId: 'new', chatId: 'missing' }), { status: 404 })
  await assert.rejects(adapter.action('dismiss-view', { sessionId: 'new', viewId: 'replacement' }), { status: 409 })
  rt.readOnly = () => 'locked'
  await assert.rejects(adapter.action('side-new', { sessionId: 'new' }), { status: 409 })
})

test('legacy mobile /side is refused before uploads while /sidechat remains ordinary text', async () => {
  const { adapter, calls } = fixture()
  await assert.rejects(adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'side-1', text: '/side summarize', attachments: ['expired'] }), { code: 'mobile/side-unsupported' })
  assert.equal(calls.some(call => call[0] === 'prompt'), false)
  await adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'sidechat-1', text: '/sidechat summarize', attachments: [] })
  assert.equal(calls.at(-1)[0], 'prompt')
})

test('historical successful show_view keeps its full blueprint beside truncated tool input', () => {
  const longView = { type: 'stack', children: [0, 1, 2, 3].map(() => ({ type: 'text', text: 'x'.repeat(1900) })) }
  const records = [
    { event: { type: 'tool/call', seq: 1, time: 1, data: { callId: 'view-call', name: 'show_view', arguments: JSON.stringify({ title: 'Long', view: longView }) } } },
    { event: { type: 'tool/result', seq: 2, time: 2, data: { callId: 'view-call', message: { content: [{ type: 'text', text: 'The view is on screen.' }] } } } },
    { event: { type: 'tool/call', seq: 3, time: 3, data: { callId: 'bad-view', name: 'show_view', arguments: JSON.stringify({ title: 'Bad', view: { type: 'text', text: 'not shown' } }) } } },
    { event: { type: 'tool/result', seq: 4, time: 4, data: { callId: 'bad-view', message: { isError: true, content: [{ type: 'text', text: 'The view was refused.' }] } } } },
  ]
  const [message, rejected] = projectRecords(records, { sessionId: 'new', redact: text => text })
  assert.equal(message.tool.input.endsWith('[Detail truncated]'), true)
  assert.deepEqual(message.tool.view, { title: 'Long', view: longView })
  assert.equal(rejected.tool.view, undefined)
})

test('logical conversation IDs cannot be replaced by arbitrary or hidden Session IDs', async () => {
  const { adapter, calls } = fixture()
  for (const id of ['new', 'old', 'ordinary-agent', 'hidden-member-session', '../../data']) {
    await assert.rejects(adapter.history(id), { status: 404 })
    await assert.rejects(adapter.cancel(id), { status: 404 })
  }
  await assert.rejects(adapter.attachment('b1', 'peer', 'image'), { status: 404 })
  assert.equal(calls.some(call => ['follow', 'cancel', 'attachment'].includes(call[0])), false)
})

test('history traverses current and earlier parts with bounded, conversation-bound cursors', async () => {
  const { adapter, calls } = fixture()
  const first = await adapter.history('b1', { limit: 20 })
  assert.equal(first.messages[0].id, 'new:4')
  assert.equal(first.messages[0].requestId, 'request-4')
  assert.equal(decode(first.cursor).sessionId, 'old')
  const previous = await adapter.history('b1', { cursor: first.cursor })
  assert.equal(previous.messages[0].text, 'earliest')
  assert.equal(previous.cursor, null)
  assert.equal(calls.filter(call => call[0] === 'closed').length, 2)
  await assert.rejects(adapter.history('b2', { cursor: first.cursor }), { code: 'mobile/invalid-cursor' })
  await assert.rejects(adapter.history('b1', { cursor: encode({ v: 1, conversationId: 'b1', sessionId: 'foreign' }) }), { status: 404 })
  await assert.rejects(adapter.history('b1', { limit: 10000 }), { status: 400 })
})

test('history pages use the opening log cut and reject forged numeric cursor fields', async () => {
  const { adapter, pages, calls } = fixture()
  pages.set('new', snapshot([user(4, 'newest')], { hasMore: true, cursor: 10 }))
  const first = await adapter.history('b1')
  assert.deepEqual(decode(first.cursor), { v: 1, conversationId: 'b1', sessionId: 'new', throughSeq: 10, beforeSeq: 4 })
  await adapter.history('b1', { cursor: first.cursor })
  assert.equal(calls.find(call => call[0] === 'page')[1].throughSeq, 10)
  for (const patch of [{ throughSeq: -2 }, { throughSeq: 1.1 }, { throughSeq: 3, beforeSeq: 4 }, { beforeSeq: 2 }]) {
    await assert.rejects(adapter.history('b1', { cursor: encode({ v: 1, conversationId: 'b1', sessionId: 'new', ...patch }) }), { status: 400 })
  }
})

test('history exposes durable attachment metadata but omits private context and hidden turns', () => {
  const records = [user(0, 'photo', { content: [{ type: 'image', attachment: { attachmentId: 'hash', mediaType: 'image/png', bytes: 80, width: 1, height: 1 } }] }),
    user(1, 'private context', { source: { kind: 'ds-bot', handoff: true } }), assistant(2, 'hidden', 4), assistant(3, 'shown', 5)]
  const messages = projectRecords(records, { sessionId: 's', hiddenTurns: [4] })
  assert.deepEqual(messages.map(message => message.id), ['s:0', 's:3'])
  assert.deepEqual(messages[0].attachments, [{ id: 'hash', type: 'image', name: 'Image', size: 80, mediaType: 'image/png', width: 1, height: 1 }])
})

test('group replies are projected from the group relay result with stable authors and IDs', () => {
  const records = [{ type: 'event', event: { type: 'tool/call', seq: 1, data: { callId: 'c', name: 'group_relay' } } },
    { type: 'event', event: { type: 'tool/result', seq: 2, time: 200, data: { message: { source: { callId: 'c' }, content: [{ type: 'text',
      text: JSON.stringify({ replies: [{ botId: 'b1', name: 'Chief', text: 'One', time: 100 }, { botId: 'b2', name: 'Peer', text: 'Two' }] }) }] } } } }]
  const messages = projectRecords(records, { sessionId: 'room', kind: 'room' })
  assert.deepEqual(messages.map(message => message.id), ['room:2:reply:0', 'room:2:reply:1'])
  assert.deepEqual(messages[0].author, { id: 'b1', name: 'Chief' })
  assert.equal(projectRecords(records, { sessionId: 'room', kind: 'bot' }).length, 0)
  const post = user(3, '[Group post from Chief]\nA public group post', { source: { kind: 'bot', role: 'post', senderSessionId: 'b1', senderName: 'Chief' } })
  assert.equal(projectRecords([post], { sessionId: 'room', kind: 'room' })[0].text, 'A public group post')
  assert.equal(projectRecords([post], { sessionId: 'room', kind: 'bot' }).length, 0)
})

test('streaming uses cumulative text, authoritative block ends, and a final attempt clear', async () => {
  const { adapter, extra } = fixture()
  const live = frame => ({ type: 'assistant-stream', frame })
  extra.push(live({ type: 'start', attemptId: 'attempt', revision: 1 }),
    live({ type: 'chunk', attemptId: 'attempt', index: 0, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }),
    live({ type: 'chunk', attemptId: 'attempt', index: 0, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }),
    live({ type: 'chunk', attemptId: 'attempt', index: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'private reasoning' } }),
    live({ type: 'chunk', attemptId: 'attempt', index: 2, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } } }),
    live({ type: 'end', attemptId: 'attempt', outcome: { kind: 'committed', seq: 5 } }), assistant(5, 'Hello'))
  const events = []
  for await (const event of adapter.follow('b1')) events.push(event)
  assert.equal(events[0].type, 'reset')
  assert.deepEqual(events.filter(event => event.type === 'delta').map(event => event.text), ['Hel', 'Hel', 'Hello'])
  assert.equal(events.find(event => event.clearAttempt).attemptId, 'attempt')
  assert.equal(events.find(event => event.type === 'message').replaceAttemptId, 'attempt')
  assert.equal(events.filter(event => event.type === 'delta').at(-1).reasoning, 'private reasoning')
})

test('a durable assistant message replaces its stream even when the end marker arrives afterwards', async () => {
  const { adapter, extra } = fixture()
  const final = assistant(8, 'Completed', 2)
  final.event.data.step = 1
  extra.push({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a', turn: 2, step: 1 } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', index: 0, chunk: { type: 'text-delta', index: 0, text: 'Com' } } },
    final, { type: 'assistant-stream', frame: { type: 'end', attemptId: 'a', outcome: { kind: 'committed', seq: 8 } } })
  const events = []
  for await (const event of adapter.follow('b1')) events.push(event)
  assert.equal(events.find(event => event.type === 'message').replaceAttemptId, 'a')
})

test('reconnecting reconstructs the partial assistant text from the public compact baseline', async () => {
  const { adapter, pages } = fixture()
  pages.set('new', snapshot([], { assistantStream: { activeAttempt: { attemptId: 'a', nextIndex: 3, stream: [
    { type: 'text-chunks', index: 0, texts: ['Hello', ' world'] }, { type: 'reasoning-chunks', index: 1, texts: ['hidden'] },
  ] } } }))
  const events = []
  for await (const event of adapter.follow('b1', { after: 'old-cursor' })) events.push(event)
  assert.equal(events[1].text, 'Hello world')
  assert.equal(events[1].replace, true)
  const accumulator = createTextAccumulator([{ type: 'text-chunks', index: 1, texts: ['B'] }])
  accumulator.accept({ type: 'text-delta', index: 0, text: 'A' })
  assert.equal(accumulator.text(), 'A\nB')
})

test('hidden Bot exchange turns do not leak through live or reconnect assistant text', async () => {
  const { adapter, rt, pages, extra } = fixture()
  rt.state.exchangeTurns.new = [7]
  pages.set('new', snapshot([], { assistantStream: { activeAttempt: { attemptId: 'past', turn: 7, nextIndex: 1,
    stream: [{ type: 'text-chunks', index: 0, texts: ['hidden baseline'] }] } } }))
  extra.push({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a', turn: 7 } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', index: 0, chunk: { type: 'text-delta', index: 0, text: 'hidden live' } } },
    assistant(10, 'hidden final', 7))
  const events = []
  for await (const event of adapter.follow('b1')) events.push(event)
  assert.equal(events.some(event => event.type === 'delta' || event.type === 'message'), false)
  assert.equal(JSON.stringify(events).includes('hidden baseline'), false)
})

test('submit retains the client request ID and refuses a stale part before prompt admission', async () => {
  const { adapter, calls } = fixture()
  const result = await adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'stable-request', text: 'Hello' })
  assert.deepEqual(result, { accepted: true, conversationId: 'b1', sessionId: 'new', requestId: 'stable-request' })
  assert.equal(calls.find(call => call[0] === 'prompt')[1].requestId, 'stable-request')
  await assert.rejects(adapter.submit({ conversationId: 'b1', sessionId: 'old', requestId: 'r2', text: 'Hello' }), { status: 409 })
  assert.equal(calls.filter(call => call[0] === 'prompt').length, 1)
})

test('documented admission refusals become actionable HTTP errors but uncertain failures stay uncertain', async () => {
  const { adapter, rt } = fixture()
  const send = () => adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'r', text: 'Hello' })
  for (const [code, status] of [['session/model-unavailable', 409], ['session/attachment-invalid', 422], ['session/not-found', 404], ['session/provider-credentials-unavailable', 409]]) {
    rt.ctx.sessionController.prompt = async () => { throw Object.assign(new Error('private host configuration details'), { code }) }
    await assert.rejects(send(), cause => cause.code === code && cause.status === status && !cause.message.includes('private host'))
  }
  for (const code of ['gateway/internal', 'gateway/cancelled', 'session/agent-busy', 'ECONNRESET']) {
    rt.ctx.sessionController.prompt = async () => { throw Object.assign(new Error('uncertain admission'), { code }) }
    await assert.rejects(send(), cause => cause.code === code && cause.status === undefined)
  }
})

test('receipt recovery only confirms public queue or historical evidence and never resends', async () => {
  const { adapter, rt, calls } = fixture()
  rt.ctx.sessionController.projections = async () => ({ values: { inbox: { 'next-turn': [{ source: { kind: 'user', rpcId: 'queued' } }] } } })
  assert.equal((await adapter.reconcile({ conversationId: 'b1', sessionId: 'new', requestId: 'queued' })).accepted, true)
  assert.equal((await adapter.reconcile({ conversationId: 'b1', sessionId: 'old', requestId: 'request-1' })).accepted, true)
  assert.equal(await adapter.reconcile({ conversationId: 'b1', sessionId: 'new', requestId: 'missing-or-compacted' }), null)
  await assert.rejects(adapter.reconcile({ conversationId: 'b1', sessionId: 'peer', requestId: 'queued' }), { status: 404 })
  assert.equal(calls.some(call => call[0] === 'prompt'), false)
})

test('cancel only stops the active turn and does not mutate the inbox', async () => {
  const { adapter, calls } = fixture()
  const result = await adapter.cancel('b1')
  assert.equal(result.queueCleared, false)
  assert.deepEqual(calls.find(call => call[0] === 'cancel')[1], { sessionId: 'new' })
  assert.equal(calls.some(call => call[0] === 'prompt'), false)
})

test('pending human input is projected separately and removing it never clears the whole inbox', async () => {
  const { adapter, rt, calls } = fixture()
  rt.ctx.sessionController.projections = async () => ({ values: { inbox: {
    'next-turn': [{ id: 'human', source: { kind: 'user', rpcId: 'r' }, content: [{ type: 'text', text: 'Later' }] },
      { id: 'internal', source: { kind: 'bot' }, content: [{ type: 'text', text: 'Internal handoff' }] }], 'next-step': [],
  } } })
  rt.ctx.sessionController.updateQueue = async request => { calls.push(['queue-update', request]); return { accepted: true } }
  const pending = await adapter.action('queue', { conversationId: 'b1' })
  assert.deepEqual(pending, { sessionId: 'new', items: [{ id: 'human', requestId: 'r', text: 'Later', target: 'next-turn' }] })
  await assert.rejects(adapter.action('queue-remove', { conversationId: 'b1', sessionId: 'old', itemId: 'human' }), { status: 409 })
  await assert.rejects(adapter.action('queue-remove', { conversationId: 'b1', sessionId: 'new', itemId: 'internal' }), { status: 409 })
  await adapter.action('queue-remove', { conversationId: 'b1', sessionId: 'new', itemId: 'human' })
  assert.deepEqual(calls.find(call => call[0] === 'queue-update')[1], { sessionId: 'new', itemId: 'human', action: { kind: 'remove' } })
})

test('follow emits a queue baseline and durable inbox splices without inventing transcript messages', async () => {
  const { adapter, pages, extra } = fixture()
  const queued = { id: 'q1', source: { kind: 'user', rpcId: 'queued' }, content: [{ type: 'text', text: 'Waiting' }] }
  pages.set('new', snapshot([], { projections: { values: { inbox: { 'next-turn': [queued], 'next-step': [] } } } }))
  extra.push({ type: 'event', event: { type: 'agent/inbox/spliced', seq: 1,
    data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } } })
  const events = []
  for await (const event of adapter.follow('b1')) events.push(event)
  assert.deepEqual(events.filter(event => event.queue).map(event => event.queue.length), [1, 0])
  assert.equal(events.some(event => event.type === 'message'), false)
})

test('uploads stay transient until submission and receipts cannot cross conversations', async () => {
  const { adapter, calls } = fixture()
  const receipt = await adapter.upload('b1', 'new', { name: '../../note.txt', mediaType: 'text/plain' }, Buffer.from('A note'))
  assert.equal(receipt.name, 'note.txt')
  assert.equal(calls.some(call => call[0] === 'file'), false)
  await assert.rejects(adapter.submit({ conversationId: 'b2', sessionId: 'peer', requestId: 'wrong', attachments: [receipt] }), { status: 409 })
  await adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'file-message', attachments: [receipt] })
  assert.deepEqual(calls.find(call => call[0] === 'prompt')[1].content, [{ type: 'file', receiptId: 'dsh-receipt' }])
  assert.equal(calls.filter(call => call[0] === 'file').length, 1)
})

test('images are staged with validated media types and admitted through public prompt content', async () => {
  const { adapter, calls } = fixture()
  await assert.rejects(adapter.upload('b1', 'new', { name: 'fake.png', mediaType: 'image/png' }, Buffer.from('not an image')), { status: 415 })
  await assert.rejects(adapter.upload('b1', 'new', { name: 'program.txt', mediaType: 'invalid mime' }, Buffer.from([0, 1, 2])), { status: 415 })
  const receipt = await adapter.upload('b1', 'new', { name: 'photo.png', mediaType: 'image/png' }, png)
  await adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'image-message', attachments: [receipt.receiptId] })
  const content = calls.find(call => call[0] === 'prompt')[1].content
  assert.equal(content[0].type, 'image')
  assert.equal(content[0].data, png.toString('base64'))
  assert.equal(calls.some(call => call[0] === 'file'), false)
})

test('part switches during upload I/O cannot send the file to the wrong Session', async () => {
  const { adapter, rt, view, calls } = fixture()
  rt.ctx.fileUploads.uploadStream = async () => { view.bots[0].sessionId = 'next'; return { receiptId: 'dsh' } }
  const receipt = await adapter.upload('b1', 'new', { name: 'note.md', mediaType: 'text/markdown' }, Buffer.from('text'))
  await assert.rejects(adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: 'switch', attachments: [receipt] }), { status: 409 })
  assert.equal(calls.some(call => call[0] === 'prompt'), false)
})

test('actions allow only team resources and drop arbitrary path and Session parameters', async () => {
  const { adapter, calls } = fixture()
  for (const endpoint of ['browser-result', 'agent-adopt', 'send', 'arbitrary-host-action']) {
    await assert.rejects(adapter.action(endpoint, {}), { status: 404 })
  }
  await assert.rejects(adapter.action('update-bot', { id: 'foreign', name: 'X' }), { status: 404 })
  await assert.rejects(adapter.action('create-room', { members: ['b1', 'foreign'] }), { status: 404 })
  await assert.rejects(adapter.action('memory-view', { botId: 'foreign' }), { status: 404 })
  await assert.rejects(adapter.action('answer-question', { sessionId: 'foreign', questionId: 'q' }), { status: 404 })
  await adapter.action('update-bot', { id: 'b1', name: 'New', path: '/host', sessionId: 'foreign' })
  assert.deepEqual(calls.find(call => call[1] === 'update-bot')[2], { id: 'b1', name: 'New' })
})

test('parity metadata retains flags and group settings while sanitizing credentials and agent records', async () => {
  const { adapter, view } = fixture()
  Object.assign(view, { workspaceId: 'workspace', colors: ['blue'], modelsKey: 'models-1', prefs: { theme: 'mono' } })
  Object.assign(view.bots[0], { pinned: true, hidden: true, avatar: { shape: 'leaf' } })
  Object.assign(view.rooms[0], { admin: 'b1', mode: 'everyone', notice: 'Group notice', pinned: true })
  view.secrets = [{ name: 'TEST_KEY', purpose: 'Testing', scope: ['b1'], value: 'ds-bot-test-private' }]
  view.secretRequests = { b1: [{ id: 'request', name: 'TEST_KEY', sessionId: 'old', status: 'pending', value: 'ds-bot-test-private' }], foreign: [{ id: 'hidden' }] }
  view.questions = { 'hidden-member-session': { id: 'group-question', header: 'Plan', detail: 'Choose next', options: [{ label: 'Yes', description: 'Proceed' }], multiSelect: true }, foreign: { id: 'unowned' } }
  view.connectors = [{ id: 'github', name: 'GitHub', state: 'ready', account: 'mock', token: 'ds-bot-test-private' }]
  view.agents = [{ id: 'agent-one', name: 'DSH Agent', sessions: ['agent-chat'], config: { secret: 'ds-bot-test-private' } }]
  const state = await adapter.state()
  assert.equal(state.workspaceId, 'workspace')
  assert.equal(state.modelsKey, 'models-1')
  assert.deepEqual(state.colors, ['blue'])
  assert.equal(JSON.stringify(state).includes('ds-bot-test-private'), false)
  assert.equal(state.secretRequests.foreign, undefined)
  assert.equal(state.secretRequests.b1[0].conversationId, 'b1')
  assert.equal(state.secretRequests.b1[0].sessionId, 'old')
  assert.equal(state.questions['hidden-member-session'].conversationId, 'room')
  assert.equal(state.questions['hidden-member-session'].options[0].description, 'Proceed')
  assert.equal(state.questions.foreign, undefined)
  const { conversations } = await adapter.conversations()
  assert.equal(conversations[0].pinned, true)
  assert.equal(conversations[0].hidden, true)
  assert.equal(conversations.find(item => item.kind === 'room').mode, 'everyone')
  assert.equal(conversations.find(item => item.kind === 'agent').id, 'agent:agent-one:agent-chat')
})

test('parts, search and context stay within logical conversation history and bind cursors to the query', async () => {
  const { adapter, rt, pages, calls } = fixture()
  rt.partsOf = () => [{ sessionId: 'old', number: 1, startedAt: 1, endedAt: 2 }, { sessionId: 'new', number: 2, startedAt: 2 }, { sessionId: 'foreign', number: 3 }]
  const parts = await adapter.action('parts', { conversationId: 'b1' })
  assert.equal(parts.parts.length, 2)
  assert.equal(decode(parts.parts[0].cursor).sessionId, 'old')
  const first = await adapter.action('search', { conversationId: 'b1', query: 'est', limit: 1 })
  assert.equal(first.messages[0].text, 'newest')
  assert.equal(first.complete, false)
  const last = await adapter.action('search', { conversationId: 'b1', query: 'est', limit: 1, cursor: first.cursor })
  assert.equal(last.messages[0].text, 'earliest')
  assert.equal(last.complete, true)
  await assert.rejects(adapter.action('search', { conversationId: 'b1', query: 'changed', cursor: first.cursor }), { status: 400 })
  await assert.rejects(adapter.action('search', { conversationId: 'b2', query: 'est', cursor: first.cursor }), { status: 400 })
  await assert.rejects(adapter.action('context', { conversationId: 'b1', sessionId: 'foreign', seq: 4 }), { status: 404 })
  pages.set('new', snapshot([user(4, 'focus'), user(8, 'later')]))
  const context = await adapter.action('context', { conversationId: 'b1', sessionId: 'new', seq: 4, limit: 4 })
  assert.equal(context.focusSeq, 4)
  assert.equal(calls.findLast(call => call[0] === 'page')[1].throughSeq, 6)
})

test('schedules, flags, exchanges and owned Agent administration validate resource identity before dispatch', async () => {
  const { adapter, rt, view, calls } = fixture()
  view.workspaceId = 'team-workspace'
  view.agents = [{ id: 'a1', name: 'Agent', sessions: ['a-session'] }]
  const tasks = [{ id: 'task', botId: 'b1', sessionId: 'old' }, { id: 'unrelated', sessionId: 'foreign' }]
  rt.teamCall = async (endpoint, payload) => {
    calls.push(['team', endpoint, payload])
    return { ok: true, value: endpoint === 'state' ? view : endpoint.startsWith('schedule') ? { available: true, tasks } : { accepted: true } }
  }
  assert.equal((await adapter.action('schedules')).tasks.length, 1)
  await assert.rejects(adapter.action('schedule-delete', { id: 'unrelated', sessionId: 'foreign' }), { status: 404 })
  await adapter.action('schedule-delete', { id: 'task', sessionId: 'old' })
  await assert.rejects(adapter.action('schedule-create', { target: 'foreign', title: 'Bad' }), { status: 404 })
  await adapter.action('set-flags', { id: 'room', pinned: true, hidden: false, arbitrary: 'drop' })
  assert.deepEqual(calls.find(call => call[1] === 'set-flags')[2], { id: 'room', pinned: true, hidden: false })
  await assert.rejects(adapter.action('exchange', { a: 'b1', b: 'foreign' }), { status: 404 })
  await adapter.action('exchange', { a: 'b1', b: 'b2' })
  await assert.rejects(adapter.action('agent-session', { agentId: 'a1', workspaceId: 'outside' }), { status: 403 })
  await assert.rejects(adapter.action('agent-archive', { agentId: 'a1', sessionId: 'old' }), { status: 404 })
  await adapter.action('agent-rename', { agentId: 'a1', sessionId: 'a-session', title: 'My task' })
  await adapter.history('agent:a1:a-session')
  await assert.rejects(adapter.history('a-session'), { status: 404 })
})

test('secret writes use team requests and Bot scopes and never return the stored value', async () => {
  const { adapter, rt, view, calls } = fixture()
  view.secrets = [{ name: 'EXISTING', scope: ['b1'] }]
  view.secretRequests = { b1: [{ id: 'pending', status: 'pending', name: 'NEW_KEY' }], foreign: [{ id: 'foreign', status: 'pending' }] }
  rt.teamCall = async (endpoint, payload) => {
    calls.push(['team', endpoint, payload])
    return { ok: true, value: endpoint === 'state' ? view : { name: payload.name ?? 'NEW_KEY', scope: ['b1'], value: 'ds-bot-test-private', token: 'ds-bot-test-private' } }
  }
  await assert.rejects(adapter.action('secret-set', { requestId: 'foreign', value: 'ds-bot-test-private' }), { status: 409 })
  await assert.rejects(adapter.action('secret-set', { name: 'NEW_KEY', value: 'ds-bot-test-private', scope: ['foreign'] }), { status: 404 })
  await assert.rejects(adapter.action('secret-update', { name: 'UNKNOWN', scope: 'all' }), { status: 404 })
  const saved = await adapter.action('secret-set', { name: 'NEW_KEY', value: 'ds-bot-test-private', scope: ['b1'] })
  assert.deepEqual(saved, { name: 'NEW_KEY', scope: ['b1'] })
  const granted = await adapter.action('secret-allow', { requestId: 'pending' })
  assert.equal(granted.value, undefined)
})

test('Harness settings use redacted controllers, current revisions and constrained paths', async () => {
  const { adapter, rt } = fixture()
  const changes = []
  const descriptor = { ns: 'display', revision: 3, value: { theme: 'mono' }, secrets: [], schema: {} }
  rt.ctx.settingsController = {
    describe: () => ({ writable: true, hasDocument: true, namespaces: [descriptor] }),
    mutate: async (...args) => { changes.push(args); return descriptor },
  }
  assert.equal((await adapter.action('settings-describe')).namespaces[0].revision, 3)
  const mutation = { ns: 'display', expectedRevision: 3, ops: [{ op: 'set', path: ['theme'], value: 'night' }] }
  await assert.rejects(adapter.action('settings-mutate', { ...mutation, expectedRevision: 2 }), { status: 409 })
  await assert.rejects(adapter.action('settings-mutate', { ...mutation, ns: 'unregistered' }), { status: 404 })
  await assert.rejects(adapter.action('settings-mutate', { ...mutation, ops: [{ op: 'set', path: ['__proto__', 'x'], value: true }] }), { status: 400 })
  assert.equal(changes.length, 0)
  await adapter.action('settings-mutate', mutation)
  assert.deepEqual(changes, [['display', mutation.ops, 3]])
})

test('Harness credential controllers expose metadata only and hide provider write failures', async () => {
  const { adapter, rt } = fixture()
  let writes = 0
  rt.ctx.credentialsController = {
    describe: refs => Object.fromEntries(refs.map(ref => [ref, { configured: writes > 0, writable: true, source: 'fixture' }])),
    set: async () => { writes++; if (writes > 1) throw new Error('ds-bot-test-private') },
    unset: async () => { writes = 0 },
  }
  const result = await adapter.action('credentials-set', { ref: 'TEST_KEY', value: 'ds-bot-test-private' })
  assert.deepEqual(result, { ref: 'TEST_KEY', configured: true, writable: true, source: 'fixture' })
  await assert.rejects(adapter.action('credentials-set', { ref: 'TEST_KEY', value: 'ds-bot-test-private' }), cause => cause.status === 400 && !cause.message.includes('ds-bot-test-private'))
  await assert.rejects(adapter.action('credentials-describe', { refs: ['../../outside'] }), { status: 400 })
})

test('browser read access only reveals owned open pages with credential-free addresses', async () => {
  const { adapter, rt } = fixture()
  rt.browserEnabled = true
  rt.redactSecrets = text => text.replaceAll('ds-bot-test-private', '[hidden]')
  rt.browserChannel = {
    openPages: () => ({ b1: { url: 'https://user:password@example.test/page?token=secret#hash', title: 'A page' }, foreign: { url: 'https://outside.test' } }),
    read: async () => ({ page: { url: 'https://example.test/page?token=secret', title: 'A page', text: 'ds-bot-test-private content' } }),
  }
  const list = await adapter.action('browser-pages')
  assert.deepEqual(list.pages, [{ botId: 'b1', url: 'https://example.test/page', title: 'A page' }])
  assert.equal((await adapter.action('browser-read', { botId: 'b1' })).page.text, '[hidden] content')
  await assert.rejects(adapter.action('browser-read', { botId: 'foreign' }), { status: 404 })
})

test('device revocation during action ownership checks prevents later team and queue mutations', async () => {
  const { adapter, rt, view, calls } = fixture()
  const controller = new AbortController()
  rt.teamCall = async endpoint => {
    if (endpoint !== 'state') calls.push(['mutation'])
    controller.abort()
    return { ok: true, value: view }
  }
  await assert.rejects(adapter.action('update-bot', { id: 'b1', name: 'Changed' }, controller.signal))
  assert.equal(calls.some(call => call[0] === 'mutation'), false)

  const second = fixture()
  const abortQueue = new AbortController()
  second.rt.ctx.sessionController.projections = async () => {
    abortQueue.abort()
    return { values: { inbox: { 'next-turn': [{ id: 'q', source: { kind: 'user' }, content: [] }] } } }
  }
  second.rt.ctx.sessionController.updateQueue = async () => { throw new Error('Must not mutate after revocation') }
  await assert.rejects(second.adapter.action('queue-remove', { conversationId: 'b1', sessionId: 'new', itemId: 'q' }, abortQueue.signal), { name: 'AbortError' })
})

test('usage excludes ordinary agents and other DSH Sessions and remaps owner indices', async () => {
  const { adapter, rt, view } = fixture()
  rt.teamCall = async endpoint => ({ ok: true, value: endpoint === 'state' ? view : {
    owners: [{ key: 'other', kind: 'other' }, { key: 'b1', kind: 'bot', id: 'b1' }],
    models: [], kinds: [], rows: [['hour', 0, 0, 0, 100], ['hour', 1, 0, 0, 20]],
  } })
  const value = await adapter.action('usage')
  assert.deepEqual(value.owners.map(owner => owner.id), ['b1'])
  assert.deepEqual(value.rows, [['hour', 0, 0, 0, 20]])
})

function wav(samples = 16) {
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  return bytes
}

test('optional speech service reports unavailable without falling back to a cloud provider', async () => {
  const { adapter } = fixture()
  assert.equal(adapter.capabilities().transcription, false)
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, wav()), { status: 503 })
})

test('optional Cordis services are read through get even when property access throws', async () => {
  const { adapter, rt } = fixture()
  Object.defineProperty(rt.ctx, 'speechToText', { get() { throw new Error('not injected') } })
  Object.defineProperty(rt.ctx, 'fileUploads', { get() { throw new Error('not injected') } })
  rt.ctx.get = () => undefined
  assert.equal(adapter.capabilities().files, false)
  assert.equal(adapter.capabilities().transcription, false)
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, wav()), { status: 503 })
})

test('canonical WAV uses the optional public speech service and returns text without sending a message', async () => {
  const { adapter, rt, calls } = fixture()
  rt.ctx.speechToText = {
    resolve: request => { calls.push(['speech-resolve', request]); return { ...request, provider: 'local' } },
    transcribe: async spec => { assert.equal(spec.provider, 'local'); return { text: 'Hello', audioSeconds: 1, inferenceSeconds: 0.1 } },
  }
  assert.equal((await adapter.transcribe({ mediaType: 'audio/wav' }, wav())).text, 'Hello')
  assert.equal(calls.filter(call => call[0] === 'speech-resolve').length, 1)
  assert.equal(calls.some(call => call[0] === 'prompt'), false)
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, wav(16000 * 61)), { status: 413 })
  await assert.rejects(adapter.transcribe({ mediaType: 'text/plain' }, Buffer.from('text')), { status: 415 })
})

test('speech admission is serialized and aborted requests do not reach the recognizer', async () => {
  const { adapter, rt } = fixture()
  let finish
  rt.ctx.speechToText = { resolve: input => input, transcribe: () => new Promise(resolve => { finish = resolve }) }
  const first = adapter.transcribe({ mediaType: 'audio/wav' }, wav())
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, wav()), { status: 429 })
  while (!finish) await Promise.resolve()
  finish({ text: 'Done' })
  await first
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, wav(), AbortSignal.abort()))
})

test('ffmpeg normalizes a phone-style AAC M4A with its metadata at the end', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return t.skip('ffmpeg is not installed')
  const dir = await mkdtemp(join(tmpdir(), 'ds-bot-mobile-audio-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'phone.m4a')
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'aac', path])
  assert.equal(encoded.status, 0, 'generate the synthetic AAC fixture')
  const m4a = await readFile(path)
  assert.ok(m4a.indexOf(Buffer.from('moov')) > m4a.indexOf(Buffer.from('mdat')), 'exercise ordinary M4A instead of a fragmented streaming container')
  const { adapter, rt } = fixture()
  let observed
  rt.ctx.speechToText = { resolve: ({ audio }) => { observed = audio; return { audio } }, transcribe: async () => ({ text: 'Synthetic audio' }) }
  const result = await adapter.transcribe({ name: 'phone.m4a', mediaType: 'audio/mp4' }, m4a)
  assert.equal(result.text, 'Synthetic audio')
  assert.equal(observed.readUInt32LE(24), 16000)
  assert.equal(observed.readUInt16LE(22), 1)
  assert.equal(observed.readUInt16LE(34), 16)
  assert.equal(observed.readUInt32LE(40), observed.length - 44)
  assert.ok(observed.length > 44)
  assert.ok((observed.length - 44) / 32000 >= 20, 'a realistic-size M4A must be decoded completely')
  const controller = new AbortController()
  const aborted = adapter.transcribe({ mediaType: 'audio/mp4' }, m4a, controller.signal)
  controller.abort()
  await assert.rejects(aborted)
})

test('ffmpeg rejects recordings over 60 seconds after conversion and does not fetch playlist URLs', async t => {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return t.skip('ffmpeg is not installed')
  const { adapter, rt } = fixture()
  let recognized = 0
  rt.ctx.speechToText = { resolve: input => input, transcribe: async () => { recognized += 1; return { text: 'unexpected' } } }
  const long = wav(48000 * 61)
  long.writeUInt32LE(48000, 24)
  long.writeUInt32LE(96000, 28)
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/wav' }, long), { status: 413 })
  let fetched = 0
  const server = createServer((_request, response) => { fetched += 1; response.end('never fetch this') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const playlist = Buffer.from(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${server.address().port}/audio.ts\n#EXT-X-ENDLIST\n`)
  await assert.rejects(adapter.transcribe({ mediaType: 'audio/ogg' }, playlist), { status: 422 })
  assert.equal(fetched, 0)
  assert.equal(recognized, 0)
})

test('approval routing accepts owned Sessions and hidden group members without opening their history', async () => {
  const { adapter, rt } = fixture()
  rt.groupOwners = new Map([['hidden-member-session', { roomId: 'room', botId: 'b1' }], ['foreign-member', { roomId: 'other' }]])
  assert.equal(await adapter.conversationForSession('new'), 'b1')
  assert.equal(await adapter.conversationForSession('old'), 'b1')
  assert.equal(await adapter.conversationForSession('hidden-member-session'), 'room')
  assert.equal(await adapter.conversationForSession('foreign-member'), null)
  assert.equal(await adapter.conversationForSession('unknown'), null)
  await assert.rejects(adapter.history('room', { cursor: encode({ v: 1, conversationId: 'room', sessionId: 'hidden-member-session' }) }), { status: 404 })
  assert.deepEqual(await adapter.action('approvals'), { requests: [] })
  const answers = []
  let disposed = false
  adapter.setApprovalBroker({ list: () => ({ requests: [{ id: 'approval' }] }), resolveForDevice: async (deviceId, answer) => {
    if (!deviceId) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    answers.push({ deviceId, answer }); return { accepted: true }
  }, resolveForDesktop: answer => ({ accepted: true, answer }), dispose: () => { disposed = true } })
  assert.equal(adapter.capabilities().approvals, true)
  await assert.rejects(adapter.action('approval-resolve', { id: 'approval', decision: 'allowed-once', deviceId: 'forged' }), { status: 401 })
  await adapter.action('approval-resolve', { id: 'approval', decision: 'allowed-once', deviceId: 'forged' }, undefined, { deviceId: 'paired' })
  assert.deepEqual(answers, [{ deviceId: 'paired', answer: { id: 'approval', decision: 'allowed-once' } }])
  assert.deepEqual(adapter.approvalOperator('approvals.list'), { requests: [{ id: 'approval' }] })
  adapter.dispose()
  assert.equal(disposed, true)
})

test('ordinary binary attachments use the original public file admission without parsing or MIME restrictions', async () => {
  const { adapter, rt, calls } = fixture()
  const bytes = Buffer.from([0, 255, 128, 1, 2])
  const received = []
  rt.ctx.fileUploads.uploadStream = async request => {
    const chunks = []
    for await (const chunk of request.data) chunks.push(chunk)
    received.push({ name: request.name, bytes: Buffer.concat(chunks) })
    return { receiptId: `host-${received.length}` }
  }
  for (const [name, mediaType] of [['report.pdf', 'application/pdf'], ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['archive.zip', 'application/zip']]) {
    const receipt = await adapter.upload('b1', 'new', { name, mediaType }, bytes)
    await adapter.submit({ conversationId: 'b1', sessionId: 'new', requestId: name, attachments: [receipt] })
  }
  assert.deepEqual(received.map(item => item.name), ['report.pdf', 'report.docx', 'archive.zip'])
  assert.ok(received.every(item => item.bytes.equals(bytes)))
  assert.deepEqual(calls.filter(call => call[0] === 'prompt').map(call => call[1].content), [1, 2, 3].map(number => [{ type: 'file', receiptId: `host-${number}` }]))
})

test('usage retains deleted team owners while excluding unrelated host Sessions', async () => {
  const { adapter, rt, view } = fixture()
  rt.teamCall = async endpoint => ({ ok: true, value: endpoint === 'state' ? view : {
    owners: [{ kind: 'bot', id: 'past-bot', deleted: true }, { kind: 'room', id: 'past-room', deleted: true }, { kind: 'other', deleted: true }, { kind: 'bot', id: 'foreign' }],
    rows: [['hour', 0], ['hour', 1], ['hour', 2], ['hour', 3]],
  } })
  const usage = await adapter.action('usage')
  assert.deepEqual(usage.owners.map(item => item.id), ['past-bot', 'past-room'])
  assert.deepEqual(usage.rows, [['hour', 0], ['hour', 1]])
})

test('group questions may be answered in their owned hidden Session without making its history readable', async () => {
  const { adapter, calls } = fixture()
  await adapter.action('answer-question', { sessionId: 'hidden-member-session', questionId: 'q', answer: { selected: ['Yes'] } })
  assert.ok(calls.some(call => call[0] === 'team' && call[1] === 'answer-question' && call[2].sessionId === 'hidden-member-session'))
  await assert.rejects(adapter.history('hidden-member-session'), { status: 404 })
  await assert.rejects(adapter.action('answer-question', { sessionId: 'foreign-member', questionId: 'q', answer: { selected: ['Yes'] } }), { status: 404 })
})

test('known host secrets are redacted consistently from durable history, live text and pending queues', async () => {
  const { adapter, rt, pages, extra } = fixture()
  rt.redactSecrets = text => text.replaceAll('ds-bot-test-private', '[redacted]')
  const queued = { id: 'pending', source: { kind: 'user' }, content: [{ type: 'text', text: 'Queue ds-bot-test-private' }] }
  const inbox = { 'next-turn': [queued], 'next-step': [] }
  pages.set('new', snapshot([assistant(0, 'Answer ds-bot-test-private')], { projections: { values: { inbox } } }))
  rt.ctx.sessionController.projections = async () => ({ values: { inbox } })
  extra.push({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a', turn: 2, step: 1 } },
    { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', index: 0, chunk: { type: 'text-delta', index: 0, text: 'Live ds-bot-test-private' } } })
  const history = await adapter.history('b1')
  const queue = await adapter.queue('b1')
  const events = []
  for await (const event of adapter.follow('b1')) events.push(event)
  assert.equal(history.messages[0].text, 'Answer [redacted]')
  assert.equal(queue.items[0].text, 'Queue [redacted]')
  assert.equal(events.find(event => event.type === 'delta').text, 'Live [redacted]')
  assert.equal(JSON.stringify({ history, queue, events }).includes('ds-bot-test-private'), false)
})

test('mobile browser command receipts prevent repeated mutations and remain isolated between devices',async()=>{
  const {rt,adapter}=fixture();let count=0
  rt.browserEnabled=true
  rt.browserChannel={openPages:()=>({b1:{mobileControl:true,tabs:[]}}),read:async()=>{count++;return {page:{changed:true}}}}
  const body={botId:'b1',command:'click',snapshotId:'one',item:0,requestId:'one-action'}
  await Promise.all([adapter.action('browser-control',body,undefined,{deviceId:'one'}),adapter.action('browser-control',body,undefined,{deviceId:'one'})]);assert.equal(count,1)
  await assert.rejects(adapter.action('browser-control',{...body,item:1},undefined,{deviceId:'one'}),{status:409})
  await adapter.action('browser-control',body,undefined,{deviceId:'two'});assert.equal(count,2)
  await assert.rejects(adapter.action('browser-control',{...body,command:'evaluate',requestId:'script'},undefined,{deviceId:'one'}),{status:400})
  rt.browserChannel.read=async()=>{count++;return {error:'Reply was lost'}}
  const uncertain={...body,requestId:'uncertain'}
  await assert.rejects(adapter.action('browser-control',uncertain,undefined,{deviceId:'one'}),{status:409})
  await assert.rejects(adapter.action('browser-control',uncertain,undefined,{deviceId:'one'}),{status:409});assert.equal(count,3)
  adapter.dispose()
})
