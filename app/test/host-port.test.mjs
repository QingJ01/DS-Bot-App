import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { hostPort } from '../src/host-port.mjs'

const root = mkdtempSync(join(tmpdir(), 'ds-bot-app-port-'))
after(() => { rmSync(root, { recursive: true, force: true }) })

test('picks a free port once and keeps it', async () => {
  const file = join(root, 'keep', 'host-port.json')
  const port = await hostPort(file)
  assert.ok(port > 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { port })
  assert.equal(await hostPort(file), port)
})

test('moves to another port when the saved one is taken', async (t) => {
  const server = createServer()
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  t.after(() => { server.close() })
  const taken = server.address().port
  const file = join(root, 'taken.json')
  writeFileSync(file, JSON.stringify({ port: taken }))
  const port = await hostPort(file)
  assert.notEqual(port, taken)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { port })
})

test('takes a new port for a file it cannot read', async () => {
  const file = join(root, 'broken.json')
  writeFileSync(file, '{"port": "x"')
  const port = await hostPort(file)
  assert.ok(port > 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { port })
})
