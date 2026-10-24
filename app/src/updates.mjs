// Windows and a Linux AppImage download and install updates; macOS and a Linux deb ask before
// opening the release page.

export const UPDATE_TEXT = {
  en: {
    ready: version => `DS Bot App ${version} is ready to install.`,
    readyDetail: 'Restart now to update, or it is installed the next time you quit.',
    restart: 'Restart now', later: 'Later',
    onFailure: version => `DS Bot App ${version} is installed when its download is done, and then DS Bot App opens again.`,
    available: version => `DS Bot App ${version} is available.`,
    availableDetail: 'This version cannot update itself. Download the new version from its release page, then replace DS Bot App in Applications.',
    download: 'Download',
    onFailurePage: version => `DS Bot App ${version} is available. After this box, its download page opens.`,
  },
  zh: {
    ready: version => `DS Bot App ${version} 已经下载好。`,
    readyDetail: '现在重启就能更新；不重启的话，下次退出时安装。',
    restart: '立即重启', later: '稍后',
    onFailure: version => `DS Bot App ${version} 下载完会自动安装，然后重新打开。`,
    available: version => `DS Bot App ${version} 已经发布。`,
    availableDetail: '这个版本不能自己更新。请到发布页下载新版，再用它替换「应用程序」里的 DS Bot App。',
    download: '下载',
    onFailurePage: version => `DS Bot App ${version} 已经发布。关掉这个对话框后，会打开它的下载页面。`,
  },
}

const CHECK_EVERY_MS = 4 * 60 * 60_000
export const RELEASES_URL = 'https://api.github.com/repos/QingJ01/DS-Bot-App/releases?per_page=20'

function parseVersion(version) {
  if (typeof version !== 'string') return null
  const value = version.replace(/^v/u, '')
  const separator = value.indexOf('-')
  const core = separator < 0 ? value : value.slice(0, separator)
  const pre = separator < 0 ? null : value.slice(separator + 1).split('.')
  const parts = core.split('.')
  if (parts.length > 3 || parts.some(part => !/^\d+$/u.test(part)) || pre?.some(part => part === '')) return null
  return {
    core: [0, 1, 2].map(index => (index < parts.length ? BigInt(parts[index]) : 0n)),
    pre,
  }
}

export function isNewer(candidate, current) {
  const newer = parseVersion(candidate)
  const older = parseVersion(current)
  if (newer === null || older === null) return false
  for (let index = 0; index < 3; index += 1) {
    if (newer.core[index] !== older.core[index]) return newer.core[index] > older.core[index]
  }
  if (newer.pre === null) return older.pre !== null
  if (older.pre === null) return false
  for (let index = 0; index < Math.max(newer.pre.length, older.pre.length); index += 1) {
    const left = newer.pre[index]
    const right = older.pre[index]
    if (left === undefined) return false
    if (right === undefined) return true
    if (left === right) continue
    const leftNumeric = /^\d+$/u.test(left)
    const rightNumeric = /^\d+$/u.test(right)
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right)
    if (leftNumeric !== rightNumeric) return !leftNumeric
    return left > right
  }
  return false
}

function isHttpsPage(page) {
  if (typeof page !== 'string') return false
  try {
    return new URL(page).protocol === 'https:'
  } catch {
    return false
  }
}

// `asset` names the release asset of this install (default: the macOS zip); a release without
// it does not count.
export function watchReleases({ current, arch, fetch = globalThis.fetch, ask, open, feed = RELEASES_URL, log = console, asset }) {
  const assetName = asset ?? (version => `DS-Bot-App-${version}-mac-${arch}.zip`)
  let asked
  let latest = Promise.resolve(null)
  const check = () => {
    latest = (async () => {
      try {
        const response = await fetch(feed, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': `DS-Bot-App/${current}` },
        })
        if (!response.ok) {
          log.error(`DS Bot App: update check failed: HTTP ${String(response.status)}`)
          return null
        }
        const releases = await response.json()
        if (!Array.isArray(releases)) {
          log.error('DS Bot App: update check failed: releases response is not an array')
          return null
        }
        const currentVersion = parseVersion(current)
        const allowPrerelease = currentVersion !== null && currentVersion.pre !== null
        let found
        for (const release of releases) {
          if (release === null || typeof release !== 'object' || release.draft === true
            || (release.prerelease === true && !allowPrerelease)) continue
          const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/u, '') : ''
          if (!isNewer(version, current)) continue
          if (!Array.isArray(release.assets) || !release.assets.some(entry => entry?.name === assetName(version))) continue
          if (!isHttpsPage(release.html_url)) {
            log.error('DS Bot App: update check failed: release page URL is not HTTPS')
            continue
          }
          if (found === undefined || isNewer(version, found.version)) found = { version, page: release.html_url }
        }
        if (found === undefined) return null
        log.info(`DS Bot App: update ${found.version} available`)
        if (ask !== undefined && asked !== found.version) {
          asked = found.version
          void Promise.resolve().then(() => ask(found.version))
            .then(yes => (yes ? open(found.page) : undefined))
            .catch((error) => { log.error(`DS Bot App: update ${found.version} not opened: ${error instanceof Error ? error.message : String(error)}`) })
        }
        return found
      } catch (error) {
        log.error(`DS Bot App: update check failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    })()
  }
  check()
  const timer = setInterval(check, CHECK_EVERY_MS)
  return { stop: () => { clearInterval(timer) }, latest: () => latest }
}

/**
 * @param {{
 *   updater: import('electron-updater').AppUpdater,
 *   beforeInstall: () => Promise<void>,
 *   ask?: (version: string) => Promise<boolean>,
 *   feed?: string,
 *   log?: Pick<Console, 'info' | 'error'>,
 * }} options `ask` answers whether to restart now; without it the update waits for the next
 *   quit. `beforeInstall` stops the Host, which runs from the files the installer replaces.
 *   `feed` is a folder URL with a latest.yml, in place of the GitHub releases.
 * @returns {{
 *   stop: () => void,
 *   latest: () => Promise<{ version: string, downloaded: Promise<boolean> } | null>,
 *   install: () => Promise<void>,
 * }} `latest` is what the newest check found: the version and whether its download finished.
 *   `install` stops the Host and runs the installer, which opens the app again.
 */
export function watchUpdates({ updater, beforeInstall, ask, feed, log = console }) {
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  if (feed) updater.setFeedURL({ provider: 'generic', url: feed })
  const install = async () => {
    await beforeInstall()
    updater.quitAndInstall(true, true)
  }
  let asked
  updater.on('update-downloaded', ({ version }) => {
    log.info(`DS Bot App: update ${version} downloaded`)
    if (ask === undefined || asked === version) return
    asked = version
    void ask(version).then(now => (now ? install() : undefined))
      .catch((error) => { log.error(`DS Bot App: update ${version} not installed: ${error instanceof Error ? error.message : String(error)}`) })
  })
  updater.on('error', (error) => { log.error(`DS Bot App: update failed: ${error instanceof Error ? error.message : String(error)}`) })
  let latest = Promise.resolve(null)
  // A failed check or download also comes as an 'error' event.
  const check = () => {
    latest = updater.checkForUpdates().then(result => (result?.isUpdateAvailable && result.downloadPromise
      ? { version: result.updateInfo.version, downloaded: result.downloadPromise.then(() => true, () => false) }
      : null), () => null)
  }
  check()
  const timer = setInterval(check, CHECK_EVERY_MS)
  return { stop: () => { clearInterval(timer) }, latest: () => latest, install }
}
