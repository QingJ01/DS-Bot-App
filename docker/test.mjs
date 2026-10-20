import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

const image = process.argv[2] ?? 'ds-bot:local'
const name = `ds-bot-test-${randomUUID()}`
const data = `${name}-data`
const workspace = `${name}-workspace`
const containers = new Set()
const volumes = []
const tempDir = mkdtempSync(join(tmpdir(), `${name}-`))

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 210_000,
    maxBuffer: 1024 * 1024,
  })
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`docker ${args[0]} failed (${result.status}): ${result.error?.message ?? result.stderr}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result
}

function mounts() {
  return [
    '--mount', `type=volume,src=${data},dst=/data`,
    '--mount', `type=volume,src=${workspace},dst=/workspace`,
  ]
}

function run(args, extraMounts = []) {
  const container = `${name}-${containers.size}`
  containers.add(container)
  return docker(['run', '--rm', '--name', container, '--network', 'none', ...mounts(), ...extraMounts, ...args])
}

function shell(script) {
  return run(['--entrypoint', '/bin/sh', image, '-eu', '-c', script])
}

function startHelp(uid, gid, archive) {
  const archiveMount = archive ? ['--mount', `type=bind,src=${archive},dst=/opt/ds-bot/ds-bot.tgz,readonly`] : []
  return run(['-e', `PUID=${uid}`, '-e', `PGID=${gid}`, image, '--help'], archiveMount)
}

function makeSameVersionArchive() {
  const sourceArchive = join(tempDir, 'original.tgz')
  const changedArchive = join(tempDir, 'revised.tgz')
  const unpacked = join(tempDir, 'unpacked')
  const archiveContainer = `${name}-archive`
  containers.add(archiveContainer)
  docker(['create', '--name', archiveContainer, image])
  try {
    docker(['cp', `${archiveContainer}:/opt/ds-bot/ds-bot.tgz`, sourceArchive])
  } finally {
    docker(['rm', '--force', archiveContainer], { allowFailure: true })
  }

  mkdirSync(unpacked)
  const extract = spawnSync('tar', ['-xzf', sourceArchive, '-C', unpacked], { encoding: 'utf8', timeout: 120_000 })
  if (extract.error || extract.status !== 0) throw new Error(`tar extract failed: ${extract.error?.message ?? extract.stderr}`)
  const manifest = join(unpacked, 'package', 'package.json')
  const version = JSON.parse(readFileSync(manifest, 'utf8')).version
  appendFileSync(join(unpacked, 'package', 'README.md'), '\nDocker same-version archive test marker.\n')
  const pack = spawnSync('tar', ['-czf', changedArchive, '-C', unpacked, 'package'], { encoding: 'utf8', timeout: 120_000 })
  if (pack.error || pack.status !== 0) throw new Error(`tar pack failed: ${pack.error?.message ?? pack.stderr}`)
  assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, version)
  assert.notEqual(
    createHash('sha256').update(readFileSync(sourceArchive)).digest('hex'),
    createHash('sha256').update(readFileSync(changedArchive)).digest('hex'),
  )
  return changedArchive
}

function makeUnsatisfiableArchive(sourceArchive) {
  const archive = join(tempDir, 'unsatisfiable.tgz')
  const unpacked = join(tempDir, 'unsatisfiable')
  mkdirSync(unpacked)
  const extract = spawnSync('tar', ['-xzf', sourceArchive, '-C', unpacked], { encoding: 'utf8', timeout: 120_000 })
  if (extract.error || extract.status !== 0) throw new Error(`tar extract failed: ${extract.error?.message ?? extract.stderr}`)
  const manifest = join(unpacked, 'package', 'package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  pkg.dependencies = { ...pkg.dependencies, [`ds-bot-offline-failure-${randomUUID().replaceAll('-', '')}`]: '0.0.1' }
  writeFileSync(manifest, JSON.stringify(pkg))
  const pack = spawnSync('tar', ['-czf', archive, '-C', unpacked, 'package'], { encoding: 'utf8', timeout: 120_000 })
  if (pack.error || pack.status !== 0) throw new Error(`tar pack failed: ${pack.error?.message ?? pack.stderr}`)
  return archive
}

function checkDataOwner(uid, gid) {
  shell(`
    test -z "$(find -P /data -xdev \\( ! -uid ${uid} -o ! -gid ${gid} \\) -print -quit)"
    test "$(stat -c %a /data/profiles/web/package.json)" = 600
    test -n "$(find /data/.pnpm-store/v11/files -type f -print -quit)"
    test -n "$(find /home/node/.cache/pnpm -type f -name qrcode.jsonl -print -quit)"
    test -n "$(find /home/node/.cache/pnpm -type f -name cliui.jsonl -print -quit)"
    test -z "$(find /home/node/.cache/pnpm \\( ! -uid 1000 -o ! -gid 1000 \\) -print -quit)"
    test "$(cat /data/review-state.txt)" = preserved
    test "$(stat -c %u:%g /workspace)" = 2345:2346
    test "$(stat -c %u:%g /workspace/keep.txt)" = 2345:2346
    test "$(cat /workspace/keep.txt)" = untouched
  `)
}

try {
  for (const volume of [data, workspace]) {
    docker(['volume', 'create', volume])
    volumes.push(volume)
  }

  shell(`
    test "$(stat -c %a /usr/local/bin/entrypoint.sh)" = 755
    /bin/sh -n /usr/local/bin/entrypoint.sh
  `)
  startHelp(1000, 1000)
  shell(`
    test "$(stat -c %u:%g /data/profiles/web/package.json)" = 1000:1000
    printf preserved > /data/review-state.txt
    chmod 600 /data/review-state.txt
    chown 1000:1000 /data/review-state.txt
    printf untouched > /workspace/keep.txt
    chown 2345:2346 /workspace /workspace/keep.txt
    ln -s /workspace /data/workspace-link
    ln -s /workspace/keep.txt /data/file-link
    ln -s /missing-target /data/dangling-link
  `)
  console.log('PASS: executable entrypoint and first start')

  startHelp(1234, 1234)
  checkDataOwner(1234, 1234)
  console.log('PASS: UID/GID migration preserves data and workspace link targets')

  startHelp(1234, 1235)
  checkDataOwner(1234, 1235)
  shell(`
    mkdir -p /data/restored
    printf restored > /data/restored/private.txt
    chmod 700 /data/restored
    chmod 600 /data/restored/private.txt
    chown -R 3456:3457 /data/restored
  `)
  startHelp(1234, 1235)
  checkDataOwner(1234, 1235)
  console.log('PASS: group-only migration and restored files with mixed ownership')

  shell(`
    node -e 'const fs = require("node:fs"); const path = "/data/profiles/web/node_modules/ds-bot/package.json"; const pkg = JSON.parse(fs.readFileSync(path)); pkg.version = "0.0.1"; fs.writeFileSync(path, JSON.stringify(pkg))'
  `)
  startHelp(1234, 1235)
  shell(`
    test "$(jq -r .version /data/profiles/web/node_modules/ds-bot/package.json)" = "$(jq -r .version /opt/dsh-template/profiles/web/node_modules/ds-bot/package.json)"
  `)
  console.log('PASS: offline plugin reinstall after migration')

  const revisedArchive = makeSameVersionArchive()
  const revisedHash = createHash('sha256').update(readFileSync(revisedArchive)).digest('hex')
  const revisedInstall = startHelp(1234, 1235, revisedArchive)
  assert.match(revisedInstall.stdout, /Lockfile passes supply-chain policies/)
  const installedVersion = shell(`jq -r .version /data/profiles/web/node_modules/ds-bot/package.json`).stdout.trim()
  const templateVersion = shell(`jq -r .version /opt/dsh-template/profiles/web/node_modules/ds-bot/package.json`).stdout.trim()
  const installedHash = shell(`cat /data/.ds-bot-image.sha256`).stdout.trim()
  const marker = shell(`grep -q 'Docker same-version archive test marker' /data/profiles/web/node_modules/ds-bot/README.md && echo present || echo missing`).stdout.trim()
  assert.equal(installedVersion, templateVersion, 'the revised archive must keep the installed version aligned with the template')
  assert.equal(installedHash, revisedHash, `the revised archive hash must be recorded\n${revisedInstall.stdout}\n${revisedInstall.stderr}`)
  assert.equal(marker, 'present', 'the changed file from the same-version archive must replace the installed file')
  console.log('PASS: same-version changed archive triggers reinstall and updates its stamp')

  const unsatisfiableArchive = makeUnsatisfiableArchive(revisedArchive)
  const beforeFailure = shell(`
    sha256sum /data/profiles/web/node_modules/ds-bot/package.json /data/profiles/web/node_modules/ds-bot/README.md
  `).stdout
  const failedAt = Date.now()
  const failedInstall = startHelp(1234, 1235, unsatisfiableArchive)
  assert.equal(failedInstall.status, 0, failedInstall.stderr)
  assert.match(failedInstall.stdout, /reinstalling into the web profile/)
  assert.match(failedInstall.stderr, /reinstall failed or timed out/)
  assert.equal(shell(`
    sha256sum /data/profiles/web/node_modules/ds-bot/package.json /data/profiles/web/node_modules/ds-bot/README.md
  `).stdout, beforeFailure)
  shell(`
    test "$(jq -r .version /data/profiles/web/node_modules/ds-bot/package.json)" = "$(jq -r .version /opt/dsh-template/profiles/web/node_modules/ds-bot/package.json)"
    test "$(cat /data/.ds-bot-image.sha256)" = "${revisedHash}"
    grep -q 'Docker same-version archive test marker' /data/profiles/web/node_modules/ds-bot/README.md
  `)
  console.log(`PASS: failed offline plugin reinstall restores the previous profile and archive stamp (${((Date.now() - failedAt) / 1000).toFixed(1)}s)`)

  const beforeRecovery = shell(`
    sha256sum /data/profiles/web/node_modules/ds-bot/package.json /data/profiles/web/node_modules/ds-bot/README.md
  `).stdout
  shell(`
    mkdir -p /data/profiles/.web-ds-bot-snapshot
    cp -a /data/profiles/web /data/profiles/.web-ds-bot-snapshot/profile
    cp -a /data/.ds-bot-image.sha256 /data/profiles/.web-ds-bot-snapshot/stamp
    printf interrupted > /data/profiles/web/node_modules/ds-bot/README.md
    printf wrong > /data/.ds-bot-image.sha256
  `)
  const recovered = startHelp(1234, 1235, revisedArchive)
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.match(recovered.stdout, /recovering an interrupted ds-bot reinstall/)
  assert.doesNotMatch(recovered.stdout, /reinstalling into the web profile/)
  assert.equal(shell(`
    sha256sum /data/profiles/web/node_modules/ds-bot/package.json /data/profiles/web/node_modules/ds-bot/README.md
  `).stdout, beforeRecovery)
  shell(`
    test "$(cat /data/.ds-bot-image.sha256)" = "${revisedHash}"
    test ! -e /data/profiles/.web-ds-bot-snapshot
  `)
  console.log('PASS: startup restores and removes a stale reinstall snapshot')

  const server = `${name}-web`
  containers.add(server)
  docker([
    'run', '--detach', '--rm', '--name', server, '--network', 'none', ...mounts(),
    '-e', 'PUID=1234', '-e', 'PGID=1235', '-e', 'DSH_TELEMETRY_DISABLED=1', image,
  ])
  const probe = `
    const response = await fetch('http://127.0.0.1:3080/');
    if (![200, 401].includes(response.status)) throw new Error('Unexpected HTTP status: ' + response.status);
  `
  const deadline = Date.now() + 45_000
  let ready = false
  while (Date.now() < deadline) {
    if (docker(['exec', server, 'node', '--input-type=module', '-e', probe], { allowFailure: true }).status === 0) {
      ready = true
      break
    }
    await setTimeout(300)
  }
  assert.ok(ready, 'web server must answer HTTP after ownership migration')
  const processOwner = docker(['exec', server, 'stat', '-c', '%u:%g', '/proc/1']).stdout.trim()
  assert.equal(processOwner, '1234:1235', 'web process must run under the new identity')
  const identity = docker(['exec', server, 'gosu', 'node', 'id']).stdout
  assert.match(identity, /uid=1234\(node\) gid=1235\(node\)/)
  docker(['exec', server, 'gosu', 'node', '/bin/sh', '-eu', '-c', `
    test "$(cat /data/review-state.txt)" = preserved
    test "$(cat /data/restored/private.txt)" = restored
    test -w /data/profiles/web/package.json
  `])
  console.log('PASS: web startup and private data access under the new identity')
} finally {
  for (const container of containers) {
    docker(['rm', '--force', container], { allowFailure: true })
  }
  for (const volume of volumes) {
    docker(['volume', 'rm', volume])
  }
  rmSync(tempDir, { recursive: true, force: true })
}
