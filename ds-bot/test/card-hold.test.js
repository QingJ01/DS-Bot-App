import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createSource, heldCardKey } from '../src/client/sources.js'
import { teamActions } from '../src/client/team-actions.js'

// Keep each component's hook state across renders. The tool-cell tests cover where
// these components appear; this harness checks their edits and async lifetimes.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { useDockHold } from './src/client/card-hold.js'",
      "export { PendingQuestion } from './src/client/questions.js'",
      "export { SecretCard } from './src/client/secret-card.js'",
      "export { PendingView } from './src/client/widget-cell.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
let current
const slot = (make) => {
  const index = current.index++
  return current.slots[index] ??= make()
}
const effect = (make, deps) => {
  const cell = slot(() => ({}))
  if (!cell.deps || deps.some((value, index) => value !== cell.deps[index])) {
    current.effects.push(() => { cell.stop?.(); cell.stop = make(); cell.deps = deps })
  }
}
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: (initial) => {
    const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
  },
  useRef: initial => slot(() => ({ current: initial })),
  useId: () => slot(() => ({ id: 'card-id' })).id,
  useEffect: effect, useLayoutEffect: effect,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}
const keys = new Set()
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    assert.ok(name === 'react' || name === '@deepseek-ai/dsh-client-ui-primitives')
    return name === 'react' ? react : { MarkdownText: ({ text }) => text }
  },
  document: {
    activeElement: null, querySelector: () => null,
    addEventListener: (type, listener) => { if (type === 'keydown') keys.add(listener) },
    removeEventListener: (type, listener) => { if (type === 'keydown') keys.delete(listener) },
  },
  HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, HTMLElement: class {},
})
const { useDockHold, PendingQuestion, SecretCard, PendingView } = module.exports
const mount = (Component, props) => {
  const instance = {
    slots: [], effects: [], props,
    render(next = instance.props) {
      instance.props = next
      instance.index = 0
      current = instance
      const out = Component(next)
      current = undefined
      for (const run of instance.effects.splice(0)) run()
      return out
    },
    unmount() { for (const cell of instance.slots) cell.stop?.() },
  }
  return instance
}
const find = (node, check) => {
  if (Array.isArray(node)) return node.map(child => find(child, check)).find(Boolean)
  if (!node || typeof node !== 'object') return undefined
  return check(node) ? node : find(node.props.children, check)
}
const all = (node, check) => {
  if (Array.isArray(node)) return node.flatMap(child => all(child, check))
  if (!node || typeof node !== 'object') return []
  return [...(check(node) ? [node] : []), ...all(node.props.children, check)]
}
const options = node => all(node, child => child.type === 'button' && child.props.className === 'bt-q-opt')
const field = node => find(node, child => child.type === 'textarea')
const childOf = node => node.props.children[0]
const plain = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const lease = () => {
  const source = createSource({})
  const actions = teamActions({ heldCards: source })
  const count = (sessionId, kind, id) => source.getSnapshot()[sessionId]?.[heldCardKey(kind, id)] ?? 0
  return { source, actions, count }
}
const Hold = props => useDockHold(props.sessionId, props.kind, props.id, props.actions, props.inline)
const question = { id: 'question', question: 'Which draft?', options: ['Short', 'Detailed'], allowCustom: true, multiSelect: true }

// Multiple slot instances may coexist briefly during a render. One cleanup must
// not release another instance's ownership of that same request.
test('dock ownership counts each instance once and releases only its own request', () => {
  const { actions, count, source } = lease()
  const props = { actions, sessionId: 'chief', kind: 'question', id: 'request' }
  const first = mount(Hold, props)
  const second = mount(Hold, props)
  const takeFirst = first.render()
  takeFirst()
  takeFirst()
  second.render()()
  assert.equal(count('chief', 'question', 'request'), 2)
  first.unmount()
  assert.equal(count('chief', 'question', 'request'), 1)
  second.unmount()
  assert.equal(count('chief', 'question', 'request'), 0)
  const inline = mount(Hold, { ...props, inline: true })
  inline.render()()
  inline.unmount()
  assert.deepEqual(source.getSnapshot(), { chief: {} })
})

test('changing session, request or kind releases the old identity before a fresh interaction', () => {
  const { actions, count, source } = lease()
  const instance = mount(Hold, { actions, sessionId: 'chief', kind: 'question', id: 'same' })
  instance.render()()
  const take = instance.render({ actions, sessionId: 'other', kind: 'secret', id: 'same' })
  assert.equal(count('chief', 'question', 'same'), 0)
  assert.equal(count('other', 'secret', 'same'), 0)
  take()
  assert.deepEqual(source.getSnapshot(), { chief: {}, other: { '["secret","same"]': 1 } })
  instance.render({ actions, sessionId: 'other', kind: 'secret', id: 'next' })()
  assert.equal(count('other', 'secret', 'same'), 0)
  assert.equal(count('other', 'secret', 'next'), 1)
  instance.unmount()
  assert.deepEqual(source.getSnapshot(), { chief: {}, other: {} })
})

test('a question keeps its custom answer and selection while submitting, after failure, and on retry', async () => {
  const { actions, count } = lease()
  const wait = deferred()
  const sent = []
  let result = wait.promise
  actions.answerQuestion = (...args) => { sent.push(plain(args)); return result }
  const pending = mount(PendingQuestion, { actions, sessionId: 'chief', question, inline: false })
  const initial = childOf(pending.render())
  const view = mount(initial.type, initial.props)
  let form = view.render()
  field(form).props.onChange({ target: { value: 'Custom draft' } })
  options(form)[1].props.onClick()
  form = view.render()
  form.props.onSubmit({ preventDefault() {} })
  form.props.onSubmit({ preventDefault() {} })
  const submitting = childOf(pending.render())
  assert.equal(submitting.type, initial.type)
  assert.equal(submitting.props.key, initial.props.key)
  form = view.render(submitting.props)
  assert.equal(field(form).props.value, 'Custom draft')
  assert.equal(field(form).props.readOnly, true)
  assert.ok(options(form).every(option => option.props.disabled))
  assert.equal(count('chief', 'question', question.id), 1)
  await tick()
  assert.deepEqual(sent, [['chief', 'question', { selected: ['Detailed'], custom: 'Custom draft' }]])
  wait.reject(new Error('Temporary failure'))
  await tick()
  form = view.render(childOf(pending.render()).props)
  assert.equal(field(form).props.value, 'Custom draft')
  assert.equal(field(form).props.readOnly, false)
  assert.deepEqual(options(form).map(option => option.props['aria-pressed']), [false, true])
  result = Promise.resolve()
  form.props.onSubmit({ preventDefault() {} })
  await tick()
  assert.equal(sent.length, 2)
  assert.equal(pending.render(), null)
  view.unmount()
  pending.unmount()
  assert.equal(count('chief', 'question', question.id), 0)
})

test('keyboard selection owns a dock card and busy questions cannot submit or dismiss twice', async () => {
  const { actions, count } = lease()
  const wait = deferred()
  const sent = []
  actions.answerQuestion = (...args) => { sent.push(args); return wait.promise }
  actions.dismissQuestion = () => { sent.push('dismiss'); return wait.promise }
  const pending = mount(PendingQuestion, { actions, sessionId: 'chief', question: { ...question, multiSelect: false }, inline: false })
  const initial = childOf(pending.render())
  const view = mount(initial.type, initial.props)
  view.render()
  const key = () => ({ key: 'a', target: null, preventDefault() { this.defaultPrevented = true } })
  for (const listener of keys) listener(key())
  for (const listener of keys) listener(key())
  initial.props.onDismiss()
  assert.equal(count('chief', 'question', question.id), 1)
  view.render(childOf(pending.render()).props)
  assert.equal(keys.size, 0)
  await tick()
  assert.equal(sent.length, 1)
  wait.resolve()
  await tick()
  view.unmount()
  pending.unmount()
  assert.equal(count('chief', 'question', question.id), 0)
})

test('secret edits stay local and an in-flight save preserves value and scope for a retry', async () => {
  const { actions, count, source } = lease()
  const wait = deferred()
  const sent = []
  let result = wait.promise
  actions.secretSet = payload => { sent.push(payload); return result }
  const request = { id: 'request', kind: 'fill', name: 'DEMO_TOKEN' }
  const card = mount(SecretCard, { actions, sessionId: 'chief', bot: { id: 'chief', name: 'Chief' }, request, roster: { secrets: [] } })
  let out = card.render()
  find(out, node => node.type.name === 'MaskedInput').props.onChange('synthetic-test-value')
  find(out, node => node.type.name === 'ScopeSwitch').props.onChange('bot')
  out = card.render()
  const save = find(out, node => node.props.className === 'bt-q-submit').props.onClick
  save()
  save()
  out = card.render()
  assert.equal(find(out, node => node.props.className === 'bt-q-submit').props.disabled, true)
  assert.equal(find(out, node => node.type.name === 'MaskedInput').props.value, 'synthetic-test-value')
  assert.deepEqual(source.getSnapshot(), { chief: { '["secret","request"]': 1 } })
  await tick()
  assert.equal(sent.length, 1)
  wait.reject(new Error('Save failed'))
  await tick()
  out = card.render()
  assert.equal(find(out, node => node.type.name === 'MaskedInput').props.value, 'synthetic-test-value')
  assert.equal(find(out, node => node.type.name === 'ScopeSwitch').props.value, 'bot')
  assert.equal(find(out, node => node.props.className === 'bt-q-submit').props.disabled, false)
  result = Promise.resolve()
  find(out, node => node.props.className === 'bt-q-submit').props.onClick()
  await tick()
  assert.deepEqual(plain(sent), [
    { requestId: 'request', value: 'synthetic-test-value', scope: 'bot' },
    { requestId: 'request', value: 'synthetic-test-value', scope: 'bot' },
  ])
  assert.equal(find(card.render(), node => node.type.name === 'MaskedInput').props.value, '')
  card.unmount()
  assert.equal(count('chief', 'secret', 'request'), 0)
})

const pendingView = () => ({ id: 'view-1', callId: 'call-1', title: 'Pick', view: { type: 'options', id: 'pick', options: [{ label: 'A' }, { label: 'B' }] } })

test('a pending view hides but stays mounted while its request is in flight', async () => {
  const { actions, count } = lease()
  const wait = deferred()
  const sent = []
  let result = wait.promise
  actions.answerView = (...args) => { sent.push(plain(args)); return result }
  actions.dismissView = () => { sent.push('dismiss'); return result }
  const pending = mount(PendingView, { actions, sessionId: 'chief', view: pendingView(), inline: false })
  const card = pending.render()
  assert.equal(card.props.style, undefined)
  // A second submit while the first is in flight is swallowed.
  childOf(card).props.onSubmit('pick', { selected: ['A'] })
  childOf(card).props.onSubmit('pick', { selected: ['B'] })
  const flying = pending.render()
  assert.deepEqual(plain(flying.props.style), { display: 'none' })
  assert.equal(childOf(flying).props.busy, true)
  assert.equal(count('chief', 'view', 'view-1'), 1)
  await tick()
  assert.deepEqual(sent, [['chief', 'view-1', 'pick', { selected: ['A'] }]])
  wait.reject(new Error('Temporary failure'))
  await tick()
  // The rejection brings the card back, still holding what the user picked.
  const back = pending.render()
  assert.equal(back.props.style, undefined)
  assert.equal(childOf(back).props.busy, false)
  // A failed dismiss brings the card back too: the server still waits on it.
  const dismiss = deferred()
  result = dismiss.promise
  childOf(pending.render()).props.onDismiss()
  assert.deepEqual(plain(pending.render().props.style), { display: 'none' })
  await tick()
  assert.deepEqual(sent.at(-1), 'dismiss')
  dismiss.reject(new Error('flush failed'))
  await tick()
  assert.equal(pending.render().props.style, undefined)
  result = Promise.resolve()
  childOf(pending.render()).props.onSubmit('pick', { selected: ['B'] })
  await tick()
  assert.equal(sent.at(-1)[2], 'pick')
  assert.deepEqual(plain(pending.render().props.style), { display: 'none' })
  pending.unmount()
  assert.equal(count('chief', 'view', 'view-1'), 0)
})

test('letter keys answer a card only while it is the sole open card with keys', async () => {
  const { actions } = lease()
  const answers = []
  actions.answerQuestion = (...args) => { answers.push(plain(args)); return Promise.resolve() }
  actions.dismissQuestion = () => Promise.resolve()
  const ask = id => ({ ...question, id, multiSelect: false })
  const first = mount(PendingQuestion, { actions, sessionId: 'chief', question: ask('first'), inline: false })
  const second = mount(PendingQuestion, { actions, sessionId: 'chief', question: ask('second'), inline: false })
  const firstCard = childOf(first.render())
  const secondCard = childOf(second.render())
  const firstView = mount(firstCard.type, firstCard.props)
  const secondView = mount(secondCard.type, secondCard.props)
  firstView.render()
  // A lone card advertises its keys: both options and the own-answer row.
  assert.equal(all(firstView.render(), node => node.props.className === 'bt-key').length, 3)
  secondView.render()
  assert.equal(keys.size, 2)
  // With two cards open neither shows letters for keys it will not answer.
  assert.equal(all(firstView.render(), node => node.props.className === 'bt-key').length, 0)
  const both = secondView.render()
  assert.equal(all(both, node => node.props.className === 'bt-key').length, 0)
  assert.ok(options(both).every(option => option.props['aria-keyshortcuts'] === undefined))
  assert.equal(field(both).props['aria-keyshortcuts'], undefined)
  const key = () => ({ key: 'a', target: null, preventDefault() { this.defaultPrevented = true } })
  const shared = key()
  for (const listener of [...keys]) listener(shared)
  // Two open cards both stay silent rather than the first listener stealing the key.
  assert.equal(shared.defaultPrevented, undefined)
  assert.equal(answers.length, 0)
  firstView.unmount()
  assert.equal(keys.size, 1)
  // Alone again, the surviving card brings its letters back.
  const alone = secondView.render()
  assert.equal(all(alone, node => node.props.className === 'bt-key').length, 3)
  assert.ok(options(alone).every(option => option.props['aria-keyshortcuts'] !== undefined))
  assert.equal(field(alone).props['aria-keyshortcuts'], 'c')
  for (const listener of [...keys]) listener(key())
  await tick()
  assert.deepEqual(answers, [['chief', 'second', { selected: ['Short'], custom: '' }]])
  secondView.unmount()
  first.unmount()
  second.unmount()
  assert.equal(keys.size, 0)
})
