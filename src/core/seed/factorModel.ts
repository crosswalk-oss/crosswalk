// Seed data for the Class 5 factor model: settings, three model versions (retired, published, draft), cost drivers for
// every demo project, and ~60 fictional closed projects for the backtest. The backtest set is generated from a hidden
// "true" cost process plus noise, so the published model is close but not exact — like a real fit.
// All values are fictional ("Arroyo Valley Gas").
import type { AppState, AssetType, AuditEntry, BacktestProject, DiameterBand, DriverValues, FactorModel, FactorModelSettings, HistoricalCost, HistUnit, ModelBaseRate, ModelFactor, ProjectDrivers, Terrain, WorkMethod } from '../types'
import { inputsOfRecord, priceFactor } from '../engine/factorModel'
import { rng } from '../util'

export const FACTOR_SETTINGS: FactorModelSettings = {
  overrideReasons: [
    'Site condition the drivers do not capture',
    'Scope not represented in the model population',
    'Known market or vendor pricing',
    'Quantity or scope correction from the requester',
    'Constructability review finding',
    'Outage window or schedule constraint',
  ],
  // VERIFY: publish-gate thresholds (MAPE, bias, P10–P90 coverage) are demo defaults set by the estimating lead.
  gate: { maxMape: 25, minCoverage: 70, maxCoverage: 95, maxAbsBias: 10 },
  iterations: 5000,
}

const LINEAR: AssetType[] = ['transmission-pipeline', 'distribution-main']
const L = (value: string, label: string, multiplier: number) => ({ value, label, multiplier })

// VERIFY: default factor multipliers, weights and cv are illustrative planning values for the fictional utility,
// to be replaced by the estimating team's own calibration.
export const DEFAULT_FACTORS: ModelFactor[] = [
  { id: 'f-soil', name: 'Soil / rock', kind: 'physical', driver: 'soil', weight: 1, cv: 0.12, appliesTo: [...LINEAR, 'valve-site'], levels: [L('normal', 'Normal soil', 1), L('cobble', 'Cobble / caliche', 1.15), L('rock', 'Rock', 1.35)], note: 'Excavation, drilling and spoil handling' },
  { id: 'f-cross', name: 'Crossings', kind: 'physical', driver: 'crossings', weight: 1, cv: 0.15, appliesTo: LINEAR, levels: [L('0', 'None', 0.96), L('1-2', '1–2', 1), L('3-5', '3–5', 1.08), L('6+', '6 or more', 1.18)], note: 'Bored or drilled road, rail and water crossings' },
  { id: 'f-setting', name: 'Setting', kind: 'physical', driver: 'terrain', weight: 1, cv: 0.08, appliesTo: LINEAR, levels: [L('urban', 'Urban', 1.22), L('suburban', 'Suburban', 1), L('rural', 'Rural', 0.75)], note: 'Restoration, substructures and congestion' },
  { id: 'f-permit', name: 'Permit complexity', kind: 'legal', driver: 'permitComplexity', weight: 1, cv: 0.15, appliesTo: [...LINEAR, 'valve-site', 'regulator-station'], levels: [L('ministerial', 'Ministerial', 1), L('discretionary', 'Discretionary', 1.08), L('major', 'Major', 1.2)], note: 'Agency review, CEQA documents, conditions of approval. Compressor stations: air permits and CEQA are already in the base rate' },
  { id: 'f-hca', name: 'High consequence area', kind: 'legal', driver: 'hca', weight: 1, cv: 0.05, appliesTo: ['transmission-pipeline', 'valve-site'], levels: [L('no', 'Not HCA', 0.96), L('yes', 'HCA', 1)], note: 'Integrity-management inspection and records' },
  { id: 'f-class', name: 'Class location', kind: 'legal', driver: 'classLocation', weight: 0.6, cv: 0.05, appliesTo: ['transmission-pipeline'], levels: [L('1', 'Class 1', 0.97), L('2', 'Class 2', 1), L('3', 'Class 3', 1.06), L('4', 'Class 4', 1.1)], note: 'Design factor and valve spacing. Weighted below 1: partly captured by setting' },
  { id: 'f-traffic', name: 'Traffic', kind: 'logistical', driver: 'traffic', weight: 0.8, cv: 0.12, appliesTo: [...LINEAR, 'valve-site'], levels: [L('low', 'Low', 0.97), L('moderate', 'Moderate', 1), L('heavy', 'Heavy', 1.08)], note: 'Traffic control and lane-closure limits. Weighted below 1: partly captured by setting' },
  { id: 'f-hours', name: 'Work-hour restrictions', kind: 'logistical', driver: 'workHours', weight: 1, cv: 0.12, appliesTo: [...LINEAR, 'valve-site', 'regulator-station'], levels: [L('standard', 'Standard', 1), L('restricted', 'Restricted hours', 1.08), L('night', 'Night work', 1.2)], note: 'Shortened shifts, night premiums, lighting' },
  { id: 'f-remote', name: 'Remoteness / access', kind: 'logistical', driver: 'remoteness', weight: 1, cv: 0.1, levels: [L('local', 'Local', 1), L('regional', 'Regional', 1.04), L('remote', 'Remote', 1.12)], note: 'Haul, crew travel and per diem' },
]

/** Reference quantity each historical rate was observed at (the representative project size). */
const REF_QTY = (a: AssetType, wm: WorkMethod): number =>
  a === 'transmission-pipeline' ? (wm === 'hydrotest' ? 25_000 : 15_000) : a === 'distribution-main' ? 8_000 : a === 'valve-site' ? 3 : a === 'compressor-station' ? (wm === 'compressor-replacement' ? 22_000 : 9_000) : 1

/** Base rates from the historical cost table: the suburban (or all-settings) P50 for each asset × method × band. */
export function baseRatesFromHistory(hist: HistoricalCost[]): ModelBaseRate[] {
  const groups = new Map<string, HistoricalCost[]>()
  for (const h of hist.filter((x) => x.active)) {
    const k = `${h.assetType}|${h.workMethod}|${h.diameterBand}`
    groups.set(k, [...(groups.get(k) ?? []), h])
  }
  return Array.from(groups.values()).map((rows, k) => {
    const h = rows.find((x) => x.terrain === 'suburban') ?? rows.find((x) => x.terrain === 'any') ?? rows[0]
    return { id: `br-${k + 1}`, assetType: h.assetType, workMethod: h.workMethod, diameterBand: h.diameterBand, unit: h.unit, rate: h.p50, refQty: REF_QTY(h.assetType, h.workMethod), baseYear: h.baseYear, n: rows.reduce((a, x) => a + x.n, 0), mix: { ...h.mix }, sourceRowId: h.id }
  })
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const setMult = (fs: ModelFactor[], id: string, value: string, m: number) => { const l = fs.find((f) => f.id === id)?.levels.find((x) => x.value === value); if (l) l.multiplier = m }
const setWeight = (fs: ModelFactor[], id: string, w: number) => { const f = fs.find((x) => x.id === id); if (f) f.weight = w }

/** v1 (retired), v2 (published, the model of record), v3 (an estimator's draft refit). */
export function buildFactorModels(hist: HistoricalCost[]): FactorModel[] {
  const base = baseRatesFromHistory(hist)
  const f1 = clone(DEFAULT_FACTORS).filter((f) => f.id !== 'f-class')
  setWeight(f1, 'f-cross', 0.5); setWeight(f1, 'f-traffic', 1); setMult(f1, 'f-soil', 'rock', 1.25)
  const b3 = clone(base)
  for (const r of b3) if (r.assetType === 'transmission-pipeline' && r.workMethod === 'replace-open-trench') r.rate = Math.round(r.rate * 0.95)
  const f3 = clone(DEFAULT_FACTORS)
  setMult(f3, 'f-soil', 'rock', 1.42); setMult(f3, 'f-soil', 'cobble', 1.17); setWeight(f3, 'f-traffic', 0.9); setMult(f3, 'f-cross', '6+', 1.21)
  return [
    { id: 'fm-1', name: 'Class 5 factor model', version: 1, status: 'retired', baseRates: clone(base), scaleExponent: 1, baseCv: 0.3, factors: f1, notes: 'First model: linear in quantity, crossings at half weight.', createdById: 'u-est1', createdAt: '2025-02-03T17:00:00.000Z', approvedById: 'u-estl', approvedAt: '2025-02-20T17:00:00.000Z', retiredAt: '2026-03-16T17:00:00.000Z', backtest: { at: '2025-02-10T17:00:00.000Z', n: 44, mape: 24.1, medianApe: 19.8, bias: 6.2, coverage: 88.6, passed: true } },
    { id: 'fm-2', name: 'Class 5 factor model', version: 2, status: 'published', baseRates: clone(base), scaleExponent: 0.92, baseCv: 0.15, factors: clone(DEFAULT_FACTORS), notes: 'Size scale fitted (0.92); class location added at 0.6 weight; traffic reduced to 0.8 weight where setting already explains it.', createdById: 'u-est1', createdAt: '2026-02-24T17:00:00.000Z', parentVersion: 1, submittedAt: '2026-03-02T17:00:00.000Z', approvedById: 'u-estl', approvedAt: '2026-03-16T17:00:00.000Z' },
    { id: 'fm-3', name: 'Class 5 factor model', version: 3, status: 'draft', baseRates: b3, scaleExponent: 0.9, baseCv: 0.15, factors: f3, notes: 'Refit after the 2026 closeouts: rock and cobble up, open-trench base rates down 5%, size scale 0.92 → 0.90, traffic weight back to 0.9.', createdById: 'u-est2', createdAt: '2026-10-19T17:00:00.000Z', parentVersion: 2 },
  ]
}

/** Audit history for the seeded versions (append-only log). */
export function factorModelAudit(models: FactorModel[]): AuditEntry[] {
  const a = (at: string, actorId: string, entityId: string, action: string, summary: string, k: number): AuditEntry => ({ id: `aud-fm-${k}`, at, actorId, entity: 'factor-model', entityId, action, summary })
  const v2 = models.find((m) => m.id === 'fm-2')!, v3 = models.find((m) => m.id === 'fm-3')!
  return [
    a('2025-02-03T17:00:00.000Z', 'u-est1', 'fm-1', 'create', 'Factor model v1 created from the historical cost table', 1),
    a('2025-02-20T17:00:00.000Z', 'u-estl', 'fm-1', 'publish', 'Factor model v1 approved and published', 2),
    a('2026-02-24T17:00:00.000Z', 'u-est1', 'fm-2', 'create', 'Factor model v2 drafted from v1', 3),
    a('2026-02-26T17:00:00.000Z', 'u-est1', 'fm-2', 'update', 'Factor model v2 draft: Scale exponent 1.00 → 0.92; Base uncertainty cv 0.30 → 0.15; Added factor Class location (Class location, weight 0.60); Crossings: weight 0.50 → 1.00; Traffic: weight 1.00 → 0.80; Soil / rock · Rock: ×1.25 → ×1.35', 4),
    a(v2.submittedAt!, 'u-est1', 'fm-2', 'submit', 'Factor model v2 submitted for approval', 5),
    a('2026-03-16T17:00:00.000Z', 'u-estl', 'fm-1', 'retire', 'Factor model v1 retired — replaced by v2', 6),
    a('2026-03-16T17:00:00.000Z', 'u-estl', 'fm-2', 'publish', 'Factor model v2 approved and published', 7),
    a(v3.createdAt, 'u-est2', 'fm-3', 'create', 'Factor model v3 drafted from v2', 8),
    a('2026-10-21T17:00:00.000Z', 'u-est2', 'fm-3', 'update', 'Factor model v3 draft: Scale exponent 0.92 → 0.90; Base rates, transmission open-trench replacement (all bands): −5%; Soil / rock · Cobble / caliche: ×1.15 → ×1.17; Soil / rock · Rock: ×1.35 → ×1.42; Crossings · 6 or more: ×1.18 → ×1.21; Traffic: weight 0.80 → 0.90', 9),
  ]
}

// ───────────────────────────── Drivers
type R = ReturnType<typeof rng>
function driversFor(R: R, asset: AssetType, wm: WorkMethod, terrain: Terrain, lengthFt: number): ProjectDrivers {
  const linear = LINEAR.includes(asset)
  const station = asset === 'compressor-station' || asset === 'regulator-station'
  return {
    soil: terrain === 'rural' ? R.pick(['normal', 'cobble', 'cobble', 'rock'] as const) : R.pick(['normal', 'normal', 'normal', 'normal', 'cobble', 'rock'] as const),
    permitComplexity: asset === 'compressor-station' ? 'major' : terrain === 'urban' ? R.pick(['ministerial', 'discretionary', 'discretionary'] as const) : terrain === 'rural' ? R.pick(['ministerial', 'ministerial', 'discretionary', 'major'] as const) : R.pick(['ministerial', 'ministerial', 'ministerial', 'discretionary'] as const),
    traffic: station ? 'low' : terrain === 'urban' ? R.pick(['heavy', 'heavy', 'moderate'] as const) : terrain === 'suburban' ? R.pick(['moderate', 'moderate', 'low'] as const) : 'low',
    workHours: station ? 'standard' : terrain === 'urban' ? R.pick(['standard', 'restricted', 'restricted', 'night'] as const) : terrain === 'suburban' ? R.pick(['standard', 'standard', 'restricted'] as const) : 'standard',
    crossings: !linear ? 0 : wm === 'replace-hdd' ? R.int(1, 4) : wm === 'hydrotest' ? R.int(0, 2) : Math.min(9, Math.round(lengthFt / 6000) + R.int(0, 2)),
    remoteness: terrain === 'rural' ? R.pick(['local', 'regional', 'regional', 'remote'] as const) : terrain === 'suburban' ? R.pick(['local', 'local', 'regional'] as const) : 'local',
  }
}

/** Record plausible fictional drivers on every demo project (deterministic). Mutates the state. */
export function seedProjectDrivers(s: AppState) {
  const R = rng(3131)
  for (const p of s.projects) p.drivers = driversFor(R, p.asset.type, p.workMethod, p.location.terrain, p.asset.lengthFt)
}

// ───────────────────────────── Backtest set
const PLACES = ['Cedar Hollow', 'Mesa Alta', 'Quail Run', 'Agua Fria', 'Los Robles', 'Copper Flat', 'Sunset Bluff', 'Pinecrest', 'Rio Seco', 'Granite Pass', 'Oak Terrace', 'Harbor Point', 'Dry Creek', 'Willow Bend', 'Saddleback', 'Coyote Wash', 'Bayview', 'Lone Pine', 'Arroyo Verde', 'Brookfield']
const DISTRICT_COUNTY: Record<string, string> = { West: 'Coastline County', East: 'Arroyo County', South: 'Sierra Mesa County', North: 'Arroyo County' }

/**
 * The hidden "true" cost process the fictional history was generated from. It is NOT used by any estimate — only to make
 * the synthetic actuals. It differs from the published model on purpose (rock, size scale, crossings, permits, bias by asset).
 */
function trueModel(published: FactorModel): FactorModel {
  const m = clone(published)
  m.scaleExponent = 0.89
  setMult(m.factors, 'f-soil', 'rock', 1.45); setMult(m.factors, 'f-soil', 'cobble', 1.18)
  setMult(m.factors, 'f-setting', 'urban', 1.26); setMult(m.factors, 'f-setting', 'rural', 0.73)
  setMult(m.factors, 'f-cross', '3-5', 1.1); setMult(m.factors, 'f-cross', '6+', 1.23)
  setMult(m.factors, 'f-permit', 'major', 1.22); setMult(m.factors, 'f-hours', 'night', 1.23); setMult(m.factors, 'f-remote', 'remote', 1.14)
  setWeight(m.factors, 'f-traffic', 0.9)
  const bias: Partial<Record<string, number>> = { 'replace-hdd': 1.05, 'distribution-main': 0.97, 'compressor-station': 1.04, 'valve-site': 1.02 }
  for (const b of m.baseRates) b.rate *= (bias[b.workMethod] ?? 1) * (bias[b.assetType] ?? 1)
  return m
}

const MIX: { asset: AssetType; wm: WorkMethod; n: number; bands: DiameterBand[]; unit: HistUnit; kind: string }[] = [
  { asset: 'transmission-pipeline', wm: 'replace-open-trench', n: 16, bands: ['10-16', '20-24', '26-36'], unit: 'ft', kind: 'Replacement' },
  { asset: 'transmission-pipeline', wm: 'replace-hdd', n: 8, bands: ['10-16', '20-24', '26-36'], unit: 'ft', kind: 'HDD Replacement' },
  { asset: 'transmission-pipeline', wm: 'hydrotest', n: 10, bands: ['n/a'], unit: 'ft', kind: 'Hydrotest' },
  { asset: 'distribution-main', wm: 'replace-open-trench', n: 12, bands: ['le-8'], unit: 'ft', kind: 'Main Replacement' },
  { asset: 'valve-site', wm: 'valve-automation', n: 8, bands: ['n/a'], unit: 'site', kind: 'Valve Automation' },
  { asset: 'compressor-station', wm: 'compressor-replacement', n: 2, bands: ['n/a'], unit: 'hp', kind: 'Compressor Replacement' },
  { asset: 'compressor-station', wm: 'station-rebuild', n: 1, bands: ['n/a'], unit: 'hp', kind: 'Station Rebuild' },
  { asset: 'regulator-station', wm: 'station-rebuild', n: 3, bands: ['n/a'], unit: 'station', kind: 'Regulator Station Rebuild' },
]

/** ~60 fictional closed projects with drivers and actual cost, generated from the hidden process + noise. */
export function buildBacktestProjects(s: AppState): BacktestProject[] {
  const published = s.factorModels.find((m) => m.status === 'published')
  if (!published) return []
  const truth = trueModel(published)
  const R = rng(6161)
  const normal = () => { const u = Math.max(1e-12, R.next()), v = R.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  const regionTrue: Record<string, number> = { West: 1.03, East: 1, South: 0.98, North: 1 }
  const taxOf = (district: string) => s.settings.estimating.taxRates.find((t) => t.county === DISTRICT_COUNTY[district])?.rate ?? 0
  const out: BacktestProject[] = []
  let k = 0
  for (const g of MIX) {
    for (let j = 0; j < g.n; j++) {
      k++
      const terrain: Terrain = g.asset === 'compressor-station' ? 'rural' : R.pick(['urban', 'suburban', 'suburban', 'rural'] as const)
      const district = R.pick(['North', 'West', 'South', 'East'] as const)
      const ref = REF_QTY(g.asset, g.wm)
      const qty = g.unit === 'site' ? R.int(1, 5) : g.unit === 'station' ? 1 : Math.round((ref * Math.exp(R.range(Math.log(0.3), Math.log(2.5)))) / (g.unit === 'hp' ? 500 : 100)) * (g.unit === 'hp' ? 500 : 100)
      const pd = driversFor(R, g.asset, g.wm, terrain, g.unit === 'ft' ? qty : 0)
      const drivers: DriverValues = { ...pd, terrain, classLocation: terrain === 'urban' ? R.pick([3, 3, 4] as const) : terrain === 'suburban' ? R.pick([2, 2, 3] as const) : R.pick([1, 1, 2] as const), hca: terrain !== 'rural' || R.chance(0.2) }
      const year = R.int(2023, 2026)
      const rec: BacktestProject = {
        id: `bt-${k}`, code: `CL-${year}-${String(k).padStart(3, '0')}`,
        name: `${g.asset === 'transmission-pipeline' ? `Line AV-${40 + k} ` : g.asset === 'distribution-main' ? 'Tract ' : ''}${g.kind} — ${PLACES[k % PLACES.length]}`,
        assetType: g.asset, workMethod: g.wm, diameterBand: R.pick(g.bands), unit: g.unit, qty, district, midpointYear: year, taxPct: taxOf(district), drivers, actual: 0,
      }
      // VERIFY: synthetic actuals = hidden process × lognormal noise (σ 0.20); fictional data for the demo backtest only.
      const cost = priceFactor(s, truth, inputsOfRecord(rec)).cost
      rec.actual = Math.round((cost * (regionTrue[district] ?? 1) * Math.exp(0.2 * normal())) / 1000) * 1000
      out.push(rec)
    }
  }
  return out
}
