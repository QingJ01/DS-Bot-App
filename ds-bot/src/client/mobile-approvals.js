import { createElement as h } from 'react'
import { createSource } from './sources.js'
import { language } from './i18n.js'
import { toolArgs } from './text.js'

export function approvalReason(request, locale = 'en') {
  const copy = request.displayReason
  return copy?.[locale] ?? copy?.[locale.split('-')[0]] ?? copy?.en ?? request.reason
    ?? `${request.toolName} requires your approval.`
}

// The broker is the only request owner. Polling only presents its current queue;
// it never replays audit history or creates another approval waterfall.
export function createMobileApprovals(operator) {
  const source = createSource({ requests: [], connected: true, busy: [], errors: {} })
  const settled = new Set()
  const answering = new Set()
  const lifetime = new AbortController()
  let order = 0
  let disposed = false
  let stopPoll = null
  const signal = () => AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)])
  const refresh = async () => {
    const current = ++order
    try {
      const value = await operator('approvals.list', {}, signal())
      if (disposed || current !== order) return
      const requests = (value.requests ?? []).filter(request => !settled.has(request.id))
      source.set(state => ({ ...state, requests, connected: true,
        errors: Object.fromEntries(Object.entries(state.errors).filter(([id]) => requests.some(request => request.id === id))) }))
    } catch {
      if (!disposed && current === order) source.set(state => ({ ...state, connected: false }))
    }
  }
  const answer = async (id, decision) => {
    if (disposed || answering.has(id) || !source.getSnapshot().connected
      || !source.getSnapshot().requests.some(request => request.id === id)
      || !['allowed-once', 'rejected'].includes(decision)) return
    answering.add(id)
    source.set(state => ({ ...state, busy: [...answering], errors: { ...state.errors, [id]: '' } }))
    try {
      await operator('approvals.resolve', { id, decision }, signal())
      settled.add(id)
      if (!disposed) source.set(state => ({ ...state, requests: state.requests.filter(request => request.id !== id) }))
    } catch {
      // A second device may have won, or the response may have been lost. Only
      // a fresh broker list decides whether there is still something to answer.
      if (!disposed) source.set(state => ({ ...state, errors: { ...state.errors, [id]: 'Could not confirm the decision. Refreshing the request…' } }))
    } finally {
      answering.delete(id)
      if (!disposed) { source.set(state => ({ ...state, busy: [...answering] })); await refresh() }
    }
  }
  const start = (page = document) => {
    if (stopPoll) return stopPoll
    let timer
    let running = false
    let stopped = false
    const loop = async () => {
      clearTimeout(timer)
      if (stopped || running) return
      running = true
      await refresh()
      running = false
      if (!stopped) timer = setTimeout(loop, page.hidden ? 10000 : 1500)
    }
    const wake = () => { if (!page.hidden) void loop() }
    page.addEventListener('visibilitychange', wake)
    void loop()
    stopPoll = () => { stopped = true; clearTimeout(timer); page.removeEventListener('visibilitychange', wake) }
    return stopPoll
  }
  return { ...source, refresh, answer, start, dispose: () => {
    disposed = true
    stopPoll?.()
    lifetime.abort()
    settled.clear()
    answering.clear()
    source.set({ requests: [], connected: false, busy: [], errors: {} })
  } }
}

// Harness owns its approval-detail slot. The public Chat selector supplies the
// correlated live tool without redeclaring that slot or creating another prompt.
export function liveApprovalCommand(snapshot, request) {
  if (!request.callId) return undefined
  const node = [...snapshot.nodes.values()].find(entry => entry.kind === 'tool-call'
    && entry.data?.root?.callId === request.callId && entry.data.root.phase === 'start')
  return node ? toolArgs(node.data.root).text('command') : undefined
}

function ApprovalCommand({ request, useChat }) {
  const command = useChat(snapshot => liveApprovalCommand(snapshot, request))
  return command ? h('div', { className: 'bt-mobile-approval-command' }, command) : null
}

export function approvalSession(request, roster) {
  const room = roster.roomsById[request.conversationId]
  if (room) return room.id
  if (roster.byId[request.conversationId] || roster.agentOf?.[request.sessionId]) return request.sessionId
  return null
}

export function MobileApprovalDock({ sessionId, useMobileApprovals, useRoster, useChat, actions }) {
  const state = useMobileApprovals(value => value)
  const roster = useRoster(value => value)
  const requests = state.requests.filter(request => approvalSession(request, roster) === sessionId)
  if (requests.length === 0) return null
  return h('section', { className: 'bt-mobile-approvals', 'aria-label': 'Pending approvals' }, requests.map(request => {
    const busy = state.busy.includes(request.id)
    return h('section', { key: request.id, className: 'bt-mobile-approval', 'aria-label': `${request.toolName} approval`, 'aria-busy': busy },
      h('div', { className: 'bt-mobile-approval-strip', role: 'status' }, 'Approval required', h('code', null, request.toolName)),
      h('div', { className: 'bt-mobile-approval-body', tabIndex: 0, role: 'group', 'aria-label': 'Approval details' },
        h('p', null, approvalReason(request, language())),
        request.callId && request.sessionId === sessionId && useChat ? h(ApprovalCommand, { request, useChat }) : null),
      !state.connected ? h('p', { className: 'bt-mobile-approval-error', role: 'alert' }, 'Connection lost. Waiting to confirm that this request is still pending.')
        : state.errors[request.id] ? h('p', { className: 'bt-mobile-approval-error', role: 'alert' }, state.errors[request.id]) : null,
      h('div', { className: 'bt-mobile-approval-actions' },
        h('span', { className: 'bt-mobile-approval-hint' }, 'Answer here or on your paired phone.'),
        h('button', { type: 'button', disabled: busy || !state.connected, onClick: () => void actions.answerMobileApproval(request.id, 'rejected') }, 'Reject'),
        h('button', { type: 'button', className: 'bt-mobile-approval-allow', disabled: busy || !state.connected, onClick: () => void actions.answerMobileApproval(request.id, 'allowed-once') }, 'Allow once')))
  }))
}

export function MobileApprovalNotice({ useMobileApprovals, useSessions, useRoster, actions }) {
  const state = useMobileApprovals(value => value)
  const roster = useRoster(value => value)
  const current = useSessions(list => Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id)
  const requests = state.requests.filter(request => {
    const target = approvalSession(request, roster)
    return target && target !== current
  })
  if (requests.length === 0) return null
  return h('aside', { className: 'bt-mobile-approval-notices', 'aria-label': 'Approvals in other conversations' }, requests.map(request => {
    const owner = roster.byId[request.conversationId] ?? roster.roomsById[request.conversationId]
    return h('button', { key: request.id, type: 'button', className: 'bt-mobile-approval-notice', onClick: () => actions.openMobileApproval(approvalSession(request, roster)) },
      h('span', null, `${owner?.name || 'A team conversation'} needs approval`), h('span', { className: 'bt-mobile-approval-hint' }, `${request.toolName} · Open conversation`))
  }))
}

export const MOBILE_APPROVAL_CSS = `
.bt-mobile-approvals{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto 8px;max-height:50vh;overflow:auto;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--bt-ink)}
.bt-mobile-approval{margin-bottom:8px;border:1px solid var(--dsw-alias-state-warn-secondary,var(--bt-line-2));border-radius:16px;overflow:hidden;background:var(--bt-card)}
.bt-mobile-approval-strip{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--dsw-alias-state-warn-tertiary,var(--bt-hover));color:var(--dsw-alias-state-warn-primary,var(--bt-ink));font-weight:600}
.bt-mobile-approval-strip code{margin-left:auto;font-size:12px;font-weight:400;overflow-wrap:anywhere}
.bt-mobile-approval-body{padding:12px 14px 0;max-height:260px;overflow:auto}
.bt-mobile-approval-body p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 8px;font-size:14px}
.bt-mobile-approval-command{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
.bt-mobile-approval-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 14px;flex-wrap:wrap}
.bt-mobile-approval-hint{font-size:12px!important;color:var(--bt-ink-2);font-weight:400}
.bt-mobile-approval-actions>.bt-mobile-approval-hint{margin-right:auto}
.bt-mobile-approval button,.bt-mobile-approval-notice{font:inherit;cursor:pointer;border:1px solid var(--bt-line);border-radius:10px;padding:7px 13px;background:var(--bt-hover);color:inherit}
.bt-mobile-approval button:disabled{opacity:.5;cursor:default}
.bt-mobile-approval button.bt-mobile-approval-allow{background:var(--bt-accent);color:var(--bt-accent-ink);border-color:transparent}
.bt-mobile-approval-error{margin:8px 14px;color:var(--dsw-alias-state-error-primary,var(--bt-danger))}
.bt-mobile-approval-notices{position:fixed;right:20px;top:72px;z-index:160;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 40px));font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.bt-mobile-approval-notice{display:flex;flex-direction:column;text-align:left;background:var(--bt-card);color:var(--bt-ink)}
.bt-mobile-approval button:focus-visible,.bt-mobile-approval-body:focus-visible,.bt-mobile-approval-notice:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
`
