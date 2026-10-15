// Explicitly loaded test fixture; never included in the distributed package.
import { basename, join } from 'node:path'
import { cp, lstat, mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { install } from '../src/host/update.js'

export const name = 'ds-bot-update-smoke'
export const inject = ['connection', 'pluginManager']
export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME
  if (!/^[a-z0-9-]+$/.test(config.bench ?? '') || basename(home ?? '') !== `.dsh-test-${config.bench}`) throw new Error('Update smoke requires a named isolated bench')
  const profile = ctx.get('profileContext').dir
  if (profile !== join(home, 'profiles', 'web')) throw new Error('Unexpected update smoke profile')
  const rt = { home: join(home, 'update-proof'), config: {}, ctx: { get: key => ctx.get(key), effect() {} }, warn: (...args) => ctx.logger.warn(...args) }
  install(rt)
  let prepared = false
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/bot-update-smoke', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      const body = await request.json()
      let result
      if (body.endpoint === 'prepare' && !prepared) {
        // A profile's linked development dependency must not be pruned while the
        // real package manager replaces it. Give this bench its own package copy.
        const link = join(profile, 'node_modules', 'ds-bot')
        if (!(await lstat(link)).isSymbolicLink()) throw new Error('Update smoke expects its initial linked package')
        const source = await realpath(link)
        const shadow = join(home, 'update-shadow')
        const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
        await mkdir(shadow, { recursive: true })
        for (const file of ['package.json', ...pkg.files]) await cp(join(source, file), join(shadow, file), { recursive: true })
        await unlink(link)
        await symlink(shadow, link, process.platform === 'win32' ? 'junction' : 'dir')
        const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
        const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
        const url = `https://127.0.0.1:1/ds-bot-${version}.tgz`
        manifest.dependencies['ds-bot'] = url
        await writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2))
        await writeFile(join(profile, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      ds-bot:\n        specifier: ${url}\n        version: ${url}\npackages:\n  ds-bot@${url}:\n    resolution: {tarball: '${url}', integrity: sha512-AAAA}\nsnapshots:\n  ds-bot@${url}: {}\n`)
        prepared = true
        result = { prepared: true }
      } else if (body.endpoint === 'check') result = await rt.updateCheck({ fresh: true })
      else if (body.endpoint === 'install') result = rt.updateStart({ targetId: body.targetId })
      else if (body.endpoint === 'status') result = rt.updateView()
      else return new Response('Unknown smoke action', { status: 400 })
      return Response.json(result)
    },
  }), 'ds-bot: update smoke route')
}
