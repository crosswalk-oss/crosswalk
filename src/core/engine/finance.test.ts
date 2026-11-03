import { buildSeed } from '@/core/seed'
import { produce } from 'immer'
import type { AppState } from '@/core/types'
import { actOnWorkflow } from './workflow'
import {
  capitalSplit, commitmentIssues, commitmentRow, completeScheduleNotice, createCommitmentChange, deliverableCompleteness,
  ioCoverage, lineCoverage, nextCcoCode, nextIoNumber, notifyScheduler,
} from './finance'

const seed = buildSeed()
const P = (s: AppState, id: string) => s.projects.find((p) => p.id === id)!

describe('financial accounts', () => {
  it('flags WBS functions with budget that no IO carries, and clears the gap once assigned', () => {
    const p = P(seed, 'prj-1001')
    const cov = ioCoverage(seed, p)
    expect(cov.basis).toBe('budget')
    for (const g of cov.gaps) expect(g.budget).toBeGreaterThan(0)
    const gap = cov.gaps.find((g) => g.status === 'gap')
    expect(gap).toBeTruthy()
    const next = produce(seed, (d) => { P(d, 'prj-1001').finance!.ios[0].functionIds.push(gap!.fnId) })
    expect(ioCoverage(next, P(next, 'prj-1001')).gaps.some((g) => g.fnId === gap!.fnId)).toBe(false)
  })
  it('reports requested-only IOs as pending and initiation projects (estimate basis) as gaps', () => {
    const stage1 = seed.projects.find((p) => p.stageIndex === 1 && p.status === 'active' && p.finance?.ios.every((i) => i.status === 'requested'))!
    expect(ioCoverage(seed, stage1).gaps.some((g) => g.status === 'pending')).toBe(true)
    const init = ioCoverage(seed, P(seed, 'prj-1006'))
    expect(init.basis).toBe('estimate')
    expect(init.gaps.every((g) => g.status === 'gap')).toBe(true)
  })
  it('compares the capital split the IOs carry with the scope statement', () => {
    const p = seed.projects.find((x) => (x.finance?.ios.length ?? 0) >= 2)!
    const sp = capitalSplit(seed, p)
    expect(sp.capital).toBeGreaterThan(0)
    expect(sp.om).toBeGreaterThan(0)
    expect(sp.ioCapitalPct).toBeCloseTo((sp.capital / (sp.capital + sp.om)) * 100, 0)
    expect(sp.deltaPts).toBeCloseTo(sp.ioCapitalPct! - p.scope.capitalPct!, 0)
  })
  it('numbers new IOs in the project series', () => {
    const p = P(seed, 'prj-1001')
    expect(nextIoNumber(p, 'capital')).toBe('71100102')
    expect(nextIoNumber(P(seed, 'prj-1006'), 'om')).toBe('72100601')
  })
})

describe('commitments', () => {
  it('computes current, remaining and PO share for every commitment', () => {
    for (const c of seed.contracts) {
      const r = commitmentRow(seed, c)
      expect(r.current).toBe(c.value + c.changeOrders)
      expect(r.remaining).toBe(r.current - c.invoiced)
      // approved changes tie out to approved RFI / CCOs
      expect(c.changeOrders).toBe(r.ccos.filter((x) => x.status === 'approved').reduce((a, x) => a + x.amount, 0))
    }
  })
  it('flags estimate lines with budget that no commitment covers, but not company labor', () => {
    const lc = lineCoverage(seed, 'prj-1001')
    expect(lc.gaps.length).toBeGreaterThan(0)
    expect(lc.gaps.every((g) => g.status === 'gap' && g.budget > 0 && g.contractIds.length === 0)).toBe(true)
    expect(lc.rows.find((r) => r.lineId === 'fl-100')?.status).toBe('company')
    const line = lc.gaps[0].lineId
    const next = produce(seed, (d) => { d.contracts.find((c) => c.projectId === 'prj-1001')!.lineIds!.push(line) })
    expect(lineCoverage(next, 'prj-1001').gaps.some((g) => g.lineId === line)).toBe(false)
  })
  it('flags a commitment whose IO does not carry its lines', () => {
    const next = produce(seed, (d) => {
      const p = P(d, 'prj-1001')
      p.finance!.ios[0].functionIds = p.finance!.ios[0].functionIds.filter((f) => f !== 'wbs-500')
    })
    const c = next.contracts.find((x) => x.projectId === 'prj-1001' && x.type === 'Construction')!
    expect(commitmentIssues(next, P(next, 'prj-1001'), c).some((x) => x.includes('does not carry 500'))).toBe(true)
  })
})

describe('RFI / change orders', () => {
  it('routes a new CCO and adds the amount to the commitment on approval', () => {
    const c0 = seed.contracts.find((x) => x.projectId === 'prj-1001' && x.type === 'Construction')!
    const ch = seed.changes.find((x) => x.projectId === 'prj-1001' && x.status !== 'rejected')
    const code = nextCcoCode(seed, P(seed, 'prj-1001'))
    let s = produce(seed, (d) => {
      d.currentUserId = P(d, 'prj-1001').team.pm!
      createCommitmentChange(d, 'prj-1001', { contractId: c0.id, rfi: 'Rock at Sta 18+00', description: 'Rock excavation', amount: 42_000, scheduleImpactDays: 3, changeId: ch?.id })
    })
    const cc = s.commitmentChanges.find((x) => x.code === code)!
    expect(cc.status).toBe('in-review')
    if (ch) expect(s.changes.find((x) => x.id === ch.id)!.contractIds).toContain(c0.id)
    const inst = s.workflows.find((w) => w.id === cc.workflowInstanceId)!
    expect(inst.active[0].nodeId).toBe('cm') // PM's prep step submitted on creation
    for (let i = 0; i < 6; i++) {
      const w = s.workflows.find((x) => x.id === inst.id)!
      if (w.status !== 'running') break
      const slot = w.active[0]
      s = produce(s, (d) => actOnWorkflow(d, w.id, slot.nodeId, slot.assigneeIds[0], 'approve', 'ok'))
    }
    expect(s.commitmentChanges.find((x) => x.id === cc.id)!.status).toBe('approved')
    expect(s.contracts.find((x) => x.id === c0.id)!.changeOrders).toBe(c0.changeOrders + 42_000)
  })
})

describe('scheduler notice', () => {
  it('creates a task and notification for the project scheduler and closes it when P6 is updated', () => {
    const ch = seed.changes.find((x) => x.scheduleImpactDays > 0 && !x.scheduleNotice)!
    const p = P(seed, ch.projectId)
    let res: { ok: boolean } = { ok: false }
    let s = produce(seed, (d) => { res = notifyScheduler(d, ch.id) })
    expect(res.ok).toBe(true)
    const c = s.changes.find((x) => x.id === ch.id)!
    expect(c.scheduleNotice?.schedulerId).toBe(p.team.scheduler)
    const a = s.actions.find((x) => x.id === c.scheduleNotice!.actionId)!
    expect(a.ownerId).toBe(p.team.scheduler)
    expect(s.notifications.some((n) => n.toId === p.team.scheduler && n.kind === 'task' && n.text.includes(ch.code))).toBe(true)
    // a second notice is refused while the first is open
    s = produce(s, (d) => { res = notifyScheduler(d, ch.id) })
    expect(res.ok).toBe(false)
    s = produce(s, (d) => completeScheduleNotice(d, ch.id))
    expect(s.changes.find((x) => x.id === ch.id)!.scheduleNotice!.status).toBe('done')
    expect(s.actions.find((x) => x.id === a.id)!.status).toBe('done')
  })
})

describe('deliverable completeness', () => {
  it('derives completeness from the gate checklist deliverables', () => {
    for (const p of seed.projects) {
      const dc = deliverableCompleteness(seed, p)
      expect(dc.current.total).toBeGreaterThan(0)
      expect(dc.current.done).toBeLessThanOrEqual(dc.current.total)
      expect(dc.toDate.total).toBeGreaterThanOrEqual(dc.current.total)
    }
    const closed = deliverableCompleteness(seed, P(seed, 'prj-1009'))
    expect(closed.current.pct).toBe(100)
  })
})
