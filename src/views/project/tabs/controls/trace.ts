// Traceability logic shared by Baselines, Cost, Changes, Evidence and Regulatory (builder C).
// Pure functions over AppState: every figure here is derived from store records.
import type { AppState, Change, Project, Snapshot, SnapshotType, WorkflowInstance } from '@/core/types'
import { personName } from '@/core/store'
import { activeBudget, position, snapshotsFor, thresholdBreaches } from '@/core/engine/position'
import { evmMetrics } from '@/core/engine/evm'
import { templateFor } from '@/core/engine/gates'
import { daysBetween, fmtDate, money, sum } from '@/core/util'

// ───────────────────────────── Snapshot type presentation
export const SNAP_META: Record<SnapshotType, { label: string; color: string; shape: 'diamond' | 'circle' | 'tick' | 'square' | 'triangle' | 'ring'; tone: 'ink' | 'info' | 'neutral' | 'marker' | 'good' }> = {
  original: { label: 'Original', color: 'rgb(var(--ink))', shape: 'diamond', tone: 'ink' },
  current: { label: 'Current', color: 'rgb(var(--link))', shape: 'circle', tone: 'info' },
  'period-close': { label: 'Period close', color: 'rgb(var(--faint))', shape: 'tick', tone: 'neutral' },
  gate: { label: 'Gate', color: 'rgb(var(--marker))', shape: 'square', tone: 'marker' },
  regulatory: { label: 'Regulatory', color: 'rgb(var(--good))', shape: 'triangle', tone: 'good' },
  forecast: { label: 'Forecast', color: 'rgb(var(--info))', shape: 'ring', tone: 'info' },
}

/** Cross-tab focus: a link elsewhere can ask the Baselines tab to open a snapshot (hash routes carry no ids). */
let focusSnap: string | null = null
export const setFocusSnapshot = (id: string | null) => { focusSnap = id }
export const takeFocusSnapshot = () => { const x = focusSnap; focusSnap = null; return x }
let focusChange: string | null = null
export const setFocusChange = (id: string | null) => { focusChange = id }
export const takeFocusChange = () => { const x = focusChange; focusChange = null; return x }

// ───────────────────────────── Workflow approval chain
export interface ChainStep { at: string; actorId: string; actor: string; title: string; step: string; action: string; comment?: string; sig?: string }

export function approvalChain(s: AppState, instId?: string): ChainStep[] {
  const inst = s.workflows.find((w) => w.id === instId)
  if (!inst) return []
  const def = s.workflowDefs.find((d) => d.id === inst.defId)
  const label = (id: string) => def?.nodes.find((n) => n.id === id)?.label ?? ''
  return inst.history
    .filter((h) => ['start', 'submit', 'approve', 'return', 'reject', 'recall', 'complete'].includes(h.action))
    .map((h) => ({ at: h.at, actorId: h.actorId, actor: personName(s, h.actorId), title: s.people.find((p) => p.id === h.actorId)?.title ?? '', step: h.action === 'complete' ? 'Workflow complete' : label(h.nodeId), action: h.action === 'complete' ? `complete — ${h.comment}` : h.action, comment: h.action === 'complete' ? undefined : h.comment, sig: h.signature?.hash }))
}

/** The final dollar-authority (or last) approval event of an instance. */
export function finalApprover(s: AppState, inst?: WorkflowInstance) {
  if (!inst) return undefined
  const ev = [...inst.history].reverse().find((h) => h.action === 'approve')
  return ev ? { name: personName(s, ev.actorId), title: s.people.find((p) => p.id === ev.actorId)?.title ?? '', at: ev.at, sig: ev.signature?.hash } : undefined
}

export function doaLabel(s: AppState, projectId: string, amount: number) {
  const p = s.projects.find((x) => x.id === projectId)
  const prog = s.programs.find((x) => x.id === p?.programId)
  const m = s.doaMatrices.find((x) => x.id === prog?.doaMatrixId) ?? s.doaMatrices[0]
  if (!m) return { label: '—', roleId: undefined as string | undefined, people: [] as string[], matrix: '' }
  const rows = m.rows.slice().sort((a, b) => a.upTo - b.upTo)
  const row = rows.find((r) => Math.abs(amount) <= r.upTo) ?? rows[rows.length - 1]
  const people = s.people.filter((x) => x.roles.includes(row.roleId) && !x.company).map((x) => x.name)
  return { label: row.label, roleId: row.roleId, people, matrix: `${m.name} v${m.version}` }
}

// ───────────────────────────── Snapshots & baselines
/** What authorized a snapshot: the gate decision, the approved change, or the person who froze it. */
export function snapshotAuthority(s: AppState, snap: Snapshot): { kind: string; text: string; signers: { name: string; at?: string; sig?: string }[]; changeId?: string; gateDecisionId?: string } {
  if (snap.changeId) {
    const c = s.changes.find((x) => x.id === snap.changeId)
    const inst = s.workflows.find((w) => w.id === c?.workflowInstanceId)
    const fa = finalApprover(s, inst)
    return { kind: 'Approved change', text: c ? `${c.code} ${c.title} — approved ${fmtDate(c.decidedAt)}${fa ? ` by ${fa.name}` : ''}` : 'Change record not found', signers: fa ? [{ name: `${fa.name}, ${fa.title}`, at: fa.at, sig: fa.sig }] : [], changeId: c?.id }
  }
  const gd = s.gateDecisions.find((g) => g.snapshotId === snap.id) ?? (snap.type === 'original' || snap.type === 'current' ? s.gateDecisions.find((g) => g.projectId === snap.projectId && g.date === snap.date && (g.outcome === 'go' || g.outcome === 'go-with-conditions')) : undefined)
  if (gd) return { kind: 'Gate decision', text: `${gd.gateName} — ${gd.outcome.replace(/-/g, ' ')} on ${fmtDate(gd.date)} (readiness ${gd.readiness}%)`, signers: gd.decidedBy.map((id) => ({ name: `${personName(s, id)}, ${s.people.find((p) => p.id === id)?.title ?? ''}` })), gateDecisionId: gd.id }
  const by = personName(s, snap.createdById)
  if (snap.type === 'regulatory') return { kind: 'Regulatory snapshot', text: `Frozen for ${snap.proceeding ?? 'regulatory filing'} by ${by}`, signers: [{ name: by }] }
  if (snap.type === 'period-close') return { kind: 'Monthly close', text: `Period close frozen by ${by} (project controls)`, signers: [{ name: by }] }
  if (snap.type === 'forecast') return { kind: 'Forecast snapshot', text: `Forecast position frozen by ${by}`, signers: [{ name: by }] }
  return { kind: 'Manual', text: `Taken by ${by}`, signers: [{ name: by }] }
}

/** Baseline (Original/Current) in force on a date, optionally ignoring one snapshot. */
export function baselineInForce(s: AppState, pid: string, date: string, excludeId?: string): Snapshot | undefined {
  return snapshotsFor(s, pid).filter((x) => (x.type === 'current' || x.type === 'original') && x.date <= date && x.id !== excludeId).sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'current' ? 1 : -1)).pop()
}

export const changeBaseline = (s: AppState, c: Change) => (c.baselineSnapshotId ? s.snapshots.find((x) => x.id === c.baselineSnapshotId) : baselineInForce(s, c.projectId, c.decidedAt ?? c.requestedAt, c.resultingSnapshotId))

/** Approved changes decided after snapshot A and up to snapshot B. */
export function changesBetween(s: AppState, pid: string, a: Snapshot, b: Snapshot): Change[] {
  const [lo, hi] = a.date <= b.date ? [a, b] : [b, a]
  return s.changes.filter((c) => c.projectId === pid && c.status === 'approved' && c.decidedAt && c.decidedAt >= lo.date && c.decidedAt <= hi.date && c.resultingSnapshotId !== lo.id)
}

export const stageLabel = (s: AppState, p: Project, idx: number) => templateFor(s, p).stages[idx]?.name ?? `Stage ${idx + 1}`

// ───────────────────────────── Forecast by year
const thisYear = (s: AppState) => Number(s.settings.asOf.slice(0, 4))

export function actualsByYear(s: AppState, pid: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of s.costPeriods.filter((x) => x.projectId === pid)) out[c.period.slice(0, 4)] = (out[c.period.slice(0, 4)] || 0) + c.actual
  return out
}

/** Forecast by year = recorded actuals for past years + (EAC − actual to date) spread by the latest forecast's profile. */
export function forecastByYear(s: AppState, pid: string): Record<string, number> {
  const pos = position(s, pid)
  const act = actualsByYear(s, pid)
  const y0 = thisYear(s)
  const out: Record<string, number> = {}
  for (const [y, v] of Object.entries(act)) out[y] = v
  const remaining = Math.max(0, pos.eac - pos.actualToDate)
  if (!pos.eac) {
    const b = activeBudget(s, pid)
    for (const [y, v] of Object.entries(b?.byYear ?? {})) if (Number(y) >= y0) out[y] = (out[y] || 0) + v
    return out
  }
  const fc = s.forecasts.filter((f) => f.projectId === pid).sort((a, b) => a.date.localeCompare(b.date)).pop()
  let prof = Object.entries(fc?.byYear ?? {}).filter(([y]) => Number(y) >= y0)
  if (!prof.length) prof = Object.entries(activeBudget(s, pid)?.byYear ?? {}).filter(([y]) => Number(y) >= y0)
  if (!prof.length) prof = [[String(y0), 1]]
  const W = sum(prof.map(([, v]) => v)) || 1
  let acc = 0
  prof.forEach(([y, v], i) => {
    const share = i === prof.length - 1 ? remaining - acc : Math.round((remaining * v) / W)
    acc += share
    out[y] = (out[y] || 0) + share
  })
  return out
}

export interface YearRow { year: number; authorized: number; planned: number; recorded: number; forecast: number; proceeding: string }

/** BL-08: authorized vs planned vs recorded vs forecast for a program (or all programs when programId is empty). */
export function programYears(s: AppState, programId?: string): YearRow[] {
  const progs = s.programs.filter((p) => !programId || p.id === programId)
  const projects = s.projects.filter((p) => progs.some((g) => g.id === p.programId) && p.status !== 'cancelled')
  const years = new Map<number, YearRow>()
  const row = (y: number) => { if (!years.has(y)) years.set(y, { year: y, authorized: 0, planned: 0, recorded: 0, forecast: 0, proceeding: '' }); return years.get(y)! }
  for (const f of s.funding.filter((f) => progs.some((g) => g.id === f.programId))) { const r = row(f.year); r.authorized += f.authorized; if (!r.proceeding.includes(f.proceeding)) r.proceeding = r.proceeding ? r.proceeding : f.proceeding }
  for (const p of projects) {
    for (const [y, v] of Object.entries(activeBudget(s, p.id)?.byYear ?? {})) row(Number(y)).planned += v
    for (const [y, v] of Object.entries(actualsByYear(s, p.id))) row(Number(y)).recorded += v
    for (const [y, v] of Object.entries(forecastByYear(s, p.id))) row(Number(y)).forecast += v
  }
  return [...years.values()].sort((a, b) => a.year - b.year)
}

// ───────────────────────────── ERP reconciliation (CC-01)
function h32(str: string) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) } return h >>> 0 }
/** Content fingerprint for signed exports (FNV-1a, two passes). Not a security control — a tamper-evidence aid. */
export const fingerprint = (str: string) => h32(str).toString(16).padStart(8, '0') + h32(str.split('').reverse().join('')).toString(16).padStart(8, '0')

export interface ReconRow { categoryId: string; name: string; element: string; budget: number; actual: number }
export interface Recon { rows: ReconRow[]; unmapped: { amount: number; period: string; element: string; text: string } | null; erpTotal: number; mainlineTotal: number; budgetTotal: number }

/**
 * Actuals by cost element vs budget by category. Cost periods carry project totals only, so ERP postings
 * by element are simulated deterministically from budget shares; the small unmapped line is drawn from the
 * latest period and labeled as simulated. ERP total always ties to Crosswalk actual to date.
 */
export function erpRecon(s: AppState, pid: string): Recon {
  const p = s.projects.find((x) => x.id === pid)!
  const b = activeBudget(s, pid)
  const pos = position(s, pid)
  const byCat: Record<string, number> = { ...(b?.byCategory ?? {}) }
  for (const c of s.changes.filter((c) => c.projectId === pid && c.status === 'approved' && (!b || (c.decidedAt ?? c.requestedAt) >= b.createdAt))) byCat[c.categoryId] = (byCat[c.categoryId] || 0) + c.costImpact
  const periods = s.costPeriods.filter((x) => x.projectId === pid).sort((a, c) => a.period.localeCompare(c.period))
  const last = periods[periods.length - 1]
  const mapped = s.audit.some((a) => a.entity === 'erp-recon' && a.entityId === `${pid}:${last?.period}`)
  const unmappedAmt = last && !mapped ? Math.round(last.actual * 0.0062) : 0
  const toSpread = pos.actualToDate - unmappedAmt
  const cats = Object.keys(byCat).filter((k) => byCat[k] > 0)
  const w = cats.map((k) => byCat[k] * (0.82 + (h32(pid + k) % 1000) / 2800))
  const W = sum(w) || 1
  let acc = 0
  const rows: ReconRow[] = cats.map((k, i) => {
    const cat = s.categories.find((c) => c.id === k)
    const v = i === cats.length - 1 ? toSpread - acc : Math.round((toSpread * w[i]) / W)
    acc += v
    return { categoryId: k, name: cat?.name ?? k, element: cat?.erpCostElement ?? '—', budget: byCat[k], actual: v }
  })
  return {
    rows,
    unmapped: unmappedAmt ? { amount: unmappedAmt, period: last!.period, element: '5999000', text: `Posting to WBS ${p.erpWbs}.99 on suspense element 5999000 (simulated demo line)` } : null,
    erpTotal: pos.actualToDate,
    mainlineTotal: sum(periods.map((x) => x.actual)),
    budgetTotal: sum(Object.values(byCat)),
  }
}

// ───────────────────────────── Evidence completeness (RC-01, AI-06 style deterministic)
export interface Check { id: string; area: string; label: string; ok: boolean; severity: 'major' | 'minor'; gap?: string; tab?: string }
export interface Assessment { checks: Check[]; score: number; gaps: Check[]; passed: number }

export function assessEvidence(s: AppState, pid: string): Assessment {
  const p = s.projects.find((x) => x.id === pid)!
  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)
  const pos = position(s, pid)
  const budget = activeBudget(s, pid)
  const t = s.settings.varianceThresholds

  // Need & driver
  add({ id: 'need-driver', area: 'Need', label: 'Regulatory driver and recovery proceeding named', ok: !!p.regulatoryCitation && !!p.fundingProceeding, severity: 'major', gap: 'Regulatory driver or proceeding not recorded', tab: 'overview' })
  add({ id: 'need-option', area: 'Need', label: 'Option analysis decision logged', ok: s.decisions.some((x) => x.projectId === pid), severity: 'minor', gap: 'No alternatives decision in the decision log', tab: 'records' })

  // Estimates
  const ests =s.estimates.filter((e) => e.projectId === pid).sort((a, b) => a.version - b.version)
  for (const e of ests.filter((e) => e.status === 'approved' || e.status === 'superseded')) {
    const inst = s.workflows.find((w) => w.id === e.workflowInstanceId)
    add({ id: `est-appr-${e.id}`, area: 'Estimates', label: `Estimate v${e.version} (Class ${e.cls}) approved through workflow`, ok: !!e.approvedById && inst?.status === 'approved', severity: 'major', gap: `Estimate v${e.version} has no workflow approval record`, tab: 'estimates' })
    const miss = [!e.basis.exclusions.length && 'exclusions', !e.basis.assumptions.length && 'assumptions', !e.basis.contingencyRationale.trim() && 'contingency rationale', !e.basis.classJustification.trim() && 'class justification', !e.basis.scopeBasis.trim() && 'scope basis'].filter(Boolean)
    add({ id: `est-boe-${e.id}`, area: 'Estimates', label: `Estimate v${e.version} basis of estimate complete`, ok: !miss.length, severity: 'minor', gap: `Estimate v${e.version} missing BOE ${miss.join(', ')}`, tab: 'estimates' })
  }
  for (const e of ests.filter((e) => e.status === 'in-review')) add({ id: `est-rev-${e.id}`, area: 'Estimates', label: `Estimate v${e.version} decided`, ok: false, severity: 'minor', gap: `Class ${e.cls} estimate v${e.version} is still in review`, tab: 'estimates' })
  if (budget) add({ id: 'bud-src', area: 'Budget', label: `${budget.kind === 'control' ? 'Control' : 'Planning'} budget traces to an approved estimate`, ok: ests.some((e) => e.id === budget.estimateId && (e.status === 'approved' || e.status === 'superseded')), severity: 'major', gap: 'Budget is not linked to an approved estimate', tab: 'estimates' })

  // Baselines
  const snaps = snapshotsFor(s, pid)
  if (budget?.kind === 'control') add({ id: 'bl-orig', area: 'Baselines', label: 'Original baseline frozen at authorization', ok: snaps.some((x) => x.type === 'original'), severity: 'major', gap: 'No Original baseline snapshot', tab: 'baselines' })
  for (const sn of snaps.filter((x) => x.type === 'current' || x.type === 'original')) {
    const a = snapshotAuthority(s, sn)
    add({ id: `bl-auth-${sn.id}`, area: 'Baselines', label: `${SNAP_META[sn.type].label} baseline ${fmtDate(sn.date)} has an approving decision`, ok: a.kind === 'Gate decision' || a.kind === 'Approved change', severity: 'major', gap: `${SNAP_META[sn.type].label} baseline of ${fmtDate(sn.date)} has no approving decision`, tab: 'baselines' })
  }

  // Changes
  const changes = s.changes.filter((c) => c.projectId === pid)
  const variances = s.variances.filter((v) => v.projectId === pid)
  for (const c of changes.filter((c) => c.status === 'approved')) {
    const inst = s.workflows.find((w) => w.id === c.workflowInstanceId)
    const signed = !!inst && inst.history.some((h) => h.action === 'approve' && h.nodeId === 'approve' && h.signature)
    add({ id: `ch-sig-${c.id}`, area: 'Changes', label: `${c.code} approved by dollar authority with e-signature`, ok: signed, severity: 'major', gap: `${c.code} has no signed dollar-authority approval`, tab: 'changes' })
    add({ id: `ch-snap-${c.id}`, area: 'Changes', label: `${c.code} produced a new Current baseline`, ok: !!c.resultingSnapshotId && s.snapshots.some((x) => x.id === c.resultingSnapshotId), severity: 'major', gap: `${c.code} did not produce a baseline snapshot`, tab: 'changes' })
    if (Math.abs(c.costImpact) >= t.eacAbs || c.rootCause === 'Estimate error') add({ id: `ch-var-${c.id}`, area: 'Changes', label: `${c.code} (${money(c.costImpact)}) cited in a variance explanation`, ok: variances.some((v) => v.changeIds.includes(c.id) && v.status !== 'required'), severity: 'major', gap: `Change ${c.code} (${money(c.costImpact)}) has no linked variance explanation`, tab: 'cost' })
    if (c.fundedFrom === 'contingency') add({ id: `ch-risk-${c.id}`, area: 'Changes', label: `${c.code} contingency draw tied to a risk`, ok: !!c.riskId, severity: 'minor', gap: `${c.code} drew ${money(c.costImpact)} contingency without a linked risk`, tab: 'changes' })
  }

  // Variances
  const breaches = p.status === 'active' ? thresholdBreaches(s, p) : []
  for (const b of breaches) add({ id: `br-${b.description}`, area: 'Variances', label: `Threshold breach explained: ${b.description}`, ok: variances.some((v) => v.description === b.description && v.status !== 'required' && v.status !== 'returned'), severity: 'major', gap: `Unexplained threshold breach: ${b.description}`, tab: 'cost' })
  for (const v of variances.filter((v) => !breaches.some((b) => b.description === v.description))) {
    add({ id: `var-${v.id}`, area: 'Variances', label: `Variance "${v.description}" accepted`, ok: v.status === 'accepted', severity: v.status === 'submitted' ? 'minor' : 'major', gap: v.status === 'submitted' ? `Variance "${v.description}" awaiting acceptance` : `Variance "${v.description}" has no accepted explanation`, tab: 'cost' })
  }

  // Forecast
  if (budget?.kind === 'control' && p.status === 'active') {
    const fc = s.forecasts.filter((f) => f.projectId === pid).sort((a, b) => a.date.localeCompare(b.date)).pop()
    const age = fc ? daysBetween(fc.date, s.settings.asOf) : 999
    add({ id: 'fc-cur', area: 'Cost', label: 'Signed forecast within the last 45 days', ok: !!fc && fc.locked && age <= 45, severity: 'minor', gap: fc ? (fc.locked ? `Latest signed forecast is ${age} days old` : `Forecast of ${fmtDate(fc.date)} awaits PM sign-off`) : 'No forecast on record', tab: 'cost' })
  }

  // Risk & contingency
  for (const r of s.risks.filter((r) => r.projectId === pid && r.status === 'realized')) {
    const draw = s.contingencyDraws.find((d) => d.riskId === r.id && d.status === 'approved') || changes.find((c) => c.riskId === r.id && c.status === 'approved')
    add({ id: `rk-${r.id}`, area: 'Risk & contingency', label: `Realized risk ${r.code} funded by an approved draw or change`, ok: !!draw, severity: 'minor', gap: `Realized risk ${r.code} has no approved contingency draw`, tab: 'risk' })
  }
  for (const d of s.contingencyDraws.filter((x) => x.projectId === pid && x.status === 'approved')) {
    const inst = s.workflows.find((w) => w.id === d.workflowInstanceId)
    add({ id: `dr-${d.id}`, area: 'Risk & contingency', label: `Contingency draw ${money(d.amount)} approved through workflow`, ok: inst?.status === 'approved', severity: 'major', gap: `Contingency draw of ${money(d.amount)} (${fmtDate(d.date)}) has no workflow approval`, tab: 'risk' })
  }
  if (pos.contingencyOriginal) add({ id: 'cont-neg', area: 'Risk & contingency', label: 'Contingency not overdrawn', ok: pos.contingencyRemaining >= 0, severity: 'major', gap: `Contingency overdrawn by ${money(-pos.contingencyRemaining)}`, tab: 'risk' })

  // Gates
  for (const g of s.gateDecisions.filter((g) => g.projectId === pid)) {
    add({ id: `gd-${g.id}`, area: 'Gates', label: `${g.gateName} decision recorded with deciders and snapshot`, ok: g.decidedBy.length > 0 && !!g.snapshotId, severity: 'major', gap: `${g.gateName} decision lacks deciders or snapshot`, tab: 'lifecycle' })
    for (const aid of g.conditions) {
      const a = s.actions.find((x) => x.id === aid)
      if (a && a.status === 'open' && a.due < s.settings.asOf) add({ id: `gc-${aid}`, area: 'Gates', label: `Gate condition closed: ${a.title}`, ok: false, severity: 'minor', gap: `${g.gateName} condition "${a.title}" open past due (${fmtDate(a.due)})`, tab: 'lifecycle' })
    }
  }
  for (const d of s.deliverables.filter((x) => x.projectId === pid && x.status === 'waived')) add({ id: `wv-${d.id}`, area: 'Gates', label: 'Deliverable waiver', ok: false, severity: 'minor', gap: `Deliverable waived: ${d.waiverReason || 'no reason recorded'}`, tab: 'lifecycle' })

  // Records
  const recs = s.records.filter((r) => r.projectId === pid)
  if (recs.length) {
    const missing = recs.filter((r) => r.status === 'missing')
    add({ id: 'rec-missing', area: 'Records', label: 'Construction records attached (traceable)', ok: !missing.length, severity: 'major', gap: `${missing.length} of ${recs.length} construction records missing (${missing.slice(0, 2).map((r) => `${r.type}, ${r.segment}`).join('; ')}${missing.length > 2 ? '…' : ''})`, tab: 'records' })
    const unverified = recs.filter((r) => r.status === 'attached')
    add({ id: 'rec-verified', area: 'Records', label: 'Attached records verified', ok: !unverified.length, severity: 'minor', gap: `${unverified.length} attached records not yet verified`, tab: 'records' })
  }

  // Safety
  const plans = s.safetyPlans.filter((x) => x.projectId === pid)
  if (plans.length && p.status === 'active') add({ id: 'sf-plan', area: 'Safety', label: 'Approved job-specific safety plan in force', ok: plans.some((x) => x.status === 'approved'), severity: 'major', gap: 'No approved job-specific safety plan', tab: 'safety' })
  const sif = s.safetyEvents.filter((e) => e.projectId === pid && e.sifPotential && e.status === 'open')
  if (sif.length) add({ id: 'sf-sif', area: 'Safety', label: 'SIF-potential events closed', ok: false, severity: 'minor', gap: `${sif.length} SIF-potential event${sif.length > 1 ? 's' : ''} still open`, tab: 'safety' })

  const w = (c: Check) => (c.severity === 'major' ? 3 : 1)
  const total = sum(checks.map(w))
  const got = sum(checks.filter((c) => c.ok).map(w))
  const gaps = checks.filter((c) => !c.ok).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'major' ? -1 : 1))
  return { checks, gaps, passed: checks.length - gaps.length, score: total ? Math.round((got / total) * 100) : 100 }
}

// ───────────────────────────── Small helpers
export function evmFor(s: AppState, pid: string) {
  const periods = s.costPeriods.filter((c) => c.projectId === pid)
  return evmMetrics(periods, position(s, pid).baseBudget)
}

export const nextChangeCode = (s: AppState, p: Project) => `CR-${p.code.slice(4)}-${String(s.changes.filter((c) => c.projectId === p.id).length + 1).padStart(2, '0')}`

export const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
