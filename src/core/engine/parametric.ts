// Class 5 parametric request: what a PM enters (length, location, a Low/Medium/High rating per risk item, with the
// pipe and work method from the project record) priced automatically from the rate table, plus a seeded Monte Carlo.
//
//   rate-table direct  = Σ rate rows (region row, else base row × region factor) × quantity      (parametricLines)
//   risk allowances    = rate-table direct × most-likely % of each rated risk item                 (one line per item)
//   base               = direct + sales tax + loaders + escalation (rate basis year → spend midpoint)
//   Monte Carlo        = rate-table cost ~ triangular(P10, P50, P90 of the rows); each risk item ~ triangular(min, mode, max) %
//   contingency        = P80 − base (risk-based), so the estimate of record is the P80; range shown is P10–P90
//
// Risk items are physical, legal or logistical conditions only (AGENT_RULES 13–14): never demographic or wealth inputs.
import type { AppState, Estimate, EstimateLine, ParametricInputs, ParametricMonteCarlo, ParametricRecord, Project, RiskItemDef, RiskLevel } from '../types'
import { nowISO, rng, sum, triangular, uid } from '../util'
import { estimateTotals, parametricLines, regionalUnitCost } from './estimates'
import { basisYearOf, currentLoaders, escalationPctFor, salesTaxFor, spendMidpoint } from './estimatingAdmin'
import { siteOf, taxForDistrict } from './factorModel'

export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high']
export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

const lvl = (label: string, min: number, mode: number, max: number) => ({ label, min, mode, max })
/**
 * Default risk items for gas pipeline work. Impacts are triangular % of rate-table direct cost (min, most likely, max).
 * VERIFY: every item, level description and % impact is an illustrative planning value for the fictional utility; the
 * estimating team sets the real table in Estimating → Administration.
 */
export const DEFAULT_RISK_ITEMS: RiskItemDef[] = [
  { id: 'traffic', name: 'Traffic control & lane closures', help: 'How much traffic control the street and agency will require.', levels: { low: lvl('Residential or rural street, flagging only', 0, 0, 2), medium: lvl('Arterial lane closures with a traffic control plan', 2, 5, 9), high: lvl('Major arterial or near a freeway: detours, night closures', 6, 12, 22) } },
  { id: 'permits', name: 'Permitting & agency coordination', help: 'Agencies whose approval the work needs.', levels: { low: lvl('Single city or county encroachment permit', 0, 0, 2), medium: lvl('Several agencies, state highway or railroad', 2, 4, 8), high: lvl('Environmental document, coastal or federal waters permit', 5, 10, 20) } },
  { id: 'soil', name: 'Soil & rock conditions', help: 'What the trench or bore will hit.', levels: { low: lvl('Normal soil', 0, 0, 2), medium: lvl('Cobble or caliche', 2, 5, 9), high: lvl('Rock or hard dig: rock wheel or blasting', 6, 12, 25) } },
  { id: 'crossings', name: 'Road, rail & water crossings', help: 'Bores and drills along the route.', levels: { low: lvl('None, or a single bore', 0, 0, 2), medium: lvl('Two to five bores', 2, 5, 10), high: lvl('Six or more, or a drill under rail or water', 6, 12, 25) } },
  { id: 'utilities', name: 'Existing utility conflicts', help: 'Other underground facilities in the corridor.', levels: { low: lvl('Open corridor', 0, 0, 2), medium: lvl('Some potholing, crossing other utilities', 1, 4, 8), high: lvl('Congested corridor, relocations needed', 5, 10, 20) } },
  { id: 'groundwater', name: 'Groundwater & dewatering', help: 'Water expected in the excavation.', levels: { low: lvl('None expected', 0, 0, 1), medium: lvl('Seasonal or partial dewatering', 1, 3, 6), high: lvl('Continuous dewatering, treat or haul the water', 4, 8, 15) } },
  { id: 'environmental', name: 'Environmental & cultural resources', help: 'Monitoring or protection the site needs.', levels: { low: lvl('None known', 0, 0, 1), medium: lvl('Biological or cultural monitoring', 1, 3, 6), high: lvl('Sensitive habitat, contaminated soil or tribal monitoring', 4, 8, 18) } },
  { id: 'workhours', name: 'Work-hour restrictions', help: 'When crews are allowed to work.', levels: { low: lvl('Standard day shift', 0, 0, 1), medium: lvl('Restricted hours', 2, 4, 7), high: lvl('Night work only', 5, 10, 18) } },
  { id: 'tieins', name: 'Tie-ins & service transfers', help: 'Connections to the live system and customer services.', levels: { low: lvl('Few tie-ins, no customer outages', 0, 0, 2), medium: lvl('Several tie-ins, some service transfers', 1, 3, 6), high: lvl('Complex tie-ins, hot taps, many service transfers', 4, 8, 15) } },
  { id: 'access', name: 'Site access & right-of-way', help: 'Getting crews, equipment and rights to the work.', levels: { low: lvl('Public right-of-way, easy access', 0, 0, 1), medium: lvl('Temporary construction easements', 1, 3, 6), high: lvl('New permanent easements or remote access', 4, 8, 16) } },
  { id: 'restoration', name: 'Paving & restoration', help: 'What the street or site must be restored to.', levels: { low: lvl('Dirt or landscape', 0, 0, 1), medium: lvl('Standard trench paving', 1, 3, 6), high: lvl('Full-lane grind and overlay, concrete, or moratorium street', 3, 7, 14) } },
]

/** Estimate category each risk allowance is booked to. */
const RISK_CATEGORY: Record<string, string> = { traffic: 'cat-traffic', permits: 'cat-permit-fees', environmental: 'cat-env', access: 'cat-land', restoration: 'cat-restore' }
const riskCategory = (id: string) => RISK_CATEGORY[id] ?? 'cat-contract'

export const riskItemsOf = (s: Pick<AppState, 'settings'>): RiskItemDef[] => (s.settings.estimating.riskItems?.length ? s.settings.estimating.riskItems : DEFAULT_RISK_ITEMS)

/** Validation for the administration table. */
export function validateRiskItems(items: RiskItemDef[]): string[] {
  const out: string[] = []
  const ids = new Set<string>()
  for (const it of items) {
    if (!it.id || ids.has(it.id)) out.push(`Duplicate or missing id: "${it.id}"`)
    ids.add(it.id)
    if (!it.name.trim()) out.push(`${it.id}: name is required`)
    for (const k of RISK_LEVELS) {
      const l = it.levels[k]
      if (!(l.min <= l.mode && l.mode <= l.max)) out.push(`${it.name}, ${RISK_LEVEL_LABEL[k]}: needs min ≤ most likely ≤ max`)
      if (l.min < -50 || l.max > 200) out.push(`${it.name}, ${RISK_LEVEL_LABEL[k]}: impact outside −50% to +200%`)
    }
    if (/\bdac\b|disadvantag|income|wealth|race|ethnic|demograph|home.?value|zip/i.test(`${it.id} ${it.name} ${it.help}`)) out.push(`${it.name}: risk items must be physical, legal or logistical conditions`)
  }
  return out
}

// ───────────────────────────── Inputs from a project
const fromDriver = <T extends string>(v: T | undefined, map: Partial<Record<T, RiskLevel>>): RiskLevel => (v && map[v]) || 'low'

/** Risk levels pre-filled from the project's cost drivers (physical, legal and logistical fields only). */
export function risksFromProject(s: Pick<AppState, 'settings'>, p?: Project): Record<string, RiskLevel> {
  const out: Record<string, RiskLevel> = Object.fromEntries(riskItemsOf(s).map((r) => [r.id, 'low' as RiskLevel]))
  if (!p) return out
  const d = siteOf(p)
  const set = (id: string, v: RiskLevel) => { if (id in out) out[id] = v }
  set('traffic', fromDriver(d.traffic, { moderate: 'medium', heavy: 'high' }))
  set('permits', fromDriver(d.permitComplexity, { discretionary: 'medium', major: 'high' }))
  set('soil', fromDriver(d.soil, { cobble: 'medium', rock: 'high' }))
  set('crossings', d.crossings >= 6 ? 'high' : d.crossings >= 2 ? 'medium' : 'low')
  set('workhours', fromDriver(d.workHours, { restricted: 'medium', night: 'high' }))
  set('access', fromDriver(d.remoteness, { regional: 'medium', remote: 'high' }))
  set('environmental', d.hca ? 'medium' : 'low')
  set('utilities', p.location.terrain === 'urban' ? 'medium' : 'low')
  set('restoration', p.location.terrain === 'urban' ? 'high' : p.location.terrain === 'suburban' ? 'medium' : 'low')
  return out
}

/** A PM's starting inputs for a project (or defaults for a new need). */
export function parametricInputsFromProject(s: AppState, p?: Project): ParametricInputs {
  const y = Number(s.settings.asOf.slice(0, 4))
  return {
    assetType: p?.asset.type ?? 'distribution-main',
    workMethod: p?.workMethod ?? 'replace-open-trench',
    diameterIn: p?.asset.diameterIn ?? 8,
    lengthFt: p?.asset.lengthFt ?? 0,
    region: p?.location.district ?? s.settings.estimating.regions[0] ?? 'East',
    midpointYear: p ? spendMidpoint(s, p) : y + 2,
    risks: risksFromProject(s, p),
  }
}

// ───────────────────────────── Pricing
export interface ParametricOpts { adjustPct?: number; iterations?: number; seed?: number }
export interface ParametricRiskLine { id: string; name: string; level: RiskLevel; levelLabel: string; min: number; mode: number; max: number; amount: number }
export interface ParametricResult {
  inputs: ParametricInputs
  rateLines: EstimateLine[]
  riskLines: EstimateLine[]
  adjustmentLine?: EstimateLine
  lines: EstimateLine[]
  rateDirect: number
  rateSpread: { p10: number; p90: number }
  risks: ParametricRiskLine[]
  riskPct: number
  adjustPct: number
  direct: number // rate-table direct + risk allowances + adjustment
  salesTax: NonNullable<Estimate['salesTax']>
  tax: number
  loaders: { name: string; pct: number }[]
  loaderAmount: number
  escalationPct: number
  escalation: number
  basisYear: number
  base: number // before contingency
  mc: ParametricMonteCarlo
  contingency: number
  contingencyPct: number
  total: number // = base + contingency (≈ P80)
  low: number // P10
  high: number // P90
  perFoot: number
}

/** A project-shaped object the rate-table lookup can price (pipe, method, region, setting). */
function pricingProject(i: ParametricInputs, p?: Project): Project {
  return { asset: { type: i.assetType, diameterIn: i.diameterIn, lengthFt: i.lengthFt }, workMethod: i.workMethod, location: { district: i.region, terrain: p?.location.terrain ?? 'suburban' }, scope: { quantities: [] } } as unknown as Project
}

/** Price a parametric request. Pure. Undefined when the rate table has no rows for this asset and work method. */
export function priceParametric(s: AppState, i: ParametricInputs, p?: Project, o: ParametricOpts = {}): ParametricResult | undefined {
  const opts = { region: i.region, regionFactors: s.settings.estimating.regionFactors }
  const rateLines = parametricLines(pricingProject(i, p), s.rates, opts, { lengthFt: i.lengthFt, sites: 1 }).map((l) => ({ ...l, workPackage: 'Rate table' }))
  if (!rateLines.length || !i.lengthFt) return
  const lineAt = (l: EstimateLine, k: 'p10' | 'p90') => {
    const r = s.rates.find((x) => x.id === l.rateId)
    if (!r) return l.qty * l.unitCost
    return l.qty * r[k] * regionalUnitCost(r, opts).factor
  }
  const rateDirect = Math.round(sum(rateLines.map((l) => l.qty * l.unitCost)))
  const rateSpread = { p10: Math.round(sum(rateLines.map((l) => lineAt(l, 'p10')))), p90: Math.round(sum(rateLines.map((l) => lineAt(l, 'p90')))) }

  const risks: ParametricRiskLine[] = riskItemsOf(s).map((it) => {
    const level = i.risks[it.id] ?? 'low'
    const x = it.levels[level]
    return { id: it.id, name: it.name, level, levelLabel: x.label, min: x.min, mode: x.mode, max: x.max, amount: Math.round(rateDirect * x.mode / 100) }
  })
  const riskLines: EstimateLine[] = risks.filter((r) => r.amount).map((r) => ({
    id: uid('ln'), categoryId: riskCategory(r.id), workPackage: 'Risk allowances', description: `${r.name}: ${RISK_LEVEL_LABEL[r.level].toLowerCase()} allowance (${r.mode}% of rate-table direct)`,
    qty: 1, unit: 'LS', unitCost: r.amount, source: 'judgment' as const, confidence: 'low' as const,
  }))
  const riskPct = sum(risks.map((r) => r.mode))
  const adjustPct = o.adjustPct ?? 0
  const preAdj = rateDirect + sum(riskLines.map((l) => l.unitCost))
  const adjustmentLine: EstimateLine | undefined = adjustPct ? { id: uid('ln'), categoryId: 'cat-contract', workPackage: 'Estimator adjustment', description: `Estimator adjustment ${adjustPct > 0 ? '+' : ''}${adjustPct}% of direct cost`, qty: 1, unit: 'LS', unitCost: Math.round(preAdj * adjustPct / 100), source: 'judgment', confidence: 'low' } : undefined
  const lines = [...rateLines, ...riskLines, ...(adjustmentLine ? [adjustmentLine] : [])]

  const salesTax = p ? salesTaxFor(s, p) : { pct: i.taxPct ?? taxForDistrict(s, i.region), counties: [], categoryIds: [...s.settings.estimating.taxableCategoryIds] }
  const loaders = currentLoaders(s)
  const basisYear = basisYearOf(s, rateLines)
  const escalationPct = escalationPctFor(s, basisYear, i.midpointYear)
  const t = estimateTotals({ lines, loaders, escalationPct, contingency: { method: 'deterministic', pct: 0 }, cls: 5, salesTax })
  const direct = t.lines

  // Everything after direct cost (tax on taxable rows, loaders, escalation) scales with direct cost.
  const markup = direct ? t.base / direct : 1
  const adjF = 1 + adjustPct / 100
  const iterations = o.iterations ?? s.settings.factorModel?.iterations ?? 5000
  const mc = monteCarloParametric({ rateP10: rateSpread.p10, rateP50: rateDirect, rateP90: rateSpread.p90, risks, markup: markup * adjF, rateDirect }, iterations, o.seed ?? 17)
  // VERIFY: risk-based Class 5 contingency = P80 of the Monte Carlo less the deterministic base (never negative), so the
  // estimate of record sits at P80; the range shown is the Monte Carlo P10–P90.
  const contingency = Math.max(0, mc.p.P80 - t.base)
  const contingencyPct = t.base ? Math.round((contingency / t.base) * 1000) / 10 : 0
  const total = estimateTotals({ lines, loaders, escalationPct, contingency: { method: 'risk-based', pct: contingencyPct }, cls: 5, salesTax }).total
  return {
    inputs: i, rateLines, riskLines, adjustmentLine, lines, rateDirect, rateSpread, risks, riskPct, adjustPct, direct,
    salesTax, tax: t.tax, loaders, loaderAmount: t.loaders, escalationPct, escalation: t.escalation, basisYear, base: t.base,
    mc, contingency: total - t.base, contingencyPct, total, low: Math.min(mc.p.P10, total), high: Math.max(mc.p.P90, total), perFoot: i.lengthFt ? total / i.lengthFt : 0,
  }
}

interface McInput { rateP10: number; rateP50: number; rateP90: number; risks: Pick<ParametricRiskLine, 'id' | 'name' | 'min' | 'mode' | 'max' | 'level'>[]; markup: number; rateDirect: number }

/**
 * Seeded Monte Carlo of the parametric estimate. Rate-table cost ~ triangular(P10, P50, P90 of the rows); each risk item
 * at its rated level ~ triangular(min, most likely, max) % of rate-table direct, independent; tax, loaders, escalation
 * and any estimator adjustment scale each draw. Pure: the same inputs and seed give the same answer.
 * VERIFY: independence between risk items and the triangular shapes are modelling assumptions for the estimating team.
 */
export function monteCarloParametric(x: McInput, iterations = 5000, seed = 17): ParametricMonteCarlo {
  const R = rng(seed)
  const lo10 = Math.min(x.rateP10, x.rateP50), hi90 = Math.max(x.rateP90, x.rateP50)
  const active = x.risks.filter((r) => r.max > r.min || r.mode)
  const xs: number[] = new Array(iterations)
  for (let k = 0; k < iterations; k++) {
    const rate = triangular(R.next(), lo10, x.rateP50, hi90)
    let pct = 0
    for (const r of active) pct += triangular(R.next(), r.min, r.mode, r.max)
    xs[k] = (rate + x.rateDirect * pct / 100) * x.markup
  }
  xs.sort((a, b) => a - b)
  const q = (p: number) => Math.round(xs[Math.min(xs.length - 1, Math.max(0, Math.floor(p * xs.length)))])
  const lo = xs[0], hi = xs[xs.length - 1]
  const bins = 30
  const w = (hi - lo) / bins || 1
  const histogram = Array.from({ length: bins }, (_, k) => ({ x: Math.round(lo + w * (k + 0.5)), n: 0 }))
  for (const v of xs) histogram[Math.min(bins - 1, Math.floor((v - lo) / w))].n++
  const scurve = Array.from({ length: 21 }, (_, k) => ({ pct: k * 5, value: q(Math.min(0.999, Math.max(0.001, k / 20))) }))

  // Tornado: each source swung from its low to its high end with everything else at most likely.
  const modeSum = sum(active.map((r) => r.mode))
  const at = (rate: number, pct: number) => Math.round((rate + x.rateDirect * pct / 100) * x.markup)
  const rows = [
    { id: 'rate-table', label: 'Rate-table unit costs (P10–P90 of the rows)', low: at(lo10, modeSum), high: at(hi90, modeSum) },
    ...active.map((r) => ({ id: r.id, label: `${r.name} (${RISK_LEVEL_LABEL[r.level].toLowerCase()})`, low: at(x.rateP50, modeSum - r.mode + r.min), high: at(x.rateP50, modeSum - r.mode + r.max) })),
  ].map((t) => ({ ...t, swing: t.high - t.low }))
  const tot = sum(rows.map((t) => t.swing ** 2)) || 1
  const tornado = rows.map((t) => ({ ...t, share: t.swing ** 2 / tot })).filter((t) => t.swing > 0).sort((a, b) => b.swing - a.swing)
  return { iterations, seed, p: { P10: q(0.1), P50: q(0.5), P80: q(0.8), P90: q(0.9) }, mean: Math.round(sum(xs) / (xs.length || 1)), histogram, scurve, tornado }
}

// ───────────────────────────── Basis of estimate
const money = (n: number) => '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n).toLocaleString('en-US'))

/** Generated basis of estimate. VERIFY: BOE wording for parametric Class 5 requests (scope, assumptions, contingency, class). */
export function parametricBoe(r: ParametricResult, adjustment?: { pct: number; reason: string; changed?: string[] }): Estimate['basis'] {
  const i = r.inputs
  const rated = r.risks.filter((x) => x.level !== 'low')
  const assumptions = [
    `Rate table: ${r.rateLines.length} rate rows for ${i.diameterIn}" ${i.assetType.replace(/-/g, ' ')}, ${i.workMethod.replace(/-/g, ' ')}, ${i.lengthFt.toLocaleString('en-US')} ft in the ${i.region} region (region rows, else base rate × region factor): ${money(r.rateDirect)} direct at P50, ${money(r.rateSpread.p10)}–${money(r.rateSpread.p90)} at the rows' P10–P90.`,
    rated.length ? `Risk allowances (most likely % of rate-table direct): ${rated.map((x) => `${x.name} ${x.level} (${x.mode}%, ${x.min}–${x.max}%)`).join('; ')}. All other items rated low.` : 'Every risk item rated low: no allowances above the rate table.',
    `Sales tax ${r.salesTax.pct}% on taxable material; loaders ${sum(r.loaders.map((l) => l.pct)).toFixed(1)}%; escalation ${r.escalationPct}% from the ${r.basisYear} rate basis to the ${i.midpointYear} spend midpoint.`,
  ]
  if (adjustment && (adjustment.pct || adjustment.changed?.length)) assumptions.push(`Estimator review: ${[adjustment.changed?.length ? `risk ratings changed (${adjustment.changed.join('; ')})` : '', adjustment.pct ? `${adjustment.pct > 0 ? '+' : ''}${adjustment.pct}% adjustment` : ''].filter(Boolean).join(', ')} — ${adjustment.reason}.`)
  return {
    scopeBasis: `${i.lengthFt.toLocaleString('en-US')} ft of ${i.diameterIn}" ${i.assetType.replace(/-/g, ' ')}, ${i.workMethod.replace(/-/g, ' ')}, ${i.region} region. Class 5 parametric estimate from the rate table and the PM's risk ratings.`,
    assumptions,
    exclusions: ['Scope not described by the rate rows or the rated risk items', 'Land acquisition by condemnation', 'Unknown contamination remediation'],
    contingencyRationale: `Risk-based: Monte Carlo of ${r.mc.iterations.toLocaleString('en-US')} seeded draws (rate-table cost triangular on the rows' P10/P50/P90; each risk item triangular on its min/most likely/max, independent). Funded at P80 ${money(r.mc.p.P80)}: contingency ${money(r.contingency)} (${r.contingencyPct}% of base). P10–P90 ${money(r.mc.p.P10)}–${money(r.mc.p.P90)}.`,
    classJustification: 'Class 5: need, location and approximate length known; no design. Parametric from the rate table with rated physical, legal and logistical risks.',
  }
}

// ───────────────────────────── Saved estimates
function record(s: AppState, r: ParametricResult, prev?: ParametricRecord['adjustment']): ParametricRecord {
  return {
    inputs: JSON.parse(JSON.stringify(r.inputs)), rateTableVersion: s.settings.estimating.rateTableVersion, rateDirect: r.rateDirect, rateSpread: r.rateSpread,
    risks: r.risks.map((x) => ({ id: x.id, name: x.name, level: x.level, pct: x.mode, amount: x.amount })), base: r.base,
    mc: { iterations: r.mc.iterations, seed: r.mc.seed, p: r.mc.p, mean: r.mc.mean }, contingencyPct: r.contingencyPct, adjustment: prev,
  }
}

function applyResult(s: AppState, e: Estimate, r: ParametricResult) {
  e.lines = r.lines
  e.loaders = r.loaders
  e.escalationPct = r.escalationPct
  e.contingency = { method: 'risk-based', pct: r.contingencyPct, confidence: 'P80' }
  e.salesTax = r.salesTax
  e.region = r.inputs.region
  e.rateTableVersion = s.settings.estimating.rateTableVersion
}

/** Create a draft Class 5 parametric estimate on a project (route it with class5-review). Mutates the draft. */
export function createParametricEstimate(d: AppState, pid: string, i: ParametricInputs, requestNote: string, byId = d.currentUserId, needBy?: string): Estimate | undefined {
  const p = d.projects.find((x) => x.id === pid)
  if (!p) return
  const r = priceParametric(d, i, p)
  if (!r) return
  const version = Math.max(0, ...d.estimates.filter((e) => e.projectId === pid).map((e) => e.version)) + 1
  const e: Estimate = {
    id: uid('est'), projectId: pid, version, title: 'Class 5 parametric estimate', cls: 5, status: 'draft', method: 'quick',
    createdAt: nowISO(), createdById: byId, lines: [], maturity: { 'need-defined': true }, loaders: [], escalationPct: 0, contingency: { method: 'risk-based', pct: 0 },
    basis: parametricBoe(r),
    quick: { inputs: { assetType: i.assetType, workMethod: i.workMethod, diameterBand: 'n/a', terrain: p.location.terrain, district: i.region, qty: i.lengthFt, unit: 'ft', midpointYear: i.midpointYear }, historicalCostId: '', basis: 'p50', baseRate: i.lengthFt ? r.rateDirect / i.lengthFt : 0, regionFactor: d.settings.estimating.regionFactors[i.region] ?? 1, escalationFactor: 1 + r.escalationPct / 100, direct: r.direct, range: { low: r.low, high: r.high }, requestNote, needBy },
    parametric: record(d, r),
  }
  applyResult(d, e, r)
  d.estimates.push(e)
  d.audit.push({ id: uid('aud'), at: e.createdAt, actorId: byId, entity: 'estimate', entityId: e.id, projectId: pid, action: 'create', summary: `Class 5 parametric estimate v${version}: ${i.lengthFt.toLocaleString('en-US')} ft, ${i.region}, ${r.risks.filter((x) => x.level !== 'low').length} risk items above low — $${(r.total / 1e6).toFixed(2)}M at P80 (P10–P90 $${(r.low / 1e6).toFixed(2)}M–$${(r.high / 1e6).toFixed(2)}M)` })
  return e
}

/** Reprice a saved parametric estimate with new risk ratings and/or an estimator % (preview; no change). */
export function previewParametric(s: AppState, e: Estimate, risks: Record<string, RiskLevel>, adjustPct: number): ParametricResult | undefined {
  if (!e.parametric) return
  const p = s.projects.find((x) => x.id === e.projectId)
  return priceParametric(s, { ...e.parametric.inputs, risks: { ...e.parametric.inputs.risks, ...risks } }, p, { adjustPct })
}

/**
 * Estimating-team review of a parametric estimate: change any risk rating and/or apply a ± % with a reason. Repriced
 * (Monte Carlo included); before/after kept on the record and in the audit trail.
 */
export function adjustParametricEstimate(d: AppState, estimateId: string, o: { risks?: Record<string, RiskLevel>; pct: number; reason: string; note?: string }, byId = d.currentUserId) {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e?.parametric || !e.quick) return
  const prevRisks = e.parametric.inputs.risks
  const risks = { ...prevRisks, ...(o.risks ?? {}) }
  const r = previewParametric(d, e, risks, o.pct)
  if (!r) return
  const names = Object.fromEntries(riskItemsOf(d).map((x) => [x.id, x.name]))
  const changed = Object.keys(risks).filter((k) => risks[k] !== prevRisks[k]).map((k) => `${names[k] ?? k} ${prevRisks[k] ?? 'low'} → ${risks[k]}`)
  const before = estimateTotals(e).total
  applyResult(d, e, r)
  const after = estimateTotals(e).total
  const reason = o.note?.trim() ? `${o.reason} — ${o.note.trim()}` : o.reason
  const adjustment = { pct: o.pct, reason, byId, at: nowISO(), fromTotal: before, toTotal: after, changed }
  e.basis = parametricBoe(r, { pct: o.pct, reason, changed })
  e.parametric = record(d, r, adjustment)
  e.quick = { ...e.quick, direct: r.direct, range: { low: r.low, high: r.high }, adjustment: { pct: o.pct, reason, byId, at: adjustment.at, fromTotal: before, toTotal: after } }
  d.audit.push({ id: uid('aud'), at: adjustment.at, actorId: byId, entity: 'estimate', entityId: e.id, projectId: e.projectId, action: 'adjust', summary: `Estimator adjusted Class 5 parametric estimate${changed.length ? ` (${changed.join('; ')})` : ''} ${o.pct >= 0 ? '+' : ''}${o.pct}%: $${(before / 1e6).toFixed(2)}M → $${(after / 1e6).toFixed(2)}M — ${reason}` })
}
