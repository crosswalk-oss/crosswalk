import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AppState } from '../types'
import { addDays } from '../util'
import { noticesFor, openEscalations, planReminders, runReminders, taskNoticeState } from './notify'
import { actOnWorkflow, tasksFor } from './workflow'

const S = buildSeed()
const asOf = S.settings.asOf

/** A running step for a person with a manager, re-dated so it is `late` days past due. */
function withStep(s: AppState, late: number) {
  return produce(s, (d) => {
    const inst = d.workflows.find((w) => w.status === 'running' && w.active.some((a) => a.assigneeIds.length === 1 && d.people.find((p) => p.id === a.assigneeIds[0])?.managerId))!
    const slot = inst.active.find((a) => a.assigneeIds.length === 1)!
    slot.due = addDays(asOf, -late)
    d.workflows = [inst] // isolate one instance so counts are exact
    d.notifications = []
  })
}

describe('workflow reminders', () => {
  it('sends a due-soon reminder within reminderDays and nothing earlier', () => {
    const early = withStep(S, -5) // due in 5 days
    expect(planReminders(early)).toHaveLength(0)
    const soon = withStep(S, -1) // due tomorrow, reminderDays = 1
    const p = planReminders(soon)
    expect(p.map((x) => x.kind)).toEqual(['reminder'])
    expect(p[0].text).toContain('due tomorrow')
  })

  it('is idempotent: a second run sends nothing new', () => {
    const s0 = withStep(S, -1)
    let r1: ReturnType<typeof runReminders> | undefined
    const s1 = produce(s0, (d) => { r1 = runReminders(d) })
    expect(r1!.reminders).toBe(1)
    expect(s1.notifications.filter((n) => n.kind === 'reminder')).toHaveLength(1)
    let r2: ReturnType<typeof runReminders> | undefined
    const s2 = produce(s1, (d) => { r2 = runReminders(d) })
    expect(r2!.notices).toHaveLength(0)
    expect(s2.notifications).toHaveLength(s1.notifications.length)
  })

  it('sends one overdue reminder, then escalates to the manager after escalateAfterDays', () => {
    const late1 = withStep(S, 1)
    expect(planReminders(late1).map((x) => x.kind)).toEqual(['overdue'])
    const late3 = withStep(S, 3) // escalateAfterDays = 3
    const plan = planReminders(late3)
    expect(plan.map((x) => x.kind).sort()).toEqual(['escalation', 'overdue'])
    const esc = plan.find((x) => x.kind === 'escalation')!
    const mgr = late3.people.find((p) => p.id === esc.assigneeId)!.managerId
    expect(esc.toIds).toEqual([mgr])
    const after = produce(late3, (d) => { runReminders(d) })
    const inst = after.workflows[0]
    expect(inst.history.some((h) => h.action === 'escalate')).toBe(true)
    expect(after.notifications.some((n) => n.toId === mgr && n.kind === 'escalation')).toBe(true)
    const st = taskNoticeState(inst, inst.active[0], esc.assigneeId)
    expect(st.overdueReminded).toBe(asOf)
    expect(st.escalated?.to).toBe(mgr)
    expect(openEscalations(after, mgr)).toHaveLength(1)
    // running again the next day does not re-escalate
    expect(planReminders(after, addDays(asOf, 1)).filter((x) => x.kind === 'escalation')).toHaveLength(0)
  })

  it('escalation can be switched off with escalateAfterDays = 0', () => {
    const s = produce(withStep(S, 10), (d) => { d.settings.workflow.escalateAfterDays = 0 })
    expect(planReminders(s).map((x) => x.kind)).toEqual(['overdue'])
  })

  it('a re-entered step (new since) is reminded again', () => {
    const s1 = produce(withStep(S, 1), (d) => { runReminders(d) })
    const s2 = produce(s1, (d) => { d.workflows[0].active[0].since = '2026-10-28T09:00:00.000Z' })
    expect(noticesFor(s2.workflows[0], s2.workflows[0].active[0]).overdue).toEqual({})
    expect(planReminders(s2).map((x) => x.kind)).toContain('overdue')
  })

  it('copies the reminder to the delegate of an out-of-office assignee', () => {
    const s = produce(withStep(S, -1), (d) => {
      const pid = d.workflows[0].active[0].assigneeIds[0]
      const p = d.people.find((x) => x.id === pid)!
      p.outOfOffice = { from: addDays(asOf, -2), to: addDays(asOf, 5), delegateId: 'u-pmo2' === pid ? 'u-me' : 'u-pmo2' }
    })
    const [n] = planReminders(s)
    expect(n.toIds).toHaveLength(2)
    expect(n.text).toContain('covering for')
  })

  it('runs across the whole seed without duplicates', () => {
    const s1 = produce(S, (d) => { runReminders(d) })
    const added = s1.notifications.length - S.notifications.length
    expect(added).toBeGreaterThan(0)
    const s2 = produce(s1, (d) => { runReminders(d) })
    expect(s2.notifications.length).toBe(s1.notifications.length)
  })
})

describe('out-of-office delegation of steps assigned before the absence', () => {
  it('the delegate sees and can act on the absent person\'s open step', () => {
    const base = withStep(S, -4)
    const slot = base.workflows[0].active[0]
    const pid = slot.assigneeIds[0]
    const del = pid === 'u-pmo2' ? 'u-me' : 'u-pmo2'
    const s = produce(base, (d) => { d.people.find((x) => x.id === pid)!.outOfOffice = { from: asOf, to: addDays(asOf, 3), delegateId: del } })
    const t = tasksFor(s, del).find((x) => x.inst.id === s.workflows[0].id)
    expect(t?.actingFor).toBe(pid)
    const after = produce(s, (d) => { actOnWorkflow(d, d.workflows[0].id, slot.nodeId, del, t!.node.type === 'form' ? 'submit' : 'approve', 'ok') })
    const ev = after.workflows[0].history.find((h) => h.actorId === del)
    expect(ev?.comment).toMatch(/^On behalf of/)
    expect(tasksFor(after, del).some((x) => x.inst.id === s.workflows[0].id && x.node.id === slot.nodeId)).toBe(false)
  })

  it('outside the absence window the delegate cannot act', () => {
    const base = withStep(S, -4)
    const slot = base.workflows[0].active[0]
    const pid = slot.assigneeIds[0]
    const del = pid === 'u-pmo2' ? 'u-me' : 'u-pmo2'
    const s = produce(base, (d) => { d.people.find((x) => x.id === pid)!.outOfOffice = { from: addDays(asOf, 5), to: addDays(asOf, 9), delegateId: del } })
    expect(tasksFor(s, del).some((x) => x.actingFor === pid)).toBe(false)
  })
})
