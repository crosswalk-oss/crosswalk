// Browser implementation of the data-access interface: localStorage, for the single-file demo.
// Every call is wrapped so the app keeps working in memory when storage is blocked or full.
import type { AppState } from '../types'
import type { DataAccess } from './types'

const STATE_KEY = (v: number) => 'crosswalk:state:v' + v

function storage(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null } catch { return null }
}

export function browserDataAccess(): DataAccess {
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  const mem = new Map<string, string>()
  return {
    kind: 'browser',
    loadState(schemaVersion) {
      version = schemaVersion
      try {
        const raw = storage()?.getItem(STATE_KEY(schemaVersion))
        if (!raw) return null
        const s = JSON.parse(raw) as AppState
        return s.schemaVersion === schemaVersion ? s : null
      } catch { return null }
    },
    saveState(state) {
      version = state.schemaVersion
      clearTimeout(timer)
      timer = setTimeout(() => {
        try { storage()?.setItem(STATE_KEY(state.schemaVersion), JSON.stringify(state)) } catch { /* full or blocked: keep in memory */ }
      }, 400)
    },
    clearState() {
      clearTimeout(timer)
      try { storage()?.removeItem(STATE_KEY(version)) } catch { /* ignore */ }
    },
    getPref(key) {
      try { const v = storage()?.getItem(key); if (v != null) return v } catch { /* ignore */ }
      return mem.get(key) ?? null
    },
    setPref(key, value) {
      mem.set(key, value)
      try { storage()?.setItem(key, value) } catch { /* ignore */ }
    },
  }
}
