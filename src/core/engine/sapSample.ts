// The fictional SAP actuals sample committed at samples/sap-actuals-fictional.csv. Everything in it is made up: the
// projects and WBS elements are the seed's fictional "Arroyo Valley Gas" projects, the cost elements are the seed's
// fictional cost elements, and every vendor is a fictional "… Co.". It is laid out like a typical SAP PS line-item
// report (CJI3-style English column headers) so the import reads it the way it would read a real export.
//
// It is built from the seed's posted September (P09) transactions for six projects, so the reconciliation view
// ties for most of them, plus the quirks real extracts have: thousands separators, trailing-minus credits, a
// reversal pair, an unknown cost element, a WBS that matches no project, a balance-sheet row and an ALV total line.
// Regenerate with `npm run sample:sap` (writes the file from this function).
import type { ActualTxn, AppState } from '../types'
import { sum } from '../util'

export const FICTIONAL_SAMPLE_FILE = 'sap-actuals-fictional.csv'
export const FICTIONAL_SAMPLE_PERIOD = '2026-09'

export const CJI3_HEADERS = ['WBS Element', 'Cost Element', 'Cost Element Name', 'Fiscal Year', 'Period', 'Posting Date', 'Document Number', 'Reference Document', 'Purchasing Document', 'Vendor', 'Name', 'Value in Obj. Currency', 'Object Currency', 'Text'] as const

/** 1234.5 → "1,234.50"; −1234.5 → "1,234.50-" (SAP trailing minus). */
export function sapAmount(n: number): string {
  const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `${a}-` : a
}
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`

interface Line { wbs: string; ce: string; ceName: string; date: string; doc: string; ref: string; po: string; vendorNo: string; vendor: string; amount: number; text: string }

/** Build the fictional CJI3-style extract (CSV text). Deterministic for a given seed. */
export function fictionalSapExtract(s: AppState): string {
  const imp = s.actualsImports.find((x) => x.status === 'posted' && x.period === FICTIONAL_SAMPLE_PERIOD)
  const txns = imp ? s.actualTxns.filter((t) => t.importId === imp.id) : []
  // six projects across WBS prefixes (skip the largest program project to keep the sample short)
  const pids = [...new Set(txns.map((t) => t.projectId!).filter(Boolean))]
  const projects = pids.map((id) => s.projects.find((p) => p.id === id)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code))
  const byPrefix = new Map<string, typeof projects>()
  for (const p of projects.slice(1)) { const k = p.erpWbs.split('.').slice(0, 2).join('.'); byPrefix.set(k, [...(byPrefix.get(k) ?? []), p]) }
  const pick = [...byPrefix.values()].flatMap((ps) => ps.slice(0, 3)).slice(0, 6).sort((a, b) => a.code.localeCompare(b.code))
  const vendors = [...new Set(txns.map((t) => t.vendor).filter(Boolean))].sort()
  const vName = (v: string) => (v && !/ Co\.$/.test(v) ? `${v.replace(/^City of /, '')} Permit Services Co.` : v)
  const vNo = (v: string) => (v ? String(300010 + vendors.indexOf(v) * 10) : '')
  const lines: Line[] = []
  const from = (t: ActualTxn, p: (typeof pick)[number]): Line => ({
    wbs: t.sapWbs, ce: t.costElement, ceName: t.costElementName, date: t.postingDate, doc: t.docNo,
    ref: t.vendor ? `INV-${t.docNo.slice(-5)}` : '', po: t.vendor ? `45${String(vendors.indexOf(t.vendor) + 1).padStart(2, '0')}0${p.code.replace(/\D/g, '')}` : '',
    vendorNo: vNo(t.vendor), vendor: vName(t.vendor), amount: t.amount, text: t.text,
  })
  for (const p of pick) for (const t of txns.filter((x) => x.projectId === p.id).sort((a, b) => a.sapWbs.localeCompare(b.sapWbs) || a.docNo.localeCompare(b.docNo))) lines.push(from(t, p))

  // quirks
  const [a, b, c] = pick
  const y = FICTIONAL_SAMPLE_PERIOD.slice(0, 4), m = FICTIONAL_SAMPLE_PERIOD.slice(5)
  const d = (day: number) => `${y}-${m}-${String(day).padStart(2, '0')}`
  const q = (x: Partial<Line> & Pick<Line, 'wbs' | 'ce' | 'ceName' | 'doc' | 'amount' | 'text'>): Line => ({ date: d(29), ref: '', po: '', vendorNo: '', vendor: '', ...x })
  if (a) {
    lines.push(q({ wbs: a.erpWbs, ce: '5450110', ceName: 'Software subscriptions', date: d(15), doc: '4900590001', ref: 'INV-77120', vendorNo: '300990', vendor: 'Mapleleaf Field Software Co.', amount: 12_480, text: 'Field data collection licenses' }))
    lines.push(q({ wbs: a.erpWbs, ce: '1400110', ceName: 'Inventory transfer — pipe stock', date: d(21), doc: '4900590002', amount: 86_400, text: 'Pipe transferred from storeroom (balance sheet)' }))
  }
  if (b) {
    lines.push(q({ wbs: b.erpWbs, ce: '5200110', ceName: 'Contract services — construction', date: d(10), doc: '4900590010', ref: 'INV-55012', po: `4599${b.code.replace(/\D/g, '')}`, vendorNo: '300995', vendor: 'Pinecone Builders Co.', amount: 23_450, text: 'Pay app 5 — duplicate entry' }))
    lines.push(q({ wbs: b.erpWbs, ce: '5200110', ceName: 'Contract services — construction', date: d(12), doc: '4900590011', ref: '4900590010', po: `4599${b.code.replace(/\D/g, '')}`, vendorNo: '300995', vendor: 'Pinecone Builders Co.', amount: -23_450, text: 'Reversal of 4900590010 — duplicate invoice' }))
  }
  if (c) lines.push(q({ wbs: c.erpWbs, ce: '5200110', ceName: 'Contract services — construction', date: d(30), doc: '4900590020', ref: 'CM-3301', po: `4598${c.code.replace(/\D/g, '')}`, vendorNo: '300996', vendor: 'Kestrel Ridge Pipeline Co.', amount: -15_000, text: 'Credit memo, backcharge for damaged coating' }))
  lines.push(q({ wbs: 'C.PSE.9999', ce: '5200110', ceName: 'Contract services — construction', date: d(18), doc: '4900590030', ref: 'INV-55107', vendorNo: '300996', vendor: 'Kestrel Ridge Pipeline Co.', amount: 48_210.55, text: 'Pay app 7 — WBS keyed incorrectly' }))

  const out = [CJI3_HEADERS.join(',')]
  for (const l of lines) out.push([l.wbs, l.ce, l.ceName, y, String(Number(m)), usDate(l.date), l.doc, l.ref, l.po, l.vendorNo, l.vendor, sapAmount(l.amount), 'USD', l.text].map(csvCell).join(','))
  // ALV exports end with a total line (no WBS, no cost element) — the import skips it
  out.push(['', '', '', '', '', '', '', '', '', '', '', sapAmount(Math.round(sum(lines.map((l) => l.amount)) * 100) / 100), 'USD', '*'].map(csvCell).join(','))
  return out.join('\n') + '\n'
}
