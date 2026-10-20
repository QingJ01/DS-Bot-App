// Check a packaged app's update on throwaway folders. Windows downloads and installs a feed;
// macOS reads the latest release and opens no browser.
// Usage: node scripts/check-update.mjs <app executable> <feed folder> [--kill] (Windows)
//        node scripts/check-update.mjs <app executable> <version> (macOS)
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const [executable, source, mode] = process.argv.slice(2)
const mac = process.platform === 'darwin'
if (!executable || !source || !existsSync(executable)
  || (mac ? mode !== undefined : !existsSync(join(source, 'latest.yml')))) {
  console.error(`check-update: usage: ${mac
    ? 'node scripts/check-update.mjs <app executable> <version>'
    : 'node scripts/check-update.mjs <app executable> <feed folder with latest.yml> [--kill]'}`)
  process.exit(2)
}
const version = mac ? source : /^version:\s*(\S+)/mu.exec(readFileSync(join(source, 'latest.yml'), 'utf8'))?.[1]
const work = mkdtempSync(join(tmpdir(), 'ds-bot-update-'))
mkdirSync(join(work, 'home'))

const served = []
const server = createServer((request, response) => {
  if (mac) {
    const pathname = new URL(request.url, 'http://feed/').pathname
    if (request.method !== 'GET' || pathname !== '/') { response.writeHead(404).end(); return }
    served.push(pathname)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{
      tag_name: `v${version}`,
      html_url: `https://github.com/QingJ01/DS-Bot-App/releases/tag/v${version}`,
      draft: false,
      prerelease: false,
      assets: [{ name: `DS-Bot-App-${version}-mac-${process.arch}.dmg` }],
    }]))
    return
  }
  const name = basename(decodeURIComponent(new URL(request.url, 'http://feed/').pathname))
  const file = join(source, name)
  served.push(name)
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return }
  response.writeHead(200, { 'content-length': statSync(file).size })
  createReadStream(file).pipe(response)
})
await new Promise((done) => { server.listen(0, '127.0.0.1', done) })
const feed = `http://127.0.0.1:${String(server.address().port)}/`

// Closes the window from inside the page, as check-packed does; the app then quits as it does
// when a user closes it. The page goes away with the window, so the call gets no answer.
async function closeWindow(port, waitForReady = false) {
  const targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
  const page = targets.find(target => target.type === 'page' && target.url.startsWith('dsh-app://app'))
  if (!page) throw new Error('the app window is not there')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  if (waitForReady) {
    const ready = await new Promise((done, reject) => {
      const timer = setTimeout(() => { reject(new Error('the app window did not finish booting')) }, 120_000)
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== 1) return
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message))
        else done(message.result?.result?.value === true)
      })
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: "new Promise(resolve => { const end = Date.now() + 120000; const check = () => { if (document.querySelector('.bt-tile, .bt-row')) resolve(true); else if (Date.now() >= end) resolve(false); else setTimeout(check, 250) }; check() })",
          returnByValue: true,
          awaitPromise: true,
        },
      }))
    })
    if (!ready) throw new Error('the app window did not finish booting')
  }
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }))
}

let failed = false
let app
try {
  // A terminal inside an Electron-based editor may set ELECTRON_RUN_AS_NODE, which turns the app into plain Node.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
  Object.assign(env, { DS_BOT_HOME: join(work, 'home'), DS_BOT_SHELL_DATA: join(work, 'shell'), DS_BOT_UPDATE_URL: feed })
  const port = 9300 + Math.floor(Math.random() * 600)
  app = spawn(resolve(executable), [`--remote-debugging-port=${String(port)}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((done) => { app.once('exit', (code) => { done(code) }) })
  let output = ''
  for (const stream of [app.stdout, app.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => { output += chunk; process.stdout.write(chunk) })
  }
  const updateLine = `DS Bot App: update ${String(version)} ${mac ? 'available' : 'downloaded'}`
  const end = Date.now() + (mac ? 3 : 5) * 60_000
  while (!output.includes(updateLine)) {
    if (mac ? /DS Bot App: update check failed/u.test(output) : /DS Bot App: update failed/u.test(output)) {
      throw new Error('the app reported a failed update')
    }
    if (app.exitCode !== null) {
      const status = mac ? 'the update was found' : 'the update was downloaded'
      throw new Error(`the app exited (code ${String(app.exitCode)}) before ${status}`)
    }
    if (Date.now() > end) throw new Error(mac ? 'the update was not found within 3 minutes' : 'the update was not downloaded within 5 minutes')
    await sleep(500)
  }
  if (mac && !served.includes('/')) throw new Error('the release feed was not requested')
  console.log(`check-update: ${updateLine}; the feed served ${served.join(', ')}`)
  if (mac) {
    await closeWindow(port, true)
    const code = await Promise.race([exited, sleep(60_000).then(() => 'timeout')])
    if (code === 'timeout') throw new Error('the app did not exit after its window closed')
    if (code !== 0) throw new Error(`the app exited with code ${String(code)}`)
    console.log('check-update: the app closed without installing')
  } else if (mode === '--kill') {
    spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
    await exited
    console.log('check-update: ended the app, so nothing was installed')
  } else {
    await closeWindow(port)
    const code = await Promise.race([exited, sleep(60_000).then(() => 'timeout')])
    if (code === 'timeout') throw new Error('the app did not exit after its window closed')
    if (code !== 0) throw new Error(`the app exited with code ${String(code)}, so it does not install the update`)
    console.log('check-update: the app closed; its installer runs now')
  }
  console.log('check-update: passed')
} catch (error) {
  failed = true
  console.error(`check-update: FAILED: ${error instanceof Error ? error.message : String(error)}`)
  if (app?.exitCode === null) {
    if (mac) app.kill()
    else spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}
server.close()
await sleep(500)
rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
process.exit(failed ? 1 : 0)
