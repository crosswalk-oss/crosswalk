// Cloudflare Pages Functions adapter: every /api/* request goes to the plain handler in src/server/api.ts.
// Configuration comes from the Pages project's secrets: DATABASE_URL (Neon) and EDIT_PASSCODE.
import { neon } from '@neondatabase/serverless'
import { handle } from '../../src/server/api'
import { sqlRepo } from '../../src/server/repo'

interface Env { DATABASE_URL?: string; EDIT_PASSCODE?: string }

export const onRequest = async (ctx: { request: Request; env: Env }): Promise<Response> => {
  if (!ctx.env.DATABASE_URL) return new Response(JSON.stringify({ error: 'DATABASE_URL is not configured' }), { status: 503, headers: { 'content-type': 'application/json' } })
  const sql = neon(ctx.env.DATABASE_URL)
  const repo = sqlRepo(async (text, params) => (await sql.query(text, params ?? [])) as Record<string, unknown>[])
  return handle(ctx.request, { repo, passcode: ctx.env.EDIT_PASSCODE ?? '' })
}
