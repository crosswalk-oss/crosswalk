// End to end without a browser: the store + sync engine + shared data client talk to the real API handler
// (fetch is routed to it) backed by Postgres (PGlite). A second "browser" is simulated with direct API calls.
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { handle } from '@/server/api'
import { migrate } from '@/server/migrate'
import { sqlRepo, type Exec } from '@/server/repo'
import { sharedDataAccess, gzipBase64, gunzipBase64 } from '@/core/data/server'
import { createSync, PASSCODE_KEY, type Sync } from './sync'
import { mutate, useStore } from './store'
import { buildSeed, SCHEMA_VERSION } from './seed'

const PASS = 'arroyo-demo'
let db: PGlite
let exec: Exec
let apiUp = true
let data: ReturnType<typeof sharedDataAccess>
const notes: string[] = []
const st = () => useStore.getState()
const orgName = () => st().settings.orgName

beforeAll(async () => {
  db = new PGlite()
  exec = async (sql, params) => (await db.query(sql, params as any[])).rows as Record<string, unknown>[]
  const dir = path.resolve(__dirname, '../../migrations')
  await migrate(exec, (sql) => db.exec(sql), fs.readdirSync(dir).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') })))
  ;(globalThis as any).fetch = async (input: string, init?: RequestInit) => {
    if (!apiUp) throw new TypeError('network down')
    return handle(new Request('https://demo.test/' + input, init), { repo: sqlRepo(exec), passcode: PASS })
  }
  data = sharedDataAccess()
})
afterAll(async () => { await db.close() })

const newSync = () => createSync({ data, gzip: gzipBase64, gunzip: gunzipBase64, notify: (m) => notes.push(m) })
/** A second editor, writing straight to the API. */
async function otherEditor(patches: unknown[], summary = 'other') {
  const s = await (await fetch('api/state?schema=' + SCHEMA_VERSION)).json()
  const r = await fetch('api/changes', { method: 'POST', headers: { 'x-crosswalk-passcode': PASS }, body: JSON.stringify({ generation: s.generation.id, seq: s.head + 1, actor: 'u-pm1', summary, patches }) })
  expect(r.status).toBe(200)
}

describe('shared data sync', () => {
  let sync: Sync
  beforeEach(() => { useStore.setState(buildSeed()); data.removePref(PASSCODE_KEY); notes.length = 0 })
  afterEach(() => sync?.stop())

  it('with no API the app runs in memory and says so', async () => {
    apiUp = false
    sync = newSync()
    await sync.start({ poll: false })
    expect(st().sync.mode).toBe('offline')
    apiUp = true
  })

  it('a viewer without the passcode sees shared data; their edits stay on the page only', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    expect(st().sync).toMatchObject({ mode: 'shared', editable: true, canEdit: false })
    mutate((d) => { d.settings.orgName = 'Viewer edit' })
    expect(st().sync.unsaved).toBe(true)
    expect((await (await fetch('api/state?schema=' + SCHEMA_VERSION)).json()).generation).toBeNull()
    expect(await sync.unlock('wrong')).toBe(false)
  })

  it('an editor’s first change starts the shared dataset; changes persist across a fresh load', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    expect(await sync.unlock(PASS)).toBe(true)
    expect(data.getPref(PASSCODE_KEY)).toBe(PASS)
    mutate((d) => { d.settings.orgName = 'Arroyo Valley Gas — shared' }, { entity: 'settings', entityId: 'org', action: 'update', summary: 'Renamed org' })
    expect(await sync.idle()).toBe(true)
    mutate((d) => { d.projects[0].name = 'Renamed project' })
    expect(await sync.idle()).toBe(true)
    expect(sync.position).toMatchObject({ seq: 2, pending: 0 })
    const g = sync.position.generation
    sync.stop()

    // a brand-new browser session: everything comes back from the database
    useStore.setState(buildSeed())
    data.removePref(PASSCODE_KEY)
    sync = newSync()
    await sync.start({ poll: false })
    expect(orgName()).toBe('Arroyo Valley Gas — shared')
    expect(st().projects[0].name).toBe('Renamed project')
    expect(st().audit.at(-1)?.summary).toBe('Renamed org')
    expect(sync.position).toMatchObject({ generation: g, seq: 2 })
  })

  it('others’ edits arrive by polling; the persona you act as stays per browser', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    await sync.unlock(PASS)
    useStore.getState().setUser('u-pm1')
    await otherEditor([{ op: 'replace', path: ['settings', 'orgName'], value: 'Edited elsewhere' }])
    await sync.poll()
    expect(orgName()).toBe('Edited elsewhere')
    expect(st().currentUserId).toBe('u-pm1')
    const changes = await exec('select patches from changes')
    expect(changes.some((c) => String(c.patches).includes('currentUserId'))).toBe(false)
  })

  it('secrets (AI key, map tokens) and the persona never reach the shared database', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    await sync.unlock(PASS)
    mutate((d) => { d.settings.ai.apiKey = 'sk-live-should-never-leave'; d.settings.orgName = 'With secret nearby' })
    mutate((d) => { d.settings.ai = { ...d.settings.ai, apiKey: 'sk-also-hidden' } })
    expect(await sync.idle()).toBe(true)
    const rows = await exec('select patches from changes union all select state_gz as patches from snapshots')
    for (const r of rows) expect(String(r.patches)).not.toMatch(/sk-live|sk-also/)
    for (const r of await exec('select state_gz from snapshots')) expect(await gunzipBase64(String(r.state_gz))).not.toMatch(/sk-live|sk-also|"apiKey"/)
    expect(st().settings.ai.apiKey).toBe('sk-also-hidden') // still usable on this browser
  })

  it('two editors at once: our change is re-applied on top of theirs (no lost update)', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    await sync.unlock(PASS)
    const before = st().projects.length
    // someone else saves first…
    await otherEditor([{ op: 'replace', path: ['projects', 1, 'name'], value: 'Their edit' }])
    // …then we save without having seen it
    mutate((d) => { d.projects[2].name = 'Our edit' })
    expect(await sync.idle()).toBe(true)
    expect(st().projects[1].name).toBe('Their edit')
    expect(st().projects[2].name).toBe('Our edit')
    expect(st().projects.length).toBe(before)
    expect(sync.position.pending).toBe(0)
    // and the database agrees: a fresh load shows both
    sync.stop(); useStore.setState(buildSeed()); sync = newSync(); await sync.start({ poll: false })
    expect([st().projects[1].name, st().projects[2].name]).toEqual(['Their edit', 'Our edit'])
  })

  it('"Reset demo data" by an editor starts a new generation for everyone; history is kept', async () => {
    sync = newSync()
    await sync.start({ poll: false })
    await sync.unlock(PASS)
    const old = sync.position.generation
    mutate((d) => { d.settings.orgName = 'Before reset' })
    expect(await sync.idle()).toBe(true)
    st().reset()
    for (let i = 0; i < 40 && sync.position.generation === old; i++) await new Promise((r) => setTimeout(r, 25))
    expect(sync.position.generation).not.toBe(old)
    expect(orgName()).toBe(buildSeed().settings.orgName)
    expect((await exec('select count(*)::int as n from changes where generation_id = $1', [old]))[0].n).toBeGreaterThan(0)
  })
})
