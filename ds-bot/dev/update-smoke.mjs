// Run after the normal smoke, with UPDATE_SMOKE=1. Replaces ONLY this bench's
// linked plugin with the published source; stop the bench before using it again.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [name, port] = process.argv.slice(2)
if (!/^[a-z0-9-]+$/.test(name ?? '') || !/^\d+$/.test(port ?? '') || Number(port) < 1024 || Number(port) > 65535 || Number(port) === 3080) throw new Error('Use an isolated bench and test port')
const home = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), `.dsh-test-${name}`)
const log = await readFile(join(home, 'web.log'), 'utf8')
const login = log.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s]+`))?.[0]
assert.ok(login)
const auth = await fetch(login, { redirect: 'manual' })
const cookie = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
const request = async (endpoint, extra = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/bot-update-smoke`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, ...extra }) })
  assert.equal(response.ok, true, `Fixture action ${endpoint} failed`)
  return response.json()
}
const before = JSON.parse(await readFile(join(home, 'bot', 'state.json'), 'utf8'))
await writeFile(join(home, 'bot', 'update-smoke-keep.txt'), 'Keep this user-owned file')
await request('prepare')
const offer = await request('check')
assert.equal(offer.available, true, offer.checkError || offer.blockedReason)
assert.ok(offer.targetId)
assert.equal((await request('install', { targetId: offer.targetId })).phase, 'installing')
let status
const deadline = Date.now() + 180_000
while (Date.now() < deadline) {
  status = await request('status')
  if (status.phase !== 'installing') break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.equal(status.phase, 'installed', status.error || 'Installation did not finish')
const manifest = JSON.parse(await readFile(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
assert.match(manifest.dependencies['ds-bot'], /^github:QingJ01\/DS-Bot-App#[a-f0-9]{40}&path:ds-bot$/)
const lock = await readFile(join(home, 'profiles', 'web', 'pnpm-lock.yaml'), 'utf8')
assert.ok(!lock.includes('127.0.0.1:1'), 'The old broken archive remains locked')
const after = JSON.parse(await readFile(join(home, 'bot', 'state.json'), 'utf8'))
assert.deepEqual(Object.keys(after.bots).sort(), Object.keys(before.bots).sort())
assert.equal(await readFile(join(home, 'bot', 'update-smoke-keep.txt'), 'utf8'), 'Keep this user-owned file')
console.log('Real DSH update replaced a broken legacy tarball lock with the immutable release source; team and user files survived.')
