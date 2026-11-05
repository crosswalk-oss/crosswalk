// SAP actuals: import an SAP actual-cost extract (CJI3 / KSB1 / ACDOCA export), run it through the mapping table to
// forecast line items, let project controls resolve the exceptions, then post it to project actuals. Posted imports
// stay drillable to the line item; the forecast grid's actual cells drill back here.
import React, { useMemo, useState } from 'react'
import type { ActualsImport, ActualTxn, AppState, TxnStatus } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { discardImport, parseSapExtract, postImport, remap, resolveTxn, stageImport, type SapColumn, type SapRow } from '@/core/engine/sap'
import { FICTIONAL_SAMPLE_FILE } from '@/core/engine/sapSample'
import { forecastLines, lineById } from '@/core/engine/lines'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, fmtDateTime, fmtMonth, money, sum } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Empty, Field, Input, Modal, PageHeader, Panel, SegButtons, Select, Stat, StatusBadge, Table, Tabs, TextArea, type Column } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { FileButton, lsGet, lsSet } from '../admin/common'
import { useUploadsLocked } from '../shared/SyncUi'
import { TxnTable } from './Drill'
import Reconciliation, { SAMPLE_CSV, SAMPLE_SOURCE, takeReconHandoff } from './Reconcile'
import { exceptionReason, importFigures, importTxns, isException, projectLineRollup, ruleLabel, testRow, TXN_STATUS, type ProjectRoll } from './lib'

const $ = (n: number) => money(n, 'full')
const IMP_TONE: Record<ActualsImport['status'], string> = { staged: 'in-review', posted: 'approved', discarded: 'cancelled' }
const IMP_LABEL: Record<ActualsImport['status'], string> = { staged: 'Staged', posted: 'Posted', discarded: 'Discarded' }

type PageTab = 'imports' | 'recon'

export default function Actuals(props: { projectId?: string }) {
  const uploadsLocked = useUploadsLocked()
  const s = useStore()
  const me = useMe()
  const [handoff] = useState(() => takeReconHandoff())
  const [page, setPageState] = useState<PageTab>(() => (props.projectId || handoff ? 'recon' : lsGet<PageTab>('crosswalk:actuals-tab', 'imports') === 'recon' ? 'recon' : 'imports'))
  const setPage = (t: PageTab) => { setPageState(t); lsSet('crosswalk:actuals-tab', t) }
  const [reconSource, setReconSource] = useState(handoff?.source ?? SAMPLE_SOURCE)
  const reconcileImport = (id: string) => { setReconSource(id); setPage('recon'); document.getElementById('main')?.scrollTo?.({ top: 0, behavior: 'smooth' }) }
  const imports = useMemo(() => [...s.actualsImports].sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [s.actualsImports])
  const staged = imports.filter((x) => x.status === 'staged')
  const [selId, setSelId] = useState<string | undefined>(() => (staged[0] ?? imports[0])?.id)
  const sel = imports.find((x) => x.id === selId) ?? staged[0] ?? imports[0]
  const [upload, setUpload] = useState<{ name: string; text: string } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const canPost = me.roles.some((r) => ['admin', 'pmo', 'project-controls', 'finance'].includes(r))
  const posted = imports.filter((x) => x.status === 'posted')
  const lastPosted = posted[0]
  const openExceptions = s.actualTxns.filter((t) => staged.some((x) => x.id === t.importId) && isException(t)).length

  const onFile = (f: File) => {
    const rd = new FileReader()
    rd.onload = () => setUpload({ name: f.name, text: String(rd.result ?? '') })
    rd.onerror = () => toast(`Could not read ${f.name}`, 'bad')
    rd.readAsText(f)
  }
  const loadSample = () => setUpload({ name: FICTIONAL_SAMPLE_FILE, text: SAMPLE_CSV })
  const stage = (rows: SapRow[], name: string) => {
    let id = ''
    mutate((d) => { id = stageImport(d, rows, name, me.id).id })
    setSelId(id)
    setUpload(null)
    setPasteOpen(false)
    const t = useStore.getState().actualTxns.filter((x) => x.importId === id)
    const ex = t.filter(isException).length
    toast(ex ? `Staged ${rows.length} rows · ${ex} exception${ex === 1 ? '' : 's'} to resolve` : `Staged ${rows.length} rows · all mapped`, ex ? 'info' : 'good')
  }

  const cols: Column<ActualsImport>[] = [
    { key: 'file', header: 'Extract', sort: (r) => r.fileName, render: (r) => <div className="min-w-0"><div className="flex items-center gap-1.5"><Icon name="doc" className="h-3.5 w-3.5 shrink-0 text-faint" /><span className="truncate font-mono text-[12px] font-semibold">{r.fileName}</span></div>{r.note && <div className="truncate text-[11.5px] text-muted">{r.note}</div>}</div> },
    { key: 'period', header: 'Period', sort: (r) => r.period, render: (r) => <span className="whitespace-nowrap">{fmtMonth(r.period)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, render: (r) => <StatusBadge status={IMP_TONE[r.status]} label={IMP_LABEL[r.status]} /> },
    { key: 'when', header: 'Imported', sort: (r) => r.importedAt, render: (r) => <div className="whitespace-nowrap text-[12px]"><div>{fmtDateTime(r.importedAt)}</div><div className="text-muted">{personName(s, r.byId)}</div></div> },
    { key: 'rows', header: 'Rows', num: true, sort: (r) => r.rows, render: (r) => r.rows.toLocaleString('en-US') },
    { key: 'total', header: 'Total', num: true, sort: (r) => r.total, render: (r) => money(r.total) },
    { key: 'mapped', header: 'To lines', num: true, sort: (r) => r.mapped, render: (r) => money(r.mapped) },
    { key: 'excl', header: 'Excluded', num: true, render: (r) => r.excluded ? <span className="text-muted">{money(r.excluded)}</span> : <span className="text-faint">–</span> },
    { key: 'ex', header: 'Exceptions', num: true, render: (r) => { const n = r.status === 'staged' ? s.actualTxns.filter((t) => t.importId === r.id && isException(t)).length : 0; return n ? <Badge tone="bad">{n}</Badge> : <span className="text-faint">–</span> } },
    { key: 'proj', header: 'Projects', num: true, render: (r) => r.projectIds.length },
  ]

  return (
    <div>
      <PageHeader eyebrow="Cost control" title="SAP actuals"
        subtitle={`Actual cost arrives from SAP as line items by WBS element and cost element. The mapping table translates each row to a forecast line item, project controls resolves what doesn’t map, and posting rebuilds each project-period’s actuals by line — the actuals every forecast and EAC is built on.`}
        actions={<>
          {!uploadsLocked && <FileButton label={<><Icon name="download" className="h-3.5 w-3.5 rotate-180" />Upload extract</>} accept=".csv,.txt,.tsv,text/csv,text/plain" onFile={onFile} variant="primary" />}
          {!uploadsLocked && <Button size="sm" onClick={() => setPasteOpen(true)}>Paste rows</Button>}
          <Button size="sm" variant="ghost" onClick={loadSample} title={`Bundled with the demo: samples/${FICTIONAL_SAMPLE_FILE}`}>Load the fictional sample file</Button>
        </>} />

      <FictionalOnly />

      <Tabs className="mb-4" value={page} onChange={setPage} tabs={[
        { id: 'imports', label: 'Imports & exceptions', count: staged.length || undefined },
        { id: 'recon', label: 'Reconciliation' },
      ]} />

      {page === 'recon' ? <Reconciliation s={s} source={reconSource} onSource={setReconSource} projectId={props.projectId ?? handoff?.projectId} /> : <>
      <HowItWorks s={s} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Staged extracts" value={staged.length} tone={staged.length ? 'warn' : undefined} sub={staged.length ? 'Waiting to be posted' : 'Nothing waiting'} onClick={staged[0] ? () => setSelId(staged[0].id) : undefined} />
        <Stat label="Open exceptions" value={openExceptions} tone={openExceptions ? 'bad' : 'good'} sub={openExceptions ? 'Block posting until resolved' : 'All rows map'} />
        <Stat label="Posted through" value={lastPosted ? fmtMonth([...posted].sort((a, b) => b.period.localeCompare(a.period))[0].period) : '—'} sub={lastPosted ? `last posted ${fmtDate(lastPosted.postedAt?.slice(0, 10))}` : 'No posted extracts'} />
        <Stat label="Mapping rules" value={s.settings.sapMappings.filter((r) => r.active).length} sub={<a href="#admin" onClick={() => lsSet('crosswalk:admin-tab', 'sap')} className="text-link hover:underline">{forecastLines(s).length} forecast lines · edit in Configuration</a>} />
      </div>

      {sel ? <ImportReview key={sel.id} s={s} imp={sel} canPost={canPost} onReconcile={() => reconcileImport(sel.id)} /> : <Panel title="No extracts yet"><Empty title="Load an extract">Load the fictional sample file, or paste or upload rows you made up in the same column layout (CSV or tab-delimited text).</Empty></Panel>}

      <Panel className="mt-4" title="Import history" subtitle={`${imports.length} extracts · click one to review it`} pad={false}>
        <Table rows={imports} rowKey={(r) => r.id} columns={cols} dense onRowClick={(r) => { setSelId(r.id); document.getElementById('main')?.scrollTo?.({ top: 0, behavior: 'smooth' }) }} empty={<div className="p-4"><Empty title="No imports yet" /></div>} />
      </Panel>
      </>}

      {upload && <StageModal s={s} name={upload.name} text={upload.text} onClose={() => setUpload(null)} onStage={stage} />}
      {pasteOpen && <PasteModal s={s} onClose={() => setPasteOpen(false)} onStage={stage} />}
    </div>
  )
}

/** The public demo takes fictional data only (AGENT_RULES §1 and §8). */
function FictionalOnly() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/[0.06] px-3 py-2 text-[12.5px]" role="note">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div><b>Fictional data only.</b> This public demo may only load the bundled fictional sample ({FICTIONAL_SAMPLE_FILE}) or rows you made up. Never upload or paste a real SAP extract, real cost-element or vendor mapping, or anything Confidential. This demo is not approved for company data.</div>
    </div>
  )
}

// ───────────────────────────── How it works
function HowItWorks({ s }: { s: AppState }) {
  const steps: [string, string][] = [
    ['SAP extract', 'Actual-cost line items (CJI3 / KSB1 / ACDOCA) with WBS element, cost element, period, amount, vendor and document number.'],
    ['Project by WBS', `The WBS element finds the project: its ERP WBS (C.PSE.1042) or any child element (C.PSE.1042.02).`],
    ['Mapping table', `${s.settings.sapMappings.filter((r) => r.active).length} rules run in priority order — cost-element range, optional WBS suffix and text. First match wins.`],
    ['Forecast line', 'Each row lands on one line item, which rolls up to one WBS function (CBS Level 3, 100–999). Overhead and AFUDC settlements land on 900 Project Overhead; balance-sheet rows are excluded.'],
    ['Post', 'Exceptions must be resolved first. Posting replaces each project-period’s actuals by line, so the forecast’s actual months and EAC update.'],
  ]
  return (
    <ol className="mb-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-5" aria-label="How SAP rows become forecast line actuals">
      {steps.map(([t, d], i) => (
        <li key={t} className="flex min-w-0 gap-2.5 bg-surface px-3 py-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-steel font-mono text-[11px] font-semibold text-steelink">{i + 1}</span>
          <div className="min-w-0"><div className="text-[12.5px] font-semibold">{t}</div><div className="text-[11.5px] leading-snug text-muted">{d}</div></div>
        </li>
      ))}
    </ol>
  )
}

// ───────────────────────────── Stage (upload / paste preview)
function StageModal({ s, name, text, onClose, onStage }: { s: AppState; name: string; text: string; onClose: () => void; onStage: (rows: SapRow[], name: string) => void }) {
  const [fileName, setFileName] = useState(name)
  const parsed = useMemo(() => parseSapExtract(text, s.settings.asOf.slice(0, 7)), [text, s.settings.asOf])
  const total = sum(parsed.rows.map((r) => r.amount))
  const periods = [...new Set(parsed.rows.map((r) => r.period))].sort()
  const wbs = new Set(parsed.rows.map((r) => r.sapWbs)).size
  const dup = s.actualsImports.find((x) => x.fileName === fileName && x.status !== 'discarded')
  return (
    <Modal open wide onClose={onClose} title="Stage SAP extract"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!parsed.rows.length} onClick={() => onStage(parsed.rows, fileName.trim() || name)}>Stage {parsed.rows.length.toLocaleString('en-US')} rows</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Extract name"><Input value={fileName} onChange={(e) => setFileName(e.target.value)} /></Field>
        {name !== FICTIONAL_SAMPLE_FILE && <Callout tone="warn">Fictional data only: confirm this file is made up. Real SAP extracts may not be loaded into the public demo.</Callout>}
        {dup && <Callout tone="warn">An extract named {dup.fileName} was already {dup.status} on {fmtDate(dup.importedAt.slice(0, 10))}. Posting this one replaces the actuals for every project-period it contains.</Callout>}
        {parsed.errors.length > 0 && <Callout tone={parsed.rows.length ? 'warn' : 'bad'} title={parsed.rows.length ? `${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} skipped` : 'This file can’t be read as an SAP extract'}><ul className="list-disc pl-4">{parsed.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>{parsed.errors.length > 6 && <div className="text-faint">…and {parsed.errors.length - 6} more</div>}</Callout>}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
          {[['Rows', parsed.rows.length.toLocaleString('en-US')], ['Total', $(total)], ['Periods', periods.map(fmtMonth).join(', ') || '—'], ['WBS elements', String(wbs)]].map(([k, v]) => <div key={k} className="min-w-0 bg-surface px-3 py-2"><div className="eyebrow">{k}</div><div className="truncate font-semibold tabular-nums">{v}</div></div>)}
        </div>
        <div>
          <div className="eyebrow mb-1">Columns recognised</div>
          <div className="flex flex-wrap gap-1">
            {(['sapWbs', 'costElement', 'costElementName', 'fiscalYear', 'period', 'postingDate', 'amount', 'currency', 'vendor', 'docNo', 'refDoc', 'poNumber', 'text'] as const).map((k) => (
              <Badge key={k} tone={parsed.columns[k] ? 'good' : ['sapWbs', 'costElement', 'amount'].includes(k) ? 'bad' : 'neutral'} title={parsed.columns[k] ? `Read from “${parsed.columns[k]}”` : 'Not in the file'}>{COL_LABEL[k]}{parsed.columns[k] ? ` ← ${parsed.columns[k]}` : ' —'}</Badge>
            ))}
          </div>
        </div>
        {parsed.rows.length > 0 && (
          <div className="scroll-x max-h-[240px] overflow-y-auto rounded border border-line">
            <table className="tbl [&_td]:py-1">
              <thead><tr><th>WBS element</th><th>Cost element</th><th>Period</th><th>Posted</th><th className="num">Amount</th><th>Vendor · text</th></tr></thead>
              <tbody>{parsed.rows.slice(0, 12).map((r, i) => <tr key={i}><td className="font-mono text-[11.5px]">{r.sapWbs}</td><td><span className="font-mono text-[11.5px]">{r.costElement}</span> <span className="text-[11px] text-faint">{r.costElementName}</span></td><td>{r.period}</td><td>{r.postingDate}</td><td className="num">{$(r.amount)}</td><td className="max-w-[240px] truncate text-muted">{[r.vendor, r.text].filter(Boolean).join(' · ')}</td></tr>)}</tbody>
            </table>
            {parsed.rows.length > 12 && <div className="border-t border-line px-3 py-1.5 text-[11.5px] text-faint">First 12 of {parsed.rows.length} rows</div>}
          </div>
        )}
        <p className="text-[12px] text-muted">Staging runs every row through the mapping table. Nothing reaches project actuals until you post.</p>
      </div>
    </Modal>
  )
}
const COL_LABEL: Record<SapColumn, string> = { sapWbs: 'WBS element', costElement: 'Cost element', costElementName: 'Cost element name', fiscalYear: 'Fiscal year', period: 'Period', postingDate: 'Posting date', amount: 'Amount', currency: 'Currency', vendor: 'Vendor', docNo: 'Document', refDoc: 'Reference', poNumber: 'Purchasing doc.', text: 'Text' }

function PasteModal({ s, onClose, onStage }: { s: AppState; onClose: () => void; onStage: (rows: SapRow[], name: string) => void }) {
  const [text, setText] = useState('')
  const [next, setNext] = useState<string | null>(null)
  if (next !== null) return <StageModal s={s} name={`Pasted ${fmtDate(s.settings.asOf)}`} text={next} onClose={onClose} onStage={onStage} />
  return (
    <Modal open wide onClose={onClose} title="Paste SAP rows"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!text.trim()} onClick={() => setNext(text)}>Read rows</Button></>}>
      <div className="flex flex-col gap-2">
        <Callout tone="warn">Fictional data only — paste rows you made up, never rows copied from a real SAP system.</Callout>
        <p className="text-[12.5px] text-muted">Paste rows with the header row. Tab-, comma- or semicolon-delimited text works; columns are matched by name (WBS Element, Cost Element, Fiscal Year + Period, Posting Date, Value in Obj. Currency, Name, Document Number, Text).</p>
        <TextArea rows={12} className="font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'WBS Element\tCost Element\tFiscal Period\tPosting Date\tAmount\tVendor\tText\nC.PSE.1001\t5200110\t2026/010\t10/14/2026\t125000.00\tKestrel Ridge Pipeline Co.\tPay app 6'} />
      </div>
    </Modal>
  )
}

// ───────────────────────────── Review one import
type RTab = 'exceptions' | 'rollup' | 'txns'

function ImportReview({ s, imp, canPost, onReconcile }: { s: AppState; imp: ActualsImport; canPost: boolean; onReconcile: () => void }) {
  const me = useMe()
  const txns = useMemo(() => importTxns(s, imp.id), [s.actualTxns, imp.id])
  const F = importFigures(txns)
  const ex = txns.filter(isException)
  const review = txns.filter((t) => !isException(t) && (t.manual || t.status === 'excluded' || t.amount < 0))
  const [tab, setTab] = useState<RTab>(imp.status === 'staged' && (ex.length || review.length) ? 'exceptions' : 'rollup')
  const [blocked, setBlocked] = useState<string | null>(null)
  const staged = imp.status === 'staged'

  const rerun = () => {
    const before = ex.length
    mutate((d) => remap(d, imp.id), { entity: 'actuals-import', entityId: imp.id, action: 'remap', summary: `Re-ran the SAP mapping table over ${imp.fileName}` })
    const after = useStore.getState().actualTxns.filter((t) => t.importId === imp.id && isException(t)).length
    toast(after < before ? `Mapping re-run · ${before - after} exception${before - after === 1 ? '' : 's'} cleared` : 'Mapping re-run · no change', after < before ? 'good' : 'info')
  }
  const post = () => {
    let res: ReturnType<typeof postImport> = { ok: false, periods: 0 }
    mutate((d) => { res = postImport(d, imp.id, me.id) })
    if (!res.ok) { setBlocked(res.reason ?? 'Posting is blocked'); setTab('exceptions'); toast(`Not posted: ${res.reason}`, 'bad'); return }
    setBlocked(null)
    toast(`Posted to ${res.periods} project-period${res.periods === 1 ? '' : 's'} — forecast actuals updated`)
  }
  const discard = () => { mutate((d) => discardImport(d, imp.id, me.id)); toast('Extract discarded', 'info') }
  const exportCsv = async () => {
    const rows = txns.map((t) => ({ 'Document': t.docNo, 'Posting date': t.postingDate, Period: t.period, Project: s.projects.find((p) => p.id === t.projectId)?.code ?? '', 'WBS element': t.sapWbs, 'Cost element': t.costElement, 'Cost element name': t.costElementName, Vendor: t.vendor, Text: t.text, Amount: t.amount, Status: TXN_STATUS[t.status].label, Line: lineById(s, t.lineId)?.code ?? '', Rule: s.settings.sapMappings.find((r) => r.id === t.ruleId)?.priority ?? '', Manual: t.manual?.note ?? '' }))
    const r = await saveFile(`${imp.fileName.replace(/\.\w+$/, '')}-mapped.csv`, toCSV(rows), 'text/csv')
    if (r === 'saved') toast('Mapped extract exported')
  }

  return (
    <Panel pad={false}>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate font-mono text-[15px] font-semibold">{imp.fileName}</h2>
            <StatusBadge status={IMP_TONE[imp.status]} label={IMP_LABEL[imp.status]} />
            {staged && F.exceptions > 0 && <Badge tone="bad">{F.exceptions} exception{F.exceptions === 1 ? '' : 's'} block posting</Badge>}
            {staged && F.exceptions === 0 && <Badge tone="good">Ready to post</Badge>}
          </div>
          <div className="mt-1 text-[12px] text-muted">
            {imp.source} · {F.periods.map(fmtMonth).join(', ')} · imported {fmtDateTime(imp.importedAt)} by {personName(s, imp.byId)}
            {imp.postedAt && <> · posted {fmtDateTime(imp.postedAt)} by {personName(s, imp.postedById)}</>}
            {imp.note && <> · {imp.note}</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {staged && <Button size="sm" variant="ghost" onClick={rerun} title="Run the current mapping table again; rows resolved by hand are kept">Re-run mapping</Button>}
          {staged && <ConfirmButton size="sm" confirmLabel="Discard extract" onConfirm={discard}>Discard</ConfirmButton>}
          {txns.length > 0 && <Button size="sm" variant="ghost" onClick={exportCsv} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV</Button>}
          {txns.length > 0 && <Button size="sm" variant="ghost" onClick={onReconcile} title="Compare this extract with Crosswalk's posted actuals and the forecast">Reconcile</Button>}
          {staged && <Button size="sm" variant={F.exceptions ? 'secondary' : 'marker'} disabled={!canPost} title={canPost ? undefined : 'Project controls, PMO or finance post actuals'} onClick={post}>Post to project actuals</Button>}
        </div>
      </div>
      {blocked && staged && <div className="px-4 pb-3"><Callout tone="bad" title="Posting is blocked">{blocked}. Map each exception below to a line item, assign a project, or exclude it with a note — then post again.</Callout></div>}
      {imp.status === 'discarded' && <div className="px-4 pb-3"><Callout tone="info">This extract was discarded; its rows were removed and nothing reached project actuals.</Callout></div>}

      <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4 xl:grid-cols-7">
        <Fig label="Rows" value={F.rows.toLocaleString('en-US')} sub={`${F.projects} project${F.projects === 1 ? '' : 's'}`} />
        <Fig label="Total" value={money(F.total)} sub={$(F.total)} />
        <Fig label="Mapped to a line" value={money(F.mapped)} sub={`${txns.filter((t) => t.status === 'mapped').length} rows`} tone="good" />
        <Fig label="Allocated" value={money(F.allocated)} sub="spread pro-rata by rule" />
        <Fig label="Excluded" value={money(F.excluded)} sub={`${txns.filter((t) => t.status === 'excluded').length} rows · not project cost`} />
        <Fig label="Unmapped" value={money(F.unmapped)} sub={`${txns.filter((t) => t.status === 'unmapped').length} rows`} tone={F.unmapped ? 'bad' : undefined} />
        <Fig label="No project" value={money(F.noProject)} sub={`${txns.filter((t) => t.status === 'no-project').length} rows`} tone={F.noProject ? 'bad' : undefined} />
      </div>

      {txns.length === 0 ? <div className="p-4"><Empty title="No rows">{imp.status === 'discarded' ? 'Discarded extracts keep only their summary.' : 'This extract has no rows.'}</Empty></div> : <>
        <Tabs className="px-2 pt-1" value={tab} onChange={setTab} tabs={[
          { id: 'exceptions', label: staged ? 'Exceptions & checks' : 'Resolutions & checks', count: ex.length + review.length },
          { id: 'rollup', label: 'By project & line item', count: F.projects },
          { id: 'txns', label: 'Transactions', count: txns.length },
        ]} />
        <div className="p-3 sm:p-4">
          {tab === 'exceptions' && <Exceptions s={s} imp={imp} ex={ex} review={review} />}
          {tab === 'rollup' && <Rollup s={s} txns={txns} posted={imp.status === 'posted'} />}
          {tab === 'txns' && <Txns s={s} txns={txns} />}
        </div>
      </>}
    </Panel>
  )
}

function Fig({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2.5">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-0.5 font-display text-[19px] font-bold leading-tight tabular-nums', tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {sub && <div className="truncate text-[11.5px] text-muted" title={sub}>{sub}</div>}
    </div>
  )
}

// ───────────────────────────── Exceptions
function Exceptions({ s, imp, ex, review }: { s: AppState; imp: ActualsImport; ex: ActualTxn[]; review: ActualTxn[] }) {
  const staged = imp.status === 'staged'
  return (
    <div className="flex flex-col gap-4">
      {staged && (ex.length
        ? <Callout tone="bad" title={`${ex.length} row${ex.length === 1 ? '' : 's'} need project controls`}>Each one blocks posting. Map it to a forecast line, assign the right project, or exclude it — every resolution keeps a note and goes to the audit log. If a whole cost element is missing from the mapping table, add a rule in Configuration → SAP mapping and re-run mapping instead.</Callout>
        : <Callout tone="good" title="No exceptions">Every row maps to a project and a forecast line (or is allocated or excluded by rule). Review the credits and exclusions below, then post.</Callout>)}
      {ex.map((t) => <ExceptionRow key={t.id} s={s} t={t} editable={staged} />)}
      {review.length > 0 && (
        <div>
          <div className="eyebrow mb-1.5">Worth a second look · credits, exclusions and hand resolutions</div>
          <div className="rounded-md border border-line"><TxnTable s={s} txns={review} showProject showStatus /></div>
        </div>
      )}
    </div>
  )
}

function ExceptionRow({ s, t, editable }: { s: AppState; t: ActualTxn; editable: boolean }) {
  const me = useMe()
  const noProject = t.status === 'no-project'
  const [projectId, setProjectId] = useState('')
  const rule = useMemo(() => testRow(s, { costElement: t.costElement, sapWbs: t.sapWbs, text: t.text }), [s, t])
  const [mode, setMode] = useState<'line' | 'rule' | 'exclude'>(noProject && rule.winner ? 'rule' : 'line')
  const [lineId, setLineId] = useState(rule.line?.id ?? '')
  const [note, setNote] = useState('')
  const lines = forecastLines(s)
  const fnCode = (id: string) => s.settings.wbsFunctions.find((f) => f.id === id)?.code ?? ''
  const resolve = () => {
    if (noProject && !projectId) { toast('Choose the project this cost belongs to', 'bad'); return }
    if (mode === 'line' && !lineId) { toast('Choose a forecast line', 'bad'); return }
    if (!note.trim()) { toast('Add a note — why this resolution is right', 'bad'); return }
    const to = mode === 'exclude' ? { exclude: true, projectId: projectId || undefined } : mode === 'rule' ? { projectId } : { lineId, projectId: projectId || undefined }
    const p = s.projects.find((x) => x.id === (projectId || t.projectId))
    const what = mode === 'exclude' ? 'excluded' : mode === 'rule' ? `assigned to ${p?.code} (mapping rule applies)` : `mapped to ${lineById(s, lineId)?.code} ${lineById(s, lineId)?.name}${projectId ? ` on ${p?.code}` : ''}`
    mutate((d) => resolveTxn(d, t.id, to, note.trim(), me.id), { entity: 'actuals-import', entityId: t.importId, projectId: p?.id, action: 'resolve', summary: `SAP doc ${t.docNo} (${t.costElement}, ${$(t.amount)}) ${what}: ${note.trim()}` })
    toast(`Doc ${t.docNo} ${what}`)
  }
  return (
    <div className="rounded-md border border-bad/30 bg-bad/[0.03]">
      <div className="flex flex-col gap-1 border-b border-line px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="bad">{TXN_STATUS[t.status].label}</Badge>
            <span className="font-mono text-[12px] font-semibold">Doc {t.docNo}</span>
            <span className="text-[12px] text-muted">{fmtDate(t.postingDate)} · {fmtMonth(t.period)}</span>
          </div>
          <div className="mt-1 text-[12.5px]">{exceptionReason(s, t)}</div>
        </div>
        <div className={cx('shrink-0 font-display text-[18px] font-bold tabular-nums', t.amount < 0 && 'text-bad')}>{$(t.amount)}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 text-[12px] sm:grid-cols-4">
        <KVs k="WBS element" v={<span className="font-mono">{t.sapWbs}</span>} />
        <KVs k="Cost element" v={<><span className="font-mono">{t.costElement}</span> <span className="text-muted">{t.costElementName}</span></>} />
        <KVs k="Vendor" v={t.vendor || 'Internal'} />
        <KVs k="Text" v={t.text} />
      </div>
      {editable && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {noProject && (
              <Field label="Project" hint={`No project has ERP WBS ${t.sapWbs.split('.').slice(0, 3).join('.')} — pick the one the cost belongs to`}>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} options={[{ value: '', label: '— Select project —' }, ...s.projects.filter((p) => p.status !== 'closed').map((p) => ({ value: p.id, label: `${p.code} · ${p.erpWbs} · ${p.name}` }))]} />
              </Field>
            )}
            <Field label="Resolution">
              <div className="flex flex-col gap-1.5">
                <SegButtons value={mode} onChange={setMode} options={[...(noProject && rule.winner ? [{ id: 'rule' as const, label: 'Use mapping rule' }] : []), { id: 'line' as const, label: 'Map to a line' }, { id: 'exclude' as const, label: 'Exclude' }]} />
                {mode === 'rule' && rule.winner && <span className="text-[11.5px] text-muted">{ruleLabel(s, rule.winner)}</span>}
                {mode === 'line' && <Select aria-label="Forecast line" value={lineId} onChange={(e) => setLineId(e.target.value)} options={[{ value: '', label: '— Select forecast line —' }, ...lines.map((l) => ({ value: l.id, label: `${l.code} ${l.name} (WBS ${fnCode(l.functionId)})` }))]} />}
                {mode === 'exclude' && <span className="text-[11.5px] text-muted">Kept in the import record but out of project actuals.</span>}
              </div>
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Note (required)" className="flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={noProject ? 'e.g. Pay app 7 keyed to the wrong WBS — confirmed with AP' : 'e.g. Field software licenses are project PM cost per the capitalization policy'} /></Field>
            <Button variant="primary" onClick={resolve}>Resolve</Button>
          </div>
        </div>
      )}
    </div>
  )
}
const KVs = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="min-w-0"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className="truncate" title={typeof v === 'string' ? v : undefined}>{v}</div></div>

// ───────────────────────────── By project & line
function Rollup({ s, txns, posted }: { s: AppState; txns: ActualTxn[]; posted: boolean }) {
  const rows = useMemo(() => projectLineRollup(s, txns), [s, txns])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const tot = (k: 'direct' | 'allocated' | 'excluded' | 'exceptions') => sum(rows.map((r) => r[k]))
  const lineRows = (r: ProjectRoll) => Object.entries(r.byLine).map(([lid, v]) => ({ l: lineById(s, lid), lid, ...v })).sort((a, b) => (a.l?.code ?? '').localeCompare(b.l?.code ?? ''))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-muted">{posted ? 'What this extract posted to each project, by forecast line item. Allocated amounts are rows a mapping rule spreads over each period’s direct lines.' : 'What posting will write to each project, by forecast line item. Allocated amounts are previewed the same way posting spreads them: pro-rata to each project-period’s mapped lines.'}</p>
      <div className="scroll-x rounded-md border border-line">
        <table className="tbl">
          <thead><tr><th>Project · line item</th><th className="num">Direct</th><th className="num">Allocated</th><th className="num">To actuals</th><th className="num">Excluded</th><th className="num">Exceptions</th><th className="num">Rows</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.projectId}>
                <tr className="font-semibold">
                  <td className="whitespace-nowrap">
                    <button className="mr-1.5 w-3 text-muted hover:text-ink" onClick={() => toggle(r.projectId)} aria-expanded={open.has(r.projectId)} aria-label="Show lines">{open.has(r.projectId) ? '▾' : '▸'}</button>
                    {r.p ? <><a href={projectHref(r.p.id, 'forecast')} className="font-mono text-[12px] text-link hover:underline">{r.p.code}</a> <span className="font-normal">{r.p.name}</span></> : <span className="text-bad">No project</span>}
                  </td>
                  <td className="num">{money(r.direct)}</td><td className="num">{money(r.allocated)}</td><td className="num">{money(r.direct + r.allocated)}</td>
                  <td className="num text-muted">{r.excluded ? money(r.excluded) : '–'}</td>
                  <td className={cx('num', r.exceptions ? 'text-bad' : 'text-faint')}>{r.exceptions ? money(r.exceptions) : '–'}</td>
                  <td className="num font-normal text-muted">{r.rows}</td>
                </tr>
                {open.has(r.projectId) && lineRows(r).map((x) => (
                  <tr key={x.lid} className="text-[12.5px]">
                    <td className="whitespace-nowrap pl-9 text-muted"><span className="font-mono text-[11px] text-faint">{x.l?.code}</span> {x.l?.name ?? x.lid}</td>
                    <td className="num text-muted">{money(x.direct)}</td><td className="num text-muted">{money(x.allocated)}</td><td className="num">{money(x.direct + x.allocated)}</td><td /><td /><td />
                  </tr>
                ))}
              </React.Fragment>
            ))}
            <tr className="bg-sunken font-bold"><td>Total</td><td className="num">{money(tot('direct'))}</td><td className="num">{money(tot('allocated'))}</td><td className="num">{money(tot('direct') + tot('allocated'))}</td><td className="num">{money(tot('excluded'))}</td><td className="num">{money(tot('exceptions'))}</td><td className="num">{txns.length}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ───────────────────────────── Transactions
function Txns({ s, txns }: { s: AppState; txns: ActualTxn[] }) {
  const [st, setSt] = useState<TxnStatus | ''>('')
  const [pid, setPid] = useState('')
  const [q, setQ] = useState('')
  const projects = [...new Set(txns.map((t) => t.projectId).filter(Boolean) as string[])].map((id) => s.projects.find((p) => p.id === id)!).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code))
  const ql = q.trim().toLowerCase()
  const shown = txns.filter((t) => (!st || t.status === st) && (!pid || t.projectId === pid) && (!ql || [t.docNo, t.costElement, t.costElementName, t.vendor, t.text, t.sapWbs].some((x) => x.toLowerCase().includes(ql))))
  const counts = Object.fromEntries((Object.keys(TXN_STATUS) as TxnStatus[]).map((k) => [k, txns.filter((t) => t.status === k).length]))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" className="h-8 w-auto py-1" value={st} onChange={(e) => setSt(e.target.value as TxnStatus | '')} options={[{ value: '', label: `All statuses (${txns.length})` }, ...(Object.keys(TXN_STATUS) as TxnStatus[]).filter((k) => counts[k]).map((k) => ({ value: k, label: `${TXN_STATUS[k].label} (${counts[k]})` }))]} />
        <Select aria-label="Project" className="h-8 w-auto py-1" value={pid} onChange={(e) => setPid(e.target.value)} options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.code }))]} />
        <Input aria-label="Search" className="h-8 w-full py-1 sm:w-[240px]" placeholder="Doc, cost element, vendor, text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ml-auto text-[12px] text-muted">{shown.length} rows · {$(sum(shown.map((t) => t.amount)))}</span>
      </div>
      <div className="rounded-md border border-line">{shown.length ? <TxnTable key={st + pid + ql} s={s} txns={shown} showProject showStatus limit={100} /> : <div className="p-4"><Empty title="No rows match" /></div>}</div>
    </div>
  )
}
