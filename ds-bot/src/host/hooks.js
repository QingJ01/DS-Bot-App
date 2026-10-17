// Webhooks: an external service POSTs to this host, and what it sends reaches one Bot's
// chat or one group chat as a user message, as if the user had sent it. The listener
// exists only while config.hooks.enabled is true and binds to loopback unless a host is
// named. Every request carries a per-hook secret, and only its digest is stored.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

const DEFAULT_PORT = 8790
const PREFIX = '/hook/'
const MAX_HOOKS = 50
const MAX_NAME = 60
const MAX_TEMPLATE = 500
const MAX_BODY_BYTES = 64 * 1024
const MAX_TEXT = 8_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

export const digest = value => createHash('sha256').update(value).digest('hex')
const matches = (value, hash) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(hash ?? '')
  && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(hash))

const secret = () => randomBytes(32).toString('base64url')
const identity = () => randomBytes(9).toString('base64url')

// The address a phone should use: the first non-internal IPv4 of the machine, so the URL
// the user copies is reachable on the same network. Loopback when there is none.
const lanAddress = (interfaces = networkInterfaces()) => {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal && isIP(entry.address) === 4) return entry.address
    }
  }
  return '127.0.0.1'
}

export function install(rt) {
  const { ctx, state } = rt
  const config = rt.config.hooks ?? {}
  const port = Number.isInteger(config.port) ? config.port : DEFAULT_PORT
  // Delivery counters change on every request, so they stay out of state.json: a webhook
  // must not rewrite the team file each time one fires.
  const recent = new Map()
  const rates = new Map()
  let server
  let failure
  let stopped = false

  const hooks = () => state.hooks ?? {}
  const find = id => (typeof id === 'string' && id !== '' ? hooks()[id] : undefined)

  const bindHost = config.host ?? '127.0.0.1'
  // The address a sender should use: what the config names, or this machine's first
  // non-internal IPv4 when the listener is bound to every interface, so the URL the user
  // copies is the one a phone or a service can reach.
  const baseUrl = () => config.publicUrl ?? `http://${bindHost === '0.0.0.0' ? lanAddress() : bindHost}:${port}`

  const publicHook = hook => {
    const stat = recent.get(hook.id)
    return {
      id: hook.id, name: hook.name,
      ...(hook.botId ? { botId: hook.botId } : {}),
      ...(hook.roomId ? { roomId: hook.roomId } : {}),
      template: hook.template ?? '',
      enabled: hook.enabled !== false,
      createdAt: hook.createdAt,
      url: `${baseUrl()}${PREFIX}${hook.id}`,
      ...(stat ? { lastDeliveryAt: stat.at, deliveries: stat.count } : { deliveries: 0 }),
    }
  }

  const view = () => ({
    enabled: config.enabled === true,
    running: server !== undefined,
    url: baseUrl(),
    hooks: Object.values(hooks()).map(publicHook).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    ...(failure ? { error: failure } : {}),
  })
  // The team view carries the hooks so the browser and the phone render them with the
  // state, without a second round trip.
  rt.hooksView = view

  // Exactly one target: a Bot's own chat, or a group chat, whose Session is the group id.
  const targetOf = body => {
    const botId = typeof body.botId === 'string' && body.botId !== '' ? body.botId : undefined
    const roomId = typeof body.roomId === 'string' && body.roomId !== '' ? body.roomId : undefined
    if (botId !== undefined && roomId !== undefined) throw invalid('Choose one Bot or one group, not both')
    if (botId !== undefined) {
      if (!state.bots[botId]) throw invalid('There is no Bot with that id')
      return { botId }
    }
    if (roomId !== undefined) {
      if (!state.rooms[roomId]) throw invalid('There is no group with that id')
      return { roomId }
    }
    throw invalid('Choose the Bot or the group this webhook reaches')
  }

  const nameOf = value => {
    const name = String(value ?? '').trim()
    if (name === '') throw invalid('Give the webhook a name')
    if (name.length > MAX_NAME) throw invalid(`Keep the name under ${MAX_NAME} characters`)
    return name
  }

  const templateOf = value => {
    const template = String(value ?? '').trim()
    if (template.length > MAX_TEMPLATE) throw invalid(`Keep the message template under ${MAX_TEMPLATE} characters`)
    return template
  }

  const sessionFor = hook => (hook.botId ? rt.chatOf(hook.botId) : hook.roomId)

  const deliver = async (hook, text) => {
    const result = await rt.teamCall('send', { sessionId: sessionFor(hook), text })
    if (result?.ok === false) throw refused(result.error?.message ?? 'The team refused this webhook')
    const stat = recent.get(hook.id)
    recent.set(hook.id, { at: Date.now(), count: (stat?.count ?? 0) + 1 })
  }

  // What the Bot sees: the template with the payload worked in, or a marked line that
  // says the text came from outside the conversation.
  const messageOf = (hook, raw, contentType) => {
    let text = raw.trim()
    if (/application\/json/i.test(contentType ?? '')) {
      try {
        const parsed = JSON.parse(raw)
        const candidate = parsed !== null && typeof parsed === 'object'
          ? (typeof parsed.text === 'string' ? parsed.text : typeof parsed.message === 'string' ? parsed.message : undefined)
          : undefined
        text = (candidate ?? (parsed !== null && typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed))).trim()
      } catch {
        // A body that says it is JSON and is not goes to the Bot as it came.
      }
    }
    const rendered = hook.template
      ? hook.template.replaceAll('{{text}}', text).replaceAll('{{name}}', hook.name)
      : `[Webhook: ${hook.name}] ${text}`
    return rendered.length > MAX_TEXT ? `${rendered.slice(0, MAX_TEXT)}…` : rendered
  }

  const rateLimited = id => {
    const now = Date.now()
    const window = rates.get(id)
    if (window === undefined || now - window.start >= RATE_WINDOW_MS) {
      rates.set(id, { start: now, count: 1 })
      return false
    }
    window.count += 1
    return window.count > RATE_MAX
  }

  const answer = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }

  const readBody = request => new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('too large'), { tooLarge: true }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

  const presented = (request, parsed) => {
    const header = String(request.headers.authorization ?? '')
    if (/^bearer /i.test(header)) return header.slice(7).trim()
    const direct = request.headers['x-ds-bot-secret']
    if (typeof direct === 'string') return direct.trim()
    return parsed.searchParams.get('token') ?? ''
  }

  const handle = async (request, res) => {
    if (request.method !== 'POST') return answer(res, 405, { ok: false, error: 'Use POST' })
    const parsed = new URL(request.url ?? '/', 'http://localhost')
    if (!parsed.pathname.startsWith(PREFIX)) return answer(res, 404, { ok: false, error: 'Unknown webhook' })
    const hook = find(parsed.pathname.slice(PREFIX.length))
    if (hook === undefined || hook.enabled === false) return answer(res, 404, { ok: false, error: 'Unknown webhook' })
    if (!matches(presented(request, parsed), hook.secretHash)) return answer(res, 401, { ok: false, error: 'The webhook secret is wrong' })
    if (rateLimited(hook.id)) return answer(res, 429, { ok: false, error: 'Too many requests; slow down' })
    let raw
    try {
      raw = await readBody(request)
    } catch (error) {
      return error?.tooLarge === true
        ? answer(res, 413, { ok: false, error: 'The body is too large' })
        : answer(res, 400, { ok: false, error: 'The body could not be read' })
    }
    try {
      await deliver(hook, messageOf(hook, raw, request.headers['content-type']))
    } catch (error) {
      rt.noteFailure?.({ source: 'webhook', text: error?.message ?? String(error), code: error?.code ?? error?.name, stack: error?.stack })
      return answer(res, 502, { ok: false, error: 'The Bot team did not accept this webhook' })
    }
    return answer(res, 202, { ok: true })
  }

  const start = () => new Promise((resolve, reject) => {
    const listening = createServer((request, res) => {
      handle(request, res).catch(() => answer(res, 500, { ok: false, error: 'The webhook could not be handled' }))
    })
    listening.on('error', reject)
    listening.listen(port, bindHost, () => {
      listening.off('error', reject)
      server = listening
      resolve()
    })
  })

  const stop = () => new Promise(resolve => {
    const closing = server
    server = undefined
    if (closing === undefined) return resolve()
    closing.close(() => resolve())
  })

  // The plugin channel: create, change, rotate, and remove hooks, and the view the
  // browser and the phone render. The secret is returned once and never stored in clear.
  rt.hooksEndpoint = async (endpoint, body = {}) => {
    await rt.load()
    if (endpoint === 'hooks-list') return view()
    if (rt.readOnly?.() !== undefined) throw refused('Use the DSH host that owns this Bot team.')
    if (endpoint === 'hook-create') {
      if (Object.keys(hooks()).length >= MAX_HOOKS) throw invalid(`Keep to ${MAX_HOOKS} webhooks; remove one first`)
      const created = secret()
      const hook = {
        id: identity(),
        name: nameOf(body.name),
        ...targetOf(body),
        template: templateOf(body.template),
        secretHash: digest(created),
        enabled: true,
        createdAt: Date.now(),
      }
      state.hooks = { ...hooks(), [hook.id]: hook }
      await rt.save()
      return { hook: publicHook(hook), secret: created }
    }
    const hook = find(body.id)
    if (hook === undefined) throw invalid('There is no webhook with that id')
    if (endpoint === 'hook-update') {
      const next = { ...hook }
      if (body.name !== undefined) next.name = nameOf(body.name)
      if (body.botId !== undefined || body.roomId !== undefined) Object.assign(next, targetOf({ botId: body.botId, roomId: body.roomId }))
      if (body.template !== undefined) next.template = templateOf(body.template)
      if (body.enabled !== undefined) next.enabled = body.enabled !== false
      state.hooks = { ...hooks(), [hook.id]: next }
      await rt.save()
      return { hook: publicHook(next) }
    }
    if (endpoint === 'hook-rotate') {
      const created = secret()
      const next = { ...hook, secretHash: digest(created) }
      state.hooks = { ...hooks(), [hook.id]: next }
      await rt.save()
      return { hook: publicHook(next), secret: created }
    }
    if (endpoint === 'hook-delete') {
      const rest = { ...hooks() }
      delete rest[hook.id]
      state.hooks = rest
      recent.delete(hook.id)
      rates.delete(hook.id)
      await rt.save()
      return { id: hook.id, removed: true }
    }
    throw invalid(`Unknown webhook endpoint ${endpoint}`)
  }

  ctx.effect(() => {
    const ready = (async () => {
      await rt.load()
      if (stopped || config.enabled !== true || rt.readOnly?.() !== undefined) return
      await start()
    })().catch(error => {
      failure = `The webhook listener could not start on port ${port}. ${error?.message ?? ''}`.trim()
      rt.warn?.('ds-bot: %s', failure)
    })
    return () => {
      stopped = true
      return ready.then(stop)
    }
  }, 'ds-bot: webhook listener')
}
