// Capital allocation: quantify each project's benefit (safety, added capacity, redundancy), weight it, and pick the
// combination of projects that delivers the most benefit within the capital available (0/1 knapsack, exact).
// Pure: reads state, returns numbers. Inputs are engineering and system measures only — never community,
// demographic or wealth attributes (AGENT_RULES rule 14). It never reads project.location at all.
import type { AllocationCriterion, AllocationDecision, AllocationSettings, AppState, ID, Money, Project, ProjectBenefits } from '../types'
import { activeBudget, position } from './position'
import { estimateTotals } from './estimates'
import { sum } from '../util'

export const CRITERIA: { id: AllocationCriterion; label: string; unit: string; field: keyof Pick<ProjectBenefits, 'safetyK' | 'capacityMmcfd' | 'redundancyCustomers'>; help: string }[] = [
  { id: 'safety', label: 'Safety', unit: '$K/yr', field: 'safetyK', help: 'Monetized safety risk reduced per year: likelihood × consequence of failure before the work, less after (from the integrity risk model).' },
  { id: 'capacity', label: 'Added capacity', unit: 'MMcfd', field: 'capacityMmcfd', help: 'System capacity added, million cubic feet per day (from the hydraulic study).' },
  { id: 'redundancy', label: 'Redundancy', unit: 'customers', field: 'redundancyCustomers', help: 'Customers that gain a second feed and are no longer served by a single source.' },
]

// VERIFY: starting weights and the full-credit scale are demo placeholders for the portfolio team to set.
export const DEFAULT_ALLOCATION: AllocationSettings = {
  weights: { safety: 50, capacity: 25, redundancy: 25 },
  fullCredit: { safety: 1000, capacity: 25, redundancy: 10_000 },
  budget: 0,
  lockCommitted: true,
  decisions: {},
}

/** Authorized funding across all programs for `years` years starting at the as-of year. */
export function authorizedFunding(s: Pick<AppState, 'funding' | 'settings'>, years = 3): { amount: Money; from: number; to: number } {
  const from = Number(s.settings.asOf.slice(0, 4)), to = from + years - 1
  return { amount: sum(s.funding.filter((f) => f.year >= from && f.year <= to).map((f) => f.authorized)), from, to }
}

export function allocationOf(s: Pick<AppState, 'settings' | 'funding'>): AllocationSettings {
  const a = s.settings.allocation
  return {
    ...DEFAULT_ALLOCATION,
    ...a,
    weights: { ...DEFAULT_ALLOCATION.weights, ...a?.weights },
    fullCredit: { ...DEFAULT_ALLOCATION.fullCredit, ...a?.fullCredit },
    decisions: { ...a?.decisions },
    budget: a?.budget || authorizedFunding(s).amount,
  }
}

export function validateAllocation(a: Pick<AllocationSettings, 'weights' | 'fullCredit' | 'budget'>): string[] {
  const out: string[] = []
  for (const c of CRITERIA) {
    if (!(a.weights[c.id] >= 0)) out.push(`${c.label} weight cannot be negative.`)
    if (!(a.fullCredit[c.id] > 0)) out.push(`${c.label} full-credit amount must be more than zero.`)
  }
  if (!(sum(CRITERIA.map((c) => a.weights[c.id])) > 0)) out.push('At least one weight must be more than zero.')
  if (!(a.budget >= 0)) out.push('Capital available cannot be negative.')
  return out
}

/** Weights as shares of 100%. */
export function weightShares(w: Record<AllocationCriterion, number>): Record<AllocationCriterion, number> {
  const t = sum(CRITERIA.map((c) => Math.max(0, w[c.id])))
  return Object.fromEntries(CRITERIA.map((c) => [c.id, t ? Math.max(0, w[c.id]) / t : 0])) as Record<AllocationCriterion, number>
}

/**
 * Benefit points: for each measure, (amount ÷ full-credit amount) × 100 × weight share, summed.
 * Linear and additive, so points can be added across projects and compared per dollar.
 */
export function scoreBenefits(b: ProjectBenefits | undefined, a: Pick<AllocationSettings, 'weights' | 'fullCredit'>): { total: number; parts: Record<AllocationCriterion, number> } {
  const sh = weightShares(a.weights)
  const parts = Object.fromEntries(CRITERIA.map((c) => {
    const v = Math.max(0, Number(b?.[c.field]) || 0)
    return [c.id, a.fullCredit[c.id] > 0 ? (v / a.fullCredit[c.id]) * 100 * sh[c.id] : 0]
  })) as Record<AllocationCriterion, number>
  return { total: sum(Object.values(parts)), parts }
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
  committed: boolean // control budget in force
  decision: AllocationDecision
  locked: boolean // funded before the optimizer runs (committed or must-fund)
  benefit: number
  parts: Record<AllocationCriterion, number>
  perM: number // benefit points per $1M of cost to complete
  missing: boolean // no benefit entered
  status: AllocStatus
}
export interface AllocResult {
  rows: AllocRow[]
  budget: Money
  lockedCost: Money
  spend: Money
  unused: Money
  overLocked: Money // committed and must-fund cost above the capital available (0 when it fits)
  benefit: number // benefit points funded
  maxBenefit: number // all eligible projects funded
  greedyBenefit: number // funding in benefit-per-dollar order until the money runs out
  byCriterion: Record<AllocationCriterion, number>
  funded: number
  eligible: number
  /** Best achievable benefit at each level of capital (the efficient frontier). */
  frontier: { budget: Money; benefit: number }[]
  unit: Money
}

export function isAllocCandidate(p: Project): boolean { return p.status !== 'closed' && p.status !== 'cancelled' }

export function allocationRows(s: AppState, a: AllocationSettings): AllocRow[] {
  return s.projects.filter(isAllocCandidate).map((p) => {
    const cost = costToComplete(s, p)
    const committed = activeBudget(s, p.id)?.kind === 'control'
    const decision = a.decisions[p.id] ?? 'auto'
    const sc = scoreBenefits(p.benefits, a)
    const locked = decision === 'must' || (decision !== 'exclude' && a.lockCommitted && committed)
    return {
      project: p, cost, committed, decision, locked, benefit: sc.total, parts: sc.parts,
      perM: cost > 0 ? sc.total / (cost / 1e6) : sc.total > 0 ? Infinity : 0,
      missing: !p.benefits, status: decision === 'exclude' ? 'excluded' : locked ? (decision === 'must' ? 'must' : 'committed') : 'unfunded',
    }
  })
}

const MAX_CELLS = 200_000

/** Exact 0/1 knapsack over cost in $0.1M steps (coarser if the portfolio is very large). Deterministic. */
export function optimize(s: AppState, a: AllocationSettings = allocationOf(s)): AllocResult {
  const rows = allocationRows(s, a)
  const locked = rows.filter((r) => r.locked)
  const flex = rows.filter((r) => !r.locked && r.decision !== 'exclude')
  const lockedCost = sum(locked.map((r) => r.cost))
  const lockedBenefit = sum(locked.map((r) => r.benefit))
  const flexCost = sum(flex.map((r) => r.cost))
  let unit = 100_000
  while (Math.ceil(flexCost / unit) > MAX_CELLS) unit *= 2
  const w = flex.map((r) => Math.ceil(r.cost / unit))
  const C = sum(w)
  const dp = new Float64Array(C + 1)
  const keep = new Uint8Array(flex.length * (C + 1))
  flex.forEach((r, i) => {
    const wi = w[i], b = r.benefit
    for (let c = C; c >= wi; c--) {
      const v = dp[c - wi] + b
      if (v > dp[c] + 1e-9) { dp[c] = v; keep[i * (C + 1) + c] = 1 }
    }
  })
  const cap = Math.max(0, a.budget - lockedCost)
  let c = Math.min(C, Math.floor(cap / unit))
  const take = new Set<number>()
  for (let i = flex.length - 1; i >= 0; i--) if (keep[i * (C + 1) + c]) { take.add(i); c -= w[i] }
  flex.forEach((r, i) => { r.status = take.has(i) ? 'funded' : 'unfunded' })

  // Rank order: fund the best benefit per dollar first, skip what no longer fits.
  let left = cap, greedy = 0
  for (const r of [...flex].sort((x, y) => y.perM - x.perM || x.cost - y.cost)) if (r.cost <= left) { left -= r.cost; greedy += r.benefit }

  const funded = rows.filter((r) => r.status === 'funded' || r.status === 'committed' || r.status === 'must')
  const spend = sum(funded.map((r) => r.cost))
  const steps = 40
  const frontier = Array.from({ length: steps + 1 }, (_, k) => {
    const cc = Math.round((C * k) / steps)
    return { budget: lockedCost + cc * unit, benefit: lockedBenefit + dp[cc] }
  })
  const byCriterion = Object.fromEntries(CRITERIA.map((cr) => [cr.id, sum(funded.map((r) => r.parts[cr.id]))])) as Record<AllocationCriterion, number>
  rows.sort((x, y) => order(x.status) - order(y.status) || y.perM - x.perM || x.project.code.localeCompare(y.project.code))
  return {
    rows, budget: a.budget, lockedCost, spend, unused: Math.max(0, a.budget - spend), overLocked: Math.max(0, lockedCost - a.budget),
    benefit: sum(funded.map((r) => r.benefit)), maxBenefit: lockedBenefit + sum(flex.map((r) => r.benefit)), greedyBenefit: lockedBenefit + greedy,
    byCriterion, funded: funded.length, eligible: rows.filter((r) => r.status !== 'excluded').length, frontier, unit,
  }
}

const ORDER: Record<AllocStatus, number> = { committed: 0, must: 1, funded: 2, unfunded: 3, excluded: 4 }
const order = (x: AllocStatus) => ORDER[x]

export const STATUS_LABEL: Record<AllocStatus, string> = { committed: 'Committed', must: 'Must fund', funded: 'Funded', unfunded: 'Not funded', excluded: 'Excluded' }
export const DECISION_LABEL: Record<AllocationDecision, string> = { auto: 'Optimizer decides', must: 'Must fund', exclude: 'Exclude' }

/** Set one project's benefit numbers (audited by the caller). */
export function setBenefits(d: AppState, pid: ID, patch: Partial<ProjectBenefits>, byId: ID): { before?: ProjectBenefits; after: ProjectBenefits } | null {
  const p = d.projects.find((x) => x.id === pid)
  if (!p) return null
  const before = p.benefits ? { ...p.benefits } : undefined
  const base: ProjectBenefits = p.benefits ?? { safetyK: 0, capacityMmcfd: 0, redundancyCustomers: 0 }
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'number' ? Math.max(0, v) : v]))
  p.benefits = { ...base, ...clean, updatedById: byId, updatedAt: d.settings.asOf }
  return { before, after: p.benefits }
}

/** Save weights, scale, capital available or decisions into settings (audited by the caller). */
export function saveAllocation(d: AppState, patch: Partial<AllocationSettings>): AllocationSettings {
  const cur = allocationOf(d)
  d.settings.allocation = { ...cur, ...patch, weights: { ...cur.weights, ...patch.weights }, fullCredit: { ...cur.fullCredit, ...patch.fullCredit }, decisions: { ...cur.decisions, ...patch.decisions } }
  return d.settings.allocation
}
