// Webhooks: what an external service sends reaches one Bot's chat or one group chat,
// with the secret stored only as a digest and the team file untouched by a delivery.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const makeHome = state => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-hooks-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  return home
}
const team = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief-chat', name: 'Chief', capabilities: [], createdAt: 1 },
    writer: { id: 'writer', sessionId: 'writer-chat', name: 'Writer', capabilities: [], createdAt: 2 },
  },
  rooms: { room: { id: 'room', name: 'Crew', members: ['chief'], sessions: { chief: 'room-chief' }, admin: 'chief', mode: 'everyone' } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  revision: 1,
})

const freePort = () => new Promise(resolve => {
  const probe = createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitUntil = async (ready, ms = 3000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (ready()) return true
    await sleep(10)
  }
  return false
}

async function setup({ state = team(), config = {}, enabled = true, readOnly } = {}) {
  const home = makeHome(state)
  const port = await freePort()
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false, hooks: { enabled, port, ...config } })
  ctx.sessionTitle = { rename: async () => {} }
  const sent = []
  rt.teamCall = async (endpoint, payload) => {
    sent.push({ endpoint, payload })
    return { ok: true, value: true }
  }
  if (readOnly !== undefined) rt.readOnly = () => readOnly
  rt.resolveAgent = async sessionId => ({ session: { id: sessionId } })
  await rt.load()
  const running = enabled && readOnly === undefined ? await waitUntil(() => rt.hooksView().running) : false
  return {
    rt, ctx, home, sent, port, running,
    create: (body = {}) => rt.hooksEndpoint('hook-create', { name: 'CI', botId: 'writer', ...body }),
    cleanup: async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true }) },
  }
}

const post = async (port, path, { body = '', headers = {} } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body })
  return { status: response.status, json: await response.json().catch(() => null) }
}
const bearer = secret => ({ 'content-type': 'application/json', authorization: `Bearer ${secret}` })

test('a created webhook returns its secret once and stores only a digest', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({ name: 'GitHub' })
    assert.equal(hook.name, 'GitHub')
    assert.equal(hook.botId, 'writer')
    assert.equal(hook.url, `http://127.0.0.1:${env.port}/hook/${hook.id}`)
    assert.equal(hook.enabled, true)
    const saved = readFileSync(join(env.home, 'state.json'), 'utf8')
    assert.equal(JSON.parse(saved).hooks[hook.id].secretHash.length, 64)
    assert.ok(!saved.includes(secret), 'the secret must not reach state.json')
    const listed = await env.rt.hooksEndpoint('hooks-list', {})
    assert.equal(listed.hooks.length, 1)
    assert.equal(listed.enabled, true)
    assert.ok(!JSON.stringify(listed).includes(secret), 'the view must never carry the secret')
  } finally {
    await env.cleanup()
  }
})

test('a webhook delivers its payload to the Bot chat as a user message', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({ name: 'CI' })
    const answer = await post(env.port, `/hook/${hook.id}`, {
      body: JSON.stringify({ text: 'Build 42 is green' }),
      headers: bearer(secret),
    })
    assert.equal(answer.status, 202)
    assert.deepEqual(answer.json, { ok: true })
    assert.deepEqual(env.sent, [{ endpoint: 'send', payload: { sessionId: 'writer-chat', text: '[Webhook: CI] Build 42 is green' } }])
  } finally {
    await env.cleanup()
  }
})

test('a webhook can reach a group chat, and its own text is payload when there is no field', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({ name: 'Alerts', botId: undefined, roomId: 'room' })
    await post(env.port, `/hook/${hook.id}`, { body: 'disk almost full', headers: { authorization: `Bearer ${secret}` } })
    assert.deepEqual(env.sent, [{ endpoint: 'send', payload: { sessionId: 'room', text: '[Webhook: Alerts] disk almost full' } }])
  } finally {
    await env.cleanup()
  }
})

test('a template puts the payload where the user asked', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({ name: 'Deploy', template: 'Deployment {{text}} — look at it as {{name}}' })
    await post(env.port, `/hook/${hook.id}`, { body: JSON.stringify({ text: 'v2 shipped' }), headers: bearer(secret) })
    assert.equal(env.sent[0].payload.text, 'Deployment v2 shipped — look at it as Deploy')
  } finally {
    await env.cleanup()
  }
})

test('a wrong secret is refused and delivers nothing', async () => {
  const env = await setup()
  try {
    const { hook } = await env.create({})
    const wrong = await post(env.port, `/hook/${hook.id}`, { body: 'hello', headers: bearer('not-the-secret') })
    assert.equal(wrong.status, 401)
    assert.deepEqual(env.sent, [])
  } finally {
    await env.cleanup()
  }
})

test('an unknown webhook, a disabled one and a wrong method are refused', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({})
    assert.equal((await post(env.port, '/hook/nothing', { body: 'x', headers: bearer(secret) })).status, 404)
    await env.rt.hooksEndpoint('hook-update', { id: hook.id, enabled: false })
    assert.equal((await post(env.port, `/hook/${hook.id}`, { body: 'x', headers: bearer(secret) })).status, 404)
    assert.equal((await post(env.port, `/hook/${hook.id}?token=${secret}`, { body: 'x' })).status, 404)
    await env.rt.hooksEndpoint('hook-update', { id: hook.id, enabled: true })
    const response = await fetch(`http://127.0.0.1:${env.port}/hook/${hook.id}`, { method: 'GET' })
    assert.equal(response.status, 405)
  } finally {
    await env.cleanup()
  }
})

test('the query token is accepted, so a service that cannot set headers still works', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({})
    const answer = await post(env.port, `/hook/${hook.id}?token=${secret}`, { body: 'poked' })
    assert.equal(answer.status, 202)
    assert.equal(env.sent.length, 1)
  } finally {
    await env.cleanup()
  }
})

test('rotating replaces the secret and starts a new one; deleting closes the URL', async () => {
  const env = await setup()
  try {
    const first = await env.create({})
    const rotated = await env.rt.hooksEndpoint('hook-rotate', { id: first.hook.id })
    assert.notEqual(rotated.secret, first.secret)
    assert.equal((await post(env.port, `/hook/${first.hook.id}`, { body: 'x', headers: bearer(first.secret) })).status, 401)
    assert.equal((await post(env.port, `/hook/${first.hook.id}`, { body: 'x', headers: bearer(rotated.secret) })).status, 202)
    await env.rt.hooksEndpoint('hook-delete', { id: first.hook.id })
    assert.equal((await post(env.port, `/hook/${first.hook.id}`, { body: 'x', headers: bearer(rotated.secret) })).status, 404)
    assert.equal((await env.rt.hooksEndpoint('hooks-list', {})).hooks.length, 0)
  } finally {
    await env.cleanup()
  }
})

test('a delivery does not rewrite the team file', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({})
    const before = readFileSync(join(env.home, 'state.json'), 'utf8')
    await post(env.port, `/hook/${hook.id}`, { body: 'one', headers: bearer(secret) })
    assert.equal(readFileSync(join(env.home, 'state.json'), 'utf8'), before)
    assert.equal((await env.rt.hooksEndpoint('hooks-list', {})).hooks[0].deliveries, 1)
  } finally {
    await env.cleanup()
  }
})

test('a webhook needs exactly one target that exists', async () => {
  const env = await setup()
  try {
    await assert.rejects(env.rt.hooksEndpoint('hook-create', { name: 'Both', botId: 'chief', roomId: 'room' }), /one Bot or one group/)
    await assert.rejects(env.rt.hooksEndpoint('hook-create', { name: 'None' }), /Choose the Bot or the group/)
    await assert.rejects(env.rt.hooksEndpoint('hook-create', { name: 'Ghost', botId: 'ghost' }), /no Bot with that id/)
    await assert.rejects(env.rt.hooksEndpoint('hook-create', { botId: 'chief' }), /Give the webhook a name/)
    await assert.rejects(env.rt.hooksEndpoint('hook-update', { id: 'missing', name: 'x' }), /no webhook with that id/)
  } finally {
    await env.cleanup()
  }
})

test('a read-only host lists webhooks but refuses to change them', async () => {
  const env = await setup({ enabled: false, readOnly: 'Another DS Bot host holds this team' })
  try {
    assert.deepEqual((await env.rt.hooksEndpoint('hooks-list', {})).hooks, [])
    await assert.rejects(env.rt.hooksEndpoint('hook-create', { name: 'CI', botId: 'chief' }), /owns this Bot team/)
  } finally {
    await env.cleanup()
  }
})

test('the listener stays down until the config turns it on, and then answers', async () => {
  const off = await setup({ enabled: false })
  try {
    assert.equal(off.running, false)
    assert.equal((await off.rt.hooksEndpoint('hooks-list', {})).running, false)
  } finally {
    await off.cleanup()
  }
  const on = await setup({ enabled: true })
  try {
    assert.equal(on.running, true)
    assert.equal((await on.rt.hooksEndpoint('hooks-list', {})).running, true)
  } finally {
    await on.cleanup()
  }
})

test('a run of requests past the limit is throttled per webhook', async () => {
  const env = await setup()
  try {
    const { hook, secret } = await env.create({})
    let throttled = 0
    for (let index = 0; index < 130; index += 1) {
      const answer = await post(env.port, `/hook/${hook.id}`, { body: 'tick', headers: bearer(secret) })
      if (answer.status === 429) throttled += 1
    }
    assert.ok(throttled > 0, 'the limit must stop a flood')
    assert.equal(env.sent.length, 120)
  } finally {
    await env.cleanup()
  }
})

test('a team saved before webhooks existed loads with none', async () => {
  const state = team()
  const home = makeHome(state)
  try {
    const ctx = fakeContext()
    const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
    await rt.load()
    assert.deepEqual(rt.state.hooks, {})
    await ctx.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a corrupt hooks value resets instead of breaking the load', async () => {
  const state = { ...team(), hooks: ['not', 'an', 'object'] }
  const home = makeHome(state)
  try {
    const ctx = fakeContext()
    const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
    await rt.load()
    assert.deepEqual(rt.state.hooks, {})
    await ctx.dispose()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
