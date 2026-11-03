// Finance & commitments: the project's financial accounts (WOA + internal orders), the commitments
// ("call-offs") it buys through, and the RFI / change orders that are the single entry point for
// changing a commitment. Two coverage checks close the loop: every WBS function with budget is carried
// by an IO, and every estimate line is bought through a vendor commitment (or is company labor).
import { useEffect, useMemo, useState } from 'react'
import { mutate, personName, useMe, useStore } from '@/core/store'
import type { AppState, Contract, InternalOrder, Project } from '@/core/types'
import { capitalSplit, commitmentIssues, commitmentsFor, ioCoverage, ioLabel, lineCoverage, NON_COMMITMENT_LINES, type CommitmentRow } from '@/core/engine/finance'
import { reviseInfo } from '@/core/engine/info'
import { lineById } from '@/core/engine/lines'
import { go, projectHref } from '@/core/router'
import { fmtDate, money, moneyDelta, sum, cx } from '@/core/util'
import { Badge, Button, Callout, Empty, Input, Mono, Panel, Select, SegButtons, Stat, StatusBadge, Table } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { lsSet } from '../../admin/common'
import { setFocusChange } from './controls/trace'
import { CcoModal, type CcoSeed } from './finance/CcoModal'
import { CommitmentDetail } from './finance/CommitmentDetail'
import { CommitmentForm } from './finance/CommitmentForm'
import { IoDrawer } from './finance/IoDrawer'
import { takeFocusCommitment } from './finance/focus'

export default function Finance({ projectId }: { projectId: string }) {
  return <FinanceInner key={projectId} projectId={projectId} />
}

const EDIT_ROLES = ['admin', 'pmo', 'finance', 'project-controls', 'plant-accounting']

function FinanceInner({ projectId }: { projectId: string }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === projectId)!
  const canEdit = p.status !== 'closed' && p.status !== 'cancelled' && (me.id === p.team.pm || me.id === p.team.projectControls || me.roles.some((r) => EDIT_ROLES.includes(r)))
  const rows = useMemo(() => commitmentsFor(s, p.id), [s, p.id])
  const ioCov = useMemo(() => ioCoverage(s, p), [s, p])
  const lineCov = useMemo(() => lineCoverage(s, p.id), [s, p.id])
  const ios = p.finance?.ios ?? []

  const [detail, setDetail] = useState<{ id: string; cco?: string } | null>(null)
  const [cmEdit, setCmEdit] = useState<{ c?: Contract; lineIds?: string[] } | null>(null)
  const [ioEdit, setIoEdit] = useState<{ io?: InternalOrder; functionIds?: string[] } | null>(null)
  const [cco, setCco] = useState<CcoSeed | null>(null)
  useEffect(() => { const f = takeFocusCommitment(); if (f) setDetail({ id: f.contractId, cco: f.ccoId }) }, [])

  const live = rows.filter((r) => r.c.status !== 'rfp')
  const current = sum(live.map((r) => r.current))
  const invoiced = sum(live.map((r) => r.invoiced))
  const pending = s.commitmentChanges.filter((x) => x.projectId === p.id && x.status === 'in-review')
  const mine = pending.filter((x) => s.workflows.find((w) => w.id === x.workflowInstanceId)?.active.some((a) => a.assigneeIds.includes(me.id) && !a.actedIds.includes(me.id)))
  const gapCount = ioCov.gaps.length + lineCov.gaps.length
  const openIos = ios.filter((x) => x.status === 'open').length, reqIos = ios.filter((x) => x.status === 'requested').length
  const woa = p.finance?.woa || p.info?.workOrder

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Work order authorization" value={woa ? <Mono className="text-[19px]">{woa}</Mono> : <span className="text-faint">Not issued</span>} sub={woa ? 'Charges authorized' : 'Issued with phase 2 funding'} />
        <Stat label="Internal orders" value={ios.length} sub={ios.length ? `${openIos} open · ${reqIos} requested` : 'None requested yet'} tone={reqIos && !openIos ? 'warn' : undefined} />
        <Stat label="Current commitments" value={money(current)} sub={`${live.length} commitment${live.length === 1 ? '' : 's'} · ${moneyDelta(sum(live.map((r) => r.approvedChanges)))} approved changes`} />
        <Stat label="Remaining to invoice" value={money(current - invoiced)} sub={`${money(invoiced)} invoiced${pending.length ? ` · ${moneyDelta(sum(pending.map((x) => x.amount)))} in review` : ''}`} />
        <Stat label="Coverage gaps" value={gapCount} tone={gapCount ? 'warn' : 'good'} sub={`${ioCov.gaps.length} WBS function${ioCov.gaps.length === 1 ? '' : 's'} · ${lineCov.gaps.length} estimate line${lineCov.gaps.length === 1 ? '' : 's'}`} />
      </div>

      {mine.length > 0 && (
        <Callout tone="marker" title={`${mine.length} RFI / change order${mine.length === 1 ? '' : 's'} waiting on you`}>
          <div className="flex flex-col gap-1">
            {mine.map((x) => <div key={x.id} className="flex flex-wrap items-center gap-2"><Mono className="font-semibold">{x.code}</Mono><span className="min-w-0 flex-1">{x.rfi}</span><b className="tabular-nums">{moneyDelta(x.amount)}</b><Button size="sm" onClick={() => setDetail({ id: x.contractId, cco: x.id })}>Review</Button></div>)}
          </div>
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <AccountsPanel s={s} p={p} canEdit={canEdit} onEditIo={(io) => setIoEdit({ io })} onAddIo={() => setIoEdit({})} />
        <IoCoveragePanel p={p} cov={ioCov} canEdit={canEdit} onNewIo={(fn) => setIoEdit({ functionIds: [fn] })} />
      </div>

      <Panel title="Commitments" subtitle="Vendor POs this project buys through and the share of each PO intended for it. Click a commitment for its RFI / change order log." pad={false}
        actions={canEdit && <>
          <Button size="sm" onClick={() => setCco({})} disabled={!live.some((r) => r.c.status !== 'closed')}>New RFI / change order</Button>
          <Button size="sm" variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setCmEdit({})}>Add commitment</Button>
        </>}>
        <CommitmentTable s={s} p={p} rows={rows} onOpen={(id) => setDetail({ id })} />
      </Panel>

      <LineCoveragePanel cov={lineCov} canEdit={canEdit} onCover={(lineId) => setCmEdit({ lineIds: [lineId] })} onOpen={(id) => setDetail({ id })} s={s} />

      <CcoLog s={s} p={p} onOpen={(contractId, id) => setDetail({ id: contractId, cco: id })} />

      <Panel title="How a change reaches vendors, the IO and the schedule">
        <ol className="grid grid-cols-1 gap-3 text-[12.5px] md:grid-cols-4">
          <FlowStep n={1} title="Change request" text="A change to the project baseline (scope, cost, schedule) is raised on the Changes tab and names the commitments it affects." href={projectHref(p.id, 'changes')} />
          <FlowStep n={2} title="RFI / change order" text="Each affected commitment gets an RFI / CCO here — the only way a commitment changes. Approval adds the amount to the commitment." />
          <FlowStep n={3} title="Accounts" text="The commitment charges an internal order; the IO must carry the WBS function of every line the commitment covers." />
          <FlowStep n={4} title="Scheduler task" text="When a change moves dates, the scheduler gets a task and a notification to update P6. Crosswalk does not write to P6." />
        </ol>
      </Panel>

      {detail && <CommitmentDetail key={detail.id + (detail.cco ?? '')} contractId={detail.id} focusCco={detail.cco} canEdit={canEdit} onClose={() => setDetail(null)}
        onEdit={() => { const c = s.contracts.find((x) => x.id === detail.id); setDetail(null); if (c) setCmEdit({ c }) }}
        onNewCco={() => { setCco({ contractId: detail.id }) }} />}
      <CommitmentForm p={p} edit={cmEdit} onClose={() => setCmEdit(null)} />
      <IoDrawer p={p} edit={ioEdit} onClose={() => setIoEdit(null)} />
      <CcoModal projectId={p.id} seed={cco} onClose={() => setCco(null)} onCreated={(id, contractId) => setDetail({ id: contractId, cco: id })} />
    </div>
  )
}

function FlowStep({ n, title, text, href }: { n: number; title: string; text: string; href?: string }) {
  return (
    <li className="flex gap-2.5 rounded-md border border-line px-3 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-surface">{n}</span>
      <span className="min-w-0"><b className="block text-[13px]">{href ? <a href={href} className="text-link hover:underline">{title}</a> : title}</b><span className="text-muted">{text}</span></span>
    </li>
  )
}

// ───────────────────────────── Accounts: WOA, IOs, capital / O&M split
function AccountsPanel({ s, p, canEdit, onEditIo, onAddIo }: { s: AppState; p: Project; canEdit: boolean; onEditIo: (io: InternalOrder) => void; onAddIo: () => void }) {
  const woa = p.finance?.woa || p.info?.workOrder || ''
  const [val, setVal] = useState<string | null>(null)
  const split = capitalSplit(s, p)
  const ios = p.finance?.ios ?? []
  const saveWoa = () => {
    const v = (val ?? '').trim()
    if (v === woa) { setVal(null); return }
    mutate((d) => {
      const x = d.projects.find((y) => y.id === p.id)!
      x.finance ??= { ios: [] }
      x.finance.woa = v || undefined
      reviseInfo(d, p.id, { workOrder: v }, 'WOA set on the Finance tab')
    }, { entity: 'finance', entityId: p.id, projectId: p.id, action: 'woa', summary: `${p.code}: WOA ${woa || '(none)'} → ${v || '(none)'}` })
    toast(v ? `WOA ${v} saved` : 'WOA cleared')
    setVal(null)
  }
  const openSap = () => { lsSet('crosswalk:admin-tab', 'sap'); go('#admin') }
  const cap = split.scopeCapitalPct
  return (
    <Panel title="Financial accounts" subtitle="Key facts on the Overview show these; manage them here."
      actions={canEdit && <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={onAddIo}>Add IO</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Work order authorization (WOA)</div>
            {val === null ? (
              <div className="mt-0.5 flex items-center gap-2">{woa ? <Mono className="text-[14px] font-semibold">{woa}</Mono> : <span className="text-[13px] text-faint">Not issued</span>}{canEdit && <Button size="sm" variant="ghost" onClick={() => setVal(woa)}>{woa ? 'Edit' : 'Enter WOA'}</Button>}</div>
            ) : (
              <div className="mt-1 flex items-center gap-2"><Input id="fin-woa" aria-label="WOA number" className="w-44 font-mono" value={val} onChange={(e) => setVal(e.target.value)} placeholder={`WOA-${p.code.slice(4)}-01`} onKeyDown={(e) => e.key === 'Enter' && saveWoa()} /><Button size="sm" variant="primary" onClick={saveWoa}>Save</Button><Button size="sm" variant="ghost" onClick={() => setVal(null)}>Cancel</Button></div>
            )}
          </div>
          <p className="min-w-0 flex-1 text-[11.5px] text-muted">Saving also revises the Project Information record (WOA field), so both always agree.</p>
        </div>

        <Table rows={ios} rowKey={(io) => io.id} dense empty={<Empty title="No internal orders yet">IOs are requested once the project is funded past initiation. Add the capital IO (and an O&M IO when the scope has an O&M share), then pick the WBS functions each one carries.</Empty>} columns={[
          { key: 'n', header: 'Internal order', render: (io) => <span><Mono className="font-semibold">{io.number}</Mono><span className="block text-[11.5px] text-muted">{io.description}</span></span> },
          { key: 't', header: 'Type', render: (io) => <Badge tone={io.type === 'capital' ? 'ink' : 'info'}>{io.type === 'capital' ? 'Capital' : 'O&M'}</Badge> },
          { key: 's', header: 'Status', render: (io) => <StatusBadge status={io.status} label={io.status === 'open' ? 'Open' : undefined} /> },
          { key: 'o', header: 'Opened', render: (io) => <span className="whitespace-nowrap tabular-nums">{fmtDate(io.opened)}</span> },
          { key: 'f', header: 'Carries', render: (io) => <span className="flex max-w-[240px] flex-wrap gap-1">{io.functionIds.map((f) => <Mono key={f} className="rounded bg-sunken px-1 text-[11px]">{s.settings.wbsFunctions.find((w) => w.id === f)?.code ?? f}</Mono>)}</span> },
          { key: 'e', header: '', render: (io) => canEdit ? <Button size="sm" variant="ghost" onClick={() => onEditIo(io)}>Edit</Button> : null },
        ]} />

        <div className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="eyebrow">Capital vs O&M</div>
            <a href={projectHref(p.id, 'overview')} className="text-[11.5px] font-semibold text-link hover:underline">Scope statement split →</a>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SplitBar label="Scope statement" capital={cap} />
            <SplitBar label="Carried by the IOs" capital={split.ioCapitalPct} sub={split.capital + split.om ? `${money(split.capital)} capital · ${money(split.om)} O&M${split.unassigned ? ` · ${money(split.unassigned)} on no IO` : ''}` : 'No budget on an IO yet'} />
          </div>
          {split.deltaPts !== undefined && Math.abs(split.deltaPts) > 5 && (
            <Callout tone="warn">The IOs carry {split.ioCapitalPct}% capital but the scope statement says {cap}%. Move WBS functions between the capital and O&M IOs, or correct the split in the scope statement.</Callout>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Icon name="layers" className="h-4 w-4 text-faint" />
          <span className="min-w-0 flex-1">Cost elements are universal: SAP cost elements map once to forecast lines for every project.</span>
          <button type="button" onClick={openSap} className="font-semibold text-link hover:underline">Configuration → SAP mapping</button>
        </div>
      </div>
    </Panel>
  )
}

function SplitBar({ label, capital, sub }: { label: string; capital?: number; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12px]"><span className="font-semibold">{label}</span><span className="tabular-nums text-muted">{capital === undefined ? '—' : `${capital}% capital · ${Math.round((100 - capital) * 10) / 10}% O&M`}</span></div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-sunken">{capital !== undefined && <><span className="h-full bg-ink" style={{ width: `${capital}%` }} /><span className="h-full bg-info" style={{ width: `${100 - capital}%` }} /></>}</div>
      {sub && <div className="mt-1 text-[11px] text-faint">{sub}</div>}
    </div>
  )
}

// ───────────────────────────── IO coverage by WBS function (feedback loop)
function IoCoveragePanel({ p, cov, canEdit, onNewIo }: { p: Project; cov: ReturnType<typeof ioCoverage>; canEdit: boolean; onNewIo: (fnId: string) => void }) {
  const [all, setAll] = useState(false)
  const ios = (p.finance?.ios ?? []).filter((x) => x.status !== 'closed')
  const rows = cov.rows.filter((r) => all || r.budget > 0)
  const assign = (fnId: string, ioId: string) => {
    if (ioId === '__new') { onNewIo(fnId); return }
    const io = ios.find((x) => x.id === ioId)
    if (!io) return
    const fn = cov.rows.find((r) => r.fnId === fnId)
    mutate((d) => { const x = d.projects.find((y) => y.id === p.id)!.finance!.ios.find((y) => y.id === ioId)!; if (!x.functionIds.includes(fnId)) x.functionIds.push(fnId) },
      { entity: 'internal-order', entityId: ioId, projectId: p.id, action: 'update', summary: `${p.code}: IO ${io.number} now carries ${fn?.code} ${fn?.name}` })
    toast(`${fn?.code} assigned to IO ${io.number}`)
  }
  const tone = (st: string) => (st === 'ok' ? 'good' : st === 'pending' ? 'info' : st === 'duplicate' ? 'warn' : 'bad') as 'good' | 'info' | 'warn' | 'bad'
  const label = (st: string) => ({ ok: 'Carried', pending: 'IO requested', gap: 'No IO', duplicate: 'Two IOs', closed: 'IO closed' } as Record<string, string>)[st]
  return (
    <Panel title="IO coverage by WBS function" subtitle={`Every function with budget must be carried by one live internal order · amounts from the ${cov.basisLabel}`} pad={false}
      actions={<SegButtons options={[{ id: 'budget', label: 'With budget' }, { id: 'all', label: 'All' }]} value={all ? 'all' : 'budget'} onChange={(v) => setAll(v === 'all')} />}>
      {cov.basis === 'none' ? <div className="p-4"><Empty title="No estimate yet">Coverage is checked once the project has an estimate or budget.</Empty></div> : (
        <>
          {cov.gaps.length > 0 ? <div className="border-b border-line px-4 py-2 text-[12.5px] font-semibold text-warn">{cov.gaps.length} function{cov.gaps.length === 1 ? '' : 's'} with budget not carried by an open IO — {money(sum(cov.gaps.map((g) => g.budget)))}</div>
            : <div className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-[12.5px] font-semibold text-good"><Icon name="check" className="h-4 w-4" />Every function with budget is carried by an open IO</div>}
          <Table rows={rows} rowKey={(r) => r.fnId} dense columns={[
            { key: 'f', header: 'WBS function', render: (r) => <span className="whitespace-nowrap"><Mono className="text-faint">{r.code}</Mono> {r.name}</span> },
            { key: 'b', header: 'Budget', num: true, render: (r) => (r.budget ? money(r.budget) : <span className="text-faint">—</span>), sort: (r) => r.budget },
            { key: 'io', header: 'IO', render: (r) => r.ios.length ? <span className="flex flex-wrap gap-1">{r.ios.map((io) => <Mono key={io.id} className={cx('rounded px-1 text-[11px]', io.status === 'closed' ? 'bg-sunken text-faint line-through' : 'bg-sunken')}>{io.number}</Mono>)}</span> : <span className="text-faint">—</span> },
            { key: 's', header: 'Check', render: (r) => r.budget > 0 || r.ios.length ? <Badge tone={tone(r.status)} title={r.note}>{label(r.status)}</Badge> : <span className="text-[11.5px] text-faint">No budget</span> },
            { key: 'a', header: '', render: (r) => canEdit && r.budget > 0 && (r.status === 'gap' || r.status === 'closed') ? (
              <Select aria-label={`Assign ${r.code} to an IO`} className="h-7 w-36 py-0 text-[12px]" value="" onChange={(e) => assign(r.fnId, e.target.value)}
                options={[{ value: '', label: 'Assign to IO…' }, ...ios.map((io) => ({ value: io.id, label: ioLabel(io) })), { value: '__new', label: 'New IO…' }]} />
            ) : null },
          ]} />
        </>
      )}
    </Panel>
  )
}

// ───────────────────────────── Commitments table
function CommitmentTable({ s, p, rows, onOpen }: { s: AppState; p: Project; rows: CommitmentRow[]; onOpen: (id: string) => void }) {
  return (
    <Table rows={rows} rowKey={(r) => r.c.id} onRowClick={(r) => onOpen(r.c.id)} empty={<div className="p-4"><Empty title="No commitments yet">Add each vendor PO the project will use, with the share of the PO intended for this project and the forecast lines it buys.</Empty></div>} columns={[
      { key: 'v', header: 'Vendor', sort: (r) => r.c.vendor, render: (r) => <span className="block min-w-[180px]"><span className="font-semibold">{r.c.vendor || 'TBD'}</span> <span className="text-[11px] text-faint">{r.c.type}</span><span className="block max-w-[260px] truncate text-[11.5px] text-muted" title={r.c.scope}>{r.c.scope || 'No scope stated'}</span></span> },
      { key: 'po', header: 'PO', render: (r) => <span className="whitespace-nowrap"><Mono>{r.c.poNumber || '—'}</Mono>{r.c.status === 'rfp' && <Badge className="ml-1">RFP</Badge>}</span> },
      { key: 'pt', header: 'PO total', num: true, sort: (r) => r.c.poTotal ?? 0, render: (r) => money(r.c.poTotal) },
      { key: 'pct', header: '% of PO', num: true, sort: (r) => r.c.pctOfPo ?? 0, render: (r) => <span title={r.usedPct !== undefined ? `Current commitment uses ${r.usedPct}% of the PO` : undefined} className={cx(r.overShare && 'font-semibold text-warn')}>{r.c.pctOfPo !== undefined ? `${r.c.pctOfPo}%` : '—'}{r.overShare && <span className="block text-[10.5px]">uses {r.usedPct}%</span>}</span> },
      { key: 'cm', header: 'Committed', num: true, sort: (r) => r.committed, render: (r) => money(r.committed) },
      { key: 'ch', header: 'Approved changes', num: true, sort: (r) => r.approvedChanges, render: (r) => <span>{r.approvedChanges ? moneyDelta(r.approvedChanges) : '—'}{r.pendingChanges !== 0 && <span className="block text-[10.5px] text-info">{moneyDelta(r.pendingChanges)} in review</span>}</span> },
      { key: 'cur', header: 'Current', num: true, sort: (r) => r.current, render: (r) => <b>{money(r.current)}</b> },
      { key: 'inv', header: 'Invoiced', num: true, sort: (r) => r.invoiced, render: (r) => money(r.invoiced) },
      { key: 'rem', header: 'Remaining', num: true, sort: (r) => r.remaining, render: (r) => <span className={cx(r.remaining < 0 && 'font-semibold text-bad')}>{money(r.remaining)}</span> },
      { key: 'l', header: 'Lines', render: (r) => <span className="whitespace-nowrap text-[12px]" title={(r.c.lineIds ?? []).map((l) => `${lineById(s, l)?.code} ${lineById(s, l)?.name}`).join('\n')}>{(r.c.lineIds ?? []).map((l) => lineById(s, l)?.code).join(', ') || <span className="text-bad">none</span>}</span> },
      { key: 'io', header: 'IO', render: (r) => { const io = p.finance?.ios.find((x) => x.id === r.c.ioId); return io ? <Mono className="text-[11.5px]">{io.number}</Mono> : <span className="text-[12px] text-bad">none</span> } },
      { key: 'x', header: 'Checks', render: (r) => { const iss = commitmentIssues(s, p, r.c); return iss.length ? <Badge tone="warn" title={iss.join('\n')}>{iss.length} issue{iss.length === 1 ? '' : 's'}</Badge> : <Badge tone="good">OK</Badge> } },
    ]} />
  )
}

// ───────────────────────────── Estimate line coverage
function LineCoveragePanel({ s, cov, canEdit, onCover, onOpen }: { s: AppState; cov: ReturnType<typeof lineCoverage>; canEdit: boolean; onCover: (lineId: string) => void; onOpen: (contractId: string) => void }) {
  const [only, setOnly] = useState(cov.gaps.length > 0)
  const rows = cov.rows.filter((r) => !only || r.status === 'gap')
  return (
    <Panel title="Estimate line coverage" subtitle={`Every estimate line must be assigned to a vendor commitment · amounts from the ${cov.basisLabel}`} pad={false}
      actions={<SegButtons options={[{ id: 'gaps', label: `Uncovered ${cov.gaps.length}` }, { id: 'all', label: `All ${cov.rows.length}` }]} value={only ? 'gaps' : 'all'} onChange={(v) => setOnly(v === 'gaps')} />}>
      {cov.basis === 'none' ? <div className="p-4"><Empty title="No estimate yet">Line coverage is checked once the project has an estimate.</Empty></div> : (
        <>
          {cov.gaps.length > 0 ? <div className="border-b border-line px-4 py-2 text-[12.5px] font-semibold text-warn">{cov.gaps.length} line{cov.gaps.length === 1 ? '' : 's'} ({money(cov.uncovered)}) not assigned to any commitment — add the PO that buys each one.</div>
            : <div className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-[12.5px] font-semibold text-good"><Icon name="check" className="h-4 w-4" />Every estimate line is covered by a commitment or company labor</div>}
          <Table rows={rows} rowKey={(r) => r.lineId} dense empty={<div className="p-4 text-[13px] text-muted">No uncovered lines.</div>} columns={[
            { key: 'l', header: 'Forecast line', render: (r) => <span className="whitespace-nowrap"><Mono className="text-faint">{r.code}</Mono> {r.name}</span> },
            { key: 'b', header: 'Budget', num: true, sort: (r) => r.budget, render: (r) => money(r.budget) },
            { key: 'c', header: 'Committed (attributed)', num: true, sort: (r) => r.committed, render: (r) => (r.contractIds.length ? money(r.committed) : '—') },
            { key: 'k', header: 'Commitments', render: (r) => r.contractIds.length ? <span className="flex flex-wrap gap-1">{r.contractIds.map((id) => { const c = s.contracts.find((x) => x.id === id)!; return <button key={id} onClick={() => onOpen(id)} className="text-[12px] font-semibold text-link hover:underline">{c.vendor}</button> })}</span> : r.status === 'company' ? <span className="text-[12px] text-muted">{NON_COMMITMENT_LINES[r.lineId]}</span> : <span className="text-[12px] text-faint">—</span> },
            { key: 's', header: 'Check', render: (r) => <Badge tone={r.status === 'covered' ? 'good' : r.status === 'company' ? 'neutral' : 'warn'}>{r.status === 'covered' ? 'Covered' : r.status === 'company' ? 'Company / direct' : 'Uncovered'}</Badge> },
            { key: 'a', header: '', render: (r) => canEdit && r.status === 'gap' ? <Button size="sm" onClick={() => onCover(r.lineId)}>Add commitment</Button> : null },
          ]} />
        </>
      )}
    </Panel>
  )
}

// ───────────────────────────── Project-wide RFI / CCO log
function CcoLog({ s, p, onOpen }: { s: AppState; p: Project; onOpen: (contractId: string, ccoId: string) => void }) {
  const rows = s.commitmentChanges.filter((x) => x.projectId === p.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.code.localeCompare(a.code))
  if (!rows.length) return null
  return (
    <Panel title="RFI / change order log" subtitle="Every change to what a vendor is paid, with its approval status. Approved amounts are in the commitments above." pad={false}>
      <Table rows={rows} rowKey={(x) => x.id} onRowClick={(x) => onOpen(x.contractId, x.id)} dense columns={[
        { key: 'c', header: 'Code', sort: (x) => x.code, render: (x) => <Mono className="font-semibold">{x.code}</Mono> },
        { key: 'v', header: 'Commitment', render: (x) => <span className="whitespace-nowrap">{s.contracts.find((c) => c.id === x.contractId)?.vendor ?? '—'}</span> },
        { key: 'r', header: 'RFI / field condition', render: (x) => <span className="block min-w-[220px]">{x.rfi}<span className="block text-[11.5px] text-muted">{x.description}</span></span> },
        { key: 'a', header: 'Amount', num: true, sort: (x) => x.amount, render: (x) => <span className={cx('font-semibold', x.amount > 0 ? 'text-bad' : x.amount < 0 ? 'text-good' : '')}>{moneyDelta(x.amount)}</span> },
        { key: 'd', header: 'Days', num: true, render: (x) => (x.scheduleImpactDays ? `+${x.scheduleImpactDays}` : '0') },
        { key: 'ch', header: 'Project change', render: (x) => { const ch = s.changes.find((c) => c.id === x.changeId); return ch ? <a href={projectHref(p.id, 'changes')} onClick={(e) => { e.stopPropagation(); setFocusChange(ch.id) }} className="font-mono text-[12px] font-semibold text-link hover:underline">{ch.code}</a> : <span className="text-faint">—</span> } },
        { key: 'q', header: 'Requested', sort: (x) => x.requestedAt, render: (x) => <span className="whitespace-nowrap text-[12px]">{fmtDate(x.requestedAt)} · {personName(s, x.requestedById)}</span> },
        { key: 's', header: 'Status', sort: (x) => x.status, render: (x) => <StatusBadge status={x.status} /> },
      ]} />
    </Panel>
  )
}
