import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repo = fileURLToPath(new URL('../', import.meta.url))
const signing = 'apps/mobile/signing/DeepSeekBot.p12'
const container = readFileSync(join(repo, signing))

function scan(files) {
  const root = mkdtempSync(join(tmpdir(), 'ds-bot-scan-'))
  try {
    const baseline = Object.fromEntries(['LICENSE', 'ds-bot/LICENSE', 'ds-bot/package.json', 'README.md', 'README.zh.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'AGENTS.md', '.gitignore']
      .map(file => [file, file === 'ds-bot/package.json' ? readFileSync(join(repo, file)) : 'fixture']))
    for (const [file, data] of Object.entries({ ...baseline, ...files })) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), data)
    }
    const result = spawnSync(process.execPath, [join(repo, 'scripts/scan.mjs'), root], { encoding: 'utf8', env: { ...process.env, SCAN_EXTRA_PATTERNS: '' } })
    if (result.error) throw result.error
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the exact reviewed encrypted signing container stays visible as an accepted finding', () => {
  const result = scan({ [signing]: container })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /encrypted-signing-container/u)
})

test('changed signing bytes and other key files remain forbidden', () => {
  const changed = Buffer.from(container)
  changed[changed.length - 1] ^= 1
  for (const files of [{ [signing]: changed }, { 'other.p12': container }, { 'other.key': 'fixture' }]) {
    const result = scan(files)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /forbidden-file/u)
  }
})

test('the signing exception does not disable secret detection in other files', () => {
  const result = scan({ [signing]: container, 'leak.txt': 'sk-' + 'A'.repeat(30) })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /secret-openai-style/u)
})

test('draft markers are detected without flagging ordinary draft prose', () => {
  const draft = ['草', '稿'].join('')
  const prose = scan({ 'draft-prose.md': ['缓存的', draft, '消息可稍后继续编辑。'].join('') })
  assert.equal(prose.status, 0, prose.stdout + prose.stderr)

  const markers = [
    ['TBD', ['TBD', '('].join('')],
    ['English placeholder', ['DRAFT', ' for'].join('')],
    ['Chinese heading', draft],
    ['Markdown heading', ['# ', draft].join('')],
    ['Chinese bracket tag', ['【', draft, '】'].join('')],
    ['square bracket tag', ['[', draft, ']'].join('')],
  ]
  for (const [name, marker] of markers) {
    const result = scan({ 'draft-marker.md': marker })
    assert.equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /draft-marker/u)
  }
})
