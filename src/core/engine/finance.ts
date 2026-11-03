// Project finance (Finance tab): financial accounts (WOA + internal orders), commitments ("call-offs")
// against vendor POs, RFI / contract change orders, and the coverage checks that close the loop:
// every WBS function with budget is carried by an IO, every estimate line is bought through a commitment.
// Pure functions plus draft mutators; no UI.
import type { AppState, Change, CommitmentChange, Contract, InternalOrder, Money, Project } from '../types'
import { addDays, nowISO, sum, uid } from '../util'
import { estimateTotals } from './estimates'
import { activeBudget } from './position'
import { budgetByLine, forecastLines, lineById, toLines } from './lines'
import { toFunctions, budgetByFunction } from './wbs'
import { actOnWorkflow, startWorkflow } from './workflow'
import { requiredDefs, templateFor } from './gates'

// ───────────────────────────── Budget basis (budget when authorized, else the latest estimate)

export type BasisKind = 'budget' | 'estimate' | 'none'

/** Latest estimate that still counts (approved preferred, then in review / draft). */
export function latestEstimate(s: AppState, pid: string) {
  const es = s.estimates.filter((e) => e.projectId === pid && e.status !== 'superseded' && e.status !== 'rejected')
  const appr = es.filter((e) => e.status === 'approved').sort((a, b) => b.version - a.version)[0]
  return appr ?? es.sort((a, b) => b.version - a.version)[0]
}

/** Budget (or, before a budget exists, the latest estimate) by forecast line, contingency separate. */
export function basisByLine(s: AppState, pid: string): { kind: BasisKind; byLine: Record<string, Money>; contingency: Money; label: string } {
  if (activeBudget(s, pid)) {
    const b = budgetByLine(s, pid)
    return { kind: 'budget', byLine: b.byLine, contingency: b.contingency, label: 'current budget' }
  }
  const e = latestEstimate(s, pid)
  if (!e) return { kind: 'none', byLine: {}, contingency: 0, label: 'no estimate yet' }
  const t = estimateTotals(e)
  const l = toLines(s, t.byCategory)
  return { kind: 'estimate', byLine: l.byLine, contingency: t.contingency, label: `estimate v${e.version} (Class ${e.cls})` }
}

/** Same basis rolled up to WBS functions. */
export function basisByFunction(s: AppState, pid: string): { kind: BasisKind; byFn: Record<string, Money>; contingency: Money; label: string } {
  if (activeBudget(s, pid)) {
    const b = budgetByFunction(s, pid)
    return { kind: 'budget', byFn: b.byFn, contingency: b.contingency, label: 'current budget' }
  }
  const e = latestEstimate(s, pid)
  if (!e) return { kind: 'none', byFn: {}, contingency: 0, label: 'no estimate yet' }
  const t = estimateTotals(e)
  return { kind: 'estimate', byFn: toFunctions(s, t.byCategory).byFn, contingency: t.contingency, label: `estimate v${e.version} (Class ${e.cls})` }
}

// ───────────────────────────── Internal orders

export const ioLabel = (io?: InternalOrder) => (io ? `${io.number} · ${io.type === 'capital' ? 'Capital' : 'O&M'}` : '—')

export interface FnCoverage { fnId: string; code: string; name: string; budget: Money; ios: InternalOrder[]; status: 'ok' | 'pending' | 'gap' | 'duplicate' | 'closed'; note: string }

/**
 * The feedback loop once IOs exist: every WBS function with budget must be carried by exactly one live IO.
 * pending = only a requested IO carries it; closed = only closed IOs; duplicate = more than one live IO.
 */
export function ioCoverage(s: AppState, p: Project): { rows: FnCoverage[]; gaps: FnCoverage[]; basis: BasisKind; basisLabel: string } {
  const b = basisByFunction(s, p.id)
  const ios = p.finance?.ios ?? []
  const rows: FnCoverage[] = s.settings.wbsFunctions.map((fn) => {
    const budget = b.byFn[fn.id] || 0
    const carriers = ios.filter((io) => io.functionIds.includes(fn.id))
    const live = carriers.filter((io) => io.status !== 'closed')
    let status: FnCoverage['status'] = 'ok'
    let note = ''
    if (!carriers.length) { status = budget > 0 ? 'gap' : 'ok'; note = budget > 0 ? 'Budget with no internal order to charge' : 'No budget' }
    else if (!live.length) { status = budget > 0 && p.status !== 'closed' ? 'closed' : 'ok'; note = 'Only closed IOs carry it' }
    else if (live.length > 1) { status = 'duplicate'; note = `${live.length} live IOs carry it — charges could split` }
    else if (live[0].status === 'requested') { status = 'pending'; note = `IO ${live[0].number} requested, not yet open in SAP` }
    else note = `Charges to ${live[0].number}`
    return { fnId: fn.id, code: fn.code, name: fn.name, budget, ios: carriers, status, note }
  })
  return { rows, gaps: rows.filter((r) => r.budget > 0 && r.status !== 'ok'), basis: b.kind, basisLabel: b.label }
}

/** Capital vs O&M: the split implied by the IOs (budget each IO type carries) vs the scope statement's split. */
export function capitalSplit(s: AppState, p: Project): { scopeCapitalPct?: number; ioCapitalPct?: number; capital: Money; om: Money; unassigned: Money; deltaPts?: number } {
  const b = basisByFunction(s, p.id)
  const ios = (p.finance?.ios ?? []).filter((io) => io.status !== 'closed' || p.status === 'closed')
  let capital = 0, om = 0, unassigned = 0
  for (const [fn, amt] of Object.entries(b.byFn)) {
    if (!amt) continue
    const io = ios.find((x) => x.functionIds.includes(fn))
    if (!io) unassigned += amt
    else if (io.type === 'capital') capital += amt
    else om += amt
  }
  const tot = capital + om
  const ioCapitalPct = tot ? Math.round((capital / tot) * 1000) / 10 : undefined
  const scopeCapitalPct = p.scope.capitalPct
  return { scopeCapitalPct, ioCapitalPct, capital, om, unassigned, deltaPts: ioCapitalPct !== undefined && scopeCapitalPct !== undefined ? Math.round((ioCapitalPct - scopeCapitalPct) * 10) / 10 : undefined }
}

/** Next internal order number in the project's series (71nnnnXX capital, 72nnnnXX O&M). */
export function nextIoNumber(p: Project, type: InternalOrder['type']): string {
  const n = p.code.replace(/\D/g, '')
  const prefix = (type === 'capital' ? '71' : '72') + n
  const used = (p.finance?.ios ?? []).filter((io) => io.number.startsWith(prefix)).map((io) => Number(io.number.slice(prefix.length)) || 0)
  return prefix + String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')
}

// ───────────────────────────── Commitments

export interface CommitmentRow {
  c: Contract
  committed: Money // original commitment for this project
  approvedChanges: Money
  pendingChanges: Money // RFI / CCOs in review
  current: Money // committed + approved changes
  invoiced: Money
  remaining: Money // current − invoiced
  poShare?: Money // PO total × % of PO (what the PM planned to use)
  usedPct?: number // current commitment as % of the PO
  overShare: boolean // current commitment (after approved CCOs) exceeds the planned share: raise % of PO
  ccos: CommitmentChange[]
}

export function commitmentRow(s: AppState, c: Contract): CommitmentRow {
  const ccos = s.commitmentChanges.filter((x) => x.contractId === c.id).sort((a, b) => b.code.localeCompare(a.code))
  const current = c.value + c.changeOrders
  const poShare = c.poTotal && c.pctOfPo !== undefined ? Math.round((c.poTotal * c.pctOfPo) / 100) : undefined
  return {
    c, committed: c.value, approvedChanges: c.changeOrders,
    pendingChanges: sum(ccos.filter((x) => x.status === 'in-review').map((x) => x.amount)),
    current, invoiced: c.invoiced, remaining: current - c.invoiced, poShare, usedPct: c.poTotal ? Math.round((current / c.poTotal) * 1000) / 10 : undefined,
    overShare: poShare !== undefined && current > poShare * 1.005, ccos,
  }
}
export const commitmentsFor = (s: AppState, pid: string): CommitmentRow[] => s.contracts.filter((c) => c.projectId === pid).map((c) => commitmentRow(s, c))

/** Forecast lines bought with company labor or paid directly (no vendor commitment expected). */
export const NON_COMMITMENT_LINES: Record<string, string> = {
  'fl-100': 'Company project management labor',
  'fl-700': 'Company operations labor',
  'fl-800': 'Company support services labor',
  'fl-870': 'Land purchased directly (escrow)',
  'fl-880': 'Permit fees paid to agencies',
  'fl-900': 'Overhead and AFUDC settlements',
}

export interface LineCoverage { lineId: string; code: string; name: string; budget: Money; committed: Money; contractIds: string[]; status: 'covered' | 'company' | 'gap' }

/** "Every estimate line must be assigned to a vendor commitment": lines with budget and no commitment are gaps. */
export function lineCoverage(s: AppState, pid: string): { rows: LineCoverage[]; gaps: LineCoverage[]; basis: BasisKind; basisLabel: string; uncovered: Money } {
  const b = basisByLine(s, pid)
  const cons = s.contracts.filter((c) => c.projectId === pid)
  const rows: LineCoverage[] = forecastLines(s).map((l) => {
    const budget = b.byLine[l.id] || 0
    const mine = cons.filter((c) => c.lineIds?.includes(l.id))
    // a commitment's current value is attributed to its lines pro-rata to their budget
    const committed = sum(mine.map((c) => {
      const lines = c.lineIds ?? []
      const tot = sum(lines.map((x) => b.byLine[x] || 0))
      return Math.round(((c.value + c.changeOrders) * (tot ? budget / tot : 1 / Math.max(1, lines.length))))
    }))
    const status: LineCoverage['status'] = mine.length ? 'covered' : NON_COMMITMENT_LINES[l.id] ? 'company' : 'gap'
    return { lineId: l.id, code: l.code, name: l.name, budget, committed, contractIds: mine.map((c) => c.id), status }
  }).filter((r) => r.budget > 0 || r.contractIds.length)
  const gaps = rows.filter((r) => r.status === 'gap' && r.budget > 0)
  return { rows, gaps, basis: b.kind, basisLabel: b.label, uncovered: sum(gaps.map((g) => g.budget)) }
}

/** Data-quality flags on one commitment (shown inline and in the Finance summary). */
export function commitmentIssues(s: AppState, p: Project, c: Contract): string[] {
  const out: string[] = []
  const r = commitmentRow(s, c)
  if (!c.poNumber && c.status !== 'rfp') out.push('No SAP PO number')
  if (!c.lineIds?.length) out.push('No forecast lines assigned')
  if (!c.scope?.trim()) out.push('No scope of work stated')
  const io = p.finance?.ios.find((x) => x.id === c.ioId)
  if (!io) out.push('No internal order')
  else {
    if (io.status === 'closed' && c.status !== 'closed') out.push(`IO ${io.number} is closed`)
    const fns = new Set((c.lineIds ?? []).map((l) => lineById(s, l)?.functionId).filter(Boolean) as string[])
    const off = [...fns].filter((f) => !io.functionIds.includes(f))
    if (off.length) out.push(`IO ${io.number} does not carry ${off.map((f) => s.settings.wbsFunctions.find((w) => w.id === f)?.code ?? f).join(', ')}`)
  }
  if (r.remaining < 0) out.push('Invoiced beyond the current commitment')
  return out
}

// ───────────────────────────── RFI / contract change orders (single entry point for commitment changes)

export function nextCcoCode(s: AppState, p: Project): string {
  const n = p.code.slice(4)
  const used = s.commitmentChanges.filter((x) => x.projectId === p.id).map((x) => Number(x.code.split('-').pop()) || 0)
  return `CCO-${n}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`
}

export interface NewCco { contractId: string; rfi: string; description: string; amount: Money; scheduleImpactDays: number; changeId?: string }

/** Log an RFI / CCO against a commitment and route it ('commitment-change'). The requester's own prep step is submitted. */
export function createCommitmentChange(d: AppState, pid: string, a: NewCco, byId = d.currentUserId): CommitmentChange {
  const p = d.projects.find((x) => x.id === pid)!
  const cc: CommitmentChange = {
    id: uid('cco'), projectId: pid, contractId: a.contractId, code: nextCcoCode(d, p), rfi: a.rfi.trim(), description: a.description.trim(),
    amount: Math.round(a.amount), scheduleImpactDays: Math.round(a.scheduleImpactDays) || 0, status: 'draft', requestedById: byId, requestedAt: d.settings.asOf, changeId: a.changeId || undefined,
  }
  d.commitmentChanges.push(cc)
  const k = d.contracts.find((x) => x.id === a.contractId)
  const ch = cc.changeId ? d.changes.find((x) => x.id === cc.changeId) : undefined
  if (ch && !(ch.contractIds ?? []).includes(a.contractId)) ch.contractIds = [...(ch.contractIds ?? []), a.contractId]
  const inst = startWorkflow(d, 'commitment-change', {
    title: `${cc.code} ${k?.vendor ?? ''}: ${cc.rfi.slice(0, 48)}`.trim(), recordType: 'commitment-change', recordId: cc.id, projectId: pid,
    data: { amount: cc.amount, scheduleImpactDays: cc.scheduleImpactDays, rfi: cc.rfi, contract: k?.number, vendor: k?.vendor }, startedById: byId,
  })
  const slot = inst?.active.find((x) => x.nodeId === 'prep' && x.assigneeIds.includes(byId))
  if (inst && slot) actOnWorkflow(d, inst.id, slot.nodeId, byId, 'submit', 'RFI / change order logged')
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'commitment-change', entityId: cc.id, projectId: pid, action: 'create', summary: `${cc.code} logged against ${k?.number ?? 'commitment'} ${k?.vendor ?? ''}: ${cc.rfi} (${cc.amount >= 0 ? '+' : ''}${cc.amount.toLocaleString('en-US')} USD, ${cc.scheduleImpactDays} days)` })
  return d.commitmentChanges.find((x) => x.id === cc.id)!
}

// ───────────────────────────── Project change → commitments → scheduler

/** RFI / CCOs that roll into a project change. */
export const ccosOfChange = (s: AppState, changeId: string) => s.commitmentChanges.filter((x) => x.changeId === changeId)

/**
 * Notify the project scheduler of a change's schedule impact. Crosswalk does not write to P6; the scheduler
 * gets an action (task) and a notification, and the change records the notice.
 */
export function notifyScheduler(d: AppState, changeId: string, byId = d.currentUserId): { ok: boolean; reason?: string } {
  const c = d.changes.find((x) => x.id === changeId)
  if (!c) return { ok: false, reason: 'Change not found' }
  const p = d.projects.find((x) => x.id === c.projectId)!
  const schedulerId = p.team.scheduler ?? d.people.find((x) => x.roles.includes('scheduler'))?.id
  if (!schedulerId) return { ok: false, reason: 'No scheduler assigned to the project team' }
  if (c.scheduleNotice && c.scheduleNotice.status === 'sent') return { ok: false, reason: 'The scheduler already has an open task for this change' }
  const actionId = uid('act')
  const days = c.scheduleImpactDays
  d.actions.push({ id: actionId, projectId: p.id, title: `Update P6 ${p.scheduleId} for ${c.code}: ${days > 0 ? '+' : ''}${days} days (${c.title.slice(0, 60)})`, ownerId: schedulerId, due: addDays(d.settings.asOf, 5), status: 'open', source: 'review', sourceId: c.id })
  d.notifications.push({ id: uid('ntf'), at: nowISO(), toId: schedulerId, text: `${p.code} ${c.code} has ${days > 0 ? '+' : ''}${days} days schedule impact — update P6 schedule ${p.scheduleId}`, link: `#p-${p.code.replace(/\D/g, '')}-changes`, read: false, kind: 'task' })
  c.scheduleNotice = { schedulerId, actionId, sentAt: nowISO(), status: 'sent' }
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'change', entityId: c.id, projectId: p.id, action: 'notify-scheduler', summary: `${c.code}: scheduler ${d.people.find((x) => x.id === schedulerId)?.name ?? schedulerId} asked to reflect ${days} days in P6 ${p.scheduleId}` })
  return { ok: true }
}

/** Scheduler confirms the P6 update; closes the action. */
export function completeScheduleNotice(d: AppState, changeId: string, byId = d.currentUserId, note?: string) {
  const c = d.changes.find((x) => x.id === changeId)
  if (!c?.scheduleNotice) return
  c.scheduleNotice.status = 'done'
  const a = d.actions.find((x) => x.id === c.scheduleNotice!.actionId)
  if (a) a.status = 'done'
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'change', entityId: c.id, projectId: c.projectId, action: 'schedule-updated', summary: `${c.code}: P6 schedule updated by the scheduler${note ? ` — ${note}` : ''}` })
}

/** Commitments a change touches (explicit links plus the commitments of its CCOs). */
export function changeCommitments(s: AppState, c: Change): Contract[] {
  const ids = new Set([...(c.contractIds ?? []), ...ccosOfChange(s, c.id).map((x) => x.contractId)])
  return s.contracts.filter((k) => ids.has(k.id))
}

// ───────────────────────────── Deliverable completeness (stage-gate checklist)

export interface StageDeliverables { stageIndex: number; stage: string; gate: string; total: number; done: number; submitted: number; inProgress: number; pct: number }

/** Deliverable completeness from the lifecycle template's gate checklists (conditions evaluated per project). */
export function deliverableCompleteness(s: AppState, p: Project): { current: StageDeliverables; toDate: { total: number; done: number; pct: number }; stages: StageDeliverables[] } {
  const tpl = templateFor(s, p)
  const stages: StageDeliverables[] = tpl.stages.map((st, i) => {
    const defs = requiredDefs(s, p, i)
    const dl = s.deliverables.filter((x) => x.projectId === p.id && x.stageIndex === i)
    const st_ = (defId: string) => dl.find((x) => x.defId === defId)?.status
    const done = defs.filter((d) => ['accepted', 'waived'].includes(st_(d.id) ?? '')).length
    const submitted = defs.filter((d) => st_(d.id) === 'submitted').length
    const inProgress = defs.filter((d) => st_(d.id) === 'in-progress' || st_(d.id) === 'returned').length
    return { stageIndex: i, stage: st.name, gate: st.gate.name, total: defs.length, done, submitted, inProgress, pct: defs.length ? Math.round((done / defs.length) * 100) : 100 }
  })
  const cur = stages[Math.min(p.stageIndex, stages.length - 1)]
  const upto = stages.slice(0, p.stageIndex + 1)
  const total = sum(upto.map((x) => x.total)), done = sum(upto.map((x) => x.done))
  return { current: cur, toDate: { total, done, pct: total ? Math.round((done / total) * 100) : 100 }, stages }
}
