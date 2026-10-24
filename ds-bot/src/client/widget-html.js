import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n.js'

// -------------------------------------------------------------------------
// The html component of a view, for what the catalog cannot draw. The Bot's markup
// runs in a sandboxed frame: scripts only (no same-origin, so no access to the app,
// its storage or its API), and a policy written ahead of the markup that blocks
// every network request. The frame reports its height and takes theme colors; it
// has no way to answer the Bot. A frame that navigates away is stopped.

export const FRAME_VARS = ['--bt-ink', '--bt-ink-2', '--bt-ink-3', '--bt-line', '--bt-line-2', '--bt-card', '--bt-main', '--bt-hover', '--bt-accent', '--bt-accent-ink', '--bt-green', '--bt-star', '--bt-danger']
export const FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'"
const HEIGHT = 'bt-view-height'
const THEME = 'bt-view-theme'
const MIN_HEIGHT = 24

export function themeVars() {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined' || !document.body) return {}
  const style = getComputedStyle(document.body)
  const vars = {}
  for (const name of FRAME_VARS) {
    const value = style.getPropertyValue(name).trim()
    if (value !== '') vars[name] = value
  }
  // The same scheme as the page around it: a frame whose scheme differs gets an opaque
  // backdrop instead of a transparent one.
  vars['color-scheme'] = style.getPropertyValue('color-scheme').trim() || 'normal'
  return vars
}

const cssValue = value => String(value).replace(/[<>{};]/g, '')

// The document the frame loads. The policy and our script come before the Bot's
// markup, so nothing in the markup runs before them or loosens the policy.
export function frameDocument(html, vars = {}) {
  const root = Object.entries(vars).map(([name, value]) => `${name}:${cssValue(value)}`).join(';')
  const report = `(()=>{const send=()=>parent.postMessage({type:${JSON.stringify(HEIGHT)},height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*');`
    + 'new ResizeObserver(send).observe(document.documentElement);addEventListener(\'load\',send);'
    + `addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.type!==${JSON.stringify(THEME)})return;for(const[k,v]of Object.entries(e.data.vars||{}))document.documentElement.style.setProperty(k,String(v))})})()`
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`
    + `<style>:root{${root}}html,body{margin:0;padding:0;background:transparent;color:var(--bt-ink);font:14px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}*{box-sizing:border-box}</style>`
    + `<script>${report}</script></head><body>${html}</body></html>`
}

export function HtmlFrame({ node }) {
  const frame = useRef(null)
  const loads = useRef(0)
  const [height, setHeight] = useState(Number.isFinite(node.height) ? node.height : 120)
  const [stopped, setStopped] = useState(false)
  const doc = useMemo(() => frameDocument(String(node.html ?? ''), themeVars()), [node.html])
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== HEIGHT) return
      const next = Number(event.data.height)
      if (Number.isFinite(next)) setHeight(Math.max(MIN_HEIGHT, Math.ceil(next)))
    }
    window.addEventListener('message', onMessage)
    const retheme = () => frame.current?.contentWindow?.postMessage({ type: THEME, vars: themeVars() }, '*')
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(retheme) : null
    observer?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
    return () => { window.removeEventListener('message', onMessage); observer?.disconnect() }
  }, [])
  if (stopped) return h('p', { className: 'bt-view-frame-stopped' }, t('This view tried to open a page and was stopped.'))
  return h('iframe', {
    ref: frame, className: 'bt-view-frame', title: String(node.summary ?? ''),
    sandbox: 'allow-scripts', srcDoc: doc, referrerPolicy: 'no-referrer',
    style: { height: `${height}px` },
    onLoad: () => { loads.current += 1; if (loads.current > 1) setStopped(true) },
  })
}

export const HTML_CSS = `
.bt-view-frame{display:block;width:100%;border:0;background:transparent}
.bt-view-frame-stopped{margin:0;font-size:13px;line-height:18px;color:var(--bt-ink-2)}
`
