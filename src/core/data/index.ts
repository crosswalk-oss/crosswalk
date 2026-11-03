// The one data-access instance the app uses (rule 17): the shared Postgres-backed API. Swap the
// implementation here without touching any screen or the engine.
import { sharedDataAccess } from './server'
import type { DataAccess } from './types'

export type { DataAccess, RemoteChange, RemoteState, CommitResult } from './types'
export { gzipBase64, gunzipBase64 } from './server'
export const data: DataAccess = sharedDataAccess()

/** UI preferences through the data-access interface (kept in this browser only). */
export const prefs = {
  getRaw: (key: string) => data.getPref(key),
  setRaw: (key: string, value: string) => data.setPref(key, value),
  remove: (key: string) => data.removePref(key),
  get<T>(key: string, fallback: T): T {
    const v = data.getPref(key)
    if (v == null) return fallback
    try { return JSON.parse(v) as T } catch { return fallback }
  },
  set(key: string, value: unknown) { data.setPref(key, JSON.stringify(value)) },
}
