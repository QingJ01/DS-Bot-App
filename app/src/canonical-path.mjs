import { realpathSync } from 'node:fs'

// The path Windows hands the packaged app can carry 8.3 short names or junctions: the
// same exe then reads as a different path, so the single-instance lock compares unlike
// strings and every absolute path the Host builds (profile includes, plugin roots) mixes
// short and long forms. Callers relaunch on the returned path; undefined means execPath
// is already canonical (or cannot be resolved).
export function canonicalExecPath(execPath, realpath = realpathSync.native) {
  try {
    const real = realpath(execPath)
    return real === execPath ? undefined : real
  } catch {
    return undefined
  }
}
