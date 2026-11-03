// Workflow reminders and escalation. There is no server, so this runs in the client: once when the app loads and
// from "Send reminders now". It is idempotent — every notice sent is recorded on the instance (data.__notices,
// keyed by the active step and the moment it became active), so a step is reminded and escalated at most once.
//
//  • Reminder   — `settings.workflow.reminderDays` days before the step's due date (0 = on the due date).
//  • Overdue    — once, the first run after the due date passes.
//  • Escalation — to the assignee's manager once the step is `settings.workflow.escalateAfterDays` days overdue
//                 (0 turns escalation off). Recorded in the workflow history as an 'escalate' event.
// Assignees who are out of office have the notice copied to their delegate.
import type { AppState, ID, ISODate, WorkflowInstance } from '../types'
import { daysBetween, fmtDate, nowISO, uid } from '../util'
import { activeDelegate } from './workflow'

type Slot = WorkflowInstance['active'][number]

export interface SlotNotices {
  due: Record<ID, ISODate> // assignee → date the due-soon reminder went out
  overdue: Record<ID, ISODate> // assignee → date the overdue reminder went out
  escalated: Record<ID, { at: ISODate; to: ID }> // assignee → when and to whom the step was escalated
}

export type NoticeKind = 'reminder' | 'overdue' | 'escalation'

export interface PlannedNotice {
  kind: NoticeKind
  instId: ID
  nodeId: ID
  slotKey: string
  assigneeId: ID // whose step it is (first, for escalations covering several assignees)
  assigneeIds: ID[] // every assignee this notice covers
  toIds: ID[] // who is notified
  stepLabel: string
  title: string
  due: ISODate
  daysLate: number // negative = days remaining
  text: string
  projectId?: ID
}

const KEY = '__notices'
export const slotKey = (a: Pick<Slot, 'nodeId' | 'since'>) => `${a.nodeId}@${a.since}`

function allNotices(inst: WorkflowInstance): Record<string, SlotNotices> {
  const v = inst.data[KEY]
  return v && typeof v === 'object' ? (v as Record<string, SlotNotices>) : {}
}

/** What has already been sent for one active step. */
export function noticesFor(inst: WorkflowInstance, slot: Pick<Slot, 'nodeId' | 'since'>): SlotNotices {
  return allNotices(inst)[slotKey(slot)] ?? { due: {}, overdue: {}, escalated: {} }
}

export const workflowNotifySettings = (s: Pick<AppState, 'settings'>) => ({
  reminderDays: Math.max(0, s.settings.workflow?.reminderDays ?? 1),
  escalateAfterDays: Math.max(0, s.settings.workflow?.escalateAfterDays ?? 3),
})

const nameOf = (s: Pick<AppState, 'people'>, id: ID) => s.people.find((p) => p.id === id)?.name ?? id
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Dry run: every notice the next run would send as of `asOf`. Pure — reads the state, changes nothing. */
export function planReminders(s: AppState, asOf: ISODate = s.settings.asOf): PlannedNotice[] {
  const { reminderDays, escalateAfterDays } = workflowNotifySettings(s)
  const view = { people: s.people, settings: { ...s.settings, asOf } }
  const out: PlannedNotice[] = []
  for (const inst of s.workflows) {
    if (inst.status !== 'running') continue
    const def = s.workflowDefs.find((d) => d.id === inst.defId)
    for (const slot of inst.active) {
      if (!slot.due) continue
      const sent = noticesFor(inst, slot)
      const left = daysBetween(asOf, slot.due)
      const stepLabel = def?.nodes.find((n) => n.id === slot.nodeId)?.label ?? 'Step'
      const base = { instId: inst.id, nodeId: slot.nodeId, slotKey: slotKey(slot), stepLabel, title: inst.title, due: slot.due, daysLate: -left, projectId: inst.projectId }
      const escalate = new Map<ID, ID[]>() // manager → late assignees
      for (const pid of slot.assigneeIds) {
        if (slot.actedIds.includes(pid)) continue
        const del = activeDelegate(view, pid)
        const toIds = del ? [pid, del] : [pid]
        if (left >= 0 && left <= reminderDays && !sent.due[pid]) {
          const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${plural(left, 'day')}`
          out.push({ ...base, kind: 'reminder', assigneeId: pid, assigneeIds: [pid], toIds, text: `Reminder: ${stepLabel} — ${inst.title} is due ${when} (${fmtDate(slot.due)})${del ? ` · ${nameOf(s, del)} is covering for ${nameOf(s, pid)}` : ''}` })
        }
        if (left < 0 && !sent.overdue[pid]) {
          out.push({ ...base, kind: 'overdue', assigneeId: pid, assigneeIds: [pid], toIds, text: `Overdue: ${stepLabel} — ${inst.title} was due ${fmtDate(slot.due)} (${plural(-left, 'day')} late)${del ? ` · ${nameOf(s, del)} is covering for ${nameOf(s, pid)}` : ''}` })
        }
        if (escalateAfterDays > 0 && -left >= escalateAfterDays && !sent.escalated[pid]) {
          // one escalation per manager per step; a manager who is also on the step already has it in their queue
          const mgr = s.people.find((p) => p.id === pid)?.managerId
          if (!mgr || slot.assigneeIds.includes(mgr)) continue
          escalate.set(mgr, [...(escalate.get(mgr) ?? []), pid])
        }
      }
      for (const [mgr, pids] of escalate) {
        out.push({ ...base, kind: 'escalation', assigneeId: pids[0], assigneeIds: pids, toIds: [mgr], text: `Escalated: ${stepLabel} — ${inst.title} is ${plural(-left, 'day')} overdue with ${pids.map((x) => nameOf(s, x)).join(', ')}` })
      }
    }
  }
  return out
}

export interface RunResult { reminders: number; overdue: number; escalations: number; notices: PlannedNotice[] }

/** Send every due notice (mutates the immer draft) and record it so it is never sent twice. */
export function runReminders(d: AppState, asOf: ISODate = d.settings.asOf): RunResult {
  const plan = planReminders(d, asOf)
  for (const n of plan) {
    const inst = d.workflows.find((w) => w.id === n.instId)
    if (!inst) continue
    const all = allNotices(inst)
    const rec: SlotNotices = all[n.slotKey] ?? { due: {}, overdue: {}, escalated: {} }
    if (n.kind === 'reminder') rec.due[n.assigneeId] = asOf
    if (n.kind === 'overdue') { rec.overdue[n.assigneeId] = asOf; if (!rec.due[n.assigneeId]) rec.due[n.assigneeId] = asOf }
    if (n.kind === 'escalation') {
      for (const a of n.assigneeIds) rec.escalated[a] = { at: asOf, to: n.toIds[0] }
      inst.history.push({ id: uid('ev'), at: nowISO(), nodeId: n.nodeId, actorId: 'system', action: 'escalate', comment: `Escalated to ${nameOf(d, n.toIds[0])} — ${plural(n.daysLate, 'day')} overdue with ${n.assigneeIds.map((x) => nameOf(d, x)).join(', ')}` })
    }
    all[n.slotKey] = rec
    inst.data[KEY] = all
    for (const to of n.toIds) d.notifications.push({ id: uid('ntf'), at: nowISO(), toId: to, text: n.text, link: '#inbox', read: false, kind: n.kind === 'escalation' ? 'escalation' : 'reminder' })
  }
  const result = { reminders: plan.filter((n) => n.kind === 'reminder').length, overdue: plan.filter((n) => n.kind === 'overdue').length, escalations: plan.filter((n) => n.kind === 'escalation').length, notices: plan }
  if (plan.length) d.audit.push({ id: uid('aud'), at: nowISO(), actorId: 'system', entity: 'workflow', entityId: 'reminders', action: 'remind', summary: `Workflow reminders as of ${asOf}: ${result.reminders} due-soon, ${result.overdue} overdue, ${result.escalations} escalated` })
  return result
}

/** Reminder / escalation state of one person's step, for My work. */
export function taskNoticeState(inst: WorkflowInstance, slot: Pick<Slot, 'nodeId' | 'since'>, personId: ID) {
  const n = noticesFor(inst, slot)
  const escalations = Object.entries(n.escalated).map(([assigneeId, e]) => ({ assigneeId, ...e }))
  return { reminded: n.due[personId], overdueReminded: n.overdue[personId], escalated: n.escalated[personId], escalations }
}

/** Every escalation still open (the step has not been acted on), newest first — for the manager's view. */
export function openEscalations(s: AppState, managerId?: ID) {
  const out: { inst: WorkflowInstance; slot: Slot; assigneeId: ID; at: ISODate; to: ID; stepLabel: string }[] = []
  for (const inst of s.workflows) {
    if (inst.status !== 'running') continue
    const def = s.workflowDefs.find((d) => d.id === inst.defId)
    for (const slot of inst.active) {
      const seen = new Set<ID>()
      for (const [assigneeId, e] of Object.entries(noticesFor(inst, slot).escalated)) {
        if (slot.actedIds.includes(assigneeId) || seen.has(e.to) || (managerId && e.to !== managerId)) continue
        seen.add(e.to)
        out.push({ inst, slot, assigneeId, at: e.at, to: e.to, stepLabel: def?.nodes.find((n) => n.id === slot.nodeId)?.label ?? 'Step' })
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
