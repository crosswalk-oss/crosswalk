// My work (#inbox): every workflow step waiting on the current person, with the record summary beside it,
// e-signature with re-authentication (WF-10), bulk approval for low-risk items, delegation (WF-06) and notifications.
import { useEffect, useMemo, useState } from 'react'
import type { AppState, Person, WorkflowInstance } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { go, workflowHref } from '@/core/router'
import { actOnWorkflow, recallWorkflow, tasksFor, type Decision, type Task } from '@/core/engine/workflow'
import { addDays, cx, daysBetween, fmtDate, fmtDateTime, money, nowISO, uid } from '@/core/util'
import { Avatar, Badge, Button, Callout, Checkbox, Drawer, Empty, Field, Input, Modal, PageHeader, Panel, Select, StatusBadge, Tabs, TextArea, Mono } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { isLowRisk, isOutOfOffice, nodeTypeLabel, nowMs, recordTypeLabel, relTime, signatureHash, taskAmount, fmtDur } from '../workflows/lib'
import { useNarrow } from '../workflows/hooks'
import { ProjectLine, RecordSummary, recordHref } from './records'
import { openEscalations, taskNoticeState } from '@/core/engine/notify'
import { dmHref } from '../messages/lib'

type Tab = 'mine' | 'escalated' | 'started' | 'done' | 'delegation' | 'notifications'
const taskKey = (t: Task) => `${t.inst.id}:${t.node.id}`

export default function Inbox(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const me = useMe()
  const narrow = useNarrow(1024)
  const [tab, setTab] = useState<Tab>('mine')
  const tasks = useMemo(() => tasksFor(s, me.id), [s.workflows, me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [rt, setRt] = useState('')
  const filtered = tasks.filter((t) => (!rt || t.inst.recordType === rt) && (!q || `${t.inst.title} ${t.node.label} ${code(s, t.inst.projectId)}`.toLowerCase().includes(q.toLowerCase())))
  const [selKey, setSelKey] = useState<string | undefined>()
  const sel = filtered.find((t) => taskKey(t) === selKey) ?? (narrow ? undefined : filtered[0])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  useEffect(() => { setChecked(new Set()); setSelKey(undefined) }, [me.id])

  const started = s.workflows.filter((w) => w.startedById === me.id && w.status === 'running')
  const unread = s.notifications.filter((n) => n.toId === me.id && !n.read).length
  const overdue = tasks.filter((t) => t.overdue).length
  const delegatedToMe = s.people.filter((p) => p.outOfOffice?.delegateId === me.id && isOutOfOffice(p, s.settings.asOf))
  const actingCount = tasks.filter((t) => t.actingFor).length
  const escalatedToMe = useMemo(() => openEscalations(s, me.id), [s.workflows, me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const lowRisk = filtered.filter(isLowRisk)

  const groups = useMemo(() => {
    const soon = addDays(s.settings.asOf, 3), week = addDays(s.settings.asOf, 7)
    const g = { due: [] as Task[], week: [] as Task[], later: [] as Task[] }
    for (const t of filtered) (t.overdue || (t.due && t.due <= soon) ? g.due : t.due && t.due <= week ? g.week : g.later).push(t)
    return g
  }, [filtered, s.settings.asOf])

  const afterAct = (key: string) => {
    const idx = filtered.findIndex((t) => taskKey(t) === key)
    const next = filtered[idx + 1] ?? filtered[idx - 1]
    setSelKey(next && taskKey(next) !== key ? taskKey(next) : undefined)
  }

  const detail = sel ? <TaskDetail key={taskKey(sel)} s={s} me={me} task={sel} onDone={() => afterAct(taskKey(sel))} /> : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Work" title="My work"
        subtitle={<>Steps waiting on <b className="text-ink">{me.name}</b>, {me.title}. Switch persona in the top bar to act as anyone in the routing.</>}
        actions={<a href="#workflows" className="text-[12.5px] font-semibold text-link">How work routes →</a>} />

      {(isOutOfOffice(me, s.settings.asOf) || delegatedToMe.length > 0) && (
        <Callout tone="info" title={isOutOfOffice(me, s.settings.asOf) ? `You are out of office until ${fmtDate(me.outOfOffice!.to)}` : 'You are covering for colleagues'}>
          {isOutOfOffice(me, s.settings.asOf) && <>{personName(s, me.outOfOffice!.delegateId)} is acting for you: new steps route to them and they can act on the steps already waiting on you. </>}
          {delegatedToMe.length > 0 && <>You are acting for {delegatedToMe.map((p) => `${p.name} (until ${fmtDate(p.outOfOffice!.to)})`).join(', ')}{actingCount ? <> — <b>{actingCount}</b> of their step{actingCount === 1 ? ' is' : 's are'} in your list, marked “acting for”</> : ''}. New steps for them route to you.</>}
          {' '}<button className="font-semibold text-link" onClick={() => setTab('delegation')}>Delegation settings</button>
        </Callout>
      )}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'mine', label: <span className="flex items-center gap-1.5">Waiting on me{overdue > 0 && <span className="rounded-full bg-bad px-1.5 text-[10.5px] font-bold text-white">{overdue} overdue</span>}</span>, count: tasks.length },
        ...(escalatedToMe.length ? [{ id: 'escalated' as Tab, label: <span className="flex items-center gap-1.5">Escalated to me</span>, count: escalatedToMe.length }] : []),
        { id: 'started', label: 'Started by me', count: started.length },
        { id: 'done', label: 'Completed recently' },
        { id: 'delegation', label: 'Delegation' },
        { id: 'notifications', label: 'Notifications', count: unread || undefined },
      ]} />

      {tab === 'mine' && (
        tasks.length === 0 ? <Empty title="Nothing is waiting on you">When a request reaches a step you own — or one delegated to you — it appears here with its SLA.</Empty> : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Search tasks" placeholder="Search by project, record or step" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 min-w-0 flex-1" />
                <Select aria-label="Record type" className="h-8 w-auto" value={rt} onChange={(e) => setRt(e.target.value)} options={[{ value: '', label: 'All records' }, ...Array.from(new Set(tasks.map((t) => t.inst.recordType))).map((r) => ({ value: r, label: recordTypeLabel(r) }))]} />
              </div>
              {lowRisk.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px]">
                  <Checkbox checked={lowRisk.every((t) => checked.has(taskKey(t)))} onChange={(v) => setChecked(v ? new Set(lowRisk.map(taskKey)) : new Set())} label={<span><b>{lowRisk.length}</b> low-risk item{lowRisk.length > 1 ? 's' : ''} can be approved together</span>} />
                  <span className="text-faint" title="Routine reviews and decisions up to $250K. Gates, estimates, budgets, contracts and exceptions always need individual review.">What counts?</span>
                  <Button size="sm" variant="primary" className="ml-auto" disabled={!checked.size} onClick={() => setBulkOpen(true)}>Approve selected ({checked.size})</Button>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {(['due', 'week', 'later'] as const).map((g) => groups[g].length > 0 && (
                  <section key={g} className="min-w-0">
                    <h3 className={cx('eyebrow mb-1.5 flex items-center gap-2', g === 'due' && 'text-bad')}>{g === 'due' ? 'Due now / overdue' : g === 'week' ? 'Due this week' : 'Later'}<span className="font-normal normal-case tracking-normal text-faint">{groups[g].length}</span></h3>
                    <ul className="overflow-hidden rounded-md border border-line bg-surface">
                      {groups[g].map((t) => <TaskRow key={taskKey(t)} s={s} t={t} selected={sel ? taskKey(sel) === taskKey(t) : false} checked={checked.has(taskKey(t))} canBulk={isLowRisk(t)}
                        onCheck={(v) => setChecked((c) => { const n = new Set(c); v ? n.add(taskKey(t)) : n.delete(taskKey(t)); return n })} onClick={() => setSelKey(taskKey(t))} />)}
                    </ul>
                  </section>
                ))}
                {filtered.length === 0 && <Empty title="No tasks match">Clear the search or filter.</Empty>}
              </div>
            </div>
            {!narrow && <div className="min-w-0">{detail ?? <Empty title="Select a task">Pick a step on the left to review the record and act.</Empty>}</div>}
          </div>
        )
      )}
      {narrow && tab === 'mine' && <Drawer open={!!sel} onClose={() => setSelKey(undefined)} title={sel?.node.label ?? ''} width={640}>{detail}</Drawer>}

      {tab === 'escalated' && <EscalatedToMe s={s} rows={escalatedToMe} />}
      {tab === 'started' && <StartedByMe s={s} me={me} />}
      {tab === 'done' && <CompletedRecently s={s} me={me} />}
      {tab === 'delegation' && <Delegation s={s} me={me} tasks={tasks} />}
      {tab === 'notifications' && <Notifications s={s} me={me} onOpenTask={(instId) => { const t = tasks.find((x) => x.inst.id === instId); setTab('mine'); if (t) setSelKey(taskKey(t)) }} />}

      <ReauthModal open={bulkOpen} onClose={() => setBulkOpen(false)} me={me} title={`Approve ${checked.size} item${checked.size > 1 ? 's' : ''}`} commentLabel="Comment (added to each approval)"
        summary={<ul className="max-h-[220px] overflow-y-auto rounded border border-line text-[12.5px]">{filtered.filter((t) => checked.has(taskKey(t))).map((t) => <li key={taskKey(t)} className="flex justify-between gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-0"><span className="min-w-0 truncate"><b>{t.node.label}</b> · {t.inst.title}</span>{taskAmount(t) != null && <span className="shrink-0 tabular-nums text-muted">{money(taskAmount(t))}</span>}</li>)}</ul>}
        onSign={(comment) => {
          const list = filtered.filter((t) => checked.has(taskKey(t)))
          let ok = 0
          for (const t of list) { try { signAndAct(me.id, t, 'approve', comment || 'Approved in batch (low-risk).', true); ok++ } catch (e: any) { toast(`${t.inst.title}: ${e.message}`, 'bad') } }
          setChecked(new Set()); setBulkOpen(false); setSelKey(undefined)
          toast(`${ok} item${ok === 1 ? '' : 's'} approved and e-signed`)
        }} />
    </div>
  )
}

const code = (s: AppState, pid?: string) => s.projects.find((p) => p.id === pid)?.code ?? ''

function dueText(s: AppState, due?: string): { text: string; tone: 'bad' | 'warn' | 'muted' } {
  if (!due) return { text: 'No SLA', tone: 'muted' }
  const d = daysBetween(s.settings.asOf, due)
  if (d < 0) return { text: `Overdue ${-d} day${d === -1 ? '' : 's'}`, tone: 'bad' }
  if (d === 0) return { text: 'Due today', tone: 'warn' }
  if (d === 1) return { text: 'Due tomorrow', tone: 'warn' }
  return { text: `Due in ${d} days`, tone: d <= 3 ? 'warn' : 'muted' }
}

/** Reminder / escalation state of a task for the person it is assigned to. */
function noticeOf(s: AppState, t: Task, personId: string) {
  const slot = t.inst.active.find((a) => a.nodeId === t.node.id)
  if (!slot) return undefined
  const n = taskNoticeState(t.inst, slot, t.actingFor ?? personId)
  const esc = n.escalated ?? n.escalations[0]
  return { reminded: n.overdueReminded ?? n.reminded, overdue: !!n.overdueReminded, escalatedTo: esc ? personName(s, esc.to) : undefined, escalatedAt: esc?.at }
}

function TaskRow({ s, t, selected, checked, canBulk, onCheck, onClick }: { s: AppState; t: Task; selected: boolean; checked: boolean; canBulk: boolean; onCheck: (v: boolean) => void; onClick: () => void }) {
  const due = dueText(s, t.due)
  const me = s.currentUserId
  const nt = noticeOf(s, t, me)
  const amt = taskAmount(t)
  const p = s.projects.find((x) => x.id === t.inst.projectId)
  return (
    <li className={cx('flex items-stretch border-b border-line/70 last:border-0', selected ? 'bg-marker/10' : 'hover:bg-sunken/60')}>
      <div className={cx('w-1 shrink-0', selected ? 'bg-marker' : t.overdue ? 'bg-bad' : 'bg-transparent')} />
      <div className="flex w-8 shrink-0 items-start justify-center pt-3">
        {canBulk && <input type="checkbox" aria-label="Select for bulk approval" className="h-4 w-4 accent-[rgb(var(--ink))]" checked={checked} onChange={(e) => onCheck(e.target.checked)} />}
      </div>
      <button onClick={onClick} className="min-w-0 flex-1 py-2.5 pr-3 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Badge tone={t.node.type === 'approval' ? 'marker' : t.node.type === 'form' ? 'info' : 'neutral'}>{t.node.type === 'approval' ? 'Approve' : t.node.type === 'form' ? 'Submit' : 'Review'}</Badge>
          <span className="text-[13px] font-semibold">{t.node.label}</span>
          {t.actingFor && <Badge tone="info" title="Assigned to a colleague who is out of office; you can act on their behalf">Acting for {personName(s, t.actingFor)}</Badge>}
          <span className={cx('ml-auto whitespace-nowrap text-[11.5px] font-semibold', due.tone === 'bad' ? 'text-bad' : due.tone === 'warn' ? 'text-warn' : 'text-muted')}>{due.text}</span>
        </div>
        <div className="mt-0.5 truncate text-[12.5px]">{t.inst.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
          <span>{recordTypeLabel(t.inst.recordType)}</span>
          {p && <span className="font-mono">{p.code}</span>}
          {amt != null && <span className="tabular-nums">{money(amt)}</span>}
          <span>from {personName(s, t.inst.startedById)}</span>
          <span title={fmtDateTime(t.since)}>waiting {relTime(t.since, nowMs(s)).replace(' ago', '')}</span>
          {nt?.escalatedTo ? <span className="font-semibold text-bad" title={`Escalated ${fmtDate(nt.escalatedAt)}`}>escalated to {nt.escalatedTo}</span>
            : nt?.reminded ? <span className={nt.overdue ? 'text-warn' : ''} title={`Reminder sent ${fmtDate(nt.reminded)}`}>{nt.overdue ? 'overdue notice sent' : 'reminder sent'}</span> : null}
        </div>
      </button>
    </li>
  )
}

/** Act on a step and stamp the e-signature as password re-authenticated (WF-10). */
function signAndAct(actorId: string, t: Task, decision: Decision, comment: string | undefined, reauth: boolean) {
  mutate((d) => {
    const before = d.workflows.find((w) => w.id === t.inst.id)?.history.length ?? 0
    actOnWorkflow(d, t.inst.id, t.node.id, actorId, decision, comment)
    const inst = d.workflows.find((w) => w.id === t.inst.id)!
    const ev = inst.history.slice(before).find((h) => h.actorId === actorId && h.nodeId === t.node.id)
    if (ev && decision === 'approve' && reauth) {
      ev.signature = { method: 'password-reauth', hash: signatureHash([inst.id, t.node.id, actorId, ev.at, decision, comment ?? '']) }
      d.audit.push({ id: uid('aud'), at: nowISO(), actorId, entity: 'workflow', entityId: inst.id, projectId: inst.projectId, action: 'e-sign', summary: `E-signed “${t.node.label}” on ${inst.title} after password re-authentication (signature ${ev.signature.hash})` })
    }
  })
}

function TaskDetail({ s, me, task, onDone }: { s: AppState; me: Person; task: Task; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [reauth, setReauth] = useState(false)
  const inst = task.inst
  const href = recordHref(inst)
  const due = dueText(s, task.due)
  const slot = inst.active.find((a) => a.nodeId === task.node.id)
  const others = slot ? slot.assigneeIds.filter((x) => x !== me.id && x !== task.actingFor) : []
  const nt = noticeOf(s, task, me.id)
  const away = task.actingFor ? s.people.find((p) => p.id === task.actingFor) : undefined
  const act = (decision: Decision) => {
    if ((decision === 'reject' || decision === 'return') && !comment.trim()) { toast('Add a comment explaining why.', 'bad'); document.getElementById('inbox-comment')?.focus(); return }
    if (decision === 'approve') { setReauth(true); return }
    try {
      signAndAct(me.id, task, decision, comment.trim() || undefined, false)
      toast(decision === 'submit' ? 'Submitted' : decision === 'return' ? 'Returned for revision' : 'Rejected', decision === 'reject' ? 'bad' : 'good')
      onDone()
    } catch (e: any) { toast(e.message, 'bad') }
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Panel title={<span className="flex flex-wrap items-center gap-2">{task.node.label}<Badge tone={task.node.type === 'approval' ? 'marker' : 'neutral'}>{nodeTypeLabel(task.node.type)}</Badge></span>}
        subtitle={<>{inst.title}</>}
        actions={href ? <a href={href} className="text-[12.5px] font-semibold text-link">Open record →</a> : undefined}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
            <span>{recordTypeLabel(inst.recordType)}</span>
            <span>Started by <b className="text-ink">{personName(s, inst.startedById)}</b> {relTime(inst.startedAt, nowMs(s))}{inst.startedById !== me.id && <> · <a href={dmHref(inst.startedById)} className="text-link">Message</a></>}</span>
            <span>Waiting since {fmtDateTime(task.since)}</span>
            <span className={due.tone === 'bad' ? 'font-semibold text-bad' : due.tone === 'warn' ? 'font-semibold text-warn' : ''}>{due.text}{task.due ? ` (${fmtDate(task.due)}, ${task.node.slaDays}-day SLA)` : ''}</span>
          </div>
          {(nt?.reminded || nt?.escalatedTo) && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {nt.reminded && <Badge tone={nt.overdue ? 'warn' : 'info'}>{nt.overdue ? 'Overdue notice' : 'Reminder'} sent {fmtDate(nt.reminded)}</Badge>}
              {nt.escalatedTo && <Badge tone="bad">Escalated to {nt.escalatedTo} {fmtDate(nt.escalatedAt)}</Badge>}
              <a href="#admin-notify" className="text-[11.5px] text-faint hover:text-link">Reminder rules</a>
            </div>
          )}
          <ProjectLine s={s} projectId={inst.projectId} />
          <RecordSummary s={s} inst={inst} />
        </div>
      </Panel>
      <div className="flex flex-col gap-2 rounded-md border border-marker/70 bg-marker/5 p-3">
        <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">Your decision</b>{task.node.type !== 'form' && <span className="text-[11.5px] text-muted">Approvals are e-signed after you re-enter your password.</span>}</div>
        {away && <Callout tone="info" title={`Acting for ${away.name}`}>{away.name} is out of office{away.outOfOffice ? ` until ${fmtDate(away.outOfOffice.to)}` : ''} and named you as delegate. Your decision is signed by you and recorded on the step as on behalf of {away.name.split(' ')[0]}.</Callout>}
        {task.node.description && <p className="text-[12.5px] text-muted">{task.node.description}</p>}
        {others.length > 0 && <p className="text-[12px] text-muted">{task.node.rule === 'all' ? `All must act: ${slot!.assigneeIds.map((x) => `${personName(s, x)}${slot!.actedIds.includes(x) ? ' ✓' : ''}`).join(', ')}` : `Also assigned: ${others.map((x) => personName(s, x)).join(', ')} — the first to act decides.`}</p>}
        <TextArea id="inbox-comment" placeholder={task.node.type === 'form' ? 'Note for the next reviewer (optional)' : 'Comment (required to return or reject)'} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[60px] bg-surface" />
        <div className="flex flex-wrap gap-2">
          {task.node.type === 'form'
            ? <Button variant="primary" onClick={() => act('submit')}>Submit</Button>
            : <Button variant="primary" onClick={() => act('approve')}>Approve & sign</Button>}
          {task.node.type !== 'form' && <Button onClick={() => act('return')}>Return for revision</Button>}
          {task.node.type !== 'form' && <Button variant="ghost" className="text-bad" onClick={() => act('reject')}>Reject</Button>}
          <a href={workflowHref(inst.defKey)} className="ml-auto self-center text-[12px] text-link">Process v{inst.defVersion}</a>
        </div>
      </div>
      <Panel title="History" pad={false}><Timeline s={s} inst={inst} /></Panel>
      <ReauthModal open={reauth} onClose={() => setReauth(false)} me={me} title={`Sign: ${task.node.label}`} initialComment={comment}
        summary={<div className="rounded border border-line bg-sunken/50 px-3 py-2 text-[12.5px]"><b>{inst.title}</b><div className="text-muted">{recordTypeLabel(inst.recordType)}{taskAmount(task) != null ? ` · ${money(taskAmount(task))}` : ''}</div></div>}
        onSign={(c) => {
          try {
            signAndAct(me.id, task, 'approve', c || undefined, true)
            setReauth(false)
            toast('Approved and e-signed')
            onDone()
          } catch (e: any) { toast(e.message, 'bad') }
        }} />
    </div>
  )
}

function ReauthModal({ open, onClose, me, title, summary, onSign, initialComment = '', commentLabel = 'Comment (optional)' }: { open: boolean; onClose: () => void; me: Person; title: string; summary?: React.ReactNode; onSign: (comment: string) => void; initialComment?: string; commentLabel?: string }) {
  const [pw, setPw] = useState('')
  const [comment, setComment] = useState(initialComment)
  const [err, setErr] = useState(false)
  useEffect(() => { if (open) { setPw(''); setErr(false); setComment(initialComment) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => { if (!pw) { setErr(true); return } onSign(comment.trim()) }
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Sign and approve</Button></>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {summary}
        <Field label={commentLabel}><TextArea className="min-h-[52px]" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <div className="flex items-center gap-2 rounded border border-line px-3 py-2"><Avatar name={me.name} size={26} /><div className="min-w-0 text-[12.5px]"><b>{me.name}</b><div className="truncate text-muted">{me.email}</div></div></div>
        <Field label="Enter your password to sign" hint={err ? <span className="text-bad">Enter your password to apply your electronic signature.</span> : 'Your signature is bound to this record, step, time and comment. Demo: any password works.'}>
          <Input id="reauth-password" type="password" autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false) }} autoFocus />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

export function Timeline({ s, inst }: { s: AppState; inst: WorkflowInstance }) {
  const def = s.workflowDefs.find((d) => d.id === inst.defId)
  const label = (id: string) => def?.nodes.find((n) => n.id === id)?.label ?? ''
  const rows = inst.history.filter((h) => h.action !== 'system' || h.comment)
  return (
    <ol className="relative ml-6 border-l border-line py-3 pr-3">
      {rows.map((h) => (
        <li key={h.id} className="mb-2.5 ml-4 last:mb-0">
          <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', h.action === 'approve' || h.action === 'submit' ? 'bg-good' : h.action === 'complete' ? 'bg-link' : h.action === 'reject' ? 'bg-bad' : h.action === 'return' ? 'bg-warn' : 'bg-faint')} />
          <div className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
            <b>{personName(s, h.actorId)}</b>
            <span className="text-muted">{h.action === 'complete' ? `completed — ${h.comment}` : h.action === 'system' ? h.comment : `${h.action}${h.nodeId ? ` · ${label(h.nodeId)}` : ''}`}</span>
            {h.signature && <Badge tone="good" title={`Signature ${h.signature.hash}`}>e-signed</Badge>}
            <span className="text-[11px] text-faint">{fmtDateTime(h.at)}</span>
          </div>
          {h.comment && h.action !== 'complete' && h.action !== 'system' && <p className="mt-0.5 text-[12.5px] text-muted">“{h.comment}”</p>}
        </li>
      ))}
      {inst.status === 'running' && inst.active.map((a) => (
        <li key={a.nodeId} className="ml-4 mt-2.5">
          <span className="absolute -left-[6px] mt-1 h-3 w-3 rounded-full border-2 border-surface bg-marker" />
          <div className="text-[12.5px]"><b>Waiting:</b> {label(a.nodeId)} · <span className="text-muted">{a.assigneeIds.map((x) => personName(s, x) + (a.actedIds.includes(x) ? ' ✓' : '')).join(', ')}</span>{a.due && <span className={cx('ml-1 text-[11px]', a.due < s.settings.asOf ? 'text-bad' : 'text-faint')}>due {fmtDate(a.due)}</span>}</div>
        </li>
      ))}
    </ol>
  )
}

function StartedByMe({ s, me }: { s: AppState; me: Person }) {
  const mine = s.workflows.filter((w) => w.startedById === me.id).sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt.localeCompare(a.startedAt))
  const [open, setOpen] = useState<string | undefined>()
  const running = mine.filter((w) => w.status === 'running')
  const recent = mine.filter((w) => w.status !== 'running').slice(0, 15)
  if (!mine.length) return <Empty title="You have not started any requests">Requests you submit — change requests, estimates, drawdowns — show here with where they sit and who holds them.</Empty>
  const row = (w: WorkflowInstance) => {
    const def = s.workflowDefs.find((d) => d.id === w.defId)
    const p = s.projects.find((x) => x.id === w.projectId)
    const late = w.active.some((a) => a.due && a.due < s.settings.asOf)
    return (
      <li key={w.id} className="border-b border-line/70 last:border-0">
        <button className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken/60" onClick={() => setOpen(open === w.id ? undefined : w.id)}>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{w.title}</div>
            <div className="text-[11.5px] text-muted">{def?.name} v{w.defVersion}{p && <> · <span className="font-mono">{p.code}</span></>} · started {fmtDate(w.startedAt.slice(0, 10))}</div>
          </div>
          {w.status === 'running' ? (
            <div className="flex flex-col items-end gap-0.5 text-right text-[12px]">
              {w.active.map((a) => <span key={a.nodeId}><Badge tone={late ? 'bad' : 'marker'}>{def?.nodes.find((n) => n.id === a.nodeId)?.label}</Badge> <span className="text-muted">{a.assigneeIds.map((x) => personName(s, x)).join(', ')}</span></span>)}
              <span className="text-[11px] text-faint">{fmtDur((nowMs(s) - Date.parse(w.startedAt)) / 36e5)} in flight</span>
            </div>
          ) : <StatusBadge status={w.status} />}
        </button>
        {open === w.id && (
          <div className="border-t border-line bg-sunken/30">
            <Timeline s={s} inst={w} />
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {recordHref(w) && <a className="text-[12.5px] font-semibold text-link" href={recordHref(w)}>Open record</a>}
              {w.status === 'running' && <Button size="sm" variant="ghost" className="text-bad" onClick={() => { mutate((d) => recallWorkflow(d, w.id, me.id), { entity: 'workflow', entityId: w.id, action: 'recall', summary: `Recalled ${w.title}`, projectId: w.projectId }); toast('Request recalled') }}>Recall request</Button>}
            </div>
          </div>
        )}
      </li>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Panel title="In flight" subtitle="Where each of your requests sits now" pad={false}>{running.length ? <ul>{running.map(row)}</ul> : <div className="px-4 py-3 text-[13px] text-muted">None of your requests are in flight.</div>}</Panel>
      {recent.length > 0 && <Panel title="Finished" pad={false}><ul>{recent.map(row)}</ul></Panel>}
    </div>
  )
}

function CompletedRecently({ s, me }: { s: AppState; me: Person }) {
  const since = addDays(s.settings.asOf, -60)
  const rows = s.workflows.flatMap((w) => w.history.filter((h) => h.actorId === me.id && ['approve', 'reject', 'return', 'submit'].includes(h.action) && h.at.slice(0, 10) >= since).map((h) => ({ w, h })))
    .sort((a, b) => b.h.at.localeCompare(a.h.at))
  if (!rows.length) return <Empty title="No decisions in the last 60 days">Steps you approve, return, reject or submit are listed here with their signature.</Empty>
  return (
    <Panel title="My decisions" subtitle="Last 60 days" pad={false}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>When</th><th>Decision</th><th>Step</th><th>Request</th><th>Now</th><th>Signature</th></tr></thead>
          <tbody>
            {rows.slice(0, 80).map(({ w, h }) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap text-[12px]">{fmtDateTime(h.at)}</td>
                <td><Badge tone={h.action === 'approve' ? 'good' : h.action === 'reject' ? 'bad' : h.action === 'return' ? 'warn' : 'info'}>{h.action}</Badge></td>
                <td className="text-[12.5px]">{s.workflowDefs.find((d) => d.id === w.defId)?.nodes.find((n) => n.id === h.nodeId)?.label}</td>
                <td className="min-w-[220px]">{recordHref(w) ? <a className="text-link" href={recordHref(w)}>{w.title}</a> : w.title}{h.comment && <div className="text-[11.5px] text-muted">“{h.comment}”</div>}</td>
                <td><StatusBadge status={w.status} /></td>
                <td>{h.signature ? <Mono className="text-muted">{h.signature.hash}</Mono> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Delegation({ s, me, tasks }: { s: AppState; me: Person; tasks: Task[] }) {
  const oo = me.outOfOffice
  const [from, setFrom] = useState(oo?.from ?? s.settings.asOf)
  const [to, setTo] = useState(oo?.to ?? addDays(s.settings.asOf, 7))
  const [delegate, setDelegate] = useState(oo?.delegateId ?? '')
  useEffect(() => { setFrom(me.outOfOffice?.from ?? s.settings.asOf); setTo(me.outOfOffice?.to ?? addDays(s.settings.asOf, 7)); setDelegate(me.outOfOffice?.delegateId ?? '') }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = s.people.filter((p) => p.id !== me.id && !p.company)
  const suggested = candidates.filter((p) => p.roles.some((r) => me.roles.includes(r) && r !== 'admin'))
  const dp = s.people.find((p) => p.id === delegate)
  const authorityGap = dp && dp.dollarAuthority < me.dollarAuthority
  const chain = dp?.outOfOffice && dp.outOfOffice.delegateId === me.id
  const active = oo && isOutOfOffice(me, s.settings.asOf)
  const coveringFor = s.people.filter((p) => p.outOfOffice?.delegateId === me.id)
  const save = () => {
    if (!delegate || !from || !to || to < from) { toast('Pick a delegate and a valid date range', 'bad'); return }
    const starts = from <= s.settings.asOf && to >= s.settings.asOf
    const mine = tasks.filter((t) => !t.actingFor).length
    mutate((d) => {
      const p = d.people.find((x) => x.id === me.id)!
      p.outOfOffice = { from, to, delegateId: delegate }
      d.notifications.push({ id: uid('ntf'), at: nowISO(), toId: delegate, text: `${me.name} is out of office ${fmtDate(from)} – ${fmtDate(to)} and named you as delegate. Their workflow steps appear in your My work.`, link: '#inbox', read: false, kind: 'info' })
    }, { entity: 'person', entityId: me.id, action: 'delegate', summary: `Out of office ${from} to ${to}; delegate ${personName(s, delegate)}` })
    toast(starts && mine ? `Delegation saved — ${dp?.name} can act on your ${mine} open step${mine > 1 ? 's' : ''}` : 'Delegation saved')
  }
  const clear = () => {
    mutate((d) => { const p = d.people.find((x) => x.id === me.id)!; delete p.outOfOffice }, { entity: 'person', entityId: me.id, action: 'delegate-end', summary: 'Ended out-of-office delegation' })
    toast('Delegation ended — new steps route to you again')
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Out of office" subtitle="While you are away, new steps that would come to you route to your delegate, and they can act on the steps already waiting on you. Also available from your avatar in the top bar.">
        <div className="flex flex-col gap-3">
          {oo ? <Callout tone={active ? 'marker' : 'info'} title={active ? 'Delegation in force' : oo.to < s.settings.asOf ? 'Past delegation' : 'Scheduled delegation'}>{fmtDate(oo.from)} – {fmtDate(oo.to)} → {personName(s, oo.delegateId)}</Callout> : <Callout>No delegation set. Steps route to you.</Callout>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Delegate">
              <Select id="delegate" value={delegate} onChange={(e) => setDelegate(e.target.value)} options={[{ value: '', label: '— Select —' }, ...suggested.map((p) => ({ value: p.id, label: `${p.name} · ${p.title} (same role)` })), ...candidates.filter((p) => !suggested.includes(p)).map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))]} />
            </Field>
          </div>
          {authorityGap && <Callout tone="warn">{dp!.name}'s dollar authority ({money(dp!.dollarAuthority)}) is below yours ({money(me.dollarAuthority)}). Dollar-authority steps still route by the DOA matrix, so approvals above their limit go to the next tier.</Callout>}
          {chain && <Callout tone="bad">{dp!.name} has delegated to you for overlapping dates — pick someone else to avoid a loop.</Callout>}
          <p className="text-[12.5px] text-muted">Your <b className="text-ink">{tasks.filter((t) => !t.actingFor).length}</b> open step{tasks.filter((t) => !t.actingFor).length === 1 ? '' : 's'} stay assigned to you; while the delegation is in force they also appear in your delegate's My work as “acting for {me.name}”, and either of you can act. Steps nobody acted on come back to you when you return.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!delegate || !!chain} onClick={save}>Save delegation</Button>
            {oo && <Button variant="ghost" onClick={clear}>End delegation</Button>}
          </div>
        </div>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel title="You are covering for" pad={false}>
          {coveringFor.length ? <ul className="divide-y divide-line">{coveringFor.map((p) => <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[13px]"><Avatar name={p.name} /><span className="min-w-0 flex-1"><b>{p.name}</b><span className="block text-[11.5px] text-muted">{fmtDate(p.outOfOffice!.from)} – {fmtDate(p.outOfOffice!.to)}</span></span>{isOutOfOffice(p, s.settings.asOf) ? <Badge tone="marker">active</Badge> : <Badge>scheduled</Badge>}</li>)}</ul> : <div className="px-4 py-3 text-[13px] text-muted">Nobody has named you as their delegate.</div>}
        </Panel>
        <Panel title="Delegations across the organization" pad={false}>
          {s.people.filter((p) => p.outOfOffice).length ? <ul className="divide-y divide-line">{s.people.filter((p) => p.outOfOffice).map((p) => <li key={p.id} className="px-4 py-2 text-[12.5px]"><b>{p.name}</b> → {personName(s, p.outOfOffice!.delegateId)}<span className="block text-[11.5px] text-muted">{fmtDate(p.outOfOffice!.from)} – {fmtDate(p.outOfOffice!.to)}</span></li>)}</ul> : <div className="px-4 py-3 text-[13px] text-muted">No one is out of office.</div>}
        </Panel>
      </div>
    </div>
  )
}

function Notifications({ s, me, onOpenTask }: { s: AppState; me: Person; onOpenTask: (instId: string) => void }) {
  const list = s.notifications.filter((n) => n.toId === me.id).slice().reverse()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const rows = unreadOnly ? list.filter((n) => !n.read) : list
  const markAll = () => { mutate((d) => d.notifications.forEach((n) => { if (n.toId === me.id) n.read = true })); toast('All notifications marked read') }
  const open = (id: string, text: string, link: string) => {
    mutate((d) => { const n = d.notifications.find((x) => x.id === id); if (n) n.read = true })
    const inst = s.workflows.find((w) => text.includes(w.title))
    if (link.startsWith('#') && link !== '#inbox') go(link)
    else if (inst && inst.status === 'running' && inst.active.some((a) => a.assigneeIds.includes(me.id))) onOpenTask(inst.id)
    else if (inst?.projectId) go(recordHref(inst) ?? '#inbox')
  }
  return (
    <Panel title="Notifications" pad={false} actions={<><Checkbox checked={unreadOnly} onChange={setUnreadOnly} label={<span className="text-[12px]">Unread only</span>} /><Button size="sm" disabled={!list.some((n) => !n.read)} onClick={markAll}>Mark all read</Button></>}>
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((n) => (
            <li key={n.id}>
              <button onClick={() => open(n.id, n.text, n.link)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-link')} />
                <span className="min-w-0 flex-1"><span className={cx('block text-[13px]', !n.read && 'font-semibold')}>{n.text}</span><span className="text-[11px] text-faint">{fmtDateTime(n.at)}</span></span>
                <Icon name="arrow" className="mt-1 h-4 w-4 shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="px-4 py-6 text-center text-[13px] text-muted">{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</div>}
    </Panel>
  )
}

function EscalatedToMe({ s, rows }: { s: AppState; rows: ReturnType<typeof openEscalations> }) {
  return (
    <Panel title="Escalated to me" subtitle="Steps assigned to people who report to you that are past the escalation threshold. Follow up with the assignee; the step stays theirs." pad={false}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Step</th><th>Request</th><th>Waiting on</th><th className="num">Overdue</th><th>Escalated</th><th /></tr></thead>
          <tbody>
            {rows.map((e) => {
              const waiting = e.slot.assigneeIds.filter((x) => !e.slot.actedIds.includes(x))
              const late = daysBetween(e.slot.due ?? s.settings.asOf, s.settings.asOf)
              const href = recordHref(e.inst)
              return (
                <tr key={`${e.inst.id}:${e.slot.nodeId}`}>
                  <td className="whitespace-nowrap font-semibold">{e.stepLabel}</td>
                  <td className="min-w-[220px]">{href ? <a className="text-link" href={href}>{e.inst.title}</a> : e.inst.title}<div className="text-[11.5px] text-muted">{recordTypeLabel(e.inst.recordType)}{code(s, e.inst.projectId) && <> · <span className="font-mono">{code(s, e.inst.projectId)}</span></>}</div></td>
                  <td className="whitespace-nowrap text-[12.5px]">{waiting.map((x) => personName(s, x)).join(', ')}</td>
                  <td className="num font-semibold text-bad">{late} d</td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDate(e.at)}</td>
                  <td className="whitespace-nowrap text-right">{waiting[0] && <a href={dmHref(e.assigneeId)} className="text-[12.5px] font-semibold text-link">Message {personName(s, e.assigneeId).split(' ')[0]}</a>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
