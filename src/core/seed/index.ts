// Demo data for a fictional utility, "Arroyo Valley Gas". History is REPLAYED through the real
// engine (gates, estimates, workflows, snapshots) with a pinned clock, so every number ties out.
import type { AppState, AssetType, Estimate, EstimateLine, InternalOrder, Project, Risk, WorkMethod, Terrain, Milestone, SafetyPlan } from '../types'
import { addDays, addMonths, argmax, daysBetween, monthKey, monthRange, rng, setClock, sum, uid } from '../util'
import { CATEGORIES, CONTRACTORS, DOA, HAZARDS, INFO_FIELDS, INFO_SECTIONS, PEOPLE, PROGRAMS, RATES, RISK_LIBRARY, ROLES, TEMPLATES, WBS_FUNCTIONS, FORECAST_LINES, SAP_MAPPINGS, SPREAD_PROFILES, REGION_FACTORS, REGIONS, TAX_RATES, UNITS, QUANTITY_TYPES, SCOPE_LIBRARY, buildHistoricalCosts } from './reference'
import { applyProfile, defaultLineSpread, linesOfFunction, rollupGrid, syncForecast, toLines, splitExact } from '../engine/lines'
import { postImport, stageImport, resolveTxn, type SapRow } from '../engine/sap'
import { createFactorEstimate, adjustFactorEstimate, factorInputsFromProject } from '../engine/factorModel'
import { adjustParametricEstimate, createParametricEstimate, parametricInputsFromProject } from '../engine/parametric'
import { FACTOR_SETTINGS, buildBacktestProjects, buildFactorModels, factorModelAudit, seedProjectDrivers } from './factorModel'
import { defaultSpread, toFunctions, spreadByYear as spreadYears } from '../engine/wbs'
import { infoValue } from '../engine/info'
import { xyToLatLng, offset, DEMO_BOUNDS, type LatLng } from '../engine/geo'
import { workflowDefs } from './workflows'
import { computeClass, estimateTotals, MATURITY_ITEMS, parametricLines, spreadByYear } from '../engine/estimates'
import { decideGate, ensureDeliverables, readiness, templateFor } from '../engine/gates'
import { actOnWorkflow, startWorkflow } from '../engine/workflow'
import { position, takeSnapshot, thresholdBreaches } from '../engine/position'
import { DEFAULT_ALLOCATION, authorizedFunding } from '../engine/allocation'

export const SCHEMA_VERSION = 11
export const AS_OF = '2026-10-28'

type Spec = {
  n: number; name: string; prog: string; asset: AssetType; wm: WorkMethod; dia: number; len: number; terrain: Terrain; district: string; stage: number; closed?: boolean; hold?: boolean; sites?: number; city: string
}
const S = (n: number, name: string, prog: string, asset: AssetType, wm: WorkMethod, dia: number, len: number, terrain: Terrain, district: string, city: string, stage: number, extra: Partial<Spec> = {}): Spec =>
  ({ n, name, prog, asset, wm, dia, len, terrain, district, city, stage, ...extra })

const SPECS: Spec[] = [
  S(1001, 'Line AV-11 Replacement — Mesa Verde', 'prg-pse', 'transmission-pipeline', 'replace-open-trench', 24, 18400, 'urban', 'West', 'Mesa Verde', 3),
  S(1002, 'Line AV-25 Hydrotest — Palo Duro Section', 'prg-pse', 'transmission-pipeline', 'hydrotest', 30, 42000, 'rural', 'South', 'Palo Duro', 3),
  S(1003, 'Line AV-13 Replacement — San Lucero Crossing', 'prg-pse', 'transmission-pipeline', 'replace-hdd', 20, 6200, 'suburban', 'East', 'San Lucero', 2),
  S(1004, 'Line AV-12 Hydrotest — Rancho Alto', 'prg-pse', 'transmission-pipeline', 'hydrotest', 16, 21000, 'suburban', 'East', 'Rancho Alto', 4),
  S(1005, 'Line AV-15 Replacement — Old Mission Blvd', 'prg-pse', 'transmission-pipeline', 'replace-open-trench', 16, 9800, 'urban', 'West', 'Old Mission', 1),
  S(1006, 'Line AV-14 Test or Replace — Vista Linda', 'prg-pse', 'transmission-pipeline', 'hydrotest', 12, 14500, 'suburban', 'North', 'Vista Linda', 0),
  S(1007, 'Line AV-17 Replacement — Ironwood Wash', 'prg-pse', 'transmission-pipeline', 'replace-hdd', 36, 12000, 'rural', 'South', 'Ironwood', 2),
  S(1008, 'Line AV-16 Hydrotest — Cielo Grande', 'prg-pse', 'transmission-pipeline', 'hydrotest', 24, 30000, 'rural', 'North', 'Cielo Grande', 3),
  S(1009, 'Line AV-19 Replacement — Bellport Harbor', 'prg-pse', 'transmission-pipeline', 'replace-open-trench', 20, 7400, 'urban', 'West', 'Bellport', 4, { closed: true }),
  S(1010, 'Line AV-18 MAOP Reconfirmation — Juniper Ridge', 'prg-tim', 'transmission-pipeline', 'hydrotest', 30, 26000, 'rural', 'North', 'Juniper Ridge', 1),
  S(1011, 'Line AV-21 Segment Replacement — Las Piedras', 'prg-tim', 'transmission-pipeline', 'replace-open-trench', 30, 11000, 'suburban', 'East', 'Las Piedras', 3),
  S(1012, 'Line AV-26 Hydrotest — Laguna Ciega', 'prg-tim', 'transmission-pipeline', 'hydrotest', 24, 16000, 'rural', 'South', 'Laguna Ciega', 0),
  S(1013, 'Line AV-22 MAOP Replacement — Sycamore Flats', 'prg-tim', 'transmission-pipeline', 'replace-open-trench', 20, 4300, 'suburban', 'East', 'Sycamore Flats', 2),
  S(1014, 'Line AV-23 Creek Crossing — Fairhollow', 'prg-tim', 'transmission-pipeline', 'replace-hdd', 16, 3800, 'rural', 'North', 'Fairhollow', 1),
  S(1015, 'Highland Ave Main Replacement — Cresthaven', 'prg-drp', 'distribution-main', 'replace-open-trench', 6, 14000, 'urban', 'West', 'Cresthaven', 3),
  S(1016, 'Westgate Tract Main Replacement', 'prg-drp', 'distribution-main', 'replace-open-trench', 4, 22000, 'suburban', 'East', 'Westgate', 2),
  S(1017, 'Old Mission Downtown Main Replacement', 'prg-drp', 'distribution-main', 'replace-open-trench', 8, 9500, 'urban', 'West', 'Old Mission', 1),
  S(1018, 'Bellport North Main Replacement', 'prg-drp', 'distribution-main', 'replace-open-trench', 6, 18000, 'urban', 'West', 'Bellport', 0),
  S(1019, 'Rancho Alto Phase 3 Main Replacement', 'prg-drp', 'distribution-main', 'replace-open-trench', 4, 16000, 'suburban', 'East', 'Rancho Alto', 4),
  S(1020, 'Del Arroyo Compressor Station Modernization', 'prg-csm', 'compressor-station', 'compressor-replacement', 0, 0, 'rural', 'South', 'Del Arroyo', 3),
  S(1021, 'Cielo Grande Storage Compressor Replacement', 'prg-csm', 'compressor-station', 'compressor-replacement', 0, 0, 'rural', 'North', 'Cielo Grande', 2),
  S(1022, 'Palo Duro Station Rebuild', 'prg-csm', 'compressor-station', 'station-rebuild', 0, 0, 'rural', 'South', 'Palo Duro', 1),
  S(1023, 'Las Lomas Station Rebuild', 'prg-csm', 'compressor-station', 'station-rebuild', 0, 0, 'suburban', 'East', 'Las Lomas', 0),
  S(1024, 'Valve Automation — Line AV-11 MLV 7 & 9', 'prg-vap', 'valve-site', 'valve-automation', 24, 0, 'urban', 'West', 'Mesa Verde', 2, { sites: 2 }),
  S(1025, 'Valve Automation — Line AV-25 MLV 14', 'prg-vap', 'valve-site', 'valve-automation', 30, 0, 'rural', 'South', 'Palo Duro', 1, { sites: 1 }),
  S(1026, 'Valve Automation — Line AV-21 MLV 3, 4, 5', 'prg-vap', 'valve-site', 'valve-automation', 30, 0, 'suburban', 'East', 'Las Piedras', 1, { sites: 3 }),
  S(1027, 'Valve Automation — Line AV-16 MLV 21', 'prg-vap', 'valve-site', 'valve-automation', 24, 0, 'rural', 'North', 'Cielo Grande', 0, { sites: 1 }),
  S(1028, 'Valve Automation — Line AV-19 MLV 2', 'prg-vap', 'valve-site', 'valve-automation', 20, 0, 'urban', 'West', 'Bellport', 2, { sites: 1, closed: true }),
  S(1029, 'Valve Automation — Line AV-26 MLV 8 & 11', 'prg-vap', 'valve-site', 'valve-automation', 24, 0, 'rural', 'South', 'Laguna Ciega', 2, { sites: 2 }),
  S(1030, 'Line AV-24 Abandon & Replace — Ironwood', 'prg-pse', 'transmission-pipeline', 'replace-open-trench', 12, 5600, 'rural', 'South', 'Ironwood', 1, { hold: true }),
]

// Capital allocation: quantified benefit per project (fictional; VERIFY with the integrity risk model and hydraulic studies).
// [safety $K/yr risk reduced, added capacity MMcfd, customers gaining a second feed, outage cust-hrs/yr avoided, tCO2e/yr reduced, O&M $K/yr saved, basis]
const BENEFITS: Record<number, [number, number, number, number, number, number, string]> = {
  1001: [2400, 0, 0, 5000, 150, 120, 'TIMP risk model 2026 run; replacement removes legacy seam threat'],
  1002: [450, 0, 0, 0, 0, 20, 'TIMP risk model 2026 run; MAOP records established'],
  1003: [1300, 0, 0, 8000, 80, 60, 'TIMP risk model 2026 run; river crossing exposure'],
  1004: [300, 0, 0, 0, 0, 15, 'TIMP risk model 2026 run'],
  1005: [1900, 4, 0, 6000, 120, 90, 'TIMP risk model 2026 run; 16→20 in. upsizing per hydraulic study HS-114'],
  1006: [600, 0, 0, 2000, 40, 30, 'TIMP risk model 2026 run'],
  1007: [900, 25, 0, 20000, 200, 100, 'TIMP risk model 2026 run; looping adds capacity per hydraulic study HS-109'],
  1008: [500, 0, 0, 0, 0, 25, 'TIMP risk model 2026 run'],
  1010: [700, 0, 0, 0, 0, 40, 'TIMP risk model 2026 run; MAOP reconfirmation'],
  1011: [1100, 0, 0, 3000, 60, 70, 'TIMP risk model 2026 run; HCA segment'],
  1012: [380, 0, 0, 0, 0, 20, 'TIMP risk model 2026 run'],
  1013: [950, 0, 0, 2500, 50, 60, 'TIMP risk model 2026 run; HCA segment'],
  1014: [650, 0, 0, 6000, 30, 40, 'TIMP risk model 2026 run; scour exposure at creek'],
  1015: [520, 1.5, 3200, 12000, 450, 260, 'DIMP risk model 2026 run; tie-in creates a second feed to the tract'],
  1016: [640, 1, 4800, 15000, 600, 320, 'DIMP risk model 2026 run; new loop closes a dead end'],
  1017: [700, 2, 6500, 22000, 800, 380, 'DIMP risk model 2026 run; downtown grid tied to a second regulator station'],
  1018: [820, 3, 9000, 30000, 900, 450, 'DIMP risk model 2026 run; loop closes the north feed'],
  1019: [160, 0, 1100, 4000, 180, 90, 'DIMP risk model 2026 run'],
  1020: [3000, 120, 60000, 150000, 18000, 1800, 'Station risk assessment SRA-20; hydraulic study HS-101'],
  1021: [2600, 180, 140000, 400000, 22000, 2400, 'Station risk assessment SRA-21; storage withdrawal study HS-121 (winter peak)'],
  1022: [1500, 40, 20000, 60000, 9000, 1200, 'Station risk assessment SRA-22; hydraulic study HS-122'],
  1023: [2200, 110, 55000, 140000, 15000, 1600, 'Station risk assessment SRA-23; hydraulic study HS-123'],
  1024: [650, 0, 0, 1500, 120, 10, 'Rupture consequence model; isolation time cut from 60 to 10 minutes'],
  1025: [380, 0, 0, 800, 80, 8, 'Rupture consequence model'],
  1026: [900, 0, 0, 2500, 200, 15, 'Rupture consequence model; three valves on an HCA line'],
  1027: [260, 0, 0, 600, 60, 6, 'Rupture consequence model'],
  1029: [300, 0, 0, 700, 70, 7, 'Rupture consequence model'],
  1030: [300, 0, 0, 1000, 60, 40, 'TIMP risk model 2026 run'],
}

const DISTRICT_BOX: Record<string, [number, number, number, number]> = {
  West: [90, 300, 330, 540], East: [360, 260, 620, 500], South: [650, 220, 930, 520], North: [260, 50, 720, 210],
}
const COUNTY: Record<string, string> = { West: 'Coastline County', East: 'Arroyo County', South: 'Sierra Mesa County', North: 'Arroyo County' }

const PM_BY_PROG: Record<string, string[]> = { 'prg-pse': ['u-pm1', 'u-pm2'], 'prg-tim': ['u-pm3', 'u-pm4'], 'prg-drp': ['u-pm1', 'u-pm3'], 'prg-csm': ['u-pm5', 'u-pm6'], 'prg-vap': ['u-pm4', 'u-pm2'] }
const SPONSOR_BY_PROG: Record<string, string> = { 'prg-pse': 'u-dir1', 'prg-tim': 'u-dir1', 'prg-drp': 'u-dir1', 'prg-csm': 'u-dir2', 'prg-vap': 'u-dir1' }
const PGM_BY_PROG: Record<string, string> = { 'prg-pse': 'u-pgm1', 'prg-tim': 'u-pgm2', 'prg-drp': 'u-pgm1', 'prg-csm': 'u-pgm3', 'prg-vap': 'u-pgm2' }

const MILESTONES_STD = ['Business case approved', 'Option selected', 'Construction authorized', 'In service', 'Closeout complete']
const MILESTONES_SMALL = ['Plan approved', 'Construction authorized', 'In service & closed']

function emptyState(): AppState {
  const hist = buildHistoricalCosts(RATES)
  return {
    schemaVersion: SCHEMA_VERSION,
    currentUserId: 'u-me',
    settings: {
      orgName: 'Arroyo Valley Gas',
      asOf: AS_OF,
      varianceThresholds: { eacPct: 10, eacAbs: 1_000_000, milestoneDays: 30 },
      fieldDefs: [
        { key: 'grcWorkpaper', label: 'GRC workpaper', programIds: ['prg-tim', 'prg-drp', 'prg-vap'] },
        { key: 'pseSegment', label: 'Safety enhancement segment ID', programIds: ['prg-pse'], requiredAtStage: 1 },
        { key: 'airDistrictPermit', label: 'Air district permit no.', programIds: ['prg-csm'], requiredAtStage: 2 },
      ],
      loaderRates: [
        { year: 2026, name: 'A&G overhead', pct: 6.5 },
        { year: 2026, name: 'Payroll taxes & benefits', pct: 4.0 },
        { year: 2026, name: 'AFUDC', pct: 3.2 },
      ],
      escalationByYear: { '2025': 3.4, '2026': 3.1, '2027': 3.0, '2028': 2.9, '2029': 2.8, '2030': 2.8 },
      wbsFunctions: WBS_FUNCTIONS,
      infoFields: INFO_FIELDS,
      infoSections: INFO_SECTIONS,
      gis: {
        allowExternal: false,
        basemap: 'none',
        center: [(DEMO_BOUNDS.north + DEMO_BOUNDS.south) / 2, (DEMO_BOUNDS.east + DEMO_BOUNDS.west) / 2],
        zoom: 8,
        layers: [
          { id: 'lyr-demo', name: 'Arroyo Valley Gas pipe network (fictional demo)', kind: 'demo', url: '', color: '#f0b000', visible: true, note: 'Illustrative alignments for the demo utility. Not real pipe locations.' },
          { id: 'lyr-utility', name: 'Utility GIS — gas transmission', kind: 'arcgis-feature', url: '', color: '#ff7a00', visible: false, note: "Paste your ArcGIS Server or ArcGIS Online feature service URL (…/FeatureServer/0 or …/MapServer/0). Add a token for secured services." },
        ],
        demoNetwork: [],
      },
      forecastLines: FORECAST_LINES,
      sapMappings: SAP_MAPPINGS,
      spreadProfiles: SPREAD_PROFILES,
      quickEstimate: { regionFactors: REGION_FACTORS, contingencyPct: 30, reviewerRole: 'estimator' },
      ai: { enabled: false, endpoint: '', model: '' },
      estimating: {
        regions: REGIONS,
        regionFactors: REGION_FACTORS,
        contingencyByClass: { '5': 30, '4': 20, '3': 15, '2': 10, '1': 5 },
        taxRates: TAX_RATES,
        taxableCategoryIds: ['cat-pipe', 'cat-valves', 'cat-equipment', 'cat-test'],
        units: UNITS,
        quantityTypes: QUANTITY_TYPES,
        scopeLibrary: SCOPE_LIBRARY,
        maturityItems: MATURITY_ITEMS,
        rateTableVersion: 3,
        rateTableHistory: [
          { version: 1, at: '2025-01-15T17:00:00.000Z', byId: 'u-estl', note: 'Initial rate table from 2024 closed projects' },
          { version: 2, at: '2025-07-10T17:00:00.000Z', byId: 'u-estl', note: 'Mid-year refresh: contract construction +4%, pipe +6%' },
          { version: 3, at: '2026-01-12T17:00:00.000Z', byId: 'u-estl', note: '2026 rates: loaders updated, traffic control by region' },
        ],
      },
      factorModel: JSON.parse(JSON.stringify(FACTOR_SETTINGS)),
      workflow: { reminderDays: 1, escalateAfterDays: 3 },
      features: { fieldTailboard: false, portfolioPlanning: false, opQual: false },
    },
    roles: ROLES, people: PEOPLE, programs: PROGRAMS, funding: [], templates: TEMPLATES, projects: [], deliverables: [], gateDecisions: [], gateReviews: [], actions: [],
    categories: CATEGORIES, rates: RATES, estimates: [], budgets: [], snapshots: [], changes: [], costPeriods: [], forecasts: [], infoRevisions: [], historicalCosts: hist, factorModels: buildFactorModels(hist), backtestProjects: [], actualTxns: [], actualsImports: [], commitmentChanges: [], channels: [], messages: [], variances: [], risks: [], riskLibrary: RISK_LIBRARY,
    contingencyDraws: [], monteCarlo: [], hazards: HAZARDS, safetyPlans: [], tailboards: [], safetyEvents: [], workflowDefs: workflowDefs(), doaMatrices: DOA, workflows: [],
    permits: [], landRights: [], contracts: [], longLead: [], records: [], decisions: [], outreach: [], lessons: [], documents: [], closeout: [], audit: [], notifications: [],
  }
}

// Pinned demo clock used while replaying history; workflow steps advance it 1–3 days so cycle times look real.
let clk = AS_OF
let clkCap = AS_OF
const stepRng = rng(4242)
function pin(s: AppState, d: string, cap = AS_OF) { clk = d; clkCap = cap; s.settings.asOf = d; setClock(d) }

/** Drive a running workflow forward, each active step approved by its first assignee. */
function advance(s: AppState, instId: string, steps: number, comment = 'Reviewed — no issues.') {
  for (let i = 0; i < steps; i++) {
    const nd = addDays(clk, stepRng.int(1, 3))
    if (nd <= clkCap) { clk = nd; setClock(nd) }
    const inst = s.workflows.find((w) => w.id === instId)
    if (!inst || inst.status !== 'running' || !inst.active.length) return
    const slot = inst.active[0]
    const actor = slot.assigneeIds.find((x) => !slot.actedIds.includes(x)) ?? slot.assigneeIds[0]
    actOnWorkflow(s, inst.id, slot.nodeId, actor, 'approve', comment)
  }
}
const runToEnd = (s: AppState, instId: string, comment?: string) => advance(s, instId, 20, comment)

export function buildSeed(): AppState {
  const s = emptyState()
  s.backtestProjects = buildBacktestProjects(s)
  s.audit.push(...factorModelAudit(s.factorModels))
  const R = rng(20261028)
  const at = (d: string) => pin(s, d, d < AS_OF ? addDays(d, 18) : AS_OF)

  for (const sp of SPECS) {
    const tpl = TEMPLATES.find((t) => t.id === PROGRAMS.find((p) => p.id === sp.prog)!.lifecycleTemplateId)!
    const small = tpl.id === 'tpl-small'
    const lastStage = tpl.stages.length - 1
    const target = Math.min(sp.stage, lastStage)
    // stage durations (days)
    const consDur = small ? 200 + R.int(0, 120) : sp.asset === 'compressor-station' ? 640 + R.int(0, 200) : sp.asset === 'distribution-main' ? 210 + R.int(0, 120) : Math.round(180 + (sp.len / 60) + R.int(0, 120))
    const durs = small ? [110 + R.int(0, 60), 200 + R.int(0, 90), consDur] : [130 + R.int(0, 80), 200 + R.int(0, 100), 260 + R.int(0, 140), consDur, 120 + R.int(0, 60)]
    const frac = sp.closed ? 1.4 : 0.2 + R.next() * 0.7
    const stageStarts: string[] = []
    stageStarts[target] = addDays(AS_OF, -Math.round(durs[target] * frac))
    for (let i = target - 1; i >= 0; i--) stageStarts[i] = addDays(stageStarts[i + 1], -durs[i])
    for (let i = target + 1; i <= lastStage + 1; i++) stageStarts[i] = addDays(stageStarts[i - 1], durs[i - 1] ?? 120)
    const gateDates = tpl.stages.map((_, i) => stageStarts[i + 1])
    const initiated = stageStarts[0]
    const slipDays = target >= (small ? 1 : 2) ? R.pick([0, 0, 14, 35, 60, 90]) : 0

    const [x0, y0, x1, y1] = DISTRICT_BOX[sp.district]
    const pm = R.pick(PM_BY_PROG[sp.prog])
    const isStation = sp.asset === 'compressor-station'
    const isValve = sp.asset === 'valve-site'
    const lineNo = (sp.name.match(/Line ([A-Z]{2}-\d+)/) ?? [])[1] ?? (isStation ? 'STA-' + sp.city.slice(0, 3).toUpperCase() : 'DIST')
    const miles = +(sp.len / 5280).toFixed(1)
    const milestoneNames = small ? MILESTONES_SMALL : MILESTONES_STD
    const milestones: Milestone[] = milestoneNames.map((name, i) => {
      const gi = small ? i : i
      const base = gateDates[gi]
      return { id: uid('ms'), name, baseline: base, forecast: base }
    })
    if (!small) milestones.splice(3, 0, { id: uid('ms'), name: 'Construction start', baseline: addDays(gateDates[2], 30), forecast: addDays(gateDates[2], 30) })

    const quantities = isValve
      ? [{ label: 'Valve sites automated', qty: sp.sites ?? 1, unit: 'ea' }]
      : isStation
        ? [{ label: 'Compressor units', qty: sp.wm === 'compressor-replacement' ? 4 : 2, unit: 'ea' }, { label: 'Station capacity', qty: sp.wm === 'compressor-replacement' ? 22000 : 9000, unit: 'hp' }]
        : sp.wm === 'hydrotest'
          ? [{ label: 'Pipe tested', qty: sp.len, unit: 'ft' }, { label: 'Test sections', qty: Math.max(2, Math.round(sp.len / 4200)), unit: 'ea' }, { label: 'Short-section replacements', qty: R.int(2, 9), unit: 'ea' }]
          : [{ label: 'Pipe installed', qty: sp.len, unit: 'ft' }, { label: 'Tie-ins', qty: R.int(2, 6), unit: 'ea' }, { label: sp.asset === 'distribution-main' ? 'Services transferred' : 'Pipe abandoned in place', qty: sp.asset === 'distribution-main' ? Math.round(sp.len / 55) : sp.len, unit: sp.asset === 'distribution-main' ? 'ea' : 'ft' }]

    const p: Project = {
      id: `prj-${sp.n}`,
      code: `PRJ-${sp.n}`,
      name: sp.name,
      programId: sp.prog,
      sizeTier: 'M',
      driver: sp.prog === 'prg-csm' ? 'Environmental' : sp.prog === 'prg-drp' ? 'Reliability' : 'Safety / compliance',
      regulatoryCitation: PROGRAMS.find((x) => x.id === sp.prog)!.regulatoryDriver,
      fundingProceeding: sp.prog === 'prg-pse' ? 'PSE balancing account (AV-PUC-2022-05 (fictional) review)' : sp.prog === 'prg-csm' ? 'Tier 2 advice letter on in-service' : 'TY2028 GRC (AV-PUC-2026-06 (fictional))',
      location: { district: sp.district, city: sp.city, county: COUNTY[sp.district], x: R.int(x0, x1), y: R.int(y0, y1), classLocation: sp.terrain === 'urban' ? 3 : sp.terrain === 'suburban' ? 2 : 1, hca: sp.terrain !== 'rural' || R.chance(0.2), dac: R.chance(0.35), terrain: sp.terrain },
      asset: {
        type: sp.asset, lineId: lineNo, diameterIn: sp.dia, lengthFt: sp.len,
        maopPsig: sp.asset === 'distribution-main' ? 60 : isStation ? 1000 : R.pick([400, 640, 720, 860, 975]),
        material: sp.asset === 'distribution-main' ? 'Pre-1940 cast iron / bare steel' : isStation ? 'Gas turbine-driven reciprocating units' : R.pick(['Steel, Grade B', 'Steel, X42', 'Steel, X52']),
        vintage: isStation ? R.int(1958, 1972) : R.int(1931, 1968),
        recordsStatus: sp.wm === 'hydrotest' ? 'gaps' : R.pick(['complete', 'gaps', 'unknown']),
      },
      workMethod: sp.wm,
      team: { sponsor: SPONSOR_BY_PROG[sp.prog], pm, engineer: isStation ? 'u-eng2' : 'u-eng1', estimator: R.pick(['u-est1', 'u-est2']), projectControls: R.pick(['u-pc1', 'u-pc2']), scheduler: 'u-sch', constructionManager: isStation ? 'u-cm2' : 'u-cm1', safety: R.pick(['u-saf1', 'u-saf2']), environmental: 'u-env', land: 'u-land' },
      contractor: target >= (small ? 1 : 2) ? R.pick(CONTRACTORS) : undefined,
      stageIndex: 0,
      status: 'active',
      health: { scope: 'green', schedule: 'green', cost: 'green', risk: 'green', safety: 'green' },
      scope: {
        summary: isValve
          ? `Install remote-control valves with SCADA at ${sp.sites} mainline valve site(s) on Line ${lineNo} to meet automatic shutoff requirements.`
          : isStation
            ? `Replace gas turbine-driven compression at ${sp.city} with electric-drive units, new substation and controls; decommission legacy units.`
            : sp.wm === 'hydrotest'
              ? `Pressure test ${miles} miles of ${sp.dia}-inch Line ${lineNo} to establish MAOP records; replace short sections that cannot be tested.`
              : `Replace ${miles} miles of ${sp.dia}-inch ${sp.asset === 'distribution-main' ? 'distribution main' : `Line ${lineNo}`} through ${sp.city} by ${sp.wm === 'replace-hdd' ? 'horizontal directional drill' : 'open trench'}; abandon existing pipe in place.`,
        inScope: isStation
          ? ['Compressor units and motors', 'Substation and interconnect', 'Station piping and controls', 'Demolition of legacy units', 'Air permit compliance']
          : isValve
            ? ['Valve and actuator installation', 'SCADA RTU and communications', 'Site civil work', 'Commissioning with gas control']
            : ['Engineering, survey and design', 'Land rights and permits', 'Construction and inspection', 'Tie-ins and gas handling', 'Restoration'],
        outOfScope: ['Customer meter work', 'Unrelated leak repairs'],
        quantities,
        assumptions: ['Outage windows available October–April', 'Work hours 7 AM–6 PM weekdays in residential areas', 'No groundwater dewatering beyond 2 ft'],
      },
      milestones,
      dates: { initiated },
      erpWbs: `C.${sp.prog.slice(4).toUpperCase()}.${sp.n}`,
      scheduleId: `P6-${sp.n}`,
      gisIds: isStation ? [`FAC-${sp.n}`] : [`SEG-${lineNo}-${R.int(100, 999)}`, `SEG-${lineNo}-${R.int(100, 999)}`],
      permitsNeeded: { ceqa: isStation || sp.terrain === 'rural', encroachment: !isStation, hydrotestDischarge: sp.wm === 'hydrotest' },
      info: {},
      customFields: sp.prog === 'prg-pse' ? { pseSegment: `PSE-${lineNo}-${R.int(1, 40)}` } : sp.prog === 'prg-csm' ? { airDistrictPermit: `ADP-${R.int(20000, 29999)}` } : { grcWorkpaper: `WP-${R.int(1000, 9999)}` },
    }
    s.projects.push(p)
    const bf = BENEFITS[sp.n]
    // delivery confidence rises as the project matures (scope, permits and contracts settle)
    if (bf) p.benefits = { values: { safety: bf[0], capacity: bf[1], redundancy: bf[2], reliability: bf[3], emissions: bf[4], om: bf[5] }, confidence: [70, 80, 90, 95, 95][Math.min(4, sp.stage)], basis: bf[6], updatedById: 'u-me', updatedAt: initiated }
    p.info = infoFor(p, sp, R, target)

    // ── replay history
    at(initiated)
    ensureDeliverables(s, p)
    seedRisks(s, p, R, initiated)

    for (let g = 0; g < target || (sp.closed && g <= lastStage); g++) {
      if (g > lastStage) break
      const gate = tpl.stages[g].gate
      const gDate = gateDates[g]
      // estimate before the gate if the gate needs one
      if (gate.requiredEstimateClass) {
        at(addDays(gDate, -20))
        const cls = gate.requiredEstimateClass
        const est = makeEstimate(s, p, R, cls, g)
        const inst = startWorkflow(s, 'estimate-approval', { title: `${p.code} Class ${cls} estimate v${est.version}`, recordType: 'estimate', recordId: est.id, projectId: p.id, data: { amount: estimateTotals(est).total, cls: String(cls) }, startedById: p.team.estimator })
        if (inst) runToEnd(s, inst.id)
      }
      at(addDays(gDate, -3))
      for (const dl of s.deliverables.filter((x) => x.projectId === p.id && x.stageIndex === g)) {
        dl.status = 'accepted'; dl.version = 1 + (R.chance(0.3) ? 1 : 0)
        dl.evidence = [{ id: uid('evd'), name: evidenceName(s, dl.defId), sizeKb: R.int(180, 4200), uploadedAt: `${addDays(gDate, -R.int(5, 30))}T10:00:00.000Z`, byId: dl.ownerId ?? pm }]
      }
      at(gDate)
      const withConditions = R.chance(0.3)
      decideGate(s, p.id, withConditions ? 'go-with-conditions' : 'go', [p.team.sponsor!, 'u-pmo2'], withConditions ? 'Approved; close open land items before mobilization.' : 'All deliverables accepted; proceed.', withConditions ? [{ title: 'Confirm outage window with gas control', ownerId: pm, due: addDays(gDate, 45) }] : [])
      const ms = p.milestones.filter((m) => !/Construction start/.test(m.name))[g]
      if (ms) ms.actual = gDate
      if (!small && g === 2) {
        const cs = p.milestones.find((m) => m.name === 'Construction start')!
        if (addDays(gDate, 30) <= AS_OF) cs.actual = addDays(gDate, 30 + R.int(0, 20))
      }
      // after the control gate, cost history + changes are generated below
    }
    // apply schedule slip to future milestones (forecast), counted from Current baseline
    for (const m of p.milestones) if (!m.actual) m.forecast = addDays(m.baseline, slipDays)
    if (sp.closed) { p.status = 'closed'; p.dates.closed = gateDates[lastStage]; p.dates.inService = gateDates[small ? 1 : 3] }
    if (!small && target >= 4) p.dates.inService = gateDates[3]
    if (sp.hold) p.status = 'on-hold'

    // ── cost history (engineering spend from Gate 1; construction after control gate)
    const controlIdx = small ? 1 : 2
    const planningDone = target >= 1 || sp.closed
    if (planningDone) seedCost(s, p, R, gateDates, controlIdx, target, small, !!sp.closed)

    // ── current-stage deliverables partly done
    at(AS_OF)
    if (p.status === 'active') {
      ensureDeliverables(s, p)
      const cur = s.deliverables.filter((x) => x.projectId === p.id && x.stageIndex === p.stageIndex)
      cur.forEach((dl, i) => {
        const roll = R.next()
        dl.status = roll < 0.45 ? 'accepted' : roll < 0.6 ? 'submitted' : roll < 0.85 ? 'in-progress' : 'not-started'
        if (dl.status !== 'not-started') { dl.version = 1; dl.evidence = [{ id: uid('evd'), name: evidenceName(s, dl.defId), sizeKb: R.int(150, 3000), uploadedAt: `${addDays(AS_OF, -R.int(2, 40))}T15:00:00.000Z`, byId: dl.ownerId ?? pm }] }
        dl.due = addDays(AS_OF, -10 + i * 9)
      })
    }

    seedSupporting(s, p, R, target, small, !!sp.closed, gateDates)
  }

  seedProjectDrivers(s)
  at(AS_OF)
  seedFinance(s)
  seedSapActuals(s)
  seedGeometry(s)
  seedInfoRevisions(s, R)
  seedLiveWorkflows(s, R)
  seedCommitmentChanges(s)
  seedMessages(s)
  pin(s, AS_OF)
  seedFunding(s)
  s.settings.allocation = { ...JSON.parse(JSON.stringify(DEFAULT_ALLOCATION)), budget: authorizedFunding(s).amount }
  health(s)
  // keep only the demo user's recent notifications
  s.notifications = s.notifications.filter((n) => n.at >= addDays(AS_OF, -14)).slice(-60)
  // (audit kept whole: the log is append-only)
  setClock(null)
  return s
}

function evidenceName(s: AppState, defId: string) {
  for (const t of s.templates) for (const st of t.stages) { const d = st.gate.deliverables.find((x) => x.id === defId); if (d) return d.name.replace(/[^A-Za-z0-9]+/g, '_') + (d.kind === 'schedule' ? '.xer' : d.kind === 'estimate' ? '.xlsx' : '.pdf') }
  return 'document.pdf'
}

function seedRisks(s: AppState, p: Project, R: ReturnType<typeof rng>, date: string) {
  const lib = RISK_LIBRARY.filter((r) => r.appliesTo.includes(p.workMethod))
  const scale = p.asset.type === 'compressor-station' ? 280_000_000 : p.asset.type === 'valve-site' ? 1_900_000 * (p.scope.quantities[0]?.qty ?? 1) : Math.max(2_000_000, p.asset.lengthFt * (p.asset.type === 'distribution-main' ? 650 : p.workMethod === 'hydrotest' ? 500 : 2600))
  let k = 0
  for (const item of lib) {
    if (!R.chance(0.75)) continue
    k++
    const ml = Math.round((Math.abs(item.typicalCostPct) / 100) * scale * R.range(0.6, 1.4) / 1000) * 1000
    const L = R.int(1, 5) as Risk['likelihood'], C = R.int(2, 5) as Risk['consequence']
    const owner = R.pick([p.team.pm!, p.team.engineer!, p.team.land!, p.team.environmental!])
    s.risks.push({
      id: uid('rsk'), projectId: p.id, code: `R-${p.code.slice(4)}-${String(k).padStart(2, '0')}`, title: item.title, cause: item.cause, event: item.event, effect: item.effect, category: item.category,
      kind: item.typicalCostPct < 0 ? 'opportunity' : 'threat', ownerId: owner, status: 'open', likelihood: L, consequence: C, consequenceDim: item.category === 'Environmental' ? 'Environmental' : item.typicalDays > 40 ? 'Schedule' : 'Financial',
      probability: [0.05, 0.15, 0.35, 0.6, 0.85][L - 1], cost: { min: Math.round(ml * 0.4), ml, max: Math.round(ml * 2.2) }, scheduleDays: { min: Math.round(item.typicalDays * 0.4), ml: item.typicalDays, max: Math.round(item.typicalDays * 2) },
      responses: L * C >= 12 || R.chance(0.5) ? [{ id: uid('rr'), action: responseFor(item.category), ownerId: owner, due: addDays(date, R.int(30, 200)), status: R.chance(0.4) ? 'done' : 'open', cost: Math.round(ml * 0.08 / 1000) * 1000 }] : [],
      residual: { likelihood: Math.max(1, L - 1) as Risk['likelihood'], consequence: Math.max(1, C - 1) as Risk['consequence'] }, libraryId: item.id, createdAt: date,
    })
  }
}
function responseFor(cat: string) {
  return ({
    'Third-party / substructures': 'Pothole all crossings during design; add SUE survey', Permitting: 'Pre-application meeting with agency; submit 30 days early', Environmental: 'Phase I site assessment; pre-approve disposal facility',
    Material: 'Early release of pipe order; secondary mill qualified', Operations: 'Book outage windows with gas control at Gate 2', 'Land / right-of-way': 'Begin owner outreach at Gate 1; appraisal early',
    Technical: 'Pre-test records review; spare test heads on site', Productivity: 'Night work variance request; second crew option in contract', 'Regulatory change': 'Track rulemaking; design margin for controls',
    Weather: 'Schedule excavation outside rainy season', Records: 'Records review before Class 3 estimate', Market: 'Target-price contracting with alliance partner',
  } as Record<string, string>)[cat] ?? 'Monitor monthly'
}

function makeEstimate(s: AppState, p: Project, R: ReturnType<typeof rng>, cls: 5 | 4 | 3 | 2 | 1, gateIdx: number): Estimate {
  const base = parametricLines(p, s.rates)
  let lines: EstimateLine[] = base
  if (cls <= 3) {
    // Class 3: split into work packages with quantity/unit-cost refinement and vendor quotes
    const wps = p.asset.type === 'compressor-station' ? ['WP1 Equipment', 'WP2 EPC construction', 'WP3 Electrical'] : p.asset.type === 'valve-site' ? ['WP1 Sites'] : ['WP1 Segment A', 'WP2 Segment B']
    lines = []
    for (const l of base) {
      const parts = l.unit === 'ft' ? wps.length : 1
      for (let i = 0; i < parts; i++) {
        lines.push({ ...l, id: uid('ln'), workPackage: parts > 1 ? wps[i] : wps[0], qty: Math.round((l.qty / parts) * R.range(0.95, 1.12) * 100) / 100, unitCost: Math.round(l.unitCost * R.range(0.92, 1.22)), source: l.categoryId === 'cat-pipe' || l.categoryId === 'cat-equipment' || l.categoryId === 'cat-valves' ? 'quote' : R.pick(['library', 'library', 'analog', 'judgment'] as const), confidence: R.pick(['medium', 'high'] as const) })
      }
    }
  }
  const maturity: Record<string, boolean> = {}
  for (const m of MATURITY_ITEMS) maturity[m.key] = m.forClass >= cls
  const prev = s.estimates.filter((e) => e.projectId === p.id)
  const t = s.settings
  const e: Estimate = {
    id: uid('est'), projectId: p.id, version: prev.length + 1, title: cls === 5 ? 'Class 5 parametric estimate' : `Class ${cls} line-item estimate`, cls: computeClass(maturity), status: 'draft', method: cls === 5 ? 'parametric' : 'line-item',
    createdAt: `${s.settings.asOf}T09:00:00.000Z`, createdById: p.team.estimator!, lines, maturity,
    loaders: t.loaderRates.map((x) => ({ name: x.name, pct: x.pct })), escalationPct: cls === 5 ? 9.5 : 6.2, contingency: cls === 5 ? { method: 'deterministic', pct: 30 } : { method: 'risk-based', pct: Math.round(R.range(13, 19)), confidence: 'P80' },
    basis: {
      scopeBasis: p.scope.summary,
      assumptions: cls === 5 ? ['Quantities from GIS centerline length', 'Library rates for similar terrain', 'No land acquisition beyond temporary rights'] : ['Quantities from 30% plan & profile', 'Pipe and valve pricing from vendor quotes', 'Productivity from last three comparable projects', 'Outage windows per gas control letter'],
      exclusions: ['Customer-side work', 'Unknown contamination beyond Phase I findings', 'Escalation beyond the planned in-service year'],
      contingencyRationale: cls === 5 ? 'Deterministic 30% for Class 5 per estimating standard.' : 'Risk-based: P80 of Monte Carlo on the quantified risk register.',
      classJustification: cls === 5 ? 'Definition 0–2%: need, asset and length known; no design.' : 'Definition about 30%: plan & profile, survey, permit matrix, quotes and risk register complete.',
    },
  }
  void gateIdx
  s.estimates.push(e)
  return e
}

function seedCost(s: AppState, p: Project, R: ReturnType<typeof rng>, gateDates: string[], controlIdx: number, target: number, small: boolean, closed: boolean) {
  const start = gateDates[0]
  const consStart = gateDates[controlIdx]
  const consEnd = gateDates[controlIdx + 1]
  const end = small ? consEnd : gateDates[4] ?? consEnd
  const months = monthRange(monthKey(start), monthKey(end))
  const reachedControl = target > controlIdx || closed
  const cpi = reachedControl ? R.pick([0.84, 0.9, 0.94, 0.97, 1.0, 1.03]) : R.range(0.92, 1.04)
  const spi = reachedControl ? R.pick([0.86, 0.92, 0.97, 1.0, 1.02]) : 1
  const changeMonths = new Set<string>()
  const nChanges = reachedControl ? R.int(1, 4) : 0
  const consMonths = months.filter((m) => m >= monthKey(consStart) && m <= monthKey(AS_OF))
  for (let i = 0; i < nChanges && consMonths.length > 2; i++) changeMonths.add(consMonths[R.int(1, consMonths.length - 1)])
  const weights = months.map((m) => (m < monthKey(consStart) ? 0.18 : m <= monthKey(consEnd) ? 1 + Math.sin(((months.indexOf(m) + 0.5) / months.length) * Math.PI) : 0.12))
  const W = sum(weights)
  let k = 0
  const lastMonths = new Set(consMonths.slice(-8))
  for (const [i, m] of months.entries()) {
    if (m > monthKey(AS_OF)) break
    const monthEnd = addDays(addMonths(m + '-01', 1), -1)
    s.settings.asOf = monthEnd > AS_OF ? AS_OF : monthEnd
    setClock(s.settings.asOf)
    const b = s.budgets.filter((x) => x.projectId === p.id).sort((a, c) => a.createdAt.localeCompare(c.createdAt))
    const active = [...b].reverse().find((x) => x.kind === 'control') ?? b[b.length - 1]
    if (!active) continue
    const bac = active.total - active.contingency
    const planned = Math.round((bac * weights[i]) / W)
    const earned = Math.round(planned * spi * R.range(0.9, 1.1))
    const actual = Math.round(earned / cpi * R.range(0.95, 1.05))
    const cumAct = sum(s.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.actual)) + actual
    const fnBud = toFunctions(s, active.byCategory).byFn
    const tt = months.length > 1 ? i / (months.length - 1) : 0.5
    const peak: Record<string, number> = { early: 0.18, mid: 0.6, late: 0.92, flat: 0.5 }
    const wts = WBS_FUNCTIONS.map((f) => (fnBud[f.id] || 0) * (f.timing === 'flat' ? 1 : Math.exp(-(((tt - peak[f.timing]) / 0.28) ** 2)) + 0.04))
    const W2 = sum(wts) || 1
    const fv = wts.map((x) => Math.round((actual * x) / W2))
    fv[argmax(wts)] += actual - sum(fv)
    const byFunction: Record<string, number> = Object.fromEntries(WBS_FUNCTIONS.map((f, k) => [f.id, fv[k]]))
    const lineBud = toLines(s, active.byCategory).byLine
    const byLine: Record<string, number> = {}
    for (const f of WBS_FUNCTIONS) Object.assign(byLine, splitExact(byFunction[f.id], Object.fromEntries(linesOfFunction(s, f.id).map((l) => [l.id, lineBud[l.id] || 0]))))
    s.costPeriods.push({ id: uid('cp'), projectId: p.id, period: m, planned, earned, actual, commitments: Math.round(Math.max(0, bac - cumAct) * R.range(0.15, 0.4)), byFunction, byLine, source: 'summary' })
    if (changeMonths.has(m)) {
      k++
      const cat = R.pick(['cat-contract', 'cat-restore', 'cat-land', 'cat-pipe', 'cat-env'])
      const rc = R.pick(['Third-party / substructures', 'Permitting', 'Scope growth', 'Material price', 'Productivity', 'Design maturity'] as const)
      const amt = Math.round((bac * R.range(0.01, 0.06)) / 1000) * 1000
      const fund = R.chance(0.75) ? 'contingency' : 'new-funding'
      const ch = {
        id: uid('chg'), projectId: p.id, code: `CR-${p.code.slice(4)}-${String(k).padStart(2, '0')}`, title: changeTitle(rc), type: 'cost' as const, rootCause: rc,
        description: `${changeTitle(rc)} identified during construction. Field verification and contractor pricing attached.`, costImpact: amt, scheduleImpactDays: R.pick([0, 0, 7, 14, 21, 45]), scopeImpact: rc === 'Scope growth' ? 'Additional segment added' : 'None',
        categoryId: cat, fundedFrom: fund as 'contingency' | 'new-funding', status: 'draft' as const, requestedById: p.team.pm!, requestedAt: s.settings.asOf,
      }
      s.changes.push(ch)
      const inst = startWorkflow(s, 'change-request', { title: `${ch.code} ${ch.title}`, recordType: 'change', recordId: ch.id, projectId: p.id, data: { amount: amt, scheduleImpactDays: ch.scheduleImpactDays, rootCause: rc, justification: ch.description }, startedById: p.team.pm })
      if (inst) runToEnd(s, inst.id, 'Impact verified; approved.')
    }
    if (lastMonths.has(m) && m < monthKey(AS_OF)) takeSnapshot(s, p.id, 'period-close', `Period close ${m}`, { byId: p.team.projectControls })
  }
  // forecast: EAC from CPI on remaining work, plus half the remaining risk exposure
  s.settings.asOf = AS_OF
  setClock(AS_OF)
  const pos = position(s, p.id)
  const b = [...s.budgets.filter((x) => x.projectId === p.id)].sort((a, c) => a.createdAt.localeCompare(c.createdAt)).pop()
  if (!b) return
  const bacNow = pos.currentBudget - Math.max(0, pos.contingencyRemaining)
  const ev = sum(s.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.earned))
  const eac = closed ? pos.actualToDate : Math.round(pos.actualToDate + Math.max(0, bacNow - ev) / cpi + Math.max(0, pos.riskExposure) * 0.35 + Math.max(0, pos.contingencyRemaining) * 0.45)
  const held = closed ? 0 : Math.round(Math.max(0, pos.contingencyRemaining) * 0.45)
  const through = monthKey(addDays(AS_OF.slice(0, 7) + '-01', -1))
  const mk = (eacV: number, date: string, note: string, status: 'approved' | 'draft') => {
    const ls = closed ? undefined : defaultLineSpread(s, p, Math.max(0, eacV - pos.actualToDate - held))
    const spread = ls ? rollupGrid(s, ls.lineSpread) : {}
    s.forecasts.push({ id: uid('fc'), projectId: p.id, date, eac: eacV, byYear: closed ? spreadByYear(eacV, gateDates[0], gateDates[gateDates.length - 1]) : yearsWithActuals(s, p.id, spreadYears(spread), held), note, byId: p.team.pm!, locked: status === 'approved', spread, lineSpread: ls?.lineSpread, profiles: ls?.profiles, contingencyHeld: held, actualsThrough: through, status })
  }
  mk(Math.round(eac * R.range(0.95, 1.0)), addDays(AS_OF, -92), 'Quarterly forecast — spread by WBS function', 'approved')
  mk(eac, addDays(AS_OF, -12), 'October forecast cycle — ETC spread by function from remaining budget and burn rate', 'approved')
}
function changeTitle(rc: string) {
  return ({ 'Third-party / substructures': 'Unmarked substructure relocation', Permitting: 'Encroachment permit conditions — night work', 'Scope growth': 'Additional short-section replacement', 'Material price': 'Fitting price increase', Productivity: 'Rock excavation productivity', 'Design maturity': 'Tie-in redesign after potholing' } as Record<string, string>)[rc] ?? rc
}

function seedSupporting(s: AppState, p: Project, R: ReturnType<typeof rng>, target: number, small: boolean, closed: boolean, gateDates: string[]) {
  const designIdx = small ? 1 : 2
  const consIdx = small ? 2 : 3
  // permits
  if (target >= (small ? 1 : 1)) {
    const permits = [
      p.permitsNeeded.encroachment ? { agency: `City of ${p.location.city}`, type: 'Encroachment permit' } : null,
      p.permitsNeeded.hydrotestDischarge ? { agency: 'Regional Water Quality Board', type: 'Hydrotest discharge permit' } : null,
      p.permitsNeeded.ceqa ? { agency: 'Lead agency (CEQA)', type: 'CEQA exemption / initial study' } : null,
      p.asset.type === 'compressor-station' ? { agency: 'Air Quality Management District', type: 'Permit to construct' } : null,
    ].filter(Boolean) as { agency: string; type: string }[]
    for (const pm of permits) {
      const issued = target > designIdx || closed || R.chance(0.3)
      s.permits.push({
        id: uid('pmt'), projectId: p.id, agency: pm.agency, type: pm.type, number: `${pm.type.split(' ')[0].slice(0, 3).toUpperCase()}-${R.int(10000, 99999)}`, status: issued ? 'issued' : R.pick(['applied', 'not-applied']), applied: addDays(gateDates[0], R.int(60, 200)), issued: issued ? addDays(gateDates[Math.min(designIdx, gateDates.length - 1)], -R.int(10, 60)) : undefined, expires: issued ? addDays(AS_OF, R.int(-5, 300)) : undefined,
        conditions: [
          { id: uid('pc'), text: pm.type.startsWith('Encroach') ? 'No work 7–9 AM and 4–6 PM on arterials' : pm.type.startsWith('Hydro') ? 'Dechlorinate and sample discharge every 4 hours' : pm.type.startsWith('Permit to') ? 'Source test within 60 days of startup' : 'Biological monitor present during ground disturbance', status: R.chance(0.5) ? 'met' : 'open', due: addDays(AS_OF, R.int(-20, 120)) },
          { id: uid('pc'), text: 'Notify agency 48 hours before start', status: 'met' },
        ],
      })
    }
  }
  // land rights
  if (!['compressor-station'].includes(p.asset.type) && target >= 1) {
    for (let i = 0; i < R.int(2, 6); i++) s.landRights.push({ id: uid('lr'), projectId: p.id, parcel: `APN ${R.int(100, 999)}-${R.int(100, 999)}-${R.int(10, 99)}`, owner: R.pick(['Private owner', 'City', 'County flood control', 'Railroad', 'Water district', 'Private owner']), type: R.pick(['Temporary right of entry', 'Permanent easement', 'License'] as const), status: target > designIdx || closed ? 'acquired' : R.pick(['identified', 'negotiating', 'acquired'] as const), needBy: addDays(gateDates[designIdx], -R.int(0, 60)), cost: R.int(15, 420) * 1000 })
  }
  // contracts & long lead
  const pos = s.budgets.filter((b) => b.projectId === p.id).pop()
  if (target >= designIdx || closed) {
    const total = pos?.total ?? 5_000_000
    const awarded = target > designIdx || closed
    s.contracts.push({ id: uid('ctr'), projectId: p.id, number: `4600${R.int(10000, 99999)}`, vendor: p.contractor ?? R.pick(CONTRACTORS), type: 'Construction', value: Math.round(total * 0.48), changeOrders: awarded ? Math.round(total * R.range(0, 0.05)) : 0, invoiced: awarded ? Math.round(total * (closed ? 0.5 : R.range(0.1, 0.4))) : 0, status: closed ? 'closed' : awarded ? 'active' : 'rfp', awarded: awarded ? gateDates[designIdx] : undefined })
    s.contracts.push({ id: uid('ctr'), projectId: p.id, number: `4600${R.int(10000, 99999)}`, vendor: R.pick(['Juniper Gate Engineering Co.', 'Tidewell Design Co.']), type: 'Engineering', value: Math.round(total * 0.06), changeOrders: 0, invoiced: Math.round(total * 0.05), status: closed ? 'closed' : 'active', awarded: gateDates[0] })
    const items = p.asset.type === 'compressor-station' ? ['Electric-drive compressor packages', 'Main transformer', 'Motor control center'] : p.asset.type === 'valve-site' ? ['Ball valves with actuators', 'RTU cabinets'] : p.asset.type === 'distribution-main' ? ['PE pipe and fittings'] : [`${p.asset.diameterIn}" line pipe, FBE coated`, 'Mainline ball valves', 'Hot tap fittings']
    for (const it of items) {
      const need = addDays(gateDates[designIdx], R.int(20, 90))
      const eta = addDays(need, R.pick([-30, -10, 0, 12, 40]))
      s.longLead.push({ id: uid('ll'), projectId: p.id, item: it, qty: it.includes('pipe') ? `${Math.round(p.asset.lengthFt * 1.05).toLocaleString()} ft` : `${R.int(1, 6)} ea`, vendor: R.pick(['Redrock Steel Mill Co.', 'Gravelpoint Valve Co.', 'Hollyhock Electric Co.', 'Ribbonfern Poly Co.']), requiredOnSite: need, eta, status: eta < AS_OF ? 'received' : R.pick(['ordered', 'shipped']) })
    }
  }
  // safety plans
  if (target >= designIdx && !closed) {
    const contractor = p.contractor ?? CONTRACTORS[0]
    const cs = s.people.find((x) => x.company === contractor)!
    const acts = p.asset.type === 'compressor-station' ? ['Station work', 'Lifting & rigging', 'Welding', 'Work near energized lines', 'Heavy equipment', 'All outdoor work'] : p.workMethod === 'hydrotest' ? ['Excavation', 'Pressure testing', 'Purge & blowdown', 'Traffic control', 'All outdoor work', 'Heavy equipment'] : p.workMethod === 'valve-automation' ? ['Excavation', 'Tie-in / hot tap', 'Welding', 'Lifting & rigging', 'All outdoor work'] : ['Excavation', 'Tie-in / hot tap', 'Welding', 'Traffic control', 'Purge & blowdown', 'Heavy equipment', 'All outdoor work', ...(p.workMethod === 'replace-hdd' ? ['HDD'] : [])]
    const hazardIds = HAZARDS.filter((h) => acts.includes(h.activity)).map((h) => h.id)
    const plan: SafetyPlan = {
      id: uid('jssp'), projectId: p.id, workPackage: p.asset.type === 'valve-site' ? 'WP1 Sites' : 'WP1 Segment A', version: 1, status: target > designIdx ? 'draft' : R.pick(['draft', 'draft']) as SafetyPlan['status'], contractor, activities: acts, hazardIds, extraControls: [],
      site: { address: `${R.int(100, 9800)} ${R.pick(['Mission Rd', 'Highland Ave', 'Canyon Dr', 'Ranch Rd', 'Industrial Way'])}, ${p.location.city}`, hospital: `${p.location.city} Regional Medical Center`, hospitalRoute: `North on ${R.pick(['Main St', 'Route 9', 'Valley Blvd'])}, ${R.range(1.5, 9).toFixed(1)} mi, approx. ${R.int(6, 18)} min`, musterPoint: 'Northeast corner of staging yard', contacts: [{ name: s.people.find((x) => x.id === p.team.constructionManager)!.name, role: 'Construction Manager', phone: '(555) 201-4410' }, { name: cs.name, role: 'Contractor Safety', phone: '(555) 388-1902' }, { name: 'Gas Control', role: '24-hour', phone: '(555) 600-0100' }] },
      tickets: [{ id: uid('tk'), type: '811 locate', number: `A${R.int(2600000, 2699999)}`, expires: addDays(AS_OF, R.int(-3, 26)) }, ...(p.permitsNeeded.encroachment ? [{ id: uid('tk'), type: 'Encroachment permit' as const, number: `ENC-${R.int(1000, 9999)}`, expires: addDays(AS_OF, R.int(20, 200)) }] : []), { id: uid('tk'), type: 'Hot work permit' as const, number: `HW-${R.int(100, 999)}`, expires: addDays(AS_OF, R.int(-1, 6)) }],
      crew: Array.from({ length: R.int(5, 9) }, (_, i) => ({ id: uid('crw'), name: R.pick(['J. Alvarez', 'M. Chen', 'D. Okoro', 'T. Brooks', 'S. Patel', 'R. Morales', 'K. Ivanova', 'L. Grant', 'A. Rossi', 'P. Nakamura', 'E. Duarte', 'C. Walsh']) + (i > 9 ? i : ''), company: contractor, role: i === 0 ? 'Foreman' : R.pick(['Welder', 'Operator', 'Laborer', 'Pipe fitter', 'Flagger']), oqTasks: i === 0 ? ['Excavation & backfill', 'Purging', 'Tapping & stopping'] : R.pick([['Welding (qualified procedure)'], ['Excavation & backfill'], [], ['Pressure testing']]), oqExpires: addDays(AS_OF, R.int(-20, 500)), prequal: R.pick(['Compliant', 'Compliant', 'Compliant', 'Conditional'] as const) })),
      heatPlan: true, trafficPlan: p.permitsNeeded.encroachment, createdAt: addDays(AS_OF, -R.int(20, 120)), libraryVersion: '2026.1',
    }
    s.safetyPlans.push(plan)
    if (target > designIdx) {
      s.settings.asOf = addDays(gateDates[designIdx], -25); setClock(s.settings.asOf)
      const inst = startWorkflow(s, 'safety-plan', { title: `${p.code} JSSP ${plan.workPackage} v1`, recordType: 'safety-plan', recordId: plan.id, projectId: p.id, data: { workPackage: plan.workPackage }, startedById: cs.id })
      if (inst) runToEnd(s, inst.id, 'Controls match activities.')
      s.settings.asOf = AS_OF; setClock(AS_OF)
      // tailboards: last 12 working days
      for (let d = 1; d <= 16; d++) {
        const day = addDays(AS_OF, -d)
        const dow = new Date(day + 'T12:00:00Z').getUTCDay()
        if (dow === 0 || dow === 6) continue
        if (d > 2 && R.chance(0.12)) continue // a missed tailboard now and then, as in real life
        s.tailboards.push({ id: uid('tb'), planId: plan.id, projectId: p.id, date: day, leader: plan.crew[0].name, attendees: plan.crew.slice(0, R.int(4, plan.crew.length)).map((c) => c.name), hazardsDiscussed: hazardIds.filter(() => R.chance(0.5)).slice(0, 4), notes: R.pick(['Reviewed traffic setup and excavation entry.', 'Heat plan reviewed — 92°F forecast.', 'Hot tap sequence walked through with gas control.', 'New crew member oriented; stop-work authority reviewed.', 'Spoil pile setback corrected from yesterday observation.']), stopWorkReminder: true })
      }
      for (let i = 0; i < R.int(1, 4); i++) s.safetyEvents.push({ id: uid('se'), projectId: p.id, planId: plan.id, date: addDays(AS_OF, -R.int(1, 60)), type: R.pick(['observation', 'observation', 'near-miss', 'observation'] as const), description: R.pick(['Spoil pile within 2 ft of trench edge', 'Flagger without radio at lane closure', 'Excavator swing radius not barricaded', 'Good catch: crew stopped work when odor detected', 'Ladder extension short of 3 ft above landing', 'Hydration station empty at noon']), sifPotential: R.chance(0.25), correctiveAction: 'Corrected on site; covered at next tailboard', status: R.chance(0.7) ? 'closed' : 'open', contractor })
    } else if (R.chance(0.5)) {
      plan.status = 'draft'
    }
  }
  // records for construction / closeout
  if (target >= consIdx || closed) {
    const types = p.workMethod === 'hydrotest' ? ['Pressure test chart', 'MAOP validation', 'As-built drawing', 'Weld log'] : p.asset.type === 'valve-site' ? ['Weld log', 'NDE report', 'As-built drawing'] : ['Weld log', 'NDE report', 'Pressure test chart', 'Material test report', 'As-built drawing', 'Coating inspection']
    const segs = p.asset.type === 'compressor-station' ? ['Station piping', 'Unit 1', 'Unit 2'] : p.asset.type === 'valve-site' ? ['Site 1'] : ['Segment A', 'Segment B', 'Segment C']
    for (const seg of segs) for (const t of types) s.records.push({ id: uid('rec'), projectId: p.id, type: t as any, segment: seg, status: closed ? 'verified' : R.pick(['missing', 'attached', 'attached', 'verified', 'verified']), fileName: `${t.replace(/ /g, '_')}_${seg.replace(/ /g, '')}.pdf` })
  }
  // closeout checklist
  if ((target >= (small ? 2 : 4)) || closed) {
    const items: [string, any][] = [['In-service date recorded', 'pm'], ['As-builts submitted to GIS', 'engineer'], ['Unitization data to plant accounting', 'project-controls'], ['Open POs and accruals cleared', 'project-controls'], ['Final cost reconciled to ERP', 'finance'], ['Lessons learned captured', 'pm'], ['Records verified complete', 'records'], ['Reasonableness package frozen', 'pmo']]
    for (const [item, role] of items) s.closeout.push({ id: uid('co'), projectId: p.id, item, ownerRole: role, status: closed ? 'done' : R.pick(['done', 'open', 'open']), done: closed ? p.dates.closed : undefined })
  }
  if (closed || target >= (small ? 2 : 3)) {
    s.lessons.push({ id: uid('ll'), projectId: p.id, date: addDays(AS_OF, -R.int(10, 300)), title: R.pick(['Pothole every foreign crossing before Class 3', 'Book outage windows at Gate 2', 'Order pipe at option selection', 'Night-work permits take 60+ days in Coastal cities', 'Hydrotest water source must be secured early']), category: R.pick(['Estimating', 'Permitting', 'Scheduling', 'Procurement', 'Construction']), text: 'Captured from a realized risk on this project; applied to the risk library for similar work.', workMethods: [p.workMethod] })
  }
  // documents, decisions, outreach
  const docs = ['Project charter.pdf', 'Feasibility study.pdf', 'Project execution plan.docx', 'Basis of estimate.pdf', 'Plan and profile set.pdf', 'Permit matrix.xlsx', 'Construction schedule.xer']
  docs.slice(0, 2 + target * 1).forEach((n, i) => s.documents.push({ id: uid('doc'), projectId: p.id, name: n, type: n.split('.').pop()!.toUpperCase(), version: 1 + (i % 3), updated: addDays(AS_OF, -R.int(5, 400)), byId: p.team.pm!, sizeKb: R.int(200, 9000) }))
  s.decisions.push({ id: uid('dec'), projectId: p.id, date: addDays(gateDates[0], 20), decision: p.workMethod === 'hydrotest' ? 'Test rather than replace: records review shows pipe can be tested at 1.5× MAOP' : p.workMethod === 'replace-hdd' ? 'Drill under the wash instead of open-cut crossing' : 'Replace in existing alignment rather than reroute', byId: p.team.sponsor!, alternatives: 'Replace / reroute / derate evaluated in option analysis', evidence: 'Option analysis memo' })
  if (p.location.terrain !== 'rural') s.outreach.push({ id: uid('out'), projectId: p.id, date: addDays(AS_OF, -R.int(3, 90)), type: R.pick(['Notification', 'Meeting', 'Complaint', 'Commitment'] as const), stakeholder: R.pick([`${p.location.city} Public Works`, 'Neighborhood association', 'School district', 'Business improvement district']), summary: R.pick(['Door hangers delivered 72 hours before work', 'Community meeting on night work schedule', 'Complaint about dust on residential street — water truck added', 'Committed to repave full lane width']), status: R.chance(0.6) ? 'closed' : 'open' })
}

function seedLiveWorkflows(s: AppState, R: ReturnType<typeof rng>) {
  const active = s.projects.filter((p) => p.status === 'active')
  // Class 3 estimates in review for design-stage projects (standard stage 2 / small stage 1)
  for (const p of active) {
    const small = templateFor(s, p).id === 'tpl-small'
    if ((small && p.stageIndex === 1) || (!small && p.stageIndex === 2)) {
      const e = makeEstimate(s, p, R, 3, 2)
      pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'estimate-approval', { title: `${p.code} Class 3 estimate v${e.version}`, recordType: 'estimate', recordId: e.id, projectId: p.id, data: { amount: estimateTotals(e).total, cls: '3' }, startedById: p.team.estimator })
      if (inst) advance(s, inst.id, R.int(1, 3))
    }
  }
  // Class 5 requests for new projects: the PM enters length, location and risk ratings (priced from the rate table
  // with a Monte Carlo); an estimator reviews. Assets the rate table cannot price by length use the factor model.
  active.filter((p) => p.stageIndex === 0).forEach((p, i) => {
    pin(s, addDays(AS_OF, -R.int(3, 12)))
    const note = R.pick(['Screening number for the TY2028 GRC forecast', 'Planning budget for Gate 1 business case', 'Portfolio plan placeholder — replace when route is selected'])
    const pin_ = parametricInputsFromProject(s, p)
    const e = (pin_.lengthFt > 0 ? createParametricEstimate(s, p.id, pin_, note, p.team.pm) : undefined) ?? createFactorEstimate(s, p.id, factorInputsFromProject(s, p), note, p.team.pm)
    if (!e) return
    const inst = startWorkflow(s, 'class5-review', { title: `${p.code} Class 5 quick estimate`, recordType: 'estimate', recordId: e.id, projectId: p.id, data: { amount: estimateTotals(e).total, note: e.quick!.requestNote }, startedById: p.team.pm })
    if (!inst) return
    advance(s, inst.id, 1) // submitted → waiting on the estimating team
    if (i === 0) {
      // one already reviewed: adjusted by an estimator with a reason, then approved
      const est = 'u-est1'
      if (e.parametric) adjustParametricEstimate(s, e.id, { risks: { crossings: 'high' }, pct: 0, reason: 'Site condition the drivers do not capture', note: 'Two drills under the flood-control channel; crossings re-rated high.' }, est)
      else adjustFactorEstimate(s, e.id, { pct: 12, reason: 'Site condition the drivers do not capture', note: 'Two HDD crossings under the flood-control channel are not represented in the historical population.' }, est)
      const live = s.workflows.find((w) => w.id === inst.id)
      const slot = live?.active[0]
      if (live && slot) actOnWorkflow(s, live.id, slot.nodeId, est, 'approve', e.parametric ? 'Crossings re-rated high for the channel drills; otherwise in line with the rate table.' : 'Adjusted +12% for the channel crossings; otherwise in line with history.')
    }
  })
  // gate review packets waiting at PMO quality check
  for (const p of active.filter((p) => readiness(s, p).pct >= 50).slice(0, 4)) {
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'gate-review', { title: `${p.code} ${templateFor(s, p).stages[p.stageIndex].gate.name}`, recordType: 'gate', recordId: p.id, projectId: p.id, data: { summary: 'Packet assembled; see readiness.', recommendation: 'Go with conditions' }, startedById: p.team.pm })
    if (inst) advance(s, inst.id, 1)
    s.gateReviews.push({ id: uid('gr'), projectId: p.id, stageIndex: p.stageIndex, scheduled: addDays(s.settings.asOf, R.int(6, 40)), board: [p.team.sponsor!, 'u-pmo2', 'u-vp'], status: 'scheduled' })
  }
  for (const p of active.filter((p) => !s.gateReviews.some((g) => g.projectId === p.id)).slice(0, 5)) s.gateReviews.push({ id: uid('gr'), projectId: p.id, stageIndex: p.stageIndex, scheduled: addDays(s.settings.asOf, R.int(20, 110)), board: [p.team.sponsor!, 'u-pmo2'], status: 'scheduled' })
  // deliverable reviews waiting on PMO
  const submitted = s.deliverables.filter((d) => d.status === 'submitted').slice(0, 7)
  for (const d of submitted) {
    const p = s.projects.find((x) => x.id === d.projectId)!
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'deliverable-review', { title: `${p.code} ${defName(s, d.defId)}`, recordType: 'deliverable', recordId: d.id, projectId: p.id, data: { deliverable: defName(s, d.defId) }, startedById: d.ownerId ?? p.team.pm })
    if (inst) advance(s, inst.id, 1)
  }
  // change requests in flight on construction projects
  for (const p of active.filter((p) => s.budgets.some((b) => b.projectId === p.id && b.kind === 'control')).slice(0, 6)) {
    const amt = R.pick([85_000, 180_000, 420_000, 1_250_000, 3_400_000])
    const ch = { id: uid('chg'), projectId: p.id, code: `CR-${p.code.slice(4)}-${String(s.changes.filter((c) => c.projectId === p.id).length + 1).padStart(2, '0')}`, title: R.pick(['Additional traffic control for school zone', 'Contaminated soil disposal', 'Reroute around new storm drain', 'Extended outage support', 'Pipe coating repair']), type: 'cost' as const, rootCause: R.pick(['Third-party / substructures', 'Permitting', 'Scope growth'] as const), description: 'Field condition documented with photos and contractor quote.', costImpact: amt, scheduleImpactDays: R.pick([0, 10, 35, 60]), scopeImpact: 'None', categoryId: 'cat-contract', fundedFrom: 'contingency' as const, status: 'draft' as const, requestedById: p.team.pm!, requestedAt: s.settings.asOf }
    s.changes.push(ch)
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'change-request', { title: `${ch.code} ${ch.title}`, recordType: 'change', recordId: ch.id, projectId: p.id, data: { amount: amt, scheduleImpactDays: ch.scheduleImpactDays, rootCause: ch.rootCause, justification: ch.description }, startedById: p.team.pm })
    if (inst) advance(s, inst.id, R.int(1, 2))
  }
  // contingency drawdown
  for (const p of active.filter((p) => s.budgets.some((b) => b.projectId === p.id && b.kind === 'control')).slice(2, 4)) {
    const risk = s.risks.find((r) => r.projectId === p.id && r.kind === 'threat')
    const draw = { id: uid('cd'), projectId: p.id, riskId: risk?.id, amount: Math.round((risk?.cost.ml ?? 150000) * 0.8), date: s.settings.asOf, reason: `Realized: ${risk?.title ?? 'field condition'}`, status: 'in-review' as const }
    s.contingencyDraws.push(draw)
    if (risk) risk.status = 'realized'
    pin(s, addDays(AS_OF, -R.int(2, 8)))
    startWorkflow(s, 'contingency-drawdown', { title: `${p.code} contingency for ${risk?.title ?? 'field condition'}`, recordType: 'contingency', recordId: draw.id, projectId: p.id, data: { amount: draw.amount, risk: risk?.title, reason: draw.reason }, startedById: p.team.pm })
  }
  // safety plan in review
  for (const sp of s.safetyPlans.filter((x) => x.status === 'draft').slice(0, 2)) {
    const p = s.projects.find((x) => x.id === sp.projectId)!
    const cs = s.people.find((x) => x.company === sp.contractor)!
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'safety-plan', { title: `${p.code} JSSP ${sp.workPackage} v1`, recordType: 'safety-plan', recordId: sp.id, projectId: p.id, data: { workPackage: sp.workPackage }, startedById: cs.id })
    if (inst) advance(s, inst.id, 1)
  }
  // variances
  for (const p of s.projects.filter((p) => p.status === 'active')) {
    for (const b of thresholdBreaches(s, p)) {
      const v = { id: uid('var'), projectId: p.id, date: s.settings.asOf, metric: b.metric, description: b.description, amount: b.amount, narrative: '', status: 'required' as const, changeIds: [], riskIds: [] }
      s.variances.push(v)
    }
  }
  const firstVar = s.variances[0]
  if (firstVar) {
    const p = s.projects.find((x) => x.id === firstVar.projectId)!
    firstVar.narrative = 'Rock excavation in Segment B reduced productivity 30%; contractor added a second crew. Remaining footage is in soil, so CPI should recover.'
    firstVar.rootCause = 'Productivity'
    firstVar.authorId = p.team.pm
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'variance-explanation', { title: `${p.code} variance: ${firstVar.description}`, recordType: 'variance', recordId: firstVar.id, projectId: p.id, data: { rootCause: 'Productivity', narrative: firstVar.narrative }, startedById: p.team.pm })
    if (inst) advance(s, inst.id, 2)
  }
  // November forecast cycle: a few construction projects have submitted spreads in review
  for (const p of active.filter((p) => s.budgets.some((b) => b.projectId === p.id && b.kind === 'control')).slice(0, 4)) {
    const last = s.forecasts.filter((f) => f.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date)).pop()
    if (!last) continue
    const fc = { ...last, id: uid('fc'), date: addDays(AS_OF, -2), note: 'November cycle — construction re-profiled to the contractor\'s mobilization plan; project support weighted to closeout', status: 'draft' as const, locked: false, workflowInstanceId: undefined, spread: JSON.parse(JSON.stringify(last.spread ?? {})), lineSpread: JSON.parse(JSON.stringify(last.lineSpread ?? {})), profiles: JSON.parse(JSON.stringify(last.profiles ?? {})) }
    const months = Object.keys(Object.values(fc.lineSpread)[0] ?? {}).sort()
    if (months.length > 2) {
      const cons = { profileId: 'prof-mobilize', start: months[0], end: months[Math.max(1, Math.floor(months.length * 0.75))], adjusted: true, appliedAt: `${addDays(AS_OF, -2)}T16:00:00.000Z` }
      Object.assign(fc.lineSpread, applyProfile(s, p, fc, 'wbs-500', cons))
      // hand adjustment after applying the profile: pull $150k of contract construction forward a month
      const l = fc.lineSpread['fl-500-10']
      if (l && months.length > 3 && l[months[2]] > 150_000) { l[months[2]] -= 150_000; l[months[1]] += 150_000 }
      fc.profiles['wbs-500'] = cons
      fc.profiles['wbs-800'] = { profileId: 'prof-closeout', start: months[0], end: months[months.length - 1], adjusted: false, appliedAt: cons.appliedAt }
      Object.assign(fc.lineSpread, applyProfile(s, p, fc, 'wbs-800', fc.profiles['wbs-800']))
      syncForecast(s, fc)
    }
    s.forecasts.push(fc)
    pin(s, addDays(AS_OF, -2))
    const inst = startWorkflow(s, 'forecast-review', { title: `${p.code} November forecast`, recordType: 'forecast', recordId: fc.id, projectId: p.id, data: { amount: fc.eac, period: '2026-11', note: fc.note }, startedById: p.team.pm })
    if (inst) advance(s, inst.id, 1)
  }
  // waiver and initiation waiting on PMO
  const wp = active.find((p) => p.stageIndex === 1)
  if (wp) {
    const d = s.deliverables.find((x) => x.projectId === wp.id && x.stageIndex === wp.stageIndex && x.status !== 'accepted')
    pin(s, addDays(AS_OF, -R.int(3, 14)))
      const inst = startWorkflow(s, 'waiver', { title: `${wp.code} early release of long-lead pipe`, recordType: 'waiver', recordId: wp.id, projectId: wp.id, data: { reason: 'Mill lead time is 38 weeks; releasing the pipe order before Gate 2 protects the outage window.', permission: 'long-lead-release', deliverableId: d?.id }, startedById: wp.team.pm })
    if (inst) advance(s, inst.id, 1)
  }
  pin(s, addDays(AS_OF, -R.int(3, 14)))
  const ini = startWorkflow(s, 'project-initiation', { title: 'New need: Line AV-27 river crossing exposure', recordType: 'initiation', recordId: 'need-7100', data: { need: 'Scour survey found 40 ft of exposed pipe at the Arroyo Seco crossing after winter storms.', amount: 6_500_000 }, startedById: 'u-pgm2' })
  if (ini) advance(s, ini.id, 2)
}
const defName = (s: AppState, id: string) => { for (const t of s.templates) for (const st of t.stages) { const d = st.gate.deliverables.find((x) => x.id === id); if (d) return d.name } return id }

function seedFunding(s: AppState) {
  const R = rng(99)
  for (const prog of s.programs) {
    const budgets = s.projects.filter((p) => p.programId === prog.id).map((p) => s.budgets.filter((b) => b.projectId === p.id).pop()).filter(Boolean)
    for (let y = 2024; y <= 2031; y++) {
      const planned = sum(budgets.map((b) => b!.byYear[String(y)] ?? 0))
      s.funding.push({ id: uid('fund'), programId: prog.id, year: y, authorized: Math.round((planned * R.range(0.88, 1.12) + 2_000_000) / 100000) * 100000, proceeding: y <= 2027 ? 'AV-PUC-D-2024-12 (fictional) (TY2024 GRC)' : 'AV-PUC-2026-06 (fictional) (TY2028 GRC, pending)' })
    }
  }
}

function health(s: AppState) {
  for (const p of s.projects) {
    const pos = position(s, p.id)
    const slip = Math.max(0, ...p.milestones.filter((m) => !m.actual).map((m) => daysBetween(m.baseline, m.forecast)))
    const over = pos.currentBudget ? (pos.eac - pos.currentBudget) / pos.currentBudget : 0
    const highOpen = s.risks.filter((r) => r.projectId === p.id && (r.status === 'open' || r.status === 'mitigating') && r.likelihood * r.consequence >= 15).length
    const sev = s.safetyEvents.filter((e) => e.projectId === p.id && e.sifPotential && e.status === 'open').length
    p.health = {
      scope: s.changes.some((c) => c.projectId === p.id && c.rootCause === 'Scope growth') ? 'amber' : 'green',
      schedule: slip > 60 ? 'red' : slip > 20 ? 'amber' : 'green',
      cost: over > 0.08 ? 'red' : over > 0.02 ? 'amber' : 'green',
      risk: highOpen >= 3 ? 'red' : highOpen >= 1 ? 'amber' : 'green',
      safety: sev ? 'amber' : 'green',
    }
    const total = pos.currentBudget || pos.eac
    p.sizeTier = total > 50_000_000 ? 'L' : total > 5_000_000 ? 'M' : 'S'
    p.lastStatusNote = p.status === 'closed' ? 'Closed; evidence package frozen.' : p.health.cost === 'red' ? 'Forecast above budget; variance explanation in progress.' : p.health.schedule !== 'green' ? 'Schedule pressure from permit timing; recovery plan in place.' : 'On track.'
  }
}

/** Calendar-year forecast: recorded actuals by year + spread ETC by year (+ held contingency in the final year). */
function yearsWithActuals(s: AppState, pid: string, etcYears: Record<string, number>, held: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of s.costPeriods.filter((x) => x.projectId === pid)) out[c.period.slice(0, 4)] = (out[c.period.slice(0, 4)] || 0) + c.actual
  for (const [y, v] of Object.entries(etcYears)) out[y] = (out[y] || 0) + v
  const ys = Object.keys(out).sort()
  if (held && ys.length) out[ys[ys.length - 1]] += held
  return out
}

function infoFor(p: Project, sp: Spec, R: ReturnType<typeof rng>, target: number): Record<string, string> {
  const wm = p.workMethod
  const type = wm === 'hydrotest' ? 'Pressure test' : wm === 'valve-automation' ? 'Valve automation' : p.asset.type === 'compressor-station' ? 'Station modernization' : p.asset.type === 'distribution-main' ? 'Main replacement' : 'Pipe replacement'
  const problem = wm === 'hydrotest'
    ? `Line ${p.asset.lineId} (${p.asset.vintage} vintage, ${p.asset.diameterIn}") lacks a traceable, verifiable and complete strength-test record for ${Math.round(p.asset.lengthFt / 528) / 10} miles in ${p.location.city}.`
    : wm === 'valve-automation' ? `Mainline valves on Line ${p.asset.lineId} are manually operated; rupture isolation depends on crew travel time.`
    : p.asset.type === 'compressor-station' ? `Gas turbine-driven compressors at ${p.location.city} (installed ${p.asset.vintage}) exceed air district NOx limits after 2028 and have rising forced-outage rates.`
    : p.asset.type === 'distribution-main' ? `${p.asset.material} main in ${p.location.city} shows an elevated leak rate under the distribution integrity model.`
    : `Line ${p.asset.lineId} segment through ${p.location.city} (${p.asset.vintage}, ${p.asset.material}) cannot be tested in place and lacks pressure-test records.`
  const info: Record<string, string> = {
    projectType: type,
    workOrder: target >= 2 ? `WOA-${p.code.slice(4)}-${R.int(10, 99)}` : '',
    problemStatement: problem,
    consequence: wm === 'valve-automation' ? 'Longer isolation time after a rupture increases gas released and consequence to the public.' : p.asset.type === 'compressor-station' ? 'Loss of station capacity in peak winter demand; non-compliance penalties.' : 'Pressure reduction or loss of service to downstream customers; regulatory non-compliance.',
    alternatives: wm === 'hydrotest' ? 'Pressure test in place; replace; derate MAOP; in-line inspection with engineering assessment.' : wm === 'replace-hdd' ? 'Open-cut crossing; horizontal directional drill; aerial span; reroute.' : wm === 'valve-automation' ? 'Remote-control valve; automatic shutoff valve; keep manual with added staffing.' : 'Replace in alignment; reroute; derate.',
    selectedRationale: wm === 'hydrotest' ? 'Testing is lowest cost and preserves the asset; records review shows pipe can be tested at 1.5× MAOP.' : wm === 'replace-hdd' ? 'Drilling avoids in-channel work and the related permit timeline.' : 'Lowest life-cycle cost with acceptable construction impact.',
    benefits: 'Restores MAOP records and reduces rupture likelihood in a high consequence area; supports compliance with federal integrity rules.',
    crossings: p.location.terrain === 'urban' ? 'Arterial street crossings; one freeway undercrossing; storm drain conflicts.' : p.location.terrain === 'rural' ? 'Wash crossing; county road; agricultural canal.' : 'Two arterial crossings; railroad spur.',
    grcWorkpaper: p.customFields.grcWorkpaper ?? '',
    ceqaPath: p.permitsNeeded.ceqa ? R.pick(['Exempt', 'Initial study / MND']) : 'Exempt',
    cpcn: p.asset.type === 'compressor-station' ? 'Under review' : 'No',
    outage: target >= 2 || R.chance(0.4) ? R.pick(['October–April window only; gas control requires 10-day notice; bypass sized for 60% of winter peak.', 'Two 72-hour clearances for tie-ins; CNG support for 140 customers during the second tie-in.', 'Station on bypass for 21 days; storage withdrawals curtailed during cutover.']) : '',
    customersAffected: target >= 2 ? String(R.int(0, 1800)) : '',
    temporarySupply: p.asset.type === 'distribution-main' ? 'Service transfers done live; no interruption planned beyond 4 hours per block.' : R.pick(['CNG trailers at two regulator stations.', 'Bypass around work area; no customer interruption.', '']),
    communityImpact: p.location.terrain === 'rural' ? 'Minimal; ranch access maintained.' : 'Lane closures on arterials outside peak hours; door hangers 72 hours ahead; school zone restrictions.',
    constraints: R.pick(['Night work restricted by city noise ordinance.', 'Nesting season (Feb–Aug) limits clearing near the wash.', 'Shared corridor with water district pipeline project in 2027.']),
    workWindows: p.location.terrain === 'urban' ? '7 AM–6 PM weekdays; no work 7–9 AM and 4–6 PM on arterials' : '6 AM–5 PM, Mon–Sat',
    agencies: [`City of ${p.location.city}`, p.location.county, p.permitsNeeded.hydrotestDischarge ? 'Regional Water Quality Board' : '', p.asset.type === 'compressor-station' ? 'Air Quality Management District' : ''].filter(Boolean).join('; '),
    stakeholders: p.location.terrain === 'rural' ? 'Landowners; county roads department' : 'Neighborhood associations; school district; business improvement district',
    assetUnits: target >= 4 || p.status === 'closed' ? (p.asset.type === 'distribution-main' ? `${p.asset.lengthFt.toLocaleString()} ft ${p.asset.diameterIn}" PE main; services transferred` : `${p.asset.lengthFt.toLocaleString()} ft ${p.asset.diameterIn}" steel main; ${R.int(2, 6)} valves`) : '',
    gisUpdated: sp.closed ? 'Yes' : target >= 4 ? 'No' : '',
  }
  // early-stage projects still have a few required fields open — they show up as gate blockers
  if (target <= 1 && R.chance(0.5)) { info.alternatives = ''; info.selectedRationale = '' }
  if (target === 2 && R.chance(0.35)) info.outage = ''
  return info
}

function seedInfoRevisions(s: AppState, R: ReturnType<typeof rng>) {
  for (const p of s.projects) {
    const defs = s.settings.infoFields.filter((f) => !f.readOnly && !f.bind && p.info[f.key])
    const n = R.int(1, 3)
    for (let i = 0; i < n && defs.length; i++) {
      const def = R.pick(defs)
      const to = infoValue(p, def, s)
      const at = `${addDays(s.settings.asOf, -R.int(5, 200))}T${String(R.int(8, 17)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}:00.000Z`
      s.infoRevisions.push({ id: uid('irev'), projectId: p.id, at, byId: R.pick([p.team.pm!, p.team.engineer!, p.team.projectControls!]), note: R.pick(['Updated after design review', 'Gas control comments incorporated', 'Clarified for gate packet', 'Agency feedback']), changes: [{ key: def.key, label: def.label, from: i === 0 ? '' : to.slice(0, Math.max(8, Math.floor(to.length / 2))) + '…', to }] })
    }
  }
}

/** Coordinates, alignments and a fictional pipe network for the demo utility (separate RNG so other data is unchanged). */
function seedGeometry(s: AppState) {
  const G = rng(7171)
  const net = s.settings.gis.demoNetwork
  const bend = (start: LatLng, totalFt: number, bearing: number, steps: number): LatLng[] => {
    const pts: LatLng[] = [start]
    let b = bearing
    for (let i = 0; i < steps; i++) { b += G.range(-14, 14); pts.push(offset(pts[pts.length - 1], totalFt / steps, b)) }
    return pts
  }
  // 1) linear projects get an alignment; transmission lines extend into the demo network
  for (const p of s.projects) {
    const [lat, lng] = xyToLatLng(p.location.x, p.location.y)
    p.location.lat = lat; p.location.lng = lng
    if (p.asset.type === 'transmission-pipeline' || p.asset.type === 'distribution-main') {
      const bearing = G.range(0, 360)
      const len = Math.max(2500, p.asset.lengthFt)
      const startPt = offset([lat, lng], len / 2, bearing + 180)
      const route = bend(startPt, len, bearing, Math.max(5, Math.min(14, Math.round(len / 2500))))
      p.location.route = route
      p.location.routeSource = p.stageIndex >= 2 || p.status === 'closed' ? 'GIS (as-designed alignment)' : 'Drawn on map'
      const mid = route[Math.floor(route.length / 2)]
      p.location.lat = mid[0]; p.location.lng = mid[1]
      if (p.asset.type === 'transmission-pipeline' && !net.some((n) => n.id === p.asset.lineId)) {
        const back = bend(route[0], G.range(30000, 70000), bearing + 180, 8).reverse()
        const fwd = bend(route[route.length - 1], G.range(30000, 70000), bearing, 8)
        net.push({ id: p.asset.lineId, name: `Line ${p.asset.lineId}`, maopPsig: p.asset.maopPsig, diameterIn: p.asset.diameterIn, coords: [...back.slice(0, -1), ...route, ...fwd.slice(1)] })
      }
    } else {
      p.location.routeSource = 'Site point'
    }
  }
  // 2) valve sites sit on their line; stations get a short trunk tie
  for (const p of s.projects.filter((x) => x.asset.type === 'valve-site')) {
    let line = net.find((n) => n.id === p.asset.lineId)
    if (!line) { line = { id: p.asset.lineId, name: `Line ${p.asset.lineId}`, maopPsig: 720, diameterIn: p.asset.diameterIn, coords: bend(offset([p.location.lat!, p.location.lng!], 40000, 250), 80000, 70, 12) }; net.push(line) }
    const v = line.coords[G.int(2, Math.max(2, line.coords.length - 3))]
    p.location.lat = v[0]; p.location.lng = v[1]
  }
  const stations = s.projects.filter((x) => x.asset.type === 'compressor-station')
  for (let i = 0; i < stations.length - 1; i++) {
    const a: LatLng = [stations[i].location.lat!, stations[i].location.lng!], b: LatLng = [stations[i + 1].location.lat!, stations[i + 1].location.lng!]
    const mid: LatLng = [(a[0] + b[0]) / 2 + G.range(-0.08, 0.08), (a[1] + b[1]) / 2 + G.range(-0.08, 0.08)]
    net.push({ id: `T-${i + 1}`, name: `Trunk Line ${3000 + i * 100}`, maopPsig: 975, diameterIn: 36, coords: [a, mid, b] })
  }
}

/**
 * SAP actuals for the last three closed periods (and a staged October extract with exceptions) are generated
 * from the seeded cost periods and run through the real import → mapping → post path, so line-level actuals,
 * the allocation of loader settlements and the transaction drill-down all come from the engine.
 */
function seedSapActuals(s: AppState) {
  const R = rng(6060)
  const ceFor: Record<string, [string, string, string[]]> = {
    'fl-100': ['5800110', 'Project management services', ['Wrenwood Project Controls Co.', 'Cobalt Mesa Engineering Co.']],
    'fl-200': ['5400110', 'Outside engineering services', ['Cobalt Mesa Engineering Co.', 'Tidewell Design Co.']],
    'fl-300-10': ['5310110', 'Material — line pipe', ['Foxtail Pipe & Supply Co.', 'Ironbark Valve Supply Co.']],
    'fl-300-20': ['5320110', 'Material — valves', ['Ironbark Valve Supply Co.']],
    'fl-300-30': ['5330110', 'Material — major equipment', ['Copperhawk Compression Co.', 'Brightvale Electric Supply Co.']],
    'fl-390': ['5610110', 'Test water & temporary bypass', ['Driftwood Hydrotest Co.']],
    'fl-400': ['5340110', 'Shop fabrication', ['Copperhawk Compression Co.']],
    'fl-500-10': ['5200110', 'Contract services — construction', ['Kestrel Ridge Pipeline Co.', 'Pinecone Builders Co.']],
    'fl-500-20': ['5710110', 'Traffic control services', ['Cactus Wren Traffic Co.']],
    'fl-500-30': ['5700110', 'Paving & restoration', ['Bluejay Paving Co.']],
    'fl-500-40': ['5600110', 'Inspection services — NDE', ['Larkspur Inspection Co.']],
    'fl-600': ['5620110', 'Commissioning services', ['Copperhawk Compression Co.']],
    'fl-700': ['5100110', 'Company labor — straight time', ['']],
    'fl-800': ['5810110', 'Project support services', ['Wrenwood Project Controls Co.']],
    'fl-850': ['5510110', 'Environmental consultants', ['Quillfeather Environmental Co.', 'Sagebrush Biological Co.']],
    'fl-860': ['5500110', 'Easements & rights of entry', ['Saltgrass Title Co.', 'Owlcreek Land Services Co.']],
    'fl-870': ['5520110', 'Land purchase', ['Saltgrass Title Co.']],
    'fl-880': ['5530110', 'Permit fees', ['City of Arroyo Valley']],
    'fl-999': ['5980110', 'Undifferentiated project cost', ['']],
  }
  const loaders: [string, string, number][] = [['5900110', 'A&G overhead settlement', 0.47], ['5900120', 'Payroll taxes & benefits loader', 0.29], ['5900130', 'AFUDC', 0.24]]
  let doc = 4900500000
  const rowsFor = (period: string): SapRow[] => {
    const rows: SapRow[] = []
    const [y, m] = period.split('-')
    const date = () => `${y}-${m}-${String(R.int(3, 27)).padStart(2, '0')}`
    const cents = (v: number) => Math.round(v * 100) / 100
    for (const cp of s.costPeriods.filter((c) => c.period === period && c.byLine && c.actual > 0)) {
      const p = s.projects.find((x) => x.id === cp.projectId)
      if (!p) continue
      for (const [lid, amt] of Object.entries(cp.byLine!)) {
        if (!amt) continue
        type Part = readonly [string, string, number, string]
        let parts: Part[]
        if (lid === 'fl-900') parts = loaders.map(([ce, name, sh]) => [ce, name, cents(amt * sh), p.erpWbs] as const)
        else {
          const [ce, name] = ceFor[lid] ?? ['5980110', 'Undifferentiated project cost', ['']]
          parts = lid === 'fl-200' ? [[ce, name, cents(amt * 0.6), p.erpWbs], ['5100110', 'Company labor — straight time', 0, `${p.erpWbs}.02`]]
            : amt > 60_000 ? [[ce, name, cents(amt * R.range(0.35, 0.65)), p.erpWbs], [ce, name, 0, p.erpWbs]] : [[ce, name, amt, p.erpWbs]]
        }
        const vendors = ceFor[lid]?.[2] ?? ['']
        let acc = 0
        parts.forEach((pt, i) => {
          const v = i === parts.length - 1 ? cents(amt - acc) : pt[2]
          acc = cents(acc + v)
          const settle = lid === 'fl-900'
          rows.push({ sapWbs: pt[3], costElement: pt[0], costElementName: pt[1], period, postingDate: settle ? `${y}-${m}-28` : date(), amount: v, vendor: settle || pt[0].startsWith('51') ? '' : R.pick(vendors), docNo: String(doc++), text: settle ? 'Period-end settlement' : `${p.code} ${pt[1].split(' — ')[0].toLowerCase()}` })
        })
      }
    }
    return rows
  }
  const fy = (period: string) => `CJI3_FY${period.slice(0, 4)}_P${period.slice(5)}.csv`
  for (const period of ['2026-07', '2026-08', '2026-09']) {
    const close = addDays(addMonths(period + '-01', 1), 4)
    pin(s, close)
    const imp = stageImport(s, rowsFor(period), fy(period), 'u-pc1')
    imp.note = 'Month-end close extract'
    advanceClock(s, 1)
    postImport(s, imp.id, 'u-pc1')
  }
  // October: weekly extract staged with three exceptions waiting on project controls
  pin(s, addDays(AS_OF, -1))
  const rows = rowsFor('2026-10')
  const p0 = s.projects.find((p) => p.status === 'active' && s.costPeriods.some((c) => c.projectId === p.id && c.period === '2026-10' && c.actual > 0))
  if (p0) {
    rows.push({ sapWbs: p0.erpWbs, costElement: '5450110', costElementName: 'Software subscriptions', period: '2026-10', postingDate: '2026-10-15', amount: 12_480, vendor: 'Mapleleaf Field Software Co.', docNo: String(doc++), text: 'Field data collection licenses' })
    rows.push({ sapWbs: 'C.PSE.9999', costElement: '5200110', costElementName: 'Contract services — construction', period: '2026-10', postingDate: '2026-10-18', amount: 48_210.55, vendor: 'Kestrel Ridge Pipeline Co.', docNo: String(doc++), text: 'Pay app 7 — WBS keyed incorrectly' })
    rows.push({ sapWbs: p0.erpWbs, costElement: '5200110', costElementName: 'Contract services — construction', period: '2026-10', postingDate: '2026-10-20', amount: -15_000, vendor: 'Kestrel Ridge Pipeline Co.', docNo: String(doc++), text: 'Credit memo — backcharge for damaged coating' })
    rows.push({ sapWbs: p0.erpWbs, costElement: '1400110', costElementName: 'Inventory transfer — pipe stock', period: '2026-10', postingDate: '2026-10-21', amount: 86_400, vendor: '', docNo: String(doc++), text: 'Pipe transferred from storeroom (balance sheet)' })
  }
  const oct = stageImport(s, rows, 'CJI3_FY2026_P10_wk4.csv', 'u-pc1')
  oct.note = 'Weekly extract — October period still open'
  void resolveTxn
}
const advanceClock = (s: AppState, days: number) => { const d = addDays(s.settings.asOf, days); s.settings.asOf = d; setClock(d) }

const QT_BY_LABEL: Record<string, string> = Object.fromEntries(QUANTITY_TYPES.map((q) => [q.label, q.id]))
const COUNTY_NEIGHBOR: Record<string, string> = { 'Coastline County': 'Arroyo County', 'Arroyo County': 'Sierra Mesa County', 'Sierra Mesa County': 'Arroyo County' }

/** Financial accounts (WOA + internal orders), counties, capital/O&M split, quantity types and commitment details. */
function seedFinance(s: AppState) {
  const R = rng(9393)
  for (const p of s.projects) {
    const n = p.code.slice(4)
    // scope statement: capital share and quantity types
    p.scope.capitalPct = p.workMethod === 'hydrotest' ? R.pick([35, 40, 45]) : p.asset.type === 'compressor-station' ? 100 : R.pick([85, 90, 95, 100])
    for (const q of p.scope.quantities) q.typeId = QT_BY_LABEL[q.label]
    // counties: long pipelines sometimes cross a county line
    p.counties = p.asset.lengthFt > 15000 && R.chance(0.5)
      ? [{ county: p.location.county, pct: 70 }, { county: COUNTY_NEIGHBOR[p.location.county] ?? p.location.county, pct: 30 }]
      : [{ county: p.location.county, pct: 100 }]
    // WOA + IOs once the project is funded past initiation
    const ios: InternalOrder[] = []
    if (p.stageIndex >= 1 || p.status === 'closed') {
      const open = p.stageIndex >= 2 || p.status === 'closed'
      const capFns = ['wbs-100', 'wbs-200', 'wbs-300', 'wbs-500', 'wbs-600', 'wbs-700', 'wbs-800', 'wbs-860', 'wbs-870', 'wbs-880', 'wbs-900']
      ios.push({ id: uid('io'), number: `71${n}01`, description: `${p.code} capital`, type: 'capital', status: p.status === 'closed' ? 'closed' : open ? 'open' : 'requested', opened: open ? addDays(AS_OF, -R.int(60, 500)) : undefined, functionIds: capFns })
      if ((p.scope.capitalPct ?? 100) < 100) ios.push({ id: uid('io'), number: `72${n}01`, description: `${p.code} O&M`, type: 'om', status: p.status === 'closed' ? 'closed' : open ? 'open' : 'requested', opened: open ? addDays(AS_OF, -R.int(60, 500)) : undefined, functionIds: ['wbs-390', 'wbs-850', 'wbs-999'] })
    }
    p.finance = { woa: p.stageIndex >= 1 || p.status === 'closed' ? `WOA-${n}-${R.int(10, 99)}` : undefined, ios }
    // material commitments for projects that have reached design/procurement
    const bud = toLines(s, s.budgets.filter((b) => b.projectId === p.id).pop()?.byCategory ?? {}).byLine
    const mat = (bud['fl-300-10'] || 0) + (bud['fl-300-20'] || 0) + (bud['fl-300-30'] || 0)
    if (mat > 0 && s.contracts.some((c) => c.projectId === p.id) && !s.contracts.some((c) => c.projectId === p.id && c.type === 'Materials')) {
      const con = s.contracts.find((c) => c.projectId === p.id && c.type === 'Construction')
      s.contracts.push({ id: uid('ctr'), projectId: p.id, number: `4600${R.int(10000, 99999)}`, vendor: p.asset.type === 'compressor-station' ? 'Copperhawk Compression Co.' : R.pick(['Foxtail Pipe & Supply Co.', 'Ironbark Valve Supply Co.']), type: 'Materials', value: Math.round(mat * R.range(0.9, 1.0)), changeOrders: 0, invoiced: con && con.status !== 'rfp' ? Math.round(mat * R.range(0.6, 0.95)) : 0, status: con?.status === 'closed' ? 'closed' : con && con.status !== 'rfp' ? 'active' : 'awarded', awarded: con?.awarded })
    }
    // commitments (call-offs) against blanket POs
    const cap = ios.find((i) => i.type === 'capital')
    for (const k of s.contracts.filter((c) => c.projectId === p.id)) {
      const blanket = k.type === 'Construction' || R.chance(0.5)
      k.poNumber = `45${R.int(10000000, 99999999)}`
      k.poTotal = blanket ? Math.round(k.value / R.range(0.08, 0.3) / 1000) * 1000 : k.value
      k.pctOfPo = k.poTotal ? Math.round((k.value / k.poTotal) * 1000) / 10 : 100
      k.scope = k.type === 'Construction' ? `Installation, tie-ins and restoration for ${p.name}` : k.type === 'Engineering' ? 'Detailed design, survey and IFC package' : k.type === 'Materials' ? 'Line pipe, fittings, valves and actuators per bill of materials' : `${k.type} services`
      k.lineIds = k.type === 'Construction' ? ['fl-500-10', 'fl-500-20', 'fl-500-30'] : k.type === 'Engineering' ? ['fl-200'] : k.type === 'Inspection' ? ['fl-500-40'] : k.type === 'Environmental' ? ['fl-850'] : ['fl-300-10', 'fl-300-20', 'fl-300-30']
      k.ioId = cap?.id
    }
  }
}

/** RFI / change orders against commitments: approved history plus a few in review. */
function seedCommitmentChanges(s: AppState) {
  const R = rng(5151)
  const RFIS = [
    ['Unmarked 12" water main at Sta 42+10 conflicts with alignment', 'Reroute 180 ft around the conflict; additional potholing'],
    ['Rock encountered below 6 ft between Sta 18+00 and 21+50', 'Rock excavation and select backfill'],
    ['City requires full-lane slurry seal instead of trench cap', 'Additional paving per encroachment permit condition'],
    ['Abandoned steel casing found at the creek crossing', 'Remove casing and dispose; 2 days standby'],
    ['Night work required by city for the intersection tie-in', 'Night-shift premium and lighting'],
  ]
  const cons = s.contracts.filter((c) => c.type === 'Construction' && (c.status === 'active' || c.status === 'closed'))
  let k = 0
  for (const c of cons) {
    const p = s.projects.find((x) => x.id === c.projectId)!
    const nApproved = R.int(1, 3)
    for (let i = 0; i < nApproved + (c.status === 'active' && k < 4 ? 1 : 0); i++) {
      const [rfi, desc] = R.pick(RFIS)
      const amount = Math.round((c.value * R.range(0.004, 0.02)) / 500) * 500
      const cc = { id: uid('cco'), projectId: p.id, contractId: c.id, code: `CCO-${p.code.slice(4)}-${String(i + 1).padStart(2, '0')}`, rfi, description: desc, amount, scheduleImpactDays: R.pick([0, 0, 2, 5]), status: 'draft' as const, requestedById: p.team.pm!, requestedAt: addDays(AS_OF, -R.int(20, 200)) }
      s.commitmentChanges.push(cc)
      const live = i >= nApproved
      pin(s, live ? addDays(AS_OF, -R.int(2, 6)) : cc.requestedAt)
      const inst = startWorkflow(s, 'commitment-change', { title: `${cc.code} ${rfi.slice(0, 48)}`, recordType: 'commitment-change', recordId: cc.id, projectId: p.id, data: { amount, scheduleImpactDays: cc.scheduleImpactDays, rfi }, startedById: p.team.pm })
      if (inst) live ? (advance(s, inst.id, R.int(1, 2)), k++) : runToEnd(s, inst.id, 'Condition verified in the field; pricing checked against unit rates.')
    }
  }
  pin(s, AS_OF)
  // tie a few approved project changes to the commitments they affect
  for (const ch of s.changes.filter((x) => x.status === 'approved').slice(0, 12)) {
    const c = s.contracts.find((x) => x.projectId === ch.projectId && x.type === 'Construction')
    if (c) ch.contractIds = [c.id]
  }
  // the original seed folded changes into changeOrders; recompute from the approved RFI / CCOs so they tie out
  for (const c of s.contracts) c.changeOrders = sum(s.commitmentChanges.filter((x) => x.contractId === c.id && x.status === 'approved').map((x) => x.amount))
}

/** Project channels and a direct conversation so the messaging view opens with real context. */
function seedMessages(s: AppState) {
  const R = rng(7272)
  const active = s.projects.filter((p) => p.status === 'active' && p.stageIndex >= 2).slice(0, 5)
  const lines = [
    'Pothole results are in the project folder — two conflicts at the east tie-in.',
    'Can we move the outage to the 18th? Gas control is asking.',
    'Updated the forecast spread for November; construction re-profiled to the contractor plan.',
    'Permit condition 7 needs a monitor on site during trenching near the creek.',
    'CCO for the rock excavation is in your queue.',
    'Scheduler: please reflect the 5-day slip on the crossing in P6.',
    'Closeout checklist started; as-builts due from the contractor next week.',
  ]
  for (const p of active) {
    const members = Array.from(new Set(Object.values(p.team).filter(Boolean) as string[]).add('u-me'))
    const ch = { id: uid('ch'), kind: 'project' as const, projectId: p.id, memberIds: members, name: `${p.code} team` }
    s.channels.push(ch)
    for (let i = 0; i < R.int(3, 6); i++) {
      const from = R.pick(members.filter((m) => m !== 'u-me'))
      s.messages.push({ id: uid('msg'), channelId: ch.id, fromId: from, at: `${addDays(AS_OF, -R.int(0, 9))}T${String(R.int(14, 23)).padStart(2, '0')}:${String(R.int(0, 59)).padStart(2, '0')}:00.000Z`, text: R.pick(lines), readBy: R.chance(0.6) ? [from, 'u-me'] : [from] })
    }
  }
  const dm = { id: uid('ch'), kind: 'direct' as const, memberIds: ['u-me', 'u-pc1'], name: '' }
  s.channels.push(dm)
  s.messages.push({ id: uid('msg'), channelId: dm.id, fromId: 'u-pc1', at: `${addDays(AS_OF, -1)}T18:12:00.000Z`, text: 'The October SAP extract has four exceptions. Can you look at the C.PSE.9999 row before I post?', readBy: ['u-pc1'] })
  s.messages.sort((a, b) => a.at.localeCompare(b.at))
}
