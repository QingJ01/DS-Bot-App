import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/mobile-settings.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, external: ['react'],
})
const ipv4 = { address: '192.168.1.8', family: 4, name: 'Wi-Fi' }
const private6 = { address: 'fd12::8', family: 6, scope: 'private', name: 'Wi-Fi' }
const public6 = { address: '2001:db8::8', family: 6, scope: 'global', name: 'Wi-Fi' }
const status = (addresses, extra = {}) => ({ enabled: false, pending: [], devices: [], https: { provider: 'local', addresses, ...extra } })
const nodes = (tree, match) => !tree || typeof tree !== 'object' ? []
  : [...(match(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, match))]
const text = tree => !tree || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree)
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }

async function page(initial) {
  const hooks = []
  let index = 0, mounted = false, effect, refresh, cleanup, value = initial
  const calls = []
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, Date,
    setInterval: callback => { refresh = callback; return 1 }, clearInterval: () => {},
    fetch: async (_url, request) => {
      const { payload: { endpoint, payload } } = JSON.parse(request.body)
      calls.push({ endpoint, payload })
      if (endpoint === 'https.enable') value = { ...value, enabled: true, url: `https://${payload.address.includes(':') ? `[${payload.address}]` : payload.address}:8788`, https: { ...value.https, address: payload.address } }
      const result = endpoint === 'pairing.create' ? { url: value.url, expiresAt: new Date(Date.now() + 60000).toISOString() } : value
      return { ok: true, json: async () => ({ ok: true, value: result }) }
    },
    require: name => {
      assert.equal(name, 'react')
      return {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initialValue => {
          const slot = index++
          if (!(slot in hooks)) hooks[slot] = initialValue
          return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next }]
        },
        useRef: initialValue => {
          const slot = index++
          hooks[slot] ??= { current: initialValue }
          return hooks[slot]
        },
        useEffect: callback => { if (!mounted) effect = callback },
      }
    },
  })
  const render = () => { index = 0; const tree = module.exports.MobileDevicesPage(); mounted = true; return tree }
  render(); cleanup = effect(); await settle()
  return { render, calls, close: () => cleanup(), refresh: async next => { value = next; await refresh(); await settle() } }
}
const control = (page, type, label) => nodes(page.render(), node => node.type === type && node.props['aria-label'] === label)[0]
const toggle = page => control(page, 'button', 'Use IPv6')
const select = page => control(page, 'select', 'Computer network address')
const enable = page => nodes(page.render(), node => node.type === 'button' && text(node) === 'Enable phone connection')[0]

test('IPv6 remains visible with one IPv4 address and explains why it is unavailable', async t => {
  const view = await page(status([ipv4])); t.after(view.close)
  assert.equal(toggle(view).props['aria-checked'], false)
  assert.equal(toggle(view).props.disabled, true)
  assert.match(text(view.render()), /No usable IPv6 address was detected/)
  assert.equal(select(view).props.value, ipv4.address)
})

test('IPv6 selection filters addresses and sends the selected public address when enabling', async t => {
  const view = await page(status([ipv4, private6, public6])); t.after(view.close)
  assert.equal(toggle(view).props['aria-checked'], false)
  toggle(view).props.onClick()
  assert.equal(toggle(view).props['aria-checked'], true)
  assert.deepEqual(nodes(select(view), node => node.type === 'option').map(node => node.props.value), [private6.address, public6.address])
  select(view).props.onChange({ target: { value: public6.address } })
  assert.match(text(view.render()), /Public IPv6 can connect across networks/)
  enable(view).props.onClick(); await settle()
  assert.deepEqual(view.calls.find(call => call.endpoint === 'https.enable').payload, { address: public6.address })
  assert.equal(toggle(view).props.disabled, true)
  assert.equal(select(view).props.disabled, true)
  assert.match(text(view.render()), /Turn off phone connection before switching/)
})

test('an existing IPv6 connection still shows its switch and selected address', async t => {
  const view = await page({ ...status([ipv4, public6], { address: public6.address }), enabled: true, url: 'https://[2001:db8::8]:8788' }); t.after(view.close)
  assert.equal(toggle(view).props['aria-checked'], true)
  assert.equal(toggle(view).props.disabled, true)
  assert.equal(select(view).props.value, public6.address)
  assert.equal(select(view).props.disabled, true)
})

test('switching a saved IPv6 connection to IPv4 overrides the host saved-address default', async t => {
  const view = await page(status([ipv4, public6], { address: public6.address })); t.after(view.close)
  assert.equal(toggle(view).props['aria-checked'], true)
  toggle(view).props.onClick()
  enable(view).props.onClick(); await settle()
  assert.deepEqual(view.calls.find(call => call.endpoint === 'https.enable').payload, { address: ipv4.address })
})

test('a missing IPv6 interface disables enabling without silently falling back to IPv4', async t => {
  const view = await page(status([ipv4, public6])); t.after(view.close)
  toggle(view).props.onClick()
  await view.refresh(status([ipv4]))
  assert.equal(toggle(view).props['aria-checked'], true)
  assert.equal(enable(view).props.disabled, true)
  assert.match(text(view.render()), /No usable IPv6 address is available/)
  assert.equal(view.calls.filter(call => call.endpoint === 'https.enable').length, 0)
})

test('IPv6-only and offline hosts keep the network controls visible', async t => {
  const only6 = await page(status([public6])); t.after(only6.close)
  assert.equal(toggle(only6).props['aria-checked'], true)
  assert.equal(toggle(only6).props.disabled, true)
  assert.equal(enable(only6).props.disabled, false)
  const offline = await page(status([])); t.after(offline.close)
  assert.ok(toggle(offline))
  assert.equal(enable(offline).props.disabled, true)
  assert.match(text(offline.render()), /No network address available/)
})
