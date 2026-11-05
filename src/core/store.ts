import { create } from 'zustand'
import { enablePatches, produceWithPatches, type Patch } from 'immer'
import type { AppState, AuditEntry, Person, Project } from './types'
import { buildSeed } from './seed'
import { prefs } from './data'
import { nowISO, uid } from './util'

enablePatches()

/** The persona this browser is acting as. Per viewer, never shared. */
export const USER_KEY = 'crosswalk:user'

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
export interface UpdateOptions { /** A change the app makes on its own (e.g. due reminders), not a person's edit. */ background?: boolean }

/** Where the data lives right now. `memory` = tests and builds with no sync started. */
export type SyncMode = 'memory' | 'connecting' | 'shared' | 'offline'
export interface SyncStatus {
  mode: SyncMode
  /** The server accepts edits (a passcode is configured there). */
  editable: boolean
  /** This browser has entered the right passcode. */
  canEdit: boolean
  saving: boolean
  error: string | null
  /** View-only changes on this page that were not saved. */
  unsaved: boolean
  lastSavedAt: string | null
}
export const INITIAL_SYNC: SyncStatus = { mode: 'memory', editable: false, canEdit: false, saving: false, error: null, unsaved: false, lastSavedAt: null }

/** One local change, as immer patches plus the function that made it (so it can be re-applied on top of others' edits). */
export interface LocalChange { fn: (d: AppState) => void; audit?: AuditInput; background: boolean; patches: Patch[]; inverse: Patch[] }

let changeListener: ((c: LocalChange) => void) | null = null
let resetHandler: (() => void) | null = null
/** The sync layer subscribes here to every committed local change. */
export function onLocalChange(l: ((c: LocalChange) => void) | null) { changeListener = l }
/** The sync layer takes over "Reset demo data" when the data is shared. */
export function onReset(h: (() => void) | null) { resetHandler = h }

/** Apply a change and its audit entry to a draft (also used to re-apply a change on top of others' edits). */
export function applyChange(d: AppState, fn: (d: AppState) => void, audit?: AuditInput) {
  fn(d)
  if (audit) d.audit.push({ id: uid('aud'), at: nowISO(), actorId: d.currentUserId, ...audit } as AuditEntry)
}

interface Store extends AppState {
  sync: SyncStatus
  /** The ONE way to change data. `fn` mutates an immer draft. Optional audit entry is appended. */
  update: (fn: (d: AppState) => void, audit?: AuditInput, opts?: UpdateOptions) => void
  reset: () => void
  setUser: (id: string) => void
}

export const strip = (s: Store | AppState): AppState => {
  const { update, reset, setUser, sync, ...rest } = s as Store
  void update; void reset; void setUser; void sync
  return rest
}

export const useStore = create<Store>()((set, get) => ({
  ...buildSeed(),
  sync: INITIAL_SYNC,
  update: (fn, audit, opts) => {
    const prev = strip(get())
    const [next, patches, inverse] = produceWithPatches(prev, (d: AppState) => applyChange(d, fn, audit))
    if (!auditIntact(prev.audit, next.audit)) {
      console.error('Rejected an update that changed or removed audit log entries (the audit log is append-only).')
      return
    }
    if (!patches.length) return
    set(next)
    changeListener?.({ fn, audit, background: !!opts?.background, patches, inverse })
  },
  reset: () => {
    if (resetHandler) return resetHandler()
    const me = get().currentUserId
    const s = buildSeed()
    if (s.people.some((p) => p.id === me)) s.currentUserId = me
    set(s)
  },
  setUser: (id) => {
    prefs.setRaw(USER_KEY, id)
    get().update((d) => { d.currentUserId = id })
  },
}))

/** Replace the whole dataset (sync layer only). */
export const replaceState = (s: AppState) => useStore.setState(s)
export const setSync = (p: Partial<SyncStatus>) => useStore.setState({ sync: { ...useStore.getState().sync, ...p } })
export const useSync = () => useStore((s) => s.sync)

/** Imperative access for event handlers: mutate(d => ..., audit?) */
export const mutate = (fn: (d: AppState) => void, audit?: AuditInput, opts?: UpdateOptions) => useStore.getState().update(fn, audit, opts)
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
