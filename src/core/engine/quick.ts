// Class 5 quick estimate: a few dropdowns → a row in the historical cost table → a forward-looking estimate
// (escalated to the spend midpoint, regionally adjusted) with a P10–P90 range. Becomes an ordinary Estimate
// (method 'quick') so it can route for review, be adjusted by the estimating team and convert to a budget.
import type { AppState, DiameterBand, Estimate, EstimateLine, HistoricalCost, HistUnit, Money, Project, QuickEstimate, QuickInputs, WorkMethod, AssetType } from '../types'
import { nowISO, sum, uid } from '../util'
import { estimateTotals } from './estimates'

export const DIAMETER_BANDS: { id: DiameterBand; label: string; min: number; max: number }[] = [
  { id: 'le-8', label: '8" and smaller', min: 0, max: 8 },
  { id: '10-16', label: '10"–16"', min: 9, max: 16 },
  { id: '20-24', label: '20"–24"', min: 17, max: 24 },
  { id: '26-36', label: '26"–36"', min: 25, max: 99 },
  { id: 'n/a', label: 'Not applicable', min: -1, max: -1 },
]
export const bandOf = (dia: number): DiameterBand => DIAMETER_BANDS.find((b) => dia >= b.min && dia <= b.max && b.id !== 'n/a')?.id ?? 'n/a'

export const UNIT_LABEL: Record<HistUnit, string> = { ft: 'feet', site: 'valve sites', hp: 'horsepower', station: 'stations' }

/** Work methods offered per asset type, and the unit the historical table is kept in. */
export const QUICK_CATALOG: { asset: AssetType; label: string; methods: WorkMethod[]; unit: HistUnit; banded: boolean }[] = [
  { asset: 'transmission-pipeline', label: 'Transmission pipeline', methods: ['replace-open-trench', 'replace-hdd', 'hydrotest'], unit: 'ft', banded: true },
  { asset: 'distribution-main', label: 'Distribution main', methods: ['replace-open-trench', 'replace-hdd'], unit: 'ft', banded: true },
  { asset: 'valve-site', label: 'Valve site', methods: ['valve-automation'], unit: 'site', banded: true },
  { asset: 'compressor-station', label: 'Compressor station', methods: ['compressor-replacement', 'station-rebuild'], unit: 'hp', banded: false },
  { asset: 'regulator-station', label: 'Regulator station', methods: ['station-rebuild'], unit: 'station', banded: false },
]
export const unitFor = (asset: AssetType): HistUnit => QUICK_CATALOG.find((c) => c.asset === asset)?.unit ?? 'ft'

/**
 * Best historical row for the inputs: exact asset/method; diameter band exact (or n/a for unbanded);
 * terrain exact, else 'any'. Returns the row and how it matched so the reviewer sees the fallback.
 */
export function findHistorical(s: AppState, i: Pick<QuickInputs, 'assetType' | 'workMethod' | 'diameterBand' | 'terrain'>): { row?: HistoricalCost; match: 'exact' | 'any-terrain' | 'nearest-band' | 'none' } {
  const pool = s.historicalCosts.filter((h) => h.active && h.assetType === i.assetType && h.workMethod === i.workMethod)
  const banded = QUICK_CATALOG.find((c) => c.asset === i.assetType)?.banded
  const band = banded ? i.diameterBand : 'n/a'
  const exact = pool.find((h) => h.diameterBand === band && h.terrain === i.terrain)
  if (exact) return { row: exact, match: 'exact' }
  const any = pool.find((h) => h.diameterBand === band && h.terrain === 'any')
  if (any) return { row: any, match: 'any-terrain' }
  // A row kept without a diameter band covers every diameter (e.g. hydrotest, valve automation): not a band fallback.
  const allDia = pool.find((h) => h.diameterBand === 'n/a' && h.terrain === i.terrain) ?? pool.find((h) => h.diameterBand === 'n/a' && h.terrain === 'any')
  if (allDia) return { row: allDia, match: allDia.terrain === 'any' ? 'any-terrain' : 'exact' }
  const order = DIAMETER_BANDS.map((b) => b.id)
  const near = pool.filter((h) => h.terrain === i.terrain || h.terrain === 'any').sort((a, b) => Math.abs(order.indexOf(a.diameterBand) - order.indexOf(band)) - Math.abs(order.indexOf(b.diameterBand) - order.indexOf(band)))[0]
  return near ? { row: near, match: 'nearest-band' } : { match: 'none' }
}

/** Compound escalation from base year to the spend midpoint using the configured escalation table. */
// VERIFY: escalation compounds the configured annual index year over year from the historical cost year to the estimate year.
export function escalationFactor(s: AppState, fromYear: number, toYear: number): number {
  let f = 1
  for (let y = fromYear + 1; y <= toYear; y++) f *= 1 + (s.settings.escalationByYear[String(y)] ?? s.settings.escalationByYear[String(Math.max(...Object.keys(s.settings.escalationByYear).map(Number)))] ?? 3) / 100
  return f
}

/** Region factor from Estimating administration (falls back to the older quick-estimate copy of the table). */
export const regionFactor = (s: AppState, district: string) => s.settings.estimating?.regionFactors?.[district] ?? s.settings.quickEstimate.regionFactors[district] ?? 1

/** Class 5 contingency: the estimating team's contingency-by-class table, else the quick-estimate default. */
export const quickContingencyPct = (s: AppState) => s.settings.estimating?.contingencyByClass?.['5'] ?? s.settings.quickEstimate.contingencyPct

export const loaderPct = (s: AppState) => {
  const latest = Math.max(...s.settings.loaderRates.map((r) => r.year))
  return s.settings.loaderRates.filter((r) => r.year === latest)
}

export interface QuickResult {
  row?: HistoricalCost
  match: ReturnType<typeof findHistorical>['match']
  baseRate: number
  regionFactor: number
  escalationFactor: number
  direct: Money // base-year rate × qty × region, escalated
  loaders: Money
  contingencyPct: number
  contingency: Money
  total: Money
  low: Money // P10
  high: Money // P90
  perUnit: number // total / qty
}

/** Compute a quick estimate from inputs. Pure. */
export function computeQuick(s: AppState, i: QuickInputs, basis: QuickEstimate['basis'] = 'p50', adjustPct = 0): QuickResult {
  const { row, match } = findHistorical(s, i)
  const rf = regionFactor(s, i.district)
  const ef = row ? escalationFactor(s, row.baseYear, i.midpointYear) : 1
  const lp = sum(loaderPct(s).map((x) => x.pct)) / 100
  const cp = quickContingencyPct(s)
  const at = (rate: number) => {
    const direct = Math.round(rate * i.qty * rf * ef * (1 + adjustPct / 100))
    const loaders = Math.round(direct * lp)
    const contingency = Math.round((direct + loaders) * cp / 100)
    return { direct, loaders, contingency, total: direct + loaders + contingency }
  }
  const mid = at(row?.[basis] ?? 0)
  return { row, match, baseRate: row?.[basis] ?? 0, regionFactor: rf, escalationFactor: ef, direct: mid.direct, loaders: mid.loaders, contingencyPct: cp, contingency: mid.contingency, total: mid.total, low: at(row?.p10 ?? 0).total, high: at(row?.p90 ?? 0).total, perUnit: i.qty ? mid.total / i.qty : 0 }
}

/** Estimate lines from the historical cost mix (one lump-sum line per category). */
export function quickLines(row: HistoricalCost, direct: Money): EstimateLine[] {
  const entries = Object.entries(row.mix).filter(([, v]) => v > 0)
  const W = sum(entries.map(([, v]) => v)) || 1
  let acc = 0
  return entries.map(([cat, v], k) => {
    const amt = k === entries.length - 1 ? direct - acc : Math.round((direct * v) / W)
    acc += amt
    return { id: uid('el'), categoryId: cat, workPackage: 'Class 5 historical', description: `Historical ${Math.round((v / W) * 100)}% share`, qty: 1, unit: 'LS', unitCost: amt, source: 'analog' as const, confidence: 'low' as const }
  })
}

/** Inputs pre-filled from a project. */
export function inputsFromProject(s: AppState, p: Project): QuickInputs {
  const unit = unitFor(p.asset.type)
  const qty = unit === 'ft' ? p.asset.lengthFt : unit === 'hp' ? (p.scope.quantities.find((q) => q.unit === 'hp')?.qty ?? 10000) : unit === 'site' ? (p.scope.quantities.find((q) => /valve/i.test(q.label))?.qty ?? 1) : 1
  const end = p.milestones.find((m) => /in.service/i.test(m.name))?.forecast ?? s.settings.asOf
  const mid = Math.round((Number(s.settings.asOf.slice(0, 4)) + Number(end.slice(0, 4))) / 2)
  return { assetType: p.asset.type, workMethod: p.workMethod, diameterBand: QUICK_CATALOG.find((c) => c.asset === p.asset.type)?.banded ? bandOf(p.asset.diameterIn) : 'n/a', terrain: p.location.terrain, district: p.location.district, qty, unit, midpointYear: Math.max(mid, Number(s.settings.asOf.slice(0, 4))) }
}

/**
 * Create a draft quick estimate on a project. Mutates the draft; returns the estimate.
 * Route it with startWorkflow(d, 'class5-review', 'estimate', e.id, …) to send it to the estimating team.
 */
export function createQuickEstimate(d: AppState, pid: string, i: QuickInputs, requestNote: string, byId = d.currentUserId, needBy?: string): Estimate | undefined {
  const r = computeQuick(d, i)
  if (!r.row) return
  const version = Math.max(0, ...d.estimates.filter((e) => e.projectId === pid).map((e) => e.version)) + 1
  const e: Estimate = {
    id: uid('est'), projectId: pid, version, title: 'Class 5 quick estimate', cls: 5, status: 'draft', method: 'quick',
    createdAt: nowISO(), createdById: byId,
    lines: quickLines(r.row, r.direct),
    maturity: { 'need-defined': true },
    loaders: loaderPct(d).map((x) => ({ name: x.name, pct: x.pct })),
    escalationPct: 0, // already in the escalated historical rate
    contingency: { method: 'deterministic', pct: r.contingencyPct },
    basis: {
      scopeBasis: `${QUICK_CATALOG.find((c) => c.asset === i.assetType)?.label ?? i.assetType}, ${i.qty.toLocaleString('en-US')} ${UNIT_LABEL[i.unit]}, ${i.terrain}, ${i.district}.`,
      assumptions: [
        `Historical direct cost ${fmtRate(r.baseRate, i.unit)} (P50 of ${r.row.n} closed projects, ${r.row.baseYear} dollars)${r.match !== 'exact' ? ` — matched on ${r.match === 'any-terrain' ? 'all terrains' : 'nearest diameter band'}` : ''}.`,
        `Escalated ${r.row.baseYear} → ${i.midpointYear} spend midpoint (×${r.escalationFactor.toFixed(3)}); ${i.district} regional factor ×${r.regionFactor.toFixed(2)}.`,
        `Loaders at current rates; contingency ${r.contingencyPct}% (Class 5 default).`,
      ],
      exclusions: ['Scope not represented in the historical population', 'Land acquisition by condemnation', 'Unknown contamination remediation'],
      contingencyRationale: `Class 5 default ${r.contingencyPct}%. Range shown is P10–P90 of the historical population.`,
      classJustification: 'Class 5: need, driver and asset identified; no design. Parametric from historical cost.',
    },
    quick: { inputs: i, historicalCostId: r.row.id, basis: 'p50', baseRate: r.baseRate, regionFactor: r.regionFactor, escalationFactor: r.escalationFactor, direct: r.direct, range: { low: r.low, high: r.high }, requestNote, needBy },
  }
  d.estimates.push(e)
  d.audit.push({ id: uid('aud'), at: e.createdAt, actorId: byId, entity: 'estimate', entityId: e.id, projectId: pid, action: 'create', summary: `Class 5 quick estimate v${version} drafted from historical costs: $${(estimateTotals(e).total / 1e6).toFixed(1)}M` })
  return e
}

/**
 * Estimating-team adjustment during review: scale by pct and/or switch the percentile basis, with a reason.
 * Lines, totals and range are recomputed; the before/after is kept on the estimate and in the audit trail.
 */
export function adjustQuickEstimate(d: AppState, estimateId: string, o: { pct: number; basis?: QuickEstimate['basis']; reason: string }, byId = d.currentUserId) {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e?.quick) return
  const row = d.historicalCosts.find((h) => h.id === e.quick!.historicalCostId)
  if (!row) return
  const before = estimateTotals(e).total
  const basis = o.basis ?? e.quick.basis
  // Price against the row the request was matched to (even if it has since been deactivated), at current markups.
  const r = computeQuick({ ...d, historicalCosts: [{ ...row, active: true }] } as AppState, e.quick.inputs, basis, o.pct)
  e.lines = quickLines(row, r.direct)
  e.loaders = loaderPct(d).map((x) => ({ name: x.name, pct: x.pct }))
  e.contingency = { ...e.contingency, pct: r.contingencyPct }
  const after = estimateTotals(e).total
  e.quick = { ...e.quick, basis, baseRate: r.baseRate, direct: r.direct, range: { low: r.low, high: r.high }, adjustment: { pct: o.pct, reason: o.reason, byId, at: nowISO(), fromTotal: before, toTotal: after } }
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'estimate', entityId: e.id, projectId: e.projectId, action: 'adjust', summary: `Estimator adjusted Class 5 quick estimate ${o.pct >= 0 ? '+' : ''}${o.pct}%${basis !== 'p50' ? ` at ${basis.toUpperCase()}` : ''}: $${(before / 1e6).toFixed(2)}M → $${(after / 1e6).toFixed(2)}M — ${o.reason}` })
}

const fmtRate = (v: number, u: HistUnit) => `$${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(0)}/${u === 'ft' ? 'ft' : u}`
export { fmtRate as fmtHistRate }

/**
 * Derive historical unit costs from closed projects' final actuals (direct cost in base-year dollars).
 * Used by the "Refresh from closed projects" action in the historical cost table.
 */
export function deriveFromClosed(s: AppState, p: Project): { unit: HistUnit; qty: number; perUnit: number; year: number } | undefined {
  if (p.status !== 'closed') return
  const unit = unitFor(p.asset.type)
  const qty = inputsFromProject(s, p).qty
  const act = sum(s.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.actual))
  if (!qty || !act) return
  const lp = sum(loaderPct(s).map((x) => x.pct)) / 100
  const year = Number((p.dates.inService ?? p.dates.closed ?? s.settings.asOf).slice(0, 4))
  return { unit, qty, perUnit: act / (1 + lp) / qty, year }
}
