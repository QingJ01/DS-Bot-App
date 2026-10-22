import { freePriority } from './surface.js'

const navigationEntry = entries => entries.find(entry => entry.store && typeof entry.inject === 'function')

// Reuse the replaced header's public navigation face and store: activating a
// Conversation target alone does not change its persisted View selection.
export function headerNavigation(entries, face) {
  const source = navigationEntry(entries)
  return {
    ...(source ? { store: source.store } : {}),
    inject: (...args) => {
      const navigation = source?.inject(...args) ?? {}
      const own = face()
      return { ...navigation, ...own, hooks: { ...navigation.hooks, ...own.hooks } }
    },
  }
}

export function installHeaderNavigation(slots, face, component, priority) {
  const name = 'conversation.session.header'
  let source
  let dispose
  const refresh = () => {
    const entries = slots.entries(name).filter(entry => entry.component !== component)
    const next = navigationEntry(entries)
    if (dispose && source === next) return
    dispose?.()
    source = next
    dispose = slots.register({ name, priority: freePriority(entries, { priority }), ...headerNavigation(entries, face) }, component)
  }
  // Slot declaration precedes the owner's registration. Follow that arrival,
  // and later host reloads, without treating our own registration as a source.
  const unsubscribe = slots.subscribe(name, refresh)
  try { refresh() } catch (error) { unsubscribe(); throw error }
  return () => { unsubscribe(); dispose?.() }
}
