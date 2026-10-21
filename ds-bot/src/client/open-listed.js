// DSH's main view opens only a Session that its client list already holds; any other id
// throws `sessions.retain: unknown session`. A part the Host made a moment ago, or any part
// before the first list arrives, waits for the list; a newer navigation — through here or
// elsewhere — drops the wait.
export function listedOpener({ list, open, refresh, current }) {
  let drop = () => {}
  let generation = 0
  let disposed = false
  const cancel = () => {
    generation++
    drop()
    drop = () => {}
  }
  const show = (target, prepare = () => {}) => {
    if (disposed) return
    cancel()
    const request = generation
    const listed = () => list.getSnapshot().byId?.[target] !== undefined
    if (listed()) { prepare(); open(target); return }
    const from = current?.()
    const off = list.subscribe(() => {
      if (disposed || request !== generation || current?.() !== from) {
        off()
        drop = () => {}
        return
      }
      if (!listed()) return
      off()
      drop = () => {}
      prepare()
      open(target)
    })
    drop = off
    refresh?.()
  }
  show.cancel = cancel
  show.dispose = () => { disposed = true; cancel() }
  return show
}
