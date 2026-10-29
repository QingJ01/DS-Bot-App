// Run with Electron, not node --test: exercise real origin-scoped Chromium storage.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, protocol, session } from 'electron'
import { LEGACY_STORAGE_SCHEME, migrateLegacyStorage } from '../../src/storage-migration.mjs'

const userData = mkdtempSync(join(resolve('.'), '.dsh-test-storage-migration-'))
app.setPath('userData', userData)
protocol.registerSchemesAsPrivileged([LEGACY_STORAGE_SCHEME])
app.disableHardwareAcceleration()
const server = createServer((_request, response) => { response.end('<!doctype html><title>Host restored</title>') })
const timeout = setTimeout(() => {
  console.error('Storage migration fixture timed out after 60 seconds')
  app.exit(1)
}, 60_000)
timeout.unref()

async function run() {
  let window
  try {
    await app.whenReady()
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const origin = `http://127.0.0.1:${String(server.address().port)}`
    const ses = session.defaultSession
    ses.protocol.handle('dsh-app', () => new Response('<!doctype html><title>Legacy</title>', { headers: { 'content-type': 'text/html' } }))
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await window.loadURL('dsh-app://app/')
    const key = 'dsh.conversation.session-test'
    const value = JSON.stringify({ draft: 'upgrade 草稿', view: null })
    await window.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); localStorage.setItem('auth-token', 'synthetic-test-only')`)
    await window.loadURL(origin)
    assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), null)
    ses.protocol.unhandle('dsh-app')

    await migrateLegacyStorage({ BrowserWindow, session: ses, origin, userData })
    await window.loadURL(origin)
    assert.equal(await window.webContents.executeJavaScript('document.title'), 'Host restored')
    assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), value)
    assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('auth-token')"), null)
    assert.deepEqual(JSON.parse(readFileSync(join(userData, 'legacy-storage-migrated-v1.json'), 'utf8')), { origin })

    await window.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(key)})`)
    await migrateLegacyStorage({ BrowserWindow, session: ses, origin, userData })
    assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), null)

    ses.protocol.handle('dsh-app', () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
    await window.loadURL('dsh-app://app/')
    assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), value)
    assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('auth-token')"), 'synthetic-test-only')
    ses.protocol.unhandle('dsh-app')
    console.log('PASS: real Chromium origin migration, source preservation, auth exclusion, retry, and HTTP restoration')
    window.destroy()
    server.close()
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    server.close()
    clearTimeout(timeout)
    app.exit(1)
  }
}

void run()
