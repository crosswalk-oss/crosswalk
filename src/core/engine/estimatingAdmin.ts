// Estimating administration: the backend tables every estimate reads (rate table by region, region factors,
// escalation, contingency by class, portfolio loaders, county sales tax, units, quantity types, scope library,
// maturity checklist) and the bulk repricing of estimates after the rate table changes.
import type { AaceClass, AppState, Estimate, EstimateLine, Person, Project, UnitCostRate } from '../types'
import { computeClass, estimateTotals, maturityItems, regionalUnitCost, type EstimateTotals, type RatePricing, type ScopeQty } from './estimates'
import { nowISO, sum, uid } from '../util'

// ───────────────────────────── Who may do what
const TEAM = ['estimator', 'estimating-lead', 'admin']
/** The estimating team maintains the administration tables (everyone else sees them read-only). */
export const canAdministerEstimating = (p?: Pick<Person, 'roles'>) => !!p?.roles.some((r) => TEAM.includes(r))
/** Only estimators and the estimating lead may override a locked rate-table unit cost (with a reason). */
export const canOverrideUnitCost = (p?: Pick<Person, 'roles'>) => !!p?.roles.some((r) => r === 'estimator' || r === 'estimating-lead')

// ───────────────────────────── Table lookups
export const regionOf = (p: Pick<Project, 'location'>) => p.location.district

export const pricingFor = (s: Pick<AppState, 'settings'>, p: Pick<Project, 'location'>, region?: string): RatePricing =>
  ({ region: region ?? regionOf(p), regionFactors: s.settings.estimating.regionFactors })

/** Portfolio loaders in force (latest year of the loader table). Locked on project estimates. */
export function currentLoaders(s: Pick<AppState, 'settings'>): { name: string; pct: number }[] {
  const rows = s.settings.loaderRates
  if (!rows.length) return []
  const y = Math.max(...rows.map((r) => r.year))
  return rows.filter((r) => r.year === y).map((r) => ({ name: r.name, pct: r.pct }))
}
export const loaderYear = (s: Pick<AppState, 'settings'>) => Math.max(0, ...s.settings.loaderRates.map((r) => r.year))

const GUIDE: Record<AaceClass, number> = { 5: 30, 4: 20, 3: 15, 2: 10, 1: 5 }
/** Default deterministic contingency % for a class, from the estimating team's table. */
export const contingencyForClass = (s: Pick<AppState, 'settings'>, cls: AaceClass) => s.settings.estimating.contingencyByClass[String(cls)] ?? GUIDE[cls]

/** Compound escalation % from a basis year to a target year using the portfolio escalation table. */
export function escalationPctFor(s: Pick<AppState, 'settings'>, fromYear: number, toYear: number): number {
  const tbl = s.settings.escalationByYear
  const years = Object.keys(tbl).map(Number)
  const last = years.length ? Math.max(...years) : 0
  let f = 1
  for (let y = fromYear + 1; y <= toYear; y++) f *= 1 + (tbl[String(y)] ?? tbl[String(last)] ?? 3) / 100
  return Math.round((f - 1) * 1000) / 10
}

/** Year of the spend midpoint: halfway between today and the in-service forecast. */
export function spendMidpoint(s: Pick<AppState, 'settings'>, p: Project): number {
  const ins = p.milestones.find((m) => /in.service/i.test(m.name))
  const end = ins?.actual ?? ins?.forecast ?? s.settings.asOf
  const a = Date.parse(s.settings.asOf), b = Date.parse(end)
  return new Date(a + Math.max(0, b - a) / 2).getUTCFullYear()
}

/** Basis year of the rate rows an estimate's lines were priced from (earliest; 2025 when none). */
export function basisYearOf(s: Pick<AppState, 'rates'>, lines: EstimateLine[]): number {
  const ys = lines.map((l) => s.rates.find((r) => r.id === l.rateId)?.basisYear).filter((y): y is number => !!y)
  return ys.length ? Math.min(...ys) : 2025
}

/** Sales tax for a project: county rates weighted by the project's county split (crossing a county line splits it). */
export function salesTaxFor(s: Pick<AppState, 'settings'>, p: Project): NonNullable<Estimate['salesTax']> {
  const cfg = s.settings.estimating
  const split = p.counties?.length ? p.counties : [{ county: p.location.county, pct: 100 }]
  const tot = sum(split.map((c) => c.pct)) || 100
  const counties = split.map((c) => ({ county: c.county, share: c.pct / tot, rate: cfg.taxRates.find((t) => t.county === c.county)?.rate ?? 0 }))
  const pct = Math.round(sum(counties.map((c) => c.share * c.rate)) * 1000) / 1000
  return { pct, counties, categoryIds: [...cfg.taxableCategoryIds] }
}

/** Rate table version in force at a timestamp (the latest published at or before it). */
export function rateTableVersionAt(s: Pick<AppState, 'settings'>, iso: string): number {
  const h = s.settings.estimating.rateTableHistory.slice().sort((a, b) => a.version - b.version)
  let v = h[0]?.version ?? s.settings.estimating.rateTableVersion
  for (const x of h) if (x.at <= iso) v = x.version
  return v
}
/** The rate table version an estimate was priced on (stamped, else inferred from when it was created). */
export const pricedOnVersion = (s: Pick<AppState, 'settings'>, e: Pick<Estimate, 'rateTableVersion' | 'createdAt'>) => e.rateTableVersion ?? rateTableVersionAt(s, e.createdAt)

/** Scope quantities from the project's scope statement, via the quantity types' `feeds` (asset record as fallback). */
export function scopeQuantities(s: Pick<AppState, 'settings'>, p: Project): ScopeQty & { sources: Partial<Record<keyof ScopeQty, string>> } {
  const types = s.settings.estimating.quantityTypes
  const sources: Partial<Record<keyof ScopeQty, string>> = {}
  const feed = (k: keyof ScopeQty): number | undefined => {
    const qs = p.scope.quantities.filter((q) => types.find((t) => t.id === q.typeId)?.feeds === k)
    if (!qs.length) return
    // several quantities feeding length (installed + tested) describe the same pipe: take the largest
    const q = qs.slice().sort((a, b) => b.qty - a.qty)[0]
    sources[k] = q.label
    return q.qty
  }
  const lengthFt = feed('lengthFt') ?? (p.asset.lengthFt ? (sources.lengthFt = 'Asset record', p.asset.lengthFt) : 0)
  const sites = feed('sites') ?? (p.asset.type === 'valve-site' ? (sources.sites = 'Asset record', p.scope.quantities.find((q) => q.unit === 'ea' || q.unit === 'site')?.qty ?? 1) : 1)
  return { lengthFt, sites, hp: feed('hp'), tieIns: feed('tieIns'), services: feed('services'), sources }
}

// ───────────────────────────── Rate rows
/** The row for the same item in another region (or the base row when the table has none for that region). */
export function rowForRegion(rates: UnitCostRate[], r: UnitCostRate, region: string): UnitCostRate {
  const same = rates.filter((x) => x.assetType === r.assetType && x.workMethod === r.workMethod && x.categoryId === r.categoryId && x.description === r.description && (x.diameterIn ?? 0) === (r.diameterIn ?? 0) && (x.terrain ?? '') === (r.terrain ?? ''))
  return same.find((x) => x.region === region) ?? same.find((x) => !x.region) ?? r
}

/** Region rows sharing a base row's identity. */
export const regionRowsOf = (rates: UnitCostRate[], base: UnitCostRate) => rates.filter((x) => x.region && x.assetType === base.assetType && x.workMethod === base.workMethod && x.categoryId === base.categoryId && x.description === base.description && (x.diameterIn ?? 0) === (base.diameterIn ?? 0) && (x.terrain ?? '') === (base.terrain ?? ''))

/** Effective P50 of an item in each region: its region row, else the base row × region factor. */
export function effectiveByRegion(s: Pick<AppState, 'settings' | 'rates'>, base: UnitCostRate, rates = s.rates): Record<string, { value: number; regional: boolean }> {
  const out: Record<string, { value: number; regional: boolean }> = {}
  for (const g of s.settings.estimating.regions) {
    const row = rowForRegion(rates, base, g)
    const u = regionalUnitCost(row, { region: g, regionFactors: s.settings.estimating.regionFactors })
    out[g] = { value: u.unitCost, regional: u.regional }
  }
  return out
}

/** Human-readable differences between two versions of the rate table (for the audit trail). */
export function diffRates(before: UnitCostRate[], after: UnitCostRate[]): string[] {
  const out: string[] = []
  const label = (r: UnitCostRate) => `${r.description}${r.region ? ` (${r.region})` : ''}`
  for (const a of after) {
    const b = before.find((x) => x.id === a.id)
    if (!b) { out.push(`Added ${label(a)}: ${a.unit}, P50 $${a.p50.toLocaleString('en-US')}`); continue }
    const ch = (['p10', 'p50', 'p90', 'unit', 'sampleSize', 'basisYear', 'description'] as const).filter((k) => b[k] !== a[k]).map((k) => `${k} ${b[k]} → ${a[k]}`)
    if (ch.length) out.push(`${label(a)}: ${ch.join(', ')}`)
  }
  for (const b of before) if (!after.some((x) => x.id === b.id)) out.push(`Removed ${label(b)}`)
  return out
}

/** Publish a new rate table: replaces the rows, bumps the version and records the note. Mutates the draft. */
export function publishRateTable(d: AppState, rates: UnitCostRate[], note: string, byId = d.currentUserId): { version: number; changes: string[] } {
  const changes = diffRates(d.rates, rates)
  const cfg = d.settings.estimating
  const version = cfg.rateTableVersion + 1
  d.rates = rates.map((r) => ({ ...r }))
  cfg.rateTableVersion = version
  cfg.rateTableHistory.push({ version, at: nowISO(), byId, note: note.trim() || `${changes.length} rate change${changes.length === 1 ? '' : 's'}` })
  for (const c of changes) d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'rate', entityId: `rate-table-v${version}`, action: 'update', summary: `Rate table v${version}: ${c}` })
  return { version, changes }
}

// ───────────────────────────── Pricing an estimate against the tables
export interface LineReprice { line: EstimateLine; from: number; to: number; rowId?: string; status: 'repriced' | 'unchanged' | 'override' | 'quote' | 'manual' | 'missing' }

/** What each line would cost at today's table for the project's region. Quotes, analogs, judgment and overrides keep their price. */
export function repriceLines(s: Pick<AppState, 'settings' | 'rates'>, p: Project, lines: EstimateLine[]): LineReprice[] {
  const pr = pricingFor(s, p)
  return lines.map((l) => {
    if (!l.rateId) return { line: l, from: l.unitCost, to: l.unitCost, status: 'manual' as const }
    if (l.override) return { line: l, from: l.unitCost, to: l.unitCost, status: 'override' as const }
    if (l.source !== 'library') return { line: l, from: l.unitCost, to: l.unitCost, status: 'quote' as const }
    const r = s.rates.find((x) => x.id === l.rateId)
    if (!r) return { line: l, from: l.unitCost, to: l.unitCost, status: 'missing' as const }
    const row = rowForRegion(s.rates, r, pr.region!)
    const to = regionalUnitCost(row, pr).unitCost
    return { line: l, from: l.unitCost, to, rowId: row.id, status: Math.abs(to - l.unitCost) < 0.005 && row.id === l.rateId ? 'unchanged' as const : 'repriced' as const }
  })
}

/** Stamp the portfolio tables (loaders, escalation, contingency default, sales tax, region, rate version) onto an estimate. */
export function applyTables(s: Pick<AppState, 'settings' | 'rates'>, p: Project, e: Estimate): Estimate {
  const cls = computeClass(e.maturity, maturityItems(s))
  const esc = escalationPctFor(s, basisYearOf(s, e.lines), spendMidpoint(s, p))
  return {
    ...e,
    cls,
    loaders: currentLoaders(s),
    escalationPct: e.method === 'quick' ? e.escalationPct : esc,
    contingency: e.contingency.method === 'deterministic' ? { method: 'deterministic', pct: contingencyForClass(s, cls) } : e.contingency,
    salesTax: e.method === 'quick' ? e.salesTax : salesTaxFor(s, p),
    region: regionOf(p),
  }
}

/** Do the estimate's markups differ from the portfolio tables in force? */
export function tablesDrift(s: Pick<AppState, 'settings' | 'rates'>, p: Project, e: Estimate): string[] {
  const out: string[] = []
  const cur = currentLoaders(s)
  const same = cur.length === e.loaders.length && cur.every((x) => e.loaders.some((y) => y.name === x.name && Math.abs(y.pct - x.pct) < 0.001))
  if (!same) out.push(`loaders ${sum(e.loaders.map((l) => l.pct)).toFixed(1)}% → ${sum(cur.map((l) => l.pct)).toFixed(1)}%`)
  if (e.method !== 'quick') {
    const esc = escalationPctFor(s, basisYearOf(s, e.lines), spendMidpoint(s, p))
    if (Math.abs(esc - e.escalationPct) > 0.05) out.push(`escalation ${e.escalationPct}% → ${esc}%`)
    const tax = salesTaxFor(s, p)
    if (!e.salesTax || Math.abs(e.salesTax.pct - tax.pct) > 0.0005 || e.salesTax.categoryIds.join() !== tax.categoryIds.join()) out.push(`sales tax ${e.salesTax ? e.salesTax.pct + '%' : 'not applied'} → ${tax.pct}%`)
  }
  return out
}

// ───────────────────────────── Bulk update after the rate table changes
/** The project's current estimate: its open draft or in-review version, else the estimate of record. */
export function currentEstimateOf(s: Pick<AppState, 'estimates'>, pid: string): Estimate | undefined {
  const es = s.estimates.filter((e) => e.projectId === pid).sort((a, b) => b.version - a.version)
  return es.find((e) => e.status === 'draft' || e.status === 'in-review') ?? es.find((e) => e.status === 'approved')
}

export interface RepricePlan {
  project: Project
  estimate: Estimate
  fromVersion: number
  eligible: boolean
  reason?: string
  mode: 'new-version' | 'update-draft'
  preview: Estimate
  before: EstimateTotals
  after: EstimateTotals
  lines: LineReprice[]
  kept?: { at: string; byId: string; note: string }
}

const KEEP_ACTION = 'keep-rates'

/** Build the repriced version of an estimate (not pushed into state). */
export function repricedEstimate(s: AppState, e: Estimate, byId: string, note = ''): { est: Estimate; lines: LineReprice[]; mode: RepricePlan['mode'] } {
  const p = s.projects.find((x) => x.id === e.projectId)!
  const lr = repriceLines(s, p, e.lines)
  const mode: RepricePlan['mode'] = e.status === 'draft' ? 'update-draft' : 'new-version'
  const v = s.settings.estimating.rateTableVersion
  const from = pricedOnVersion(s, e)
  const lines = lr.map((x) => x.status === 'repriced' ? { ...x.line, id: mode === 'new-version' ? uid('ln') : x.line.id, unitCost: x.to, rateId: x.rowId ?? x.line.rateId } : { ...x.line, id: mode === 'new-version' ? uid('ln') : x.line.id })
  const nextVersion = Math.max(0, ...s.estimates.filter((x) => x.projectId === e.projectId).map((x) => x.version)) + 1
  const n = lr.filter((x) => x.status === 'repriced').length
  const assumption = `Repriced to rate table v${v} (from v${from}) for the ${regionOf(p)} region: ${n} rate-table line${n === 1 ? '' : 's'} updated; quotes, analogs, estimator judgment and overrides kept${note ? ` — ${note}` : ''}.`
  const base: Estimate = JSON.parse(JSON.stringify(e))
  const est = applyTables(s, p, {
    ...base,
    ...(mode === 'new-version' ? { id: uid('est'), version: nextVersion, status: 'draft' as const, createdAt: nowISO(), createdById: byId, approvedAt: undefined, approvedById: undefined, workflowInstanceId: undefined } : {}),
    lines,
    rateTableVersion: v,
    repricedFrom: { estimateId: e.id, fromVersion: e.version, fromRateTable: from, toRateTable: v },
    basis: { ...base.basis, assumptions: [...base.basis.assumptions.filter((a) => !/^Repriced to rate table v/.test(a)), assumption] },
  })
  return { est, lines: lr, mode }
}

/** Projects whose current estimate was priced on an older rate table version, with a before → after preview. */
export function repriceCandidates(s: AppState, byId = s.currentUserId): RepricePlan[] {
  const v = s.settings.estimating.rateTableVersion
  const out: RepricePlan[] = []
  for (const p of s.projects) {
    if (p.status === 'closed' || p.status === 'cancelled') continue
    const e = currentEstimateOf(s, p.id)
    if (!e || e.method === 'quick') continue // quick estimates price from the historical cost table, not the rate table
    const from = pricedOnVersion(s, e)
    if (from >= v) continue
    const { est, lines, mode } = repricedEstimate(s, e, byId)
    const hasDraft = s.estimates.some((x) => x.projectId === p.id && x.status === 'draft' && x.id !== e.id)
    const kept = [...s.audit].reverse().find((a) => a.entity === 'estimate' && a.entityId === e.id && a.action === KEEP_ACTION && a.summary.includes(`rate table v${v}`))
    const eligible = e.status !== 'in-review' && !hasDraft
    out.push({
      project: p, estimate: e, fromVersion: from, eligible, mode, preview: est, lines,
      reason: e.status === 'in-review' ? 'In review — reprice after the approval decision (or recall it)' : hasDraft ? 'Project has another open draft' : undefined,
      before: estimateTotals(e), after: estimateTotals(est),
      kept: kept ? { at: kept.at, byId: kept.actorId, note: kept.summary.split(' — ').slice(1).join(' — ') } : undefined,
    })
  }
  return out.sort((a, b) => a.project.code.localeCompare(b.project.code))
}

/** Reprice the chosen estimates: approved ones get a new draft version; open drafts are updated in place. Mutates. */
export function applyReprice(d: AppState, estimateIds: string[], note: string, byId = d.currentUserId): { created: Estimate[]; updated: Estimate[] } {
  const created: Estimate[] = [], updated: Estimate[] = []
  for (const id of estimateIds) {
    const e = d.estimates.find((x) => x.id === id)
    if (!e || e.status === 'in-review' || e.method === 'quick') continue
    const before = estimateTotals(e).total
    const { est, lines, mode } = repricedEstimate(d, e, byId, note)
    const after = estimateTotals(est).total
    const n = lines.filter((x) => x.status === 'repriced').length
    const p = d.projects.find((x) => x.id === e.projectId)!
    if (mode === 'update-draft') { Object.assign(e, est); updated.push(e) } else { d.estimates.push(est); created.push(est) }
    d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'estimate', entityId: est.id, projectId: p.id, action: 'reprice',
      summary: `${mode === 'update-draft' ? `Repriced draft v${e.version}` : `Created draft v${est.version} from v${e.version}`} on rate table v${est.rateTableVersion} (was v${est.repricedFrom!.fromRateTable}): ${n} line${n === 1 ? '' : 's'} repriced, current loaders, escalation ${est.escalationPct}%, sales tax ${est.salesTax?.pct ?? 0}% — $${(before / 1e6).toFixed(2)}M → $${(after / 1e6).toFixed(2)}M${note ? ` — ${note}` : ''}` })
  }
  return { created, updated }
}

/** Record that the estimating team keeps an estimate on its historical rates for this table version. Mutates. */
export function keepHistorical(d: AppState, estimateIds: string[], note: string, byId = d.currentUserId): number {
  const v = d.settings.estimating.rateTableVersion
  let n = 0
  for (const id of estimateIds) {
    const e = d.estimates.find((x) => x.id === id)
    if (!e) continue
    d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'estimate', entityId: e.id, projectId: e.projectId, action: KEEP_ACTION, summary: `Kept v${e.version} on historical rates (rate table v${pricedOnVersion(d, e)}) instead of repricing to rate table v${v}${note ? ` — ${note}` : ''}` })
    n++
  }
  return n
}
