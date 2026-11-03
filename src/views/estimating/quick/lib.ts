// Class 5 quick estimate helpers for the estimating module (pure functions and draft mutations).
// The pricing itself lives in core/engine/quick.ts; this file wires it to the request, review and table-maintenance flows.
import type { AppState, AssetType, AuditEntry, DiameterBand, Estimate, FactorInputs, HistoricalCost, HistUnit, Project, QuickEstimate, QuickInputs, SiteDrivers, Terrain, WorkMethod, WorkflowInstance } from '@/core/types'
import { CLASS_RANGES, estimateTotals } from '@/core/engine/estimates'
import { DIAMETER_BANDS, QUICK_CATALOG, UNIT_LABEL, adjustQuickEstimate, computeQuick, deriveFromClosed, escalationFactor, findHistorical, inputsFromProject, type QuickResult } from '@/core/engine/quick'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { adjustFactorEstimate, createFactorEstimate, factorInputsFromProject, previewFactorAdjust, publishedModel, taxForDistrict } from '@/core/engine/factorModel'
import { nowISO, sum, uid } from '@/core/util'

// ───────────────────────────── Labels
export const ASSET_LABEL: Record<AssetType, string> = { 'transmission-pipeline': 'Transmission pipeline', 'distribution-main': 'Distribution main', 'compressor-station': 'Compressor station', 'valve-site': 'Valve site', 'storage-field': 'Storage field', 'regulator-station': 'Regulator station' }
export const METHOD_LABEL: Record<WorkMethod, string> = { 'replace-open-trench': 'Replace, open trench', 'replace-hdd': 'Replace, HDD', hydrotest: 'Hydrotest', abandon: 'Abandon', 'valve-automation': 'Valve automation', 'station-rebuild': 'Station rebuild', 'compressor-replacement': 'Compressor replacement', 'inline-inspection': 'In-line inspection' }
export const TERRAIN_LABEL: Record<Terrain | 'any', string> = { urban: 'Urban', suburban: 'Suburban', rural: 'Rural', any: 'Any setting' }
export const bandLabel = (b: DiameterBand) => (b === 'n/a' ? 'All diameters' : DIAMETER_BANDS.find((x) => x.id === b)?.label ?? b)
export const UNIT_SHORT: Record<HistUnit, string> = { ft: 'ft', site: 'site', hp: 'hp', station: 'station' }
export const QUICK_LABEL = 'Quick · Class 5'

export const catalogOf = (a: AssetType) => QUICK_CATALOG.find((c) => c.asset === a)
export const isBanded = (a: AssetType) => !!catalogOf(a)?.banded

/** Rate per unit for display: $2,415/ft or $1.2M/station. */
export function fmtRate(v: number, u: HistUnit): string {
  const n = v >= 1e5 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M` : `$${Math.round(v).toLocaleString('en-US')}`
  return `${n}/${UNIT_SHORT[u]}`
}

// ───────────────────────────── Inputs
/** Keep inputs consistent after a dropdown changes: method valid for the asset, unit from the catalog, band only when banded. */
export function normalizeInputs(i: QuickInputs, prevAsset?: AssetType): QuickInputs {
  const c = catalogOf(i.assetType) ?? QUICK_CATALOG[0]
  const workMethod = c.methods.includes(i.workMethod) ? i.workMethod : c.methods[0]
  let diameterBand: DiameterBand = i.diameterBand
  if (!c.banded) diameterBand = 'n/a'
  else if (diameterBand === 'n/a') diameterBand = i.assetType === 'distribution-main' ? 'le-8' : '20-24'
  const qty = prevAsset && prevAsset !== c.asset && catalogOf(prevAsset)?.unit !== c.unit ? defaultQty(c.unit) : i.qty
  return { ...i, assetType: c.asset, workMethod, diameterBand, unit: c.unit, qty }
}
const defaultQty = (u: HistUnit) => (u === 'ft' ? 5280 : u === 'hp' ? 10000 : 1)

/** Starting inputs for a need that has no project yet. */
export function blankInputs(s: Pick<AppState, 'settings'>): QuickInputs {
  const y = Number(s.settings.asOf.slice(0, 4))
  const district = Object.keys(s.settings.quickEstimate.regionFactors)[0] ?? 'East'
  return { assetType: 'transmission-pipeline', workMethod: 'replace-open-trench', diameterBand: '20-24', terrain: 'suburban', district, qty: 5280, unit: 'ft', midpointYear: y + 1 }
}

/** Site drivers for a need with no project yet: everything at its baseline for the setting. */
export function defaultSite(terrain: Terrain): SiteDrivers {
  return { soil: 'normal', permitComplexity: 'ministerial', traffic: terrain === 'urban' ? 'heavy' : terrain === 'suburban' ? 'moderate' : 'low', workHours: 'standard', crossings: 0, remoteness: terrain === 'rural' ? 'regional' : 'local', classLocation: terrain === 'urban' ? 3 : terrain === 'suburban' ? 2 : 1, hca: terrain !== 'rural' }
}

/** Quick-estimate inputs completed with the site drivers and sales tax the factor model needs (from the project when there is one). */
export function toFactorInputs(s: AppState, p: Project | undefined, i: QuickInputs | FactorInputs): FactorInputs {
  if ('site' in i && i.site) return { ...i, site: { ...i.site }, taxPct: i.taxPct ?? (p ? factorInputsFromProject(s, p).taxPct : taxForDistrict(s, i.district)) }
  const from = p ? factorInputsFromProject(s, p) : undefined
  return { ...i, site: from?.site ?? defaultSite(i.terrain), taxPct: from?.taxPct ?? taxForDistrict(s, i.district) }
}
export const isFactorInputs = (i: QuickInputs): i is FactorInputs => 'site' in i && !!(i as FactorInputs).site

export function districtsOf(s: Pick<AppState, 'settings' | 'projects'>): string[] {
  return Array.from(new Set([...Object.keys(s.settings.quickEstimate.regionFactors), ...s.projects.map((p) => p.location.district)])).sort()
}

export function describeQuickInputs(i: QuickInputs): string {
  const band = isBanded(i.assetType) && i.diameterBand !== 'n/a' ? `, ${bandLabel(i.diameterBand)}` : ''
  return `${ASSET_LABEL[i.assetType]} · ${METHOD_LABEL[i.workMethod]}${band} · ${i.qty.toLocaleString('en-US')} ${UNIT_LABEL[i.unit]} · ${TERRAIN_LABEL[i.terrain].toLowerCase()} · ${i.district} · ${i.midpointYear} midpoint`
}

// ───────────────────────────── Result interpretation
export interface MatchNote { tone: 'good' | 'warn' | 'bad'; label: string; detail: string }

/** How the historical row was found, and whether the reviewer should look harder. */
export function matchNote(s: Pick<AppState, 'historicalCosts'>, r: Pick<QuickResult, 'row' | 'match'>, i: QuickInputs): MatchNote {
  if (!r.row) return { tone: 'bad', label: 'No historical data', detail: `The table has no active row for ${ASSET_LABEL[i.assetType].toLowerCase()} · ${METHOD_LABEL[i.workMethod].toLowerCase()}. Ask the estimating team to add one, or prepare a parametric estimate.` }
  const row = r.row
  const small = row.n < 5
  const sample = small ? ` Only ${row.n} closed project${row.n === 1 ? '' : 's'} behind it — small sample.` : ''
  const allDia = isBanded(i.assetType) && row.diameterBand === 'n/a' ? ' The row covers all diameters.' : ''
  if (r.match === 'nearest-band') return { tone: 'warn', label: 'Fallback: nearest diameter band', detail: `No row for ${bandLabel(i.diameterBand)}; priced from ${bandLabel(row.diameterBand)} (${TERRAIN_LABEL[row.terrain].toLowerCase()}).${sample}` }
  if (r.match === 'any-terrain') {
    const pool = s.historicalCosts.filter((h) => h.active && h.assetType === i.assetType && h.workMethod === i.workMethod)
    const split = pool.some((h) => h.terrain !== 'any')
    if (split) return { tone: 'warn', label: 'Fallback: all settings', detail: `No ${TERRAIN_LABEL[i.terrain].toLowerCase()} row; priced from the row that pools every setting.${allDia}${sample}` }
    return { tone: small ? 'warn' : 'good', label: small ? 'Small sample' : 'Matched', detail: `${ASSET_LABEL[i.assetType]} · ${METHOD_LABEL[i.workMethod].toLowerCase()} is kept as one row across settings.${allDia}${sample}` }
  }
  return { tone: small ? 'warn' : 'good', label: small ? 'Small sample' : 'Exact match', detail: `Same asset type, method${isBanded(i.assetType) && !allDia ? ', diameter band' : ''} and setting.${allDia}${sample}` }
}

/** Historical P10–P90 spread around the point, beside the AACE Class 5 expected range. */
export function aaceCompare(r: Pick<QuickResult, 'total' | 'low' | 'high'>) {
  const c5 = CLASS_RANGES[5]
  const lo = r.total ? r.low / r.total - 1 : 0
  const hi = r.total ? r.high / r.total - 1 : 0
  const inside = lo >= c5.low && hi <= c5.high
  return { lo, hi, aaceLo: c5.low, aaceHi: c5.high, aaceLow: Math.round(r.total * (1 + c5.low)), aaceHigh: Math.round(r.total * (1 + c5.high)), inside }
}

/** Which model version priced a quick estimate, and whether the base rate was a fallback. */
export function modelNote(s: AppState, e: Estimate): MatchNote | undefined {
  if (!e.factor || !e.quick) return
  const pub = publishedModel(s)
  const m = storedMatch(s, e)
  const current = pub?.id === e.factor.modelId
  return { tone: m === 'nearest-band' ? 'warn' : current ? 'good' : 'warn', label: `Model v${e.factor.modelVersion}${current ? '' : ' (superseded)'}`, detail: m === 'nearest-band' ? 'Base rate from the nearest diameter band' : current ? 'Priced on the published factor model' : `Priced on v${e.factor.modelVersion}; v${pub?.version ?? '—'} is now published` }
}

// ───────────────────────────── Eligibility, request, revise
export function quickEligibility(s: AppState, pid: string): { ok: boolean; reason?: string } {
  const p = s.projects.find((x) => x.id === pid)
  if (!p) return { ok: false, reason: 'Pick a project' }
  if (p.status === 'closed' || p.status === 'cancelled') return { ok: false, reason: `${p.code} is ${p.status}` }
  const ests = s.estimates.filter((e) => e.projectId === pid)
  const review = ests.find((e) => e.status === 'in-review')
  if (review) return { ok: false, reason: `v${review.version} is already in review` }
  const better = ests.find((e) => e.status === 'approved' && e.cls < 5)
  if (better) return { ok: false, reason: `${p.code} already has an approved Class ${better.cls} estimate (v${better.version})` }
  const draft = ests.find((e) => e.status === 'draft')
  if (draft) return { ok: false, reason: `Finish or submit draft v${draft.version} first` }
  return { ok: true }
}

export interface RequestArgs { inputs: QuickInputs | FactorInputs; note: string; needBy?: string; byId?: string }
export interface RequestResult { estimateId?: string; instId?: string; message: string; ok: boolean }

const names = (d: AppState, ids: string[]) => ids.map((id) => d.people.find((p) => p.id === id)?.name ?? id).join(', ')

/** Route an existing quick estimate (status draft) to the estimating team: start class5-review and submit the prep step. */
function route(d: AppState, e: Estimate, note: string, byId: string): RequestResult {
  const p = d.projects.find((x) => x.id === e.projectId)!
  const total = estimateTotals(e).total
  const inst = startWorkflow(d, 'class5-review', { title: `${p.code} Class 5 quick estimate`, recordType: 'estimate', recordId: e.id, projectId: p.id, data: { amount: total, note }, startedById: byId })
  if (!inst) return { ok: false, estimateId: e.id, message: 'No published Class 5 quick estimate review process' }
  const slot = inst.active[0]
  if (slot && slot.assigneeIds.includes(byId)) actOnWorkflow(d, inst.id, slot.nodeId, byId, 'submit', note || 'Quick estimate requested')
  const next = d.workflows.find((w) => w.id === inst.id)?.active[0]
  return { ok: true, estimateId: e.id, instId: inst.id, message: next ? `Sent to the estimating team — ${names(d, next.assigneeIds)}` : 'Submitted' }
}

/** New quick estimate on a project, routed for review. Mutates the draft. */
export function submitQuickRequest(d: AppState, pid: string, a: RequestArgs): RequestResult {
  const byId = a.byId ?? d.currentUserId
  const p = d.projects.find((x) => x.id === pid)
  if (!publishedModel(d)) return { ok: false, message: 'No published factor model — ask the estimating lead' }
  const e = createFactorEstimate(d, pid, toFactorInputs(d, p, a.inputs), a.note.trim(), byId, a.needBy || undefined)
  if (!e) return { ok: false, message: 'The factor model has no base rate for this asset and method' }
  return route(d, e, a.note.trim(), byId)
}

/** Sent back by the estimating team: the workflow is waiting on the requester at the prep step again. */
export function returnedToRequester(s: Pick<AppState, 'workflows'>, e: Estimate) {
  const inst = s.workflows.find((w) => w.id === e.workflowInstanceId)
  if (!inst || inst.status !== 'running') return
  const slot = inst.active.find((a) => a.nodeId === 'prep')
  if (!slot) return
  const ev = [...inst.history].reverse().find((h) => h.action === 'return')
  return { inst, slot, event: ev }
}

export const canRevise = (s: Pick<AppState, 'workflows'>, e: Estimate) => e.method === 'quick' && (e.status === 'draft' || !!returnedToRequester(s, e))

/**
 * Revise a quick estimate that came back (returned to the requester, or recalled to draft): reprice it in place
 * from new inputs and send it to the estimating team again.
 */
export function reviseQuickRequest(d: AppState, estimateId: string, a: RequestArgs): RequestResult {
  const e = d.estimates.find((x) => x.id === estimateId)
  if (!e || !canRevise(d, e)) return { ok: false, message: 'Only a returned or recalled quick estimate can be revised' }
  const byId = a.byId ?? d.currentUserId
  const nAudit = d.audit.length
  const p = d.projects.find((x) => x.id === e.projectId)
  const fresh = createFactorEstimate(d, e.projectId, toFactorInputs(d, p, a.inputs), a.note.trim(), byId, a.needBy || undefined)
  if (!fresh) return { ok: false, message: 'The factor model has no base rate for these inputs' }
  // Use the engine's pricing and basis text, but keep this record (same id and version).
  d.estimates.splice(d.estimates.indexOf(fresh), 1)
  d.audit.splice(nAudit)
  e.lines = fresh.lines; e.loaders = fresh.loaders; e.contingency = fresh.contingency; e.basis = fresh.basis; e.quick = fresh.quick; e.factor = fresh.factor; e.salesTax = fresh.salesTax; e.region = fresh.region; e.escalationPct = 0; e.cls = 5
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'estimate', entityId: e.id, projectId: e.projectId, action: 'revise', summary: `Revised Class 5 quick estimate v${e.version} on factor model v${e.factor?.modelVersion ?? '—'} (${describeQuickInputs(a.inputs)}): $${(estimateTotals(e).total / 1e6).toFixed(2)}M` })
  const back = returnedToRequester(d, e)
  if (back) {
    back.inst.data.amount = estimateTotals(e).total
    back.inst.data.note = a.note.trim()
    actOnWorkflow(d, back.inst.id, 'prep', byId, 'submit', `Revised: ${a.note.trim()}`)
    const next = d.workflows.find((w) => w.id === back.inst.id)?.active[0]
    return { ok: true, estimateId: e.id, instId: back.inst.id, message: next ? `Resubmitted to the estimating team — ${names(d, next.assigneeIds)}` : 'Resubmitted' }
  }
  e.workflowInstanceId = undefined
  return route(d, e, a.note.trim(), byId)
}

// ───────────────────────────── Review & adjust
/** The running class5-review step on an estimate, if any. */
export function reviewSlot(s: Pick<AppState, 'workflows'>, e: Estimate): { inst: WorkflowInstance; slot: WorkflowInstance['active'][number] } | undefined {
  const inst = s.workflows.find((w) => w.id === e.workflowInstanceId)
  if (!inst || inst.status !== 'running') return
  const slot = inst.active.find((a) => a.nodeId === 'est') ?? inst.active[0]
  return slot ? { inst, slot } : undefined
}

/** How a saved quick estimate's row relates to its inputs (the same categories the request form showed). */
export function storedMatch(s: Pick<AppState, 'historicalCosts'>, e: Estimate): QuickResult['match'] {
  const q = e.quick
  if (q && e.factor) {
    const m = (s as AppState).factorModels?.find((x) => x.id === e.factor!.modelId)
    const br = m?.baseRates.find((b) => b.id === e.factor!.baseRateId)
    if (!br) return 'none'
    return isBanded(q.inputs.assetType) && br.diameterBand !== 'n/a' && br.diameterBand !== q.inputs.diameterBand ? 'nearest-band' : 'exact'
  }
  const row = q && s.historicalCosts.find((h) => h.id === q.historicalCostId)
  if (!q || !row) return 'none'
  const band = isBanded(q.inputs.assetType) ? q.inputs.diameterBand : 'n/a'
  if (row.diameterBand !== band && row.diameterBand !== 'n/a') return 'nearest-band'
  return row.terrain === 'any' ? 'any-terrain' : 'exact'
}

export function canAdjust(s: AppState, e: Estimate, personId: string): boolean {
  if (e.method !== 'quick' || e.status !== 'in-review') return false
  const r = reviewSlot(s, e)
  if (!r || r.slot.nodeId !== 'est') return false
  const me = s.people.find((p) => p.id === personId)
  return (r.slot.assigneeIds.includes(personId) && !r.slot.actedIds.includes(personId)) || !!me?.roles.some((x) => x === 'admin' || x === 'estimating-lead')
}

/** What the estimate would total after an adjustment (same pricing as adjustQuickEstimate). */
export function previewAdjust(s: AppState, e: Estimate, basis: QuickEstimate['basis'], pctAdj: number): { total: number; low: number; high: number; baseRate: number } | undefined {
  if (e.factor) {
    const r = previewFactorAdjust(s, e, pctAdj, basis)
    return r && { total: r.total, low: r.p10, high: r.p90, baseRate: r.base?.rate ?? 0 }
  }
  const row = e.quick && s.historicalCosts.find((h) => h.id === e.quick!.historicalCostId)
  if (!row || !e.quick) return
  return computeQuick({ ...s, historicalCosts: [{ ...row, active: true }] }, e.quick.inputs, basis, pctAdj)
}

/** Apply an estimator adjustment and keep the workflow's amount current. */
export function applyAdjustment(d: AppState, estimateId: string, o: { pct: number; basis: QuickEstimate['basis']; reason: string; note?: string }, byId = d.currentUserId) {
  const e0 = d.estimates.find((x) => x.id === estimateId)
  if (e0?.factor) adjustFactorEstimate(d, estimateId, o, byId)
  else adjustQuickEstimate(d, estimateId, o, byId)
  const e = d.estimates.find((x) => x.id === estimateId)
  const inst = e && d.workflows.find((w) => w.id === e.workflowInstanceId)
  if (e && inst && inst.status === 'running') { inst.data.amount = estimateTotals(e).total; e.quick!.reviewNote = o.note?.trim() ? `${o.reason} — ${o.note.trim()}` : o.reason }
}

export interface AdjustmentEntry { at: string; byId: string; pct?: number; basis?: string; from?: number; to?: number; reason: string; raw: string }

/** Every adjustment ever made to the estimate, from the audit trail (the estimate itself keeps only the latest). */
export function adjustmentHistory(s: Pick<AppState, 'audit'>, estimateId: string): AdjustmentEntry[] {
  return s.audit.filter((a: AuditEntry) => a.entityId === estimateId && a.action === 'adjust').map((a) => {
    const m = a.summary.match(/([+-]?\d+(?:\.\d+)?)%(?: at (P\d0))?: \$([\d.]+)M → \$([\d.]+)M — (.*)$/s)
    return m ? { at: a.at, byId: a.actorId, pct: Number(m[1]), basis: m[2] ?? 'P50', from: Number(m[3]) * 1e6, to: Number(m[4]) * 1e6, reason: m[5], raw: a.summary } : { at: a.at, byId: a.actorId, reason: a.summary, raw: a.summary }
  })
}

// ───────────────────────────── Historical cost table maintenance
export const histKey = (h: Pick<HistoricalCost, 'assetType' | 'workMethod' | 'diameterBand' | 'terrain'>) => `${h.assetType}|${h.workMethod}|${h.diameterBand}|${h.terrain}`
export const mixTotal = (mix: Record<string, number>) => Math.round(sum(Object.values(mix)) * 10000) / 100 // percent

export function validateHistorical(h: HistoricalCost, all: HistoricalCost[]): string[] {
  const out: string[] = []
  const c = catalogOf(h.assetType)
  if (!c) out.push(`${ASSET_LABEL[h.assetType] ?? h.assetType} is not in the quick estimate catalog`)
  else {
    if (!c.methods.includes(h.workMethod)) out.push(`${METHOD_LABEL[h.workMethod] ?? h.workMethod} is not a work method for ${c.label.toLowerCase()}`)
    if (h.unit !== c.unit) out.push(`Unit must be ${c.unit} for ${c.label.toLowerCase()}`)
  }
  if (!(h.p50 > 0)) out.push('P50 must be greater than zero')
  if (h.p10 > h.p50 || h.p50 > h.p90) out.push('P10 ≤ P50 ≤ P90')
  if (!(h.n >= 1)) out.push('n must be at least 1')
  if (!(h.baseYear >= 2000 && h.baseYear <= 2100)) out.push('Base year looks wrong')
  if (Math.abs(mixTotal(h.mix) - 100) > 0.5) out.push(`Category mix must total 100% (now ${mixTotal(h.mix).toFixed(1)}%)`)
  if (h.active && all.some((x) => x.id !== h.id && x.active && histKey(x) === histKey(h))) out.push('Another active row already covers this asset, method, band and setting')
  return out
}

export const HIST_COLUMNS = ['id', 'assetType', 'workMethod', 'diameterBand', 'terrain', 'unit', 'p10', 'p50', 'p90', 'n', 'baseYear', 'mix', 'sources', 'updatedAt', 'updatedById', 'active', 'note'] as const

export function historicalCsvRows(rows: HistoricalCost[]): Record<string, unknown>[] {
  return rows.map((h) => ({ id: h.id, assetType: h.assetType, workMethod: h.workMethod, diameterBand: h.diameterBand, terrain: h.terrain, unit: h.unit, p10: h.p10, p50: h.p50, p90: h.p90, n: h.n, baseYear: h.baseYear, mix: Object.entries(h.mix).map(([k, v]) => `${k}:${v}`).join(';'), sources: h.sources.join(';'), updatedAt: h.updatedAt, updatedById: h.updatedById, active: h.active ? 'yes' : 'no', note: h.note ?? '' }))
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function readCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) out.push(row); row = [] }
    else f += c
  }
  row.push(f)
  if (row.some((x) => x.trim() !== '')) out.push(row)
  return out
}

/** Parse an exported (or hand-edited) historical cost CSV. Rows with errors are reported, not imported. */
export function parseHistoricalCsv(text: string, s: Pick<AppState, 'settings' | 'currentUserId'>): { rows: HistoricalCost[]; errors: string[] } {
  const grid = readCsv(text.replace(/^﻿/, ''))
  if (!grid.length) return { rows: [], errors: ['The file is empty'] }
  const head = grid[0].map((h) => h.trim())
  const need = ['assetType', 'workMethod', 'diameterBand', 'terrain', 'p10', 'p50', 'p90', 'n', 'baseYear', 'mix']
  const missing = need.filter((k) => !head.includes(k))
  if (missing.length) return { rows: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`] }
  const rows: HistoricalCost[] = []
  const errors: string[] = []
  grid.slice(1).forEach((cells, k) => {
    const g = (key: string) => (cells[head.indexOf(key)] ?? '').trim()
    const line = k + 2
    const assetType = g('assetType') as AssetType
    const c = catalogOf(assetType)
    const mix: Record<string, number> = {}
    for (const part of g('mix').split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
      const [cat, v] = part.split(':')
      const n = Number(v)
      if (!cat || !Number.isFinite(n)) { errors.push(`Line ${line}: mix entry "${part}" should look like cat-contract:0.42`); return }
      mix[cat.trim()] = n > 1.0001 ? n / 100 : n
    }
    const num = (key: string) => Number(g(key).replace(/[$,\s]/g, ''))
    const h: HistoricalCost = {
      id: g('id') || '', assetType, workMethod: g('workMethod') as WorkMethod, diameterBand: (g('diameterBand') || 'n/a') as DiameterBand,
      terrain: (g('terrain') || 'any') as HistoricalCost['terrain'], unit: (g('unit') || c?.unit || 'ft') as HistUnit,
      p10: num('p10'), p50: num('p50'), p90: num('p90'), n: Math.round(num('n')), baseYear: Math.round(num('baseYear')), mix,
      sources: g('sources').split(/[;|]/).map((x) => x.trim()).filter(Boolean), updatedAt: s.settings.asOf, updatedById: s.currentUserId,
      active: !/^(no|false|0|inactive)$/i.test(g('active')), note: g('note') || undefined,
    }
    if (!c) { errors.push(`Line ${line}: unknown asset type "${assetType}"`); return }
    if (!DIAMETER_BANDS.some((b) => b.id === h.diameterBand)) { errors.push(`Line ${line}: unknown diameter band "${h.diameterBand}"`); return }
    if (!['urban', 'suburban', 'rural', 'any'].includes(h.terrain)) { errors.push(`Line ${line}: unknown setting "${h.terrain}"`); return }
    const v = validateHistorical(h, []).filter((x) => !x.startsWith('Another active row'))
    if (v.length) { errors.push(`Line ${line}: ${v.join('; ')}`); return }
    rows.push(h)
  })
  const keys = rows.filter((r) => r.active).map(histKey)
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
  if (dup.length) errors.push(`Duplicate active rows in the file: ${Array.from(new Set(dup)).map((k) => k.replace(/\|/g, ' · ')).join('; ')}`)
  return { rows, errors }
}

export interface ImportPlan { add: HistoricalCost[]; update: { from: HistoricalCost; to: HistoricalCost }[]; deactivate: HistoricalCost[]; unchanged: number }

/** What an import would do. Rows match on id, else on asset/method/band/setting. Replace deactivates rows not in the file (never deletes). */
export function planImport(existing: HistoricalCost[], incoming: HistoricalCost[], mode: 'merge' | 'replace'): ImportPlan {
  const plan: ImportPlan = { add: [], update: [], deactivate: [], unchanged: 0 }
  const touched = new Set<string>()
  const canon = (h: HistoricalCost) => JSON.stringify([histKey(h), h.unit, h.p10, h.p50, h.p90, h.n, h.baseYear, Object.entries(h.mix).filter(([, v]) => v).sort(), h.sources, h.active, h.note ?? ''])
  const same = (a: HistoricalCost, b: HistoricalCost) => canon(a) === canon(b)
  for (const r of incoming) {
    const hit = (r.id && existing.find((x) => x.id === r.id)) || existing.find((x) => histKey(x) === histKey(r) && (x.active || !r.active))
    if (hit) {
      touched.add(hit.id)
      const to = { ...r, id: hit.id }
      if (same(hit, to)) plan.unchanged++
      else plan.update.push({ from: hit, to })
    } else plan.add.push({ ...r, id: r.id && !existing.some((x) => x.id === r.id) ? r.id : '' })
  }
  if (mode === 'replace') plan.deactivate = existing.filter((x) => x.active && !touched.has(x.id))
  return plan
}

export function applyImport(d: AppState, plan: ImportPlan, byId = d.currentUserId) {
  let k = d.historicalCosts.length
  for (const r of plan.add) {
    let id = r.id
    while (!id || d.historicalCosts.some((x) => x.id === id)) id = `hc-${++k}`
    d.historicalCosts.push({ ...r, id, updatedAt: d.settings.asOf, updatedById: byId })
  }
  for (const u of plan.update) { const x = d.historicalCosts.find((h) => h.id === u.from.id); if (x) Object.assign(x, u.to, { updatedAt: d.settings.asOf, updatedById: byId }) }
  for (const r of plan.deactivate) { const x = d.historicalCosts.find((h) => h.id === r.id); if (x) { x.active = false; x.updatedAt = d.settings.asOf; x.updatedById = byId } }
}

// ───────────────────────────── Derive from closed projects
export interface DerivedPoint { projectId: string; code: string; perUnitBase: number; perUnitNominal: number; year: number; qty: number }
export interface Suggestion { key: string; row?: HistoricalCost; points: DerivedPoint[]; current?: Pick<HistoricalCost, 'p10' | 'p50' | 'p90' | 'n'>; suggested: HistoricalCost }

/**
 * Closed projects whose final actuals are not yet in the table, grouped by the row they price into.
 * Unit cost is normalized to the row's base year; the suggested P50 is the n-weighted blend, P10/P90 move with it
 * and widen to cover any new point outside the band.
 */
export function deriveSuggestions(s: AppState): Suggestion[] {
  const groups = new Map<string, { row?: HistoricalCost; inputs: QuickInputs; points: DerivedPoint[] }>()
  for (const p of s.projects.filter((x) => x.status === 'closed')) {
    const dv = deriveFromClosed(s, p)
    if (!dv) continue
    const inputs = inputsFromProject(s, p)
    const m = findHistorical(s, inputs)
    const row = m.match === 'exact' || m.match === 'any-terrain' ? m.row : undefined
    if (row?.sources.includes(p.code)) continue
    const baseYear = row?.baseYear ?? dv.year
    const f = dv.year >= baseYear ? 1 / escalationFactor(s, baseYear, dv.year) : escalationFactor(s, dv.year, baseYear)
    const key = row ? row.id : histKey({ ...inputs, terrain: inputs.terrain })
    const g = groups.get(key) ?? { row, inputs, points: [] }
    g.points.push({ projectId: p.id, code: p.code, perUnitBase: Math.round(dv.perUnit * f), perUnitNominal: Math.round(dv.perUnit), year: dv.year, qty: dv.qty })
    groups.set(key, g)
  }
  return Array.from(groups.entries()).map(([key, g]) => {
    const vals = g.points.map((x) => x.perUnitBase)
    const codes = g.points.map((x) => x.code)
    if (g.row) {
      const r = g.row
      const n = r.n + vals.length
      const p50 = Math.round((r.p50 * r.n + sum(vals)) / n)
      const ratio = p50 / r.p50
      const p10 = Math.min(Math.round(r.p10 * ratio), ...vals)
      const p90 = Math.max(Math.round(r.p90 * ratio), ...vals)
      return { key, row: r, points: g.points, current: { p10: r.p10, p50: r.p50, p90: r.p90, n: r.n }, suggested: { ...r, p10, p50, p90, n, sources: [...r.sources, ...codes], note: r.note } }
    }
    const near = findHistorical(s, g.inputs).row
    const v = Math.round(sum(vals) / vals.length)
    return {
      key, points: g.points,
      suggested: { id: '', assetType: g.inputs.assetType, workMethod: g.inputs.workMethod, diameterBand: g.inputs.diameterBand, terrain: g.inputs.terrain, unit: g.inputs.unit, p10: Math.min(...vals), p50: v, p90: Math.max(...vals), n: vals.length, baseYear: g.points[0].year, mix: near ? { ...near.mix } : {}, sources: codes, updatedAt: s.settings.asOf, updatedById: s.currentUserId, active: true, note: `New row from ${codes.join(', ')}${near ? `; category mix copied from ${bandLabel(near.diameterBand)} ${TERRAIN_LABEL[near.terrain].toLowerCase()} row` : ''} — set P10/P90 before relying on it` },
    }
  })
}

/** Projects whose quick estimates reference a historical row (to warn before editing it). */
export function rowUsage(s: Pick<AppState, 'estimates'>, rowId: string) {
  const es = s.estimates.filter((e) => e.method === 'quick' && e.quick?.historicalCostId === rowId)
  return { total: es.length, inReview: es.filter((e) => e.status === 'in-review').length }
}

export const projectLabel = (p?: Project) => (p ? `${p.code} · ${p.name}` : '—')
