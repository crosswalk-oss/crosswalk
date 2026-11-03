// Project register: filterable/sortable table with quick filters, CSV export and a territory map toggle.
import { prefs } from '@/core/data'
import { useMemo, useState } from 'react'
import { useMe, useStore } from '@/core/store'
import { go, projectHref } from '@/core/router'
import { daysBetween, fmtDate, money, moneyDelta, cx, sum } from '@/core/util'
import { saveFile, toCSV } from '@/core/download'
import { Badge, Button, HealthDot, Input, Mono, PageHeader, Panel, Progress, SegButtons, Select, StageTrack, StatusBadge, Table, Empty, type Column } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { PHASES, projectRow, type ProjectRow } from '../portfolio/lib'
import { TerritoryMap } from './TerritoryMap'

type Quick = 'all' | 'mine' | 'over' | 'gate60' | 'construction' | 'red'
const QUICK: { id: Quick; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'My projects' },
  { id: 'over', label: 'Over budget' },
  { id: 'gate60', label: 'Gate due ≤ 60d' },
  { id: 'construction', label: 'Construction' },
  { id: 'red', label: 'Red health' },
]

const VIEW_KEY = 'crosswalk:projects:view'
function loadPref(): { view: 'table' | 'map'; quick: Quick } {
  try { const v = JSON.parse(prefs.getRaw(VIEW_KEY) || '{}'); return { view: v.view === 'map' ? 'map' : 'table', quick: QUICK.some((q) => q.id === v.quick) ? v.quick : 'all' } } catch { return { view: 'table', quick: 'all' } }
}
function savePref(v: { view: string; quick: string }) { try { prefs.setRaw(VIEW_KEY, JSON.stringify(v)) } catch { /* storage blocked */ } }

export default function Projects(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const me = useMe()
  const pref = useMemo(loadPref, [])
  const [view, setViewRaw] = useState<'table' | 'map'>(pref.view)
  const [quick, setQuickRaw] = useState<Quick>(pref.quick)
  const [q, setQ] = useState('')
  const [program, setProgram] = useState('')
  const [phase, setPhase] = useState('')
  const [status, setStatus] = useState('open')
  const [pm, setPm] = useState('')
  const setView = (v: 'table' | 'map') => { setViewRaw(v); savePref({ view: v, quick }) }
  const setQuick = (v: Quick) => { setQuickRaw(v); savePref({ view, quick: v }) }

  const all = useMemo(() => s.projects.map((p) => projectRow(s, p)), [s])
  const asOf = s.settings.asOf
  const isMine = (r: ProjectRow) => Object.values(r.p.team).includes(me.id)
  const rows = all.filter((r) => {
    if (quick === 'mine' && !isMine(r)) return false
    if (quick === 'over' && !(r.variance > 0)) return false
    if (quick === 'gate60' && !(r.nextReview && daysBetween(asOf, r.nextReview.scheduled) <= 60)) return false
    if (quick === 'construction' && r.phase !== 3) return false
    if (quick === 'red' && r.overall !== 'red') return false
    if (program && r.p.programId !== program) return false
    if (phase !== '' && String(r.phase) !== phase) return false
    if (status === 'open' && !(r.p.status === 'active' || r.p.status === 'on-hold')) return false
    if (status !== 'open' && status !== '' && r.p.status !== status) return false
    if (pm && r.p.team.pm !== pm) return false
    if (q.trim()) {
      const hay = `${r.p.code} ${r.p.name} ${r.p.location.city} ${r.p.location.district} ${r.pmName} ${r.p.asset.lineId}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })
  const mineCount = all.filter(isMine).length
  const pms = s.people.filter((p) => p.roles.includes('pm'))

  const columns: Column<ProjectRow>[] = [
    { key: 'code', header: 'Project', sort: (r) => r.p.code, render: (r) => (
      <a href={projectHref(r.p.id)} onClick={(e) => e.stopPropagation()} className="flex min-w-[240px] max-w-[360px] flex-col">
        <span className="flex items-center gap-1.5"><ProgramTag programId={r.p.programId} /><Mono className="font-semibold">{r.p.code}</Mono>{r.p.status !== 'active' && <StatusBadge status={r.p.status} />}</span>
        <span className="truncate font-semibold text-ink" title={r.p.name}>{r.p.name}</span>
        <span className="text-[11px] text-faint">{r.p.location.city} · {r.p.location.district} · Tier {r.p.sizeTier}</span>
      </a>
    ) },
    { key: 'stage', header: 'Stage', sort: (r) => r.phase * 10 + r.p.stageIndex, render: (r) => (
      <div className="w-[150px]"><StageTrack stages={r.stages} current={r.p.stageIndex} status={r.p.status} /><div className="mt-1 truncate text-[11px] text-muted" title={r.stageName}>{r.p.stageIndex + 1}/{r.stages.length} · {r.stageName}</div></div>
    ) },
    { key: 'health', header: 'Health', sort: (r) => ({ red: 0, amber: 1, green: 2 })[r.overall], render: (r) => (
      <span className="flex gap-1" title={`Scope ${r.p.health.scope} · Schedule ${r.p.health.schedule} · Cost ${r.p.health.cost} · Risk ${r.p.health.risk} · Safety ${r.p.health.safety}`}>
        {(['scope', 'schedule', 'cost', 'risk', 'safety'] as const).map((k) => <HealthDot key={k} rag={r.p.health[k]} />)}
      </span>
    ) },
    { key: 'pm', header: 'PM', sort: (r) => r.pmName, render: (r) => <span className="whitespace-nowrap">{r.pmName}</span> },
    { key: 'budget', header: 'Budget', num: true, sort: (r) => r.budget, render: (r) => <span title={r.budgetBasis === 'estimate' ? 'No budget yet — latest estimate shown' : `${r.budgetBasis} budget`}>{money(r.budget)}{r.budgetBasis === 'estimate' && <span className="ml-1 text-[10px] text-faint">est</span>}{r.budgetBasis === 'planning' && <span className="ml-1 text-[10px] text-faint">plan</span>}</span> },
    { key: 'eac', header: 'EAC', num: true, sort: (r) => r.eac, render: (r) => money(r.eac) },
    { key: 'var', header: 'Variance', num: true, sort: (r) => r.variance, render: (r) => r.budgetBasis === 'estimate' || r.budgetBasis === 'none' ? <span className="text-faint">—</span> : <span className={cx('font-semibold', r.variance > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(r.variance)}</span> },
    { key: 'next', header: 'Next milestone', sort: (r) => r.next?.forecast ?? '9', render: (r) => r.next ? (
      <div className="min-w-[150px]"><div className="truncate text-[13px]">{r.next.name}</div><div className="text-[11px] text-muted">{fmtDate(r.next.forecast)}{r.nextSlip > 0 && <span className={cx('ml-1 font-semibold', r.nextSlip > 30 ? 'text-bad' : 'text-warn')}>+{r.nextSlip}d</span>}</div></div>
    ) : <span className="text-faint">—</span> },
    { key: 'ready', header: 'Gate readiness', sort: (r) => r.readiness, render: (r) => r.p.status === 'active' ? (
      <div className="w-[120px]" title={r.blockers.join('\n') || 'Ready for gate'}>
        <div className="flex items-center justify-between text-[11px]"><span className="tabular-nums font-semibold">{r.readiness}%</span>{r.nextReview && <span className="text-faint">{fmtDate(r.nextReview.scheduled).replace(/, \d{4}/, '')}</span>}</div>
        <Progress value={r.readiness} tone={r.readiness >= 80 ? 'good' : r.readiness >= 50 ? 'warn' : 'bad'} />
      </div>
    ) : <span className="text-faint">—</span> },
  ]

  const exportCsv = async () => {
    const res = await saveFile(`project-register-${asOf}.csv`, toCSV(rows.map((r) => ({
      Project: r.p.code, Name: r.p.name, Program: r.programCode, District: r.p.location.district, City: r.p.location.city, Stage: `${r.p.stageIndex + 1}/${r.stages.length} ${r.stageName}`, Status: r.p.status,
      PM: r.pmName, Sponsor: s.people.find((x) => x.id === r.p.team.sponsor)?.name ?? '', Budget: r.budget, BudgetBasis: r.budgetBasis, EAC: r.eac, Variance: r.variance, ActualToDate: r.pos.actualToDate,
      ContingencyRemaining: r.pos.contingencyRemaining, Health: r.overall, Scope: r.p.health.scope, Schedule: r.p.health.schedule, Cost: r.p.health.cost, Risk: r.p.health.risk, Safety: r.p.health.safety,
      NextMilestone: r.next?.name ?? '', NextMilestoneForecast: r.next?.forecast ?? '', SlipDays: r.nextSlip, GateReadinessPct: r.readiness, NextGateReview: r.nextReview?.scheduled ?? '', ErpWbs: r.p.erpWbs,
    }))), 'text/csv')
    if (res === 'saved') toast(`Exported ${rows.length} projects`)
    else if (res === 'unavailable') toast('Download is not available here', 'bad')
  }

  const totBudget = sum(rows.map((r) => r.budget)), totEac = sum(rows.map((r) => r.eac))
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Capital delivery"
        title="Project register"
        subtitle={`${all.filter((r) => r.p.status === 'active').length} active projects across ${s.programs.length} programs. Budget shows the control budget once authorized, else the planning budget or latest estimate.`}
        actions={<>
          <SegButtons value={view} onChange={setView} options={[{ id: 'table', label: 'Table' }, { id: 'map', label: 'Map' }]} />
          <Button icon={<Icon name="download" className="h-4 w-4" />} onClick={exportCsv}>Export CSV</Button>
          <Button variant="primary" icon={<Icon name="plus" className="h-4 w-4" />} onClick={() => go('#new-project')}>New project</Button>
        </>}
      />
      <Panel pad={false}>
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
          <div className="scroll-x flex gap-1">
            {QUICK.map((x) => {
              const n = x.id === 'mine' ? mineCount : undefined
              return <button key={x.id} onClick={() => setQuick(x.id)} className={cx('shrink-0 rounded-full border px-3 py-1 text-xs font-semibold', quick === x.id ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{x.label}{n !== undefined && <span className="ml-1 opacity-70">{n}</span>}</button>
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <div className="relative col-span-2 md:col-span-1">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input id="proj-search" className="pl-8" placeholder="Search number, name, city, PM, line" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select id="proj-program" value={program} onChange={(e) => setProgram(e.target.value)} options={[{ value: '', label: 'All programs' }, ...s.programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
            <Select id="proj-phase" value={phase} onChange={(e) => setPhase(e.target.value)} options={[{ value: '', label: 'All phases' }, ...PHASES.map((p, i) => ({ value: String(i), label: p }))]} />
            <Select id="proj-status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Active & on hold' }, { value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'on-hold', label: 'On hold' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }]} />
            <Select id="proj-pm" value={pm} onChange={(e) => setPm(e.target.value)} options={[{ value: '', label: 'All PMs' }, ...pms.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span><b className="tabular-nums text-ink">{rows.length}</b> projects</span>
            <span>Budget <b className="tabular-nums text-ink">{money(totBudget)}</b></span>
            <span>EAC <b className={cx('tabular-nums', totEac > totBudget ? 'text-bad' : 'text-ink')}>{money(totEac)}</b></span>
            <span>Actual <b className="tabular-nums text-ink">{money(sum(rows.map((r) => r.pos.actualToDate)))}</b></span>
            {(q || program || phase || pm || status !== 'open' || quick !== 'all') && <button className="font-semibold text-link hover:underline" onClick={() => { setQ(''); setProgram(''); setPhase(''); setPm(''); setStatus('open'); setQuick('all') }}>Clear filters</button>}
            {quick === 'mine' && mineCount === 0 && <Badge tone="info">You are not on any project team. Switch persona to a PM to see theirs.</Badge>}
          </div>
        </div>
        {view === 'table' ? (
          <Table rows={rows} columns={columns} rowKey={(r) => r.p.id} onRowClick={(r) => go(projectHref(r.p.id))} maxHeight={680}
            empty={<div className="p-4"><Empty title="No projects match">Change the filters or clear them.</Empty></div>} />
        ) : (
          <div className="p-3">{rows.length ? <TerritoryMap rows={rows} /> : <Empty title="No projects match">Change the filters or clear them.</Empty>}</div>
        )}
      </Panel>
    </div>
  )
}
