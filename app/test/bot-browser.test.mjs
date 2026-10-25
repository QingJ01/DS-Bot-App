import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { allowedNavigation, BotBrowserGuests, partitionOf, requestAllowed } from '../src/bot-browser.mjs'

const ORIGIN = 'http://127.0.0.1:43117'

test('a storage key keeps its own partition on disk', () => {
  assert.equal(partitionOf('bot:a'), partitionOf('bot:a'))
  assert.notEqual(partitionOf('bot:a'), partitionOf('bot:b'))
  assert.match(partitionOf('bot:../../x'), /^persist:ds-bot-browser-[\da-f]{32}$/u)
})

test('pages go anywhere on http(s) but the app’s own Host', () => {
  assert.equal(allowedNavigation('https://example.com/', ORIGIN), true)
  assert.equal(allowedNavigation('http://localhost:3000/', ORIGIN), true)
  assert.equal(allowedNavigation('http://192.168.1.2:43117/', ORIGIN), true)
  for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST.', 'x.localhost', '[::1]', '0.0.0.0', '127.0.0.2', '[::ffff:127.0.0.1]', '127.1']) {
    assert.equal(allowedNavigation(`http://${host}:43117/`, ORIGIN), false, host)
  }
  assert.equal(allowedNavigation('https://user:pass@example.com/', ORIGIN), false)
  for (const url of ['file:///C:/', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,x', 'not a url']) {
    assert.equal(allowedNavigation(url, ORIGIN), false, url)
  }
})

test('a page’s requests reach the network and inert local schemes, not the Host', () => {
  assert.equal(requestAllowed('wss://example.com/socket', ORIGIN), true)
  assert.equal(requestAllowed('data:image/png;base64,AA==', ORIGIN), true)
  assert.equal(requestAllowed('blob:https://example.com/1', ORIGIN), true)
  assert.equal(requestAllowed('ws://localhost:43117/api', ORIGIN), false)
  assert.equal(requestAllowed('file:///etc/passwd', ORIGIN), false)
})

function fakeElectron() {
  const sessions = new Map()
  const session = {
    fromPartition(name) {
      if (!sessions.has(name)) {
        const storage = Object.assign(new EventEmitter(), {
          name, cleared: 0,
          setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, setDisplayMediaRequestHandler() {},
          webRequest: { onBeforeRequest(handler) { storage.beforeRequest = handler } },
          async clearStorageData() { storage.cleared += 1 },
          async clearCache() {},
        })
        sessions.set(name, storage)
      }
      return sessions.get(name)
    },
  }
  const owner = Object.assign(new EventEmitter(), { sent: [], isDestroyed: () => false, send(channel, value) { this.sent.push([channel, value]) } })
  return { session, sessions, owner, window: { webContents: owner } }
}

function fakeGuest(url) {
  return Object.assign(new EventEmitter(), {
    url, closed: false,
    getURL() { return this.url },
    isDestroyed() { return this.closed },
    close() { this.closed = true; this.emit('destroyed') },
    setWindowOpenHandler(handler) { this.openHandler = handler },
  })
}

function attach(owner, src, partition) {
  const event = { prevented: false, preventDefault() { this.prevented = true } }
  const preferences = { preload: 'evil.js', nodeIntegration: true, disablePopups: false }
  owner.emit('will-attach-webview', event, preferences, { src, partition })
  return { event, preferences }
}

test('only a leased webview attaches, with fixed preferences, and its new windows become tab requests', async () => {
  const electron = fakeElectron()
  const guests = new BotBrowserGuests({ session: electron.session, origin: () => ORIGIN, devTools: false })
  guests.bind(electron.window)
  const { lease, partition } = guests.acquire(electron.owner, 'bot:a')
  assert.equal(partition, partitionOf('bot:a'))
  // Every request of the partition goes through the policy.
  const decided = []
  electron.sessions.get(partition).beforeRequest({ url: 'http://localhost:43117/' }, value => decided.push(value.cancel))
  assert.deepEqual(decided, [true])

  assert.equal(attach(electron.owner, 'about:blank#unknown', partition).event.prevented, true)
  assert.equal(attach(electron.owner, `about:blank#${lease}`, 'persist:other').event.prevented, true)
  const { event, preferences } = attach(electron.owner, `about:blank#${lease}`, partition)
  assert.equal(event.prevented, false)
  assert.equal(preferences.preload, undefined)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.partition, partition)
  // A lease attaches once.
  assert.equal(attach(electron.owner, `about:blank#${lease}`, partition).event.prevented, true)

  const guest = fakeGuest(`about:blank#${lease}`)
  electron.owner.emit('did-attach-webview', {}, guest)
  guest.emit('dom-ready')
  assert.deepEqual(guest.openHandler({ url: 'https://example.com/next' }), { action: 'deny' })
  assert.deepEqual(guest.openHandler({ url: `${ORIGIN}/` }), { action: 'deny' })
  assert.deepEqual(electron.owner.sent, [['ds-bot:browser-open-requested', { lease, url: 'https://example.com/next' }]])

  const navigation = { isMainFrame: true, url: `${ORIGIN}/api`, prevented: false, preventDefault() { this.prevented = true } }
  guest.emit('will-frame-navigate', navigation)
  assert.equal(navigation.prevented, true)

  await guests.forget(electron.owner, 'bot:a')
  assert.equal(guest.closed, true)
  assert.equal(electron.sessions.get(partition).cleared, 1)
  assert.throws(() => guests.acquire(electron.owner, ''), /storage key/u)
})

test('a guest without a lease is closed, and a lease of another window is not released', async () => {
  const electron = fakeElectron()
  const guests = new BotBrowserGuests({ session: electron.session, origin: () => ORIGIN, devTools: false })
  guests.bind(electron.window)
  const stray = fakeGuest('about:blank#nope')
  electron.owner.emit('did-attach-webview', {}, stray)
  stray.emit('dom-ready')
  assert.equal(stray.closed, true)
  const { lease } = guests.acquire(electron.owner, 'bot:a')
  await assert.rejects(guests.release({}, lease), /another window/u)
})
