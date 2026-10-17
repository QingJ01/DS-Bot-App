// Approvals. A member's group Session is hidden, so DSH's approval card never shows
// there and the turn would wait forever: DS Bot answers those requests itself, from
// the group chat. A Bot's own chat keeps DSH's card; its requests are only noted, so
// the team view can say who is waiting.
//
// A Bot may also carry rules that answer some requests before anyone is asked — the
// policy the user writes once instead of approving the same call every turn. A rule
// names one tool (or every tool) and either the whole machine or the folder the Bot is
// working in; a request the rules do not cover is asked for as before, so a rule can
// only widen what the user already lets the Bot do by hand.
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { within } from './folders.js'

const OUTCOMES = { allow: 'allowed-once', reject: 'rejected' }
const MAX_RULES = 20
const MAX_TOOL = 64
const RECENT_MAX = 20
const ANY_TOOL = '*'
const SCOPES = ['folder', 'anywhere']
// The argument a file tool names its target with. A tool that names no path — a shell
// command, a request — cannot be judged against a folder, so it is asked for.
const PATH_KEYS = ['file_path', 'path', 'file', 'dir', 'directory', 'folder', 'cwd', 'target', 'notebook_path']

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

export function install(rt) {
  const { ctx, state } = rt
  /** @type {Map<string, {id:string, sessionId:string, botId:string, roomId?:string, tool:string, reason:string, detail:{text?:string, code?:string}, at:number, answer?:(outcome:string)=>void}>} */
  const pending = new Map()
  // Answered by a rule rather than by the user. Kept out of state.json: the history of
  // approvals that were never asked is news, not the team's own data.
  const recent = []

  // One rule: a tool name or '*', and where it may act without asking.
  const cleanRule = (input) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw invalid('A rule must name a tool and a place')
    const tool = String(input.tool ?? '').trim()
    if (tool !== ANY_TOOL && !/^[A-Za-z][\w.-]*$/.test(tool)) throw invalid('Give a tool name, or * for every tool')
    if (tool.length > MAX_TOOL) throw invalid(`Keep a tool name under ${MAX_TOOL} characters`)
    const scope = String(input.scope ?? 'folder').trim()
    if (!SCOPES.includes(scope)) throw invalid(`Say ${SCOPES.join(' or ')} for where the rule applies`)
    return { tool, scope }
  }

  const cleanRules = (value) => {
    if (!Array.isArray(value)) throw invalid('Send the rules as a list')
    if (value.length > MAX_RULES) throw invalid(`A Bot can carry at most ${MAX_RULES} rules`)
    const seen = new Set()
    return value.map(cleanRule).filter((rule) => {
      const key = `${rule.tool}\n${rule.scope}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const rulesOf = botId => (Array.isArray(rt.botOf(botId)?.approvals?.rules) ? rt.botOf(botId).approvals.rules : [])

  // The folder a rule about the Bot's own place means: the group's folder here, else the
  // Bot's, else the team workspace.
  const folderFor = (botId, roomId) => rt.workDirOf?.({ botId, roomId }) ?? rt.teamFolder?.()

  // The path a call acts on when it acts on one inside `folder`; undefined when the call
  // names no path. A relative path is the tool's own folder, which is where it runs.
  function targetIn(args, folder) {
    if (folder === undefined) return undefined
    for (const key of PATH_KEYS) {
      const value = args?.[key]
      if (typeof value !== 'string' || value.trim() === '') continue
      const text = value.trim()
      const full = isAbsolute(text) ? resolve(text) : resolve(folder, text)
      if (within(full, folder)) return full
    }
    return undefined
  }

  // The rule that answers this request, if the user wrote one that covers it.
  function ruleFor({ botId, roomId, tool, callId, sessionId }) {
    const rules = rulesOf(botId)
    if (rules.length === 0) return undefined
    const args = rt.callArgs?.(sessionId, callId)
    const folder = folderFor(botId, roomId)
    for (const rule of rules) {
      if (rule.tool !== ANY_TOOL && rule.tool !== tool) continue
      if (rule.scope === 'anywhere') return { rule, target: undefined }
      const target = targetIn(args, folder)
      if (target !== undefined) return { rule, target }
    }
    return undefined
  }

  const note = entry => {
    recent.push(entry)
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX)
  }

  // Ahead of DSH's own answerer, which would hold a hidden Session's request unseen.
  ctx.on('approval/request', (request, next) => {
    const sessionId = request.agent?.session?.id ?? request.agent?.id
    const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
    const botId = owner?.botId ?? (sessionId === undefined ? undefined : rt.chatOwners.get(sessionId))
    if (botId === undefined) return next()
    const tool = String(request.toolName ?? '')
    const allowed = ruleFor({ botId, roomId: owner?.roomId, tool, callId: request.callId, sessionId })
    if (allowed !== undefined) {
      note({ botId, ...(owner ? { roomId: owner.roomId } : {}), tool, scope: allowed.rule.scope, at: Date.now(), ...(allowed.target ? { target: allowed.target } : {}) })
      return Promise.resolve(OUTCOMES.allow)
    }
    const id = randomUUID()
    const entry = {
      id,
      sessionId,
      botId,
      ...(owner ? { roomId: owner.roomId } : {}),
      tool,
      reason: String(request.reason ?? '').slice(0, 500),
      detail: rt.callDetail?.(sessionId, request.callId) ?? {},
      at: Date.now(),
    }
    pending.set(id, entry)
    rt.noteApproval?.(sessionId, { tool: entry.tool, reason: entry.reason.slice(0, 200) })
    const settled = () => {
      pending.delete(id)
      rt.noteApproval?.(sessionId, undefined)
    }
    if (owner === undefined) return Promise.resolve(next()).finally(settled)
    rt.yieldRoomTurn?.(sessionId)
    return new Promise((resolve) => {
      entry.answer = (outcome) => {
        if (!pending.has(id)) return
        settled()
        resolve(outcome)
      }
      if (request.signal?.aborted) entry.answer('cancelled')
      request.signal?.addEventListener('abort', () => entry.answer('cancelled'), { once: true })
    })
  }, { prepend: true })

  const approvalsView = () => [...pending.values()].map(({ answer, ...entry }) => ({ ...entry, answerable: answer !== undefined }))
  const waitsForApproval = sessionId => [...pending.values()].some(entry => entry.sessionId === sessionId)

  function answerApproval(id, choice) {
    const entry = pending.get(String(id ?? ''))
    if (entry?.answer === undefined) throw Object.assign(new Error('This approval is no longer open'), { code: 'bot/stale' })
    const outcome = OUTCOMES[choice]
    if (outcome === undefined) throw Object.assign(new Error('Choose allow or reject'), { code: 'bot/invalid' })
    entry.answer(outcome)
  }

  // A group Session that leaves its group has no card left to answer from.
  const cancelApprovals = (sessionId) => {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) entry.answer?.('cancelled')
    }
  }

  // Every Bot's rules, and the calls a rule answered without asking. The team view
  // already carries each Bot's rules; this is the answer for a phone that opens the
  // settings while something runs.
  const rulesView = () => ({
    bots: Object.values(state.bots).map(bot => ({ id: bot.id, name: bot.name, rules: rulesOf(bot.id) })),
    recent: [...recent].reverse(),
    scopes: [...SCOPES],
  })

  rt.approvalRuleEndpoint = async (endpoint, body = {}) => {
    await rt.load()
    if (endpoint === 'approval-rules') return rulesView()
    if (rt.readOnly?.() !== undefined) throw Object.assign(new Error('Use the DSH host that owns this Bot team.'), { code: 'bot/refused' })
    const bot = rt.botOf(body.id)
    if (bot === undefined) throw invalid('There is no Bot with that id')
    if (endpoint === 'approval-rule-set') {
      const rules = cleanRules(body.rules)
      if (rules.length === 0) delete bot.approvals
      else bot.approvals = { rules }
      await rt.save()
      return { id: bot.id, rules: rulesOf(bot.id) }
    }
    if (endpoint === 'approval-rule-clear') {
      delete bot.approvals
      await rt.save()
      return { id: bot.id, rules: [] }
    }
    throw invalid(`Unknown approval endpoint ${endpoint}`)
  }

  Object.assign(rt, { approvalsView, waitsForApproval, answerApproval, cancelApprovals, cleanApprovalRules: cleanRules, approvalRulesOf: rulesOf })
}
