import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorker, workerSession } from '../src/host/hermes.js'

test('worker calls retain identity across conversations and report actual completion', async t => {
  const home = await mkdtemp(join(tmpdir(), 'hermes-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const keyFile = join(home, 'key'); await writeFile(keyFile, 'mock-credential')
  const worker = { url: 'http://localhost:8642', keyFile }
  const sent = []
  const request = async (url, init) => {
    sent.push({ url: url.href, ...init, body: JSON.parse(init.body) })
    return Response.json({ choices: [{ message: { content: 'Executed on worker' }, finish_reason: 'stop' }] })
  }
  for (const context of ['private chat', 'group chat']) {
    const out = await runWorker(worker, { botId: 'bot-a', name: 'Worker', task: 'Run a check', context }, request)
    assert.equal(out.text, 'Executed on worker')
  }
  assert.equal(sent[0].headers['X-Hermes-Session-Id'], sent[1].headers['X-Hermes-Session-Id'])
  assert.notEqual(workerSession('bot-a'), workerSession('bot-b'))
  assert.equal(sent[0].url, 'http://localhost:8642/v1/chat/completions')
  assert.match(sent[1].body.messages[0].content, /group chat/)
  assert.equal(sent[0].headers.Authorization, 'Bearer mock-credential')
  for (const response of [new Response('private error', { status: 401 }), Response.json({ choices: [{ finish_reason: 'error', message: { content: 'partial' } }] }), Response.json({ choices: [] })]) {
    await assert.rejects(runWorker(worker, { botId: 'bot-a', name: 'Worker', task: 'check' }, async () => response), /Hermes worker/)
  }
})
