// Shows where a record sits in its workflow and lets the current user act on it.
// Drop it next to any record that has a workflowInstanceId:  <WorkflowStatus instanceId={x.workflowInstanceId} />
import { useState } from 'react'
import { mutate, personName, useStore } from '@/core/store'
import { actOnWorkflow, recallWorkflow, type Decision } from '@/core/engine/workflow'
import { fmtDateTime, cx } from '@/core/util'
import { Avatar, Badge, Button, StatusBadge, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'

export function WorkflowStatus({ instanceId, compact }: { instanceId?: string; compact?: boolean }) {
  const inst = useStore((s) => s.workflows.find((w) => w.id === instanceId))
  const def = useStore((s) => s.workflowDefs.find((d) => d.id === inst?.defId))
  const me = useStore((s) => s.currentUserId)
  const people = useStore((s) => s.people)
  const [comment, setComment] = useState('')
  const [open, setOpen] = useState(!compact)
  if (!inst || !def) return null
  const nodeLabel = (id: string) => def.nodes.find((n) => n.id === id)?.label ?? 'Step'
  const mine = inst.active.find((a) => a.assigneeIds.includes(me) && !a.actedIds.includes(me))
  const isAdmin = people.find((p) => p.id === me)?.roles.includes('admin')
  const act = (decision: Decision) => {
    const slot = mine ?? inst.active[0]
    if (!slot) return
    if ((decision === 'reject' || decision === 'return') && !comment.trim()) { toast('Add a comment explaining why.', 'bad'); return }
    try {
      mutate((d) => actOnWorkflow(d, inst.id, slot.nodeId, me, decision, comment || undefined))
      toast(decision === 'approve' ? 'Approved and signed' : decision === 'submit' ? 'Submitted' : decision === 'return' ? 'Returned for revision' : 'Rejected', decision === 'reject' ? 'bad' : 'good')
      setComment('')
    } catch (e: any) { toast(e.message, 'bad') }
  }
  const step = mine ? def.nodes.find((n) => n.id === mine.nodeId) : undefined
  return (
    <div className="rounded-md border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
        <span className="eyebrow">Workflow</span>
        <span className="text-[13px] font-semibold">{def.name}</span>
        <span className="text-xs text-faint">v{inst.defVersion}</span>
        <StatusBadge status={inst.status} />
        {inst.active.map((a) => <Badge key={a.nodeId} tone="marker">At: {nodeLabel(a.nodeId)} · {a.assigneeIds.map((id) => personName({ people }, id)).join(', ')}</Badge>)}
        <span className="ml-auto text-xs text-muted">{open ? 'Hide' : 'Show'} history</span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-3">
          <ol className="relative ml-2 border-l border-line">
            {inst.history.filter((h) => h.action !== 'system' || h.comment).map((h) => (
              <li key={h.id} className="mb-2.5 ml-4">
                <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', h.action === 'approve' || h.action === 'complete' ? 'bg-good' : h.action === 'reject' ? 'bg-bad' : h.action === 'return' ? 'bg-warn' : 'bg-faint')} />
                <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                  {h.actorId !== 'system' && <Avatar name={personName({ people }, h.actorId)} size={18} />}
                  <b>{personName({ people }, h.actorId)}</b>
                  <span className="text-muted">{h.action === 'complete' ? `completed — ${h.comment}` : h.action}{h.nodeId && h.action !== 'complete' ? ` · ${nodeLabel(h.nodeId)}` : ''}</span>
                  {h.signature && <Badge tone="good" title={`Signature ${h.signature.hash}`}>e-signed</Badge>}
                  <span className="text-xs text-faint">{fmtDateTime(h.at)}</span>
                </div>
                {h.comment && h.action !== 'complete' && <p className="mt-0.5 text-[13px] text-muted">“{h.comment}”</p>}
              </li>
            ))}
          </ol>
          {inst.status === 'running' && (mine || isAdmin) && (
            <div className="mt-2 flex flex-col gap-2 rounded-md border border-marker/60 bg-marker/5 p-3">
              <div className="text-[13px] font-semibold">{mine ? `Your step: ${step?.label}` : `Act as administrator on: ${nodeLabel(inst.active[0]?.nodeId ?? '')}`}</div>
              {step?.description && <p className="text-xs text-muted">{step.description}</p>}
              <TextArea id={`wf-comment-${inst.id}`} placeholder="Comment (required to return or reject)" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[56px]" />
              <div className="flex flex-wrap gap-2">
                {step?.type === 'form' ? <Button variant="primary" onClick={() => act('submit')}>Submit</Button> : <Button variant="primary" onClick={() => act('approve')}>Approve & sign</Button>}
                <Button onClick={() => act('return')}>Return for revision</Button>
                {step?.type !== 'form' && <Button variant="ghost" className="text-bad" onClick={() => act('reject')}>Reject</Button>}
              </div>
            </div>
          )}
          {inst.status === 'running' && inst.startedById === me && (
            <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => { mutate((d) => recallWorkflow(d, inst.id, me)); toast('Recalled') }}>Recall</Button></div>
          )}
        </div>
      )}
    </div>
  )
}
