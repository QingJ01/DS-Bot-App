// Writing parsed cookies into a partition session: the details mapping, the per-cookie
// apply with read-back verification and flush, the pending-import store, and the
// value-free preview the page confirms.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { applyCookies, CookieImports, previewOf, toSetDetails } from '../src/cookie-import.mjs'
import { parseCookieFile } from '../src/cookie-parse.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cookies')
const parse = (name) => parseCookieFile(readFileSync(join(fixtures, name)))

test('toSetDetails maps a normalized cookie to the Electron set call', () => {
  const domain = toSetDetails({ name: 'n', value: 'v', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: 1893456000 })
  assert.equal(domain.url, 'https://example.com/')
  assert.equal(domain.domain, '.example.com')
  assert.equal(domain.sameSite, 'strict')
  assert.equal(domain.expirationDate, 1893456000)

  const hostOnly = toSetDetails({ name: 'n', value: 'v', domain: 'example.com', path: '/app', secure: false, httpOnly: false })
  assert.equal(hostOnly.url, 'http://example.com/app')
  assert.equal(hostOnly.domain, undefined, 'no leading dot means host-only: no domain field')
  assert.equal(hostOnly.sameSite, 'unspecified', 'no SameSite attribute stays unspecified')
  assert.equal(hostOnly.expirationDate, undefined, 'a session cookie carries no expiry')

  assert.equal(toSetDetails({ name: 'n', value: 'v', domain: 'x.io', path: '/', sameSite: 'None' }).sameSite, 'no_restriction')
  assert.equal(toSetDetails({ name: 'n', value: 'v', domain: 'x.io', path: '/', sameSite: 'Lax' }).sameSite, 'lax')
})

/** A session.cookies stand-in: store what set accepts, refuse and drop what we are told to. */
function fakeSession({ reject = [], drop = [] } = {}) {
  const stored = new Map()
  const key = (c) => `${c.name}${String(c.domain ?? '').replace(/^\.+/, '')}${c.path ?? '/'}`
  return {
    stored,
    flushed: false,
    cookies: {
      set: async (details) => {
        if (reject.includes(details.name)) throw new Error('Invalid cookie fields')
        if (!drop.includes(details.name)) {
          const host = new URL(details.url).host
          stored.set(key({ name: details.name, domain: details.domain ?? host, path: details.path }), {
            name: details.name, domain: details.domain ?? host, path: details.path, value: details.value,
            secure: details.secure, httpOnly: details.httpOnly,
          })
        }
      },
      get: async () => [...stored.values()],
      flushStore: async function () { this.flushed = true },
    },
  }
}

test('applyCookies stores, verifies by read-back and flushes the store', async () => {
  const ses = fakeSession()
  const parsed = parse('cookie-editor.json')
  const report = await applyCookies(ses, parsed.cookies)
  assert.equal(report.stored, 8)
  assert.equal(report.dropped.length, 0)
  assert.equal(report.failed.length, 0)
  assert.equal(report.flushed, true)
  assert.equal(ses.stored.size, 8)
})

test('applyCookies reports rejects and silent drops per cookie', async () => {
  const ses = fakeSession({ reject: ['p_none'], drop: ['p_strict'] })
  const parsed = parse('cookie-editor.json')
  const report = await applyCookies(ses, parsed.cookies)
  assert.equal(report.stored, 6)
  assert.equal(report.failed.length, 1)
  assert.equal(report.failed[0].name, 'p_none')
  assert.match(report.failed[0].reason, /Invalid cookie fields/)
  assert.equal(report.dropped.length, 1)
  assert.equal(report.dropped[0].name, 'p_strict')
  // Reports never carry values.
  for (const item of [...report.failed, ...report.dropped]) assert.equal(item.value, undefined)
})

test('a pending import is value-bearing, one-shot and capped', () => {
  const imports = new CookieImports()
  const parsed = parse('cookies.txt')
  const { id, preview } = imports.store(parsed, { kind: 'file', label: 'cookies.txt' })
  assert.equal(preview.cookies, 8)
  assert.equal(preview.source.kind, 'file')
  assert.equal(preview.sites.length, 1) // all eight share 127.0.0.1
  assert.ok(preview.notes.includes('session-cookies'))
  assert.equal(imports.peek(id).cookies.length, 8)
  assert.equal(imports.take(id).cookies.length, 8)
  assert.equal(imports.take(id), null, 'taken once')
  for (let i = 0; i < 20; i += 1) imports.store(parsed, { kind: 'file', label: String(i) })
  assert.equal(imports.peek(id), null, 'older pendings were evicted past the cap')
})

test('preview groups by site and reports skipped and adjusted entries', () => {
  const parsed = parse('malformed.cookies.txt')
  const preview = previewOf(parsed, { kind: 'file', label: 'malformed.cookies.txt' })
  assert.equal(preview.cookies, 5)
  assert.equal(preview.skipped.length, 7)
  assert.ok(preview.warnings.length > 0)
  assert.ok(preview.warnings.every((w) => w.count >= 1 && w.message))
})
