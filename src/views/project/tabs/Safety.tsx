// Project safety: job-specific safety plans by work package, NTP gate, tailboards and safety events (SF-*).
import { useState } from 'react'
import type { SafetyPlan } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { startWorkflow } from '@/core/engine/workflow'
import { ntpBlockers } from '@/core/engine/gates'
import { saveFile } from '@/core/download'
import { fmtDate, groupBy, uid, cx } from '@/core/util'
import { Badge, Button, Callout, Empty, Field, Input, Modal, Panel, StatusBadge, Table, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { EventModal, EventsTable } from '@/views/safety/Events'
import { PlanEditor } from '@/views/safety/PlanEditor'
import { blankPlan, indicators, jsspHtml, levelTone, opQualOn, oqCoverage, oqLevel, planHazards, planIssues, ticketLevel } from '@/views/safety/lib'
import { submitFirstForm } from '@/views/risk/wf'

export default function Safety({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const plans = s.safetyPlans.filter((x) => x.projectId === projectId)
  const byWp = groupBy(plans, (x) => x.workPackage)
  const wps = Object.keys(byWp).sort()
  const current = (wp: string) => { const vs = byWp[wp].slice().sort((a, b) => b.version - a.version); return vs.find((x) => x.status === 'approved') ?? vs[0] }
  const [selId, setSelId] = useState<string | undefined>(() => (wps[0] ? current(wps[0]).id : undefined))
  const sel = plans.find((x) => x.id === selId) ?? (wps[0] ? current(wps[0]) : undefined)
  const [editing, setEditing] = useState<SafetyPlan | null>(null)
  const [newWp, setNewWp] = useState<string | null>(null)
  const [eventOpen, setEventOpen] = useState(false)
  const blockers = ntpBlockers(s, p)
  const ind = indicators(s, [projectId], 30)
  const tailboards = s.tailboards.filter((t) => t.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date))
  const events = s.safetyEvents.filter((e) => e.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date))
  const inConstruction = s.budgets.some((b) => b.projectId === projectId && b.kind === 'control')

  const createPlan = () => {
    const wp = (newWp ?? '').trim()
    if (!wp) { toast('Name the work package.', 'bad'); return }
    if (byWp[wp]) { toast('That work package already has a plan.', 'bad'); return }
    const plan = blankPlan(s, projectId, wp)
    mutate((d) => { d.safetyPlans.push(plan) }, { entity: 'safety-plan', entityId: plan.id, projectId, action: 'create', summary: `Started JSSP for ${wp}` })
    setNewWp(null); setSelId(plan.id); setEditing(plan)
    toast('Safety plan started')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cx('flex flex-col gap-2 rounded-md border-2 px-4 py-3 md:flex-row md:items-center', blockers.length ? 'border-bad/60 bg-bad/5' : 'border-good/60 bg-good/5')}>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Construction notice to proceed</div>
          <div className={cx('font-display text-[20px] font-bold', blockers.length ? 'text-bad' : 'text-good')}>{blockers.length ? 'NTP blocked' : 'Clear for NTP'}</div>
          {blockers.length ? <ul className="mt-0.5 text-[13px]">{blockers.map((b) => <li key={b}>• {b}</li>)}</ul> : <p className="text-[13px] text-muted">Authorization gate passed, an approved job-specific safety plan is on file and all permits are issued.</p>}
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><div className="font-display text-[22px] font-bold tabular-nums">{ind.tailboardRate == null ? '—' : `${Math.round(ind.tailboardRate * 100)}%`}</div><div className="text-[11px] uppercase text-faint">Tailboards, 2 wks</div></div>
          <div><div className={cx('font-display text-[22px] font-bold tabular-nums', ind.lapsed ? 'text-bad' : '')}>{ind.lapsed}</div><div className="text-[11px] uppercase text-faint">Lapsed tickets</div></div>
          <div><div className={cx('font-display text-[22px] font-bold tabular-nums', ind.sif ? 'text-bad' : '')}>{ind.sif}</div><div className="text-[11px] uppercase text-faint">Open SIF-potential</div></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Safety plans" subtitle="One job-specific plan per work package" pad={false} actions={<Button size="sm" onClick={() => setNewWp(p.asset.type === 'valve-site' ? `WP${wps.length + 1} Sites` : `WP${wps.length + 1} Segment ${String.fromCharCode(65 + wps.length)}`)}>New plan</Button>}>
          {wps.length === 0 && <div className="p-4"><Empty title="No safety plans">{inConstruction ? 'Construction cannot start without an approved plan.' : 'Plans are prepared by the contractor during design & procurement.'}</Empty></div>}
          <div className="flex flex-col divide-y divide-line">
            {wps.map((wp) => (
              <div key={wp} className="px-3 py-2.5">
                <div className="mb-1.5 text-[13px] font-semibold">{wp}</div>
                <div className="flex flex-col gap-1">
                  {byWp[wp].slice().sort((a, b) => b.version - a.version).map((v) => {
                    const issues = planIssues(s, v).filter((i) => i.level === 'bad').length
                    return (
                      <button key={v.id} onClick={() => setSelId(v.id)} className={cx('flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[13px]', sel?.id === v.id ? 'border-ink bg-ink/5' : 'border-transparent hover:bg-sunken')}>
                        <span className="font-mono text-[12px] font-semibold">v{v.version}</span>
                        <StatusBadge status={v.status} />
                        <span className="text-xs text-faint">{fmtDate(v.approvedAt ?? v.createdAt)}</span>
                        {v.status !== 'superseded' && issues > 0 && <Badge tone="bad" className="ml-auto">{issues} issue{issues > 1 ? 's' : ''}</Badge>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        {sel ? <PlanDetail plan={sel} onEdit={() => setEditing(sel)} onSelect={setSelId} /> : <Panel title="Plan"><Empty title="Select or start a plan" /></Panel>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Tailboards" subtitle={`${tailboards.length} recorded · ${ind.tailboardsHeld} of ${ind.tailboardsExpected} working days in the last two weeks`} pad={false} actions={<a href="#field"><Button size="sm">Open field tailboard</Button></a>}>
          <Table rows={tailboards} rowKey={(t) => t.id} maxHeight={360} dense empty={<div className="p-4"><Empty title="No tailboards yet">Crews record the pre-job briefing from the field tailboard app.</Empty></div>}
            columns={[
              { key: 'date', header: 'Date', render: (t) => <span className="whitespace-nowrap">{fmtDate(t.date)}</span>, sort: (t) => t.date },
              { key: 'leader', header: 'Leader', render: (t) => t.leader },
              { key: 'n', header: 'Crew', num: true, render: (t) => t.attendees.length },
              { key: 'hz', header: 'Hazards discussed', render: (t) => <span className="text-[12px]">{t.hazardsDiscussed.map((id) => s.hazards.find((h) => h.id === id)?.hazard).filter(Boolean).join(' · ') || '—'}</span> },
              { key: 'flags', header: '', render: (t) => <span className="flex gap-1">{t.stopWorkReminder && <Badge tone="good">SWA</Badge>}{t.offlineCaptured && <Badge tone="info">Offline</Badge>}</span> },
            ]} />
        </Panel>
        <Panel title="Safety events" subtitle={`${ind.observations} observations · ${ind.nearMisses} near misses · ${ind.incidents} incidents in 30 days`} pad={false} actions={<Button size="sm" variant="primary" onClick={() => setEventOpen(true)}>Log event</Button>}>
          <EventsTable events={events} />
        </Panel>
      </div>

      <PlanEditor open={!!editing} plan={editing} onClose={() => setEditing(null)} />
      <EventModal open={eventOpen} onClose={() => setEventOpen(false)} projectId={projectId} planId={sel?.id} contractor={sel?.contractor ?? p.contractor} />
      <Modal open={newWp !== null} onClose={() => setNewWp(null)} title="New job-specific safety plan" footer={<><Button variant="ghost" onClick={() => setNewWp(null)}>Cancel</Button><Button variant="primary" onClick={createPlan}>Start plan</Button></>}>
        <Field label="Work package" hint="Each work package gets its own plan and version history."><Input id="new-wp" value={newWp ?? ''} onChange={(e) => setNewWp(e.target.value)} /></Field>
      </Modal>
    </div>
  )
}

function PlanDetail({ plan, onEdit, onSelect }: { plan: SafetyPlan; onEdit: () => void; onSelect: (id: string) => void }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === plan.projectId)!
  const asOf = s.settings.asOf
  const hz = planHazards(s, plan)
  const issues = planIssues(s, plan)
  const bad = issues.filter((i) => i.level === 'bad')
  const oqOn = opQualOn(s)
  const cov = oqOn ? oqCoverage(s, plan, asOf) : []
  const newer = s.safetyPlans.find((x) => x.projectId === plan.projectId && x.workPackage === plan.workPackage && x.version > plan.version && x.status !== 'superseded')
  const [submitting, setSubmitting] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [changeNote, setChangeNote] = useState('')

  const submit = () => {
    mutate((d) => {
      const inst = startWorkflow(d, 'safety-plan', { title: `${p.code} JSSP ${plan.workPackage} v${plan.version}`, recordType: 'safety-plan', recordId: plan.id, projectId: plan.projectId, data: { workPackage: plan.workPackage, version: plan.version, openIssues: bad.length } })
      submitFirstForm(d, inst?.id, bad.length ? `Submitted with ${bad.length} open item(s) for reviewer attention` : 'Plan prepared; all pre-mobilization checks pass')
    }, { entity: 'safety-plan', entityId: plan.id, projectId: plan.projectId, action: 'submit', summary: `Submitted JSSP ${plan.workPackage} v${plan.version} for approval` })
    setSubmitting(false)
    toast('Safety plan submitted for approval')
  }
  const fieldChange = () => {
    if (!changeNote.trim()) { toast('Describe the field change.', 'bad'); return }
    const id = uid('jssp')
    mutate((d) => {
      const src = d.safetyPlans.find((x) => x.id === plan.id)!
      const max = Math.max(...d.safetyPlans.filter((x) => x.projectId === plan.projectId && x.workPackage === plan.workPackage).map((x) => x.version))
      const copy: SafetyPlan = JSON.parse(JSON.stringify(src))
      d.safetyPlans.push({ ...copy, id, version: max + 1, status: 'draft', createdAt: d.settings.asOf, approvedAt: undefined, workflowInstanceId: undefined, extraControls: [...copy.extraControls] })
    }, { entity: 'safety-plan', entityId: id, projectId: plan.projectId, action: 'field-change', summary: `Field change to JSSP ${plan.workPackage}: v${plan.version} → new draft. ${changeNote.trim()}` })
    setChangeOpen(false); setChangeNote('')
    onSelect(id)
    toast(`Version ${plan.version + 1} draft created; v${plan.version} stays in force until it is approved`)
  }
  const download = async () => {
    const r = await saveFile(`JSSP_${p.code}_${plan.workPackage.replace(/\W+/g, '_')}_v${plan.version}.html`, jsspHtml(s, plan), 'text/html')
    toast(r === 'saved' ? 'Safety plan downloaded' : r === 'declined' ? 'Download cancelled' : 'Download not available here', r === 'saved' ? 'good' : 'info')
  }

  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">{plan.workPackage} <Badge tone="ink">v{plan.version}</Badge><StatusBadge status={plan.status} /></span>}
      subtitle={`${plan.contractor} · ${plan.activities.length} activities · ${hz.length} hazards · ${plan.crew.length} crew · library ${plan.libraryVersion}`}
      actions={<>
        <Button size="sm" onClick={download}>Download plan</Button>
        {plan.status === 'draft' && <Button size="sm" onClick={onEdit}>Edit plan</Button>}
        {plan.status === 'draft' && (submitting ? <span className="inline-flex gap-1"><Button size="sm" variant="primary" onClick={submit}>Confirm submit</Button><Button size="sm" variant="ghost" onClick={() => setSubmitting(false)}>Cancel</Button></span> : <Button size="sm" variant="primary" onClick={() => setSubmitting(true)} disabled={!plan.hazardIds.length}>Submit for approval</Button>)}
        {plan.status === 'approved' && !newer && <Button size="sm" variant="marker" onClick={() => setChangeOpen(true)}>Field change</Button>}
      </>}>
      <div className="flex flex-col gap-4">
        {newer && plan.status === 'approved' && <Callout tone="info" title={`Field change in progress: v${newer.version} ${newer.status.replace('-', ' ')}`}>This version stays in force until v{newer.version} is approved. <button className="font-semibold text-link" onClick={() => onSelect(newer.id)}>Open v{newer.version}</button></Callout>}
        {plan.status === 'superseded' && <Callout tone="warn">Superseded by a later approved version. Kept for the record.</Callout>}
        {submitting && bad.length > 0 && <Callout tone="bad" title={`${bad.length} blocking item(s)`}>The reviewer will see these. Fix them first if you can.</Callout>}
        {plan.workflowInstanceId && <WorkflowStatus instanceId={plan.workflowInstanceId} compact={plan.status === 'approved' || plan.status === 'superseded'} />}

        {issues.length > 0 ? (
          <div className="rounded-md border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-2"><span className="text-xs font-bold uppercase tracking-wide text-muted">Pre-mobilization check</span>{bad.length > 0 && <Badge tone="bad">{bad.length} blocking</Badge>}{issues.length - bad.length > 0 && <Badge tone="warn">{issues.length - bad.length} warning</Badge>}</div>
            <ul className="flex flex-col gap-1 px-3 py-2 text-[13px]">{issues.map((x, i) => <li key={i} className="flex items-start gap-2"><span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.level === 'bad' ? 'bg-bad' : 'bg-warn')} />{x.text}</li>)}</ul>
          </div>
        ) : <Callout tone="good">All pre-mobilization checks pass: tickets current, permits listed, every covered task has a qualified crew member.</Callout>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="eyebrow mb-1.5">Tickets & permits</div>
            {plan.tickets.length === 0 ? <p className="text-[13px] text-muted">None listed.</p> : (
              <table className="tbl"><thead><tr><th>Type</th><th>Number</th><th>Expires</th><th>Status</th></tr></thead>
                <tbody>{plan.tickets.map((t) => { const st = ticketLevel(t.expires, asOf); return <tr key={t.id}><td>{t.type}</td><td className="font-mono text-[12px]">{t.number || '—'}</td><td className="whitespace-nowrap">{fmtDate(t.expires)}</td><td><Badge tone={levelTone(st.level)}>{st.label}</Badge></td></tr> })}</tbody></table>
            )}
          </div>
          <div>
            <div className="eyebrow mb-1.5">Emergency</div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted">Site</dt><dd>{plan.site.address || '—'}</dd>
              <dt className="text-muted">Hospital</dt><dd><b>{plan.site.hospital || '—'}</b><div className="text-xs text-muted">{plan.site.hospitalRoute}</div></dd>
              <dt className="text-muted">Muster point</dt><dd>{plan.site.musterPoint || '—'}</dd>
              <dt className="text-muted">Contacts</dt><dd>{plan.site.contacts.map((c) => <div key={c.name + c.role}>{c.name} <span className="text-muted">· {c.role} · {c.phone}</span></div>)}</dd>
              <dt className="text-muted">Plans</dt><dd className="flex gap-1">{plan.heatPlan && <Badge tone="warn">Heat plan</Badge>}{plan.trafficPlan && <Badge tone="info">Traffic plan</Badge>}{!plan.heatPlan && !plan.trafficPlan && '—'}</dd>
            </dl>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-1.5">Hazards & controls</div>
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Activity</th><th>Hazard</th><th className="num">Eng.</th><th className="num">Admin</th><th className="num">PPE</th><th className="num">Site</th><th>{oqOn ? 'Permits / OQ' : 'Permits'}</th></tr></thead>
            <tbody>{hz.map((h) => (
              <tr key={h.id}>
                <td className="text-[12px] text-muted">{h.activity}</td>
                <td className="font-semibold">{h.hazard}</td>
                <td className="num">{h.controls.filter((c) => c.type === 'engineering').length}</td>
                <td className="num">{h.controls.filter((c) => c.type === 'administrative').length}</td>
                <td className="num">{h.controls.filter((c) => c.type === 'ppe').length}</td>
                <td className="num">{plan.extraControls.filter((x) => x.hazardId === h.id).length || '—'}</td>
                <td className="text-[12px]">{[...h.permits, ...(oqOn ? h.oqTasks.map((x) => `OQ ${x}`) : [])].join(' · ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2"><span className="eyebrow">Crew</span>{cov.map((c) => <Badge key={c.task} tone={c.valid.length ? 'good' : 'bad'}>{c.task} {c.valid.length ? `✓ ${c.valid.length}` : '✗'}</Badge>)}</div>
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Company</th>{oqOn && <><th>OQ tasks</th><th>OQ</th></>}<th>Prequal</th></tr></thead>
            <tbody>{plan.crew.map((c) => { const oq = oqLevel(c.oqExpires, asOf); return (
              <tr key={c.id}><td className="font-semibold">{c.name}</td><td>{c.role}</td><td className="text-[12px]">{c.company}</td>{oqOn && <><td className="text-[12px]">{c.oqTasks.join(', ') || '—'}</td><td><Badge tone={levelTone(oq.level)}>{oq.label}</Badge></td></>}<td><StatusBadge status={c.prequal.toLowerCase()} label={c.prequal} /></td></tr>) })}</tbody>
          </table></div>
        </div>
      </div>
      <Modal open={changeOpen} onClose={() => setChangeOpen(false)} title={`Field change to ${plan.workPackage}`} footer={<><Button variant="ghost" onClick={() => setChangeOpen(false)}>Cancel</Button><Button variant="primary" onClick={fieldChange}>Create v{plan.version + 1} draft</Button></>}>
        <div className="flex flex-col gap-3">
          <Callout tone="info">Approved plans are never edited. A field change creates version {plan.version + 1} as a draft; v{plan.version} stays in force until the new version is approved.</Callout>
          <Field label="What changed in the field"><TextArea id="fc-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Night work added on Mission Rd; new crew from sub-contractor; confined space vault found at station 42+10" /></Field>
        </div>
      </Modal>
    </Panel>
  )
}
