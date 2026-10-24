import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inputsSummary, normalizeView, resolve, validateView, validateViewAnswer, viewScope, viewSummary } from '../src/shared/views.js'

const text = (value = 'hello') => ({ type: 'text', text: value })
const metric = (label = '进度', value = '70%') => ({ type: 'metric', label, value })
const options = (id = 'pick') => ({ type: 'options', id, options: [{ label: 'A' }, { label: 'B' }] })
const stack = (...children) => ({ type: 'stack', children })
const slider = (over = {}) => ({ type: 'slider', id: 'req', label: 'Requests a day', min: 100, max: 5000, step: 100, value: 1200, ...over })
const choice = (over = {}) => ({ type: 'choice', id: 'hit', label: 'Cache hits', options: [{ label: 'Low', value: 0.2 }, { label: 'Mid', value: 0.5 }], value: 0.5, ...over })
const calculator = () => ({
  type: 'stack',
  let: { tokens: 'req * 30 * 2000 / 1e6', cost: 'tokens * (1 - hit) * 2 + tokens * hit * 0.5' },
  children: [
    slider(), choice(), { type: 'toggle', id: 'cache', label: 'Use cache', value: true },
    { type: 'metric', label: 'Monthly cost', value: { '=': "'¥' + fixed(cost, 0)" }, tone: { '=': "cost > 100 ? 'bad' : 'good'" }, caption: { '=': 'format(tokens) + " M tokens"' } },
    { type: 'progress', label: 'Basic plan', value: { '=': 'cost' }, max: 100, valueLabel: { '=': "'¥' + fixed(100 - cost, 0) + ' left'" }, tone: { '=': "cost > 80 ? 'warn' : 'good'" } },
    { type: 'chart', kind: 'bar', categories: ['A', 'B'], series: [{ name: 'Cost', values: [{ '=': 'cost' }, 50] }], unit: '¥' },
    { type: 'submit', id: 'send', label: 'Send these numbers' },
  ],
})

test('validateView accepts the new components and keeps inputs out of the interactive kind', () => {
  const display = stack(
    { type: 'row', children: [metric(), metric('b', 2)] },
    { type: 'text', text: 'note', tone: 'muted' },
    { type: 'chart', categories: ['A', 'B'], series: [{ values: [1, 2] }] },
    { type: 'chart', kind: 'donut', categories: ['A', 'B'], series: [{ name: 'Share', values: [1, 2] }], unit: '%', caption: 'Sample data' },
    { type: 'progress', label: 'Used', value: 30, max: 120, valueLabel: '90 left', tone: 'warn' },
    { type: 'callout', text: 'Careful', tone: 'warn' },
    { type: 'sources', items: [{ label: 'Docs', url: 'https://example.com/a' }] },
    { type: 'html', html: '<canvas></canvas>', summary: 'A drawing', height: 200 },
  )
  assert.deepEqual(validateView(display), { ok: true, interactive: false })
  assert.deepEqual(validateView(stack(slider(), choice(), { type: 'number', id: 'n', label: 'N', value: 1 }, { type: 'toggle', id: 't', label: 'T' })), { ok: true, interactive: false })
  assert.deepEqual(validateView(calculator()), { ok: true, interactive: true })
  assert.deepEqual(validateView(stack(slider(), { type: 'submit', id: 'go' })), { ok: true, interactive: true })
})

test('validateView checks the new components with a path', () => {
  const chart = over => ({ type: 'chart', categories: ['A', 'B'], series: [{ values: [1, 2] }], ...over })
  assert.match(validateView(chart({ kind: 'pie' })).error, /view\.kind: unknown chart "pie"; allowed: bar, hbar, line, area, donut/)
  assert.match(validateView(chart({ categories: [] })).error, /view\.categories: expected a non-empty array/)
  assert.match(validateView(chart({ series: [{ values: [1] }] })).error, /view\.series\[0\]\.values: 1 values for 2 categories/)
  assert.match(validateView(chart({ series: [{ values: [1, 'x'] }] })).error, /view\.series\[0\]\.values\[1\]: expected a number/)
  assert.match(validateView(chart({ kind: 'donut', series: [{ values: [1, 2] }, { values: [3, 4] }] })).error, /a donut takes one series; got 2/)
  assert.match(validateView({ type: 'progress', label: 'x' }).error, /give percent \(0 to 100\), or value with max/)
  assert.match(validateView({ type: 'progress', percent: 10, value: 3, max: 4 }).error, /give percent/)
  assert.match(validateView({ type: 'progress', value: 3 }).error, /view\.max: expected a number with value/)
  assert.match(validateView({ type: 'callout', text: 'x', tone: 'loud' }).error, /unknown tone "loud"; allowed: info, good, warn, bad/)
  assert.match(validateView({ type: 'text', text: 'x', tone: 'loud' }).error, /unknown tone "loud"; allowed: muted/)
  assert.match(validateView({ type: 'sources', items: [{ label: 'x', url: 'javascript:alert(1)' }] }).error, /view\.items\[0\]\.url: expected an http\(s\) address/)
  assert.match(validateView({ type: 'html', html: '<b>x</b>' }).error, /view\.summary: expected one line/)
  assert.match(validateView(slider({ id: 'my-input' })).error, /an input id is letters, digits and _/)
  assert.match(validateView(slider({ id: 'true' })).error, /an input id is letters/)
  assert.match(validateView(slider({ min: undefined })).error, /a slider needs min and max/)
  assert.match(validateView(slider({ max: 50 })).error, /view\.max: expected more than min \(100\)/)
  assert.match(validateView(slider({ value: 9000 })).error, /view\.value: expected a number from 100 to 5000/)
  assert.match(validateView(choice({ value: 0.9 })).error, /view\.value: expected one of the options' values/)
  assert.match(validateView(choice({ options: [{ label: 'A', value: 1 }, { label: 'B', value: 1 }] })).error, /duplicate value 1/)
  assert.deepEqual(validateView(choice({ options: [{ label: 'A' }, { label: 'B' }], value: undefined })), { ok: true, interactive: false })
  assert.match(validateView({ type: 'toggle', id: 't', label: 'T', value: 'yes' }).error, /expected true or false/)
  assert.match(validateView(stack(slider(), choice({ id: 'req' }))).error, /view\.children\[1\]\.id: duplicate id "req"/)
  assert.match(validateView(stack({ type: 'stack', let: { a: '1' }, children: [text()] })).error, /view\.children\[0\]\.let: only the outermost component can define names/)
})

test('validateView checks formulas against the inputs as the Bot set them', () => {
  const around = (child, extra = {}) => ({ type: 'stack', ...extra, children: [slider(), child] })
  assert.match(validateView(around({ type: 'metric', label: 'x', value: { '=': 'nope * 2' } })).error, /view\.children\[1\]\.value: unknown name "nope"; known: req/)
  assert.match(validateView(around({ type: 'metric', label: 'x', value: { '=': 'req +' } })).error, /view\.children\[1\]\.value: the formula ends too early/)
  assert.match(validateView(around({ type: 'metric', label: 'x', value: 1, tone: { '=': "'red'" } })).error, /view\.children\[1\]\.tone: the formula gives "red"; expected one of good, warn, bad/)
  assert.match(validateView(around({ type: 'progress', percent: { '=': "'half'" } })).error, /view\.children\[1\]\.percent: the formula gives "half"; expected a number/)
  assert.match(validateView(around(text(), { let: { a: 'b', b: 'a' } })).error, /view\.let\.a: "[ab]" refers to itself/)
  assert.match(validateView(around(text(), { let: { req: '1' } })).error, /view\.let\.req: "req" is already an input id/)
  assert.match(validateView(around(text(), { let: { 'bad-name': '1' } })).error, /view\.let\.bad-name: a name is letters/)
  assert.match(validateView({ type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [[{ '=': 'x' }]] }).error, /view\.rows\[0\]\[0\]: unknown name "x"; known: \(none\)/)
  // A formula without inputs is still a formula.
  assert.deepEqual(validateView({ type: 'metric', label: 'x', value: { '=': '2 * 21' } }), { ok: true, interactive: false })
})

test('viewScope and resolve work the formulas out for the values the user set', () => {
  const view = calculator()
  const node = view.children[3]
  assert.equal(resolve(node.value, viewScope(view)), '¥90')
  assert.equal(resolve(node.tone, viewScope(view)), 'good')
  assert.equal(resolve(node.value, viewScope(view, { req: 2000 })), '¥150')
  assert.equal(resolve(node.tone, viewScope(view, { req: 2000 })), 'bad')
  assert.equal(resolve(node.value, viewScope(view, { hit: 0.2 })), '¥122')
  assert.equal(resolve('plain', viewScope(view)), 'plain')
  assert.equal(resolve({ '=': '1 +' }, viewScope(view), 'fallback'), 'fallback')
  assert.equal(resolve({ '=': 'pow(2, 3) + nope' }, viewScope(view), 'fallback'), 'fallback')
})

test('viewSummary shows inputs as set and formulas as worked out', () => {
  assert.equal(viewSummary(calculator()), [
    'slider: Requests a day=1200',
    'choice: Cache hits=Mid',
    'toggle: Use cache=on',
    'metric: Monthly cost=¥90',
    'progress: Basic plan 90%',
    'chart: A=90 ¥, B=50 ¥',
    'submit: Send these numbers',
  ].join('; '))
  const others = stack({ type: 'html', html: '<b>x</b>', summary: 'Seat map of hall B' }, { type: 'sources', items: [{ label: 'Docs', url: 'https://a.b' }] }, { type: 'callout', text: 'Mind the gap' })
  assert.equal(viewSummary(others), 'html: Seat map of hall B; sources: Docs; callout: Mind the gap')
  assert.equal(viewSummary({ type: 'row', children: [metric()] }), 'metric: 进度=70%')
})

test('validateViewAnswer carries every input with any answer and checks each value', () => {
  const view = calculator()
  assert.deepEqual(validateViewAnswer(view, 'send', { inputs: { req: 2000 } }), { inputs: { req: 2000, hit: 0.5, cache: true } })
  assert.deepEqual(validateViewAnswer(view, 'send', {}), { inputs: { req: 1200, hit: 0.5, cache: true } })
  assert.match(validateViewAnswer(view, 'send', { inputs: { req: 9000 } }).error, /values\.inputs\.req: expected a number from 100 to 5000/)
  assert.match(validateViewAnswer(view, 'send', { inputs: { req: '2000' } }).error, /values\.inputs\.req: expected a number/)
  assert.match(validateViewAnswer(view, 'send', { inputs: { hit: 0.9 } }).error, /values\.inputs\.hit: expected one of the options' values/)
  assert.match(validateViewAnswer(view, 'send', { inputs: { cache: 'yes' } }).error, /values\.inputs\.cache: expected true or false/)
  assert.match(validateViewAnswer(view, 'send', { inputs: { other: 1 } }).error, /values\.inputs\.other: unknown input; allowed: req, hit, cache/)
  assert.match(validateViewAnswer(view, 'send', { inputs: [] }).error, /values\.inputs: expected an object/)
  const mixed = stack(slider(), options('pick'))
  assert.deepEqual(validateViewAnswer(mixed, 'pick', { selected: ['A'], inputs: { req: 300 } }), { selected: ['A'], inputs: { req: 300 } })
  assert.match(validateViewAnswer(stack(options('pick')), 'pick', { selected: ['A'], inputs: {} }).error, /values\.inputs: this view has no inputs/)
  assert.equal(inputsSummary(view, { req: 2000, hit: 0.2, cache: false }), 'Requests a day=2000; Cache hits=Low; Use cache=off')
})

test('normalizeView coerces numeric strings on input and chart fields', () => {
  assert.deepEqual(normalizeView(slider({ min: '100', max: '5000', step: '100', value: '1200' })), slider())
  assert.deepEqual(normalizeView({ type: 'chart', categories: ['A'], series: [{ values: ['3', 'x'] }] }).series[0].values, [3, 'x'])
  assert.equal(Object.hasOwn(normalizeView(text()), 'value'), false, 'a field the Bot did not send stays absent')
})
