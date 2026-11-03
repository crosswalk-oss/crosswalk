// Class 5 factor model (ES-21). A versioned model the estimating team maintains and publishes:
//   direct = base $/unit × qty × (qty / refQty)^(scale − 1) × Π(1 + weight × (multiplier − 1)) × region × escalation
// then sales tax, loaders and contingency from the estimating tables. Every factor binds to a physical, legal or
// logistical driver (AGENT_RULES 13–14); every estimate itemizes the $ effect of each driver (rule 15).
// Uncertainty is lognormal: base-rate cv plus the cv of each driver that is off its baseline level.
// Pure: no UI, storage or network.
import type {
  AppState, BacktestProject, BacktestSummary, BasisOfEstimate, DiameterBand, DriverKey, DriverValues, Estimate, EstimateLine, FactorInputs,
  FactorItem, FactorKind, FactorModel, ModelBaseRate, ModelFactor, Money, Project, PublishGate, SiteDrivers, WorkMethod,
} from '../types'
import { money, nowISO, rng, sum, uid } from '../util'
import { estimateTotals, parametricLines, type EstimateTotals } from './estimates'
import { basisYearOf, contingencyForClass, currentLoaders, escalationPctFor, pricingFor, salesTaxFor, scopeQuantities, spendMidpoint } from './estimatingAdmin'
import { DIAMETER_BANDS, QUICK_CATALOG, UNIT_LABEL, escalationFactor, inputsFromProject, regionFactor } from './quick'

// ───────────────────────────── Drivers a factor may bind to
/** The ONLY values a factor can read. Community demographics and wealth are not here and cannot be added as drivers. */
export const DRIVER_KEYS: DriverKey[] = ['soil', 'crossings', 'terrain', 'permitComplexity', 'hca', 'classLocation', 'traffic', 'workHours', 'remoteness']

export interface DriverInfo { label: string; kind: FactorKind; baseline: string; levels: { value: string; label: string }[]; help: string }
// VERIFY: baseline levels (multiplier 1) are assumed to describe the typical historical project behind the base rates.
// The baseline level of each driver is the typical project in the historical population behind the base rates
// (suburban, a crossing or two, HCA, moderate traffic); it carries multiplier 1.
export const DRIVER_INFO: Record<DriverKey, DriverInfo> = {
  soil: { label: 'Soil / rock', kind: 'physical', baseline: 'normal', help: 'Excavation and drilling conditions along the alignment or at the site', levels: [{ value: 'normal', label: 'Normal soil' }, { value: 'cobble', label: 'Cobble / caliche' }, { value: 'rock', label: 'Rock' }] },
  crossings: { label: 'Road, rail & water crossings', kind: 'physical', baseline: '1-2', help: 'Count of bored or drilled crossings', levels: [{ value: '0', label: 'None' }, { value: '1-2', label: '1–2' }, { value: '3-5', label: '3–5' }, { value: '6+', label: '6 or more' }] },
  terrain: { label: 'Setting', kind: 'physical', baseline: 'suburban', help: 'Urban, suburban or rural work area (restoration, congestion, substructures)', levels: [{ value: 'urban', label: 'Urban' }, { value: 'suburban', label: 'Suburban' }, { value: 'rural', label: 'Rural' }] },
  permitComplexity: { label: 'Permit complexity', kind: 'legal', baseline: 'ministerial', help: 'Ministerial (over-the-counter), discretionary (agency review) or major (CEQA document, multiple agencies)', levels: [{ value: 'ministerial', label: 'Ministerial' }, { value: 'discretionary', label: 'Discretionary' }, { value: 'major', label: 'Major' }] },
  hca: { label: 'High consequence area', kind: 'legal', baseline: 'yes', help: 'Integrity-management requirements for pipe in an HCA', levels: [{ value: 'no', label: 'Not HCA' }, { value: 'yes', label: 'HCA' }] },
  classLocation: { label: 'Class location', kind: 'legal', baseline: '2', help: 'Design class location (wall thickness, valve spacing, testing)', levels: [{ value: '1', label: 'Class 1' }, { value: '2', label: 'Class 2' }, { value: '3', label: 'Class 3' }, { value: '4', label: 'Class 4' }] },
  traffic: { label: 'Traffic', kind: 'logistical', baseline: 'moderate', help: 'Traffic control effort and lane-closure limits', levels: [{ value: 'low', label: 'Low' }, { value: 'moderate', label: 'Moderate' }, { value: 'heavy', label: 'Heavy' }] },
  workHours: { label: 'Work-hour restrictions', kind: 'logistical', baseline: 'standard', help: 'Standard day shift, restricted hours, or night work', levels: [{ value: 'standard', label: 'Standard' }, { value: 'restricted', label: 'Restricted hours' }, { value: 'night', label: 'Night work' }] },
  remoteness: { label: 'Remoteness / access', kind: 'logistical', baseline: 'local', help: 'Haul distance, crew travel and site access', levels: [{ value: 'local', label: 'Local' }, { value: 'regional', label: 'Regional' }, { value: 'remote', label: 'Remote' }] },
}

/** The level a driver value falls in (crossings are banded; booleans are yes/no). */
export function levelOf(v: DriverValues, k: DriverKey): string {
  const x = v[k]
  if (k === 'crossings') { const n = Math.max(0, Math.round(Number(x) || 0)); return n === 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : '6+' }
  if (typeof x === 'boolean') return x ? 'yes' : 'no'
  return String(x)
}
export const levelLabel = (k: DriverKey, value: string) => DRIVER_INFO[k].levels.find((l) => l.value === value)?.label ?? value

export const driverValues = (i: Pick<FactorInputs, 'site' | 'terrain'>): DriverValues => ({ ...i.site, terrain: i.terrain })

/** Driver values used when a project has none recorded: everything at its baseline except what the location record says. */
export function siteOf(p: Pick<Project, 'drivers' | 'location'>): SiteDrivers {
  const d = p.drivers ?? { soil: 'normal', permitComplexity: 'ministerial', traffic: p.location.terrain === 'urban' ? 'heavy' : p.location.terrain === 'suburban' ? 'moderate' : 'low', workHours: 'standard', crossings: 0, remoteness: p.location.terrain === 'rural' ? 'regional' : 'local' }
  // Only the physical/legal fields of the location record are read here.
  return { soil: d.soil, permitComplexity: d.permitComplexity, traffic: d.traffic, workHours: d.workHours, crossings: d.crossings, remoteness: d.remoteness, classLocation: p.location.classLocation, hca: p.location.hca }
}

/** Factor-model inputs pre-filled from a project's scope, location and drivers. */
export function factorInputsFromProject(s: AppState, p: Project): FactorInputs {
  return { ...inputsFromProject(s, p), site: siteOf(p), taxPct: salesTaxFor(s, p).pct }
}

/** Sales tax % for a region when there is no project yet: the county of a project in that region, else 0. */
export function taxForDistrict(s: Pick<AppState, 'projects' | 'settings'>, district: string): number {
  const p = s.projects.find((x) => x.location.district === district)
  return p ? salesTaxFor(s, p).pct : 0
}

// ───────────────────────────── Models
export const publishedModel = (s: Pick<AppState, 'factorModels'>): FactorModel | undefined => s.factorModels.find((m) => m.status === 'published')
/** The open draft (being edited or in review), if any. */
export const openDraft = (s: Pick<AppState, 'factorModels'>): FactorModel | undefined => s.factorModels.find((m) => m.status === 'draft' || m.status === 'in-review')
export const modelsByVersion = (s: Pick<AppState, 'factorModels'>) => s.factorModels.slice().sort((a, b) => b.version - a.version)

export const factorApplies = (f: Pick<ModelFactor, 'appliesTo'>, asset: string) => !f.appliesTo?.length || f.appliesTo.includes(asset as never)
// VERIFY: weight blends a factor toward neutral: effective = 1 + weight × (multiplier − 1).
export const effectiveMultiplier = (f: Pick<ModelFactor, 'weight'>, m: number) => 1 + Math.max(0, Math.min(1, f.weight)) * (m - 1)

/** Base rate for the inputs: exact band, the row kept for all diameters, else the nearest band. */
export function baseRateFor(model: Pick<FactorModel, 'baseRates'>, i: { assetType: string; workMethod: WorkMethod; diameterBand: DiameterBand }): { rate?: ModelBaseRate; match: 'exact' | 'nearest-band' | 'none' } {
  const pool = model.baseRates.filter((r) => r.assetType === i.assetType && r.workMethod === i.workMethod)
  const banded = QUICK_CATALOG.find((c) => c.asset === i.assetType)?.banded
  const band = banded ? i.diameterBand : 'n/a'
  const exact = pool.find((r) => r.diameterBand === band) ?? pool.find((r) => r.diameterBand === 'n/a')
  if (exact) return { rate: exact, match: 'exact' }
  const order = DIAMETER_BANDS.map((b) => b.id)
  const near = pool.slice().sort((a, b) => Math.abs(order.indexOf(a.diameterBand) - order.indexOf(band)) - Math.abs(order.indexOf(b.diameterBand) - order.indexOf(band)))[0]
  return near ? { rate: near, match: 'nearest-band' } : { match: 'none' }
}

/** Escalation between two years using the portfolio table; de-escalates when `to` is before `from`. */
export const escalationBetween = (s: Pick<AppState, 'settings'>, from: number, to: number) => (to >= from ? escalationFactor(s as AppState, from, to) : 1 / escalationFactor(s as AppState, to, from))

const Z90 = 1.2816 // standard normal quantile for P90
const sigmaOf = (cv: number) => Math.sqrt(Math.log(1 + Math.max(0, cv) ** 2))

// ───────────────────────────── Pricing
export interface FactorApplied { factor: ModelFactor; level: string; levelLabel: string; multiplier: number; effective: number; sigma: number }
export interface UncertaintyPart { id: string; label: string; sigma: number }

export interface FactorResult {
  base?: ModelBaseRate
  match: ReturnType<typeof baseRateFor>['match']
  baseline: Money // base rate × quantity
  scale: number // size multiplier (qty / refQty)^(scale − 1)
  factors: FactorApplied[]
  factorProduct: number
  regionFactor: number
  escalationFactor: number
  adjust: number // estimator adjustment multiplier (incl. a percentile basis)
  direct: Money
  tax: Money
  loaders: Money
  loaderPct: number
  contingencyPct: number
  contingency: Money
  cost: Money // direct + tax + loaders (what the work is expected to cost, before contingency)
  total: Money
  items: FactorItem[]
  parts: UncertaintyPart[]
  sigma: number
  p10: Money // total
  p50: Money
  p90: Money
  costP10: Money // excluding contingency (used by the backtest)
  costP90: Money
  perUnit: number
  lines: EstimateLine[]
  salesTax: NonNullable<Estimate['salesTax']>
}

/** One lump-sum line per category of the base rate's cost mix (the residual goes to the last line). */
export function mixLines(mix: Record<string, number>, direct: Money, label = 'Class 5 factor model'): EstimateLine[] {
  const entries = Object.entries(mix).filter(([, v]) => v > 0)
  const W = sum(entries.map(([, v]) => v)) || 1
  let acc = 0
  return entries.map(([cat, v], k) => {
    const amt = k === entries.length - 1 ? direct - acc : Math.round((direct * v) / W)
    acc += amt
    return { id: uid('el'), categoryId: cat, workPackage: label, description: `Factor model ${Math.round((v / W) * 100)}% share`, qty: 1, unit: 'LS', unitCost: amt, source: 'analog' as const, confidence: 'low' as const }
  })
}

export interface PriceOpts { adjustPct?: number; basis?: 'p10' | 'p50' | 'p90'; salesTax?: Estimate['salesTax'] }

/** Price inputs with a model. Pure. */
export function priceFactor(s: AppState, model: FactorModel, i: FactorInputs, o: PriceOpts = {}): FactorResult {
  const { rate: base, match } = baseRateFor(model, i)
  const dv = driverValues(i)
  const qty = Math.max(0, i.qty)
  const baseline = (base?.rate ?? 0) * qty
  // VERIFY: size scale around the reference quantity: cost ∝ qty^scale, i.e. per-unit cost × (qty / refQty)^(scale − 1).
  const scale = base && qty > 0 && base.refQty > 0 ? Math.pow(qty / base.refQty, model.scaleExponent - 1) : 1
  // Only allowlisted drivers are ever read: a factor bound to anything else is ignored (and fails validation).
  const factors: FactorApplied[] = model.factors.filter((f) => DRIVER_KEYS.includes(f.driver) && factorApplies(f, i.assetType)).map((f) => {
    const level = levelOf(dv, f.driver)
    const m = f.levels.find((l) => l.value === level)?.multiplier ?? 1
    const effective = effectiveMultiplier(f, m)
    // VERIFY: a driver adds uncertainty only when it is off its baseline level; its cv is scaled by the weight.
    const sigma = Math.abs(effective - 1) > 1e-9 ? sigmaOf(Math.max(0, Math.min(1, f.weight)) * f.cv) : 0
    return { factor: f, level, levelLabel: levelLabel(f.driver, level), multiplier: m, effective, sigma }
  })
  const factorProduct = factors.reduce((a, f) => a * f.effective, 1)
  const rf = regionFactor(s, i.district)
  const ef = base ? escalationBetween(s, base.baseYear, i.midpointYear) : 1
  const parts: UncertaintyPart[] = [{ id: 'base', label: 'Base rate', sigma: sigmaOf(model.baseCv) }, ...factors.filter((f) => f.sigma > 0).map((f) => ({ id: f.factor.id, label: `${f.factor.name}: ${f.levelLabel}`, sigma: f.sigma }))]
  // VERIFY: combined uncertainty is lognormal with independent components: σ² = Σ ln(1 + cv²).
  const sigma = Math.sqrt(sum(parts.map((p) => p.sigma ** 2)))
  const z = o.basis === 'p90' ? Z90 : o.basis === 'p10' ? -Z90 : 0
  const adjust = (1 + (o.adjustPct ?? 0) / 100) * Math.exp(z * sigma)
  // VERIFY: direct = base rate × qty × size scale × Π factors × region × escalation × estimator adjustment.
  const directRaw = baseline * scale * factorProduct * rf * ef * adjust
  const direct = Math.round(directRaw)
  const lines = base ? mixLines(base.mix, direct) : []
  const salesTax = o.salesTax ? { ...o.salesTax, pct: o.salesTax.pct } : { pct: i.taxPct, counties: [], categoryIds: [...s.settings.estimating.taxableCategoryIds] }
  const loaders = currentLoaders(s)
  const cp = contingencyForClass(s, 5)
  const t = estimateTotals({ lines, loaders, escalationPct: 0, contingency: { method: 'deterministic', pct: cp }, cls: 5, salesTax })
  const cost = t.base
  const spread = (v: number, k: number) => Math.round(v * Math.exp(k * Z90 * sigma))

  // VERIFY: driver $ attribution = baseline × ln(multiplier) × (G − 1) / ln G (logarithmic-mean decomposition).
  // Itemized drivers: each multiplicative step's share of (direct − baseline), by the logarithmic mean so the
  // shares add up exactly and do not depend on the order the factors are applied in.
  const steps: { item: Omit<FactorItem, 'effect'>; g: number }[] = [
    { item: { id: 'scale', label: 'Size scale', kind: 'size', level: base ? `${qty.toLocaleString('en-US')} vs ${base.refQty.toLocaleString('en-US')} ${base.unit} reference` : '—', multiplier: scale }, g: scale },
    ...factors.map((f) => ({ item: { id: f.factor.id, label: f.factor.name, kind: f.factor.kind, level: f.levelLabel, multiplier: f.effective, weight: f.factor.weight }, g: f.effective })),
    { item: { id: 'region', label: 'Region factor', kind: 'region', level: i.district, multiplier: rf }, g: rf },
    { item: { id: 'escalation', label: 'Escalation', kind: 'escalation', level: base ? `${base.baseYear} → ${i.midpointYear}` : '—', multiplier: ef }, g: ef },
  ]
  if (Math.abs(adjust - 1) > 1e-9) steps.push({ item: { id: 'adjustment', label: 'Estimator adjustment', kind: 'adjustment', level: `${(o.adjustPct ?? 0) >= 0 ? '+' : ''}${o.adjustPct ?? 0}%${o.basis && o.basis !== 'p50' ? ` at ${o.basis.toUpperCase()}` : ''}`, multiplier: adjust }, g: adjust })
  const G = steps.reduce((a, x) => a * x.g, 1)
  const lnG = Math.log(G || 1)
  const L = Math.abs(lnG) > 1e-12 ? (G - 1) / lnG : 1
  const items: FactorItem[] = steps.map((x) => ({ ...x.item, effect: x.g > 0 ? Math.round(baseline * Math.log(x.g) * L) : 0 }))
  const residual = direct - Math.round(baseline) - sum(items.map((x) => x.effect))
  if (residual && items.length) { const k = items.reduce((bi, x, idx) => (Math.abs(x.effect) > Math.abs(items[bi].effect) ? idx : bi), 0); items[k] = { ...items[k], effect: items[k].effect + residual } }

  return {
    base, match, baseline: Math.round(baseline), scale, factors, factorProduct, regionFactor: rf, escalationFactor: ef, adjust,
    direct, tax: t.tax, loaders: t.loaders, loaderPct: sum(loaders.map((l) => l.pct)), contingencyPct: cp, contingency: t.contingency, cost, total: t.total,
    items, parts, sigma, p10: spread(t.total, -1), p50: t.total, p90: spread(t.total, 1), costP10: spread(cost, -1), costP90: spread(cost, 1),
    perUnit: qty ? t.total / qty : 0, lines, salesTax,
  }
}

/** The Class 5 rate-table (parametric) estimate for the same project, priced on today's tables. */
export function rateTableEstimate(s: AppState, p: Project): EstimateTotals | undefined {
  const lines = parametricLines(p, s.rates, pricingFor(s, p), scopeQuantities(s, p))
  if (!lines.length) return
  return estimateTotals({ lines, loaders: currentLoaders(s), escalationPct: escalationPctFor(s, basisYearOf(s, lines), spendMidpoint(s, p)), contingency: { method: 'deterministic', pct: contingencyForClass(s, 5) }, cls: 5, salesTax: salesTaxFor(s, p) })
}

// ───────────────────────────── Backtest
export interface BacktestPoint { id: string; code: string; name: string; assetType: string; predicted: Money; actual: Money; p10: Money; p90: Money; err: number; ape: number; inside: boolean }
export interface BacktestGroup { assetType: string; n: number; mape: number; bias: number; coverage: number }
export interface BacktestResult { n: number; mape: number; medianApe: number; bias: number; coverage: number; points: BacktestPoint[]; byAsset: BacktestGroup[] }

export const inputsOfRecord = (r: BacktestProject): FactorInputs => {
  const { terrain, ...site } = r.drivers
  return { assetType: r.assetType, workMethod: r.workMethod, diameterBand: r.diameterBand, terrain, district: r.district, qty: r.qty, unit: r.unit, midpointYear: r.midpointYear, site, taxPct: r.taxPct }
}

const median = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0 }
const r1 = (n: number) => Math.round(n * 10) / 10
function stats(ps: BacktestPoint[]) {
  return { mape: r1(100 * sum(ps.map((p) => p.ape)) / (ps.length || 1)), bias: r1(100 * sum(ps.map((p) => p.err)) / (ps.length || 1)), coverage: r1(100 * ps.filter((p) => p.inside).length / (ps.length || 1)) }
}

/**
 * Predict every closed project in the backtest set and compare with its actual cost.
 * VERIFY: compares the model's expected cost (direct + sales tax + loaders, no contingency) with the final actual cost,
 * and its P10–P90 of that cost; contingency is a reserve, not a cost, so it is left out of both sides.
 */
export function backtest(s: AppState, model: FactorModel, records: BacktestProject[] = s.backtestProjects): BacktestResult {
  const points: BacktestPoint[] = []
  for (const rec of records) {
    const r = priceFactor(s, model, inputsOfRecord(rec))
    if (!r.base || !rec.actual) continue
    const err = (r.cost - rec.actual) / rec.actual
    points.push({ id: rec.id, code: rec.code, name: rec.name, assetType: rec.assetType, predicted: r.cost, actual: rec.actual, p10: r.costP10, p90: r.costP90, err, ape: Math.abs(err), inside: rec.actual >= r.costP10 && rec.actual <= r.costP90 })
  }
  const all = stats(points)
  const groups = Array.from(new Set(points.map((p) => p.assetType)))
  return { n: points.length, ...all, medianApe: r1(100 * median(points.map((p) => p.ape))), points, byAsset: groups.map((g) => { const ps = points.filter((p) => p.assetType === g); return { assetType: g, n: ps.length, ...stats(ps) } }) }
}

export const summarize = (bt: BacktestResult, gate: PublishGate): BacktestSummary => ({ at: nowISO(), n: bt.n, mape: bt.mape, medianApe: bt.medianApe, bias: bt.bias, coverage: bt.coverage, passed: gateCheck(bt, gate).ok })

export interface GateCheck { label: string; value: string; limit: string; ok: boolean }
/** The publish gate: accuracy, bias and calibrated range on the backtest. */
export function gateCheck(bt: Pick<BacktestResult, 'n' | 'mape' | 'bias' | 'coverage'>, g: PublishGate): { ok: boolean; checks: GateCheck[]; reasons: string[] } {
  const checks: GateCheck[] = [
    { label: 'Mean absolute % error', value: `${bt.mape.toFixed(1)}%`, limit: `≤ ${g.maxMape}%`, ok: bt.mape <= g.maxMape },
    { label: 'Bias', value: `${bt.bias > 0 ? '+' : ''}${bt.bias.toFixed(1)}%`, limit: `within ±${g.maxAbsBias}%`, ok: Math.abs(bt.bias) <= g.maxAbsBias },
    { label: 'Actuals inside P10–P90', value: `${bt.coverage.toFixed(1)}%`, limit: `${g.minCoverage}–${g.maxCoverage}%`, ok: bt.coverage >= g.minCoverage && bt.coverage <= g.maxCoverage },
    { label: 'Projects backtested', value: String(bt.n), limit: '≥ 20', ok: bt.n >= 20 },
  ]
  const reasons = checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.value} (needs ${c.limit})`)
  return { ok: !reasons.length, checks, reasons }
}

/** Structural checks on a model before it can be submitted. */
export function validateModel(m: FactorModel): string[] {
  const out: string[] = []
  if (!(m.scaleExponent >= 0.5 && m.scaleExponent <= 1.2)) out.push('Scale exponent must be between 0.50 and 1.20')
  if (!(m.baseCv > 0 && m.baseCv < 1.5)) out.push('Base uncertainty (cv) must be between 0 and 1.5')
  for (const b of m.baseRates) if (!(b.rate > 0) || !(b.refQty > 0)) out.push(`Base rate ${rateName(b)} needs a rate and reference quantity above zero`)
  for (const f of m.factors) {
    if (!DRIVER_KEYS.includes(f.driver)) out.push(`${f.name}: driver "${String(f.driver)}" is not a physical, legal or logistical driver`)
    if (!(f.weight >= 0 && f.weight <= 1)) out.push(`${f.name}: weight must be 0–1`)
    if (!(f.cv >= 0 && f.cv < 1)) out.push(`${f.name}: cv must be 0–1`)
    if (f.levels.some((l) => !(l.multiplier > 0))) out.push(`${f.name}: every level needs a multiplier above zero`)
    const info = DRIVER_INFO[f.driver]
    if (info && Math.abs((f.levels.find((l) => l.value === info.baseline)?.multiplier ?? 1) - 1) > 1e-9) out.push(`${f.name}: the baseline level (${levelLabel(f.driver, info.baseline)}) must have multiplier 1.00`)
  }
  return out
}

// ───────────────────────────── Versions, diffs and lifecycle (mutate an immer draft)
const f2 = (n: number) => n.toFixed(2)
const rateName = (b: ModelBaseRate) => `${ASSET_TEXT(b.assetType)} · ${METHOD_TEXT[b.workMethod] ?? b.workMethod}${b.diameterBand !== 'n/a' ? ` · ${DIAMETER_BANDS.find((x) => x.id === b.diameterBand)?.label ?? b.diameterBand}` : ''}`
/** Human-readable differences between two model versions (weights, multipliers, cv, base rates, scale). */
export function diffModels(a: FactorModel, b: FactorModel): string[] {
  const out: string[] = []
  if (a.scaleExponent !== b.scaleExponent) out.push(`Scale exponent ${f2(a.scaleExponent)} → ${f2(b.scaleExponent)}`)
  if (a.baseCv !== b.baseCv) out.push(`Base uncertainty cv ${f2(a.baseCv)} → ${f2(b.baseCv)}`)
  for (const fb of b.factors) {
    const fa = a.factors.find((x) => x.id === fb.id)
    if (!fa) { out.push(`Added factor ${fb.name} (${DRIVER_INFO[fb.driver]?.label ?? fb.driver}, weight ${f2(fb.weight)})`); continue }
    if (fa.weight !== fb.weight) out.push(`${fb.name}: weight ${f2(fa.weight)} → ${f2(fb.weight)}`)
    if (fa.cv !== fb.cv) out.push(`${fb.name}: cv ${f2(fa.cv)} → ${f2(fb.cv)}`)
    for (const lb of fb.levels) {
      const la = fa.levels.find((x) => x.value === lb.value)
      if (la && la.multiplier !== lb.multiplier) out.push(`${fb.name} · ${lb.label}: ×${f2(la.multiplier)} → ×${f2(lb.multiplier)}`)
    }
    if ((fa.appliesTo ?? []).join() !== (fb.appliesTo ?? []).join()) out.push(`${fb.name}: applies to ${(fb.appliesTo ?? ['all assets']).join(', ')}`)
  }
  for (const fa of a.factors) if (!b.factors.some((x) => x.id === fa.id)) out.push(`Removed factor ${fa.name}`)
  for (const rb of b.baseRates) {
    const ra = a.baseRates.find((x) => x.id === rb.id)
    if (!ra) out.push(`Added base rate ${rateName(rb)}`)
    else if (ra.rate !== rb.rate || ra.refQty !== rb.refQty) out.push(`Base rate ${rateName(rb)}: $${Math.round(ra.rate).toLocaleString('en-US')} → $${Math.round(rb.rate).toLocaleString('en-US')}/${rb.unit}${ra.refQty !== rb.refQty ? ` (ref ${ra.refQty} → ${rb.refQty})` : ''}`)
  }
  return out
}

const audit = (d: AppState, m: FactorModel, action: string, summary: string, byId: string) => d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'factor-model', entityId: m.id, action, summary })

/** Start a new draft version from the published model (or a given version). Mutates; returns the draft. */
export function newDraft(d: AppState, byId = d.currentUserId, fromId?: string): FactorModel | undefined {
  if (openDraft(d)) return
  const src = (fromId && d.factorModels.find((m) => m.id === fromId)) || publishedModel(d) || modelsByVersion(d)[0]
  if (!src) return
  const version = Math.max(0, ...d.factorModels.map((m) => m.version)) + 1
  const m: FactorModel = { ...JSON.parse(JSON.stringify(src)), id: uid('fm'), version, status: 'draft', createdById: byId, createdAt: nowISO(), parentVersion: src.version, notes: '', submittedAt: undefined, approvedById: undefined, approvedAt: undefined, retiredAt: undefined, workflowInstanceId: undefined, backtest: undefined }
  d.factorModels.push(m)
  audit(d, m, 'create', `Factor model v${version} drafted from v${src.version}`, byId)
  return m
}

/** Save edits to the open draft. Returns what changed (also written to the audit trail). */
export function saveDraft(d: AppState, edited: FactorModel, byId = d.currentUserId): string[] {
  const m = d.factorModels.find((x) => x.id === edited.id)
  if (!m || m.status !== 'draft') return []
  const changes = diffModels(m, edited)
  const notesChanged = m.notes !== edited.notes
  m.baseRates = JSON.parse(JSON.stringify(edited.baseRates))
  m.factors = JSON.parse(JSON.stringify(edited.factors))
  m.scaleExponent = edited.scaleExponent
  m.baseCv = edited.baseCv
  m.notes = edited.notes
  m.name = edited.name
  m.backtest = undefined
  if (changes.length) audit(d, m, 'update', `Factor model v${m.version} draft: ${changes.join('; ')}`, byId)
  else if (notesChanged) audit(d, m, 'update', `Factor model v${m.version} draft: notes updated`, byId)
  return changes
}

/** Discard the open draft (kept as retired: records are never hard-deleted). */
export function discardDraft(d: AppState, id: string, byId = d.currentUserId) {
  const m = d.factorModels.find((x) => x.id === id)
  if (!m || m.status !== 'draft') return
  m.status = 'retired'
  m.retiredAt = nowISO()
  m.notes = `${m.notes ? m.notes + ' ' : ''}(Discarded draft)`.trim()
  audit(d, m, 'discard', `Factor model v${m.version} draft discarded`, byId)
}

/** Record that a draft passed the gate and went for approval. */
export function markSubmitted(d: AppState, id: string, summary: BacktestSummary, byId = d.currentUserId) {
  const m = d.factorModels.find((x) => x.id === id)
  if (!m) return
  m.status = 'in-review'
  m.submittedAt = nowISO()
  m.backtest = summary
  audit(d, m, 'submit', `Factor model v${m.version} submitted for approval — backtest MAPE ${summary.mape}%, bias ${summary.bias > 0 ? '+' : ''}${summary.bias}%, P10–P90 coverage ${summary.coverage}% (n = ${summary.n})`, byId)
}

/** Approval: publish the model and retire the version it replaces. Called by the workflow completion hook. */
export function publishModel(d: AppState, id: string, approverId: string) {
  const m = d.factorModels.find((x) => x.id === id)
  if (!m) return
  for (const o of d.factorModels) if (o.status === 'published' && o.id !== id) { o.status = 'retired'; o.retiredAt = nowISO(); audit(d, o, 'retire', `Factor model v${o.version} retired — replaced by v${m.version}`, approverId) }
  m.status = 'published'
  m.approvedById = approverId
  m.approvedAt = nowISO()
  audit(d, m, 'publish', `Factor model v${m.version} approved and published`, approverId)
}

/** Returned or rejected in review: back to an editable draft. */
export function returnModel(d: AppState, id: string, byId = 'system') {
  const m = d.factorModels.find((x) => x.id === id)
  if (!m || m.status !== 'in-review') return
  m.status = 'draft'
  audit(d, m, 'return', `Factor model v${m.version} returned to draft`, byId)
}

// ───────────────────────────── Monte Carlo
export interface FactorMonteCarlo {
  iterations: number
  seed: number
  p: { P10: Money; P50: Money; P80: Money; P90: Money }
  mean: Money
  histogram: { x: number; n: number }[]
  scurve: { pct: number; value: Money }[] // cumulative probability → cost
  tornado: { id: string; label: string; low: Money; high: Money; swing: Money; share: number }[]
}

/**
 * Seeded Monte Carlo of a priced estimate: draws the base-rate and each active driver's uncertainty (lognormal,
 * independent) around the point estimate. Pure — the same inputs and seed give the same answer.
 */
export function monteCarloFactor(r: Pick<FactorResult, 'total' | 'parts'>, iterations = 5000, seed = 11): FactorMonteCarlo {
  const R = rng(seed)
  const normal = () => { const u = Math.max(1e-12, R.next()), v = R.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  const xs: number[] = new Array(iterations)
  for (let k = 0; k < iterations; k++) {
    let e = 0
    for (const p of r.parts) e += p.sigma * normal()
    // VERIFY: draws are centred so the point estimate is the median of the distribution.
    xs[k] = r.total * Math.exp(e)
  }
  xs.sort((a, b) => a - b)
  const q = (p: number) => Math.round(xs[Math.min(xs.length - 1, Math.max(0, Math.floor(p * xs.length)))])
  const lo = xs[0], hi = xs[xs.length - 1]
  const bins = 30
  const w = (hi - lo) / bins || 1
  const histogram = Array.from({ length: bins }, (_, k) => ({ x: Math.round(lo + w * (k + 0.5)), n: 0 }))
  for (const x of xs) histogram[Math.min(bins - 1, Math.floor((x - lo) / w))].n++
  const scurve = Array.from({ length: 21 }, (_, k) => ({ pct: k * 5, value: q(Math.min(0.999, Math.max(0.001, k / 20))) }))
  const tot = sum(r.parts.map((p) => p.sigma ** 2)) || 1
  const tornado = r.parts.map((p) => {
    const low = Math.round(r.total * Math.exp(-Z90 * p.sigma)), high = Math.round(r.total * Math.exp(Z90 * p.sigma))
    return { id: p.id, label: p.label, low, high, swing: high - low, share: p.sigma ** 2 / tot }
  }).sort((a, b) => b.swing - a.swing)
  return { iterations, seed, p: { P10: q(0.1), P50: q(0.5), P80: q(0.8), P90: q(0.9) }, mean: Math.round(sum(xs) / (xs.length || 1)), histogram, scurve, tornado }
}

// ───────────────────────────── Basis of estimate text
const ASSET_TEXT = (a: string) => QUICK_CATALOG.find((c) => c.asset === a)?.label ?? a
const METHOD_TEXT: Record<string, string> = { 'replace-open-trench': 'open-trench replacement', 'replace-hdd': 'replacement by horizontal directional drill', hydrotest: 'hydrostatic test', 'valve-automation': 'valve automation', 'station-rebuild': 'station rebuild', 'compressor-replacement': 'compressor replacement', abandon: 'abandonment', 'inline-inspection': 'in-line inspection' }
const rateText = (v: number, u: string) => `$${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(0)}/${u}`

/**
 * Basis of estimate generated from the pricing. Draft wording: an estimator must check it before it is relied on.
 * VERIFY: BOE wording (scope basis, assumptions, exclusions, contingency rationale, class justification).
 */
export function factorBoe(model: Pick<FactorModel, 'version' | 'baseCv' | 'scaleExponent'>, i: FactorInputs, r: FactorResult, rateTable?: Money, adjustment?: { pct: number; reason: string; note?: string; basis?: string }): BasisOfEstimate {
  const b = r.base
  const band = i.diameterBand !== 'n/a' ? `, ${DIAMETER_BANDS.find((x) => x.id === i.diameterBand)?.label ?? i.diameterBand}` : ''
  const off = r.items.filter((x) => x.kind !== 'size' && x.kind !== 'region' && x.kind !== 'escalation' && x.kind !== 'adjustment' && Math.abs(x.multiplier - 1) > 1e-9)
  const assumptions = [
    b ? `Base direct rate ${rateText(b.rate, b.unit)} (${b.baseYear} dollars, ${b.n} closed projects) at a reference quantity of ${b.refQty.toLocaleString('en-US')} ${UNIT_LABEL[b.unit]}; size scale exponent ${model.scaleExponent.toFixed(2)} gives ×${r.scale.toFixed(3)} for ${i.qty.toLocaleString('en-US')} ${UNIT_LABEL[i.unit]}.` : 'No base rate in the model for this asset and method.',
    off.length ? `Cost drivers off their baseline level: ${off.map((x) => `${x.label} (${x.level}) ×${x.multiplier.toFixed(3)}, ${x.effect >= 0 ? '+' : '−'}${money(Math.abs(x.effect))}`).join('; ')}.` : 'All physical, legal and logistical drivers at their baseline levels.',
    `${i.district} regional factor ×${r.regionFactor.toFixed(2)}; escalated ${b?.baseYear ?? '—'} → ${i.midpointYear} spend midpoint ×${r.escalationFactor.toFixed(3)}.`,
    `Sales tax ${r.salesTax.pct}% on taxable material; loaders ${r.loaderPct.toFixed(1)}% at current rates; contingency ${r.contingencyPct}% (Class 5 default).`,
  ]
  if (rateTable) assumptions.push(`Cross-check: the Class 5 rate-table estimate for the same scope is ${money(rateTable)} (${r.total >= rateTable ? '+' : '−'}${Math.abs((r.total / rateTable - 1) * 100).toFixed(0)}% from this estimate's basis).`)
  if (adjustment && (adjustment.pct || (adjustment.basis && adjustment.basis !== 'p50'))) assumptions.push(`Estimator adjustment ${adjustment.pct >= 0 ? '+' : ''}${adjustment.pct}%${adjustment.basis && adjustment.basis !== 'p50' ? `, priced at ${adjustment.basis.toUpperCase()}` : ''}: ${adjustment.reason}${adjustment.note ? ` — ${adjustment.note}` : ''}.`)
  return {
    scopeBasis: `${ASSET_TEXT(i.assetType)}, ${METHOD_TEXT[i.workMethod] ?? i.workMethod}${band}, ${i.qty.toLocaleString('en-US')} ${UNIT_LABEL[i.unit]}, ${i.district} region. Priced with Class 5 factor model v${model.version}.`,
    assumptions,
    exclusions: ['Scope not represented by the model drivers', 'Land acquisition by condemnation', 'Unknown contamination remediation'],
    contingencyRationale: `Class 5 default ${r.contingencyPct}%. Model range P10–P90 ${money(r.p10)}–${money(r.p90)} from base-rate uncertainty (cv ${model.baseCv.toFixed(2)}) and the uncertainty of each driver off its baseline, combined as a lognormal distribution.`,
    classJustification: 'Class 5: need, driver and asset identified; no design. Parametric factor model on physical, legal and logistical cost drivers.',
  }
}

// ───────────────────────────── Quick estimates priced with the model
const salesTaxOf = (d: AppState, p: Project | undefined, i: FactorInputs): NonNullable<Estimate['salesTax']> => {
  const t = p ? salesTaxFor(d, p) : { pct: i.taxPct, counties: [], categoryIds: [...d.settings.estimating.taxableCategoryIds] }
  return { ...t, pct: i.taxPct }
}

/**
 * Create a draft Class 5 quick estimate on a project priced with the published factor model. Mutates the draft; returns
 * the estimate (route it with the class5-review workflow). Undefined when there is no published model or base rate.
 */
export function createFactorEstimate(d: AppState, pid: string, i: FactorInputs, requestNote: string, byId = d.currentUserId, needBy?: string): Estimate | undefined {
  const model = publishedModel(d)
  const p = d.projects.find((x) => x.id === pid)
  if (!model || !p) return
  const r = priceFactor(d, model, i, { salesTax: salesTaxOf(d, p, i) })
  if (!r.base) return
  const rt = rateTableEstimate(d, p)?.total
  const version = Math.max(0, ...d.estimates.filter((e) => e.projectId === pid).map((e) => e.version)) + 1
  const e: Estimate = {
    id: uid('est'), projectId: pid, version, title: 'Class 5 quick estimate', cls: 5, status: 'draft', method: 'quick',
    createdAt: nowISO(), createdById: byId,
    lines: r.lines, maturity: { 'need-defined': true },
    loaders: currentLoaders(d), escalationPct: 0, contingency: { method: 'deterministic', pct: r.contingencyPct }, salesTax: r.salesTax, region: i.district,
    basis: factorBoe(model, i, r, rt),
    quick: { inputs: JSON.parse(JSON.stringify(i)), historicalCostId: r.base.sourceRowId ?? r.base.id, basis: 'p50', baseRate: r.base.rate, regionFactor: r.regionFactor, escalationFactor: r.escalationFactor, direct: r.direct, range: { low: r.p10, high: r.p90 }, requestNote, needBy },
    factor: { modelId: model.id, modelVersion: model.version, baseRateId: r.base.id, baseline: r.baseline, items: r.items, sigma: r.sigma, p10: r.p10, p50: r.p50, p90: r.p90, rateTable: rt },
  }
  d.estimates.push(e)
  d.audit.push({ id: uid('aud'), at: e.createdAt, actorId: byId, entity: 'estimate', entityId: e.id, projectId: pid, action: 'create', summary: `Class 5 quick estimate v${version} priced with factor model v${model.version}: $${(estimateTotals(e).total / 1e6).toFixed(1)}M (P10–P90 $${(r.p10 / 1e6).toFixed(1)}M–$${(r.p90 / 1e6).toFixed(1)}M)` })
  return e
}

/** Price a saved factor estimate again (same model version) with an adjustment, without changing it. */
export function previewFactorAdjust(s: AppState, e: Estimate, pct: number, basis: 'p10' | 'p50' | 'p90' = 'p50'): FactorResult | undefined {
  if (!e.factor || !e.quick) return
  const model = s.factorModels.find((m) => m.id === e.factor!.modelId) ?? publishedModel(s)
  if (!model) return
  return priceFactor(s, model, e.quick.inputs as FactorInputs, { adjustPct: pct, basis, salesTax: e.salesTax })
}

/**
 * Estimating-team adjustment of a factor-model quick estimate: a % and/or a percentile basis, with a reason from the
 * override list (and an optional note). Repriced on the model version it was created with; before/after kept + audit.
 */
export function adjustFactorEstimate(d: AppState, estimateId: string, o: { pct: number; reason: string; note?: string; basis?: 'p10' | 'p50' | 'p90' }, byId = d.currentUserId) {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e?.factor || !e.quick) return
  const basis = o.basis ?? e.quick.basis
  const r = previewFactorAdjust(d, e, o.pct, basis)
  const model = d.factorModels.find((m) => m.id === e.factor!.modelId) ?? publishedModel(d)
  if (!r || !r.base || !model) return
  const before = estimateTotals(e).total
  const reason = o.note?.trim() ? `${o.reason} — ${o.note.trim()}` : o.reason
  e.lines = r.lines
  e.loaders = currentLoaders(d)
  e.contingency = { ...e.contingency, pct: r.contingencyPct }
  const after = estimateTotals(e).total
  const inputs = e.quick.inputs as FactorInputs
  e.basis = factorBoe(model, inputs, r, e.factor.rateTable, { pct: o.pct, reason: o.reason, note: o.note, basis })
  e.factor = { ...e.factor, items: r.items, sigma: r.sigma, p10: r.p10, p50: r.p50, p90: r.p90, adjustment: { pct: o.pct, reason: o.reason, note: o.note?.trim() || undefined, basis } }
  e.quick = { ...e.quick, basis, direct: r.direct, range: { low: r.p10, high: r.p90 }, adjustment: { pct: o.pct, reason, byId, at: nowISO(), fromTotal: before, toTotal: after } }
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'estimate', entityId: e.id, projectId: e.projectId, action: 'adjust', summary: `Estimator adjusted Class 5 quick estimate ${o.pct >= 0 ? '+' : ''}${o.pct}%${basis !== 'p50' ? ` at ${basis.toUpperCase()}` : ''}: $${(before / 1e6).toFixed(2)}M → $${(after / 1e6).toFixed(2)}M — ${reason}` })
}
