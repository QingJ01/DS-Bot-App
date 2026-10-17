// Team transfer: a backup of the team's own settings, and putting them back on another host.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// Enough of the dsh services for the roster to make Sessions: the same stand-in the roster
// tests use, so an import really creates Bots and groups.
function start(team, { models = [], held = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-transfer-'))
  if (team !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  // Another dsh holds the team: its lock file is fresh and names another host, so this one
  // only reads (store.js). Written before the plugin loads, as a real second host would find it.
  if (held) writeFileSync(join(home, 'state.lock'), JSON.stringify({ pid: 1, host: 'another-machine', token: 'held', since: Date.now() }))
  const ctx = fakeContext({ services: { permissionPresets: {
    catalog: () => ({ options: [{ value: 'workspace-write', name: 'workspace-write' }, { value: 'danger-full-access', name: 'danger-full-access' }], defaultPreset: 'workspace-write' }),
    resolve: name => ({ name }),
    set: () => {},
    get: name => ({ name }),
  } } })
  const workspaces = new Map()
  let sessions = 0
  Object.assign(ctx, {
    llm: {
      listProviders: () => (models.length > 0 ? [{ id: 'deepseek', name: 'DeepSeek' }] : []),
      listModels: async () => models.map(id => ({ id })),
      resolveModelInfo: async () => ({}),
    },
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup: () => {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop, home, ctx }
}

const team = () => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief-chat', name: 'Chief', role: 'Boss', capabilities: [], createdAt: 1, instructions: 'Run the team.' },
    writer: {
      id: 'writer', sessionId: 'writer-chat', name: 'Writer', role: 'Scribe', capabilities: [{ name: 'notes', kind: 'skill' }], createdAt: 2,
      instructions: 'Write it down.', color: 'blue', avatar: { shape: 'star' }, model: 'deepseek/m', permission: 'workspace-write',
      dailyTokens: 25_000,
      segments: [{ sessionId: 'writer-old', endedAt: 5 }],
    },
  },
  rooms: { room: { id: 'room', name: 'Crew', named: true, members: ['chief', 'writer'], sessions: { writer: 'room-writer' }, admin: 'chief', mode: 'everyone', notice: 'Be kind.', createdAt: 3 } },
  agents: {},
  exchanges: [{ id: 'e1', from: 'chief', to: 'writer', text: 'hi', role: 'request', time: 4 }],
  exchangeTurns: {},
  questions: {},
  revision: 1,
})

test('an export carries what the user wrote and nothing that belongs to this install', async () => {
  const host = start(team(), { models: ['m'] })
  try {
    const answer = await host.call('team-export', {})
    assert.equal(answer.ok, true)
    const { export: exported, path, folder } = answer.value
    assert.equal(exported.version, 1)
    assert.equal(folder, join(host.home, 'exports'))
    assert.ok(path.startsWith(folder))
    assert.ok(existsSync(path), 'the export is written where the team can find it')
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), exported)

    const writer = exported.bots.find(bot => bot.name === 'Writer')
    assert.deepEqual(writer, {
      name: 'Writer', role: 'Scribe', instructions: 'Write it down.', color: 'blue', avatar: { shape: 'star' },
      model: 'deepseek/m', permission: 'workspace-write', dailyTokens: 25_000, capabilities: ['notes'],
    })
    assert.deepEqual(exported.rooms, [{ name: 'Crew', members: ['Chief', 'Writer'], admin: 'Chief', mode: 'everyone', notice: 'Be kind.' }])
    // No Session id, no history, no exchange, no secret: this is a settings file.
    const text = JSON.stringify(exported)
    for (const mine of ['chief-chat', 'writer-chat', 'writer-old', 'room-writer', 'e1', 'segments', 'secret']) {
      assert.ok(!text.includes(mine), `${mine} must not travel`)
    }
  } finally {
    await host.stop()
  }
})

test('an import puts the Bots and the group on another host, with the same settings', async () => {
  const source = start(team(), { models: ['m'] })
  const target = start(undefined, { models: ['m'] })
  try {
    const exported = (await source.call('team-export', {})).value.export
    const answer = await target.call('team-import', { payload: exported })
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.value.bots.map(bot => bot.name), ['Chief', 'Writer'])
    assert.deepEqual(answer.value.rooms.map(room => room.name), ['Crew'])
    const back = (await target.call('team-export', {})).value.export
    assert.deepEqual(back.bots.map(bot => bot.name), ['Chief', 'Writer'])
    const writer = back.bots.find(bot => bot.name === 'Writer')
    assert.equal(writer.instructions, 'Write it down.')
    assert.equal(writer.role, 'Scribe')
    assert.equal(writer.model, 'deepseek/m')
    assert.equal(writer.dailyTokens, 25_000)
    assert.deepEqual(back.rooms, [{ name: 'Crew', members: ['Chief', 'Writer'], admin: 'Chief', mode: 'everyone', notice: 'Be kind.' }])
    // This stand-in host has no capability library, so the one capability the Bot carried is
    // reported and left out — the only thing a real host with that library would keep.
    assert.deepEqual(answer.value.notes, [{ what: 'bot', name: 'Writer', why: 'capability notes: No capability named notes.' }])
  } finally {
    await source.stop()
    await target.stop()
  }
})

test('the same file can be imported by name from the export folder', async () => {
  const source = start(team(), { models: ['m'] })
  const target = start(undefined, { models: ['m'] })
  try {
    const { path } = (await source.call('team-export', {})).value
    mkdirSync(join(target.home, 'exports'), { recursive: true })
    writeFileSync(join(target.home, 'exports', 'copy.json'), readFileSync(path))
    const answer = await target.call('team-import', { path: 'copy.json' })
    assert.equal(answer.ok, true)
    assert.equal(answer.value.bots.length, 2)
  } finally {
    await source.stop()
    await target.stop()
  }
})

test('a name already on the team is kept apart, and the Bot here is untouched', async () => {
  const host = start(team(), { models: ['m'] })
  try {
    const exported = (await host.call('team-export', {})).value.export
    const answer = await host.call('team-import', { payload: exported })
    assert.equal(answer.ok, true)
    const names = answer.value.bots.map(bot => bot.name)
    assert.deepEqual(names, ['Chief 2', 'Writer 2'])
    assert.ok(answer.value.notes.some(note => note.name === 'Writer' && /already here/.test(note.why)))
    const back = (await host.call('team-export', {})).value.export
    assert.deepEqual(back.bots.map(bot => bot.name), ['Chief', 'Writer', 'Chief 2', 'Writer 2'])
    assert.equal(back.bots.find(bot => bot.name === 'Writer').instructions, 'Write it down.', 'the Bot that was here keeps its own settings')
  } finally {
    await host.stop()
  }
})

test('a folder or a model this host does not have is reported, and the Bot still arrives', async () => {
  const host = start(undefined, { models: ['m'] })
  try {
    const payload = {
      version: 1,
      bots: [{ name: 'Guest', instructions: 'Be brief.', model: 'deepseek/ghost', workDir: join(tmpdir(), 'ds-bot-not-here-12345') }],
      rooms: [],
    }
    const answer = await host.call('team-import', { payload })
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.value.bots.map(bot => bot.name), ['Guest'])
    const reasons = answer.value.notes.map(note => note.why).join(' | ')
    assert.match(reasons, /model/)
    assert.match(reasons, /working folder/)
    const back = (await host.call('team-export', {})).value.export
    const guest = back.bots.find(bot => bot.name === 'Guest')
    assert.equal(guest.instructions, 'Be brief.')
    assert.equal(guest.model, undefined)
    assert.equal(guest.workDir, undefined)
  } finally {
    await host.stop()
  }
})

test('a group is made from the members this host has, and skipped when too few are here', async () => {
  const host = start(undefined, { models: ['m'] })
  try {
    const payload = {
      version: 1,
      bots: [{ name: 'Ada' }, { name: 'Bo' }],
      rooms: [
        { name: 'Mix', members: ['Ada', 'Bo', 'Ghost'], admin: 'Ghost', mode: 'everyone' },
        { name: 'Ghosts', members: ['Ghost', 'Nobody'], admin: null, mode: 'everyone' },
      ],
    }
    const answer = await host.call('team-import', { payload })
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.value.rooms.map(room => room.name), ['Mix'])
    assert.ok(answer.value.notes.some(note => note.name === 'Mix' && /Ghost is not on this team/.test(note.why)))
    assert.ok(answer.value.notes.some(note => note.name === 'Ghosts' && /fewer than two/.test(note.why)))
    const back = (await host.call('team-export', {})).value.export
    assert.deepEqual(back.rooms, [{ name: 'Mix', members: ['Ada', 'Bo'], admin: null, mode: 'everyone' }])
  } finally {
    await host.stop()
  }
})

test('an import refuses anything that is not a team export, and a path outside the folder', async () => {
  const host = start(team(), { models: ['m'] })
  try {
    const notAnExport = await host.call('team-import', { payload: { hello: 'world' } })
    assert.equal(notAnExport.ok, false)
    assert.match(notAnExport.error.message, /not a team export/)
    const futureVersion = await host.call('team-import', { payload: { version: 99, bots: [], rooms: [] } })
    assert.equal(futureVersion.ok, false)
    assert.match(futureVersion.error.message, /another version of DS Bot/)
    const outside = await host.call('team-import', { path: '../state.json' })
    assert.equal(outside.ok, false)
    assert.match(outside.error.message, /There is no export called state\.json/)
    const nowhere = await host.call('team-import', {})
    assert.equal(nowhere.ok, false)
    assert.match(nowhere.error.message, /Give the export file name/)
  } finally {
    await host.stop()
  }
})

test('a record without a name, or too many of them, is refused or skipped', async () => {
  const host = start(undefined, { models: ['m'] })
  try {
    const answer = await host.call('team-import', { payload: { version: 1, bots: [{ name: '  ' }, { name: 'Fine' }], rooms: [{ }] } })
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.value.bots.map(bot => bot.name), ['Fine'])
    assert.equal(answer.value.notes.length, 2)
    const flood = await host.call('team-import', { payload: { version: 1, bots: Array.from({ length: 201 }, (_, index) => ({ name: `Bot ${index}` })), rooms: [] } })
    assert.equal(flood.ok, false)
    assert.match(flood.error.message, /at most 200 Bots/)
  } finally {
    await host.stop()
  }
})

test('a watch-only host exports the team but cannot import one', async () => {
  const host = start(team(), { models: ['m'], held: true })
  try {
    const exported = await host.call('team-export', {})
    assert.equal(exported.ok, true, 'reading the team is always allowed')
    assert.equal(exported.value.export.bots.length, 2)
    const refused = await host.call('team-import', { payload: { version: 1, bots: [], rooms: [] } })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'bot/read-only')
  } finally {
    await host.stop()
  }
})
