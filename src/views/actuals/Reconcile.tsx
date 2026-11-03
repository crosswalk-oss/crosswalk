// Reconciliation: does Crosswalk agree with SAP? For a chosen extract (a staged or posted import, or the bundled
// fictional sample file) and period, compares SAP project cost with Crosswalk's posted actuals and the forecast's
// actual months by project, then drills to lines, functions, cost elements and the rows that explain each gap.
import React, { useMemo, useState } from 'react'
import type { AppState } from '@/core/types'
import { go, projectHref } from '@/core/router'
import { parseSapExtract, type SapRow } from '@/core/engine/sap'
import { reconcile, reconCsvRows, reconItemCsvRows, ruleLanding, RECON_ITEM_LABEL, RECON_STATUS_LABEL, RECON_TOLERANCE, UNPLACED, type ReconItem, type ReconPeriod, type ReconProject, type ReconStatus } from '@/core/engine/reconcile'
import { FICTIONAL_SAMPLE_FILE } from '@/core/engine/sapSample'
import { lineById } from '@/core/engine/lines'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, fmtMonth, money, sum } from '@/core/util'
import { Badge, Button, Callout, Drawer, Empty, Field, Panel, SegButtons, Select, Tabs, type Tone } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { lsGet, lsSet } from '../admin/common'
import { TXN_STATUS } from './lib'
import SAMPLE_CSV from '../../../samples/sap-actuals-fictional.csv?raw'

export { SAMPLE_CSV }
export const SAMPLE_SOURCE = 'sample'
const $ = (n: number) => money(n, 'full')
const signed = (n: number) => (n > 0 ? `+${$(n)}` : $(n))

/** Open the reconciliation tab on the SAP actuals page (optionally for one project or one extract). */
export function openReconciliation(o: { projectId?: string; source?: string } = {}) {
  lsSet('crosswalk:actuals-tab', 'recon')
  lsSet('crosswalk:recon-open', o)
  go('#actuals')
}
/** Read (and clear) a pending hand-off from openReconciliation. */
export function takeReconHandoff(): { projectId?: string; source?: string } | null {
  const o = lsGet<{ projectId?: string; source?: string } | null>('crosswalk:recon-open', null)
  if (o) lsSet('crosswalk:recon-open', null)
  return o
}

const STATUS_TONE: Record<ReconStatus, Tone> = { ties: 'good', 'lines-differ': 'warn', differs: 'bad', 'not-posted': 'warn' }
export function ReconBadge({ status, diff }: { status: ReconStatus; diff: number }) {
  return <Badge tone={STATUS_TONE[status]}>{status === 'differs' ? `Differs by ${signed(diff)}` : RECON_STATUS_LABEL[status]}</Badge>
}

export function sourceRows(s: AppState, source: string): SapRow[] {
  if (source === SAMPLE_SOURCE) return parseSapExtract(SAMPLE_CSV, s.settings.asOf.slice(0, 7)).rows
  return s.actualTxns.filter((t) => t.importId === source)
}

export default function Reconciliation({ s, source, onSource, projectId: initialProject }: { s: AppState; source: string; onSource: (id: string) => void; projectId?: string }) {
  const imports = useMemo(() => s.actualsImports.filter((x) => x.status !== 'discarded').sort((a, b) => b.period.localeCompare(a.period) || b.importedAt.localeCompare(a.importedAt)), [s.actualsImports])
  const rows = useMemo(() => sourceRows(s, source), [s, source])
  const periods = useMemo(() => [...new Set(rows.map((r) => r.period))].sort(), [rows])
  const [period, setPeriod] = useState('')
  const per = periods.includes(period) ? period : ''
  const [pid, setPid] = useState(initialProject ?? '')
  const [openPid, setOpenPid] = useState<string | null>(initialProject ?? null)
  const rec = useMemo(() => reconcile(s, rows, { period: per || undefined }), [s, rows, per])
  const shown = rec.projects.filter((p) => !pid || p.projectId === pid)
  const T = rec.totals
  const pc = (id?: string) => s.projects.find((p) => p.id === id)
  const srcName = source === SAMPLE_SOURCE ? FICTIONAL_SAMPLE_FILE : imports.find((x) => x.id === source)?.fileName ?? 'extract'
  const exportCsv = async (what: 'summary' | 'rows') => {
    const data = what === 'summary' ? reconCsvRows(s, rec) : reconItemCsvRows(s, rec)
    if (!data.length) { toast('Nothing to export', 'info'); return }
    const r = await saveFile(`${srcName.replace(/\.\w+$/, '')}-reconciliation${what === 'rows' ? '-rows' : ''}${per ? `-${per}` : ''}.csv`, toCSV(data), 'text/csv')
    if (r === 'saved') toast(what === 'summary' ? 'Reconciliation exported' : 'Reconciling rows exported')
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel pad={false}>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <p className="text-[12.5px] text-muted">SAP is the book of record. For every project-period in the extract, <b className="text-ink">SAP project cost</b> (rows on the project’s WBS run through the current mapping table, less rows the table excludes) is compared with Crosswalk’s <b className="text-ink">posted actuals</b> and with what the project’s latest <b className="text-ink">forecast</b> treats as actuals for that month. Rows are matched by document, WBS, cost element and amount, so every difference traces to the rows behind it.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="SAP extract">
              <Select aria-label="SAP extract" value={source} onChange={(e) => { onSource(e.target.value); setPeriod('') }} options={[{ value: SAMPLE_SOURCE, label: `${FICTIONAL_SAMPLE_FILE} · fictional sample (not staged)` }, ...imports.map((x) => ({ value: x.id, label: `${x.fileName} · ${x.status} · ${fmtMonth(x.period)}` }))]} />
            </Field>
            <Field label="Period">
              <Select aria-label="Period" value={per} onChange={(e) => setPeriod(e.target.value)} options={[{ value: '', label: periods.length > 1 ? `All periods (${periods.length})` : 'All periods' }, ...periods.map((m) => ({ value: m, label: fmtMonth(m) }))]} />
            </Field>
            <Field label="Project">
              <Select aria-label="Project" value={pid} onChange={(e) => setPid(e.target.value)} options={[{ value: '', label: `All projects (${rec.projects.length})` }, ...rec.projects.map((p) => ({ value: p.projectId, label: `${pc(p.projectId)?.code ?? p.projectId} · ${pc(p.projectId)?.name ?? ''}` }))]} />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 xl:grid-cols-7">
          <Fig label="SAP rows" value={$(T.sapGross)} sub={`${T.rows} rows · ${rec.periods.map(fmtMonth).join(', ') || '—'}`} />
          <Fig label="Excluded by rule" value={$(T.sapExcluded)} sub="balance sheet / not project cost" />
          <Fig label="No project" value={$(T.noProject)} sub={`${rec.noProject.rows.length} row${rec.noProject.rows.length === 1 ? '' : 's'} · WBS matches no project`} tone={T.noProject ? 'bad' : undefined} />
          <Fig label="SAP project cost" value={$(T.sapCost)} sub={`${T.projects} project${T.projects === 1 ? '' : 's'}`} />
          <Fig label="Crosswalk posted" value={$(T.posted)} sub="CostPeriod actuals" />
          <Fig label="Difference" value={signed(T.diff)} sub={`posted − SAP · ${$(T.diff - T.explained)} unexplained`} tone={Math.abs(T.diff) > RECON_TOLERANCE ? 'bad' : 'good'} />
          <Fig label="Projects that tie" value={`${T.tie} / ${T.projects}`} sub={`within $${RECON_TOLERANCE} per period, total and lines`} tone={T.tie === T.projects ? 'good' : undefined} />
        </div>
      </Panel>

      <Panel title="By project" subtitle={`${shown.length} project${shown.length === 1 ? '' : 's'} · click a row for lines, cost elements and SAP rows`} pad={false}
        actions={<><Button size="sm" variant="ghost" onClick={() => exportCsv('summary')} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV</Button><Button size="sm" variant="ghost" onClick={() => exportCsv('rows')} icon={<Icon name="download" className="h-3.5 w-3.5" />}>Rows CSV</Button></>}>
        {shown.length ? (
          <div className="scroll-x">
            <table className="tbl [&_td]:py-1.5">
              <thead><tr><th>Project</th><th className="num">SAP cost</th><th className="num">Posted</th><th className="num">Difference</th><th className="num hidden sm:table-cell">Unexplained</th><th className="num hidden md:table-cell">Forecast</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((p) => {
                  const pr = pc(p.projectId)
                  return (
                    <tr key={p.projectId} className="clickable" onClick={() => setOpenPid(p.projectId)}>
                      <td className="max-w-[220px]"><div className="font-mono text-[12px] font-semibold">{pr?.code ?? p.projectId}</div><div className="truncate text-[11.5px] text-muted" title={pr?.name}>{pr?.name}</div></td>
                      <td className="num">{$(p.sapCost)}{p.sapExcluded ? <div className="text-[10.5px] text-faint">{$(p.sapExcluded)} excl.</div> : null}</td>
                      <td className="num">{p.periods.every((x) => x.posted === undefined) ? <span className="text-faint">—</span> : $(p.posted)}{p.periods.some((x) => x.source === 'summary') && <div className="text-[10.5px] text-faint">summary</div>}</td>
                      <td className={cx('num font-semibold', Math.abs(p.diff) > RECON_TOLERANCE ? 'text-bad' : 'text-faint')}>{p.diff ? signed(p.diff) : '–'}</td>
                      <td className={cx('num hidden sm:table-cell', Math.abs(p.diff - p.explained) > RECON_TOLERANCE ? 'text-bad' : 'text-faint')}>{p.diff - p.explained ? signed(p.diff - p.explained) : '–'}</td>
                      <td className="num hidden md:table-cell">{forecastCell(p)}</td>
                      <td className="whitespace-nowrap"><ReconBadge status={p.status} diff={p.diff} />{p.items > 0 && <div className="mt-0.5 text-[10.5px] text-muted">{p.items} reconciling row{p.items === 1 ? '' : 's'}</div>}</td>
                    </tr>
                  )
                })}
                {!pid && <tr className="bg-sunken font-bold"><td>Total</td><td className="num">{$(T.sapCost)}</td><td className="num">{$(T.posted)}</td><td className="num">{signed(T.diff)}</td><td className="num hidden sm:table-cell">{signed(T.diff - T.explained)}</td><td className="hidden md:table-cell" /><td>{T.tie}/{T.projects} tie</td></tr>}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><Empty title="Nothing to reconcile">{rows.length ? 'No row in this extract lands on a project for the chosen period.' : 'This extract has no rows.'}</Empty></div>}
      </Panel>

      <Items s={s} items={rec.items.filter((it) => !pid || pid in it.effect || it.sap?.projectId === pid || it.cw?.projectId === pid)} />

      {rec.noProject.rows.length > 0 && !pid && (
        <Panel title="WBS elements with no project" subtitle={`${$(rec.noProject.amount)} SAP cost that belongs to no Crosswalk project — stays out of every project until SAP is corrected or the row is assigned on import`} pad={false}>
          <RowsTable s={s} rows={rec.noProject.rows} />
        </Panel>
      )}

      {openPid && <ProjectDrawer s={s} rec={rec.projects.find((p) => p.projectId === openPid)} pid={openPid} rows={rows} items={rec.items} source={srcName} onClose={() => setOpenPid(null)} />}
    </div>
  )
}

function forecastCell(p: ReconProject) {
  const inAct = p.periods.every((x) => x.forecast.inActuals)
  const none = p.periods.every((x) => !x.forecast.inActuals && !x.forecast.etc)
  if (none) return <span className="text-faint">no forecast</span>
  return inAct ? <span title="The latest forecast treats these months as actuals">{$(p.forecastActual)}<div className="text-[10.5px] text-faint">as actuals</div></span>
    : <span className="text-warn" title="The latest forecast still holds estimate-to-complete in these months — roll the forecast forward">{$(p.forecastEtc)}<div className="text-[10.5px]">still ETC</div></span>
}

function Fig({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5 sm:px-4">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-0.5 truncate font-display text-[17px] font-bold leading-tight tabular-nums', tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink')}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted" title={sub}>{sub}</div>}
    </div>
  )
}

const KIND_TONE: Record<ReconItem['kind'], Tone> = { 'sap-only': 'warn', 'crosswalk-only': 'info', 'mapped-differently': 'bad' }
function Items({ s, items }: { s: AppState; items: ReconItem[] }) {
  const [kind, setKind] = useState<ReconItem['kind'] | 'all'>('all')
  const [n, setN] = useState(50)
  const shown = items.filter((i) => kind === 'all' || i.kind === kind)
  const code = (id?: string) => (id ? s.projects.find((p) => p.id === id)?.code ?? id : '—')
  return (
    <Panel title="Reconciling rows" subtitle={items.length ? 'The SAP rows behind each difference: in SAP but not posted, posted but no longer in SAP, or posted somewhere other than the mapping table says' : 'Every SAP row matches a posted Crosswalk transaction that landed where the mapping table says'} pad={false}
      actions={items.length > 0 ? <div className="scroll-x max-w-full"><SegButtons value={kind} onChange={setKind} options={[{ id: 'all' as const, label: `All ${items.length}` }, ...(['sap-only', 'crosswalk-only', 'mapped-differently'] as const).filter((k) => items.some((i) => i.kind === k)).map((k) => ({ id: k, label: RECON_ITEM_LABEL[k] }))]} /></div> : undefined}>
      {shown.length ? (
        <div className="scroll-x">
          <table className="tbl [&_td]:py-1">
            <thead><tr><th>Row</th><th>Doc · WBS</th><th>Cost element</th><th className="hidden sm:table-cell">Vendor · text</th><th className="num">Amount</th><th className="num">Effect</th><th>Why</th></tr></thead>
            <tbody>
              {shown.slice(0, n).map((it) => (
                <tr key={it.id}>
                  <td className="whitespace-nowrap"><Badge tone={KIND_TONE[it.kind]}>{RECON_ITEM_LABEL[it.kind]}</Badge><div className="text-[10.5px] text-faint">{fmtMonth(it.period)}</div></td>
                  <td className="whitespace-nowrap"><div className="font-mono text-[11.5px]">{it.row.docNo || '—'}</div><div className="font-mono text-[10.5px] text-faint">{it.row.sapWbs}</div></td>
                  <td className="whitespace-nowrap"><span className="font-mono text-[11.5px]">{it.row.costElement}</span><div className="max-w-[160px] truncate text-[10.5px] text-faint" title={it.row.costElementName}>{it.row.costElementName}</div></td>
                  <td className="hidden max-w-[220px] sm:table-cell"><div className="truncate">{it.row.vendor || <span className="text-faint">Internal</span>}</div><div className="truncate text-[11px] text-muted" title={it.row.text}>{it.row.text}</div></td>
                  <td className={cx('num whitespace-nowrap', it.row.amount < 0 && 'text-bad')}>{$(it.row.amount)}</td>
                  <td className="num whitespace-nowrap text-[11.5px]">{Object.entries(it.effect).filter(([, v]) => v).map(([p, v]) => <div key={p}><span className="font-mono text-faint">{code(p)}</span> {signed(Math.round(v))}</div>)}{!Object.values(it.effect).some(Boolean) && <span className="text-faint">lines only</span>}</td>
                  <td className="min-w-[200px] max-w-[340px] text-[11.5px] text-muted"><div className="line-clamp-3" title={it.note}>{it.note}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > n && <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-muted">Showing {n} of {shown.length}<Button size="sm" variant="ghost" onClick={() => setN(n + 100)}>Show 100 more</Button></div>}
        </div>
      ) : <div className="p-4"><Empty title="No reconciling rows" /></div>}
    </Panel>
  )
}

/** SAP rows with where the current mapping table sends each one. */
function RowsTable({ s, rows }: { s: AppState; rows: SapRow[] }) {
  const [n, setN] = useState(100)
  return (
    <div className="scroll-x">
      <table className="tbl [&_td]:py-1">
        <thead><tr><th>Doc no.</th><th>Posted</th><th>WBS</th><th>Cost element</th><th className="hidden sm:table-cell">Vendor · text</th><th className="num">Amount</th><th>Mapping table</th></tr></thead>
        <tbody>
          {rows.slice(0, n).map((r, i) => {
            const l = ruleLanding(s, r)
            const line = lineById(s, l.lineId)
            return (
              <tr key={`${r.docNo}-${i}`}>
                <td className="whitespace-nowrap font-mono text-[11.5px]">{r.docNo || '—'}{r.refDoc && <div className="text-[10.5px] text-faint">ref {r.refDoc}</div>}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(r.postingDate)}</td>
                <td className="whitespace-nowrap font-mono text-[11.5px]">{r.sapWbs}</td>
                <td className="whitespace-nowrap"><span className="font-mono text-[11.5px]">{r.costElement}</span><div className="max-w-[160px] truncate text-[10.5px] text-faint" title={r.costElementName}>{r.costElementName}</div></td>
                <td className="hidden max-w-[220px] sm:table-cell"><div className="truncate">{r.vendor || <span className="text-faint">Internal</span>}</div><div className="truncate text-[11px] text-muted" title={r.text}>{r.text}</div></td>
                <td className={cx('num whitespace-nowrap', r.amount < 0 && 'text-bad')}>{$(r.amount)}</td>
                <td className="whitespace-nowrap text-[11.5px]"><Badge tone={TXN_STATUS[l.status].tone}>{TXN_STATUS[l.status].label}</Badge>{line && <span className="ml-1 text-muted">{line.code}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > n && <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-muted">Showing {n} of {rows.length}<Button size="sm" variant="ghost" onClick={() => setN(n + 200)}>Show 200 more</Button></div>}
    </div>
  )
}

type DTab = 'lines' | 'functions' | 'ce' | 'items' | 'rows'
function ProjectDrawer({ s, rec, pid, rows, items, source, onClose }: { s: AppState; rec?: ReconProject; pid: string; rows: SapRow[]; items: ReconItem[]; source: string; onClose: () => void }) {
  const p = s.projects.find((x) => x.id === pid)
  const [period, setPeriod] = useState(rec?.periods[rec.periods.length - 1]?.period ?? '')
  const pp: ReconPeriod | undefined = rec?.periods.find((x) => x.period === period) ?? rec?.periods[0]
  const [tab, setTab] = useState<DTab>('lines')
  const myItems = items.filter((it) => it.period === pp?.period && (pid in it.effect || it.sap?.projectId === pid || it.cw?.projectId === pid))
  const myRows = pp ? rows.filter((r) => r.period === pp.period && ruleLanding(s, r).projectId === pid) : []
  const lineName = (k: string) => (k === UNPLACED ? <span className="text-bad">No mapping rule (unplaced)</span> : <><span className="font-mono text-[11px] text-faint">{lineById(s, k)?.code}</span> {lineById(s, k)?.name ?? k}</>)
  const fnName = (k: string) => { if (k === UNPLACED) return <span className="text-bad">No mapping rule (unplaced)</span>; const f = s.settings.wbsFunctions.find((x) => x.id === k); return <><span className="font-mono text-[11px] text-faint">{f?.code}</span> {f?.name ?? k}</> }
  return (
    <Drawer open onClose={onClose} width={920} title={<span>{`Reconciliation · ${p?.code ?? pid}`}</span>}
      footer={<><a href={projectHref(pid, 'forecast')} className="mr-auto self-center text-[12.5px] font-semibold text-link hover:underline">Open forecast</a><Button onClick={onClose}>Close</Button></>}>
      {!rec || !pp ? <Empty title="Not in this extract">{p?.code} has no rows in {source} for the chosen period.</Empty> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-semibold">{p?.name}</span>
            <span className="font-mono text-[11.5px] text-faint">{p?.erpWbs}</span>
            {rec.periods.length > 1 && <span className="ml-auto"><SegButtons value={pp.period} onChange={setPeriod} options={rec.periods.map((x) => ({ id: x.period, label: fmtMonth(x.period) }))} /></span>}
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
            <Cell label="SAP rows" value={$(pp.sap.gross)} sub={`${pp.sap.rows} rows · ${fmtMonth(pp.period)}`} />
            <Cell label="Excluded by rule" value={$(pp.sap.excluded)} sub={pp.sap.unplaced ? `${$(pp.sap.unplaced)} has no rule` : undefined} />
            <Cell label="SAP project cost" value={$(pp.sap.cost)} />
            <Cell label="Crosswalk posted" value={pp.posted === undefined ? '—' : $(pp.posted)} sub={pp.posted === undefined ? 'no cost period' : pp.source === 'sap' ? 'from SAP line items' : 'summary actuals'} />
            <Cell label="Difference" value={signed(pp.diff)} sub="posted − SAP" tone={Math.abs(pp.diff) > RECON_TOLERANCE ? 'bad' : undefined} />
            <Cell label="Explained by rows" value={signed(pp.explained)} sub={`${signed(pp.diff - pp.explained)} unexplained`} />
            <Cell label="Forecast" value={pp.forecast.inActuals ? $(pp.forecast.actual ?? 0) : pp.forecast.etc !== undefined ? $(pp.forecast.etc) : '—'} sub={pp.forecast.inActuals ? `as actuals (thru ${fmtMonth(pp.forecast.cutoff!)})` : pp.forecast.cutoff ? `still ETC — actuals thru ${fmtMonth(pp.forecast.cutoff)}` : 'no forecast'} />
            <div className="flex min-w-0 flex-col justify-center bg-surface px-3 py-2"><div className="eyebrow">Status</div><div><ReconBadge status={pp.status} diff={pp.diff} /></div></div>
          </div>
          <StatusNote pp={pp} />
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'lines', label: 'By line', count: pp.lines.filter((l) => l.diff).length || undefined },
            { id: 'functions', label: 'By function' },
            { id: 'ce', label: 'By cost element', count: pp.costElements.length },
            { id: 'items', label: 'Reconciling rows', count: myItems.length },
            { id: 'rows', label: 'SAP rows', count: myRows.length },
          ]} />
          {tab === 'lines' && <CompareTable rows={pp.lines} name={lineName} what="Forecast line" />}
          {tab === 'functions' && <CompareTable rows={pp.functions} name={fnName} what="WBS function" />}
          {tab === 'ce' && (
            <div className="scroll-x rounded-md border border-line">
              <table className="tbl [&_td]:py-1">
                <thead><tr><th>Cost element</th><th className="num">SAP</th><th className="num">Excluded</th><th className="num">Posted</th><th className="num">Difference</th></tr></thead>
                <tbody>
                  {pp.costElements.map((c) => (
                    <tr key={c.costElement}>
                      <td><span className="font-mono text-[11.5px]">{c.costElement}</span> <span className="text-[11.5px] text-muted">{c.name}</span></td>
                      <td className="num">{$(c.sap)}</td><td className="num text-muted">{c.excluded ? $(c.excluded) : '–'}</td>
                      <td className="num">{c.posted === undefined ? <span className="text-faint" title="Crosswalk holds summary actuals for this month — no SAP line items to compare">n/a</span> : $(c.posted)}</td>
                      <td className={cx('num', c.diff && Math.abs(c.diff) >= 0.5 ? 'font-semibold text-bad' : 'text-faint')}>{c.diff === undefined ? '' : Math.abs(c.diff) >= 0.5 ? signed(c.diff) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'items' && (myItems.length ? <div className="rounded-md border border-line"><Items s={s} items={myItems} /></div> : <Empty title="No reconciling rows">Every SAP row for {fmtMonth(pp.period)} matches a posted transaction that landed where the mapping table says.</Empty>)}
          {tab === 'rows' && <div className="rounded-md border border-line"><RowsTable s={s} rows={myRows} /></div>}
        </div>
      )}
    </Drawer>
  )
}

function StatusNote({ pp }: { pp: ReconPeriod }) {
  const un = pp.diff - pp.explained
  if (pp.status === 'ties') return <Callout tone="good">Crosswalk’s {fmtMonth(pp.period)} actuals tie to SAP in total and on every forecast line.</Callout>
  if (pp.status === 'not-posted') return <Callout tone="warn" title="Not posted">Crosswalk has no actuals for {fmtMonth(pp.period)} on this project. Post the extract to bring them in.</Callout>
  if (pp.status === 'lines-differ') return <Callout tone="warn" title="Total ties, lines differ">The total agrees with SAP, but some cost sits on different forecast lines than the mapping table sends it — usually a hand resolution. See Reconciling rows.</Callout>
  return (
    <Callout tone="bad" title={`Crosswalk ${pp.diff > 0 ? 'is higher' : 'is lower'} than SAP by ${$(Math.abs(pp.diff))}`}>
      {pp.source === 'summary' ? 'Crosswalk holds monthly summary actuals for this month, not SAP line items; posting the extract replaces them.' : Math.abs(un) <= RECON_TOLERANCE ? 'Every dollar of the gap is explained by the reconciling rows below.' : `${$(Math.abs(un))} is not explained by row-level matching — check for edits to the cost period outside an SAP import.`}
    </Callout>
  )
}

function CompareTable({ rows, name, what }: { rows: { key: string; sap: number; posted: number; diff: number }[]; name: (k: string) => React.ReactNode; what: string }) {
  return (
    <div className="scroll-x rounded-md border border-line">
      <table className="tbl [&_td]:py-1">
        <thead><tr><th>{what}</th><th className="num">SAP</th><th className="num">Posted</th><th className="num">Difference</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="min-w-[160px]">{name(r.key)}</td>
              <td className="num">{$(r.sap)}</td><td className="num">{$(r.posted)}</td>
              <td className={cx('num', Math.abs(r.diff) > RECON_TOLERANCE ? 'font-semibold text-bad' : 'text-faint')}>{r.diff ? signed(r.diff) : '–'}</td>
            </tr>
          ))}
          <tr className="bg-sunken font-bold"><td>Total</td><td className="num">{$(sum(rows.map((r) => r.sap)))}</td><td className="num">{$(sum(rows.map((r) => r.posted)))}</td><td className="num">{signed(sum(rows.map((r) => r.diff)))}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return <div className="min-w-0 bg-surface px-3 py-2"><div className="eyebrow truncate">{label}</div><div className={cx('truncate font-semibold tabular-nums', tone === 'bad' && 'text-bad')}>{value}</div>{sub && <div className="truncate text-[11px] text-faint" title={sub}>{sub}</div>}</div>
}
