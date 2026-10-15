// A Bot retains DS Bot conversations and team tools while its bound Hermes worker
// executes tasks. The same worker session follows it between private and group chats.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

export function workerSession(botId) {
  return `dsbot-${createHash('sha256').update(botId).digest('hex').slice(0, 32)}`
}

export async function runWorker(worker, { botId, name, task, context = '', signal }, request = fetch) {
  const key = (await readFile(worker.keyFile, 'utf8')).trim()
  const url = new URL('v1/chat/completions', worker.url.endsWith('/') ? worker.url : `${worker.url}/`)
  const response = await request(url, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`,
      'X-Hermes-Session-Id': workerSession(botId), 'X-Hermes-Session-Key': workerSession(botId) },
    body: JSON.stringify({ stream: false, messages: [
      { role: 'system', content: `You are ${name}, the actual Hermes worker for this DS Bot identity. Private chats and group work belong to the same identity. Use your tools to perform requested work and keep durable user facts in your memory. Do not claim actions without evidence. The DS Bot side handles messages to teammates and group administration.\n${context}` },
      { role: 'user', content: task },
    ] }),
  })
  if (!response.ok) throw new Error(`Hermes worker returned HTTP ${response.status}`)
  const data = await response.json()
  const choice = data.choices?.[0]
  if (data.error || data.hermes?.failed || choice?.finish_reason === 'error') throw new Error('Hermes worker failed; no successful result was received.')
  const text = choice?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('Hermes worker returned no answer.')
  return { sessionId: response.headers.get('X-Hermes-Session-Id') ?? workerSession(botId), text }
}

export function install(rt) {
  const workers = rt.config.hermes?.workers ?? {}
  if (Object.keys(workers).length === 0) return
  const queues = new Map()
  const workerOf = id => {
    const bot = rt.botOf(rt.selfOf(id))
    return bot && workers[bot.name] ? { bot, worker: workers[bot.name] } : undefined
  }
  rt.ctx.effect(() => rt.ctx.systemPrompt.section({
    name: 'bot-hermes-worker', order: 646, interpolate: false,
    text: context => workerOf(context?.agent?.id) ? [
      '# Your Hermes worker',
      'You are bound to an actual Hermes worker. For every new user or teammate task, call hermes_task with the complete request before answering. Include relevant conversation context; never replace its execution with a claim or an action on this DSH host.',
      'Use DS Bot tools for remember/recall, messaging teammates and managing groups. Forward facts learned in private or group chat to your worker. Preserve important user facts with remember so all your conversations know them.',
      'Report the actual worker result. If it fails, report failure. A reply from a teammate that only acknowledges delivery needs no worker call.',
    ].join('\n') : '',
  }), 'ds-bot: Hermes identity')
  rt.ctx.tools.register(defineTool({
    name: 'hermes_task', description: 'Send the current task to your bound Hermes worker, with persistent history shared across your private and group chats. Wait for its actual result.',
    parameters: {
      task: { type: 'string', required: true, description: 'Complete request and all relevant facts, including what teammates said. Do not omit details the worker needs.' },
    }, output,
    async execute({ task }, exec) {
      await rt.load()
      const binding = workerOf(exec.agent?.id)
      if (!binding) throw new Error('This Bot has no Hermes worker configured.')
      const { bot, worker } = binding
      const room = rt.roomOf(rt.groupOwners.get(exec.agent?.id)?.roomId)
      const context = `Current conversation: ${room ? `group ${room.name}` : 'private chat'}.\n${rt.currentMemory?.(bot) ?? ''}`
      const timeout = AbortSignal.timeout(worker.timeoutMs ?? 600000)
      const signal = exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
      const previous = queues.get(bot.id) ?? Promise.resolve()
      const run = previous.catch(() => {}).then(() => {
        signal.throwIfAborted()
        return runWorker(worker, { botId: bot.id, name: bot.name, task, context, signal })
      })
      queues.set(bot.id, run)
      try {
        const result = await run
        return JSON.stringify({ worker: bot.name, ...result })
      } finally { if (queues.get(bot.id) === run) queues.delete(bot.id) }
    },
  }))
}
