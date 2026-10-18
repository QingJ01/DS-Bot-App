import { createElement as h, useMemo, useState } from 'react'
import { t } from './i18n.js'

// A message past FOLD_AT shows folded: its first lines, then "Show all". A Bot's reply in
// its own chat is what the user reads, so it folds only past FOLD_HUGE, where rendering
// all of it would slow the chat down.
export const FOLD_AT = { chars: 1500, lines: 25 }
export const FOLD_HUGE = { chars: 20_000, lines: Infinity }
const ALWAYS = { chars: -1, lines: 0 }
const PREVIEW_LINES = 10
const PREVIEW_CHARS = 600
const FENCE = /^ {0,3}(`{3,}|~{3,})/

// More than `max` lines, counted only as far as needed.
function moreLines(text, max) {
  let lines = 1
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    if (++lines > max) return true
  }
  return false
}

// The start of a long text, cut at a line end (or inside a very long first line). In
// Markdown a code fence left open is closed, so the preview does not run on as code.
// Null when `text` is within `limit`.
export function foldPreview(text, limit = FOLD_AT, markdown = true) {
  if (text.length <= limit.chars && !moreLines(text, limit.lines)) return null
  let head = text.split('\n', PREVIEW_LINES).join('\n')
  if (head.length > PREVIEW_CHARS) {
    const cut = head.lastIndexOf('\n', PREVIEW_CHARS)
    const end = cut > 0 ? cut : PREVIEW_CHARS
    const code = head.charCodeAt(end - 1)
    head = head.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end)
  }
  if (!markdown) return head
  let open = null
  for (const line of head.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (marker === undefined) continue
    if (open === null) open = marker
    else if (marker[0] === open[0] && marker.length >= open.length) open = null
  }
  return open === null ? head : `${head}\n${open}`
}

// The line a long message that went as a file starts with (the host's attachLong) is
// for the model; the chat shows "Show all" instead.
export const stripLongNote = text => text.replace(/^\[A long message: \d+ characters\.[^\]\n]*\]\n/, '')

// `shown`: the text to show now; `control`: what goes under it (null for a short text).
// `whole`, when `text` is only the start of the message: its `length`, and `load()`,
// which reads it whole ({ text, whole }). `live`: still streaming, never folded.
// `markdown`: false for plain text.
export function useFold(text, { limit = FOLD_AT, whole, live = false, markdown = true } = {}) {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState()
  const cut = whole !== undefined && whole.length > text.length
  // A message kept only in part folds whatever the length of its start.
  const preview = useMemo(() => (live ? null : foldPreview(text, cut ? ALWAYS : limit, markdown)), [text, live, limit, markdown, cut])
  if (preview === null) return { shown: text, control: null }
  const count = (cut ? whole.length : text.length).toLocaleString()
  if (!open) {
    const show = async () => {
      setOpen(true)
      if (!cut || read !== undefined || whole.load === undefined) return
      setRead('loading')
      setRead(await whole.load() ?? { whole: false })
    }
    return { shown: preview, folded: true, control: h('span', { className: 'bt-fold' }, h('button', { type: 'button', className: 'bt-more', onClick: show }, t('Show all · {count} characters', { count }))) }
  }
  const loaded = typeof read?.text === 'string' ? read : undefined
  const note = !cut || read === undefined || read === 'loading' || loaded?.whole ? null
    : loaded !== undefined && loaded.text.length > text.length ? t('Showing the first {count} characters', { count: loaded.text.length.toLocaleString() })
      : t('Only the start of this message is kept here')
  return {
    shown: loaded?.text ?? text,
    control: h('span', { className: 'bt-fold' },
      note ? h('span', { className: 'bt-fold-note' }, note) : null,
      h('button', { type: 'button', className: 'bt-more', onClick: () => setOpen(false) }, t('Show less'))),
  }
}
