import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkShownView, normalizeView, validateView, validateViewAnswer, VIEW_BYTE_LIMIT, viewBytes, viewSummary } from '../src/shared/views.js'

const text = (value = 'hello') => ({ type: 'text', text: value })
const metric = (label = '进度', value = '70%') => ({ type: 'metric', label, value })
const options = (id = 'pick', extra = {}) => ({ type: 'options', id, options: [{ label: 'A' }, { label: 'B' }, { label: 'C', description: 'third' }], ...extra })
const confirm = (id = 'go') => ({ type: 'confirm', id, confirmLabel: 'Ship', cancelLabel: 'Wait' })
const form = (id = 'ask') => ({ type: 'form', id, submitLabel: 'Send', fields: [{ id: 'name', label: 'Name', placeholder: 'Ada' }, { id: 'note', label: 'Note' }] })
const progress = () => ({ type: 'progress', label: 'Load', percent: 40 })
const table = () => ({ type: 'table', columns: [{ key: 'name', label: 'Name' }, { key: 'n', label: 'N' }], rows: [['Ada', 2], ['Bea', true]] })
const stack = (...children) => ({ type: 'stack', children })

test('validateView accepts every component and reports whether the card can be submitted', () => {
  for (const view of [text(), metric(), table(), progress()]) {
    assert.deepEqual(validateView(view), { ok: true, interactive: false }, view.type)
  }
  for (const view of [options(), confirm(), form()]) {
    assert.deepEqual(validateView(view), { ok: true, interactive: true }, view.type)
  }
  const card = stack(text(), metric('进度', 70), table(), options(), confirm('ship'), form(), progress())
  assert.deepEqual(validateView(card), { ok: true, interactive: true })
  assert.equal(validateView(metric('ok', '1', )).ok, true)
  assert.deepEqual(validateView({ type: 'metric', label: 'n', value: 70, tone: 'good' }), { ok: true, interactive: false })
  assert.deepEqual(validateView({ type: 'form', id: 'empty', fields: [] }), { ok: true, interactive: true })
  assert.equal(validateView({ type: 'progress', percent: 0 }).ok, true)
  assert.equal(validateView({ type: 'progress', percent: 100 }).ok, true)
})

test('normalizeView unwraps XML-style arrays and coerces numeric strings', () => {
  // Providers may serialize nested arrays as { item: [...] } and numbers as strings.
  const wrapped = { type: 'stack', children: { item: [text(), { type: 'options', id: 'env', options: { item: [{ label: 'staging' }, { label: 'prod' }] } }] } }
  const unwrapped = normalizeView(wrapped)
  assert.ok(Array.isArray(unwrapped.children), 'children unwraps to an array')
  assert.ok(Array.isArray(unwrapped.children[1].options), 'nested options unwrap to an array')
  assert.deepEqual(validateView(unwrapped), { ok: true, interactive: true })
  // Numeric strings land only on the numeric fields, never on labels or text.
  assert.deepEqual(normalizeView({ type: 'progress', label: '70', percent: '70' }), { type: 'progress', label: '70', percent: 70 })
  assert.deepEqual(normalizeView({ type: 'metric', label: '70', value: '70' }), { type: 'metric', label: '70', value: 70 })
  assert.deepEqual(normalizeView(text('70')), text('70'), 'text stays a string')
  assert.deepEqual(normalizeView(metric('进度', '70%')), metric('进度', '70%'), 'non-numeric string stays a string')
  // Input is not mutated.
  assert.equal(Array.isArray(wrapped.children), false)
  // A provider may nest the wrapper: { item: { item: [...] } } collapses too.
  const nested = normalizeView({ type: 'stack', children: { item: { item: [text()] } } })
  assert.ok(Array.isArray(nested.children), 'a nested wrapper still unwraps')
  assert.deepEqual(validateView(nested), { ok: true, interactive: false })
})

test('validateView rejects an unknown component with the path and the catalog', () => {
  const view = stack(text(), metric(), { type: 'chart', data: [1] })
  assert.equal(validateView(view).error, 'view.children[2].type: unknown component "chart"; allowed: stack, text, metric, table, options, confirm, form, progress')
  assert.equal(validateView(null).error, 'view: expected a component object')
  assert.equal(validateView([]).error, 'view: expected a component object')
  assert.match(validateView({ type: 'text' }).error, /view\.text: expected a string/)
  assert.match(validateView({ type: 'text', text: 'hi', style: 'red' }).error, /unknown property "style"; allowed: text/)
  assert.match(validateView({ type: 'metric', label: 'n', value: '1', tone: 'nope' }).error, /unknown tone "nope"; allowed: good, warn, bad/)
  assert.match(validateView({ type: 'stack' }).error, /expected an array of 1 to 16 components/)
  assert.match(validateView({ type: 'stack', children: [] }).error, /expected 1 to 16 children; got 0/)
  assert.match(validateView({ type: 'text', text: 'x'.repeat(2001) }).error, /2001 characters exceeds the limit of 2000/)
  assert.match(validateView({ type: 'progress', percent: 101 }).error, /expected a number from 0 to 100/)
  assert.match(validateView({ type: 'progress', percent: Number.NaN }).error, /expected a number from 0 to 100/)
})

test('validateView enforces table, options, form, depth, node, and id limits', () => {
  const wide = { type: 'table', columns: Array.from({ length: 9 }, (_, index) => ({ key: `c${index}`, label: `C${index}` })), rows: [] }
  assert.match(validateView(wide).error, /9 columns exceeds the limit of 8/)
  const tall = { type: 'table', columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 51 }, () => ['x']) }
  assert.match(validateView(tall).error, /51 rows exceeds the limit of 50/)
  const cell = { type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [['x'.repeat(201)]] }
  assert.match(validateView(cell).error, /view\.rows\[0\]\[0\]: 201 characters exceeds the limit of 200/)
  assert.match(validateView({ type: 'table', columns: [{ key: 'a', label: 'A' }], rows: ['nope'] }).error, /view\.rows\[0\]: expected an array of cells/)

  const tooMany = options('pick', { options: Array.from({ length: 9 }, (_, index) => ({ label: `o${index}` })) })
  assert.match(validateView(tooMany).error, /expected 1 to 8 options; got 9/)
  assert.match(validateView(options('pick', { options: [] })).error, /expected 1 to 8 options; got 0/)
  assert.match(validateView(options('pick', { options: [{ label: 'A' }, { label: 'A' }] })).error, /duplicate label "A"/)

  const fields = { type: 'form', id: 'ask', fields: Array.from({ length: 7 }, (_, index) => ({ id: `f${index}`, label: `F${index}` })) }
  assert.match(validateView(fields).error, /7 fields exceeds the limit of 6/)
  assert.match(validateView({ type: 'form', id: 'ask', fields: [{ id: 'name', label: 'Name' }, { id: 'name', label: 'Again' }] }).error, /duplicate field id "name"/)
  // A field id may match the form's own id: the two namespaces are separate.
  assert.equal(validateView({ type: 'form', id: 'name', fields: [{ id: 'name', label: 'Name' }] }).ok, true)

  let deep = text()
  for (let level = 1; level < 8; level += 1) deep = stack(deep)
  assert.equal(validateView(deep).ok, true)
  assert.match(validateView(stack(deep)).error, /9 levels exceeds the limit of 8/)

  assert.equal(validateView(nodes(64)).ok, true)
  assert.match(validateView(nodes(65)).error, /65 components exceeds the limit of 64/)

  const dup = stack(options('same'), confirm('same'))
  assert.match(validateView(dup).error, /view\.children\[1\]\.id: duplicate id "same"/)
  const many = stack(...Array.from({ length: 17 }, () => text()))
  assert.match(validateView(many).error, /expected 1 to 16 children; got 17/)

  // `__proto__` is no id, as a component or a field: the answer would write to a
  // plain object's prototype instead of its fields.
  assert.equal(validateView(options('__proto__')).error, 'view.id: "__proto__" cannot be an id')
  assert.equal(validateView(confirm('__proto__')).error, 'view.id: "__proto__" cannot be an id')
  assert.equal(validateView({ type: 'form', id: 'ask', fields: [{ id: '__proto__', label: 'Name' }] }).error, 'view.fields[0].id: "__proto__" cannot be an id')
})

test('checkShownView runs the call\'s own checks and names the card and its kind', () => {
  assert.deepEqual(checkShownView('  Status  ', text()), { title: 'Status', interactive: false })
  assert.deepEqual(checkShownView('Pick', options()), { title: 'Pick', interactive: true })
  assert.equal(checkShownView(' ', text()).error, 'Give the view a title.')
  assert.equal(checkShownView('Card', { type: 'nope' }).error, 'view.type: unknown component "nope"; allowed: stack, text, metric, table, options, confirm, form, progress')
  assert.equal(checkShownView('Card', undefined).error, 'view: expected a component object')
  const room = VIEW_BYTE_LIMIT - viewBytes('', text())
  assert.equal(checkShownView('x'.repeat(room + 1), text()).error, `The view is ${VIEW_BYTE_LIMIT + 1} bytes; the limit is ${VIEW_BYTE_LIMIT}.`)
  assert.equal(checkShownView('Card', { get type() { throw new Error('no') } }).error, 'The view is not JSON data.')
})

test('viewBytes counts the blueprint JSON plus the title in UTF-8', () => {
  const view = text('a')
  const title = '测'
  assert.equal(viewBytes(title, view), new TextEncoder().encode(`${JSON.stringify(view)}${title}`).length)
  assert.ok(viewBytes(title, view) > `${JSON.stringify(view)}${title}`.length)
  const room = VIEW_BYTE_LIMIT - viewBytes('', view)
  assert.equal(viewBytes('x'.repeat(room), view), VIEW_BYTE_LIMIT)
  assert.equal(viewBytes(`${'x'.repeat(room)}y`, view), VIEW_BYTE_LIMIT + 1)
})

test('viewSummary keeps a short list of component values', () => {
  const view = stack(metric(), options(), text(` ${'word '.repeat(30)}`))
  assert.equal(viewSummary(view), `metric: 进度=70%; options: A/B/C; text: ${'word '.repeat(30).trim()}`.slice(0, 'metric: 进度=70%; options: A/B/C; '.length) + viewSummary(view).split('; ')[2])
  const parts = viewSummary(view).split('; ')
  assert.equal(parts[0], 'metric: 进度=70%')
  assert.equal(parts[1], 'options: A/B/C')
  assert.ok(parts[2].length <= 40)
  assert.equal(parts[2].startsWith('text:'), true)
  const many = stack(...Array.from({ length: 9 }, (_, index) => metric(`m${index}`, '1')))
  assert.equal(viewSummary(many).split('; ').length, 8)
  assert.equal(viewSummary(stack(text('a'))).includes('stack'), false)
})

test('validateViewAnswer checks the submitted component and keeps the question-card selection rules', () => {
  const view = stack(options('pick'), options('many', { multi: true, id: 'many' }), confirm('go'), form())
  assert.deepEqual(validateViewAnswer(view, 'pick', { selected: ['Z', 'B', 'A'] }), { selected: ['B'] })
  assert.deepEqual(validateViewAnswer(view, 'many', { selected: ['A', 'A', 'C', 'nope'] }), { selected: ['A', 'C'] })
  assert.equal(validateViewAnswer(view, 'pick', { selected: [] }).error, 'values.selected: select at least one option')
  assert.equal(validateViewAnswer(view, 'pick', { selected: ['nope'] }).error, 'values.selected: select at least one option')
  assert.match(validateViewAnswer(view, 'pick', {}).error, /values\.selected: expected an array/)
  assert.deepEqual(validateViewAnswer(view, 'go', { confirmed: false }), { confirmed: false })
  assert.deepEqual(validateViewAnswer(view, 'go', { confirmed: true }), { confirmed: true })
  assert.match(validateViewAnswer(view, 'go', { confirmed: 'yes' }).error, /values\.confirmed: expected a boolean/)
  assert.deepEqual(validateViewAnswer(view, 'ask', { fields: {} }), { fields: {} })
  assert.deepEqual(validateViewAnswer(view, 'ask', { fields: { name: '', note: 'hi' } }), { fields: { name: '', note: 'hi' } })
  assert.match(validateViewAnswer(view, 'ask', { fields: { other: 'x' } }).error, /unknown field; allowed: name, note/)
  assert.match(validateViewAnswer(view, 'ask', { fields: { name: 'x'.repeat(2001) } }).error, /2001 characters exceeds the limit of 2000/)
  assert.match(validateViewAnswer(view, 'missing', { selected: ['A'] }).error, /no interactive component with id "missing"; allowed: pick, many, go, ask/)
  assert.match(validateViewAnswer(view, '', {}).error, /expected an interactive component id/)
})

// `count` component nodes, packed under the 16-child cap.
function nodes(count) {
  if (count === 1) return text('x')
  const rest = count - 1
  const width = Math.min(16, rest)
  const base = Math.floor(rest / width)
  const extra = rest % width
  const children = []
  for (let index = 0; index < width; index += 1) children.push(nodes(base + (index < extra ? 1 : 0)))
  return stack(...children)
}
