// Safety event log and entry form (SF-09), shared by the project tab, Safety home and field mode.
import { useState } from 'react'
import type { SafetyEvent } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { addDays, fmtDate, uid } from '@/core/util'
import { Badge, Button, Checkbox, Empty, Field, Input, Modal, SegButtons, StatusBadge, Table, TextArea, type Column } from '@/ui/kit'
import { toast } from '@/ui/toast'

/** Record a safety event; SIF-potential and incidents notify the safety advisor and create a PM corrective action. */
export function logEvent(e: Omit<SafetyEvent, 'id'>): string {
  const id = uid('se')
  mutate((d) => {
    d.safetyEvents.push({ ...e, id })
    if (e.sifPotential || e.type === 'incident') {
      const p = d.projects.find((x) => x.id === e.projectId)
      if (p) {
        p.health.safety = e.type === 'incident' && e.sifPotential ? 'red' : 'amber'
        if (p.team.safety) d.notifications.push({ id: uid('ntf'), at: new Date().toISOString(), toId: p.team.safety, text: `${p.code}: ${e.type}${e.sifPotential ? ' with SIF potential' : ''} — ${e.description}`, link: `#p-${p.id.replace(/\D/g, '')}-safety`, read: false })
        if (p.team.pm && e.status === 'open') d.actions.push({ id: uid('act'), projectId: e.projectId, title: `Corrective action: ${e.description.slice(0, 60)}`, ownerId: p.team.pm, due: addDays(d.settings.asOf, 7), status: 'open', source: 'safety', sourceId: id })
      }
    }
  }, { entity: 'safety-event', entityId: id, projectId: e.projectId, action: 'create', summary: `Logged ${e.type}${e.sifPotential ? ' (SIF potential)' : ''}: ${e.description}` })
  return id
}

export function EventsTable({ events, showProject }: { events: SafetyEvent[]; showProject?: boolean }) {
  const s = useStore()
  const close = (e: SafetyEvent) => mutate((d) => { const x = d.safetyEvents.find((y) => y.id === e.id); if (x) x.status = 'closed' }, { entity: 'safety-event', entityId: e.id, projectId: e.projectId, action: 'close', summary: `Closed ${e.type}: ${e.description}` })
  const cols: Column<SafetyEvent>[] = [
    { key: 'date', header: 'Date', render: (e) => <span className="whitespace-nowrap">{fmtDate(e.date)}</span>, sort: (e) => e.date },
    ...(showProject ? [{ key: 'p', header: 'Project', render: (e: SafetyEvent) => <a className="font-mono text-[12px] font-semibold text-link hover:underline" href={`#p-${e.projectId.replace(/\D/g, '')}-safety`}>{s.projects.find((p) => p.id === e.projectId)?.code}</a> }] : []),
    { key: 'type', header: 'Type', render: (e) => <Badge tone={e.type === 'incident' ? 'bad' : e.type === 'near-miss' ? 'warn' : 'neutral'}>{e.type === 'near-miss' ? 'Near miss' : e.type === 'incident' ? 'Incident' : 'Observation'}</Badge>, sort: (e) => e.type },
    { key: 'desc', header: 'What happened', render: (e) => <div className="min-w-[200px]"><div>{e.description}</div><div className="text-xs text-muted">{e.correctiveAction}</div></div> },
    { key: 'sif', header: 'SIF', render: (e) => (e.sifPotential ? <Badge tone="bad">SIF potential</Badge> : <span className="text-faint">—</span>), sort: (e) => (e.sifPotential ? 1 : 0) },
    { key: 'st', header: 'Status', render: (e) => (e.status === 'open' ? <span className="inline-flex items-center gap-1.5"><StatusBadge status="open" /><Button size="sm" variant="ghost" onClick={() => { close(e); toast('Event closed') }}>Close</Button></span> : <StatusBadge status="closed" />), sort: (e) => e.status },
  ]
  return <Table rows={events} columns={cols} rowKey={(e) => e.id} maxHeight={360} dense empty={<div className="p-4"><Empty title="No events logged">Observations, near misses and incidents appear here.</Empty></div>} />
}

export function EventModal({ open, onClose, projectId, planId, contractor }: { open: boolean; onClose: () => void; projectId: string; planId?: string; contractor?: string }) {
  const asOf = useStore((s) => s.settings.asOf)
  const [type, setType] = useState<SafetyEvent['type']>('observation')
  const [date, setDate] = useState(asOf)
  const [desc, setDesc] = useState('')
  const [ca, setCa] = useState('')
  const [sif, setSif] = useState(false)
  const [closed, setClosed] = useState(false)
  const save = () => {
    if (!desc.trim()) { toast('Describe what happened.', 'bad'); return }
    logEvent({ projectId, planId, date, type, description: desc.trim(), sifPotential: sif, correctiveAction: ca.trim() || 'Corrective action to be assigned', status: closed ? 'closed' : 'open', contractor })
    toast(sif ? 'Event logged; safety advisor notified' : 'Event logged')
    setDesc(''); setCa(''); setSif(false); setClosed(false); setType('observation'); setDate(asOf)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Log safety event" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Log event</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Type"><SegButtons options={[{ id: 'observation', label: 'Observation' }, { id: 'near-miss', label: 'Near miss' }, { id: 'incident', label: 'Incident' }]} value={type} onChange={setType} /></Field>
          <Field label="Date"><Input type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="What happened"><TextArea id="ev-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Excavator swing radius not barricaded near sidewalk" /></Field>
        <Field label="Corrective action"><TextArea value={ca} onChange={(e) => setCa(e.target.value)} placeholder="What was done, or what must be done and by whom" /></Field>
        <Checkbox checked={sif} onChange={setSif} label={<span><b>Serious injury or fatality (SIF) potential</b><span className="block text-xs text-muted">Could this have resulted in a life-altering injury or fatality? SIF-potential events notify the safety advisor and create a corrective action for the PM.</span></span>} />
        <Checkbox checked={closed} onChange={setClosed} label="Corrected on site — close now" />
      </div>
    </Modal>
  )
}

