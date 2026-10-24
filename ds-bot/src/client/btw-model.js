// Side questions. `/btw` is claimed only in a Bot's private chat. A group, an
// attachment, or an empty question throws, so the draft stays and the line
// never becomes a normal send. Until the roster is ready, Enter waits (or
// refuses): undefined is only for a session that is positively not a Bot.
// Cards are not transcript entries. A numeric anchorSeq is the owning turn's
// turn/start, or the newest message when no turn has started. It matches a
// closed turn when start <= anchorSeq <= end, and a turn/start value equals
// that turn's start. Null or absent anchorSeq falls back to atSeq, so an old
// card still follows the latest turn that had started by then. The dock holds
// a card until that turn has closed; the turn tail holds it after that.
// Earlier parts place the card once after the rows of that turn. A card with an
// integer `turn` (or `atTurn`) attaches only to rows of that turn; if those
// rows are not loaded it stays in the trailing block. Rows carry `turn` and
// `seq`. A part with no visible rows keeps its cards in that same block.
import { t } from './i18n.js'

export const BTW_SOURCE = 'ds-bot-btw'
export const BTW_TOKEN = '/btw '

const GROUP_REFUSAL = "btw is only available in a Bot's private chat."
const ATTACHMENT_REFUSAL = '/btw does not take attachments.'
const EMPTY_REFUSAL = 'Write a question after /btw.'
const LOADING_REFUSAL = 'DS Bot is still loading this chat.'

export function btwSurface(roster, sessionId) {
  if (!roster?.ready) return 'unknown'
  if (roster.roomsById?.[sessionId]) return 'group'
  if (roster.byId?.[sessionId]) return 'bot'
  return 'other'
}

// The leading token, or null when the line is not a `/btw` command.
// `/btwquestion` is ordinary text. The match is case-sensitive.
export function parseBtwLine(line) {
  const trimmed = String(line ?? '').trim()
  if (!trimmed.startsWith('/')) return null
  const gap = trimmed.search(/\s/)
  const token = gap === -1 ? trimmed : trimmed.slice(0, gap)
  if (token !== '/btw') return null
  const args = gap === -1 ? '' : trimmed.slice(gap + 1)
  return { args, bare: args.trim() === '' }
}

export function btwQueryMatches(query) {
  const head = String(query ?? '').trim().toLowerCase().split(/\s/, 1)[0] ?? ''
  return head === '' || 'btw'.startsWith(head)
}

// A claim, or undefined when this surface does not offer the command.
// Groups are refused on Enter, not here: Space must not turn the line into a chip.
export function matchBtwSpace(roster, sessionId, token) {
  if (token !== '/btw' || btwSurface(roster, sessionId) !== 'bot') return undefined
  return { claim: true }
}

export function matchBtwClaim(roster, sessionId, token) {
  if (token !== '/btw' || btwSurface(roster, sessionId) !== 'bot') return undefined
  return true
}

function liveRoster(roster) {
  if (typeof roster?.getSnapshot === 'function' && typeof roster?.subscribe === 'function') return roster
  return undefined
}

function readRoster(roster) {
  const live = liveRoster(roster)
  return live ? live.getSnapshot() : roster
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new Error('slash adjudication aborted')
}

// Resolves with a ready roster. A live source is waited on; a snapshot that is
// not ready yet cannot be waited on, so the claim refuses instead of falling
// through. Abort rejects, which also keeps the draft.
function whenRosterReady(roster, signal) {
  const current = readRoster(roster)
  if (current?.ready) return Promise.resolve(current)
  const live = liveRoster(roster)
  if (!live) return Promise.reject(new Error(t(LOADING_REFUSAL)))
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    // A source that notifies inside subscribe must not run before `off` exists.
    let gate = true
    let off = () => {}
    const stop = () => {
      off()
      off = () => {}
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = () => {
      const next = live.getSnapshot()
      if (!next?.ready) return
      stop()
      resolve(next)
    }
    const onAbort = () => {
      stop()
      reject(abortError(signal))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    off = live.subscribe(() => {
      if (!gate) finish()
    })
    gate = false
    finish()
  })
}

// Throws for the three refusals. Undefined lets a positively identified
// non-Bot session send `/btw` as a normal message. A group throw wins over an
// empty question or attachments. A roster that is not ready yet is awaited.
export async function matchBtwEnter(roster, sessionId, line, envelope, signal) {
  const parsed = parseBtwLine(line)
  if (!parsed) return undefined
  const snap = readRoster(roster)?.ready ? readRoster(roster) : await whenRosterReady(roster, signal)
  const surface = btwSurface(snap, sessionId)
  if (surface === 'other') return undefined
  if (surface === 'group') throw new Error(t(GROUP_REFUSAL))
  if (surface !== 'bot') throw new Error(t(LOADING_REFUSAL))
  if ((envelope?.attachments ?? 0) > 0) throw new Error(t(ATTACHMENT_REFUSAL))
  if (parsed.bare) throw new Error(t(EMPTY_REFUSAL))
  return { claim: true }
}

// `call` is the host request. It resolves when the aside is accepted; the answer
// arrives later on the card. A throw keeps the draft.
export async function submitBtw({ call, roster, sessionId, args, attachments }) {
  const text = String(args ?? '').trim()
  if (btwSurface(roster, sessionId) === 'group') throw new Error(t(GROUP_REFUSAL))
  if (Array.isArray(attachments) && attachments.length > 0) throw new Error(t(ATTACHMENT_REFUSAL))
  if (text === '') throw new Error(t(EMPTY_REFUSAL))
  await call('btw', { sessionId, text })
  return { kind: 'success' }
}

export function seqNum(value) {
  const seq = value !== null && typeof value === 'object' ? value.seq : value
  if (typeof seq === 'bigint') return Number(seq)
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined
}

function turnClosed(turn) {
  return seqNum(turn?.end) !== undefined
}

// A usable anchorSeq. Null and absence mean an old card, which still uses atSeq.
function anchorOf(card) {
  if (card == null || card.anchorSeq == null) return undefined
  return seqNum(card.anchorSeq)
}

// Closed turns win: start and end are both included, so the turn/start seq
// itself belongs to the turn it opened. An open turn matches from its start
// onward and stays on the dock, because it has no end yet. No match stays
// on the dock too, even when atSeq would have landed in an earlier turn.
function turnContaining(seq, turns) {
  let closed
  let closedStart = -Infinity
  let open
  let openStart = -Infinity
  for (const turn of turns.values()) {
    const start = seqNum(turn?.start)
    if (start === undefined || seq < start) continue
    const end = seqNum(turn?.end)
    if (end !== undefined) {
      if (seq > end || start < closedStart) continue
      closed = turn
      closedStart = start
      continue
    }
    if (start < openStart) continue
    open = turn
    openStart = start
  }
  return closed ?? open
}

// Old cards have no anchorSeq. The latest turn that had started by atSeq keeps
// a log-only tail, such as model/selection after turn/end, on the turn that
// just ended.
function turnStartedBy(seq, turns) {
  let best
  let bestStart = -Infinity
  for (const turn of turns.values()) {
    const start = seqNum(turn?.start)
    if (start === undefined || start > seq || start < bestStart) continue
    best = turn
    bestStart = start
  }
  return best
}

export function owningTurn(card, turns) {
  if (!turns || typeof turns.values !== 'function') return undefined
  const anchor = anchorOf(card)
  if (anchor !== undefined) return turnContaining(anchor, turns)
  const at = seqNum(card?.atSeq)
  if (at === undefined) return undefined
  return turnStartedBy(at, turns)
}

function sameTurn(owner, turn) {
  if (!owner || !turn) return false
  if (typeof owner.turn === 'number' && typeof turn.turn === 'number') return owner.turn === turn.turn
  return owner === turn
}

// Open turns, and cards whose anchor matches no closed turn, stay here.
// A closed turn is not here, including an old card whose atSeq is a log-only
// event after that turn ended.
export function dockCards(cards, facts) {
  const turns = facts?.turns
  return (Array.isArray(cards) ? cards : []).filter(card => {
    const owner = owningTurn(card, turns)
    return owner === undefined || !turnClosed(owner)
  })
}

// Cards whose resolved turn is this one. Needs the whole timeline: a later
// turn can own a seq that is also after this turn's start. An open turn
// has no tail yet.
export function tailCards(cards, turn, turns) {
  if (!turn || !turnClosed(turn) || !turns) return []
  return (Array.isArray(cards) ? cards : []).filter(card => sameTurn(owningTurn(card, turns), turn))
}

export function sessionCards(roster, sessionId) {
  if (!roster?.ready || roster.roomsById?.[sessionId]) return []
  const bot = roster.byId?.[sessionId]
  if (!bot) return []
  const cards = roster.btwCards?.[bot.id]
  return (Array.isArray(cards) ? cards : []).filter(card => card?.partId === sessionId)
}

function partChain(bot) {
  return [...(bot?.parts ?? []), bot?.sessionId].filter(id => typeof id === 'string' && id !== '')
}

// Same index the host uses: an explicit cursor part, otherwise the part before this one.
export function partIndexOf(bot, sessionId, cursor) {
  if (Number.isInteger(cursor?.part)) return cursor.part
  return partChain(bot).indexOf(sessionId) - 1
}

function rowTurn(item) {
  return typeof item?.turn === 'number' && Number.isInteger(item.turn) ? item.turn : undefined
}

function rowSeq(item) {
  return seqNum(item?.seq ?? item?.atSeq)
}

// One run of rows that share a turn. A steering message stays in the run,
// because it carries the same turn as the messages around it. A divider is
// its own segment and never owns a card.
function segmentsOf(items) {
  const segments = []
  let current = null
  const close = () => {
    if (current) segments.push(current)
    current = null
  }
  for (const item of items) {
    if (item?.kind === 'divider') {
      close()
      segments.push({ kind: 'divider', items: [item] })
      continue
    }
    const turn = rowTurn(item)
    if (!current || current.turn !== turn) {
      close()
      current = { kind: 'rows', items: [], turn, startSeq: undefined }
    }
    current.items.push(item)
    const seq = rowSeq(item)
    if (seq !== undefined && (current.startSeq === undefined || seq < current.startSeq)) current.startSeq = seq
  }
  close()
  return segments
}

// turn/start is not a row, so an anchorSeq usually sits just before the turn's
// first message. The segment that holds the earliest row at or after it is
// that turn, including when the same turn number continues on the next page.
function segmentAt(seq, content) {
  let best
  let bestSeq = Infinity
  for (const segment of content) {
    for (const item of segment.items) {
      const row = rowSeq(item)
      if (row === undefined || row < seq || row >= bestSeq) continue
      best = segment
      bestSeq = row
    }
  }
  return best
}

function segmentStartedBy(seq, content) {
  let best
  let bestStart = -Infinity
  for (const segment of content) {
    const start = segment.startSeq
    if (start === undefined || start > seq || start < bestStart) continue
    best = segment
    bestStart = start
  }
  return best
}

// Owning turn number. `turn: null` means there is none, so placement falls
// through to anchorSeq. Old cards omit `turn` and may still carry `atTurn`.
function cardTurn(card) {
  if (card == null || typeof card !== 'object') return undefined
  const value = 'turn' in card ? card.turn : card.atTurn
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

// The last visible run of this turn. A divider can split a run; the card
// follows the later one. No such run means the card is not placed in a turn.
function segmentByTurn(turn, content) {
  let match
  for (const segment of content) if (segment.turn === turn) match = segment
  return match
}

function ownerSegment(card, content) {
  const turn = cardTurn(card)
  if (turn !== undefined) return segmentByTurn(turn, content)
  const anchor = anchorOf(card)
  if (anchor !== undefined) return segmentAt(anchor, content)
  const at = seqNum(card?.atSeq)
  if (at === undefined) return undefined
  return segmentStartedBy(at, content)
}

const btwRow = card => ({ kind: 'btw', card })

// Newest-first `cards` are inserted once, after the turn they belong to.
// An integer turn attaches only to that turn's rows. A turn that is not loaded
// yet stays in the trailing block, so the card never sits inside a later turn.
// Cards without a turn number use anchorSeq, then atSeq. An old card below the
// first loaded sequence waits for the page that holds its turn. A part with no
// visible rows keeps its cards in the trailing block. The btw row has no `time`,
// so it does not open a clock gap.
export function withBtwRows(items, cards) {
  const list = Array.isArray(items) ? items : []
  const pending = (Array.isArray(cards) ? cards : []).filter(card => card && card.id !== undefined && card.id !== null)
  if (pending.length === 0) return list
  const segments = segmentsOf(list)
  const content = segments.filter(segment => segment.kind === 'rows')
  let floor
  for (const segment of content) {
    if (segment.startSeq === undefined) continue
    if (floor === undefined || segment.startSeq < floor) floor = segment.startSeq
  }
  const buckets = new Map()
  const aside = []
  for (const card of pending) {
    const owner = ownerSegment(card, content)
    if (owner) {
      const bucket = buckets.get(owner) ?? []
      bucket.push(card)
      buckets.set(owner, bucket)
      continue
    }
    // The owning turn is not on this page. Keep the card in the trailing block
    // until that page is prepended. Do not drop it, and do not borrow a later turn.
    if (cardTurn(card) !== undefined) {
      aside.push(card)
      continue
    }
    const at = seqNum(card?.atSeq)
    // This list may be a suffix (older rows are prepended later). An atSeq
    // below the first loaded sequence belongs to that older page. A turn/start
    // anchorSeq is handled above: it is not a row, and it is not dropped here.
    if (floor !== undefined && at !== undefined && at < floor) continue
    aside.push(card)
  }
  if (content.length === 0) return [...list, ...aside.map(btwRow)]
  const out = []
  for (const segment of segments) {
    out.push(...segment.items)
    const bucket = buckets.get(segment)
    if (bucket) for (const card of bucket) out.push(btwRow(card))
  }
  for (const card of aside) out.push(btwRow(card))
  return out
}
