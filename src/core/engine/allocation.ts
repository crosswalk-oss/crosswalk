// Capital allocation: quantify each project's benefit on configurable measures (safety, reliability, capacity,
// redundancy, emissions, O&M savings, …), weight them, and pick the combination of projects that delivers the most
// benefit within the capital available. One total limit: exact 0/1 knapsack. Limits by year (with deferral) or
// prerequisite links: exact branch and bound over fund / start later / don't fund for each project.
// Pure: reads state, returns numbers. Measures are engineering, system and financial only — never community,
// demographic or wealth attributes (AGENT_RULES rule 14). It never reads project.location at all.
import type { AllocationAttribute, AllocationCriterion, AllocationCriterionDef, AllocationDecision, AllocationDependency, AllocationPreset, AllocationSettings, AppState, ID, Money, Project, ProjectBenefits } from '../types'
import { activeBudget, position } from './position'
import { estimateTotals, spreadByYear } from './estimates'
import { sum } from '../util'

export const ATTRIBUTE_LABEL: Record<AllocationAttribute, string> = { safety: 'Safety', reliability: 'Reliability', financial: 'Financial', environmental: 'Environmental', other: 'Other' }

// VERIFY: measures, full-credit scale, weights and presets are demo placeholders for the portfolio team to set.
export const DEFAULT_CRITERIA: AllocationCriterionDef[] = [
  { id: 'safety', label: 'Safety', unit: '$K/yr', attribute: 'safety', fullCredit: 1000, weight: 35, active: true, help: 'Monetized safety risk reduced per year: likelihood × consequence of failure before the work, less after (from the integrity risk model).' },
  { id: 'reliability', label: 'Outages avoided', unit: 'cust-hrs/yr', attribute: 'reliability', fullCredit: 100_000, weight: 15, active: true, help: 'Customer outage-hours avoided per year: likelihood of a supply interruption × customers affected × hours to restore, before vs after.' },
  { id: 'capacity', label: 'Added capacity', unit: 'MMcfd', attribute: 'reliability', fullCredit: 25, weight: 15, active: true, help: 'System capacity added, million cubic feet per day (from the hydraulic study).' },
  { id: 'redundancy', label: 'Redundancy', unit: 'customers', attribute: 'reliability', fullCredit: 10_000, weight: 15, active: true, help: 'Customers that gain a second feed and are no longer served by a single source.' },
  { id: 'emissions', label: 'Emissions reduced', unit: 'tCO2e/yr', attribute: 'environmental', fullCredit: 5000, weight: 10, active: true, help: 'Methane and combustion emissions avoided per year: leak-prone pipe retired, venting cut, gas-turbine drives replaced.' },
  { id: 'om', label: 'O&M savings', unit: '$K/yr', attribute: 'financial', fullCredit: 1000, weight: 10, active: true, help: 'Operating and maintenance cost avoided per year: leak repairs, patrols, unit overhauls.' },
]
export const DEFAULT_PRESETS: AllocationPreset[] = [
  { id: 'balanced', name: 'Balanced', weights: { safety: 20, reliability: 16, capacity: 16, redundancy: 16, emissions: 16, om: 16 } },
  { id: 'safety', name: 'Safety first', weights: { safety: 60, reliability: 10, capacity: 5, redundancy: 10, emissions: 10, om: 5 } },
  { id: 'growth', name: 'Growth', weights: { safety: 25, reliability: 10, capacity: 40, redundancy: 15, emissions: 5, om: 5 } },
  { id: 'reliability', name: 'Reliability', weights: { safety: 25, reliability: 30, capacity: 10, redundancy: 25, emissions: 5, om: 5 } },
  { id: 'climate', name: 'Emissions', weights: { safety: 30, reliability: 10, capacity: 5, redundancy: 10, emissions: 40, om: 5 } },
]
// VERIFY: discount rate and deferral limit are placeholders for finance / the portfolio team.
export const DEFAULT_ALLOCATION: AllocationSettings = {
  criteria: DEFAULT_CRITERIA, presets: DEFAULT_PRESETS, budget: 0, lockCommitted: true, useConfidence: true, decisions: {},
  annual: { on: false, limits: {}, maxDeferYears: 1 },
  timing: { on: true, discountPct: 5 },
  dependencies: [],
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Authorized funding across all programs for `years` years starting at the as-of year. */
export function authorizedFunding(s: Pick<AppState, 'funding' | 'settings'>, years = 3): { amount: Money; from: number; to: number } {
  const from = Number(s.settings.asOf.slice(0, 4)), to = from + years - 1
  return { amount: sum(s.funding.filter((f) => f.year >= from && f.year <= to).map((f) => f.authorized)), from, to }
}

export function allocationOf(s: Pick<AppState, 'settings' | 'funding'>): AllocationSettings {
  const a = s.settings.allocation as Partial<AllocationSettings> | undefined
  return {
    criteria: clone(a?.criteria?.length ? a.criteria : DEFAULT_CRITERIA),
    presets: clone(a?.presets ?? DEFAULT_PRESETS),
    budget: a?.budget || authorizedFunding(s).amount,
    lockCommitted: a?.lockCommitted ?? true,
    useConfidence: a?.useConfidence ?? true,
    decisions: { ...a?.decisions },
    annual: { ...DEFAULT_ALLOCATION.annual, ...clone(a?.annual ?? {}) },
    timing: { ...DEFAULT_ALLOCATION.timing, ...a?.timing },
    dependencies: clone(a?.dependencies ?? []),
  }
}

export const activeCriteria = (a: Pick<AllocationSettings, 'criteria'>) => a.criteria.filter((c) => c.active)

/** Words that must never name or describe a measure (rule 14). */
export const FORBIDDEN_MEASURE = /\bdac\b|disadvantag|income|wealth|\brace\b|racial|ethnic|home.?value|property.?value|\bzip\b|postal|census|demograph|poverty|language|tract median/i

export function validateAllocation(a: Pick<AllocationSettings, 'criteria' | 'budget'> & Partial<Pick<AllocationSettings, 'presets' | 'annual' | 'timing'>>): string[] {
  const out: string[] = []
  const ids = new Set<string>()
  for (const c of a.criteria) {
    const name = c.label || c.id
    if (!c.id || !/^[a-z][a-z0-9-]*$/.test(c.id)) out.push(`${name}: the key must be lower-case letters, digits or hyphens.`)
    if (ids.has(c.id)) out.push(`${name}: the key ${c.id} is used twice.`)
    ids.add(c.id)
    if (!c.label.trim()) out.push(`A measure has no name.`)
    if (!c.unit.trim()) out.push(`${name}: give a unit.`)
    if (!(c.fullCredit > 0)) out.push(`${name}: the 100-point amount must be more than zero.`)
    if (!(c.weight >= 0)) out.push(`${name}: weight cannot be negative.`)
    if (FORBIDDEN_MEASURE.test(`${c.id} ${c.label} ${c.unit} ${c.help}`)) out.push(`${name}: measures cannot use community, demographic or income attributes.`)
  }
  if (a.criteria.length > 10) out.push('Use 10 measures or fewer.')
  if (!(sum(activeCriteria(a).map((c) => Math.max(0, c.weight))) > 0)) out.push('At least one active measure needs a weight above zero.')
  if (!(a.budget >= 0)) out.push('Capital available cannot be negative.')
  for (const p of a.presets ?? []) if (!p.name.trim()) out.push('A weighting preset has no name.')
  if (a.timing && !(a.timing.discountPct >= 0 && a.timing.discountPct <= 20)) out.push('Discount rate must be between 0% and 20% a year.')
  if (a.annual) {
    if (!(a.annual.maxDeferYears >= 0 && a.annual.maxDeferYears <= 3)) out.push('Projects can start at most 3 years later.')
    for (const [y, v] of Object.entries(a.annual.limits)) if (!(v >= 0)) out.push(`The ${y} limit cannot be negative.`)
  }
  return out
}

/** Active measures' weights as shares of 100%. */
export function weightShares(a: Pick<AllocationSettings, 'criteria'>): Record<AllocationCriterion, number> {
  const act = activeCriteria(a)
  const t = sum(act.map((c) => Math.max(0, c.weight)))
  return Object.fromEntries(act.map((c) => [c.id, t ? Math.max(0, c.weight) / t : 0]))
}

export const benefitValue = (b: ProjectBenefits | undefined, id: AllocationCriterion): number => Math.max(0, Number(b?.values?.[id]) || 0)
export const confidenceOf = (b: ProjectBenefits | undefined): number => Math.min(100, Math.max(0, b?.confidence ?? 100))

/**
 * Benefit points: for each active measure, (amount ÷ 100-point amount) × 100 × weight share, summed — then, when
 * enabled, × delivery confidence. Linear and additive, so points add across projects and compare per dollar.
 */
export function scoreBenefits(b: ProjectBenefits | undefined, a: Pick<AllocationSettings, 'criteria'> & Partial<Pick<AllocationSettings, 'useConfidence'>>): { total: number; parts: Record<AllocationCriterion, number>; confidence: number } {
  const sh = weightShares(a)
  const conf = a.useConfidence ? confidenceOf(b) / 100 : 1
  const parts: Record<AllocationCriterion, number> = {}
  for (const c of activeCriteria(a)) parts[c.id] = c.fullCredit > 0 ? (benefitValue(b, c.id) / c.fullCredit) * 100 * sh[c.id] * conf : 0
  return { total: sum(Object.values(parts)), parts, confidence: conf * 100 }
}

/** Cost to complete: forecast at completion (or the latest estimate when there is no budget) less actuals to date. */
export function costToComplete(s: AppState, p: Project): Money {
  const b = activeBudget(s, p.id)
  const pos = position(s, p.id)
  let total = 0
  if (b) total = pos.eac || pos.currentBudget || b.total
  else {
    const est = s.estimates.filter((e) => e.projectId === p.id && e.status !== 'rejected' && e.status !== 'superseded').sort((x, y) => x.version - y.version).pop()
    total = est ? estimateTotals(est).total : 0
  }
  return Math.max(0, Math.round(total - pos.actualToDate))
}

export type AllocStatus = 'committed' | 'must' | 'funded' | 'unfunded' | 'excluded'
export interface AllocRow {
  project: Project
  cost: Money
  byYear: Record<string, Money> // cost to complete by year, as planned
  inService: number // year the benefit starts, as planned
  committed: boolean // control budget in force
  decision: AllocationDecision
  locked: boolean // funded before the optimizer runs (committed, must-fund, or needed by one of those)
  benefit: number // points if it goes ahead as planned (after confidence and timing)
  beforeTiming: number // points before the timing discount
  parts: Record<AllocationCriterion, number>
  confidence: number // % applied (100 when confidence is off)
  timeFactor: number // timing discount applied (1 when timing is off)
  perM: number // benefit points per $1M of cost to complete
  missing: boolean // no benefit entered
  status: AllocStatus
  defer: number // years later than planned (funded rows)
  counted: number // points this row adds to the plan (after any deferral; 0 when not funded)
  needs: ID[] // prerequisite projects
  note?: string // why it is must-fund, or why it isn't funded
}
export interface AllocYear { year: string; limit?: Money; committed: Money; funded: Money; deferred: Money; total: Money }
export interface AllocResult {
  rows: AllocRow[]
  mode: 'total' | 'annual'
  method: 'knapsack' | 'search'
  exact: boolean // false only if the search hit its node limit (the plan is then the best found)
  budget: Money // capital available (sum of the yearly limits in annual mode)
  lockedCost: Money
  spend: Money
  unused: Money
  overLocked: Money // committed and must-fund cost above the capital available (0 when it fits)
  overLockedYears: string[]
  benefit: number // benefit points funded
  maxBenefit: number // all eligible projects funded as planned
  greedyBenefit: number // rank order: best benefit per dollar first until the money runs out
  byCriterion: Record<AllocationCriterion, number>
  funded: number
  deferred: number
  eligible: number
  /** Best achievable benefit at each level of total capital (the efficient frontier). */
  frontier: { budget: Money; benefit: number }[]
  frontierNote?: string
  yearly: AllocYear[]
  problems: string[]
  unit: Money
}

export function isAllocCandidate(p: Project): boolean { return p.status !== 'closed' && p.status !== 'cancelled' }
const asOfYearOf = (s: Pick<AppState, 'settings'>) => Number(s.settings.asOf.slice(0, 4))
const msDate = (p: Project, ...names: string[]) => { for (const n of names) { const m = p.milestones.find((x) => x.name === n); if (m) return m.actual ?? m.forecast } return undefined }

/** Year the project's benefit starts: the In service milestone (forecast, or actual). */
export function inServiceYear(s: AppState, p: Project, byYear?: Record<string, Money>): number {
  const d = msDate(p, 'In service', 'In service & closed')
  if (d) return Number(d.slice(0, 4))
  const ys = Object.keys(byYear ?? {}).map(Number)
  return ys.length ? Math.max(...ys) : asOfYearOf(s)
}

/** Cost to complete spread by year: the budget's (or latest estimate's) yearly plan from this year on, less this year's actuals, scaled to the cost to complete. */
export function costByYear(s: AppState, p: Project, cost: Money = costToComplete(s, p)): Record<string, Money> {
  if (cost <= 0) return {}
  const y0 = asOfYearOf(s)
  const b = activeBudget(s, p.id)
  let by: Record<string, Money> = {}
  if (b) by = { ...b.byYear }
  else {
    const est = s.estimates.filter((e) => e.projectId === p.id && e.status !== 'rejected' && e.status !== 'superseded').sort((x, y) => x.version - y.version).pop()
    const total = est ? estimateTotals(est).total : 0
    const start = msDate(p, 'Business case approved', 'Plan approved') ?? s.settings.asOf
    const end = msDate(p, 'In service', 'In service & closed') ?? start
    by = total ? spreadByYear(total, start < s.settings.asOf ? s.settings.asOf : start, end < s.settings.asOf ? s.settings.asOf : end) : {}
  }
  const spentThisYear = sum(s.costPeriods.filter((c) => c.projectId === p.id && c.period.startsWith(`${y0}-`)).map((c) => c.actual))
  const fut: Record<string, Money> = {}
  for (const [y, v] of Object.entries(by)) { const n = Number(y); if (n > y0) fut[y] = v; else if (n === y0) fut[y] = Math.max(0, v - spentThisYear) }
  const t = sum(Object.values(fut))
  if (t <= 0) return { [String(y0)]: cost }
  const keys = Object.keys(fut).filter((y) => fut[y] > 0).sort()
  const out: Record<string, Money> = {}
  let acc = 0
  keys.forEach((y, i) => { const v = i === keys.length - 1 ? cost - acc : Math.round((fut[y] * cost) / t); out[y] = v; acc += v })
  return out
}

/** Default yearly limit: this year = authorized less what's already spent this year; the next two = authorized; later = their average (planning assumption). */
export function annualLimitDefault(s: AppState, year: string): { amount: Money; basis: string } {
  const y0 = asOfYearOf(s), y = Number(year)
  const auth = (n: number) => sum(s.funding.filter((f) => f.year === n).map((f) => f.authorized))
  if (y === y0) {
    const spent = sum(s.costPeriods.filter((c) => c.period.startsWith(`${y0}-`)).map((c) => c.actual))
    return { amount: Math.max(0, auth(y0) - spent), basis: `Authorized ${y0} less spent so far this year` }
  }
  if (y <= y0 + 2 && auth(y) > 0) return { amount: auth(y), basis: `Authorized ${y}` }
  const base = [y0, y0 + 1, y0 + 2].map(auth).filter((v) => v > 0)
  return { amount: base.length ? Math.round(sum(base) / base.length / 1e6) * 1e6 : 0, basis: `Planning assumption: average authorized ${y0}–${y0 + 2}` }
}

export function annualLimits(s: AppState, a: Pick<AllocationSettings, 'annual'>, years: string[]): Record<string, { amount: Money; basis: string; custom: boolean }> {
  return Object.fromEntries(years.map((y) => [y, a.annual.limits[y] != null ? { amount: a.annual.limits[y], basis: 'Set by the portfolio team', custom: true } : { ...annualLimitDefault(s, y), custom: false }]))
}

/** Years the plan covers: this year through the last year of planned spend, plus the allowed deferral. */
export function planYears(s: AppState, rows: Pick<AllocRow, 'byYear'>[], maxDefer: number): string[] {
  const y0 = asOfYearOf(s)
  const last = Math.max(y0, ...rows.flatMap((r) => Object.keys(r.byYear).map(Number)))
  return Array.from({ length: last + maxDefer - y0 + 1 }, (_, i) => String(y0 + i))
}

export function timeFactor(s: AppState, a: Pick<AllocationSettings, 'timing'>, inService: number, defer = 0): number {
  if (!a.timing.on) return 1
  const n = Math.max(0, inService + defer - asOfYearOf(s))
  return 1 / Math.pow(1 + Math.max(0, a.timing.discountPct) / 100, n)
}

export function allocationRows(s: AppState, a: AllocationSettings): AllocRow[] {
  return s.projects.filter(isAllocCandidate).map((p) => {
    const cost = costToComplete(s, p)
    const byYear = costByYear(s, p, cost)
    const inService = inServiceYear(s, p, byYear)
    const committed = activeBudget(s, p.id)?.kind === 'control'
    const decision = a.decisions[p.id] ?? 'auto'
    const sc = scoreBenefits(p.benefits, a)
    const tf = timeFactor(s, a, inService)
    const benefit = sc.total * tf
    const locked = decision === 'must' || (decision !== 'exclude' && a.lockCommitted && committed)
    return {
      project: p, cost, byYear, inService, committed, decision, locked, benefit, beforeTiming: sc.total, timeFactor: tf,
      parts: Object.fromEntries(Object.entries(sc.parts).map(([k, v]) => [k, v * tf])), confidence: sc.confidence,
      perM: cost > 0 ? benefit / (cost / 1e6) : benefit > 0 ? Infinity : 0,
      missing: !p.benefits, status: decision === 'exclude' ? 'excluded' : locked ? (decision === 'must' ? 'must' : 'committed') : 'unfunded',
      defer: 0, counted: 0, needs: a.dependencies.filter((d) => d.projectId === p.id).map((d) => d.requiresId),
    }
  })
}

const MAX_CELLS = 200_000
const NODE_CAP = 600_000

/** 0/1 knapsack over total cost in $0.1M steps (coarser for very large portfolios). Returns best value per capacity and the chosen set at `capUnits`. */
function knapsack(items: { cost: Money; benefit: number }[], capMoney: Money) {
  const total = sum(items.map((r) => r.cost))
  let unit = 100_000
  while (Math.ceil(total / unit) > MAX_CELLS) unit *= 2
  const w = items.map((r) => Math.ceil(r.cost / unit))
  const C = sum(w)
  const dp = new Float64Array(C + 1)
  const keep = new Uint8Array(items.length * (C + 1))
  items.forEach((r, i) => {
    const wi = w[i], b = r.benefit
    for (let c = C; c >= wi; c--) { const v = dp[c - wi] + b; if (v > dp[c] + 1e-9) { dp[c] = v; keep[i * (C + 1) + c] = 1 } }
  })
  let c = Math.min(C, Math.floor(Math.max(0, capMoney) / unit))
  const take = new Set<number>()
  for (let i = items.length - 1; i >= 0; i--) if (keep[i * (C + 1) + c]) { take.add(i); c -= w[i] }
  return { take, dp, C, unit }
}

export function optimize(s: AppState, a: AllocationSettings = allocationOf(s)): AllocResult {
  const rows = allocationRows(s, a)
  const byId = new Map(rows.map((r) => [r.project.id, r]))
  const problems: string[] = []
  // Prerequisites of locked work are locked too (a committed project can't deliver without them).
  for (let changed = true; changed;) {
    changed = false
    for (const r of rows.filter((x) => x.locked)) for (const req of r.needs) {
      const q = byId.get(req)
      if (!q || q.locked) continue
      if (q.decision === 'exclude') { const m = `${r.project.code} is ${r.status === 'must' ? 'must-fund' : 'committed'} but needs ${q.project.code}, which is excluded.`; if (!problems.includes(m)) problems.push(m); continue }
      q.locked = true; q.status = 'must'; q.note = `Needed by ${r.project.code}`; changed = true
    }
  }
  const locked = rows.filter((r) => r.locked)
  const flex = rows.filter((r) => !r.locked && r.decision !== 'exclude')
  const lockedCost = sum(locked.map((r) => r.cost))
  const lockedBenefit = sum(locked.map((r) => r.benefit))
  for (const r of locked) { r.counted = r.benefit }
  const annual = a.annual.on
  const D = annual ? Math.max(0, Math.min(3, Math.round(a.annual.maxDeferYears))) : 0
  const years = planYears(s, rows, D)
  const limits = annual ? annualLimits(s, a, years) : {}
  // A prerequisite that is a flexible project, or excluded, makes the search necessary.
  const flexIds = new Set(flex.map((r) => r.project.id))
  const deps = a.dependencies.filter((d) => flexIds.has(d.projectId) && d.projectId !== d.requiresId)
  const needSearch = annual || deps.some((d) => !byId.get(d.requiresId)?.locked)

  let method: AllocResult['method'] = 'knapsack', exact = true, greedy = 0
  const choice = new Map<AllocRow, number>() // flex row → years deferred (absent = not funded)

  if (!needSearch) {
    const ks = knapsack(flex, a.budget - lockedCost)
    flex.forEach((r, i) => { if (ks.take.has(i)) choice.set(r, 0) })
    let left = Math.max(0, a.budget - lockedCost)
    for (const r of [...flex].sort((x, y) => y.perM - x.perM || x.cost - y.cost)) if (r.cost <= left) { left -= r.cost; greedy += r.benefit }
  } else {
    method = 'search'
    const dims = annual ? years : ['all']
    const cap = new Float64Array(dims.length)
    if (annual) years.forEach((y, k) => { cap[k] = Math.max(0, limits[y].amount - sum(locked.map((r) => r.byYear[y] ?? 0))) })
    else cap[0] = Math.max(0, a.budget - lockedCost)
    type Opt = { d: number; ben: number; cost: Float64Array }
    const blocked = new Set<AllocRow>()
    for (const r of flex) for (const req of r.needs) {
      const q = byId.get(req)
      if (q ? q.decision === 'exclude' : s.projects.find((p) => p.id === req)?.status === 'cancelled') { blocked.add(r); r.note = `Needs ${q?.project.code ?? 'a cancelled project'}${q ? ' (excluded)' : ''}` }
    }
    const items = flex.map((r) => {
      const opts: Opt[] = []
      if (!blocked.has(r)) for (let d = 0; d <= D; d++) {
        const cost = new Float64Array(dims.length)
        let fits = true
        if (annual) for (const [y, v] of Object.entries(r.byYear)) { const k = years.indexOf(String(Number(y) + d)); if (k < 0) { fits = false; break } cost[k] += v }
        else cost[0] = r.cost
        if (fits) opts.push({ d, ben: r.beforeTiming * timeFactor(s, a, r.inService, d), cost })
      }
      return { row: r, opts, total: r.cost, best: opts[0]?.ben ?? 0, pre: [] as number[], post: [] as number[] }
    })
    // Rank order (benefit per dollar) for the incumbent; the search itself branches on the biggest projects first.
    const rankOrder = [...items].sort((x, y) => (y.total ? y.best / y.total : Infinity) - (x.total ? x.best / x.total : Infinity) || x.total - y.total)
    items.sort((x, y) => y.total - x.total || y.best - x.best || x.row.project.code.localeCompare(y.row.project.code))
    const idx = new Map(items.map((it, i) => [it.row.project.id, i]))
    for (const d of deps) { const i = idx.get(d.projectId), j = idx.get(d.requiresId); if (i != null && j != null && i !== j) { items[i].pre.push(j); items[j].post.push(i) } }
    const n = items.length
    const pick = new Int8Array(n).fill(-1) // option index, -1 = not funded
    const rem = Float64Array.from(cap)
    const okFund = (i: number, d: number) => {
      for (const j of items[i].pre) if (j < i && (pick[j] < 0 || items[j].opts[pick[j]].d > d)) return false
      for (const q of items[i].post) if (q < i && pick[q] >= 0 && d > items[q].opts[pick[q]].d) return false
      return true
    }
    const okSkip = (i: number) => { for (const q of items[i].post) if (q < i && pick[q] >= 0) return false; return true }
    const fits = (c: Float64Array) => { for (let k = 0; k < c.length; k++) if (c[k] > 1e-6 && c[k] > rem[k] + 1e-6) return false; return true }
    const apply = (c: Float64Array, sign: 1 | -1) => { for (let k = 0; k < c.length; k++) rem[k] -= sign * c[k] }
    // Rank-order incumbent: best benefit per dollar first, earliest start that fits.
    // okFund only sees decided items, so walk rank order and check prerequisites by decision state.
    const decided = new Int8Array(n)
    const okFundAny = (i: number, d: number) => {
      for (const j of items[i].pre) if (!decided[j] || pick[j] < 0 || items[j].opts[pick[j]].d > d) return false
      return true
    }
    for (const it of rankOrder) {
      const i = items.indexOf(it)
      for (let o = 0; o < it.opts.length; o++) { const op = it.opts[o]; if (fits(op.cost) && okFundAny(i, op.d)) { pick[i] = o; apply(op.cost, 1); greedy += op.ben; break } }
      decided[i] = 1
    }
    let best = greedy
    let bestPick = Int8Array.from(pick)
    pick.fill(-1); rem.set(cap)
    let nodes = 0
    // Upper bound: several relaxations, each a fractional knapsack on one implied constraint — every single year, and
    // every "years up to Y" running total (deferral can only push spend later, so early running totals bind).
    // Each item uses its best benefit and its smallest possible cost on that constraint; the tightest bound wins.
    const rowsY: number[][] = []
    for (let k = 0; k < dims.length; k++) rowsY.push([k])
    for (let k = 1; k < dims.length; k++) rowsY.push(Array.from({ length: k + 1 }, (_, x) => x))
    const R = rowsY.length
    const wR = rowsY.map((ys) => items.map((it) => (it.opts.length ? Math.min(...it.opts.map((op) => ys.reduce((a2, y) => a2 + op.cost[y], 0))) : 0)))
    const orderR = rowsY.map((_, r) => items.map((_, i) => i).filter((i) => items[i].opts.length).sort((x, y) => {
      const rx = wR[r][x] > 1e-6 ? items[x].best / wR[r][x] : Infinity, ry = wR[r][y] > 1e-6 ? items[y].best / wR[r][y] : Infinity
      return ry - rx
    }))
    // Lagrangian bound: price each year's capital (λ ≥ 0, in benefit points per $), let every remaining project take
    // its best priced option or nothing, and add back the priced capacity. Valid for any prices; the prices are tuned
    // once at the start by subgradient steps to make the bound as tight as possible.
    const m = dims.length
    const lam = new Float64Array(m)
    const lagr = (L: Float64Array, k: number, cur: number, sub?: Float64Array) => {
      let v = cur
      for (let y = 0; y < m; y++) { v += L[y] * rem[y]; if (sub) sub[y] = rem[y] }
      for (let i = k; i < n; i++) {
        let bv = 0, bo = -1
        const ops = items[i].opts
        for (let o = 0; o < ops.length; o++) { let x = ops[o].ben; const c = ops[o].cost; for (let y = 0; y < m; y++) x -= L[y] * c[y]; if (x > bv) { bv = x; bo = o } }
        v += bv
        if (sub && bo >= 0) { const c = ops[bo].cost; for (let y = 0; y < m; y++) sub[y] -= c[y] }
      }
      return v
    }
    {
      const g = new Float64Array(m), tryL = new Float64Array(m)
      let bestV = lagr(lam, 0, 0), theta = 2, stall = 0
      lam.set(lam)
      const cur = Float64Array.from(lam)
      for (let it = 0; it < 300 && bestV > best + 1e-9; it++) {
        const v = lagr(cur, 0, 0, g)
        if (v < bestV - 1e-9) { bestV = v; lam.set(cur); stall = 0 } else if (++stall >= 20) { theta /= 2; stall = 0; if (theta < 1e-4) break }
        let gg = 0
        for (let y = 0; y < m; y++) gg += g[y] * g[y]
        if (gg <= 0) break
        const step = (theta * (v - best)) / gg
        for (let y = 0; y < m; y++) { tryL[y] = Math.max(0, cur[y] - step * g[y]) }
        cur.set(tryL)
      }
    }
    const bound = (k: number, cur: number) => {
      let ub = lagr(lam, k, cur)
      if (ub <= best + 1e-9) return ub
      for (let r = 0; r < R; r++) {
        let room = 0
        for (const y of rowsY[r]) room += rem[y]
        room = Math.max(0, room)
        let b = cur
        for (const i of orderR[r]) {
          if (i < k) continue
          const w = wR[r][i], v = items[i].best
          if (w <= 1e-6) { b += v; continue }
          if (w <= room) { b += v; room -= w } else { b += (v * room) / w; break }
        }
        if (b < ub) ub = b
        if (ub <= best + 1e-9) break
      }
      return ub
    }
    const dfs = (k: number, cur: number): void => {
      if (++nodes > NODE_CAP) { exact = false; return }
      if (k === n) { if (cur > best + 1e-9) { best = cur; bestPick = Int8Array.from(pick) } return }
      if (bound(k, cur) <= best + 1e-9) return
      const it = items[k]
      for (let o = 0; o < it.opts.length; o++) {
        const op = it.opts[o]
        if (!fits(op.cost) || !okFund(k, op.d)) continue
        pick[k] = o; apply(op.cost, 1)
        dfs(k + 1, cur + op.ben)
        apply(op.cost, -1); pick[k] = -1
        if (!exact) return
      }
      if (okSkip(k)) dfs(k + 1, cur)
    }
    dfs(0, 0)
    items.forEach((it, i) => { if (bestPick[i] >= 0) choice.set(it.row, it.opts[bestPick[i]].d) })
  }

  for (const r of flex) {
    const d = choice.get(r)
    if (d == null) { r.status = 'unfunded'; continue }
    r.status = 'funded'; r.defer = d; r.counted = r.beforeTiming * timeFactor(s, a, r.inService, d)
  }
  for (const r of flex) if (r.status === 'unfunded' && !r.note) {
    const miss = r.needs.map((id) => byId.get(id)).filter((q): q is AllocRow => !!q && (q.status === 'unfunded' || q.status === 'excluded'))
    if (miss.length) r.note = `Needs ${miss.map((q) => q.project.code).join(', ')} (not funded)`
  }

  const fundedRows = rows.filter((r) => r.status === 'funded' || r.status === 'committed' || r.status === 'must')
  const spend = sum(fundedRows.map((r) => r.cost))
  // Spend by year after deferrals.
  const yearly: AllocYear[] = years.map((y) => {
    const committed = sum(locked.map((r) => r.byYear[y] ?? 0))
    const funded = sum(flex.filter((r) => r.status === 'funded' && r.defer === 0).map((r) => r.byYear[y] ?? 0))
    const deferred = sum(flex.filter((r) => r.status === 'funded' && r.defer > 0).map((r) => r.byYear[String(Number(y) - r.defer)] ?? 0))
    return { year: y, limit: annual ? limits[y].amount : undefined, committed, funded, deferred, total: committed + funded + deferred }
  })
  const budget = annual ? sum(years.map((y) => limits[y].amount)) : a.budget
  const overLockedYears = annual ? yearly.filter((y) => y.committed > (y.limit ?? Infinity) + 1).map((y) => y.year) : []
  const overLocked = annual ? sum(yearly.map((y) => Math.max(0, y.committed - (y.limit ?? Infinity)))) : Math.max(0, lockedCost - a.budget)

  const fr = knapsack(flex, 0)
  const steps = 40
  const frontier = Array.from({ length: steps + 1 }, (_, k) => {
    const cc = Math.round((fr.C * k) / steps)
    return { budget: lockedCost + cc * fr.unit, benefit: lockedBenefit + fr.dp[cc] }
  })
  const byCriterion = Object.fromEntries(activeCriteria(a).map((cr) => [cr.id, sum(fundedRows.map((r) => (r.benefit > 0 ? ((r.parts[cr.id] ?? 0) * r.counted) / r.benefit : 0)))]))
  rows.sort((x, y) => ORDER[x.status] - ORDER[y.status] || y.perM - x.perM || x.project.code.localeCompare(y.project.code))
  return {
    rows, mode: annual ? 'annual' : 'total', method, exact, budget, lockedCost, spend,
    unused: annual ? sum(yearly.map((y) => Math.max(0, (y.limit ?? 0) - y.total))) : Math.max(0, a.budget - spend),
    overLocked, overLockedYears,
    benefit: sum(fundedRows.map((r) => r.counted)), maxBenefit: lockedBenefit + sum(flex.map((r) => r.benefit)), greedyBenefit: lockedBenefit + greedy,
    byCriterion, funded: fundedRows.length, deferred: flex.filter((r) => r.status === 'funded' && r.defer > 0).length, eligible: rows.filter((r) => r.status !== 'excluded').length,
    frontier, frontierNote: method === 'search' ? 'The curve uses a single total; limits by year and prerequisites can lower what is achievable.' : undefined,
    yearly, problems, unit: fr.unit,
  }
}

/** Would `projectId requires requiresId` create a loop (requiresId already depends on projectId)? */
export function dependencyLoop(deps: AllocationDependency[], projectId: ID, requiresId: ID): boolean {
  if (projectId === requiresId) return true
  const seen = new Set<ID>()
  const walk = (id: ID): boolean => { if (id === projectId) return true; if (seen.has(id)) return false; seen.add(id); return deps.filter((d) => d.projectId === id).some((d) => walk(d.requiresId)) }
  return walk(requiresId)
}

const ORDER: Record<AllocStatus, number> = { committed: 0, must: 1, funded: 2, unfunded: 3, excluded: 4 }

export const STATUS_LABEL: Record<AllocStatus, string> = { committed: 'Committed', must: 'Must fund', funded: 'Funded', unfunded: 'Not funded', excluded: 'Excluded' }
export const DECISION_LABEL: Record<AllocationDecision, string> = { auto: 'Optimizer decides', must: 'Must fund', exclude: 'Exclude' }

/** Set one project's benefit amounts and/or delivery confidence (audited by the caller). Negative amounts become 0. */
export function setBenefits(d: AppState, pid: ID, patch: { values?: Record<AllocationCriterion, number>; confidence?: number; basis?: string }, byId: ID): { before?: ProjectBenefits; after: ProjectBenefits } | null {
  const p = d.projects.find((x) => x.id === pid)
  if (!p) return null
  const before = p.benefits ? clone(p.benefits) : undefined
  const base: ProjectBenefits = p.benefits ?? { values: {} }
  const values = { ...base.values }
  for (const [k, v] of Object.entries(patch.values ?? {})) values[k] = Math.max(0, Number(v) || 0)
  p.benefits = {
    ...base, values,
    ...(patch.confidence != null ? { confidence: Math.min(100, Math.max(0, patch.confidence)) } : {}),
    ...(patch.basis != null ? { basis: patch.basis } : {}),
    updatedById: byId, updatedAt: d.settings.asOf,
  }
  return { before, after: p.benefits }
}

/** Save allocation settings (audited by the caller). `weights` updates the active measures' weights in place. */
export function saveAllocation(d: AppState, patch: Partial<AllocationSettings> & { weights?: Record<AllocationCriterion, number> }): AllocationSettings {
  const cur = allocationOf(d)
  const { weights, ...rest } = patch
  const next: AllocationSettings = { ...cur, ...clone(rest), decisions: { ...cur.decisions, ...rest.decisions }, annual: { ...cur.annual, ...clone(rest.annual ?? {}) }, timing: { ...cur.timing, ...rest.timing } }
  if (weights) next.criteria = next.criteria.map((c) => (weights[c.id] != null ? { ...c, weight: weights[c.id] } : c))
  d.settings.allocation = next
  return next
}

/** One line per change between two settings, for the audit log. */
export function describeAllocationChange(a: AllocationSettings, b: AllocationSettings): string[] {
  const out: string[] = []
  for (const c of b.criteria) {
    const o = a.criteria.find((x) => x.id === c.id)
    if (!o) { out.push(`added measure ${c.label} (${c.unit}, 100 pts = ${c.fullCredit}, weight ${c.weight})`); continue }
    if (o.label !== c.label) out.push(`${o.label} renamed ${c.label}`)
    if (o.active !== c.active) out.push(`${c.label} ${c.active ? 'switched on' : 'switched off'}`)
    if (o.weight !== c.weight) out.push(`${c.label} weight ${o.weight} → ${c.weight}`)
    if (o.fullCredit !== c.fullCredit) out.push(`${c.label} 100 pts ${o.fullCredit} → ${c.fullCredit} ${c.unit}`)
    if (o.unit !== c.unit) out.push(`${c.label} unit ${o.unit} → ${c.unit}`)
    if (o.attribute !== c.attribute) out.push(`${c.label} group ${ATTRIBUTE_LABEL[o.attribute]} → ${ATTRIBUTE_LABEL[c.attribute]}`)
    if (o.help !== c.help) out.push(`${c.label} description changed`)
  }
  for (const o of a.criteria) if (!b.criteria.some((c) => c.id === o.id)) out.push(`removed measure ${o.label}`)
  if (JSON.stringify(a.presets) !== JSON.stringify(b.presets)) out.push(`weighting presets: ${b.presets.map((p) => p.name).join(', ') || 'none'}`)
  if (a.budget !== b.budget) out.push(`capital available $${(a.budget / 1e6).toFixed(1)}M → $${(b.budget / 1e6).toFixed(1)}M`)
  if (a.lockCommitted !== b.lockCommitted) out.push(`fund committed projects first ${b.lockCommitted ? 'on' : 'off'}`)
  if (a.useConfidence !== b.useConfidence) out.push(`risk-adjust by delivery confidence ${b.useConfidence ? 'on' : 'off'}`)
  if (a.annual.on !== b.annual.on) out.push(`limit by year ${b.annual.on ? 'on' : 'off'}`)
  if (a.annual.maxDeferYears !== b.annual.maxDeferYears) out.push(`projects may start up to ${b.annual.maxDeferYears} yr later`)
  for (const y of new Set([...Object.keys(a.annual.limits), ...Object.keys(b.annual.limits)])) if (a.annual.limits[y] !== b.annual.limits[y]) out.push(`${y} limit ${a.annual.limits[y] != null ? `$${(a.annual.limits[y] / 1e6).toFixed(1)}M` : 'default'} → ${b.annual.limits[y] != null ? `$${(b.annual.limits[y] / 1e6).toFixed(1)}M` : 'default'}`)
  if (a.timing.on !== b.timing.on) out.push(`benefit timing ${b.timing.on ? 'on' : 'off'}`)
  if (a.timing.discountPct !== b.timing.discountPct) out.push(`discount rate ${a.timing.discountPct}% → ${b.timing.discountPct}%`)
  if (JSON.stringify(a.dependencies) !== JSON.stringify(b.dependencies)) out.push(`prerequisites: ${b.dependencies.length}`)
  return out
}
