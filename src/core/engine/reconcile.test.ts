import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSeed } from '../seed'
import { sum } from '../util'
import { parseSapExtract, postImport, resolveTxn, stageImport } from './sap'
import { CJI3_HEADERS, FICTIONAL_SAMPLE_FILE, fictionalSapExtract, sapAmount } from './sapSample'
import { reconcile, reconCsvRows, reconItemCsvRows, UNPLACED } from './reconcile'

const S = buildSeed()
const SAMPLE_PATH = resolve(__dirname, '../../../samples', FICTIONAL_SAMPLE_FILE)
// `npm run sample:sap` regenerates the committed file from the generator
if (process.env.UPDATE_SAP_SAMPLE) writeFileSync(SAMPLE_PATH, fictionalSapExtract(S))
const SAMPLE = readFileSync(SAMPLE_PATH, 'utf8')
const parsed = parseSapExtract(SAMPLE, '2026-10')
const byDoc = (doc: string) => parsed.rows.find((r) => r.docNo === doc)!

describe('fictional SAP sample extract', () => {
  it('the committed file parses cleanly with every CJI3 column recognised', () => {
    expect(SAMPLE.split('\n')[0]).toBe(CJI3_HEADERS.join(','))
    expect(parsed.errors).toEqual([])
    expect(parsed.columns).toMatchObject({ sapWbs: 'WBS Element', costElement: 'Cost Element', costElementName: 'Cost Element Name', fiscalYear: 'Fiscal Year', period: 'Period', postingDate: 'Posting Date', docNo: 'Document Number', refDoc: 'Reference Document', poNumber: 'Purchasing Document', vendor: 'Name', amount: 'Value in Obj. Currency', currency: 'Object Currency', text: 'Text' })
    const dataLines = SAMPLE.trim().split('\n').length - 2 // header and the ALV total line
    expect(parsed.rows.length).toBe(dataLines)
    expect(new Set(parsed.rows.map((r) => r.period))).toEqual(new Set(['2026-09']))
    expect(parsed.rows.every((r) => r.currency === 'USD' && /^\d{4}-\d{2}-\d{2}$/.test(r.postingDate))).toBe(true)
  })
  it('contains only fictional identifiers: seed WBS elements and vendors ending in "Co."', () => {
    const wbs = new Set(S.projects.map((p) => p.erpWbs))
    for (const r of parsed.rows) {
      if (r.sapWbs !== 'C.PSE.9999') expect(wbs.has(r.sapWbs.split('.').slice(0, 3).join('.'))).toBe(true)
      if (r.vendor) expect(r.vendor).toMatch(/ Co\.$/)
    }
  })
  it('carries the realistic quirks', () => {
    expect(SAMPLE).toMatch(/"\d{1,3}(,\d{3})+\.\d{2}"/) // thousands separators
    expect(SAMPLE).toContain('"15,000.00-"') // trailing-minus credit
    expect(byDoc('4900590020').amount).toBe(-15_000)
    expect(byDoc('4900590010').amount + byDoc('4900590011').amount).toBe(0) // reversal pair
    expect(byDoc('4900590011').refDoc).toBe('4900590010')
    expect(byDoc('4900590001').costElement).toBe('5450110') // no mapping rule
    expect(byDoc('4900590030').sapWbs).toBe('C.PSE.9999') // no project
    expect(byDoc('4900590002').costElement).toBe('1400110') // balance sheet
    expect(sapAmount(-1234.5)).toBe('1,234.50-')
  })
  it('the generator produces the same layout and quirks', () => {
    const g = parseSapExtract(fictionalSapExtract(S), '2026-10')
    expect(g.errors).toEqual([])
    expect(g.rows.filter((r) => r.docNo.startsWith('490059')).length).toBe(6)
    expect(new Set(g.rows.map((r) => r.sapWbs.split('.').slice(0, 3).join('.'))).size).toBe(7) // six projects + C.PSE.9999
  })
  it('reads fiscal year + bare period, rejects other currencies, prefers the vendor name over its number', () => {
    const r = parseSapExtract('WBS Element,Cost Element,Fiscal Year,Period,Vendor,Name,Value in Obj. Currency,Object Currency\nC.PSE.1001,5200110,2026,009,300010,Pinecone Builders Co.,"1,000.00",USD\nC.PSE.1001,5200110,2026,9,300010,Pinecone Builders Co.,5.00,EUR\n', '2026-10')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ period: '2026-09', vendor: 'Pinecone Builders Co.', amount: 1000 })
    expect(r.errors[0]).toContain('EUR')
  })
})

describe('reconciliation', () => {
  it('posted imports tie to Crosswalk actuals by project, period and line', () => {
    for (const imp of S.actualsImports.filter((i) => i.status === 'posted')) {
      const rec = reconcile(S, S.actualTxns.filter((t) => t.importId === imp.id))
      expect(rec.projects.length).toBeGreaterThan(10)
      expect(rec.projects.every((p) => p.status === 'ties')).toBe(true)
      expect(rec.totals.diff).toBe(0)
      expect(rec.items).toEqual([])
      expect(rec.totals.posted).toBe(rec.totals.sapCost)
      for (const pp of rec.projects.flatMap((p) => p.periods)) {
        expect(pp.lines.every((l) => l.diff === 0)).toBe(true)
        expect(pp.functions.every((l) => l.diff === 0)).toBe(true)
        expect(pp.forecast.inActuals).toBe(true)
        expect(pp.forecast.actual).toBe(pp.posted)
      }
    }
  })
  it('the sample file reconciles against posted September: ties except its quirks, all explained', () => {
    const rec = reconcile(S, parsed.rows, { period: '2026-09' })
    const [a, b, c, ...rest] = rec.projects
    expect(rec.projects).toHaveLength(6)
    expect(a.status).toBe('differs')
    expect(a.diff).toBe(-12_480) // SAP has an unknown cost element Crosswalk never posted
    expect(a.sapExcluded).toBe(86_400) // balance sheet excluded by rule
    expect(b.status).toBe('ties') // reversal pair nets to zero
    expect(c.diff).toBe(15_000) // SAP credit memo not yet in Crosswalk
    expect(rest.every((p) => p.status === 'ties')).toBe(true)
    expect(rec.projects.every((p) => p.diff === p.explained)).toBe(true)
    expect(rec.noProject.amount).toBe(48_210.55)
    expect(rec.items.map((i) => i.kind)).toEqual(['sap-only', 'sap-only', 'sap-only', 'sap-only'])
    expect(reconCsvRows(S, rec).length).toBe(7)
    expect(reconItemCsvRows(S, rec)[0]).toHaveProperty('Note')
  })
  it('detects rows excluded or mapped to another line by hand after posting the sample', () => {
    const next = produce(S, (d) => {
      const imp = stageImport(d, parsed.rows, FICTIONAL_SAMPLE_FILE)
      const tx = () => d.actualTxns.filter((t) => t.importId === imp.id)
      for (const t of tx().filter((t) => t.status === 'unmapped')) resolveTxn(d, t.id, { lineId: 'fl-100' }, 'Field software is PM cost')
      for (const t of tx().filter((t) => t.status === 'no-project')) resolveTxn(d, t.id, { exclude: true }, 'Belongs to another utility program; AP to transfer')
      const pids = [...new Set(tx().map((t) => t.projectId))].filter(Boolean).sort()
      const ex = tx().find((t) => t.projectId === pids[3] && t.status === 'mapped')!
      resolveTxn(d, ex.id, { exclude: true }, 'Looks like a duplicate')
      const mis = tx().find((t) => t.projectId === pids[4] && t.status === 'mapped' && t.lineId !== 'fl-999')!
      resolveTxn(d, mis.id, { lineId: 'fl-999' }, 'Not sure where this goes')
      expect(postImport(d, imp.id).ok).toBe(true)
    })
    const rec = reconcile(next, parsed.rows)
    const [a, b, c, d, e, f] = rec.projects
    // a: the unknown cost element was placed by hand — total ties, lines differ (unplaced vs 100.10)
    expect(a.status).toBe('lines-differ')
    expect(a.periods[0].lines.find((l) => l.key === UNPLACED)!.diff).toBe(-12_480)
    expect([b.status, c.status, f.status]).toEqual(['ties', 'ties', 'ties'])
    const exAmt = rec.items.find((i) => i.cw?.manual === 'Looks like a duplicate')!.row.amount
    expect(d.status).toBe('differs')
    expect(d.diff).toBe(-Math.round(exAmt))
    expect(d.explained).toBe(d.diff)
    expect(e.status).toBe('lines-differ')
    expect(e.diff).toBe(0)
    expect(e.periods[0].lines.find((l) => l.key === 'fl-999')!.diff).toBeGreaterThan(0)
    expect(rec.items.filter((i) => i.kind === 'mapped-differently').length).toBe(3)
    expect(rec.totals.tie).toBe(3)
  })
  it('a row dropped from a posted month shows as Crosswalk-only; a staged extract differs from summary actuals', () => {
    const p09 = S.actualsImports.find((i) => i.status === 'posted' && i.period === '2026-09')!
    const rows = S.actualTxns.filter((t) => t.importId === p09.id)
    const dropped = rows[5]
    const rec = reconcile(S, rows.filter((t) => t.id !== dropped.id))
    const p = rec.projects.find((x) => x.projectId === dropped.projectId)!
    expect(p.status).toBe('differs')
    expect(p.diff).toBe(Math.round(dropped.amount))
    expect(rec.items).toHaveLength(1)
    expect(rec.items[0].kind).toBe('crosswalk-only')
    // October: Crosswalk holds summary actuals; the staged weekly extract carries exceptions
    const oct = S.actualsImports.find((i) => i.status === 'staged')!
    const r10 = reconcile(S, S.actualTxns.filter((t) => t.importId === oct.id), { period: '2026-10' })
    expect(r10.projects.every((x) => x.periods.every((pp) => pp.source === 'summary'))).toBe(true)
    expect(r10.projects.some((x) => x.status === 'differs')).toBe(true)
    expect(r10.noProject.rows).toHaveLength(1)
    expect(Math.abs(sum(r10.projects.map((x) => x.sapCost)) + r10.totals.noProject + r10.totals.sapExcluded - r10.totals.sapGross)).toBeLessThan(r10.projects.length)
  })
})
