// The app's one sync instance (started by App on load).
import { data, gunzipBase64, gzipBase64 } from './data'
import { createSync, type Sync } from './sync'

export const appSync: { current: Sync | null } = { current: null }

export function startAppSync(notify: (msg: string) => void): Sync {
  appSync.current?.stop()
  const s = createSync({ data, gzip: gzipBase64, gunzip: gunzipBase64, notify })
  appSync.current = s
  return s
}
