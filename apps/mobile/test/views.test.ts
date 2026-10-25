import test from 'node:test';
import assert from 'node:assert/strict';
import { readView, resolve, validateViewAnswer, viewScope, sideQuestion, sideRefusal } from '../src/logic/views.ts';

test('mobile cards share host validation, local formulas and answer constraints', () => {
  const card = readView({ title: 'Estimate', view: { type: 'stack', children: [
    { type: 'number', id: 'count', label: 'Count', value: 2, min: 0, max: 10 },
    { type: 'metric', label: 'Total', value: { '=': 'count * 3' } },
    { type: 'submit', id: 'send' },
  ] } });
  assert.ok(card);
  assert.equal(card.interactive, true);
  assert.equal(resolve({ '=': 'count * 3' }, viewScope(card.view, { count: 4 })), 12);
  assert.equal(validateViewAnswer(card.view, 'send', { inputs: { count: 4 } }).error, undefined);
  assert.match(validateViewAnswer(card.view, 'send', { inputs: { count: '' } }).error!, /number/);
  assert.match(validateViewAnswer(card.view, 'send', { inputs: { count: 11 } }).error!, /number/);
  assert.ok(validateViewAnswer(card.view, 'foreign', {}).error);
  assert.equal(readView({ view: { type: 'iframe', src: 'https://example.invalid' } }), null);
  assert.equal(readView({ view: { type: 'text', text: 'x'.repeat(9000) } }), null);
});

test('view confirmation, choice and form answers retain upstream semantics', () => {
  for (const [view, action, values] of [
    [{ type: 'confirm', id: 'decision' }, 'decision', { confirmed: false }],
    [{ type: 'options', id: 'pick', multi: true, options: [{ label: 'A' }, { label: 'B' }] }, 'pick', { selected: ['A', 'B'] }],
    [{ type: 'form', id: 'form', fields: [{ id: 'name', label: 'Name' }] }, 'form', { fields: { name: 'Qing' } }],
  ] as const) {
    const card = readView({ view });
    assert.ok(card);
    assert.equal(validateViewAnswer(card.view, action, values).error, undefined);
  }
});

test('side commands never silently turn into ordinary messages on unsupported surfaces', () => {
  assert.equal(sideQuestion(' /side\nExplain this '), 'Explain this');
  assert.equal(sideQuestion('/side'), '');
  assert.equal(sideQuestion('/sidechat ordinary text'), null);
  assert.equal(sideQuestion('/SIDE ordinary text'), null);
  assert.equal(sideRefusal('Explain', true, true, 0, 0), null);
  assert.match(sideRefusal('Explain', false, true, 0, 0)!, /private chat/);
  assert.match(sideRefusal('Explain', true, false, 0, 0)!, /Update/);
  assert.match(sideRefusal('Explain', true, true, 1, 0)!, /attachments/);
  assert.match(sideRefusal('Explain', true, true, 0, 1)!, /references/);
  assert.match(sideRefusal('', true, true, 0, 0)!, /question/);
});
