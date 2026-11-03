// Line-item forecasting: profiles by WBS function, line-level versions, ETC/EAC by function, SAP drill-down.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mutate, useStore } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { actualsThrough, forecastMonths, spreadTotal } from '@/core/engine/wbs'
import { budgetByLine, etcEacByFunction, linesOfFunction, rollupGrid } from '@/core/engine/lines'
import { txnsFor } from '@/core/engine/sap'
import { sum } from '@/core/util'
import ForecastSpread from '../project/tabs/ForecastSpread'
import ForecastCycle from './ForecastCycle'
import {
  applyFnProfile, applyLines, carryForwardLines, carryProfiles, copyVersion, etcEacAt, fnGroups, lineActuals, lineCsvRows, lineRefs, linesToSpread,
  markAdjusted, portfolioEtcEac, portfolioEtcEacCsv, rowTotal, setCell, shapeOf, stripZeros, txnShare, versionCutoff, versionsOf, working,
} from './lib'

const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el) }

describe('line-level forecast helpers', () => {
  const s = buildSeed()
  const p = s.projects.find((x) => x.code === 'PRJ-1001')!
  const v = versionsOf(s, p.id)[0]

  it('the open November version carries the custom construction and restoration profiles', () => {
    expect(v.lineSpread).toBeTruthy()
    expect(v.profiles?.['wbs-500']?.profileId).toBe('prof-mobilize')
    expect(v.profiles?.['wbs-500']?.adjusted).toBe(true)
    expect(v.profiles?.['wbs-800']?.profileId).toBe('prof-closeout')
  })
  it('groups lines under the WBS functions in WBS order', () => {
    const g = fnGroups(s, lineRefs(s))
    expect(g.length).toBe(s.settings.wbsFunctions.length)
    expect(g.find((x) => x.fn.id === 'wbs-300')!.lines.map((l) => l.code)).toEqual(['300.10', '300.20', '300.30'])
  })
  it('applies a profile to one function: total kept, lines phased, adjusted cleared', () => {
    const lines = stripZeros(v.lineSpread)
    const ids = linesOfFunction(s, 'wbs-500').map((l) => l.id)
    const before = sum(ids.map((id) => rowTotal(lines, id)))
    const ms = forecastMonths(s, p)
    const r = applyFnProfile(s, p, lines, 'wbs-500', { profileId: 'bell', start: ms[1], end: ms[6] })
    expect(sum(ids.map((id) => rowTotal(r.lines, id)))).toBe(before)
    for (const id of ids) expect(Object.keys(r.lines[id]).every((m) => m >= ms[1] && m <= ms[6])).toBe(true)
    expect(r.profile.adjusted).toBe(false)
    // other functions untouched
    expect(r.lines['fl-100']).toEqual(lines['fl-100'])
    const adj = markAdjusted({ 'wbs-500': r.profile }, 'wbs-500')
    expect(adj['wbs-500'].adjusted).toBe(true)
    expect(markAdjusted({}, 'wbs-500')).toEqual({})
  })
  it('black-out months of a custom profile get no ETC', () => {
    const ms = forecastMonths(s, p)
    const r = applyFnProfile(s, p, stripZeros(v.lineSpread), 'wbs-500', { profileId: 'prof-moratorium', start: ms[0], end: ms[ms.length - 1] })
    const row = r.lines['fl-500-30'] ?? {}
    expect(Object.keys(row).some((m) => ['11', '12', '01'].includes(m.slice(5)))).toBe(false)
    expect(shapeOf(s, 'prof-moratorium', ms).filter((x) => x === 0).length).toBeGreaterThan(0)
  })
  it('ETC / EAC by function ties to the stored EAC and the line grid', () => {
    const t = etcEacAt(s, p, v, versionCutoff(s, v))
    expect(t.totals.eac).toBe(v.eac)
    expect(t.totals.etc).toBe(spreadTotal(v.lineSpread))
    expect(sum(t.rows.map((r) => r.actual))).toBe(sum(s.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.actual)))
    for (const r of t.rows) expect(r.eac).toBe(sum(r.lines.map((l) => l.eac)))
    expect(etcEacByFunction(s, p, v).totals.eac).toBe(t.totals.eac)
  })
  it('copies a version at line level with profiles carried over', () => {
    const { forecast, moved } = copyVersion(s, p, v, { byId: 'u-me' })
    expect(moved).toBe(0)
    expect(spreadTotal(forecast.lineSpread)).toBe(spreadTotal(v.lineSpread))
    expect(forecast.spread).toEqual(stripZeros(rollupGrid(s, forecast.lineSpread)))
    expect(forecast.profiles?.['wbs-500']?.profileId).toBe('prof-mobilize')
    expect(sum(Object.values(forecast.byYear))).toBe(forecast.eac)
  })
  it('carries stale line ETC forward and marks the function adjusted', () => {
    const through = actualsThrough(s, p.id)
    const lines = { ...stripZeros(v.lineSpread), 'fl-500-10': { ...stripZeros(v.lineSpread)['fl-500-10'], [through]: 500_000 } }
    const r = carryForwardLines(s, p, lines, through, 'all')
    expect(r.moved).toBe(500_000)
    expect(r.movedBy['fl-500-10']).toBe(500_000)
    expect(spreadTotal(r.spread)).toBe(spreadTotal(lines))
    const pr = carryProfiles({ 'wbs-500': { profileId: 'scurve', start: '2020-01', end: '2020-02', adjusted: false } }, forecastMonths(s, p), new Set(['wbs-500']))
    expect(pr['wbs-500'].start).toBe(forecastMonths(s, p)[0])
    expect(pr['wbs-500'].adjusted).toBe(true)
  })
  it('writes lines back and keeps spread / EAC / years in step', () => {
    const d = buildSeed()
    const f = versionsOf(d, p.id)[0]
    const m = forecastMonths(d, p)[0]
    const lines = setCell(stripZeros(f.lineSpread), 'fl-500-20', m, rowTotal(f.lineSpread ?? {}, 'fl-500-20') + 0 + 77_000)
    applyLines(d, f, lines, 1_000, 'n', { ...f.profiles })
    expect(spreadTotal(f.spread)).toBe(spreadTotal(f.lineSpread))
    expect(f.eac).toBe(sum(d.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.actual)) + spreadTotal(lines) + 1_000)
    expect(sum(Object.values(f.byYear))).toBe(f.eac)
    expect(working(d, f, lines, 1_000, {}).eac).toBe(f.eac)
    expect(linesToSpread(d, lines)['wbs-500']).toBeTruthy()
  })
  it('exports a line CSV whose total ties to EAC', () => {
    const rows = lineCsvRows(s, p, v, forecastMonths(s, p))
    const tot = rows[rows.length - 1]
    expect(tot['WBS code']).toBe('TOTAL')
    expect(tot.EAC).toBe(v.eac)
    expect(rows.some((r) => r['Line code'] === '500.10')).toBe(true)
    expect(rows.find((r) => r['WBS code'] === '500' && r['Line code'] === '')!.Profile).toContain('adjusted')
  })
  it('line actuals sum to the ERP actual and drill to SAP rows', () => {
    const la = lineActuals(s, p.id)
    expect(sum(Object.values(la))).toBe(sum(s.costPeriods.filter((c) => c.projectId === p.id).map((c) => c.actual)))
    const cp = s.costPeriods.find((c) => c.projectId === p.id && c.period === '2026-09')!
    expect(cp.source).toBe('sap')
    const tx = txnsFor(s, p.id, { lineId: 'fl-500-10', period: '2026-09' })
    expect(tx.length).toBeGreaterThan(0)
    expect(Math.abs(sum(tx.map((t) => txnShare(s, t, { lineId: 'fl-500-10' }))) - (cp.byLine?.['fl-500-10'] ?? 0))).toBeLessThan(2)
    const fnTx = txnsFor(s, p.id, { fnId: 'wbs-500', period: '2026-09' })
    expect(Math.abs(sum(fnTx.map((t) => txnShare(s, t, { fnId: 'wbs-500' }))) - (cp.byFunction?.['wbs-500'] ?? 0))).toBeLessThan(3)
  })
  it('rolls ETC / EAC by function up across the portfolio', () => {
    const ps = s.projects.filter((x) => x.status === 'active')
    const r = portfolioEtcEac(s, ps)
    const eacs = sum(r.projects.map((x) => etcEacAt(s, x.p, x.version, versionCutoff(s, x.version)).totals.eac))
    expect(r.totals.eac).toBe(eacs)
    expect(sum(r.rows.map((x) => x.eac)) + r.contingencyHeld).toBe(r.totals.eac)
    const bud = sum(r.projects.map((x) => { const b = budgetByLine(s, x.p.id); return sum(Object.values(b.byLine)) + b.contingency }))
    expect(r.totals.budget).toBe(bud)
    expect(portfolioEtcEacCsv(r).pop()!['WBS code']).toBe('TOTAL')
  })
})

describe('forecast tab at line level', () => {
  beforeEach(() => { useStore.setState(buildSeed()) })
  it('renders PRJ-1001 with the ETC/EAC headline, profiles and actual months', () => {
    const h = render(<ForecastSpread projectId="prj-1001" />)
    expect(h).toContain('ETC / EAC by WBS function')
    expect(h).toContain('Mobilize, produce, demobilize')
    expect(h).toContain('Closeout tail')
    expect(h).toContain('adjusted')
    expect(h).toContain('Contract construction')
    expect(h).toContain('actual · SAP')
    expect(h).toContain('SAP transactions for')
  })
  it('a draft is editable at line level and opens on line rows', () => {
    const s0 = useStore.getState()
    const p = s0.projects.find((x) => x.code === 'PRJ-1011')!
    const { forecast } = copyVersion(s0, p, versionsOf(s0, p.id)[0], { byId: 'u-me', note: 'x' })
    mutate((d) => { d.forecasts.push(forecast) })
    const h = render(<ForecastSpread projectId={p.id} />)
    expect(h).toContain('Submit for review')
    expect(h).toContain('aria-label="500.10 Contract construction')
    expect(h).toContain('Line tools for')
  })
  it('the cycle page shows the portfolio ETC / EAC by function', () => {
    const h = render(<ForecastCycle />)
    expect(h).toContain('ETC / EAC by WBS function — portfolio')
    expect(h).toContain('Projects over')
  })
})
