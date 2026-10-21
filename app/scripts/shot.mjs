// Dev check: run the app on throwaway folders, save a screenshot of its window, print what the page shows,
// then close the window the way a user does and wait until the app has exited.
// Usage: node scripts/shot.mjs <out.png> [seconds to wait before the screenshot]
// Set DS_BOT_HOME and DS_BOT_SHELL_DATA to throwaway folders, plus the model variables for the Host
// (for the ds-bot mock model: DEEPSEEK_BASE_URL=http://127.0.0.1:<port>/v1 and DEEPSEEK_API_KEY=mock-key).
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const [out = 'shot.png', wait = '20'] = process.argv.slice(2)
if (!process.env.DS_BOT_HOME || !process.env.DS_BOT_SHELL_DATA) {
  console.error('shot: set DS_BOT_HOME and DS_BOT_SHELL_DATA to throwaway folders')
  process.exit(2)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron')
const port = 9300 + Math.floor(Math.random() * 600)
// A terminal inside an Electron-based editor may set ELECTRON_RUN_AS_NODE, which turns the app into plain Node.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
const child = spawn(electron, [root, `--remote-debugging-port=${String(port)}`], { stdio: 'inherit', env })
const exited = new Promise((done) => { child.once('exit', (code, signal) => { done({ code, signal }) }) })

async function appPage(deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//u.test(target.url))
      if (page) return page
    } catch {
      // The debugging port is not listening yet.
    }
    await sleep(500)
  }
  throw new Error('shot: the app window did not appear')
}

function devtools(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let next = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const opened = new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = next++
    pending.set(id, { resolve: done, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { opened, call, close: () => { socket.close() } }
}

try {
  const page = await appPage(Date.now() + 60_000)
  const cdp = devtools(page.webSocketDebuggerUrl)
  await cdp.opened
  await sleep(Number(wait) * 1000)
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(out), Buffer.from(data, 'base64'))
  const { result } = await cdp.call('Runtime.evaluate', {
    expression: 'JSON.stringify({ title: document.title, text: document.body.innerText.slice(0, 600) })', returnByValue: true,
  })
  console.log(`shot: saved ${resolve(out)}`)
  console.log(`shot: page ${String(result.value)}`)
  // The page goes away with the window, so this call gets no answer.
  void cdp.call('Runtime.evaluate', { expression: 'window.close()' }).catch(() => undefined)
} catch (error) {
  console.error(error)
  child.kill()
  process.exitCode = 1
}
const outcome = await Promise.race([exited, sleep(40_000).then(() => undefined)])
if (outcome === undefined) {
  console.error('shot: the app did not exit after its window closed')
  child.kill()
  process.exitCode = 1
} else {
  console.log(`shot: app exited (code ${String(outcome.code)}, signal ${String(outcome.signal)})`)
}
process.exit()
