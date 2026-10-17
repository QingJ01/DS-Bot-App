// Run against an owned mock bench, after the ordinary desktop/mobile smoke tests.
// node dev/mobile-folders-smoke.mjs <bench-name> <web-port> <mobile-port>
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { MobileClient, MemoryTokenStore } from '../../packages/mobile-sdk/index.js'

const [name, webPort, mobilePort] = process.argv.slice(2)
assert.match(name ?? '', /^[a-z0-9-]+$/)
for (const port of [webPort, mobilePort]) assert.ok(/^\d+$/.test(port ?? '') && Number(port) >= 1024 && Number(port) <= 65535 && Number(port) !== 3080)
assert.notEqual(webPort, mobilePort)
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const home = join(root, `.dsh-test-${name}`)
const log = await readFile(join(home, 'web.log'), 'utf8')
const login = log.match(new RegExp(`http://127\\.0\\.0\\.1:${webPort}/\\?token=[^\\s]+`))?.[0]
assert.ok(login, 'The isolated bench must provide a login route')
const response = await fetch(login, { redirect: 'manual' })
const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
async function desktop(endpoint, payload = {}) {
  const response = await fetch(`http://127.0.0.1:${webPort}/api/bot`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })
  const result = await response.json(); assert.equal(result.ok, true); return result.value
}
const operator = (endpoint, payload) => desktop('mobile', { endpoint, payload })
const mobile = new MobileClient({ baseUrl: `http://127.0.0.1:${mobilePort}`, tokenStore: new MemoryTokenStore(), allowInsecure: true })
// The host saves a folder as its real path; resolve it the same way so they agree.
const project = await realpath(await mkdtemp(join(tmpdir(), 'dsbot-mobile-folders-')))
let bot, room, device
let passed = 0
async function step(label, run) { await run(); passed++; console.log(`ok ${label}`) }
async function until(check) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('The host did not finish moving the conversation')
}
try {
  const code = await operator('pairing.create'), claim = await mobile.pair(code.code, 'Working folder smoke phone')
  await operator('pairing.approve', { requestId: claim.requestId })
  device = await mobile.completePairing(claim.claimToken)
  await step('folder discovery stays on the host without a native computer dialog', async () => {
    const folders = await mobile.action('folders'); assert.ok(Array.isArray(folders.folders)); assert.notEqual(folders.picker, 'native')
    if (folders.picker === 'browse') {
      const listing = await mobile.action('folder-list', { path: project }); assert.equal(listing.path, project); assert.ok(Array.isArray(listing.entries))
    }
  })
  bot = await mobile.action('create-bot', { name: `Folder phone ${Date.now()}`, workDir: project })
  await step('a phone-created Bot keeps its explicit working directory', async () => {
    assert.equal((await mobile.state()).bots.find(item => item.id === bot.id).workDir, project)
  })
  await step('guarded DSH data directories reject the whole update', async () => {
    await assert.rejects(mobile.action('update-bot', { id: bot.id, name: 'Should not be saved', workDir: home }), { status: 400 })
    const saved = (await mobile.state()).bots.find(item => item.id === bot.id); assert.equal(saved.name, bot.name); assert.equal(saved.workDir, project)
  })
  await step('resetting a folder creates a new part and retains the earlier conversation', async () => {
    const before = (await mobile.state()).bots.find(item => item.id === bot.id)
    await mobile.action('update-bot', { id: bot.id, workDir: '' })
    const after = await until(async () => { const item = (await mobile.state()).bots.find(item => item.id === bot.id); return item.sessionId !== before.sessionId ? item : undefined })
    assert.equal(after.workDir, undefined); assert.ok(after.parts.includes(before.sessionId))
  })
  await step('the phone sets and resets a group working folder', async () => {
    const team = await mobile.state(), chief = team.bots.find(item => item.id !== bot.id)
    room = await mobile.action('create-room', { name: 'Folder phone group', members: [chief.id, bot.id], admin: chief.id })
    await mobile.action('update-room', { id: room.id, workDir: project })
    assert.equal((await mobile.state()).rooms.find(item => item.id === room.id).workDir, project)
    await mobile.action('update-room', { id: room.id, workDir: '' })
    assert.equal((await mobile.state()).rooms.find(item => item.id === room.id).workDir, undefined)
  })
  await step('foreign Bot identities cannot change working folders', async () => {
    await assert.rejects(mobile.action('update-bot', { id: 'not-on-this-team', workDir: project }), { status: 404 })
  })
  console.log(`mobile folders smoke: all ${passed} steps passed`)
} finally {
  if (room) await mobile.action('delete-room', { id: room.id }).catch(() => {})
  if (bot) await mobile.action('delete-bot', { id: bot.id }).catch(() => {})
  if (device) await operator('device.revoke', { id: device.deviceId }).catch(() => {})
  mobile.dispose(); await rm(project, { recursive: true, force: true })
}
