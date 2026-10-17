// Approval rules: the calls a Bot may make without asking, and the ones that still
// reach the user.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// The answer DSH's own card would give, which is what a request that is not answered by
// a rule falls through to.
const ASKED = 'asked-in-dsh'

const team = workDir => ({
  version: 1,
  mainBotIds: ['chief'],
  bots: {
    chief: { id: 'chief', sessionId: 'chief-chat', name: 'Chief', capabilities: [], createdAt: 1, workDir },
    writer: { id: 'writer', sessionId: 'writer-chat', name: 'Writer', capabilities: [], createdAt: 2, workDir },
  },
  rooms: { room: { id: 'room', name: 'Crew', named: true, members: ['chief', 'writer'], sessions: { writer: 'room-writer' }, admin: 'chief', mode: 'everyone' } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  revision: 1,
})

async function setup({ state } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsb-approval-'))
  const home = join(root, 'home')
  const work = join(root, 'work')
  mkdirSync(home, { recursive: true })
  mkdirSync(work, { recursive: true })
  writeFileSync(join(home, 'state.json'), JSON.stringify(state ?? team(work)))
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home, github: false, diagnosticsFile: false })
  ctx.sessionTitle = { rename: async () => {} }
  await rt.load()
  const listener = ctx.listeners.get('approval/request')[0]
  // A tool call the Session is running right now, as the Session log reports it.
  const startCall = (sessionId, { callId = 'call-1', tool = 'write_file', args = {} } = {}) => {
    ctx.listeners.get('session/event')[0]({ id: sessionId }, {
      type: 'tool/call',
      data: { callId, name: tool, arguments: JSON.stringify(args) },
      time: Date.now(),
    })
  }
  const ask = (sessionId, { tool = 'write_file', callId = 'call-1', reason = 'write to a file' } = {}) =>
    listener({ agent: { session: { id: sessionId } }, toolName: tool, callId, reason }, async () => ASKED)
  return {
    rt, ctx, home, work, root, startCall, ask,
    rules: rules => rt.approvalRuleEndpoint('approval-rule-set', { id: 'writer', rules }),
    cleanup: async () => { await ctx.dispose(); rmSync(root, { recursive: true, force: true }) },
  }
}

test('a rule that trusts the Bot\'s own folder answers a call inside it, and the user is not asked', async () => {
  const env = await setup()
  try {
    await env.rules([{ tool: '*', scope: 'folder' }])
    env.startCall('writer-chat', { args: { file_path: join(env.work, 'notes', 'todo.md') } })
    assert.equal(await env.ask('writer-chat'), 'allowed-once')
    assert.deepEqual(env.rt.approvalsView(), [])
    const view = await env.rt.approvalRuleEndpoint('approval-rules', {})
    assert.deepEqual(view.bots.find(bot => bot.id === 'writer').rules, [{ tool: '*', scope: 'folder' }])
    assert.equal(view.recent.length, 1)
    assert.deepEqual(
      { botId: view.recent[0].botId, tool: view.recent[0].tool, scope: view.recent[0].scope, target: view.recent[0].target },
      { botId: 'writer', tool: 'write_file', scope: 'folder', target: join(env.work, 'notes', 'todo.md') },
    )
  } finally {
    await env.cleanup()
  }
})

test('a call outside the folder still reaches the user, and a rejection is passed back', async () => {
  const env = await setup()
  try {
    await env.rules([{ tool: '*', scope: 'folder' }])
    env.startCall('room-writer', { args: { file_path: join(tmpdir(), 'elsewhere.txt') } })
    const answer = env.ask('room-writer')
    const [open] = env.rt.approvalsView()
    assert.equal(open.botId, 'writer')
    assert.equal(open.roomId, 'room')
    env.rt.answerApproval(open.id, 'reject')
    assert.equal(await answer, 'rejected')
    assert.deepEqual(env.rt.approvalsView(), [])
    assert.deepEqual((await env.rt.approvalRuleEndpoint('approval-rules', {})).recent, [])
  } finally {
    await env.cleanup()
  }
})

test('a call whose tool names no path is never answered by a folder rule', async () => {
  const env = await setup()
  try {
    await env.rules([{ tool: '*', scope: 'folder' }])
    env.startCall('writer-chat', { tool: 'run_command', args: { command: `rm -rf ${join(env.work, 'notes')}` } })
    assert.equal(await env.ask('writer-chat', { tool: 'run_command' }), ASKED)
  } finally {
    await env.cleanup()
  }
})

test('a rule over the whole machine answers a call that names no path', async () => {
  const env = await setup()
  try {
    await env.rules([{ tool: 'run_command', scope: 'anywhere' }])
    env.startCall('writer-chat', { tool: 'run_command', args: { command: 'ls' } })
    assert.equal(await env.ask('writer-chat', { tool: 'run_command' }), 'allowed-once')
  } finally {
    await env.cleanup()
  }
})

test('a rule for another tool leaves the call to the user', async () => {
  const env = await setup()
  try {
    await env.rules([{ tool: 'read_file', scope: 'anywhere' }])
    env.startCall('writer-chat', { args: { file_path: join(env.work, 'notes.md') } })
    assert.equal(await env.ask('writer-chat'), ASKED)
  } finally {
    await env.cleanup()
  }
})

test('a group folder makes the rule follow the group', async () => {
  const env = await setup()
  try {
    const elsewhere = mkdtempSync(join(tmpdir(), 'dsb-group-'))
    env.rt.roomOf('room').workDir = elsewhere
    await env.rules([{ tool: '*', scope: 'folder' }])
    env.startCall('room-writer', { args: { file_path: join(elsewhere, 'shared.md') } })
    assert.equal(await env.ask('room-writer'), 'allowed-once')
    // The Bot's own folder is outside the group's, so that call is still the user's.
    env.startCall('room-writer', { callId: 'call-2', args: { file_path: join(env.work, 'private.md') } })
    const waited = env.ask('room-writer', { callId: 'call-2' })
    const [open] = env.rt.approvalsView()
    assert.equal(open.tool, 'write_file')
    env.rt.answerApproval(open.id, 'allow')
    assert.equal(await waited, 'allowed-once')
    rmSync(elsewhere, { recursive: true, force: true })
  } finally {
    await env.cleanup()
  }
})

test('rules are checked, deduplicated and cleared', async () => {
  const env = await setup()
  try {
    await assert.rejects(env.rules([{ tool: 'bad tool!', scope: 'folder' }]), /tool name/)
    await assert.rejects(env.rules([{ tool: '*', scope: 'sometimes' }]), /folder or anywhere/)
    await assert.rejects(env.rules({}), /list/)
    await assert.rejects(env.rules(Array.from({ length: 21 }, (_, index) => ({ tool: `tool_${index}`, scope: 'folder' }))), /at most 20/)
    await assert.rejects(env.rt.approvalRuleEndpoint('approval-rule-set', { id: 'ghost', rules: [] }), /no Bot with that id/)
    const saved = await env.rules([{ tool: '*', scope: 'folder' }, { tool: '*', scope: 'folder' }, { tool: 'bash' }])
    assert.deepEqual(saved.rules, [{ tool: '*', scope: 'folder' }, { tool: 'bash', scope: 'folder' }])
    assert.deepEqual(env.rt.state.bots.writer.approvals.rules, saved.rules)
    await env.rt.approvalRuleEndpoint('approval-rule-clear', { id: 'writer' })
    assert.equal(env.rt.state.bots.writer.approvals, undefined)
    assert.deepEqual((await env.rt.approvalRuleEndpoint('approval-rules', {})).bots.find(bot => bot.id === 'writer').rules, [])
  } finally {
    await env.cleanup()
  }
})

test('a watch-only host reads the rules but does not change them', async () => {
  const env = await setup()
  try {
    env.rt.readOnly = () => 'Another DS Bot host holds this team'
    assert.deepEqual((await env.rt.approvalRuleEndpoint('approval-rules', {})).bots.length, 2)
    await assert.rejects(env.rules([{ tool: '*', scope: 'folder' }]), /owns this Bot team/)
  } finally {
    await env.cleanup()
  }
})

test('a team saved with an unreadable rules value asks for everything again', async () => {
  const env = await setup({ state: { ...team(undefined), bots: {
    ...team(undefined).bots,
    writer: { ...team(undefined).bots.writer, approvals: { rules: 'everything' } },
  } } })
  try {
    assert.equal(env.rt.state.bots.writer.approvals, undefined)
    env.startCall('writer-chat', { args: { file_path: join(env.work, 'notes.md') } })
    assert.equal(await env.ask('writer-chat'), ASKED)
  } finally {
    await env.cleanup()
  }
})
