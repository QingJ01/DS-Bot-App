import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readLegacyStorage, restoreLegacyStorage } from '../src/storage-migration.mjs'

function storage(entries = []) {
  const data = new Map(entries)
  return {
    get length() { return data.size },
    key: index => [...data.keys()][index],
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
}

test('copies conversation drafts and UI preferences, not authentication or unrelated data', () => {
  const entries = [
    ['dsh.conversation.session-one', JSON.stringify({ draft: '未发送 draft', view: null })],
    ['dsh.sessions.current', 'session-one'], ['ds-bot:seen', '{}'],
    ['dsh.sidebar-right.v1.session-one', '{}'],
  ]
  const source = storage([...entries, ['auth-token', 'synthetic'], ['dsh.auth', 'synthetic'], ['unrelated', 'value']])
  const target = storage()
  assert.deepEqual(readLegacyStorage(source), entries)
  restoreLegacyStorage(target, readLegacyStorage(source))
  for (const [key, value] of entries) assert.equal(target.getItem(key), value)
  assert.equal(source.length, 7)
  assert.equal(target.getItem('dsh.auth'), null)
})

test('keeps newer destination values and never resurrects a sent draft on retry', () => {
  const key = 'dsh.conversation.session-one'
  const target = storage([[key, JSON.stringify({ draft: '' })]])
  restoreLegacyStorage(target, [[key, 'old'], ['ds-bot:seen', '{}']])
  assert.equal(target.getItem(key), JSON.stringify({ draft: '' }))
  target.removeItem(key)
  restoreLegacyStorage(target, [[key, 'old']])
  assert.equal(target.getItem(key), null)
})

test('failed storage writes leave migration retryable', () => {
  const target = storage()
  const entries = [['dsh.sessions.current', 'one'], ['dsh.conversation.one', 'draft']]
  let writes = 0
  const interrupted = { ...target, setItem(key, value) {
    if (++writes === 2) throw new Error('quota')
    target.setItem(key, value)
  } }
  assert.throws(() => restoreLegacyStorage(interrupted, entries), /quota/u)
  assert.equal(target.getItem('ds-bot:legacy-storage-migrated-v1'), null)
  restoreLegacyStorage(target, entries)
  assert.equal(target.getItem('dsh.conversation.one'), 'draft')
  assert.equal(target.getItem('ds-bot:legacy-storage-migrated-v1'), '1')
})
