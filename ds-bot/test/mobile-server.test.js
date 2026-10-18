import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, X509Certificate } from 'node:crypto'
import test from 'node:test'
import https from 'node:https'
import { WebSocket } from 'ws'
import { createMobileServer } from '../src/mobile/server.js'
import { createAuthStore } from '../src/mobile/auth.js'
import { ensureLocalCertificate } from '../src/mobile/local-certificate.js'

function fakeAdapter() {
  const calls = []
  const target = async id => {
    if (id !== 'bot-one') throw Object.assign(new Error('Unknown conversation'), { status: 404, code: 'NOT_FOUND' })
    return { conversationId: id, sessionId: 'session-one' }
  }
  return {
    calls,
    state: async () => ({ bots: [{ id: 'bot-one', name: 'Bot' }] }),
    conversations: async () => ({ conversations: [{ id: 'bot-one' }] }),
    target,
    history: async () => ({ messages: [], cursor: null }),
    async submit(body) { calls.push(body); await new Promise(resolve => setTimeout(resolve, 20)); return { accepted: true, ...body } },
    cancel: async () => ({ cancelled: true }),
    action: async endpoint => ({ endpoint }),
    upload: async (conversationId, sessionId, meta, bytes) => ({ receiptId: randomUUID(), conversationId, sessionId, ...meta, size: bytes.length, expiresAt: Date.now() + 60_000 }),
    transcribe: async () => ({ text: 'Recorded words' }),
    attachment: async () => ({ attachment: { mediaType: 'image/png' }, data: Buffer.from('image').toString('base64') }),
    async *follow(conversationId, _options, signal) {
      yield { type: 'reset', conversationId, sessionId: 'session-one', messages: [], cursor: null }
      if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    },
  }
}

test('IPv6 HTTPS pairing and WSS events verify the IP certificate and require device authorization', async t => {
  const home = await mkdtemp(join(tmpdir(), '.dsh-test-mobile-ipv6-'))
  let server, socket
  t.after(async () => { socket?.terminate(); await server?.close(); await rm(home, { recursive: true, force: true }) })
  const certificate = await ensureLocalCertificate(join(home, 'tls'), ['::1'])
  const ca = await readFile(certificate.certPath)
  server = await createMobileServer({ home, adapter: fakeAdapter(), config: { host: '::1', port: 0, ...certificate } })
  assert.equal(new URL(server.url).hostname, '[::1]')
  // Node 24.19's DNS ASCII conversion rejects bare IPv6 in checkServerIdentity.
  // Keep normal CA/expiry checks and verify the binary IP SAN with X509 instead.
  const checkServerIdentity = (hostname, peer) => new X509Certificate(peer.raw).checkIP(hostname) ? undefined : new Error('The certificate does not match the IPv6 address.')
  assert.ok(checkServerIdentity('::2', { raw: new X509Certificate(ca).raw }) instanceof Error)
  const request = (path, body) => new Promise((resolve, reject) => {
    const req = https.request(`${server.url}/mobile/v1${path}`, { ca, checkServerIdentity, method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {} }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }))
    })
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
  })
  assert.equal((await request('/state')).status, 401)
  const code = await server.operator('pairing.create')
  assert.equal(code.url, server.url)
  const claim = (await request('/pairings', { code: code.code, deviceName: 'IPv6 test phone' })).body
  assert.equal((await request('/pairings/complete', { claimToken: claim.claimToken })).body.status, 'pending')
  await server.operator('pairing.approve', { requestId: claim.requestId })
  const session = (await request('/pairings/complete', { claimToken: claim.claimToken })).body
  socket = new WebSocket(`${server.url.replace('https:', 'wss:')}/mobile/v1/events`, { ca, checkServerIdentity })
  await once(socket, 'open')
  const message = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  assert.equal(JSON.parse(String((await message)[0])).type, 'ready')
  const closed = once(socket, 'close')
  await server.operator('device.revoke', { id: session.deviceId })
  assert.equal((await closed)[0], 4403)
})

async function fixture(t, config = {}) {
  const home = await mkdtemp(join(tmpdir(), '.dsh-test-mobile-'))
  const adapter = fakeAdapter()
  const options = { home, adapter, config: { port: 0, devAllowInsecure: true, ...config } }
  let server = await createMobileServer(options)
  t.after(async () => { await server.close(); await rm(home, { recursive: true, force: true }) })
  const request = async (path, { token, body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) => {
    const options = { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }
    if (body !== undefined) options.body = JSON.stringify(body)
    // The advertised HTTPS origin can be a reverse proxy; fixtures hit its loopback upstream.
    const response = await fetch(`http://127.0.0.1:${server.address.port}/mobile/v1${path}`, options)
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  async function pair(name = 'Test phone') {
    const code = await server.operator('pairing.create')
    const claim = (await request('/pairings', { body: { code: code.code, deviceName: name } })).body
    await server.operator('pairing.approve', { requestId: claim.requestId })
    return (await request('/pairings/complete', { body: { claimToken: claim.claimToken } })).body
  }
  return { home, adapter, request, pair, get server() { return server }, async restart() { await server.close(); server = await createMobileServer(options) } }
}

test('file responses use download headers and strictly validate message positions', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let actual
  f.adapter.attachment = async (...args) => { actual = args; return { attachment: { mediaType: 'application/octet-stream' }, data: Buffer.from('file-bytes').toString('base64'), file: true } }
  const path = '/attachments/file?conversationId=bot-one&sessionId=session-one&seq=12'
  const response = await fetch(`${f.server.url}/mobile/v1${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-disposition'), 'attachment')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(await response.text(), 'file-bytes')
  assert.deepEqual(actual[4], { seq: 12 })
  for (const seq of ['-1', '1.5', '01', '9007199254740992']) {
    assert.equal((await f.request(`/attachments/file?conversationId=bot-one&sessionId=session-one&seq=${seq}`, { token: session.accessToken })).status, 400)
  }
})
test('revoking a device during a file read prevents late download bytes', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  f.adapter.attachment = async () => {
    await f.server.operator('device.revoke', { id: session.deviceId })
    return { attachment: {}, data: Buffer.from('private bytes').toString('base64'), file: true }
  }
  const response = await f.request('/attachments/file?conversationId=bot-one&sessionId=session-one&seq=12', { token: session.accessToken })
  assert.equal(response.status, 401)
  assert.ok(!JSON.stringify(response.body).includes('private bytes'))
})

test('mobile pairing requires explicit desktop approval and keeps only token hashes on disk', async t => {
  const f = await fixture(t)
  const info = await f.request('/info')
  assert.equal(info.body.protocolVersion, 1)
  assert.equal((await f.request('/state')).status, 401)
  const code = await f.server.operator('pairing.create')
  const claim = (await f.request('/pairings', { body: { code: code.code, deviceName: 'My phone' } })).body
  assert.equal(claim.status, 'pending')
  assert.equal((await f.request('/pairings/complete', { body: { claimToken: claim.claimToken } })).body.status, 'pending')
  assert.equal((await f.request('/pairings', { body: { code: code.code, deviceName: 'Second phone' } })).status, 400)
  const operator = await f.server.operator('status')
  assert.equal(operator.pending[0].deviceName, 'My phone')
  await f.server.operator('pairing.approve', { requestId: claim.requestId })
  const session = (await f.request('/pairings/complete', { body: { claimToken: claim.claimToken } })).body
  assert.equal(session.serverId, info.body.serverId)
  assert.equal((await f.request('/state', { token: session.accessToken })).status, 200)
  const disk = await readFile(join(f.home, 'bridge.json'), 'utf8')
  for (const value of [session.accessToken, session.refreshToken, code.code, claim.claimToken]) assert.equal(disk.includes(value), false)
  // Windows inherits the user's directory ACL; its mode bits do not represent Unix permissions.
  if (process.platform !== 'win32') assert.equal((await stat(join(f.home, 'bridge.json'))).mode & 0o777, 0o600)
})

test('mobile refresh rotates credentials and device revocation closes streams immediately', async t => {
  const f = await fixture(t)
  const initial = await f.pair()
  const session = (await f.request('/auth/refresh', { body: { refreshToken: initial.refreshToken } })).body
  assert.equal((await f.request('/auth/refresh', { body: { refreshToken: initial.refreshToken } })).status, 401)
  assert.equal((await f.request('/state', { token: initial.accessToken })).status, 401)
  const socket = new WebSocket(`${f.server.url.replace('http:', 'ws:')}/mobile/v1/events`)
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const ready = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  assert.equal(JSON.parse((await ready)[0]).type, 'ready')
  const closed = once(socket, 'close')
  await f.server.operator('device.revoke', { id: session.deviceId })
  assert.equal((await closed)[0], 4403)
  assert.equal((await f.request('/state', { token: session.accessToken })).status, 401)
  assert.equal((await f.request('/auth/refresh', { body: { refreshToken: session.refreshToken } })).status, 401)
})
test('background notification credentials are scoped to metadata and survive app session rotation only', async t => {
  const f = await fixture(t, { publicUrl: 'https://phone.example' })
  const session = await f.pair()
  const action = (endpoint, payload={}) => f.request('/actions', {token:session.accessToken,body:{endpoint,payload}})
  const registration = await action('notifications-background-register')
  assert.equal(registration.status,200)
  const lease = registration.body
  assert.equal((await f.request('/notifications/background',{token:lease.token,body:{cursor:lease.cursor}})).status,200)
  assert.equal((await f.request('/state',{token:lease.token})).status,401)
  assert.equal((await f.request('/actions',{token:lease.token,body:{endpoint:'notifications-list'}})).status,401)
  assert.equal((await f.request('/notifications/background',{token:session.accessToken,body:{cursor:0}})).status,401)
  const rotated = (await f.request('/auth/refresh',{body:{refreshToken:session.refreshToken}})).body
  f.adapter.state=async()=>({questions:{question:{id:'background-question',conversationId:'bot-one'}}})
  const received=await f.request('/notifications/background',{token:lease.token,body:{cursor:lease.cursor}})
  assert.equal(received.status,200)
  assert.equal(received.body.items[0].kind,'question')
  assert.equal(received.body.deliveryEnabled,true)
  await f.server.operator('device.revoke',{id:rotated.deviceId})
  assert.equal((await f.request('/notifications/background',{token:lease.token,body:{cursor:lease.cursor}})).status,401)
})
test('background registration requires HTTPS and is invalidated when the host restarts', async t => {
  const insecure = await fixture(t)
  const phone = await insecure.pair()
  assert.equal((await insecure.request('/actions',{token:phone.accessToken,body:{endpoint:'notifications-background-register'}})).status,403)
  const f = await fixture(t,{publicUrl:'https://phone.example'})
  const session = await f.pair()
  const {body:lease} = await f.request('/actions',{token:session.accessToken,body:{endpoint:'notifications-background-register'}})
  await f.restart()
  assert.equal((await f.request('/notifications/background',{token:lease.token,body:{cursor:lease.cursor}})).status,401)
})

test('mobile submissions are deduplicated across concurrent retries and server restarts', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  const message = { requestId: 'stable-request', conversationId: 'bot-one', sessionId: 'session-one', text: 'Hello' }
  const responses = await Promise.all(Array.from({ length: 3 }, () => f.request('/submissions', { token: session.accessToken, body: message })))
  assert.deepEqual(responses.map(item => item.status), [200, 200, 200])
  assert.equal(f.adapter.calls.length, 1)
  assert.equal(responses[0].body.status, 'accepted')
  assert.equal(responses[0].body.requestId, message.requestId)
  assert.equal((await f.request('/submissions', { token: session.accessToken, body: { ...message, text: 'Different' } })).status, 409)
  const before = f.server.serverId
  await f.restart()
  assert.equal(f.server.serverId, before)
  assert.equal((await f.request('/submissions', { token: session.accessToken, body: message })).body.status, 'accepted')
  assert.equal(f.adapter.calls.length, 1)
  assert.equal((await f.request('/submissions/stable-request', { token: session.accessToken })).body.status, 'accepted')
  const other = await f.pair('Another phone')
  assert.equal((await f.request('/submissions/stable-request', { token: other.accessToken })).status, 404)
  await f.request('/submissions', { token: other.accessToken, body: message })
  assert.equal(f.adapter.calls.length, 2)
  assert.notEqual(f.adapter.calls[0].requestId, f.adapter.calls[1].requestId)
  f.adapter.history = async () => ({ messages: [{ id: 'one', requestId: f.adapter.calls[0].requestId }, { id: 'two', requestId: f.adapter.calls[1].requestId }] })
  const history = (await f.request('/conversations/bot-one/messages', { token: session.accessToken })).body
  assert.equal(history.messages[0].requestId, message.requestId)
  assert.equal(history.messages[1].requestId, f.adapter.calls[1].requestId)
})

test('mobile bridge denies unknown origins, credentials in URLs, dangerous actions and oversized uploads', async t => {
  const f = await fixture(t, { maxUploadBytes: 4, allowedOrigins: ['https://phone.example'] })
  const session = await f.pair()
  assert.equal((await f.request('/info', { headers: { Origin: 'https://evil.example' } })).status, 403)
  const allowed = await f.request('/info', { headers: { Origin: 'https://phone.example' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://phone.example')
  assert.equal((await f.request('/state?token=nope', { token: session.accessToken })).status, 400)
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { endpoint: 'secret-set', payload: {} } })).status, 403)
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { endpoint: 'mobile', payload: {} } })).status, 403)
  const response = await fetch(`${f.server.url}/mobile/v1/uploads?conversationId=bot-one&sessionId=session-one&name=test.txt&mediaType=text/plain`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` }, body: '12345',
  })
  assert.equal(response.status, 413)
  assert.equal((await f.request('/conversations/bot-one/messages?limit=500', { token: session.accessToken })).status, 400)
})

test('a lost admission acknowledgement is recovered only from positive host evidence', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let admitted = false
  let submissions = 0
  f.adapter.submit = async () => { submissions += 1; throw Object.assign(new Error('Lost acknowledgement'), { status: 503, code: 'UNAVAILABLE' }) }
  f.adapter.reconcile = async request => {
    assert.equal(request.requestId, `${session.deviceId}_lost-ack`)
    return admitted ? { accepted: true } : null
  }
  const message = { requestId: 'lost-ack', conversationId: 'bot-one', sessionId: 'session-one', text: 'One message' }
  assert.equal((await f.request('/submissions', { token: session.accessToken, body: message })).status, 503)
  assert.equal((await f.request('/submissions/lost-ack', { token: session.accessToken })).body.status, 'unknown')
  assert.equal((await f.request('/submissions', { token: session.accessToken, body: message })).body.status, 'unknown')
  await f.restart()
  admitted = true
  const recovered = (await f.request('/submissions/lost-ack', { token: session.accessToken })).body
  assert.equal(recovered.status, 'accepted')
  assert.equal(recovered.recovered, true)
  assert.equal(submissions, 1)
})

test('revocation during WebSocket target resolution cannot open a stream', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let release
  let entered
  const resolving = new Promise(resolve => { entered = resolve })
  f.adapter.target = async () => { entered(); await new Promise(resolve => { release = resolve }); return { sessionId: 'session-one' } }
  let followed = false
  f.adapter.follow = async function* () { followed = true; yield { type: 'reset', messages: [] } }
  const socket = new WebSocket(`${f.server.url.replace('http:', 'ws:')}/mobile/v1/events`)
  t.after(() => socket.terminate())
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  await resolving
  const closed = once(socket, 'close')
  await f.server.operator('device.revoke', { id: session.deviceId })
  release()
  assert.equal((await closed)[0], 4401)
  assert.equal(followed, false)
})

test('WebSocket device limits include concurrent authentication reservations', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let enteredTargets = 0
  let enterFive
  const fiveTargetsEntered = new Promise(resolve => { enterFive = resolve })
  let releaseTargets
  const targetGate = new Promise(resolve => { releaseTargets = resolve })
  f.adapter.target = async () => {
    if (++enteredTargets === 5) enterFive()
    await targetGate
    return { sessionId: 'session-one' }
  }

  const connect = () => {
    const socket = new WebSocket(`${f.server.url.replace('http:', 'ws:')}/mobile/v1/events`)
    const outcome = new Promise(resolve => socket.on('message', bytes => {
      const frame = JSON.parse(String(bytes))
      if (frame.type === 'ready' || frame.type === 'error') resolve(frame)
    }))
    t.after(() => socket.terminate())
    return { socket, outcome }
  }
  const initial = Array.from({ length: 6 }, connect)
  await Promise.all(initial.map(({ socket }) => once(socket, 'open')))
  for (const { socket } of initial) socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  await fiveTargetsEntered
  let earlyTimer
  const early = await Promise.race([
    ...initial.map(({ outcome }) => outcome),
    new Promise(resolve => { earlyTimer = setTimeout(() => resolve(null), 2000) }),
  ])
  clearTimeout(earlyTimer)

  releaseTargets()
  const outcomes = await Promise.all(initial.map(({ outcome }) => outcome))
  assert.ok(early, 'six concurrent authentication attempts should reject one connection before target resolution completes')
  assert.equal(early.type, 'error')
  assert.equal(early.error.code, 'CONNECTION_LIMIT')
  assert.equal(outcomes.filter(frame => frame.type === 'ready').length, 5)
  assert.equal(outcomes.filter(frame => frame.error?.code === 'CONNECTION_LIMIT').length, 1)

  const seventh = connect()
  await once(seventh.socket, 'open')
  seventh.socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  const control = await seventh.outcome
  assert.equal(control.type, 'error')
  assert.equal(control.error.code, 'CONNECTION_LIMIT')
})

test('a failed WebSocket target releases its reserved device slot', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let targetCalls = 0
  f.adapter.target = async () => {
    if (++targetCalls === 1) throw new Error('target failed')
    return { sessionId: 'session-one' }
  }
  const connect = () => {
    const socket = new WebSocket(`${f.server.url.replace('http:', 'ws:')}/mobile/v1/events`)
    const outcome = new Promise(resolve => socket.on('message', bytes => {
      const frame = JSON.parse(String(bytes))
      if (frame.type === 'ready' || frame.type === 'error') resolve(frame)
    }))
    t.after(() => socket.terminate())
    return { socket, outcome }
  }
  const failed = connect()
  await once(failed.socket, 'open')
  failed.socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  assert.equal((await failed.outcome).type, 'error')

  const remaining = Array.from({ length: 5 }, connect)
  await Promise.all(remaining.map(({ socket }) => once(socket, 'open')))
  for (const { socket } of remaining) socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  const outcomes = await Promise.all(remaining.map(({ outcome }) => outcome))
  assert.equal(outcomes.filter(frame => frame.type === 'ready').length, 5)
})

test('upload receipts are restricted to the uploading device and conversation', async t => {
  const f = await fixture(t)
  const owner = await f.pair('Uploader')
  const other = await f.pair('Other device')
  const upload = await fetch(`${f.server.url}/mobile/v1/uploads?conversationId=bot-one&sessionId=session-one&name=test.txt&mediaType=text/plain`, {
    method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}` }, body: 'A document',
  }).then(response => response.json())
  const message = { requestId: 'uploaded-request', conversationId: 'bot-one', sessionId: 'session-one', text: '', attachments: [{ receiptId: upload.receiptId }] }
  assert.equal((await f.request('/submissions', { token: other.accessToken, body: message })).status, 409)
  assert.equal((await f.request('/submissions', { token: owner.accessToken, body: { ...message, sessionId: 'another-session' } })).status, 409)
  assert.equal((await f.request('/submissions', { token: owner.accessToken, body: message })).status, 200)
})

test('queue actions require device authentication and preserve scoped adapter refusal statuses', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  const removed = []
  f.adapter.action = async (endpoint, payload) => {
    if (payload.conversationId !== 'bot-one') throw Object.assign(new Error('Conversation not owned'), { status: 404, code: 'mobile/not-found' })
    if (endpoint === 'queue') return { sessionId: 'session-one', items: [{ id: 'queued-one', requestId: `${session.deviceId}_queued-request`, text: 'Pending message', target: 'next-turn' }] }
    if (payload.sessionId !== 'session-one' || payload.itemId !== 'queued-one') throw Object.assign(new Error('Queue changed'), { status: 409, code: 'mobile/queue-changed' })
    removed.push(payload.itemId)
    return { accepted: true, conversationId: payload.conversationId, sessionId: payload.sessionId, itemId: payload.itemId }
  }
  const queue = { endpoint: 'queue', payload: { conversationId: 'bot-one' } }
  assert.equal((await f.request('/actions', { body: queue })).status, 401)
  const visible = await f.request('/actions', { token: session.accessToken, body: queue })
  assert.equal(visible.status, 200)
  assert.equal(visible.body.items[0].requestId, 'queued-request')
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { ...queue, payload: { conversationId: 'hidden-session' } } })).status, 404)
  const remove = { endpoint: 'queue-remove', payload: { conversationId: 'bot-one', sessionId: 'session-one', itemId: 'queued-one' } }
  const stale = await f.request('/actions', { token: session.accessToken, body: { ...remove, payload: { ...remove.payload, sessionId: 'earlier-part' } } })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'mobile/queue-changed')
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { ...remove, payload: { ...remove.payload, itemId: 'internal-task' } } })).status, 409)
  assert.deepEqual(removed, [])
  assert.equal((await f.request('/actions', { token: session.accessToken, body: remove })).body.accepted, true)
  assert.deepEqual(removed, ['queued-one'])
  f.adapter.follow = async function* (_id, _options, signal) {
    yield { type: 'status', sessionId: 'session-one', queue: [{ id: 'queued-two', requestId: `${session.deviceId}_second-request` }] }
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  }
  const socket = new WebSocket(`${f.server.url.replace('http:', 'ws:')}/mobile/v1/events`)
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const queueFrame = new Promise(resolve => socket.on('message', data => {
    const frame = JSON.parse(data)
    if (frame.queue) resolve(frame)
  }))
  socket.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: 'bot-one' }))
  assert.equal((await queueFrame).queue[0].requestId, 'second-request')
})

test('revocation aborts an action waiting to mutate the host', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  let release
  let entered
  let removed = false
  const resolving = new Promise(resolve => { entered = resolve })
  f.adapter.action = async (_endpoint, _payload, signal) => {
    entered()
    await new Promise(resolve => { release = resolve })
    signal.throwIfAborted()
    removed = true
    return { accepted: true }
  }
  const request = f.request('/actions', { token: session.accessToken, body: { endpoint: 'queue-remove', payload: { conversationId: 'bot-one', sessionId: 'session-one', itemId: 'queued-one' } } })
  await resolving
  await f.server.operator('device.revoke', { id: session.deviceId })
  release()
  assert.equal((await request).status, 401)
  assert.equal(removed, false)
})

test('pairing expiry, denial and access expiry fail closed', async t => {
  const home = await mkdtemp(join(tmpdir(), '.dsh-test-mobile-auth-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  let now = 10_000
  const auth = await createAuthStore(home, { now: () => now })
  const expired = auth.createPairing('https://phone.example')
  now += 120_001
  assert.throws(() => auth.beginPairing({ code: expired.code, deviceName: 'Phone' }), error => error.status === 400)
  const denied = auth.beginPairing({ code: auth.createPairing('https://phone.example').code, deviceName: 'Phone' })
  auth.decidePairing(denied.requestId, false)
  await assert.rejects(auth.completePairing(denied.claimToken), error => error.status === 403)
  const approved = auth.beginPairing({ code: auth.createPairing('https://phone.example').code, deviceName: 'Phone' })
  auth.decidePairing(approved.requestId, true)
  const session = await auth.completePairing(approved.claimToken)
  assert.equal(auth.verifyAccess(session.accessToken).id, session.deviceId)
  now += 15 * 60_000 + 1
  assert.throws(() => auth.verifyAccess(session.accessToken), error => error.status === 401)
  await auth.close()
})

test('plaintext bridges cannot listen on a public interface or advertise remote HTTP', async () => {
  await assert.rejects(createMobileServer({ config: { host: '0.0.0.0', publicUrl: 'https://phone.example' } }), /loopback/)
  await assert.rejects(createMobileServer({ config: { publicUrl: 'http://phone.example', devAllowInsecure: true } }), /HTTPS/)
  await assert.rejects(createMobileServer({ config: { certPath: '/does-not-exist' } }), /both/)
})

test('approval endpoints bind answers to the paired device and reflect revocation', async t => {
  const f = await fixture(t)
  assert.equal(f.server.hasActiveDevices(), false)
  assert.deepEqual(await f.server.operator('approvals.list'), { requests: [] })
  const session = await f.pair()
  assert.equal(f.server.hasActiveDevices(), true)
  assert.equal(f.server.isDeviceAuthorized(session.deviceId), true)
  let observed
  f.adapter.action = async (endpoint, payload, _signal, caller) => { observed = { endpoint, payload, caller }; return { accepted: true } }
  const body = { endpoint: 'approval-resolve', payload: { id: 'approval', decision: 'allowed-once', deviceId: 'forged' } }
  assert.equal((await f.request('/actions', { token: session.accessToken, body })).status, 200)
  assert.equal(observed.caller.deviceId, session.deviceId)
  await f.server.operator('device.revoke', { id: session.deviceId })
  assert.equal(f.server.hasActiveDevices(), false)
  assert.equal(f.server.isDeviceAuthorized(session.deviceId), false)
  assert.equal((await f.request('/actions', { token: session.accessToken, body })).status, 401)
})

test('credential writes require HTTPS and loopback accepts explicitly synthetic fixtures only', async t => {
  const f = await fixture(t)
  const session = await f.pair()
  for (const endpoint of ['secret-set', 'credentials-set', 'connector-connect']) {
    const field = endpoint === 'connector-connect' ? 'token' : 'value'
    const rejected = await f.request('/actions', { token: session.accessToken, body: { endpoint, payload: { [field]: 'synthetic-without-fixture-prefix' } } })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.body.error.code, 'HTTPS_REQUIRED')
    assert.equal((await f.request('/actions', { token: session.accessToken, body: { endpoint, payload: { [field]: 'ds-bot-test-fixture' } } })).status, 200)
  }
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { endpoint: 'settings-mutate', payload: {} } })).status, 403)
  assert.equal((await f.request('/actions', { token: session.accessToken, body: { endpoint: 'update-bot', payload: { id: 'bot-one', avatar: 'x'.repeat(160_000) } } })).status, 200)
})
