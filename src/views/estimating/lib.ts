// Estimating module helpers (pure functions over AppState). UI lives next to this file.
import type { AaceClass, AppState, Estimate, EstimateLine, LineSource, MonteCarloResult, Project, Risk } from '@/core/types'
import { CLASS_RANGES, CONT_CAT, ESC_CAT, LOADER_CAT, MATURITY_ITEMS, benchmark, computeClass, estimateTotals, lineTotal, maturityItems, missingFor, parametricLines, type EstimateTotals, type MaturityItem } from '@/core/engine/estimates'
import { basisYearOf, contingencyForClass, currentLoaders, escalationPctFor, pricedOnVersion, regionOf, salesTaxFor, scopeQuantities, spendMidpoint } from '@/core/engine/estimatingAdmin'
import { position } from '@/core/engine/position'
import { isActive, pert } from '@/core/engine/risk'
import { templateFor } from '@/core/engine/gates'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { fmtDate, groupBy, money, pct, sum, uid, nowISO } from '@/core/util'

// ───────────────────────────── Lookups
export const directCategories = (s: Pick<AppState, 'categories'>) => s.categories.filter((c) => c.group === 'direct')

export const projectEstimates = (s: Pick<AppState, 'estimates'>, pid: string) =>
  s.estimates.filter((e) => e.projectId === pid).sort((a, b) => a.version - b.version)

export const latestEstimate = (s: Pick<AppState, 'estimates'>, pid: string): Estimate | undefined => projectEstimates(s, pid).pop()

export const latestApproved = (s: Pick<AppState, 'estimates'>, pid: string): Estimate | undefined =>
  projectEstimates(s, pid).filter((e) => e.status === 'approved').pop()

/** Estimates that were approved at some point (approved or later superseded). */
export const everApproved = (s: Pick<AppState, 'estimates'>, pid: string) => projectEstimates(s, pid).filter((e) => !!e.approvedAt && (e.status === 'approved' || e.status === 'superseded'))

export const isEditable = (e: Estimate) => e.status === 'draft'

export const nextVersion = (s: Pick<AppState, 'estimates'>, pid: string) => Math.max(0, ...projectEstimates(s, pid).map((e) => e.version)) + 1

/** Short labels for chart axes (Waterfall truncates at 14 chars). */
const SHORT: Record<string, string> = {
  'cat-pmc': 'Project mgmt', 'cat-eng': 'Engineering', 'cat-pipe': 'Pipe/fittings', 'cat-valves': 'Valves', 'cat-equipment': 'Equipment',
  'cat-test': 'Consumables', 'cat-fabrication': 'Fabrication', 'cat-contract': 'Construction', 'cat-traffic': 'Traffic',
  'cat-restore': 'Restoration', 'cat-inspect': 'Inspection', 'cat-commission': 'Commissioning', 'cat-co-labor': 'Operations',
  'cat-support': 'Proj. support', 'cat-env': 'Environmental', 'cat-land': 'Land & ROW', 'cat-land-purchase': 'Land purchase',
  'cat-permit-fees': 'Permit fees', 'cat-undiff': 'Undifferent.', [LOADER_CAT]: 'Overhead', [ESC_CAT]: 'Escalation', [CONT_CAT]: 'Contingency',
}
export const shortCat = (s: Pick<AppState, 'categories'>, id: string) => SHORT[id] ?? s.categories.find((c) => c.id === id)?.name ?? id
export const catName = (s: Pick<AppState, 'categories'>, id: string) => s.categories.find((c) => c.id === id)?.name ?? id
export const catCode = (s: Pick<AppState, 'categories'>, id: string) => s.categories.find((c) => c.id === id)?.code ?? ''

export const SOURCE_LABEL: Record<LineSource, string> = { library: 'Rate table', quote: 'Vendor quote', analog: 'Analog project', judgment: 'Estimator judgment' }

/** Plain-language method names (internal ids stay 'parametric' / 'line-item' / 'quick'). */
export const METHOD_LABEL: Record<Estimate['method'], string> = { parametric: 'Rate-table estimate', 'line-item': 'Line-item estimate', quick: 'Historical quick estimate' }
export const methodLabel = (m: Estimate['method']) => METHOD_LABEL[m] ?? m
/** Estimate title in plain language (older records say "parametric"). */
export const displayTitle = (e: Pick<Estimate, 'title'>) => e.title.replace(/\bparametric\b/i, 'rate-table')

// ───────────────────────────── Escalation & contingency guidance
/** Compound escalation from the rate basis year to a target year using the settings table. */
export function escalationTo(s: Pick<AppState, 'settings'>, fromYear: number, toYear: number): number {
  return escalationPctFor(s, fromYear, toYear)
}

/** Year of the spend midpoint: halfway between today and the in-service forecast. */
export const midpointYear = spendMidpoint

/** Product default deterministic contingency by class (the live table is settings.estimating.contingencyByClass). */
export const CONTINGENCY_GUIDE: Record<AaceClass, number> = { 5: 30, 4: 20, 3: 15, 2: 10, 1: 5 }

/** Risk-based contingency: percent of base needed to reach the chosen confidence. */
export function riskBasedPct(mc: Pick<MonteCarloResult, 'costP' | 'baseCost'>, conf: 'P50' | 'P80'): number {
  if (!mc.baseCost) return 0
  return Math.max(0, Math.round(((mc.costP[conf] - mc.baseCost) / mc.baseCost) * 1000) / 10)
}

// ───────────────────────────── Building estimates
/**
 * Inputs to the Class 5 rate-table estimate. They are read from the project's scope statement
 * (quantity types say which input each quantity feeds), the asset record (diameter) and its region.
 */
export interface ParametricInputs { lengthFt: number; diameterIn: number; region: string; sites: number; hp?: number; tieIns?: number; services?: number; terrain: Project['location']['terrain'] }

type CfgState = Pick<AppState, 'settings'>
export function defaultInputs(p: Project, s?: CfgState): ParametricInputs {
  if (s?.settings?.estimating) {
    const q = scopeQuantities(s, p)
    return { lengthFt: q.lengthFt, diameterIn: p.asset.diameterIn, region: regionOf(p), sites: q.sites, hp: q.hp, tieIns: q.tieIns, services: q.services, terrain: p.location.terrain }
  }
  return { lengthFt: p.asset.lengthFt, diameterIn: p.asset.diameterIn, region: regionOf(p), terrain: p.location.terrain, sites: p.scope.quantities.find((q) => q.unit === 'ea' && /site/i.test(q.label))?.qty ?? p.scope.quantities.find((q) => q.unit === 'ea')?.qty ?? 1 }
}

/** Where each input came from (scope statement quantity label, asset record or project location). */
export function inputSources(s: CfgState, p: Project): Record<string, string> {
  const q = scopeQuantities(s, p)
  return { lengthFt: q.sources.lengthFt ?? 'Asset record', sites: q.sources.sites ?? 'Asset record', hp: q.sources.hp ?? '', tieIns: q.sources.tieIns ?? '', services: q.sources.services ?? '', diameterIn: 'Asset record', region: 'Project location' }
}

/** A copy of the project with the estimate's inputs applied (the project record is not changed). */
export function projectForInputs(p: Project, i: ParametricInputs): Project {
  const q = p.scope.quantities.map((x) => ({ ...x }))
  if (p.asset.type === 'valve-site') {
    const k = q.findIndex((x) => x.unit === 'ea' || x.unit === 'site')
    if (k >= 0) q[k].qty = i.sites
    else q.push({ label: 'Valve sites automated', qty: i.sites, unit: 'ea' })
  }
  return { ...p, asset: { ...p.asset, lengthFt: i.lengthFt, diameterIn: i.diameterIn }, location: { ...p.location, terrain: i.terrain ?? p.location.terrain, district: i.region ?? p.location.district }, scope: { ...p.scope, quantities: q } }
}

export function describeInputs(p: Project, i: ParametricInputs): string {
  const reg = i.region ? `${i.region} region` : `${i.terrain} terrain`
  if (p.asset.type === 'valve-site') return `${i.sites} valve site${i.sites === 1 ? '' : 's'}, ${i.diameterIn}" line, ${reg}`
  if (p.asset.type === 'compressor-station' || p.asset.type === 'storage-field') return `One station (lump-sum rate-table rows)${i.hp ? `, ${i.hp.toLocaleString('en-US')} hp` : ''}, ${reg}`
  return `${i.lengthFt.toLocaleString('en-US')} ft of ${i.diameterIn}" pipe${i.tieIns ? `, ${i.tieIns} tie-ins` : ''}, ${reg}`
}

export function blankMaturity(items: MaturityItem[] = MATURITY_ITEMS): Record<string, boolean> {
  return Object.fromEntries(items.map((m) => [m.key, m.forClass === 5]))
}

/** Build a new Class 5 rate-table draft (ES-01) from the scope statement. Not yet pushed into state. */
export function buildParametric(s: AppState, p: Project, inputs: ParametricInputs, byId: string): Estimate {
  const proj = projectForInputs(p, inputs)
  const region = inputs.region ?? regionOf(p)
  const lines = parametricLines(proj, s.rates, { region, regionFactors: s.settings.estimating.regionFactors }, { lengthFt: inputs.lengthFt, sites: inputs.sites, hp: inputs.hp, tieIns: inputs.tieIns, services: inputs.services })
  const items = maturityItems(s)
  const maturity = blankMaturity(items)
  const cls = computeClass(maturity, items)
  const mid = midpointYear(s, p)
  const by = basisYearOf(s, lines)
  const esc = escalationPctFor(s, by, mid)
  const cont = contingencyForClass(s, cls)
  const tax = salesTaxFor(s, p)
  const rf = s.settings.estimating.regionFactors[region] ?? 1
  return {
    id: uid('est'), projectId: p.id, version: nextVersion(s, p.id), title: 'Class 5 rate-table estimate', cls, status: 'draft', method: 'parametric',
    createdAt: nowISO(), createdById: byId, lines, maturity,
    loaders: currentLoaders(s),
    escalationPct: esc,
    contingency: { method: 'deterministic', pct: cont },
    rateTableVersion: s.settings.estimating.rateTableVersion,
    region,
    salesTax: tax,
    basis: {
      scopeBasis: `${p.scope.summary} Rate-table basis: ${describeInputs(p, inputs)}.`,
      assumptions: [
        'Quantities read from the project scope statement',
        `Unit costs at the rate-table median (P50), rate table v${s.settings.estimating.rateTableVersion}, for the ${region} region (region factor ×${rf.toFixed(2)} where no regional rate is kept)`,
        `Escalated from ${by}$ to the ${mid} spend midpoint using the portfolio escalation table`,
        `Sales tax ${tax.pct}% on material (${tax.counties.map((c) => `${c.county} ${Math.round(c.share * 100)}%`).join(', ')})`,
      ],
      exclusions: ['Customer-side work', 'Unknown contamination beyond Phase I findings', 'Escalation beyond the planned in-service year'],
      contingencyRationale: `Deterministic ${cont}% for Class ${cls} per the estimating standard.`,
      classJustification: classJustification(maturity, items),
    },
  }
}

/** Default work packages for a Class 3 split, by asset type. */
export function defaultPackages(p: Project): string[] {
  if (p.asset.type === 'compressor-station') return ['WP1 Equipment', 'WP2 EPC construction', 'WP3 Electrical']
  if (p.asset.type === 'valve-site') return ['WP1 Sites']
  return ['WP1 Segment A', 'WP2 Segment B']
}

/** Split parametric lines into work packages: linear quantities spread evenly, lump sums and counts go to the first package. */
export function splitIntoPackages(lines: EstimateLine[], wps: string[]): EstimateLine[] {
  const pk = wps.length ? wps : ['WP1']
  const out: EstimateLine[] = []
  for (const l of lines) {
    if ((l.unit === 'ft' || l.unit === 'mi') && pk.length > 1) {
      let left = l.qty
      pk.forEach((wp, i) => {
        const q = i === pk.length - 1 ? Math.round(left * 100) / 100 : Math.round((l.qty / pk.length) * 100) / 100
        left -= q
        out.push({ ...l, id: uid('ln'), workPackage: wp, qty: q })
      })
    } else out.push({ ...l, id: uid('ln'), workPackage: pk[0] })
  }
  return out
}

/** New draft version copied from an existing estimate (ES-02). */
export function buildFromExisting(s: AppState, src: Estimate, byId: string, opts: { split?: string[]; toClass3?: boolean } = {}): Estimate {
  const lines = opts.split ? splitIntoPackages(src.lines, opts.split) : src.lines.map((l) => ({ ...l, id: uid('ln') }))
  const maturity = { ...src.maturity }
  const cls = computeClass(maturity, maturityItems(s))
  const p = s.projects.find((x) => x.id === src.projectId)
  // Loaders and escalation are portfolio tables, locked per project: a new version carries the ones in force.
  // Unit costs are copied as they were, so the version keeps the rate table they were priced on.
  const fromQuick = src.method === 'quick'
  const tables = p && !fromQuick ? { escalationPct: escalationPctFor(s, basisYearOf(s, lines), spendMidpoint(s, p)), salesTax: salesTaxFor(s, p), region: regionOf(p) } : {}
  return {
    ...JSON.parse(JSON.stringify(src)) as Estimate,
    id: uid('est'), version: nextVersion(s, src.projectId), status: 'draft', createdAt: nowISO(), createdById: byId,
    approvedAt: undefined, approvedById: undefined, workflowInstanceId: undefined, repricedFrom: undefined,
    title: opts.toClass3 ? 'Class 3 line-item estimate' : fromQuick ? 'Class 5 estimate (from quick estimate)' : src.title,
    method: opts.toClass3 || fromQuick ? 'line-item' : src.method,
    quick: undefined, // a new version is worked as line items; the quick estimate record stays on its own version
    lines, maturity, cls,
    loaders: currentLoaders(s).length ? currentLoaders(s) : src.loaders,
    rateTableVersion: fromQuick ? undefined : pricedOnVersion(s, src),
    ...tables,
  }
}

// ───────────────────────────── Basis of estimate
export function classJustification(m: Record<string, boolean>, items: MaturityItem[] = MATURITY_ITEMS): string {
  const cls = computeClass(m, items)
  const done = items.filter((i) => m[i.key]).map((i) => i.label.toLowerCase())
  const nextMissing = cls > 1 ? missingFor(m, (cls - 1) as AaceClass, items) : []
  const r = CLASS_RANGES[cls]
  return `Class ${cls} (AACE 18R-97; project definition ${r.definition}). Complete: ${done.length ? done.join('; ') : 'none'}.` +
    (nextMissing.length ? ` Not yet complete for Class ${cls - 1}: ${nextMissing.map((i) => i.label.toLowerCase()).join('; ')}.` : '') +
    ` Expected accuracy ${pct(r.low)} to +${pct(r.high)}.`
}

export function contingencyRationale(e: Pick<Estimate, 'contingency' | 'cls'>, mc?: Pick<MonteCarloResult, 'costP' | 'iterations'>, riskCount?: number, guide?: number): string {
  if (e.contingency.method === 'deterministic') {
    const g = guide ?? CONTINGENCY_GUIDE[e.cls]
    return `Deterministic ${e.contingency.pct}% of base` + (e.contingency.pct === g ? ` per the estimating standard for Class ${e.cls}.` : ` (standard for Class ${e.cls} is ${g}%; estimator adjustment documented in assumptions).`)
  }
  return `Risk-based: ${e.contingency.pct}% of base sets the budget at the ${e.contingency.confidence ?? 'P80'} of a Monte Carlo simulation` +
    (mc ? ` (${mc.iterations.toLocaleString('en-US')} iterations; P50 ${money(mc.costP.P50)}, P80 ${money(mc.costP.P80)})` : '') +
    (riskCount != null ? ` over ${riskCount} active quantified risks on the project register.` : ' over the active quantified risk register.')
}

export function sourceSummary(e: Pick<Estimate, 'lines'>): { source: LineSource; n: number; amount: number }[] {
  const g = groupBy(e.lines, (l) => l.source)
  return (['library', 'quote', 'analog', 'judgment'] as LineSource[]).map((src) => ({ source: src, n: g[src]?.length ?? 0, amount: sum((g[src] ?? []).map(lineTotal)) }))
}

export const workPackages = (e: Pick<Estimate, 'lines'>) => Array.from(new Set(e.lines.map((l) => l.workPackage)))

/** Lines more than 25% from the rate-table median for the estimate's region. */
export function benchmarkExceptions(e: Pick<Estimate, 'lines'> & { region?: string }, rates: AppState['rates'], regionFactors?: Record<string, number>) {
  const pr = e.region && regionFactors ? { region: e.region, regionFactors } : undefined
  return e.lines.map((l) => ({ line: l, b: benchmark(l, rates, pr) })).filter((x) => x.b?.flag) as { line: EstimateLine; b: { pct: number; flag: boolean; ref: number } }[]
}

export function activeRisks(s: Pick<AppState, 'risks'>, pid: string): Risk[] {
  return s.risks.filter((r) => r.projectId === pid && isActive(r))
}

// ───────────────────────────── Outcomes & accuracy (ES-13)
export interface Outcome { value: number; basis: 'final' | 'eac' }

/** What a project actually costs: final actuals once closed, else the current EAC once spending has started. */
export function outcomeFor(s: AppState, p: Project): Outcome | null {
  const pos = position(s, p.id)
  if (p.status === 'closed' && pos.actualToDate > 0) return { value: pos.actualToDate, basis: 'final' }
  if (pos.actualToDate > 0 && pos.eac > 0) return { value: pos.eac, basis: 'eac' }
  return null
}

export interface AccuracyPoint {
  projectId: string; code: string; programId: string; estimatorId: string; estimateId: string; version: number
  cls: AaceClass; estimate: number; low: number; high: number; outcome: number; basis: Outcome['basis']; acc: number; within: boolean; approvedAt?: string
}

export function accuracyForProject(s: AppState, p: Project): AccuracyPoint[] {
  const o = outcomeFor(s, p)
  if (!o) return []
  return everApproved(s, p.id).map((e) => {
    const t = estimateTotals(e)
    const acc = o.value / t.total - 1
    const r = CLASS_RANGES[e.cls]
    return { projectId: p.id, code: p.code, programId: p.programId, estimatorId: e.createdById, estimateId: e.id, version: e.version, cls: e.cls, estimate: t.total, low: t.low, high: t.high, outcome: o.value, basis: o.basis, acc, within: acc >= r.low && acc <= r.high, approvedAt: e.approvedAt }
  })
}

export function accuracyPoints(s: AppState, opts: { includeInFlight: boolean } = { includeInFlight: true }): AccuracyPoint[] {
  return s.projects.flatMap((p) => accuracyForProject(s, p)).filter((x) => opts.includeInFlight || x.basis === 'final')
}

export function summarize(points: AccuracyPoint[]) {
  if (!points.length) return { n: 0, mean: 0, meanAbs: 0, min: 0, max: 0, within: 0 }
  const accs = points.map((p) => p.acc)
  return { n: points.length, mean: sum(accs) / accs.length, meanAbs: sum(accs.map(Math.abs)) / accs.length, min: Math.min(...accs), max: Math.max(...accs), within: points.filter((p) => p.within).length / points.length }
}

// ───────────────────────────── Analogs (ES-14)
export interface UnitBasis { unit: 'ft' | 'site' | 'hp' | 'station'; qty: number }
export function unitBasis(p: Project): UnitBasis {
  if (p.asset.type === 'valve-site') return { unit: 'site', qty: p.scope.quantities.find((q) => q.unit === 'ea')?.qty ?? 1 }
  if (p.asset.type === 'compressor-station' || p.asset.type === 'storage-field') {
    const hp = p.scope.quantities.find((q) => q.unit === 'hp')?.qty
    return hp ? { unit: 'hp', qty: hp } : { unit: 'station', qty: 1 }
  }
  return { unit: 'ft', qty: Math.max(1, p.asset.lengthFt) }
}

export interface CostBasis { value: number; basis: 'final' | 'eac' | 'estimate'; label: string; cls?: AaceClass }
export function bestCost(s: AppState, p: Project): CostBasis | null {
  const o = outcomeFor(s, p)
  if (o) return { value: o.value, basis: o.basis, label: o.basis === 'final' ? 'Final cost' : 'Current EAC' }
  const e = latestApproved(s, p.id) ?? latestEstimate(s, p.id)
  if (!e) return null
  return { value: estimateTotals(e).total, basis: 'estimate', label: `Class ${e.cls} estimate`, cls: e.cls }
}

export interface Analog { project: Project; score: number; reasons: string[]; cost: CostBasis | null; perUnit: number | null; unit: UnitBasis }

export function analogs(s: AppState, target: Project): Analog[] {
  const tu = unitBasis(target)
  return s.projects.filter((p) => p.id !== target.id).map((p) => {
    const reasons: string[] = []
    let score = 0
    if (p.asset.type === target.asset.type) { score += 35; reasons.push('Same asset type') }
    if (p.workMethod === target.workMethod) { score += 30; reasons.push('Same work method') }
    const d1 = target.asset.diameterIn, d2 = p.asset.diameterIn
    if (d1 && d2) { const f = 1 - Math.abs(d1 - d2) / Math.max(d1, d2); score += 15 * f; if (d1 === d2) reasons.push(`Same ${d1}" diameter`); else reasons.push(`${d2}" vs ${d1}"`) }
    else if (!d1 && !d2) score += 15
    if (p.location.terrain === target.location.terrain) { score += 10; reasons.push(`${p.location.terrain[0].toUpperCase() + p.location.terrain.slice(1)} terrain`) }
    const u = unitBasis(p)
    if (u.unit === tu.unit) { const f = Math.min(u.qty, tu.qty) / Math.max(u.qty, tu.qty); score += 10 * f }
    if (p.location.district === target.location.district) { score += 3; reasons.push(`${p.location.district} district`) }
    const cost = bestCost(s, p)
    const perUnit = cost && u.unit === tu.unit ? cost.value / u.qty : null
    return { project: p, score: Math.round(Math.min(100, score)), reasons, cost, perUnit, unit: u }
  }).sort((a, b) => b.score - a.score || (b.cost?.basis === 'final' ? 1 : 0) - (a.cost?.basis === 'final' ? 1 : 0))
}

export function perUnitLabel(u: UnitBasis['unit']) {
  return u === 'ft' ? '/ft' : u === 'site' ? '/site' : u === 'hp' ? '/hp' : '/station'
}
export function fmtPerUnit(v: number | null, u: UnitBasis['unit']) {
  if (v == null) return '—'
  return (v >= 1e4 ? money(v) : '$' + Math.round(v).toLocaleString('en-US')) + perUnitLabel(u)
}

// ───────────────────────────── BOE document (ES-08)
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function boeHtml(s: AppState, e: Estimate, opts: { mc?: MonteCarloResult } = {}): { title: string; body: string } {
  const p = s.projects.find((x) => x.id === e.projectId)!
  const t = estimateTotals(e)
  const person = (id?: string) => s.people.find((x) => x.id === id)?.name ?? '—'
  const prog = s.programs.find((x) => x.id === p.programId)
  const r = CLASS_RANGES[e.cls]
  const wf = s.workflows.find((w) => w.id === e.workflowInstanceId)
  const def = wf ? s.workflowDefs.find((d) => d.id === wf.defId) : undefined
  const cats = Object.entries(t.byCategory).sort((a, b) => catCode(s, a[0]).localeCompare(catCode(s, b[0])))
  const srcs = sourceSummary(e)
  const ex = benchmarkExceptions(e, s.rates, s.settings.estimating.regionFactors)
  const title = `${p.code} Basis of Estimate — v${e.version} Class ${e.cls}`
  const wps = workPackages(e)
  const body = `
<h1>Basis of Estimate</h1>
<div class="meta">${esc(s.settings.orgName)} · ${esc(p.code)} ${esc(p.name)} · ${esc(prog?.code)} ${esc(prog?.name)}</div>
<div class="meta">Estimate v${e.version} · ${esc(displayTitle(e))} · <span class="tag">AACE Class ${e.cls}</span> · Status: ${esc(e.status)} · Method: ${esc(methodLabel(e.method))}${e.method !== 'quick' ? ` · Rate table v${pricedOnVersion(s, e)}${e.region ? ` · ${esc(e.region)} region` : ''}` : ''}</div>
<div class="meta">Prepared by ${esc(person(e.createdById))} on ${fmtDate(e.createdAt.slice(0, 10))}${e.approvedAt ? ` · Approved by ${esc(person(e.approvedById))} on ${fmtDate(e.approvedAt.slice(0, 10))}` : ''} · Generated ${fmtDate(s.settings.asOf)}</div>

<h2>1. Estimate summary</h2>
<table><tr><th>Point estimate</th><th>Expected range (AACE Class ${e.cls})</th><th>Base (excl. contingency)</th><th>Contingency</th></tr>
<tr><td class="num"><b>${money(t.total, 'full')}</b></td><td class="num">${money(t.low, 'full')} to ${money(t.high, 'full')} (${pct(r.low)} / +${pct(r.high)})</td><td class="num">${money(t.base, 'full')}</td><td class="num">${money(t.contingency, 'full')} (${e.contingency.pct}%)</td></tr></table>

<h2>2. Scope basis</h2>
<p>${esc(e.basis.scopeBasis)}</p>
${p.scope.quantities.length ? `<table><tr><th>Quantity</th><th class="num">Amount</th><th>Unit</th></tr>${p.scope.quantities.map((q) => `<tr><td>${esc(q.label)}</td><td class="num">${q.qty.toLocaleString('en-US')}</td><td>${esc(q.unit)}</td></tr>`).join('')}</table>` : ''}
<p class="meta">Asset: ${esc(p.asset.lineId)} · ${p.asset.diameterIn ? p.asset.diameterIn + '" ' : ''}${esc(p.asset.material)} · ${p.asset.lengthFt ? p.asset.lengthFt.toLocaleString('en-US') + ' ft · ' : ''}MAOP ${p.asset.maopPsig} psig · ${esc(p.location.terrain)} · Class location ${p.location.classLocation}${p.location.hca ? ' · HCA' : ''}</p>

<h2>3. Cost by category</h2>
<table><tr><th>Code</th><th>Category</th><th>ERP cost element</th><th class="num">Amount</th><th class="num">% of base</th></tr>
${cats.map(([c, v]) => `<tr><td>${esc(catCode(s, c))}</td><td>${esc(catName(s, c))}</td><td>${esc(s.categories.find((x) => x.id === c)?.erpCostElement)}</td><td class="num">${money(v, 'full')}</td><td class="num">${t.base ? pct(v / t.base, 1) : '—'}</td></tr>`).join('')}
<tr><td></td><td><b>Base estimate</b></td><td></td><td class="num"><b>${money(t.base, 'full')}</b></td><td class="num">100%</td></tr>
<tr><td>990</td><td>Contingency (${e.contingency.method}${e.contingency.confidence && e.contingency.method === 'risk-based' ? ', ' + e.contingency.confidence : ''})</td><td>${esc(s.categories.find((x) => x.id === CONT_CAT)?.erpCostElement)}</td><td class="num">${money(t.contingency, 'full')}</td><td class="num">${e.contingency.pct}%</td></tr>
<tr><td></td><td><b>Total estimate</b></td><td></td><td class="num"><b>${money(t.total, 'full')}</b></td><td></td></tr></table>

<h2>4. Markups</h2>
<table><tr><th>Markup</th><th class="num">Rate</th><th class="num">Amount</th></tr>
${e.loaders.map((l) => `<tr><td>${esc(l.name)} (on direct cost)</td><td class="num">${l.pct}%</td><td class="num">${money(Math.round(t.lines * l.pct / 100), 'full')}</td></tr>`).join('')}
${e.salesTax && t.tax ? `<tr><td>Sales tax on material (${e.salesTax.counties.map((c) => `${esc(c.county)} ${Math.round(c.share * 100)}% at ${c.rate}%`).join('; ')})</td><td class="num">${e.salesTax.pct}%</td><td class="num">${money(t.tax, 'full')}</td></tr>` : ''}
<tr><td>Escalation (on direct + tax + loaders)</td><td class="num">${e.escalationPct}%</td><td class="num">${money(t.escalation, 'full')}</td></tr></table>

<h2>5. Line items by work package</h2>
${wps.map((wp) => {
    const ls = e.lines.filter((l) => l.workPackage === wp)
    return `<h3>${esc(wp)} — ${money(sum(ls.map(lineTotal)), 'full')}</h3><table><tr><th>Category</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th class="num">Total</th><th>Source</th><th>Confidence</th></tr>${ls.map((l) => `<tr><td>${esc(catCode(s, l.categoryId))} ${esc(shortCat(s, l.categoryId))}</td><td>${esc(l.description)}</td><td class="num">${l.qty.toLocaleString('en-US')}</td><td>${esc(l.unit)}</td><td class="num">${money(l.unitCost, 'full')}</td><td class="num">${money(lineTotal(l), 'full')}</td><td>${esc(l.source)}</td><td>${esc(l.confidence)}</td></tr>`).join('')}</table>`
  }).join('')}

<h2>6. Sources of pricing</h2>
<table><tr><th>Source</th><th class="num">Lines</th><th class="num">Amount</th><th class="num">% of direct</th></tr>
${srcs.map((x) => `<tr><td>${SOURCE_LABEL[x.source]}</td><td class="num">${x.n}</td><td class="num">${money(x.amount, 'full')}</td><td class="num">${t.lines ? pct(x.amount / t.lines, 1) : '—'}</td></tr>`).join('')}</table>
${ex.length ? `<p><b>Benchmark exceptions</b> (unit cost more than 25% from the rate-table median for the region):</p><table><tr><th>Line</th><th class="num">Unit cost</th><th class="num">Rate-table P50</th><th class="num">Difference</th></tr>${ex.map((x) => `<tr><td>${esc(x.line.workPackage)} · ${esc(x.line.description)}${x.line.override ? ` (override: ${esc(x.line.override.reason)})` : ''}</td><td class="num">${money(x.line.unitCost, 'full')}</td><td class="num">${money(x.b.ref, 'full')}</td><td class="num">${x.b.pct > 0 ? '+' : ''}${pct(x.b.pct, 0)}</td></tr>`).join('')}</table>` : '<p class="meta">No line is more than 25% from its rate-table median.</p>'}

<h2>7. Assumptions</h2>
<ul>${e.basis.assumptions.map((a) => `<li>${esc(a)}</li>`).join('') || '<li>None recorded</li>'}</ul>
<h2>8. Exclusions</h2>
<ul>${e.basis.exclusions.map((a) => `<li>${esc(a)}</li>`).join('') || '<li>None recorded</li>'}</ul>

<h2>9. Contingency rationale</h2>
<p>${esc(e.basis.contingencyRationale)}</p>
${opts.mc && e.contingency.method === 'risk-based' ? `<table><tr><th>P10</th><th>P50</th><th>P80</th><th>P90</th><th>Iterations</th></tr><tr><td class="num">${money(opts.mc.costP.P10, 'full')}</td><td class="num">${money(opts.mc.costP.P50, 'full')}</td><td class="num">${money(opts.mc.costP.P80, 'full')}</td><td class="num">${money(opts.mc.costP.P90, 'full')}</td><td class="num">${opts.mc.iterations}</td></tr></table>` : ''}

<h2>10. Class justification</h2>
<p>${esc(e.basis.classJustification)}</p>
<table><tr><th>Maturity item</th><th>Needed for</th><th>Status</th></tr>
${maturityItems(s).map((m) => `<tr><td>${esc(m.label)}</td><td>Class ${m.forClass}</td><td>${e.maturity[m.key] ? 'Complete' : 'Not complete'}</td></tr>`).join('')}</table>

<h2>11. Review and approval</h2>
${wf ? `<p class="meta">${esc(def?.name)} v${wf.defVersion} · ${esc(wf.status)}</p><table><tr><th>When</th><th>Who</th><th>Action</th><th>Step</th><th>Comment</th></tr>${wf.history.filter((h) => h.action !== 'system').map((h) => `<tr><td>${esc(h.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(h.actorId === 'system' ? 'System' : person(h.actorId))}</td><td>${esc(h.action)}${h.signature ? ' (e-signed)' : ''}</td><td>${esc(def?.nodes.find((n) => n.id === h.nodeId)?.label ?? '')}</td><td>${esc(h.comment ?? '')}</td></tr>`).join('')}</table>` : '<p class="meta">Not yet submitted for approval.</p>'}
`
  return { title, body }
}

/** Compact facts for AI prompts. */
export function estimateFacts(s: AppState, e: Estimate) {
  const p = s.projects.find((x) => x.id === e.projectId)!
  const t: EstimateTotals = estimateTotals(e)
  return {
    project: { code: p.code, name: p.name, program: s.programs.find((x) => x.id === p.programId)?.code, assetType: p.asset.type, workMethod: p.workMethod, diameterIn: p.asset.diameterIn, lengthFt: p.asset.lengthFt, terrain: p.location.terrain, classLocation: p.location.classLocation, hca: p.location.hca, scope: p.scope.summary, inScope: p.scope.inScope, outOfScope: p.scope.outOfScope, quantities: p.scope.quantities },
    estimate: { version: e.version, class: e.cls, method: e.method, total: t.total, base: t.base, low: t.low, high: t.high, loaders: e.loaders, escalationPct: e.escalationPct, contingency: e.contingency },
    byCategory: Object.fromEntries(Object.entries(t.byCategory).map(([k, v]) => [catName(s, k), v])),
    workPackages: workPackages(e).map((wp) => ({ name: wp, total: sum(e.lines.filter((l) => l.workPackage === wp).map(lineTotal)) })),
    lines: e.lines.slice().sort((a, b) => lineTotal(b) - lineTotal(a)).slice(0, 20).map((l) => ({ wp: l.workPackage, desc: l.description, qty: l.qty, unit: l.unit, unitCost: l.unitCost, source: l.source, confidence: l.confidence })),
    sources: sourceSummary(e),
    maturityComplete: maturityItems(s).filter((m) => e.maturity[m.key]).map((m) => m.label),
    maturityMissing: maturityItems(s).filter((m) => !e.maturity[m.key]).map((m) => `${m.label} (Class ${m.forClass})`),
    topRisks: activeRisks(s, p.id).sort((a, b) => b.probability * pert(b.cost) - a.probability * pert(a.cost)).slice(0, 6).map((r) => ({ title: r.title, probability: r.probability, mostLikely: r.cost.ml })),
  }
}

// ───────────────────────────── Actions (mutate drafts)
/**
 * Start the estimate-approval workflow for a saved draft (ES-09). If the current user holds the
 * first "prepare" step (or is an admin) it is submitted on their behalf. Returns a toast message.
 */
export function submitEstimate(d: AppState, estimateId: string, mc?: MonteCarloResult): string {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e || e.status !== 'draft') return 'Only drafts can be submitted'
  const p = d.projects.find((x) => x.id === e.projectId)!
  e.cls = computeClass(e.maturity, maturityItems(d))
  const total = estimateTotals(e).total
  if (e.contingency.method === 'risk-based' && mc) d.monteCarlo.push({ ...mc, id: uid('mc') })
  const inst = startWorkflow(d, 'estimate-approval', { title: `${p.code} Class ${e.cls} estimate v${e.version}`, recordType: 'estimate', recordId: e.id, projectId: p.id, data: { amount: total, cls: String(e.cls) } })
  if (!inst) return 'No published estimate-approval workflow'
  const slot = inst.active[0]
  const actor = d.people.find((x) => x.id === d.currentUserId)
  const name = (id: string) => d.people.find((x) => x.id === id)?.name ?? id
  if (slot && (slot.assigneeIds.includes(d.currentUserId) || actor?.roles.includes('admin'))) {
    actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', 'Estimate and basis of estimate prepared')
    const next = inst.active[0]
    return next ? `Submitted for approval — now with ${next.assigneeIds.map(name).join(', ')}` : 'Submitted and approved'
  }
  return slot ? `Sent to ${slot.assigneeIds.map(name).join(', ')} to complete and submit` : 'Submitted for approval'
}

/** Which budget kind an approved estimate can become now: the latest passed gate with a budget event. */
export function budgetKindAvailable(s: AppState, p: Project): { kind: 'planning' | 'control'; gate: string } | null {
  const tpl = templateFor(s, p)
  const passed = tpl.stages.slice(0, p.stageIndex).filter((st) => st.gate.budgetEvent)
  const last = passed[passed.length - 1]
  return last ? { kind: last.gate.budgetEvent!, gate: last.gate.name } : null
}
