// Aside questions (btw): one model call on a snapshot of a Bot's private chat.
// Nothing is written into the Session, and no tool call is ever dispatched.
// Cards live in a file per Bot and part (<home>/btw/<botId>/<partId>.json), not
// in state.json, so a save never rewrites them; only the host that owns the
// team writes them.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { BTW_LIMIT } from './constants.js'
import { replaceFile } from './files.js'

// The mock model recognizes an aside by this first line.
export const BTW_MARKER = 'ds-bot/btw'

const BTW_PROMPT = [
  BTW_MARKER,
  'Answer briefly from the conversation so far, based on progress up to this snapshot.',
  'Do not call any tool.',
  'If the answer needs information that is not in the conversation, say so.',
  'Never claim to have done anything.',
].join('\n')
const BTW_RETRY = 'Do not call any tool. Answer in text only.'
const RESTART_ERROR = 'DS Bot restarted before this answer finished.'
const TOOL_ERROR = 'The model called a tool again after being told not to, so this aside was not answered.'
const EMPTY_ERROR = 'The model wrote nothing.'
// Events that still belong to a turn. A model selection or a title does not.
const MESSAGE_EVENTS = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/start', 'turn/end'])
// Host-only projection. `turnBoundary` clears its open seq on turn/end, so a
// log-only tail would lose the turn it still belongs to.
const ANCHOR_KEY = 'dsBotAnchor'

const seqOf = (value) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
const turnOf = (value) => (typeof value === 'number' && Number.isInteger(value) ? value : null)

// Checkpoint check for the projection registry. The live read does not use it.
const anchorStateSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('ds-bot anchor projection state is not an object')
    const starts = []
    if (Array.isArray(value.starts)) {
      for (const start of value.starts) {
        const seq = seqOf(start?.seq)
        const turn = turnOf(start?.turn)
        if (seq === null || turn === null) continue
        starts.push({ seq, turn })
      }
    }
    return { turnStartSeq: seqOf(value.turnStartSeq), turn: turnOf(value.turn), messageSeq: seqOf(value.messageSeq), starts }
  },
}

// `turnStartSeq` is the latest turn/start and stays set after turn/end.
// `starts` lists every numbered turn/start so a later page can seed its rows.
const anchorProjection = {
  key: ANCHOR_KEY,
  stateVersion: 1,
  stateSchema: anchorStateSchema,
  init() {
    return { turnStartSeq: null, turn: null, messageSeq: null, starts: [] }
  },
  apply(state, event) {
    const seq = seqOf(event?.seq)
    if (seq === null) return state
    if (event.type === 'turn/start') {
      const turn = turnOf(event.data?.turn)
      if (turn === null) return state.turnStartSeq === seq && state.messageSeq === seq ? state : { ...state, turnStartSeq: seq, messageSeq: seq }
      return { turnStartSeq: seq, turn, messageSeq: seq, starts: [...state.starts, { seq, turn }] }
    }
    if (!MESSAGE_EVENTS.has(event.type) || state.messageSeq === seq) return state
    return { ...state, messageSeq: seq }
  },
}

// `session.eventAt` is closed to new callers. The registry folds the log;
// this reads the fold. Absent means the capability is not loaded.
function registerAnchor(ctx) {
  const register = (projections) => {
    if (typeof projections?.register === 'function') projections.register(anchorProjection)
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionProjections'], (projectionCtx) => { register(projectionCtx.sessionProjections) })
    return
  }
  register(ctx.get?.('sessionProjections'))
}

function anchorState(session, projections) {
  if (typeof projections?.stateOf !== 'function' || session == null) return undefined
  return projections.stateOf(session, ANCHOR_KEY)
}

const callIds = (message) => {
  if (message?.role !== 'assistant' || !Array.isArray(message.content)) return []
  const ids = []
  for (const block of message.content) if (block?.type === 'tool-call') ids.push(block.id)
  return ids
}

// DSH commits the assistant message before tool results exist. A tail that still
// owes a result is dropped whole: an adapter rejects a tool call with no result,
// and an aside does not wait for one or invent one.
export function trimToolBoundary(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return []
  let index = messages.length
  while (index > 0 && messages[index - 1]?.role === 'tool') index -= 1
  const calls = callIds(messages[index - 1])
  if (calls.length === 0) return messages
  const answered = new Set()
  for (const message of messages.slice(index)) {
    if (typeof message?.toolCallId === 'string') answered.add(message.toolCallId)
  }
  const balanced = calls.every(id => typeof id === 'string' && answered.has(id))
  return balanced ? messages : messages.slice(0, index - 1)
}

// `seq` is the next event's number. The last committed one is the snapshot's atSeq.
const committedSeq = (session) => {
  const seq = session?.seq
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq - 1 : null
}

// `atSeq` is the last committed event, which may be log-only. `anchorSeq` is the
// turn/start of the turn that event belongs to (or the newest message when no
// turn has started) so the card is not left turnless. `turn` is that turn's
// number from the same read, or null when no numbered turn owns the snapshot.
function placementOf(session, projections) {
  const state = anchorState(session, projections)
  if (state == null) return { anchorSeq: null, turn: null }
  return { anchorSeq: seqOf(state.turnStartSeq) ?? seqOf(state.messageSeq), turn: turnOf(state.turn) }
}

// The turn number in effect at `seq`: the latest numbered turn/start at or
// before it. No projection, no session, or no such start leaves it unset.
export function openTurnAt(projections, session, seq) {
  if (seqOf(seq) === null) return undefined
  const starts = anchorState(session, projections)?.starts
  if (!Array.isArray(starts)) return undefined
  let best = -1
  let turn
  for (const start of starts) {
    const at = seqOf(start?.seq)
    if (at === null || at > seq || at < best) continue
    const next = turnOf(start.turn)
    if (next === null) continue
    best = at
    turn = next
  }
  return turn
}

// Header, derived history, tool history, and the session id, taken together.
function snapshotOf(session, projections) {
  const header = session.requestHeader()
  const messages = trimToolBoundary(session.deriveMessages())
  const toolHistory = session.toolHistory()
  const sessionId = session.id
  const { anchorSeq, turn } = placementOf(session, projections)
  return { header, messages, toolHistory, sessionId, atSeq: committedSeq(session), anchorSeq, turn }
}

const promptFor = (question, retry) => [BTW_PROMPT, ...(retry ? [BTW_RETRY] : []), question].join('\n\n')

export function install(rt) {
  const { ctx, state } = rt
  registerAnchor(ctx)
  /** @type {Map<string, {botId: string, controller: AbortController, done?: Promise<void>}>} */
  const flights = new Map()
  /** @type {Map<string, Set<string>>} */
  const byBot = new Map()
  // Set before abort, so a call that settles in the abort turn cannot save.
  let disposing = false
  const dropped = new Set()

  const track = (id, botId, controller) => {
    flights.set(id, { botId, controller })
    const ids = byBot.get(botId) ?? new Set()
    ids.add(id)
    byBot.set(botId, ids)
  }
  const untrack = (id) => {
    const flight = flights.get(id)
    if (flight === undefined) return
    flights.delete(id)
    const ids = byBot.get(flight.botId)
    ids?.delete(id)
    if (ids?.size === 0) byBot.delete(flight.botId)
  }

  // Cards by Bot and part. A part's list is read from
  // <home>/btw/<botId>/<partId>.json on first need and kept here; writes are
  // whole-file replaces, queued so a finish and a cancel never interleave. A
  // runtime without a home (a bare channel install) keeps cards in memory only.
  const cardsDir = typeof rt.home === 'string' ? join(rt.home, 'btw') : undefined
  const partFile = (botId, partId) => join(cardsDir, botId, `${partId}.json`)
  const partKey = (botId, partId) => `${botId}/${partId}`
  const writes = () => rt.readOnly?.() === undefined
  /** @type {Map<string, Map<string, object[]>>} */
  const cards = new Map()
  const reading = new Map()
  let writing = Promise.resolve()

  const listOf = (botId, partId) => cards.get(botId)?.get(partId) ?? []
  const findCard = (botId, id) => {
    for (const list of cards.get(botId)?.values() ?? []) {
      const found = list.find(card => card?.id === id)
      if (found !== undefined) return found
    }
    return undefined
  }

  const writePart = (botId, partId) => {
    const run = writing.then(async () => {
      if (cardsDir === undefined || !writes() || dropped.has(botId) || rt.botOf(botId) === undefined) return
      const path = partFile(botId, partId)
      await mkdir(dirname(path), { recursive: true })
      const temp = `${path}.${process.pid}.tmp`
      try {
        await writeFile(temp, JSON.stringify(cards.get(botId)?.get(partId) ?? [], null, 2), 'utf8')
        await replaceFile(temp, path)
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw error
      }
    })
    writing = run.catch(() => {})
    return run
  }

  // A card event rewrites its part's file; the state save afterwards only bumps
  // the revision, so a window polls fresh cards.
  const persist = async (card) => {
    await writePart(card.botId, card.partId).catch(error => rt.warn('ds-bot: btw cards of %s not saved: %s', card.botId, error))
    await rt.save()
  }

  // A part's list, reading its file once. The owning host records the restart a
  // previous process left behind: an 'answering' card that is not one of this
  // process's flights failed with it, and the file is written again. A reading
  // host keeps the cards as they were saved.
  async function readPart(botId, partId) {
    const byBot = cards.get(botId) ?? new Map()
    cards.set(botId, byBot)
    const held = byBot.get(partId)
    if (held !== undefined) return held
    const key = partKey(botId, partId)
    const pending = reading.get(key)
    if (pending !== undefined) return pending
    const job = (async () => {
      let list = []
      if (cardsDir === undefined) {
        byBot.set(partId, list)
        return list
      }
      try {
        const parsed = JSON.parse(await readFile(partFile(botId, partId), 'utf8'))
        if (Array.isArray(parsed)) list = parsed.filter(card => card !== null && typeof card === 'object' && !Array.isArray(card))
      } catch (error) {
        if (error?.code !== 'ENOENT') rt.warn('ds-bot: unreadable btw cards %s: %s', partFile(botId, partId), error?.code ?? error)
      }
      if (writes()) {
        const now = Date.now()
        let touched = false
        list = list.map((card) => {
          if (card.status !== 'answering' || flights.has(card.id)) return card
          touched = true
          return { ...card, status: 'failed', error: card.error ?? RESTART_ERROR, finishedAt: card.finishedAt ?? now }
        })
        byBot.set(partId, list)
        if (touched) await writePart(botId, partId).catch(error => rt.warn('ds-bot: btw cards of %s not saved: %s', botId, error))
      } else {
        byBot.set(partId, list)
      }
      return byBot.get(partId)
    })()
    reading.set(key, job)
    try {
      return await job
    } finally {
      reading.delete(key)
    }
  }

  // Only each Bot's current part is read up front. An earlier part's file is
  // read when that part's history is asked for (parts.js's earlier page).
  const originalLoad = rt.load?.bind(rt)
  if (typeof originalLoad === 'function') {
    let ready
    rt.load = () => (ready ??= (async () => {
      await originalLoad()
      for (const botId of Object.keys(state.bots)) await readPart(botId, rt.chatOf(botId))
    })())
  }

  const originalRefresh = rt.refresh?.bind(rt)
  if (typeof originalRefresh === 'function') {
    rt.refresh = async () => {
      const wasWriting = writes()
      await originalRefresh()
      // Taking over a team the other host closed makes this one the writer:
      // re-read the loaded parts so a leftover 'answering' is recorded now.
      if (wasWriting || !writes()) return
      for (const [botId, byBot] of cards) {
        const parts = Array.from(byBot.keys())
        byBot.clear()
        for (const partId of parts) await readPart(botId, partId)
      }
    }
  }

  // The team view carries each Bot's current part only; earlier parts come with
  // their history pages.
  const btwView = () => {
    const view = {}
    for (const botId of Object.keys(state.bots)) {
      const list = listOf(botId, rt.chatOf(botId))
      if (list.length > 0) view[botId] = list
    }
    return view
  }

  const abandoned = botId => disposing || dropped.has(botId) || rt.botOf(botId) === undefined
  const stopError = (botId) => new Error(disposing && !dropped.has(botId) && rt.botOf(botId) !== undefined ? 'DS Bot is stopping.' : 'Unknown Bot')

  // Wait until every targeted flight has left. A call still inside resolveAgent
  // has no `done` yet; yielding lets it notice disposal and drop the slot.
  async function drain(ids) {
    const left = () => (ids === undefined ? [...flights.keys()] : ids.filter(id => flights.has(id)))
    for (;;) {
      const idsLeft = left()
      if (idsLeft.length === 0) return
      const waiting = idsLeft.map(id => flights.get(id)?.done).filter(Boolean)
      if (waiting.length > 0) {
        await Promise.allSettled(waiting)
        continue
      }
      await new Promise(resolve => { setTimeout(resolve, 0) })
    }
  }

  // The same route as the conversation, including temperature, stop, and the output
  // budget: thinking shares it, so an aside must not set a small one of its own. The
  // messages array is tagged for usage.
  async function callModel(snapshot, question, retry, signal) {
    const messages = rt.tagUsage([
      ...snapshot.messages,
      { role: 'user', content: [{ type: 'text', text: promptFor(question, retry) }] },
    ], { sessionId: snapshot.sessionId, kind: 'btw' })
    const assembler = new BlockAssembler()
    const tools = snapshot.header?.tools
    for await (const chunk of ctx.llm.stream({
      ...snapshot.header?.config,
      messages,
      toolHistory: snapshot.toolHistory,
      ...(tools ? { tools: [...tools] } : {}),
      sessionId: snapshot.sessionId,
      signal,
    })) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      return { failed: finish.failure?.message ?? finish.kind }
    }
    const text = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    // Checked before a tool-call retry: a truncated tool call is not a request.
    if (finish.kind === 'max-tokens') return { text, cutOff: true }
    const toolCalls = finish.kind === 'tool-calls' || assembler.blocks().some(block => block?.type === 'tool-call')
    return { text, toolCalls }
  }

  // The card is gone when its Bot was deleted or this host is unloading.
  function alive(card) {
    if (disposing || dropped.has(card.botId)) return false
    if (rt.botOf(card.botId) === undefined) return false
    return findCard(card.botId, card.id) === card
  }

  // Only the first writer wins. Cancel sets 'cancelled' before it aborts.
  function settle(card, patch) {
    if (card.status !== 'answering' || !alive(card)) return false
    Object.assign(card, patch, { finishedAt: Date.now() })
    return true
  }

  async function complete(card, snapshot, question, signal) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (signal.aborted || card.status !== 'answering' || !alive(card)) return
        const result = await callModel(snapshot, question, attempt === 1, signal)
        if (signal.aborted || card.status !== 'answering' || !alive(card)) return
        if (result.failed !== undefined) {
          // Cancel already left this card, and the check above returned. A provider
          // that stops on its own still fails the card, so it does not stay 'answering'.
          if (settle(card, { status: 'failed', error: result.failed, answer: '' })) await persist(card)
          return
        }
        if (result.cutOff) {
          const answer = result.text ?? ''
          if (settle(card, { status: 'failed', error: BTW_LIMIT, answer, finish: 'max-tokens' })) await persist(card)
          return
        }
        if (result.toolCalls) {
          if (attempt === 0) continue
          if (settle(card, { status: 'failed', error: TOOL_ERROR, answer: '' })) await persist(card)
          return
        }
        if (result.text === '') {
          if (settle(card, { status: 'failed', error: EMPTY_ERROR, answer: '' })) await persist(card)
          return
        }
        if (settle(card, { status: 'done', answer: result.text })) await persist(card)
        return
      }
    } catch (error) {
      if (signal.aborted || card.status !== 'answering' || !alive(card)) return
      const message = error?.message ?? String(error)
      rt.warn('ds-bot: btw for %s failed: %s', card.botId, message)
      if (settle(card, { status: 'failed', error: message, answer: '' })) await persist(card)
    }
  }

  // A Bot id or an earlier part of its own chat means the current part, as `send` does.
  function locate(raw) {
    const past = rt.pastOwners.get(raw)
    const sessionId = rt.botOf(raw) ? rt.chatOf(raw) : past && past.roomId === undefined ? rt.chatOf(past.botId) : raw
    const grouped = rt.roomOf(raw) !== undefined || rt.roomOf(sessionId) !== undefined
      || rt.groupOwners.has(raw) || rt.groupOwners.has(sessionId)
      || past?.roomId !== undefined
    if (grouped) throw new Error('btw is only available in a Bot\'s private chat.')
    const botId = rt.chatOwners.get(sessionId) ?? rt.botOf(raw)?.id
    if (botId === undefined || rt.botOf(botId) === undefined) throw new Error('Unknown Bot')
    return { sessionId, botId }
  }

  async function askBtw({ sessionId: raw, text }) {
    const question = typeof text === 'string' ? text : ''
    if (question.trim() === '') throw Object.assign(new Error('Write a question after /btw.'), { code: 'bot/invalid' })
    const { sessionId, botId } = locate(raw)
    const id = randomUUID()
    const controller = new AbortController()
    track(id, botId, controller)
    let started = false
    try {
      const agent = await rt.resolveAgent(sessionId)
      if (abandoned(botId)) throw stopError(botId)
      const snapshot = snapshotOf(agent.session, ctx.get?.('sessionProjections'))
      const route = snapshot.header?.config
      if (!route?.provider || !route?.model) throw new Error('This Bot has not called a model yet. Send a normal message first.')
      const card = {
        id,
        botId,
        partId: snapshot.sessionId,
        atSeq: snapshot.atSeq,
        anchorSeq: snapshot.anchorSeq,
        turn: snapshot.turn,
        question,
        answer: '',
        status: 'answering',
        createdAt: Date.now(),
      }
      await readPart(botId, sessionId)
      cards.get(botId).set(sessionId, [card, ...listOf(botId, sessionId)])
      await persist(card)
      // Unload keeps the saved card for the next owner. Deletion already removed it.
      if (abandoned(botId) || findCard(botId, id) !== card) {
        if (disposing && !dropped.has(botId) && findCard(botId, id) === card) return { id }
        throw new Error('Unknown Bot')
      }
      const done = complete(card, snapshot, question, controller.signal).finally(() => untrack(id))
      const flight = flights.get(id)
      if (flight !== undefined) flight.done = done
      started = true
      return { id }
    } catch (error) {
      const list = listOf(botId, sessionId)
      if (list.some(card => card.id === id)) {
        cards.get(botId)?.set(sessionId, list.filter(card => card.id !== id))
        await writePart(botId, sessionId).catch(() => {})
      }
      throw error
    } finally {
      if (!started) untrack(id)
    }
  }

  async function cancelBtw({ sessionId: raw, id }) {
    const { botId } = locate(raw)
    const card = findCard(botId, id)
    if (card === undefined) throw new Error('This aside question is no longer here.')
    if (card.status !== 'answering') return { answering: false }
    card.status = 'cancelled'
    card.finishedAt = Date.now()
    flights.get(id)?.controller.abort()
    await persist(card)
    return { answering: true }
  }

  // Plugin unload. The card stays 'answering'; the next owning host records the restart.
  async function btwDispose() {
    disposing = true
    for (const flight of flights.values()) flight.controller.abort()
    await drain()
    await writing
  }

  // Clears the Bot's cards before the roster save, and waits out calls that
  // would otherwise finish into the deleted team.
  async function dropBot(botId) {
    dropped.add(botId)
    cards.delete(botId)
    for (const key of reading.keys()) if (key.startsWith(`${botId}/`)) reading.delete(key)
    const ids = [...(byBot.get(botId) ?? [])]
    for (const id of ids) flights.get(id)?.controller.abort()
    await drain(ids)
    if (cardsDir !== undefined && writes()) await rm(join(cardsDir, botId), { recursive: true, force: true }).catch(error => rt.warn('ds-bot: btw cards of %s not removed: %s', botId, error))
  }

  // Channel can be installed without the roster (the thinking route test). The
  // full runtime always has deleteBot, and that is the path that must drop cards.
  if (typeof rt.deleteBot === 'function') {
    const originalDelete = rt.deleteBot.bind(rt)
    rt.deleteBot = async (id) => {
      if (rt.botOf(id) !== undefined && !rt.isMain(id)) await dropBot(id)
      return originalDelete(id)
    }
  }

  const btwJoin = id => flights.get(id)?.done ?? Promise.resolve()

  Object.assign(rt, { askBtw, cancelBtw, btwJoin, btwDispose, btwView, btwPartCards: readPart })
}
