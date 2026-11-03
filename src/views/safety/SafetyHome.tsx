// Safety home (SF-10): leading indicators by contractor and project, approvals, expiring tickets, hazard library.
import { useEffect, useState } from 'react'
import type { ControlType, HazardItem } from '@/core/types'
import { mutate, personName, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { daysBetween, fmtDate, uid, cx } from '@/core/util'
import { Badge, Button, Callout, Drawer, Empty, Field, Input, PageHeader, Panel, Select, Stat, Table, TextArea, type Column } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { ProgramTag } from '@/views/shared/pickers'
import { EventsTable } from './Events'
import { indicators, levelTone, opQualOn, planIssues, ticketLevel } from './lib'

const pctTxt = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const rateTone = (n: number | null) => (n == null ? '' : n >= 0.95 ? 'text-good' : n >= 0.8 ? 'text-warn' : 'text-bad')

export default function SafetyHome(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const asOf = s.settings.asOf
  const oqOn = opQualOn(s)
  const fieldOn = !!s.settings.features?.fieldTailboard
  const [hazard, setHazard] = useState<HazardItem | null>(null)
  const [openWf, setOpenWf] = useState<string | null>(null)
  const [hzQ, setHzQ] = useState('')
  const [evFilter, setEvFilter] = useState<'open' | 'sif' | 'all'>('open')

  const working = s.projects.filter((p) => p.status === 'active' && s.safetyPlans.some((x) => x.projectId === p.id && x.status === 'approved'))
  const withPlans = s.projects.filter((p) => p.status === 'active' && s.safetyPlans.some((x) => x.projectId === p.id))
  const all = indicators(s, working.map((p) => p.id), 30)
  const contractors = Array.from(new Set(s.safetyPlans.filter((x) => x.status === 'approved').map((x) => x.contractor))).sort()
  const byContractor = contractors.map((c) => ({ c, ...indicators(s, working.map((p) => p.id), 30, c), projects: working.filter((p) => s.safetyPlans.some((x) => x.projectId === p.id && x.contractor === c && x.status === 'approved')).length }))

  const awaiting = s.safetyPlans.filter((x) => x.status === 'in-review')
  const drafts = s.safetyPlans.filter((x) => x.status === 'draft')
  const live = s.safetyPlans.filter((x) => x.status === 'approved' || x.status === 'in-review')
  const tickets = live.flatMap((pl) => pl.tickets.map((t) => ({ t, pl, st: ticketLevel(t.expires, asOf) }))).filter((x) => x.st.days <= 7).sort((a, b) => a.st.days - b.st.days)
  const crewOq = live.flatMap((pl) => pl.crew.filter((c) => c.oqTasks.length && daysBetween(asOf, c.oqExpires) <= 30).map((c) => ({ c, pl })))
  const proj = (id: string) => s.projects.find((p) => p.id === id)!
  const events = s.safetyEvents.filter((e) => (evFilter === 'open' ? e.status === 'open' : evFilter === 'sif' ? e.sifPotential : true)).sort((a, b) => b.date.localeCompare(a.date))

  const projCols: Column<(typeof working)[number]>[] = [
    { key: 'p', header: 'Project', render: (p) => <a href={projectHref(p.id, 'safety')} className="flex items-center gap-2 hover:underline"><ProgramTag programId={p.programId} /><span className="font-mono text-[12px] font-semibold">{p.code}</span><span className="max-w-[220px] truncate text-[12px] text-muted">{p.name}</span></a>, sort: (p) => p.code },
    { key: 'c', header: 'Contractor', render: (p) => <span className="text-[12px]">{s.safetyPlans.find((x) => x.projectId === p.id && x.status === 'approved')?.contractor}</span> },
    { key: 'tb', header: 'Tailboards', num: true, render: (p) => { const i = indicators(s, [p.id]); return <span className={cx('font-semibold', rateTone(i.tailboardRate))}>{pctTxt(i.tailboardRate)}</span> }, sort: (p) => indicators(s, [p.id]).tailboardRate ?? 0 },
    { key: 'obs', header: 'Obs. 30d', num: true, render: (p) => indicators(s, [p.id]).observations + indicators(s, [p.id]).nearMisses },
    { key: 'lapse', header: 'Lapsed', num: true, render: (p) => { const n = indicators(s, [p.id]).lapsed; return <span className={n ? 'font-bold text-bad' : ''}>{n}</span> }, sort: (p) => indicators(s, [p.id]).lapsed },
    { key: 'exp', header: '≤3 days', num: true, render: (p) => { const n = indicators(s, [p.id]).expiring; return <span className={n ? 'font-bold text-warn' : ''}>{n}</span> } },
    { key: 'open', header: 'Open events', num: true, render: (p) => indicators(s, [p.id]).openEvents },
    { key: 'sif', header: 'SIF open', num: true, render: (p) => { const n = indicators(s, [p.id]).sif; return n ? <Badge tone="bad">{n}</Badge> : <span className="text-faint">0</span> }, sort: (p) => indicators(s, [p.id]).sif },
  ]

  return (
    <div>
      <PageHeader eyebrow="Controls" title="Construction safety" subtitle="Leading indicators across every crew working under an approved job-specific safety plan."
        actions={fieldOn ? <a href="#field"><Button variant="marker">Open field tailboard</Button></a> : undefined} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Crews working" value={working.length} sub={`${working.filter((p) => s.tailboards.some((t) => t.projectId === p.id && t.date === asOf)).length} of ${working.length} briefed today`} />
        <Stat label="Tailboard completion" value={pctTxt(all.tailboardRate)} sub={`${all.tailboardsHeld} of ${all.tailboardsExpected} working days, 2 wks`} tone={all.tailboardRate == null ? undefined : all.tailboardRate >= 0.95 ? 'good' : all.tailboardRate >= 0.8 ? 'warn' : 'bad'} />
        <Stat label="Observations, 30 days" value={all.observations + all.nearMisses} sub={`${all.nearMisses} near misses · ${all.obsPerWeek.toFixed(1)}/crew/wk`} />
        <Stat label="Lapsed tickets" value={all.lapsed} tone={all.lapsed ? 'bad' : 'good'} sub={`${all.expiring} expiring in ≤3 days`} />
        <Stat label="Open SIF-potential" value={all.sif} tone={all.sif ? 'bad' : 'good'} sub={`${all.openEvents} open events total`} />
        <Stat label="Plans awaiting approval" value={awaiting.length} tone={awaiting.length ? 'warn' : undefined} sub={`${drafts.length} drafts in preparation`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Leading indicators by contractor" subtitle="Last 30 days; tailboards over the last two weeks" pad={false}>
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Contractor</th><th className="num">Projects</th><th className="num">Tailboards</th><th className="num">Obs. / near miss</th><th className="num">Lapsed tickets</th><th className="num">Open events</th><th className="num">SIF open</th></tr></thead>
            <tbody>{byContractor.map((x) => (
              <tr key={x.c}>
                <td className="font-semibold">{x.c}</td>
                <td className="num">{x.projects}</td>
                <td className={cx('num font-semibold', rateTone(x.tailboardRate))}>{pctTxt(x.tailboardRate)}</td>
                <td className="num">{x.observations} / {x.nearMisses}</td>
                <td className={cx('num', x.lapsed > 0 && 'font-bold text-bad')}>{x.lapsed}</td>
                <td className="num">{x.openEvents}</td>
                <td className="num">{x.sif ? <Badge tone="bad">{x.sif}</Badge> : '0'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="border-t border-line px-4 py-2 text-[11px] text-faint">Tailboard completion = working days with a recorded tailboard ÷ working days since plan approval. Targets: ≥95% tailboards, zero lapsed tickets.</p>
        </Panel>

        <Panel title="Plans awaiting approval" subtitle={`${awaiting.length} in review · ${drafts.length} drafts`} pad={false}>
          {awaiting.length === 0 && <div className="p-4"><Empty title="Nothing waiting">Submitted job-specific safety plans appear here.</Empty></div>}
          <div className="flex flex-col divide-y divide-line">
            {awaiting.map((pl) => {
              const p = proj(pl.projectId)
              const issues = planIssues(s, pl)
              const bad = issues.filter((i) => i.level === 'bad').length
              const wf = s.workflows.find((w) => w.id === pl.workflowInstanceId)
              return (
                <div key={pl.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(p.id, 'safety')}>{p.code}</a>
                    <b className="text-[13px]">{pl.workPackage} v{pl.version}</b>
                    <span className="text-xs text-muted">{pl.contractor}</span>
                    {bad ? <Badge tone="bad">{bad} blocking</Badge> : <Badge tone="good">Checks pass</Badge>}
                    {wf?.active[0] && <span className="text-xs text-muted">At {s.workflowDefs.find((d) => d.id === wf.defId)?.nodes.find((n) => n.id === wf.active[0].nodeId)?.label} · {wf.active[0].assigneeIds.map((id) => personName(s, id)).join(', ')}</span>}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpenWf(openWf === pl.id ? null : pl.id)}>{openWf === pl.id ? 'Hide' : 'Review'}</Button>
                  </div>
                  {openWf === pl.id && (
                    <div className="mt-2 flex flex-col gap-2">
                      {issues.length > 0 && <ul className="text-[13px]">{issues.map((x, i) => <li key={i} className="flex items-start gap-2"><span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.level === 'bad' ? 'bg-bad' : 'bg-warn')} />{x.text}</li>)}</ul>}
                      <WorkflowStatus instanceId={pl.workflowInstanceId} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      <Panel className="mt-4" title="Leading indicators by project" pad={false}>
        <Table rows={working} columns={projCols} rowKey={(p) => p.id} empty={<div className="p-4"><Empty title="No crews working" /></div>} />
      </Panel>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Expiring tickets & permits" subtitle="Expired or expiring within 7 days on live plans" pad={false}>
          {tickets.length === 0 ? <div className="p-4"><Empty title="All tickets current" /></div> : (
            <div className="scroll-x"><table className="tbl">
              <thead><tr><th>Project</th><th>Ticket</th><th>Number</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>{tickets.map(({ t, pl, st }) => (
                <tr key={t.id} className={st.level === 'bad' ? 'bg-bad/5' : ''}>
                  <td><a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(pl.projectId, 'safety')}>{proj(pl.projectId).code}</a> <span className="text-xs text-muted">{pl.workPackage}</span></td>
                  <td>{t.type}</td><td className="font-mono text-[12px]">{t.number}</td><td className="whitespace-nowrap">{fmtDate(t.expires)}</td>
                  <td><Badge tone={st.level === 'ok' ? 'neutral' : levelTone(st.level)}>{st.label}</Badge></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {!oqOn && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted"><Badge>Phase 2</Badge>Operator-qualification tracking (an operator-qualification provider feed) is not part of the pilot. Turn it on in Configuration → Modules.</div>
          )}
          {oqOn && crewOq.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="eyebrow mb-1.5">Operator qualifications expiring or expired</div>
              <ul className="flex flex-col gap-1 text-[13px]">{crewOq.slice(0, 10).map(({ c, pl }) => <li key={c.id + pl.id} className="flex flex-wrap items-center gap-2"><b>{c.name}</b><span className="text-xs text-muted">{c.role} · {c.company} · {proj(pl.projectId).code}</span><Badge tone={c.oqExpires < asOf ? 'bad' : 'warn'}>{c.oqExpires < asOf ? 'Expired' : 'Expires'} {fmtDate(c.oqExpires)}</Badge></li>)}</ul>
            </div>
          )}
        </Panel>

        <Panel title="Safety events" pad={false} actions={<Select id="ev-filter" className="w-[170px]" value={evFilter} onChange={(e) => setEvFilter(e.target.value as typeof evFilter)} options={[{ value: 'open', label: 'Open events' }, { value: 'sif', label: 'SIF potential' }, { value: 'all', label: 'All events' }]} />}>
          <EventsTable events={events} showProject />
        </Panel>
      </div>

      <Panel className="mt-4" title="Hazard library" subtitle={`${s.hazards.length} hazards by activity. Plans assemble controls from here; edits take effect for plans prepared after the effective date.`} pad={false}
        actions={<><Input id="hz-q" className="w-[220px]" placeholder="Search hazards" value={hzQ} onChange={(e) => setHzQ(e.target.value)} /><Button size="sm" onClick={() => setHazard({ id: uid('hz'), activity: '', hazard: '', controls: [{ type: 'administrative', text: '' }], permits: [], oqTasks: [], effective: asOf })}>New hazard</Button></>}>
        <Table rows={s.hazards.filter((h) => !hzQ || (h.activity + h.hazard + h.controls.map((c) => c.text).join(' ')).toLowerCase().includes(hzQ.toLowerCase()))} rowKey={(h) => h.id} onRowClick={(h) => setHazard(h)} maxHeight={480}
          columns={[
            { key: 'a', header: 'Activity', render: (h) => <span className="font-semibold">{h.activity}</span>, sort: (h) => h.activity },
            { key: 'h', header: 'Hazard', render: (h) => h.hazard, sort: (h) => h.hazard },
            { key: 'c', header: 'Controls', render: (h) => <span className="flex flex-wrap gap-1">{(['engineering', 'administrative', 'ppe'] as const).map((t) => { const n = h.controls.filter((c) => c.type === t).length; return n ? <Badge key={t} tone={t === 'engineering' ? 'good' : t === 'ppe' ? 'warn' : 'info'}>{n} {t === 'ppe' ? 'PPE' : t === 'engineering' ? 'eng.' : 'admin'}</Badge> : null })}</span> },
            { key: 'p', header: 'Permits', render: (h) => <span className="text-[12px]">{h.permits.join(', ') || '—'}</span> },
            ...(oqOn ? [{ key: 'o', header: 'OQ tasks', render: (h: HazardItem) => <span className="text-[12px]">{h.oqTasks.join(', ') || '—'}</span> }] : []),
            { key: 'u', header: 'In plans', num: true, render: (h) => s.safetyPlans.filter((x) => x.status !== 'superseded' && x.hazardIds.includes(h.id)).length },
            { key: 'e', header: 'Effective', render: (h) => <span className="whitespace-nowrap">{fmtDate(h.effective)}</span>, sort: (h) => h.effective },
          ]} />
      </Panel>

      <HazardDrawer hazard={hazard} onClose={() => setHazard(null)} />
    </div>
  )
}

function HazardDrawer({ hazard, onClose }: { hazard: HazardItem | null; onClose: () => void }) {
  const s = useStore()
  const [h, setH] = useState<HazardItem | null>(null)
  const [permits, setPermits] = useState('')
  const [oq, setOq] = useState('')
  useEffect(() => {
    setH(hazard ? JSON.parse(JSON.stringify(hazard)) : null)
    setPermits(hazard?.permits.join(', ') ?? '')
    setOq(hazard?.oqTasks.join(', ') ?? '')
  }, [hazard])
  if (!hazard || !h) return null
  const isNew = !s.hazards.some((x) => x.id === h.id)
  const used = s.safetyPlans.filter((x) => x.status !== 'superseded' && x.hazardIds.includes(h.id))
  const save = () => {
    if (!h.activity.trim() || !h.hazard.trim()) { toast('Activity and hazard are required.', 'bad'); return }
    const next: HazardItem = { ...h, controls: h.controls.filter((c) => c.text.trim()), permits: permits.split(',').map((x) => x.trim()).filter(Boolean), oqTasks: oq.split(',').map((x) => x.trim()).filter(Boolean) }
    if (!next.controls.length) { toast('Add at least one control.', 'bad'); return }
    mutate((d) => { const i = d.hazards.findIndex((x) => x.id === next.id); if (i >= 0) d.hazards[i] = next; else d.hazards.push(next) },
      { entity: 'hazard', entityId: next.id, action: isNew ? 'create' : 'update', summary: `${isNew ? 'Added' : 'Updated'} hazard library: ${next.activity} / ${next.hazard} (effective ${next.effective})` })
    toast(isNew ? 'Hazard added to library' : 'Hazard library updated')
    onClose()
  }
  return (
    <Drawer open onClose={onClose} width={640} title={isNew ? 'New hazard' : `${h.activity} · ${h.hazard}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{isNew ? 'Add hazard' : 'Save changes'}</Button></>}>
      <div className="flex flex-col gap-3">
        {!isNew && used.length > 0 && <Callout tone="info">Used by {used.length} live plan{used.length > 1 ? 's' : ''}. Approved plans keep the controls they were approved with; new and revised plans pick up this change from the effective date.</Callout>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_150px]">
          <Field label="Activity"><Input value={h.activity} onChange={(e) => setH({ ...h, activity: e.target.value })} /></Field>
          <Field label="Hazard"><Input value={h.hazard} onChange={(e) => setH({ ...h, hazard: e.target.value })} /></Field>
          <Field label="Effective date"><Input type="date" value={h.effective} onChange={(e) => setH({ ...h, effective: e.target.value })} /></Field>
        </div>
        <div className="eyebrow mt-1">Controls (hierarchy: engineering → administrative → PPE)</div>
        {h.controls.map((c, i) => (
          <div key={i} className="grid grid-cols-[140px_1fr_auto] gap-2">
            <Select value={c.type} onChange={(e) => setH({ ...h, controls: h.controls.map((x, j) => (j === i ? { ...x, type: e.target.value as ControlType } : x)) })} options={[{ value: 'engineering', label: 'Engineering' }, { value: 'administrative', label: 'Administrative' }, { value: 'ppe', label: 'PPE' }]} />
            <TextArea className="min-h-[36px]" value={c.text} onChange={(e) => setH({ ...h, controls: h.controls.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <Button size="sm" variant="ghost" onClick={() => setH({ ...h, controls: h.controls.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        <div><Button size="sm" onClick={() => setH({ ...h, controls: [...h.controls, { type: 'administrative', text: '' }] })}>Add control</Button></div>
        <Field label="Required permits" hint="Comma-separated, e.g. Hot work permit, Excavation permit"><Input value={permits} onChange={(e) => setPermits(e.target.value)} /></Field>
        {opQualOn(s) && <Field label="Covered tasks (operator qualification)" hint="Comma-separated; crews are checked against these"><Input value={oq} onChange={(e) => setOq(e.target.value)} /></Field>}
      </div>
    </Drawer>
  )
}
