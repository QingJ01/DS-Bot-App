import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBotBrowsers } from '../src/client/bot-browsers.js'
import { noteLeft, setUnread, sharedMap, toggleReaction } from '../src/client/shared-map.js'
import { STORAGE } from '../src/client/storage.js'

// One browser storage that two windows (tabs of DSH Web, or Desktop windows) share.
function sharedStorage() {
  const items = new Map()
  return {
    items,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, String(value)) },
    removeItem: (key) => { items.delete(key) },
  }
}
// A window as index.js keeps one: a copy read at load, updated by its own changes.
function windowOn(storage, key) {
  const store = sharedMap(key, storage)
  let copy = store.read()
  return { change: (edit) => { copy = store.update(edit, copy); return copy }, get copy() { return copy } }
}

// #215: each window wrote its whole copy back, so the window that wrote last erased what
// the others had saved since it loaded.
test('reactions made in two windows are both kept, and one taken back leaves the other', () => {
  const storage = sharedStorage()
  const a = windowOn(storage, STORAGE.reactions)
  const b = windowOn(storage, STORAGE.reactions)
  a.change(saved => toggleReaction(saved, 'writer:3:step3', 0, '👍'))
  b.change(saved => toggleReaction(saved, 'writer:4:step4', 1, '❤️'))
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.reactions)), { 'writer:3:step3': { 0: ['👍'] }, 'writer:4:step4': { 1: ['❤️'] } })
  // A window learns of the other's change through the storage event and reads again.
  assert.deepEqual(sharedMap(STORAGE.reactions, storage).read(a.copy), JSON.parse(storage.getItem(STORAGE.reactions)))
  a.change(saved => toggleReaction(saved, 'writer:3:step3', 0, '👍'))
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.reactions)), { 'writer:4:step4': { 1: ['❤️'] } })
})

test('unread marks set in two windows are both kept', () => {
  const storage = sharedStorage()
  const a = windowOn(storage, STORAGE.unread)
  const b = windowOn(storage, STORAGE.unread)
  a.change(marks => setUnread(marks, 'viewer', true))
  b.change(marks => setUnread(marks, 'umber', true))
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.unread)), { viewer: true, umber: true })
  b.change(marks => setUnread(marks, 'viewer', false))
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.unread)), { umber: true })
})

test('a window that closes with an old copy does not move a visit time back', () => {
  const storage = sharedStorage()
  const a = windowOn(storage, STORAGE.seen)
  a.change(seen => noteLeft(seen, ['writer', 'coder'], 100))
  const b = windowOn(storage, STORAGE.seen)
  b.change(seen => noteLeft(seen, ['writer'], 300))
  // A closes later, but its clock read is older than B's.
  a.change(seen => noteLeft(seen, ['writer', 'coder'], 250))
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.seen)), { writer: 300, coder: 250 })
})

test('storage that cannot be read leaves the window its own copy, and nothing unchanged is written', () => {
  const storage = sharedStorage()
  const store = sharedMap(STORAGE.unread, { ...storage, getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
  assert.deepEqual(store.update(marks => setUnread(marks, 'umber', true), { viewer: true }), { viewer: true, umber: true })
  assert.deepEqual(sharedMap(STORAGE.unread, undefined).read({ viewer: true }), { viewer: true })
  storage.setItem(STORAGE.unread, 'not json')
  assert.deepEqual(sharedMap(STORAGE.unread, storage).read({ kept: true }), { kept: true })

  let writes = 0
  const counted = sharedMap(STORAGE.unread, { ...storage, getItem: () => '{"umber":true}', setItem: () => { writes += 1 } })
  counted.update(marks => setUnread(marks, 'umber', true))
  assert.equal(writes, 0)
})

test('Bot browser tabs saved by two windows are both kept', () => {
  const storage = sharedStorage()
  const createSource = (initial) => {
    let value = initial
    return { getSnapshot: () => value, set: (next) => { value = typeof next === 'function' ? next(value) : next }, subscribe: () => () => {} }
  }
  const open = () => createBotBrowsers({ bridge: {}, createSource, storage, document: { body: { append() {} }, createElement: () => ({ style: {}, append() {}, remove() {} }) } })
  const first = open()
  const second = open()
  first.openTab('writer')
  second.openTab('coder')
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(STORAGE.browsers))).sort(), ['coder', 'writer'])
})
