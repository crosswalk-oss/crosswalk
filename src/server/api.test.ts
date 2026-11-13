// The shared-state API against a real Postgres (PGlite, in memory): migrations, passcode, append-only log,
// conflicts, snapshots and resets.
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { handle, sameSecret } from './api'
import { migrate } from './migrate'
import { sqlRepo, type Exec } from './repo'

const MIG = path.resolve(__dirname, '../../migrations')
const migrations = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: fs.readFileSync(path.join(MIG, name), 'utf8') }))

let db: PGlite
let exec: Exec
const PASS = 'arroyo-demo'
const call = (method: string, url: string, body?: unknown, pass?: string) =>
  handle(new Request('https://demo.test' + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: pass ? { 'x-crosswalk-passcode': pass } : {} }), { repo: sqlRepo(exec), passcode: PASS })

beforeAll(async () => {
  db = new PGlite()
  exec = async (sql, params) => (await db.query(sql, params as any[])).rows as Record<string, unknown>[]
  expect(await migrate(exec, (sql) => db.exec(sql), migrations)).toEqual(migrations.map((m) => m.name))
  expect(await migrate(exec, (sql) => db.exec(sql), migrations)).toEqual([]) // idempotent
})
afterAll(async () => { await db.close() })

describe('shared state API', () => {
  it('health reports that editing is on; auth checks the passcode', async () => {
    expect(await (await call('GET', '/api/health')).json()).toEqual({ ok: true, editable: true })
    expect((await call('POST', '/api/auth', {}, 'nope')).status).toBe(401)
    expect((await call('POST', '/api/auth', {}, PASS)).status).toBe(204)
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
    expect(sameSecret('abc', 'abcd')).toBe(false)
  })

  it('reads are open, writes need the passcode', async () => {
    expect(await (await call('GET', '/api/state?schema=9')).json()).toMatchObject({ generation: null, changes: [], head: 0 })
    expect((await call('POST', '/api/generation', { schema: 9, reason: 'x', actor: 'u', stateGz: 'AAA' })).status).toBe(401)
    expect((await call('POST', '/api/generation', { schema: 9, reason: 'x', actor: 'u', stateGz: 'AAA' }, 'wrong')).status).toBe(401)
  })

  it('generation → ordered changes → conflict on a stale seq → snapshot → read back', async () => {
    const g = (await (await call('POST', '/api/generation', { schema: 9, reason: 'First edit', actor: 'u-me', stateGz: 'SEED' }, PASS)).json()).generation
    expect(g.id).toBeGreaterThan(0)
    const p1 = [{ op: 'replace', path: ['settings', 'orgName'], value: 'A' }]
    expect(await (await call('POST', '/api/changes', { generation: g.id, seq: 1, actor: 'u-me', summary: 'one', patches: p1 }, PASS)).json()).toEqual({ seq: 1 })
    // a second writer that has not seen change 1 is told to catch up
    const stale = await call('POST', '/api/changes', { generation: g.id, seq: 1, actor: 'u-pm1', summary: 'late', patches: p1 }, PASS)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ head: 1 })
    expect((await call('POST', '/api/changes', { generation: g.id, seq: 3, actor: 'u-me', summary: 'gap', patches: p1 }, PASS)).status).toBe(409)
    await call('POST', '/api/changes', { generation: g.id, seq: 2, actor: 'u-pm1', summary: 'two', patches: [{ op: 'add', path: ['audit', 0], value: { id: 'a' } }] }, PASS)

    const st = await (await call('GET', '/api/state?schema=9')).json()
    expect(st.snapshot).toEqual({ seq: 0, stateGz: 'SEED' })
    expect(st.changes.map((c: { seq: number }) => c.seq)).toEqual([1, 2])
    expect(JSON.parse(st.changes[0].patches)).toEqual(p1) // patches pass through untouched
    expect(st.head).toBe(2)

    expect((await (await call('GET', `/api/changes?schema=9&generation=${g.id}&after=1`)).json()).changes.map((c: { seq: number }) => c.seq)).toEqual([2])
    expect((await call('POST', '/api/snapshot', { generation: g.id, seq: 5, stateGz: 'X' }, PASS)).status).toBe(400) // ahead of the log
    expect((await call('POST', '/api/snapshot', { generation: g.id, seq: 2, stateGz: 'SNAP2' }, PASS)).status).toBe(204)
    const st2 = await (await call('GET', '/api/state?schema=9')).json()
    expect(st2.snapshot).toEqual({ seq: 2, stateGz: 'SNAP2' })
    expect(st2.changes).toEqual([])
    expect(st2.head).toBe(2)
  })

  it('"Reset demo data" starts a new generation; clients on the old one are told to reload', async () => {
    const old = (await (await call('GET', '/api/state?schema=9')).json()).generation
    const g2 = (await (await call('POST', '/api/generation', { schema: 9, reason: 'Reset demo data', actor: 'u-me', stateGz: 'SEED2' }, PASS)).json()).generation
    expect(g2.id).toBeGreaterThan(old.id)
    expect(await (await call('GET', `/api/changes?schema=9&generation=${old.id}&after=2`)).json()).toMatchObject({ reset: true, generation: { id: g2.id } })
    // the old generation's history is still there (nothing was deleted)
    expect((await exec('select count(*)::int as n from changes where generation_id = $1', [old.id]))[0].n).toBe(2)
  })

  it('the database refuses to update or delete any record (append-only, rule 21)', async () => {
    await expect(exec("update changes set summary = 'edited'")).rejects.toThrow(/append-only/)
    await expect(exec('delete from changes')).rejects.toThrow(/append-only/)
    await expect(exec('delete from snapshots')).rejects.toThrow(/append-only/)
    await expect(exec("update generations set reason = 'x'")).rejects.toThrow(/append-only/)
    await expect(db.exec('truncate changes')).rejects.toThrow(/append-only/)
  })

  it('editing is off when the server has no passcode configured; bad input is rejected', async () => {
    const off = (m: string, u: string, b?: unknown) => handle(new Request('https://demo.test' + u, { method: m, body: b ? JSON.stringify(b) : undefined, headers: { 'x-crosswalk-passcode': '' } }), { repo: sqlRepo(exec), passcode: '' })
    expect(await (await off('GET', '/api/health')).json()).toEqual({ ok: true, editable: false })
    expect((await off('POST', '/api/changes', { generation: 1, seq: 9, patches: [] })).status).toBe(403)
    expect((await call('GET', '/api/state')).status).toBe(400)
    expect((await call('POST', '/api/changes', { nope: true }, PASS)).status).toBe(400)
    expect((await call('GET', '/api/nothing')).status).toBe(404)
  })
})
