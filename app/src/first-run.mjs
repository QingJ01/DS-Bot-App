// The first start: where the app keeps its data and the Bots' files, and whether it copies the
// Bot team of the user's own DSH. The answers are kept in the app's own data.
import { app, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { findTeam, newerSessions, teamInUse, userDshHome, within } from './import.mjs'

const TEXT = {
  en: {
    welcome: 'Welcome to DS Bot App',
    places: (data, workspace) => `Data: ${data}\nFiles that Bots make: ${workspace}`,
    start: 'Start', change: 'Change…',
    pickData: 'Folder for DS Bot App data', pickWorkspace: 'Folder for files that Bots make',
    dataInWorkspace: 'The data folder cannot be inside the folder for Bot files.',
    workspaceInData: 'The folder for Bot files cannot be inside the data folder.',
    inDsh: home => `Choose a folder outside the DeepSeek Harness data (${home}).`,
    inProgram: 'Choose a folder outside the program folder: uninstalling removes it.',
    found: (bots, rooms) => `DeepSeek Harness has a Bot team: ${bots} Bot${bots === 1 ? '' : 's'}${rooms > 0 ? `, ${rooms} group${rooms === 1 ? '' : 's'}` : ''}. Copy it into DS Bot App?`,
    foundDetail: home => `The copy takes the Bots, groups, memories, chats, files, keys and model settings. Mobile authorization and TLS identity are not copied: mobile access starts disabled and phones must pair again. Nothing in ${home} changes, and the two teams do not stay in step.`,
    copy: 'Copy', skip: 'Do not copy',
    inUse: 'DeepSeek Harness is using this team. Close it, then try again.', retry: 'Try again',
    newer: count => `${count} chat${count === 1 ? ' was' : 's were'} written by a newer DeepSeek Harness than this DS Bot App can read. Update DS Bot App, then start it again to copy the team.`,
    quit: 'Quit', startEmpty: 'Start without the team',
    whichModels: 'Which model settings should DS Bot App use?',
    failed: message => `The team could not be copied: ${message}\n\nDS Bot App starts with a new team. The team in DeepSeek Harness is unchanged.`,
    notStarted: 'DS Bot App could not start.',
  },
  zh: {
    welcome: '欢迎使用 DS Bot App',
    places: (data, workspace) => `数据：${data}\nBot 写出的文件：${workspace}`,
    start: '开始使用', change: '更改位置…',
    pickData: '选择 DS Bot App 的数据文件夹', pickWorkspace: '选择 Bot 写出的文件放在哪个文件夹',
    dataInWorkspace: '数据文件夹不能放在 Bot 文件夹里面。',
    workspaceInData: 'Bot 文件夹不能放在数据文件夹里面。',
    inDsh: home => `请选择 DeepSeek Harness 数据（${home}）以外的文件夹。`,
    inProgram: '请选择程序文件夹以外的位置：卸载时会删掉程序文件夹。',
    found: (bots, rooms) => `DeepSeek Harness 里有一个 Bot 团队：${bots} 个 Bot${rooms > 0 ? `、${rooms} 个群` : ''}。要复制到 DS Bot App 吗？`,
    foundDetail: home => `会复制 Bot、群、记忆、对话、文件、密钥和模型设置。不复制手机授权和 TLS 身份：手机入口默认关闭，需要重新启用并配对。${home} 里的内容不会改变；复制以后两个团队各自独立。`,
    copy: '复制', skip: '不复制',
    inUse: 'DeepSeek Harness 正在使用这个团队。请先关掉它，再重试。', retry: '重试',
    newer: count => `有 ${count} 段对话是更新版本的 DeepSeek Harness 写的，这个版本的 DS Bot App 读不了。请先更新 DS Bot App，再打开它来复制团队。`,
    quit: '退出', startEmpty: '不带团队开始',
    whichModels: 'DS Bot App 用哪一份模型设置？',
    failed: message => `团队没有复制成功：${message}\n\nDS Bot App 会用一个新团队开始。DeepSeek Harness 里的团队没有变化。`,
    notStarted: 'DS Bot App 没能启动。',
  },
}
export const localeText = table => (app.getLocale().toLowerCase().startsWith('zh') ? table.zh : table.en)
export const text = () => localeText(TEXT)

const PROFILE_NAMES = { desktop: 'DSH Desktop', web: 'DSH Web' }
const ask = options => dialog.showMessageBoxSync({ title: 'DS Bot App', noLink: true, ...options })

function pick(title, current) {
  const picked = dialog.showOpenDialogSync({ title, defaultPath: existsSync(current) ? current : dirname(current), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
  return picked?.[0] ?? current
}

function placeProblem(t, dataDir, workspace) {
  const dsh = userDshHome()
  const program = dirname(app.getPath('exe'))
  if (within(dataDir, workspace)) return t.dataInWorkspace
  if (within(workspace, dataDir)) return t.workspaceInData
  for (const path of [dataDir, workspace]) {
    if (within(path, dsh) || within(dsh, path)) return t.inDsh(dsh)
    if (app.isPackaged && within(path, program)) return t.inProgram
  }
  return undefined
}

function hasTeam(dataDir) {
  try {
    return Object.keys(JSON.parse(readFileSync(join(dataDir, 'bot', 'state.json'), 'utf8')).bots ?? {}).length > 0
  } catch {
    return false
  }
}

function offerImport(t, dataDir) {
  const from = userDshHome()
  let found
  try {
    found = hasTeam(dataDir) ? undefined : findTeam(from)
  } catch (error) {
    console.error(error)
  }
  if (found === undefined) return undefined
  if (ask({ type: 'question', message: t.found(found.bots, found.rooms), detail: t.foundDetail(from), buttons: [t.copy, t.skip], defaultId: 0, cancelId: 1 }) === 1) return undefined
  while (teamInUse(from)) {
    if (ask({ type: 'warning', message: t.inUse, buttons: [t.retry, t.skip], defaultId: 0, cancelId: 1 }) === 1) return undefined
  }
  const newer = newerSessions(from, found.team)
  if (newer.length > 0) {
    if (ask({ type: 'warning', message: t.newer(newer.length), buttons: [t.quit, t.startEmpty], defaultId: 0, cancelId: 0 }) === 0) return { quit: true }
    return undefined
  }
  const { profiles } = found
  const profile = profiles.length < 2 ? profiles[0]?.name
    : profiles[ask({ type: 'question', message: t.whichModels, buttons: profiles.map(entry => PROFILE_NAMES[entry.name] ?? entry.name), defaultId: 0, cancelId: 0 })].name
  return { from, profile }
}

/**
 * Where the app keeps its data and the Bots' files, asked at the first start.
 * A run on throwaway folders (DS_BOT_HOME, for development and tests) asks nothing and copies nothing.
 * @returns {{ dataDir: string, workspace?: string, import?: { from: string, profile?: string }, quit?: true }}
 */
export function chooseLocations() {
  if (process.env.DS_BOT_HOME) return { dataDir: process.env.DS_BOT_HOME, workspace: process.env.DS_BOT_WORKSPACE || undefined }
  const file = join(app.getPath('userData'), 'locations.json')
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    return { dataDir: saved.dataDir, workspace: saved.workspace }
  }
  const t = text()
  let dataDir = join(homedir(), '.ds-bot-app')
  let workspace = join(homedir(), 'DS Bot App')
  for (;;) {
    const choice = ask({ type: 'info', message: t.welcome, detail: t.places(dataDir, workspace), buttons: [t.start, t.change], defaultId: 0, cancelId: 0 })
    if (choice === 1) {
      dataDir = pick(t.pickData, dataDir)
      workspace = pick(t.pickWorkspace, workspace)
      continue
    }
    const problem = placeProblem(t, dataDir, workspace)
    if (problem === undefined) break
    ask({ type: 'warning', message: problem, buttons: ['OK'] })
  }
  const imported = offerImport(t, dataDir)
  if (imported?.quit) return { dataDir, workspace, quit: true }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ dataDir, workspace }, null, 2)}\n`)
  return { dataDir, workspace, ...(imported ? { import: imported } : {}) }
}
