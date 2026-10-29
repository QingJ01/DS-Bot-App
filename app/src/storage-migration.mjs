import { existsSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const LEGACY_STORAGE_SCHEME = {
  scheme: 'dsh-app', privileges: { standard: true, secure: true },
}

// Keep this self-contained: it runs in a blank renderer, not in the DSH page.
export function readLegacyStorage(storage) {
  const keys = new Set([
    'dsh.sessions.current',
    'ds-bot:unread', 'ds-bot:reactions', 'ds-bot:seen', 'ds-bot:prefs',
    'ds-bot:surface', 'ds-bot:agent-sessions', 'ds-bot:browser-width',
  ])
  return Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter(key => keys.has(key) || key?.startsWith('dsh.conversation.') || key?.startsWith('dsh.sidebar-right.v1.'))
    .map(key => [key, storage.getItem(key)])
}

export function restoreLegacyStorage(storage, entries) {
  const marker = 'ds-bot:legacy-storage-migrated-v1'
  if (storage.getItem(marker) !== null) return
  for (const [key, value] of entries) {
    // A newer draft or preference wins, including an intentionally emptied draft.
    if (storage.getItem(key) === null) storage.setItem(key, value)
  }
  storage.setItem(marker, '1')
}

/** Transfer UI state before the new page can initialize its empty draft stores. */
export async function migrateLegacyStorage({ BrowserWindow, session, origin, userData }) {
  const marker = join(userData, 'legacy-storage-migrated-v1.json')
  if (existsSync(marker)) return
  const url = new URL(origin)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin) {
    throw new Error('Invalid desktop storage destination')
  }
  const target = `${origin}/__ds_bot_storage_migration__`
  const legacy = 'dsh-app://app/'
  const handled = []
  let window
  let timer
  try {
    // Both documents are inert. Never boot a second DSH page, expose a preload,
    // proxy requests, or copy cookies/IndexedDB from the old origin.
    for (const scheme of ['dsh-app', 'http']) {
      session.protocol.handle(scheme, request => new Response('<!doctype html><title>Storage migration</title>', {
        status: request.url === legacy || request.url === target ? 200 : 403,
        headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'", 'cache-control': 'no-store' },
      }))
      handled.push(scheme)
    }
    window = new BrowserWindow({
      show: false,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const transfer = async () => {
      await window.loadURL(legacy)
      const entries = await window.webContents.executeJavaScript(`(${readLegacyStorage.toString()})(localStorage)`)
      await window.loadURL(target)
      await window.webContents.executeJavaScript(`(${restoreLegacyStorage.toString()})(localStorage, ${JSON.stringify(entries)})`)
      session.flushStorageData()
      // This profile-wide marker also prevents replaying stale drafts if the
      // loopback port later changes. The destination marker makes retries safe.
      const pending = `${marker}.tmp`
      writeFileSync(pending, JSON.stringify({ origin }))
      renameSync(pending, marker)
    }
    await Promise.race([
      transfer(),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('Storage migration timed out')) }, 30_000) }),
    ])
  } catch {
    // Do not include renderer errors or serialized draft contents in logs.
    throw new Error('Could not migrate desktop drafts. Old data is unchanged; restart to retry.')
  } finally {
    clearTimeout(timer)
    window?.destroy()
    for (const scheme of handled) session.protocol.unhandle(scheme)
  }
}
