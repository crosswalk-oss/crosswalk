import { buildSeed } from '@/core/seed'
import { actualsThrough, budgetByFunction, eacOf, forecastMonths, spreadTotal } from '@/core/engine/wbs'
import { sum } from '@/core/util'
import {
  applyPaste, applySpread, byYearOf, carryForward, clearRow, compareVersions, copyVersion, currentCycle, cycleOf, cycleRows,
  diffSummary, distribute, fmtCell, gridCsvRows, isBlock, parseClipboard, parseMoney, rollup, rollupCsvRows, rollupFnTotal,
  rollupYearTotal, rowTotal, scaleRow, setCell, setYearTotal, spreadRow, startCycle, versionCutoff, versionsOf,
} from './lib'

describe('cell entry', () => {
  it('parses dollars, separators, suffixes and negatives', () => {
    expect(parseMoney('1234')).toBe(1234)
    expect(parseMoney('$1,234,567')).toBe(1234567)
    expect(parseMoney('1.2M')).toBe(1200000)
    expect(parseMoney('450k')).toBe(450000)
    expect(parseMoney(' $2.5m ')).toBe(2500000)
    expect(parseMoney('(5,000)')).toBe(-5000)
    expect(parseMoney('-5k')).toBe(-5000)
    expect(parseMoney('−7,500')).toBe(-7500)
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('-')).toBe(0)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1.2.3')).toBeNull()
    expect(parseMoney('250', 1000)).toBe(250000)
    expect(parseMoney('1.5M', 1000)).toBe(1500000)
    expect(fmtCell(1234567)).toBe('1,234,567')
    expect(fmtCell(0)).toBe('')
  })
  it('parses an Excel block', () => {
    expect(parseClipboard('1\t2\t3\r\n4\t5\t6\r\n')).toEqual([['1', '2', '3'], ['4', '5', '6']])
    expect(isBlock('1,000\n')).toBe(false)
    expect(isBlock('1\t2')).toBe(true)
    expect(isBlock('1\n2')).toBe(true)
  })
  it('pastes right and down, clipping at the grid edge and reporting bad cells', () => {
    const rows = ['a', 'b'], cols = ['2027-01', '2027-02', '2027-03']
    const r = applyPaste({}, rows, cols, 0, 1, parseClipboard('1,000\t$2k\t9\n3\tx\n5\t6'))
    expect(r.spread.a).toEqual({ '2027-02': 1000, '2027-03': 2000 })
    expect(r.spread.b).toEqual({ '2027-02': 3 })
    expect(r.filled).toBe(3)
    expect(r.rejected).toEqual(['x'])
  })
})

describe('spread edits', () => {
  const months = ['2026-11', '2026-12', '2027-01', '2027-02']
  it('set/clear keeps zero cells out', () => {
    let sp = setCell({}, 'f', '2026-11', 100)
    sp = setCell(sp, 'f', '2026-12', 0)
    expect(sp.f).toEqual({ '2026-11': 100 })
    expect(clearRow(sp, 'f').f).toEqual({})
  })
  it('spreads an amount over a range and clears the rest of the row', () => {
    const sp = spreadRow({ f: { '2026-11': 999, '2027-02': 5 } }, 'f', months, 1000, 'even', '2026-12', '2027-01')
    expect(sp.f).toEqual({ '2026-12': 500, '2027-01': 500 })
  })
  it('scales a row to a new ETC keeping its shape', () => {
    const sp = scaleRow({ f: { '2026-11': 100, '2027-01': 300 } }, 'f', months, 800, 'even')
    expect(sp.f).toEqual({ '2026-11': 200, '2027-01': 600 })
    const fresh = scaleRow({}, 'g', months, 1001, 'even')
    expect(rowTotal(fresh, 'g')).toBe(1001)
    expect(Object.keys(fresh.g)).toEqual(months)
  })
  it('distributes exactly', () => {
    const d = distribute(1000, [1, 1, 1])
    expect(sum(d)).toBe(1000)
    expect(distribute(10, [0, 0])).toEqual([5, 5])
  })
  it('summarises a save for the audit trail', () => {
    const fns = [{ id: 'f', code: '06', name: 'Construction' }]
    const t = diffSummary(fns, { f: { '2026-11': 100 } }, { f: { '2026-11': 150, '2026-12': 50 } }, 0, 10)
    expect(t).toContain('2 cells changed')
    expect(t).toContain('06 Construction +$100')
    expect(t).toContain('contingency held +$10')
    expect(diffSummary(fns, {}, {}, 0, 0)).toBe('No changes to the spread')
  })
})

describe('versions on the seed', () => {
  const s = buildSeed()
  const p = s.projects.find((x) => x.code === 'PRJ-1001')!
  it('lists versions newest first and computes the cutoff', () => {
    const vs = versionsOf(s, p.id)
    expect(vs.length).toBeGreaterThanOrEqual(3)
    expect(vs[0].date >= vs[1].date).toBe(true)
    expect(versionCutoff(s, vs[0])).toBe(actualsThrough(s, p.id))
  })
  it('copies the latest version into a draft with the same EAC when nothing is stale', () => {
    const src = versionsOf(s, p.id)[0]
    const { forecast, moved } = copyVersion(s, p, src, { byId: 'u-me' })
    expect(forecast.status).toBe('draft')
    expect(forecast.locked).toBe(false)
    expect(forecast.date).toBe(s.settings.asOf)
    expect(moved).toBe(0)
    expect(spreadTotal(forecast.spread)).toBe(spreadTotal(src.spread))
    expect(forecast.eac).toBe(eacOf(s, p.id, forecast.spread, forecast.contingencyHeld))
    expect(sum(Object.values(forecast.byYear))).toBe(forecast.eac)
  })
  it('carries ETC that fell into closed months forward', () => {
    const src = versionsOf(s, p.id)[0]
    const stale = { ...src.spread!, 'wbs-500': { ...src.spread!['wbs-500'], '2026-09': 1_000_000 } }
    const all = carryForward(s, p, stale, '2026-08', 'all')
    expect(all.moved).toBe(1_000_000)
    expect(spreadTotal(all.spread)).toBe(spreadTotal(stale))
    expect(Object.keys(all.spread['wbs-500']).every((m) => m > actualsThrough(s, p.id))).toBe(true)
    const net = carryForward(s, p, stale, '2026-08', 'net')
    expect(net.moved).toBeLessThan(1_000_000)
  })
  it('starts a first version from remaining budget when there is none', () => {
    const { forecast } = copyVersion(s, p, undefined, { byId: 'u-me' })
    const bud = budgetByFunction(s, p.id)
    expect(spreadTotal(forecast.spread)).toBeGreaterThan(0)
    expect(forecast.eac).toBeLessThanOrEqual(bud.total + 10)
  })
  it('applySpread recomputes EAC and calendar years', () => {
    const d = buildSeed()
    const f = versionsOf(d, p.id)[0]
    const sp = setCell(f.spread!, 'wbs-500', forecastMonths(d, p)[0], 12_345)
    applySpread(d, f, sp, 1000, 'n')
    expect(f.eac).toBe(eacOf(d, p.id, sp, 1000))
    expect(sum(Object.values(f.byYear))).toBe(f.eac)
    expect(byYearOf(d, p.id, {}, 0)['2026']).toBeGreaterThan(0)
  })
  it('compares two versions by function and month', () => {
    const [b, a] = versionsOf(s, p.id).filter((f) => f.status === 'approved')
    const c = compareVersions(s, a, b)
    expect(c.rows.length).toBe(s.settings.wbsFunctions.length)
    expect(sum(c.months.map((m) => m.delta))).toBe(spreadTotal(b.spread) - spreadTotal(a.spread))
    expect(c.movers.length).toBeLessThanOrEqual(5)
  })
  it('exports the grid with totals that tie to EAC', () => {
    const f = versionsOf(s, p.id)[1]
    const rows = gridCsvRows(s, p, f, forecastMonths(s, p))
    const total = rows[rows.length - 1]
    expect(total['WBS code']).toBe('TOTAL')
    expect(total.EAC).toBe(f.eac)
  })
})

describe('cycle and roll-up', () => {
  it('assigns versions to cycles and reports status', () => {
    const s = buildSeed()
    expect(cycleOf('2026-10-26')).toBe('2026-11')
    expect(cycleOf('2026-10-16')).toBe('2026-10')
    expect(currentCycle(s)).toBe('2026-11')
    const rows = cycleRows(s)
    expect(rows.some((r) => r.status === 'in-review')).toBe(true)
    expect(rows.some((r) => r.status === 'not-started')).toBe(true)
  })
  it('start cycle creates one draft per project without a version, once', () => {
    const s = buildSeed()
    const before = cycleRows(s).filter((r) => r.status === 'not-started').length
    const n0 = s.forecasts.length
    const r = startCycle(s, 'u-me')
    expect(r.codes.length).toBe(before)
    expect(s.forecasts.length).toBe(n0 + before)
    expect(cycleRows(s).every((x) => x.status !== 'not-started')).toBe(true)
    expect(startCycle(s, 'u-me').codes.length).toBe(0)
  })
  it('rolls up actuals + spread by function and year', () => {
    const s = buildSeed()
    const ps = s.projects.filter((p) => p.status === 'active')
    const r = rollup(s, ps)
    const total = sum(r.years.map((y) => rollupYearTotal(r, y)))
    const eacs = sum(r.projects.map((x) => x.version.eac))
    expect(Math.abs(total - eacs)).toBeLessThan(r.projects.length * 2 + 2)
    expect(sum(r.fns.map((f) => rollupFnTotal(r, f.id))) + sum(Object.values(r.contingency))).toBe(total)
    const csv = rollupCsvRows(r)
    expect(csv[csv.length - 1]['WBS code']).toBe('TOTAL')
  })
})

describe('year totals', () => {
  it('sets a year total keeping shape, and pastes into collapsed years', () => {
    const months = ['2026-11', '2026-12', '2027-01', '2027-02']
    const sp = setYearTotal({ f: { '2027-01': 100, '2027-02': 300 } }, 'f', ['2027-01', '2027-02'], 1000)
    expect(sp.f).toEqual({ '2027-01': 250, '2027-02': 750 })
    const even = setYearTotal({}, 'g', ['2026-11', '2026-12'], 101)
    expect(rowTotal(even, 'g')).toBe(101)
    const r = applyPaste({}, ['f'], ['2026', '2027-01'], 0, 0, [['200', '5']], 1, months)
    expect(r.spread.f).toEqual({ '2026-11': 100, '2026-12': 100, '2027-01': 5 })
  })
})
