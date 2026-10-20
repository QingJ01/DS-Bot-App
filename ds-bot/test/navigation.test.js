import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNavigation } from '../src/client/navigation.js'
import { createSource } from '../src/client/sources.js'

function fixture() {
  const list = createSource({ byId: { known: {} } })
  const opened = [], errors = []
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const sessions = { list, refresh: () => pending }
  const navigation = createNavigation({ sessions, open: id => opened.push(id), reportError: error => errors.push(error) })
  return { list, opened, errors, sessions, navigation, finish }
}

test('opening a fresh Bot waits for its catalog entry, while known sessions open immediately', async () => {
  const f = fixture()
  const pending = f.navigation.open('fresh')
  assert.deepEqual(f.opened, [])
  f.list.set({ byId: { fresh: {} } })
  f.finish()
  await pending
  assert.deepEqual(f.opened, ['fresh'])
  assert.deepEqual(f.errors, [])
  f.navigation.open('fresh')
  assert.deepEqual(f.opened, ['fresh', 'fresh'])
})

test('a delayed catalog response cannot undo the next user selection', async () => {
  const f = fixture()
  let stalePrepared = false
  const pending = f.navigation.open('fresh', () => { stalePrepared = true })
  await f.navigation.open('known')
  f.list.set({ byId: { fresh: {}, known: {} } })
  f.finish()
  await pending
  assert.deepEqual(f.opened, ['known'])
  assert.equal(stalePrepared, false)
})

test('missing or failed catalog loads report an error without opening an unknown session', async () => {
  const f = fixture()
  f.finish()
  await f.navigation.open('missing')
  assert.match(f.errors[0].message, /not available/u)
  f.sessions.refresh = async () => { throw new Error('offline') }
  await f.navigation.open('missing')
  assert.equal(f.errors[1].message, 'offline')
  assert.deepEqual(f.opened, [])
})

test('changing surface or disposing cancels pending navigation', async () => {
  for (const action of ['cancel', 'dispose']) {
    const f = fixture()
    const pending = f.navigation.open('fresh')
    f.navigation[action]()
    f.list.set({ byId: { fresh: {} } })
    f.finish()
    await pending
    assert.deepEqual(f.opened, [])
    assert.deepEqual(f.errors, [])
  }
})
