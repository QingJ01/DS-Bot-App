import { STORAGE } from './storage.js'

// The plugin's surface mode: 'bot' paints the whole team interface over the shell,
// 'agent' withdraws every replacement so the shell's own interface comes back.
// `plain` marks a Bot-mode view whose main view is a plain session — only the
// conversation replacements come off then, the shell stays.
export function groupsFor({ mode, plain = false }) {
  return { shell: mode === 'bot', conversation: mode === 'bot' && !plain }
}

const GROUPS = ['shell', 'conversation']

// Runs every disposer even when one throws, last installed first: later entries
// lean on earlier ones (the theme's styles and tokens), never the other way round.
function disposeAll(disposers, label) {
  for (const dispose of [...disposers].reverse()) {
    try { dispose?.() } catch (error) { console.warn(`[ds-bot] ${label}`, error) }
  }
}

// Keeps the mounted groups in step with `groupsFor`. The conversation group sits on
// the shell's styles and tokens, so it comes off before the shell and goes on after.
// A group's list is cleared before it is disposed, so a throw never makes a later
// reconcile believe the group is mounted.
//
// `install[group]()` lists the group's steps; each step mounts one thing and returns
// its disposer. A group goes on whole or not at all: when a step throws, the steps
// before it are withdrawn, so Agent mode never keeps a half-installed Bot skin.
export function surfaceGroups(install, { onError } = {}) {
  const mounted = { shell: [], conversation: [] }
  const withdraw = (group) => {
    const disposers = mounted[group]
    mounted[group] = []
    disposeAll(disposers, `withdraw ${group}`)
  }
  return {
    reconcile(wanted) {
      for (const group of [...GROUPS].reverse()) if (!wanted[group]) withdraw(group)
      for (const group of GROUPS) {
        if (!wanted[group] || mounted[group].length > 0) continue
        const disposers = []
        try {
          for (const step of install[group]()) if (step) disposers.push(step())
          mounted[group] = disposers
        } catch (error) {
          disposeAll(disposers, `roll back ${group}`)
          console.warn(`[ds-bot] install ${group}`, error)
          onError?.(group, error)
          break
        }
      }
    },
    dispose() { for (const group of [...GROUPS].reverse()) withdraw(group) },
  }
}

// The priority that puts an entry below every other entry of its cell (lowest
// renders). Another plugin that shadows the same cell at the same priority would
// make the registration throw; in a Bot surface the cell is DS Bot's.
export function freePriority(entries, { priority, key, id }) {
  if (priority === undefined) return undefined
  const taken = entries
    .filter(entry => (key === undefined || entry.options?.key === key) && (id === undefined || entry.options?.id === id))
    .map(entry => (entry.options?.priority ?? 0) - 1)
  return Math.min(priority, ...taken)
}

export function readMode(storage = globalThis.localStorage) {
  try { return storage.getItem(STORAGE.surface) === 'agent' ? 'agent' : 'bot' } catch { return 'bot' }
}

export function writeMode(mode, storage = globalThis.localStorage) {
  try { storage.setItem(STORAGE.surface, mode) } catch { /* storage unavailable */ }
}
