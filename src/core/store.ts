import { create } from 'zustand'
import { produce } from 'immer'
import type { AppState, AuditEntry, Person, Project } from './types'
import { buildSeed, SCHEMA_VERSION } from './seed'
import { data } from './data'
import { nowISO, uid } from './util'

function load(): AppState {
  return data.loadState(SCHEMA_VERSION) ?? buildSeed()
}
const persist = (s: AppState) => data.saveState(s)

/**
 * The audit log is append-only (rule 21): an update may add entries but never change or remove existing ones.
 * Violations are rejected and the update is discarded.
 */
export function auditIntact(before: AppState['audit'], after: AppState['audit']): boolean {
  if (after.length < before.length) return false
  for (let i = 0; i < before.length; i++) if (after[i] !== before[i]) return false
  return true
}

export interface AuditInput { entity: string; entityId: string; action: string; summary: string; projectId?: string }

interface Store extends AppState {
  /** The ONE way to change data. `fn` mutates an immer draft. Optional audit entry is appended. */
  update: (fn: (d: AppState) => void, audit?: AuditInput) => void
  reset: () => void
  setUser: (id: string) => void
}

const strip = (s: Store): AppState => {
  const { update, reset, setUser, ...rest } = s
  void update; void reset; void setUser
  return rest
}

export const useStore = create<Store>()((set, get) => ({
  ...load(),
  update: (fn, audit) => {
    const prev = strip(get())
    const next = produce(prev, (d: AppState) => {
      fn(d)
      if (audit) d.audit.push({ id: uid('aud'), at: nowISO(), actorId: d.currentUserId, ...audit } as AuditEntry)
    })
    if (!auditIntact(prev.audit, next.audit)) {
      console.error('Rejected an update that changed or removed audit log entries (the audit log is append-only).')
      return
    }
    set(next)
    persist(next)
  },
  reset: () => {
    data.clearState()
    const s = buildSeed()
    set(s)
    persist(s)
  },
  setUser: (id) => get().update((d) => { d.currentUserId = id }),
}))

/** Imperative access for event handlers: mutate(d => ..., audit?) */
export const mutate = (fn: (d: AppState) => void, audit?: AuditInput) => useStore.getState().update(fn, audit)
export const getState = (): AppState => useStore.getState()

// ── Convenience hooks
export const useMe = (): Person => useStore((s) => s.people.find((p) => p.id === s.currentUserId)!)
export const useProject = (id: string | undefined): Project | undefined => useStore((s) => s.projects.find((p) => p.id === id || p.code === id))
export const usePeopleMap = () => useStore((s) => s.people)
export function personName(s: Pick<AppState, 'people'>, id?: string): string {
  if (!id) return '—'
  if (id === 'system') return 'System'
  return s.people.find((p) => p.id === id)?.name ?? 'Unknown'
}
export const usePersonName = (id?: string) => useStore((s) => personName(s, id))
export const categoryName = (s: Pick<AppState, 'categories'>, id: string) => s.categories.find((c) => c.id === id)?.name ?? id
