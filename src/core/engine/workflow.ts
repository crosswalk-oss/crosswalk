// Workflow engine (Module 7): routes a record through a configured process definition.
import type { AppState, Assignee, Person, RecordType, WfEdge, WfNode, WorkflowDef, WorkflowInstance } from '../types'
import { addDays, evalCondition, nowISO, uid } from '../util'
import { approveEstimate } from './estimates'
import { takeSnapshot } from './position'
import { decideGate } from './gates'
import { onDeliverableAccepted } from './records'
import { publishModel, returnModel } from './factorModel'

export const latestDef = (s: AppState, key: string): WorkflowDef | undefined =>
  s.workflowDefs.filter((d) => d.key === key && d.status === 'published').sort((a, b) => b.version - a.version)[0]

/** People who must act on a node for this instance. Out-of-office approvers are replaced by their delegate. */
export function resolveAssignees(s: AppState, inst: WorkflowInstance, a?: Assignee): string[] {
  if (!a) return []
  const project = inst.projectId ? s.projects.find((p) => p.id === inst.projectId) : undefined
  let ids: string[] = []
  switch (a.kind) {
    case 'person': ids = [a.personId]; break
    case 'requester': ids = [inst.startedById]; break
    case 'role': {
      ids = s.people.filter((p) => p.roles.includes(a.roleId)).map((p) => p.id)
      break
    }
    case 'team-position': {
      const id = project?.team[a.position]
      ids = id ? [id] : []
      break
    }
    case 'manager-of-requester': {
      const m = s.people.find((p) => p.id === inst.startedById)?.managerId
      ids = m ? [m] : []
      break
    }
    case 'doa': {
      const amount = Math.abs(Number(inst.data[a.field] ?? 0))
      const role = doaRoleFor(s, inst, amount)
      ids = role ? s.people.filter((p) => p.roles.includes(role) && !p.company).map((p) => p.id) : []
      break
    }
  }
  return Array.from(new Set(ids.map((id) => delegateFor(s, id))))
}

export function doaRoleFor(s: AppState, inst: Pick<WorkflowInstance, 'projectId'>, amount: number) {
  const project = inst.projectId ? s.projects.find((p) => p.id === inst.projectId) : undefined
  const prog = project ? s.programs.find((p) => p.id === project.programId) : undefined
  const m = s.doaMatrices.find((x) => x.id === prog?.doaMatrixId) ?? s.doaMatrices[0]
  if (!m) return undefined
  const rows = m.rows.slice().sort((a, b) => a.upTo - b.upTo)
  return (rows.find((r) => amount <= r.upTo) ?? rows[rows.length - 1]).roleId
}

function delegateFor(s: AppState, id: string): string {
  return activeDelegate(s, id) ?? id
}

/** The person covering for `id` today (out-of-office window includes settings.asOf), if any. */
export function activeDelegate(s: Pick<AppState, 'people' | 'settings'>, id: string): string | undefined {
  const oo = s.people.find((x) => x.id === id)?.outOfOffice
  return oo && s.settings.asOf >= oo.from && s.settings.asOf <= oo.to && oo.delegateId !== id ? oo.delegateId : undefined
}

/** Assignee on this slot that `actorId` may act for as an out-of-office delegate (steps assigned before the absence). */
export function coveredAssignee(s: Pick<AppState, 'people' | 'settings'>, slot: WorkflowInstance['active'][number], actorId: string): string | undefined {
  if (slot.assigneeIds.includes(actorId)) return undefined
  return slot.assigneeIds.find((x) => !slot.actedIds.includes(x) && activeDelegate(s, x) === actorId)
}

const outgoing = (def: WorkflowDef, nodeId: string) => def.edges.filter((e) => e.from === nodeId)
const nodeOf = (def: WorkflowDef, id: string) => def.nodes.find((n) => n.id === id)!
const defOf = (s: AppState, inst: WorkflowInstance) => s.workflowDefs.find((d) => d.id === inst.defId)!

function event(inst: WorkflowInstance, nodeId: string, actorId: string, action: WorkflowInstance['history'][number]['action'], comment?: string) {
  inst.history.push({ id: uid('ev'), at: nowISO(), nodeId, actorId, action, comment, signature: action === 'approve' ? { method: 'password-reauth', hash: Math.random().toString(16).slice(2, 14) } : undefined })
}

/** Enter a node: create the active task, or evaluate/pass through automatic nodes. */
function enter(d: AppState, inst: WorkflowInstance, def: WorkflowDef, nodeId: string, guard = 0) {
  if (guard > 50) throw new Error('Workflow loop detected')
  const n = nodeOf(def, nodeId)
  const follow = (edges: WfEdge[]) => edges.forEach((e) => enter(d, inst, def, e.to, guard + 1))
  switch (n.type) {
    case 'start':
      follow(outgoing(def, n.id).slice(0, 1))
      return
    case 'form':
    case 'review':
    case 'approval': {
      const assigneeIds = resolveAssignees(d, inst, n.assignee)
      if (!assigneeIds.length) {
        event(inst, n.id, 'system', 'system', 'No assignee resolved; step skipped')
        follow(outgoing(def, n.id).filter((e) => !e.outcome || e.outcome === 'approve' || e.outcome === 'default').slice(0, 1))
        return
      }
      inst.active.push({ nodeId: n.id, since: nowISO(), assigneeIds, actedIds: [], due: n.slaDays ? addDays(d.settings.asOf, n.slaDays) : undefined })
      for (const id of assigneeIds) notify(d, id, `${n.label}: ${inst.title}`, `inbox`)
      return
    }
    case 'condition': {
      const edges = outgoing(def, n.id)
      const ctx = { ...inst.data, project: inst.projectId ? d.projects.find((p) => p.id === inst.projectId) : undefined }
      const hit = edges.find((e) => e.condition && evalCondition(e.condition, ctx)) ?? edges.find((e) => !e.condition)
      event(inst, n.id, 'system', 'system', `Condition → ${hit?.label ?? 'default'}`)
      if (hit) enter(d, inst, def, hit.to, guard + 1)
      return
    }
    case 'parallel-split':
      follow(outgoing(def, n.id))
      return
    case 'parallel-join': {
      const key = `__join_${n.id}`
      const arrived = Number(inst.data[key] ?? 0) + 1
      const needed = def.edges.filter((e) => e.to === n.id).length
      inst.data[key] = arrived
      if (arrived >= needed) {
        inst.data[key] = 0
        follow(outgoing(def, n.id).slice(0, 1))
      }
      return
    }
    case 'notify': {
      for (const id of resolveAssignees(d, inst, n.assignee)) notify(d, id, `${n.label}: ${inst.title}`, inst.projectId ? `project` : 'inbox')
      event(inst, n.id, 'system', 'system', n.label)
      follow(outgoing(def, n.id).slice(0, 1))
      return
    }
    case 'system':
      event(inst, n.id, 'system', 'system', n.label)
      follow(outgoing(def, n.id).slice(0, 1))
      return
    case 'end':
      complete(d, inst, (inst.data.__outcome as WorkflowInstance['status']) ?? 'approved')
      return
  }
}

function notify(d: AppState, toId: string, text: string, link: string) {
  d.notifications.push({ id: uid('ntf'), at: nowISO(), toId, text, link, read: false })
}

export interface StartArgs { title: string; recordType: RecordType; recordId: string; projectId?: string; data?: Record<string, unknown>; startedById?: string }

/** Start a process by key. Returns the instance (or undefined if no published definition). */
export function startWorkflow(d: AppState, key: string, a: StartArgs): WorkflowInstance | undefined {
  const def = latestDef(d, key)
  if (!def) return
  const inst: WorkflowInstance = {
    id: uid('wf'),
    defId: def.id,
    defKey: def.key,
    defVersion: def.version,
    title: a.title,
    recordType: a.recordType,
    recordId: a.recordId,
    projectId: a.projectId,
    status: 'running',
    active: [],
    startedAt: nowISO(),
    startedById: a.startedById ?? d.currentUserId,
    data: { ...(a.data ?? {}) },
    history: [],
  }
  d.workflows.push(inst)
  event(inst, def.nodes.find((n) => n.type === 'start')!.id, inst.startedById, 'start')
  onStart(d, inst)
  enter(d, inst, def, def.nodes.find((n) => n.type === 'start')!.id)
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: inst.startedById, entity: 'workflow', entityId: inst.id, projectId: inst.projectId, action: 'start', summary: `Started ${def.name}: ${inst.title}` })
  return inst
}

export type Decision = 'approve' | 'reject' | 'return' | 'submit'

/** An assignee acts on an active step (WF-04, WF-07, WF-10). */
/** Processes where the submitter may never be the approver. */
export const SEPARATE_DUTIES = new Set(['factor-model-publish'])

export function actOnWorkflow(d: AppState, instId: string, nodeId: string, actorId: string, decision: Decision, comment?: string) {
  const inst = d.workflows.find((w) => w.id === instId)
  if (!inst || inst.status !== 'running') return
  const def = defOf(d, inst)
  const n = nodeOf(def, nodeId)
  const slot = inst.active.find((a) => a.nodeId === nodeId)
  if (!slot) return
  const actor = d.people.find((p) => p.id === actorId)
  const onBehalf = coveredAssignee(d, slot, actorId)
  const allowed = slot.assigneeIds.includes(actorId) || !!onBehalf || actor?.roles.includes('admin')
  if (!allowed) throw new Error('You are not an assignee on this step')
  // Separation of duties: whoever submitted a factor model cannot approve it (not even as an admin).
  if (decision === 'approve' && SEPARATE_DUTIES.has(inst.defKey) && actorId === inst.startedById) throw new Error('The person who submitted this cannot approve it')
  if (onBehalf) {
    const who = d.people.find((p) => p.id === onBehalf)?.name ?? onBehalf
    comment = `On behalf of ${who} (out of office)${comment ? ` — ${comment}` : ''}`
  }
  event(inst, nodeId, actorId, decision === 'submit' ? 'submit' : decision, comment)
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId, entity: 'workflow', entityId: inst.id, projectId: inst.projectId, action: decision, summary: `${n.label}: ${decision}${comment ? ` — ${comment}` : ''}` })
  if (decision === 'approve' || decision === 'submit') {
    slot.actedIds.push(actorId)
    if (onBehalf) slot.actedIds.push(onBehalf)
    if (n.rule === 'all' && !slot.assigneeIds.every((id) => slot.actedIds.includes(id))) return
    inst.active = inst.active.filter((a) => a !== slot)
    const edges = outgoing(def, nodeId)
    const next = edges.filter((e) => e.outcome === 'approve' || e.outcome === 'default' || !e.outcome)
    next.forEach((e) => enter(d, inst, def, e.to))
    return
  }
  inst.active = inst.active.filter((a) => a !== slot)
  const edge = outgoing(def, nodeId).find((e) => e.outcome === decision)
  if (edge) {
    enter(d, inst, def, edge.to)
    return
  }
  inst.active = []
  complete(d, inst, decision === 'reject' ? 'rejected' : 'returned')
}

export function recallWorkflow(d: AppState, instId: string, actorId: string) {
  const inst = d.workflows.find((w) => w.id === instId)
  if (!inst || inst.status !== 'running') return
  event(inst, inst.active[0]?.nodeId ?? '', actorId, 'recall')
  inst.active = []
  complete(d, inst, 'cancelled')
}

function complete(d: AppState, inst: WorkflowInstance, status: WorkflowInstance['status']) {
  if (inst.status !== 'running') return
  inst.status = status
  inst.completedAt = nowISO()
  inst.active = []
  event(inst, '', 'system', 'complete', status)
  onComplete(d, inst)
  notify(d, inst.startedById, `${inst.title} — ${status}`, 'inbox')
}

const lastApprover = (inst: WorkflowInstance) => [...inst.history].reverse().find((h) => h.action === 'approve')?.actorId ?? inst.startedById

/** Record status while in workflow. */
function onStart(d: AppState, inst: WorkflowInstance) {
  const id = inst.recordId
  switch (inst.recordType) {
    case 'estimate': { const e = d.estimates.find((x) => x.id === id); if (e) { e.status = 'in-review'; e.workflowInstanceId = inst.id } break }
    case 'change': { const c = d.changes.find((x) => x.id === id); if (c) { c.status = 'in-review'; c.workflowInstanceId = inst.id } break }
    case 'safety-plan': { const p = d.safetyPlans.find((x) => x.id === id); if (p) { p.status = 'in-review'; p.workflowInstanceId = inst.id } break }
    case 'variance': { const v = d.variances.find((x) => x.id === id); if (v) { v.status = 'submitted'; v.workflowInstanceId = inst.id } break }
    case 'deliverable': { const v = d.deliverables.find((x) => x.id === id); if (v) { v.status = 'submitted'; v.updatedAt = nowISO() } break }
    case 'contingency': { const v = d.contingencyDraws.find((x) => x.id === id); if (v) { v.status = 'in-review'; v.workflowInstanceId = inst.id } break }
    case 'contract': { const v = d.contracts.find((x) => x.id === id); if (v) v.workflowInstanceId = inst.id; break }
    case 'gate': { const p = d.projects.find((x) => x.id === inst.projectId); if (p) inst.data.__stage = p.stageIndex; break }
    case 'forecast': { const f = d.forecasts.find((x) => x.id === id); if (f) { f.status = 'submitted'; f.workflowInstanceId = inst.id } break }
    case 'commitment-change': { const c = d.commitmentChanges.find((x) => x.id === id); if (c) { c.status = 'in-review'; c.workflowInstanceId = inst.id } break }
    case 'factor-model': { const m = d.factorModels.find((x) => x.id === id); if (m) { m.status = 'in-review'; m.workflowInstanceId = inst.id } break }
  }
}

/** Apply the outcome to the underlying record (completion hooks). */
function onComplete(d: AppState, inst: WorkflowInstance) {
  const ok = inst.status === 'approved'
  const id = inst.recordId
  switch (inst.recordType) {
    case 'estimate': {
      const e = d.estimates.find((x) => x.id === id)
      if (!e) break
      if (ok) approveEstimate(d, id, lastApprover(inst))
      else e.status = inst.status === 'rejected' ? 'rejected' : 'draft'
      break
    }
    case 'change': {
      const c = d.changes.find((x) => x.id === id)
      if (!c) break
      if (!ok) { c.status = inst.status === 'rejected' ? 'rejected' : 'draft'; break }
      c.status = 'approved'
      c.decidedAt = d.settings.asOf
      const p = d.projects.find((x) => x.id === c.projectId)
      if (p && c.scheduleImpactDays) for (const m of p.milestones) if (!m.actual && m.forecast >= d.settings.asOf) m.forecast = addDays(m.forecast, c.scheduleImpactDays)
      const snap = takeSnapshot(d, c.projectId, 'current', `Current baseline after ${c.code}`, { changeId: c.id })
      c.resultingSnapshotId = snap.id
      break
    }
    case 'safety-plan': {
      const sp = d.safetyPlans.find((x) => x.id === id)
      if (!sp) break
      if (ok) {
        for (const o of d.safetyPlans) if (o.projectId === sp.projectId && o.workPackage === sp.workPackage && o.status === 'approved' && o.id !== sp.id) o.status = 'superseded'
        sp.status = 'approved'
        sp.approvedAt = d.settings.asOf
      } else sp.status = 'draft'
      break
    }
    case 'contingency': { const x = d.contingencyDraws.find((v) => v.id === id); if (x) x.status = ok ? 'approved' : 'rejected'; break }
    case 'variance': { const x = d.variances.find((v) => v.id === id); if (x) x.status = ok ? 'accepted' : 'returned'; break }
    case 'deliverable': { const x = d.deliverables.find((v) => v.id === id); if (x) { x.status = ok ? 'accepted' : 'returned'; x.updatedAt = nowISO(); if (ok && !d.settings.records?.paused) onDeliverableAccepted(d, x.id, d.currentUserId) } break }
    case 'waiver': {
      const x = d.deliverables.find((v) => v.id === inst.data.deliverableId)
      if (x && ok) { x.status = 'waived'; x.waiverReason = String(inst.data.reason ?? '') }
      break
    }
    case 'contract': { const x = d.contracts.find((v) => v.id === id); if (x && ok) { x.status = 'awarded'; x.awarded = d.settings.asOf } break }
    case 'budget': { const b = d.budgets.find((x) => x.id === id); if (b && ok) b.postedToErp = true; break }
    case 'forecast': { const f = d.forecasts.find((x) => x.id === id); if (f) { f.status = ok ? 'approved' : 'returned'; f.locked = ok } break }
    case 'commitment-change': {
      const c = d.commitmentChanges.find((x) => x.id === id)
      if (!c) break
      c.status = ok ? 'approved' : inst.status === 'rejected' ? 'rejected' : 'draft'
      c.decidedAt = d.settings.asOf
      if (ok) { const k = d.contracts.find((x) => x.id === c.contractId); if (k) k.changeOrders += c.amount }
      break
    }
    case 'factor-model': {
      if (ok) publishModel(d, id, lastApprover(inst))
      else returnModel(d, id, lastApprover(inst))
      break
    }
    case 'gate': {
      // Board approval through the routed workflow records the gate decision (same effect as the Lifecycle panel).
      const p = d.projects.find((x) => x.id === inst.projectId)
      if (!ok || !p || p.status !== 'active' || inst.data.__stage !== p.stageIndex) break
      const rec = String(inst.data.recommendation ?? '').toLowerCase()
      decideGate(d, p.id, rec.includes('condition') ? 'go-with-conditions' : 'go', [lastApprover(inst)], 'Approved through the gate-review workflow')
      break
    }
  }
}

export interface Task { inst: WorkflowInstance; node: WfNode; def: WorkflowDef; since: string; due?: string; overdue: boolean; actingFor?: string }

/** Inbox: steps waiting on this person, plus steps assigned to anyone they are covering for while that person is out of office. */
export function tasksFor(s: AppState, personId: string): Task[] {
  const out: Task[] = []
  for (const inst of s.workflows) {
    if (inst.status !== 'running') continue
    const def = s.workflowDefs.find((d) => d.id === inst.defId)
    if (!def) continue
    for (const a of inst.active) {
      if (a.assigneeIds.includes(personId) && !a.actedIds.includes(personId)) {
        out.push({ inst, node: nodeOf(def, a.nodeId), def, since: a.since, due: a.due, overdue: !!a.due && a.due < s.settings.asOf })
      } else {
        const actingFor = coveredAssignee(s, a, personId)
        if (actingFor) out.push({ inst, node: nodeOf(def, a.nodeId), def, since: a.since, due: a.due, overdue: !!a.due && a.due < s.settings.asOf, actingFor })
      }
    }
  }
  return out.sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
}

/** Dry-run routing for the designer's test mode (WF-09): who would this reach, step by step? */
export function simulate(s: AppState, def: WorkflowDef, data: Record<string, unknown>, projectId?: string, startedById?: string): { node: WfNode; people: Person[] }[] {
  const fake: WorkflowInstance = { id: 'sim', defId: def.id, defKey: def.key, defVersion: def.version, title: 'Simulation', recordType: def.recordType, recordId: 'sim', projectId, status: 'running', active: [], startedAt: nowISO(), startedById: startedById ?? s.currentUserId, data, history: [] }
  const out: { node: WfNode; people: Person[] }[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    if (depth > 40) return
    const n = def.nodes.find((x) => x.id === id)
    if (!n) return
    if (seen.has(id) && n.type !== 'parallel-join') return
    seen.add(id)
    if (n.type === 'approval' || n.type === 'review' || n.type === 'form' || n.type === 'notify') {
      out.push({ node: n, people: resolveAssignees(s, fake, n.assignee).map((pid) => s.people.find((p) => p.id === pid)!).filter(Boolean) })
    }
    const edges = def.edges.filter((e) => e.from === id)
    if (n.type === 'condition') {
      const ctx = { ...data, project: projectId ? s.projects.find((p) => p.id === projectId) : undefined }
      const hit = edges.find((e) => e.condition && evalCondition(e.condition, ctx)) ?? edges.find((e) => !e.condition)
      if (hit) walk(hit.to, depth + 1)
    } else if (n.type === 'parallel-split') edges.forEach((e) => walk(e.to, depth + 1))
    else {
      const e = edges.find((e) => !e.outcome || e.outcome === 'approve' || e.outcome === 'default')
      if (e) walk(e.to, depth + 1)
    }
  }
  walk(def.nodes.find((n) => n.type === 'start')!.id, 0)
  return out
}

/** Swimlane label for a node (documentation export). */
export function laneOf(s: AppState, n: WfNode): string {
  if (n.lane) return n.lane
  const a = n.assignee
  if (!a) return 'System'
  switch (a.kind) {
    case 'role': return s.roles.find((r) => r.id === a.roleId)?.name ?? a.roleId
    case 'team-position': return ({ pm: 'Project Manager', sponsor: 'Project Sponsor', projectControls: 'Project Controls', constructionManager: 'Construction Manager', safety: 'Safety Advisor', estimator: 'Estimator', engineer: 'Engineer', scheduler: 'Scheduler', environmental: 'Environmental', land: 'Land' } as Record<string, string>)[a.position] ?? a.position
    case 'doa': return 'Approver by dollar authority'
    case 'manager-of-requester': return "Requester's manager"
    case 'requester': return 'Requester'
    case 'person': return s.people.find((p) => p.id === a.personId)?.name ?? 'Person'
  }
}
