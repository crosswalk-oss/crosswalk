// Estimating → Quick estimate: request a Class 5 quick estimate for any project (or a new need), and the
// register of quick estimates with where each one sits in the estimating team's review.
import { prefs } from '@/core/data'
import { useMemo, useState } from 'react'
import type { AppState } from '@/core/types'
import { personName, useMe, useStore } from '@/core/store'
import { estimateTotals } from '@/core/engine/estimates'
import { go, projectHref } from '@/core/router'
import { cx, fmtDate, money, moneyDelta } from '@/core/util'
import { Badge, Callout, Empty, Panel, SegButtons, StatusBadge, Table, type Column } from '@/ui/kit'
import { RangeBar } from '@/ui/charts'
import { ProgramTag } from '@/views/shared/pickers'
import { NEW_NEED, QuickRequest } from './QuickForm'
import { ASSET_LABEL, METHOD_LABEL, matchNote, modelNote, quickEligibility, returnedToRequester, reviewSlot, storedMatch } from './lib'

const selKey = (pid: string) => `crosswalk:est-sel:${pid}`
export function openEstimate(pid: string, estimateId: string) {
  try { prefs.setRaw(selKey(pid), estimateId) } catch { /* storage blocked */ }
  go(projectHref(pid, 'estimates'))
}

function defaultProject(s: AppState): string {
  const act = s.projects.filter((p) => p.status === 'active')
  const pick = act.filter((p) => p.stageIndex <= 1).find((p) => quickEligibility(s, p.id).ok) ?? act.find((p) => quickEligibility(s, p.id).ok)
  return pick?.id ?? NEW_NEED
}

export function QuickTab() {
  const s = useStore()
  const me = useMe()
  const [pid] = useState(() => defaultProject(s))
  const [sent, setSent] = useState<{ eid: string; pid: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'in-review' | 'approved' | 'draft'>('all')
  const rows = useMemo(() => s.estimates.filter((e) => e.method === 'quick').map((e) => {
    const p = s.projects.find((x) => x.id === e.projectId)!
    const t = estimateTotals(e)
    const rv = reviewSlot(s, e)
    const wf = s.workflows.find((w) => w.id === e.workflowInstanceId)
    const row = s.historicalCosts.find((h) => h.id === e.quick?.historicalCostId)
    const m = e.factor ? modelNote(s, e) : e.quick ? matchNote(s, { row, match: storedMatch(s, e) }, e.quick.inputs) : undefined
    const back = returnedToRequester(s, e)
    return { e, p, t, rv, wf, m, back, returned: !!back || e.status === 'draft', mine: !!rv && rv.slot.assigneeIds.includes(me.id) && !rv.slot.actedIds.includes(me.id) }
  }).sort((a, b) => Number(b.mine) - Number(a.mine) || (a.e.status === 'in-review' ? 0 : 1) - (b.e.status === 'in-review' ? 0 : 1) || b.e.createdAt.localeCompare(a.e.createdAt)), [s, me.id])
  const shown = rows.filter((r) => filter === 'all' || (filter === 'draft' ? r.returned : r.e.status === filter && !r.returned))
  const waitingMine = rows.filter((r) => r.mine).length
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'p', header: 'Project', sort: (r) => r.p.code, render: (r) => <div className="flex min-w-[200px] items-start gap-2"><span className={cx('mt-0.5 h-8 w-1 shrink-0 rounded-full', r.mine ? 'bg-marker' : 'bg-transparent')} /><div className="min-w-0"><div className="flex items-center gap-1.5"><ProgramTag programId={r.p.programId} /><span className="font-mono text-[12px] font-semibold text-link">{r.p.code}</span><span className="font-mono text-[11px] text-faint">v{r.e.version}</span></div><div className="truncate text-[12.5px]">{r.p.name}</div></div></div> },
    { key: 'what', header: 'Asset · purpose', render: (r) => <div className="min-w-[200px] text-[12px]"><div>{r.e.quick ? `${ASSET_LABEL[r.e.quick.inputs.assetType]} · ${METHOD_LABEL[r.e.quick.inputs.workMethod]}` : '—'}</div><div className="truncate text-muted">{r.e.quick?.requestNote}</div></div> },
    { key: 'st', header: 'Status', render: (r) => <div>{r.returned ? <StatusBadge status="returned" label={r.e.status === 'draft' ? 'Recalled' : 'Returned'} /> : <StatusBadge status={r.e.status} />}{r.rv && <div className="mt-0.5 text-[11px] text-muted">{r.mine ? <b className="text-ink">Waiting on you</b> : <>{r.back ? 'Back with' : 'With'} {r.rv.slot.assigneeIds.map((id) => personName(s, id)).join(' / ')}</>}{r.rv.slot.due && <span className={cx(r.rv.slot.due < s.settings.asOf && 'font-semibold text-bad')}> · due {fmtDate(r.rv.slot.due)}</span>}</div>}</div> },
    { key: 'tot', header: 'Total', num: true, sort: (r) => r.t.total, render: (r) => <b>{money(r.t.total)}</b> },
    { key: 'rng', header: 'P10 – P90', width: 170, render: (r) => r.e.quick ? <div className="min-w-[140px]"><RangeBar low={r.e.quick.range.low} point={r.t.total} high={r.e.quick.range.high} /><div className="flex justify-between text-[11px] tabular-nums text-faint"><span>{money(r.e.quick.range.low)}</span><span>{money(r.e.quick.range.high)}</span></div></div> : null },
    { key: 'adj', header: 'Adjustment', render: (r) => r.e.quick?.adjustment ? <span className="text-[12px]"><Badge tone="marker">{r.e.quick.adjustment.pct > 0 ? '+' : ''}{r.e.quick.adjustment.pct}%</Badge><div className="text-[11px] text-muted">{moneyDelta(r.e.quick.adjustment.toTotal - r.e.quick.adjustment.fromTotal)} · {personName(s, r.e.quick.adjustment.byId)}</div></span> : <span className="text-[11px] text-faint">None</span> },
    { key: 'm', header: 'Priced with', render: (r) => r.m ? <Badge tone={r.m.tone === 'good' ? 'good' : r.m.tone === 'warn' ? 'warn' : 'bad'} title={r.m.detail}>{r.m.label}</Badge> : null },
    { key: 'by', header: 'Requested', sort: (r) => r.e.createdAt, render: (r) => <span className="text-[12px]">{personName(s, r.wf?.startedById ?? r.e.createdById)}<div className="text-faint">{fmtDate(r.e.createdAt.slice(0, 10))}{r.e.quick?.needBy ? ` · need ${fmtDate(r.e.quick.needBy)}` : ''}</div></span> },
  ]
  return (
    <div className="flex flex-col gap-4">
      {waitingMine > 0 && <Callout tone="marker" title={`${waitingMine} quick estimate${waitingMine > 1 ? 's' : ''} waiting on you`}>Open one below to check the drivers and the rate-table cross-check, adjust it with an override reason if needed, and approve or return it.</Callout>}
      <Panel title="Request a Class 5 quick estimate" subtitle="Enter the length of pipe, the location and how risky each item is. The rate table prices it automatically and a Monte Carlo gives the P10–P90 range. Sending it routes it to the estimating team, who review it and adjust it if needed.">
        {sent && <div className="mb-3"><Callout tone="good" title="Sent to the estimating team">Track it on <button className="font-semibold text-link" onClick={() => openEstimate(sent.pid, sent.eid)}>{s.projects.find((p) => p.id === sent.pid)?.code} estimates</button> or in the list below.</Callout></div>}
        <QuickRequest allowPicker projectId={pid} onDone={(eid, p) => setSent({ eid, pid: p })} />
      </Panel>
      <Panel pad={false} title="Quick estimates" subtitle={`${rows.length} requested · ${rows.filter((r) => r.e.status === 'in-review').length} with the estimating team · ${rows.filter((r) => r.e.quick?.adjustment).length} adjusted by an estimator`}
        actions={<SegButtons value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'in-review', label: 'In review' }, { id: 'approved', label: 'Approved' }, { id: 'draft', label: 'Returned' }]} />}>
        <Table rows={shown} columns={cols} rowKey={(r) => r.e.id} onRowClick={(r) => openEstimate(r.p.id, r.e.id)} empty={<div className="p-4"><Empty title="No quick estimates here">Requests appear here as soon as they are sent.</Empty></div>} />
      </Panel>
    </div>
  )
}
