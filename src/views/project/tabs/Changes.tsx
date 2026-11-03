// Change control (CH-*): register, new request routed by dollar authority, detail with approval chain
// and impact preview, cumulative trend and root-cause summary.
import { useEffect, useMemo, useState } from 'react'
import { mutate, useMe, useStore, personName, categoryName } from '@/core/store'
import type { AppState, Change, RootCause } from '@/core/types'
import { ROOT_CAUSES } from '@/core/types'
import { position } from '@/core/engine/position'
import { actOnWorkflow, startWorkflow, simulate, latestDef } from '@/core/engine/workflow'
import { fmtDate, fmtDateTime, fmtMonth, money, moneyDelta, monthRange, sum, uid, cx } from '@/core/util'
import { projectHref } from '@/core/router'
import { Avatar, Badge, Button, Callout, Checkbox, Drawer, Empty, Field, Input, KV, Modal, MoneyInput, Panel, SegButtons, Select, Stat, StatusBadge, Table, TextArea, Mono, Section } from '@/ui/kit'
import { HBarChart, LineChart } from '@/ui/charts'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { approvalChain, changeBaseline, doaLabel, nextChangeCode, setFocusSnapshot, takeFocusChange } from './controls/trace'
import { ccosOfChange, changeCommitments, commitmentRow, completeScheduleNotice, notifyScheduler } from '@/core/engine/finance'
import { CcoModal, type CcoSeed } from './finance/CcoModal'
import { setFocusCommitment } from './finance/focus'

type Filter = 'all' | 'open' | 'approved' | 'rejected'

export default function Changes({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const changes = useMemo(() => s.changes.filter((c) => c.projectId === projectId).sort((a, b) => b.code.localeCompare(a.code)), [s.changes, projectId])
  const pos = useMemo(() => position(s, projectId), [s, projectId])
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => { const f = takeFocusChange(); if (f) setOpen(f) }, [])

  const approved = changes.filter((c) => c.status === 'approved')
  const pending = changes.filter((c) => c.status === 'in-review' || c.status === 'draft')
  const rows = changes.filter((c) => filter === 'all' || (filter === 'open' ? c.status === 'in-review' || c.status === 'draft' : c.status === filter))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Approved changes" value={moneyDelta(sum(approved.map((c) => c.costImpact)))} sub={`${approved.length} change${approved.length === 1 ? '' : 's'} · ${sum(approved.map((c) => c.scheduleImpactDays))} days`} />
        <Stat label="In review" value={moneyDelta(sum(pending.map((c) => c.costImpact)))} sub={`${pending.length} pending decision`} tone={pending.length ? 'warn' : undefined} />
        <Stat label="Funded from contingency" value={money(sum(approved.filter((c) => c.fundedFrom === 'contingency').map((c) => c.costImpact)))} sub={`${money(pos.contingencyRemaining)} remaining of ${money(pos.contingencyOriginal)}`} />
        <Stat label="New funding" value={money(sum(approved.filter((c) => c.fundedFrom === 'new-funding').map((c) => c.costImpact)))} sub="Raises the authorized budget" />
        <Stat label="Budget growth" value={pos.originalBudget ? `${(((pos.currentBudget - pos.originalBudget) / pos.originalBudget) * 100).toFixed(1)}%` : '—'} sub={`${money(pos.originalBudget)} → ${money(pos.currentBudget)}`} />
      </div>

      <Callout tone="info" title="How a change reaches vendors and the schedule">
        <span className="text-muted">A change request names the <b className="text-ink">commitments it affects</b>; each affected commitment gets an <b className="text-ink">RFI / change order</b> on the Finance tab (the only way a vendor commitment changes, routed by dollar authority); when the change moves dates, the <b className="text-ink">scheduler gets a task</b> and a notification to update P6. Crosswalk does not write to P6.</span>
      </Callout>

      <Panel title="Change register" subtitle="Every change to an approved baseline, with the baseline it changed and the snapshot it created." pad={false}
        actions={<><SegButtons options={[{ id: 'all', label: `All ${changes.length}` }, { id: 'open', label: `Open ${pending.length}` }, { id: 'approved', label: `Approved ${approved.length}` }, { id: 'rejected', label: 'Rejected' }]} value={filter} onChange={setFilter} /><Button variant="primary" size="sm" onClick={() => setCreating(true)} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>New change request</Button></>}>
        <Table rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setOpen(c.id)} empty={<div className="p-4"><Empty title={changes.length ? 'No changes match this filter' : 'No changes yet'}>{changes.length ? 'Pick another filter.' : `${p.code} has no change requests. Changes are raised against the Current baseline once the control budget is authorized.`}</Empty></div>} columns={[
          { key: 'code', header: 'Code', render: (c) => <Mono className="font-semibold">{c.code}</Mono>, sort: (c) => c.code },
          { key: 'title', header: 'Title', render: (c) => <span className="block min-w-[200px]">{c.title}<span className="block text-xs text-muted">{categoryName(s, c.categoryId)} · requested {fmtDate(c.requestedAt)} by {personName(s, c.requestedById)}</span></span> },
          { key: 'type', header: 'Type', render: (c) => <Badge>{c.type}</Badge> },
          { key: 'rc', header: 'Root cause', render: (c) => <span className="text-[12px]">{c.rootCause}</span>, sort: (c) => c.rootCause },
          { key: 'cost', header: 'Cost', num: true, render: (c) => <span className={cx('font-semibold', c.costImpact > 0 ? 'text-bad' : c.costImpact < 0 ? 'text-good' : '')}>{moneyDelta(c.costImpact)}</span>, sort: (c) => c.costImpact },
          { key: 'days', header: 'Days', num: true, render: (c) => (c.scheduleImpactDays ? `+${c.scheduleImpactDays}` : '0'), sort: (c) => c.scheduleImpactDays },
          { key: 'fund', header: 'Funded from', render: (c) => <span className="text-[12px]">{c.fundedFrom === 'new-funding' ? 'New funding' : c.fundedFrom === 'contingency' ? 'Contingency' : '—'}</span> },
          { key: 'st', header: 'Status', render: (c) => <StatusBadge status={c.status} />, sort: (c) => c.status },
          { key: 'cm', header: 'Commitments', render: (c) => { const ks = changeCommitments(s, c); const n = ccosOfChange(s, c.id).length; return ks.length ? <span className="whitespace-nowrap text-[12px]">{ks.map((k) => k.vendor).join(', ')}<span className="block text-[11px] text-muted">{n} RFI / CCO{n === 1 ? '' : 's'}</span></span> : <span className="text-faint">—</span> } },
          { key: 'sn', header: 'Scheduler', render: (c) => c.scheduleNotice ? <Badge tone={c.scheduleNotice.status === 'done' ? 'good' : 'info'}>{c.scheduleNotice.status === 'done' ? 'P6 updated' : 'Task sent'}</Badge> : c.scheduleImpactDays ? <Badge tone="marker">Not notified</Badge> : <span className="text-faint">—</span> },
          { key: 'bl', header: 'Changed baseline', render: (c) => { const b = changeBaseline(s, c); return b ? <span className="text-xs text-muted">{b.label}<span className="block">{fmtDate(b.date)}</span></span> : <span className="text-faint">—</span> } },
          { key: 'res', header: 'Resulting snapshot', render: (c) => (c.resultingSnapshotId ? <a href={projectHref(projectId, 'baselines')} onClick={(e) => { e.stopPropagation(); setFocusSnapshot(c.resultingSnapshotId!) }} className="text-xs font-semibold text-link hover:underline">{fmtDate(s.snapshots.find((x) => x.id === c.resultingSnapshotId)?.date)} Current</a> : <span className="text-xs text-faint">{c.status === 'in-review' ? 'On approval' : '—'}</span>) },
        ]} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <TrendPanel s={s} projectId={projectId} changes={changes} />
        <Panel title="Approved cost by root cause" subtitle="Where the budget growth came from">
          {approved.length ? <HBarChart rows={Object.entries(groupSum(approved, (c) => c.rootCause)).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, sub: `(${approved.filter((c) => c.rootCause === k).length})`, color: v < 0 ? 'rgb(var(--good))' : undefined }))} /> : <p className="text-[13px] text-muted">No approved changes yet.</p>}
        </Panel>
      </div>

      {open && <ChangeDrawer id={open} onClose={() => setOpen(null)} />}
      <NewChangeModal open={creating} onClose={() => setCreating(false)} projectId={projectId} onCreated={(id) => { setCreating(false); setOpen(id) }} />
    </div>
  )
}

const groupSum = <T,>(xs: T[], k: (x: T) => string, v: (x: T) => number = (x: any) => x.costImpact) => xs.reduce<Record<string, number>>((a, x) => { a[k(x)] = (a[k(x)] || 0) + v(x); return a }, {})

function TrendPanel({ s, projectId, changes }: { s: AppState; projectId: string; changes: Change[] }) {
  const approved = changes.filter((c) => c.status === 'approved' && c.decidedAt)
  const periods = s.costPeriods.filter((c) => c.projectId === projectId).map((c) => c.period).sort()
  const first = [approved.map((c) => c.decidedAt!.slice(0, 7)).sort()[0], periods.find((x) => x >= (s.snapshots.find((n) => n.projectId === projectId && n.type === 'original')?.date.slice(0, 7) ?? ''))].filter(Boolean).sort()[0]
  if (!first) return <Panel title="Cumulative approved changes"><p className="text-[13px] text-muted">The trend starts with the first approved change.</p></Panel>
  const months = monthRange(first, s.settings.asOf.slice(0, 7))
  let acc = 0, accC = 0
  const cum = months.map((m) => { acc += sum(approved.filter((c) => c.decidedAt!.slice(0, 7) === m).map((c) => c.costImpact)); return acc })
  const cumC = months.map((m) => { accC += sum(approved.filter((c) => c.decidedAt!.slice(0, 7) === m && c.fundedFrom === 'contingency').map((c) => c.costImpact)); return accC })
  const pending = sum(changes.filter((c) => c.status === 'in-review').map((c) => c.costImpact))
  return (
    <Panel title="Cumulative approved changes" subtitle={`By month of decision · pending ${moneyDelta(pending)} not yet counted`}>
      <LineChart labels={months.map((m) => fmtMonth(m).replace(/ (\d\d)(\d\d)$/, " '$2"))} height={210} series={[
        { name: 'All approved', values: cum, color: 'rgb(var(--bad))', area: true },
        { name: 'From contingency', values: cumC, color: 'rgb(var(--link))' },
        ...(pending ? [{ name: 'If pending approved', values: months.map((_, i) => (i === months.length - 1 ? acc + pending : null)), color: 'rgb(var(--marker))', dashed: true }] : []),
      ]} />
    </Panel>
  )
}

function ChangeDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore()
  const c = s.changes.find((x) => x.id === id)
  if (!c) return null
  const p = s.projects.find((x) => x.id === c.projectId)!
  const pos = position(s, c.projectId)
  const base = changeBaseline(s, c)
  const res = s.snapshots.find((x) => x.id === c.resultingSnapshotId)
  const doa = doaLabel(s, c.projectId, c.costImpact)
  const chain = approvalChain(s, c.workflowInstanceId).filter((x) => x.action === 'approve' || x.action === 'submit')
  const inst = s.workflows.find((w) => w.id === c.workflowInstanceId)
  const live = c.status !== 'approved' && c.status !== 'rejected'
  const contAfter = pos.contingencyRemaining - (live && c.fundedFrom === 'contingency' ? c.costImpact : 0)
  const budgetAfter = pos.currentBudget + (live && c.fundedFrom === 'new-funding' ? c.costImpact : 0)
  const eacAfter = pos.eac + (live && (c.fundedFrom !== 'contingency' || contAfter < 0) ? (c.fundedFrom === 'contingency' ? -contAfter : c.costImpact) : 0)
  const risk = s.risks.find((r) => r.id === c.riskId)
  const variance = s.variances.filter((v) => v.changeIds.includes(c.id))
  return (
    <Drawer open onClose={onClose} width={640} title={<span className="flex flex-wrap items-center gap-2"><Mono className="text-[14px] font-semibold">{c.code}</Mono><StatusBadge status={c.status} /></span>}>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-display text-[18px] font-semibold leading-snug">{c.title}</h3>
          <p className="mt-1 text-[13px] text-muted">{c.description}</p>
        </div>
        <KV cols={3} items={[
          ['Cost impact', <b className={c.costImpact > 0 ? 'text-bad' : 'text-good'}>{money(c.costImpact, 'full')}</b>], ['Schedule impact', `${c.scheduleImpactDays} days`], ['Funded from', c.fundedFrom.replace('-', ' ')],
          ['Type', c.type], ['Root cause', c.rootCause], ['Cost category', `${s.categories.find((x) => x.id === c.categoryId)?.code} ${categoryName(s, c.categoryId)}`],
          ['Scope impact', c.scopeImpact || 'None'], ['Requested', `${fmtDate(c.requestedAt)} · ${personName(s, c.requestedById)}`], ['Decided', fmtDate(c.decidedAt)],
        ]} />
        {inst && <WorkflowStatus instanceId={inst.id} />}

        <Section title={live ? 'Impact preview (if approved)' : 'Impact at decision'}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Impact label="Contingency after" value={money(live ? contAfter : pos.contingencyRemaining)} sub={live && c.fundedFrom === 'contingency' ? `${money(pos.contingencyRemaining)} − ${money(c.costImpact)}` : 'Not drawn from contingency'} bad={contAfter < 0} />
            <Impact label="Authorized budget after" value={money(budgetAfter)} sub={live && c.fundedFrom === 'new-funding' ? `${money(pos.currentBudget)} + ${money(c.costImpact)}` : 'Unchanged'} />
            <Impact label={live ? 'New EAC (indicative)' : 'Signed EAC'} value={money(eacAfter)} sub={!live ? 'Current signed forecast' : c.fundedFrom === 'contingency' && contAfter >= 0 ? 'Absorbed by contingency already in the forecast' : `${money(pos.eac)} + ${money(eacAfter - pos.eac)} until the next forecast cycle`} bad={eacAfter > budgetAfter} />
          </div>
          {contAfter < 0 && <Callout tone="bad">This change would overdraw contingency by {money(-contAfter)}. Fund the shortfall as new funding or reduce scope.</Callout>}
          <Callout tone="info" title={`Routes to ${doa.label} under the DOA matrix`}>
            {money(Math.abs(c.costImpact), 'full')} falls in the {doa.label} band of {doa.matrix}{doa.people.length ? ` — ${doa.people.join(', ')}` : ''}. {c.scheduleImpactDays > 30 ? 'Schedule impact over 30 days adds a scheduler review.' : 'No scheduler review (30 days or less).'}
          </Callout>
        </Section>

        <CommitmentsSection c={c} />
        {c.scheduleImpactDays !== 0 && <ScheduleSection c={c} />}

        <Section title="Traceability">
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line text-[13px]">
            <TraceRow label="Baseline it changed" value={base ? `${base.label} · ${fmtDate(base.date)} · ${money(base.budget.total)}` : '—'} href={base ? projectHref(c.projectId, 'baselines') : undefined} onClick={() => base && setFocusSnapshot(base.id)} />
            <TraceRow label="Resulting snapshot" value={res ? `${res.label} · ${fmtDate(res.date)} · ${money(res.budget.total)}` : live ? 'Created automatically on approval' : '—'} href={res ? projectHref(c.projectId, 'baselines') : undefined} onClick={() => res && setFocusSnapshot(res.id)} />
            <TraceRow label="Linked risk" value={risk ? `${risk.code} ${risk.title} (${risk.status})` : 'None'} href={risk ? projectHref(c.projectId, 'risk') : undefined} />
            <TraceRow label="Variance explanations" value={variance.length ? variance.map((v) => `${v.description} (${v.status})`).join('; ') : 'Not cited in a variance explanation'} href={variance.length ? projectHref(c.projectId, 'cost') : undefined} />
          </ul>
        </Section>

        {chain.length > 0 && (
          <Section title="Approval chain">
            <ol className="flex flex-col gap-1.5">
              {chain.map((x, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[13px]">
                  <Avatar name={x.actor} size={20} /><b>{x.actor}</b><span className="text-muted">{x.title}</span><span className="text-muted">· {x.step}</span>
                  {x.sig && <Badge tone="good" title={`Signature ${x.sig}`}>e-signed <Mono className="text-[10.5px]">{x.sig.slice(0, 8)}</Mono></Badge>}
                  <span className="ml-auto text-xs text-faint">{fmtDateTime(x.at)}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}
        <p className="text-xs text-faint">Project {p.code} · change id <Mono>{c.id}</Mono>. Approved changes are immutable; corrections are raised as a new change.</p>
      </div>
    </Drawer>
  )
}

function Impact({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return <div className="min-w-0 rounded-md border border-line px-3 py-2"><div className="eyebrow">{label}</div><div className={cx('font-display text-[19px] font-bold tabular-nums', bad && 'text-bad')}>{value}</div><div className="text-xs text-muted">{sub}</div></div>
}

function TraceRow({ label, value, href, onClick }: { label: string; value: string; href?: string; onClick?: () => void }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</span>
      {href ? <a href={href} onClick={onClick} className="min-w-0 text-right font-semibold text-link hover:underline">{value}</a> : <span className="min-w-0 text-right">{value}</span>}
    </li>
  )
}

function NewChangeModal({ open, onClose, projectId, onCreated }: { open: boolean; onClose: () => void; projectId: string; onCreated: (id: string) => void }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const pos = position(s, projectId)
  const blank = { type: 'cost' as Change['type'], title: '', description: '', rootCause: 'Third-party / substructures' as RootCause, categoryId: 'cat-contract', cost: 0, days: 0, scope: '', funded: 'contingency' as Change['fundedFrom'], riskId: '', contractIds: [] as string[] }
  const [f, setF] = useState(blank)
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }))
  const doa = doaLabel(s, projectId, f.cost)
  const def = latestDef(s, 'change-request')
  const route = useMemo(() => (def ? simulate(s, def, { amount: f.cost, scheduleImpactDays: f.days, rootCause: f.rootCause }, projectId) : []), [s, def, f.cost, f.days, f.rootCause, projectId])
  const risks = s.risks.filter((r) => r.projectId === projectId && r.status !== 'closed')
  const commitments = s.contracts.filter((c) => c.projectId === projectId && c.status !== 'closed')
  const contAfter = pos.contingencyRemaining - (f.funded === 'contingency' ? f.cost : 0)
  const submit = () => {
    if (!f.title.trim() || !f.description.trim()) { toast('Give the change a title and a description.', 'bad'); return }
    if (f.type !== 'schedule' && !f.cost && f.type !== 'scope') { toast('Enter the cost impact.', 'bad'); return }
    const code = nextChangeCode(s, p)
    const id = uid('chg')
    mutate((d) => {
      const base = [...d.snapshots].filter((x) => x.projectId === projectId && (x.type === 'current' || x.type === 'original')).sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'current' ? 1 : -1)).pop()
      d.changes.push({ id, projectId, code, title: f.title.trim(), type: f.type, rootCause: f.rootCause, description: f.description.trim(), costImpact: f.cost, scheduleImpactDays: f.days, scopeImpact: f.scope.trim() || 'None', categoryId: f.categoryId, fundedFrom: f.cost ? f.funded : 'none', status: 'draft', requestedById: d.currentUserId, requestedAt: d.settings.asOf, baselineSnapshotId: base?.id, riskId: f.riskId || undefined, contractIds: f.contractIds.length ? f.contractIds : undefined })
      const inst = startWorkflow(d, 'change-request', { title: `${code} ${f.title.trim()}`, recordType: 'change', recordId: id, projectId, data: { amount: f.cost, scheduleImpactDays: f.days, rootCause: f.rootCause, justification: f.description.trim() } })
      const slot = inst?.active.find((a) => a.nodeId === 'prep' && a.assigneeIds.includes(d.currentUserId))
      if (inst && slot) actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', 'Change request prepared')
    }, { entity: 'change', entityId: id, projectId, action: 'create', summary: `Raised ${code} ${f.title.trim()} (${moneyDelta(f.cost)}, ${f.days} days)` })
    toast('Submitted for approval')
    setF(blank)
    onCreated(id)
  }
  return (
    <Modal open={open} onClose={onClose} wide title={`New change request · ${nextChangeCode(s, p)}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Create & route</Button></>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type"><Select value={f.type} onChange={(e) => set('type', e.target.value as Change['type'])} options={[{ value: 'cost', label: 'Cost' }, { value: 'scope', label: 'Scope' }, { value: 'schedule', label: 'Schedule' }, { value: 'trend', label: 'Trend' }]} /></Field>
            <Field label="Root cause"><Select value={f.rootCause} onChange={(e) => set('rootCause', e.target.value as RootCause)} options={[...ROOT_CAUSES]} /></Field>
          </div>
          <Field label="Title"><Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Relocate conflicting 8-inch water main at Sta. 42+10" /></Field>
          <Field label="Description and justification"><TextArea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What was found, why the change is needed, alternatives considered, and the evidence attached (photos, contractor quote, RFI)." /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Cost impact" hint="Negative for a saving"><MoneyInput value={f.cost} onChange={(v) => set('cost', v)} /></Field>
            <Field label="Schedule impact (days)"><Input type="number" value={f.days} onChange={(e) => set('days', Number(e.target.value) || 0)} /></Field>
            <Field label="Cost category"><Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} options={s.categories.filter((c) => c.group === 'direct' || c.group === 'indirect').map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} /></Field>
          </div>
          <Field label="Scope impact"><Input value={f.scope} onChange={(e) => set('scope', e.target.value)} placeholder="None, or what is added or removed" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Funding source"><SegButtons options={[{ id: 'contingency', label: 'Contingency' }, { id: 'new-funding', label: 'New funding' }]} value={f.funded === 'none' ? 'contingency' : f.funded} onChange={(v) => set('funded', v)} /></Field>
            <Field label="Linked risk (optional)"><Select value={f.riskId} onChange={(e) => set('riskId', e.target.value)} options={[{ value: '', label: 'None' }, ...risks.map((r) => ({ value: r.id, label: `${r.code} ${r.title}` }))]} /></Field>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">Commitments affected</div>
            {commitments.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {commitments.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <Checkbox checked={f.contractIds.includes(k.id)} onChange={(v) => set('contractIds', v ? [...f.contractIds, k.id] : f.contractIds.filter((x) => x !== k.id))} label={<span><b>{k.vendor}</b> <span className="text-muted">· {k.type} · PO {k.poNumber ?? '—'}</span></span>} />
                    <span className="shrink-0 text-[12px] tabular-nums text-muted">{money(k.value + k.changeOrders)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[12px] text-faint">No commitments on this project yet.</p>}
            <p className="mt-1 text-[11.5px] text-faint">After the change is created, raise an RFI / change order on each affected commitment — that is how the vendor's commitment moves.</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-md border border-line bg-sunken/40 p-3">
          <div className="eyebrow">Impact preview</div>
          <KV cols={1} items={[
            ['Contingency after', <span className={cx('font-semibold tabular-nums', contAfter < 0 && 'text-bad')}>{money(contAfter, 'full')}{f.funded === 'contingency' && f.cost ? <span className="font-normal text-muted"> ({money(pos.contingencyRemaining)} − {money(f.cost)})</span> : null}</span>],
            ['Authorized budget after', <span className="tabular-nums">{money(pos.currentBudget + (f.funded === 'new-funding' ? f.cost : 0), 'full')}</span>],
            ['Signed EAC today', <span className="tabular-nums">{money(pos.eac, 'full')}</span>],
            ['Dollar authority', <b>{doa.label}</b>],
          ]} />
          <div className="eyebrow mt-1">Routing (live from the workflow)</div>
          <ol className="flex flex-col gap-1 text-[12.5px]">
            {route.map((r, i) => <li key={i} className="flex gap-2"><span className="w-4 text-right tabular-nums text-faint">{i + 1}</span><span className="min-w-0"><b>{r.node.label}</b><span className="block text-muted">{r.people.map((x) => x.name).join(', ') || 'Unassigned'}</span></span></li>)}
          </ol>
          {contAfter < 0 && <Callout tone="bad">Overdraws contingency by {money(-contAfter)}.</Callout>}
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Commitments the change affects → RFI / CCOs
function CommitmentsSection({ c }: { c: Change }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === c.projectId)!
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [cco, setCco] = useState<CcoSeed | null>(null)
  const canEdit = me.id === p.team.pm || me.id === p.team.projectControls || me.roles.includes('admin') || me.roles.includes('pmo')
  const affected = changeCommitments(s, c)
  const ccos = ccosOfChange(s, c.id)
  const all = s.contracts.filter((k) => k.projectId === c.projectId)
  const raised = sum(ccos.filter((x) => x.status !== 'rejected').map((x) => x.amount))
  const save = () => {
    const names = all.filter((k) => sel.includes(k.id)).map((k) => k.vendor)
    mutate((d) => { const x = d.changes.find((y) => y.id === c.id)!; x.contractIds = sel.length ? sel : undefined }, { entity: 'change', entityId: c.id, projectId: c.projectId, action: 'commitments', summary: `${c.code}: commitments affected → ${names.join(', ') || 'none'}` })
    toast('Commitments affected saved'); setEditing(false)
  }
  return (
    <Section title="Commitments affected" actions={canEdit && !editing ? <Button size="sm" variant="ghost" onClick={() => { setSel(c.contractIds ?? []); setEditing(true) }}>Edit</Button> : undefined}>
      {editing ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
          {all.length ? all.map((k) => <Checkbox key={k.id} checked={sel.includes(k.id)} onChange={(v) => setSel(v ? [...sel, k.id] : sel.filter((x) => x !== k.id))} label={<span><b>{k.vendor}</b> <span className="text-muted">· {k.type} · PO {k.poNumber ?? '—'}</span></span>} />) : <span className="text-[13px] text-faint">No commitments on this project.</span>}
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save</Button></div>
        </div>
      ) : affected.length === 0 ? (
        <p className="text-[13px] text-muted">No commitments linked. If a vendor will be paid differently because of this change, link the commitment and raise an RFI / change order on it.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line text-[13px]">
          {affected.map((k) => {
            const r = commitmentRow(s, k)
            const mine = ccos.filter((x) => x.contractId === k.id)
            const live = k.status !== 'rfp' && k.status !== 'closed'
            return (
              <li key={k.id} className="flex flex-col gap-1.5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{k.vendor}</b><span className="text-muted">{k.type} · PO <Mono>{k.poNumber ?? '—'}</Mono></span>
                  <span className="ml-auto tabular-nums text-muted">current {money(r.current)}</span>
                </div>
                {mine.length > 0 && <div className="flex flex-wrap gap-1.5">{mine.map((x) => <a key={x.id} href={projectHref(c.projectId, 'finance')} onClick={() => setFocusCommitment(k.id, x.id)} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[12px] hover:border-ink/40"><Mono className="font-semibold">{x.code}</Mono><span className="tabular-nums">{moneyDelta(x.amount)}</span><StatusBadge status={x.status} /></a>)}</div>}
                <div className="flex flex-wrap gap-2">
                  {canEdit && live && c.status !== 'rejected' && <Button size="sm" onClick={() => setCco({ contractId: k.id, changeId: c.id })}>Raise RFI / CCO</Button>}
                  <a href={projectHref(c.projectId, 'finance')} onClick={() => setFocusCommitment(k.id)} className="self-center text-[12px] font-semibold text-link hover:underline">Open commitment →</a>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {ccos.length > 0 && (
        <p className={cx('text-[12px]', raised !== c.costImpact ? 'text-warn' : 'text-muted')}>
          RFI / CCOs raised under this change: <b className="tabular-nums">{moneyDelta(raised)}</b> of <b className="tabular-nums">{moneyDelta(c.costImpact)}</b>{raised !== c.costImpact ? ` — ${money(Math.abs(c.costImpact - raised))} ${raised < c.costImpact ? 'not yet placed with a vendor (company cost or still to raise)' : 'more than the change'}` : ' — fully placed with vendors'}.
        </p>
      )}
      <CcoModal projectId={c.projectId} seed={cco} onClose={() => setCco(null)} />
    </Section>
  )
}

// ───────────────────────────── Schedule impact → scheduler task (P6 is not written back)
function ScheduleSection({ c }: { c: Change }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === c.projectId)!
  const n = c.scheduleNotice
  const schedulerId = n?.schedulerId ?? p.team.scheduler
  const action = n?.actionId ? s.actions.find((a) => a.id === n.actionId) : undefined
  const isScheduler = me.id === schedulerId || me.roles.includes('admin')
  const canNotify = me.id === p.team.pm || me.id === p.team.projectControls || me.roles.includes('admin') || me.roles.includes('pmo')
  const notify = () => {
    let res: { ok: boolean; reason?: string } = { ok: false }
    mutate((d) => { res = notifyScheduler(d, c.id) })
    toast(res.ok ? `Task sent to ${personName(s, schedulerId)}` : res.reason ?? 'Could not notify', res.ok ? 'good' : 'bad')
  }
  const done = () => { mutate((d) => completeScheduleNotice(d, c.id)); toast('Marked P6 updated') }
  return (
    <Section title="Schedule">
      <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <b className="tabular-nums">{c.scheduleImpactDays > 0 ? '+' : ''}{c.scheduleImpactDays} days</b>
          <span className="text-muted">P6 schedule <Mono>{p.scheduleId}</Mono> · scheduler {personName(s, schedulerId)}</span>
          {n ? <Badge tone={n.status === 'done' ? 'good' : 'info'}>{n.status === 'done' ? 'P6 updated' : `Task sent ${fmtDateTime(n.sentAt)}`}</Badge> : <Badge tone="marker">Scheduler not notified</Badge>}
        </div>
        {action && <div className="text-[12px] text-muted">Task: {action.title} · due {fmtDate(action.due)} · {action.status}</div>}
        <div className="flex flex-wrap gap-2">
          {!n && canNotify && <Button size="sm" variant="marker" onClick={notify}>Notify scheduler</Button>}
          {n?.status === 'sent' && isScheduler && <Button size="sm" variant="primary" onClick={done}>Mark P6 updated</Button>}
        </div>
        <p className="text-[11.5px] text-faint">Crosswalk does not write to P6. The scheduler gets a task and a notification; approved changes move the milestone forecasts here, and the scheduler reflects them in the P6 schedule.</p>
      </div>
    </Section>
  )
}
