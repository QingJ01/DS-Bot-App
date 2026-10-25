import { checkShownView } from '../shared/views.js'

const HTML_PLACEHOLDER = '<p>HTML view is unavailable on mobile.</p>'
const SUCCESS_RECEIPTS = new Set([
  'The view is on screen.',
  "The view is on screen; the user's answer arrives as their next message.",
])
const PROPS = {
  stack: ['children', 'let'], row: ['children', 'let'],
  text: ['text', 'tone'], metric: ['label', 'value', 'tone', 'caption'],
  table: ['columns', 'rows'], chart: ['kind', 'categories', 'series', 'unit', 'caption'],
  progress: ['label', 'percent', 'value', 'max', 'valueLabel', 'tone'],
  callout: ['text', 'tone'], sources: ['items'], html: ['html', 'summary', 'height'],
  slider: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  choice: ['id', 'label', 'options', 'value'], toggle: ['id', 'label', 'value'],
  number: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  options: ['id', 'options', 'multi'], confirm: ['id', 'confirmLabel', 'cancelLabel'],
  form: ['id', 'fields', 'submitLabel'], submit: ['id', 'label'],
}
const INPUT_TYPES = new Set(['slider', 'choice', 'toggle', 'number'])
const STATUS = new Set(['answering', 'done', 'failed', 'cancelled'])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isFormula = value => isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '=')

function display(value, redact, limit = 2000) {
  try {
    return String(redact(String(value))).slice(0, limit)
  } catch {
    return '[redacted]'
  }
}

function safeUrl(value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function formula(value, redact) {
  return { '=': display(value['='], redact) }
}

function scalar(value, redact, preserve = false) {
  if (isFormula(value)) return formula(value, redact)
  if (typeof value === 'string') return preserve ? value : display(value, redact)
  return value
}

function source(value, redact) {
  if (!isRecord(value)) return undefined
  const initial = safeUrl(value.url)
  const url = initial && safeUrl(display(initial, redact, 2048))
  if (!url) return undefined
  return { label: display(value.label ?? '', redact), url }
}

function option(value, redact, { description = false, preserveValue = false } = {}) {
  if (!isRecord(value)) return undefined
  const result = {}
  if (typeof value.label === 'string') result.label = display(value.label, redact)
  if (description && Object.hasOwn(value, 'description')) result.description = display(value.description, redact)
  if (preserveValue && Object.hasOwn(value, 'value')) result.value = scalar(value.value, redact, true)
  return result
}

function field(value, redact) {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  return {
    id: value.id,
    label: display(value.label ?? '', redact),
    ...(typeof value.placeholder === 'string' ? { placeholder: display(value.placeholder, redact) } : {}),
  }
}

function node(value, redact) {
  if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(PROPS, value.type)) return undefined
  const result = { type: value.type }
  const props = PROPS[value.type]
  for (const key of props) {
    if (!Object.hasOwn(value, key)) continue
    if (key === 'children') {
      const children = (Array.isArray(value.children) ? value.children : []).map(item => node(item, redact)).filter(Boolean)
      result.children = children
    } else if (key === 'let') {
      result.let = isRecord(value.let)
        ? Object.fromEntries(Object.entries(value.let).filter(([name]) => typeof name === 'string').map(([name, item]) => [name, scalar(item, redact)]))
        : {}
    } else if (key === 'html') {
      result.html = HTML_PLACEHOLDER
    } else if (key === 'summary') {
      result.summary = display(value.summary ?? '', redact)
    } else if (key === 'items' && value.type === 'sources') {
      result.items = (Array.isArray(value.items) ? value.items : []).map(item => source(item, redact)).filter(Boolean)
    } else if (key === 'columns' && value.type === 'table') {
      result.columns = (Array.isArray(value.columns) ? value.columns : []).filter(item => isRecord(item) && typeof item.key === 'string').map(item => ({
        key: item.key, label: display(item.label ?? item.key, redact),
      }))
    } else if (key === 'rows' && value.type === 'table') {
      result.rows = (Array.isArray(value.rows) ? value.rows : []).map(row => (Array.isArray(row) ? row : []).map(item => scalar(item, redact)))
    } else if (key === 'categories' && value.type === 'chart') {
      result.categories = (Array.isArray(value.categories) ? value.categories : []).map(item => scalar(item, redact))
    } else if (key === 'series' && value.type === 'chart') {
      result.series = (Array.isArray(value.series) ? value.series : []).filter(isRecord).map(item => ({
        ...(typeof item.name === 'string' ? { name: display(item.name, redact) } : {}),
        values: (Array.isArray(item.values) ? item.values : []).map(item => scalar(item, redact)),
      }))
    } else if (key === 'options') {
      result.options = (Array.isArray(value.options) ? value.options : []).map(item => option(item, redact, {
        description: value.type === 'options', preserveValue: value.type === 'choice',
      })).filter(Boolean)
    } else if (key === 'fields') {
      result.fields = (Array.isArray(value.fields) ? value.fields : []).map(item => field(item, redact)).filter(Boolean)
    } else if (key === 'id' || key === 'type') {
      result[key] = value[key]
    } else if (key === 'value' && INPUT_TYPES.has(value.type)) {
      result.value = scalar(value.value, redact, true)
    } else if (key === 'value' || key === 'percent' || key === 'min' || key === 'max' || key === 'step' || key === 'height') {
      result[key] = scalar(value[key], redact)
    } else if (key === 'multi') {
      result.multi = value.multi === true
    } else if (typeof value[key] === 'string') {
      result[key] = display(value[key], redact)
    } else if (Array.isArray(value[key])) {
      result[key] = value[key].map(item => scalar(item, redact))
    } else if (isRecord(value[key])) {
      result[key] = scalar(value[key], redact)
    } else {
      result[key] = value[key]
    }
  }
  return result
}

// Validate once before redaction and once after it. The second check makes a
// card unavailable rather than exposing a blueprint whose controls no longer
// have the same answer semantics after secret removal.
export function projectShownView(title, view, redact = value => value) {
  let checked
  try { checked = checkShownView(title, view) } catch { return undefined }
  if (checked.error !== undefined) return undefined
  const safeTitle = display(checked.title, redact)
  const safeView = node(checked.view, redact)
  if (!safeView) return undefined
  let safe
  try { safe = checkShownView(safeTitle, safeView) } catch { return undefined }
  return safe.error === undefined ? { title: safe.title, view: safe.view } : undefined
}

export function projectPendingView(title, view, redact = value => value) {
  let checked
  try { checked = checkShownView(title, view) } catch { return undefined }
  if (checked.error !== undefined) return undefined
  const projected = projectShownView(checked.title, checked.view, redact)
  return projected ?? { title: display(checked.title, redact) }
}

export function projectHistoricalView(call, result, redact = value => value) {
  if (call?.name !== 'show_view' || !SUCCESS_RECEIPTS.has(result)) return undefined
  let args
  try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments } catch { return undefined }
  if (!isRecord(args) || !Object.hasOwn(args, 'view')) return undefined
  let checked
  try { checked = checkShownView(args.title, args.view) } catch { return undefined }
  if (checked.error !== undefined || (!checked.interactive && args.await_reply === true) || (checked.interactive && args.await_reply === false)) return undefined
  return projectShownView(args.title, args.view, redact) ?? { title: display(checked.title, redact), view: undefined }
}

export function projectSideChats(value, botIds, redact = text => text) {
  const chats = isRecord(value) ? value : {}
  const result = {}
  for (const botId of botIds) {
    const list = Array.isArray(chats[botId]) ? chats[botId] : []
    const visible = list.slice(-50).flatMap(chat => {
      if (!isRecord(chat) || chat.botId !== botId || typeof chat.id !== 'string' || chat.id.length > 256) return []
      const entries = (Array.isArray(chat.entries) ? chat.entries : []).slice(-100).flatMap(entry => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length > 256 || typeof entry.question !== 'string' || typeof entry.answer !== 'string' || !STATUS.has(entry.status)) return []
        return [{
          id: entry.id,
          question: display(entry.question ?? '', redact, 12000),
          answer: display(entry.answer ?? '', redact, 12000),
          status: entry.status,
          ...(typeof entry.error === 'string' ? { error: display(entry.error, redact, 4000) } : {}),
          ...(Number.isFinite(entry.createdAt) ? { createdAt: entry.createdAt } : {}),
          ...(Number.isFinite(entry.finishedAt) ? { finishedAt: entry.finishedAt } : {}),
        }]
      })
      return [{
        id: chat.id, botId,
        ...(Number.isFinite(chat.createdAt) ? { createdAt: chat.createdAt } : {}),
        ...(Number.isFinite(chat.updatedAt) ? { updatedAt: chat.updatedAt } : {}),
        entries,
      }]
    })
    if (visible.length) result[botId] = visible
  }
  return result
}
