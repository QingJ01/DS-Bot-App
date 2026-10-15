import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate, createPrivateKey, generateKeyPairSync } from 'node:crypto'
import https from 'node:https'
import { ensureLocalCertificate, generateLocalCertificate } from '../src/mobile/local-certificate.js'
import { createLocalHttps, localAddresses } from '../src/mobile/local-https.js'

async function fixture(t) { const home = await mkdtemp(join(tmpdir(), 'dsbot-local-tls-')); t.after(() => rm(home, { recursive: true, force: true })); return home }
test('local certificate authenticates a real HTTPS connection with IP SAN, permissions and stable identity after renewal', async t => {
  const home = await fixture(t)
  const now = Date.now()
  const original = await ensureLocalCertificate(home, ['127.0.0.1', '192.168.2.3'], { now })
  const pem = await readFile(original.certPath)
  const key = await readFile(original.keyPath)
  const cert = new X509Certificate(pem)
  assert.ok(cert.verify(cert.publicKey) && cert.checkPrivateKey(createPrivateKey(key)))
  assert.equal(cert.checkIP('192.168.2.3'), '192.168.2.3')
  assert.equal(cert.checkIP('192.168.2.4'), undefined)
  if (process.platform !== 'win32') { assert.equal((await stat(home)).mode & 0o777, 0o700); assert.equal((await stat(original.keyPath)).mode & 0o777, 0o600) }
  const server = https.createServer({ key, cert: pem }, (_req, res) => res.end('verified'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const value = await new Promise((resolve, reject) => https.get(`https://127.0.0.1:${server.address().port}`, { ca: pem }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body)) }).on('error', reject))
  assert.equal(value, 'verified')
  await ensureLocalCertificate(home, ['127.0.0.1', '192.168.2.3'], { now: now + 1000 })
  assert.deepEqual(await readFile(original.certPath), pem)
  const renewal = await ensureLocalCertificate(home, ['127.0.0.1', '192.168.2.4'], { now: now + 360 * 86400000 })
  assert.equal(renewal.tlsPin, original.tlsPin)
  assert.deepEqual(await readFile(original.keyPath), key)
  assert.notDeepEqual(await readFile(original.certPath), pem)
  assert.ok(new X509Certificate(await readFile(original.certPath)).checkIP('192.168.2.4'))
})
test('a damaged identity key fails closed, and a non-owner cannot create it', async t => {
  const home = await fixture(t)
  await assert.rejects(ensureLocalCertificate(home, ['127.0.0.1'], { assertOwner() { throw new Error('read-only') } }), /read-only/)
  await assert.rejects(stat(join(home, 'computer.key')), { code: 'ENOENT' })
  await writeFile(join(home, 'computer.key'), 'damaged-test-key')
  await assert.rejects(ensureLocalCertificate(home, ['127.0.0.1']), /Restore its private key/)
  assert.equal(await readFile(join(home, 'computer.key'), 'utf8'), 'damaged-test-key')
})
test('an unexpected private key algorithm is rejected without rotating identity', async t => {
  const home = await fixture(t)
  const key = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' })
  await writeFile(join(home, 'computer.key'), key)
  await assert.rejects(ensureLocalCertificate(home, ['127.0.0.1']), /Restore its private key/)
  assert.equal(await readFile(join(home, 'computer.key'), 'utf8'), key)
})
test('one-click HTTPS restores after restart with the same pin, disables persistently, and rejects other addresses', async t => {
  const home = await fixture(t)
  const starts = []; let stops = 0
  const options = { home, load: async () => {}, readOnly: () => undefined, addresses: () => [{ address: '192.168.2.3', name: 'Wi-Fi' }], start: async config => starts.push(config), stop: async () => { stops++ } }
  const first = await createLocalHttps(options)
  assert.equal(first.snapshot().enabled, false)
  await assert.rejects(first.enable({ address: '203.0.113.1' }), { code: 'bot/refused' })
  const state = await first.enable({})
  assert.equal(state.url, 'https://192.168.2.3:8788'); assert.equal(state.busy, false)
  assert.match(state.tlsPin, /^sha256:[a-f0-9]{64}$/)
  assert.equal(starts[0].host, '0.0.0.0')
  const second = await createLocalHttps(options)
  await second.restore()
  assert.equal(second.snapshot().tlsPin, state.tlsPin)
  assert.equal(starts.length, 2)
  await second.enable(); assert.equal(starts.length, 2)
  await second.disable(); assert.equal(stops, 1)
  const third = await createLocalHttps(options); await third.restore(); assert.equal(starts.length, 2)
})
test('manual configuration, explicit disable, corrupt settings, owner changes, and startup failures fail safely', async t => {
  const home = await fixture(t); let started = false; let owner = undefined
  const base = { home, load: async () => {}, readOnly: () => owner, addresses: () => [{ address: '10.1.1.1', name: 'Ethernet' }], start: async () => { started = true; throw new Error('private network error') }, stop: async () => {} }
  const manual = await createLocalHttps({ ...base, config: { enabled: true, publicUrl: 'https://example.invalid' } })
  await assert.rejects(manual.enable(), /manually configured/); assert.equal(started, false)
  const disabled = await createLocalHttps({ ...base, config: { enabled: false } }); await assert.rejects(disabled.enable(), /disabled/)
  const local = await createLocalHttps(base); owner = 'someone else'; await assert.rejects(local.enable(), /owns this Bot team/)
  owner = undefined; await assert.rejects(local.enable(), /could not start/); assert.ok(!local.snapshot().error.includes('private network'))
  await assert.rejects(stat(join(home, 'local-https.json')), { code: 'ENOENT' })
  await writeFile(join(home, 'local-https.json'), 'broken')
  const corrupt = await createLocalHttps(base); await assert.rejects(corrupt.enable(), /Restore its settings/)
})
test('network selection prefers LAN Wi-Fi over virtual adapters and excludes loopback', () => {
  assert.deepEqual(localAddresses({ docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }], wlan0: [{ address: '192.168.3.4', family: 'IPv4', internal: false }], lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }).map(item => item.address), ['192.168.3.4', '172.17.0.1'])
})
test('IPv6 certificates verify compressed, expanded and mapped IP SANs and retain identity after address changes', async t => {
  const home = await fixture(t)
  const addresses = ['127.0.0.1', '::1', 'fd12:3456::1', '2001:db8::7', '::ffff:192.0.2.7']
  const first = await ensureLocalCertificate(home, addresses)
  const pem = await readFile(first.certPath)
  const certificate = new X509Certificate(pem)
  assert.ok(certificate.checkIP('2001:db8:0:0:0:0:0:7'))
  for (const address of addresses) assert.ok(certificate.checkIP(address), address)
  assert.equal(certificate.checkIP('2001:db8::8'), undefined)
  await ensureLocalCertificate(home, addresses)
  assert.deepEqual(await readFile(first.certPath), pem)
  const renewed = await ensureLocalCertificate(home, [...addresses, '2001:db8::8'])
  assert.equal(renewed.tlsPin, first.tlsPin)
  assert.ok(new X509Certificate(await readFile(renewed.certPath)).checkIP('2001:db8::8'))
  const key = createPrivateKey(await readFile(first.keyPath))
  for (const address of ['fe80::1%wlan0', '[2001:db8::1]', '2001:db8:::1', 'host.example']) assert.throws(() => generateLocalCertificate(key, [address]))
})
test('IPv6 selection excludes link-local, multicast, unspecified and mapped addresses while preserving IPv4 defaults', () => {
  const addresses = ['192.168.3.4', '2001:db8::7', 'fd12:3456::1', 'fe80::1', 'fe80::1%wlan0', 'ff02::1', '::', '::1', '::ffff:192.0.2.7']
  const interfaces = { wlan0: addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4, internal: false })) }
  const selected = localAddresses(interfaces)
  assert.deepEqual(selected.map(item => item.address), ['192.168.3.4', 'fd12:3456::1', '2001:db8::7'])
  assert.deepEqual(selected.map(item => item.scope), [undefined, 'private', 'global'])
})
test('selecting IPv6 uses a bracketed QR origin, binds only that address and restores the same pin', async t => {
  const home = await fixture(t)
  const starts = []
  const options = { home, load: async () => {}, readOnly: () => undefined, addresses: () => [{ address: '192.168.3.4', name: 'Wi-Fi' }, { address: '2001:DB8:0:0:0:0:0:7', name: 'Wi-Fi' }], start: async config => starts.push(config), stop: async () => {} }
  const local = await createLocalHttps(options)
  await assert.rejects(local.enable({ address: '2001:db8::8' }), /listed IPv4 or IPv6/)
  const state = await local.enable({ address: '2001:DB8:0:0:0:0:0:7' })
  assert.equal(state.url, 'https://[2001:db8::7]:8788')
  assert.equal(starts[0].host, '2001:DB8:0:0:0:0:0:7')
  assert.equal(state.address, starts[0].host)
  await assert.rejects(local.enable({ address: '192.168.3.4' }), /Turn off/)
  const restored = await createLocalHttps(options)
  await restored.restore()
  assert.equal(restored.snapshot().url, state.url)
  assert.equal(restored.snapshot().tlsPin, state.tlsPin)
})


test('a container advertises the configured host address and retains its certificate pin on restart', async t => {
  const home = await fixture(t)
  let started
  const options = { home, config: { advertisedAddress: '192.168.2.8' }, load: async () => {}, readOnly: () => undefined, addresses: () => [{ address: '172.17.0.2', name: 'eth0' }], start: async config => { started = config }, stop: async () => {} }
  const first = await createLocalHttps(options)
  const state = await first.enable()
  assert.equal(state.url, 'https://192.168.2.8:8788')
  assert.ok(new X509Certificate(await readFile(started.certPath)).checkIP('192.168.2.8'))
  const restored = await createLocalHttps(options)
  await restored.restore()
  assert.equal(restored.snapshot().url, state.url)
  assert.equal(restored.snapshot().tlsPin, state.tlsPin)
})
