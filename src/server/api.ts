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
// Writes need the edit passcode in the `x-crosswalk-passcode` header. Reads are open: the demo is fictional data.
import { Conflict, type Repo } from './repo'

export interface ApiEnv { repo: Repo; passcode: string }

const MAX_CHANGE_BYTES = 2_000_000
const MAX_SNAPSHOT_BYTES = 8_000_000

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
