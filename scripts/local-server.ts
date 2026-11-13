// Run the built app with its API and an in-memory Postgres (PGlite), like the hosted demo but on your machine:
//   npm run build && npm run serve:local        → http://localhost:8788  (edit passcode: "local")
// Data lasts until you stop the server. Set PORT or EDIT_PASSCODE to change them.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { handle } from '../src/server/api'
import { migrate } from '../src/server/migrate'
import { sqlRepo, type Exec } from '../src/server/repo'
import { handleShark } from '../src/server/shark'

const port = Number(process.env.PORT ?? 8788)
const passcode = process.env.EDIT_PASSCODE ?? 'local'
const dist = path.resolve('dist')

const db = new PGlite()
const exec: Exec = async (sql, params) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[]
const dir = path.resolve('migrations')
await migrate(exec, (sql) => db.exec(sql), fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') })))
const repo = sqlRepo(exec)

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  if (url.pathname === '/shark') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync('server/shark.html')); return }
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: body && req.method !== 'GET' ? body : undefined })
    const r = url.pathname.startsWith('/api/shark/') ? await handleShark(request, { exec, passcode }) : await handle(request, { repo, passcode })
    res.writeHead(r.status, Object.fromEntries(r.headers))
    res.end(Buffer.from(await r.arrayBuffer()))
    return
  }
  const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname)
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(port, () => console.log(`Crosswalk on http://localhost:${port}  (edit passcode: ${passcode})`))
