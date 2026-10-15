import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTextAccumulator, detail, projectEvent, projectQueue, projectRecords } from './projection.js'
import { createManagement, MANAGEMENT_ACTIONS } from './management.js'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'])
const MAX_IMAGE = 10 * 1024 * 1024
const MAX_FILE = 20 * 1024 * 1024
const MAX_STAGED = 64 * 1024 * 1024
const MAX_AUDIO = 10 * 1024 * 1024
const MAX_PCM = 60 * 16000 * 2
const RECEIPT_TTL = 15 * 60 * 1000
const ACTIONS = {
  'create-bot': ['name', 'role', 'instructions', 'brief', 'color', 'avatar', 'model', 'effort', 'workDir'],
  'update-bot': ['id', 'name', 'role', 'instructions', 'brief', 'color', 'avatar', 'model', 'effort', 'permission', 'workDir'],
  'duplicate-bot': ['id'], 'delete-bot': ['id'], 'set-main': ['id', 'main', 'primary', 'replace'],
  'create-room': ['name', 'members', 'admin', 'greet'],
  'update-room': ['id', 'name', 'notice', 'mode', 'admin', 'members', 'add', 'remove', 'workDir', 'permission'], 'delete-room': ['id'],
  folders: [], 'folder-list': ['path'],
  'memory-view': ['botId', 'summarize', 'regenerate'], 'memory-forget': ['botId', 'scope', 'topic', 'text'], 'memory-ask': ['botId', 'text'],
  'answer-question': ['sessionId', 'questionId', 'answer'], 'dismiss-question': ['sessionId'],
  'room-progress': ['roomId'], usage: ['timeZone'], models: [], efforts: ['ref'],
  queue: ['conversationId'], 'queue-remove': ['conversationId', 'sessionId', 'itemId'],
  'set-flags': ['id', 'pinned', 'hidden'], 'set-prefs': ['theme', 'accent', 'motion'],
  exchange: ['a', 'b'], earlier: ['sessionId', 'cursor'], parts: ['conversationId'], search: ['conversationId', 'query', 'cursor', 'limit'],
  context: ['conversationId', 'sessionId', 'seq', 'limit'],
  'reference-chats': ['conversationId'],
  'bot-capability': ['botId', 'name', 'attached'], 'stop-member-work': ['roomId', 'botId'],
  schedules: [], 'schedule-create': ['target', 'title', 'prompt', 'when'], 'schedule-delete': ['sessionId', 'id'],
  'connector-connect': ['id', 'token'], 'connector-retry': ['id'], 'connector-disconnect': ['id'], 'browser-pages': [], 'browser-read': ['botId', 'start'], 'browser-control': ['botId', 'command', 'tabId', 'url', 'requestId', 'snapshotId', 'item', 'text', 'direction'],
  'secret-set': ['requestId', 'name', 'value', 'purpose', 'scope'], 'secret-allow': ['requestId'], 'secret-cancel': ['requestId'],
  'secret-update': ['name', 'scope'], 'secret-delete': ['name'],
  'add-agent': [], 'agent-session': ['agentId', 'workspaceId'], 'agent-archive': ['agentId', 'sessionId'],
  'agent-rename': ['agentId', 'sessionId', 'title'], 'remove-agent': ['agentId'],
  diagnostics: ['client', 'clientErrors'], 'diagnostics-log': [], 'diagnostics-clear': [],
  'settings-describe': [], 'settings-update': ['ns', 'patch', 'expectedRevision'], 'settings-mutate': ['ns', 'ops', 'expectedRevision'],
  'credentials-describe': ['refs'], 'credentials-set': ['ref', 'value'], 'credentials-unset': ['ref'],
  'update-check': ['fresh'], 'update-install': ['targetId', 'repair'], 'dsh-update-install': [], 'repo-stars': [],
  approvals: [], 'approval-resolve': ['id', 'decision'],
  ...MANAGEMENT_ACTIONS,
}
export const MOBILE_ACTIONS = Object.freeze(Object.keys(ACTIONS))
const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const unavailable = message => error(503, 'mobile/unavailable', message)
const signalFor = signal => signal ?? AbortSignal.timeout(30_000)
const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const safeName = value => [...String(value ?? 'upload').split(/[\\/]/).at(-1)].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 160) || 'upload'
const REFUSALS = {
  'gateway/bad-request': [400, 'The host rejected the message format.'],
  'session/invalid-time-zone': [400, 'The host rejected the time zone.'],
  'session/not-found': [404, 'This Session is no longer available.'],
  'session/model-unavailable': [409, 'Select an available model before sending a message.'],
  'session/provider-credentials-unavailable': [409, 'Configure the model provider credentials on the host.'],
  'session/provider-models-unavailable': [409, 'The selected provider has no available models.'],
  'session/attachment-invalid': [422, 'The host could not accept this attachment. Check its format and the selected model.'],
  'session/writer-held': [409, 'Another host currently owns this Session.'],
  'session/conflict': [409, 'The Session configuration changed. Refresh the conversation.'],
  'agent-preset/conflict': [409, 'The Session configuration changed. Refresh the conversation.'],
  'session/queue-item-not-found': [409, 'This queued message is no longer pending.'],
}

async function publicCall(run) {
  try { return await run() } catch (cause) {
    const refusal = Object.hasOwn(REFUSALS, cause?.code) ? REFUSALS[cause.code] : undefined
    if (refusal && cause.status === undefined) throw error(refusal[0], cause.code, refusal[1])
    // In particular, an internal failure or agent-busy wrapper may follow an
    // attempted inbox write. Its receipt stays uncertain instead of replaying.
    throw cause
  }
}

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
}

function canonicalWave(bytes) {
  return bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
    && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 12, 16) === 'fmt '
    && bytes.readUInt32LE(16) === 16 && bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1
    && bytes.readUInt32LE(24) === 16000 && bytes.readUInt32LE(28) === 32000 && bytes.readUInt16LE(32) === 2
    && bytes.readUInt16LE(34) === 16 && bytes.toString('ascii', 36, 40) === 'data'
    && bytes.readUInt32LE(40) === bytes.length - 44 && (bytes.length - 44) % 2 === 0
}

function waveFromPcm(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function normalizeAudio(bytes, signal) {
  if (canonicalWave(bytes)) {
    if (bytes.length - 44 > MAX_PCM) throw error(413, 'mobile/audio-too-long', 'Recordings must be no longer than 60 seconds')
    return bytes
  }
  let directory
  let path
  try {
    // Ordinary phone M4A puts moov after mdat and needs a seekable input. Force
    // the MOV demuxer and disable external data references for this one format.
    if (bytes.toString('ascii', 4, 8) === 'ftyp') {
      directory = await mkdtemp(join(tmpdir(), 'ds-bot-mobile-audio-'))
      path = join(directory, 'recording.m4a')
      await writeFile(path, bytes, { mode: 0o600, signal })
    }
    signal.throwIfAborted()
    return await decodeAudio(bytes, path, signal)
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

function decodeAudio(bytes, path, signal) {
  return new Promise((resolve, reject) => {
    // Generic input may only use pipes, so playlists cannot fetch URLs or files.
    const input = path ? ['-protocol_whitelist', 'file,pipe', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', path]
      : ['-protocol_whitelist', 'pipe', '-i', 'pipe:0']
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...input,
      '-map', '0:a:0', '-vn', '-t', '61', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks = []
    let length = 0
    let failure
    const stop = reason => { failure ??= reason; child.kill('SIGKILL') }
    const abort = () => stop(signal.reason ?? error(499, 'mobile/cancelled', 'Transcription cancelled'))
    const timer = setTimeout(() => stop(error(504, 'mobile/audio-timeout', 'Audio conversion timed out')), 30_000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stdout.on('data', chunk => {
      length += chunk.length
      if (length > MAX_PCM) stop(error(413, 'mobile/audio-too-long', 'Recordings must be no longer than 60 seconds'))
      else chunks.push(chunk)
    })
    child.stdin.on('error', () => {})
    child.on('error', cause => { failure = cause.code === 'ENOENT' ? unavailable('Install ffmpeg on the host to transcribe this recording format') : unavailable('Audio conversion is unavailable') })
    child.on('close', code => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0 || length === 0) reject(error(422, 'mobile/invalid-audio', 'The recording could not be decoded'))
      else resolve(waveFromPcm(Buffer.concat(chunks)))
    })
    child.stdin.end(path ? undefined : bytes)
  })
}

export function createAdapter(rt) {
  const { ctx } = rt
  const optional = name => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
  const staged = new Map()
  const shutdown = new AbortController()
  let transcribing = false
  let disposed = false
  let approvalBroker
  let authorizeApprovalDevice
  let summariesUntil = 0
  let summariesJob
  let summaryCache = new Map()
  async function summaries() {
    if (!ctx.sessionController.list) return summaryCache
    if (Date.now() < summariesUntil) return summaryCache
    if (!summariesJob) summariesJob = (async () => {
      try {
        const value = await ctx.sessionController.list({}, AbortSignal.any([AbortSignal.timeout(5000), shutdown.signal]))
        summaryCache = new Map((value.items ?? []).map(item => [item.sessionId, { running: item.running === true, title: item.projections?.values?.title, origin: item.origin, blank: item.blank, updatedAt: item.updatedAt }]))
      } catch { /* Retain the last public summary while a host is reconnecting. */ }
      finally { summariesUntil = Date.now() + 1500; summariesJob = undefined }
      return summaryCache
    })()
    return summariesJob
  }
  const redact = value => typeof rt.redactSecrets === 'function' ? rt.redactSecrets(value) : value
  const management = createManagement(rt, { optional, conversation, redact })
  const connectors = value => (Array.isArray(value) ? value : []).filter(item => item && typeof item.id === 'string').map(item => ({
    id: item.id, name: String(item.name ?? item.id), state: String(item.state ?? 'off'), account: typeof item.account === 'string' ? item.account : null,
    ...(typeof item.error === 'string' ? { error: redact(item.error) } : {}),
  }))
  const agentView = value => (Array.isArray(value) ? value : []).filter(item => item && typeof item.id === 'string' && Array.isArray(item.sessions))
    .map(({ id, name, sessions, createdAt, pinned, hidden }) => ({ id, name, sessions: sessions.filter(validId), createdAt, pinned, hidden }))
  const secretView = value => value && typeof value.name === 'string' ? Object.fromEntries(['name', 'purpose', 'scope', 'requestedBy', 'createdAt', 'updatedAt', 'lastUsedAt'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) : undefined
  async function team(endpoint, payload = {}, signal) {
    const result = await rt.teamCall(endpoint, payload, signal)
    if (result?.ok === false) {
      const code = result.error?.code ?? 'bot/refused'
      throw error(code === 'bot/not-found' ? 404 : code === 'bot/read-only' ? 409 : 400, code, result.error?.message ?? 'The team refused this request')
    }
    return result?.ok === true ? result.value : result
  }
  async function state() {
    const value = await team('state')
    // Explicit selection keeps future host-only administration fields off phones.
    const selected = Object.fromEntries(['revision', 'workspaceId', 'colors', 'modelsKey', 'mainBotId', 'mainBotIds', 'bots', 'rooms', 'models', 'defaultModel', 'questions',
      'activity', 'permissions', 'memory', 'memoryNews', 'memoryReviews', 'readOnly', 'prefs'].filter(key => value[key] !== undefined).map(key => [key, value[key]]))
    selected.rooms = (value.rooms ?? []).map(room => ({ ...room, parts: [] }))
    selected.agents = agentView(value.agents)
    const questionOwners = new Map([
      ...(value.bots ?? []).flatMap(bot => [bot.id, bot.sessionId, ...(bot.parts ?? [])].map(id => [id, bot.id])),
      ...(value.rooms ?? []).flatMap(room => [room.id, ...(room.parts ?? [])].map(id => [id, room.id])),
      ...selected.agents.flatMap(agent => agent.sessions.map(id => [id, `agent:${agent.id}:${id}`])),
    ])
    selected.questions = Object.fromEntries(Object.entries(value.questions ?? {}).filter(([id]) => questionOwners.has(id))
      .map(([sessionId, question]) => [sessionId, { ...question, sessionId, conversationId: questionOwners.get(sessionId) }]))
    selected.connectors = connectors(value.connectors)
    selected.secrets = (value.secrets ?? []).map(secretView).filter(Boolean)
    selected.secretRequests = Object.fromEntries(Object.entries(value.secretRequests ?? {}).filter(([id]) => value.bots?.some(bot => bot.id === id))
      .map(([id, requests]) => [id, (Array.isArray(requests) ? requests : []).map(request => ({
        ...Object.fromEntries(['id', 'name', 'purpose', 'kind', 'status', 'callId', 'askedAt', 'createdAt', 'updatedAt', 'settledAt'].filter(key => request[key] !== undefined).map(key => [key, request[key]])),
        conversationId: id, ...(questionOwners.get(request.sessionId) === id ? { sessionId: request.sessionId } : {}),
      }))]))
    selected.browser = rt.browserEnabled === true
    if (Array.isArray(value.capabilities)) selected.capabilities = value.capabilities.filter(item => item && typeof item.name === 'string' && ['mcp', 'skill', 'pack'].includes(item.kind)).map(item => ({
      name: item.name, kind: item.kind, description: detail(String(item.description ?? ''), 2000, redact).text,
      ...(item.kind === 'mcp' ? { transport: item.transport === 'streamable-http' ? 'streamable-http' : 'stdio', approved: item.approved === true } : {}),
      ...(item.kind === 'pack' ? { items: (Array.isArray(item.items) ? item.items : []).filter(name => typeof name === 'string') } : {}),
    }))
    const botIds = new Set((selected.bots ?? []).map(bot => bot.id))
    const roomIds = new Set(selected.rooms.map(room => room.id))
    if (value.capabilityStatuses) selected.capabilityStatuses = Object.fromEntries(Object.entries(value.capabilityStatuses).filter(([id]) => botIds.has(id)).map(([id, statuses]) => [id,
      Object.fromEntries(Object.entries(statuses ?? {}).filter(([name, status]) => selected.capabilities?.some(item => item.name === name) && status && ['ready', 'connecting', 'needs-approval', 'error'].includes(status.state)).map(([name, status]) => [name, {
        state: status.state, ...(typeof status.error === 'string' ? { error: detail(status.error, 500, redact).text } : {}),
      }])),
    ]))
    selected.work = {
      bots: Object.fromEntries(Object.entries(value.work?.bots ?? {}).filter(([id, work]) => botIds.has(id) && (!work.roomId || roomIds.has(work.roomId))).map(([id, work]) => [id, {
        ...(typeof work.tool === 'string' ? { tool: redact(work.tool) } : {}),
        ...Object.fromEntries(['said', 'note', 'target'].filter(key => typeof work[key] === 'string').map(key => [key, detail(work[key], 300, redact).text])),
        ...(work.switching === true ? { switching: true } : {}),
        ...(Number.isFinite(work.since) ? { since: work.since } : {}),
        ...(roomIds.has(work.roomId) ? { roomId: work.roomId } : {}),
      }])),
      rooms: Object.fromEntries(Object.entries(value.work?.rooms ?? {}).filter(([id]) => roomIds.has(id)).map(([id, work]) => [id,
        (Array.isArray(work) ? work : []).filter(entry => botIds.has(entry.botId) && selected.rooms.find(room => room.id === id)?.members?.includes(entry.botId)).map(entry => ({
          botId: entry.botId, ...(Number.isFinite(entry.since) ? { since: entry.since } : {}),
          ...(typeof entry.tool === 'string' ? { tool: detail(entry.tool, 300, redact).text } : {}),
          ...Object.fromEntries(['said', 'note', 'target'].filter(key => typeof entry[key] === 'string').map(key => [key, detail(entry[key], 300, redact).text])),
          ...(entry.switching === true ? { switching: true } : {}),
          ...(entry.speaking === true ? { speaking: true } : {}),
        })),
      ])),
      approvals: (value.work?.approvals ?? []).filter(entry => botIds.has(entry.botId) && (!entry.roomId || roomIds.has(entry.roomId))).map(entry => ({
        id: entry.id, botId: entry.botId, sessionId: entry.sessionId, roomId: entry.roomId, answerable: entry.answerable === true,
        tool: redact(String(entry.tool ?? '')), reason: redact(String(entry.reason ?? '')), at: entry.at,
        detail: { text: redact(String(entry.detail?.text ?? '')), code: redact(String(entry.detail?.code ?? '')) },
      })),
    }
    for (const request of approvalBroker?.list().requests ?? []) {
      const owner = selected.bots?.find(bot => bot.id === request.conversationId)
      if (owner && !selected.work.approvals.some(entry => entry.id === request.id)) selected.work.approvals.push({ id: request.id, botId: owner.id, sessionId: request.sessionId, tool: request.toolName, reason: request.reason, at: request.createdAt, answerable: false })
    }
    return selected
  }
  async function approvalRequests() {
    const own = approvalBroker?.list().requests ?? []
    const view = await state()
    const group = view.work.approvals.filter(entry => entry.roomId && entry.answerable).map(entry => ({
      id: `group:${entry.id}`, conversationId: entry.roomId, sessionId: entry.sessionId, botId: entry.botId,
      toolName: entry.tool, createdAt: entry.at,
      reason: [entry.reason, entry.detail?.text, entry.detail?.code].filter(Boolean).join('\n\n'),
    }))
    return { requests: [...own, ...group] }
  }
  async function resolveGroupApproval(payload, deviceId) {
    if (!['allowed-once', 'rejected'].includes(payload?.decision)) throw error(400, 'INVALID_APPROVAL', 'Choose Allow once or Reject for this request')
    if (deviceId !== undefined && (!deviceId || !await authorizeApprovalDevice?.(deviceId))) throw error(401, 'UNAUTHORIZED', 'This device is no longer authorized')
    const request = (await approvalRequests()).requests.find(entry => entry.id === payload.id && entry.id.startsWith('group:'))
    const inScope = () => request && rt.groupOwners?.get(request.sessionId)?.roomId === request.conversationId && rt.groupOwners?.get(request.sessionId)?.botId === request.botId && rt.state?.rooms?.[request.conversationId]?.members?.includes(request.botId)
    if (!inScope()) throw error(409, 'APPROVAL_SCOPE_CHANGED', 'This approval no longer belongs to this group')
    if (deviceId !== undefined && !await authorizeApprovalDevice?.(deviceId)) throw error(401, 'UNAUTHORIZED', 'This device is no longer authorized')
    if (!inScope()) throw error(409, 'APPROVAL_SCOPE_CHANGED', 'This approval no longer belongs to this group')
    if (!rt.answerApproval) throw unavailable('Group approvals are unavailable on this host')
    rt.answerApproval(payload.id.slice(6), payload.decision === 'allowed-once' ? 'allow' : 'reject')
    return { accepted: true }
  }
  async function conversations() {
    const view = await state()
    const summariesById = await summaries()
    const rows = [
      ...(view.bots ?? []).map(bot => ({ id: bot.id, kind: 'bot', name: bot.name, role: bot.role ?? '', sessionId: bot.sessionId,
        parts: bot.parts ?? [], model: bot.model ?? null, waiting: bot.waiting === true, color: bot.color, avatar: bot.avatar,
        pinned: bot.pinned === true, hidden: bot.hidden === true, createdAt: bot.createdAt,
        main: (view.mainBotIds ?? []).includes(bot.id), activity: view.activity?.[bot.id] ?? null })),
      ...(view.rooms ?? []).map(room => ({ id: room.id, kind: 'room', name: room.name, role: 'Group', sessionId: room.id,
        parts: [], members: room.members ?? [], admin: room.admin ?? null, mode: room.mode ?? 'admin', notice: room.notice ?? '',
        pinned: room.pinned === true, hidden: room.hidden === true, createdAt: room.createdAt,
        model: null, waiting: false, preview: room.preview ?? '', activity: view.activity?.[room.id] ?? null })),
      ...(view.agents ?? []).flatMap(agent => agent.sessions.map((sessionId, index) => ({ id: `agent:${agent.id}:${sessionId}`, kind: 'agent',
        agentId: agent.id, name: summariesById.get(sessionId)?.title || `${agent.name ?? 'DSH Agent'} · ${index + 1}`, role: 'DSH Agent', sessionId, parts: [], model: null,
        pinned: agent.pinned === true, hidden: agent.hidden === true, waiting: false, activity: view.activity?.[sessionId] ?? null }))),
    ]
    return { conversations: rows.map(item => ({ ...item, ...(summariesById.has(item.sessionId) ? {
      running: summariesById.get(item.sessionId).running,
      updatedAt: summariesById.get(item.sessionId).updatedAt,
    } : {}) })), revision: view.revision }
  }
  async function conversation(id) {
    if (!validId(id)) throw error(400, 'mobile/invalid', 'A conversation ID is required')
    const list = await conversations()
    const found = list.conversations.find(item => item.id === id)
    if (!found) throw error(404, 'mobile/not-found', 'This conversation is not on the team')
    return { ...found, revision: list.revision }
  }
  const sessionsOf = item => [...new Set([...(item.kind === 'bot' ? item.parts : []), item.sessionId])]
  function requireSession(item, sessionId, current = false) {
    if (!validId(sessionId) || !(current ? [item.sessionId] : sessionsOf(item)).includes(sessionId)) {
      throw error(current ? 409 : 404, current ? 'mobile/target-changed' : 'mobile/not-found', current
        ? 'The conversation moved to a new part. Refresh the target and prepare attachments again.' : 'This Session does not belong to the conversation')
    }
  }
  async function target(id) {
    const item = await conversation(id)
    return { conversationId: item.id, sessionId: item.sessionId, revision: item.revision }
  }
  async function conversationForSession(sessionId) {
    const list = await conversations()
    const direct = list.conversations.find(item => sessionsOf(item).includes(sessionId))?.id
    if (direct) return direct
    const roomId = rt.groupOwners?.get(sessionId)?.roomId
    return list.conversations.find(item => item.kind === 'room' && item.id === roomId)?.id ?? null
  }
  async function referenceChats(id, signal, allRecent = false) {
    const item = await conversation(id)
    const resolver = optional('sessionReferenceResolver')
    if (!resolver?.listCandidates || !rt.resolveAgent) return { available: false, chats: [] }
    const view = await state()
    const teamIds = new Set([
      ...(view.bots ?? []).flatMap(bot => [bot.id, bot.sessionId, ...(bot.parts ?? [])]),
      ...(view.rooms ?? []).map(room => room.id),
      ...(rt.groupOwners?.keys() ?? []),
      ...Object.values(rt.state?.rooms ?? {}).flatMap(room => [...Object.values(room.sessions ?? {}), ...Object.values(room.segments ?? {}).flat().map(part => part.sessionId)]),
    ])
    const bots = (view.bots ?? []).filter(bot => bot.sessionId && bot.sessionId !== item.sessionId).map(bot => ({ sessionId: bot.sessionId, label: String(redact(bot.name)), botId: bot.id, kind: 'bot' }))
    const agent = await rt.resolveAgent(item.sessionId)
    const candidates = await resolver.listCandidates(agent, '', 100, signalFor(signal))
    const publicSessions = await summaries()
    const recent = candidates.filter(row => validId(row.sessionId) && row.sessionId !== item.sessionId && !teamIds.has(row.sessionId)
      && publicSessions.has(row.sessionId) && publicSessions.get(row.sessionId).origin !== 'subagent' && publicSessions.get(row.sessionId).blank !== true)
      .sort((a, b) => (publicSessions.get(b.sessionId).updatedAt ?? b.createdAt ?? 0) - (publicSessions.get(a.sessionId).updatedAt ?? a.createdAt ?? 0))
      .slice(0, allRecent ? 100 : 8).map(row => ({ sessionId: row.sessionId, label: String(redact(row.displayTitle || row.label || row.sessionId)).slice(0, 200), kind: 'session' }))
    return { available: true, chats: [...bots, ...recent] }
  }
  async function checkReferences(id, text, signal) {
    if (!text.includes('dsh-session:')) return
    let references, maxReferences
    try {
      const { parseSessionReferenceText, MAX_REFERENCES } = await import('@deepseek-ai/dsh-session-reference')
      references = parseSessionReferenceText(text).references
      maxReferences = MAX_REFERENCES
    } catch { throw error(400, 'mobile/reference-invalid', 'Use a valid chat reference from the attachment menu') }
    if (!references.length) return
    if (new Set(references.map(ref => ref.sessionId)).size > maxReferences) throw error(400, 'mobile/reference-limit', 'Use up to three chat references')
    const available = await referenceChats(id, signal, true)
    if (!available.available) throw unavailable('Update Harness on the host to use chat references')
    const allowed = new Set(available.chats.map(row => row.sessionId))
    if (references.some(ref => !allowed.has(ref.sessionId) || rt.groupOwners?.has(ref.sessionId))) throw error(403, 'mobile/reference-denied', 'This chat reference is no longer available. Choose it again from the attachment menu')
  }
  async function action(endpoint, payload = {}, signal, caller = {}) {
    const scoped = AbortSignal.any([signalFor(signal), shutdown.signal])
    scoped.throwIfAborted()
    const fields = Object.hasOwn(ACTIONS, endpoint) ? ACTIONS[endpoint] : undefined
    if (!fields) throw error(404, 'mobile/unsupported-action', 'This action is not available on mobile')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw error(400, 'mobile/invalid', 'Invalid action payload')
    const body = Object.fromEntries(fields.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]))
    for (const key of ['workDir', ...(endpoint === 'folder-list' ? ['path'] : [])]) {
      if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 4096)) throw error(400, 'mobile/invalid', 'Use a host folder path of at most 4096 characters')
    }
    if (endpoint === 'folders' || endpoint === 'folder-list') {
      const result = await team(endpoint, body, scoped)
      scoped.throwIfAborted()
      return endpoint === 'folders' ? { ...result, picker: result.picker === 'browse' ? 'browse' : null } : result
    }
    if (Object.hasOwn(MANAGEMENT_ACTIONS, endpoint)) return management(endpoint, body, scoped, caller)
    if (endpoint === 'approvals') return approvalRequests()
    if (endpoint === 'approval-resolve') {
      if (typeof body.id === 'string' && body.id.startsWith('group:')) {
        if (typeof caller.deviceId !== 'string' || !caller.deviceId) throw error(401, 'UNAUTHORIZED', 'This device is no longer authorized')
        return resolveGroupApproval(body, caller.deviceId)
      }
      if (!approvalBroker) throw unavailable('Tool approvals are unavailable on this host')
      return approvalBroker.resolveForDevice(caller.deviceId, body)
    }
    if (endpoint === 'parts') return parts(body.conversationId)
    if (endpoint === 'reference-chats') return referenceChats(body.conversationId, scoped)
    if (endpoint === 'search') return search(body, scoped)
    if (endpoint === 'context') return context(body, scoped)
    if (endpoint.startsWith('settings-')) return settings(endpoint, body, scoped)
    if (endpoint.startsWith('credentials-')) return credentials(endpoint, body, scoped)
    if (endpoint === 'browser-pages' || endpoint === 'browser-read' || endpoint === 'browser-control') return browser(endpoint, body, scoped, caller)
    if (endpoint === 'queue') return queue(body.conversationId, scoped)
    if (endpoint === 'queue-remove') {
      const item = await conversation(body.conversationId)
      requireSession(item, body.sessionId, true)
      if (rt.readOnly?.() !== undefined) throw error(409, 'bot/read-only', 'The team is read-only on this host')
      if (!validId(body.itemId)) throw error(400, 'mobile/invalid', 'A queued message ID is required')
      const pending = await queue(body.conversationId, scoped)
      if (pending.sessionId !== body.sessionId) throw error(409, 'mobile/target-changed', 'The conversation moved to a new part. Refresh the queue.')
      if (!pending.items.some(message => message.id === body.itemId)) throw error(409, 'session/queue-item-not-found', 'This queued message is no longer pending.')
      scoped.throwIfAborted()
      const result = await publicCall(() => ctx.sessionController.updateQueue({ sessionId: body.sessionId, itemId: body.itemId, action: { kind: 'remove' } }, scoped))
      return { ...result, conversationId: body.conversationId, sessionId: body.sessionId, itemId: body.itemId }
    }
    const view = await team('state')
    if (endpoint === 'efforts' && !view.models?.some(model => model.ref === body.ref)) throw error(400, 'mobile/invalid', 'Choose an available model')
    const bots = new Set((view.bots ?? []).map(bot => bot.id))
    const rooms = new Set((view.rooms ?? []).map(room => room.id))
    const agents = agentView(view.agents)
    const agent = agents.find(item => item.id === body.agentId)
    const owned = new Set([...(view.bots ?? []).flatMap(bot => [bot.id, bot.sessionId, ...(bot.parts ?? [])]),
      ...(view.rooms ?? []).map(room => room.id), ...agents.flatMap(item => item.sessions)])
    const questionSession = ['answer-question', 'dismiss-question'].includes(endpoint)
      && (view.rooms ?? []).some(room => room.parts?.includes(body.sessionId))
    const requireBot = id => { if (!bots.has(id)) throw error(404, 'mobile/not-found', 'This Bot is not on the team') }
    if (endpoint === 'bot-capability') {
      requireBot(body.botId)
      if (typeof body.name !== 'string' || body.name.length > 32 || !view.capabilities?.some(item => item.name === body.name)) throw error(404, 'mobile/not-found', 'This capability is not on the team')
      if (typeof body.attached !== 'boolean') throw error(400, 'mobile/invalid', 'Choose whether to attach this capability')
    }
    if (endpoint === 'stop-member-work') {
      requireBot(body.botId)
      if (!view.rooms?.some(room => room.id === body.roomId && room.members?.includes(body.botId))) throw error(404, 'mobile/not-found', 'This member is not in the group')
    }
    if (['update-bot', 'duplicate-bot', 'delete-bot', 'set-main'].includes(endpoint)) requireBot(body.id)
    if (endpoint === 'set-flags' && !bots.has(body.id) && !rooms.has(body.id) && !agents.some(item => item.id === body.id)) throw error(404, 'mobile/not-found', 'This conversation is not on the team')
    if (endpoint === 'exchange') { requireBot(body.a); requireBot(body.b) }
    if (endpoint === 'earlier' && !(view.bots ?? []).some(bot => [bot.sessionId, ...(bot.parts ?? [])].includes(body.sessionId))) throw error(404, 'mobile/not-found', 'This part does not belong to a Bot conversation')
    if (endpoint === 'schedule-create' && !bots.has(body.target) && !rooms.has(body.target)) throw error(404, 'mobile/not-found', 'This task target is not on the team')
    if (endpoint === 'schedule-delete') {
      const catalog = await team('schedules')
      if (!catalog.tasks?.some(task => task.id === body.id && task.sessionId === body.sessionId && (bots.has(task.botId) || rooms.has(task.roomId)))) throw error(404, 'mobile/not-found', 'This task is not on the team')
    }
    if (['agent-session', 'agent-rename', 'agent-archive', 'remove-agent'].includes(endpoint) && !agent) throw error(404, 'mobile/not-found', 'This DSH Agent is not on the team')
    if (['agent-rename', 'agent-archive'].includes(endpoint) && !agent.sessions.includes(body.sessionId)) throw error(404, 'mobile/not-found', 'This Session does not belong to the DSH Agent')
    if (endpoint === 'agent-session' && body.workspaceId !== undefined && body.workspaceId !== view.workspaceId) throw error(403, 'mobile/workspace-denied', 'Create mobile Sessions in the team workspace')
    if (endpoint.startsWith('connector-') && !connectors(view.connectors).some(item => item.id === body.id)) throw error(404, 'mobile/not-found', 'This connector is not configured on the host')
    if (endpoint.startsWith('secret-')) {
      if (body.requestId !== undefined || ['secret-allow', 'secret-cancel'].includes(endpoint)) {
        const found = Object.entries(view.secretRequests ?? {}).some(([botId, requests]) => bots.has(botId) && Array.isArray(requests) && requests.some(request => request.id === body.requestId && request.status === 'pending'))
        if (!found) throw error(409, 'mobile/stale-request', 'This secret request is no longer pending on the team')
        if (body.scope !== undefined && !['bot', 'all'].includes(body.scope)) throw error(400, 'mobile/invalid', 'Choose this Bot or all Bots for a secret request')
      } else {
        if (typeof body.name !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(body.name.trim())) throw error(400, 'mobile/invalid', 'Use an uppercase secret name with letters, digits, and underscores')
        body.name = body.name.trim()
        if (endpoint !== 'secret-set' && !(view.secrets ?? []).some(secret => secret?.name === body.name)) throw error(404, 'mobile/not-found', 'This secret is not stored on the team')
        if (body.scope !== undefined && body.scope !== 'all') {
          if (!Array.isArray(body.scope)) throw error(400, 'mobile/invalid', 'Choose all Bots or a list of team Bots')
          for (const id of body.scope) requireBot(id)
        }
      }
    }
    if (endpoint.startsWith('memory-')) requireBot(body.botId)
    if (body.replace !== undefined) requireBot(body.replace)
    if (['update-room', 'delete-room', 'room-progress'].includes(endpoint) && !rooms.has(body.id ?? body.roomId)) throw error(404, 'mobile/not-found', 'This group is not on the team')
    if (endpoint === 'update-room' && body.permission !== undefined && body.permission !== null) {
      if (typeof body.permission !== 'string' || body.permission === 'auto' || !view.permissions?.options?.some(option => option.value === body.permission)) throw error(400, 'mobile/invalid', 'Choose a permission preset offered by this host')
    }
    for (const key of ['members', 'add', 'remove']) {
      if (body[key] !== undefined) {
        if (!Array.isArray(body[key]) || body[key].length > 30) throw error(400, 'mobile/invalid', 'Invalid group members')
        for (const member of body[key]) requireBot(member)
      }
    }
    if (body.admin !== undefined && body.admin !== null && body.admin !== '') requireBot(body.admin)
    if (body.sessionId !== undefined && endpoint !== 'schedule-delete' && !owned.has(body.sessionId) && !questionSession) throw error(404, 'mobile/not-found', 'This Session is not on the team')
    if (['answer-question', 'dismiss-question'].includes(endpoint) && !owned.has(body.sessionId) && !questionSession) throw error(404, 'mobile/not-found', 'This Session is not on the team')
    scoped.throwIfAborted()
    let result
    try { result = await team(endpoint, body) } catch (cause) {
      if (['secret-set', 'connector-connect'].includes(endpoint)) throw error(cause.status ?? 400, cause.code ?? 'mobile/rejected', 'The host refused this credential change. Check the name, value, and scope.')
      throw cause
    }
    // Some original mutations return the entire Web state including host-only
    // secret metadata. Return the mobile view instead of forwarding that object.
    if (['delete-bot', 'set-main', 'delete-room', 'remove-agent'].includes(endpoint)) return state()
    if (['create-bot', 'update-bot', 'duplicate-bot', 'create-room', 'set-flags', 'add-agent'].includes(endpoint) && result?.id) {
      const visible = await state()
      return [...visible.bots, ...visible.rooms, ...visible.agents].find(item => item.id === result.id) ?? { id: result.id }
    }
    if (endpoint.startsWith('secret-')) return secretView(result) ?? (result === true)
    if (['update-check', 'update-install', 'dsh-update-install'].includes(endpoint) && result) return { ...result,
      ...(result.error ? { error: redact(String(result.error)) } : {}),
      ...(result.dsh ? { dsh: { ...result.dsh, ...(result.dsh.error ? { error: redact(String(result.dsh.error)) } : {}) } } : {}),
    }
    if (endpoint.startsWith('connector-')) return connectors(result)
    if (endpoint.startsWith('schedule') && Array.isArray(result?.tasks)) return { available: result.available === true,
      tasks: result.tasks.filter(task => bots.has(task.botId) || rooms.has(task.roomId)) }
    if (endpoint === 'update-room' && result?.room) return { ...result, room: { ...result.room, parts: [] } }
    if (endpoint === 'room-progress') {
      const members = new Set(view.rooms.find(room => room.id === body.roomId)?.members ?? [])
      return (Array.isArray(result) ? result : []).filter(round => typeof round?.callId === 'string').slice(0, 100).map(round => ({
        callId: round.callId.slice(0, 256), speaking: members.has(round.speaking) ? round.speaking : null,
        replies: (Array.isArray(round.replies) ? round.replies : []).map((reply, index) => ({ reply, index })).filter(({ reply }) => members.has(reply?.botId)).slice(0, 200).map(({ reply, index }) => ({
          groupReplyId: `${round.callId}:${index}`, botId: reply.botId, ...(typeof reply.kind === 'string' ? { kind: reply.kind.slice(0, 40) } : {}),
          ...(typeof reply.text === 'string' ? { text: detail(reply.text, 12000, redact).text } : {}),
          ...(Number.isFinite(reply.time) ? { time: reply.time } : {}),
        })),
      }))
    }
    if (endpoint === 'usage' && Array.isArray(result?.owners)) {
      const keep = new Map()
      const owners = result.owners.filter((owner, index) => {
        const accepted = owner.kind === 'bot' ? bots.has(owner.id) || owner.deleted === true
          : owner.kind === 'room' ? rooms.has(owner.id) || owner.deleted === true : owner.kind === 'agent' && agents.some(item => item.id === owner.id)
        if (accepted) keep.set(index, keep.size)
        return accepted
      })
      return { ...result, owners, rows: (result.rows ?? []).filter(row => keep.has(row[1])).map(row => [row[0], keep.get(row[1]), ...row.slice(2)]) }
    }
    return result
  }
  function options(item, sessionId) {
    return { sessionId, kind: item.kind, hiddenTurns: rt.state?.exchangeTurns?.[sessionId] ?? [], redact,
      changesSummary: (id, seq) => optional('workspaceChanges')?.summary?.(id, seq) }
  }
  async function settings(endpoint, body, signal) {
    const service = optional('settingsController')
    if (!service?.describe) throw unavailable('Harness settings are unavailable on this host')
    const described = await service.describe()
    signal.throwIfAborted()
    if (endpoint === 'settings-describe') return described
    if (rt.readOnly?.() !== undefined || described.writable !== true) throw error(409, 'settings/read-only', 'Harness settings are read-only on this host')
    const namespace = described.namespaces.find(item => item.ns === body.ns)
    if (!namespace) throw error(404, 'settings/not-found', 'This settings namespace is not registered on the host')
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== namespace.revision) throw error(409, 'settings/conflict', 'Settings changed. Refresh the settings page before saving.')
    const dangerous = new Set(['__proto__', 'prototype', 'constructor'])
    const validate = (value, depth = 0) => {
      if (depth > 16) throw error(400, 'settings/invalid', 'The settings value is nested too deeply')
      if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
        if (dangerous.has(key)) throw error(400, 'settings/invalid', 'This settings path is not allowed')
        validate(entry, depth + 1)
      }
    }
    if (endpoint === 'settings-update') {
      if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) throw error(400, 'settings/invalid', 'A settings patch must be an object')
      validate(body.patch)
    } else {
      if (!Array.isArray(body.ops) || body.ops.length === 0 || body.ops.length > 100) throw error(400, 'settings/invalid', 'Provide from 1 to 100 settings edits')
      for (const op of body.ops) {
        if (!op || !['set', 'unset'].includes(op.op) || !Array.isArray(op.path) || !op.path.length || op.path.length > 16
          || op.path.some(key => typeof key !== 'string' || !key || key.length > 256 || dangerous.has(key))) throw error(400, 'settings/invalid', 'This settings edit is not allowed')
        validate(op.value)
      }
    }
    signal.throwIfAborted()
    try {
      return await (endpoint === 'settings-update' ? service.update(body.ns, body.patch, body.expectedRevision) : service.mutate(body.ns, body.ops, body.expectedRevision))
    } catch (cause) {
      throw error(cause?.code === 'settings/conflict' ? 409 : 400, cause?.code ?? 'settings/rejected', 'Harness refused this settings change. Refresh the form and check its constraints.')
    }
  }
  async function credentials(endpoint, body, signal) {
    const service = optional('credentialsController')
    if (!service?.describe) throw unavailable('Harness credential management is unavailable on this host')
    const validRef = ref => typeof ref === 'string' && ref.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)
    const refs = endpoint === 'credentials-describe' ? body.refs : [body.ref]
    if (!Array.isArray(refs) || refs.length > 64 || refs.some(ref => !validRef(ref))) throw error(400, 'credential/invalid', 'Provide up to 64 valid credential references')
    const metadata = await service.describe(refs)
    signal.throwIfAborted()
    if (endpoint === 'credentials-describe') return metadata
    if (rt.readOnly?.() !== undefined || metadata[body.ref]?.writable !== true) throw error(409, 'credential/read-only', 'This credential is read-only on the host')
    if (endpoint === 'credentials-set' && (typeof body.value !== 'string' || !body.value || body.value.length > 65536)) throw error(400, 'credential/invalid', 'Provide a nonempty credential value of at most 65536 characters')
    try {
      if (endpoint === 'credentials-set') await service.set(body.ref, body.value)
      else await service.unset(body.ref)
      return { ref: body.ref, ...(await service.describe([body.ref]))[body.ref] }
    } catch { throw error(400, 'credential/rejected', 'The host refused this credential change. Its value has not been returned.') }
  }
  async function parts(id) {
    const item = await conversation(id)
    const known = item.kind === 'bot' && typeof rt.partsOf === 'function' ? rt.partsOf(item.id) : sessionsOf(item).map((sessionId, index) => ({ sessionId, number: index + 1 }))
    return { conversationId: id, currentSessionId: item.sessionId, parts: known.filter(part => sessionsOf(item).includes(part.sessionId))
      .map(({ sessionId, number, startedAt, endedAt }) => ({ sessionId, number, current: sessionId === item.sessionId,
        cursor: encodeCursor({ v: 1, conversationId: id, sessionId }),
        ...(startedAt !== undefined ? { startedAt } : {}), ...(endedAt !== undefined ? { endedAt } : {}) })) }
  }
  async function context({ conversationId, sessionId, seq, limit = 30 }, signal) {
    const item = await conversation(conversationId)
    requireSession(item, sessionId)
    if (seq === undefined) return history(conversationId, { cursor: encodeCursor({ v: 1, conversationId, sessionId }), limit }, signal)
    if (!Number.isSafeInteger(seq) || seq < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw error(400, 'mobile/invalid', 'Choose a valid message position and context limit from 1 to 100')
    const first = await opening(sessionId, 1, signal)
    if (seq > first.cursor) throw error(404, 'mobile/not-found', 'This message is no longer in the conversation')
    const throughSeq = Math.min(first.cursor, seq + Math.floor(limit / 2))
    const page = await ctx.sessionController.page({ address: { kind: 'session', sessionId }, throughSeq, maxMessages: limit }, signal)
    const messages = projectRecords(page.records, options(item, sessionId))
    return { messages, sessionId, cursor: pageCursor(item, sessionId, page, throughSeq),
      focusId: messages.find(message => message.seq === seq)?.id ?? `${sessionId}:${seq}`, focusSeq: seq }
  }
  async function search({ conversationId, query, cursor, limit = 30 }, signal) {
    await conversation(conversationId)
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw error(400, 'mobile/invalid', 'Search needs a query up to 200 characters and a limit from 1 to 50')
    let next
    if (cursor !== undefined && cursor !== null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 8192) throw new Error()
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
        if (value.v !== 1 || value.conversationId !== conversationId || value.query !== query || typeof value.history !== 'string') throw new Error()
        next = value.history
      } catch { throw error(400, 'mobile/invalid-cursor', 'This search cursor belongs to another query') }
    }
    let messages = []
    let scannedPages = 0
    const wanted = query.trim().toLocaleLowerCase()
    do {
      signal.throwIfAborted()
      const page = await history(conversationId, { cursor: next, limit: limit - messages.length }, signal)
      messages = [...page.messages.filter(message => [message.text, message.reasoning, message.tool?.output].filter(Boolean).join('\n').toLocaleLowerCase().includes(wanted)), ...messages]
      next = page.cursor
      scannedPages++
    } while (next && messages.length < limit && scannedPages < 10)
    return { messages, scannedPages, complete: next === null, cursor: next ? encodeCursor({ v: 1, conversationId, query, history: next }) : null }
  }
  const browserCommands = new Map()
  async function browser(endpoint, body, signal, caller = {}) {
    const view = await state()
    if (!rt.browserEnabled || !rt.browserChannel) return endpoint === 'browser-pages' ? { available: false, pages: [] } : { available: false }
    const bots = new Set(view.bots.map(bot => bot.id))
    const safeUrl = value => {
      try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) return ''; url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString() } catch { return '' }
    }
    if (endpoint === 'browser-pages') return { available: true, pages: Object.entries(rt.browserChannel.openPages()).filter(([id]) => bots.has(id))
      .map(([botId, page]) => ({ botId, url: safeUrl(page.url), title: redact(String(page.title ?? '')), ...(typeof page.mobileControl === 'boolean' ? { mobileControl: page.mobileControl === true, active: page.active, tabs: (page.tabs || []).map(tab => ({ id: tab.id, title: redact(String(tab.title || '')), url: safeUrl(tab.url) })) } : {}) })) }
    if (!bots.has(body.botId)) throw error(404, 'mobile/not-found', 'This Bot is not on the team')
    if (endpoint === 'browser-control') {
      if (rt.readOnly?.() !== undefined) throw error(409, 'bot/read-only', 'The team is read-only on this host')
      if (!['snapshot', 'navigate', 'new-tab', 'activate', 'close', 'back', 'forward', 'reload', 'stop', 'scroll', 'click', 'fill'].includes(body.command)) throw error(400, 'mobile/invalid', 'Unsupported browser command')
      if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestId)) throw error(400, 'mobile/invalid', 'A browser request ID is required')
      if (['navigate', 'new-tab'].includes(body.command) && body.url !== undefined) {
        let url; try { url = new URL(body.url) } catch { throw error(400, 'mobile/invalid', 'Use an HTTP or HTTPS browser address') }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || body.url.length > 2000) throw error(400, 'mobile/invalid', 'Use an HTTP or HTTPS browser address without credentials')
      }
      if (body.command === 'navigate' && !body.url) throw error(400, 'mobile/invalid', 'A browser address is required')
      if (body.tabId !== undefined && !validId(body.tabId)) throw error(400, 'mobile/invalid', 'Invalid tab ID')
      if (['click', 'fill'].includes(body.command) && (typeof body.snapshotId !== 'string' || body.snapshotId.length > 100 || !Number.isInteger(body.item) || body.item < 0 || body.item >= 100)) throw error(400, 'mobile/invalid', 'Refresh the page before selecting its controls')
      if (body.command === 'fill' && (typeof body.text !== 'string' || body.text.length > 8000)) throw error(400, 'mobile/invalid', 'Text input supports up to 8000 characters')
      if (body.command === 'scroll' && !['up', 'down'].includes(body.direction)) throw error(400, 'mobile/invalid', 'Choose a scroll direction')
      const key = `${caller.deviceId || 'operator'}:${body.requestId}`
      const identity = JSON.stringify(body)
      const previous = browserCommands.get(key)
      if (previous) {
        if (previous.identity !== identity) throw error(409, 'mobile/request-conflict', 'This browser request ID was already used')
        return previous.job
      }
      if (rt.browserChannel.openPages()[body.botId]?.mobileControl !== true) throw error(409, 'mobile/browser-disabled', 'Enable mobile control in this Bot’s Desktop browser first')
      if (browserCommands.size >= 2000) throw error(429, 'mobile/browser-limit', 'Restart the mobile bridge to renew the browser command allowance')
      const job = (async () => {
        const result = await rt.browserChannel.read(body.botId, { signal, mobileCommand: { ...body, snapshotId: body.command === 'snapshot' ? randomUUID() : body.snapshotId, expiresAt: Date.now() + 14000 } })
        if (!result.page) throw error(409, 'mobile/browser-unconfirmed', result.error ? redact(String(result.error)) : 'The Desktop browser did not answer. Refresh before continuing; do not replay the action.')
        const page = result.page
        return { available: true, page: { changed: page.changed === true, tabId: page.tabId, snapshotId: page.snapshotId, url: safeUrl(page.url), title: redact(String(page.title || '')), text: redact(String(page.text || '').slice(0, 12000)), controls: (Array.isArray(page.controls) ? page.controls : []).slice(0, 100).map(item => ({ item: item.item, role: String(item.role || '').slice(0, 30), name: redact(String(item.name || '').slice(0, 160)), disabled: item.disabled === true, editable: item.editable === true })) } }
      })()
      browserCommands.set(key, { identity, job })
      // Keep a rejected receipt as well: a click may have happened before transport loss.
      void job.catch(() => {})
      return job
    }
    if (body.start !== undefined && (!Number.isSafeInteger(body.start) || body.start < 0)) throw error(400, 'mobile/invalid', 'The page offset must be nonnegative')
    signal.throwIfAborted()
    const result = await rt.browserChannel.read(body.botId, { signal })
    signal.throwIfAborted()
    if (!result.page) return { available: true, absent: result.absent === true, ...(result.error ? { error: redact(String(result.error)) } : {}) }
    const page = result.page
    const start = body.start ?? 0
    const text = String(page.text ?? '')
    return { available: true, page: { url: safeUrl(page.url), title: redact(String(page.title ?? '')),
      text: redact(text.slice(start, start + 12000)), ...(text.length > start + 12000 ? { next: start + 12000 } : {}) } }
  }
  async function opening(sessionId, limit, signal) {
    if (!ctx.sessionController?.follow) throw unavailable('This host does not provide Session history')
    const controller = new AbortController()
    const scoped = AbortSignal.any([signalFor(signal), controller.signal])
    const iterator = ctx.sessionController.follow({ address: { kind: 'session', sessionId }, maxMessages: limit }, scoped)[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      if (first.done || first.value?.type !== 'snapshot') throw unavailable('The host did not provide a history snapshot')
      return first.value
    } finally {
      controller.abort()
      await iterator.return?.().catch(() => {})
    }
  }
  function pageCursor(item, sessionId, page, throughSeq) {
    if (page.hasMore && page.records?.length) return encodeCursor({ v: 1, conversationId: item.id, sessionId, throughSeq, beforeSeq: page.records[0].event.seq })
    const sessions = sessionsOf(item)
    const previous = sessions[sessions.indexOf(sessionId) - 1]
    return previous ? encodeCursor({ v: 1, conversationId: item.id, sessionId: previous }) : null
  }
  async function history(id, { cursor, limit = 60 } = {}, signal) {
    const item = await conversation(id)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw error(400, 'mobile/invalid', 'History limit must be between 1 and 100')
    let cut = { sessionId: item.sessionId }
    if (cursor !== undefined && cursor !== null) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error()
        cut = JSON.parse(Buffer.from(cursor, 'base64url').toString())
        if (cut.v !== 1 || cut.conversationId !== id || !validId(cut.sessionId)
          || (cut.throughSeq !== undefined && (!Number.isSafeInteger(cut.throughSeq) || cut.throughSeq < -1))
          || (cut.beforeSeq !== undefined && (!Number.isSafeInteger(cut.beforeSeq) || cut.beforeSeq < 0 || cut.throughSeq === undefined || cut.beforeSeq > cut.throughSeq))) throw new Error()
      } catch { throw error(400, 'mobile/invalid-cursor', 'Invalid history cursor') }
    }
    requireSession(item, cut.sessionId)
    const page = cut.throughSeq === undefined ? await opening(cut.sessionId, limit, signal)
      : await ctx.sessionController.page({ address: { kind: 'session', sessionId: cut.sessionId }, throughSeq: cut.throughSeq,
        ...(cut.beforeSeq === undefined ? {} : { beforeSeq: cut.beforeSeq }), maxMessages: limit }, signalFor(signal))
    const throughSeq = cut.throughSeq ?? page.cursor
    return { messages: projectRecords(page.records, options(item, cut.sessionId)),
      cursor: pageCursor(item, cut.sessionId, page, throughSeq), sessionId: cut.sessionId }
  }
  function prune() {
    for (const [id, receipt] of staged) if (receipt.expiresAt <= Date.now()) staged.delete(id)
  }
  async function upload(id, sessionId, { name, mediaType } = {}, bytes, signal) {
    signalFor(signal).throwIfAborted()
    const item = await conversation(id)
    requireSession(item, sessionId, true)
    if (disposed) throw unavailable('The mobile adapter is stopped')
    if (typeof mediaType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType)) throw error(415, 'mobile/unsupported-file', 'Provide a valid attachment media type')
    const image = IMAGE_TYPES.has(mediaType)
    if (!image && !optional('fileUploads')?.uploadStream) throw unavailable('File uploads are not enabled on this host')
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > (image ? MAX_IMAGE : MAX_FILE)) throw error(413, 'mobile/file-size', 'The attachment is empty or exceeds the upload limit')
    const data = Buffer.from(bytes)
    if (image && imageType(data) !== mediaType) throw error(415, 'mobile/invalid-image', 'The image bytes do not match its declared type')
    prune()
    const total = [...staged.values()].reduce((sum, receipt) => sum + receipt.data.length, 0)
    if (staged.size >= 32 || total + data.length > MAX_STAGED) throw error(429, 'mobile/upload-capacity', 'Send or wait for pending uploads to expire before uploading more')
    const receiptId = randomUUID()
    const descriptor = { receiptId, conversationId: id, sessionId, name: safeName(name), mediaType, size: data.length, expiresAt: Date.now() + RECEIPT_TTL }
    staged.set(receiptId, { ...descriptor, image, data })
    return descriptor
  }
  async function submit({ conversationId, sessionId, requestId, text = '', attachments = [] }, signal) {
    const item = await conversation(conversationId)
    requireSession(item, sessionId, true)
    if (!validId(requestId) || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) throw error(400, 'mobile/invalid', 'A stable request ID is required')
    if (typeof text !== 'string' || text.length > 100_000 || !Array.isArray(attachments) || attachments.length > 8) throw error(400, 'mobile/invalid', 'Invalid message content')
    if (text.trim() === '' && attachments.length === 0) throw error(400, 'mobile/invalid', 'Enter a message or attach a file')
    await checkReferences(conversationId, text, signalFor(signal))
    if (rt.readOnly?.() !== undefined) throw error(409, 'bot/read-only', 'The team is read-only on this host')
    prune()
    const content = text.trim() ? [{ type: 'text', text }] : []
    const receipts = attachments.map(ref => staged.get(typeof ref === 'string' ? ref : ref?.receiptId))
    if (receipts.some(receipt => !receipt || receipt.sessionId !== sessionId || receipt.conversationId !== conversationId)) throw error(409, 'mobile/expired-upload', 'An upload has expired or belongs to another Session. Upload it again.')
    const scoped = signalFor(signal)
    for (const receipt of receipts) {
      if (receipt.image) content.push({ type: 'image', mediaType: receipt.mediaType, name: receipt.name, data: receipt.data.toString('base64') })
      else {
        const fileUploads = optional('fileUploads')
        if (!fileUploads?.uploadStream) throw unavailable('File uploads are not enabled on this host')
        // Reuse a staged DSH receipt if prompt admission was interrupted.
        receipt.upload ??= fileUploads.uploadStream({ sessionId, name: receipt.name, signal: scoped, data: (async function* () { yield receipt.data })() })
          .catch(cause => { delete receipt.upload; throw cause })
        const uploaded = await receipt.upload
        content.push({ type: 'file', receiptId: uploaded.receiptId })
      }
    }
    await rt.ensureCapabilities?.(sessionId)
    // Upload admission and capability mounting can await I/O; recheck the target.
    requireSession(await conversation(conversationId), sessionId, true)
    if (rt.readOnly?.() !== undefined) throw error(409, 'bot/read-only', 'The team is read-only on this host')
    if (text.includes('dsh-session:')) await checkReferences(conversationId, text, scoped)
    scoped.throwIfAborted()
    const accepted = await publicCall(() => ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue', content }, scoped))
    if (!accepted?.accepted) throw unavailable('The host did not acknowledge this message')
    for (const receipt of receipts) staged.delete(receipt.receiptId)
    return { accepted: true, conversationId, sessionId, requestId }
  }
  async function cancel(id, signal) {
    const item = await conversation(id)
    if (rt.readOnly?.() !== undefined) throw error(409, 'bot/read-only', 'The team is read-only on this host')
    const value = await publicCall(() => ctx.sessionController.cancel({ sessionId: item.sessionId }, signalFor(signal)))
    return { ...value, conversationId: id, sessionId: item.sessionId, queueCleared: false }
  }
  async function queue(id, signal) {
    const item = await conversation(id)
    if (!ctx.sessionController.projections) throw unavailable('This host does not provide queue projections')
    const projection = await ctx.sessionController.projections({ sessionId: item.sessionId }, signalFor(signal))
    return { sessionId: item.sessionId, items: projectQueue(projection?.values?.inbox, { redact }) }
  }
  async function reconcile({ conversationId, sessionId, requestId }, signal) {
    const item = await conversation(conversationId)
    requireSession(item, sessionId)
    if (!validId(requestId)) throw error(400, 'mobile/invalid', 'A request ID is required')
    const scoped = AbortSignal.any([signalFor(signal), AbortSignal.timeout(5000)])
    const matches = message => message?.source?.kind === 'user' && message.source.rpcId === requestId
    const accepted = { accepted: true, conversationId, sessionId, requestId }
    if (ctx.sessionController.projections) {
      const projection = await ctx.sessionController.projections({ sessionId }, scoped)
      const inbox = projection?.values?.inbox
      if ([...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])].some(matches)) return accepted
    }
    let page = await opening(sessionId, 100, scoped)
    const throughSeq = page.cursor
    for (let count = 0; count < 5; count += 1) {
      if ((page.records ?? []).some(record => record.event?.type === 'user/message' && matches(record.event.data))) return accepted
      if (!page.hasMore || !page.records?.length) break
      page = await ctx.sessionController.page({ address: { kind: 'session', sessionId }, throughSeq,
        beforeSeq: page.records[0].event.seq, maxMessages: 100 }, scoped)
    }
    // Missing or compacted evidence never proves a submission was rejected.
    return null
  }
  async function* follow(id, _options = {}, signal) {
    let item = await conversation(id)
    while (!signal?.aborted && !disposed) {
      const controller = new AbortController()
      const scoped = AbortSignal.any([...(signal ? [signal] : []), controller.signal, shutdown.signal])
      const sessionId = item.sessionId
      const calls = new Map()
      const attempts = new Map()
      const committed = new Map()
      let lastEventSeq = -1
      let inbox = { 'next-turn': [], 'next-step': [] }
      let pending
      let timer
      let changed = false
      const iterator = ctx.sessionController.follow({ address: { kind: 'session', sessionId }, maxMessages: 60, assistantStream: true }, scoped)[Symbol.asyncIterator]()
      try {
        pending = iterator.next()
        while (!scoped.aborted) {
          const next = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500) })])
          clearTimeout(timer)
          if (next === null) {
            const current = await conversation(id)
            if (current.sessionId !== sessionId) { item = current; changed = true; break }
            yield { type: 'status', conversationId: id, sessionId, activity: current.activity,
              ...(current.running !== undefined ? { running: current.running, phase: current.running ? 'running' : 'idle' } : {}) }
            continue
          }
          if (next.done) break
          const frame = next.value
          if (frame.type === 'snapshot') {
            const lastTurn = (frame.records ?? []).findLast(record => ['turn/start', 'turn/end'].includes(record.event?.type))?.event
            const running = lastTurn ? lastTurn.type === 'turn/start' : !!frame.assistantStream?.activeAttempt || item.running === true
            lastEventSeq = frame.cursor
            for (const record of frame.records ?? []) if (record.event?.type === 'tool/call') calls.set(record.event.data.callId, record.event)
            yield { type: 'reset', conversationId: id, sessionId, eventSeq: frame.cursor, running, phase: running ? 'running' : 'idle',
              messages: projectRecords(frame.records, { ...options(item, sessionId), calls }), cursor: pageCursor(item, sessionId, frame, frame.cursor) }
            if (frame.projections?.values?.inbox) {
              inbox = { 'next-turn': [...(frame.projections.values.inbox['next-turn'] ?? [])], 'next-step': [...(frame.projections.values.inbox['next-step'] ?? [])] }
              yield { type: 'status', conversationId: id, sessionId, queue: projectQueue(inbox, { redact }) }
            }
            const active = frame.assistantStream?.activeAttempt
            if (active) {
              const accumulator = createTextAccumulator(active.stream)
              attempts.set(active.attemptId, { accumulator, nextIndex: active.nextIndex, turn: active.turn, step: active.step })
              if ((accumulator.text() || accumulator.reasoning()) && !options(item, sessionId).hiddenTurns.includes(active.turn)) yield { type: 'delta', conversationId: id, sessionId, attemptId: active.attemptId,
                text: redact(accumulator.text()), reasoning: redact(accumulator.reasoning()), index: active.nextIndex - 1, replace: true }
            }
          } else if (frame.type === 'event') {
            lastEventSeq = frame.event.seq
            if (frame.event.type === 'agent/inbox/spliced') {
              const splice = frame.event.data
              if (Object.hasOwn(inbox, splice.target)) inbox[splice.target].splice(splice.start, splice.removedCount ?? 0, ...(splice.inserted ?? []))
              yield { type: 'status', conversationId: id, sessionId, queue: projectQueue(inbox, { redact }) }
            }
            const messages = projectEvent(frame.event, { ...options(item, sessionId), calls })
            const liveAttempt = frame.event.type === 'assistant/message' ? [...attempts].find(([, attempt]) =>
              attempt.turn === frame.event.data?.turn && attempt.step === frame.event.data?.step)?.[0] : undefined
            const replaceAttemptId = committed.get(frame.event.seq) ?? liveAttempt
            for (const message of messages) yield { type: 'message', conversationId: id, sessionId, message,
              ...(replaceAttemptId ? { replaceAttemptId } : {}) }
            committed.delete(frame.event.seq)
            if (frame.event.type === 'turn/end' || frame.event.type === 'turn/start') yield { type: 'status', conversationId: id, sessionId,
              running: frame.event.type === 'turn/start', phase: frame.event.type === 'turn/start' ? 'running' : 'idle', eventSeq: frame.event.seq }
          } else if (frame.type === 'assistant-stream') {
            const live = frame.frame
            if (live.type === 'start') attempts.set(live.attemptId, { accumulator: createTextAccumulator(), nextIndex: 0, turn: live.turn, step: live.step })
            if (live.type === 'chunk') {
              const active = attempts.get(live.attemptId)
              if (active && live.index === active.nextIndex) {
                const before = active.accumulator.text()
                const beforeReasoning = active.accumulator.reasoning()
                active.accumulator.accept(live.chunk)
                active.nextIndex += 1
                if (options(item, sessionId).hiddenTurns.includes(active.turn)) {
                  if (before || beforeReasoning) yield { type: 'status', conversationId: id, sessionId, attemptId: live.attemptId, clearAttempt: true, phase: 'hidden' }
                } else if (before !== active.accumulator.text() || beforeReasoning !== active.accumulator.reasoning()) yield { type: 'delta', conversationId: id, sessionId, attemptId: live.attemptId,
                  text: redact(active.accumulator.text()), reasoning: redact(active.accumulator.reasoning()), index: live.index, replace: true }
              }
            }
            if (live.type === 'end') {
              if (live.outcome?.kind === 'committed' && live.outcome.seq > lastEventSeq) committed.set(live.outcome.seq, live.attemptId)
              attempts.delete(live.attemptId)
              yield { type: 'status', conversationId: id, sessionId, attemptId: live.attemptId, phase: live.outcome?.kind ?? 'abandoned', clearAttempt: true }
            }
          }
          pending = iterator.next()
        }
      } finally {
        clearTimeout(timer)
        controller.abort()
        await pending?.catch(() => {})
        await iterator.return?.().catch(() => {})
      }
      if (!changed) break
    }
  }
  async function transcribe({ mediaType } = {}, bytes, signal) {
    const speech = optional('speechToText')
    if (!speech?.resolve || !speech?.transcribe) throw unavailable('Enable and prepare the host Voice Input plugin to use transcription')
    if (!AUDIO_TYPES.has(mediaType)) throw error(415, 'mobile/unsupported-audio', 'Unsupported audio recording format')
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_AUDIO) throw error(413, 'mobile/audio-size', 'The recording is empty or exceeds 10 MiB')
    if (transcribing) throw error(429, 'mobile/transcription-busy', 'A recording is already being transcribed')
    transcribing = true
    const scoped = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000), shutdown.signal])
    try {
      scoped.throwIfAborted()
      const audio = await normalizeAudio(Buffer.from(bytes), scoped)
      const spec = speech.resolve({ audio })
      return await speech.transcribe(spec, scoped)
    } catch (cause) {
      if (scoped.aborted) throw scoped.reason
      if (cause?.status) throw cause
      throw unavailable('The speech provider is not ready. Prepare Voice Input on the host and retry.')
    } finally { transcribing = false }
  }
  async function attachment(id, sessionId, attachmentId, signal, { seq } = {}) {
    const item = await conversation(id)
    requireSession(item, sessionId)
    if (!validId(attachmentId)) throw error(400, 'mobile/invalid', 'An attachment ID is required')
    if (seq !== undefined) {
      if (!Number.isSafeInteger(seq) || seq < 0) throw error(400, 'mobile/invalid', 'An exact message sequence is required')
      const scoped = signalFor(signal)
      const page = await publicCall(() => ctx.sessionController.page({ address: { kind: 'session', sessionId }, throughSeq: seq, maxMessages: 1 }, scoped))
      const record = page.records?.find(record => record.event?.seq === seq)
      const visible = record && projectRecords([record], options(item, sessionId)).some(message => message.attachments?.some(ref => ref.id === attachmentId && ref.type === 'file'))
      const content = record?.event?.data?.content ?? record?.event?.data?.message?.content
      const ref = visible && Array.isArray(content) && content.find(block => block.type === 'file' && block.attachment?.attachmentId === attachmentId)?.attachment
      if (ref) {
        if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > MAX_FILE) throw error(413, 'mobile/file-size', 'This file exceeds the mobile download limit of 20 MiB')
        const store = optional('attachments')
        if (!store?.readFileStream) throw unavailable('File downloads are not enabled on this host')
        const chunks = []
        let size = 0
        try {
          for await (const chunk of store.readFileStream(ref, scoped)) {
            scoped.throwIfAborted()
            size += chunk.byteLength
            if (size > ref.bytes || size > MAX_FILE) throw new Error('Invalid file size')
            chunks.push(Buffer.from(chunk))
          }
          if (size !== ref.bytes) throw new Error('Invalid file size')
        } catch {
          if (scoped.aborted) throw scoped.reason
          throw unavailable('This file could not be verified. Retry or check it on the host.')
        }
        requireSession(await conversation(id), sessionId)
        return { attachment: { attachmentId, name: safeName(ref.name), bytes: size, mediaType: 'application/octet-stream' }, data: Buffer.concat(chunks, size).toString('base64'), file: true }
      }
      throw error(404, 'mobile/not-found', 'This file is not referenced by that visible message')
    }
    // The public controller also checks that the image occurs in this Session.
    return publicCall(() => ctx.sessionController.attachment({ sessionId, attachmentId }, signalFor(signal)))
  }
  return { state, conversations, history, target, submit, cancel, follow, upload, transcribe, attachment, action, reconcile, queue, conversationForSession,
    setApprovalBroker(broker, options = {}) { approvalBroker = broker; authorizeApprovalDevice = options.authorizeDevice },
    approvalOperator(endpoint, payload) {
      if (endpoint === 'approvals.list') return approvalBroker?.list() ?? { requests: [] }
      if (typeof payload?.id === 'string' && payload.id.startsWith('group:')) return resolveGroupApproval(payload)
      if (!approvalBroker) throw unavailable('Tool approvals are unavailable on this host')
      return approvalBroker.resolveForDesktop(payload)
    },
    capabilities: () => ({ images: true, files: !!optional('fileUploads')?.uploadStream, transcription: !!optional('speechToText')?.transcribe,
      maxImageBytes: MAX_IMAGE, maxFileBytes: MAX_FILE, maxAudioBytes: MAX_AUDIO, maxAudioSeconds: 60, audioStreaming: false,
      approvals: !!approvalBroker, actions: Object.keys(ACTIONS), attachmentDownloads: ['image', ...(optional('attachments')?.readFileStream ? ['file'] : [])], historyResume: 'snapshot-merge' }),
    dispose() { disposed = true; shutdown.abort(); approvalBroker?.dispose(); staged.clear() } }
}
