import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/settings.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText: () => null } : require(name),
})
const render = page => renderToStaticMarkup(React.createElement(module.exports.SettingsDialog, {
  page, roster: { prefs: {}, bots: [], rooms: [], byId: {}, roomsById: {} },
  actions: { providers: {} }, useUpdate: select => select({ current: '0.1.2', source: 'path' }),
}))

test('settings opens with every navigation icon rendered by React', () => {
  const html = render('general')
  assert.match(html, /role="dialog"/)
  assert.match(html, /Appearance/)
  const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1]
  const buttons = [...nav.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
  assert.equal(buttons.length, 13)
  for (const [, content] of buttons) assert.match(content, /<svg\b/)
  assert.match(nav, /Plugin updates/)
})

test('plugin updates, About and unknown settings routes render without crashing', () => {
  assert.match(render('updates'), /<h2>Plugin updates<\/h2>/)
  assert.match(render('about'), /<h2>About DS Bot<\/h2>/)
  assert.match(render('unknown'), /<h2>General<\/h2>/)
})
