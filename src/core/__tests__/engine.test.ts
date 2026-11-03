import { buildSeed } from '../seed'
import { computeClass, estimateTotals, MATURITY_ITEMS, CLASS_RANGES } from '../engine/estimates'
import { decideGate, readiness, ensureDeliverables } from '../engine/gates'
import { position, takeSnapshot, compareSnapshots, latestOf } from '../engine/position'
import { startWorkflow, actOnWorkflow, tasksFor, simulate, latestDef } from '../engine/workflow'
import { monteCarlo } from '../engine/risk'
import { evmMetrics } from '../engine/evm'
import { setClock } from '../util'

const all = (cls: number) => Object.fromEntries(MATURITY_ITEMS.map((m) => [m.key, m.forClass >= cls]))

describe('estimating', () => {
  test('class is computed from maturity, never skips a coarser requirement', () => {
    expect(computeClass({})).toBe(5)
    expect(computeClass(all(4))).toBe(4)
    expect(computeClass(all(3))).toBe(3)
    const gap = { ...all(3), 'route-selected': false }
    expect(computeClass(gap)).toBe(5)
  })
  test('totals apply loaders, escalation, contingency and class range', () => {
    const t = estimateTotals({ cls: 3, lines: [{ id: 'a', categoryId: 'cat-contract', workPackage: '', description: '', qty: 100, unit: 'ft', unitCost: 1000, source: 'library', confidence: 'high' }], loaders: [{ name: 'x', pct: 10 }], escalationPct: 5, contingency: { method: 'deterministic', pct: 20 } })
    expect(t.lines).toBe(100000)
    expect(t.loaders).toBe(10000)
    expect(t.escalation).toBe(5500)
    expect(t.contingency).toBe(Math.round(115500 * 0.2))
    expect(t.low).toBe(Math.round(t.total * (1 + CLASS_RANGES[3].low)))
  })
})

describe('gates & baselines', () => {
  test('control gate converts the Class 3 estimate into a budget and creates Original + Current baselines', () => {
    const s = buildSeed()
    setClock(s.settings.asOf)
    const p = s.projects.find((x) => x.code === 'PRJ-1003')!
    const before = s.budgets.filter((b) => b.projectId === p.id && b.kind === 'control').length
    // approve the in-review Class 3 by walking its workflow
    const inst = s.workflows.find((w) => w.projectId === p.id && w.recordType === 'estimate' && w.status === 'running')!
    while (inst.status === 'running') { const a = inst.active[0]; actOnWorkflow(s, inst.id, a.nodeId, a.assigneeIds[0], 'approve') }
    for (const d of s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex)) d.status = 'accepted'
    for (const r of s.risks.filter((r) => r.projectId === p.id)) if (!r.responses.length) r.responses.push({ id: 'x', action: 'x', ownerId: 'u-pm1', due: '2027-01-01', status: 'open', cost: 0 })
    expect(readiness(s, p).ready).toBe(true)
    decideGate(s, p.id, 'go', ['u-dir1'], 'ok')
    expect(p.stageIndex).toBe(3)
    expect(s.budgets.filter((b) => b.projectId === p.id && b.kind === 'control').length).toBe(before + 1)
    expect(latestOf(s, p.id, 'original')).toBeTruthy()
    const pos = position(s, p.id)
    expect(pos.budgetKind).toBe('control')
    setClock(null)
  })
  test('snapshot compare bridges cost and milestone moves', () => {
    const s = buildSeed()
    const p = s.projects.find((x) => x.code === 'PRJ-1001')!
    const a = latestOf(s, p.id, 'original')!
    const b = takeSnapshot(s, p.id, 'forecast', 'test')
    const d = compareSnapshots(a, b)
    expect(typeof d.totalDelta).toBe('number')
    expect(Array.isArray(d.costBridge)).toBe(true)
  })
})

describe('workflow', () => {
  test('change request routes by dollar authority and long schedule impacts add a scheduler review', () => {
    const s = buildSeed()
    const p = s.projects.find((x) => x.code === 'PRJ-1001')!
    const def = latestDef(s, 'change-request')!
    const small = simulate(s, def, { amount: 100000, scheduleImpactDays: 0 }, p.id, p.team.pm)
    const big = simulate(s, def, { amount: 8000000, scheduleImpactDays: 45 }, p.id, p.team.pm)
    expect(small.map((x) => x.node.id)).toEqual(['prep', 'impact', 'approve'])
    expect(small.at(-1)!.people.every((x) => x.roles.includes('program-manager'))).toBe(true)
    expect(big.map((x) => x.node.id)).toEqual(['prep', 'impact', 'sched', 'approve'])
    expect(big.at(-1)!.people.every((x) => x.roles.includes('exec'))).toBe(true)
  })
  test('approved change creates a new Current baseline', () => {
    const s = buildSeed()
    const p = s.projects.find((x) => x.code === 'PRJ-1011')!
    const n0 = s.snapshots.filter((x) => x.projectId === p.id && x.type === 'current').length
    s.changes.push({ id: 'c1', projectId: p.id, code: 'CR-T', title: 't', type: 'cost', rootCause: 'Permitting', description: '', costImpact: 50000, scheduleImpactDays: 0, scopeImpact: '', categoryId: 'cat-contract', fundedFrom: 'contingency', status: 'draft', requestedById: p.team.pm!, requestedAt: s.settings.asOf })
    const inst = startWorkflow(s, 'change-request', { title: 't', recordType: 'change', recordId: 'c1', projectId: p.id, data: { amount: 50000, scheduleImpactDays: 0 }, startedById: p.team.pm })!
    while (inst.status === 'running') { const a = inst.active[0]; actOnWorkflow(s, inst.id, a.nodeId, a.assigneeIds[0], a.nodeId === 'prep' ? 'submit' : 'approve') }
    expect(inst.status).toBe('approved')
    expect(s.changes.find((c) => c.id === 'c1')!.status).toBe('approved')
    expect(s.snapshots.filter((x) => x.projectId === p.id && x.type === 'current').length).toBe(n0 + 1)
  })
  test('demo user has inbox tasks', () => {
    const s = buildSeed()
    expect(tasksFor(s, 'u-me').length).toBeGreaterThan(5)
  })
})

describe('risk & evm', () => {
  test('monte carlo percentiles are ordered', () => {
    const s = buildSeed()
    const p = s.projects.find((x) => x.code === 'PRJ-1020')!
    const r = monteCarlo(p.id, s.risks.filter((x) => x.projectId === p.id), 1e8, 600, s.settings.asOf, 2000)
    expect(r.costP.P10).toBeLessThanOrEqual(r.costP.P50)
    expect(r.costP.P50).toBeLessThanOrEqual(r.costP.P80)
    expect(r.costP.P80).toBeLessThanOrEqual(r.costP.P90)
  })
  test('evm metrics', () => {
    const m = evmMetrics([{ id: '1', projectId: 'p', period: '2026-01', planned: 100, earned: 80, actual: 100, commitments: 0 }], 1000)
    expect(m.cpi).toBeCloseTo(0.8)
    expect(m.spi).toBeCloseTo(0.8)
    expect(m.eac).toBe(1250)
  })
})
