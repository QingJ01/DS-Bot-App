import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { test } from 'node:test'
import { canonicalExecPath } from '../src/canonical-path.mjs'

test('an already-canonical path needs no relaunch', () => {
  assert.equal(canonicalExecPath('C:\\App\\bot.exe', () => 'C:\\App\\bot.exe'), undefined)
})

test('a short or linked path returns the canonical one', () => {
  assert.equal(canonicalExecPath('C:\\APPS~1\\bot.exe', () => 'C:\\App Data\\bot.exe'), 'C:\\App Data\\bot.exe')
})

test('a path that cannot be resolved keeps the caller going', () => {
  assert.equal(canonicalExecPath('X:\\gone\\bot.exe', () => { throw new Error('ENOENT') }), undefined)
})

test('the default realpath leaves the running exe alone', () => {
  assert.ok(canonicalExecPath(process.execPath) === undefined || canonicalExecPath(process.execPath) === realpathSync.native(process.execPath))
})
