// Pure helpers for the forecast spread grid, the monthly forecast cycle and the WBS roll-ups.
// No React, no store access: everything takes AppState (or a draft of it) so it can be unit-tested.
import type { ActualTxn, AppState, FnProfile, Forecast, Money, Project, WbsFunction } from '@/core/types'
import {
  actualsByFunctionMonth, actualsThrough, budgetByFunction, defaultSpread, eacOf, forecastMonths,
  spreadAmount, spreadByFunction, spreadByMonth, spreadByYear, spreadTotal, type SpreadMethod,
} from '@/core/engine/wbs'
import { activeBudget } from '@/core/engine/position'
import {
  actualsByLineMonth, allProfiles, applyProfile, budgetByLine, defaultLineSpread, etcEacByFunction, functionOfLine, lineById, lineGridOf,
  profileName, profileWeights, rollupGrid, spreadByWeights, syncForecast, type FunctionRow,
} from '@/core/engine/lines'
import { addMonths, monthKey, sum, uid } from '@/core/util'

export type Spread = Record<string, Record<string, Money>>
export type VersionStatus = 'draft' | 'submitted' | 'approved' | 'returned'
export type CycleStatus = 'approved' | 'in-review' | 'draft' | 'returned' | 'not-started'

// ───────────────────────────── Cell entry

/**
 * Parse what a person types (or pastes) into a money cell: `1234`, `$1,234`, `1.2M`, `450k`, `(5,000)`, `-5k`.
 * Blank means zero. Returns null when the text is not a number. `scale` applies to plain numbers only
 * (1000 when the grid shows $K); a K/M/B suffix is always absolute.
 */
export function parseMoney(raw: string, scale = 1): number | null {
  let t = (raw ?? '').trim()
  if (!t || t === '-' || t === '—' || t === '–') return 0
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  t = t.replace(/[$,\s]/g, '').replace(/^[−–]/, '-')
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1) }
  if (t.startsWith('$')) t = t.slice(1)
  const m = /^(\d+\.?\d*|\.\d+)([kmb])?$/i.exec(t)
  if (!m) return null
  const mult = ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[(m[2] ?? '').toLowerCase()] ?? scale
  const v = Math.round(parseFloat(m[1]) * mult)
  return neg ? -v : v
}

/** Whole dollars with separators for an input being edited ('' for zero). */
export const fmtCell = (n: number | undefined) => (n ? Math.round(n).toLocaleString('en-US') : '')

/** A tab-separated block copied from Excel → rows of cells. Trailing blank line dropped. */
export function parseClipboard(text: string): string[][] {
  const rows = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop()
  return rows.map((r) => r.split('\t'))
}

/** True when pasted text is a block (more than one cell) rather than a single value. */
export const isBlock = (text: string) => /[\t\n]/.test((text ?? '').replace(/\r?\n$/, ''))

// ───────────────────────────── Spread edits (all return a new spread; zero cells are dropped)

export const cloneSpread = (s?: Spread): Spread => Object.fromEntries(Object.entries(s ?? {}).map(([k, v]) => [k, { ...v }]))

export function setCell(spread: Spread, fnId: string, month: string, v: Money): Spread {
  const out = cloneSpread(spread)
  const row = (out[fnId] ||= {})
  if (v) row[month] = Math.round(v)
  else delete row[month]
  return out
}

export const rowTotal = (spread: Spread, fnId: string) => sum(Object.values(spread[fnId] ?? {}))

/**
 * Paste a block at (row r0, column c0). `rows` are function ids; `cols` are the grid's editable columns in
 * order — a month key ('YYYY-MM') or a collapsed year ('YYYY', which sets that year's total across `months`).
 */
export function applyPaste(spread: Spread, rows: string[], cols: string[], r0: number, c0: number, block: string[][], scale = 1, months: string[] = []): { spread: Spread; filled: number; rejected: string[] } {
  let out = cloneSpread(spread)
  let filled = 0
  const rejected: string[] = []
  block.forEach((line, i) => {
    const fn = rows[r0 + i]
    if (!fn) return
    line.forEach((cell, j) => {
      const col = cols[c0 + j]
      if (!col) return
      const v = parseMoney(cell, scale)
      if (v === null) { rejected.push(cell); return }
      out = col.length === 4 ? setYearTotal(out, fn, months.filter((m) => m.startsWith(col)), v) : setCell(out, fn, col, v)
      filled++
    })
  })
  return { spread: out, filled, rejected }
}

/** Set a row's total for one year: keeps the year's monthly shape when it has one, else spreads evenly. */
export function setYearTotal(spread: Spread, fnId: string, yearMonths: string[], v: Money): Spread {
  const row = spread[fnId] ?? {}
  const shape = yearMonths.map((m) => row[m] || 0)
  const vals = shape.some((x) => x > 0) ? distribute(Math.round(v), shape) : distribute(Math.round(v), yearMonths.map(() => 1))
  let out = cloneSpread(spread)
  yearMonths.forEach((m, i) => { out = setCell(out, fnId, m, vals[i]) })
  return out
}

/** Integer split of `total` by weights that sums exactly to total. */
export function distribute(total: Money, weights: number[]): Money[] {
  const W = sum(weights.map((w) => Math.max(0, w)))
  if (!weights.length) return []
  const ws = W > 0 ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1)
  const T = W > 0 ? W : weights.length
  let acc = 0
  return ws.map((w, i) => {
    const v = i === ws.length - 1 ? total - acc : Math.round((total * w) / T)
    acc += v
    return v
  })
}

/** Spread `amount` from `from` to `to` (inclusive) by a curve. Replaces the whole row. */
export function spreadRow(spread: Spread, fnId: string, months: string[], amount: Money, method: SpreadMethod, from: string, to: string): Spread {
  const range = months.filter((m) => m >= from && m <= to)
  const out = cloneSpread(spread)
  const vals = range.length ? spreadAmount(Math.round(amount), range, method) : {}
  out[fnId] = Object.fromEntries(Object.entries(vals).filter(([, v]) => v))
  return out
}

export function clearRow(spread: Spread, fnId: string): Spread {
  const out = cloneSpread(spread)
  out[fnId] = {}
  return out
}

/** Set a row's ETC to `target`: keep the row's shape when it has one, else spread by `method` over `months`. */
export function scaleRow(spread: Spread, fnId: string, months: string[], target: Money, method: SpreadMethod): Spread {
  const row = spread[fnId] ?? {}
  const keys = Object.keys(row).filter((k) => row[k]).sort()
  const out = cloneSpread(spread)
  if (keys.length && rowTotal(spread, fnId) > 0) {
    const vals = distribute(Math.round(target), keys.map((k) => row[k]))
    out[fnId] = Object.fromEntries(keys.map((k, i) => [k, vals[i]]).filter(([, v]) => v))
  } else {
    out[fnId] = Object.fromEntries(Object.entries(spreadAmount(Math.round(target), months, method)).filter(([, v]) => v))
  }
  return out
}

export const TIMING_METHOD: Record<WbsFunction['timing'], SpreadMethod> = { early: 'front', mid: 'scurve', late: 'back', flat: 'even' }

/** Budget − actuals by function (never negative). */
export function remainingByFunction(s: AppState, pid: string): Record<string, Money> {
  const bud = budgetByFunction(s, pid).byFn
  const act = actualsByFunction2(s, pid)
  return Object.fromEntries(Object.keys(bud).map((k) => [k, Math.max(0, (bud[k] || 0) - (act[k] || 0))]))
}

// ───────────────────────────── Versions

export const statusOf = (f: Forecast): VersionStatus => f.status ?? (f.locked ? 'approved' : 'draft')
export const isEditable = (f: Forecast) => !f.locked && (statusOf(f) === 'draft' || statusOf(f) === 'returned')

/** Newest first; drafts after a same-day approved version (matches latestForecast). */
export function versionsOf(s: AppState, pid: string): Forecast[] {
  return s.forecasts.filter((f) => f.projectId === pid).sort((a, b) => b.date.localeCompare(a.date) || (statusOf(a) === 'draft' ? -1 : 1))
}

const monthBefore = (m: string) => monthKey(addMonths(m + '-01', -1))
const monthAfter = (m: string) => monthKey(addMonths(m + '-01', 1))

/** Last month treated as actuals for a version: its actualsThrough, or the month before its first ETC month. */
export function versionCutoff(s: AppState, f: Forecast): string {
  const months = Object.values(f.spread ?? {}).flatMap((r) => Object.keys(r)).sort()
  const a = f.actualsThrough ?? actualsThrough(s, f.projectId)
  const b = months.length ? monthBefore(months[0]) : a
  return a > b ? a : b
}

/**
 * Actuals by function through a cutoff month. Periods without a recorded split are allocated by budget share in
 * the engine, which can leave a few dollars of rounding; the residual goes to the largest function so the
 * functions always sum to the ERP actual.
 */
export function actualsByFunction2(s: AppState, pid: string, through?: string): Record<string, Money> {
  const m = actualsByFunctionMonth(s, pid)
  const out = Object.fromEntries(Object.entries(m).map(([fn, row]) => [fn, sum(Object.entries(row).filter(([k]) => !through || k <= through).map(([, v]) => v))]))
  const truth = sum(s.costPeriods.filter((c) => c.projectId === pid && (!through || c.period <= through)).map((c) => c.actual))
  const resid = truth - sum(Object.values(out))
  if (resid) {
    const big = Object.keys(out).sort((a, b) => out[b] - out[a])[0]
    if (big) out[big] += resid
  }
  return out
}

/** Calendar-year EAC: actuals by year + ETC by year (+ contingency held in the final year). */
export function byYearOf(s: AppState, pid: string, spread: Spread, held: Money): Record<string, Money> {
  const out: Record<string, Money> = {}
  for (const c of s.costPeriods.filter((x) => x.projectId === pid)) out[c.period.slice(0, 4)] = (out[c.period.slice(0, 4)] || 0) + c.actual
  for (const [y, v] of Object.entries(spreadByYear(spread))) out[y] = (out[y] || 0) + v
  const ys = Object.keys(out).sort()
  if (held) { if (ys.length) out[ys[ys.length - 1]] += held; else out[s.settings.asOf.slice(0, 4)] = held }
  return out
}

export type SlipMode = 'net' | 'all' | 'drop'

/**
 * Carry a spread forward into a new actuals period. ETC sitting in months that are now closed is
 * re-spread across the row's remaining months (in proportion to what is already there, else evenly).
 * `net`: only the part not already consumed by that function's actuals in those months moves forward.
 * `all`: the whole amount moves forward. `drop`: stale ETC is removed (the actuals replace it).
 */
export function carryForward(s: AppState, p: Project, src: Spread, srcCutoff: string, slip: SlipMode = 'net'): { spread: Spread; moved: Money; movedBy: Record<string, Money> } {
  return carryForwardGrid(s, p, src, srcCutoff, slip, actualsByFunctionMonth(s, p.id))
}
/** Same as carryForward at forecast line level (actuals by line from SAP / the mapping table). */
export function carryForwardLines(s: AppState, p: Project, src: Spread, srcCutoff: string, slip: SlipMode = 'net'): { spread: Spread; moved: Money; movedBy: Record<string, Money> } {
  return carryForwardGrid(s, p, src, srcCutoff, slip, actualsByLineMonth(s, p.id))
}
function carryForwardGrid(s: AppState, p: Project, src: Spread, srcCutoff: string, slip: SlipMode, act: Spread): { spread: Spread; moved: Money; movedBy: Record<string, Money> } {
  const through = actualsThrough(s, p.id)
  const months = forecastMonths(s, p)
  const out: Spread = {}
  const movedBy: Record<string, Money> = {}
  let moved = 0
  for (const [fn, row] of Object.entries(src)) {
    const future: Record<string, Money> = {}
    let stale = 0
    for (const [m, v] of Object.entries(row)) {
      if (m > through) future[m] = v
      else stale += v
    }
    if (slip === 'drop') stale = 0
    if (stale && slip === 'net') {
      const spent = sum(Object.entries(act[fn] ?? {}).filter(([m]) => m > srcCutoff && m <= through).map(([, v]) => v))
      stale = Math.max(0, stale - spent)
    }
    if (stale) {
      const keys = Object.keys(future).filter((k) => future[k] > 0).sort()
      if (keys.length) {
        const add = distribute(stale, keys.map((k) => future[k]))
        keys.forEach((k, i) => { future[k] += add[i] })
      } else {
        const add = spreadAmount(stale, months, 'even')
        for (const [k, v] of Object.entries(add)) future[k] = (future[k] || 0) + v
      }
      moved += stale
      movedBy[fn] = stale
    }
    out[fn] = Object.fromEntries(Object.entries(future).filter(([, v]) => v))
  }
  return { spread: out, moved, movedBy }
}

/**
 * A new draft version copied from `src` (as of today) at forecast-line level, with stale ETC carried forward
 * and each function's profile carried over (window clamped to the open months; marked adjusted when ETC moved).
 * With no source, the draft spreads each line's remaining budget by its function's typical timing.
 */
export function copyVersion(s: AppState, p: Project, src: Forecast | undefined, opts: { byId: string; note?: string; slip?: SlipMode }): { forecast: Forecast; moved: Money } {
  const held = src?.contingencyHeld ?? 0
  const months = forecastMonths(s, p)
  const hasSrc = !!src && (Object.keys(src.lineSpread ?? {}).length > 0 || Object.keys(src.spread ?? {}).length > 0)
  let lines: Spread, moved = 0, profiles: Record<string, FnProfile>
  if (hasSrc) {
    const r = carryForwardLines(s, p, stripZeros(lineGridOf(s, p, src)), versionCutoff(s, src!), opts.slip ?? 'net')
    lines = r.spread
    moved = r.moved
    const movedFns = new Set(Object.keys(r.movedBy).map((l) => functionOfLine(s, l)))
    profiles = carryProfiles(src!.profiles, months, movedFns)
  } else {
    const d = defaultLineSpread(s, p)
    lines = stripZeros(d.lineSpread)
    profiles = d.profiles
  }
  const forecast: Forecast = {
    id: uid('fc'), projectId: p.id, date: s.settings.asOf, eac: 0, byYear: {},
    note: opts.note ?? '', byId: opts.byId, locked: false, spread: {}, lineSpread: lines, profiles, contingencyHeld: held,
    actualsThrough: actualsThrough(s, p.id), status: 'draft',
  }
  syncForecast(s, forecast)
  return { forecast, moved }
}

/** Carry function profiles into a new period: windows start no earlier than the first open month. */
export function carryProfiles(src: Record<string, FnProfile> | undefined, months: string[], adjustedFns: Set<string | undefined> = new Set()): Record<string, FnProfile> {
  const out: Record<string, FnProfile> = {}
  const first = months[0]
  for (const [fn, pr] of Object.entries(src ?? {})) {
    const start = first && pr.start < first ? first : pr.start
    const end = pr.end < start ? start : pr.end
    out[fn] = { ...pr, start, end, adjusted: pr.adjusted || adjustedFns.has(fn) }
  }
  return out
}

/** Drop zero cells (profiles write explicit zeros outside their window). */
export function stripZeros(g?: Spread): Spread {
  return Object.fromEntries(Object.entries(g ?? {}).map(([k, row]) => [k, Object.fromEntries(Object.entries(row).filter(([, v]) => v))]))
}

/** Write a spread back to a forecast record (draft of the store) with recomputed EAC and calendar years. */
export function applySpread(d: AppState, f: Forecast, spread: Spread, held: Money, note: string) {
  f.spread = cloneSpread(spread)
  f.contingencyHeld = Math.round(held)
  f.note = note
  f.eac = eacOf(d, f.projectId, spread, held)
  f.byYear = byYearOf(d, f.projectId, spread, held)
}

/** Audit text for a save: which functions' ETC moved and by how much. */
export function diffSummary(fns: { id: string; code: string; name: string }[], before: Spread, after: Spread, heldBefore: Money, heldAfter: Money): string {
  const parts: string[] = []
  let cells = 0
  const ids = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  for (const id of ids) {
    const a = before[id] ?? {}, b = after[id] ?? {}
    for (const m of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[m] || 0) !== (b[m] || 0)) cells++
    const d = rowTotal(after, id) - rowTotal(before, id)
    const f = fns.find((x) => x.id === id)
    if (d) parts.push(`${f?.code ?? id} ${f?.name ?? ''} ${signed(d)}`.replace(/\s+/g, ' '))
  }
  if (heldAfter !== heldBefore) parts.push(`contingency held ${signed(heldAfter - heldBefore)}`)
  const etc = spreadTotal(after) - spreadTotal(before) + heldAfter - heldBefore
  if (!parts.length && !cells) return 'No changes to the spread'
  return `${cells} cell${cells === 1 ? '' : 's'} changed; ETC ${signed(etc)}${parts.length ? ' · ' + parts.join(', ') : ' (re-phased only)'}`
}
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US')

// ───────────────────────────── Function lists (including functions retired since a version was made)

export interface FnRef { id: string; code: string; name: string; retired: boolean; timing: WbsFunction['timing'] }
export function fnRefs(s: AppState, ...spreads: (Spread | undefined)[]): FnRef[] {
  const out: FnRef[] = s.settings.wbsFunctions.map((f) => ({ id: f.id, code: f.code, name: f.name, retired: false, timing: f.timing }))
  for (const sp of spreads) for (const id of Object.keys(sp ?? {})) {
    if (!out.some((x) => x.id === id) && rowTotal(sp!, id)) out.push({ id, code: id.replace(/^wbs-/, ''), name: 'Retired function', retired: true, timing: 'flat' })
  }
  return out
}

// ───────────────────────────── Compare two versions

export interface CompareRow { id: string; code: string; name: string; etcA: Money; etcB: Money; eacA: Money; eacB: Money; delta: Money }
export function compareVersions(s: AppState, a: Forecast, b: Forecast) {
  const fns = fnRefs(s, a.spread, b.spread)
  const actA = actualsByFunction2(s, a.projectId, versionCutoff(s, a))
  const actB = actualsByFunction2(s, b.projectId, versionCutoff(s, b))
  const ea = spreadByFunction(a.spread), eb = spreadByFunction(b.spread)
  const rows: CompareRow[] = fns.map((f) => {
    const eacA = (actA[f.id] || 0) + (ea[f.id] || 0), eacB = (actB[f.id] || 0) + (eb[f.id] || 0)
    return { id: f.id, code: f.code, name: f.name, etcA: ea[f.id] || 0, etcB: eb[f.id] || 0, eacA, eacB, delta: eacB - eacA }
  })
  const ma = spreadByMonth(a.spread), mb = spreadByMonth(b.spread)
  const months = Array.from(new Set([...Object.keys(ma), ...Object.keys(mb)])).sort().map((m) => ({ month: m, a: ma[m] || 0, b: mb[m] || 0, delta: (mb[m] || 0) - (ma[m] || 0) }))
  const movers = rows.filter((r) => r.delta).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 5)
  return { rows, months, movers, heldA: a.contingencyHeld ?? 0, heldB: b.contingencyHeld ?? 0, eacA: a.eac, eacB: b.eac }
}

// ───────────────────────────── Monthly cycle

/** The cycle opens on this day, after the prior month's actuals close in the ERP. */
export const CYCLE_OPEN_DAY = 21
/** Which monthly cycle a version dated `date` belongs to ('YYYY-MM'). */
export const cycleOf = (date: string) => (Number(date.slice(8, 10)) >= CYCLE_OPEN_DAY ? monthAfter(date.slice(0, 7)) : date.slice(0, 7))
export const currentCycle = (s: AppState) => cycleOf(s.settings.asOf)

export const inCycleScope = (s: AppState, p: Project) => p.status === 'active' && !!activeBudget(s, p.id)

export function cycleVersion(s: AppState, pid: string, cycle: string): Forecast | undefined {
  return versionsOf(s, pid).find((f) => cycleOf(f.date) === cycle)
}
export function cycleStatusOf(f?: Forecast): CycleStatus {
  if (!f) return 'not-started'
  const st = statusOf(f)
  return st === 'submitted' ? 'in-review' : st
}
/** Latest approved version other than `excludeId`. */
export function priorApproved(s: AppState, pid: string, excludeId?: string): Forecast | undefined {
  return versionsOf(s, pid).find((f) => f.id !== excludeId && statusOf(f) === 'approved')
}

export interface CycleRow { p: Project; status: CycleStatus; version?: Forecast; latest?: Forecast; prior?: Forecast; eac: Money; delta?: Money; budget: Money }
export function cycleRows(s: AppState, cycle = currentCycle(s)): CycleRow[] {
  return s.projects.filter((p) => inCycleScope(s, p)).map((p) => {
    const version = cycleVersion(s, p.id, cycle)
    const latest = versionsOf(s, p.id)[0]
    const prior = priorApproved(s, p.id, version?.id)
    const eac = (version ?? latest)?.eac ?? 0
    return { p, status: cycleStatusOf(version), version, latest, prior, eac, delta: prior && version ? version.eac - prior.eac : undefined, budget: budgetByFunction(s, p.id).total }
  })
}

/**
 * Open the cycle: a draft for every in-scope project that has no version this cycle, copied from its
 * latest version (stale ETC carried forward). Mutates `d`; returns the codes it created.
 */
export function startCycle(d: AppState, byId: string, slip: SlipMode = 'net'): { codes: string[]; moved: Money } {
  const cycle = currentCycle(d)
  const codes: string[] = []
  let moved = 0
  for (const p of d.projects.filter((x) => inCycleScope(d, x))) {
    if (cycleVersion(d, p.id, cycle)) continue
    const src = versionsOf(d, p.id)[0]
    const { forecast, moved: mv } = copyVersion(d, p, src, { byId: p.team.pm ?? byId, slip, note: `${monthLabel(cycle)} cycle — opened from ${src ? `the ${src.date} version` : 'remaining budget'}` })
    d.forecasts.push(forecast)
    codes.push(p.code)
    moved += mv
  }
  return { codes, moved }
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`

// ───────────────────────────── Portfolio roll-up (function × calendar year)

export type RollupBasis = 'latest' | 'approved'
export interface Rollup {
  years: string[]
  fns: FnRef[]
  actual: Record<string, Record<string, Money>> // fn → year → actuals
  forecast: Record<string, Record<string, Money>> // fn → year → ETC
  contingency: Record<string, Money> // year → held contingency
  projects: { p: Project; version: Forecast }[]
}
export function versionFor(s: AppState, pid: string, basis: RollupBasis): Forecast | undefined {
  return basis === 'approved' ? priorApproved(s, pid) : versionsOf(s, pid)[0]
}
export function rollup(s: AppState, projects: Project[], basis: RollupBasis = 'latest'): Rollup {
  const picked = projects.map((p) => ({ p, version: versionFor(s, p.id, basis)! })).filter((x) => x.version)
  const fns = fnRefs(s, ...picked.map((x) => x.version.spread))
  const actual: Rollup['actual'] = {}, forecast: Rollup['forecast'] = {}, contingency: Rollup['contingency'] = {}
  const years = new Set<string>()
  const add = (t: Record<string, Record<string, Money>>, fn: string, y: string, v: Money) => { if (!v) return; (t[fn] ||= {})[y] = (t[fn][y] || 0) + v; years.add(y) }
  for (const { p, version } of picked) {
    const cut = versionCutoff(s, version)
    const pys = new Set<string>()
    for (const [fn, row] of Object.entries(actualsByFunctionMonth(s, p.id))) for (const [m, v] of Object.entries(row)) if (m <= cut) { add(actual, fn, m.slice(0, 4), v); pys.add(m.slice(0, 4)) }
    for (const [fn, row] of Object.entries(version.spread ?? {})) for (const [m, v] of Object.entries(row)) { add(forecast, fn, m.slice(0, 4), v); if (v) pys.add(m.slice(0, 4)) }
    const held = version.contingencyHeld ?? 0
    if (held) { const y = [...pys].sort().pop() ?? s.settings.asOf.slice(0, 4); contingency[y] = (contingency[y] || 0) + held; years.add(y) }
  }
  return { years: [...years].sort(), fns, actual, forecast, contingency, projects: picked }
}
export const rollupCell = (r: Rollup, fn: string, y: string) => (r.actual[fn]?.[y] || 0) + (r.forecast[fn]?.[y] || 0)
export const rollupFnTotal = (r: Rollup, fn: string) => sum(r.years.map((y) => rollupCell(r, fn, y)))
export const rollupYearTotal = (r: Rollup, y: string) => sum(r.fns.map((f) => rollupCell(r, f.id, y))) + (r.contingency[y] || 0)

/** Finance CSV rows: function × year with actual / forecast split and totals. */
export function rollupCsvRows(r: Rollup): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = r.fns.map((f) => ({
    'WBS code': f.code, 'WBS function': f.name + (f.retired ? ' (retired)' : ''),
    ...Object.fromEntries(r.years.map((y) => [y, rollupCell(r, f.id, y)])),
    Total: rollupFnTotal(r, f.id),
  }))
  rows.push({ 'WBS code': '990', 'WBS function': 'Contingency held', ...Object.fromEntries(r.years.map((y) => [y, r.contingency[y] || 0])), Total: sum(Object.values(r.contingency)) })
  rows.push({ 'WBS code': 'TOTAL', 'WBS function': 'Total', ...Object.fromEntries(r.years.map((y) => [y, rollupYearTotal(r, y)])), Total: sum(r.years.map((y) => rollupYearTotal(r, y))) })
  return rows
}
/** Long-format detail for finance pivots: project × function × year, actual vs forecast. */
export function rollupDetailRows(s: AppState, r: Rollup): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const { p, version } of r.projects) {
    const cut = versionCutoff(s, version)
    const act = actualsByFunctionMonth(s, p.id)
    const prog = s.programs.find((x) => x.id === p.programId)?.code ?? ''
    for (const f of r.fns) {
      const ys = new Set<string>()
      const a: Record<string, Money> = {}, e: Record<string, Money> = {}
      for (const [m, v] of Object.entries(act[f.id] ?? {})) if (m <= cut) { a[m.slice(0, 4)] = (a[m.slice(0, 4)] || 0) + v; ys.add(m.slice(0, 4)) }
      for (const [m, v] of Object.entries(version.spread?.[f.id] ?? {})) { e[m.slice(0, 4)] = (e[m.slice(0, 4)] || 0) + v; ys.add(m.slice(0, 4)) }
      for (const y of [...ys].sort()) if (a[y] || e[y]) out.push({ Project: p.code, Program: prog, 'Forecast date': version.date, Status: statusOf(version), 'WBS code': f.code, 'WBS function': f.name, Year: y, Actual: a[y] || 0, Forecast: e[y] || 0, Total: (a[y] || 0) + (e[y] || 0) })
    }
    if (version.contingencyHeld) out.push({ Project: p.code, Program: prog, 'Forecast date': version.date, Status: statusOf(version), 'WBS code': '990', 'WBS function': 'Contingency held', Year: '', Actual: 0, Forecast: version.contingencyHeld, Total: version.contingencyHeld })
  }
  return out
}

// ───────────────────────────── Grid export

/** Functions × months CSV for one version (actuals columns for past months optional). */
export function gridCsvRows(s: AppState, p: Project, f: Forecast, months: string[]): Record<string, unknown>[] {
  const fns = fnRefs(s, f.spread)
  const bud = budgetByFunction(s, p.id)
  const act = actualsByFunction2(s, p.id, versionCutoff(s, f))
  const actTotal = sum(Object.values(act))
  const rows: Record<string, unknown>[] = fns.map((fn) => {
    const etc = rowTotal(f.spread ?? {}, fn.id)
    const eac = (act[fn.id] || 0) + etc
    return { 'WBS code': fn.code, 'WBS function': fn.name, Budget: bud.byFn[fn.id] || 0, 'Actual to date': act[fn.id] || 0, ...Object.fromEntries(months.map((m) => [m, f.spread?.[fn.id]?.[m] || 0])), ETC: etc, EAC: eac, Variance: (bud.byFn[fn.id] || 0) - eac }
  })
  const held = f.contingencyHeld ?? 0
  rows.push({ 'WBS code': '990', 'WBS function': 'Contingency held', Budget: bud.contingency, 'Actual to date': 0, ...Object.fromEntries(months.map((m) => [m, 0])), ETC: held, EAC: held, Variance: bud.contingency - held })
  const byM = spreadByMonth(f.spread)
  const etcT = spreadTotal(f.spread) + held
  rows.push({ 'WBS code': 'TOTAL', 'WBS function': 'Total', Budget: bud.total, 'Actual to date': actTotal, ...Object.fromEntries(months.map((m) => [m, byM[m] || 0])), ETC: etcT, EAC: actTotal + etcT, Variance: bud.total - actTotal - etcT })
  return rows
}

/** Same values cell by cell (zero and missing are equal). */
export function sameSpread(a?: Spread, b?: Spread): boolean {
  const A = a ?? {}, B = b ?? {}
  for (const fn of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[fn] ?? {}, y = B[fn] ?? {}
    for (const m of new Set([...Object.keys(x), ...Object.keys(y)])) if ((x[m] || 0) !== (y[m] || 0)) return false
  }
  return true
}

/** 'Nov ’26' style short month label for charts. */
export const shortMonth = (k: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(k.slice(5, 7)) - 1]} '${k.slice(2, 4)}`

/** Grid columns: months, with any collapsed year shown as one year-total column. */
export interface GridCol { key: string; kind: 'month' | 'year'; months: string[] }
export function gridCols(months: string[], collapsed: Set<string> | string[]): GridCol[] {
  const c = new Set(collapsed)
  const out: GridCol[] = []
  for (const m of months) {
    const y = m.slice(0, 4)
    if (c.has(y)) {
      const last = out[out.length - 1]
      if (last?.kind === 'year' && last.key === y) last.months.push(m)
      else out.push({ key: y, kind: 'year', months: [m] })
    } else out.push({ key: m, kind: 'month', months: [m] })
  }
  return out
}

// ───────────────────────────── Forecast line items (line × month is what people edit; functions roll up)

export interface LineRef { id: string; code: string; name: string; fnId: string; inactive: boolean }

/** Active lines in WBS order, plus any inactive line that still carries ETC in one of the grids. */
export function lineRefs(s: AppState, ...grids: (Spread | undefined)[]): LineRef[] {
  const order = new Map(s.settings.wbsFunctions.map((f, i) => [f.id, i]))
  const ids = new Set(s.settings.forecastLines.filter((l) => l.active).map((l) => l.id))
  for (const g of grids) for (const [id, row] of Object.entries(g ?? {})) if (sum(Object.values(row))) ids.add(id)
  return [...ids].map((id): LineRef => {
    const l = lineById(s, id)
    return l ? { id, code: l.code, name: l.name, fnId: l.functionId, inactive: !l.active } : { id, code: id, name: 'Removed line', fnId: '', inactive: true }
  }).sort((a, b) => (order.get(a.fnId) ?? 99) - (order.get(b.fnId) ?? 99) || a.code.localeCompare(b.code))
}

export interface FnGroup { fn: FnRef; lines: LineRef[] }
/** Functions with their lines, in WBS order (functions without lines are kept so the table always shows nine). */
export function fnGroups(s: AppState, lines: LineRef[]): FnGroup[] {
  const groups: FnGroup[] = fnRefs(s).map((fn) => ({ fn, lines: lines.filter((l) => l.fnId === fn.id) }))
  const orphans = lines.filter((l) => !groups.some((g) => g.fn.id === l.fnId))
  if (orphans.length) groups.push({ fn: { id: 'fn-orphan', code: '—', name: 'Lines without a function', retired: true, timing: 'flat' }, lines: orphans })
  return groups
}

/** Actuals by line through a cutoff month (exact: line actuals sum to the ERP actual). */
export function lineActuals(s: AppState, pid: string, through?: string): Record<string, Money> {
  return Object.fromEntries(Object.entries(actualsByLineMonth(s, pid)).map(([k, row]) => [k, sum(Object.entries(row).filter(([m]) => !through || m <= through).map(([, v]) => v))]))
}

/** ETC/EAC by function (engine) with actuals cut off at a version's actuals month, so older versions read as they were made. */
export function etcEacAt(s: AppState, p: Project, f: Forecast, through?: string) {
  const st = through ? { ...s, costPeriods: s.costPeriods.filter((c) => c.projectId !== p.id || c.period <= through) } : s
  return etcEacByFunction(st, p, f)
}

/** A forecast-shaped object from the editor's working state (for engine calls before saving). */
export const working = (s: AppState, f: Forecast, lines: Spread, held: Money, profiles: Record<string, FnProfile>, note = f.note): Forecast =>
  ({ ...f, lineSpread: lines, spread: linesToSpread(s, lines), contingencyHeld: held, profiles, note, eac: eacOf(s, f.projectId, lines, held) })

/** Spread the edited line grid back into a stored forecast (draft of the store) and re-derive spread, EAC and years. */
export function applyLines(d: AppState, f: Forecast, lines: Spread, held: Money, note: string, profiles: Record<string, FnProfile>) {
  f.lineSpread = stripZeros(lines)
  f.contingencyHeld = Math.round(held)
  f.note = note
  f.profiles = JSON.parse(JSON.stringify(profiles))
  syncForecast(d, f)
}

/** The function-level roll-up of a line grid (what `spread` stores). */
export const linesToSpread = (s: AppState, lines: Spread): Spread => stripZeros(rollupGrid(s, lines))

export const fnEtc = (lines: Spread, lineIds: string[]) => sum(lineIds.map((id) => rowTotal(lines, id)))

/** Mark a function's profile as hand-adjusted (no-op when it has no profile or already is). */
export function markAdjusted(profiles: Record<string, FnProfile>, fnId: string | undefined): Record<string, FnProfile> {
  if (!fnId || !profiles[fnId] || profiles[fnId].adjusted) return profiles
  return { ...profiles, [fnId]: { ...profiles[fnId], adjusted: true } }
}

/**
 * Apply a profile to one function: its ETC (`total`, default = current) goes to its lines by each line's current share
 * and is phased by the profile between start and end (engine applyProfile). Returns the new grid and profile entry.
 */
export function applyFnProfile(s: AppState, p: Project, lines: Spread, fnId: string, prof: Pick<FnProfile, 'profileId' | 'start' | 'end'>, total?: Money, at = new Date().toISOString()): { lines: Spread; profile: FnProfile } {
  const g = applyProfile(s, p, { lineSpread: lines }, fnId, prof, total)
  const out = cloneSpread(lines)
  for (const [lid, row] of Object.entries(g)) out[lid] = Object.fromEntries(Object.entries(row).filter(([, v]) => v))
  return { lines: out, profile: { profileId: prof.profileId, start: prof.start, end: prof.end, adjusted: false, appliedAt: at } }
}

/** Normalised weights (sum 1) for drawing a profile's shape over `months`. */
export function shapeOf(s: AppState, profileId: string, months: string[]): number[] {
  const w = profileWeights(s, profileId, months)
  const W = sum(w) || 1
  return w.map((x) => x / W)
}
/** Dollar preview of a profile: `total` over the window, whole dollars. */
export const previewSpread = (s: AppState, profileId: string, months: string[], total: Money) => spreadByWeights(Math.round(total), months, profileWeights(s, profileId, months))

export { allProfiles, profileName }

/** Line-level CSV for one version: a subtotal row per function, its lines beneath, contingency held and the total. */
export function lineCsvRows(s: AppState, p: Project, f: Forecast, months: string[]): Record<string, unknown>[] {
  const cut = versionCutoff(s, f)
  const t = etcEacAt(s, p, f, cut)
  const grid = lineGridOf(s, p, f)
  const bud = budgetByLine(s, p.id)
  const rows: Record<string, unknown>[] = []
  const month = (ids: string[]) => Object.fromEntries(months.map((m) => [m, sum(ids.map((id) => grid[id]?.[m] || 0))]))
  for (const r of t.rows) {
    const pr = r.profile ? `${profileName(s, r.profile.profileId)}${r.profile.adjusted ? ' (adjusted)' : ''}` : ''
    rows.push({ 'WBS code': r.code, 'WBS function': r.name, 'Line code': '', 'Line item': `${r.name} — function total`, Profile: pr, Budget: r.budget, 'Actual to date': r.actual, ...month(r.lines.map((l) => l.line.id)), ETC: r.etc, EAC: r.eac, VAC: r.vac })
    for (const l of r.lines) rows.push({ 'WBS code': r.code, 'WBS function': r.name, 'Line code': l.line.code, 'Line item': l.line.name, Profile: '', Budget: l.budget, 'Actual to date': l.actual, ...month([l.line.id]), ETC: l.etc, EAC: l.eac, VAC: l.vac })
  }
  const held = f.contingencyHeld ?? 0
  rows.push({ 'WBS code': '990', 'WBS function': 'Contingency held', 'Line code': '', 'Line item': 'Contingency held', Profile: '', Budget: bud.contingency, 'Actual to date': 0, ...Object.fromEntries(months.map((m) => [m, 0])), ETC: held, EAC: held, VAC: bud.contingency - held })
  rows.push({ 'WBS code': 'TOTAL', 'WBS function': 'Total', 'Line code': '', 'Line item': 'Total', Profile: '', Budget: t.totals.budget, 'Actual to date': t.totals.actual, ...month(Object.keys(grid)), ETC: t.totals.etc + held, EAC: t.totals.eac, VAC: t.totals.vac })
  return rows
}

// ───────────────────────────── Portfolio ETC / EAC by function

export interface PortfolioFnRow {
  fnId: string; code: string; name: string
  budget: Money; actual: Money; etc: Money; eac: Money; vac: Money
  lines: { id: string; code: string; name: string; budget: Money; actual: Money; etc: Money; eac: Money; vac: Money }[]
  over: { p: Project; vac: Money }[] // projects whose EAC exceeds budget in this function, worst first
}
export function portfolioEtcEac(s: AppState, projects: Project[], basis: RollupBasis = 'latest') {
  const picked = projects.map((p) => ({ p, version: versionFor(s, p.id, basis)! })).filter((x) => x.version)
  const map = new Map<string, PortfolioFnRow>()
  for (const fn of s.settings.wbsFunctions) map.set(fn.id, { fnId: fn.id, code: fn.code, name: fn.name, budget: 0, actual: 0, etc: 0, eac: 0, vac: 0, lines: [], over: [] })
  let held = 0, budCont = 0
  for (const { p, version } of picked) {
    const t = etcEacAt(s, p, version, versionCutoff(s, version))
    held += t.contingencyHeld
    budCont += t.totals.budget - sum(t.rows.map((r) => r.budget))
    for (const r of t.rows as FunctionRow[]) {
      const row = map.get(r.fnId)
      if (!row) continue
      row.budget += r.budget; row.actual += r.actual; row.etc += r.etc; row.eac += r.eac; row.vac += r.vac
      if (r.vac < 0 && r.eac > 0) row.over.push({ p, vac: r.vac })
      for (const l of r.lines) {
        let lr = row.lines.find((x) => x.id === l.line.id)
        if (!lr) { lr = { id: l.line.id, code: l.line.code, name: l.line.name, budget: 0, actual: 0, etc: 0, eac: 0, vac: 0 }; row.lines.push(lr) }
        lr.budget += l.budget; lr.actual += l.actual; lr.etc += l.etc; lr.eac += l.eac; lr.vac += l.vac
      }
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, over: r.over.sort((a, b) => a.vac - b.vac) }))
  const T = (k: 'budget' | 'actual' | 'etc' | 'eac') => sum(rows.map((r) => r[k]))
  const totals = { budget: T('budget') + budCont, actual: T('actual'), etc: T('etc') + held, eac: T('eac') + held, vac: T('budget') + budCont - T('eac') - held }
  return { rows, contingencyHeld: held, budgetContingency: budCont, totals, projects: picked }
}

export function portfolioEtcEacCsv(r: ReturnType<typeof portfolioEtcEac>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const f of r.rows) {
    out.push({ 'WBS code': f.code, 'WBS function': f.name, 'Line code': '', 'Line item': '', Budget: f.budget, 'Actual to date': f.actual, ETC: f.etc, EAC: f.eac, VAC: f.vac, 'Projects over budget': f.over.length })
    for (const l of f.lines) out.push({ 'WBS code': f.code, 'WBS function': f.name, 'Line code': l.code, 'Line item': l.name, Budget: l.budget, 'Actual to date': l.actual, ETC: l.etc, EAC: l.eac, VAC: l.vac, 'Projects over budget': '' })
  }
  out.push({ 'WBS code': '990', 'WBS function': 'Contingency', 'Line code': '', 'Line item': '', Budget: r.budgetContingency, 'Actual to date': 0, ETC: r.contingencyHeld, EAC: r.contingencyHeld, VAC: r.budgetContingency - r.contingencyHeld, 'Projects over budget': '' })
  out.push({ 'WBS code': 'TOTAL', 'WBS function': 'Total', 'Line code': '', 'Line item': '', Budget: r.totals.budget, 'Actual to date': r.totals.actual, ETC: r.totals.etc, EAC: r.totals.eac, VAC: r.totals.vac, 'Projects over budget': '' })
  return out
}

// ───────────────────────────── SAP drill-down helpers

/** What one SAP transaction contributes to a line (or to all lines of a function): its amount, or its allocated share. */
export function txnShare(s: AppState, t: ActualTxn, o: { lineId?: string; fnId?: string }): Money {
  if (o.lineId) return t.lineId === o.lineId ? t.amount : t.allocation?.[o.lineId] ?? 0
  if (o.fnId) {
    if (t.lineId) return functionOfLine(s, t.lineId) === o.fnId ? t.amount : 0
    return sum(Object.entries(t.allocation ?? {}).filter(([l]) => functionOfLine(s, l) === o.fnId).map(([, v]) => v))
  }
  return t.amount
}
