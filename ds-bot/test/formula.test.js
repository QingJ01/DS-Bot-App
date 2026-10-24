import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileFormula, createScope, evaluate, show } from '../src/shared/formula.js'

const run = (source, inputs = {}, lets = {}) => {
  const compiled = compileFormula(source)
  if (compiled.error !== undefined) return compiled
  const trees = new Map(Object.entries(lets).map(([name, text]) => [name, compileFormula(text).tree]))
  return evaluate(compiled.tree, createScope(new Map(Object.entries(inputs)), trees))
}
const value = (...args) => run(...args).value

test('formulas do arithmetic, comparisons and conditions with the usual precedence', () => {
  assert.equal(value('1 + 2 * 3'), 7)
  assert.equal(value('(1 + 2) * 3'), 9)
  assert.equal(value('-2 ** 2'.replace('**', '*')), -4)
  assert.equal(value('10 % 4 + 1e3 / 4'), 252)
  assert.equal(value('.5 + 1.5'), 2)
  assert.equal(value('3 > 2 && 2 >= 2'), true)
  assert.equal(value('1 == 2 || !false'), true)
  assert.equal(value('x > 100 ? "bad" : x > 80 ? "warn" : "good"', { x: 90 }), 'warn')
  assert.equal(value('0 && boom'), false, 'the right side of && is not worked out when the left is false')
  assert.equal(value("'¥' + 3"), '¥3')
  assert.equal(value('0.1 + 0.2 + ""'), '0.3', 'text drops float noise')
  assert.equal(value('"2" * 3'), 6)
})

test('formulas call the fixed functions and format numbers', () => {
  assert.equal(value('min(3, 1, 2) + max(4, 5)'), 6)
  assert.equal(value('clamp(12, 0, 10)'), 10)
  assert.equal(value('round(2.345, 2)'), 2.35)
  assert.equal(value('round(2.5)'), 3)
  assert.equal(value('floor(2.9) + ceil(2.1) + abs(-1)'), 6)
  assert.equal(value('sqrt(16) + pow(2, 3)'), 12)
  assert.equal(value('fixed(3.14159, 2)'), '3.14')
  assert.equal(value('format(1234567.891, 1)'), '1,234,567.9')
  assert.equal(value('format(-1234)'), '-1,234')
  assert.equal(value('percent(0.4321, 1)'), '43.2%')
  assert.match(run('fixed(1, 11)').error, /digits must be a whole number from 0 to 10/)
  assert.match(run('round(1, 2, 3)').error, /round\(\) takes 1 or 2 arguments; got 3/)
  assert.match(run('clamp(1)').error, /clamp\(\) takes 3 arguments; got 1/)
  assert.match(run('min()').error, /min\(\) takes at least 1 argument/)
})

test('formulas read inputs and let names, and catch cycles and unknown names', () => {
  assert.equal(value('cost * 2', { req: 10 }, { cost: 'req * 3' }), 60)
  assert.match(run('a', {}, { a: 'b + 1', b: 'a + 1' }).error, /refers to itself/)
  assert.match(run('nope').error, /unknown name "nope"/)
  assert.deepEqual(compileFormula('price * qty + tax(1)').error, 'unknown function "tax"; allowed: min, max, abs, floor, ceil, sqrt, pow, round, clamp, fixed, format, percent')
  assert.deepEqual(compileFormula('price * qty + total').names, ['price', 'qty', 'total'])
})

test('formulas cannot reach the page: no property access, no prototype names, no code', () => {
  assert.match(compileFormula('constructor.constructor("x")()').error, /unexpected "\."/)
  assert.match(compileFormula('constructor("x")').error, /unknown function "constructor"/)
  assert.match(compileFormula('toString()').error, /unknown function "toString"/)
  assert.match(run('constructor').error, /unknown name "constructor"/)
  assert.match(run('__proto__').error, /unknown name "__proto__"/)
  assert.match(compileFormula('a = 1').error, /unexpected "="/)
  assert.match(compileFormula('x[0]').error, /unexpected "\["/)
  assert.match(compileFormula('`x`').error, /unexpected "`"/)
})

test('formulas report syntax errors with a position and refuse deep nesting', () => {
  assert.equal(compileFormula('').error, 'the formula is empty')
  assert.equal(compileFormula('1 +').error, 'the formula ends too early')
  assert.equal(compileFormula('(1 + 2').error, 'expected ")" at the end')
  assert.equal(compileFormula('1 2').error, 'unexpected "2" at 3')
  assert.equal(compileFormula('"open').error, 'unclosed string at 1')
  assert.equal(compileFormula('a ? b').error, 'expected ":" at the end')
  assert.equal(compileFormula(3).error, 'expected a formula string')
  assert.match(compileFormula(`${'('.repeat(80)}1${')'.repeat(80)}`).error, /nested more than 64 levels/)
  assert.match(compileFormula(`${'-'.repeat(80)}1`).error, /nested more than 64 levels/)
  assert.equal(compileFormula(`${'('.repeat(30)}1${')'.repeat(30)}`).error, undefined)
})

test('a value as text', () => {
  assert.equal(show(0.1 + 0.2), '0.3')
  assert.equal(show(Infinity), 'Infinity')
  assert.equal(show(true), 'true')
  assert.equal(show('x'), 'x')
})
