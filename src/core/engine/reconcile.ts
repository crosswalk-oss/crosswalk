// Reconcile an SAP extract against Crosswalk. SAP is the book of record: for every project-period in the extract,
// what SAP says the project cost (rows on the project's WBS, through the current mapping table, less rows the table
// excludes) is compared with what Crosswalk has posted (CostPeriod.actual / byLine / byFunction) and with what the
// project's latest forecast treats as actuals for that month. Row-level matching (document, WBS, cost element,
// amount) against posted SAP transactions explains each difference: rows SAP has that Crosswalk doesn't, rows
// Crosswalk posted that SAP no longer has, and rows that landed differently (hand resolutions, rule changes).
// Pure: reads AppState, returns plain data.
import type { ActualTxn, AppState, CostPeriod, Money, TxnStatus } from '../types'
import { sum } from '../util'
import { budgetByLine, functionOfLine, lineGridOf, linesToFunctions, periodByLine, forecastLines, actualsByLineMonth } from './lines'
import { matchRule, periodLines, projectForWbs, type SapRow } from './sap'
import { latestForecast } from './wbs'

/** Key used for amounts SAP puts on a project but no mapping rule places on a line (unknown cost elements). */
export const UNPLACED = '(unplaced)'

// VERIFY: $1 per project-period covers whole-dollar rounding at posting; anything larger is reported as a difference.
export const RECON_TOLERANCE = 1

export type ReconStatus = 'ties' | 'lines-differ' | 'differs' | 'not-posted'

/** Where a row lands: by the current mapping table (SAP side) or as posted in Crosswalk. */
export interface Landing { projectId?: string; status: TxnStatus; lineId?: string }

export interface ReconItem {
  id: string
  kind: 'sap-only' | 'crosswalk-only' | 'mapped-differently'
  period: string
  row: SapRow // the SAP row (or the posted transaction's SAP fields)
  sap?: Landing // landing by the current mapping table (absent for crosswalk-only)
  cw?: Landing & { txnId: string; manual?: string } // landing as posted (absent for sap-only)
  /** Effect on each project's difference (posted − SAP). Sums to the row's contribution to the gap. */
  effect: Record<string, Money>
  note: string
}

export interface ReconLine { key: string; sap: Money; posted: Money; diff: Money }
export interface ReconCE { costElement: string; name: string; sap: Money; excluded: Money; posted?: Money; diff?: Money; rows: number }

export interface ReconPeriod {
  projectId: string
  period: string
  sap: { gross: Money; excluded: Money; unplaced: Money; cost: Money; rows: number }
  posted?: Money // undefined = no cost period in Crosswalk
  source?: CostPeriod['source']
  diff: Money // posted − SAP cost
  explained: Money // part of diff accounted for by row-level items
  status: ReconStatus
  lines: ReconLine[] // by forecast line (plus UNPLACED)
  functions: ReconLine[] // by WBS function
  costElements: ReconCE[]
  forecast: { cutoff?: string; inActuals: boolean; actual?: Money; etc?: Money }
}

export interface ReconProject {
  projectId: string
  periods: ReconPeriod[]
  sapGross: Money; sapExcluded: Money; sapCost: Money; posted: Money; diff: Money; explained: Money
  status: ReconStatus
  forecastActual: Money; forecastEtc: Money
  items: number
}

export interface Reconciliation {
  period?: string
  periods: string[] // periods in scope
  projects: ReconProject[]
  noProject: { rows: SapRow[]; amount: Money }
  items: ReconItem[]
  totals: { sapGross: Money; sapExcluded: Money; noProject: Money; sapCost: Money; posted: Money; diff: Money; explained: Money; tie: number; projects: number; rows: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const inActuals = (st: TxnStatus) => st === 'mapped' || st === 'allocated'
const STATUS_RANK: Record<ReconStatus, number> = { ties: 0, 'lines-differ': 1, 'not-posted': 2, differs: 3 }

/** Where the current mapping table sends a row (no stored resolutions). */
export function ruleLanding(s: AppState, r: SapRow): Landing {
  const p = projectForWbs(s, r.sapWbs)
  if (!p) return { status: 'no-project' }
  const rule = matchRule(s.settings.sapMappings, r)
  if (!rule) return { projectId: p.id, status: 'unmapped' }
  if (rule.target === 'exclude') return { projectId: p.id, status: 'excluded' }
  if (rule.target === 'allocate') return { projectId: p.id, status: 'allocated' }
  return rule.lineId && forecastLines(s).some((l) => l.id === rule.lineId) ? { projectId: p.id, status: 'mapped', lineId: rule.lineId } : { projectId: p.id, status: 'unmapped' }
}

/** Last month a forecast version treats as actuals: its actualsThrough, or the month before its first ETC month. */
export function forecastCutoff(s: AppState, pid: string): string | undefined {
  const f = latestForecast(s, pid)
  if (!f) return undefined
  const months = Object.values(f.lineSpread ?? f.spread ?? {}).flatMap((r) => Object.keys(r)).sort()
  let b = f.actualsThrough
  if (months.length) {
    const [y, m] = months[0].split('-').map(Number)
    const before = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    if (!b || before > b) b = before
  }
  return b
}

const rowKey = (r: Pick<SapRow, 'period' | 'sapWbs' | 'docNo' | 'costElement' | 'amount'>) => `${r.period}|${r.sapWbs.trim().toUpperCase()}|${r.docNo}|${r.costElement}|${Math.round(r.amount * 100)}`

function landingLabel(s: AppState, l: Landing | undefined): string {
  if (!l) return '—'
  if (l.status === 'mapped') { const ln = s.settings.forecastLines.find((x) => x.id === l.lineId); return ln ? `line ${ln.code}` : 'a missing line' }
  return { allocated: 'allocated pro-rata', excluded: 'excluded', unmapped: 'no mapping rule', 'no-project': 'no project', mapped: '' }[l.status]
}

/**
 * Reconcile SAP rows against Crosswalk's posted actuals. `rows` can be a parsed extract or an import's transactions
 * (ActualTxn carries the SAP fields). `period` limits the comparison to one fiscal period.
 */
export function reconcile(s: AppState, rows: SapRow[], opts: { period?: string } = {}): Reconciliation {
  const scoped = rows.filter((r) => !opts.period || r.period === opts.period)
  const sapRows = scoped.map((r) => ({ r, l: ruleLanding(s, r) }))
  const postedImports = new Set(s.actualsImports.filter((x) => x.status === 'posted').map((x) => x.id))
  const periods = [...new Set(scoped.map((r) => r.period))].sort()
  const periodSet = new Set(periods)

  // posted SAP transactions for the periods in scope, indexed for matching
  const cwTxns = s.actualTxns.filter((t) => postedImports.has(t.importId) && periodSet.has(t.period))
  const pool = new Map<string, ActualTxn[]>()
  for (const t of cwTxns) { const k = rowKey(t); const a = pool.get(k); if (a) a.push(t); else pool.set(k, [t]) }
  const matched = new Set<string>()
  const pairs = sapRows.map(({ r, l }) => {
    const t = pool.get(rowKey(r))?.find((x) => !matched.has(x.id))
    if (t) matched.add(t.id)
    return { r, l, t }
  })

  // scope: project-periods the extract touches by rule, plus those a matched transaction was posted to
  const ppKey = (pid: string, period: string) => `${pid}|${period}`
  const scope = new Set<string>()
  for (const { r, l, t } of pairs) {
    if (l.projectId) scope.add(ppKey(l.projectId, r.period))
    if (t?.projectId) scope.add(ppKey(t.projectId, r.period))
  }

  // row-level reconciling items
  const items: ReconItem[] = []
  const cwLanding = (t: ActualTxn): ReconItem['cw'] => ({ projectId: t.projectId, status: t.status, lineId: t.lineId, txnId: t.id, manual: t.manual?.note })
  pairs.forEach(({ r, l, t }, i) => {
    const effect: Record<string, Money> = {}
    const add = (pid: string | undefined, v: number) => { if (pid && v) effect[pid] = r2((effect[pid] || 0) + v) }
    const sapCounts = l.projectId && l.status !== 'excluded' // unmapped rows are still project cost in SAP
    if (!t) {
      if (!sapCounts) return
      add(l.projectId, -r.amount)
      items.push({ id: `sap-${i}`, kind: 'sap-only', period: r.period, row: r, sap: l, effect, note: `In SAP, not posted in Crosswalk${l.status === 'unmapped' ? ' — cost element has no mapping rule' : ` — mapping table sends it to ${landingLabel(s, l)}`}` })
      return
    }
    const sameLanding = l.projectId === t.projectId && l.status === t.status && (l.lineId ?? '') === (t.lineId ?? '')
    if (sameLanding || (!sapCounts && !(t.projectId && inActuals(t.status)))) return // e.g. a no-project row excluded by hand
    if (sapCounts) add(l.projectId, -r.amount)
    if (t.projectId && inActuals(t.status)) add(t.projectId, r.amount)
    const how = t.manual ? `Resolved by hand${t.manual.note ? `: ${t.manual.note}` : ''}` : 'Mapping table changed since posting'
    const pc = (id?: string) => s.projects.find((p) => p.id === id)?.code ?? 'no project'
    const what = l.projectId !== t.projectId ? `posted to ${pc(t.projectId)}, WBS says ${pc(l.projectId)}` : `posted as ${landingLabel(s, t)}, mapping table says ${landingLabel(s, l)}`
    items.push({ id: `diff-${i}`, kind: 'mapped-differently', period: r.period, row: r, sap: l, cw: cwLanding(t), effect, note: `${how} — ${what}` })
  })
  cwTxns.filter((t) => !matched.has(t.id) && t.projectId && scope.has(ppKey(t.projectId, t.period))).forEach((t, i) => {
    const effect: Record<string, Money> = inActuals(t.status) ? { [t.projectId!]: r2(t.amount) } : {}
    if (!Object.keys(effect).length) return
    items.push({ id: `cw-${i}`, kind: 'crosswalk-only', period: t.period, row: t, cw: cwLanding(t), effect, note: 'Posted in Crosswalk, not in this SAP extract (reversed, re-keyed or filtered out of the extract)' })
  })

  // per project-period comparison
  const out: ReconPeriod[] = []
  for (const key of [...scope].sort()) {
    const [pid, period] = key.split('|')
    const mine = sapRows.filter((x) => x.l.projectId === pid && x.r.period === period)
    const gross = r2(sum(mine.map((x) => x.r.amount)))
    const excluded = r2(sum(mine.filter((x) => x.l.status === 'excluded').map((x) => x.r.amount)))
    const unplaced = r2(sum(mine.filter((x) => x.l.status === 'unmapped').map((x) => x.r.amount)))
    const placed = periodLines(s, mine.map((x) => ({ status: x.l.status, lineId: x.l.lineId, amount: x.r.amount }))).byLine
    const cost = sum(Object.values(placed)) + Math.round(unplaced)
    const cp = s.costPeriods.find((c) => c.projectId === pid && c.period === period)
    const postedLines: Record<string, Money> = cp ? { ...periodByLine(s, cp, budgetByLine(s, pid).byLine) } : {}
    const sapLines: Record<string, Money> = { ...placed, ...(unplaced ? { [UNPLACED]: Math.round(unplaced) } : {}) }
    const lines = diffRows(sapLines, postedLines, (k) => (k === UNPLACED ? 'ZZZ' : s.settings.forecastLines.find((l) => l.id === k)?.code ?? k))
    const fnOf = (m: Record<string, Money>) => { const { [UNPLACED]: u, ...rest } = m; const f = linesToFunctions(s, rest); return u ? { ...f, [UNPLACED]: u } : f }
    const functions = diffRows(fnOf(sapLines), cp?.byFunction && cp.source === 'sap' ? cp.byFunction : fnOf(postedLines), (k) => s.settings.wbsFunctions.find((f) => f.id === k)?.code ?? 'ZZZ')
    // by cost element: SAP vs the posted transactions that reached actuals
    const ces = new Map<string, ReconCE>()
    const ce = (code: string, name: string) => { let e = ces.get(code); if (!e) { e = { costElement: code, name, sap: 0, excluded: 0, rows: 0 }; ces.set(code, e) } return e }
    for (const x of mine) { const e = ce(x.r.costElement, x.r.costElementName); e.sap = r2(e.sap + x.r.amount); e.rows++; if (x.l.status === 'excluded') e.excluded = r2(e.excluded + x.r.amount) }
    const cwHere = cwTxns.filter((t) => t.projectId === pid && t.period === period && inActuals(t.status))
    if (cwHere.length) {
      for (const t of cwHere) { const e = ce(t.costElement, t.costElementName); e.posted = r2((e.posted ?? 0) + t.amount) }
      for (const e of ces.values()) { e.posted ??= 0; e.diff = r2(e.posted - (e.sap - e.excluded)) }
    }
    const posted = cp?.actual
    const diff = Math.round((posted ?? 0) - cost)
    const explained = Math.round(sum(items.filter((it) => it.period === period).map((it) => it.effect[pid] ?? 0)))
    const status: ReconStatus = posted === undefined ? 'not-posted' : Math.abs(diff) > RECON_TOLERANCE ? 'differs' : lines.some((l) => Math.abs(l.diff) > RECON_TOLERANCE) ? 'lines-differ' : 'ties'
    // forecast: does the latest version treat this month as actuals, or does it still carry ETC there?
    const p = s.projects.find((x) => x.id === pid)
    const cutoff = forecastCutoff(s, pid)
    const fIn = !!cutoff && period <= cutoff
    const fc: ReconPeriod['forecast'] = { cutoff, inActuals: fIn }
    if (fIn) fc.actual = Math.round(sum(Object.values(actualsByLineMonth(s, pid)).map((m) => m[period] || 0)))
    else if (p) fc.etc = Math.round(sum(Object.values(lineGridOf(s, p, latestForecast(s, pid))).map((m) => m[period] || 0)))
    out.push({ projectId: pid, period, sap: { gross, excluded, unplaced, cost, rows: mine.length }, posted, source: cp?.source, diff, explained, status, lines, functions, costElements: [...ces.values()].sort((a, b) => a.costElement.localeCompare(b.costElement)), forecast: fc })
  }

  const byProject = new Map<string, ReconPeriod[]>()
  for (const pp of out) { const a = byProject.get(pp.projectId); if (a) a.push(pp); else byProject.set(pp.projectId, [pp]) }
  const code = (id: string) => s.projects.find((p) => p.id === id)?.code ?? id
  const projects: ReconProject[] = [...byProject.entries()].map(([projectId, ps]) => ({
    projectId, periods: ps,
    sapGross: r2(sum(ps.map((x) => x.sap.gross))), sapExcluded: r2(sum(ps.map((x) => x.sap.excluded))), sapCost: sum(ps.map((x) => x.sap.cost)),
    posted: sum(ps.map((x) => x.posted ?? 0)), diff: sum(ps.map((x) => x.diff)), explained: sum(ps.map((x) => x.explained)),
    status: ps.reduce<ReconStatus>((a, x) => (STATUS_RANK[x.status] > STATUS_RANK[a] ? x.status : a), 'ties'),
    forecastActual: sum(ps.map((x) => x.forecast.actual ?? 0)), forecastEtc: sum(ps.map((x) => x.forecast.etc ?? 0)),
    items: items.filter((it) => projectId in it.effect || it.sap?.projectId === projectId || it.cw?.projectId === projectId).length,
  })).sort((a, b) => code(a.projectId).localeCompare(code(b.projectId)))

  const np = sapRows.filter((x) => x.l.status === 'no-project').map((x) => x.r)
  const T = (k: 'sapGross' | 'sapExcluded' | 'sapCost' | 'posted' | 'diff' | 'explained') => r2(sum(projects.map((p) => p[k])))
  return {
    period: opts.period, periods, projects, items,
    noProject: { rows: np, amount: r2(sum(np.map((r) => r.amount))) },
    totals: { sapGross: r2(sum(scoped.map((r) => r.amount))), sapExcluded: T('sapExcluded'), noProject: r2(sum(np.map((r) => r.amount))), sapCost: T('sapCost'), posted: T('posted'), diff: T('diff'), explained: T('explained'), tie: projects.filter((p) => p.status === 'ties').length, projects: projects.length, rows: scoped.length },
  }
}

function diffRows(sap: Record<string, Money>, posted: Record<string, Money>, order: (k: string) => string): ReconLine[] {
  return [...new Set([...Object.keys(sap), ...Object.keys(posted)])]
    .map((key) => { const a = Math.round(sap[key] || 0), b = Math.round(posted[key] || 0); return { key, sap: a, posted: b, diff: b - a } })
    .filter((x) => x.sap || x.posted)
    .sort((a, b) => order(a.key).localeCompare(order(b.key)))
}

/** Function of a reconciliation line key (forecast line id or UNPLACED). */
export const reconLineFunction = (s: AppState, key: string) => (key === UNPLACED ? undefined : functionOfLine(s, key))

/** Rows for a reconciliation CSV: one per project-period (and the no-project bucket). */
export function reconCsvRows(s: AppState, rec: Reconciliation): Record<string, string | number>[] {
  const code = (id: string) => s.projects.find((p) => p.id === id)?.code ?? id
  const rows: Record<string, string | number>[] = rec.projects.flatMap((p) => p.periods.map((x) => ({
    Project: code(p.projectId), 'ERP WBS': s.projects.find((q) => q.id === p.projectId)?.erpWbs ?? '', Period: x.period,
    'SAP rows': x.sap.rows, 'SAP gross': x.sap.gross, 'SAP excluded by rule': x.sap.excluded, 'SAP no mapping rule': x.sap.unplaced, 'SAP project cost': x.sap.cost,
    'Crosswalk posted': x.posted ?? '', 'Posted source': x.source ?? '', Difference: x.diff, Explained: x.explained, Unexplained: x.diff - x.explained,
    Status: RECON_STATUS_LABEL[x.status], 'Forecast treats as': x.forecast.inActuals ? 'actual' : 'ETC', 'Forecast amount': x.forecast.inActuals ? x.forecast.actual ?? '' : x.forecast.etc ?? '',
  })))
  if (rec.noProject.rows.length) rows.push({ Project: '(no project)', 'ERP WBS': [...new Set(rec.noProject.rows.map((r) => r.sapWbs))].join(' '), Period: rec.period ?? 'all', 'SAP rows': rec.noProject.rows.length, 'SAP gross': rec.noProject.amount, 'SAP excluded by rule': 0, 'SAP no mapping rule': 0, 'SAP project cost': 0, 'Crosswalk posted': '', 'Posted source': '', Difference: '', Explained: '', Unexplained: '', Status: 'WBS matches no project', 'Forecast treats as': '', 'Forecast amount': '' })
  return rows
}

/** Rows for the reconciling-items CSV. */
export function reconItemCsvRows(s: AppState, rec: Reconciliation): Record<string, string | number>[] {
  const code = (id?: string) => (id ? s.projects.find((p) => p.id === id)?.code ?? id : '')
  return rec.items.map((it) => ({
    Kind: RECON_ITEM_LABEL[it.kind], Period: it.period, Document: it.row.docNo, 'Posting date': it.row.postingDate, 'WBS element': it.row.sapWbs, 'Cost element': it.row.costElement,
    'Cost element name': it.row.costElementName, Vendor: it.row.vendor, Text: it.row.text, Amount: it.row.amount,
    'SAP project': code(it.sap?.projectId), 'SAP landing': it.sap ? landingLabel(s, it.sap) : '', 'Crosswalk project': code(it.cw?.projectId), 'Crosswalk landing': it.cw ? landingLabel(s, it.cw) : '',
    Effect: Object.entries(it.effect).map(([pid, v]) => `${code(pid)} ${v}`).join('; '), Note: it.note,
  }))
}

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = { ties: 'Ties', 'lines-differ': 'Total ties, lines differ', differs: 'Differs', 'not-posted': 'Not posted' }
export const RECON_ITEM_LABEL: Record<ReconItem['kind'], string> = { 'sap-only': 'In SAP only', 'crosswalk-only': 'In Crosswalk only', 'mapped-differently': 'Landed differently' }
