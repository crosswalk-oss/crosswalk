// Monthly forecast cycle across the portfolio: where each project's forecast stands this cycle, a
// "Start cycle" action that opens drafts for everyone, ETC / EAC by WBS function across the portfolio, and the
// portfolio roll-up by WBS function × year.
import { useMemo, useState } from 'react'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { actualsThrough } from '@/core/engine/wbs'
import { saveFile, toCSV, htmlDoc } from '@/core/download'
import { cx, fmtDate, fmtMonth, money, moneyDelta, sum } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Empty, Panel, PageHeader, SegButtons, Stat, StatusBadge, Table, type Column } from '@/ui/kit'
import { BarChart, SERIES } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { ProgramSelect, ProgramTag } from '../shared/pickers'
import { EtcEacTable } from './EtcEac'
import {
  portfolioEtcEac, portfolioEtcEacCsv, currentCycle, cycleRows, monthLabel, rollup, rollupCell, rollupCsvRows, rollupDetailRows, rollupFnTotal, rollupYearTotal, startCycle,
  type CycleRow, type CycleStatus, type RollupBasis, type SlipMode,
} from './lib'

const STATUS: Record<CycleStatus, { label: string; tone: string }> = {
  approved: { label: 'Approved', tone: 'approved' },
  'in-review': { label: 'In review', tone: 'in-review' },
  draft: { label: 'Draft', tone: 'draft' },
  returned: { label: 'Returned', tone: 'returned' },
  'not-started': { label: 'Not started', tone: 'pending' },
}
const ORDER: CycleStatus[] = ['not-started', 'returned', 'draft', 'in-review', 'approved']

export default function ForecastCycle(_props: { projectId?: string }) {
  const s = useStore()
  const me = useMe()
  const cycle = currentCycle(s)
  const [program, setProgram] = useState('')
  const [filter, setFilter] = useState<CycleStatus | ''>('')
  const all = useMemo(() => cycleRows(s, cycle), [s, cycle])
  const rows = all.filter((r) => !program || r.p.programId === program)
  const shown = rows.filter((r) => !filter || r.status === filter)
  const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r.status === k).length])) as Record<CycleStatus, number>
  const notStarted = all.filter((r) => r.status === 'not-started')
  const [slip, setSlip] = useState<SlipMode>('net')
  const canStart = me.roles.some((r) => ['admin', 'pmo', 'project-controls', 'finance'].includes(r))

  const start = () => {
    let res = { codes: [] as string[], moved: 0 }
    mutate((d) => { res = startCycle(d, me.id, slip) }, { entity: 'forecast', entityId: `cycle-${cycle}`, action: 'start-cycle', summary: `Opened the ${monthLabel(cycle)} forecast cycle: draft versions created for ${notStarted.length} projects (${notStarted.map((r) => r.p.code).join(', ')})` })
    toast(`${monthLabel(cycle)} cycle started — ${res.codes.length} drafts created`)
  }

  const eacT = sum(rows.map((r) => r.eac))
  const budT = sum(rows.map((r) => r.budget))
  const deltaT = sum(rows.map((r) => r.delta ?? 0))

  const cols: Column<CycleRow>[] = [
    { key: 'code', header: 'Project', sort: (r) => r.p.code, render: (r) => (
      <div className="flex min-w-0 items-center gap-2"><ProgramTag programId={r.p.programId} /><a href={projectHref(r.p.id, 'forecast')} className="font-mono text-[12px] font-semibold text-link hover:underline">{r.p.code}</a><span className="min-w-0 max-w-[260px] truncate" title={r.p.name}>{r.p.name}</span></div>
    ) },
    { key: 'pm', header: 'PM', sort: (r) => personName(s, r.p.team.pm), render: (r) => <span className="whitespace-nowrap text-muted">{personName(s, r.p.team.pm)}</span> },
    { key: 'status', header: `${monthLabel(cycle).split(' ')[0]} status`, sort: (r) => ORDER.indexOf(r.status), render: (r) => (
      <div className="flex flex-col gap-0.5"><StatusBadge status={STATUS[r.status].tone} label={STATUS[r.status].label} />{r.version && <span className="text-[11px] text-faint">{fmtDate(r.version.date)}</span>}</div>
    ) },
    { key: 'thru', header: 'Actuals thru', render: (r) => <span className="whitespace-nowrap text-muted">{fmtMonth(actualsThrough(s, r.p.id))}</span> },
    { key: 'budget', header: 'Budget', num: true, sort: (r) => r.budget, render: (r) => money(r.budget) },
    { key: 'eac', header: 'EAC', num: true, sort: (r) => r.eac, render: (r) => <span className={cx('font-semibold', r.eac > r.budget && 'text-bad')}>{money(r.eac)}{!r.version && r.latest && <span className="ml-1 text-[10.5px] font-normal text-faint" title={`Latest version ${r.latest.date}`}>last</span>}</span> },
    { key: 'var', header: 'Budget − EAC', num: true, sort: (r) => r.budget - r.eac, render: (r) => <span className={r.budget - r.eac < 0 ? 'text-bad' : 'text-muted'}>{moneyDelta(r.budget - r.eac)}</span> },
    { key: 'delta', header: 'vs prior approved', num: true, sort: (r) => r.delta ?? 0, render: (r) => (r.delta === undefined ? <span className="text-faint">—</span> : <span className={r.delta > 0 ? 'text-bad' : r.delta < 0 ? 'text-good' : 'text-faint'}>{r.delta ? moneyDelta(r.delta) : 'no change'}</span>) },
    { key: 'open', header: '', render: (r) => <a href={projectHref(r.p.id, 'forecast')} className="whitespace-nowrap text-[12px] font-semibold text-link hover:underline">{r.status === 'not-started' ? 'Open' : r.status === 'draft' || r.status === 'returned' ? 'Edit spread' : 'View'} →</a> },
  ]

  return (
    <div>
      <PageHeader eyebrow="Cost control" title="Forecast cycle"
        subtitle={`Every active project re-spreads its estimate to complete across the ${s.settings.wbsFunctions.length} WBS functions each month. Project controls validates, the program manager accepts, and the approved version locks. Cycle month: ${monthLabel(cycle)} (opens after ${fmtMonth(actualsThrough(s, all[0]?.p.id ?? ''))} actuals close).`}
        actions={<>
          <ProgramSelect value={program} onChange={setProgram} />
          {notStarted.length > 0 && canStart && <ConfirmButton variant="marker" confirmLabel={`Create ${notStarted.length} drafts`} onConfirm={start}>Start {monthLabel(cycle).split(' ')[0]} cycle</ConfirmButton>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ORDER.map((k) => <Stat key={k} label={STATUS[k].label} value={counts[k]} tone={k === 'approved' && counts[k] === rows.length ? 'good' : k === 'returned' && counts[k] ? 'bad' : undefined} onClick={() => setFilter(filter === k ? '' : k)} sub={filter === k ? 'Filtered — click to clear' : `of ${rows.length} projects`} />)}
        <Stat label="Portfolio EAC" value={money(eacT)} tone={eacT > budT ? 'bad' : undefined} sub={`budget ${money(budT)} · ${moneyDelta(deltaT)} vs prior`} />
      </div>

      {notStarted.length > 0 && (
        <div className="mb-4">
          <Callout tone="marker" title={`${notStarted.length} project${notStarted.length === 1 ? '' : 's'} have no ${monthLabel(cycle)} forecast yet`}>
            <div className="flex flex-col gap-2">
              <span>Starting the cycle copies each project’s latest version into a draft with actuals through {fmtMonth(actualsThrough(s, notStarted[0].p.id))}. ETC left in months that have since closed is handled as chosen below; PMs then adjust the spread by hand.</span>
              <div className="flex flex-wrap items-center gap-2 text-[12px]"><span className="font-semibold">ETC in closed months:</span>
                <SegButtons value={slip} onChange={setSlip} options={[{ id: 'net', label: 'Carry forward unspent' }, { id: 'all', label: 'Carry forward all' }, { id: 'drop', label: 'Drop' }]} />
              </div>
              {!canStart && <span className="text-[12px] text-muted">Only PMO, project controls or finance can open the cycle for everyone. PMs can start their own version from the project’s forecast tab.</span>}
            </div>
          </Callout>
        </div>
      )}

      <Panel title={`${monthLabel(cycle)} cycle by project`} subtitle={filter ? `Showing ${STATUS[filter].label.toLowerCase()} only` : `${rows.length} active projects with a budget`} pad={false}
        actions={filter ? <Button size="sm" variant="ghost" onClick={() => setFilter('')}>Clear filter</Button> : undefined}>
        <Table rows={shown} rowKey={(r) => r.p.id} columns={cols} dense empty={<div className="p-4"><Empty title="No projects match">Change the program or status filter.</Empty></div>} />
      </Panel>

      <PortfolioEtcEac program={program} />

      <Rollup program={program} />
    </div>
  )
}

function Rollup({ program }: { program: string }) {
  const s = useStore()
  const [basis, setBasis] = useState<RollupBasis>('latest')
  const [view, setView] = useState<'table' | 'chart'>('table')
  const projects = useMemo(() => s.projects.filter((p) => p.status === 'active' && (!program || p.programId === program)), [s.projects, program])
  const r = useMemo(() => rollup(s, projects, basis), [s, projects, basis])
  const prog = s.programs.find((x) => x.id === program)
  const scope = prog ? `${prog.code} ${prog.name}` : 'All programs'
  const nowY = s.settings.asOf.slice(0, 4)
  const grand = sum(r.years.map((y) => rollupYearTotal(r, y)))

  const exportCsv = async () => {
    const res = await saveFile(`forecast-rollup-${basis}-${prog?.code ?? 'all'}-${s.settings.asOf}.csv`, toCSV(rollupCsvRows(r)), 'text/csv')
    if (res === 'saved') toast('Roll-up exported for finance')
  }
  const exportDetail = async () => {
    const res = await saveFile(`forecast-detail-${basis}-${prog?.code ?? 'all'}-${s.settings.asOf}.csv`, toCSV(rollupDetailRows(s, r)), 'text/csv')
    if (res === 'saved') toast('Project detail exported')
  }
  const exportHtml = async () => {
    const th = r.years.map((y) => `<th>${y}</th>`).join('')
    const row = (code: string, name: string, vals: number[], total: number, b = false) => `<tr><td>${code}</td><td>${b ? '<b>' + name + '</b>' : name}</td>${vals.map((v) => `<td class="num">${v ? money(v, 'full') : '–'}</td>`).join('')}<td class="num"><b>${money(total, 'full')}</b></td></tr>`
    const body = `<h1>Capital forecast by WBS function</h1><p class="meta">${s.settings.orgName} · ${scope} · ${basis === 'latest' ? 'latest version of each project' : 'latest approved versions'} · ${r.projects.length} projects · as of ${fmtDate(s.settings.asOf)}</p>
<p class="meta">Each cell is recorded ERP actuals (through each version’s actuals month) plus time-phased ETC. Contingency held sits in each project’s final year.</p>
<table><thead><tr><th>Code</th><th>WBS function</th>${th}<th>Total</th></tr></thead><tbody>
${r.fns.map((f) => row(f.code, f.name, r.years.map((y) => rollupCell(r, f.id, y)), rollupFnTotal(r, f.id))).join('\n')}
${row('990', 'Contingency held', r.years.map((y) => r.contingency[y] || 0), sum(Object.values(r.contingency)))}
${row('', 'Total', r.years.map((y) => rollupYearTotal(r, y)), grand, true)}</tbody></table>
<h2>Projects included</h2><table><thead><tr><th>Project</th><th>Version</th><th>Status</th><th>EAC</th></tr></thead><tbody>${r.projects.map(({ p, version }) => `<tr><td>${p.code} ${p.name}</td><td>${version.date}</td><td>${version.status ?? ''}</td><td class="num">${money(version.eac, 'full')}</td></tr>`).join('')}</tbody></table>`
    const res = await saveFile(`forecast-rollup-${prog?.code ?? 'all'}-${s.settings.asOf}.html`, htmlDoc('Capital forecast by WBS function', body), 'text/html')
    if (res === 'saved') toast('Roll-up report saved')
  }

  const chartFns = [...r.fns].sort((a, b) => rollupFnTotal(r, b.id) - rollupFnTotal(r, a.id))
  const top = chartFns.slice(0, 5)
  const rest = chartFns.slice(5)
  const colors = [SERIES[0], SERIES[2], SERIES[5], SERIES[1], SERIES[3]]

  if (!r.projects.length) return <Panel title="Portfolio roll-up" className="mt-4"><Empty title="No forecasts in scope">No active project in {scope} has a {basis === 'approved' ? 'approved ' : ''}forecast version.</Empty></Panel>

  return (
    <Panel className="mt-4" title="Portfolio roll-up by WBS function × year" pad={false}
      subtitle={`${scope} · ${r.projects.length} projects · actuals + time-phased ETC, ${basis === 'latest' ? 'latest version of each project (drafts included)' : 'latest approved versions only'}`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <SegButtons value={basis} onChange={setBasis} options={[{ id: 'latest', label: 'Latest' }, { id: 'approved', label: 'Approved only' }]} />
        <SegButtons value={view} onChange={setView} options={[{ id: 'table', label: 'Table' }, { id: 'chart', label: 'Chart' }]} />
        <Button size="sm" onClick={exportCsv} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV for finance</Button>
        <Button size="sm" variant="ghost" onClick={exportDetail}>Project detail CSV</Button>
        <Button size="sm" variant="ghost" onClick={exportHtml}>Report</Button>
      </div>}>
      {view === 'table' ? (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th className="sticky left-0 z-[2] bg-sunken">WBS function</th>{r.years.map((y) => <th key={y} className={cx('num', y === nowY && 'text-ink')}>{y}{y < nowY ? ' A' : y === nowY ? ' A+F' : ' F'}</th>)}<th className="num">Total</th><th className="num">Share</th></tr></thead>
            <tbody>
              {r.fns.map((f) => {
                const t = rollupFnTotal(r, f.id)
                return (
                  <tr key={f.id}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-surface"><span className="font-mono text-[11px] text-faint">{f.code}</span> <span className={cx(f.retired && 'text-muted line-through')}>{f.name}</span></td>
                    {r.years.map((y) => { const a = r.actual[f.id]?.[y] || 0, v = rollupCell(r, f.id, y); return <td key={y} className="num" title={`Actual ${money(a, 'full')} · forecast ${money(v - a, 'full')}`}>{v ? money(v) : <span className="text-faint">–</span>}</td> })}
                    <td className="num font-semibold">{money(t)}</td>
                    <td className="num text-muted">{grand ? `${((t / grand) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                )
              })}
              <tr>
                <td className="sticky left-0 z-[1] bg-surface"><span className="font-mono text-[11px] text-faint">990</span> Contingency held</td>
                {r.years.map((y) => <td key={y} className="num text-muted">{r.contingency[y] ? money(r.contingency[y]) : '–'}</td>)}
                <td className="num font-semibold">{money(sum(Object.values(r.contingency)))}</td>
                <td className="num text-muted">{grand ? `${((sum(Object.values(r.contingency)) / grand) * 100).toFixed(1)}%` : ''}</td>
              </tr>
              <tr className="bg-sunken font-semibold">
                <td className="sticky left-0 z-[1] bg-sunken">Total</td>
                {r.years.map((y) => <td key={y} className="num">{money(rollupYearTotal(r, y))}</td>)}
                <td className="num">{money(grand)}</td><td className="num">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4">
          <BarChart labels={r.years} stacked height={260} series={[
            ...top.map((f, i) => ({ name: `${f.code} ${f.name}`, values: r.years.map((y) => rollupCell(r, f.id, y)), color: colors[i] })),
            { name: 'Other functions', values: r.years.map((y) => sum(rest.map((f) => rollupCell(r, f.id, y)))), color: 'rgb(var(--muted) / 0.55)' },
            { name: 'Contingency held', values: r.years.map((y) => r.contingency[y] || 0), color: 'rgb(var(--faint) / 0.5)' },
          ]} />
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
        <span><b className="text-ink">A</b> recorded actuals · <b className="text-ink">F</b> forecast ETC · hover a cell for the split</span>
        <span>Loaders and escalation are allocated to functions pro-rata to direct cost</span>
        <span className="ml-auto"><Badge tone="neutral">{r.projects.filter((x) => x.version.status !== 'approved').length} unapproved versions included</Badge></span>
      </div>
    </Panel>
  )
}

function PortfolioEtcEac({ program }: { program: string }) {
  const s = useStore()
  const [basis, setBasis] = useState<RollupBasis>('latest')
  const projects = useMemo(() => s.projects.filter((p) => p.status === 'active' && (!program || p.programId === program)), [s.projects, program])
  const r = useMemo(() => portfolioEtcEac(s, projects, basis), [s, projects, basis])
  const prog = s.programs.find((x) => x.id === program)
  const scope = prog ? `${prog.code} ${prog.name}` : 'All programs'
  const exportCsv = async () => {
    const res = await saveFile(`etc-eac-by-function-${basis}-${prog?.code ?? 'all'}-${s.settings.asOf}.csv`, toCSV(portfolioEtcEacCsv(r)), 'text/csv')
    if (res === 'saved') toast('ETC / EAC by function exported')
  }
  if (!r.projects.length) return null
  const worst = [...r.rows].sort((a, b) => a.vac - b.vac)[0]
  return (
    <Panel className="mt-4" pad={false} title="ETC / EAC by WBS function — portfolio"
      subtitle={`${scope} · ${r.projects.length} projects · SAP actuals to each version’s actuals month + ETC by forecast line item, ${basis === 'latest' ? 'latest version of each project' : 'latest approved versions only'}`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <SegButtons value={basis} onChange={setBasis} options={[{ id: 'latest', label: 'Latest' }, { id: 'approved', label: 'Approved only' }]} />
        <Button size="sm" onClick={exportCsv} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV</Button>
      </div>}>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line md:grid-cols-4">
        <PFig label="Budget" value={money(r.totals.budget)} sub={`incl. ${money(r.budgetContingency)} contingency`} />
        <PFig label="Actual to date" value={money(r.totals.actual)} sub={r.totals.eac ? `${Math.round((r.totals.actual / r.totals.eac) * 100)}% of EAC spent` : ''} />
        <PFig label="EAC" value={money(r.totals.eac)} tone={r.totals.vac < 0 ? 'bad' : undefined} sub={`ETC ${money(r.totals.etc)} incl. ${money(r.contingencyHeld)} held`} />
        <PFig label="VAC" value={moneyDelta(r.totals.vac)} tone={r.totals.vac < 0 ? 'bad' : 'good'} sub={worst && worst.vac < 0 ? `largest overrun ${worst.code} ${worst.name} ${moneyDelta(worst.vac)}` : 'no function over budget'} />
      </div>
      <EtcEacTable s={s} rows={r.rows.map((x) => ({ ...x, note: x.over.length ? (
        <div className="flex flex-wrap gap-1">{x.over.slice(0, 4).map((o) => <a key={o.p.id} href={projectHref(o.p.id, 'forecast')} title={`${o.p.name}: ${moneyDelta(o.vac)}`} className="rounded border border-bad/30 bg-bad/10 px-1 font-mono text-[11px] text-bad hover:underline">{o.p.code.replace('PRJ-', '')}</a>)}{x.over.length > 4 && <span className="text-[11px] text-faint">+{x.over.length - 4}</span>}</div>
      ) : <span className="text-[11.5px] text-faint">none</span> }))}
        showProfile={false} extraHeader="Projects over" contingencyBudget={r.budgetContingency} contingencyHeld={r.contingencyHeld} totals={r.totals} />
    </Panel>
  )
}

function PFig({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2.5">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-0.5 font-display text-[20px] font-bold leading-tight tabular-nums', tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink')}>{value}</div>
      {sub && <div className="truncate text-[11.5px] text-muted" title={sub}>{sub}</div>}
    </div>
  )
}
