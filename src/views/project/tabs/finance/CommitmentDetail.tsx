// One commitment: PO share, the money waterfall (committed → approved changes → current → invoiced → remaining),
// data-quality flags, and its RFI / change order log with the live workflow for each.
import { useState } from 'react'
import { personName, useStore } from '@/core/store'
import type { CommitmentChange } from '@/core/types'
import { commitmentIssues, commitmentRow } from '@/core/engine/finance'
import { lineById } from '@/core/engine/lines'
import { projectHref } from '@/core/router'
import { fmtDate, money, moneyDelta, cx } from '@/core/util'
import { Badge, Button, Callout, Drawer, Empty, KV, Mono, Progress, Section, StatusBadge } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { WorkflowStatus } from '../../../shared/WorkflowStatus'
import { setFocusChange } from '../controls/trace'

export function CommitmentDetail({ contractId, focusCco, onClose, onEdit, onNewCco, canEdit = true }: { contractId: string; focusCco?: string; onClose: () => void; onEdit: () => void; onNewCco: () => void; canEdit?: boolean }) {
  const s = useStore()
  const c = s.contracts.find((x) => x.id === contractId)
  const [open, setOpen] = useState<string | null>(focusCco ?? null)
  if (!c) return null
  const p = s.projects.find((x) => x.id === c.projectId)!
  const r = commitmentRow(s, c)
  const issues = commitmentIssues(s, p, c)
  const io = p.finance?.ios.find((x) => x.id === c.ioId)
  const billed = r.current ? r.invoiced / r.current : 0
  const live = c.status !== 'rfp' && c.status !== 'closed'
  return (
    <Drawer open onClose={onClose} width={680} title={<span className="flex flex-wrap items-center gap-2">{c.vendor}<Badge>{c.type}</Badge><StatusBadge status={c.status} label={c.status === 'rfp' ? 'RFP' : undefined} /></span>}
      footer={canEdit ? <><Button variant="ghost" onClick={onEdit}>Edit commitment</Button>{live && <Button variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={onNewCco}>New RFI / change order</Button>}</> : undefined}>
      <div className="flex flex-col gap-4">
        <KV cols={3} items={[
          ['SAP PO', <Mono key="po">{c.poNumber || '—'}</Mono>], ['PO total (all projects)', money(c.poTotal, 'full')], ['% of PO for this project', c.pctOfPo !== undefined ? `${c.pctOfPo}% · ${money(r.poShare)}` : '—'],
          ['Call-off / contract', <Mono key="n">{c.number || '—'}</Mono>], ['Internal order', io ? <span key="io"><Mono>{io.number}</Mono> · {io.type === 'capital' ? 'Capital' : 'O&M'}</span> : <span className="text-bad">None</span>], ['Awarded', fmtDate(c.awarded)],
        ]} />
        {c.scope && <div className="rounded-md border border-line bg-sunken/40 px-3 py-2 text-[13px]"><div className="eyebrow mb-0.5">Scope of work</div>{c.scope}</div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([['Committed', r.committed], ['Approved changes', r.approvedChanges], ['Current', r.current], ['Invoiced', r.invoiced], ['Remaining', r.remaining]] as [string, number][]).map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-md border border-line px-2.5 py-1.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{k}</div>
              <div className={cx('font-display text-[16px] font-bold tabular-nums', k === 'Remaining' && v < 0 && 'text-bad')}>{k === 'Approved changes' ? moneyDelta(v) : money(v)}</div>
            </div>
          ))}
        </div>
        <div>
          <Progress value={billed * 100} tone={billed > 1 ? 'bad' : 'ink'} />
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-[11.5px] text-muted">
            <span>{(billed * 100).toFixed(0)}% invoiced</span>
            {r.usedPct !== undefined && <span className={r.overShare ? 'font-semibold text-warn' : ''}>Uses {r.usedPct}% of the PO{c.pctOfPo !== undefined ? ` · ${c.pctOfPo}% planned` : ''}{r.overShare ? ' — raise the planned share with supply' : ''}</span>}
            {r.pendingChanges !== 0 && <span>{moneyDelta(r.pendingChanges)} in review</span>}
          </div>
        </div>
        {issues.length > 0 && <Callout tone="warn" title="Fix before the next forecast">{issues.map((x) => <div key={x}>• {x}</div>)}</Callout>}
        <Section title="Forecast lines covered">
          <div className="flex flex-wrap gap-1.5">{(c.lineIds ?? []).map((l) => { const line = lineById(s, l); return <span key={l} className="rounded border border-line px-1.5 py-0.5 text-[12px]"><Mono className="text-faint">{line?.code}</Mono> {line?.name ?? l}</span> })}{!c.lineIds?.length && <span className="text-[13px] text-faint">None assigned</span>}</div>
        </Section>
        <Section title={`RFI / change orders (${r.ccos.length})`}>
          {r.ccos.length === 0 ? <Empty title="No RFI / change orders">Every change to what this vendor is paid starts here, so the commitment and the forecast move together.</Empty> : (
            <ul className="flex flex-col gap-2">
              {r.ccos.map((x) => <CcoItem key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} />)}
            </ul>
          )}
        </Section>
        <p className="text-xs text-faint">{p.code} · commitment id <Mono>{c.id}</Mono>. Approved changes are added by the RFI / CCO workflow only.</p>
      </div>
    </Drawer>
  )
}

function CcoItem({ x, open, onToggle }: { x: CommitmentChange; open: boolean; onToggle: () => void }) {
  const s = useStore()
  const ch = s.changes.find((c) => c.id === x.changeId)
  return (
    <li className="rounded-md border border-line">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-sunken/50">
        <Mono className="font-semibold">{x.code}</Mono>
        <StatusBadge status={x.status} />
        <span className="min-w-0 flex-1 text-[13px]">{x.rfi}</span>
        <span className={cx('font-semibold tabular-nums', x.amount > 0 ? 'text-bad' : x.amount < 0 ? 'text-good' : '')}>{moneyDelta(x.amount)}</span>
        <span className="text-[12px] tabular-nums text-muted">{x.scheduleImpactDays ? `+${x.scheduleImpactDays}d` : '0d'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
          <p className="text-[13px]">{x.description}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            <span>Requested {fmtDate(x.requestedAt)} by {personName(s, x.requestedById)}</span>
            {x.decidedAt && <span>Decided {fmtDate(x.decidedAt)}</span>}
            {ch ? <a href={projectHref(x.projectId, 'changes')} onClick={() => setFocusChange(ch.id)} className="font-semibold text-link hover:underline">Rolls into {ch.code}</a> : <span>Absorbed within the commitment (no project change)</span>}
          </div>
          {x.workflowInstanceId && <WorkflowStatus instanceId={x.workflowInstanceId} compact={x.status !== 'in-review'} />}
        </div>
      )}
    </li>
  )
}
