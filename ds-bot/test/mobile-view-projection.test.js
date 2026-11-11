import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateViewAnswer } from 'deep-view/core'
import { projectHistoricalView, projectPendingView } from '../src/mobile/view-projection.js'

const redact = text => text.replaceAll('SECRET', '[redacted]')
const unavailable = { type: 'confirm', id: 'SECRET' }

test('redacting a view answer or formula identity makes the blueprint unavailable', () => {
  const cases = [
    unavailable,
    { type: 'form', id: 'form', fields: [{ id: 'SECRET', label: 'Name' }] },
    { type: 'options', id: 'pick', options: [{ label: 'SECRET' }] },
    { type: 'choice', id: 'pick', label: 'Pick', options: [{ label: 'Private', value: 'SECRET' }], value: 'SECRET' },
    { type: 'choice', id: 'pick', label: 'Pick', options: [{ label: 'SECRET' }] },
    { type: 'stack', let: { SECRET: '2' }, children: [{ type: 'metric', label: 'Total', value: { '=': 'SECRET + 1' } }] },
  ]
  for (const view of cases) {
    const projected = projectPendingView('Card SECRET', view, redact)
    assert.deepEqual(projected, { title: 'Card [redacted]' })
    assert.doesNotMatch(JSON.stringify(projected), /SECRET/)
  }

  const expressionView = { type: 'stack', let: { answer: '2' }, children: [
    { type: 'metric', label: 'Total', value: { '=': 'answer + 1' } },
  ] }
  const expressionRedactor = text => text === 'answer + 1' ? '[redacted]' : text
  assert.deepEqual(projectPendingView('Card', expressionView, expressionRedactor), { title: 'Card' })

  const historical = projectHistoricalView({
    name: 'show_view',
    arguments: { title: 'Card SECRET', view: cases[3] },
  }, 'The view is on screen; the user\'s answer arrives as their next message.', redact)
  assert.deepEqual(historical, { title: 'Card [redacted]' })
  assert.doesNotMatch(JSON.stringify(historical), /SECRET/)
})

test('ordinary display redaction preserves answer semantics and sanitizer failures fall back safely', () => {
  const view = { type: 'stack', children: [
    { type: 'choice', id: 'pick', label: 'Pick SECRET', options: [
      { label: 'Private SECRET', value: 'stable' },
      { label: 'Other', value: 'other' },
    ], value: 'stable' },
    { type: 'options', id: 'choose', options: [{ label: 'A', description: 'SECRET details' }] },
    { type: 'form', id: 'form', fields: [{ id: 'name', label: 'Name SECRET' }] },
    { type: 'submit', id: 'send' },
  ] }
  const projected = projectPendingView('Card SECRET', view, redact)
  assert.ok(projected?.view)
  assert.doesNotMatch(JSON.stringify(projected), /SECRET/)
  assert.equal(validateViewAnswer(projected.view, 'send', { inputs: { pick: 'stable' } }).error, undefined)
  assert.equal(validateViewAnswer(projected.view, 'choose', { selected: ['A'], inputs: { pick: 'stable' } }).error, undefined)
  assert.equal(validateViewAnswer(projected.view, 'form', { fields: { name: 'Qing' }, inputs: { pick: 'stable' } }).error, undefined)

  assert.deepEqual(projectPendingView('Card', { type: 'choice', id: 'pick', label: 'Pick', options: [{ label: 'safe' }] }, () => {
    throw new Error('redactor unavailable')
  }), { title: '[redacted]' })
})

test('mobile projections keep only an HTML summary and retain chart data for native tables', () => {
  const html = projectPendingView('Report', {
    type: 'html',
    html: '<script>run()</script>',
    summary: 'A safe summary SECRET',
  }, redact)
  assert.equal(html.view.html, '<p>HTML view is unavailable on mobile.</p>')
  assert.equal(html.view.summary, 'A safe summary [redacted]')
  assert.doesNotMatch(JSON.stringify(html), /<script>|SECRET/)

  const chart = projectPendingView('Totals', {
    type: 'chart', kind: 'bar', categories: ['A', 'B'],
    series: [{ name: 'Count', values: [2, 3] }],
  })
  assert.deepEqual(chart.view, {
    type: 'chart', kind: 'bar', categories: ['A', 'B'],
    series: [{ name: 'Count', values: [2, 3] }],
  })
})
