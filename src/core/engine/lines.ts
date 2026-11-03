// Forecast line items under the WBS functions: budget, actuals and ETC by line, roll-ups to function,
// and per-function curve profiles. Pure functions; no storage or UI.
import type { AppState, CostPeriod, FnProfile, Forecast, ForecastLine, Money, Project, SpreadProfile } from '../types'
import { argmax, monthRange, sum } from '../util'
import { CONT_CAT, ESC_CAT, LOADER_CAT } from './estimates'
import { activeBudget } from './position'
import { curve, forecastMonths, SPREAD_METHODS, type SpreadMethod } from './wbs'

export type Grid = Record<string, Record<string, Money>> // key → month → $

export const forecastLines = (s: AppState): ForecastLine[] => s.settings.forecastLines.filter((l) => l.active)
export const linesOfFunction = (s: AppState, fnId: string) => forecastLines(s).filter((l) => l.functionId === fnId)
export const lineById = (s: AppState, id?: string) => s.settings.forecastLines.find((l) => l.id === id)
export const functionOfLine = (s: AppState, lineId: string) => lineById(s, lineId)?.functionId

/** Line a CBS category's budget belongs to (first active line that lists it). */
export const lineOfCategory = (s: AppState, categoryId: string) => forecastLines(s).find((l) => l.categoryIds.includes(categoryId))?.id

/** Split a by-category amount map into lines. Loaders and escalation go pro-rata to direct lines; contingency separate. */
export function toLines(s: AppState, byCategory: Record<string, Money>): { byLine: Record<string, Money>; contingency: Money; unmapped: Money } {
  const byLine: Record<string, Money> = Object.fromEntries(forecastLines(s).map((l) => [l.id, 0]))
  let pool = 0, contingency = 0, unmapped = 0
  for (const [cat, amt] of Object.entries(byCategory)) {
    if ((cat === LOADER_CAT || cat === ESC_CAT) && !lineOfCategory(s, cat)) { pool += amt; continue } // owned by a function (e.g. 900 Project Overhead) → direct; otherwise pro-rata
    if (cat === CONT_CAT) { contingency += amt; continue }
    const l = lineOfCategory(s, cat)
    if (l) byLine[l] += amt
    else unmapped += amt
  }
  return { byLine: allocate(byLine, pool), contingency, unmapped }
}

/** Add `pool` to a map pro-rata to its values (whole dollars, exact total). Even split when the base is zero. */
export function allocate(base: Record<string, Money>, pool: Money): Record<string, Money> {
  const out = { ...base }
  const ids = Object.keys(out)
  if (!pool || !ids.length) return out
  const tot = sum(Object.values(base))
  const w = ids.map((id) => (tot ? base[id] : 1))
  const adds = w.map((x) => Math.round((pool * x) / sum(w)))
  adds[argmax(w)] += pool - sum(adds)
  ids.forEach((id, i) => { out[id] += adds[i] })
  return out
}

/** Current budget by line (active budget + approved new-funding changes), contingency separate. */
export function budgetByLine(s: AppState, pid: string): { byLine: Record<string, Money>; contingency: Money } {
  const b = activeBudget(s, pid)
  const cats: Record<string, Money> = { ...(b?.byCategory ?? {}) }
  for (const c of s.changes.filter((c) => c.projectId === pid && c.status === 'approved' && c.fundedFrom === 'new-funding' && (!b || (c.decidedAt ?? c.requestedAt) >= b.createdAt))) cats[c.categoryId] = (cats[c.categoryId] || 0) + c.costImpact
  return { byLine: toLines(s, cats).byLine, contingency: b?.contingency ?? 0 }
}

/** Roll a line map up to functions. */
export function linesToFunctions(s: AppState, byLine: Record<string, Money>): Record<string, Money> {
  const out: Record<string, Money> = Object.fromEntries(s.settings.wbsFunctions.map((f) => [f.id, 0]))
  for (const [lid, v] of Object.entries(byLine)) { const fn = functionOfLine(s, lid); if (fn && fn in out) out[fn] += v }
  return out
}
/** Roll a line × month grid up to function × month. */
export function rollupGrid(s: AppState, lineGrid?: Grid): Grid {
  const out: Grid = Object.fromEntries(s.settings.wbsFunctions.map((f) => [f.id, {}]))
  for (const [lid, months] of Object.entries(lineGrid ?? {})) {
    const fn = functionOfLine(s, lid)
    if (!fn || !out[fn]) continue
    for (const [m, v] of Object.entries(months)) out[fn][m] = (out[fn][m] || 0) + v
  }
  return out
}

/** A period's actuals by line. Periods without a line split are allocated by line budget share. */
export function periodByLine(s: AppState, cp: CostPeriod, budget: Record<string, Money>): Record<string, Money> {
  if (cp.byLine) return cp.byLine
  if (cp.byFunction) {
    // split each function's actual to its lines by budget share
    const out: Record<string, Money> = {}
    for (const [fn, amt] of Object.entries(cp.byFunction)) {
      const ls = linesOfFunction(s, fn)
      if (!ls.length) continue
      Object.assign(out, allocate(Object.fromEntries(ls.map((l) => [l.id, budget[l.id] || 0])), amt))
    }
    return out
  }
  return allocate(Object.fromEntries(Object.keys(budget).map((k) => [k, budget[k]])), cp.actual)
}

export function actualsByLineMonth(s: AppState, pid: string): Grid {
  const out: Grid = Object.fromEntries(forecastLines(s).map((l) => [l.id, {}]))
  const bud = budgetByLine(s, pid).byLine
  for (const cp of s.costPeriods.filter((c) => c.projectId === pid)) {
    for (const [lid, v] of Object.entries(periodByLine(s, cp, bud))) { out[lid] ??= {}; out[lid][cp.period] = (out[lid][cp.period] || 0) + v }
  }
  return out
}
export function actualsByLine(s: AppState, pid: string): Record<string, Money> {
  return Object.fromEntries(Object.entries(actualsByLineMonth(s, pid)).map(([k, v]) => [k, sum(Object.values(v))]))
}

// ───────────────────────────── Profiles

export const BUILT_IN_PROFILES: { id: string; name: string; description: string }[] = SPREAD_METHODS.map((m) => ({ id: m.id, name: m.label, description: m.hint }))
export const isBuiltIn = (id: string) => SPREAD_METHODS.some((m) => m.id === id)
export function profileName(s: AppState, id: string) {
  return BUILT_IN_PROFILES.find((p) => p.id === id)?.name ?? s.settings.spreadProfiles.find((p) => p.id === id)?.name ?? id
}
export function allProfiles(s: AppState): { id: string; name: string; description: string; custom: boolean }[] {
  return [...BUILT_IN_PROFILES.map((p) => ({ ...p, custom: false })), ...s.settings.spreadProfiles.map((p) => ({ id: p.id, name: p.name, description: p.description, custom: true }))]
}

/** Resample a weight shape to n points (linear interpolation; area-preserving enough for phasing). */
export function resample(weights: number[], n: number): number[] {
  if (n <= 0) return []
  if (!weights.length) return Array(n).fill(1)
  if (weights.length === 1) return Array(n).fill(Math.max(0, weights[0]))
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const x = t * (weights.length - 1)
    const a = Math.floor(x), b = Math.min(weights.length - 1, a + 1)
    return Math.max(0, weights[a] + (weights[b] - weights[a]) * (x - a))
  })
}

/** Weights for a profile over a list of months (honours black-out calendar months). */
export function profileWeights(s: AppState, profileId: string, months: string[]): number[] {
  const custom = s.settings.spreadProfiles.find((p) => p.id === profileId)
  let w = custom ? resample(custom.weights, months.length) : curve((isBuiltIn(profileId) ? profileId : 'even') as SpreadMethod, months.length)
  if (custom?.zeroMonths?.length) {
    const masked = w.map((x, i) => (custom.zeroMonths!.includes(Number(months[i].slice(5, 7))) ? 0 : x))
    if (sum(masked) > 0) w = masked
  }
  return w
}

/** Spread `total` over months by weights; whole dollars that sum exactly to total. */
export function spreadByWeights(total: Money, months: string[], w: number[]): Record<string, Money> {
  const W = sum(w) || 1
  const out: Record<string, Money> = {}
  let acc = 0
  const lastNz = w.reduce((li, x, i) => (x > 0 ? i : li), months.length - 1)
  months.forEach((m, i) => {
    const v = i === lastNz ? total - acc : Math.round((total * w[i]) / W)
    out[m] = v
    acc += v
  })
  return out
}

/**
 * Apply a profile to one function in a forecast: the function's ETC (`fnTotal`, default = its current ETC)
 * is split to its lines by each line's current ETC share (or remaining budget when the function is empty),
 * then each line is phased by the profile between start and end. Months outside the window are zeroed.
 * Returns the new line grid for that function's lines.
 */
export function applyProfile(s: AppState, p: Project, f: Pick<Forecast, 'lineSpread'>, fnId: string, prof: Pick<FnProfile, 'profileId' | 'start' | 'end'>, fnTotal?: Money): Grid {
  const lines = linesOfFunction(s, fnId)
  const cur = f.lineSpread ?? {}
  const curTot = Object.fromEntries(lines.map((l) => [l.id, sum(Object.values(cur[l.id] ?? {}))]))
  const total = fnTotal ?? sum(Object.values(curTot))
  let shares = curTot
  if (!sum(Object.values(shares))) {
    const bud = budgetByLine(s, p.id).byLine
    const act = actualsByLine(s, p.id)
    shares = Object.fromEntries(lines.map((l) => [l.id, Math.max(0, (bud[l.id] || 0) - (act[l.id] || 0))]))
  }
  const split = splitExact(total, Object.fromEntries(lines.map((l) => [l.id, shares[l.id] || 0])))
  const all = forecastMonths(s, p)
  const start = prof.start < all[0] ? all[0] : prof.start
  const end = prof.end < start ? start : prof.end
  const window = monthRange(start, end)
  const w = profileWeights(s, prof.profileId, window)
  const out: Grid = {}
  for (const l of lines) {
    const row: Record<string, Money> = Object.fromEntries(all.map((m) => [m, 0]))
    Object.assign(row, spreadByWeights(split[l.id] || 0, window, w))
    out[l.id] = row
  }
  return out
}

/** Split total across keys by weights (whole dollars, exact; even split when weights are all zero). */
export function splitExact(total: Money, weights: Record<string, number>): Record<string, Money> {
  const ids = Object.keys(weights)
  if (!ids.length) return {}
  const W = sum(Object.values(weights))
  const w = ids.map((id) => (W ? weights[id] : 1))
  const v = w.map((x) => Math.round((total * x) / sum(w)))
  v[argmax(w)] += total - sum(v)
  return Object.fromEntries(ids.map((id, i) => [id, v[i]]))
}

/** Default line spread for a new forecast: remaining budget per line (scaled to etcTotal), phased by the function's timing. */
export function defaultLineSpread(s: AppState, p: Project, etcTotal?: Money): { lineSpread: Grid; profiles: Record<string, FnProfile> } {
  const months = forecastMonths(s, p)
  const bud = budgetByLine(s, p.id).byLine
  const act = actualsByLine(s, p.id)
  const remaining = Object.fromEntries(forecastLines(s).map((l) => [l.id, Math.max(0, (bud[l.id] || 0) - (act[l.id] || 0))]))
  const target = etcTotal ?? sum(Object.values(remaining))
  const scaled = splitExact(target, remaining)
  const timing: Record<string, SpreadMethod> = { early: 'front', mid: 'scurve', late: 'back', flat: 'even' }
  const lineSpread: Grid = {}
  const profiles: Record<string, FnProfile> = {}
  for (const fn of s.settings.wbsFunctions) {
    const method = timing[fn.timing]
    profiles[fn.id] = { profileId: method, start: months[0], end: months[months.length - 1], adjusted: false }
    const w = profileWeights(s, method, months)
    for (const l of linesOfFunction(s, fn.id)) lineSpread[l.id] = spreadByWeights(Math.max(0, scaled[l.id] || 0), months, w)
  }
  return { lineSpread, profiles }
}

/**
 * Line grid for a forecast. Older forecast versions only carry `spread` by function: split each function's
 * months to its lines by remaining-budget share so every version can be read at line level.
 */
export function lineGridOf(s: AppState, p: Project, f?: Pick<Forecast, 'lineSpread' | 'spread'>): Grid {
  if (!f) return {}
  if (f.lineSpread) return f.lineSpread
  const bud = budgetByLine(s, p.id).byLine
  const act = actualsByLine(s, p.id)
  const out: Grid = {}
  for (const [fn, months] of Object.entries(f.spread ?? {})) {
    const ls = linesOfFunction(s, fn)
    const w = Object.fromEntries(ls.map((l) => [l.id, Math.max(0, (bud[l.id] || 0) - (act[l.id] || 0)) || 1]))
    for (const l of ls) out[l.id] = {}
    for (const [m, v] of Object.entries(months)) {
      const sp = splitExact(v, w)
      for (const l of ls) out[l.id][m] = sp[l.id]
    }
  }
  return out
}

// ───────────────────────────── ETC / EAC by function and line

export interface LineRow { line: ForecastLine; budget: Money; actual: Money; etc: Money; eac: Money; vac: Money }
export interface FunctionRow {
  fnId: string; code: string; name: string
  budget: Money; actual: Money; etc: Money; eac: Money; vac: Money // vac = budget − EAC
  pctSpent: number // actual / EAC
  profile?: FnProfile
  lines: LineRow[]
}
/** ETC and EAC by WBS function (lines nested). EAC = actuals to date + ETC. Contingency is reported separately. */
export function etcEacByFunction(s: AppState, p: Project, f?: Forecast): { rows: FunctionRow[]; contingencyHeld: Money; totals: { budget: Money; actual: Money; etc: Money; eac: Money; vac: Money } } {
  const bud = budgetByLine(s, p.id)
  const act = actualsByLine(s, p.id)
  const grid = lineGridOf(s, p, f)
  const rows: FunctionRow[] = s.settings.wbsFunctions.map((fn) => {
    const lines = linesOfFunction(s, fn.id).map((line) => {
      const budget = bud.byLine[line.id] || 0, actual = act[line.id] || 0, etc = sum(Object.values(grid[line.id] ?? {}))
      return { line, budget, actual, etc, eac: actual + etc, vac: budget - actual - etc }
    })
    const t = (k: 'budget' | 'actual' | 'etc' | 'eac' | 'vac') => sum(lines.map((l) => l[k]))
    return { fnId: fn.id, code: fn.code, name: fn.name, budget: t('budget'), actual: t('actual'), etc: t('etc'), eac: t('eac'), vac: t('vac'), pctSpent: t('eac') ? t('actual') / t('eac') : 0, profile: f?.profiles?.[fn.id], lines }
  })
  const T = (k: 'budget' | 'actual' | 'etc' | 'eac' | 'vac') => sum(rows.map((r) => r[k]))
  return { rows, contingencyHeld: f?.contingencyHeld ?? 0, totals: { budget: T('budget') + bud.contingency, actual: T('actual'), etc: T('etc'), eac: T('eac') + (f?.contingencyHeld ?? 0), vac: T('budget') + bud.contingency - T('eac') - (f?.contingencyHeld ?? 0) } }
}

/** Keep the function-level `spread`, `eac` and `byYear` in step after editing `lineSpread`. Mutates the forecast. */
export function syncForecast(s: AppState, f: Forecast) {
  if (!f.lineSpread) return
  f.spread = rollupGrid(s, f.lineSpread)
  const act = sum(s.costPeriods.filter((c) => c.projectId === f.projectId).map((c) => c.actual))
  const etc = sum(Object.values(f.lineSpread).flatMap((m) => Object.values(m)))
  f.eac = act + etc + (f.contingencyHeld ?? 0)
  const byYear: Record<string, Money> = {}
  for (const c of s.costPeriods.filter((c) => c.projectId === f.projectId)) byYear[c.period.slice(0, 4)] = (byYear[c.period.slice(0, 4)] || 0) + c.actual
  for (const m of Object.values(f.lineSpread)) for (const [k, v] of Object.entries(m)) byYear[k.slice(0, 4)] = (byYear[k.slice(0, 4)] || 0) + v
  // contingency held sits in the final year so the calendar years add up to EAC (same convention as the seed and applySpread)
  const ys = Object.keys(byYear).sort()
  if (f.contingencyHeld) byYear[ys[ys.length - 1] ?? s.settings.asOf.slice(0, 4)] = (byYear[ys[ys.length - 1] ?? s.settings.asOf.slice(0, 4)] || 0) + f.contingencyHeld
  f.byYear = byYear
}

export type { SpreadProfile }
