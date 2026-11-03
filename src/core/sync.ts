// Keeps this browser's copy of the data in step with the shared database (through the data-access interface).
//
// - Load: the latest snapshot plus every change after it, replayed with immer.
// - Edit: each local change goes to the server as immer patches, numbered in order. If someone else saved
//   first (409), we undo our pending changes, apply theirs, re-run ours on top and try again.
// - Others' edits: polled every few seconds while the page is visible.
// - No passcode: changes stay on this page only and the app says so. No API: the app runs in memory.
// Only the persona you are acting as (currentUserId) is per browser; everything else is shared.
import { applyPatches, produceWithPatches, type Patch } from 'immer'
import type { AppState } from './types'
import type { DataAccess } from './data/types'
import { buildSeed, SCHEMA_VERSION } from './seed'
import { applyChange, onLocalChange, onReset, replaceState, setSync, strip, useStore, USER_KEY, type LocalChange } from './store'

export const PASSCODE_KEY = 'crosswalk:passcode'
const LOCAL_KEYS = new Set(['currentUserId'])
const SNAPSHOT_EVERY = 50
const POLL_MS = 5000

/** Fields that are secrets (the AI gateway key, map-service tokens): never sent to the shared database. */
const SECRET_KEYS = new Set(['apiKey', 'token'])
/** A deep copy without secret fields. */
export function scrub<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrub) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, x]) => [k, scrub(x)])) as T
  return v
}
/** Patches that belong in the shared database: not per-browser fields, not secrets. */
const shared = (ps: Patch[]) => ps
  .filter((p) => !LOCAL_KEYS.has(String(p.path[0])) && !p.path.some((k) => SECRET_KEYS.has(String(k))))
  .map((p) => ('value' in p ? { ...p, value: scrub(p.value) } : p))

export interface SyncDeps {
  data: DataAccess
  gzip: (s: string) => Promise<string>
  gunzip: (s: string) => Promise<string>
  schema?: number
  /** Called when someone else's edits or a reset arrive (for a toast). */
  notify?: (msg: string) => void
}

export function createSync(deps: SyncDeps) {
  const schema = deps.schema ?? SCHEMA_VERSION
  let generation: number | null = null
  let seq = 0
  let passcode = ''
  let canEdit = false
  let queue: LocalChange[] = []
  let flushing = false
  let timer: ReturnType<typeof setInterval> | undefined

  const current = () => strip(useStore.getState())
  const localUser = (s: AppState) => {
    const want = deps.data.getPref(USER_KEY) ?? useStore.getState().currentUserId
    return s.people.some((p) => p.id === want) ? want : s.currentUserId
  }
  const withLocal = (s: AppState): AppState => ({ ...s, currentUserId: localUser(s) })
  const actor = () => useStore.getState().currentUserId
  /** The shared state as of `seq`: the current state with our unsent changes undone. */
  const baseState = () => queue.reduceRight<AppState>((s, c) => applyPatches(s, c.inverse), current())

  async function load(): Promise<void> {
    const r = await deps.data.loadState(schema)
    let s: AppState = r.snapshotGz ? JSON.parse(await deps.gunzip(r.snapshotGz)) : buildSeed()
    for (const c of r.changes) s = applyPatches(s, JSON.parse(c.patches))
    generation = r.generation
    seq = r.head
    queue = []
    replaceState(withLocal(s))
    setSync({ mode: 'shared', unsaved: false, error: null, saving: false })
  }

  async function startGeneration(reason: string, state: AppState): Promise<boolean> {
    const gz = await deps.gzip(JSON.stringify(scrub(state)))
    const id = await deps.data.startGeneration(passcode, schema, reason, actor(), gz)
    if (id == null) return false
    generation = id
    seq = 0
    return true
  }

  async function snapshot() {
    if (generation == null) return
    const g = generation, at = seq
    const gz = await deps.gzip(JSON.stringify(scrub(baseState())))
    await deps.data.addSnapshot(passcode, g, at, gz)
  }

  /** Undo pending changes, apply others' changes, re-run ours on top. */
  async function rebase(): Promise<'ok' | 'reset'> {
    const r = await deps.data.changesSince(schema, generation!, seq)
    if (r.reset) return 'reset'
    let s = baseState()
    for (const c of r.changes) s = applyPatches(s, JSON.parse(c.patches))
    seq = r.head
    const redone: LocalChange[] = []
    for (const c of queue) {
      try {
        const [next, patches, inverse] = produceWithPatches(s, (d: AppState) => applyChange(d, c.fn, c.audit))
        s = next
        if (shared(patches).length) redone.push({ ...c, patches: shared(patches), inverse: shared(inverse) })
      } catch { deps.notify?.('One of your changes no longer applies after someone else’s edit and was dropped.') }
    }
    queue = redone
    replaceState(s)
    return 'ok'
  }

  async function flush(): Promise<void> {
    if (flushing) return
    flushing = true
    setSync({ saving: true })
    try {
      while (queue.length) {
        if (generation == null && !(await startGeneration('First edit', baseState()))) {
          setSync({ error: 'Couldn’t save. Retrying…' }); await wait(4000); continue
        }
        const c = queue[0]
        const res = await deps.data.appendChange(passcode, { generation: generation!, seq: seq + 1, actor: actor(), summary: c.audit?.summary ?? '', patches: c.patches })
        if (res === 'ok') {
          seq += 1
          queue.shift()
          setSync({ error: null, lastSavedAt: new Date().toISOString() })
          if (seq % SNAPSHOT_EVERY === 0) void snapshot()
        } else if (res === 'conflict') {
          if ((await rebase()) === 'reset') { deps.notify?.('The demo data was reset by someone else. Your unsaved change was dropped.'); await load(); break }
        } else if (res === 'unauthorized') {
          lock()
          deps.notify?.('The edit passcode was changed. Enter the new one to keep editing.')
          await load()
          break
        } else {
          setSync({ error: 'Couldn’t save. Retrying…' })
          await wait(4000)
        }
      }
    } finally {
      flushing = false
      setSync({ saving: false })
    }
  }

  function onChange(c: LocalChange) {
    const patches = shared(c.patches)
    if (!patches.length) return
    const mode = useStore.getState().sync.mode
    if (mode !== 'shared') return // offline: memory only, the banner says so
    if (!canEdit) { if (!c.background) setSync({ unsaved: true }); return }
    queue.push({ ...c, patches, inverse: shared(c.inverse) })
    void flush()
  }

  async function poll(): Promise<void> {
    if (flushing || queue.length || useStore.getState().sync.mode !== 'shared') return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (useStore.getState().sync.unsaved) return // keep the viewer's local changes until they reload or unlock
    try {
      if (generation == null) {
        const r = await deps.data.loadState(schema)
        if (r.generation != null) await load()
        return
      }
      const r = await deps.data.changesSince(schema, generation, seq)
      if (flushing || queue.length) return
      if (r.reset) { await load(); deps.notify?.('The demo data was reset.'); return }
      if (!r.changes.length) return
      let s = current()
      for (const c of r.changes) s = applyPatches(s, JSON.parse(c.patches))
      seq = r.head
      replaceState(withLocal(s))
      setSync({ error: null })
    } catch { setSync({ error: 'Can’t reach the shared data. Retrying…' }) }
  }

  function lock() {
    passcode = ''
    canEdit = false
    queue = []
    deps.data.removePref(PASSCODE_KEY)
    setSync({ canEdit: false })
  }

  async function resetShared() {
    const seed = buildSeed()
    if (!canEdit) { replaceState(withLocal(seed)); setSync({ unsaved: false }); return }
    queue = []
    if (await startGeneration('Reset demo data', seed)) { replaceState(withLocal(seed)); setSync({ unsaved: false }) }
    else deps.notify?.('Couldn’t reset the shared data. Try again.')
  }

  return {
    /** Connect to the API, load the shared data and start listening. Falls back to memory when no API answers. */
    async start(opts: { poll?: boolean } = {}) {
      setSync({ mode: 'connecting' })
      const h = await deps.data.health()
      if (!h) { replaceState(withLocal(current())); setSync({ mode: 'offline' }); return }
      const saved = deps.data.getPref(PASSCODE_KEY) ?? ''
      canEdit = h.editable && !!saved && (await deps.data.auth(saved))
      passcode = canEdit ? saved : ''
      if (saved && !canEdit) deps.data.removePref(PASSCODE_KEY)
      try { await load() } catch { setSync({ mode: 'offline' }); return }
      setSync({ editable: h.editable, canEdit })
      onLocalChange(onChange)
      onReset(() => { void resetShared() })
      if (opts.poll !== false && typeof window !== 'undefined') timer = setInterval(() => { void poll() }, POLL_MS)
    },
    /** Check the passcode; on success reload the shared data (dropping view-only changes) and allow edits. */
    async unlock(code: string): Promise<boolean> {
      if (!(await deps.data.auth(code))) return false
      passcode = code
      canEdit = true
      deps.data.setPref(PASSCODE_KEY, code)
      await load()
      setSync({ canEdit: true })
      return true
    },
    lock,
    /** Throw away view-only changes and show the shared data again. */
    async discardLocal() { await load() },
    poll,
    flush,
    /** Resolves once every local change has been saved (or after `ms`). */
    async idle(ms = 10000) {
      const until = Date.now() + ms
      while ((flushing || queue.length) && Date.now() < until) await wait(10)
      return !flushing && !queue.length
    },
    stop() { if (timer) clearInterval(timer); onLocalChange(null); onReset(null) },
    /** For tests. */
    get position() { return { generation, seq, pending: queue.length } },
  }
}
export type Sync = ReturnType<typeof createSync>

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
