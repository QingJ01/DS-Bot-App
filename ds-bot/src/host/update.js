// This fork updates from its own immutable GitHub release source through DSH's
// public plugin manager. Development checkouts are never replaced.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
export const OFFICIAL_REGISTRY = 'https://registry.npmjs.org/'
export const MIRROR_REGISTRY = 'https://registry.npmmirror.com/'
// Every window that opens asks; within this long the last answer stands.
export const CHECK_TTL_MS = 10 * 60_000
export const FETCH_TIMEOUT_MS = 8000
// The first check waits until the host has settled its own start.
const STARTUP_DELAY_MS = 15_000
const VERSION = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\+[\w.]+)?$/

/** A release version without its `v` and build metadata, or null. */
export const cleanVersion = value => VERSION.exec(String(value ?? '').trim())?.[1] ?? null

/** Whether version `a` is newer than `b` (semver order, prereleases before their release). */
export function newer(a, b) {
  const parse = (value) => {
    const [core, pre] = (cleanVersion(value) ?? '0.0.0').split(/-(.*)/s)
    return { nums: core.split('.').map(Number), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let index = 0; index < 3; index++) if (x.nums[index] !== y.nums[index]) return x.nums[index] > y.nums[index]
  if (x.pre === y.pre) return false
  if (x.pre === null) return true
  if (y.pre === null) return false
  return x.pre.localeCompare(y.pre, 'en', { numeric: true }) > 0
}

/**
 * How the profile installed this package, from the plugin manager's `source` spec:
 * `registry` (name@range), `git` (with `owner`, `repo`, the version `ref` and the
 * other fragment parts when it pins a GitHub tag), `path` (link:, file: or a folder),
 * `tarball`, or `unknown`.
 */
export function sourceOf(spec) {
  const text = typeof spec === 'string' ? spec.trim().replace(/^ds-bot@(?=(?:github:|git\+|https?:|file:))/, '') : ''
  if (text === '') return { kind: 'unknown' }
  if (/^link:/i.test(text)) return { kind: 'path' }
  if (/\.(?:tgz|tar\.gz)(?:[?#].*)?$/i.test(text)) return { kind: 'tarball' }
  if (/^(link|file):/i.test(text) || /^([a-z]:[\\/]|[\\/]|~|\.)/i.test(text)) return { kind: 'path' }
  const github = /^(?:github:|git\+https:\/\/github\.com\/|https:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.*))?$/i.exec(text)
  const gitLike = /^(git\+|git:|git@|github:|gitlab:|bitbucket:)/i.test(text) || /\.git(#|$)/i.test(text)
  if (github && (gitLike || !text.startsWith('@'))) {
    const parts = (github[3] ?? '').split('&').filter(Boolean)
    const ref = parts.find(part => !part.includes(':')) ?? ''
    return {
      kind: 'git', owner: github[1], repo: github[2],
      ...(cleanVersion(ref) || /^[a-f0-9]{40}$/i.test(ref) ? { ref } : {}),
      rest: parts.filter(part => part !== ref),
    }
  }
  if (gitLike) return { kind: 'git' }
  if (/^https?:/i.test(text)) return { kind: 'tarball' }
  return { kind: 'registry' }
}

const normalizeRegistry = url => `${String(url).trim().replace(/\/+$/, '')}/`
export const encodeName = name => (name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name))

export const fetchJson = async (url, headers = {}) => {
  const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw Object.assign(new Error(`Update service answered ${response.status}`), { status: response.status })
  return response.json()
}

// The registries the plugin manager installs from, in its order: its configured
// first one (else pnpm's own), then the fallbacks, unless that first one is private.
export async function registryPlan(config, manager) {
  if (typeof config.updateRegistry === 'string' && config.updateRegistry !== '') return [normalizeRegistry(config.updateRegistry)]
  const configured = await Promise.resolve(manager?.registries?.()).catch(() => null)
  if (!configured) return [OFFICIAL_REGISTRY, MIRROR_REGISTRY]
  const fallbacks = (configured.fallbackRegistries ?? []).map(normalizeRegistry)
  const own = configured.resolved ? normalizeRegistry(configured.resolved) : null
  const first = configured.registry ? normalizeRegistry(configured.registry) : own ?? OFFICIAL_REGISTRY
  const isPublic = first === OFFICIAL_REGISTRY || fallbacks.includes(first)
  return isPublic ? [...new Set([first, ...fallbacks])] : [first]
}

// The plugin manager's `source` for this package; DSH releases before it reported
// one leave the profile's own dependency entry to say the same.
export async function installSpecOf(ctx) {
  const manager = ctx.get?.('pluginManager')
  const bundles = await Promise.resolve(manager?.listBundles?.()).catch(() => null)
  const own = Array.isArray(bundles) ? bundles.find(bundle => bundle.name === PKG.name) : undefined
  if (typeof own?.source === 'string') return own.source
  const dir = ctx.get?.('profileContext')?.dir
  if (typeof dir !== 'string') return undefined
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies?.[PKG.name]
  } catch { return undefined }
}

// The public repository the releases live in, for tags and the "what's new" link.
export const repoSlug = () =>
  /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(String(PKG.repository?.url ?? PKG.repository ?? ''))?.[1] ?? null

const repoUrl = () => {
  const repo = repoSlug()
  return repo ? `https://github.com/${repo}` : null
}
const releasesUrl = () => {
  const repo = repoUrl()
  return repo ? `${repo}/releases` : (PKG.homepage ?? null)
}

// Revision archives live on the base release, but their source has its own tag.
export function releaseRef(release) {
  const version = cleanVersion(release?.tag_name)
  if (!version) return null
  const names = new Set((release.assets ?? []).map(asset => asset.name))
  let revision = 0
  for (const name of names) {
    const match = /^ds-bot-(\d+\.\d+\.\d+)-r([1-9]\d*)\.tgz$/.exec(name)
    const value = Number(match?.[2])
    if (match?.[1] === version && Number.isSafeInteger(value) && value > revision && names.has(`SHA256SUMS-r${value}`)) revision = value
  }
  return revision ? `v${version}-r${revision}` : release.tag_name
}

export const STARS_TTL_MS = 60 * 60_000

const revisionOf = (ref, version) => ref === `v${version}` || ref === version ? 0
  : ref?.startsWith(`v${version}-r`) && /^[1-9]\d*$/.test(ref.slice(`v${version}-r`.length)) ? Number(ref.slice(`v${version}-r`.length)) : null
const slugOf = value => /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(String(value?.url ?? value ?? ''))?.[1]
const failure = (code, message) => Object.assign(new Error(message), { updateCode: code })
const ownSource = source => {
  const [owner, repo] = (repoSlug() ?? '').split('/')
  return source.owner?.toLowerCase() === owner?.toLowerCase() && [repo, 'DS-Bot', 'DeepSeek-Bot'].some(name => name?.toLowerCase() === source.repo?.toLowerCase())
}

export function updateFailure(cause) {
  const text = String(cause?.packageResult?.output ?? cause?.error?.diagnostic ?? cause?.message ?? '')
  const code = cause?.updateCode ?? cause?.packageResult?.kind ?? cause?.error?.code
  if (code === 'source-changed') return { code, message: 'The installation source changed. Check for updates again.' }
  if (code === 'release-invalid') return { code, message: 'The release is incomplete or its source could not be verified. Try checking again later.' }
  if (code === 'version-mismatch') return { code, message: 'The installed version does not match the checked release. Open Harness Plugins to inspect it.' }
  if (code === 'bundle-in-use' || code === 'remove-unavailable') return { code, message: 'The current installation could not be removed. Close programs using the plugin and retry.' }
  if (code === 'restore-failed') return { code, message: String(cause?.message ?? 'The update and previous installation could not be restored.') }
  if (/ERR_PNPM_(?:MISSING_TARBALL_INTEGRITY|TARBALL_INTEGRITY)|EINTEGRITY/.test(text) || code === 'integrity') return { code: 'integrity', message: 'Package verification failed. Retry the update; if it still fails, open Harness Plugins for installation details.' }
  if (cause?.status === 403 || cause?.status === 429) return { code: 'rate-limit', message: 'GitHub limited update requests. Wait a few minutes and check again.' }
  if (code === 'build-blocked' || cause?.pendingBuilds?.length) return { code: 'build-blocked', message: 'Harness requires build approval. Review it in Harness Plugins, then retry the update.' }
  if (code === 'incompatible-version') return { code, message: 'This release needs a different Harness version. Open Harness Plugins for compatibility details.' }
  if (code === 'disk-full' || /ENOSPC/.test(text)) return { code: 'disk-full', message: 'There is not enough disk space. Free some space and retry the update.' }
  if (code === 'permission' || /EACCES|EPERM/.test(text)) return { code: 'permission', message: 'Harness could not write the update. Close programs locking the plugin files and retry.' }
  if (code === 'timeout' || cause?.name === 'TimeoutError') return { code: 'timeout', message: 'The update request timed out. Check the connection and retry.' }
  return { code: 'network', message: 'The update could not finish. Check the connection or open Harness Plugins for installation details.' }
}

export function install(rt) {
  const { ctx, config } = rt
  const enabled = config.updateCheck !== false
  const manager = () => ctx.get?.('pluginManager')
  const receiptPath = typeof rt.home === 'string' ? join(rt.home, 'update-receipt.json') : null
  let receipt
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) } catch { /* first install */ }
  const status = {
    name: PKG.name, current: PKG.version, latest: null, source: 'unknown', notesUrl: releasesUrl(),
    currentRevision: null, latestRevision: null, latestRef: null, checkedAt: 0, phase: 'idle',
    installed: null, error: null, errorCode: null, checkError: null, checkErrorCode: null,
    blockedReason: null, restartRequired: false, stage: null,
  }
  let target = null
  let checking = null
  // A remove-and-install update under hot reload drops this host with its bundle;
  // a note in the data folder carries the result to the start that follows it.
  const markerPath = typeof rt.home === 'string' ? join(rt.home, 'update.json') : null
  const safeWarn = (...args) => { try { rt.warn(...args) } catch { /* the host can be disposed */ } }
  if (markerPath !== null && existsSync(markerPath)) {
    let marker = null
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    } catch (error) {
      safeWarn('ds-bot: could not read the update note: %s', error?.message ?? error)
    }
    if (marker === null) {
      try { unlinkSync(markerPath) } catch { /* gone is what we want */ }
    } else if (typeof marker.error === 'string') {
      safeWarn('ds-bot: the update to %s did not finish: %s', marker.to ?? 'a newer version', marker.error.slice(0, 600))
      Object.assign(status, { phase: 'failed', error: marker.error.slice(0, 600), errorCode: marker.errorCode ?? 'network' })
      try { unlinkSync(markerPath) } catch { /* gone is what we want */ }
    } else if (marker.to === PKG.version) {
      Object.assign(status, { phase: 'updated', installed: PKG.version })
      try { unlinkSync(markerPath) } catch { /* gone is what we want */ }
    } else if (marker.from !== PKG.version) {
      safeWarn('ds-bot: the update to %s did not finish: %s', marker.to ?? 'a newer version', 'the install did not complete')
      Object.assign(status, { phase: 'failed', error: 'The update did not complete. Check for updates and retry.', errorCode: 'network' })
      try { unlinkSync(markerPath) } catch { /* gone is what we want */ }
    }
    // A clean note on the version that wrote it stays: a reload can still be
    // running the old modules (the hoisted profile layout keeps one path), and
    // the next start that runs the new code reports the update then.
  }

  const view = () => ({
    ...status,
    enabled,
    repoUrl: repoUrl(),
    available: !['installed', 'updated'].includes(status.phase) && target?.upgrade === true,
    canRepair: !['installed', 'updated'].includes(status.phase) && target?.repair === true,
    targetId: target?.id ?? null,
  })

  let stars = { count: null, at: 0 }
  let starring = null
  async function repoStars() {
    const repo = repoSlug()
    if (repo === null) return null
    if (Date.now() - stars.at < STARS_TTL_MS) return stars.count
    starring ??= fetchJson(`https://api.github.com/repos/${repo}`, { 'user-agent': `${PKG.name}/${PKG.version}` })
      .then(info => { if (Number.isInteger(info?.stargazers_count)) stars = { count: info.stargazers_count, at: Date.now() } })
      .catch(error => rt.warn('ds-bot: star count failed: %s', error?.message ?? error))
      .finally(() => { starring = null })
    await starring
    return stars.count
  }

  const github = path => fetchJson(`https://api.github.com/repos/${repoSlug()}/${path}`, { 'user-agent': `${PKG.name}/${PKG.version}` })
  async function currentRevision(source, spec, latest) {
    if (source.ref === latest.commit) return latest.revision
    if (receipt?.version === PKG.version && receipt?.commit === source.ref) return revisionOf(receipt.ref, PKG.version)
    if (source.kind === 'git' && source.ref) {
      const named = revisionOf(source.ref, PKG.version)
      if (named !== null) return named
      if (/^[a-f0-9]{40}$/i.test(source.ref) && latest.version === PKG.version) {
        const tags = await github(`git/matching-refs/tags/v${PKG.version}`)
        if (Array.isArray(tags)) for (const tag of tags.slice(0, 100)) {
          const ref = String(tag.ref ?? '').replace(/^refs\/tags\//, '')
          const revision = revisionOf(ref, PKG.version)
          if (revision === null) continue
          const commit = tag.object?.type === 'commit' ? tag.object.sha : (await github(`commits/${encodeURIComponent(ref)}`))?.sha
          if (commit === source.ref) return revision
        }
        return null
      }
    }
    if (source.kind === 'tarball') {
      const file = String(spec).split(/[\\/]/).at(-1).split(/[?#]/)[0]
      if (file === `ds-bot-${PKG.version}.tgz`) return 0
      const suffix = file.startsWith(`ds-bot-${PKG.version}-r`) ? file.slice(`ds-bot-${PKG.version}-r`.length).replace(/\.tgz$/, '') : ''
      if (/^[1-9]\d*$/.test(suffix)) return Number(suffix)
    }
    return source.kind === 'registry' ? 0 : null
  }

  async function runCheck() {
    target = null
    Object.assign(status, { phase: 'idle', error: null, errorCode: null, latest: null, latestRef: null, latestRevision: null, currentRevision: null, checkError: null, checkErrorCode: null, blockedReason: null })
    try {
      if (process.env.DS_BOT_APP === '1') {
        status.source = 'app'
        return
      }
      const spec = await installSpecOf(ctx)
      const source = sourceOf(spec)
      status.source = source.kind
      if (source.kind === 'path' || (source.kind === 'git' && !source.ref)) {
        status.blockedReason = 'Update this development checkout using Git.'
        return
      }
      if (source.kind === 'unknown' || (source.kind === 'git' && !ownSource(source))) {
        status.blockedReason = 'This installation uses a custom source. Update it through Harness Plugins.'
        return
      }
      if (typeof manager()?.installBundle !== 'function') {
        status.blockedReason = 'The DSH plugin manager is not available in this profile'
        return
      }
      const release = await github('releases/latest')
      const version = cleanVersion(release?.tag_name)
      if (!version || release.draft || release.prerelease) throw failure('release-invalid')
      const ref = releaseRef(release)
      const revision = revisionOf(ref, version)
      const suffix = revision ? `-r${revision}` : ''
      const names = new Set((release.assets ?? []).map(asset => asset.name))
      if (!names.has(`ds-bot-${version}${suffix}.tgz`) || !names.has(revision ? `SHA256SUMS-r${revision}` : 'SHA256SUMS')) throw failure('release-invalid')
      const commit = (await github(`commits/${encodeURIComponent(ref)}`))?.sha
      if (!/^[a-f0-9]{40}$/i.test(commit ?? '')) throw failure('release-invalid')
      const manifest = await fetchJson(`https://raw.githubusercontent.com/${repoSlug()}/${commit}/ds-bot/package.json`)
      if (manifest?.name !== PKG.name || cleanVersion(manifest.version) !== version || slugOf(manifest.repository)?.toLowerCase() !== repoSlug()?.toLowerCase() || !manifest.dsh?.bundle) throw failure('release-invalid')
      const installedRevision = await currentRevision(source, spec, { version, revision, commit })
      Object.assign(status, { latest: version, latestRef: ref, latestRevision: revision, currentRevision: installedRevision })
      const upgrade = newer(version, PKG.version) || (version === PKG.version && installedRevision !== null && revision > installedRevision)
      const repair = version === PKG.version && (installedRevision === null || installedRevision <= revision)
      target = { id: `${ref}:${commit}`, sourceSpec: spec, version, revision, ref, commit, upgrade, repair,
        spec: `github:${repoSlug()}#${commit}&path:ds-bot` }
      if (receipt?.commit === source.ref && receipt?.version === version && newer(version, PKG.version)) Object.assign(status, { phase: 'installed', installed: receipt.ref, restartRequired: true })
    } catch (cause) {
      const error = updateFailure(cause)
      Object.assign(status, { checkError: error.message, checkErrorCode: error.code })
      rt.warn('ds-bot: update check failed: %s', cause?.message ?? cause)
    } finally { status.checkedAt = Date.now() }
  }

  async function check({ fresh = false } = {}) {
    if (!enabled || ['installing', 'installed', 'updated'].includes(status.phase)) return view()
    if (checking) { await checking; return view() }
    if (!fresh && Date.now() - status.checkedAt < CHECK_TTL_MS) return view()
    checking = runCheck().finally(() => { checking = null })
    await checking
    return view()
  }

  function start({ targetId, repair = false } = {}) {
    if (status.phase === 'installing' || status.phase === 'installed' || status.phase === 'updated') return view()
    if (!enabled || !target || (!target.upgrade && !(repair && target.repair))) throw new Error('No DS Bot update is available')
    if (targetId !== undefined && targetId !== target.id) throw new Error('The available update changed. Check for updates again.')
    const chosen = target
    Object.assign(status, { phase: 'installing', stage: 'preparing', error: null, errorCode: null })
    const mark = (error, errorCode) => {
      if (markerPath === null) return
      try {
        writeFileSync(markerPath, JSON.stringify({
          from: PKG.version, to: chosen.version, spec: chosen.spec, startedAt: new Date().toISOString(),
          ...(error === undefined ? {} : { error }),
          ...(errorCode === undefined ? {} : { errorCode }),
        }), { mode: 0o600 })
      } catch { /* a note that cannot be written just is not there */ }
    }
    const unmark = () => { if (markerPath !== null) try { unlinkSync(markerPath) } catch { /* already gone */ } }
    const namedSpec = value => value.startsWith(`${PKG.name}@`) ? value : `${PKG.name}@${value}`
    const installResult = async (service, spec, expectedVersion = chosen.version) => {
      const result = await service.installBundle(spec, { enabled: true })
      if (result?.error || !['applied', 'restart-required'].includes(result?.application)) throw result ?? new Error('Install failed')
      if (result.version !== undefined && cleanVersion(result.version) !== expectedVersion) throw failure('version-mismatch')
      return result
    }
    const persistReceipt = async () => {
      if (!receiptPath) return
      const record = { spec: chosen.spec, version: chosen.version, ref: chosen.ref, commit: chosen.commit, installedAt: Date.now() }
      const temp = `${receiptPath}.${randomUUID()}.tmp`
      try {
        await mkdir(rt.home, { recursive: true })
        await writeFile(temp, JSON.stringify(record), { mode: 0o600 })
        await rename(temp, receiptPath)
        receipt = record
      } catch (error) { safeWarn('ds-bot: update receipt could not be saved: %s', error?.message ?? error) }
    }
    void (async () => {
      if (await installSpecOf(ctx) !== chosen.sourceSpec) throw failure('source-changed')
      const service = manager()
      if (typeof service?.installBundle !== 'function') throw failure('source-changed')
      status.stage = 'installing'
      // Naming the dependency replaces an old tarball BEFORE pnpm resolves it.
      // The bare GitHub spec can otherwise revisit a broken legacy lock entry.
      const serviceSpec = namedSpec(`${PKG.name}@${chosen.spec}`)
      let result
      try {
        result = await installResult(service, serviceSpec)
      } catch (cause) {
        if (cause?.error?.code !== 'already-installed') throw cause
        if (typeof service.removeBundle !== 'function') throw failure('remove-unavailable')
        mark()
        const removed = await service.removeBundle(PKG.name)
        if (removed?.error || !['applied', 'restart-required'].includes(removed?.application)) {
          unmark()
          const removeError = removed?.error
          throw failure(removeError?.code ?? 'bundle-in-use', removeError?.message ?? 'The installed bundle could not be removed')
        }
        try {
          result = await installResult(service, serviceSpec)
        } catch (installError) {
          const installHint = updateFailure(installError)
          let restoreError
          try {
            await installResult(service, namedSpec(chosen.sourceSpec), PKG.version)
          } catch (cause) {
            restoreError = updateFailure(cause)
          }
          if (restoreError) {
            const combined = failure('restore-failed', `Update install failed: ${installHint.message} Previous install restore failed: ${restoreError.message}`)
            mark(combined.message, combined.updateCode)
            throw combined
          }
          mark(`Update install failed: ${installHint.message}. The previous installation was restored.`, installHint.code)
          throw installError
        }
      }
      Object.assign(status, { phase: 'installed', stage: 'done', installed: chosen.ref, restartRequired: result.application === 'restart-required' })
      await persistReceipt()
    })().catch(cause => {
      const error = updateFailure(cause)
      Object.assign(status, { phase: 'failed', stage: null, error: error.message, errorCode: error.code })
      safeWarn('ds-bot: update to %s failed: %s', chosen.ref, error.message)
    })
    return view()
  }

  if (enabled) ctx.effect(() => {
    const timer = setTimeout(() => { void check() }, STARTUP_DELAY_MS)
    timer.unref?.()
    return () => clearTimeout(timer)
  }, 'ds-bot: update check')
  Object.assign(rt, { updateCheck: check, updateStart: start, updateView: view, repoStars })
}
