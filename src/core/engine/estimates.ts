import type { AaceClass, AppState, BudgetVersion, Estimate, EstimateLine, EstimatingConfig, Money, Project, UnitCostRate } from '../types'
import { sum, uid, nowISO } from '../util'

export type MaturityItem = { key: string; label: string; forClass: AaceClass; hint: string }

/**
 * Default maturity checklist. The live list is maintained by the estimating team in
 * settings.estimating.maturityItems (Estimating administration); pass it as `items`.
 */
export const MATURITY_ITEMS: MaturityItem[] = [
  { key: 'need-defined', label: 'Need, driver and asset identified', forClass: 5, hint: 'Charter and driver recorded' },
  { key: 'route-selected', label: 'Route / site option selected', forClass: 4, hint: 'Option analysis complete' },
  { key: 'scope-quantities', label: 'Scope quantities from preliminary design', forClass: 4, hint: 'Lengths, valves, tie-ins counted' },
  { key: 'design-30', label: 'Design at least 30% complete', forClass: 3, hint: 'Plan & profile, tie-in details' },
  { key: 'survey-complete', label: 'Survey and potholing complete', forClass: 3, hint: 'Substructures located' },
  { key: 'permits-identified', label: 'All permits identified with agencies', forClass: 3, hint: 'Permit matrix complete' },
  { key: 'land-identified', label: 'Land rights needs identified', forClass: 3, hint: 'Parcels and right types known' },
  { key: 'material-quotes', label: 'Vendor quotes for major material', forClass: 3, hint: 'Pipe, valves, fittings' },
  { key: 'risk-register', label: 'Quantified risk register', forClass: 3, hint: 'Three-point impacts on top risks' },
  { key: 'schedule-baseline', label: 'Resource-loaded schedule', forClass: 3, hint: 'Imported from P6 / MS Project' },
  { key: 'design-90', label: 'Design at least 90% complete', forClass: 2, hint: 'Issued for bid' },
  { key: 'contractor-bids', label: 'Contractor bids received', forClass: 2, hint: 'At least one compliant bid' },
  { key: 'ifc', label: 'Issued-for-construction drawings', forClass: 1, hint: 'IFC package' },
  { key: 'land-acquired', label: 'Land rights acquired', forClass: 1, hint: 'All parcels executed' },
]

// VERIFY: accuracy ranges per class are indicative AACE 18R-97 values; confirm the ranges the estimating team publishes.
/** Expected accuracy ranges by class (configurable product defaults, AACE 18R-97 indicative). */
export const CLASS_RANGES: Record<AaceClass, { low: number; high: number; definition: string; use: string }> = {
  5: { low: -0.5, high: 1.0, definition: '0–2%', use: 'Screening, GRC forecast, planning budget' },
  4: { low: -0.3, high: 0.5, definition: '1–15%', use: 'Option selection' },
  3: { low: -0.2, high: 0.3, definition: '10–40%', use: 'Authorization, control budget' },
  2: { low: -0.15, high: 0.2, definition: '30–75%', use: 'Bid check, control' },
  1: { low: -0.1, high: 0.15, definition: '65–100%', use: 'Check estimate, final change orders' },
}

/** The maturity checklist in force: the estimating team's list from settings, else the default. */
export const maturityItems = (s?: { settings?: { estimating?: Pick<EstimatingConfig, 'maturityItems'> } }): MaturityItem[] =>
  s?.settings?.estimating?.maturityItems?.length ? s.settings.estimating.maturityItems : MATURITY_ITEMS

/** Lowest (best) class whose items AND all coarser classes' items are complete. */
export function computeClass(m: Record<string, boolean>, items: MaturityItem[] = MATURITY_ITEMS): AaceClass {
  let cls: AaceClass = 5
  for (const target of [4, 3, 2, 1] as AaceClass[]) {
    const needed = items.filter((i) => i.forClass >= target)
    if (needed.every((i) => m[i.key])) cls = target
    else break
  }
  return cls
}
/** Which items are still missing to reach `target` class. */
export function missingFor(m: Record<string, boolean>, target: AaceClass, items: MaturityItem[] = MATURITY_ITEMS) {
  return items.filter((i) => i.forClass >= target && !m[i.key])
}

export const lineTotal = (l: EstimateLine) => Math.round(l.qty * l.unitCost)

export const LOADER_CAT = 'cat-loaders'
export const ESC_CAT = 'cat-escalation'
export const CONT_CAT = 'cat-contingency'

export interface EstimateTotals {
  lines: Money // direct cost before sales tax
  direct: Record<string, Money> // line totals by category, before sales tax
  byCategory: Record<string, Money> // lines (taxable categories incl. their sales tax) by category + loaders + escalation (excludes contingency)
  tax: Money // sales tax on taxable categories (county split stamped on the estimate)
  loaders: Money
  escalation: Money
  base: Money // lines + loaders + escalation
  contingency: Money
  total: Money // base + contingency
  low: Money
  high: Money
}

export function estimateTotals(e: Pick<Estimate, 'lines' | 'loaders' | 'escalationPct' | 'contingency' | 'cls'> & { salesTax?: Estimate['salesTax'] }): EstimateTotals {
  const direct: Record<string, Money> = {}
  for (const l of e.lines) direct[l.categoryId] = (direct[l.categoryId] || 0) + lineTotal(l)
  const lines = sum(Object.values(direct))
  const byCategory: Record<string, Money> = { ...direct }
  let tax = 0
  if (e.salesTax && e.salesTax.pct > 0) {
    for (const c of e.salesTax.categoryIds) {
      if (!direct[c]) continue
      const t = Math.round(direct[c] * e.salesTax.pct / 100)
      byCategory[c] += t
      tax += t
    }
  }
  const loaders = Math.round(lines * sum(e.loaders.map((x) => x.pct)) / 100)
  // VERIFY: escalation applies to lines + tax + loaders; contingency applies to that base (lines + tax + loaders + escalation).
  const escalation = Math.round((lines + tax + loaders) * e.escalationPct / 100)
  if (loaders) byCategory[LOADER_CAT] = loaders
  if (escalation) byCategory[ESC_CAT] = escalation
  const base = lines + tax + loaders + escalation
  const contingency = Math.round(base * e.contingency.pct / 100)
  const total = base + contingency
  const r = CLASS_RANGES[e.cls]
  return { lines, direct, byCategory, tax, loaders, escalation, base, contingency, total, low: Math.round(total * (1 + r.low)), high: Math.round(total * (1 + r.high)) }
}

/** Options for pricing against the rate table: the region selects region-specific rows, else base row × region factor. */
export interface RatePricing { region?: string; regionFactors?: Record<string, number> }

/**
 * Pick rate-table rows for a project's asset/work method: nearest diameter, matching terrain, and a row for the
 * project's region when the table has one (otherwise the base row; the caller applies the region factor).
 * Rows kept for a different region are never picked.
 */
export function ratesFor(project: Project, rates: UnitCostRate[], opts: RatePricing = {}): UnitCostRate[] {
  const region = opts.region ?? project.location.district
  const pool = rates.filter((r) => r.assetType === project.asset.type && r.workMethod === project.workMethod && (!r.region || r.region === region))
  const byCat: Record<string, UnitCostRate[]> = {}
  for (const r of pool) (byCat[r.categoryId + '|' + r.description.split(',')[0]] ||= []).push(r)
  return Object.values(byCat).map((group) =>
    group
      .slice()
      .sort((a, b) => score(a) - score(b))[0],
  )
  function score(r: UnitCostRate) {
    const d = r.diameterIn ? Math.abs(r.diameterIn - project.asset.diameterIn) : 0
    const t = r.terrain && r.terrain !== project.location.terrain ? 10 : 0
    const g = r.region === region ? -0.5 : 0 // a region row beats the equivalent base row
    return d + t + g
  }
}

/** Unit cost of a rate row in a region: a region-specific row prices as is; a base row is scaled by the region factor. */
export function regionalUnitCost(r: UnitCostRate, opts: RatePricing = {}): { unitCost: number; factor: number; regional: boolean } {
  if (r.region) return { unitCost: r.p50, factor: 1, regional: true }
  const f = opts.region && opts.regionFactors ? opts.regionFactors[opts.region] ?? 1 : 1
  return { unitCost: Math.round(r.p50 * f * 100) / 100, factor: f, regional: false }
}

/** Scope quantities the rate-table estimate prices from (filled from the scope statement's quantity types). */
export interface ScopeQty { lengthFt: number; sites: number; hp?: number; tieIns?: number; services?: number }

/**
 * Class 5 rate-table build (ES-01): one line per rate row; quantity from the scope (feet, sites, each) or 1 lump sum.
 * Without `opts` it prices at base rates (no region factor), as the original parametric build did.
 */
export function parametricLines(project: Project, rates: UnitCostRate[], opts?: RatePricing, q?: ScopeQty): EstimateLine[] {
  const len = q?.lengthFt ?? project.asset.lengthFt
  const ea = q ? (project.asset.type === 'valve-site' ? q.sites : q.tieIns ?? q.sites) : project.scope.quantities.find((x) => x.unit === 'ea')?.qty ?? 1
  return ratesFor(project, rates, opts).map((r) => ({
    id: uid('ln'),
    categoryId: r.categoryId,
    workPackage: opts ? 'Rate table' : 'Parametric',
    description: r.description,
    qty: r.unit === 'ft' ? len : r.unit === 'mi' ? +(len / 5280).toFixed(2) : r.unit === 'ea' || r.unit === 'site' ? ea || 1 : r.unit === 'hp' ? q?.hp ?? 1 : 1,
    unit: r.unit,
    unitCost: opts ? regionalUnitCost(r, opts).unitCost : r.p50,
    source: 'library' as const,
    rateId: r.id,
    confidence: r.sampleSize >= 8 ? 'medium' as const : 'low' as const,
  }))
}

/** Spread an amount across years between two dates using an S-curve (more spend mid-project). */
export function spreadByYear(total: Money, start: string, end: string): Record<string, Money> {
  const y0 = Number(start.slice(0, 4)), y1 = Math.max(Number(end.slice(0, 4)), y0)
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
  if (years.length === 1) return { [y0]: total }
  const w = years.map((_, i) => Math.sin(((i + 0.5) / years.length) * Math.PI))
  const W = sum(w)
  const out: Record<string, Money> = {}
  let acc = 0
  years.forEach((y, i) => {
    const v = i === years.length - 1 ? total - acc : Math.round((total * w[i]) / W)
    out[y] = v
    acc += v
  })
  return out
}

/**
 * Approve an estimate and (optionally) convert it into a budget version (ES-10).
 * Supersedes the project's previously approved estimate. Mutates the draft.
 */
export function approveEstimate(d: AppState, estimateId: string, approverId: string, budgetKind?: 'planning' | 'control'): BudgetVersion | undefined {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e) return
  for (const o of d.estimates) if (o.projectId === e.projectId && o.status === 'approved' && o.id !== e.id) o.status = 'superseded'
  e.status = 'approved'
  e.approvedAt = nowISO()
  e.approvedById = approverId
  if (!budgetKind) return
  return createBudgetFromEstimate(d, e, budgetKind)
}

export function createBudgetFromEstimate(d: AppState, e: Estimate, kind: 'planning' | 'control'): BudgetVersion {
  const p = d.projects.find((x) => x.id === e.projectId)!
  const t = estimateTotals(e)
  const end = p.milestones.find((m) => /in.service/i.test(m.name))?.forecast ?? d.settings.asOf
  const b: BudgetVersion = {
    id: uid('bud'),
    projectId: e.projectId,
    kind,
    estimateId: e.id,
    createdAt: d.settings.asOf,
    byCategory: t.byCategory,
    contingency: t.contingency,
    total: t.total,
    byYear: spreadByYear(t.total, d.settings.asOf, end),
    postedToErp: true,
  }
  d.budgets.push(b)
  return b
}

/** Line-level benchmark flag (ES-12): % off the rate-table median for its rate (in the estimate's region when given). */
export function benchmark(line: EstimateLine, rates: UnitCostRate[], opts?: RatePricing): { pct: number; flag: boolean; ref: number } | null {
  if (!line.rateId) return null
  const r = rates.find((x) => x.id === line.rateId)
  if (!r || !r.p50) return null
  const ref = opts ? regionalUnitCost(r, opts).unitCost : r.p50
  const pct = (line.unitCost - ref) / ref
  return { pct, flag: Math.abs(pct) > 0.25, ref }
}

/** Waterfall bridge between two estimates by category (ES-11). */
export function estimateBridge(a: Estimate, b: Estimate) {
  const ta = estimateTotals(a), tb = estimateTotals(b)
  const cats = Array.from(new Set([...Object.keys(ta.byCategory), ...Object.keys(tb.byCategory)]))
  const steps = cats.map((c) => ({ categoryId: c, delta: (tb.byCategory[c] || 0) - (ta.byCategory[c] || 0) })).filter((s) => s.delta !== 0)
  steps.push({ categoryId: CONT_CAT, delta: tb.contingency - ta.contingency })
  return { from: ta.total, to: tb.total, steps: steps.filter((s) => s.delta !== 0) }
}
