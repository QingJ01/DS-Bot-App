import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/permissions.js'

const PRESETS = { 'workspace-write': {}, 'danger-full-access': {} }
const SESSION_ONLY = ['auto']

function runtime({ presets = true, auto = false, fail = false } = {}) {
  const writes = []
  const service = {
    catalog: () => ({ options: [...Object.keys(PRESETS), ...(auto ? SESSION_ONLY : [])].map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: 'workspace-write' }),
    resolve: (name) => { if (!(name in PRESETS) && !(auto && SESSION_ONLY.includes(name))) throw new Error(`permission: unknown preset "${name}"`); return PRESETS[name] },
    set: (session, name) => { if (fail) throw new Error('permission: rejected'); writes.push(`${session}=${name}`) },
  }
  const ctx = { get: name => (presets && name === 'permissionPresets' ? service : undefined) }
  const rt = {
    ctx,
    chatOf: id => `${id}-chat`,
    groupSessionsOf: id => [`${id}-group`],
    groupOwners: new Map(),
    roomOf: () => undefined,
    resolveAgent: async sessionId => ({ session: sessionId }),
    warn() {},
  }
  install(rt)
  return { rt, writes }
}

test('a Bot\'s preset is set on its chat and its group Sessions', async () => {
  const { rt, writes } = runtime()
  const bot = { id: 'b1', name: 'Ada' }
  await rt.setPermission(bot, 'danger-full-access')
  assert.equal(bot.permission, 'danger-full-access')
  assert.deepEqual(writes, ['b1-chat=danger-full-access', 'b1-group=danger-full-access'])
})

test('a fresh Session gets the Bot\'s preset, and a Bot without one keeps the default', async () => {
  const { rt, writes } = runtime()
  await rt.applyPermission({ id: 'b1' }, 'fresh')
  await rt.applyPermission({ id: 'b1', permission: 'workspace-write' }, 'fresh')
  assert.deepEqual(writes, ['fresh=workspace-write'])
})

test('a configured preset cannot be silently dropped or asynchronously rejected', async () => {
  const bot = { id: 'b1', permission: 'workspace-write' }
  await assert.rejects(runtime({ presets: false }).rt.applyPermission(bot, 'fresh'), /Permissions are not available/)
  const { rt } = runtime()
  rt.ctx.get('permissionPresets').set = async () => { throw new Error('write failed') }
  await assert.rejects(rt.applyPermission(bot, 'fresh'), /write failed/)
})

test('group permission changes and new Session registration serialize in either order', async () => {
  for (const updateFirst of [true, false]) {
    const { rt, writes } = runtime()
    const room = { permission: 'danger-full-access', sessions: { a: 'old-a' } }
    const bot = { id: 'b', name: 'B' }
    rt.botOf = id => ({ id, name: id })
    let enter, release
    const entered = new Promise(resolve => { enter = resolve })
    const gate = new Promise(resolve => { release = resolve })
    rt.resolveAgent = async session => {
      if (session === (updateFirst ? 'old-a' : 'new-b')) { enter(); await gate }
      return { session }
    }
    const register = () => rt.withPermissions(async () => {
      await rt.applyPermission(bot, 'new-b', room)
      room.sessions.b = 'new-b'
    })
    const update = () => rt.setRoomPermission(room, 'workspace-write')
    const first = updateFirst ? update() : register()
    await entered
    const second = updateFirst ? register() : update()
    release()
    await Promise.all([first, second])
    assert.equal(room.permission, 'workspace-write')
    assert.equal(writes.filter(write => write.startsWith('new-b=')).at(-1), 'new-b=workspace-write')
  }
})

test('an unknown preset is refused and the Bot keeps its own', async () => {
  const { rt, writes } = runtime()
  const bot = { id: 'b1', permission: 'workspace-write' }
  await assert.rejects(rt.setPermission(bot, 'everything'), /unknown preset/)
  assert.equal(bot.permission, 'workspace-write')
  assert.deepEqual(writes, [])
})

test('the catalog lists the presets DSH offers, or nothing without the presets service', () => {
  assert.deepEqual(runtime().rt.permissionCatalog(), { options: [{ value: 'workspace-write', name: 'workspace-write' }, { value: 'danger-full-access', name: 'danger-full-access' }], defaultPreset: 'workspace-write' })
  assert.equal(runtime({ presets: false }).rt.permissionCatalog(), undefined)
})

test('Auto review is not offered or kept as a Bot\'s preset', async () => {
  const { rt, writes } = runtime({ auto: true })
  assert.deepEqual(rt.permissionCatalog().options.map(option => option.value), ['workspace-write', 'danger-full-access'])
  const bot = { id: 'b1' }
  await assert.rejects(rt.setPermission(bot, 'auto'), /one Session only/)
  assert.equal(bot.permission, undefined)
  assert.deepEqual(writes, [])
})

test('a preset the Bot\'s own chat refuses is not kept', async () => {
  const { rt } = runtime({ fail: true })
  const bot = { id: 'b1', name: 'Ada', permission: 'workspace-write' }
  await assert.rejects(
    rt.setPermission(bot, 'danger-full-access'),
    error => error.message === 'Could not apply permissions to Ada in every conversation. Some may already have changed; retry the permission setting.'
      && error.cause?.message === 'permission: rejected',
  )
  assert.equal(bot.permission, 'workspace-write')
})

test('Bot permission changes wait for every eligible Session and can retry the same preset', async () => {
  const { rt } = runtime()
  const bot = { id: 'b1', name: 'Ada', permission: 'workspace-write' }
  rt.groupSessionsOf = () => ['b1-group', 'overridden-group']
  rt.groupOwners.set('overridden-group', { roomId: 'room-with-preset' })
  rt.roomOf = id => id === 'room-with-preset' ? { permission: 'workspace-write' } : undefined
  const attempts = []
  const failure = new Error('group unavailable')
  let failing = true
  rt.ctx.get('permissionPresets').set = async (session, name) => {
    attempts.push(`${session}=${name}`)
    if (session === 'b1-group' && failing) throw failure
  }
  const message = 'Could not apply permissions to Ada in every conversation. Some may already have changed; retry the permission setting.'
  await assert.rejects(rt.setPermission(bot, 'danger-full-access'), error => error.message === message && error.cause === failure)
  assert.equal(bot.permission, 'workspace-write')
  assert.deepEqual(attempts, ['b1-chat=danger-full-access', 'b1-group=danger-full-access'])

  failing = false
  await rt.setPermission(bot, 'danger-full-access')
  assert.equal(bot.permission, 'danger-full-access')
  assert.deepEqual(attempts, [
    'b1-chat=danger-full-access',
    'b1-group=danger-full-access',
    'b1-chat=danger-full-access',
    'b1-group=danger-full-access',
  ])
})

test('group permission resolution fails before changing any member and can be retried', async () => {
  const { rt, writes } = runtime()
  const room = { permission: 'danger-full-access', sessions: { a: 'a-group', b: 'b-group' } }
  rt.botOf = id => ({ id, name: id })
  let failing = true
  rt.resolveAgent = async session => {
    if (session === 'b-group' && failing) throw new Error('Session unavailable')
    return { session }
  }
  await assert.rejects(rt.setRoomPermission(room, 'workspace-write'), /Session unavailable/)
  assert.equal(room.permission, 'danger-full-access')
  assert.deepEqual(writes, [])
  failing = false
  assert.equal(await rt.setRoomPermission(room, 'workspace-write'), true)
  assert.equal(room.permission, 'workspace-write')
  assert.deepEqual(writes, ['a-group=workspace-write', 'b-group=workspace-write'])
})

test('partial group permission writes report failure and even the saved preset can be reapplied', async () => {
  const { rt } = runtime()
  const room = { permission: 'danger-full-access', sessions: { a: 'a-group', b: 'b-group' } }
  rt.botOf = id => ({ id, name: id, permission: 'workspace-write' })
  const applied = { 'a-group': 'danger-full-access', 'b-group': 'danger-full-access' }
  let failing = true
  rt.ctx.get('permissionPresets').set = async (session, name) => {
    if (session === 'b-group' && failing) throw new Error('write failed')
    applied[session] = name
  }
  await assert.rejects(rt.setRoomPermission(room, null), /Some members may already have changed/)
  assert.equal(room.permission, 'danger-full-access')
  assert.equal(applied['a-group'], 'workspace-write')
  assert.equal(applied['b-group'], 'danger-full-access')
  failing = false
  assert.equal(await rt.setRoomPermission(room, 'danger-full-access'), false)
  assert.deepEqual(applied, { 'a-group': 'danger-full-access', 'b-group': 'danger-full-access' })
  assert.equal(await rt.setRoomPermission(room, null), true)
  assert.equal(room.permission, undefined)
  assert.deepEqual(applied, { 'a-group': 'workspace-write', 'b-group': 'workspace-write' })
})
