// One right-side panel at a time: the Bot drawer and DSH's right column never
// share the window (public#456: both open squeezed the conversation). Whichever
// the user asked for last wins.

// DSH's AppFrame marks the column on the frame element: `data-rightbar-collapsed`
// while it has no track, `data-rightbar-fullscreen` while a narrow viewport
// presents it fullscreen — with no track, so the two marks come together and it
// still counts as open. `data-rightbar-col` is the column itself, mounted
// whenever the frame is, so a frame with neither mark is open. These names are
// DSH's frame attributes.
export const RIGHTBAR_ATTRIBUTES = ['data-rightbar-collapsed', 'data-rightbar-fullscreen']

// The column's on-screen state, read off the document.
export function rightColumnOpen(doc) {
  if (doc.querySelector('[data-rightbar-fullscreen]')) return true
  if (doc.querySelector('[data-rightbar-collapsed]')) return false
  return doc.querySelector('[data-rightbar-col]') !== null
}

// The drawer opened: it needs the space an open column is holding.
export function drawerOpened(columnOpen) {
  return columnOpen ? 'collapse-column' : null
}

// The column appeared. `moved` marks a Session switch still inside its window
// (see below), so the opening is that Session's own column and the drawer wins;
// an unmoved opening is the user's own — a file link, a subagent, a shortcut —
// and takes the space.
export function columnOpened(drawerOpen, moved) {
  if (!drawerOpen) return null
  return moved ? 'collapse-column' : 'close-drawer'
}

// A Session switch moves `mounted` well before the DOM that follows it: a seat
// whose store is not minted yet opens in a passive effect, and a fullscreen
// panel reports only after its slide, so the attribute flip can land several
// batches later. The switch is therefore a timed window, not the next DOM
// batch — `settle(done)` calls `done` once the switch settled. A newer
// `moved()` restarts the window; a stale settle is ignored.
export function createSwitchWindow(settle) {
  let token = null
  return {
    moved() {
      const self = token = {}
      settle(() => { if (token === self) token = null })
    },
    get pending() { return token !== null },
  }
}
