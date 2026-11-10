// Capital allocation: quantify each project's benefit on configurable measures (safety, reliability, capacity,
// redundancy, emissions, O&M savings, …), weight them, and pick the combination of projects that delivers the most
// benefit within the capital available (exact 0/1 knapsack).
// Pure: reads state, returns numbers. Measures are engineering, system and financial only — never community,
// demographic or wealth attributes (AGENT_RULES rule 14). It never reads project.location at all.
import type { AllocationAttribute, AllocationCriterion, AllocationCriterionDef, AllocationDecision, AllocationPreset, AllocationSettings, AppState, ID, Money, Project, ProjectBenefits } from '../types'
import { activeBudget, position } from './position'
import { estimateTotals } from './estimates'
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
export const DEFAULT_ALLOCATION: AllocationSettings = { criteria: DEFAULT_CRITERIA, presets: DEFAULT_PRESETS, budget: 0, lockCommitted: true, useConfidence: true, decisions: {} }

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
  }
}

export const activeCriteria = (a: Pick<AllocationSettings, 'criteria'>) => a.criteria.filter((c) => c.active)

/** Words that must never name or describe a measure (rule 14). */
export const FORBIDDEN_MEASURE = /\bdac\b|disadvantag|income|wealth|\brace\b|racial|ethnic|home.?value|property.?value|\bzip\b|postal|census|demograph|poverty|language|tract median/i

export function validateAllocation(a: Pick<AllocationSettings, 'criteria' | 'budget'> & Partial<Pick<AllocationSettings, 'presets'>>): string[] {
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
  committed: boolean // control budget in force
  decision: AllocationDecision
  locked: boolean // funded before the optimizer runs (committed or must-fund)
  benefit: number
  parts: Record<AllocationCriterion, number>
  confidence: number // % applied (100 when confidence is off)
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
      project: p, cost, committed, decision, locked, benefit: sc.total, parts: sc.parts, confidence: sc.confidence,
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
  const byCriterion = Object.fromEntries(activeCriteria(a).map((cr) => [cr.id, sum(funded.map((r) => r.parts[cr.id] ?? 0))]))
  rows.sort((x, y) => ORDER[x.status] - ORDER[y.status] || y.perM - x.perM || x.project.code.localeCompare(y.project.code))
  return {
    rows, budget: a.budget, lockedCost, spend, unused: Math.max(0, a.budget - spend), overLocked: Math.max(0, lockedCost - a.budget),
    benefit: sum(funded.map((r) => r.benefit)), maxBenefit: lockedBenefit + sum(flex.map((r) => r.benefit)), greedyBenefit: lockedBenefit + greedy,
    byCriterion, funded: funded.length, eligible: rows.filter((r) => r.status !== 'excluded').length, frontier, unit,
  }
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
  const next: AllocationSettings = { ...cur, ...clone(rest), decisions: { ...cur.decisions, ...rest.decisions } }
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
  return out
}
