import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RADII, checks, findStyles, lowered, readDebt } from '../scripts/style-debt.mjs'

const found = findStyles()
const debt = readDebt()

// One line per file and value whose count differs from test/style-debt.json.
function drift(kind) {
  const lines = []
  for (const file of new Set([...Object.keys(found[kind]), ...Object.keys(debt[kind] ?? {})])) {
    const now = found[kind][file] ?? {}
    const was = debt[kind]?.[file] ?? {}
    for (const value of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const more = (now[value] ?? 0) - (was[value] ?? 0)
      if (more > 0) lines.push(`src/client/${file}: ${value}, ${more} new`)
      if (more < 0) lines.push(`src/client/${file}: ${value}, ${-more} gone; run node scripts/style-debt.mjs --write`)
    }
  }
  return lines
}

function check(kind, advice) {
  const lines = drift(kind)
  assert.equal(lines.length, 0, `${lines.join('\n')}\n${advice}`)
}

test('colors come from the --bt-* variables', () => {
  check('colors', 'Use a --bt-* variable. A new color becomes a variable first, in themes.js or in the base sheet of styles.js.')
})

test('corner radii stay on the steps', () => {
  check('radii', `Round corners with one of ${RADII.join(' ')}, or with a variable.`)
})

test('springs come from motion.js', () => {
  check('springs', 'Use a spring that motion.js exports, or add the new one there.')
})

test('the checks catch what they look for and pass what they allow', () => {
  assert.deepEqual(checks.colors('x.js', '.a{color:#12AB56;background:rgba(1, 2, 3, .5);box-shadow:0 1px 2px rgba(0,0,0,.1)}'), ['#12ab56', 'rgba(1,2,3,.5)'])
  assert.deepEqual(checks.colors('x.js', '.a{border:1px solid Red;fill:oklch(60% .2 20);stroke:currentColor;color:var(--bt-green)}'), ['oklch(60% .2 20)', 'red'])
  assert.deepEqual(checks.colors('x.js', "const bot = { color: 'gray' }"), [])
  assert.deepEqual(checks.colors('styles.js', 'body{--bt-x:#fff}\nbody[data-ds-dark-theme]{--bt-x:white}'), [])
  assert.deepEqual(checks.colors('styles.js', '.a{--bt-x:#fff}'), ['#fff'])
  assert.deepEqual(checks.colors('x.js', 'body{--bt-x:#fff}'), ['#fff'])
  assert.deepEqual(checks.colors('x.js', '.m{mask-image:linear-gradient(to top,transparent,#000 calc(100% - 8px))}'), [])
  assert.deepEqual(checks.colors('x.js', '<mask id="m"><g stroke="#000"/></mask><g fill="#000"/>'), ['#000'])
  assert.deepEqual(checks.colors('x.js', '.a{background:linear-gradient(#000,#fff)}'), ['#000', '#fff'])
  assert.deepEqual(checks.colors('themes.js', "const ink = '#123456'"), [])
  assert.deepEqual(checks.radii('x.js', '.a{border-radius:12px 9px;border-top-left-radius:5px!important}'), ['9px', '5px'])
  assert.deepEqual(checks.radii('x.js', "h('i', { style: { borderRadius: 999 } }), h('b', { style: { 'borderRadius': 7 } })"), ['7px'])
  assert.deepEqual(checks.radii('x.js', "node.style.borderRadius = '3px'; node.style.setProperty('border-radius', '5px')"), ['3px', '5px'])
  assert.deepEqual(checks.radii('x.js', '.a{border-radius:var(--r, 3px) 50%}'), [])
  assert.deepEqual(checks.springs('x.js', 'const GLIDE = springEasing(\n  1000,\n  63,\n)'), ['springEasing(1000,63,)'])
  assert.deepEqual(checks.springs('motion.js', 'export const SPRING = springEasing(400, 31.2)'), [])
})

test('--write only lowers the list', () => {
  const listed = { colors: { 'a.js': { '#111': 2, '#222': 1 }, 'b.js': { '#333': 1 } }, radii: {}, springs: {} }
  const now = { colors: { 'a.js': { '#111': 1, '#444': 3 }, 'c.js': { '#555': 1 } }, radii: { 'a.js': { '9px': 1 } }, springs: {} }
  assert.deepEqual(lowered(listed, now), { colors: { 'a.js': { '#111': 1 } }, radii: {}, springs: {} })
})
