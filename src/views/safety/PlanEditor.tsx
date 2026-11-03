// Job-specific safety plan builder (SF-01 … SF-07, SF-11): activities → hazards & controls from the library,
// site-specific controls, permits/tickets, emergency info, crew OQ and prequalification.
import { useEffect, useState } from 'react'
import type { SafetyPlan, TicketType } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { askJSON, aiMessage, useAiAvailable } from '@/core/ai'
import { addDays, uid, cx } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, Drawer, Field, Input, Select, Tabs, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { levelTone, opQualOn, oqCoverage, oqLevel, planHazards, planIssues, requiredPermits, ticketLevel } from './lib'

const TICKET_TYPES: TicketType[] = ['811 locate', 'Excavation permit', 'Encroachment permit', 'Hot work permit', 'Confined space permit', 'Lift plan']
const CTRL_LABEL = { engineering: 'Engineering', administrative: 'Admin', ppe: 'PPE' } as const

type Tab = 'hazards' | 'site' | 'tickets' | 'crew'

export function PlanEditor({ plan, open, onClose }: { plan: SafetyPlan | null; open: boolean; onClose: () => void }) {
  const s = useStore()
  const [d, setD] = useState<SafetyPlan | null>(plan)
  const [tab, setTab] = useState<Tab>('hazards')
  const [newCtl, setNewCtl] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<{ key: string; hazardId: string; text: string; why: string }[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const aiOk = useAiAvailable()
  useEffect(() => { setD(plan ? JSON.parse(JSON.stringify(plan)) : null); setTab('hazards'); setAi([]); setNewCtl({}) }, [plan, open])
  if (!d) return null
  const p = s.projects.find((x) => x.id === d.projectId)!
  const asOf = s.settings.asOf
  const oqOn = opQualOn(s)
  const activities = Array.from(new Set(s.hazards.map((h) => h.activity)))
  const allOq = Array.from(new Set(s.hazards.flatMap((h) => h.oqTasks)))
  const hz = planHazards(s, d)
  const set = <K extends keyof SafetyPlan>(k: K, v: SafetyPlan[K]) => setD({ ...d, [k]: v })
  const toggleAct = (a: string, on: boolean) => {
    const acts = on ? [...d.activities, a] : d.activities.filter((x) => x !== a)
    const ids = s.hazards.filter((h) => acts.includes(h.activity)).map((h) => h.id)
    setD({ ...d, activities: acts, hazardIds: ids, extraControls: d.extraControls.filter((x) => ids.includes(x.hazardId)) })
  }
  const addCtl = (hazardId: string, text: string) => { if (!text.trim()) return; setD((x) => x && ({ ...x, extraControls: [...x.extraControls, { hazardId, text: text.trim() }] })); setNewCtl((m) => ({ ...m, [hazardId]: '' })) }
  const issues = planIssues(s, d)
  const save = () => {
    mutate((dr) => { const i = dr.safetyPlans.findIndex((x) => x.id === d.id); if (i >= 0) dr.safetyPlans[i] = d; else dr.safetyPlans.push(d) },
      { entity: 'safety-plan', entityId: d.id, projectId: d.projectId, action: 'update', summary: `Saved JSSP ${d.workPackage} v${d.version} draft (${d.activities.length} activities, ${d.hazardIds.length} hazards, ${d.crew.length} crew)` })
    toast('Safety plan draft saved')
    onClose()
  }
  const draft = async () => {
    setAiBusy(true)
    const prompt = `You are a gas utility construction safety advisor reviewing a contractor's job-specific safety plan (fictional demo data). Propose ADDITIONAL site-specific controls that the standard hazard library does not already cover.

Project: ${p.code} ${p.name}
Scope: ${p.scope.summary}
Location: ${d.site.address || p.location.city}; ${p.location.terrain}; class location ${p.location.classLocation}; HCA ${p.location.hca ? 'yes' : 'no'}; assumptions: ${p.scope.assumptions.join('; ')}
Asset: ${p.asset.diameterIn}" ${p.asset.material}, MAOP ${p.asset.maopPsig} psig, vintage ${p.asset.vintage}
Contractor: ${d.contractor}; crew of ${d.crew.length}
Activities: ${d.activities.join(', ')}
Hazards with existing library controls:
${hz.map((h) => `- [${h.id}] ${h.activity} / ${h.hazard}: ${h.controls.map((c) => c.text).join('; ')}`).join('\n')}
Already-added site-specific controls: ${d.extraControls.map((x) => x.text).join('; ') || 'none'}

Return JSON exactly: {"controls":[{"hazardId": one of the ids in brackets above, "text": one concrete, verifiable control a foreman can check (max 25 words), "why": one short sentence tying it to this site}]}. Give 4 to 7 controls. Do not repeat existing controls.`
    try {
      const r = await askJSON<{ controls: { hazardId: string; text: string; why: string }[] }>(prompt)
      const ok = (r.controls ?? []).filter((c) => d.hazardIds.includes(c.hazardId) && c.text)
      setAi(ok.map((c) => ({ ...c, key: uid('aic') })))
      if (!ok.length) toast('No new controls proposed', 'info')
    } catch (e) { toast(aiMessage(e), 'bad') } finally { setAiBusy(false) }
  }
  const counts = { hazards: d.hazardIds.length, tickets: d.tickets.length, crew: d.crew.length }
  return (
    <Drawer open={open} onClose={onClose} width={860}
      title={<span className="flex flex-wrap items-center gap-2">JSSP · {d.workPackage} <Badge tone="ink">v{d.version}</Badge><Badge>Draft</Badge></span>}
      footer={<><span className="mr-auto self-center text-xs text-muted">{issues.filter((i) => i.level === 'bad').length} blocking item(s) · {issues.filter((i) => i.level === 'warn').length} warning(s)</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save draft</Button></>}>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Work package"><Input value={d.workPackage} onChange={(e) => set('workPackage', e.target.value)} /></Field>
        <Field label="Contractor"><Input value={d.contractor} onChange={(e) => set('contractor', e.target.value)} /></Field>
        <div className="flex flex-col justify-end gap-1.5 pb-1">
          <Checkbox checked={d.heatPlan} onChange={(v) => set('heatPlan', v)} label="Heat illness prevention plan" />
          <Checkbox checked={d.trafficPlan} onChange={(v) => set('trafficPlan', v)} label="Traffic control plan" />
        </div>
      </div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'hazards', label: 'Activities & hazards', count: counts.hazards }, { id: 'site', label: 'Site & emergency' }, { id: 'tickets', label: 'Tickets & permits', count: counts.tickets }, { id: 'crew', label: oqOn ? 'Crew & OQ' : 'Crew', count: counts.crew }]} />

      {tab === 'hazards' && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="eyebrow mb-2">Work activities</div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
              {activities.map((a) => <label key={a} className={cx('flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-[13px] font-semibold', d.activities.includes(a) ? 'border-ink bg-ink/5' : 'border-line')}><input type="checkbox" className="h-4 w-4" checked={d.activities.includes(a)} onChange={(e) => toggleAct(a, e.target.checked)} />{a}</label>)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Required permits from hazards</span>
            {requiredPermits(s, d).map((x) => <Badge key={x} tone={d.tickets.some((t) => t.type === x) ? 'good' : 'warn'}>{x}{d.tickets.some((t) => t.type === x) ? '' : ' — not listed'}</Badge>)}
            {!requiredPermits(s, d).length && <span className="text-xs text-faint">None</span>}
          </div>
          {aiOk !== false && (
            <div className="rounded-md border border-info/40 bg-info/5 p-3">
              <div className="flex flex-wrap items-center gap-2"><AiTag>AI assist</AiTag><span className="text-[13px] font-semibold">Site-specific controls</span><span className="text-xs text-muted">AI assist reads scope, location and activities and proposes controls beyond the library. You accept each one.</span><Button size="sm" className="ml-auto" disabled={aiBusy || !d.hazardIds.length || aiOk === null} onClick={draft}>{aiBusy ? 'Thinking…' : ai.length ? 'Propose again' : 'Propose controls'}</Button></div>
              {ai.length > 0 && <div className="mt-2 flex flex-col divide-y divide-info/20">{ai.map((c) => { const h = s.hazards.find((x) => x.id === c.hazardId); return (
                <div key={c.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><AiTag /><span className="text-xs font-semibold text-muted">{h?.activity} · {h?.hazard}</span></div><div className="text-[13px]">{c.text}</div><div className="text-xs italic text-faint">{c.why}</div></div>
                  <div className="flex shrink-0 gap-1"><Button size="sm" variant="primary" onClick={() => { addCtl(c.hazardId, c.text); setAi(ai.filter((x) => x.key !== c.key)); toast('Control added to the plan') }}>Accept</Button><Button size="sm" variant="ghost" onClick={() => setAi(ai.filter((x) => x.key !== c.key))}>Dismiss</Button></div>
                </div>) })}</div>}
            </div>
          )}
          {hz.length === 0 && <Callout tone="warn">Choose the work activities. Hazards, controls, permits and OQ requirements come from the hazard library (version {d.libraryVersion}).</Callout>}
          {hz.map((h) => (
            <div key={h.id} className="rounded-md border border-line">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken px-3 py-2"><span className="text-xs font-bold uppercase tracking-wide text-muted">{h.activity}</span><b className="text-[13px]">{h.hazard}</b>{h.permits.map((x) => <Badge key={x} tone="info">{x}</Badge>)}{oqOn && h.oqTasks.map((x) => <Badge key={x}>OQ: {x}</Badge>)}</div>
              <ul className="flex flex-col gap-1 px-3 py-2 text-[13px]">
                {h.controls.map((c, i) => <li key={i} className="flex gap-2"><span className="w-[84px] shrink-0 text-[11px] font-bold uppercase text-faint">{CTRL_LABEL[c.type]}</span>{c.text}</li>)}
                {d.extraControls.map((x, i) => ({ x, i })).filter(({ x }) => x.hazardId === h.id).map(({ x, i }) => <li key={'x' + i} className="flex gap-2"><span className="w-[84px] shrink-0 text-[11px] font-bold uppercase text-ink">Site</span><span className="flex-1">{x.text}</span><button className="text-xs text-muted hover:text-bad" onClick={() => set('extraControls', d.extraControls.filter((_, j) => j !== i))}>Remove</button></li>)}
              </ul>
              <div className="flex gap-2 border-t border-line/60 px-3 py-2"><Input placeholder="Add a site-specific control" value={newCtl[h.id] ?? ''} onChange={(e) => setNewCtl({ ...newCtl, [h.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addCtl(h.id, newCtl[h.id] ?? '') }} /><Button size="sm" onClick={() => addCtl(h.id, newCtl[h.id] ?? '')}>Add</Button></div>
            </div>
          ))}
        </div>
      )}

      {tab === 'site' && (
        <div className="flex flex-col gap-3">
          <Field label="Site address / limits of work"><Input value={d.site.address} onChange={(e) => set('site', { ...d.site, address: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Nearest hospital"><Input value={d.site.hospital} onChange={(e) => set('site', { ...d.site, hospital: e.target.value })} /></Field>
            <Field label="Muster point"><Input value={d.site.musterPoint} onChange={(e) => set('site', { ...d.site, musterPoint: e.target.value })} /></Field>
          </div>
          <Field label="Route to hospital"><TextArea value={d.site.hospitalRoute} onChange={(e) => set('site', { ...d.site, hospitalRoute: e.target.value })} /></Field>
          <div className="eyebrow mt-2">Emergency contacts</div>
          {d.site.contacts.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <Input value={c.name} placeholder="Name" onChange={(e) => set('site', { ...d.site, contacts: d.site.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input value={c.role} placeholder="Role" onChange={(e) => set('site', { ...d.site, contacts: d.site.contacts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
              <Input value={c.phone} placeholder="Phone" onChange={(e) => set('site', { ...d.site, contacts: d.site.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" onClick={() => set('site', { ...d.site, contacts: d.site.contacts.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
          ))}
          <div><Button size="sm" onClick={() => set('site', { ...d.site, contacts: [...d.site.contacts, { name: '', role: '', phone: '' }] })}>Add contact</Button></div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">811 locate tickets, permits and lift plans with their expiry. Expired tickets block work; tickets within 3 days of expiry are flagged.</p>
          {d.tickets.map((t, i) => { const st = ticketLevel(t.expires, asOf); return (
            <div key={t.id} className={cx('grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[180px_1fr_150px_auto] sm:items-end', st.level === 'bad' ? 'border-bad/60 bg-bad/5' : st.level === 'warn' ? 'border-warn/60 bg-warn/5' : 'border-line')}>
              <Field label="Type"><Select value={t.type} onChange={(e) => set('tickets', d.tickets.map((x, j) => (j === i ? { ...x, type: e.target.value as TicketType } : x)))} options={TICKET_TYPES} /></Field>
              <Field label="Number"><Input value={t.number} onChange={(e) => set('tickets', d.tickets.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} /></Field>
              <Field label="Expires"><Input type="date" value={t.expires} onChange={(e) => set('tickets', d.tickets.map((x, j) => (j === i ? { ...x, expires: e.target.value } : x)))} /></Field>
              <div className="flex items-center gap-2 pb-1"><Badge tone={levelTone(st.level)}>{st.label}</Badge><Button size="sm" variant="ghost" onClick={() => set('tickets', d.tickets.filter((_, j) => j !== i))}>Remove</Button></div>
            </div>) })}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => set('tickets', [...d.tickets, { id: uid('tk'), type: '811 locate', number: '', expires: addDays(asOf, 28) }])}>Add ticket</Button>
            {requiredPermits(s, d).filter((x) => TICKET_TYPES.includes(x as TicketType) && !d.tickets.some((t) => t.type === x)).map((x) => <Button key={x} size="sm" variant="ghost" onClick={() => set('tickets', [...d.tickets, { id: uid('tk'), type: x as TicketType, number: '', expires: addDays(asOf, 14) }])}>+ {x}</Button>)}
          </div>
        </div>
      )}

      {tab === 'crew' && (
        <div className="flex flex-col gap-3">
          {!oqOn && <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-muted"><Badge>Phase 2</Badge>Operator-qualification checks (an operator-qualification provider feed) are not part of the pilot; crew and prequalification are still checked.</div>}
          {oqOn && <div className="rounded-md border border-line">
            <div className="border-b border-line bg-sunken px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">Covered tasks required by this plan's hazards</div>
            <div className="flex flex-wrap gap-2 p-3">
              {oqCoverage(s, d, asOf).map((c) => <Badge key={c.task} tone={c.valid.length ? 'good' : 'bad'}>{c.task}: {c.valid.length ? `${c.valid.length} qualified` : 'no current OQ'}</Badge>)}
              {!oqCoverage(s, d, asOf).length && <span className="text-xs text-faint">No covered tasks for these activities.</span>}
            </div>
          </div>}
          {d.crew.map((c, i) => { const oq = oqLevel(c.oqExpires, asOf); const upd = (patch: Partial<SafetyPlan['crew'][number]>) => set('crew', d.crew.map((x, j) => (j === i ? { ...x, ...patch } : x))); return (
            <div key={c.id} className="rounded-md border border-line p-2.5">
              <div className={cx('grid grid-cols-2 gap-2', oqOn ? 'md:grid-cols-[1fr_1fr_1fr_150px_150px]' : 'md:grid-cols-[1fr_1fr_1fr_150px]')}>
                <Field label="Name"><Input value={c.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="Company"><Input value={c.company} onChange={(e) => upd({ company: e.target.value })} /></Field>
                <Field label="Role"><Input value={c.role} onChange={(e) => upd({ role: e.target.value })} /></Field>
                {oqOn && <Field label="OQ expires"><Input type="date" value={c.oqExpires} onChange={(e) => upd({ oqExpires: e.target.value })} className={oq.level === 'bad' ? 'border-bad' : ''} /></Field>}
                <Field label="Prequal (ISNetworld)"><Select value={c.prequal} onChange={(e) => upd({ prequal: e.target.value as SafetyPlan['crew'][number]['prequal'] })} options={['Compliant', 'Conditional', 'Non-compliant']} /></Field>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {oqOn && <span className="text-[11px] font-semibold uppercase text-faint">OQ tasks</span>}
                {oqOn && allOq.map((t) => <Checkbox key={t} checked={c.oqTasks.includes(t)} onChange={(v) => upd({ oqTasks: v ? [...c.oqTasks, t] : c.oqTasks.filter((x) => x !== t) })} label={<span className="text-[12px]">{t}</span>} />)}
                {oqOn && <Badge tone={levelTone(oq.level)}>{oq.label}</Badge>}
                <button className="ml-auto text-xs text-muted hover:text-bad" onClick={() => set('crew', d.crew.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>) })}
          <div><Button size="sm" onClick={() => set('crew', [...d.crew, { id: uid('crw'), name: '', company: d.contractor, role: 'Laborer', oqTasks: [], oqExpires: addDays(asOf, 365), prequal: 'Compliant' }])}>Add crew member</Button></div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-5 rounded-md border border-line">
          <div className="border-b border-line bg-sunken px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">Pre-mobilization check</div>
          <ul className="flex flex-col gap-1 p-3 text-[13px]">{issues.map((x, i) => <li key={i} className="flex items-start gap-2"><span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.level === 'bad' ? 'bg-bad' : 'bg-warn')} />{x.text}</li>)}</ul>
        </div>
      )}
    </Drawer>
  )
}
