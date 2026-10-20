// Team state can arrive before the Harness session catalog on a fresh connection.
export function createNavigation({ sessions, open, reportError }) {
  let generation = 0
  let disposed = false
  return {
    async open(id, prepare = () => {}) {
      if (disposed) return
      const request = ++generation
      try {
        if (sessions.list.getSnapshot().byId[id] === undefined) await sessions.refresh()
        if (disposed || request !== generation) return
        if (sessions.list.getSnapshot().byId[id] === undefined) throw new Error('The conversation is not available. Refresh and try again.')
        prepare()
        open(id)
      } catch (error) {
        if (!disposed && request === generation) reportError(error)
      }
    },
    cancel() { generation++ },
    dispose() { disposed = true; generation++ },
  }
}
