import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// npm installs the peers that the DSH packages ask for, but electron-builder packs only the
// dependencies it finds through `dependencies` and `optionalDependencies`. A package that npm
// installed only as a peer would be left out of the installer, and the Host would not boot.
test('every package that the app runs on is a dependency, not only a peer', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const peerOnly = Object.entries(lock.packages)
    .filter(([path, entry]) => path !== '' && entry.peer && !entry.dev && !entry.devOptional)
    .map(([path, entry]) => `${path.replace(/^.*node_modules\//u, '')}@${entry.version}`)
  assert.deepEqual(peerOnly, [], `add these to "dependencies" in app/package.json: ${peerOnly.join(' ')}`)
})

// A release is tagged with the version of ds-bot, and the installed apps compare their own
// version with the one in the release's latest.yml.
test('the app has the version of ds-bot', () => {
  const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  const app = read('../package.json')
  const lock = read('../package-lock.json')
  const plugin = read('../../ds-bot/package.json')
  assert.equal(app.name, 'ds-bot-app-desktop')
  assert.equal(app.productName, 'DS Bot App')
  assert.equal(app.version, plugin.version)
  assert.equal(lock.packages[''].name, app.name)
  assert.equal(lock.packages[''].version, app.version)
  assert.equal(lock.packages['node_modules/ds-bot'].version, plugin.version)
})
