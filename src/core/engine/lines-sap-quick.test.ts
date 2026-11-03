import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import { sum } from '../util'
import { applyProfile, budgetByLine, etcEacByFunction, linesOfFunction, profileWeights, resample, rollupGrid, splitExact, syncForecast, toLines } from './lines'
import { matchRule, parseSapExtract, postImport, projectForWbs, readDelimited, remap, resolveTxn, sampleExtract, stageImport } from './sap'
import { adjustQuickEstimate, computeQuick, createQuickEstimate, findHistorical, inputsFromProject } from './quick'
import { estimateTotals } from './estimates'
import { activeBudget } from './position'
import { latestForecast } from './wbs'

const S = buildSeed()
const pid = 'prj-1001'
const P = S.projects.find((p) => p.id === pid)!

describe('forecast lines', () => {
  it('budget by line ties to the active budget (excl. contingency)', () => {
    const b = activeBudget(S, pid)!
    const bl = budgetByLine(S, pid)
    const changes = sum(S.changes.filter((c) => c.projectId === pid && c.status === 'approved' && c.fundedFrom === 'new-funding' && (c.decidedAt ?? c.requestedAt) >= b.createdAt).map((c) => c.costImpact))
    expect(sum(Object.values(bl.byLine))).toBe(b.total - b.contingency + changes)
  })
  it('toLines puts overhead on 900 and keeps contingency separate', () => {
    const r = toLines(S, { 'cat-pipe': 600, 'cat-contract': 400, 'cat-loaders': 100, 'cat-contingency': 50 })
    expect(r.byLine['fl-300-10']).toBe(600)
    expect(r.byLine['fl-500-10']).toBe(400)
    expect(r.byLine['fl-900']).toBe(100) // overhead is owned by 900 Project Overhead
    expect(r.contingency).toBe(50)
  })
  it('every cost period byLine sums to actual', () => {
    for (const cp of S.costPeriods.filter((c) => c.byLine)) expect(Math.abs(sum(Object.values(cp.byLine!)) - cp.actual)).toBeLessThanOrEqual(1)
  })
  it('splitExact and resample are exact / shaped', () => {
    expect(sum(Object.values(splitExact(1001, { a: 1, b: 1, c: 1 })))).toBe(1001)
    expect(resample([0, 10], 5)).toEqual([0, 2.5, 5, 7.5, 10])
  })
  it('zero-month profiles black out calendar months', () => {
    const w = profileWeights(S, 'prof-moratorium', ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'])
    expect(w[1]).toBe(0); expect(w[2]).toBe(0); expect(w[3]).toBe(0); expect(w[0]).toBeGreaterThan(0)
  })
  it('applyProfile keeps the function ETC and respects the window', () => {
    const f = latestForecast(S, pid)!
    const before = sum(linesOfFunction(S, 'wbs-500').flatMap((l) => Object.values(f.lineSpread![l.id] ?? {})))
    const months = Object.keys(Object.values(f.lineSpread!)[0]).sort()
    const g = applyProfile(S, P, f, 'wbs-500', { profileId: 'back', start: months[1], end: months[3] })
    expect(sum(Object.values(g).flatMap((m) => Object.values(m)))).toBe(before)
    for (const m of Object.values(g)) { expect(m[months[0]]).toBe(0); if (months[5]) expect(m[months[5]]).toBe(0) }
  })
  it('ETC/EAC by function: EAC = actual + ETC and totals tie to the forecast EAC', () => {
    const f = latestForecast(S, pid)!
    const r = etcEacByFunction(S, P, f)
    for (const row of r.rows) expect(row.eac).toBe(row.actual + row.etc)
    expect(r.totals.eac).toBe(f.eac)
    expect(rollupGrid(S, f.lineSpread)['wbs-500']).toEqual(f.spread!['wbs-500'])
  })
  it('syncForecast re-derives EAC after a line edit', () => {
    const next = produce(S, (d) => {
      const f = latestForecast(d, pid)!
      const m = Object.keys(f.lineSpread!['fl-500-10']).sort()[0]
      f.lineSpread!['fl-500-10'][m] += 100_000
      syncForecast(d, f)
    })
    expect(latestForecast(next, pid)!.eac - latestForecast(S, pid)!.eac).toBe(100_000)
  })
})

describe('SAP actuals', () => {
  it('reads quoted CSV with embedded commas and SAP trailing minus', () => {
    expect(readDelimited('a,b\n"x, y",2\n')).toEqual([['a', 'b'], ['x, y', '2']])
    const r = parseSapExtract('WBS Element,Cost Element,Amount,Posting Date\nC.PSE.1001,5200110,"1,250.50-",10/03/2026\n', '2026-10')
    expect(r.errors).toEqual([])
    expect(r.rows[0]).toMatchObject({ amount: -1250.5, period: '2026-10', postingDate: '2026-10-03' })
  })
  it('maps by priority: company labor on the .02 sub-WBS goes to engineering', () => {
    const rules = S.settings.sapMappings
    expect(matchRule(rules, { costElement: '5100110', sapWbs: `${P.erpWbs}.02`, text: '', vendor: '' })?.lineId).toBe('fl-200')
    expect(matchRule(rules, { costElement: '5100110', sapWbs: P.erpWbs, text: '', vendor: '' })?.lineId).toBe('fl-700')
    expect(matchRule(rules, { costElement: '5900130', sapWbs: P.erpWbs, text: '', vendor: '' })?.lineId).toBe('fl-900')
    expect(matchRule(rules, { costElement: '5450110', sapWbs: P.erpWbs, text: '', vendor: '' })).toBeUndefined()
    expect(projectForWbs(S, `${P.erpWbs}.02`)?.id).toBe(pid)
  })
  it('seed: three posted month-end imports and a staged October extract with exceptions', () => {
    expect(S.actualsImports.filter((i) => i.status === 'posted').length).toBe(3)
    const st = S.actualsImports.find((i) => i.status === 'staged')!
    expect(st.unmapped).toBeGreaterThan(0)
    expect(st.noProject).toBeGreaterThan(0)
    expect(st.excluded).toBeGreaterThan(0)
  })
  it('posting is blocked until exceptions are resolved, then rebuilds period actuals by line', () => {
    const st = S.actualsImports.find((i) => i.status === 'staged')!
    let res: ReturnType<typeof postImport> | undefined
    produce(S, (d) => { res = postImport(d, st.id) })
    expect(res!.ok).toBe(false)
    const next = produce(S, (d) => {
      for (const t of d.actualTxns.filter((t) => t.importId === st.id && (t.status === 'unmapped' || t.status === 'no-project'))) {
        if (t.status === 'no-project') resolveTxn(d, t.id, { projectId: pid, lineId: 'fl-500-10' }, 'WBS mis-keyed; belongs to PRJ-1001')
        else resolveTxn(d, t.id, { lineId: 'fl-100' }, 'Field software charged to PM & controls')
      }
      res = postImport(d, st.id)
    })
    expect(res!.ok).toBe(true)
    const txns = next.actualTxns.filter((t) => t.importId === st.id && t.projectId === pid && t.period === '2026-10' && t.status !== 'excluded')
    const cp = next.costPeriods.find((c) => c.projectId === pid && c.period === '2026-10')!
    expect(cp.source).toBe('sap')
    expect(cp.actual).toBe(Math.round(sum(txns.map((t) => t.amount))))
    expect(sum(Object.values(cp.byLine!))).toBe(cp.actual)
    expect(sum(Object.values(cp.byFunction!))).toBe(cp.actual)
  })
  it('sample extract stages, remaps and flags its exceptions', () => {
    const next = produce(S, (d) => {
      const { rows } = parseSapExtract(sampleExtract(d, '2026-10'), '2026-10')
      const imp = stageImport(d, rows, 'sample.csv')
      remap(d, imp.id)
    })
    const imp = next.actualsImports[next.actualsImports.length - 1]
    expect(imp.rows).toBeGreaterThan(20)
    expect(imp.unmapped + imp.noProject).toBeGreaterThan(0)
  })
})

describe('Class 5 quick estimate', () => {
  const p = S.projects.find((x) => x.id === 'prj-1012')!
  it('finds a historical row and computes a forward-looking range', () => {
    const i = inputsFromProject(S, p)
    expect(findHistorical(S, i).row).toBeTruthy()
    const r = computeQuick(S, i)
    expect(r.low).toBeLessThan(r.total)
    expect(r.high).toBeGreaterThan(r.total)
    expect(r.escalationFactor).toBeGreaterThanOrEqual(1)
  })
  it('estimate lines + loaders + contingency reproduce the computed total', () => {
    const i = inputsFromProject(S, p)
    const r = computeQuick(S, i)
    const next = produce(S, (d) => { createQuickEstimate(d, p.id, i, 'test') })
    const e = next.estimates[next.estimates.length - 1]
    expect(e.method).toBe('quick')
    expect(Math.abs(estimateTotals(e).total - r.total)).toBeLessThanOrEqual(2)
  })
  it('estimator adjustment is recorded with before/after', () => {
    const e0 = S.estimates.find((e) => e.projectId === p.id && e.method === 'quick')!
    const next = produce(S, (d) => { adjustQuickEstimate(d, e0.id, { pct: -10, reason: 'Shorter route than the population' }, 'u-est2') })
    const e = next.estimates.find((x) => x.id === e0.id)!
    expect(e.quick!.adjustment!.pct).toBe(-10)
    expect(e.quick!.adjustment!.toTotal).toBeLessThan(e.quick!.adjustment!.fromTotal)
  })
  it('seed: one quick estimate already adjusted and approved; others in review', () => {
    const q = S.estimates.filter((e) => e.method === 'quick')
    expect(q.some((e) => e.status === 'approved' && e.quick?.adjustment)).toBe(true)
    expect(q.filter((e) => e.status === 'in-review').length).toBeGreaterThanOrEqual(3)
  })
})
