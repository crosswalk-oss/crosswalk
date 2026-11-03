import { buildSeed } from '@/core/seed'
import { estimateTotals, computeClass } from '@/core/engine/estimates'
import { accuracyPoints, analogs, boeHtml, buildFromExisting, buildParametric, defaultInputs, defaultPackages, escalationTo, latestEstimate, splitIntoPackages, summarize } from './lib'

const s = buildSeed()
test('parametric class 5 draft prices like the seed', () => {
  const p = s.projects.find((x) => x.code === 'PRJ-1006')!
  const e = buildParametric(s, p, defaultInputs(p, s), 'u-est1')
  expect(e.cls).toBe(5)
  expect(e.lines.length).toBeGreaterThan(5)
  const t = estimateTotals(e)
  expect(t.total).toBeGreaterThan(5e6)
  expect(e.version).toBe(2)
  expect(e.rateTableVersion).toBe(s.settings.estimating.rateTableVersion)
  expect(e.salesTax?.pct).toBeGreaterThan(0)
  expect(t.tax).toBeGreaterThanOrEqual(0)
  expect(e.title).toMatch(/rate-table/)
})
test('class 3 split conserves quantities', () => {
  const p = s.projects.find((x) => x.code === 'PRJ-1006')!
  const src = latestEstimate(s, p.id)!
  const lines = splitIntoPackages(src.lines, defaultPackages(p))
  const a = src.lines.reduce((x, l) => x + l.qty * l.unitCost, 0), b = lines.reduce((x, l) => x + l.qty * l.unitCost, 0)
  expect(Math.abs(a - b) / a).toBeLessThan(0.001)
  const e = buildFromExisting(s, src, 'u-est1', { split: defaultPackages(p), toClass3: true })
  expect(e.method).toBe('line-item')
  expect(e.cls).toBe(computeClass(e.maturity))
})
test('accuracy points and analogs', () => {
  const pts = accuracyPoints(s)
  expect(pts.length).toBeGreaterThan(10)
  const sm = summarize(pts.filter((x) => x.cls === 5))
  expect(sm.n).toBeGreaterThan(5)
  const p = s.projects.find((x) => x.code === 'PRJ-1003')!
  const a = analogs(s, p)
  expect(a[0].project.workMethod).toBe('replace-hdd')
  expect(escalationTo(s, 2025, 2027)).toBeGreaterThan(5)
  const b = boeHtml(s, latestEstimate(s, p.id)!)
  expect(b.body).toContain('Basis of Estimate')
})

import { produce } from 'immer'
import { actOnWorkflow } from '@/core/engine/workflow'
import { submitEstimate, budgetKindAvailable } from './lib'
test('submit routes through workflow and approval locks the estimate', () => {
  const p = s.projects.find((x) => x.code === 'PRJ-1006')!
  let st = produce(s, (d) => {
    d.currentUserId = 'u-est1'
    const e = buildParametric(d, d.projects.find((x) => x.id === p.id)!, defaultInputs(p), 'u-est1')
    d.estimates.push(e)
    // recall the seeded in-review estimate first is not needed: different record
    const msg = submitEstimate(d, e.id)
    expect(msg).toMatch(/Submitted|Sent/)
    expect(d.estimates.find((x) => x.id === e.id)!.status).toBe('in-review')
    const inst = d.workflows.find((w) => w.id === d.estimates.find((x) => x.id === e.id)!.workflowInstanceId)!
    for (let i = 0; i < 6 && inst.status === 'running'; i++) {
      const a = inst.active[0]
      actOnWorkflow(d, inst.id, a.nodeId, a.assigneeIds[0], a.nodeId === 'prep' ? 'submit' : 'approve')
    }
    expect(inst.status).toBe('approved')
    expect(d.estimates.find((x) => x.id === e.id)!.status).toBe('approved')
  })
  expect(st.estimates.filter((e) => e.projectId === p.id && e.status === 'approved').length).toBe(1)
  expect(budgetKindAvailable(s, s.projects.find((x) => x.code === 'PRJ-1001')!)?.kind).toBe('control')
  expect(budgetKindAvailable(s, p)).toBeNull()
})
