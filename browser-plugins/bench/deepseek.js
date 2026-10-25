const ENDPOINT_PATH = '/chat/completions'

export function benchConfig() {
  return {
    baseUrl: process.env.BENCH_BASE_URL?.replace(/\/$/, ''),
    model: process.env.BENCH_MODEL,
    apiKey: process.env.BENCH_API_KEY,
  }
}

export async function completeBench({ messages, tools, timeoutMs = 90_000 }) {
  const { baseUrl, model, apiKey } = benchConfig()
  if (!baseUrl || !model || !apiKey) {
    throw new Error('Set BENCH_BASE_URL, BENCH_MODEL, and BENCH_API_KEY to run the browser benchmark.')
  }
  const send = async (payload, signal) => {
    const response = await fetch(`${baseUrl}${ENDPOINT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = body?.error?.message || response.statusText
      throw new Error(`Benchmark model ${response.status}: ${detail}`)
    }
    return body
  }
  const payload = { model, messages, max_tokens: 4096 }
  if (tools?.length) payload.tools = tools
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = await send(payload, controller.signal)
    return { ...body, vision: 'accepted' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/image|multimodal|vision|unsupported/i.test(message)) throw error
    const retry = new AbortController()
    const retryTimer = setTimeout(() => retry.abort(), timeoutMs)
    try {
      const stripped = messages.map(message => {
        if (!Array.isArray(message.content)) return message
        const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
        return { ...message, content: text || '(screenshot omitted)' }
      })
      return { ...(await send({ ...payload, messages: stripped }, retry.signal)), vision: 'rejected' }
    } finally {
      clearTimeout(retryTimer)
    }
  } finally {
    clearTimeout(timer)
  }
}
