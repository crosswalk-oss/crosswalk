// Forecast spread against the WBS functions. Pure functions; no storage or UI.
import type { AppState, Forecast, Money, Project, WbsFunction } from '../types'
import { addMonths, argmax, monthKey, monthRange, sum } from '../util'
import { activeBudget } from './position'
import { CONT_CAT, ESC_CAT, LOADER_CAT } from './estimates'

export const wbsFunctions = (s: AppState): WbsFunction[] => s.settings.wbsFunctions

/** WBS function a cost category rolls up to (undefined for loaders/escalation/contingency or unmapped). */
export function fnOfCategory(s: AppState, categoryId: string): string | undefined {
  return s.settings.wbsFunctions.find((f) => f.categoryIds.includes(categoryId))?.id
}

/**
 * Split a by-category amount map into WBS functions. Loaders and escalation are allocated pro-rata
 * to the mapped direct cost; contingency is returned separately; unmapped categories are reported.
 */
export function toFunctions(s: AppState, byCategory: Record<string, Money>): { byFn: Record<string, Money>; contingency: Money; unmapped: Money } {
  const byFn: Record<string, Money> = Object.fromEntries(s.settings.wbsFunctions.map((f) => [f.id, 0]))
  let pool = 0, contingency = 0, unmapped = 0
  for (const [cat, amt] of Object.entries(byCategory)) {
    if ((cat === LOADER_CAT || cat === ESC_CAT) && !fnOfCategory(s, cat)) { pool += amt; continue } // owned by a function (e.g. 900 Project Overhead) → direct; otherwise pro-rata
    if (cat === CONT_CAT) { contingency += amt; continue }
    const fn = fnOfCategory(s, cat)
    if (fn) byFn[fn] += amt
    else unmapped += amt
  }
  const direct = sum(Object.values(byFn))
  if (pool && direct) {
    const ids = Object.keys(byFn)
    const w = ids.map((id) => byFn[id])
    const adds = w.map((x) => Math.round((pool * x) / direct))
    adds[argmax(w)] += pool - sum(adds)
    ids.forEach((id, i) => { byFn[id] += adds[i] })
  }
  return { byFn, contingency, unmapped }
}

/** Current budget by WBS function (active budget + approved changes), contingency separate. */
export function budgetByFunction(s: AppState, pid: string): { byFn: Record<string, Money>; contingency: Money; total: Money } {
  const b = activeBudget(s, pid)
  const cats: Record<string, Money> = { ...(b?.byCategory ?? {}) }
  for (const c of s.changes.filter((c) => c.projectId === pid && c.status === 'approved' && c.fundedFrom === 'new-funding' && (!b || (c.decidedAt ?? c.requestedAt) >= b.createdAt))) cats[c.categoryId] = (cats[c.categoryId] || 0) + c.costImpact
  const { byFn } = toFunctions(s, cats)
  const contingency = b?.contingency ?? 0
  return { byFn, contingency, total: sum(Object.values(byFn)) + contingency }
}

/** Actuals by function by month. Periods without a split are allocated by budget share. */
export function actualsByFunctionMonth(s: AppState, pid: string): Record<string, Record<string, Money>> {
  const out: Record<string, Record<string, Money>> = Object.fromEntries(s.settings.wbsFunctions.map((f) => [f.id, {}]))
  const bud = budgetByFunction(s, pid).byFn
  const btot = sum(Object.values(bud)) || 1
  for (const cp of s.costPeriods.filter((c) => c.projectId === pid)) {
    const split = cp.byFunction ?? Object.fromEntries(Object.entries(bud).map(([k, v]) => [k, Math.round((cp.actual * v) / btot)]))
    for (const [fn, v] of Object.entries(split)) if (out[fn]) out[fn][cp.period] = (out[fn][cp.period] || 0) + v
  }
  return out
}
export function actualsByFunction(s: AppState, pid: string): Record<string, Money> {
  const m = actualsByFunctionMonth(s, pid)
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sum(Object.values(v))]))
}

/** Last month with recorded actuals (or the month before as-of when none). */
export function actualsThrough(s: AppState, pid: string): string {
  const ps = s.costPeriods.filter((c) => c.projectId === pid).map((c) => c.period).sort()
  return ps[ps.length - 1] ?? monthKey(addMonths(s.settings.asOf, -1))
}

/** Months the forecast can be spread into: the month after actuals through to project finish + 3 months. */
export function forecastMonths(s: AppState, p: Project): string[] {
  const from = monthKey(addMonths(actualsThrough(s, p.id) + '-01', 1))
  const ends = p.milestones.map((m) => m.actual ?? m.forecast).sort()
  const last = ends[ends.length - 1] ?? addMonths(s.settings.asOf, 12)
  const to = monthKey(addMonths(last, 3))
  return to >= from ? monthRange(from, to) : [from]
}

export type SpreadMethod = 'even' | 'front' | 'back' | 'scurve' | 'bell'
export const SPREAD_METHODS: { id: SpreadMethod; label: string; hint: string }[] = [
  { id: 'even', label: 'Even', hint: 'Same amount every month' },
  { id: 'scurve', label: 'S-curve', hint: 'Slow start, peak mid-way, taper' },
  { id: 'front', label: 'Front-loaded', hint: 'Most spend early' },
  { id: 'back', label: 'Back-loaded', hint: 'Most spend late' },
  { id: 'bell', label: 'Bell', hint: 'Concentrated in the middle' },
]

export function curve(method: SpreadMethod, n: number): number[] {
  if (n <= 0) return []
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n
    switch (method) {
      case 'even': return 1
      case 'front': return 2 - 1.8 * t
      case 'back': return 0.2 + 1.8 * t
      case 'scurve': return Math.sin(t * Math.PI) + 0.15
      case 'bell': return Math.exp(-(((t - 0.5) / 0.22) ** 2)) + 0.02
    }
  })
}

/** Spread `total` across `months` by a curve; whole dollars that sum exactly to total. */
export function spreadAmount(total: Money, months: string[], method: SpreadMethod): Record<string, Money> {
  const w = curve(method, months.length)
  const W = sum(w) || 1
  const out: Record<string, Money> = {}
  let acc = 0
  months.forEach((m, i) => {
    const v = i === months.length - 1 ? total - acc : Math.round((total * w[i]) / W)
    out[m] = v
    acc += v
  })
  return out
}

const TIMING: Record<WbsFunction['timing'], SpreadMethod> = { early: 'front', mid: 'scurve', late: 'back', flat: 'even' }

/**
 * Default ETC spread: each function's remaining budget (budget − actuals, never negative), scaled so the
 * functions sum to `etcTotal` when given, spread by the function's typical timing.
 */
export function defaultSpread(s: AppState, p: Project, etcTotal?: Money, months = forecastMonths(s, p)): Record<string, Record<string, Money>> {
  const bud = budgetByFunction(s, p.id).byFn
  const act = actualsByFunction(s, p.id)
  const remaining = Object.fromEntries(s.settings.wbsFunctions.map((f) => [f.id, Math.max(0, (bud[f.id] || 0) - (act[f.id] || 0))]))
  const rtot = sum(Object.values(remaining))
  const target = etcTotal ?? rtot
  const fns = s.settings.wbsFunctions
  const w = fns.map((f) => (rtot ? remaining[f.id] : 1))
  const amts = w.map((x) => Math.round((target * x) / (sum(w) || 1)))
  amts[argmax(w)] += target - sum(amts)
  const out: Record<string, Record<string, Money>> = {}
  fns.forEach((f, i) => { out[f.id] = spreadAmount(Math.max(0, amts[i]), months, TIMING[f.timing]) })
  return out
}

export const spreadTotal = (spread?: Record<string, Record<string, Money>>) => sum(Object.values(spread ?? {}).flatMap((m) => Object.values(m)))
export const spreadByFunction = (spread?: Record<string, Record<string, Money>>) => Object.fromEntries(Object.entries(spread ?? {}).map(([k, v]) => [k, sum(Object.values(v))]))
export function spreadByMonth(spread?: Record<string, Record<string, Money>>): Record<string, Money> {
  const out: Record<string, Money> = {}
  for (const m of Object.values(spread ?? {})) for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + v
  return out
}
export function spreadByYear(spread?: Record<string, Record<string, Money>>): Record<string, Money> {
  const out: Record<string, Money> = {}
  for (const [k, v] of Object.entries(spreadByMonth(spread))) out[k.slice(0, 4)] = (out[k.slice(0, 4)] || 0) + v
  return out
}

/** Latest forecast version for a project (any status). */
export const latestForecast = (s: AppState, pid: string): Forecast | undefined =>
  s.forecasts.filter((f) => f.projectId === pid).sort((a, b) => a.date.localeCompare(b.date) || (a.status === 'draft' ? 1 : -1)).pop()

/** EAC implied by a spread: actuals to date + ETC + contingency held. */
export function eacOf(s: AppState, pid: string, spread?: Record<string, Record<string, Money>>, contingencyHeld = 0): Money {
  const act = sum(s.costPeriods.filter((c) => c.projectId === pid).map((c) => c.actual))
  return act + spreadTotal(spread) + contingencyHeld
}

/** Function-level view used by the forecast grid and portfolio roll-ups. */
export interface FnRow { fn: WbsFunction; budget: Money; actual: Money; etc: Money; eac: Money; variance: Money }
export function functionRows(s: AppState, p: Project, f?: Forecast): FnRow[] {
  const bud = budgetByFunction(s, p.id).byFn
  const act = actualsByFunction(s, p.id)
  const etc = spreadByFunction(f?.spread)
  return s.settings.wbsFunctions.map((fn) => {
    const e = (act[fn.id] || 0) + (etc[fn.id] || 0)
    return { fn, budget: bud[fn.id] || 0, actual: act[fn.id] || 0, etc: etc[fn.id] || 0, eac: e, variance: (bud[fn.id] || 0) - e }
  })
}
