// SAP actual-cost extract → forecast line items through the mapping table. Pure functions over AppState
// (stage/post/resolve mutate an immer draft). A real deployment receives the same rows from SAP via
// middleware (CJI3 / ACDOCA extract, or an OData feed) instead of a CSV upload.
import type { ActualTxn, ActualsImport, AppState, CostPeriod, Money, Project, SapMapping } from '../types'
import { nowISO, sum, uid } from '../util'
import { allocate, forecastLines, functionOfLine, linesToFunctions } from './lines'

export interface SapRow {
  sapWbs: string
  costElement: string
  costElementName: string
  period: string // 'YYYY-MM'
  postingDate: string
  amount: number
  vendor: string
  docNo: string
  text: string
  refDoc?: string // reference document (vendor invoice, reversed document)
  poNumber?: string // purchasing document
  currency?: string // object currency (USD only)
}

/** Columns read from an extract: every SapRow field plus fiscal year (combined with a bare period number). */
export type SapColumn = keyof SapRow | 'fiscalYear'

/** Minimal RFC-4180 CSV reader (quotes, embedded commas/newlines, CRLF). Also accepts tab- or semicolon-delimited text. */
export function readDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

/**
 * Column aliases accepted from common SAP extracts (CJI3 / KSB1 / S/4 ACDOCA exports, English headers). Aliases are
 * tried in order, so when an extract has both a vendor number ("Vendor") and a vendor name ("Name") the name wins.
 */
const COLS: Record<SapColumn, string[]> = {
  sapWbs: ['wbs element', 'wbs', 'object', 'wbs elem', 'posid', 'ps_posid'],
  costElement: ['cost element', 'cost elem', 'gl account', 'g/l account', 'kstar', 'racct', 'account'],
  costElementName: ['cost element name', 'cost element descr', 'cost elem.name', 'account name', 'gl account name'],
  period: ['period', 'fiscal period', 'posting period', 'per', 'poper', 'fiscal year/period'],
  fiscalYear: ['fiscal year', 'fisc. year', 'year', 'gjahr'],
  postingDate: ['posting date', 'pstng date', 'budat', 'date'],
  amount: ['amount', 'value in obj. currency', 'value in obj. crcy', 'val/coarea crcy', 'val.in rep.cur.', 'amount in local currency', 'hsl', 'wkgbtr', 'value'],
  currency: ['object currency', 'obj. currency', 'objectcurrency', 'currency', 'crcy', 'owaer'],
  vendor: ['vendor name', 'name', 'supplier name', 'vendor', 'supplier', 'lifnr'],
  docNo: ['document number', 'doc. no.', 'documentno', 'belnr', 'document', 'ref doc no'],
  refDoc: ['reference document', 'ref. document', 'reference', 'ref. doc. no.', 'xblnr', 'refbn'],
  poNumber: ['purchasing document', 'purchase order', 'po number', 'ebeln'],
  text: ['text', 'name of offsetting account', 'item text', 'description', 'sgtxt'],
}

function parseAmount(v: string): number {
  let t = v.trim().replace(/[$\s]/g, '')
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1) } // SAP trailing minus
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.') // 1.234,56
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : NaN
}

function toPeriod(period: string, postingDate: string, fallback: string, fiscalYear = ''): string {
  const p = period.trim()
  // CJI3 shows the fiscal year and a bare period number (9 or 009) in separate columns. Fiscal year = calendar year
  // here; special periods 13–16 fall back to the posting date.
  // VERIFY: confirm the fiscal-year variant (calendar year, periods 1–12 = Jan–Dec) before reading a real extract.
  if (/^\d{4}$/.test(fiscalYear.trim()) && /^\d{1,3}$/.test(p) && Number(p) >= 1 && Number(p) <= 12) return `${fiscalYear.trim()}-${String(Number(p)).padStart(2, '0')}`
  let m = p.match(/^(\d{4})[-/.](\d{1,3})$/) // 2026-10 or 2026/010
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`
  m = p.match(/^(\d{1,3})[-/.](\d{4})$/) // 010/2026
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`
  const d = toISODate(postingDate)
  return d ? d.slice(0, 7) : fallback
}
function toISODate(v: string): string {
  const t = v.trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/) // US mm/dd/yyyy (SAP US default) or dd.mm.yyyy
  if (m) return t.includes('.') ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return ''
}

/** Parse an SAP extract. `fallbackPeriod` is used when neither period nor posting date can be read. */
export function parseSapExtract(text: string, fallbackPeriod: string): { rows: SapRow[]; errors: string[]; columns: Partial<Record<SapColumn, string>> } {
  const grid = readDelimited(text.replace(/^\uFEFF/, ''))
  const errors: string[] = []
  if (grid.length < 2) return { rows: [], errors: ['The file has no data rows.'], columns: {} }
  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  const idx = {} as Record<SapColumn, number>
  const columns: Partial<Record<SapColumn, string>> = {}
  const used = new Set<number>()
  for (const k of Object.keys(COLS) as SapColumn[]) {
    idx[k] = -1
    for (const a of COLS[k]) { const i = header.indexOf(a); if (i >= 0 && !used.has(i)) { idx[k] = i; break } }
    if (idx[k] >= 0) { used.add(idx[k]); columns[k] = grid[0][idx[k]].trim() }
  }
  for (const k of ['sapWbs', 'costElement', 'amount'] as const) if (idx[k] < 0) errors.push(`Missing a "${COLS[k][0]}" column (accepted headers: ${COLS[k].slice(0, 4).join(', ')}).`)
  if (errors.length) return { rows: [], errors, columns }
  const rows: SapRow[] = []
  grid.slice(1).forEach((r, i) => {
    const g = (k: SapColumn) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
    const amount = parseAmount(g('amount'))
    if (!g('sapWbs') && !g('costElement')) return
    if (!Number.isFinite(amount)) { errors.push(`Row ${i + 2}: amount "${g('amount')}" is not a number — skipped.`); return }
    const currency = g('currency').toUpperCase()
    if (currency && currency !== 'USD') { errors.push(`Row ${i + 2}: currency ${currency} — only USD extracts are read; skipped.`); return }
    const postingDate = toISODate(g('postingDate'))
    const row: SapRow = { sapWbs: g('sapWbs'), costElement: g('costElement').replace(/^0+(?=\d{7})/, ''), costElementName: g('costElementName'), period: toPeriod(g('period'), g('postingDate'), fallbackPeriod, g('fiscalYear')), postingDate: postingDate || `${fallbackPeriod}-28`, amount: Math.round(amount * 100) / 100, vendor: g('vendor'), docNo: g('docNo'), text: g('text') }
    if (g('refDoc')) row.refDoc = g('refDoc')
    if (g('poNumber')) row.poNumber = g('poNumber')
    if (currency) row.currency = currency
    rows.push(row)
  })
  return { rows, errors, columns }
}

/** Project for an SAP WBS element: the project whose erpWbs is the element or its parent (C.PSE.1042 / C.PSE.1042.06). */
export function projectForWbs(s: AppState, wbs: string): Project | undefined {
  const w = wbs.trim().toUpperCase()
  return s.projects.filter((p) => w === p.erpWbs.toUpperCase() || w.startsWith(p.erpWbs.toUpperCase() + '.')).sort((a, b) => b.erpWbs.length - a.erpWbs.length)[0]
}

const inRange = (ce: string, from: string, to: string) => {
  const n = Number(ce), a = Number(from), b = Number(to)
  return Number.isFinite(n) && Number.isFinite(a) && Number.isFinite(b) ? n >= a && n <= b : ce >= from && ce <= to
}
/** First active rule (by priority) that matches the row. */
export function matchRule(rules: SapMapping[], r: Pick<SapRow, 'costElement' | 'sapWbs' | 'text' | 'vendor'>): SapMapping | undefined {
  return [...rules].filter((x) => x.active).sort((a, b) => a.priority - b.priority).find((x) =>
    inRange(r.costElement, x.costElementFrom, x.costElementTo) &&
    (!x.wbsSuffix || r.sapWbs.toUpperCase().endsWith(x.wbsSuffix.toUpperCase())) &&
    (!x.textContains || `${r.text} ${r.vendor}`.toLowerCase().includes(x.textContains.toLowerCase())))
}

/** Classify rows into transactions (no allocation yet — allocation happens per project/period at post time). */
export function classify(s: AppState, rows: SapRow[], importId: string): ActualTxn[] {
  return rows.map((r) => {
    const p = projectForWbs(s, r.sapWbs)
    const rule = matchRule(s.settings.sapMappings, r)
    const base = { id: uid('txn'), importId, projectId: p?.id, period: r.period, postingDate: r.postingDate, sapWbs: r.sapWbs, costElement: r.costElement, costElementName: r.costElementName, docNo: r.docNo, vendor: r.vendor, text: r.text, amount: r.amount, ruleId: rule?.id }
    if (!p) return { ...base, status: 'no-project' as const }
    if (!rule) return { ...base, status: 'unmapped' as const }
    if (rule.target === 'exclude') return { ...base, status: 'excluded' as const }
    if (rule.target === 'allocate') return { ...base, status: 'allocated' as const }
    return { ...base, status: rule.lineId && forecastLines(s).some((l) => l.id === rule.lineId) ? 'mapped' as const : 'unmapped' as const, lineId: rule.lineId }
  })
}

export function summarize(txns: ActualTxn[]) {
  const t = (st: ActualTxn['status'][]) => Math.round(sum(txns.filter((x) => st.includes(x.status)).map((x) => x.amount)))
  return { rows: txns.length, total: t(['mapped', 'allocated', 'unmapped', 'excluded', 'no-project']), mapped: t(['mapped', 'allocated']), unmapped: t(['unmapped']), excluded: t(['excluded']), noProject: t(['no-project']) }
}

/** Stage an import (nothing reaches project actuals until it is posted). Mutates the draft; returns the import. */
export function stageImport(d: AppState, rows: SapRow[], fileName: string, byId = d.currentUserId): ActualsImport {
  const id = uid('imp')
  const txns = classify(d, rows, id)
  const periods = [...new Set(txns.map((t) => t.period))].sort()
  const imp: ActualsImport = { id, fileName, source: 'SAP extract', period: periods[periods.length - 1] ?? d.settings.asOf.slice(0, 7), importedAt: nowISO(), byId, status: 'staged', ...summarize(txns), projectIds: [...new Set(txns.map((t) => t.projectId).filter(Boolean) as string[])] }
  d.actualTxns.push(...txns)
  d.actualsImports.push(imp)
  d.audit.push({ id: uid('aud'), at: imp.importedAt, actorId: byId, entity: 'actuals-import', entityId: id, action: 'stage', summary: `Staged SAP extract ${fileName}: ${imp.rows} rows, ${imp.projectIds.length} projects` })
  return imp
}

/** Re-run the mapping table over a staged import (after rules change). Keeps manual resolutions. */
export function remap(d: AppState, importId: string) {
  const imp = d.actualsImports.find((x) => x.id === importId)
  if (!imp || imp.status !== 'staged') return
  for (const t of d.actualTxns.filter((x) => x.importId === importId && !x.manual)) {
    const [n] = classify(d, [t], importId)
    Object.assign(t, { status: n.status, lineId: n.lineId, ruleId: n.ruleId, projectId: n.projectId, allocation: undefined })
  }
  Object.assign(imp, summarize(d.actualTxns.filter((x) => x.importId === importId)))
}

/** Resolve an exception by hand: map to a line, or exclude. */
export function resolveTxn(d: AppState, txnId: string, to: { lineId?: string; exclude?: boolean; projectId?: string }, note: string, byId = d.currentUserId) {
  const t = d.actualTxns.find((x) => x.id === txnId)
  if (!t) return
  if (to.projectId) t.projectId = to.projectId
  if (to.projectId && !to.exclude && !to.lineId && t.status === 'no-project') {
    // project assigned by hand: the row now runs through the mapping table like any other row
    const rule = matchRule(d.settings.sapMappings, t)
    t.ruleId = rule?.id
    t.status = !rule ? 'unmapped' : rule.target === 'exclude' ? 'excluded' : rule.target === 'allocate' ? 'allocated' : rule.lineId && forecastLines(d).some((l) => l.id === rule.lineId) ? 'mapped' : 'unmapped'
    t.lineId = t.status === 'mapped' ? rule?.lineId : undefined
  } else {
    t.status = to.exclude ? 'excluded' : to.lineId ? 'mapped' : t.status
    t.lineId = to.exclude ? undefined : to.lineId ?? t.lineId
  }
  t.manual = { byId, at: nowISO(), note }
  const imp = d.actualsImports.find((x) => x.id === t.importId)
  if (imp) Object.assign(imp, summarize(d.actualTxns.filter((x) => x.importId === t.importId)))
}

/**
 * One project-period's actuals by line from its rows, exactly as posting builds them: mapped rows land on their
 * line, allocated rows (loader settlements) are spread pro-rata over the period's mapped lines (or evenly over every
 * line when nothing is mapped), and the result is rounded to whole dollars with the residual on the largest line so
 * it sums to the rounded total. Other statuses are ignored. `allocations[i]` is row i's split when it was allocated.
 */
export function periodLines(s: AppState, rows: Pick<ActualTxn, 'status' | 'lineId' | 'amount'>[]): { byLine: Record<string, Money>; allocations: (Record<string, Money> | undefined)[] } {
  const byLine: Record<string, Money> = {}
  for (const t of rows) if (t.status === 'mapped' && t.lineId) byLine[t.lineId] = (byLine[t.lineId] || 0) + t.amount
  const direct = Object.keys(byLine).length ? { ...byLine } : Object.fromEntries(forecastLines(s).map((l) => [l.id, 1]))
  const base = sum(Object.values(direct))
  const allocations = rows.map((t) => {
    if (t.status !== 'allocated') return undefined
    const ids = Object.keys(direct)
    const share: Record<string, Money> = {}
    let acc = 0
    ids.forEach((k, i) => { const v = i === ids.length - 1 ? Math.round((t.amount - acc) * 100) / 100 : Math.round(t.amount * (base ? direct[k] / base : 1 / ids.length) * 100) / 100; share[k] = v; acc += v })
    for (const [k, v] of Object.entries(share)) byLine[k] = (byLine[k] || 0) + v
    return share
  })
  // whole dollars, exact to the rounded total
  const target = Math.round(sum(Object.values(byLine)))
  const whole = Object.fromEntries(Object.entries(byLine).map(([k, v]) => [k, Math.round(v)]))
  const diff = target - sum(Object.values(whole))
  const big = Object.keys(whole).sort((a, b) => Math.abs(whole[b]) - Math.abs(whole[a]))[0]
  if (big && diff) whole[big] += diff
  return { byLine: Object.fromEntries(Object.entries(whole).filter(([, v]) => v !== 0)), allocations }
}

/**
 * Post a staged import. Every (project, period) in the file is rebuilt from SAP: the extract is treated as the
 * complete period-to-date actuals for those projects (re-importing a period replaces it). Allocated rows (loader
 * settlements) are spread over that period's mapped lines pro-rata. Unmapped and no-project rows block posting.
 */
export function postImport(d: AppState, importId: string, byId = d.currentUserId): { ok: boolean; reason?: string; periods: number } {
  const imp = d.actualsImports.find((x) => x.id === importId)
  if (!imp || imp.status !== 'staged') return { ok: false, reason: 'Import is not staged', periods: 0 }
  const txns = d.actualTxns.filter((x) => x.importId === importId)
  const blocking = txns.filter((x) => x.status === 'unmapped' || x.status === 'no-project')
  if (blocking.length) return { ok: false, reason: `${blocking.length} row(s) still need a line or a project`, periods: 0 }
  // supersede earlier posted transactions for the same project-periods
  const keys = new Set(txns.filter((t) => t.projectId).map((t) => `${t.projectId}|${t.period}`))
  const earlier = new Set(d.actualsImports.filter((x) => x.status === 'posted' && x.id !== importId).map((x) => x.id))
  d.actualTxns = d.actualTxns.filter((t) => !(earlier.has(t.importId) && keys.has(`${t.projectId}|${t.period}`)))
  for (const key of keys) {
    const [pid, period] = key.split('|')
    const rows = d.actualTxns.filter((t) => t.importId === importId && t.projectId === pid && t.period === period)
    const { byLine: final, allocations } = periodLines(d, rows)
    rows.forEach((t, i) => { if (allocations[i]) t.allocation = allocations[i] })
    const actual = sum(Object.values(final))
    let cp = d.costPeriods.find((c) => c.projectId === pid && c.period === period)
    if (!cp) {
      cp = { id: uid('cp'), projectId: pid, period, planned: 0, earned: 0, actual: 0, commitments: 0 } as CostPeriod
      d.costPeriods.push(cp)
    }
    cp.actual = actual
    cp.byLine = final
    cp.byFunction = linesToFunctions(d, final)
    cp.source = 'sap'
  }
  imp.status = 'posted'
  imp.postedAt = nowISO()
  imp.postedById = byId
  d.audit.push({ id: uid('aud'), at: imp.postedAt, actorId: byId, entity: 'actuals-import', entityId: importId, action: 'post', summary: `Posted SAP actuals ${imp.fileName}: ${money0(imp.mapped)} to ${keys.size} project-period(s)${imp.excluded ? `, ${money0(imp.excluded)} excluded` : ''}` })
  return { ok: true, periods: keys.size }
}
const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function discardImport(d: AppState, importId: string, byId = d.currentUserId) {
  const imp = d.actualsImports.find((x) => x.id === importId)
  if (!imp || imp.status !== 'staged') return
  imp.status = 'discarded'
  d.actualTxns = d.actualTxns.filter((t) => t.importId !== importId)
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: byId, entity: 'actuals-import', entityId: importId, action: 'discard', summary: `Discarded staged SAP extract ${imp.fileName}` })
}

/** Posted SAP transactions for a project (optionally one line and/or period) — the drill-down behind every actual. */
export function txnsFor(s: AppState, pid: string, o: { lineId?: string; fnId?: string; period?: string } = {}): ActualTxn[] {
  const posted = new Set(s.actualsImports.filter((x) => x.status === 'posted').map((x) => x.id))
  return s.actualTxns.filter((t) => posted.has(t.importId) && t.projectId === pid && (!o.period || t.period === o.period) && t.status !== 'excluded' &&
    (!o.lineId || t.lineId === o.lineId || (t.allocation && o.lineId in t.allocation)) &&
    (!o.fnId || (t.lineId && functionOfLine(s, t.lineId) === o.fnId) || (t.allocation && Object.keys(t.allocation).some((l) => functionOfLine(s, l) === o.fnId))))
}

/** Build a realistic SAP extract (CSV) for a period — used for the demo's "download a sample extract" and tests. */
export function sampleExtract(s: AppState, period: string, seed = 1): string {
  let x = seed * 9301 + 49297
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280)
  const ce = [
    ['5100110', 'Company labor — straight time', 'line'], ['5100120', 'Company labor — overtime', 'line'], ['5100110', 'Company labor — straight time', 'eng'],
    ['5200110', 'Contract services — construction', 'line'], ['5200130', 'Contract services — equipment rental', 'line'], ['5310110', 'Material — line pipe', 'line'],
    ['5320110', 'Material — valves', 'line'], ['5400110', 'Outside engineering services', 'line'], ['5510110', 'Environmental consultants', 'line'],
    ['5600110', 'Inspection services — NDE', 'line'], ['5700110', 'Paving & restoration', 'line'], ['5710110', 'Traffic control services', 'line'],
    ['5800110', 'Project controls services', 'line'], ['5900110', 'A&G overhead settlement', 'alloc'], ['5900120', 'Pension & benefits loader', 'alloc'], ['5900130', 'AFUDC', 'alloc'],
  ] as const
  const vendors = ['Kestrel Ridge Pipeline Co.', 'Larkspur Inspection Co.', 'Cactus Wren Traffic Co.', 'Quillfeather Environmental Co.', 'Bluejay Paving Co.', 'Cobalt Mesa Engineering Co.', 'Ironbark Valve Supply Co.']
  const out: string[] = ['WBS Element,Cost Element,Cost Element Name,Fiscal Period,Posting Date,Amount,Vendor,Document Number,Text']
  const projects = s.projects.filter((p) => p.status === 'active' && p.stageIndex >= 1).slice(0, 8)
  const [y, m] = period.split('-')
  let doc = 4900012000 + seed * 1000
  for (const p of projects) {
    const n = 6 + Math.floor(rnd() * 6)
    for (let i = 0; i < n; i++) {
      const [code, name, kind] = ce[Math.floor(rnd() * ce.length)]
      const amt = Math.round((kind === 'alloc' ? 8000 + rnd() * 40000 : 5000 + rnd() * 180000) * 100) / 100
      const wbs = kind === 'eng' ? `${p.erpWbs}.02` : p.erpWbs
      const day = String(3 + Math.floor(rnd() * 24)).padStart(2, '0')
      out.push([wbs, code, name, `${y}/${String(Number(m)).padStart(3, '0')}`, `${m}/${day}/${y}`, amt.toFixed(2), kind === 'alloc' || code.startsWith('51') ? '' : vendors[Math.floor(rnd() * vendors.length)], String(doc++), kind === 'alloc' ? 'Period-end settlement' : `${p.code} ${name.split(' — ')[0].toLowerCase()}`].map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
    }
  }
  // exceptions to show the workflow: an unknown cost element, a WBS that matches no project, a reversal
  const p0 = projects[0]
  if (p0) {
    out.push([p0.erpWbs, '5450110', 'Software subscriptions', `${y}/${String(Number(m)).padStart(3, '0')}`, `${m}/15/${y}`, '12480.00', 'Mapleleaf Field Software Co.', String(doc++), 'Field data collection licenses'].join(','))
    out.push(['C.XXX.9999', '5200110', 'Contract services — construction', `${y}/${String(Number(m)).padStart(3, '0')}`, `${m}/18/${y}`, '48210.55', 'Kestrel Ridge Pipeline Co.', String(doc++), 'Mis-keyed WBS'].join(','))
    out.push([p0.erpWbs, '5200110', 'Contract services — construction', `${y}/${String(Number(m)).padStart(3, '0')}`, `${m}/20/${y}`, '-15000.00', 'Kestrel Ridge Pipeline Co.', String(doc++), 'Credit memo — retention release reversal'].join(','))
  }
  return out.join('\n')
}
