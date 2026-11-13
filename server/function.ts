// Neon Function: serves the Crosswalk page and its API from one HTTPS URL, next to the Postgres database.
// The API is the plain (request) => response handler in src/server/api.ts (AGENT_RULES rule 18).
// Neon injects DATABASE_URL / DATABASE_URL_UNPOOLED; EDIT_PASSCODE comes from neon.ts.
import { gzipSync } from 'node:zlib'
import { Pool } from '@neondatabase/serverless'
import { attachDatabasePool } from '@neon/functions'
import { handle } from '../src/server/api'
import { migrate } from '../src/server/migrate'
import { sqlRepo, type Exec } from '../src/server/repo'
import { handleShark } from '../src/server/shark'
import page from './page.generated'
import migrations from './migrations.generated'
import sharkPage from './shark.generated'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
attachDatabasePool(pool as never)
const exec: Exec = async (sql, params) => (await pool.query(sql, params as unknown[])).rows as Record<string, unknown>[]
const repo = sqlRepo(exec)

// Apply any new SQL migrations once per isolate, over a direct (unpooled) connection.
let schemaReady: Promise<unknown> | null = null
function ensureSchema() {
  schemaReady ??= (async () => {
    const direct = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL, max: 1 })
    try {
      const run: Exec = async (sql, params) => (await direct.query(sql, params as unknown[])).rows as Record<string, unknown>[]
      await migrate(run, (sql) => direct.query(sql), migrations)
    } finally { await direct.end() }
  })().catch((e) => { schemaReady = null; throw e })
  return schemaReady
}

const pageGz = gzipSync(Buffer.from(page, 'utf8'))
const SECURITY = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/shark/')) {
      const res = await handleShark(request, { exec, passcode: process.env.EDIT_PASSCODE ?? '' })
      for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v)
      return res
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/shark' || url.pathname === '/shark/')) {
      return new Response(request.method === 'HEAD' ? null : sharkPage, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SECURITY } })
    }
    if (url.pathname.startsWith('/api/')) {
      try { await ensureSchema() } catch (e) {
        console.error('crosswalk migrations', e)
        return new Response(JSON.stringify({ error: 'Database is not ready' }), { status: 503, headers: { 'content-type': 'application/json' } })
      }
      const res = await handle(request, { repo, passcode: process.env.EDIT_PASSCODE ?? '' })
      for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v)
      return res
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      const gzip = /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', vary: 'accept-encoding', ...SECURITY }
      if (gzip) headers['content-encoding'] = 'gzip'
      return new Response(request.method === 'HEAD' ? null : gzip ? pageGz : page, { headers })
    }
    return new Response('Not found', { status: 404, headers: SECURITY })
  },
}
