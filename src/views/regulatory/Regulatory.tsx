// Rate case & evidence (#regulatory): authorized vs recorded vs forecast (BL-08), reasonableness-review
// readiness across projects, large-project annual report, program evidence package, regulatory snapshots (RC-02).
import { useMemo, useState } from 'react'
import { mutate, useStore, personName } from '@/core/store'
import type { AppState } from '@/core/types'
import { activeBudget, position, snapshotsFor, takeSnapshot } from '@/core/engine/position'
import { stageName } from '@/core/engine/gates'
import { saveFile, toCSV } from '@/core/download'
import { go, projectHref } from '@/core/router'
import { fmtDate, money, moneyDelta, sum, cx } from '@/core/util'
import { Badge, Button, Callout, Checkbox, Field, Input, Modal, PageHeader, Panel, Progress, SegButtons, Stat, StatusBadge, Table, Mono } from '@/ui/kit'
import { BarChart } from '@/ui/charts'
import { ProgramSelect, ProgramTag } from '../shared/pickers'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { assessEvidence, forecastByYear, actualsByYear, programYears } from '../project/tabs/controls/trace'
import { evidenceRows, programBinderHtml } from '../project/tabs/controls/binder'

const LARGE = 50_000_000
const CPCN = 75_000_000

export default function Regulatory() {
  const s = useStore()
  const [programId, setProgramId] = useState('')
  const [snapOpen, setSnapOpen] = useState(false)
  const year = Number(s.settings.asOf.slice(0, 4))
  const years = useMemo(() => programYears(s, programId || undefined), [s, programId])
  const projects = s.projects.filter((p) => (!programId || p.programId === programId) && p.status !== 'cancelled')
  const assessed = useMemo(() => projects.filter((p) => s.budgets.some((b) => b.projectId === p.id)).map((p) => ({ p, a: assessEvidence(s, p.id), pos: position(s, p.id) })), [s, programId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = years.find((y) => y.year === year)
  const ready = assessed.filter((x) => x.a.score >= 90).length
  const avg = assessed.length ? Math.round(sum(assessed.map((x) => x.a.score * Math.max(1, x.pos.currentBudget))) / sum(assessed.map((x) => Math.max(1, x.pos.currentBudget)))) : 0
  const prog = s.programs.find((x) => x.id === programId)
  const regSnaps = s.snapshots.filter((x) => x.type === 'regulatory' && projects.some((p) => p.id === x.projectId)).sort((a, b) => b.date.localeCompare(a.date))

  const downloadProgram = async (kind: 'html' | 'csv') => {
    if (!prog) return
    const pids = assessed.map((x) => x.p.id)
    const r = kind === 'html'
      ? await saveFile(`${prog.code}-program-evidence-package-${s.settings.asOf}.html`, programBinderHtml(s, prog.id, pids), 'text/html')
      : await saveFile(`${prog.code}-program-evidence-extract-${s.settings.asOf}.csv`, toCSV(pids.flatMap((id) => evidenceRows(s, id))), 'text/csv')
    if (r === 'saved') { mutate(() => {}, { entity: 'evidence', entityId: prog.id, action: 'export', summary: `Downloaded ${prog.code} program evidence ${kind === 'html' ? 'binder' : 'CSV'} (${pids.length} projects)` }); toast(kind === 'html' ? 'Program binder saved' : 'Program CSV saved') }
    else if (r === 'unavailable') toast('Download is not available here', 'bad')
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Controls" title="Rate case & evidence" subtitle="Authorized funding against recorded and forecast cost, and how ready each project is for a reasonableness review. Every figure is computed from budgets, ERP cost periods, signed forecasts and approved decisions."
        actions={<>
          <div className="w-[260px]"><ProgramSelect value={programId} onChange={setProgramId} /></div>
          <Button onClick={() => setSnapOpen(true)} icon={<Icon name="plus" className="h-4 w-4" />}>Regulatory snapshot</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={`Authorized ${year}`} value={money(cur?.authorized)} sub={cur?.proceeding || '—'} />
        <Stat label={`Recorded ${year} to date`} value={money(cur?.recorded)} sub={cur?.authorized ? `${((cur.recorded / cur.authorized) * 100).toFixed(0)}% of authorized` : undefined} />
        <Stat label={`Forecast ${year}`} value={money(cur?.forecast)} tone={cur && cur.forecast > cur.authorized ? 'bad' : 'good'} sub={cur ? `${moneyDelta(cur.forecast - cur.authorized)} vs authorized` : undefined} />
        <Stat label="Review readiness" value={`${avg}%`} tone={avg >= 90 ? 'good' : avg >= 75 ? 'warn' : 'bad'} sub={`Dollar-weighted · ${ready} of ${assessed.length} projects ≥ 90%`} />
        <Stat label="Large projects" value={assessed.filter((x) => Math.max(x.pos.currentBudget, x.pos.eac) >= LARGE).length} sub={`≥ ${money(LARGE)} · ${assessed.filter((x) => Math.max(x.pos.currentBudget, x.pos.eac) > CPCN).length} over CPCN threshold`} />
      </div>

      <FundingPanel s={s} years={years} programId={programId} year={year} />
      <ReadinessPanel assessed={assessed} s={s} />
      <LargeProjectsPanel s={s} assessed={assessed} year={year} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Program evidence package" subtitle="One binder covering every budgeted project in the program — cover, estimates, baselines, change approval chains, variances, contingency, safety, records and gates.">
          {prog ? (
            <div className="flex flex-col gap-3">
              <div className="text-[13px]"><ProgramTag programId={prog.id} /> <b>{prog.name}</b> · {prog.regulatoryDriver} · recovery via {prog.recovery}</div>
              <div className="grid grid-cols-3 gap-2 text-[13px]">
                <MiniFig k="Projects" v={String(assessed.length)} />
                <MiniFig k="Gaps to close" v={String(sum(assessed.map((x) => x.a.gaps.length)))} />
                <MiniFig k="Recorded" v={money(sum(assessed.map((x) => x.pos.actualToDate)))} />
              </div>
              <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => downloadProgram('html')} icon={<Icon name="download" className="h-4 w-4" />}>Download HTML binder</Button><Button onClick={() => downloadProgram('csv')} icon={<Icon name="download" className="h-4 w-4" />}>CSV extract</Button></div>
            </div>
          ) : <Callout tone="info">Choose a program above to assemble its evidence package.<div className="mt-2 flex flex-wrap gap-1.5">{s.programs.map((p) => <Button key={p.id} size="sm" onClick={() => setProgramId(p.id)}>{p.code}</Button>)}</div></Callout>}
        </Panel>
        <Panel title="Regulatory snapshots" subtitle="Positions frozen for a filing or data request" pad={false}>
          <Table rows={regSnaps} rowKey={(x) => x.id} dense maxHeight={260} empty={<p className="p-4 text-[13px] text-muted">No regulatory snapshots yet. Take one to freeze every active project's position for a proceeding.</p>} columns={[
            { key: 'd', header: 'Date', render: (x) => fmtDate(x.date) },
            { key: 'p', header: 'Project', render: (x) => <a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(x.projectId, 'baselines')}>{s.projects.find((p) => p.id === x.projectId)?.code}</a> },
            { key: 'g', header: 'Proceeding', render: (x) => <span className="text-[12.5px]">{x.proceeding}</span> },
            { key: 'b', header: 'Budget', num: true, render: (x) => money(x.budget.total) },
            { key: 'e', header: 'EAC', num: true, render: (x) => money(x.budget.eac) },
            { key: 'by', header: 'By', render: (x) => <span className="text-xs text-muted">{personName(s, x.createdById)}</span> },
          ]} />
        </Panel>
      </div>
      <RegSnapshotModal open={snapOpen} onClose={() => setSnapOpen(false)} initialProgram={programId} />
    </div>
  )
}

function MiniFig({ k, v }: { k: string; v: string }) {
  return <div className="rounded-md border border-line px-2.5 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className="font-display text-[17px] font-bold tabular-nums">{v}</div></div>
}

// ───────────────────────────── BL-08
function FundingPanel({ s, years, programId, year }: { s: AppState; years: ReturnType<typeof programYears>; programId: string; year: number }) {
  const [view, setView] = useState<'years' | 'programs'>('years')
  const shown = years.filter((y) => y.authorized || y.recorded || y.forecast)
  const progRows = s.programs.map((pr) => { const y = programYears(s, pr.id).find((x) => x.year === year); return { pr, y } })
  return (
    <Panel title="Authorized vs recorded vs forecast" subtitle={view === 'years' ? `By year${programId ? '' : ', all programs'} · recorded = ERP actuals; forecast = actuals for past years plus the signed EAC spread for the rest` : `By program for ${year}`}
      actions={<SegButtons options={[{ id: 'years', label: 'By year' }, { id: 'programs', label: `By program ${year}` }]} value={view} onChange={setView} />}>
      {view === 'years' ? (
        <>
          <BarChart labels={shown.map((y) => String(y.year))} highlight={shown.findIndex((y) => y.year === year)} series={[
            { name: 'Authorized', values: shown.map((y) => y.authorized), color: 'rgb(var(--ink))' },
            { name: 'Planned (budgets)', values: shown.map((y) => y.planned), color: 'rgb(var(--muted))' },
            { name: 'Recorded', values: shown.map((y) => y.recorded), color: 'rgb(var(--link))' },
            { name: 'Forecast', values: shown.map((y) => y.forecast), color: 'rgb(var(--marker))' },
          ]} />
          <div className="mt-3">
            <Table rows={shown} rowKey={(y) => String(y.year)} dense columns={[
              { key: 'y', header: 'Year', render: (y) => <b className={y.year === year ? 'text-ink' : ''}>{y.year}{y.year === year && <span className="ml-1 text-xs font-normal text-muted">(current)</span>}</b> },
              { key: 'pr', header: 'Proceeding', render: (y) => <span className="text-[12px] text-muted">{y.proceeding || '—'}</span> },
              { key: 'a', header: 'Authorized', num: true, render: (y) => money(y.authorized) },
              { key: 'p', header: 'Planned', num: true, render: (y) => money(y.planned) },
              { key: 'r', header: 'Recorded', num: true, render: (y) => money(y.recorded) },
              { key: 'f', header: 'Forecast', num: true, render: (y) => money(y.forecast) },
              { key: 'v', header: 'Forecast − authorized', num: true, render: (y) => <span className={cx('font-semibold', y.forecast > y.authorized ? 'text-bad' : 'text-good')}>{moneyDelta(y.forecast - y.authorized)}</span> },
              { key: 'vp', header: '%', num: true, render: (y) => (y.authorized ? `${(((y.forecast - y.authorized) / y.authorized) * 100).toFixed(1)}%` : '—') },
            ]} />
          </div>
        </>
      ) : (
        <>
          <BarChart labels={progRows.map((x) => x.pr.code)} series={[
            { name: 'Authorized', values: progRows.map((x) => x.y?.authorized ?? 0), color: 'rgb(var(--ink))' },
            { name: 'Recorded', values: progRows.map((x) => x.y?.recorded ?? 0), color: 'rgb(var(--link))' },
            { name: 'Forecast', values: progRows.map((x) => x.y?.forecast ?? 0), color: 'rgb(var(--marker))' },
          ]} />
          <div className="mt-3">
            <Table rows={progRows} rowKey={(x) => x.pr.id} dense columns={[
              { key: 'p', header: 'Program', render: (x) => <span className="flex items-center gap-2"><ProgramTag programId={x.pr.id} />{x.pr.name}</span> },
              { key: 'm', header: 'Recovery', render: (x) => <span className="text-[12px] text-muted">{x.pr.recovery}</span> },
              { key: 'a', header: 'Authorized', num: true, render: (x) => money(x.y?.authorized) },
              { key: 'r', header: 'Recorded', num: true, render: (x) => money(x.y?.recorded) },
              { key: 'f', header: 'Forecast', num: true, render: (x) => money(x.y?.forecast) },
              { key: 'v', header: 'Variance', num: true, render: (x) => { const v = (x.y?.forecast ?? 0) - (x.y?.authorized ?? 0); return <span className={cx('font-semibold', v > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(v)}</span> } },
            ]} />
          </div>
        </>
      )}
    </Panel>
  )
}

// ───────────────────────────── Readiness across projects (AI-06 style, deterministic)
function ReadinessPanel({ s, assessed }: { s: AppState; assessed: { p: AppState['projects'][number]; a: ReturnType<typeof assessEvidence>; pos: ReturnType<typeof position> }[] }) {
  const rows = [...assessed].sort((x, y) => x.a.score - y.a.score || y.pos.currentBudget - x.pos.currentBudget)
  const allGaps = assessed.flatMap((x) => x.a.gaps)
  const themes = Object.entries(allGaps.reduce<Record<string, number>>((a, g) => { a[g.area] = (a[g.area] || 0) + 1; return a }, {})).sort((a, b) => b[1] - a[1])
  return (
    <Panel title="Reasonableness-review readiness" subtitle="Deterministic checks over each project's records: approvals, signatures, baselines, variances, contingency, records, safety and gates. Lowest first." pad={false}>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
        <span className="font-semibold text-ink">{allGaps.length} gaps across {assessed.length} projects:</span>
        {themes.map(([k, v]) => <Badge key={k}>{k} {v}</Badge>)}
      </div>
      <Table rows={rows} rowKey={(x) => x.p.id} maxHeight={480} onRowClick={(x) => go(projectHref(x.p.id, 'evidence'))} columns={[
        { key: 'p', header: 'Project', render: (x) => <span className="block min-w-[200px]"><span className="flex items-center gap-1.5"><ProgramTag programId={x.p.programId} /><Mono className="font-semibold">{x.p.code}</Mono></span><span className="block text-[12.5px]">{x.p.name}</span></span>, sort: (x) => x.p.code },
        { key: 'st', header: 'Stage', render: (x) => <span className="text-[12px] text-muted">{stageName(s, x.p)}{x.p.status !== 'active' && <> · <StatusBadge status={x.p.status} /></>}</span> },
        { key: 'b', header: 'Budget', num: true, render: (x) => money(x.pos.currentBudget), sort: (x) => x.pos.currentBudget },
        { key: 'sc', header: 'Score', render: (x) => <span className="flex min-w-[110px] items-center gap-2"><span className={cx('w-9 text-right font-bold tabular-nums', x.a.score >= 90 ? 'text-good' : x.a.score >= 75 ? 'text-warn' : 'text-bad')}>{x.a.score}%</span><Progress className="w-16" value={x.a.score} tone={x.a.score >= 90 ? 'good' : x.a.score >= 75 ? 'warn' : 'bad'} /></span>, sort: (x) => x.a.score },
        { key: 'g', header: 'Top gaps', render: (x) => x.a.gaps.length ? <ul className="min-w-[260px] text-[12.5px]">{x.a.gaps.slice(0, 2).map((g) => <li key={g.id} className={g.severity === 'major' ? 'text-ink' : 'text-muted'}>{g.gap}</li>)}{x.a.gaps.length > 2 && <li className="text-faint">+{x.a.gaps.length - 2} more</li>}</ul> : <span className="text-[12.5px] text-good">Ready</span> },
      ]} />
    </Panel>
  )
}

// ───────────────────────────── Large-project report (GO 177-style)
function LargeProjectsPanel({ s, assessed, year }: { s: AppState; assessed: { p: AppState['projects'][number]; a: ReturnType<typeof assessEvidence>; pos: ReturnType<typeof position> }[]; year: number }) {
  const rows = assessed.filter((x) => Math.max(x.pos.currentBudget, x.pos.eac) >= LARGE).map((x) => {
    const p = x.p
    const act = actualsByYear(s, p.id)
    const fy = forecastByYear(s, p.id)
    const ins = p.milestones.find((m) => /in.service/i.test(m.name))
    const authorized = x.pos.currentBudget
    const latestVar = s.variances.filter((v) => v.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date))[0]
    const approvedChanges = s.changes.filter((c) => c.projectId === p.id && c.status === 'approved')
    return {
      x, p, authorized, original: x.pos.originalBudget, recordedYear: act[String(year)] ?? 0, recordedCum: x.pos.actualToDate, forecastYear: fy[String(year)] ?? 0, eac: x.pos.eac,
      cpcn: Math.max(authorized, x.pos.eac) > CPCN, ins, budgetKind: activeBudget(s, p.id)?.kind,
      explanation: latestVar?.narrative || (approvedChanges.length ? `${approvedChanges.length} approved change(s): ${approvedChanges.map((c) => c.code).join(', ')}` : 'Within authorization'),
    }
  }).sort((a, b) => b.authorized - a.authorized)
  const csv = async () => {
    const r = await saveFile(`large-project-report-${year}.csv`, toCSV(rows.map((r) => ({ project: r.p.code, name: r.p.name, program: s.programs.find((x) => x.id === r.p.programId)?.code, driver: r.p.regulatoryCitation, proceeding: r.p.fundingProceeding, stage: stageName(s, r.p), budget_type: r.budgetKind ?? '', cpcn_required: r.cpcn ? 'Y' : 'N', original_authorized: r.original, current_authorized: r.authorized, [`recorded_${year}`]: r.recordedYear, recorded_cumulative: r.recordedCum, [`forecast_${year}`]: r.forecastYear, eac: r.eac, variance: r.eac - r.authorized, variance_pct: r.authorized ? +(((r.eac - r.authorized) / r.authorized) * 100).toFixed(1) : '', in_service_baseline: r.ins?.baseline ?? '', in_service_forecast: r.ins?.actual ?? r.ins?.forecast ?? '', evidence_score: r.x.a.score, explanation: r.explanation }))), 'text/csv')
    if (r === 'saved') { mutate(() => {}, { entity: 'report', entityId: `large-${year}`, action: 'export', summary: `Downloaded ${year} large-project report (${rows.length} projects)` }); toast('Report saved') }
  }
  return (
    <Panel title={`Large-project annual report — ${year}`} subtitle={`GO 177-style report of projects with planned investment of ${money(LARGE)} or more · CPCN flag above ${money(CPCN)}`} pad={false}
      actions={<Button size="sm" onClick={csv} disabled={!rows.length} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV</Button>}>
      <Table rows={rows} rowKey={(r) => r.p.id} onRowClick={(r) => go(projectHref(r.p.id, 'evidence'))} empty={<p className="p-4 text-[13px] text-muted">No projects at or above {money(LARGE)} in this selection.</p>} columns={[
        { key: 'p', header: 'Project', render: (r) => <span className="block min-w-[200px]"><span className="flex items-center gap-1.5"><ProgramTag programId={r.p.programId} /><Mono className="font-semibold">{r.p.code}</Mono>{r.cpcn && <Badge tone="warn" title={`Planned investment above ${money(CPCN)}`}>CPCN</Badge>}</span><span className="block text-[12.5px]">{r.p.name}</span><span className="block text-[11.5px] text-faint">{r.p.regulatoryCitation}</span></span> },
        { key: 'st', header: 'Stage', render: (r) => <span className="text-[12px] text-muted">{stageName(s, r.p)}<span className="block">{r.budgetKind ? `${r.budgetKind} budget` : 'no budget'}</span></span> },
        { key: 'a', header: 'Authorized', num: true, render: (r) => <span>{money(r.authorized)}{r.original !== r.authorized && <span className="block text-[11px] text-faint">orig. {money(r.original)}</span>}</span>, sort: (r) => r.authorized },
        { key: 'ry', header: `Recorded ${year}`, num: true, render: (r) => money(r.recordedYear) },
        { key: 'rc', header: 'Recorded cum.', num: true, render: (r) => money(r.recordedCum) },
        { key: 'fy', header: `Forecast ${year}`, num: true, render: (r) => money(r.forecastYear) },
        { key: 'e', header: 'EAC', num: true, render: (r) => money(r.eac) },
        { key: 'v', header: 'Variance', num: true, render: (r) => <span className={cx('font-semibold', r.eac > r.authorized ? 'text-bad' : 'text-good')}>{moneyDelta(r.eac - r.authorized)}<span className="block text-[11px] font-normal text-muted">{r.authorized ? `${(((r.eac - r.authorized) / r.authorized) * 100).toFixed(1)}%` : ''}</span></span>, sort: (r) => r.eac - r.authorized },
        { key: 'i', header: 'In service', render: (r) => <span className="text-[12px]">{fmtDate(r.ins?.actual ?? r.ins?.forecast)}{r.ins && !r.ins.actual && r.ins.forecast !== r.ins.baseline && <span className="block text-faint">baseline {fmtDate(r.ins.baseline)}</span>}</span> },
        { key: 'x', header: 'Explanation', render: (r) => <span className="block min-w-[220px] text-[12px] text-muted">{r.explanation}</span> },
      ]} />
    </Panel>
  )
}

// ───────────────────────────── RC-02 regulatory snapshot
function RegSnapshotModal({ open, onClose, initialProgram }: { open: boolean; onClose: () => void; initialProgram: string }) {
  const s = useStore()
  const [programId, setProgramId] = useState(initialProgram || s.programs[0]?.id)
  const progFunding = s.funding.filter((f) => f.programId === programId)
  const proceedings = Array.from(new Set(progFunding.map((f) => f.proceeding))).reverse()
  const [proceeding, setProceeding] = useState('')
  const [label, setLabel] = useState('')
  const [excluded, setExcluded] = useState<string[]>([])
  const proc = proceeding || proceedings[0] || ''
  const eligible = s.projects.filter((p) => p.programId === programId && p.status === 'active' && s.budgets.some((b) => b.projectId === p.id))
  const chosen = eligible.filter((p) => !excluded.includes(p.id))
  const submit = () => {
    if (!proc.trim()) { toast('Name the proceeding.', 'bad'); return }
    if (!chosen.length) { toast('Select at least one project.', 'bad'); return }
    const prog = s.programs.find((x) => x.id === programId)!
    const lab = label.trim() || `Regulatory snapshot — ${proc.trim()}`
    mutate((d) => { for (const p of chosen) takeSnapshot(d, p.id, 'regulatory', lab, { proceeding: proc.trim() }) }, { entity: 'snapshot', entityId: prog.id, action: 'create', summary: `Took ${proc.trim()} regulatory snapshot for ${chosen.length} ${prog.code} projects` })
    toast(`Froze ${chosen.length} project positions`)
    setExcluded([]); setLabel(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Take regulatory snapshot" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Freeze {chosen.length} project{chosen.length === 1 ? '' : 's'}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">Freezes scope, schedule, budget by category, EAC, actuals and contingency for every active budgeted project in the program, tagged with the proceeding. Snapshots are immutable and appear on each project's baseline timeline.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Program"><ProgramSelect includeAll={false} value={programId} onChange={(v) => { setProgramId(v); setProceeding(''); setExcluded([]) }} /></Field>
          <Field label="Proceeding">
            <Input list="reg-proceedings" value={proc} onChange={(e) => setProceeding(e.target.value)} />
            <datalist id="reg-proceedings">{proceedings.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        </div>
        <Field label="Label (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Regulatory snapshot — ${proc}`} /></Field>
        <div className="rounded-md border border-line">
          <div className="border-b border-line bg-sunken/50 px-3 py-1.5 text-xs font-semibold text-muted">{eligible.length} eligible projects</div>
          <div className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto p-3">
            {eligible.map((p) => { const pos = position(s, p.id); const last = snapshotsFor(s, p.id).filter((x) => x.type === 'regulatory').pop(); return <Checkbox key={p.id} checked={!excluded.includes(p.id)} onChange={(v) => setExcluded(v ? excluded.filter((x) => x !== p.id) : [...excluded, p.id])} label={<span><Mono className="font-semibold">{p.code}</Mono> {p.name} <span className="text-muted">· {money(pos.currentBudget)} · EAC {money(pos.eac)}{last ? ` · last regulatory ${fmtDate(last.date)}` : ''}</span></span>} /> })}
            {!eligible.length && <p className="text-[13px] text-muted">No active budgeted projects in this program.</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

