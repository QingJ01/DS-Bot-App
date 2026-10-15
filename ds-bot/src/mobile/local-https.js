import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureLocalCertificate } from './local-certificate.js'
import { ipv6Scope } from './ip-address.js'

const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
export function localAddresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) => entries.filter(item => !item.internal).map(item => {
    const scope = ipv6Scope(item.address)
    return { address: item.address, name, family: isIP(item.address), ...(scope ? { scope } : {}) }
  }))
    .filter(item => item.family === 4 || item.scope)
    .sort((a, b) => {
      const rank = item => (item.family === 6 ? item.scope === 'private' ? 100 : 110 : 0) + (/^(docker|br-|veth|tun|tailscale|utun|vEthernet)/i.test(item.name) ? 50 : 0) + (/^(wi-?fi|wlan|wireless|en0)/i.test(item.name) ? -10 : 0) + (item.address.startsWith('192.168.') ? 0 : item.address.startsWith('10.') ? 1 : 2)
      return rank(a) - rank(b) || a.address.localeCompare(b.address)
    })
}
export async function createLocalHttps({ home, config = {}, load, readOnly, start, stop, addresses = localAddresses }) {
  const path = join(home, 'local-https.json')
  const interfaces = addresses
  addresses = () => {
    const found = interfaces()
    const address = config.advertisedAddress
    if (address && isIP(address) && !found.some(item => item.address === address)) {
      return [{ address, name: 'configured host', family: isIP(address) }, ...found]
    }
    return found
  }
  const manual = config.enabled === true && Boolean(config.publicUrl || config.certPath || config.keyPath || config.devAllowInsecure)
  let saved = { enabled: false, port: config.port ?? 8788 }
  let phase = 'off'
  let error
  let info
  let busy = false
  let disposed = false
  const assertOwner = () => {
    if (disposed) throw refused('Mobile access is closing.')
    if (readOnly() !== undefined) throw refused('Use the DSH host that owns this Bot team.')
  }
  try {
    const data = JSON.parse(await readFile(path, 'utf8'))
    if (data.version !== 1 || typeof data.enabled !== 'boolean' || !Number.isInteger(data.port) || data.port < 1024 || data.port > 65535 || (data.address !== undefined && (!isIP(data.address) || data.address.includes('%')))) throw new Error('Invalid local HTTPS configuration')
    saved = data
  } catch (cause) { if (cause.code !== 'ENOENT') { phase = 'failed'; error = 'Local mobile configuration could not be read. Restore its settings before retrying.' } }
  const snapshot = () => ({ provider: manual ? 'manual' : 'local', enabled: saved.enabled, phase, busy, addresses: addresses(), port: saved.port,
    ...(saved.address ? { address: saved.address } : {}),
    ...(info ? { url: info.url, tlsPin: info.tlsPin, expiresAt: info.expiresAt } : {}), ...(error ? { error } : {}) })
  const persist = async value => {
    assertOwner(); await mkdir(home, { recursive: true, mode: 0o700 })
    await writeFile(path + '.tmp', JSON.stringify({ version: 1, ...value }), { mode: 0o600 })
    assertOwner(); await rename(path + '.tmp', path); saved = value
  }
  async function enable(body = {}) {
    if (busy) throw refused('Mobile connection setup is already running.')
    if (manual) throw refused('This host already has a manually configured HTTPS entrance.')
    if (config.enabled === false) throw refused('Mobile access is disabled in this plugin configuration.')
    if (phase === 'failed' && error === 'Local mobile configuration could not be read. Restore its settings before retrying.') throw refused(error)
    busy = true; phase = 'starting'; error = undefined
    let opened = false
    try {
      await load(); assertOwner()
      const options = addresses()
      const chosen = body.address ?? (options.some(item => item.address === saved.address) ? saved.address : options[0]?.address)
      if (!options.some(item => item.address === chosen)) throw refused('Connect this computer to Wi-Fi or Ethernet, then choose its listed IPv4 or IPv6 address.')
      const port = body.port ?? saved.port
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw refused('Use a port from 1024 to 65535.')
      if (info && chosen === saved.address && port === saved.port) { phase = 'ready'; return { ...snapshot(), busy: false } }
      if (info) throw refused('Turn off the current phone connection before changing its address or port.')
      const certificate = await ensureLocalCertificate(join(home, 'tls'), ['127.0.0.1', '::1', ...options.map(item => item.address)], { assertOwner })
      assertOwner()
      const ipv6 = isIP(chosen) === 6
      const url = new URL(`https://${ipv6 ? `[${chosen}]` : chosen}:${port}`).origin
      await start({ ...config, enabled: true, host: ipv6 ? chosen : '0.0.0.0', port, publicUrl: url, certPath: certificate.certPath, keyPath: certificate.keyPath })
      opened = true; assertOwner()
      await persist({ enabled: true, port, address: chosen })
      info = { url, tlsPin: certificate.tlsPin, expiresAt: certificate.expiresAt }; phase = 'ready'
      return { ...snapshot(), busy: false }
    } catch (cause) {
      if (opened) await stop()
      phase = 'failed'; error = cause.code === 'bot/refused' ? cause.message : 'The local HTTPS entrance could not start. Check that its port is available and this host can write its own mobile settings.'
      throw refused(error)
    } finally { busy = false }
  }
  return {
    snapshot,
    async restore() { if (!manual && saved.enabled && config.enabled !== false && !error) await enable({}) },
    enable,
    async disable() {
      if (busy) throw refused('Mobile connection setup is already running.')
      if (manual) throw refused('Manage this manually configured entrance in the DSH plugin settings.')
      busy = true
      try { await load(); assertOwner(); await persist({ ...saved, enabled: false }); await stop(); info = undefined; phase = 'off'; error = undefined; return { ...snapshot(), busy: false } }
      finally { busy = false }
    },
    dispose() { disposed = true },
  }
}
