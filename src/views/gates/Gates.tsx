// Portfolio gate calendar (SG-11) and gate metrics (SG-12): upcoming reviews, readiness heat map
// across active projects, days per stage by program, recycle rate and waivers granted.
import { useMemo, useState } from 'react'
import { personName, useStore } from '@/core/store'
import { go, projectHref } from '@/core/router'
import type { AppState, GateReview, Project } from '@/core/types'
import { readiness, requiredDefs, templateFor } from '@/core/engine/gates'
import { addDays, cx, daysBetween, fmtDate, fmtMonth, groupBy, sum } from '@/core/util'
import { saveFile, toCSV } from '@/core/download'
import { Avatar, Badge, Button, ClassBadge, Empty, Mono, PageHeader, Panel, Progress, SegButtons, Select, Stat } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { stageDurations } from '../portfolio/lib'
import { ScheduleReviewModal } from './ScheduleReview'

export default function Gates(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [program, setProgram] = useState('')
  const [sched, setSched] = useState<{ open: boolean; pid?: string }>({ open: false })
  const asOf = s.settings.asOf
  const inProg = (p: Project) => !program || p.programId === program
  const reviews = s.gateReviews.filter((g) => g.status === 'scheduled' && inProg(s.projects.find((p) => p.id === g.projectId)!)).sort((a, b) => a.scheduled.localeCompare(b.scheduled))
  const active = s.projects.filter((p) => p.status === 'active' && inProg(p))
  const unscheduled = active.filter((p) => !s.gateReviews.some((g) => g.projectId === p.id && g.stageIndex === p.stageIndex && g.status === 'scheduled'))
  const readyUnscheduled = unscheduled.filter((p) => readiness(s, p).pct >= 80)
  const decisions = s.gateDecisions.filter((g) => inProg(s.projects.find((p) => p.id === g.projectId)!))
  const last12 = decisions.filter((g) => g.date > addDays(asOf, -365))
  const recycles = last12.filter((g) => g.outcome === 'recycle').length
  const waivers = s.workflows.filter((w) => w.recordType === 'waiver' && w.projectId && inProg(s.projects.find((p) => p.id === w.projectId)!))
  const waiversGranted = waivers.filter((w) => w.status === 'approved')
  const exportCsv = async () => {
    const res = await saveFile(`gate-calendar-${asOf}.csv`, toCSV(reviews.map((g) => {
      const p = s.projects.find((x) => x.id === g.projectId)!
      const r = readiness(s, p)
      return { Date: g.scheduled, Project: p.code, Name: p.name, Gate: templateFor(s, p).stages[g.stageIndex]?.gate.name, ReadinessPct: r.pct, Blockers: r.blockers.join('; '), Board: g.board.map((b) => personName(s, b)).join('; ') }
    })), 'text/csv')
    if (res === 'saved') toast('Gate calendar exported')
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Stage-gate governance" title="Gate reviews"
        subtitle="Board dates across the portfolio with live readiness, and how long projects take to move through each stage. Readiness counts accepted or waived deliverables against the gate's required list."
        actions={<>
          <Select id="gates-program" value={program} onChange={(e) => setProgram(e.target.value)} options={[{ value: '', label: 'All programs' }, ...s.programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
          <Button icon={<Icon name="download" className="h-4 w-4" />} onClick={exportCsv}>Export</Button>
          <Button variant="primary" icon={<Icon name="plus" className="h-4 w-4" />} onClick={() => setSched({ open: true })}>Schedule review</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Reviews next 60 days" value={reviews.filter((g) => daysBetween(asOf, g.scheduled) <= 60).length} sub={reviews[0] ? `Next ${fmtDate(reviews[0].scheduled)}` : 'None scheduled'} />
        <Stat label="Ready, not scheduled" value={readyUnscheduled.length} sub="Readiness ≥ 80% with no board date" tone={readyUnscheduled.length ? 'warn' : undefined} />
        <Stat label="Recycle rate · 12 mo" value={last12.length ? `${Math.round((recycles / last12.length) * 100)}%` : '—'} sub={`${recycles} of ${last12.length} decisions`} tone={recycles / Math.max(1, last12.length) > 0.15 ? 'bad' : 'good'} />
        <Stat label="Waivers granted" value={waiversGranted.length} sub={`${waivers.filter((w) => w.status === 'running').length} in review · ${waivers.filter((w) => w.status === 'rejected').length} rejected`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel title="Upcoming gate reviews" pad={false} actions={<SegButtons value={view} onChange={setView} options={[{ id: 'list', label: 'List' }, { id: 'calendar', label: 'Calendar' }]} />}>
          {reviews.length === 0 ? <div className="p-4"><Empty title="No gate reviews scheduled" action={<Button onClick={() => setSched({ open: true })}>Schedule review</Button>} /></div>
            : view === 'list' ? <ReviewList s={s} reviews={reviews} onEdit={(pid) => setSched({ open: true, pid })} /> : <ReviewCalendar s={s} reviews={reviews} />}
        </Panel>
        <Panel title="Ready but not scheduled" subtitle="Active projects with no board date for their current gate, most ready first" pad={false}>
          {unscheduled.length === 0 ? <div className="p-4"><Empty title="Every active project has a board date" /></div> : (
            <ul className="divide-y divide-line overflow-y-auto" style={{ maxHeight: 420 }}>
              {unscheduled.map((p) => ({ p, r: readiness(s, p) })).sort((a, b) => b.r.pct - a.r.pct).map(({ p, r }) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <a href={projectHref(p.id, 'lifecycle')} className="min-w-0 flex-1 hover:text-link">
                    <div className="flex items-center gap-1.5 text-xs"><ProgramTag programId={p.programId} /><Mono className="font-semibold">{p.code}</Mono><span className="truncate text-muted">{templateFor(s, p).stages[p.stageIndex]?.gate.name}</span></div>
                    <div className="truncate text-[13px] font-semibold">{p.name}</div>
                    <div className="mt-1 flex items-center gap-2"><Progress value={r.pct} tone={r.pct >= 80 ? 'good' : r.pct >= 50 ? 'warn' : 'bad'} className="max-w-[120px]" /><span className="text-[11px] tabular-nums text-muted">{r.pct}%{r.blockers.length ? ` · ${r.blockers[0]}` : ''}</span></div>
                  </a>
                  <Button size="sm" variant={r.pct >= 80 ? 'marker' : 'secondary'} onClick={() => setSched({ open: true, pid: p.id })}>Schedule</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Readiness heat map" subtitle="Active projects by current gate. Deliverables done/total, estimate class against the gate requirement, and high risks without a response." pad={false}>
        <ReadinessHeat s={s} projects={active} />
      </Panel>

      <GateMetrics s={s} program={program} />
      <ScheduleReviewModal open={sched.open} projectId={sched.pid} onClose={() => setSched({ open: false })} />
    </div>
  )
}

function ReviewList({ s, reviews, onEdit }: { s: AppState; reviews: GateReview[]; onEdit: (pid: string) => void }) {
  const byMonth = groupBy(reviews, (g) => g.scheduled.slice(0, 7))
  return (
    <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
      {Object.entries(byMonth).map(([m, gs]) => (
        <div key={m}>
          <div className="sticky top-0 z-[1] border-b border-line bg-sunken px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{fmtMonth(m)} · {gs.length} review{gs.length > 1 ? 's' : ''}</div>
          <ul className="divide-y divide-line">
            {gs.map((g) => {
              const p = s.projects.find((x) => x.id === g.projectId)!
              const r = readiness(s, p)
              const days = daysBetween(s.settings.asOf, g.scheduled)
              const gate = templateFor(s, p).stages[g.stageIndex]?.gate
              const wf = s.workflows.find((w) => w.projectId === p.id && w.defKey === 'gate-review' && w.status === 'running')
              const atRisk = days <= 21 && r.pct < 80
              return (
                <li key={g.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                  <div className={cx('rounded border text-center leading-tight', days <= 14 ? 'border-marker bg-marker/10' : 'border-line')}>
                    <div className="text-[10px] font-semibold uppercase text-faint">{fmtDate(g.scheduled).slice(0, 3)}</div>
                    <div className="font-display text-[19px] font-bold tabular-nums">{Number(g.scheduled.slice(8, 10))}</div>
                  </div>
                  <a href={projectHref(p.id, 'lifecycle')} className="min-w-0 hover:text-link">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs"><ProgramTag programId={p.programId} /><Mono className="font-semibold">{p.code}</Mono><span className="text-muted">{gate?.name}</span>{wf && <Badge tone="info">Packet in review</Badge>}{atRisk && <Badge tone="bad">At risk</Badge>}</div>
                    <div className="truncate text-[13px] font-semibold">{p.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Progress value={r.pct} tone={r.pct >= 80 ? 'good' : r.pct >= 50 ? 'warn' : 'bad'} className="w-[110px]" />
                      <span className="text-[11px] tabular-nums text-muted">{r.pct}% · {r.done}/{r.total}</span>
                      <span className="flex -space-x-1">{g.board.map((b) => <span key={b} title={personName(s, b)} className="rounded-full ring-2 ring-surface"><Avatar name={personName(s, b)} size={18} /></span>)}</span>
                    </div>
                  </a>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] tabular-nums text-faint">in {days}d</span>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(p.id)}>Reschedule</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ReviewCalendar({ s, reviews }: { s: AppState; reviews: GateReview[] }) {
  const months = Array.from(new Set([s.settings.asOf.slice(0, 7), ...reviews.map((g) => g.scheduled.slice(0, 7))])).sort().slice(0, 4)
  const [mi, setMi] = useState(0)
  const m = months[Math.min(mi, months.length - 1)]
  const first = new Date(m + '-01T12:00:00Z')
  const startDow = first.getUTCDay()
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells = Array.from({ length: Math.ceil((startDow + daysIn) / 7) * 7 }, (_, i) => i - startDow + 1)
  const byDay = groupBy(reviews.filter((g) => g.scheduled.startsWith(m)), (g) => String(Number(g.scheduled.slice(8, 10))))
  const today = s.settings.asOf.startsWith(m) ? Number(s.settings.asOf.slice(8, 10)) : -1
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" disabled={mi === 0} onClick={() => setMi(mi - 1)}>← Prev</Button>
        <span className="font-display text-[15px] font-semibold">{fmtMonth(m)}</span>
        <Button size="sm" variant="ghost" disabled={mi >= months.length - 1} onClick={() => setMi(mi + 1)}>Next →</Button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-line bg-line text-[11px]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="bg-sunken px-1.5 py-1 font-semibold text-muted">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={cx('min-h-[72px] bg-surface p-1', (d < 1 || d > daysIn) && 'bg-sunken/40')}>
            {d >= 1 && d <= daysIn && <div className={cx('mb-0.5 text-[11px] tabular-nums', d === today ? 'inline-block rounded-full bg-marker px-1.5 font-bold text-markerink' : 'text-faint')}>{d}</div>}
            {(byDay[String(d)] ?? []).map((g) => {
              const p = s.projects.find((x) => x.id === g.projectId)!
              const r = readiness(s, p)
              return <a key={g.id} href={projectHref(p.id, 'lifecycle')} title={`${p.name} · ${r.pct}% ready`} className={cx('mb-0.5 block truncate rounded-sm border-l-2 bg-sunken px-1 py-0.5 font-mono text-[10.5px] font-semibold hover:bg-line', r.pct >= 80 ? 'border-good' : r.pct >= 50 ? 'border-warn' : 'border-bad')}>{p.code.slice(4)} G{g.stageIndex + 1}</a>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadinessHeat({ s, projects }: { s: AppState; projects: Project[] }) {
  const rows = projects.map((p) => {
    const r = readiness(s, p)
    const defs = requiredDefs(s, p)
    const dls = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex)
    const review = s.gateReviews.find((g) => g.projectId === p.id && g.stageIndex === p.stageIndex && g.status === 'scheduled')
    return { p, r, defs, dls, review }
  }).sort((a, b) => (a.review?.scheduled ?? '9').localeCompare(b.review?.scheduled ?? '9') || b.r.pct - a.r.pct)
  const maxDefs = Math.max(...rows.map((x) => x.defs.length), 1)
  const cell = (st?: string) => st === 'accepted' ? 'bg-good' : st === 'waived' ? 'bg-good/40' : st === 'submitted' ? 'bg-info/70' : st === 'in-progress' ? 'bg-warn/60' : st === 'returned' ? 'bg-bad' : 'bg-sunken border border-line'
  return (
    <div className="scroll-x" style={{ maxHeight: 560, overflowY: 'auto' }}>
      <table className="tbl">
        <thead><tr><th>Project · gate</th><th>Deliverables</th><th className="num">Done</th><th className="text-center">Estimate</th><th className="num">High risks</th><th className="num">Ready</th><th>Board</th></tr></thead>
        <tbody>
          {rows.map(({ p, r, defs, dls, review }) => (
            <tr key={p.id} className="clickable" onClick={() => go(projectHref(p.id, 'lifecycle'))}>
              <td className="min-w-[220px]">
                <div className="flex items-center gap-1.5"><ProgramTag programId={p.programId} /><Mono className="font-semibold">{p.code}</Mono></div>
                <div className="max-w-[280px] truncate text-[12px] text-muted">{templateFor(s, p).stages[p.stageIndex]?.gate.name}</div>
              </td>
              <td>
                <div className="flex gap-0.5" style={{ minWidth: maxDefs * 16 }}>
                  {defs.map((def) => { const d = dls.find((x) => x.defId === def.id); return <span key={def.id} title={`${def.name}: ${d?.status ?? 'not-started'}`} className={cx('h-4 w-3.5 rounded-sm', cell(d?.status))} /> })}
                </div>
              </td>
              <td className="num">{r.done}/{r.total}</td>
              <td className="text-center">
                {r.estimateRequired ? (
                  <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5', r.estimateOk ? 'bg-good/10' : 'bg-bad/10')} title={`Requires Class ${r.estimateRequired}`}>
                    {r.estimateClass ? <ClassBadge cls={r.estimateClass as 1} /> : <span className="text-[11px] text-bad">none</span>}<span className={cx('text-[11px] font-bold', r.estimateOk ? 'text-good' : 'text-bad')}>{r.estimateOk ? '✓' : `→C${r.estimateRequired}`}</span>
                  </span>
                ) : <span className="text-[11px] text-faint">n/a</span>}
              </td>
              <td className={cx('num font-semibold', r.highRisks ? 'text-bad' : 'text-faint')}>{r.highRisks || '0'}</td>
              <td className="num"><span className={cx('rounded px-1.5 py-0.5 font-bold tabular-nums', r.ready ? 'bg-good text-white' : r.pct >= 80 ? 'bg-warn/20 text-warn' : r.pct >= 50 ? 'bg-warn/10 text-warn' : 'bg-bad/10 text-bad')}>{r.pct}%</span></td>
              <td className="whitespace-nowrap text-[12px]">{review ? fmtDate(review.scheduled) : <span className="text-faint">Not scheduled</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
        {[['bg-good', 'Accepted'], ['bg-good/40', 'Waived'], ['bg-info/70', 'Submitted'], ['bg-warn/60', 'In progress'], ['bg-bad', 'Returned'], ['bg-sunken border border-line', 'Not started']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={cx('inline-block h-3 w-2.5 rounded-sm', c)} />{l}</span>)}
      </div>
    </div>
  )
}

function GateMetrics({ s, program }: { s: AppState; program: string }) {
  const durs = useMemo(() => stageDurations(s), [s])
  const programs = s.programs.filter((p) => !program || p.id === program)
  const std = s.templates.find((t) => t.id === 'tpl-standard')!
  const small = s.templates.find((t) => t.id === 'tpl-small')!
  const tplFor = (pid: string) => s.templates.find((t) => t.id === s.programs.find((p) => p.id === pid)?.lifecycleTemplateId) ?? std
  const outcomes = s.gateDecisions.filter((g) => !program || s.projects.find((p) => p.id === g.projectId)?.programId === program)
  const byOutcome = groupBy(outcomes, (g) => g.outcome)
  const withConds = outcomes.filter((g) => g.conditions.length)
  const condActions = s.actions.filter((a) => a.source === 'gate' && withConds.some((g) => g.conditions.includes(a.id)))
  const condOpenLate = condActions.filter((a) => a.status === 'open' && a.due < s.settings.asOf)
  const avg = (xs: number[]) => (xs.length ? Math.round(sum(xs) / xs.length) : undefined)
  const allAvgs = programs.flatMap((pr) => tplFor(pr.id).stages.map((_, i) => avg(durs.filter((d) => d.programId === pr.id && d.stageIndex === i).map((d) => d.days)) ?? 0))
  const maxAvg = Math.max(...allAvgs, 1)
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel title="Average days per stage" subtitle="From stage entry to the Go decision at its gate, across completed stages. Bars share one scale." pad={false}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Program</th>{std.stages.map((st, i) => <th key={st.id} className="num" title={st.name}>{i + 1}. {st.name.split(' ')[0]}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {programs.map((pr) => {
                const t = tplFor(pr.id)
                const vals = t.stages.map((_, i) => ({ v: avg(durs.filter((d) => d.programId === pr.id && d.stageIndex === i).map((d) => d.days)), n: durs.filter((d) => d.programId === pr.id && d.stageIndex === i).length }))
                const cols = t.id === small.id ? [vals[0], { v: undefined, n: -1 }, vals[1], vals[2], { v: undefined, n: -1 }] : vals
                return (
                  <tr key={pr.id}>
                    <td><span className="flex items-center gap-2"><ProgramTag programId={pr.id} />{t.id === small.id && <span className="text-[10.5px] text-faint">3-stage</span>}</span></td>
                    {cols.map((c, i) => (
                      <td key={i} className="num" style={{ minWidth: 92 }}>
                        {c.n === -1 ? <span className="text-[11px] text-faint">combined</span> : c.v === undefined ? <span className="text-faint">—</span> : (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-semibold">{c.v}d <span className="text-[10px] font-normal text-faint">n={c.n}</span></span>
                            <span className="h-1.5 rounded-full bg-link/70" style={{ width: `${(c.v / maxAvg) * 80}px` }} />
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="num font-semibold">{sum(vals.map((x) => x.v ?? 0))}d</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Gate outcomes" subtitle="All recorded decisions">
        <div className="flex flex-col gap-2">
          {(['go', 'go-with-conditions', 'recycle', 'hold', 'cancel'] as const).map((o) => {
            const n = byOutcome[o]?.length ?? 0
            return (
              <div key={o} className="grid grid-cols-[130px_1fr_40px] items-center gap-2 text-[12px]">
                <span>{({ go: 'Go', 'go-with-conditions': 'Go with conditions', recycle: 'Recycle', hold: 'Hold', cancel: 'Cancel' })[o]}</span>
                <span className="h-3 rounded-sm bg-sunken"><span className={cx('block h-3 rounded-sm', o === 'go' ? 'bg-good/80' : o === 'go-with-conditions' ? 'bg-info/70' : o === 'cancel' ? 'bg-bad/80' : 'bg-warn/80')} style={{ width: `${(n / Math.max(1, outcomes.length)) * 100}%` }} /></span>
                <span className="text-right font-semibold tabular-nums">{n}</span>
              </div>
            )
          })}
          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12px]">
            <div><div className="text-faint">Gate conditions issued</div><div className="font-display text-[19px] font-bold tabular-nums">{condActions.length}</div><div className="text-muted">{condActions.filter((a) => a.status === 'done').length} met</div></div>
            <div><div className="text-faint">Conditions overdue</div><div className={cx('font-display text-[19px] font-bold tabular-nums', condOpenLate.length ? 'text-bad' : 'text-good')}>{condOpenLate.length}</div><div className="text-muted">open past due date</div></div>
          </div>
          {condOpenLate.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {condOpenLate.slice(0, 5).map((a) => <li key={a.id}><a href={projectHref(a.projectId, 'lifecycle')} className="block rounded border border-bad/30 px-2 py-1 text-[12px] hover:bg-bad/5"><Mono className="font-semibold">{s.projects.find((p) => p.id === a.projectId)?.code}</Mono> {a.title}<span className="block text-[11px] text-muted">{personName(s, a.ownerId)} · due {fmtDate(a.due)}</span></a></li>)}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  )
}
