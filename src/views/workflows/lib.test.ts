import { buildSeed } from '@/core/seed'
import { blockingErrors, lanesOf, orderedNodes, processStats, trace, validate, signatureHash, outcomePaths } from './lib'

const s = buildSeed()

test('every seeded process passes publish validation', () => {
  for (const d of s.workflowDefs) {
    const errs = blockingErrors(validate(d))
    expect(errs.map((e) => `${d.key}: ${e.label} ${e.detail ?? ''}`)).toEqual([])
  }
})

test('trace resolves DOA by amount and conditions', () => {
  const def = s.workflowDefs.find((d) => d.key === 'change-request')!
  const p = s.projects.find((x) => x.team.projectControls)!
  const small = trace(s, def, { amount: 100_000, scheduleImpactDays: 0 }, p.id, p.team.pm)
  const big = trace(s, def, { amount: 12_000_000, scheduleImpactDays: 45 }, p.id, p.team.pm)
  const appr = (t: ReturnType<typeof trace>) => t.find((x) => x.node.id === 'approve')!
  expect(appr(small).people.every((x) => x.roles.includes('program-manager'))).toBe(true)
  expect(appr(big).people.some((x) => x.roles.includes('exec'))).toBe(true)
  expect(small.some((x) => x.node.id === 'sched')).toBe(false)
  expect(big.some((x) => x.node.id === 'sched')).toBe(true)
  const gate = s.workflowDefs.find((d) => d.key === 'gate-review')!
  const g = trace(s, gate, {}, p.id, p.team.pm)
  expect(g.map((x) => x.node.id)).toEqual(expect.arrayContaining(['pgm', 'pc', 'join', 'board', 'end']))
  expect(g.filter((x) => x.node.id === 'join').length).toBe(1)
})

test('trace shows delegation', () => {
  const s2 = buildSeed()
  const p = s2.projects.find((x) => x.team.projectControls)!
  const pc = s2.people.find((x) => x.id === p.team.projectControls)!
  pc.outOfOffice = { from: '2026-10-01', to: '2026-11-30', delegateId: 'u-me' }
  const def = s2.workflowDefs.find((d) => d.key === 'change-request')!
  const t = trace(s2, def, { amount: 1 }, p.id, p.team.pm)
  const imp = t.find((x) => x.node.id === 'impact')!
  expect(imp.people.map((x) => x.id)).toEqual(['u-me'])
  expect(imp.delegatedFrom[0].from.id).toBe(pc.id)
})

test('analytics and docs helpers', () => {
  const st = processStats(s, 'change-request')
  expect(st.total).toBeGreaterThan(5)
  expect(st.steps.length).toBeGreaterThan(2)
  console.log(st.name, st.avgCycleH, st.bottleneck?.label, st.steps.map((x) => `${x.label}:${x.n}:${x.avgH.toFixed(2)}`).join(' '))
  const d = s.workflowDefs.find((x) => x.key === 'gate-review')!
  console.log(lanesOf(s, d), orderedNodes(d).map((n) => n.id).join(','))
  console.log(outcomePaths(d, d.nodes.find((n) => n.id === 'board')!))
  expect(signatureHash(['a', 'b'])).toHaveLength(16)
})
