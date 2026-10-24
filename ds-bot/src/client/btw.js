// The `/btw` composer command and the cards that show its answer.
import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { MarkdownText } from './dsh-primitives.js'
import { hostText, t } from './i18n.js'
import { messageClock } from './text.js'
import {
  BTW_SOURCE, BTW_TOKEN, btwQueryMatches, btwSurface, dockCards, matchBtwClaim, matchBtwEnter,
  matchBtwSpace, sessionCards, submitBtw, tailCards,
} from './btw-model.js'

const mdLabels = () => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') })

function failureText(card) {
  const raw = typeof card.error === 'string' ? card.error : card.error?.message
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text !== '' ? hostText(text) : t('Could not answer.')
}

function stampOf(card) {
  const time = Number.isFinite(card.finishedAt) ? card.finishedAt : card.createdAt
  return Number.isFinite(time) ? time : undefined
}

export function BtwCardView({ card, compact = false, actions }) {
  const [open, setOpen] = useState(card?.status !== 'answering')
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => {
    if (card?.status && card.status !== 'answering') setOpen(true)
  }, [card?.status])
  if (!card) return null
  const question = typeof card.question === 'string' ? card.question : ''
  const answer = typeof card.answer === 'string' ? card.answer : ''
  const when = stampOf(card)
  const answering = card.status === 'answering'
  const cancel = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (cancelling || typeof actions?.cancelBtw !== 'function') return
    setCancelling(true)
    Promise.resolve(actions.cancelBtw(card)).catch(() => {}).finally(() => setCancelling(false))
  }
  return h('div', {
    className: compact ? 'bt-btw bt-btw-compact' : 'bt-btw',
    'data-open': open || undefined,
    'data-status': card.status,
    role: 'region',
    'aria-label': t('Side question'),
  },
  h('div', { className: 'bt-btw-head' },
    h('button', {
      type: 'button', className: 'bt-btw-toggle', 'aria-expanded': open,
      onClick: () => setOpen(value => !value),
    },
    h('span', { className: 'bt-btw-chevron', 'aria-hidden': true }),
    h('span', { className: 'bt-btw-q' }, question)),
    when !== undefined ? h('time', { className: 'bt-btw-time', dateTime: new Date(when).toISOString() }, messageClock(when)) : null,
    answering ? h('span', { className: 'bt-shimmer' }, t('Answering…')) : null,
    card.status === 'cancelled' ? h('span', { className: 'bt-btw-status' }, t('Cancelled')) : null,
    answering ? h('button', {
      type: 'button', className: 'bt-soft bt-soft-sm bt-btw-cancel', disabled: cancelling,
      title: t('Cancel this side question'), 'aria-label': t('Cancel this side question'), onClick: cancel,
    }, t('Cancel')) : null),
  h('p', { className: 'bt-btw-note' }, t('Answered from progress so far; nothing was run')),
  open ? h('div', { className: 'bt-btw-body' },
    card.status === 'failed' ? h('p', { className: 'bt-btw-fail' }, failureText(card)) : null,
    answer !== '' ? h('div', { className: 'bt-btw-answer' }, h(MarkdownText, { text: answer, labels: mdLabels(), variant: 'compact' })) : null) : null)
}

function useTurnFacts(sessionId, actions) {
  const [facts, setFacts] = useState(() => actions.turnFacts(sessionId))
  useEffect(() => {
    let live = true
    const read = () => {
      if (!live) return
      const next = actions.turnFacts(sessionId)
      setFacts(current => (current.turns === next.turns && current.openTurn === next.openTurn ? current : next))
    }
    read()
    const off = actions.watchTurns(sessionId, read)
    return () => { live = false; off() }
  }, [sessionId, actions])
  return facts
}

export function BtwDock({ sessionId, useRoster, actions }) {
  const roster = useRoster(value => value)
  const facts = useTurnFacts(sessionId, actions)
  const cards = dockCards(sessionCards(roster, sessionId), facts)
  if (cards.length === 0) return null
  return h('div', { className: 'bt-btw-dock' }, cards.map(card => h(BtwCardView, { key: card.id, card, compact: true, actions })))
}

export function BtwTurnTail({ turn, sessionId, useRoster, actions }) {
  const roster = useRoster(value => value)
  const facts = useTurnFacts(sessionId, actions)
  const cards = tailCards(sessionCards(roster, sessionId), turn, facts?.turns)
  if (cards.length === 0) return null
  return h('div', { className: 'bt-btw-stack' }, cards.map(card => h(BtwCardView, { key: card.id, card, actions })))
}

export function btwSource({ roster }) {
  const claimFor = (sessionId) => ({
    name: 'btw',
    token: BTW_TOKEN,
    hint: t('Ask about the work so far'),
    submit: (args, actx, attachments) => {
      void actx
      return submitBtw({ call, roster: roster.getSnapshot(), sessionId, args, attachments })
    },
  })
  return {
    trigger: '/',
    name: BTW_SOURCE,
    order: -50,
    showGroupTitle: false,
    async candidates(session, req) {
      if (req?.position === 'inline') return []
      if (btwSurface(roster.getSnapshot(), session.sessionId) !== 'bot') return []
      if (!btwQueryMatches(req?.query)) return []
      return [{ name: 'btw', description: t('Ask without interrupting'), value: 'btw' }]
    },
    onPick(pick) {
      if (pick?.action === 'drill') return undefined
      if (btwSurface(roster.getSnapshot(), pick.session.sessionId) !== 'bot') return undefined
      return { claim: claimFor(pick.session.sessionId) }
    },
    matchSpace(session, token) {
      const outcome = matchBtwSpace(roster.getSnapshot(), session.sessionId, token)
      return outcome === undefined ? undefined : { claim: claimFor(session.sessionId) }
    },
    matchEnter(session, line, signal, envelope) {
      // The live roster, not a snapshot: Enter waits out the startup gap instead
      // of letting `/btw` become an ordinary send.
      return matchBtwEnter(roster, session.sessionId, line, envelope, signal).then((outcome) => {
        if (outcome === undefined) return undefined
        return { claim: claimFor(session.sessionId) }
      })
    },
    async matchClaim(session, token) {
      return matchBtwClaim(roster.getSnapshot(), session.sessionId, token) ? claimFor(session.sessionId) : undefined
    },
  }
}
