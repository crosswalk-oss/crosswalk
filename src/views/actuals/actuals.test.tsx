// SAP actuals: import review, exceptions, posting, and the mapping / line / profile configuration pages.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mutate, useStore } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { parseSapExtract, postImport, remap, resolveTxn, sampleExtract, stageImport } from '@/core/engine/sap'
import { sum } from '@/core/util'
import Actuals from './Actuals'
import Reconciliation, { SAMPLE_CSV, SAMPLE_SOURCE, sourceRows } from './Reconcile'
import ForecastLines, { lineIssues } from '../admin/ForecastLines'
import SapMappings from '../admin/SapMappings'
import SpreadProfiles, { parseWeights, previewShares } from '../admin/SpreadProfiles'
import { exceptionReason, importFigures, importTxns, isException, linesWithoutRule, previewAllocation, projectLineRollup, ruleOverlaps, testRow, unmappedElements } from './lib'

const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el) }
const staged = () => useStore.getState().actualsImports.find((x) => x.status === 'staged')!

describe('import review helpers', () => {
  const s = buildSeed()
  const imp = s.actualsImports.find((x) => x.status === 'staged')!
  const txns = importTxns(s, imp.id)
  it('summarises the staged October extract with its exceptions', () => {
    const F = importFigures(txns)
    expect(imp.fileName).toBe('CJI3_FY2026_P10_wk4.csv')
    expect(F.exceptions).toBe(2)
    expect(F.unmapped).toBe(12_480)
    expect(Math.round(F.noProject)).toBe(48_211)
    expect(F.excluded).toBe(86_400)
    expect(F.credits).toBeGreaterThanOrEqual(1)
    expect(F.mapped + F.allocated + F.excluded + F.unmapped + F.noProject).toBeCloseTo(F.total, -1)
    const ex = txns.filter(isException)
    expect(exceptionReason(s, ex.find((t) => t.status === 'unmapped')!)).toContain('5450110')
    expect(exceptionReason(s, ex.find((t) => t.status === 'no-project')!)).toContain('C.PSE.9999')
  })
  it('previews allocation the way posting does', () => {
    const roll = projectLineRollup(s, txns)
    for (const r of roll.filter((x) => x.p)) {
      const alloc = sum(Object.values(r.byLine).map((x) => x.allocated))
      expect(Math.abs(alloc - r.allocated)).toBeLessThan(0.05)
    }
    // the default mapping sends overhead to 900 Project Overhead, so allocation only runs when a rule asks for it
    const a = txns.find((t) => t.status === 'allocated')
    if (a) expect(sum(Object.values(previewAllocation(txns, a)))).toBeCloseTo(a.amount, 1)
  })
  it('checks the mapping table', () => {
    const o = ruleOverlaps(s.settings.sapMappings)
    expect(o.some((x) => x.a.id === 'map-01' && x.b.id === 'map-02' && x.kind === 'refines')).toBe(true)
    expect(o.some((x) => x.kind === 'shadowed')).toBe(false)
    const shadow = ruleOverlaps([...s.settings.sapMappings, { id: 'x', priority: 5, costElementFrom: '5000000', costElementTo: '5999999', target: 'exclude', note: '', active: true }])
    expect(shadow.filter((x) => x.kind === 'shadowed').length).toBeGreaterThan(5)
    expect(linesWithoutRule(s).map((l) => l.code)).toEqual([])
    expect(unmappedElements(s).map((x) => x.costElement)).toEqual(['5450110'])
    const t = testRow(s, { costElement: '5100110', sapWbs: 'C.PSE.1001.02', text: '' })
    expect(t.winner?.id).toBe('map-01')
    expect(t.line?.code).toBe('200.10')
    expect(t.all.length).toBe(2)
    expect(testRow(s, { costElement: '5100110', sapWbs: 'C.PSE.1001', text: '' }).line?.code).toBe('700.10')
  })
  it('validates lines and profiles', () => {
    expect(lineIssues(s.settings.forecastLines, s.categories, s.settings.wbsFunctions).unassigned).toEqual([])
    const broken = lineIssues(s.settings.forecastLines.map((l) => (l.code === '500.20' ? { ...l, categoryIds: ['cat-contract'] } : l)), s.categories, s.settings.wbsFunctions)
    expect(broken.multi.map((c) => c.id)).toEqual(['cat-contract'])
    expect(broken.unassigned.map((c) => c.id)).toEqual(['cat-traffic'])
    expect(parseWeights('3, 8,12 ;4')).toEqual([3, 8, 12, 4])
    expect(parseWeights('3, x')).toBeNull()
    const sh = previewShares(s, { id: 'tmp', name: 't', description: '', weights: [1], zeroMonths: [12] }, ['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(sh).toEqual([1 / 3, 0, 1 / 3, 1 / 3])
  })
})

describe('SAP actuals flow through the store', () => {
  beforeEach(() => { useStore.setState(buildSeed()) })
  it('posting is blocked until exceptions are resolved, then rebuilds project actuals by line', () => {
    const imp = staged()
    let res: ReturnType<typeof postImport> = { ok: true, periods: 0 }
    mutate((d) => { res = postImport(d, imp.id) })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('2 row')
    const s = useStore.getState()
    const tx = importTxns(s, imp.id)
    const unk = tx.find((t) => t.status === 'unmapped')!
    const nop = tx.find((t) => t.status === 'no-project')!
    const owner = s.projects.find((p) => p.status === 'active' && p.stageIndex >= 2)!
    mutate((d) => {
      resolveTxn(d, unk.id, { lineId: 'fl-100' }, 'Field software is PM cost')
      resolveTxn(d, nop.id, { projectId: owner.id }, 'Pay app keyed to the wrong WBS')
    })
    const after = importTxns(useStore.getState(), imp.id)
    expect(after.find((t) => t.id === nop.id)!.status).toBe('mapped') // project assigned → mapping rule applies
    expect(after.find((t) => t.id === nop.id)!.lineId).toBe('fl-500-10')
    expect(after.some(isException)).toBe(false)
    mutate((d) => { remap(d, imp.id) })
    expect(importTxns(useStore.getState(), imp.id).some(isException)).toBe(false) // manual resolutions survive a re-run
    mutate((d) => { res = postImport(d, imp.id) })
    expect(res.ok).toBe(true)
    const st = useStore.getState()
    const cp = st.costPeriods.find((c) => c.projectId === owner.id && c.period === '2026-10')!
    expect(cp.source).toBe('sap')
    expect(sum(Object.values(cp.byLine!))).toBe(cp.actual)
    expect(render(<Actuals />)).toContain('Posted')
  })
  it('stages an uploaded extract and renders the review', () => {
    const s = useStore.getState()
    const text = sampleExtract(s, '2026-10', 3)
    const parsed = parseSapExtract(text, '2026-10')
    expect(parsed.errors).toEqual([])
    mutate((d) => { stageImport(d, parsed.rows, 'sample.csv') })
    expect(useStore.getState().actualsImports.filter((x) => x.status === 'staged').length).toBe(2)
    const h = render(<Actuals />)
    expect(h).toContain('SAP actuals')
    expect(h).toContain('CJI3_FY2026_P10_wk4.csv')
    expect(h).toContain('Load the fictional sample file')
    expect(h).toContain('Fictional data only')
    expect(h).toContain('Mapping table')
    expect(h).toContain('block posting')
    expect(h).toContain('No active mapping rule covers cost element 5450110')
  })
  it('renders the configuration pages', () => {
    const l = render(<ForecastLines />)
    expect(l).toContain('Forecast line items')
    expect(l).toContain('Contract construction')
    const m = render(<SapMappings />)
    expect(m).toContain('Test a row')
    expect(m).toContain('Coverage checks')
    expect(m).toContain('5450110')
    const p = render(<SpreadProfiles />)
    expect(p).toContain('Mobilize, produce, demobilize')
    expect(p).toContain('Built-in curves')
  })
})

describe('reconciliation view', () => {
  beforeEach(() => { useStore.setState(buildSeed()) })
  it('bundles the fictional sample file and stages it like an upload', () => {
    const s = useStore.getState()
    const parsed = parseSapExtract(SAMPLE_CSV, '2026-10')
    expect(parsed.errors).toEqual([])
    expect(sourceRows(s, SAMPLE_SOURCE).length).toBe(parsed.rows.length)
    mutate((d) => { stageImport(d, parsed.rows, 'sap-actuals-fictional.csv') })
    const imp = useStore.getState().actualsImports.find((x) => x.fileName === 'sap-actuals-fictional.csv')!
    expect(imp.unmapped).toBe(12_480)
    expect(imp.excluded).toBe(86_400)
  })
  it('renders the sample reconciliation with differences, reconciling rows and the no-project bucket', () => {
    const h = render(<Reconciliation s={useStore.getState()} source={SAMPLE_SOURCE} onSource={() => {}} />)
    expect(h).toContain('SAP project cost')
    expect(h).toContain('Differs by')
    expect(h).toContain('Reconciling rows')
    expect(h).toContain('WBS elements with no project')
    expect(h).toContain('C.PSE.9999')
  })
  it('a posted import ties; the per-project entry opens the reconciliation tab with the drawer', () => {
    const s = useStore.getState()
    const p09 = s.actualsImports.find((x) => x.status === 'posted' && x.period === '2026-09')!
    const h = render(<Reconciliation s={s} source={p09.id} onSource={() => {}} />)
    expect(h).toContain('Ties')
    expect(h).not.toContain('Differs by')
    const page = render(<Actuals projectId="prj-1002" />)
    expect(page).toContain('Reconciliation · PRJ-1002')
    expect(page).toContain('By cost element')
  })
})

