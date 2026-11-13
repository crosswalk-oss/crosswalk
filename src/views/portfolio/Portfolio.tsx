// Executive portfolio dashboard (home). Summary first: funding position, stage mix, health, variances,
// contingency, gates, safety leading indicators and a "needs attention" queue. Every row links to its project.
import React, { useMemo, useState } from 'react'
import { useStore } from '@/core/store'
import { go, projectHref } from '@/core/router'
import { templateFor } from '@/core/engine/gates'
import { fmtDate, money, moneyDelta, sum, cx, daysBetween, pct } from '@/core/util'
import { saveFile, toCSV } from '@/core/download'
import type { AppState, Project, RAG } from '@/core/types'
import { Badge, Button, HealthDot, PageHeader, Panel, SegButtons, Empty, Progress, Mono } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { PHASES, PHASE_CLS, allInFigures, needsAttention, projectRow, safetyIndicators, yearFigures, type FundingFigures, type ProjectRow } from './lib'

const DIMS: { key: keyof Project['health']; label: string }[] = [
  { key: 'scope', label: 'Scope' }, { key: 'schedule', label: 'Sched' }, { key: 'cost', label: 'Cost' }, { key: 'risk', label: 'Risk' }, { key: 'safety', label: 'Safety' },
]

export default function Portfolio(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const [prog, setProg] = useState<string>('all')
  const year = Number(s.settings.asOf.slice(0, 4))
  const programs = s.programs
  const programIds = prog === 'all' ? programs.map((p) => p.id) : [prog]
  const projects = useMemo(() => s.projects.filter((p) => programIds.includes(p.programId)), [s.projects, prog]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => projects.map((p) => projectRow(s, p)), [s, projects])
  const live = rows.filter((r) => r.p.status === 'active' || r.p.status === 'on-hold')
  const yr = useMemo(() => yearFigures(s, projects, programIds, year), [s, projects]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => allInFigures(s, projects, programIds), [s, projects]) // eslint-disable-line react-hooks/exhaustive-deps
  const attention = useMemo(() => needsAttention(s, projects), [s, projects])
  const safety = useMemo(() => safetyIndicators(s, projects), [s, projects])
  const reviews = s.gateReviews.filter((g) => g.status === 'scheduled' && projects.some((p) => p.id === g.projectId) && g.scheduled >= s.settings.asOf).sort((a, b) => a.scheduled.localeCompare(b.scheduled))
  const inConstruction = live.filter((r) => r.phase === 3 && r.p.status === 'active').length
  const overBudget = live.filter((r) => r.variance > 0 && r.budgetBasis === 'control')
  const exposure = sum(live.map((r) => r.pos.riskExposure))
  const contRemaining = sum(live.map((r) => r.pos.contingencyRemaining))

  const exportCsv = async () => {
    const res = await saveFile(`portfolio-${s.settings.asOf}.csv`, toCSV(rows.map((r) => ({
      Project: r.p.code, Name: r.p.name, Program: r.programCode, Stage: r.stageName, Status: r.p.status, PM: r.pmName,
      Budget: r.budget, BudgetBasis: r.budgetBasis, EAC: r.eac, Variance: r.variance, ActualToDate: r.pos.actualToDate, ContingencyRemaining: r.pos.contingencyRemaining, RiskExposure: r.pos.riskExposure,
      Scope: r.p.health.scope, Schedule: r.p.health.schedule, Cost: r.p.health.cost, Risk: r.p.health.risk, Safety: r.p.health.safety, GateReadinessPct: r.readiness,
    }))), 'text/csv')
    if (res === 'saved') toast('Portfolio exported to CSV')
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={<>{s.settings.orgName} · Capital portfolio · as of {fmtDate(s.settings.asOf)}</>}
        title="Portfolio"
        subtitle="Authorized funding against budgets, forecasts and actuals, with stage-gate position, health and safety leading indicators. Every figure traces to an approved budget, forecast or ERP period."
        actions={<>
          <Button icon={<Icon name="download" className="h-4 w-4" />} onClick={exportCsv}>Export</Button>
          <a href="#projects"><Button variant="primary" icon={<Icon name="list" className="h-4 w-4" />}>Project register</Button></a>
        </>}
      >
        <div className="scroll-x -mx-1 px-1">
          <SegButtons value={prog} onChange={setProg} options={[{ id: 'all', label: 'All programs' }, ...programs.map((p) => ({ id: p.id, label: p.code }))]} />
        </div>
      </PageHeader>

      {/* ── Funding position */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Funding position" subtitle={prog === 'all' ? 'All programs' : programs.find((p) => p.id === prog)?.name}>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FundingBlock title={`${year} plan year`} f={yr} note={`Budget is the ${year} spread of approved budgets; forecast adds remaining-year spend at each project's EAC/budget ratio.`} />
            <FundingBlock title="All-in (life of projects)" f={all} note="Authorized is the sum of funding envelopes 2024–2031 across rate-case cycles; budget, EAC and actuals are project totals." />
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Active projects" value={String(rows.filter((r) => r.p.status === 'active').length)} sub={`${inConstruction} in construction · ${rows.filter((r) => r.p.status === 'on-hold').length} on hold`} href="#projects" />
          <Tile label="Forecast over budget" value={String(overBudget.length)} sub={overBudget.length ? `${moneyDelta(sum(overBudget.map((r) => r.variance)))} combined` : 'None above control budget'} tone={overBudget.length ? 'bad' : 'good'} href="#projects" />
          <Tile label="Contingency remaining" value={money(contRemaining)} sub={`vs ${money(exposure)} open risk exposure`} tone={contRemaining < exposure ? 'warn' : undefined} href="#risk" />
          <Tile label="Gate reviews ≤ 60 days" value={String(reviews.filter((g) => daysBetween(s.settings.asOf, g.scheduled) <= 60).length)} sub={reviews[0] ? `Next ${fmtDate(reviews[0].scheduled)}` : 'None scheduled'} href="#gates" />
        </div>
      </div>

      {/* ── Stage mix + contingency */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Projects by stage" subtitle="Count and current budget by lifecycle phase. VAP's three condensed stages map onto the same phases.">
          <StageFunnel s={s} rows={rows.filter((r) => r.p.status !== 'cancelled')} programIds={programIds} />
        </Panel>
        <Panel title="Contingency remaining by program" subtitle="Approved contingency on control budgets, less approved draws and contingency-funded changes.">
          <ContingencyByProgram s={s} rows={live} programIds={programIds} />
        </Panel>
      </div>

      {/* ── Health + attention */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title="Health heat map" subtitle="Active and on-hold projects, worst first" pad={false} actions={<HealthLegend />}>
          <HealthMap rows={live} />
        </Panel>
        <Panel title={<span className="flex items-center gap-2">Needs attention <Badge tone={attention.length ? 'marker' : 'good'}>{attention.length}</Badge></span>} subtitle="Red health, overdue or due workflow steps, expiring permits and 811 tickets, unexplained variances" pad={false}>
          <AttentionList items={attention} />
        </Panel>
      </div>

      {/* ── Variances, gates, safety */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Top variances" subtitle="Forecast (EAC) against current budget" pad={false}>
          <TopVariances rows={live.filter((r) => r.budgetBasis === 'control' || r.budgetBasis === 'planning')} />
        </Panel>
        <Panel title="Upcoming gate reviews" subtitle="Scheduled board dates with current readiness" pad={false} actions={<a href="#gates" className="text-xs font-semibold text-link hover:underline">Gate calendar</a>}>
          {reviews.length === 0 ? <div className="p-4"><Empty title="No gate reviews scheduled" /></div> : (
            <ul className="divide-y divide-line">
              {reviews.slice(0, 8).map((g) => {
                const r = rows.find((x) => x.p.id === g.projectId)!
                const d = daysBetween(s.settings.asOf, g.scheduled)
                const gateName = templateFor(s, r.p).stages[g.stageIndex]?.gate.name ?? ''
                return (
                  <li key={g.id}>
                    <a href={projectHref(g.projectId, 'lifecycle')} className="flex items-center gap-3 px-4 py-2.5 hover:bg-sunken/60">
                      <div className="w-12 shrink-0 text-center leading-tight">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{fmtDate(g.scheduled).slice(0, 3)}</div>
                        <div className="font-display text-[19px] font-bold tabular-nums">{Number(g.scheduled.slice(8, 10))}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs text-muted"><ProgramTag programId={r.p.programId} /><Mono className="font-semibold text-ink">{r.p.code}</Mono><span className="truncate">{gateName}</span></div>
                        <div className="truncate text-[13px] font-semibold">{r.p.name}</div>
                        <div className="mt-1 flex items-center gap-2"><Progress value={r.readiness} tone={r.readiness >= 80 ? 'good' : r.readiness >= 50 ? 'warn' : 'bad'} className="max-w-[140px]" /><span className="text-[11px] tabular-nums text-muted">{r.readiness}% ready</span></div>
                      </div>
                      <span className={cx('shrink-0 text-xs tabular-nums', d <= 14 ? 'font-semibold text-ink' : 'text-faint')}>in {d}d</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Safety leading indicators" subtitle="Construction work in the field" className="lg:col-span-2 2xl:col-span-1">
          <SafetyBlock s={s} ind={safety} />
        </Panel>
      </div>
    </div>
  )
}

// ───────────────────────────── pieces

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad'; href: string }) {
  const t = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <a href={href} className="min-w-0 rounded-md border border-line bg-surface px-4 py-3 hover:border-ink/40">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-1 font-display text-[26px] font-bold leading-none tabular-nums', t)}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </a>
  )
}

function FundingBlock({ title, f, note }: { title: string; f: FundingFigures; note: string }) {
  const max = Math.max(f.authorized, f.budget, f.eac, f.actual, 1)
  const items: { k: string; v: number; cls: string; strong?: boolean }[] = [
    { k: 'Authorized', v: f.authorized, cls: 'bg-ink/25' },
    { k: 'Budget', v: f.budget, cls: 'bg-muted/70' },
    { k: 'Forecast (EAC)', v: f.eac, cls: f.eac > f.budget ? 'bg-bad/80' : 'bg-link', strong: true },
    { k: 'Actual', v: f.actual, cls: 'bg-good/80' },
  ]
  const headroom = f.authorized - f.eac
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        <span className={cx('text-xs font-semibold tabular-nums', headroom < 0 ? 'text-bad' : 'text-good')}>{headroom < 0 ? `${money(-headroom)} over authorized` : `${money(headroom)} headroom`}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <div key={it.k} className="grid grid-cols-[96px_1fr_64px] items-center gap-2 text-[12px]">
            <span className={cx('text-muted', it.strong && 'font-semibold text-ink')}>{it.k}</span>
            <span className="h-3.5 rounded-sm bg-sunken"><span className={cx('block h-3.5 rounded-sm', it.cls)} style={{ width: `${(it.v / max) * 100}%` }} /></span>
            <span className={cx('text-right font-semibold tabular-nums', it.strong && f.eac > f.budget && 'text-bad')}>{money(it.v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-2 text-[11px]">
        <div><div className="text-faint">EAC vs budget</div><div className={cx('font-semibold tabular-nums', f.eac > f.budget ? 'text-bad' : 'text-good')}>{moneyDelta(f.eac - f.budget)}</div></div>
        <div><div className="text-faint">Spent of budget</div><div className="font-semibold tabular-nums">{f.budget ? pct(f.actual / f.budget) : '—'}</div></div>
        <div><div className="text-faint">Budget of authorized</div><div className="font-semibold tabular-nums">{f.authorized ? pct(f.budget / f.authorized) : '—'}</div></div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">{note}</p>
    </div>
  )
}

function StageFunnel({ s, rows, programIds }: { s: AppState; rows: ProjectRow[]; programIds: string[] }) {
  const [mode, setMode] = useState<'count' | 'dollars'>('count')
  const progs = s.programs.filter((p) => programIds.includes(p.id))
  const val = (r: ProjectRow) => (mode === 'count' ? 1 : r.budget)
  const totals = progs.map((pr) => sum(rows.filter((r) => r.p.programId === pr.id).map(val)))
  const max = Math.max(...totals, 1)
  const phaseTotals = PHASES.map((_, i) => rows.filter((r) => r.phase === i))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {PHASES.map((ph, i) => <span key={ph} className="inline-flex items-center gap-1.5"><span className={cx('inline-block h-2.5 w-2.5 rounded-sm', PHASE_CLS[i])} />{ph}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-faint" />Closed</span>
        </div>
        <SegButtons value={mode} onChange={setMode} options={[{ id: 'count', label: 'Count' }, { id: 'dollars', label: 'Budget $' }]} />
      </div>
      {progs.map((pr, pi) => {
        const pr_rows = rows.filter((r) => r.p.programId === pr.id)
        const total = totals[pi]
        return (
          <div key={pr.id} className="grid grid-cols-[48px_1fr_64px] items-center gap-2">
            <ProgramTag programId={pr.id} />
            <div className="flex h-6 overflow-hidden rounded-sm bg-sunken" style={{ width: `${Math.max(8, (total / max) * 100)}%` }}>
              {PHASES.map((ph, i) => {
                const seg = pr_rows.filter((r) => r.phase === i && r.p.status !== 'closed')
                const v = sum(seg.map(val))
                if (!v) return null
                return <span key={ph} title={`${pr.code} · ${ph}: ${seg.length} project(s), ${money(sum(seg.map((r) => r.budget)))}\n${seg.map((r) => r.p.code).join(', ')}`} className={cx('flex items-center justify-center border-r border-surface text-[11px] font-bold', PHASE_CLS[i], i >= 2 ? 'text-white' : 'text-ink')} style={{ width: `${(v / total) * 100}%` }}>{mode === 'count' ? seg.length : ''}</span>
              })}
              {(() => { const seg = pr_rows.filter((r) => r.p.status === 'closed'); const v = sum(seg.map(val)); return v ? <span title={`Closed: ${seg.map((r) => r.p.code).join(', ')}`} className="flex items-center justify-center border border-dashed border-faint text-[11px] text-muted" style={{ width: `${(v / total) * 100}%` }}>{mode === 'count' ? seg.length : ''}</span> : null })()}
            </div>
            <span className="text-right text-xs font-semibold tabular-nums">{mode === 'count' ? pr_rows.length : money(total)}</span>
          </div>
        )
      })}
      <div className="scroll-x mt-1 border-t border-line pt-2">
        <table className="w-full text-[12px]">
          <tbody>
            <tr>{PHASES.map((ph, i) => <td key={ph} className="pr-2 align-top"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{ph}</div><div className="font-display text-[17px] font-bold tabular-nums">{phaseTotals[i].filter((r) => r.p.status !== 'closed').length}</div><div className="tabular-nums text-muted">{money(sum(phaseTotals[i].filter((r) => r.p.status !== 'closed').map((r) => r.budget)))}</div></td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContingencyByProgram({ s, rows, programIds }: { s: AppState; rows: ProjectRow[]; programIds: string[] }) {
  const data = s.programs.filter((p) => programIds.includes(p.id)).map((pr) => {
    const rs = rows.filter((r) => r.p.programId === pr.id && r.pos.contingencyOriginal > 0)
    const orig = sum(rs.map((r) => r.pos.contingencyOriginal))
    const used = sum(rs.map((r) => r.pos.contingencyUsed))
    const pending = sum(s.contingencyDraws.filter((d) => d.status === 'in-review' && rs.some((r) => r.p.id === d.projectId)).map((d) => d.amount))
    const exp = sum(rs.map((r) => r.pos.riskExposure))
    return { pr, orig, used, rem: orig - used, pending, exp, rs }
  })
  return (
    <div className="flex flex-col gap-3">
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Program</th><th className="num">Original</th><th className="num">Used</th><th className="num">Pending</th><th className="num">Remaining</th><th style={{ minWidth: 140 }}>Remaining vs exposure</th></tr></thead>
          <tbody>
            {data.map((d) => {
              const remPct = d.orig ? d.rem / d.orig : 0
              const covered = d.exp <= 0 ? 1 : d.rem / d.exp
              return (
                <tr key={d.pr.id}>
                  <td><span className="flex items-center gap-2"><ProgramTag programId={d.pr.id} /><span className="hidden text-muted sm:inline">{d.rs.length} budgets</span></span></td>
                  <td className="num">{money(d.orig)}</td>
                  <td className="num">{money(d.used)}</td>
                  <td className="num">{d.pending ? <span className="text-info">{money(d.pending)}</span> : '—'}</td>
                  <td className={cx('num font-semibold', remPct < 0.25 && d.orig ? 'text-warn' : '')}>{money(d.rem)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Progress value={remPct * 100} tone={remPct < 0.25 ? 'warn' : 'ink'} className="max-w-[110px]" />
                      <span className={cx('text-[11px] tabular-nums', covered < 1 ? 'text-bad' : 'text-muted')} title={`Open risk exposure ${money(d.exp)}`}>{d.exp > 0 ? `${Math.round(covered * 100)}% cover` : '—'}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-faint">Cover = contingency remaining ÷ expected value of open threats less opportunities. Below 100% means the register's expected cost exceeds what is left.</p>
    </div>
  )
}

function HealthLegend() {
  return <span className="flex items-center gap-2 text-[11px] text-muted"><HealthDot rag="green" /> On track <HealthDot rag="amber" /> Watch <HealthDot rag="red" /> Act</span>
}

function HealthMap({ rows }: { rows: ProjectRow[] }) {
  const score = (r: ProjectRow) => sum(Object.values(r.p.health).map((h: RAG) => (h === 'red' ? 3 : h === 'amber' ? 1 : 0)))
  const sorted = rows.slice().sort((a, b) => score(b) - score(a) || b.budget - a.budget)
  return (
    <div className="scroll-x" style={{ maxHeight: 460, overflowY: 'auto' }}>
      <table className="tbl">
        <thead><tr><th>Project</th>{DIMS.map((d) => <th key={d.key} className="text-center">{d.label}</th>)}<th className="num">EAC</th></tr></thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.p.id} className="clickable" onClick={() => go(projectHref(r.p.id))}>
              <td className="min-w-[200px]">
                <a href={projectHref(r.p.id)} className="flex min-w-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <ProgramTag programId={r.p.programId} />
                  <Mono className="font-semibold">{r.p.code}</Mono>
                  <span className="truncate text-muted" title={r.p.name}>{r.p.name.length > 34 ? r.p.name.slice(0, 33) + '…' : r.p.name}</span>
                  {r.p.status === 'on-hold' && <Badge tone="warn">Hold</Badge>}
                </a>
              </td>
              {DIMS.map((d) => <td key={d.key} className="text-center"><HealthCell rag={r.p.health[d.key]} label={`${r.p.code} ${d.label}`} /></td>)}
              <td className="num">{money(r.eac)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HealthCell({ rag, label }: { rag: RAG; label: string }) {
  const c = rag === 'green' ? 'bg-good/70' : rag === 'amber' ? 'bg-warn' : 'bg-bad'
  return <span title={`${label}: ${rag}`} className={cx('mx-auto block h-4 w-7 rounded-sm', c, rag === 'green' && 'opacity-40')} />
}

function AttentionList({ items }: { items: ReturnType<typeof needsAttention> }) {
  const [kind, setKind] = useState<string>('all')
  const kinds = Array.from(new Set(items.map((i) => i.kind)))
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind)
  if (!items.length) return <div className="p-4"><Empty title="Nothing needs attention">No red health, overdue steps or expiring permits in this view.</Empty></div>
  return (
    <div>
      <div className="scroll-x flex gap-1 border-b border-line px-3 py-2">
        <FilterChip on={kind === 'all'} onClick={() => setKind('all')}>All {items.length}</FilterChip>
        {kinds.map((k) => <FilterChip key={k} on={kind === k} onClick={() => setKind(k)}>{k} {items.filter((i) => i.kind === k).length}</FilterChip>)}
      </div>
      <ul className="divide-y divide-line overflow-y-auto" style={{ maxHeight: 412 }}>
        {shown.map((it) => (
          <li key={it.id}>
            <a href={it.href} className="flex items-start gap-3 px-4 py-2 hover:bg-sunken/60">
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', it.severity === 'bad' ? 'bg-bad' : 'bg-warn')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]"><span className={cx('font-semibold uppercase tracking-wide', it.severity === 'bad' ? 'text-bad' : 'text-warn')}>{it.kind}</span><Mono className="text-muted">{it.code}</Mono></div>
                <div className="truncate text-[13px] font-semibold">{it.label}</div>
                <div className="text-xs text-muted">{it.detail}</div>
              </div>
              <Icon name="arrow" className="mt-2 h-3.5 w-3.5 shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cx('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', on ? 'border-link bg-link text-surface' : 'border-line text-muted hover:text-ink')}>{children}</button>
}

function TopVariances({ rows }: { rows: ProjectRow[] }) {
  const sorted = rows.filter((r) => r.budget > 0).sort((a, b) => b.variance - a.variance).slice(0, 8)
  const max = Math.max(...sorted.map((r) => Math.abs(r.variance)), 1)
  if (!sorted.length) return <div className="p-4"><Empty title="No budgets yet" /></div>
  return (
    <ul className="divide-y divide-line">
      {sorted.map((r) => {
        const over = r.variance > 0
        return (
          <li key={r.p.id}>
            <a href={projectHref(r.p.id, 'cost')} className="block px-4 py-2 hover:bg-sunken/60">
              <div className="flex items-center gap-2 text-[13px]">
                <Mono className="font-semibold">{r.p.code}</Mono>
                <span className="min-w-0 flex-1 truncate text-muted">{r.p.name}</span>
                <span className={cx('font-semibold tabular-nums', over ? 'text-bad' : 'text-good')}>{moneyDelta(r.variance)}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1fr_1fr] items-center gap-0">
                <div className="flex justify-end border-r border-line pr-px">{!over && <span className="h-2 rounded-l-sm bg-good/70" style={{ width: `${(Math.abs(r.variance) / max) * 100}%` }} />}</div>
                <div className="flex pl-px">{over && <span className="h-2 rounded-r-sm bg-bad/80" style={{ width: `${(r.variance / max) * 100}%` }} />}</div>
              </div>
              <div className="mt-0.5 flex justify-between text-[11px] tabular-nums text-faint"><span>Budget {money(r.budget)} · EAC {money(r.eac)}</span><span>{r.variancePct ? `${r.variancePct > 0 ? '+' : ''}${(r.variancePct * 100).toFixed(1)}%` : ''}</span></div>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function SafetyBlock({ s, ind }: { s: AppState; ind: ReturnType<typeof safetyIndicators> }) {
  const delta = ind.tb7.length - ind.tbPrior.length
  const attendees = sum(ind.tb7.map((t) => t.attendees.length))
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <a href="#safety" className="rounded-md border border-line px-3 py-2 hover:border-ink/40">
          <div className="eyebrow">Tailboards · 7 days</div>
          <div className="mt-0.5 font-display text-[24px] font-bold tabular-nums">{ind.tb7.length}</div>
          <div className="text-[11px] text-muted">{attendees} sign-ins · {delta >= 0 ? '+' : ''}{delta} vs prior week</div>
        </a>
        <a href="#safety" className={cx('rounded-md border px-3 py-2 hover:border-ink/40', ind.sifOpen.length ? 'border-bad/50 bg-bad/5' : 'border-line')}>
          <div className="eyebrow">Open SIF-potential</div>
          <div className={cx('mt-0.5 font-display text-[24px] font-bold tabular-nums', ind.sifOpen.length ? 'text-bad' : 'text-good')}>{ind.sifOpen.length}</div>
          <div className="text-[11px] text-muted">Serious injury or fatality potential</div>
        </a>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-faint">Observations 30d</div><div className="font-semibold tabular-nums">{ind.obs30.length}</div></div>
        <div><div className="text-faint">Near misses 30d</div><div className="font-semibold tabular-nums">{ind.nearMiss30.length}</div></div>
        <div><div className="text-faint">Plans in review</div><div className="font-semibold tabular-nums">{ind.plansInReview.length}</div></div>
      </div>
      {ind.sifOpen.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {ind.sifOpen.map((e) => {
            const p = s.projects.find((x) => x.id === e.projectId)!
            return (
              <li key={e.id}><a href={projectHref(e.projectId, 'safety')} className="flex items-start gap-2 rounded border border-bad/30 px-2.5 py-1.5 text-[12px] hover:bg-bad/5">
                <Badge tone="bad">SIF</Badge>
                <span className="min-w-0 flex-1"><Mono className="font-semibold">{p.code}</Mono> <span className="text-muted">{fmtDate(e.date)} · {e.type}</span><span className="block">{e.description}</span></span>
              </a></li>
            )
          })}
        </ul>
      )}
      <div>
        <div className="eyebrow mb-1">Tailboards by site · last 7 days</div>
        <div className="flex flex-col gap-1">
          {ind.byProject.filter((x) => x.tb).sort((a, b) => b.tb - a.tb).map((x) => (
            <a key={x.p.id} href={projectHref(x.p.id, 'safety')} className="grid grid-cols-[70px_1fr_28px] items-center gap-2 text-[12px] hover:text-link">
              <Mono className="font-semibold">{x.p.code}</Mono>
              <span className="flex gap-0.5">{Array.from({ length: 5 }, (_, i) => <span key={i} className={cx('h-2.5 flex-1 rounded-sm', i < x.tb ? 'bg-good/70' : 'bg-sunken')} />)}</span>
              <span className="text-right tabular-nums text-muted">{x.tb}/5</span>
            </a>
          ))}
          {!ind.byProject.some((x) => x.tb) && <span className="text-[12px] text-muted">No construction work in the field for this selection.</span>}
        </div>
      </div>
    </div>
  )
}
