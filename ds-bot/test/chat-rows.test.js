import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/cells.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, Intl, Date,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) },
      'react-dom': {},
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { ChatRows } = module.exports

const roster = { byId: { b: { id: 'b', name: 'Writer' } }, roomsById: {} }
const MINUTE = 60_000
const shape = rows => [...rows].map(row => (row.props.className === 'bt-time-sep' ? 'clock' : row.type.name === 'Bubbles' ? `bot:${row.props.texts.join('+')}` : row.type.name))

test('a Bot\'s messages in a row are one block', () => {
  const items = [
    { kind: 'user', text: 'hi', time: MINUTE },
    { kind: 'bot', text: 'one', time: 2 * MINUTE },
    { kind: 'bot', text: 'two', time: 2 * MINUTE },
    { kind: 'user', text: 'and?', time: 3 * MINUTE },
    { kind: 'bot', text: 'three', time: 4 * MINUTE },
  ]
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster, actions: {} })), ['EarlierUser', 'bot:one+two', 'EarlierUser', 'bot:three'])
})

test('with the clock, a time separator sits above the first entry and after each pause of half an hour', () => {
  const items = [
    { kind: 'divider', time: 0 },
    { kind: 'user', text: 'hi', time: MINUTE },
    { kind: 'bot', text: 'one', time: 2 * MINUTE },
    { kind: 'bot', text: 'two', time: 40 * MINUTE },
    { kind: 'user', text: 'back', time: 75 * MINUTE },
  ]
  assert.deepEqual(shape(ChatRows({ items, sessionId: 'b', roster, actions: {}, clock: true })), ['PartLine', 'clock', 'EarlierUser', 'bot:one+two', 'clock', 'EarlierUser'])
})
