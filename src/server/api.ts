// The app's own API (AGENT_RULES §5 rule 18): one plain `(request) => response` function with its
// dependencies passed in, so it runs unchanged on Cloudflare Pages Functions now and AWS Lambda later.
//
//   GET  /api/health                          → { ok, editable }
//   POST /api/auth                            → 204 when the passcode is right
//   GET  /api/state?schema=V                  → { generation, snapshot, changes, head } (generation null when none yet)
//   GET  /api/changes?generation=G&after=N    → { generation, changes, head } or { reset: true }
//   POST /api/changes    { generation, seq, actor, summary, patches }   → { seq } | 409 { head }
//   POST /api/snapshot   { generation, seq, stateGz }                    → 204
//   POST /api/generation { schema, reason, actor, stateGz }              → { generation }  (first edit, or "Reset demo data")
//
//
// Private materials (a video, slide images): every one of these needs the passcode, reads included.
//   GET    /api/materials                      → { materials: [{ id, name, title, contentType, bytes, chunks, sort, meta, uploadedAt }] }
//   GET    /api/materials/chunk?id=I&idx=N     → the chunk's bytes
//   POST   /api/materials       { name, title, contentType, bytes, chunks, sort, meta, actor }  → { id }
//   POST   /api/materials/chunk { id, idx, data }  (data: base64)    → { complete }
//   DELETE /api/materials?name=NAME            → { removed }
//
// Writes need the edit passcode in the `x-crosswalk-passcode` header. Reads of the shared demo state are open:
// it is fictional data. Private materials are never returned without the passcode.
import { Conflict, type Repo } from './repo'

export interface ApiEnv { repo: Repo; passcode: string }

const MAX_CHANGE_BYTES = 2_000_000
const MAX_SNAPSHOT_BYTES = 8_000_000
const MAX_MATERIAL_CHUNK_CHARS = 1_400_000 // base64 of about 1 MB
const MAX_MATERIAL_CHUNKS = 80
const MATERIAL_TYPES = new Set(['video/mp4', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
const MATERIAL_NAME = /^[a-z0-9][a-z0-9/_-]{0,79}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const empty = (status = 204) => new Response(null, { status, headers: { 'cache-control': 'no-store' } })
const fail = (status: number, error: string) => json({ error }, status)

/** Constant-time string comparison, so response timing does not leak the passcode. */
export function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

async function body<T>(req: Request, max: number): Promise<T | null> {
  const text = await req.text()
  if (text.length > max) return null
  try { return JSON.parse(text) as T } catch { return null }
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN)
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function handle(req: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '')
  const editable = !!env.passcode
  const authorized = () => editable && sameSecret(req.headers.get('x-crosswalk-passcode') ?? '', env.passcode)
  try {
    if (req.method === 'GET' && path === '/api/health') return json({ ok: true, editable })

    if (req.method === 'POST' && path === '/api/auth') return authorized() ? empty() : fail(401, 'Wrong passcode')

    if (req.method === 'GET' && path === '/api/state') {
      const schema = int(url.searchParams.get('schema'))
      if (!Number.isFinite(schema)) return fail(400, 'schema is required')
      const generation = await env.repo.latestGeneration(schema)
      if (!generation) return json({ generation: null, snapshot: null, changes: [], head: 0 })
      const snapshot = await env.repo.latestSnapshot(generation.id)
      const changes = await env.repo.changesAfter(generation.id, snapshot?.seq ?? 0, 5000)
      return json({ generation, snapshot, changes, head: changes.at(-1)?.seq ?? snapshot?.seq ?? 0 })
    }

    if (req.method === 'GET' && path === '/api/changes') {
      const gen = int(url.searchParams.get('generation')), after = int(url.searchParams.get('after')), schema = int(url.searchParams.get('schema'))
      if (!Number.isFinite(gen) || !Number.isFinite(after) || !Number.isFinite(schema)) return fail(400, 'generation, after and schema are required')
      const latest = await env.repo.latestGeneration(schema)
      if (!latest || latest.id !== gen) return json({ reset: true, generation: latest })
      const changes = await env.repo.changesAfter(gen, after)
      return json({ generation: latest, changes, head: changes.at(-1)?.seq ?? after })
    }

    if (path === '/api/materials' || path === '/api/materials/chunk') {
      if (!editable) return fail(403, 'Private materials are turned off on this server')
      if (!authorized()) return fail(401, 'Wrong passcode')

      if (req.method === 'GET' && path === '/api/materials') return json({ materials: await env.repo.listMaterials() })

      if (req.method === 'GET') {
        const id = int(url.searchParams.get('id')), idx = int(url.searchParams.get('idx'))
        if (!Number.isFinite(id) || !Number.isFinite(idx)) return fail(400, 'id and idx are required')
        const data = await env.repo.materialChunk(id, idx)
        if (data == null) return fail(404, 'Not found')
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } })
      }

      if (req.method === 'DELETE' && path === '/api/materials') {
        const name = url.searchParams.get('name') ?? ''
        if (!MATERIAL_NAME.test(name)) return fail(400, 'Bad name')
        return json({ removed: await env.repo.deleteMaterial(name) })
      }

      if (req.method === 'POST' && path === '/api/materials') {
        const b = await body<{ name: string; title: string; contentType: string; bytes: number; chunks: number; sort: number; meta: unknown; actor: string }>(req, 20_000)
        if (!b || typeof b.name !== 'string' || !MATERIAL_NAME.test(b.name) || !MATERIAL_TYPES.has(b.contentType)) return fail(400, 'Bad material')
        if (!Number.isInteger(b.bytes) || b.bytes <= 0 || !Number.isInteger(b.chunks) || b.chunks <= 0 || b.chunks > MAX_MATERIAL_CHUNKS) return fail(400, 'Bad material size')
        const meta = JSON.stringify(b.meta && typeof b.meta === 'object' ? b.meta : {})
        if (meta.length > 8000) return fail(400, 'meta is too large')
        const id = await env.repo.startMaterial({ name: b.name, title: str(b.title), contentType: b.contentType, bytes: b.bytes, chunks: b.chunks, sort: Number.isInteger(b.sort) ? b.sort : 0, meta, by: str(b.actor) })
        return json({ id })
      }

      if (req.method === 'POST') {
        const b = await body<{ id: number; idx: number; data: string }>(req, MAX_MATERIAL_CHUNK_CHARS + 200)
        if (!b || !Number.isInteger(b.id) || !Number.isInteger(b.idx) || typeof b.data !== 'string' || !b.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)) return fail(400, 'Bad chunk')
        const m = await env.repo.material(b.id)
        if (!m) return fail(404, 'Not found')
        if (b.idx < 0 || b.idx >= m.chunks) return fail(400, 'Chunk is out of range')
        return json({ complete: await env.repo.addMaterialChunk(m, b.idx, b.data) })
      }
      return fail(404, 'Not found')
    }

    if (req.method === 'POST' && (path === '/api/changes' || path === '/api/snapshot' || path === '/api/generation')) {
      if (!editable) return fail(403, 'Editing is turned off on this server')
      if (!authorized()) return fail(401, 'Wrong passcode')

      if (path === '/api/changes') {
        const b = await body<{ generation: number; seq: number; actor: string; summary: string; patches: unknown[] }>(req, MAX_CHANGE_BYTES)
        if (!b || !Number.isInteger(b.generation) || !Number.isInteger(b.seq) || !Array.isArray(b.patches)) return fail(400, 'Bad change')
        try {
          await env.repo.appendChange(b.generation, b.seq, str(b.actor), str(b.summary, 500), JSON.stringify(b.patches))
          return json({ seq: b.seq })
        } catch (e) {
          if (e instanceof Conflict) return json({ head: await env.repo.head(b.generation) }, 409)
          throw e
        }
      }
      if (path === '/api/snapshot') {
        const b = await body<{ generation: number; seq: number; stateGz: string }>(req, MAX_SNAPSHOT_BYTES)
        if (!b || !Number.isInteger(b.generation) || !Number.isInteger(b.seq) || typeof b.stateGz !== 'string') return fail(400, 'Bad snapshot')
        if (b.seq > (await env.repo.head(b.generation))) return fail(400, 'Snapshot is ahead of the change log')
        await env.repo.addSnapshot(b.generation, b.seq, b.stateGz)
        return empty()
      }
      const b = await body<{ schema: number; reason: string; actor: string; stateGz: string }>(req, MAX_SNAPSHOT_BYTES)
      if (!b || !Number.isInteger(b.schema) || typeof b.stateGz !== 'string' || !b.stateGz) return fail(400, 'Bad generation')
      const generation = await env.repo.createGeneration(b.schema, str(b.actor), str(b.reason, 500), b.stateGz)
      return json({ generation })
    }

    return fail(404, 'Not found')
  } catch (e) {
    console.error('crosswalk api', e)
    return fail(500, 'Server error')
  }
}
