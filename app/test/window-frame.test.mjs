import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cssColor, micaAvailable, nativeThemeSource } from '../src/window-frame.mjs'

test('Mica only on Windows 11 22H2 and later', () => {
  assert.equal(micaAvailable('win32', '10.0.22621'), true)
  assert.equal(micaAvailable('win32', '10.0.26100'), true)
  assert.equal(micaAvailable('win32', '10.0.22000'), false)
  assert.equal(micaAvailable('win32', '10.0.19045'), false)
  assert.equal(micaAvailable('darwin', '25.0.0'), false)
  assert.equal(micaAvailable('linux', '6.8.0'), false)
})

test('only plain CSS colors reach the caption buttons', () => {
  assert.equal(cssColor('rgba(252, 252, 252, 1)'), true)
  assert.equal(cssColor('rgb(20, 20, 20)'), true)
  assert.equal(cssColor('#f9fafb'), true)
  assert.equal(cssColor('red'), false)
  assert.equal(cssColor('url(x)'), false)
  assert.equal(cssColor(7), false)
})

test('a theme id does not reach the native theme', () => {
  assert.equal(nativeThemeSource('dark'), 'dark')
  assert.equal(nativeThemeSource('system'), 'system')
  assert.equal(nativeThemeSource('moonlight'), undefined)
  assert.equal(nativeThemeSource(null), undefined)
})
