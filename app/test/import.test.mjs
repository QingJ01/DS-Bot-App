import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { parse } from 'yaml'
import { findTeam, importTeam, newerSessions, sessionIdsOf, teamInUse, userDshHome } from '../src/import.mjs'

const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

function treeHash(dir) {
  const hash = createHash('sha256')
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else hash.update(relative(dir, path)).update(readFileSync(path))
    }
  }
  walk(dir)
  return hash.digest('hex')
}

// A user's DSH home: Chief in two parts, Writer, a group where Chief is in two parts, the
// team's own files, two profiles and one that DSH cannot read.
const TEAM = {
  version: 1,
  workspaceId: 'w-old',
  mainBotIds: ['session-a'],
  bots: {
    'session-a': { id: 'session-a', name: 'Chief', sessionId: 'session-a2', segments: [{ sessionId: 'session-a' }] },
    'session-b': { id: 'session-b', name: 'Writer', workDir: '/projects/site' },
  },
  rooms: {
    r1: {
      id: 'r1', name: 'Ops', members: ['session-a', 'session-b'],
      sessions: { 'session-a': 'session-g', 'session-b': 'session-gone' },
      segments: { 'session-a': [{ sessionId: 'session-g0', endedAt: 1 }] },
    },
  },
  agents: { x: { id: 'x' } },
}
const TEAM_SESSIONS = [['--team--', 'session-a'], ['--team--', 'session-a2'], ['--team--', 'session-g'], ['--team--', 'session-g0'], ['--site--', 'session-b']]

function oldHome(root) {
  const from = join(root, 'dsh')
  write(join(from, 'bot', 'state.json'), JSON.stringify(TEAM))
  write(join(from, 'bot', 'state.lock'), '{}')
  write(join(from, 'bot', 'inflight.json'), '{}')
  write(join(from, 'bot', 'memory', 'session-a.md'), 'remember')
  write(join(from, 'bot', 'workspace', 'notes.txt'), 'old notes')
  write(join(from, 'bot', 'workspace', 'kept.txt'), 'old kept')
  for (const [group, id] of TEAM_SESSIONS) write(join(from, 'sessions', group, id, 'session.v4.jsonl.zstd'), id)
  write(join(from, 'sessions', '--team--', 'session-other', 'session.v4.jsonl.zstd'), 'not the team')
  write(join(from, 'attachments', 'ab', 'cdef'), 'file')
  write(join(from, '.credentials.yaml'), 'DEEPSEEK_API_KEY: fake\n')
  write(join(from, '.env'), 'X=1\n')
  write(join(from, 'profiles', 'desktop', 'cordis.patch.yml'), [
    '- id: llm-pi-ai', '  config:', '    providers:', '      moonshotai:', '        apiKeyEnv: MOONSHOTAI_API_KEY',
    '- id: agent-default-model', '  config:', '    model: deepseek-official/deepseek-flash',
    '- id: some-plugin', '  name: some-plugin', '',
  ].join('\n'))
  write(join(from, 'profiles', 'web', 'cordis.patch.yml'), '- id: some-plugin\n  name: some-plugin\n')
  write(join(from, 'profiles', 'broken', 'cordis.patch.yml'), '- id: llm-deepseek\n  config: [unclosed\n')
  return from
}

// The app's data location after the Host's first start, and the folder chosen for the Bots' files.
function newHome(root) {
  const to = join(root, 'ds-bot')
  write(join(to, 'bot', 'state.json'), JSON.stringify({ version: 1, mainBotIds: [], bots: {}, rooms: {} }))
  write(join(to, 'profiles', 'ds-bot', 'cordis.patch.yml'), '- id: llm-pi-ai\n  config:\n    providers: {}\n- id: webserver\n  config:\n    port: 0\n')
  const workspace = join(root, 'DS Bot App')
  write(join(workspace, 'kept.txt'), 'new kept')
  return { to, workspace }
}

describe('importTeam', () => {
  let root, from, to, workspace, oldTree, summary
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'ds-bot-app-import-'))
    from = oldHome(root);
    ({ to, workspace } = newHome(root))
    oldTree = treeHash(from)
    summary = await importTeam({ from, to, workspace, profile: 'desktop', dsh: '0.2.0-rc.2' })
  })
  after(() => { rmSync(root, { recursive: true, force: true }) })

  test('copies the team without its lock, its turns in flight, its workspace, its old workspace id or Agents', () => {
    const team = readJson(join(to, 'bot', 'state.json'))
    assert.deepEqual(Object.keys(team.bots), ['session-a', 'session-b'])
    assert.equal(team.workspaceId, undefined)
    assert.deepEqual(team.agents, {})
    assert.equal(readFileSync(join(to, 'bot', 'memory', 'session-a.md'), 'utf8'), 'remember')
    for (const name of ['state.lock', 'inflight.json', 'workspace']) assert.equal(existsSync(join(to, 'bot', name)), false, name)
  })

  test('copies every Session the team names into the same folder group, and only those', () => {
    for (const [group, id] of TEAM_SESSIONS) assert.equal(readFileSync(join(to, 'sessions', group, id, 'session.v4.jsonl.zstd'), 'utf8'), id)
    assert.equal(existsSync(join(to, 'sessions', '--team--', 'session-other')), false)
    assert.deepEqual(summary.missingSessions, ['session-gone'])
    assert.equal(summary.sessions, 5)
  })

  test('copies the attachments, the keys, and the model rows of the chosen profile', () => {
    assert.equal(readFileSync(join(to, 'attachments', 'ab', 'cdef'), 'utf8'), 'file')
    assert.equal(readFileSync(join(to, '.credentials.yaml'), 'utf8'), 'DEEPSEEK_API_KEY: fake\n')
    assert.equal(readFileSync(join(to, '.env'), 'utf8'), 'X=1\n')
    const patch = parse(readFileSync(join(to, 'profiles', 'ds-bot', 'cordis.patch.yml'), 'utf8'))
    assert.deepEqual(patch.map(row => row.id), ['webserver', 'llm-pi-ai', 'agent-default-model'])
    assert.deepEqual(patch[1].config.providers, { moonshotai: { apiKeyEnv: 'MOONSHOTAI_API_KEY' } })
  })

  test('puts the old workspace files in the chosen folder without replacing one that is there', () => {
    assert.equal(readFileSync(join(workspace, 'notes.txt'), 'utf8'), 'old notes')
    assert.equal(readFileSync(join(workspace, 'kept.txt'), 'utf8'), 'new kept')
  })

  test('records the import, leaves nothing staged and changes nothing in the old home', () => {
    const record = readJson(join(to, 'bot', 'imported.json'))
    assert.deepEqual({ ...record, at: undefined }, {
      from, at: undefined, dsh: '0.2.0-rc.2', bots: 2, rooms: 1, sessions: 5, missingSessions: ['session-gone'],
      keys: ['.credentials.yaml', '.env'], modelSettings: 'desktop',
    })
    assert.deepEqual(readdirSync(to).filter(name => name.startsWith('.import-')), [])
    assert.equal(treeHash(from), oldTree)
  })

  test('does not replace a team that is there', async () => {
    await assert.rejects(importTeam({ from, to, workspace }), /already has a Bot team/u)
  })
})

describe('finding the team', () => {
  let root, from
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ds-bot-app-find-'))
    from = oldHome(root)
  })
  after(() => { rmSync(root, { recursive: true, force: true }) })

  test('counts the Bots and groups and lists only the readable profiles with model settings', () => {
    const found = findTeam(from)
    assert.equal(found.bots, 2)
    assert.equal(found.rooms, 1)
    assert.deepEqual(found.profiles.map(entry => [entry.name, entry.rows.map(row => row.id)]), [['desktop', ['llm-pi-ai', 'agent-default-model']]])
    assert.equal(findTeam(join(root, 'none')), undefined)
  })

  test('names each Session of the team once', () => {
    assert.deepEqual(sessionIdsOf(TEAM), ['session-a', 'session-a2', 'session-b', 'session-g', 'session-gone', 'session-g0'])
  })

  test('finds Sessions written in a newer format than the pinned DSH reads', () => {
    assert.deepEqual(newerSessions(from, TEAM), [])
    write(join(from, 'sessions', '--site--', 'session-b', 'session.v99.jsonl.zstd'), 'newer')
    write(join(from, 'sessions', '--team--', 'session-g0', 'session.v99.jsonl.zstd'), 'newer')
    assert.deepEqual(newerSessions(from, TEAM), ['session-b', 'session-g0'])
  })

  test('takes the team for in use while a live process on this machine or a fresh lock elsewhere holds it', () => {
    const lock = join(from, 'bot', 'state.lock')
    write(lock, JSON.stringify({ pid: process.pid, host: 'here' }))
    assert.equal(teamInUse(from, { host: 'here' }), true)
    const ended = spawnSync(process.execPath, ['-e', '']).pid
    write(lock, JSON.stringify({ pid: ended, host: 'here' }))
    assert.equal(teamInUse(from, { host: 'here' }), false)
    write(lock, JSON.stringify({ pid: 1, host: 'elsewhere' }))
    assert.equal(teamInUse(from, { host: 'here' }), true)
    const old = new Date(Date.now() - 120_000)
    utimesSync(lock, old, old)
    assert.equal(teamInUse(from, { host: 'here' }), false)
  })

  test('reads DSH_HOME as DSH does', () => {
    assert.equal(userDshHome({}), join(homedir(), '.dsh'))
    assert.equal(userDshHome({ DSH_HOME: ' ' }), join(homedir(), '.dsh'))
    assert.equal(userDshHome({ DSH_HOME: '~/dsh-x' }), join(homedir(), 'dsh-x'))
  })
})
