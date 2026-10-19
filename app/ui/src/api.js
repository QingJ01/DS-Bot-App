// The window talks only to ds-bot's own channel in the engine: POST api/bot for reads and
// actions (the Bot views' own `call`), and the live feed api/bot/feed for what changes.
const RETRY_MS = [500, 1000, 2000, 5000]

function parseEvent(block) {
  let event = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7)
    else if (line.startsWith('data: ')) data.push(line.slice(6))
  }
  if (data.length === 0) return undefined
  try { return { event, data: JSON.parse(data.join('\n')) } } catch { return undefined }
}

// Read over fetch: EventSource does not load from the window's own scheme. After a
// break the feed reconnects, and its first event (`hello`) tells the window to catch up.
export function openFeed(onEvent) {
  let stopped = false
  let controller
  const run = async () => {
    for (let failures = 0; !stopped;) {
      controller = new AbortController()
      try {
        const response = await fetch('api/bot/feed', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
        failures = 0
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const parsed = parseEvent(buffer.slice(0, end))
            buffer = buffer.slice(end + 2)
            if (parsed !== undefined) onEvent(parsed.event, parsed.data)
          }
        }
      } catch {
        // The engine restarted or the window is going away; the loop decides.
      }
      if (stopped) return
      onEvent('lost', {})
      await new Promise(resolve => setTimeout(resolve, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]))
      failures += 1
    }
  }
  void run()
  return () => {
    stopped = true
    controller?.abort()
  }
}
