import { useLayoutEffect, useRef } from 'react'

// Keep an edited dock card in place when its history cell mounts. Only the
// request's identity is shared; drafts and secret values stay in the component.
export function useDockHold(sessionId, kind, requestId, actions, inline) {
  const release = useRef(null)
  const note = actions.noteHeldCard
  useLayoutEffect(() => () => {
    const stop = release.current
    release.current = null
    stop?.()
  }, [sessionId, kind, requestId, note, inline])
  return () => {
    if (inline || release.current || !note) return
    release.current = () => note(sessionId, kind, requestId, -1)
    note(sessionId, kind, requestId, 1)
  }
}
