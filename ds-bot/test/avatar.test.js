import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readAvatar } from '../src/host/avatar.js'
import { MAX_AVATAR_IMAGE } from '../src/host/constants.js'

// Only the magic bytes matter to the reader; the rest of a fixture need not decode.
const file = (magic, size = 32) => Buffer.concat([magic, Buffer.alloc(size, 7)])
const PNG = file(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
const JPEG = file(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
const GIF = file(Buffer.from('GIF89a', 'latin1'))
const WEBP = file(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP')]))
const asDataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`
const pngUrl = asDataUrl('image/png', PNG)
const jpegUrl = asDataUrl('image/jpeg', JPEG)

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-avatar-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a data URL is stored under the type its bytes really are', async () => {
  assert.equal(await readAvatar(pngUrl), pngUrl)
  assert.equal(await readAvatar(jpegUrl), jpegUrl)
  // The mime in the data URL is not trusted: the bytes decide, and the base64 is
  // rewritten in its canonical form.
  assert.equal(await readAvatar(asDataUrl('image/png', JPEG)), jpegUrl)
  assert.equal(await readAvatar(asDataUrl('image/gif', WEBP)), asDataUrl('image/webp', WEBP))
  assert.equal(await readAvatar(asDataUrl('image/jpeg', GIF)), asDataUrl('image/gif', GIF))
  assert.equal(await readAvatar(`data:IMAGE/PNG;base64,${PNG.toString('base64')}`), pngUrl)
  assert.equal(await readAvatar(`data:image/png;base64, ${PNG.toString('base64')}\n`), pngUrl)
})

test('a local image file is read, and a relative path starts in baseDir', async (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'photo.png'), PNG)
  assert.equal(await readAvatar(join(dir, 'photo.png')), pngUrl)
  assert.equal(await readAvatar('photo.png', { baseDir: dir }), pngUrl)
  // The extension does not decide the type either.
  writeFileSync(join(dir, 'photo.jpg'), PNG)
  assert.equal(await readAvatar(join(dir, 'photo.jpg')), pngUrl)
})

test('a path starting with ~ expands to the home folder', async () => {
  await assert.rejects(readAvatar('~'), (error) => {
    assert.match(error.message, /is not an image file/)
    assert.ok(error.message.includes(homedir()), 'the expanded home path is shown')
    return true
  })
  const missing = 'ds-bot-avatar-does-not-exist.png'
  await assert.rejects(readAvatar(`~/${missing}`), (error) => {
    assert.ok(error.message.includes(join(homedir(), missing)))
    return true
  })
})

test('a missing file, a folder, and a non-image file are refused', async (t) => {
  const dir = tempDir(t)
  await assert.rejects(readAvatar(join(dir, 'missing.png')), /There is no image file at .*missing\.png/)
  await assert.rejects(readAvatar(dir), /is not an image file/)
  writeFileSync(join(dir, 'notes.png'), 'this is not an image')
  await assert.rejects(readAvatar(join(dir, 'notes.png')), /The avatar must be a PNG, JPEG, WebP, or GIF image\. Use a square image; 256x256 is recommended/)
})

test('an image over the limit is refused with the limit in the message', async (t) => {
  const huge = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(200_000)])
  const dir = tempDir(t)
  writeFileSync(join(dir, 'huge.png'), huge)
  const expected = (error) => {
    assert.match(error.message, /too large: 200008 bytes/)
    assert.match(error.message, /119982 bytes/)
    assert.match(error.message, /256x256/)
    return true
  }
  await assert.rejects(readAvatar(join(dir, 'huge.png')), expected)
  await assert.rejects(readAvatar(asDataUrl('image/png', huge)), expected)
})

test('an image just under the limit still fits the stored format', async () => {
  const fits = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(119_000 - 8, 1)])
  const url = await readAvatar(asDataUrl('image/png', fits))
  assert.ok(url.length <= MAX_AVATAR_IMAGE)
  assert.ok(url.startsWith('data:image/png;base64,'))
})

test('a malformed data URL is refused', async () => {
  await assert.rejects(readAvatar('data:image/png;base64'), /no comma/)
  await assert.rejects(readAvatar('data:image/svg+xml;base64,PHN2Zz4='), /must hold a PNG, JPEG, WebP, or GIF image/)
  await assert.rejects(readAvatar('data:text/plain;base64,aGVsbG8='), /must hold a PNG, JPEG, WebP, or GIF image/)
  await assert.rejects(readAvatar('data:image/png,aGVsbG8='), /must be base64 encoded/)
  await assert.rejects(readAvatar('data:image/png;base64,not base64!'), /does not hold valid base64/)
  await assert.rejects(readAvatar('data:image/png;base64,aGVsbG8='), /must be a PNG, JPEG, WebP, or GIF image/)
  await assert.rejects(readAvatar('data:image/png;base64,abcd'), /must be a PNG, JPEG, WebP, or GIF image/)
})

test('an empty value or a link is refused', async () => {
  await assert.rejects(readAvatar(''), /Give an image path or a data URL/)
  await assert.rejects(readAvatar('   '), /Give an image path/)
  await assert.rejects(readAvatar('ftp://example.com/photo.png'), /must be a local image path or a data URL/)
  await assert.rejects(readAvatar('file:///tmp/photo.png'), /must be a local image path or a data URL/)
  // A link is never fetched, so it reaches nothing on this machine or its network.
  await assert.rejects(readAvatar('http://127.0.0.1:1/photo.png'), /not downloaded here.*pass its path, or pass a data URL/)
  await assert.rejects(readAvatar('HTTPS://example.com/photo.png'), /not downloaded here/)
  // Nor is a network path opened, which on Windows connects and signs in to that host.
  await assert.rejects(readAvatar('\\\\host.example\\share\\photo.png'), /network path is not read here/)
  await assert.rejects(readAvatar('//host.example/share/photo.png'), /network path is not read here/)
})
