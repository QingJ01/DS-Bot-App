// The first-run import: a copy of the Bot team in the user's own DSH home. It only reads there.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { parseSessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { parse, stringify } from 'yaml'

// The rows of a profile patch that hold model settings: DeepSeek's API and account, other
// providers, the default model and the agent presets. Rows of other plugins may name plugins
// that the app does not have.
export const MODEL_ROWS = ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'agent-default-model', 'agent-preset-registry']
// The team's lock, its turns in flight and its workspace belong to the old home.
const LEFT_BEHIND = new Set(['state.lock', 'inflight.json', 'workspace'])
// Only user-authored skills cross hosts; mobile identity and authorization never do.
function copyBotFile(root, path) {
  const parts = relative(root, path).split(/[\\/]/u)
  if (LEFT_BEHIND.has(parts[0])) return false
  if (parts[0] !== 'mobile') return true
  return !lstatSync(path).isSymbolicLink() && (parts.length === 1 || (parts.length === 2 && parts[1] === 'skills.json'))
}
const LOCK_STALE_MS = 60_000

/** The DSH home of the user's own DSH, read as DSH reads DSH_HOME. */
export function userDshHome(env = process.env) {
  const value = env.DSH_HOME?.trim()
  if (!value) return join(homedir(), '.dsh')
  return resolve(value === '~' ? homedir() : /^~[\\/]/u.test(value) ? join(homedir(), value.slice(2)) : value)
}

export const within = (inner, outer) => {
  const path = relative(resolve(outer), resolve(inner))
  return path === '' || (!path.startsWith('..') && !path.startsWith(sep) && !/^[a-z]:/iu.test(path))
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** Every Session the team names: each Bot's and group's parts and the group conversations. */
export function sessionIdsOf(team) {
  const ids = segments => segments.map(part => part?.sessionId)
  return [...new Set([
    ...Object.values(team.bots ?? {}).flatMap(bot => [bot.id, bot.sessionId, ...ids(bot.segments ?? [])]),
    // A group keeps the earlier parts per member: { [botId]: segments }.
    ...Object.values(team.rooms ?? {}).flatMap(room => [...Object.values(room.sessions ?? {}), ...ids(Object.values(room.segments ?? {}).flat())]),
  ].filter(id => typeof id === 'string' && id !== ''))]
}

/**
 * The team in a DSH home, with the profiles that hold model settings.
 * @returns {{ from: string, team: any, bots: number, rooms: number, profiles: { name: string, rows: any[] }[] } | undefined}
 */
export function findTeam(from) {
  const statePath = join(from, 'bot', 'state.json')
  if (!existsSync(statePath)) return undefined
  const team = readJson(statePath)
  const bots = Object.keys(team.bots ?? {}).length
  if (bots === 0) return undefined
  return { from, team, bots, rooms: Object.keys(team.rooms ?? {}).length, profiles: modelProfiles(from) }
}

function modelProfiles(from) {
  const dir = join(from, 'profiles')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap((entry) => {
    const file = join(dir, entry.name, 'cordis.patch.yml')
    if (!existsSync(file)) return []
    let patch
    try {
      patch = parse(readFileSync(file, 'utf8'))
    } catch (error) {
      // An unreadable profile has no model settings to copy; the team is still there.
      console.warn(`DS Bot App: skipped the model settings in ${file}: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
    const rows = Array.isArray(patch) ? patch.filter(row => MODEL_ROWS.includes(row?.id)) : []
    return rows.length > 0 ? [{ name: entry.name, rows }] : []
  })
}

/** Whether a running DSH holds the team, as ds-bot's own lock tells (src/host/home-lock.js). */
export function teamInUse(from, { host = hostname(), now = Date.now() } = {}) {
  const path = join(from, 'bot', 'state.lock')
  if (!existsSync(path)) return false
  const fresh = now - statSync(path).mtimeMs < LOCK_STALE_MS
  let holder
  try {
    holder = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fresh
  }
  if (holder?.host !== host) return fresh
  try {
    process.kill(holder.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// sessions/<group>/<id>/: the group is the folder the Session works in.
function sessionDirs(from, ids) {
  const root = join(from, 'sessions')
  const groups = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : []
  const found = []
  const missing = []
  for (const id of ids) {
    const group = groups.find(name => existsSync(join(root, name, id)))
    if (group === undefined) missing.push(id)
    else found.push({ id, group })
  }
  return { found, missing }
}

const logVersion = name => parseSessionFormatLogFilename(name.replace(/\.(zstd|zst|gz|br)$/u, ''))

/** The Sessions whose log is in a newer format than the pinned DSH reads. */
export function newerSessions(from, team) {
  const { found } = sessionDirs(from, sessionIdsOf(team))
  return found.filter(({ id, group }) => readdirSync(join(from, 'sessions', group, id))
    .some(name => (logVersion(name) ?? 0) > sessionFormatCatalog.currentVersion)).map(({ id }) => id)
}

async function copyKey(from, to, name) {
  const source = join(from, name)
  if (!existsSync(source)) return false
  await cp(source, join(to, name))
  if (process.platform !== 'win32') await chmod(join(to, name), 0o600)
  return true
}

async function writeModelRows(to, rows) {
  const file = join(to, 'profiles', 'ds-bot', 'cordis.patch.yml')
  const current = existsSync(file) ? parse(await readFile(file, 'utf8')) : undefined
  const ids = new Set(rows.map(row => row.id))
  const kept = Array.isArray(current) ? current.filter(row => !ids.has(row?.id)) : []
  await mkdir(join(to, 'profiles', 'ds-bot'), { recursive: true })
  await writeFile(file, stringify([...kept, ...rows]))
}

/**
 * Copy the team of `from` into the data location `to`, which the Host has started on once,
 * so that DSH does not take the copied Sessions' folders for its own projects. The old team's
 * workspace files go into `workspace`, without replacing a file that is there.
 * Everything but the keys, the model settings and the workspace files is put together in a
 * folder beside the data and moved in at the end; a failure leaves that folder behind.
 * @param {{ from: string, to: string, workspace: string, profile?: string, dsh?: string }} options
 */
export async function importTeam({ from, to, workspace, profile, dsh }) {
  const found = findTeam(from)
  if (found === undefined) throw new Error(`There is no Bot team in ${from}`)
  const present = existsSync(join(to, 'bot', 'state.json')) ? readJson(join(to, 'bot', 'state.json')) : undefined
  if (Object.keys(present?.bots ?? {}).length > 0) throw new Error(`${to} already has a Bot team`)
  const stage = join(to, `.import-${String(Date.now())}`)
  const oldBot = join(from, 'bot')
  await cp(oldBot, join(stage, 'bot'), { recursive: true, filter: path => copyBotFile(oldBot, path) })
  const team = readJson(join(stage, 'bot', 'state.json'))
  // The new data location registers its own team workspace. A DSH Agent's Sessions do not move
  // to a fresh part, so they would go on working in the old team folder in the user's DSH home.
  delete team.workspaceId
  team.agents = {}
  await writeFile(join(stage, 'bot', 'state.json'), JSON.stringify(team, null, 2))
  const { found: sessions, missing } = sessionDirs(from, sessionIdsOf(found.team))
  for (const { id, group } of sessions) await cp(join(from, 'sessions', group, id), join(stage, 'sessions', group, id), { recursive: true })
  if (existsSync(join(from, 'attachments'))) await cp(join(from, 'attachments'), join(stage, 'attachments'), { recursive: true })

  await mkdir(workspace, { recursive: true })
  if (existsSync(join(oldBot, 'workspace'))) await cp(join(oldBot, 'workspace'), workspace, { recursive: true, force: false })
  const keys = []
  for (const name of ['.credentials.yaml', '.env']) if (await copyKey(from, to, name)) keys.push(name)
  const rows = found.profiles.find(entry => entry.name === profile)?.rows ?? []
  if (rows.length > 0) await writeModelRows(to, rows)

  await rm(join(to, 'bot'), { recursive: true, force: true })
  await rename(join(stage, 'bot'), join(to, 'bot'))
  for (const { id, group } of sessions) {
    await mkdir(join(to, 'sessions', group), { recursive: true })
    await rename(join(stage, 'sessions', group, id), join(to, 'sessions', group, id))
  }
  if (existsSync(join(stage, 'attachments'))) await cp(join(stage, 'attachments'), join(to, 'attachments'), { recursive: true, force: false })
  const summary = {
    from, at: new Date().toISOString(), ...(dsh ? { dsh } : {}),
    bots: found.bots, rooms: found.rooms, sessions: sessions.length, missingSessions: missing,
    keys, modelSettings: rows.length > 0 ? profile : null,
  }
  await writeFile(join(to, 'bot', 'imported.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await rm(stage, { recursive: true, force: true })
  return summary
}
