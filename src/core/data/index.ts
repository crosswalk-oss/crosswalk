// The one data-access instance the app uses. Swap the implementation here (rule 17) — e.g. a Postgres-backed
// client of the app's own API — without touching any screen or the engine.
import { browserDataAccess } from './browser'
import type { DataAccess } from './types'

export type { DataAccess } from './types'
export const data: DataAccess = browserDataAccess()

/** UI preferences through the data-access interface. */
export const prefs = {
  getRaw: (key: string) => data.getPref(key),
  setRaw: (key: string, value: string) => data.setPref(key, value),
  get<T>(key: string, fallback: T): T {
    const v = data.getPref(key)
    if (v == null) return fallback
    try { return JSON.parse(v) as T } catch { return fallback }
  },
  set(key: string, value: unknown) { data.setPref(key, JSON.stringify(value)) },
}
