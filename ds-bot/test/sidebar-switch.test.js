import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// jsdom comes from the harness that test/harness-resolve.mjs found, like the dsh packages.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

// The sidebar and its style sheets import the browser's React; bundle them with a minimal
// stand-in, as the tool-cell tests do: components run as plain functions, effects never run.
const { outputFiles } = await build({
  stdin: {
    contents: "export { SHELL_CSS } from './src/client/styles.js'\nexport { SIDEBAR_CSS, TeamSidebar } from './src/client/sidebar.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : {}),
})
const { SHELL_CSS, SIDEBAR_CSS, TeamSidebar } = module.exports

function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  for (let at = 0; ;) {
    const open = text.indexOf('{', at)
    if (open === -1) return rules
    let end = open + 1
    for (let depth = 1; depth > 0; end += 1) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0
    const selector = text.slice(at, open).trim()
    if (!selector.startsWith('@')) rules.push({ selector, body: text.slice(open + 1, end - 1).replace(/\s+/g, '') })
    at = end
  }
}
const SHELL_PARTS = /_logoRow|_brand|_toggle|_newSession|_footArea|_collapsed|_topStrip|bt-side-collapse/
const rules = [...rulesOf(SHELL_CSS), ...rulesOf(SIDEBAR_CSS)].filter(rule => SHELL_PARTS.test(rule.selector))
const hiding = rules.filter(rule => /display:none/.test(rule.body))

// The shell sidebar's own markup (dsh-client-ui-sidebar SidebarRoot), reduced to what the
// team view reshapes: the switch is in the logo row, except in a macOS desktop window,
// where it sits in the strip by the window buttons.
function shell({ platform, collapsed }) {
  const darwin = platform === 'mac'
  const toggle = '<button class="x_iconButton x_toggle" aria-label="Toggle sidebar"></button>'
  const html = `<!doctype html><html${platform === 'windows' ? ' data-windows-titlebar' : ''}${darwin ? ' data-platform="darwin"' : ''}><body>
    <div${collapsed ? ' data-sidebar-collapsed="true"' : ''}>
      <div class="x_root${collapsed ? ' x_collapsed' : ''}">
        ${darwin ? `<div class="x_topStrip">${toggle}</div>` : ''}
        <div class="x_logoRow">${collapsed ? '' : '<button class="x_brand x_wide"></button>'}${darwin ? '' : toggle}</div>
        <div class="x_newSession"></div>
        <div class="team">${collapsed ? '' : '<div class="bt-side-top"><button class="bt-round bt-side-collapse"></button></div>'}</div>
        <div class="x_footArea"><span class="bt-foot-account"></span></div>
      </div>
    </div></body></html>`
  const { document } = new JSDOM(html).window
  const hidden = (node) => {
    for (let at = node; at && at.nodeType === 1; at = at.parentElement) {
      if (hiding.some(rule => at.matches(rule.selector))) return true
    }
    return false
  }
  const switches = [...document.querySelectorAll('.x_toggle, .bt-side-collapse')].filter(node => !hidden(node))
  return { document, hidden, switches }
}

for (const platform of ['web', 'windows', 'mac']) {
  for (const collapsed of [false, true]) {
    test(`${collapsed ? 'a collapsed' : 'an open'} sidebar on ${platform} shows exactly one sidebar switch`, () => {
      const { document, hidden, switches } = shell({ platform, collapsed })
      assert.equal(switches.length, 1, `switches shown: ${switches.map(node => node.className).join(' | ') || 'none'}`)
      const [shown] = switches
      // An open sidebar on the web has the team's own button; everywhere else the shell's
      // switch stays where the shell puts it.
      assert.equal(shown.classList.contains('bt-side-collapse'), platform === 'web' && !collapsed)
      // What the team view replaces stays out of sight.
      assert.equal(hidden(document.querySelector('.x_newSession')), true)
      const brand = document.querySelector('.x_brand')
      if (brand) assert.equal(hidden(brand), true)
    })
  }
}

test('an open sidebar has a button that collapses it; the rail leaves that to the shell', () => {
  const calls = []
  const roster = { bots: [], rooms: [], agents: [], byId: {}, ready: true }
  const props = wide => ({
    wide,
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useUpdate: () => ({}),
    actions: { toggleSidebar: () => calls.push('toggle') },
  })
  const find = (node, match) => {
    if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean)
    if (!node || typeof node !== 'object') return undefined
    return match(node) ? node : find(node.props?.children, match)
  }
  const collapse = node => node.type === 'button' && node.props['aria-label'] === 'Collapse sidebar'
  const button = find(TeamSidebar(props(true)), collapse)
  assert.ok(button?.props.className.split(' ').includes('bt-side-collapse'))
  button.props.onClick()
  assert.deepEqual(calls, ['toggle'])
  assert.equal(find(TeamSidebar(props(false)), collapse), undefined)
})

test('the logo row takes no room in an open sidebar under a Windows title bar', () => {
  const { document } = shell({ platform: 'windows', collapsed: false })
  const row = document.querySelector('.x_logoRow')
  const flat = rules.filter(rule => row.matches(rule.selector) && /height:0!important/.test(rule.body))
  assert.equal(flat.length, 1)
  assert.equal(shell({ platform: 'windows', collapsed: true }).document.querySelector('.x_logoRow').matches(flat[0].selector), false)
})

// The shell hides the footer of a collapsed sidebar under a Windows title bar, whose width
// is zero; a forced display put the account button off the screen.
test('the team view lays out the shell footer but never decides whether it shows', () => {
  const { document } = shell({ platform: 'windows', collapsed: true })
  const foot = document.querySelector('.x_footArea')
  const deciding = rules.filter(rule => foot.matches(rule.selector) && /(^|;)display:/.test(rule.body))
  assert.deepEqual(deciding.map(rule => rule.selector), [])
})

// 公开#164: the footer's grid gives other plugins' entries rows of their own; it holds
// wherever the shell shows the footer, and stays out of the one place it hides it.
test('the shell footer is a grid wherever the shell shows it', () => {
  for (const platform of ['web', 'windows', 'mac']) {
    for (const collapsed of [false, true]) {
      const foot = shell({ platform, collapsed }).document.querySelector('.x_footArea')
      const grid = rules.some(rule => foot.matches(rule.selector) && /(^|;)display:grid/.test(rule.body))
      assert.equal(grid, !(platform === 'windows' && collapsed), `${platform} ${collapsed ? 'collapsed' : 'open'}`)
    }
  }
})
