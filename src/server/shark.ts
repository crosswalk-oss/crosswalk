// Shark Bucks: a pitch-night investing page that rides on the demo's function and database.
// People open /shark on their phones, spread a fixed budget across the ventures, and a board totals it.
//
//   GET  /api/shark/state                 → { config, investors, totals?, mine? }   (totals only once revealed, or with the passcode)
//   POST /api/shark/invest  { device, name, own, alloc }   → { ok, total }
//   GET  /api/shark/investors             → { investors: [...] }      (passcode)
//   POST /api/shark/config  { title?, budget?, step?, ventures?, open?, reveal? }  → { config }   (passcode)
//   POST /api/shark/reset                 → { config }  starts a new round; earlier rounds stay on record (passcode)
//
// Its two tables are created on first use and are separate from the demo's shared state.
import { sameSecret } from './api'
import type { Exec } from './repo'

export interface SharkEnv { exec: Exec; passcode: string }
export interface Venture { id: string; name: string }
export interface SharkConfig { title: string; budget: number; step: number; ventures: Venture[]; open: boolean; reveal: boolean; round: number }

const DEFAULT: SharkConfig = { title: 'Pitch Night', budget: 100_000, step: 5_000, ventures: [], open: false, reveal: false, round: 1 }
const HEADER = 'x-crosswalk-passcode'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const fail = (status: number, error: string) => json({ error }, status)

const ready = new WeakMap<Exec, Promise<void>>()
function ensure(exec: Exec): Promise<void> {
  let p = ready.get(exec)
  if (!p) {
    p = (async () => {
      await exec('create table if not exists shark_config (id integer primary key, data text not null, updated_at timestamptz not null default now())')
      await exec('create table if not exists shark_investments (id bigserial primary key, round integer not null, device text not null, investor text not null, own_venture text not null default \'\', allocations text not null, total integer not null, at timestamptz not null default now())')
      await exec('create index if not exists shark_investments_round_idx on shark_investments (round, device, id desc)')
    })()
    p.catch(() => ready.delete(exec))
    ready.set(exec, p)
  }
  return p
}

async function loadConfig(exec: Exec): Promise<SharkConfig> {
  const r = await exec('select data from shark_config where id = 1')
  if (!r.length) return { ...DEFAULT }
  try { return { ...DEFAULT, ...(JSON.parse(String(r[0].data)) as Partial<SharkConfig>) } } catch { return { ...DEFAULT } }
}
async function saveConfig(exec: Exec, c: SharkConfig): Promise<void> {
  await exec('insert into shark_config (id, data) values (1, $1) on conflict (id) do update set data = excluded.data, updated_at = now()', [JSON.stringify(c)])
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'venture'
}
/** Venture names → ventures with stable, unique ids. Blank lines and duplicates are dropped. */
export function toVentures(names: unknown): Venture[] {
  if (!Array.isArray(names)) return []
  const out: Venture[] = []
  const seen = new Set<string>()
  const namesSeen = new Set<string>()
  for (const raw of names) {
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
    if (!name || namesSeen.has(name.toLowerCase())) continue
    namesSeen.add(name.toLowerCase())
    let id = slug(name)
    for (let i = 2; seen.has(id); i++) id = `${slug(name)}-${i}`
    seen.add(id)
    out.push({ id, name })
  }
  return out.slice(0, 40)
}

interface Row { device: string; investor: string; own: string; alloc: Record<string, number>; total: number; at: string }
async function latest(exec: Exec, round: number): Promise<Row[]> {
  const rows = await exec('select distinct on (device) device, investor, own_venture, allocations, total, at from shark_investments where round = $1 order by device, id desc', [round])
  return rows.map((r) => {
    let alloc: Record<string, number> = {}
    try { alloc = JSON.parse(String(r.allocations)) as Record<string, number> } catch { /* keep empty */ }
    return { device: String(r.device), investor: String(r.investor), own: String(r.own_venture), alloc, total: Number(r.total), at: r.at instanceof Date ? r.at.toISOString() : String(r.at) }
  })
}

export function totals(config: SharkConfig, rows: Row[]): Record<string, { amount: number; backers: number }> {
  const t: Record<string, { amount: number; backers: number }> = {}
  for (const v of config.ventures) t[v.id] = { amount: 0, backers: 0 }
  for (const r of rows) for (const [id, amt] of Object.entries(r.alloc)) {
    if (!t[id] || !(amt > 0)) continue
    t[id].amount += amt
    t[id].backers += 1
  }
  return t
}

/** Check one person's allocation. Returns the cleaned allocation, or a message saying what is wrong. */
export function checkInvestment(config: SharkConfig, own: string, alloc: unknown): { alloc: Record<string, number>; total: number } | string {
  if (!alloc || typeof alloc !== 'object') return 'Pick at least one venture'
  const ids = new Set(config.ventures.map((v) => v.id))
  const clean: Record<string, number> = {}
  let total = 0
  for (const [id, raw] of Object.entries(alloc as Record<string, unknown>)) {
    if (!ids.has(id)) continue
    const amt = typeof raw === 'number' ? raw : NaN
    if (!Number.isInteger(amt) || amt < 0) return 'Amounts must be whole dollars'
    if (amt === 0) continue
    if (id === own) return 'You cannot invest in your own venture'
    clean[id] = amt
    total += amt
  }
  if (total <= 0) return 'Pick at least one venture'
  if (total > config.budget) return `That is more than your $${config.budget.toLocaleString('en-US')}`
  return { alloc: clean, total }
}

export async function handleShark(req: Request, env: SharkEnv): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '')
  const authorized = () => !!env.passcode && sameSecret(req.headers.get(HEADER) ?? '', env.passcode)
  try {
    await ensure(env.exec)
    const config = await loadConfig(env.exec)

    if (req.method === 'GET' && path === '/api/shark/state') {
      const rows = await latest(env.exec, config.round)
      const device = (req.headers.get('x-shark-device') ?? '').slice(0, 64)
      const me = device ? rows.find((r) => r.device === device) : undefined
      const admin = authorized()
      return json({
        config, investors: rows.length, admin,
        totals: config.reveal || admin ? totals(config, rows) : null,
        mine: me ? { name: me.investor, own: me.own, alloc: me.alloc, total: me.total } : null,
      })
    }

    if (req.method === 'POST' && path === '/api/shark/invest') {
      if (!config.open) return fail(409, 'Investing is closed')
      const text = await req.text()
      if (text.length > 8000) return fail(400, 'Too large')
      let b: { device?: unknown; name?: unknown; own?: unknown; alloc?: unknown }
      try { b = JSON.parse(text) } catch { return fail(400, 'Bad request') }
      const device = typeof b.device === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.device) ? b.device : ''
      const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
      const own = typeof b.own === 'string' && config.ventures.some((v) => v.id === b.own) ? b.own : ''
      if (!device) return fail(400, 'Reload the page and try again')
      if (name.length < 2) return fail(400, 'Enter your name')
      const checked = checkInvestment(config, own, b.alloc)
      if (typeof checked === 'string') return fail(400, checked)
      await env.exec('insert into shark_investments (round, device, investor, own_venture, allocations, total) values ($1, $2, $3, $4, $5, $6)', [config.round, device, name, own, JSON.stringify(checked.alloc), checked.total])
      return json({ ok: true, total: checked.total })
    }

    if (path === '/api/shark/investors' || path === '/api/shark/config' || path === '/api/shark/reset') {
      if (!authorized()) return fail(401, 'Wrong passcode')
      if (req.method === 'GET' && path === '/api/shark/investors') {
        const rows = await latest(env.exec, config.round)
        return json({ investors: rows.map((r) => ({ name: r.investor, own: r.own, alloc: r.alloc, total: r.total, at: r.at })).sort((a, b) => a.name.localeCompare(b.name)) })
      }
      if (req.method === 'POST' && path === '/api/shark/config') {
        let b: Record<string, unknown>
        try { b = JSON.parse(await req.text()) as Record<string, unknown> } catch { return fail(400, 'Bad request') }
        const next: SharkConfig = { ...config }
        if (typeof b.title === 'string') next.title = b.title.trim().slice(0, 80) || DEFAULT.title
        if (typeof b.budget === 'number' && Number.isInteger(b.budget) && b.budget > 0 && b.budget <= 100_000_000) next.budget = b.budget
        if (typeof b.step === 'number' && Number.isInteger(b.step) && b.step > 0) next.step = b.step
        if (Array.isArray(b.ventures)) next.ventures = toVentures(b.ventures)
        if (typeof b.open === 'boolean') next.open = b.open
        if (typeof b.reveal === 'boolean') next.reveal = b.reveal
        await saveConfig(env.exec, next)
        return json({ config: next })
      }
      if (req.method === 'POST' && path === '/api/shark/reset') {
        const next: SharkConfig = { ...config, round: config.round + 1, reveal: false }
        await saveConfig(env.exec, next)
        return json({ config: next })
      }
    }
    return fail(404, 'Not found')
  } catch (e) {
    console.error('shark api', e)
    return fail(500, 'Server error')
  }
}
