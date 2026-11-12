// Shared implementation of the data-access interface: the app's own API (src/server/api.ts) over relative
// URLs, so it works wherever the page is served from. The only network calls this app makes for data.
import type { CommitResult, DataAccess, MaterialInfo, RemoteChange } from './types'

function storage(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null } catch { return null }
}

async function call(path: string, init: RequestInit = {}, passcode?: string): Promise<Response | null> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (passcode) headers['x-crosswalk-passcode'] = passcode
    return await fetch('api/' + path, { ...init, headers, cache: 'no-store' })
  } catch { return null }
}
const ok = async <T,>(r: Response | null): Promise<T | null> => (r && r.ok ? ((await r.json()) as T) : null)

export function sharedDataAccess(): DataAccess {
  const mem = new Map<string, string>()
  return {
    kind: 'shared',
    async health() {
      const r = await ok<{ ok: boolean; editable: boolean }>(await call('health'))
      return r?.ok ? { editable: !!r.editable } : null
    },
    async auth(passcode) {
      const r = await call('auth', { method: 'POST', body: '{}' }, passcode)
      return !!r && r.status === 204
    },
    async loadState(schemaVersion) {
      const r = await ok<{ generation: { id: number } | null; snapshot: { seq: number; stateGz: string } | null; changes: RemoteChange[]; head: number }>(await call(`state?schema=${schemaVersion}`))
      if (!r) throw new Error('Could not load the shared data')
      return { generation: r.generation?.id ?? null, snapshotGz: r.snapshot?.stateGz ?? null, snapshotSeq: r.snapshot?.seq ?? 0, changes: r.changes, head: r.head }
    },
    async changesSince(schemaVersion, generation, after) {
      const r = await ok<{ reset?: boolean; changes?: RemoteChange[]; head?: number }>(await call(`changes?schema=${schemaVersion}&generation=${generation}&after=${after}`))
      if (!r) throw new Error('Could not reach the shared data')
      return r.reset ? { reset: true } : { reset: false, changes: r.changes ?? [], head: r.head ?? after }
    },
    async appendChange(passcode, c): Promise<CommitResult> {
      const r = await call('changes', { method: 'POST', body: JSON.stringify(c) }, passcode)
      if (!r) return 'error'
      if (r.ok) return 'ok'
      if (r.status === 409) return 'conflict'
      if (r.status === 401 || r.status === 403) return 'unauthorized'
      return 'error'
    },
    async addSnapshot(passcode, generation, seq, stateGz) {
      const r = await call('snapshot', { method: 'POST', body: JSON.stringify({ generation, seq, stateGz }) }, passcode)
      return !!r && r.ok
    },
    async startGeneration(passcode, schema, reason, actor, stateGz) {
      const r = await ok<{ generation: { id: number } }>(await call('generation', { method: 'POST', body: JSON.stringify({ schema, reason, actor, stateGz }) }, passcode))
      return r?.generation.id ?? null
    },
    async listMaterials(passcode) {
      const r = await ok<{ materials: MaterialInfo[] }>(await call('materials', {}, passcode))
      return r?.materials ?? null
    },
    async materialChunk(passcode, id, idx) {
      const r = await call(`materials/chunk?id=${id}&idx=${idx}`, {}, passcode)
      return r && r.ok ? await r.arrayBuffer() : null
    },
    getPref(key) {
      try { const v = storage()?.getItem(key); if (v != null) return v } catch { /* blocked */ }
      return mem.get(key) ?? null
    },
    setPref(key, value) {
      mem.set(key, value)
      try { storage()?.setItem(key, value) } catch { /* blocked */ }
    },
    removePref(key) {
      mem.delete(key)
      try { storage()?.removeItem(key) } catch { /* blocked */ }
    },
  }
}

/** gzip + base64, so a ~3.5 MB state travels and is stored as a few hundred KB of text. */
export async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export async function gunzipBase64(b64: string): Promise<string> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}
