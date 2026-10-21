import { createElement as h, Fragment, useId, useRef, useState } from 'react'
import { MarkdownText } from './dsh-primitives.js'
import { CheckIcon, CloseIcon } from './icons.js'
import { t } from './i18n.js'
import { AnsweredCell, keyLetter, useOptionKeys } from './questions.js'
import { useDockHold } from './card-hold.js'
import { heldCardKey } from './sources.js'
import { checkShownView, normalizeView } from '../shared/views.js'

// -------------------------------------------------------------------------
// View cards (show_view): a Bot draws a small declarative blueprint — text,
// metrics, a table, options, a confirm, a form, a progress bar — as a card in
// its chat. Nothing model-written executes; every node maps to one of the
// components below. A card that awaits a reply lives in state.views like an
// ask_user question; a display-only blueprint renders from the call's arguments.

const mdLabels = () => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') })

const optionsOf = node => (Array.isArray(node?.options) ? node.options : [])
  .map(option => (typeof option === 'string' ? { label: option } : option))
  .filter(option => option !== null && typeof option === 'object' && option.label !== undefined)
const fieldsOf = node => (Array.isArray(node?.fields) ? node.fields : [])
  .filter(field => field !== null && typeof field === 'object' && field.id !== undefined)
const cellText = value => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value))

const countType = (node, type) => {
  if (node === null || typeof node !== 'object') return 0
  const children = Array.isArray(node.children) ? node.children : []
  return (node.type === type ? 1 : 0) + children.reduce((sum, child) => sum + countType(child, type), 0)
}

// The values an answer carries belong to the component whose id is its action.
const answerValues = (answer, node) => (answer?.action === node.id ? answer.values : undefined)

function OptionsInput({ node, onSubmit, keys }) {
  const [picked, setPicked] = useState([])
  const options = optionsOf(node)
  const multi = node.multi === true
  const choose = (label) => {
    if (multi) {
      setPicked(current => (current.includes(label) ? current.filter(item => item !== label) : [...current, label]))
      return
    }
    onSubmit?.(node.id, { selected: [label] })
  }
  const submit = () => { if (picked.length > 0) onSubmit?.(node.id, { selected: picked }) }
  const ownRef = useRef(null)
  useOptionKeys(keys ? options.length : 0, index => choose(options[index].label), ownRef)
  return h(Fragment, null,
    h('div', { className: 'bt-q-list', role: 'group' }, options.map((option, index) => {
      const selected = multi && picked.includes(option.label)
      return h('button', {
        key: option.label, type: 'button', className: 'bt-q-opt',
        'aria-pressed': multi ? selected : undefined,
        'aria-keyshortcuts': keys ? keyLetter(index).toLowerCase() : undefined,
        onClick: () => choose(option.label),
      },
      keys ? h('span', { className: 'bt-key', 'aria-hidden': true }, keyLetter(index)) : null,
      h('span', { className: 'bt-q-body' },
        h('span', { className: 'bt-q-label' }, option.label),
        option.description ? h('span', { className: 'bt-q-desc' }, option.description) : null),
      selected ? h('span', { className: 'bt-q-check', title: t('Selected') }, h(CheckIcon)) : null)
    })),
    multi ? h('div', { className: 'bt-q-foot' },
      h('button', { type: 'button', className: 'bt-q-submit', disabled: picked.length === 0, onClick: submit }, t('Submit'))) : null)
}

function SettledOptions({ node, answer }) {
  const selected = answerValues(answer, node)?.selected
  const chosen = Array.isArray(selected) ? selected : []
  return h('div', { className: 'bt-q-list', role: 'group', 'aria-label': t('Your answer') },
    optionsOf(node).map(option => h('div', { key: option.label, className: 'bt-q-opt' },
      h('span', { className: 'bt-q-body' },
        h('span', { className: 'bt-q-label' }, option.label),
        option.description ? h('span', { className: 'bt-q-desc' }, option.description) : null),
      chosen.includes(option.label) ? h('span', { className: 'bt-q-check', title: t('Selected') }, h(CheckIcon)) : null)))
}

function ConfirmInput({ node, onSubmit }) {
  return h('div', { className: 'bt-q-foot' },
    h('button', { type: 'button', className: 'bt-q-btn', onClick: () => onSubmit?.(node.id, { confirmed: false }) }, node.cancelLabel ?? t('Cancel')),
    h('button', { type: 'button', className: 'bt-q-submit', onClick: () => onSubmit?.(node.id, { confirmed: true }) }, node.confirmLabel ?? t('Confirm')))
}

function SettledConfirm({ node, answer }) {
  const confirmed = answerValues(answer, node)?.confirmed
  if (confirmed !== true && confirmed !== false) {
    return h('div', { className: 'bt-q-foot' },
      h('button', { type: 'button', className: 'bt-q-btn', disabled: true }, node.cancelLabel ?? t('Cancel')),
      h('button', { type: 'button', className: 'bt-q-submit', disabled: true }, node.confirmLabel ?? t('Confirm')))
  }
  const label = confirmed ? (node.confirmLabel ?? t('Confirm')) : (node.cancelLabel ?? t('Cancel'))
  return h('span', { className: 'bt-q-badge' }, label)
}

function FormInput({ node, onSubmit }) {
  const fields = fieldsOf(node)
  const [draft, setDraft] = useState({})
  const submit = () => onSubmit?.(node.id, { fields: Object.fromEntries(fields.map(field => [field.id, draft[field.id] ?? ''])) })
  return h('form', {
    className: 'bt-widget-form',
    onSubmit: (event) => { event.preventDefault(); submit() },
  },
  fields.map(field => h('label', { key: field.id, className: 'bt-widget-field' },
    h('span', { className: 'bt-widget-field-label' }, field.label),
    h('span', { className: 'bt-q-field' },
      h('input', {
        className: 'bt-q-input', type: 'text', value: draft[field.id] ?? '',
        autoComplete: 'off', spellCheck: false,
        'aria-label': field.label, placeholder: field.placeholder ?? undefined,
        onChange: event => setDraft(current => ({ ...current, [field.id]: event.target.value })),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          submit()
        },
      })))),
  h('div', { className: 'bt-q-foot' }, h('button', { type: 'submit', className: 'bt-q-submit' }, node.submitLabel ?? t('Submit'))))
}

function SettledForm({ node, answer }) {
  const fields = answerValues(answer, node)?.fields
  const values = fields !== null && typeof fields === 'object' ? fields : {}
  return h('div', { className: 'bt-widget-form' },
    fieldsOf(node).map(field => h('label', { key: field.id, className: 'bt-widget-field' },
      h('span', { className: 'bt-widget-field-label' }, field.label),
      h('span', { className: 'bt-q-field' },
        h('input', { className: 'bt-q-input', type: 'text', value: values[field.id] ?? '', disabled: true, readOnly: true, 'aria-label': field.label })))))
}

function WidgetTable({ node }) {
  const columns = (Array.isArray(node.columns) ? node.columns : []).filter(column => column !== null && typeof column === 'object')
  const rows = Array.isArray(node.rows) ? node.rows : []
  return h('div', { className: 'bt-widget-table' },
    h('table', null,
      h('thead', null, h('tr', null, columns.map((column, index) => h('th', { key: column.key ?? index, scope: 'col' }, column.label)))),
      h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: rowIndex },
        columns.map((column, columnIndex) => h('td', { key: column.key ?? columnIndex }, cellText(Array.isArray(row) ? row[columnIndex] : undefined))))))))
}

function WidgetProgress({ node }) {
  const percent = Math.max(0, Math.min(100, Number(node.percent) || 0))
  return h('div', { className: 'bt-widget-progress' },
    h('span', { className: 'bt-widget-progress-label' }, h('span', null, node.label), h('span', null, `${Math.round(percent)}%`)),
    h('div', {
      className: 'bt-widget-progress-track', role: 'progressbar',
      'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': node.label ?? t('Progress'),
    }, h('div', { className: 'bt-widget-progress-fill', style: { width: `${percent}%` } })))
}

// One blueprint node. Unknown types render nothing: the host validates the
// blueprint, so what arrives here is known or safely ignored.
function WidgetNode({ node, ctx }) {
  if (node === null || typeof node !== 'object') return null
  switch (node.type) {
    case 'stack': {
      const children = Array.isArray(node.children) ? node.children : []
      return h('div', { className: 'bt-widget-stack' },
        children.map((child, index) => h(WidgetNode, { key: child?.id ?? index, node: child, ctx })))
    }
    case 'text':
      return h(MarkdownText, { text: String(node.text ?? ''), labels: mdLabels(), variant: 'compact' })
    case 'metric': {
      const tone = ['good', 'warn', 'bad'].includes(node.tone) ? node.tone : undefined
      return h('div', { className: 'bt-widget-metric', 'data-tone': tone },
        h('span', { className: 'bt-widget-metric-label' }, node.label),
        h('span', { className: 'bt-widget-metric-value' }, node.value))
    }
    case 'table': return h(WidgetTable, { node })
    case 'options': return ctx.settled ? h(SettledOptions, { node, answer: ctx.answer }) : h(OptionsInput, { node, onSubmit: ctx.onSubmit, keys: ctx.keys })
    case 'confirm': return ctx.settled ? h(SettledConfirm, { node, answer: ctx.answer }) : h(ConfirmInput, { node, onSubmit: ctx.onSubmit })
    case 'form': return ctx.settled ? h(SettledForm, { node, answer: ctx.answer }) : h(FormInput, { node, onSubmit: ctx.onSubmit })
    case 'progress': return h(WidgetProgress, { node })
    default: return null
  }
}

// A whole blueprint. Letter keys answer a lone options block from the keyboard;
// with more than one in a card the same letter would hit both.
export function WidgetView({ view, onSubmit, settled = false, answer = null }) {
  const ctx = { onSubmit, settled, answer, keys: !settled && countType(view, 'options') === 1 }
  return h(WidgetNode, { node: view, ctx })
}

// The card chrome every view wears, pending or settled: a title bar with a small
// "View" tag, and a dismiss button while the card still waits for an answer.
function WidgetCard({ title, view, onSubmit, onDismiss, raised = false, settled = false, answer = null }) {
  const titleId = useId()
  return h('div', {
    className: settled ? 'bt-q bt-q-settled' : raised ? 'bt-q bt-q-raised' : 'bt-q',
    role: 'group', 'aria-labelledby': titleId,
  },
  h('div', { className: 'bt-q-head' },
    h('div', { className: 'bt-q-text' }, h('p', { className: 'bt-q-title', id: titleId }, title)),
    h('span', { className: 'bt-q-badge' }, t('View')),
    onDismiss ? h('button', { type: 'button', className: 'bt-q-x', 'aria-label': t('Dismiss view'), title: t('Dismiss'), onClick: onDismiss }, h(CloseIcon)) : null),
  h(WidgetView, { view, onSubmit, settled, answer }))
}

// A view waiting for its answer, inline at its call or raised in the dock. Like a
// pending question it hides on submit and comes back if the reply fails.
export function PendingView({ sessionId, view, actions, inline }) {
  const [answered, setAnswered] = useState(null)
  const hold = useDockHold(sessionId, 'view', view.id, actions, inline)
  const onSubmit = (action, values) => {
    setAnswered(view.id)
    void actions.answerView(sessionId, view.id, action, values).catch(() => setAnswered(null))
  }
  const onDismiss = () => {
    setAnswered(view.id)
    void Promise.resolve(actions.dismissView(sessionId)).catch(() => setAnswered(null))
  }
  // Hidden, not unmounted, while the answer is on its way: if it fails the card comes
  // back with what the user had typed or picked.
  return h('div', { className: inline ? 'bt-q-inline' : 'bt-q-dock', style: answered === view.id ? { display: 'none' } : undefined, onFocusCapture: hold, onPointerDownCapture: hold },
    h(WidgetCard, { key: view.id, title: view.title ?? '', view: view.view, onSubmit, onDismiss, raised: !inline }))
}

// The show_view call in the transcript.
export function WidgetCell({ sessionId, callId, args, done, isError, roster, actions, heldCards }) {
  const record = roster.views?.[sessionId]
  if (record !== undefined && record.callId === callId) {
    if (heldCards?.[heldCardKey('view', record.id)] > 0) return null
    return h(PendingView, { sessionId, view: record, actions, inline: true })
  }
  // A refused call (bad blueprint) drew no card; don't render an empty one.
  if (done && isError) return h('span', { className: 'bt-q-gone', hidden: true })
  // Display-only cards draw from the recorded call arguments, which keep the
  // provider's encoding: unwrap it the same way the host does before storing. The
  // args accessor reads strings through `text`; `value` drops them.
  const blueprint = normalizeView(args?.value?.('view'))
  const shown = checkShownView(args?.text?.('title'), blueprint)
  // A call the host refused — a blueprint it would not show, or a reply it cannot
  // wait for — leaves no card; the model's retry then stays the only one. So does
  // a settled interactive call: answered, dismissed or replaced, it leaves no gap
  // where it was (same as ask_user).
  if (shown.error !== undefined || shown.interactive || args?.value?.('await_reply') === true) {
    return h('span', { className: 'bt-q-gone', hidden: true })
  }
  return h('div', { className: 'bt-q-inline' }, h(WidgetCard, { title: shown.title, view: blueprint }))
}

// Views asked by a call the transcript does not draw wait above the composer,
// mirroring the question dock.
export function WidgetDock({ sessionId, useRoster, useCards, useHeldCards, actions }) {
  const view = useRoster(value => value.views?.[sessionId])
  const drawn = useCards?.(state => state[sessionId]?.[view?.callId] > 0) === true
  const held = useHeldCards?.(state => state[sessionId]?.[heldCardKey('view', view?.id)] > 0) === true
  if (view === undefined || (view.callId && drawn && !held)) return null
  return h(PendingView, { sessionId, view, actions, inline: false })
}

// An answered view rides on the reply message itself: the settled card, read-only.
export function AnsweredView({ node }) {
  const data = node.data ?? {}
  let payload = null
  if (Array.isArray(data.views)) payload = data
  else {
    try { payload = typeof data.text === 'string' ? JSON.parse(data.text) : null } catch { payload = null }
    if (payload?.kind !== 'answer_to_pending_view') payload = null
  }
  const view = payload?.views?.[0]
  if (view === null || typeof view !== 'object' || view.view === undefined) return null
  const answers = Array.isArray(payload.answers) ? payload.answers : []
  const answer = answers.find(entry => entry?.id === view.id) ?? answers[0] ?? null
  return h('div', { className: 'bt-q-inline' }, h(WidgetCard, { title: view.title ?? '', view: view.view, settled: true, answer }))
}

// A question reply node carries either questions (data.questions) or a view answer
// (JSON text discriminated by kind); each shape gets its own renderer.
export function AnsweredReply({ node }) {
  const data = node?.data ?? {}
  if (Array.isArray(data.views) && data.views.length > 0) return h(AnsweredView, { node })
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    let parsed = null
    try { parsed = typeof data.text === 'string' ? JSON.parse(data.text) : null } catch { parsed = null }
    if (parsed?.kind === 'answer_to_pending_view') return h(AnsweredView, { node })
  }
  return h(AnsweredCell, { node })
}

export const WIDGET_CSS = `
.bt-widget-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.bt-widget-stack>.bt-q-badge{align-self:flex-start}
.bt-widget-metric{display:flex;flex-direction:column;gap:1px;min-width:0}
.bt-widget-metric-label{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-metric-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-widget-metric[data-tone=good] .bt-widget-metric-value{color:var(--bt-green)}
.bt-widget-metric[data-tone=warn] .bt-widget-metric-value{color:var(--bt-star)}
.bt-widget-metric[data-tone=bad] .bt-widget-metric-value{color:var(--bt-danger)}
.bt-widget-table{max-width:100%;overflow-x:auto;border:.5px solid var(--bt-line-2);border-radius:10px}
.bt-widget-table table{border-collapse:collapse;min-width:100%;font-size:13px;line-height:18px}
.bt-widget-table th{padding:6px 10px;font-weight:500;text-align:start;white-space:nowrap;color:var(--bt-ink-2);border-bottom:.5px solid var(--bt-line-2)}
.bt-widget-table td{padding:6px 10px;max-width:280px;color:var(--bt-ink);overflow-wrap:anywhere}
.bt-widget-table tbody tr+tr td{border-top:.5px solid var(--bt-line)}
.bt-widget-form{display:flex;flex-direction:column;gap:8px;margin:0}
.bt-widget-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.bt-widget-field-label{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-field .bt-q-field:has(.bt-q-input:disabled){cursor:default;opacity:.75}
.bt-widget-progress{display:flex;flex-direction:column;gap:5px;min-width:0}
.bt-widget-progress-label{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-widget-progress-track{height:6px;border-radius:999px;background:var(--bt-hover);overflow:hidden}
.bt-widget-progress-fill{height:100%;border-radius:inherit;background:var(--bt-accent)}
.bt-q-raised .bt-widget-stack{padding:0 16px 14px}
.bt-q-raised .bt-widget-stack>.bt-q-list{padding:0}
`
