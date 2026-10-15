import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { hostText, t } from './i18n.js'
import { PhoneIcon } from './icons.js'

const mobile = (endpoint, payload) => call('mobile', { endpoint, payload })

export function MobileDevicesPage() {
  const [state, setState] = useState(null)
  const [pairing, setPairing] = useState(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const working = useRef(false)
  const [address, setAddress] = useState('')
  const [networkFamily, setNetworkFamily] = useState(null)
  useEffect(() => {
    let disposed = false
    alive.current = true
    const refresh = async () => {
      if (working.current) return
      try {
        const value = await mobile('status')
        if (disposed || working.current) return
        setState(value)
        setRefreshError('')
        setPairing(previous => previous && (previous.url !== value.url || Date.now() >= new Date(previous.expiresAt).getTime()) ? null : previous)
      } catch { if (!disposed && !working.current) setRefreshError('Could not refresh mobile devices.') }
    }
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => { disposed = true; alive.current = false; clearInterval(timer) }
  }, [])
  const run = async (endpoint, payload) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const result = await mobile(endpoint, payload)
      if (endpoint === 'https.enable') {
        const code = await mobile('pairing.create')
        if (alive.current) setPairing(code)
      }
      if (endpoint === 'pairing.create' && alive.current) setPairing(result)
      if (endpoint === 'https.disable' && alive.current) setPairing(null)
      const current = await mobile('status')
      if (alive.current) { setState(current); setRefreshError('') }
    } catch (cause) { if (alive.current) setError(cause.message ?? 'Request failed.') }
    finally { working.current = false; if (alive.current) setBusy(false) }
  }
  const row = (key, label, hint, children) => h('div', { key, className: 'bt-set-row' },
    h('div', { className: 'bt-set-copy' }, h('span', null, label), hint ? h('span', { className: 'bt-set-hint' }, hint) : null), children)
  const button = (label, action, primary = false, disabled = false) => h('button', { type: 'button', className: `bt-soft bt-soft-sm${primary ? ' bt-mobile-primary' : ''}`, disabled: busy || disabled, onClick: action }, t(label))
  const section = (key, title, children) => h('section', { key, className: 'bt-set-section' }, h('h3', null, title), h('div', { className: 'bt-set-card' }, children))
  const enabled = state?.enabled
  const pending = state?.pending ?? []
  const devices = (state?.devices ?? []).filter(device => !device.revokedAt)
  const activePairing = pairing && enabled && pairing.url === state.url && Date.now() < new Date(pairing.expiresAt).getTime()
  const problem = error || refreshError || state?.error || state?.https?.error
  const addresses = state?.https?.addresses ?? []
  const familyOf = value => value?.includes(':') ? 6 : 4
  const savedAddress = state?.https?.address
  const family = enabled ? familyOf(savedAddress) : networkFamily ?? familyOf(savedAddress || addresses[0]?.address)
  const available = addresses.filter(item => familyOf(item.address) === family)
  const chosenAddress = enabled ? savedAddress : available.find(item => item.address === address)?.address
    ?? available.find(item => item.address === savedAddress)?.address ?? available[0]?.address
  const selectedAddress = addresses.find(item => item.address === chosenAddress)
  const hasIpv6 = addresses.some(item => familyOf(item.address) === 6)
  const canSwitchFamily = addresses.some(item => familyOf(item.address) !== family)
  const networkLocked = busy || enabled || state?.locked
  const networkHint = !hasIpv6 && family !== 6 ? t('No usable IPv6 address was detected. Check IPv6 on this computer and router.')
    : enabled ? t('Turn off phone connection before switching between IPv4 and IPv6.')
      : family === 6 && !canSwitchFamily ? t('No IPv4 address is available on this computer.')
        : t('Choose IPv6 for this phone connection. Turn it off to use IPv4.')
  return h('div', { className: 'bt-mobile-page', 'aria-busy': busy },
    problem ? h('div', { className: 'bt-mobile-error', role: 'alert' }, h('span', { className: 'bt-error' }, hostText(problem)), button('Retry', () => void run('status'))) : null,
    !state ? h('p', { role: 'status' }, t('Loading devices…')) : h('div', { className: 'bt-set-card' },
      h('div', { className: 'bt-mobile-intro' },
        h('span', { className: 'bt-mobile-mark', 'aria-hidden': true }, h(PhoneIcon)),
        h('div', { className: 'bt-set-copy' }, h('h3', null, t('Connect your phone')), h('p', { className: 'bt-set-hint' }, t('Connect over your local network or a reachable IPv6 address. No domain or extra app is needed.'))),
        h('span', { className: 'bt-mobile-status', 'data-enabled': enabled || undefined }, t(enabled ? 'Phone connection enabled' : 'Phone connection off'))),
      state.https?.provider === 'local' ? row('ipv6', t('Use IPv6'), networkHint,
        h('button', { type: 'button', role: 'switch', className: 'bt-switch', 'aria-label': t('Use IPv6'), 'aria-checked': family === 6,
          disabled: networkLocked || !canSwitchFamily, onClick: () => { setNetworkFamily(family === 6 ? 4 : 6); setAddress('') } },
        h('span', { className: 'bt-switch-knob', 'aria-hidden': true }))) : null,
      state.https?.provider === 'local' ? row('network', t('Computer network address'),
        !available.length ? t(family === 6 ? 'No usable IPv6 address is available.' : 'No usable IPv4 address is available.') : undefined,
        h('select', { className: 'bt-select', 'aria-label': t('Computer network address'), value: chosenAddress ?? '',
          onChange: event => setAddress(event.target.value), disabled: networkLocked || !available.length },
        !available.length ? h('option', { value: '' }, t('No network address available')) : null,
        ...available.map(item => h('option', { key: item.address, value: item.address },
          item.name + ' · ' + (family === 6 ? t(item.scope === 'global' ? 'Public IPv6' : 'Local IPv6') : 'IPv4') + ' · ' + item.address)))) : null,
      !enabled ? row('off', t('Phone connection'), t(state.locked ? 'Mobile access is disabled by this host configuration.' : 'Enable the connection, scan the QR code, then approve your phone.'),
        !state.locked && state.https?.provider === 'local' ? h('div', { className: 'bt-mobile-actions' },
          button('Enable phone connection', () => void run('https.enable', { address: chosenAddress }), true, !chosenAddress)) : null)
        : row('host', t('Connection address'), state.url ?? t('Mobile bridge'), button('Create pairing code', () => void run('pairing.create'), true)),
      enabled && state.https?.provider === 'local' ? row('https', t('Local HTTPS is running'), t('Both devices need a route to this address. Allow the selected port in your firewall.'), button('Turn off phone connection', () => { if (window.confirm(t('Disconnect all phones from this host?'))) void run('https.disable') })) : null,
      selectedAddress?.scope === 'global' ? h('p', { className: 'bt-set-hint bt-mobile-note' }, t('Public IPv6 can connect across networks when your phone supports IPv6 and your router and computer allow incoming connections. No relay is used.')) : null),
    activePairing ? section('pairing', t('Pair your phone'), h('div', { className: 'bt-mobile-pairing' },
      h('div', { className: 'bt-mobile-qr' }, h('img', { src: pairing.qrDataUrl, width: 200, height: 200, alt: t('Scan this code in DS Bot Mobile to request access.') })),
      h('div', { className: 'bt-mobile-steps' },
        h('ol', null, ...['Open DS Bot Mobile and scan this QR code.', 'Confirm the connection on your phone.', 'Approve your phone in Pending requests below.'].map(step => h('li', { key: step }, t(step)))),
        h('p', { className: 'bt-set-hint' }, t('This code expires in two minutes. Share it only with your own device.')),
        button('Hide pairing code', () => setPairing(null))),
      h('details', { className: 'bt-mobile-manual' }, h('summary', null, t('Manual pairing data')), h('textarea', {
        readOnly: true, rows: 4, 'aria-label': t('Manual pairing data'), spellCheck: false,
        value: JSON.stringify({ url: pairing.url, code: pairing.code, serverId: pairing.serverId, ...(pairing.tlsPin ? { tlsPin: pairing.tlsPin } : {}) }),
      })))) : null,
    enabled ? section('pending', t('Pending requests · {count}', { count: pending.length }), pending.length ? pending.map(request => row(request.requestId, request.deviceName ?? t('Phone'), t('Requests access to your Bot team. Approve only a device you recognize.'),
      h('div', { className: 'bt-mobile-actions' }, button('Approve', () => void run('pairing.approve', { requestId: request.requestId }), true), button('Deny', () => void run('pairing.deny', { requestId: request.requestId })))))
      : h('p', { className: 'bt-mobile-empty' }, t('No pending requests. Scan a pairing code on your phone to get started.'))) : null,
    enabled ? section('devices', t('Paired devices · {count}', { count: devices.length }), devices.length ? devices.map(device => row(device.id, device.name ?? device.deviceName ?? t('Phone'), t('Paired device'),
      button('Revoke access', () => { if (window.confirm(t('Revoke this device? It must pair again to reconnect.'))) void run('device.revoke', { id: device.id }) })))
      : h('p', { className: 'bt-mobile-empty' }, t('No paired devices yet.'))) : null,
    state ? h('p', { className: 'bt-set-hint bt-mobile-note' }, t('Keep this computer or server running. Tool approvals remain in DSH. Revoking a device stops new access; it does not erase its local cache.')) : null)
}
