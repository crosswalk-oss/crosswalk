// Estimating home (#estimating): portfolio estimate register, unit-cost library (ES-03),
// accuracy tracking (ES-13), analog finder (ES-14) and the AACE class reference.
import { prefs } from '@/core/data'
import { useMemo, useState } from 'react'
import type { AaceClass, AppState, AssetType, Project, Terrain, UnitCostRate, WorkMethod } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { CLASS_RANGES, estimateTotals } from '@/core/engine/estimates'
import { stageName } from '@/core/engine/gates'
import { askJSON, aiMessage, useAiAvailable } from '@/core/ai'
import { saveFile, toCSV } from '@/core/download'
import { go, projectHref } from '@/core/router'
import { cx, fmtDate, groupBy, money, pct, sum } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, ClassBadge, Empty, Field, Input, Modal, PageHeader, Panel, SegButtons, Select, Stat, StatusBadge, Table, Tabs, type Column } from '@/ui/kit'
import { RangeBar } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { ProgramSelect, ProgramTag, ProjectSelect } from '../shared/pickers'
import { AccPct, AccuracyStrip, Legend, NumInput, OutcomeBar, SpreadBar, Swatch } from './parts'
import { QuickTab } from './quick/QuickTab'
import { HistoricalCosts } from './quick/Historical'
import { QuickBadge } from './quick/parts'
import { EstimatingAdmin } from './admin/Admin'
import { effectiveByRegion, pricedOnVersion } from '@/core/engine/estimatingAdmin'
import {
  accuracyPoints, analogs, bestCost, catName, directCategories, escalationTo, fmtPerUnit, latestApproved, latestEstimate, perUnitLabel,
  projectEstimates, summarize, unitBasis, type AccuracyPoint,
} from './lib'

type View = 'register' | 'quick' | 'historical' | 'library' | 'accuracy' | 'analogs' | 'admin'
const TAB_KEY = 'crosswalk:estimating:tab'
const ASSET_LABEL: Record<AssetType, string> = { 'transmission-pipeline': 'Transmission pipeline', 'distribution-main': 'Distribution main', 'compressor-station': 'Compressor station', 'valve-site': 'Valve site', 'storage-field': 'Storage field', 'regulator-station': 'Regulator station' }
const METHOD_LABEL: Record<WorkMethod, string> = { 'replace-open-trench': 'Replace, open trench', 'replace-hdd': 'Replace, HDD', hydrotest: 'Hydrotest', abandon: 'Abandon', 'valve-automation': 'Valve automation', 'station-rebuild': 'Station rebuild', 'compressor-replacement': 'Compressor replacement', 'inline-inspection': 'In-line inspection' }

export default function Estimating() {
  const s = useStore()
  const [view, setView] = useState<View>(() => { try { return (prefs.getRaw(TAB_KEY) as View) || 'register' } catch { return 'register' } })
  const pick = (v: View) => { setView(v); try { prefs.setRaw(TAB_KEY, v) } catch { /* storage blocked */ } }
  const latest = s.projects.map((p) => latestEstimate(s, p.id)).filter(Boolean)
  const inReview = s.estimates.filter((e) => e.status === 'in-review')
  const drafts = s.estimates.filter((e) => e.status === 'draft')
  const pts = useMemo(() => accuracyPoints(s), [s])
  const c3 = summarize(pts.filter((x) => x.cls === 3))
  const c5 = summarize(pts.filter((x) => x.cls === 5))
  const reviewValue = sum(inReview.map((e) => estimateTotals(e).total))
  const quickReview = inReview.filter((e) => e.method === 'quick').length
  return (
    <div>
      <PageHeader eyebrow="Controls" title="Estimating" subtitle="Historical quick estimates, Class 5 rate-table and Class 3 line-item estimates, the tables they draw from, and how accurate they turned out to be.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Estimates in review" value={inReview.length} sub={`${money(reviewValue)} awaiting approval`} onClick={() => pick('register')} />
          <Stat label="Drafts in progress" value={drafts.length} sub={`${latest.length} projects estimated`} />
          <Stat label="Class 3 mean accuracy" value={c3.n ? `${c3.mean > 0 ? '+' : ''}${pct(c3.mean, 1)}` : '—'} sub={c3.n ? `${pct(c3.within)} within AACE −20%/+30% · n=${c3.n}` : 'No outcomes yet'} tone={c3.n ? (c3.within >= 0.8 ? 'good' : 'warn') : undefined} onClick={() => pick('accuracy')} />
          <Stat label="Class 5 mean accuracy" value={c5.n ? `${c5.mean > 0 ? '+' : ''}${pct(c5.mean, 1)}` : '—'} sub={c5.n ? `${pct(c5.within)} within AACE −50%/+100% · n=${c5.n}` : 'No outcomes yet'} onClick={() => pick('accuracy')} />
        </div>
      </PageHeader>
      <Tabs<View> className="mb-4" value={view} onChange={pick} tabs={[
        { id: 'register', label: 'Estimate register', count: inReview.length || undefined },
        { id: 'quick', label: 'Quick estimate', count: quickReview || undefined },
        { id: 'historical', label: 'Historical costs', count: s.historicalCosts.filter((h) => h.active).length },
        { id: 'library', label: 'Rate table', count: s.rates.filter((r) => !r.region).length },
        { id: 'accuracy', label: 'Accuracy' },
        { id: 'analogs', label: 'Analog finder' },
        { id: 'admin', label: 'Administration' },
      ]} />
      {view === 'register' && <Register s={s} />}
      {view === 'quick' && <QuickTab />}
      {view === 'historical' && <HistoricalCosts />}
      {view === 'library' && <Library s={s} onAdmin={() => pick('admin')} />}
      {view === 'accuracy' && <Accuracy s={s} pts={pts} />}
      {view === 'analogs' && <Analogs s={s} />}
      {view === 'admin' && <EstimatingAdmin s={s} />}
    </div>
  )
}

// ───────────────────────────── Register
function Register({ s }: { s: AppState }) {
  const [prog, setProg] = useState('')
  const [cls, setCls] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const rows = s.projects.map((p) => {
    const e = latestEstimate(s, p.id)
    const rec = latestApproved(s, p.id)
    const wf = e?.workflowInstanceId ? s.workflows.find((w) => w.id === e.workflowInstanceId && w.status === 'running') : undefined
    const def = wf ? s.workflowDefs.find((d) => d.id === wf.defId) : undefined
    const step = wf?.active[0]
    return { p, e, t: e ? estimateTotals(e) : undefined, rec, recT: rec ? estimateTotals(rec) : undefined, versions: projectEstimates(s, p.id).length, waiting: step ? { label: def?.nodes.find((n) => n.id === step.nodeId)?.label ?? 'Step', who: step.assigneeIds.map((id) => personName(s, id)).join(', '), due: step.due } : undefined }
  }).filter((r) => (!prog || r.p.programId === prog) && (!cls || String(r.e?.cls) === cls) && (!status || r.e?.status === status) && (!q || (r.p.code + ' ' + r.p.name).toLowerCase().includes(q.toLowerCase())))
  const sorted = rows.slice().sort((a, b) => (a.e?.status === 'in-review' ? 0 : 1) - (b.e?.status === 'in-review' ? 0 : 1) || a.p.code.localeCompare(b.p.code))
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'p', header: 'Project', sort: (r) => r.p.code, render: (r) => <div className="flex min-w-[220px] items-start gap-2"><span className={cx('mt-0.5 h-8 w-1 shrink-0 rounded-full', r.e?.status === 'in-review' ? 'bg-marker' : 'bg-transparent')} /><div className="min-w-0"><div className="flex items-center gap-1.5"><ProgramTag programId={r.p.programId} /><a href={projectHref(r.p.id, 'estimates')} onClick={(ev) => ev.stopPropagation()} className="font-mono text-[12px] font-semibold text-link hover:underline">{r.p.code}</a></div><div className="truncate text-[12.5px]">{r.p.name}</div></div></div> },
    { key: 'stage', header: 'Stage', render: (r) => <span className="text-[12px]">{stageName(s, r.p)}{r.p.status !== 'active' && <div><StatusBadge status={r.p.status} /></div>}</span> },
    { key: 'v', header: 'Latest', sort: (r) => r.e?.cls ?? 9, render: (r) => r.e ? <span className="inline-flex flex-wrap items-center gap-1.5"><span className="font-mono text-[12px]">v{r.e.version}</span><ClassBadge cls={r.e.cls} />{r.e.method === 'quick' ? <QuickBadge /> : <span className={cx('text-[11px]', pricedOnVersion(s, r.e) < s.settings.estimating.rateTableVersion ? 'text-warn' : 'text-faint')} title="Rate table version the estimate was priced on">RT v{pricedOnVersion(s, r.e)}</span>}</span> : '—' },
    { key: 'st', header: 'Status', render: (r) => r.e ? <div><StatusBadge status={r.e.status} />{r.waiting && <div className="mt-0.5 text-[11px] text-muted">{r.waiting.label} · {r.waiting.who}{r.waiting.due && <span className={cx(r.waiting.due < s.settings.asOf && 'font-semibold text-bad')}> · due {fmtDate(r.waiting.due)}</span>}</div>}</div> : <Badge>None</Badge> },
    { key: 'tot', header: 'Total', num: true, sort: (r) => r.t?.total ?? 0, render: (r) => r.t ? <b>{money(r.t.total)}</b> : '—' },
    { key: 'rng', header: 'Expected range', width: 200, render: (r) => r.t ? <div className="min-w-[160px]"><RangeBar low={r.t.low} point={r.t.total} high={r.t.high} /><div className="flex justify-between text-[11px] tabular-nums text-faint"><span>{money(r.t.low)}</span><span>{money(r.t.high)}</span></div></div> : null },
    { key: 'rec', header: 'Estimate of record', num: true, sort: (r) => r.recT?.total ?? 0, render: (r) => r.rec && r.rec.id !== r.e?.id ? <span className="text-[12px]">{money(r.recT!.total)} <ClassBadge cls={r.rec.cls} /><div className={cx('text-[11px]', r.t!.total > r.recT!.total ? 'text-bad' : 'text-good')}>{r.t!.total >= r.recT!.total ? '+' : ''}{pct(r.t!.total / r.recT!.total - 1, 1)} in latest</div></span> : r.rec ? <span className="text-[11px] text-faint">Latest</span> : <span className="text-faint">—</span> },
    { key: 'est', header: 'Estimator', render: (r) => <span className="text-[12px]">{personName(s, r.e?.createdById ?? r.p.team.estimator)}</span> },
  ]
  const exportCsv = async () => {
    const data = sorted.map((r) => ({ project: r.p.code, name: r.p.name, program: s.programs.find((x) => x.id === r.p.programId)?.code, stage: stageName(s, r.p), version: r.e?.version ?? '', class: r.e?.cls ?? '', status: r.e?.status ?? '', method: r.e?.method ?? '', total: r.t?.total ?? '', low: r.t?.low ?? '', high: r.t?.high ?? '', estimateOfRecord: r.recT?.total ?? '', estimator: personName(s, r.e?.createdById) }))
    const res = await saveFile(`estimate-register-${s.settings.asOf}.csv`, toCSV(data), 'text/csv')
    if (res === 'saved') { mutate(() => {}, { entity: 'estimate', entityId: 'register', action: 'export', summary: `Exported estimate register (${data.length} projects)` }); toast('Register downloaded') } else toast('Download not available', 'info')
  }
  const byClass = groupBy(rows.filter((r) => r.e), (r) => String(r.e!.cls))
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel pad={false} title="Portfolio estimate register" subtitle={`Latest estimate for each project · ${rows.length} shown · ${Object.entries(byClass).sort().map(([c, v]) => `${v.length} Class ${c}`).join(', ')}`}
        actions={<Button size="sm" onClick={exportCsv}>Export CSV</Button>}>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <Input id="reg-q" className="h-8 w-48" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="w-52"><ProgramSelect id="reg-prog" value={prog} onChange={setProg} /></div>
          <Select id="reg-cls" aria-label="Estimate class" className="h-8 w-36" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: '', label: 'All classes' }, ...[5, 4, 3, 2, 1].map((c) => ({ value: String(c), label: `Class ${c}` }))]} />
          <Select id="reg-status" aria-label="Estimate status" className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, ...['draft', 'in-review', 'approved', 'superseded', 'rejected'].map((x) => ({ value: x, label: x === 'in-review' ? 'In review' : x[0].toUpperCase() + x.slice(1) }))]} />
          {(prog || cls || status || q) && <Button size="sm" variant="ghost" onClick={() => { setProg(''); setCls(''); setStatus(''); setQ('') }}>Clear filters</Button>}
        </div>
        <Table rows={sorted} columns={cols} rowKey={(r) => r.p.id} onRowClick={(r) => { go(projectHref(r.p.id, 'estimates')) }} empty={<div className="p-4"><Empty title="No estimates match">Change or clear the filters.</Empty></div>} />
      </Panel>
      <ClassReference />
    </div>
  )
}

function ClassReference() {
  return (
    <Panel pad={false} title="AACE estimate classes" subtitle="18R-97 indicative ranges used across Crosswalk">
      <table className="tbl">
        <thead><tr><th>Class</th><th>Definition</th><th>Use</th><th className="num">Range</th></tr></thead>
        <tbody>
          {([5, 4, 3, 2, 1] as AaceClass[]).map((c) => (
            <tr key={c}>
              <td><ClassBadge cls={c} /></td>
              <td className="tabular-nums">{CLASS_RANGES[c].definition}</td>
              <td className="text-[12px]">{CLASS_RANGES[c].use}</td>
              <td className="num text-[12px]">{pct(CLASS_RANGES[c].low)}<br />+{pct(CLASS_RANGES[c].high)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2.5 text-[11.5px] text-muted">The class is computed from the estimate's maturity checklist. Gate 1 needs an approved Class 5 (planning budget); the authorization gate needs Class 3 (control budget).</div>
    </Panel>
  )
}

// ───────────────────────────── Rate table, read view (ES-03). Maintained in Administration.
function Library({ s, onAdmin }: { s: AppState; onAdmin: () => void }) {
  const [asset, setAsset] = useState('')
  const [method, setMethod] = useState('')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [normalize, setNormalize] = useState(false)
  const me = useMe()
  const canEdit = me.roles.some((r) => ['estimating-lead', 'estimator', 'admin'].includes(r))
  const year = Number(s.settings.asOf.slice(0, 4))
  const base = s.rates.filter((r) => !r.region)
  const assets = Array.from(new Set(base.map((r) => r.assetType)))
  const methods = Array.from(new Set(base.filter((r) => !asset || r.assetType === asset).map((r) => r.workMethod)))
  const rows = base.filter((r) => (!asset || r.assetType === asset) && (!method || r.workMethod === method) && (!cat || r.categoryId === cat) && (!q || r.description.toLowerCase().includes(q.toLowerCase())))
  const f = (r: UnitCostRate) => (normalize ? 1 + escalationTo(s, r.basisYear, year) / 100 : 1)
  const m = (v: number) => money(v, v < 1e4 ? 'full' : 'compact')
  const usage = useMemo(() => { const u: Record<string, number> = {}; for (const e of s.estimates) for (const l of e.lines) if (l.rateId) u[l.rateId] = (u[l.rateId] || 0) + 1; return u }, [s.estimates])
  const regions = s.settings.estimating.regions
  const cols: Column<UnitCostRate>[] = [
    { key: 'd', header: 'Rate', sort: (r) => r.description, render: (r) => <div className="min-w-[220px]"><div className="text-[12.5px] font-semibold">{r.description}</div><div className="text-[11px] text-faint">{ASSET_LABEL[r.assetType]} · {METHOD_LABEL[r.workMethod]}</div></div> },
    { key: 'c', header: 'Category', sort: (r) => catName(s, r.categoryId), render: (r) => <span className="text-[12px]">{catName(s, r.categoryId)}</span> },
    { key: 'dia', header: 'Dia.', num: true, sort: (r) => r.diameterIn ?? 0, render: (r) => (r.diameterIn ? `${r.diameterIn}"` : '—') },
    { key: 't', header: 'Terrain', render: (r) => <span className="text-[12px] capitalize">{r.terrain ?? 'Any'}</span> },
    { key: 'u', header: 'Unit', render: (r) => r.unit },
    { key: 'p10', header: 'P10', num: true, sort: (r) => r.p10, render: (r) => <span className="text-muted">{m(r.p10 * f(r))}</span> },
    { key: 'p50', header: 'P50 base', num: true, sort: (r) => r.p50, render: (r) => <b>{m(r.p50 * f(r))}</b> },
    { key: 'p90', header: 'P90', num: true, sort: (r) => r.p90, render: (r) => <span className="text-muted">{m(r.p90 * f(r))}</span> },
    { key: 'reg', header: <span title="Effective P50 by region: regional row, else base × factor">By region ({regions.join(' / ')})</span>, render: (r) => { const e = effectiveByRegion(s, r); return <span className="whitespace-nowrap text-[11.5px] tabular-nums text-muted">{regions.map((g, i) => <span key={g} className={cx(e[g].regional && 'font-semibold text-ink')}>{i ? ' / ' : ''}{m(e[g].value * f(r))}</span>)}</span> } },
    { key: 'sp', header: 'Spread', render: (r) => <SpreadBar p10={r.p10} p50={r.p50} p90={r.p90} /> },
    { key: 'n', header: 'n', num: true, sort: (r) => r.sampleSize, render: (r) => <span className={cx(r.sampleSize < 5 && 'font-semibold text-warn')} title={r.sampleSize < 5 ? 'Thin sample: fewer than 5 closed projects' : undefined}>{r.sampleSize}</span> },
    { key: 'y', header: 'Basis', num: true, render: (r) => `${r.basisYear}$` },
    { key: 'use', header: 'Used', num: true, sort: (r) => usage[r.id] ?? 0, render: (r) => <span className="text-muted">{usage[r.id] ?? 0}</span> },
  ]
  return (
    <div className="flex flex-col gap-3">
      <Panel pad={false} title={<span className="inline-flex items-center gap-2">Rate table <Badge tone="ink">v{s.settings.estimating.rateTableVersion}</Badge></span>} subtitle={`${rows.length} of ${base.length} items · P10/P50/P90 from closed projects · estimates price at P50 for the project's region`}
        actions={<>
          <Checkbox checked={normalize} onChange={setNormalize} label={`Show in ${year}$`} />
          <Button size="sm" variant={canEdit ? 'primary' : 'secondary'} onClick={onAdmin}>{canEdit ? 'Edit in Administration' : 'Open Administration'}</Button>
        </>}>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <Input id="lib-q" className="h-8 w-48" placeholder="Search rates" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="lib-asset" className="h-8 w-48" value={asset} onChange={(e) => { setAsset(e.target.value); setMethod('') }} options={[{ value: '', label: 'All asset types' }, ...assets.map((a) => ({ value: a, label: ASSET_LABEL[a] }))]} />
          <Select id="lib-method" className="h-8 w-48" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'All work methods' }, ...methods.map((a) => ({ value: a, label: METHOD_LABEL[a] }))]} />
          <Select id="lib-cat" className="h-8 w-52" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...directCategories(s).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))]} />
        </div>
        <Table rows={rows} columns={cols} rowKey={(r) => r.id} maxHeight={620} dense />
      </Panel>
      <Callout tone="info" title="Normalizing for escalation">
        Rates are stored in their basis-year dollars ({Array.from(new Set(s.rates.map((r) => r.basisYear))).join(', ')}$) and carry no escalation. Estimates escalate the direct-plus-tax-plus-loaders base once, from the basis year to the project's spend midpoint, using the portfolio escalation table ({Object.entries(s.settings.escalationByYear).map(([y, v]) => `${y} ${v}%`).join(' · ')}). Toggle "Show in {year}$" to view rates escalated to today ({escalationTo(s, 2025, year)}% from 2025$). The estimating team maintains the table, its regional rows and every other estimating table under Administration; each publish creates a new rate table version.
      </Callout>
    </div>
  )
}

// ───────────────────────────── Accuracy (ES-13)
function Accuracy({ s, pts: all }: { s: AppState; pts: AccuracyPoint[] }) {
  const [basis, setBasis] = useState<'all' | 'final'>('all')
  const [zoom, setZoom] = useState<'data' | 'aace'>('data')
  const [prog, setProg] = useState('')
  const pts = all.filter((x) => (basis === 'all' || x.basis === 'final') && (!prog || x.programId === prog))
  const classes = ([5, 4, 3, 2, 1] as AaceClass[]).filter((c) => pts.some((x) => x.cls === c))
  const accs = pts.map((x) => x.acc)
  const domain: [number, number] = zoom === 'aace' ? [Math.min(-0.55, ...accs), Math.max(1.05, ...accs)] : [Math.min(-0.25, ...accs.map((a) => a - 0.04)), Math.max(0.35, ...accs.map((a) => a + 0.04))]
  const person = (id: string) => personName(s, id)
  const projects = Array.from(new Set(pts.map((x) => x.projectId))).map((id) => s.projects.find((p) => p.id === id)!).sort((a, b) => a.code.localeCompare(b.code))
  const groupTable = (key: (x: AccuracyPoint) => string, label: (k: string) => React.ReactNode, title: string) => {
    const g = groupBy(pts, key)
    return (
      <Panel pad={false} title={title}>
        <table className="tbl">
          <thead><tr><th>{title.replace('By ', '')}</th><th className="num">C5 mean</th><th className="num">C3 mean</th><th className="num">n</th><th className="num">Within range</th></tr></thead>
          <tbody>
            {Object.keys(g).sort().map((k) => {
              const a = summarize(g[k].filter((x) => x.cls === 5)), b = summarize(g[k].filter((x) => x.cls === 3)), t = summarize(g[k])
              return <tr key={k}><td>{label(k)}</td><td className="num">{a.n ? <AccPct v={a.mean} cls={5} /> : '—'}</td><td className="num">{b.n ? <AccPct v={b.mean} cls={3} /> : '—'}</td><td className="num">{t.n}</td><td className="num">{pct(t.within)}</td></tr>
            })}
          </tbody>
        </table>
      </Panel>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegButtons value={basis} onChange={setBasis} options={[{ id: 'all', label: 'Final cost + current EAC' }, { id: 'final', label: 'Closed projects only' }]} />
        <div className="w-56"><ProgramSelect id="acc-prog" value={prog} onChange={setProg} /></div>
        <span className="text-xs text-muted">Accuracy = outcome ÷ approved estimate − 1. In-flight projects use the current EAC; their accuracy is final at closeout.</span>
      </div>
      {!pts.length ? <Empty title="No outcomes to compare">{basis === 'final' ? 'No closed projects match. Include in-flight projects to compare against current forecasts.' : 'No approved estimates with actual cost yet.'}</Empty> : <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([5, 3] as AaceClass[]).map((c) => {
            const x = summarize(pts.filter((p) => p.cls === c))
            const r = CLASS_RANGES[c]
            return (
              <Panel key={c} title={<span className="inline-flex items-center gap-2"><ClassBadge cls={c} /> Class {c} estimates</span>}>
                {x.n ? <div className="grid grid-cols-3 gap-2 text-[13px]">
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Mean</div><div className="font-display text-[20px] font-bold"><AccPct v={x.mean} cls={c} /></div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Mean |error|</div><div className="font-display text-[20px] font-bold tabular-nums">{pct(x.meanAbs, 1)}</div></div>
                  <div><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">In range</div><div className={cx('font-display text-[20px] font-bold tabular-nums', x.within >= 0.8 ? 'text-good' : 'text-warn')}>{pct(x.within)}</div></div>
                  <div className="col-span-3 text-xs text-muted">n={x.n} · spread {pct(x.min, 1)} to {x.max > 0 ? '+' : ''}{pct(x.max, 1)} · AACE expects {pct(r.low)} to +{pct(r.high)}</div>
                </div> : <p className="text-[13px] text-muted">No Class {c} outcomes yet.</p>}
              </Panel>
            )
          })}
          <Panel title="Reading this">
            <p className="text-[13px] text-muted">A negative mean says estimates ran high (projects came in under). If Class 3 estimates cluster tighter than Class 5 around zero, maturing the estimate is paying for itself. Points outside the shaded AACE band need a lessons-learned entry.</p>
          </Panel>
        </div>
        <Panel title="Accuracy by class against the AACE expected range" subtitle={`${pts.length} approved estimates on ${projects.length} projects`} actions={<SegButtons value={zoom} onChange={setZoom} options={[{ id: 'data', label: 'Zoom to data' }, { id: 'aace', label: 'Full AACE range' }]} />}>
          <AccuracyStrip domain={domain} rows={classes.map((c) => {
            const x = summarize(pts.filter((p) => p.cls === c))
            return { label: `Class ${c}`, sub: `n=${x.n}`, low: CLASS_RANGES[c].low, high: CLASS_RANGES[c].high, mean: x.mean, points: pts.filter((p) => p.cls === c).map((p) => ({ v: p.acc, title: `${p.code} v${p.version} Class ${p.cls}: estimate ${money(p.estimate)} → ${p.basis === 'final' ? 'final' : 'EAC'} ${money(p.outcome)} (${p.acc > 0 ? '+' : ''}${(p.acc * 100).toFixed(1)}%)` })) }
          })} />
          <Legend items={[{ swatch: <Swatch className="border border-info/50 bg-info/20" />, label: 'AACE expected range' }, { swatch: <span className="inline-block h-2.5 w-2.5 rounded-full bg-link" />, label: 'Within range' }, { swatch: <span className="inline-block h-2.5 w-2.5 rounded-full bg-bad" />, label: 'Outside range' }, { swatch: <span className="inline-block h-3 w-[3px] bg-link" />, label: 'Mean' }]} />
        </Panel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groupTable((x) => x.programId, (k) => <span className="inline-flex items-center gap-2"><ProgramTag programId={k} /><span className="text-[12px]">{s.programs.find((p) => p.id === k)?.name}</span></span>, 'By program')}
          {groupTable((x) => x.estimatorId, (k) => person(k), 'By estimator')}
        </div>
        <Panel pad={false} title="Estimate vs outcome by project" subtitle="Each bar is an approved estimate with its AACE band; the diamond is the outcome">
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Project</th><th>Outcome</th><th style={{ minWidth: 260 }}>Class 5 · <span className="normal-case">◆ outcome</span></th><th className="num">C5</th><th style={{ minWidth: 260 }}>Class 3 · <span className="normal-case">◆ outcome</span></th><th className="num">C3</th></tr></thead>
              <tbody>
                {projects.map((p) => {
                  const ps = pts.filter((x) => x.projectId === p.id)
                  const a = ps.filter((x) => x.cls === 5).pop(), b = ps.filter((x) => x.cls === 3).pop()
                  const max = Math.max(...ps.map((x) => Math.max(x.high, x.outcome))) * 1.04
                  return (
                    <tr key={p.id} className="clickable" onClick={() => { go(projectHref(p.id, 'estimates')) }}>
                      <td><div className="flex items-center gap-1.5"><ProgramTag programId={p.programId} /><span className="font-mono text-[12px] font-semibold">{p.code}</span></div><div className="max-w-[220px] truncate text-[12px] text-muted">{p.name}</div></td>
                      <td className="text-[12px]"><b className="tabular-nums">{money(ps[0].outcome)}</b><div className="text-faint">{ps[0].basis === 'final' ? 'Final cost' : 'Current EAC'}</div></td>
                      <td>{a ? <OutcomeBar low={a.low} point={a.estimate} high={a.high} outcome={a.outcome} scaleMax={max} /> : <span className="text-faint">—</span>}</td>
                      <td className="num">{a ? <AccPct v={a.acc} cls={5} /> : '—'}</td>
                      <td>{b ? <OutcomeBar low={b.low} point={b.estimate} high={b.high} outcome={b.outcome} scaleMax={max} /> : <span className="text-[12px] text-faint">Not yet approved</span>}</td>
                      <td className="num">{b ? <AccPct v={b.acc} cls={3} /> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2"><Legend items={[{ swatch: <Swatch className="border border-info/50 bg-info/20" />, label: 'AACE range' }, { swatch: <span className="inline-block h-3 w-[3px] bg-link" />, label: 'Approved estimate' }, { swatch: <span className="inline-block h-2.5 w-2.5 rotate-45 bg-marker" />, label: 'Outcome (final or EAC)' }]} /></div>
        </Panel>
      </>}
    </div>
  )
}

// ───────────────────────────── Analog finder (ES-14)
interface AiRank { ranked: { code: string; why: string }[]; summary: string; caution?: string }

function Analogs({ s }: { s: AppState }) {
  const ai = useAiAvailable()
  const me = useMe()
  const [pid, setPid] = useState(() => s.projects.find((p) => p.code === 'PRJ-1003')?.id ?? s.projects[0].id)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ pid: string; r: AiRank } | null>(null)
  const [err, setErr] = useState('')
  const target = s.projects.find((p) => p.id === pid)!
  const list = useMemo(() => analogs(s, target), [s, target])
  const top = list.slice(0, 8)
  const tu = unitBasis(target)
  const tc = bestCost(s, target)
  const tPer = tc ? tc.value / tu.qty : null
  const comparable = list.filter((a) => a.perUnit != null && a.score >= 60).slice(0, 5)
  const per = comparable.map((a) => a.perUnit!).sort((a, b) => a - b)
  const median = per.length ? per[Math.floor(per.length / 2)] : null
  const draft = s.estimates.find((e) => e.projectId === pid && e.status === 'draft')
  const facts = (p: Project) => { const c = bestCost(s, p); const u = unitBasis(p); return { code: p.code, name: p.name, program: s.programs.find((x) => x.id === p.programId)?.code, assetType: p.asset.type, workMethod: p.workMethod, diameterIn: p.asset.diameterIn || null, lengthFt: p.asset.lengthFt || null, units: `${u.qty} ${u.unit}`, terrain: p.location.terrain, district: p.location.district, classLocation: p.location.classLocation, hca: p.location.hca, status: p.status, stage: stageName(s, p), cost: c ? Math.round(c.value) : null, costBasis: c?.label ?? null, costPerUnit: c ? Math.round(c.value / u.qty) : null, scope: p.scope.summary } }
  const run = async () => {
    setBusy(true); setErr('')
    const cands = list.slice(0, 14).map((a) => ({ ...facts(a.project), deterministicScore: a.score }))
    const prompt = `You are a utility capital cost estimator choosing analog projects to sanity-check an estimate. Data is a fictional demo for "Arroyo Valley Gas".
TARGET PROJECT:
${JSON.stringify(facts(target))}
CANDIDATE PROJECTS (cost = final cost if closed, current forecast EAC if under way, else the latest estimate; costPerUnit is cost divided by units):
${JSON.stringify(cands)}
Rank the 5 candidates most useful as cost analogs for the target. Prefer the same asset type and work method, then similar diameter, terrain, length/scale and class location, and prefer outcomes (final or EAC) over estimates. Explain each pick in one short sentence citing the specific similarity or difference and what it means for $/unit.
Return ONLY JSON: {"ranked":[{"code":"PRJ-0000","why":"..."}] (exactly 5, best first, codes from the candidates), "summary":"2-3 sentences on what the analogs say about the target's cost per unit", "caution":"one sentence on the biggest limitation of these analogs"}`
    try {
      const r = await askJSON<AiRank>(prompt)
      if (!r || !Array.isArray(r.ranked)) throw new Error('format')
      setRes({ pid, r: { ranked: r.ranked.filter((x) => s.projects.some((p) => p.code === x.code)).slice(0, 5), summary: String(r.summary ?? ''), caution: r.caution ? String(r.caution) : undefined } })
    } catch (e) { setErr(e instanceof Error && e.message === 'format' ? 'The AI reply had an unexpected format. Try again.' : aiMessage(e)) } finally { setBusy(false) }
  }
  const addToBoe = () => {
    if (!draft) return
    const text = `Analog check (${fmtDate(s.settings.asOf)}): ${comparable.map((a) => `${a.project.code} ${fmtPerUnit(a.perUnit, a.unit.unit)} (${a.cost?.label.toLowerCase()})`).join('; ')}${median != null ? `; median ${fmtPerUnit(median, tu.unit)}` : ''}${tPer != null ? ` vs this project ${fmtPerUnit(tPer, tu.unit)}` : ''}.`
    mutate((d) => { const e = d.estimates.find((x) => x.id === draft.id); if (e) e.basis.assumptions.push(text) }, { entity: 'estimate', entityId: draft.id, projectId: pid, action: 'update', summary: `Added analog cost check to draft v${draft.version} BOE assumptions (${comparable.length} analogs)` })
    toast(`Added to draft v${draft.version} basis of estimate`)
  }
  const aiRes = res?.pid === pid ? res.r : null
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Project to find analogs for" className="w-full max-w-md"><ProjectSelect id="an-proj" value={pid} onChange={(v) => { setPid(v); setErr('') }} /></Field>
          {ai !== false ? <Button variant="marker" onClick={run} disabled={busy} icon={<span aria-hidden>✦</span>}>{busy ? 'Thinking…' : 'AI rank analogs'}</Button> : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Fact label="Asset · method" value={`${ASSET_LABEL[target.asset.type]} · ${METHOD_LABEL[target.workMethod]}`} />
          <Fact label="Size" value={target.asset.type === 'valve-site' ? `${tu.qty} site${tu.qty > 1 ? 's' : ''}, ${target.asset.diameterIn}"` : target.asset.lengthFt ? `${target.asset.lengthFt.toLocaleString('en-US')} ft, ${target.asset.diameterIn}"` : target.scope.quantities.map((q) => `${q.qty.toLocaleString('en-US')} ${q.unit}`).join(', ')} />
          <Fact label="Terrain · district" value={<span className="capitalize">{target.location.terrain} · {target.location.district}</span>} />
          <Fact label={tc?.label ?? 'Cost'} value={tc ? <span>{money(tc.value)} <span className="text-muted">({fmtPerUnit(tPer, tu.unit)})</span></span> : '—'} />
        </div>
      </Panel>
      {err && <Callout tone="bad">{err}</Callout>}
      {aiRes && (
        <Panel title={<span className="inline-flex items-center gap-2">AI ranking <AiTag /></span>} subtitle="Suggested analogs. Check the cost basis before relying on them." actions={<Button size="sm" variant="ghost" onClick={() => setRes(null)}>Dismiss</Button>}>
          <ol className="flex flex-col gap-2">
            {aiRes.ranked.map((x, i) => {
              const a = list.find((y) => y.project.code === x.code)
              return (
                <li key={x.code} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-[13px]">
                  <span className="w-5 font-display font-bold text-muted">{i + 1}</span>
                  <a className="font-mono font-semibold text-link hover:underline" href={a ? projectHref(a.project.id, 'estimates') : '#estimating'}>{x.code}</a>
                  <span className="min-w-0 flex-1">{x.why}</span>
                  {a && <span className="tabular-nums text-muted">{fmtPerUnit(a.perUnit, a.unit.unit)} · {a.cost?.label}</span>}
                </li>
              )
            })}
          </ol>
          {aiRes.summary && <p className="mt-3 text-[13px]">{aiRes.summary}</p>}
          {aiRes.caution && <p className="mt-1 text-xs text-warn">{aiRes.caution}</p>}
        </Panel>
      )}
      <Panel pad={false} title="Most similar projects" subtitle="Deterministic similarity: asset type, work method, diameter, terrain, scale and district"
        actions={draft && comparable.length > 0 && <Button size="sm" onClick={addToBoe}>Add analog check to draft v{draft.version} BOE</Button>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Project</th><th className="num">Similarity</th><th>Why</th><th>Size</th><th className="num">Cost</th><th>Basis</th><th className="num">Cost {perUnitLabel(tu.unit)}</th><th className="num">vs target</th></tr></thead>
            <tbody>
              {top.map((a) => (
                <tr key={a.project.id} className="clickable" onClick={() => { go(projectHref(a.project.id, 'estimates')) }}>
                  <td><div className="flex items-center gap-1.5"><ProgramTag programId={a.project.programId} /><span className="font-mono text-[12px] font-semibold">{a.project.code}</span></div><div className="max-w-[240px] truncate text-[12px] text-muted">{a.project.name}</div></td>
                  <td className="num"><div className="flex items-center justify-end gap-2"><span className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken"><span className="block h-full bg-link" style={{ width: `${a.score}%` }} /></span><b>{a.score}</b></div></td>
                  <td className="text-[11.5px] text-muted">{a.reasons.slice(0, 4).join(' · ') || 'Different asset and method'}</td>
                  <td className="text-[12px]">{a.unit.unit === 'ft' ? `${a.unit.qty.toLocaleString('en-US')} ft` : `${a.unit.qty.toLocaleString('en-US')} ${a.unit.unit}`}{a.project.asset.diameterIn ? `, ${a.project.asset.diameterIn}"` : ''}</td>
                  <td className="num">{money(a.cost?.value)}</td>
                  <td>{a.cost ? <Badge tone={a.cost.basis === 'final' ? 'good' : a.cost.basis === 'eac' ? 'info' : 'neutral'}>{a.cost.label}</Badge> : '—'}</td>
                  <td className="num font-semibold">{fmtPerUnit(a.perUnit, a.unit.unit)}</td>
                  <td className="num">{a.perUnit != null && tPer ? <span className={cx(a.perUnit > tPer ? 'text-bad' : 'text-good')}>{a.perUnit >= tPer ? '+' : ''}{pct(a.perUnit / tPer - 1)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-2.5 text-[12.5px]">
          {median != null ? <>
            <span>Analog median (similarity ≥ 60, n={per.length}): <b className="tabular-nums">{fmtPerUnit(median, tu.unit)}</b></span>
            <span>Range <b className="tabular-nums">{fmtPerUnit(per[0], tu.unit)}</b> – <b className="tabular-nums">{fmtPerUnit(per[per.length - 1], tu.unit)}</b></span>
            {tPer != null && <span>This project: <b className="tabular-nums">{fmtPerUnit(tPer, tu.unit)}</b> <span className={cx(tPer > median * 1.25 ? 'text-bad' : tPer < median * 0.75 ? 'text-warn' : 'text-good')}>({tPer >= median ? '+' : ''}{pct(tPer / median - 1)} vs median{Math.abs(tPer / median - 1) > 0.25 ? ' — explain in the BOE' : ''})</span></span>}
          </> : <span className="text-muted">No close analogs with a comparable unit basis. Rely on the unit-cost library and document the gap.</span>}
          {!draft && comparable.length > 0 && <span className="text-xs text-faint">Open a draft estimate on this project to add the analog check to its BOE.</span>}
        </div>
      </Panel>
      <p className="text-xs text-muted">Signed in as {me.name}. Similarity is computed in the page; AI ranking (when enabled) sees only the project facts listed above.</p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div><div className="mt-0.5 text-[13px] font-semibold">{value}</div></div>
}


