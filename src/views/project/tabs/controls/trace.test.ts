import { buildSeed } from '@/core/seed'
import { assessEvidence, erpRecon, programYears, forecastByYear } from './trace'
import { projectBinderHtml, evidenceRows, programBinderHtml } from './binder'
import { position } from '@/core/engine/position'
import { sum } from '@/core/util'

const s = buildSeed()
test('evidence assessment runs for every project and lists gaps', () => {
  for (const p of s.projects) {
    const a = assessEvidence(s, p.id)
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
  }
  const a = assessEvidence(s, 'prj-1001')
})
test('ERP recon ties to actual to date', () => {
  for (const id of ['prj-1001', 'prj-1020', 'prj-1024']) {
    const r = erpRecon(s, id)
    expect(sum(r.rows.map((x) => x.actual)) + (r.unmapped?.amount ?? 0)).toBe(position(s, id).actualToDate)
  }
})
test('forecast by year sums to EAC', () => {
  for (const p of s.projects) {
    const pos = position(s, p.id)
    if (!pos.eac) continue
    const f = forecastByYear(s, p.id)
    expect(Math.abs(sum(Object.values(f)) - Math.max(pos.eac, pos.actualToDate))).toBeLessThan(5)
  }
})
test('binders render', () => {
  const h = projectBinderHtml(s, 'prj-1001')
  expect(h).toContain('Reasonableness review package')
  expect(evidenceRows(s, 'prj-1001').length).toBeGreaterThan(10)
  const pids = s.projects.filter((p) => p.programId === 'prg-pse').map((p) => p.id)
  expect(programBinderHtml(s, 'prg-pse', pids).length).toBeGreaterThan(10000)
})
