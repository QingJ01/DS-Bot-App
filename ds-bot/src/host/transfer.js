// Team transfer: a backup of the team's own settings, and putting them back on another host.
//
// What travels is what the user wrote: each Bot's name, role, instructions, look, model,
// effort, permission, folder, capabilities, daily budget and approval rules, and each group's
// name, members, admin, reply mode, notice, folder and permission. What does not travel is
// everything that belongs to this DSH install: Session ids and conversation history, the
// exchanges between Bots, the questions a Session answered, secrets, and the memory files'
// own history. A Bot that arrives is a Bot with the same settings and a fresh conversation —
// which is what a careful setup is worth backing up for.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const EXPORT_VERSION = 1
const MAX_BOTS = 200
const MAX_ROOMS = 100
const FOLDER = 'exports'

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

const textOf = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : undefined)

export function install(rt) {
  const { home, state } = rt
  const dir = join(home, FOLDER)

  const botRecord = (bot) => ({
    name: bot.name,
    ...(bot.role ? { role: bot.role } : {}),
    ...(bot.instructions ? { instructions: textOf(bot.instructions, 20_000) } : {}),
    ...(bot.color ? { color: bot.color } : {}),
    ...(bot.avatar ? { avatar: bot.avatar } : {}),
    ...(bot.model ? { model: bot.model } : {}),
    ...(bot.effort ? { effort: bot.effort } : {}),
    ...(bot.permission ? { permission: bot.permission } : {}),
    ...(bot.workDir ? { workDir: bot.workDir } : {}),
    ...(bot.dailyTokens ? { dailyTokens: bot.dailyTokens } : {}),
    ...(Array.isArray(bot.capabilities) && bot.capabilities.length > 0 ? { capabilities: bot.capabilities.map(item => item.name) } : {}),
  })

  const nameOf = id => rt.botOf(id)?.name
  const roomRecord = (room) => ({
    name: room.name,
    members: room.members.map(nameOf).filter(Boolean),
    ...(room.admin ? { admin: nameOf(room.admin) ?? null } : { admin: null }),
    ...(room.mode ? { mode: room.mode } : {}),
    ...(room.notice ? { notice: room.notice } : {}),
    ...(room.workDir ? { workDir: room.workDir } : {}),
    ...(room.permission ? { permission: room.permission } : {}),
  })

  const snapshot = () => ({
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    bots: Object.values(state.bots).map(botRecord),
    rooms: Object.values(state.rooms).map(roomRecord),
  })

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

  async function exportTeam() {
    await rt.load()
    const exported = snapshot()
    const path = join(dir, `team-${stamp()}.json`)
    await mkdir(dir, { recursive: true })
    await writeFile(path, `${JSON.stringify(exported, null, 2)}\n`, 'utf8')
    return { export: exported, path, folder: dir }
  }

  // A name inside the export folder, and nothing else: an import must not be a way to read
  // any file the host can read.
  async function readExport(body) {
    if (body.payload !== undefined && body.payload !== null && typeof body.payload === 'object') return body.payload
    const wanted = typeof body.path === 'string' ? basename(body.path.trim()) : ''
    if (wanted === '' || wanted === '.' || wanted === '..') throw invalid('Give the export file name, or send the export itself')
    const names = await readdir(dir).catch(() => [])
    if (!names.includes(wanted)) throw invalid(`There is no export called ${wanted} in ${dir}`)
    let parsed
    try {
      parsed = JSON.parse(await readFile(join(dir, wanted), 'utf8'))
    } catch (error) {
      throw invalid(`The export ${wanted} could not be read: ${error?.message ?? error}`)
    }
    return parsed
  }

  const takenName = (base) => {
    const stem = String(base ?? '').trim().slice(0, 40) || 'Bot'
    if (!rt.findBot(stem)) return stem
    let index = 2
    while (rt.findBot(`${stem} ${index}`)) index += 1
    return `${stem} ${index}`
  }

  // One Bot. Settings the host does not have (a model it does not serve, a folder that is
  // not here) are left out with a note: a Bot that arrives without its model is still a Bot
  // the user can point at one, which beats a failed import.
  async function importBot(record, notes) {
    const name = takenName(record.name)
    if (name !== record.name) notes.push({ what: 'bot', name: record.name, why: `a Bot called ${record.name} is already here, so the imported one is ${name}` })
    const optional = async (label, run) => {
      try { return await run() } catch (error) {
        notes.push({ what: 'bot', name, why: `${label}: ${error?.message ?? error}` })
        return undefined
      }
    }
    const model = record.model === undefined ? undefined : await optional('model', () => rt.resolveModel(record.model))
    const bot = await rt.createBot({
      name,
      role: textOf(record.role, 24) ?? '',
      instructions: textOf(record.instructions, 20_000) ?? '',
      color: record.color,
      avatar: record.avatar,
      model,
      workDir: record.workDir === undefined ? undefined : await optional('working folder', () => rt.cleanWorkDir(record.workDir)),
      // A Bot whose model this host does not serve arrives waiting for one, as a Bot made
      // without a model does: the user picks, and nothing runs on a model they did not choose.
      pickModel: model === undefined,
    })
    if (record.effort !== undefined && bot.model !== undefined) {
      const effort = await optional('thinking level', () => rt.resolveEffort(bot.model, record.effort))
      if (effort !== undefined) {
        bot.effort = effort
        await rt.save()
      }
    }
    if (record.permission !== undefined) {
      await optional('permissions', () => rt.setPermission(bot, record.permission))
    }
    if (Number.isSafeInteger(record.dailyTokens) && record.dailyTokens > 0) {
      bot.dailyTokens = record.dailyTokens
      await rt.save()
    }
    for (const capability of Array.isArray(record.capabilities) ? record.capabilities : []) {
      await optional(`capability ${capability}`, () => rt.capabilityEndpoint('bot-capability', { botId: bot.id, name: capability, attached: true }))
    }
    return bot
  }

  // One group. A group needs two members that exist here: a member the team does not have
  // is reported and the group is made without it, and a group left with fewer than two is
  // skipped rather than failed.
  async function importRoom(record, byName, notes) {
    const members = []
    for (const name of Array.isArray(record.members) ? record.members : []) {
      const bot = byName.get(name) ?? rt.findBot(name)
      if (bot === undefined) {
        notes.push({ what: 'group', name: record.name, why: `${name} is not on this team, so the group is made without it` })
        continue
      }
      if (!members.includes(bot.id)) members.push(bot.id)
    }
    if (members.length < 2) {
      notes.push({ what: 'group', name: record.name, why: 'fewer than two of its members are on this team, so the group was not made' })
      return undefined
    }
    const admin = record.admin ? (byName.get(record.admin) ?? rt.findBot(record.admin)) : undefined
    const name = rt.findRooms(record.name).length > 0 ? `${record.name} (imported)` : record.name
    if (name !== record.name) notes.push({ what: 'group', name: record.name, why: `a group called ${record.name} is already here, so the imported one is ${name}` })
    const room = await rt.createRoom({
      members,
      name,
      notice: record.notice,
      mode: record.mode,
      ...(admin !== undefined && members.includes(admin.id) ? { admin: admin.id } : {}),
    })
    if (record.workDir !== undefined) {
      const workDir = await rt.cleanWorkDir(record.workDir).catch((error) => {
        notes.push({ what: 'group', name, why: `working folder: ${error?.message ?? error}` })
        return undefined
      })
      if (workDir !== undefined) {
        room.workDir = workDir
        await rt.save()
      }
    }
    if (record.permission !== undefined) {
      await rt.setRoomPermission(room, record.permission).catch(error => notes.push({ what: 'group', name, why: `permissions: ${error?.message ?? error}` }))
    }
    return room
  }

  async function importTeam(body = {}) {
    await rt.load()
    if (rt.readOnly?.() !== undefined) throw refused('Use the DSH host that owns this Bot team.')
    const payload = await readExport(body)
    if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.bots) || !Array.isArray(payload.rooms)) {
      throw invalid('That is not a team export: it needs a list of Bots and a list of groups')
    }
    if (payload.version !== undefined && payload.version !== EXPORT_VERSION) {
      throw invalid(`That export was written by another version of DS Bot (${payload.version}); this one reads version ${EXPORT_VERSION}`)
    }
    if (payload.bots.length > MAX_BOTS || payload.rooms.length > MAX_ROOMS) {
      throw invalid(`A team export holds at most ${MAX_BOTS} Bots and ${MAX_ROOMS} groups`)
    }
    const notes = []
    const byName = new Map()
    const bots = []
    for (const record of payload.bots) {
      if (record === null || typeof record !== 'object' || typeof record.name !== 'string' || record.name.trim() === '') {
        notes.push({ what: 'bot', name: '', why: 'a record without a name was skipped' })
        continue
      }
      try {
        const bot = await importBot(record, notes)
        byName.set(record.name, bot)
        bots.push({ id: bot.id, name: bot.name })
      } catch (error) {
        notes.push({ what: 'bot', name: record.name, why: error?.message ?? String(error) })
      }
    }
    const rooms = []
    for (const record of payload.rooms) {
      if (record === null || typeof record !== 'object' || typeof record.name !== 'string') {
        notes.push({ what: 'group', name: '', why: 'a record without a name was skipped' })
        continue
      }
      try {
        const room = await importRoom(record, byName, notes)
        if (room !== undefined) rooms.push({ id: room.id, name: room.name })
      } catch (error) {
        notes.push({ what: 'group', name: record.name, why: error?.message ?? String(error) })
      }
    }
    await rt.save()
    return { bots, rooms, notes, source: { exportedAt: textOf(payload.exportedAt, 40) ?? null, version: payload.version ?? EXPORT_VERSION } }
  }

  const transferEndpoint = async (endpoint, body = {}) => {
    await rt.load()
    if (endpoint === 'team-export') return exportTeam()
    if (endpoint === 'team-import') return importTeam(body)
    throw invalid(`Unknown transfer endpoint ${endpoint}`)
  }

  Object.assign(rt, { exportTeam, importTeam, transferEndpoint })
}
