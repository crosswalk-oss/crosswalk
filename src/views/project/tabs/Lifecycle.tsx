// Lifecycle & gates tab (SG-*): stage timeline, current gate readiness, deliverables with evidence and
// review/waiver workflows, stage permissions, the gate review packet, the gate decision panel and history.
import React, { useMemo, useRef, useState } from 'react'
import { mutate, personName, useMe, useStore } from '@/core/store'
import type { AppState, Deliverable, DeliverableDef, GateOutcome, Project, StagePermission, WorkflowInstance } from '@/core/types'
import { decideGate, ensureDeliverables, ntpBlockers, permissions, readiness, requiredDefs, templateFor } from '@/core/engine/gates'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { CLASS_RANGES, estimateTotals } from '@/core/engine/estimates'
import { isActive, riskScore, expectedCost } from '@/core/engine/risk'
import { position } from '@/core/engine/position'
import { addDays, cx, daysBetween, fmtDate, fmtDateTime, money, moneyDelta, nowISO, uid } from '@/core/util'
import { htmlDoc, saveFile } from '@/core/download'
import { projectHref } from '@/core/router'
import { Avatar, Badge, Button, Callout, Checkbox, ClassBadge, Empty, Field, Input, KV, Mono, Modal, Panel, Progress, Select, StatusBadge, Tabs, TextArea, humanize } from '@/ui/kit'
import { RangeBar } from '@/ui/charts'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { PersonSelect } from '../../shared/pickers'
import { gatePacketHtml } from '../../portfolio/reports'
import { latestApprovedEstimate, latestEstimate } from '../../portfolio/lib'
import { ScheduleReviewModal } from '../../gates/ScheduleReview'
import { DeliverableFormModal, RecordStatus, recordTone } from '../../records/DeliverableForm'
import { allFields, formFor, missingFields } from '@/core/engine/forms'
import { formValuesFor } from '@/core/engine/carry'
import { RECORD_STATUS_LABEL, submissionsFor } from '@/core/engine/records'

const PERM_LABEL: Record<StagePermission, { label: string; desc: string }> = {
  'long-lead-release': { label: 'Long-lead material release', desc: 'Order pipe, valves and major equipment ahead of authorization' },
  'po-over-threshold': { label: 'POs over threshold', desc: 'Issue purchase orders above the pre-authorization limit' },
  'contract-award': { label: 'Construction contract award', desc: 'Award the construction contract' },
  'construction-ntp': { label: 'Construction notice to proceed', desc: 'Release the contractor to mobilize (also needs an approved safety plan and issued permits)' },
  'place-in-service': { label: 'Place in service', desc: 'Return the asset to operation' },
}
const OUTCOMES: { id: GateOutcome; label: string; desc: string; tone: 'good' | 'info' | 'warn' | 'bad' }[] = [
  { id: 'go', label: 'Go', desc: 'Pass the gate and advance to the next stage', tone: 'good' },
  { id: 'go-with-conditions', label: 'Go with conditions', desc: 'Advance; conditions become tracked actions with owners and due dates', tone: 'info' },
  { id: 'recycle', label: 'Recycle', desc: 'Stay in this stage and rework the named deliverables', tone: 'warn' },
  { id: 'hold', label: 'Hold', desc: 'Pause the project; no further spend beyond commitments', tone: 'warn' },
  { id: 'cancel', label: 'Cancel', desc: 'Stop the project and begin closeout of spend', tone: 'bad' },
]
const outcomeTone = (o: GateOutcome) => (o === 'go' ? 'good' : o === 'go-with-conditions' ? 'info' : o === 'cancel' ? 'bad' : 'warn') as 'good' | 'info' | 'warn' | 'bad'
const outcomeLabel = (o: GateOutcome) => OUTCOMES.find((x) => x.id === o)?.label ?? o

/** Latest workflow instance for a record (running first). */
function wfFor(s: AppState, pred: (w: WorkflowInstance) => boolean) {
  const xs = s.workflows.filter(pred)
  return xs.find((w) => w.status === 'running') ?? xs.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop()
}

/** If the requester is the assignee of the opening form step (or an admin), submit it in the same action. */
function autoSubmit(d: AppState, inst: WorkflowInstance | undefined, comment: string) {
  if (!inst) return
  const slot = inst.active[0]
  if (!slot) return
  const me = d.people.find((p) => p.id === d.currentUserId)
  const def = d.workflowDefs.find((x) => x.id === inst.defId)
  const node = def?.nodes.find((n) => n.id === slot.nodeId)
  if (node?.type !== 'form') return
  if (slot.assigneeIds.includes(d.currentUserId) || me?.roles.includes('admin')) actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', comment)
}

export default function Lifecycle({ projectId }: { projectId: string }) {
  const stage = useStore((s) => s.projects.find((x) => x.id === projectId)?.stageIndex)
  return <LifecycleInner key={`${projectId}-${stage}`} projectId={projectId} />
}

function LifecycleInner({ projectId }: { projectId: string }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === projectId)!
  const tpl = templateFor(s, p)
  const stage = tpl.stages[p.stageIndex]
  const r = readiness(s, p)
  const closed = p.status === 'closed' || p.status === 'cancelled'
  const decisions = s.gateDecisions.filter((g) => g.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date))
  const review = s.gateReviews.filter((g) => g.projectId === p.id && g.stageIndex === p.stageIndex && g.status === 'scheduled').sort((a, b) => a.scheduled.localeCompare(b.scheduled))[0]
  const gateWf = wfFor(s, (w) => w.projectId === p.id && w.defKey === 'gate-review')
  const gateWfRunning = gateWf?.status === 'running' ? gateWf : undefined
  const canDecide = me.roles.some((x) => x === 'gate-board' || x === 'sponsor' || x === 'exec' || x === 'admin')
  const [schedOpen, setSchedOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const stageStart = decisions.filter((g) => g.stageIndex === p.stageIndex - 1 && (g.outcome === 'go' || g.outcome === 'go-with-conditions')).pop()?.date ?? p.dates.initiated

  return (
    <div className="flex flex-col gap-4">
      <StageTimeline s={s} p={p} />

      {closed ? (
        <Callout tone={p.status === 'closed' ? 'good' : 'bad'} title={p.status === 'closed' ? 'Project closed' : 'Project cancelled'}>
          {p.status === 'closed' ? `Closed ${fmtDate(p.dates.closed)}. All gates are recorded below with the deliverable versions and snapshots the board relied on.` : 'The gate board cancelled this project. Gate history and evidence remain on record.'}
        </Callout>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Panel title={<span className="flex flex-wrap items-center gap-2">{stage.gate.name}{p.status === 'on-hold' && <Badge tone="warn">On hold</Badge>}</span>} subtitle={`Stage ${p.stageIndex + 1} of ${tpl.stages.length} · ${stage.name} · ${daysBetween(stageStart, s.settings.asOf)} days in stage`}>
            <div className="flex items-center gap-4">
              <ReadinessRing pct={r.pct} ready={r.ready} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px]"><b className="tabular-nums">{r.done}</b> of <b className="tabular-nums">{r.total}</b> deliverables accepted or waived</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                  {stage.gate.requiredEstimateClass ? (
                    <span className={cx('inline-flex items-center gap-1', r.estimateOk ? 'text-good' : 'text-bad')}>Estimate {r.estimateClass ? <ClassBadge cls={r.estimateClass as 1} /> : 'none'} needs <ClassBadge cls={stage.gate.requiredEstimateClass} /> {r.estimateOk ? '✓' : '✕'}</span>
                  ) : <span className="text-muted">No estimate requirement</span>}
                  <span className={r.highRisks ? 'text-bad' : 'text-good'}>{r.highRisks ? `${r.highRisks} high risk(s) without response` : 'High risks have responses ✓'}</span>
                </div>
                {stage.gate.budgetEvent && <div className="mt-1 text-[12px] text-muted">Passing this gate converts the approved estimate into the <b className="text-ink">{stage.gate.budgetEvent} budget</b>{stage.gate.budgetEvent === 'control' ? ' and sets the Original and Current baselines' : ''}.</div>}
              </div>
            </div>
            {r.blockers.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {r.blockers.map((b) => <li key={b} className="flex items-start gap-2 rounded border border-bad/30 bg-bad/5 px-2.5 py-1.5 text-[13px]"><span className="mt-0.5 font-bold text-bad">✕</span>{b}</li>)}
              </ul>
            ) : <div className="mt-3"><Callout tone="good">All gate criteria are met. The project is ready for the board.</Callout></div>}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <div className="mr-auto text-[12px]">
                {review ? <span>Board review <b>{fmtDate(review.scheduled)}</b> <span className="text-muted">({daysBetween(s.settings.asOf, review.scheduled)} days) · {review.board.map((b) => personName(s, b)).join(', ')}</span></span> : <span className="text-muted">No board date scheduled</span>}
              </div>
              <Button size="sm" onClick={() => setSchedOpen(true)} icon={<Icon name="clock" className="h-3.5 w-3.5" />}>{review ? 'Reschedule' : 'Schedule review'}</Button>
              {!gateWfRunning && <Button size="sm" variant={r.ready ? 'primary' : 'secondary'} onClick={() => setSubmitOpen(true)} icon={<Icon name="gate" className="h-3.5 w-3.5" />}>Submit for gate review</Button>}
            </div>
            {gateWf && gateWf.status === 'approved' && !decisions.some((g) => g.stageIndex === p.stageIndex && g.date >= (gateWf.completedAt ?? '').slice(0, 10)) && (
              <div className="mt-3"><Callout tone="marker" title="Gate review workflow approved">The board approved the gate-review routing on {fmtDate(gateWf.completedAt?.slice(0, 10))}. Record the gate decision below to advance the stage, convert the budget and freeze the deliverable versions.</Callout></div>
            )}
            {gateWf && <div className="mt-3"><WorkflowStatus instanceId={gateWf.id} compact={gateWf.status !== 'running'} /></div>}
          </Panel>
          <DeliverablesPanel s={s} p={p} stageIndex={p.stageIndex} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <PermissionsPanel s={s} p={p} />
        <PacketPanel s={s} p={p} />
      </div>

      {!closed && canDecide && <DecisionPanel s={s} p={p} gateWf={gateWfRunning} />}
      {!closed && !canDecide && <Callout tone="info" title="Gate decisions">Gate outcomes are recorded by the gate board or sponsor ({stage.gate.decisionRoles.map((x) => s.roles.find((y) => y.id === x)?.name ?? x).join(', ')}). Switch persona to a director to record one.</Callout>}

      <GateHistory s={s} p={p} />
      <PriorStages s={s} p={p} />

      <ScheduleReviewModal open={schedOpen} onClose={() => setSchedOpen(false)} projectId={p.id} />
      <SubmitGateModal open={submitOpen} onClose={() => setSubmitOpen(false)} p={p} />
    </div>
  )
}

// ───────────────────────────── Stage timeline
// One rail: stages are circles, gates are diamonds, the rail is dark up to where the project stands.
function StageTimeline({ s, p }: { s: AppState; p: Project }) {
  const tpl = templateFor(s, p)
  const decisions = s.gateDecisions.filter((g) => g.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date))
  const n = tpl.stages.length
  const closed = p.status === 'closed'
  const at = closed ? 2 * n : 2 * p.stageIndex // rail column the project has reached
  const went = (o?: string) => o === 'go' || o === 'go-with-conditions'
  const cur = closed ? undefined : tpl.stages[p.stageIndex]
  const node = (col: number, mark: React.ReactNode) => (
    <div className="relative flex h-12 w-full items-center justify-center">
      {col > 0 && <span aria-hidden className={cx('absolute left-0 right-1/2 top-1/2 h-[3px] -translate-y-1/2', col <= at ? 'bg-link' : 'bg-line')} />}
      {col < 2 * n - 1 && <span aria-hidden className={cx('absolute left-1/2 right-0 top-1/2 h-[3px] -translate-y-1/2', col < at ? 'bg-link' : 'bg-line')} />}
      {mark}
    </div>
  )
  return (
    <Panel pad={false}>
      <div className="scroll-x">
        <ol className="grid min-w-[940px] px-3 pb-4 pt-3" style={{ gridTemplateColumns: `repeat(${2 * n}, minmax(0, 1fr))` }}>
          {tpl.stages.map((st, i) => {
            const passed = i < p.stageIndex || closed
            const current = i === p.stageIndex && !closed
            const gd = decisions.filter((g) => g.stageIndex === i)
            const last = gd[gd.length - 1]
            const start = i === 0 ? p.dates.initiated : decisions.filter((g) => g.stageIndex === i - 1 && went(g.outcome)).pop()?.date
            const hold = current && p.status === 'on-hold'
            const gateName = st.gate.name.replace(/^Gate \w+ · /, '')
            return (
              <React.Fragment key={st.id}>
                <li className="flex min-w-0 flex-col items-center text-center" aria-current={current ? 'step' : undefined} title={st.purpose}>
                  {node(2 * i, (
                    <span className={cx('relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-[14px] font-bold tabular-nums',
                      passed ? 'border-link bg-link text-surface' : hold ? 'border-warn bg-warn text-white ring-4 ring-warn/20' : current ? 'border-marker bg-marker text-markerink ring-4 ring-marker/25' : 'border-line bg-surface text-faint')}>
                      {passed ? '✓' : i + 1}
                    </span>
                  ))}
                  <div className={cx('mt-1 px-2 text-[13px] font-semibold leading-snug', !passed && !current && 'text-muted')}>{st.name}</div>
                  <div className="mt-1 flex flex-col items-center gap-0.5 px-2 text-[11px] tabular-nums text-faint">
                    {current && <Badge tone={hold ? 'warn' : 'marker'}>{hold ? 'On hold' : 'Current stage'}</Badge>}
                    {start && (passed || current) && <span>{current ? 'Since' : 'Started'} {fmtDate(start)}</span>}
                  </div>
                </li>
                <li className="flex min-w-0 flex-col items-center text-center" title={st.gate.name}>
                  {node(2 * i + 1, (
                    <span className={cx('relative flex h-[26px] w-[26px] rotate-45 items-center justify-center rounded-[4px] border-2 bg-surface',
                      last ? (went(last.outcome) ? 'border-link !bg-link' : 'border-warn') : current ? 'border-marker' : 'border-line')}>
                      {last && !went(last.outcome) && <span aria-hidden className="absolute inset-0 bg-warn/15" />}
                      <span className={cx('relative -rotate-45 text-[10px] font-bold', last && went(last.outcome) ? 'text-surface' : current || last ? 'text-ink' : 'text-faint')}>G{i + 1}</span>
                    </span>
                  ))}
                  <div className={cx('mt-1 px-2 text-[12px] font-medium leading-snug', !last && !current && 'text-muted')}>{gateName}</div>
                  <div className="mt-1 flex flex-col items-center gap-0.5 px-2 text-[11px] tabular-nums text-faint">
                    {last ? <><Badge tone={outcomeTone(last.outcome)}>{outcomeLabel(last.outcome)}</Badge><span>{fmtDate(last.date)}{gd.length > 1 ? ` · ${gd.length} reviews` : ''}</span></>
                      : st.gate.requiredEstimateClass ? <span>Needs Class {st.gate.requiredEstimateClass} estimate</span> : null}
                  </div>
                </li>
              </React.Fragment>
            )
          })}
        </ol>
      </div>
      {cur && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-line bg-sunken/40 px-4 py-2.5 text-[12.5px]">
          <b>{cur.name}</b>
          <span className="text-muted">{cur.purpose}</span>
        </div>
      )}
    </Panel>
  )
}

function ReadinessRing({ pct, ready }: { pct: number; ready: boolean }) {
  const R = 30, C = 2 * Math.PI * R
  const color = ready ? 'rgb(var(--good))' : pct >= 80 ? 'rgb(var(--warn))' : pct >= 50 ? 'rgb(var(--warn))' : 'rgb(var(--bad))'
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" className="shrink-0" role="img" aria-label={`Gate readiness ${pct}%`}>
      <circle cx={38} cy={38} r={R} fill="none" stroke="rgb(var(--sunken))" strokeWidth={8} />
      <circle cx={38} cy={38} r={R} fill="none" stroke={color} strokeWidth={8} strokeDasharray={`${(pct / 100) * C} ${C}`} strokeLinecap="round" transform="rotate(-90 38 38)" />
      <text x={38} y={42} textAnchor="middle" fontSize={17} fontWeight={700} fill="rgb(var(--ink))" fontFamily="Archivo, sans-serif">{pct}%</text>
    </svg>
  )
}

// ───────────────────────────── Deliverables
function DeliverablesPanel({ s, p, stageIndex }: { s: AppState; p: Project; stageIndex: number }) {
  const defs = requiredDefs(s, p, stageIndex)
  const allDefs = templateFor(s, p).stages[stageIndex].gate.deliverables
  const notApplicable = allDefs.filter((d) => !defs.includes(d))
  const dls = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === stageIndex)
  const [open, setOpen] = useState<string | null>(null)
  const [waiver, setWaiver] = useState<{ d: Deliverable; def: DeliverableDef } | null>(null)
  const missingRecords = defs.filter((def) => !dls.some((x) => x.defId === def.id))
  return (
    <Panel title="Required deliverables" subtitle={`${defs.length} required for this gate${notApplicable.length ? ` · ${notApplicable.length} not applicable by rule` : ''}`} pad={false}
      actions={missingRecords.length ? <Button size="sm" onClick={() => { mutate((d) => { ensureDeliverables(d, d.projects.find((x) => x.id === p.id)!, stageIndex) }, { entity: 'deliverable', entityId: p.id, projectId: p.id, action: 'create', summary: `Opened ${missingRecords.length} missing deliverable record(s)` }); toast('Deliverable records opened') }}>Open {missingRecords.length} missing</Button> : undefined}>
      <ul className="divide-y divide-line">
        {defs.map((def) => {
          const d = dls.find((x) => x.defId === def.id)
          return <DeliverableRow key={def.id} s={s} p={p} def={def} d={d} open={open === def.id} onToggle={() => setOpen(open === def.id ? null : def.id)} onWaiver={() => d && setWaiver({ d, def })} />
        })}
      </ul>
      {notApplicable.length > 0 && (
        <div className="border-t border-line px-4 py-2 text-[12px] text-faint">Not required for this project: {notApplicable.map((d) => `${d.name} (${d.condition ? humanizeCond(d.condition.field) : 'rule'})`).join(' · ')}</div>
      )}
      <WaiverModal target={waiver} p={p} onClose={() => setWaiver(null)} />
    </Panel>
  )
}
const humanizeCond = (f: string) => ({ 'permitsNeeded.ceqa': 'no CEQA review', 'permitsNeeded.hydrotestDischarge': 'no hydrotest discharge' } as Record<string, string>)[f] ?? f

function DeliverableRow({ s, p, def, d, open, onToggle, onWaiver }: { s: AppState; p: Project; def: DeliverableDef; d?: Deliverable; open: boolean; onToggle: () => void; onWaiver: () => void }) {
  const me = useMe()
  const file = useRef<HTMLInputElement>(null)
  const wf = d ? wfFor(s, (w) => w.recordType === 'deliverable' && w.recordId === d.id) : undefined
  const waiverWf = d ? wfFor(s, (w) => w.recordType === 'waiver' && (w.recordId === d.id || w.data.deliverableId === d.id)) : undefined
  const status = d?.status ?? 'not-started'
  const overdue = !!d?.due && d.due < s.settings.asOf && !['accepted', 'waived', 'submitted'].includes(status)
  const done = status === 'accepted' || status === 'waived'
  const busy = wf?.status === 'running' || waiverWf?.status === 'running'
  const audit = { entity: 'deliverable', entityId: d?.id ?? def.id, projectId: p.id }
  const [formOpen, setFormOpen] = useState(false)
  const tpl = formFor(def.id)
  const formMissing = tpl && d ? missingFields(tpl, formValuesFor(s, p, d, tpl)) : []
  const formRequired = tpl ? allFields(tpl).filter((f) => f.required && !f.readOnly).length : 0
  const formDone = !!tpl && !!d?.form && formMissing.length === 0
  const rec = d ? submissionsFor(s, d.id)[0] : undefined

  const setStatus = (st: Deliverable['status'], summary: string) => {
    if (!d) return
    mutate((x) => { const y = x.deliverables.find((z) => z.id === d.id)!; y.status = st; y.updatedAt = nowISO() }, { ...audit, action: st, summary })
    toast(summary)
  }
  const attach = (files: FileList | null) => {
    if (!d || !files?.length) return
    mutate((x) => {
      const y = x.deliverables.find((z) => z.id === d.id)!
      for (const f of Array.from(files)) y.evidence.push({ id: uid('evd'), name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), uploadedAt: nowISO(), byId: x.currentUserId })
      if (y.status === 'not-started') y.status = 'in-progress'
      y.updatedAt = nowISO()
    }, { ...audit, action: 'evidence', summary: `${def.name}: attached ${Array.from(files).map((f) => f.name).join(', ')}` })
    toast(files.length === 1 ? `Attached ${files[0].name}` : `Attached ${files.length} files`)
    if (file.current) file.current.value = ''
  }
  const removeEvidence = (id: string, name: string) => {
    if (!d) return
    mutate((x) => { const y = x.deliverables.find((z) => z.id === d.id)!; y.evidence = y.evidence.filter((e) => e.id !== id); y.updatedAt = nowISO() }, { ...audit, action: 'evidence-remove', summary: `${def.name}: removed ${name} before submission` })
    toast(`Removed ${name}`)
  }
  const submit = (fromForm = false) => {
    if (!d) return
    if (!fromForm && !d.evidence.length && !formDone) { toast('Complete the form or attach evidence before submitting', 'bad'); return }
    mutate((x) => {
      const y = x.deliverables.find((z) => z.id === d.id)!
      y.version = y.status === 'returned' || y.version === 0 ? y.version + 1 : y.version
      const inst = startWorkflow(x, 'deliverable-review', { title: `${p.code} ${def.name} v${y.version}`, recordType: 'deliverable', recordId: d.id, projectId: p.id, data: { deliverable: def.name, version: y.version, acceptance: def.acceptance } })
      autoSubmit(x, inst, `Submitted v${y.version}${formDone || fromForm ? ' with the completed form' : ''}${y.evidence.length ? ` and ${y.evidence.length} evidence file(s)` : ''}`)
    }, { ...audit, action: 'submit', summary: `${def.name} submitted for review` })
    toast('Submitted for review')
  }
  const updateField = (k: 'ownerId' | 'reviewerId' | 'due' | 'notes', v: string) => {
    if (!d) return
    mutate((x) => { const y = x.deliverables.find((z) => z.id === d.id)!; (y as any)[k] = v || undefined; y.updatedAt = nowISO() }, { ...audit, action: 'edit', summary: `${def.name}: ${k === 'ownerId' ? 'owner' : k === 'reviewerId' ? 'reviewer' : k} → ${k.endsWith('Id') ? personName(s, v) : v}` })
  }
  const kindIcon = def.kind === 'estimate' ? 'calc' : def.kind === 'risk-register' ? 'alert' : def.kind === 'safety-plan' ? 'shield' : def.kind === 'schedule' ? 'clock' : def.kind === 'permit' ? 'scale' : def.kind === 'records' ? 'layers' : def.kind === 'checklist' ? 'check' : 'doc'
  const linkTab = def.kind === 'estimate' ? 'estimates' : def.kind === 'risk-register' ? 'risk' : def.kind === 'safety-plan' ? 'safety' : def.kind === 'permit' ? 'permits' : def.kind === 'records' ? 'records' : undefined
  return (
    <li className={cx(open && 'bg-sunken/30')}>
      <div className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-sunken/50" onClick={onToggle}>
        <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border', done ? 'border-good bg-good text-white' : status === 'submitted' ? 'border-info bg-info/15 text-info' : status === 'returned' ? 'border-bad bg-bad/10 text-bad' : 'border-line text-faint')}>
          {done ? <Icon name="check" className="h-3.5 w-3.5" /> : <Icon name={kindIcon} className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold">{def.name}</span>
            <StatusBadge status={status} />
            {d && d.version > 0 && <span className="text-[11px] text-faint">v{d.version}</span>}
            {overdue && <Badge tone="bad">Overdue</Badge>}
            {busy && <Badge tone="marker">In workflow</Badge>}
            {rec && <Badge tone={recordTone(rec.status)} title={rec.folder}>{rec.status === 'filed' ? `Filed · node ${rec.nodeId}` : RECORD_STATUS_LABEL[rec.status]}</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
            <span>Owner {personName(s, d?.ownerId)}</span><span>Reviewer {personName(s, d?.reviewerId)}</span>
            <span className={cx(overdue && 'font-semibold text-bad')}>Due {fmtDate(d?.due)}</span>
            <span>{d?.evidence.length ?? 0} evidence</span>
            {tpl && <span className={cx(formDone ? 'text-good' : d?.form ? 'text-warn' : '')}>Form {d?.form ? `${formRequired - formMissing.length}/${formRequired}` : 'not started'}</span>}
          </div>
        </div>
        <span className="mt-1 text-[11px] text-faint">{open ? '▲' : '▼'}</span>
      </div>
      {open && d && (
        <div className="flex flex-col gap-3 px-4 pb-4 pl-12">
          <div className="grid grid-cols-1 gap-3 text-[13px] md:grid-cols-2">
            <div><div className="eyebrow mb-0.5">What it is</div>{def.description}</div>
            <div><div className="eyebrow mb-0.5">Acceptance criteria</div>{def.acceptance}</div>
          </div>
          {d.waiverReason && <Callout tone="warn" title="Waived">{d.waiverReason}</Callout>}
          {tpl && <RecordStatus s={s} d={d} />}
          <div>
            <div className="eyebrow mb-1">Evidence</div>
            {d.evidence.length ? (
              <ul className="flex flex-col gap-1">
                {d.evidence.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-2.5 py-1 text-[12px]">
                    <Icon name="doc" className="h-4 w-4 text-faint" /><span className="font-semibold">{e.name}</span>
                    <span className="text-faint">{e.sizeKb >= 1024 ? `${(e.sizeKb / 1024).toFixed(1)} MB` : `${e.sizeKb} KB`} · {personName(s, e.byId)} · {fmtDateTime(e.uploadedAt)}</span>
                    {!done && !busy && <button className="ml-auto text-[11px] font-semibold text-muted hover:text-bad" onClick={() => removeEvidence(e.id, e.name)}>Remove</button>}
                  </li>
                ))}
              </ul>
            ) : <div className="text-[12px] text-faint">No evidence attached yet.</div>}
          </div>
          {!done && !busy && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Owner"><PersonSelect id={`dl-own-${d.id}`} value={d.ownerId} onChange={(v) => updateField('ownerId', v)} /></Field>
              <Field label="Reviewer"><PersonSelect id={`dl-rev-${d.id}`} value={d.reviewerId} onChange={(v) => updateField('reviewerId', v)} /></Field>
              <Field label="Due"><Input id={`dl-due-${d.id}`} type="date" value={d.due ?? ''} onChange={(e) => updateField('due', e.target.value)} /></Field>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" multiple className="hidden" onChange={(e) => attach(e.target.files)} />
            {(status === 'not-started' || status === 'returned') && !busy && <Button size="sm" onClick={() => setStatus('in-progress', `${def.name} marked in progress`)}>Mark in progress</Button>}
            {tpl && <Button size="sm" variant={!done && !busy && !formDone ? 'primary' : 'secondary'} icon={<Icon name="doc" className="h-3.5 w-3.5" />} onClick={() => setFormOpen(true)}>{done || busy || status === 'submitted' ? 'View form' : d.form ? 'Continue form' : 'Open form'}</Button>}
            {!done && !busy && <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => file.current?.click()}>Attach evidence</Button>}
            {!done && !busy && <Button size="sm" variant={formDone || d.evidence.length ? 'primary' : 'secondary'} disabled={!d.evidence.length && !formDone} onClick={() => submit()} title={d.evidence.length || formDone ? '' : 'Complete the form or attach evidence first'}>Submit for review</Button>}
            {!done && !busy && <Button size="sm" variant="ghost" onClick={onWaiver}>Request waiver</Button>}
            {linkTab && <a href={projectHref(p.id, linkTab)} className="text-[12px] font-semibold text-link hover:underline">Open {humanize(linkTab)} →</a>}
            {done && me.roles.includes('admin') && <span className="text-[11px] text-faint">Accepted deliverables are locked; a new version starts if the gate recycles.</span>}
          </div>
          {wf && <WorkflowStatus instanceId={wf.id} compact={wf.status !== 'running'} />}
          {waiverWf && <WorkflowStatus instanceId={waiverWf.id} compact={waiverWf.status !== 'running'} />}
        </div>
      )}
      {formOpen && d && tpl && <DeliverableFormModal s={s} p={p} def={def} d={d} busy={busy} onClose={() => setFormOpen(false)} onSubmit={!done && !busy ? () => submit(true) : undefined} />}
    </li>
  )
}

function WaiverModal({ target, p, onClose }: { target: { d: Deliverable; def: DeliverableDef } | null; p: Project; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [perm, setPerm] = useState('')
  if (!target) return null
  const go = () => {
    if (reason.trim().length < 15) { toast('Explain why in at least a sentence', 'bad'); return }
    mutate((x) => {
      const inst = startWorkflow(x, 'waiver', { title: `${p.code} waive ${target.def.name}`, recordType: 'waiver', recordId: target.d.id, projectId: p.id, data: { reason: reason.trim(), deliverableId: target.d.id, deliverable: target.def.name, permission: perm || undefined } })
      autoSubmit(x, inst, reason.trim())
    }, { entity: 'deliverable', entityId: target.d.id, projectId: p.id, action: 'waiver-request', summary: `Waiver requested for ${target.def.name}${perm ? ` with early-start permission ${perm}` : ''}` })
    toast('Waiver sent to the PMO and sponsor')
    setReason(''); setPerm(''); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Request waiver · ${target.def.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>Send for approval</Button></>}>
      <div className="flex flex-col gap-3">
        <Callout tone="warn">Waivers route to the PMO for review and the project sponsor for approval. An approved waiver counts toward gate readiness and is flagged on every later report and the gate packet.</Callout>
        <Field label="Reason" hint="Why the deliverable is not needed, or why the gate should pass without it"><TextArea id="waiver-reason" className="min-h-[90px]" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Also request an early-start permission (optional)"><Select id="waiver-perm" value={perm} onChange={(e) => setPerm(e.target.value)} options={[{ value: '', label: 'None' }, { value: 'long-lead-release', label: 'Long-lead material release' }, { value: 'po-over-threshold', label: 'POs over threshold' }]} /></Field>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Permissions
function PermissionsPanel({ s, p }: { s: AppState; p: Project }) {
  const perms = permissions(s, p)
  const tpl = templateFor(s, p)
  const ntp = ntpBlockers(s, p)
  const waived = new Set(s.workflows.filter((w) => w.projectId === p.id && w.recordType === 'waiver' && w.status === 'approved').map((w) => w.data.permission as StagePermission).filter(Boolean))
  const pending = s.workflows.filter((w) => w.projectId === p.id && w.recordType === 'waiver' && w.status === 'running' && w.data.permission)
  const all = Object.keys(PERM_LABEL) as StagePermission[]
  const unlockGate = (perm: StagePermission) => tpl.stages.find((st) => st.gate.unlocks.includes(perm))?.gate.name
  return (
    <Panel title="Stage permissions" subtitle="What the project may do now. Unlocked by passing gates or by an approved early-start waiver." pad={false}>
      <ul className="divide-y divide-line">
        {all.filter((perm) => unlockGate(perm)).map((perm) => {
          const on = perms.has(perm)
          const via = waived.has(perm) && !tpl.stages.slice(0, p.stageIndex).some((st) => st.gate.unlocks.includes(perm))
          const isNtp = perm === 'construction-ntp'
          const pend = pending.find((w) => w.data.permission === perm)
          return (
            <li key={perm} className="flex items-start gap-3 px-4 py-2">
              <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', on ? 'bg-good text-white' : 'bg-sunken text-faint')}>{on ? '✓' : '—'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">{PERM_LABEL[perm].label}{via && <Badge tone="warn">By waiver</Badge>}{pend && <Badge tone="info">Waiver in review</Badge>}</div>
                <div className="text-[11px] text-muted">{PERM_LABEL[perm].desc}</div>
                <div className="text-[11px] text-faint">{on ? (via ? 'Granted by sponsor-approved exception' : `Unlocked at ${unlockGate(perm)}`) : `Unlocks at ${unlockGate(perm)}`}</div>
                {isNtp && on && ntp.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{ntp.map((b) => <Badge key={b} tone="bad">{b}</Badge>)}</div>}
                {isNtp && on && ntp.length === 0 && <div className="mt-1"><Badge tone="good">NTP clear: safety plan approved, permits issued</Badge></div>}
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// ───────────────────────────── Gate review packet (SG-05)
type PacketTab = 'charter' | 'estimate' | 'schedule' | 'risks' | 'changes' | 'evidence'
function PacketPanel({ s, p }: { s: AppState; p: Project }) {
  const [tab, setTab] = useState<PacketTab>('charter')
  const tpl = templateFor(s, p)
  const st = tpl.stages[p.stageIndex]
  const est = latestApprovedEstimate(s, p.id)
  const draft = latestEstimate(s, p.id)
  const risks = s.risks.filter((x) => x.projectId === p.id && isActive(x)).sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 10)
  const changes = s.changes.filter((c) => c.projectId === p.id)
  const defs = requiredDefs(s, p)
  const dls = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex)
  const pos = position(s, p.id)
  const download = async () => {
    const res = await saveFile(`${p.code}-${st.gate.name.replace(/[^A-Za-z0-9]+/g, '-')}-packet.html`, htmlDoc(`${p.code} gate review packet`, gatePacketHtml(s, p)), 'text/html')
    if (res === 'saved') { mutate(() => {}, { entity: 'gate', entityId: p.id, projectId: p.id, action: 'packet', summary: `Gate review packet for ${st.gate.name} downloaded` }); toast('Gate packet downloaded') }
  }
  return (
    <Panel title="Gate review packet" subtitle={`${st.gate.name} · assembled live from the record`} pad={false}
      actions={<Button size="sm" icon={<Icon name="download" className="h-3.5 w-3.5" />} onClick={download}>Download packet</Button>}>
      <Tabs className="px-2" value={tab} onChange={setTab} tabs={[
        { id: 'charter', label: 'Charter' }, { id: 'estimate', label: 'Estimate' }, { id: 'schedule', label: 'Milestones', count: p.milestones.length },
        { id: 'risks', label: 'Top risks', count: risks.length }, { id: 'changes', label: 'Changes', count: changes.length }, { id: 'evidence', label: 'Evidence', count: dls.reduce((a, d) => a + d.evidence.length, 0) },
      ]} />
      <div className="p-4">
        {tab === 'charter' && (
          <KV cols={2} items={[
            ['Driver', p.driver], ['Citation', p.regulatoryCitation], ['Sponsor', personName(s, p.team.sponsor)], ['PM', personName(s, p.team.pm)],
            ['Scope', <span key="s" className="block">{p.scope.summary}</span>], ['Quantities', p.scope.quantities.map((q) => `${q.qty.toLocaleString()} ${q.unit} ${q.label.toLowerCase()}`).join(' · ')],
            ['Funding', `${p.fundingProceeding}`], ['Location', `${p.location.city} · Class ${p.location.classLocation}${p.location.hca ? ' · HCA' : ''}${p.location.dac ? ' · DAC' : ''}`],
          ]} />
        )}
        {tab === 'estimate' && <EstimateSummary s={s} p={p} est={est} draft={draft} required={st.gate.requiredEstimateClass} pos={pos} />}
        {tab === 'schedule' && (
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Milestone</th><th>Baseline</th><th>Forecast / actual</th><th className="num">Slip</th></tr></thead><tbody>
            {p.milestones.map((m) => { const d = daysBetween(m.baseline, m.actual ?? m.forecast); return <tr key={m.id}><td>{m.name}</td><td className="tabular-nums">{fmtDate(m.baseline)}</td><td className="tabular-nums">{m.actual ? <span className="text-good">{fmtDate(m.actual)} ✓</span> : fmtDate(m.forecast)}</td><td className={cx('num font-semibold', d > 30 ? 'text-bad' : d > 0 ? 'text-warn' : 'text-faint')}>{d > 0 ? '+' : ''}{d}d</td></tr> })}
          </tbody></table></div>
        )}
        {tab === 'risks' && (risks.length ? (
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Risk</th><th className="num">Score</th><th className="num">Expected</th><th>Response</th></tr></thead><tbody>
            {risks.map((x) => <tr key={x.id}><td><Mono className="mr-1.5 text-muted">{x.code}</Mono>{x.title}</td><td className={cx('num font-semibold', riskScore(x) >= 15 ? 'text-bad' : riskScore(x) >= 8 ? 'text-warn' : '')}>{riskScore(x)}</td><td className="num">{money(Math.round(expectedCost(x)))}</td><td className="text-[12px]">{x.responses.length ? x.responses.map((rr) => rr.action).join('; ') : <Badge tone="bad">No response</Badge>}</td></tr>)}
          </tbody></table></div>
        ) : <Empty title="No active risks" />)}
        {tab === 'changes' && (changes.length ? (
          <div className="scroll-x"><table className="tbl"><thead><tr><th>Change</th><th>Root cause</th><th className="num">Cost</th><th className="num">Days</th><th>Status</th></tr></thead><tbody>
            {changes.map((c) => <tr key={c.id}><td><Mono className="mr-1.5 text-muted">{c.code}</Mono>{c.title}</td><td className="text-[12px]">{c.rootCause}</td><td className="num">{moneyDelta(c.costImpact)}</td><td className="num">{c.scheduleImpactDays}</td><td><StatusBadge status={c.status} /></td></tr>)}
          </tbody></table></div>
        ) : <Empty title="No changes on record" />)}
        {tab === 'evidence' && (
          <ul className="flex flex-col gap-2">
            {defs.map((def) => {
              const d = dls.find((x) => x.defId === def.id)
              return (
                <li key={def.id} className="rounded border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]"><b>{def.name}</b><StatusBadge status={d?.status ?? 'not-started'} />{d && d.version > 0 && <span className="text-[11px] text-faint">v{d.version}</span>}</div>
                  {d?.evidence.length ? <div className="mt-1 flex flex-wrap gap-1.5">{d.evidence.map((e) => <span key={e.id} className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[11px]"><Icon name="doc" className="h-3 w-3 text-faint" />{e.name}</span>)}</div> : <div className="mt-0.5 text-[11px] text-bad">No evidence</div>}
                  {d?.waiverReason && <div className="mt-1 text-[11px] text-warn">Waived: {d.waiverReason}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function EstimateSummary({ s, p, est, draft, required, pos }: { s: AppState; p: Project; est?: ReturnType<typeof latestApprovedEstimate>; draft?: ReturnType<typeof latestEstimate>; required?: number; pos: ReturnType<typeof position> }) {
  const shown = [est, draft && draft.id !== est?.id ? draft : undefined].filter(Boolean) as NonNullable<typeof est>[]
  if (!shown.length) return <Empty title="No estimate on file" action={<a href={projectHref(p.id, 'estimates')} className="text-[13px] font-semibold text-link hover:underline">Open estimates →</a>} />
  const scale = Math.max(...shown.map((e) => estimateTotals(e).high)) * 1.05
  return (
    <div className="flex flex-col gap-3">
      {shown.map((e) => {
        const t = estimateTotals(e)
        const ok = !required || e.cls <= required
        return (
          <div key={e.id} className="rounded border border-line px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <ClassBadge cls={e.cls} size="lg" />
              <span className="text-[13px] font-semibold">{e.title} v{e.version}</span>
              <StatusBadge status={e.status} />
              {required && <Badge tone={ok ? 'good' : 'bad'}>{ok ? `Meets Class ${required}` : `Below Class ${required}`}</Badge>}
              <span className="ml-auto font-display text-[19px] font-bold tabular-nums">{money(t.total)}</span>
            </div>
            <div className="mt-2"><RangeBar low={t.low} point={t.total} high={t.high} scaleMax={scale} /></div>
            <div className="flex justify-between text-[11px] tabular-nums text-muted"><span>{money(t.low)} ({Math.round(CLASS_RANGES[e.cls].low * 100)}%)</span><span>Contingency {money(t.contingency)} ({e.contingency.pct}% {e.contingency.method})</span><span>{money(t.high)} (+{Math.round(CLASS_RANGES[e.cls].high * 100)}%)</span></div>
            {e.approvedAt && <div className="mt-1 text-[11px] text-faint">Approved {fmtDate(e.approvedAt.slice(0, 10))} by {personName(s, e.approvedById)}</div>}
            {e.workflowInstanceId && e.status === 'in-review' && <div className="mt-2"><WorkflowStatus instanceId={e.workflowInstanceId} compact /></div>}
          </div>
        )
      })}
      {pos.currentBudget > 0 && <div className="text-[12px] text-muted">Current {pos.budgetKind} budget <b className="text-ink">{money(pos.currentBudget)}</b> · EAC <b className={pos.eac > pos.currentBudget ? 'text-bad' : 'text-ink'}>{money(pos.eac)}</b></div>}
    </div>
  )
}

// ───────────────────────────── Decision panel
function DecisionPanel({ s, p, gateWf }: { s: AppState; p: Project; gateWf?: WorkflowInstance }) {
  const me = useMe()
  const tpl = templateFor(s, p)
  const st = tpl.stages[p.stageIndex]
  const r = readiness(s, p)
  const [outcome, setOutcome] = useState<GateOutcome>(r.ready ? 'go' : 'go-with-conditions')
  const [deciders, setDeciders] = useState<string[]>(() => Array.from(new Set([me.id, p.team.sponsor].filter(Boolean) as string[])))
  const [notes, setNotes] = useState('')
  const [conds, setConds] = useState<{ title: string; ownerId: string; due: string }[]>(() => r.blockers.length ? r.missing.slice(0, 3).map((m) => ({ title: `Complete: ${m.name}`, ownerId: p.team.pm ?? me.id, due: addDays(s.settings.asOf, 30) })) : [])
  const [override, setOverride] = useState(false)
  const [addPerson, setAddPerson] = useState('')
  const next = tpl.stages[p.stageIndex + 1]
  const est = latestApprovedEstimate(s, p.id)
  const go = outcome === 'go' || outcome === 'go-with-conditions'
  const blocked = go && !r.ready && !override
  const board = s.people.filter((x) => !x.company && x.roles.some((y) => y === 'gate-board' || y === 'sponsor' || y === 'exec'))
  const record = () => {
    if (!deciders.length) { toast('Name at least one decider', 'bad'); return }
    if (!notes.trim()) { toast('Record the basis for the decision in the notes', 'bad'); return }
    if (outcome === 'go-with-conditions' && !conds.filter((c) => c.title.trim()).length) { toast('Add at least one condition', 'bad'); return }
    if (blocked) { toast('Resolve the blockers or record that the board accepts them', 'bad'); return }
    const cleanConds = outcome === 'go-with-conditions' ? conds.filter((c) => c.title.trim()) : []
    const fullNotes = notes.trim() + (go && !r.ready ? ` [Board accepted open blockers: ${r.blockers.join('; ')}]` : '')
    mutate((d) => {
      decideGate(d, p.id, outcome, deciders, fullNotes, cleanConds)
      const inst = gateWf ? d.workflows.find((w) => w.id === gateWf.id) : undefined
      if (inst && inst.status === 'running') {
        // Close the routing record: the decision is the gate board's act of record.
        inst.history.push({ id: uid('ev'), at: nowISO(), nodeId: inst.active[0]?.nodeId ?? 'board', actorId: d.currentUserId, action: go ? 'approve' : outcome === 'cancel' ? 'reject' : 'return', comment: `Gate decision recorded: ${outcomeLabel(outcome)}`, signature: go ? { method: 'password-reauth', hash: Math.random().toString(16).slice(2, 14) } : undefined })
        inst.history.push({ id: uid('ev'), at: nowISO(), nodeId: '', actorId: 'system', action: 'complete', comment: go ? 'approved' : outcome === 'cancel' ? 'rejected' : 'returned' })
        inst.status = go ? 'approved' : outcome === 'cancel' ? 'rejected' : 'returned'
        inst.completedAt = nowISO()
        inst.active = []
      }
      for (const id of deciders) if (id !== d.currentUserId) d.notifications.push({ id: uid('ntf'), at: nowISO(), toId: id, text: `${p.code} ${st.gate.name}: ${outcomeLabel(outcome)} recorded`, link: projectHref(p.id, 'lifecycle'), read: false })
    })
    toast(go ? `${st.gate.name} passed${next ? ` — now in ${next.name}` : ' — project closed'}` : `${outcomeLabel(outcome)} recorded`)
    setNotes('')
  }
  return (
    <Panel title="Record gate decision" subtitle={`${st.gate.name} · decision roles: ${st.gate.decisionRoles.map((x) => s.roles.find((y) => y.id === x)?.name ?? x).join(', ')}`}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
            {OUTCOMES.map((o) => (
              <button key={o.id} onClick={() => setOutcome(o.id)} className={cx('rounded-md border px-2.5 py-2 text-left', outcome === o.id ? (o.tone === 'good' ? 'border-good bg-good/10' : o.tone === 'info' ? 'border-info bg-info/10' : o.tone === 'bad' ? 'border-bad bg-bad/10' : 'border-warn bg-warn/10') : 'border-line hover:border-ink/40')}>
                <div className="text-[13px] font-semibold">{o.label}</div>
                <div className="text-[10.5px] leading-snug text-muted">{o.desc}</div>
              </button>
            ))}
          </div>
          {outcome === 'go-with-conditions' && (
            <div>
              <div className="mb-1 flex items-center justify-between"><span className="text-[12px] font-semibold text-muted">Conditions (become tracked actions)</span><Button size="sm" variant="ghost" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setConds([...conds, { title: '', ownerId: p.team.pm ?? me.id, due: addDays(s.settings.asOf, 30) }])}>Add condition</Button></div>
              <div className="flex flex-col gap-1.5">
                {conds.map((c, i) => (
                  <div key={i} className="grid grid-cols-1 gap-1.5 rounded border border-line p-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_130px_auto]">
                    <Input aria-label="Condition" value={c.title} placeholder="Close open land items before mobilization" onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                    <PersonSelect value={c.ownerId} onChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, ownerId: v } : x)))} />
                    <Input aria-label="Due" type="date" value={c.due} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
                    <Button size="sm" variant="ghost" aria-label="Remove condition" onClick={() => setConds(conds.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                ))}
                {!conds.length && <span className="text-[12px] text-faint">No conditions yet.</span>}
              </div>
            </div>
          )}
          <Field label="Decision notes" hint="The board's basis for the decision. Stored with the immutable gate record."><TextArea id="gate-notes" className="min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={go ? 'Deliverables accepted; Class 3 estimate within range of bids; proceed.' : 'Recycle: option analysis must compare HDD with open cut on cost and risk.'} /></Field>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-[12px] font-semibold text-muted">Deciders</div>
            <div className="flex flex-wrap gap-1.5">
              {deciders.map((id) => <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sunken py-0.5 pl-0.5 pr-2 text-[12px]"><Avatar name={personName(s, id)} size={20} />{personName(s, id)}<button aria-label="Remove" className="text-faint hover:text-bad" onClick={() => setDeciders(deciders.filter((x) => x !== id))}>✕</button></span>)}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <select aria-label="Add decider" className="inp" value={addPerson} onChange={(e) => setAddPerson(e.target.value)}>
                <option value="">Add a board member…</option>
                {board.filter((x) => !deciders.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.title}</option>)}
              </select>
              <Button size="sm" disabled={!addPerson} onClick={() => { setDeciders([...deciders, addPerson]); setAddPerson('') }}>Add</Button>
            </div>
          </div>
          <div className="rounded-md border border-line bg-sunken/40 p-3 text-[12px]">
            <div className="eyebrow mb-1">What this records</div>
            <ul className="flex flex-col gap-0.5">
              <li>• Readiness at decision: <b>{r.pct}%</b> with {Object.keys(Object.fromEntries(s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex).map((d) => [d.id, d.version]))).length} deliverable versions frozen</li>
              <li>• Estimate of record: {est ? <><ClassBadge cls={est.cls} /> {money(estimateTotals(est).total)} v{est.version}</> : 'none approved'}</li>
              <li>• A gate snapshot of scope, schedule and budget</li>
              {go && st.gate.budgetEvent && est && <li>• Converts the estimate into the <b>{st.gate.budgetEvent} budget</b>{st.gate.budgetEvent === 'control' ? ' and sets Original + Current baselines' : ''}</li>}
              {go && <li>• {next ? <>Advances to <b>{next.name}</b>; unlocks {st.gate.unlocks.length ? st.gate.unlocks.map((u) => PERM_LABEL[u].label).join(', ') : 'no new permissions'}</> : <>Closes the project</>}</li>}
              {outcome === 'hold' && <li>• Sets the project <b>on hold</b></li>}
              {outcome === 'cancel' && <li>• Sets the project <b>cancelled</b></li>}
              {gateWf && <li>• Completes the open gate-review workflow</li>}
            </ul>
          </div>
          {go && !r.ready && (
            <Callout tone="bad" title="Open blockers">
              {r.blockers.map((b) => <div key={b}>• {b}</div>)}
              <div className="mt-2"><Checkbox checked={override} onChange={setOverride} label="The board accepts these blockers; record them in the decision notes" /></div>
            </Callout>
          )}
          <Button variant={outcome === 'cancel' ? 'danger' : 'primary'} disabled={blocked} onClick={record}>Record {outcomeLabel(outcome).toLowerCase()} decision</Button>
        </div>
      </div>
    </Panel>
  )
}

// ───────────────────────────── History
function GateHistory({ s, p }: { s: AppState; p: Project }) {
  const decisions = s.gateDecisions.filter((g) => g.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date))
  const toggle = (id: string, done: boolean) => {
    const a = s.actions.find((x) => x.id === id)!
    mutate((d) => { d.actions.find((x) => x.id === id)!.status = done ? 'done' : 'open' }, { entity: 'action', entityId: id, projectId: p.id, action: done ? 'done' : 'reopen', summary: `Gate condition ${done ? 'met' : 'reopened'}: ${a.title}` })
    toast(done ? 'Condition marked met' : 'Condition reopened')
  }
  return (
    <Panel title="Gate history" subtitle="Immutable record of every gate decision, who decided, and what they relied on" pad={false}>
      {decisions.length === 0 ? <div className="p-4"><Empty title="No gate decisions yet">The first decision is recorded at {templateFor(s, p).stages[0].gate.name}.</Empty></div> : (
        <ul className="divide-y divide-line">
          {decisions.map((g) => {
            const snap = s.snapshots.find((x) => x.id === g.snapshotId)
            const est = s.estimates.find((x) => x.id === g.estimateId)
            const conds = s.actions.filter((a) => g.conditions.includes(a.id))
            return (
              <li key={g.id} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <div className="text-[13px] font-semibold">{g.gateName}</div>
                  <div className="mt-0.5 flex items-center gap-2"><Badge tone={outcomeTone(g.outcome)}>{outcomeLabel(g.outcome)}</Badge><span className="text-[12px] tabular-nums text-muted">{fmtDate(g.date)}</span></div>
                </div>
                <div className="min-w-0 text-[12px]">
                  <div className="flex flex-wrap items-center gap-1.5">{g.decidedBy.map((id) => <span key={id} className="inline-flex items-center gap-1"><Avatar name={personName(s, id)} size={18} />{personName(s, id)}</span>)}</div>
                  <p className="mt-1 text-[13px]">{g.notes}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    <span>Readiness at decision <b className="text-ink">{g.readiness}%</b></span>
                    <span>{Object.keys(g.deliverableVersions).length} deliverable versions frozen</span>
                    {est && <span className="inline-flex items-center gap-1">Estimate <ClassBadge cls={est.cls} /> {money(estimateTotals(est).total)}</span>}
                    {snap && <a className="font-semibold text-link hover:underline" href={projectHref(p.id, 'baselines')}>Snapshot {fmtDate(snap.date)} · {money(snap.budget.total)} →</a>}
                  </div>
                </div>
                <div className="min-w-0">
                  {conds.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {conds.map((a) => {
                        const late = a.status === 'open' && a.due < s.settings.asOf
                        return (
                          <li key={a.id} className={cx('flex items-start gap-2 rounded border px-2 py-1 text-[12px]', late ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                            <input type="checkbox" aria-label="Condition met" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={a.status === 'done'} onChange={(e) => toggle(a.id, e.target.checked)} />
                            <span className="min-w-0 flex-1"><span className={cx(a.status === 'done' && 'text-muted line-through')}>{a.title}</span><span className="block text-[11px] text-muted">{personName(s, a.ownerId)} · due {fmtDate(a.due)}{late ? ' · overdue' : ''}</span></span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : <span className="text-[12px] text-faint">No conditions</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function PriorStages({ s, p }: { s: AppState; p: Project }) {
  const tpl = templateFor(s, p)
  const [open, setOpen] = useState<number | null>(null)
  const upto = p.status === 'closed' ? tpl.stages.length : p.stageIndex
  if (upto === 0) return null
  return (
    <Panel title="Prior stages" subtitle="Deliverables accepted at earlier gates" pad={false}>
      <ul className="divide-y divide-line">
        {tpl.stages.slice(0, upto).map((st, i) => {
          const dls = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === i)
          const ev = dls.reduce((a, d) => a + d.evidence.length, 0)
          return (
            <li key={st.id}>
              <button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-sunken/50" onClick={() => setOpen(open === i ? null : i)}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-link text-[11px] font-bold text-surface">{i + 1}</span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{st.name}</span>
                <span className="text-[11px] text-muted">{dls.filter((d) => d.status === 'accepted' || d.status === 'waived').length}/{dls.length} accepted · {ev} evidence</span>
                <span className="text-[11px] text-faint">{open === i ? '▲' : '▼'}</span>
              </button>
              {open === i && (
                <div className="scroll-x px-4 pb-3">
                  <table className="tbl"><thead><tr><th>Deliverable</th><th>Status</th><th className="num">Ver.</th><th>Owner</th><th>Evidence</th></tr></thead><tbody>
                    {dls.map((d) => {
                      const def = st.gate.deliverables.find((x) => x.id === d.defId)
                      return <tr key={d.id}><td>{def?.name ?? d.defId}</td><td><StatusBadge status={d.status} /></td><td className="num">v{d.version}</td><td className="whitespace-nowrap">{personName(s, d.ownerId)}</td><td className="text-[12px]">{d.evidence.map((e) => e.name).join(', ') || '—'}</td></tr>
                    })}
                  </tbody></table>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// ───────────────────────────── Submit for gate review
function SubmitGateModal({ open, onClose, p }: { open: boolean; onClose: () => void; p: Project }) {
  const s = useStore()
  const st = templateFor(s, p).stages[p.stageIndex]
  const r = readiness(s, p)
  const [summary, setSummary] = useState('')
  const [rec, setRec] = useState('Go')
  const defaultSummary = useMemo(() => `${r.done} of ${r.total} deliverables accepted (${r.pct}%).${r.blockers.length ? ' Open: ' + r.blockers.join('; ') + '.' : ' All gate criteria met.'}`, [r.done, r.total, r.pct, r.blockers])
  if (!open) return null
  const submit = () => {
    const text = (summary || defaultSummary).trim()
    mutate((d) => {
      const inst = startWorkflow(d, 'gate-review', { title: `${p.code} ${st.gate.name}`, recordType: 'gate', recordId: p.id, projectId: p.id, data: { summary: text, recommendation: rec, readiness: r.pct } })
      autoSubmit(d, inst, `Recommendation: ${rec}. ${text}`)
      if (!d.gateReviews.some((g) => g.projectId === p.id && g.stageIndex === p.stageIndex && g.status === 'scheduled')) {
        d.gateReviews.push({ id: uid('gr'), projectId: p.id, stageIndex: p.stageIndex, scheduled: addDays(d.settings.asOf, 21), board: [p.team.sponsor, 'u-pmo2'].filter(Boolean) as string[], status: 'scheduled' })
      }
    }, { entity: 'gate', entityId: p.id, projectId: p.id, action: 'submit', summary: `${st.gate.name} packet submitted (readiness ${r.pct}%, recommendation ${rec})` })
    toast('Gate packet submitted for PMO quality check')
    setSummary(''); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Submit for gate review · ${st.gate.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit packet</Button></>}>
      <div className="flex flex-col gap-3">
        {!r.ready && <Callout tone="warn" title="Not all criteria are met">{r.blockers.map((b) => <div key={b}>• {b}</div>)}<div className="mt-1 text-[12px]">You can still submit; the PMO quality check will see the open items.</div></Callout>}
        <Field label="Gate summary"><TextArea id="gate-summary" className="min-h-[90px]" value={summary} placeholder={defaultSummary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="PM recommendation"><Select id="gate-rec" value={rec} onChange={(e) => setRec(e.target.value)} options={['Go', 'Go with conditions', 'Recycle', 'Hold']} /></Field>
        <p className="text-[12px] text-muted">Routing: PM submits → PMO quality check → program and controls review in parallel → gate board decision. A board date is scheduled three weeks out if none exists.</p>
      </div>
    </Modal>
  )
}
