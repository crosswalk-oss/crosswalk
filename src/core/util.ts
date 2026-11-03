import type { Condition, ISODate } from './types'

let counter = 0
/** Unique id with a readable prefix, e.g. uid('est') -> 'est_l3k9x2a1'. */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36).slice(-5)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// The clock can be pinned (used when replaying history into seed data).
let pinned: { date: string; tick: number } | null = null
export function setClock(date: string | null) {
  pinned = date ? { date, tick: 0 } : null
}
export const nowISO = () => {
  if (!pinned) return new Date().toISOString()
  pinned.tick++
  const mins = 8 * 60 + pinned.tick * 7
  const hh = String(Math.min(23, Math.floor(mins / 60))).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  return `${pinned.date}T${hh}:${mm}:00.000Z`
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = new Date(d + 'T12:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
export function addMonths(d: ISODate, n: number): ISODate {
  const t = new Date(d + 'T12:00:00Z')
  t.setUTCMonth(t.getUTCMonth() + n)
  return t.toISOString().slice(0, 10)
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
}
export const monthKey = (d: ISODate) => d.slice(0, 7)
export function monthRange(fromKey: string, toKey: string): string[] {
  const out: string[] = []
  let [y, m] = fromKey.split('-').map(Number)
  const [ty, tm] = toKey.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 'Oct 28, 2026' */
export function fmtDate(d?: string): string {
  if (!d) return '—'
  const y = d.slice(0, 4), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10))
  if (!day) return `${MONTHS[m - 1]} ${y}`
  return `${MONTHS[m - 1]} ${day}, ${y}`
}
/** 'Oct 2026' from 'YYYY-MM' */
export const fmtMonth = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`
/** 'Oct 28, 2026 3:42 PM' */
export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** $1.24M · $842K · $9,500 (compact) or $1,240,000 (full) */
export function money(n: number | undefined, mode: 'compact' | 'full' = 'compact'): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (mode === 'full') return sign + '$' + Math.round(a).toLocaleString('en-US')
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${Math.round(a)}`
}
/** Signed money for variances: +$1.2M / −$300K */
export const moneyDelta = (n: number) => (n > 0 ? '+' : '') + money(n)
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`
export const num = (n: number) => n.toLocaleString('en-US')
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
/** Index of the largest value (first on ties) — where rounding remainders go so empty buckets stay empty. */
export const argmax = (xs: number[]) => xs.reduce((bi, x, i) => (x > xs[bi] ? i : bi), 0)
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const x of xs) (out[key(x)] ||= []).push(x)
  return out
}

/** Read a dotted path from an object: get(p, 'location.hca') */
export function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj)
}

export function evalCondition(c: Condition | undefined, obj: unknown): boolean {
  if (!c) return true
  const v = get(obj, c.field) as any
  const t = c.value as any
  switch (c.op) {
    case 'eq': return v === t
    case 'ne': return v !== t
    case 'gt': return Number(v) > Number(t)
    case 'gte': return Number(v) >= Number(t)
    case 'lt': return Number(v) < Number(t)
    case 'lte': return Number(v) <= Number(t)
    case 'in': return Array.isArray(t) && t.includes(v)
    case 'truthy': return !!v
    case 'falsy': return !v
  }
}
export function describeCondition(c?: Condition): string {
  if (!c) return 'Always'
  const ops: Record<string, string> = { eq: 'is', ne: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'is one of', truthy: 'is yes', falsy: 'is no' }
  const val = c.op === 'truthy' || c.op === 'falsy' ? '' : ' ' + (Array.isArray(c.value) ? (c.value as unknown[]).join(', ') : String(c.value))
  return `${c.field} ${ops[c.op]}${val}`
}

/** Deterministic PRNG (mulberry32) for seed data and Monte Carlo reproducibility. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
  }
}

/** Sample a triangular distribution. */
export function triangular(u: number, min: number, ml: number, max: number): number {
  if (max <= min) return ml
  const f = (ml - min) / (max - min)
  return u < f ? min + Math.sqrt(u * (max - min) * (ml - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - ml))
}

export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')
