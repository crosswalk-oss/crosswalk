import { produce } from 'immer'
import { buildSeed } from '@/core/seed'
import { position } from '@/core/engine/position'
import { startWorkflow, actOnWorkflow } from '@/core/engine/workflow'
import { adequacy, burndown, contingencyBasis, lessonsLibrary, riskFromLibrary, runMonteCarlo, exposureSummary } from './lib'
import { submitFirstForm } from './wf'
import { indicators, jsspHtml, oqCoverage, planIssues, ticketLevel } from '../safety/lib'

const s = buildSeed()

describe('risk lib', () => {
  it('runs Monte Carlo against the budget base and judges adequacy', () => {
    const mc = runMonteCarlo(s, 'prj-1001', 2000)!
    expect(mc.baseCost).toBe(position(s, 'prj-1001').baseBudget)
    expect(mc.costP.P80).toBeGreaterThanOrEqual(mc.costP.P50)
    const a = adequacy(contingencyBasis(s, 'prj-1001')!.contingency, mc)
    expect(['adequate', 'p50-only', 'short', 'no-risk']).toContain(a.verdict)
    expect(adequacy(0, { baseCost: 100, costP: { P10: 100, P50: 150, P80: 200, P90: 220 } }).verdict).toBe('short')
    expect(adequacy(60, { baseCost: 100, costP: { P10: 100, P50: 150, P80: 200, P90: 220 } }).verdict).toBe('p50-only')
    expect(adequacy(100, { baseCost: 100, costP: { P10: 100, P50: 150, P80: 200, P90: 220 } }).verdict).toBe('adequate')
  })
  it('falls back to the estimate for projects without a budget', () => {
    const b = contingencyBasis(s, 'prj-1006')
    expect(b?.source).toMatch(/estimate/)
  })
  it('builds a burn-down for construction projects', () => {
    const bd = burndown(s, 'prj-1020')!
    expect(bd.length).toBeGreaterThan(3)
    expect(bd[bd.length - 1].remaining).toBe(position(s, 'prj-1020').contingencyRemaining)
    expect(burndown(s, 'prj-1006')).toBeNull()
  })
  it('seeds library risks with a % of budget and a fresh code', () => {
    const p = s.projects.find((x) => x.id === 'prj-1001')!
    const r = riskFromLibrary(s, p, s.riskLibrary[0], 10_000_000)
    expect(r.cost.ml).toBe(400_000)
    expect(s.risks.some((x) => x.code === r.code)).toBe(false)
  })
  it('summarizes exposure and lessons', () => {
    const e = exposureSummary(s.risks.filter((r) => r.projectId === 'prj-1001'), s.settings.asOf)
    expect(e.active).toBeGreaterThan(0)
    expect(lessonsLibrary(s).length).toBeGreaterThanOrEqual(s.lessons.length)
  })
  it('routes a contingency draw and lands it on approval', () => {
    const pid = 'prj-1001'
    const before = position(s, pid).contingencyRemaining
    const risk = s.risks.find((r) => r.projectId === pid && r.kind === 'threat')!
    let next = produce(s, (d) => {
      d.contingencyDraws.push({ id: 'cd_t', projectId: pid, riskId: risk.id, amount: 100_000, date: d.settings.asOf, reason: 'test', status: 'in-review' })
      const inst = startWorkflow(d, 'contingency-drawdown', { title: 't', recordType: 'contingency', recordId: 'cd_t', projectId: pid, data: { amount: 100_000 } })
      submitFirstForm(d, inst?.id, 'go')
    })
    const inst = next.workflows.find((w) => w.recordId === 'cd_t')!
    expect(inst.active[0].nodeId).toBe('pc')
    for (let i = 0; i < 5; i++) {
      next = produce(next, (d) => { const w = d.workflows.find((x) => x.id === inst.id)!; if (w.status === 'running') { const a = w.active[0]; actOnWorkflow(d, w.id, a.nodeId, a.assigneeIds[0], 'approve') } })
    }
    expect(next.contingencyDraws.find((x) => x.id === 'cd_t')!.status).toBe('approved')
    expect(position(next, pid).contingencyRemaining).toBe(before - 100_000)
  })
})

describe('safety lib', () => {
  it('classifies ticket expiry', () => {
    expect(ticketLevel('2026-10-27', '2026-10-28').level).toBe('bad')
    expect(ticketLevel('2026-10-30', '2026-10-28').level).toBe('warn')
    expect(ticketLevel('2026-11-20', '2026-10-28').level).toBe('ok')
  })
  it('checks plans, OQ coverage, indicators and prints', () => {
    const plan = s.safetyPlans.find((x) => x.status === 'approved')!
    expect(Array.isArray(planIssues(s, plan))).toBe(true)
    expect(Array.isArray(oqCoverage(s, plan, s.settings.asOf))).toBe(true)
    const ind = indicators(s, [plan.projectId])
    expect(ind.plans).toBe(1)
    expect(ind.tailboardRate).not.toBeNull()
    const html = jsspHtml(s, plan)
    expect(html).toContain('Job-Specific Safety Plan')
    expect(html).toContain('Stop-work authority')
  })
})
