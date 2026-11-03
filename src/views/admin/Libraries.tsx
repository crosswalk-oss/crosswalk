// Risk library and hazard library CRUD.
import { useMemo, useState } from 'react'
import type { ControlType, HazardItem, RiskLibraryItem, WorkMethod } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { uid } from '@/core/util'
import { Badge, Button, ConfirmButton, Drawer, Field, Input, Panel, Select, SegButtons, Table, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { MultiCheck, WORK_METHODS, humanizeId, useDraft } from './common'

export default function Libraries() {
  const [lib, setLib] = useState<'risk' | 'hazard'>('risk')
  return (
    <div className="flex flex-col gap-3">
      <SegButtons options={[{ id: 'risk', label: 'Risk library' }, { id: 'hazard', label: 'Hazard & control library' }]} value={lib} onChange={setLib} />
      {lib === 'risk' ? <RiskLib /> : <HazardLib />}
    </div>
  )
}

function RiskLib() {
  const items = useStore((s) => s.riskLibrary)
  const risks = useStore((s) => s.risks)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ it: RiskLibraryItem; isNew: boolean } | null>(null)
  const uses = useMemo(() => { const o: Record<string, number> = {}; for (const r of risks) if (r.libraryId) o[r.libraryId] = (o[r.libraryId] || 0) + 1; return o }, [risks])
  const rows = items.filter((x) => !q || (x.title + x.category + x.cause).toLowerCase().includes(q.toLowerCase()))
  return (
    <Panel title="Risk library" subtitle="Standard risks suggested when a project's work method matches. Typical impact seeds the three-point estimate." pad={false}
      actions={<><Input className="h-7 w-48 py-0.5" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} /><Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, it: { id: uid('rl'), title: '', category: 'Technical', cause: '', event: '', effect: '', appliesTo: [], typicalCostPct: 2, typicalDays: 20 } })}>Add risk</Button></>}>
      <Table rows={rows} rowKey={(r) => r.id} onRowClick={(it) => setEdit({ it, isNew: false })} columns={[
        { key: 't', header: 'Risk', sort: (r) => r.title, render: (r) => <div className="min-w-[200px]"><b>{r.title}</b><div className="text-[12px] text-muted">{r.event}</div></div> },
        { key: 'c', header: 'Category', sort: (r) => r.category, render: (r) => <Badge>{r.category}</Badge> },
        { key: 'a', header: 'Applies to', render: (r) => <span className="text-[12px] text-muted">{r.appliesTo.map(humanizeId).join(', ')}</span> },
        { key: 'p', header: 'Typical cost', num: true, sort: (r) => r.typicalCostPct, render: (r) => <span className={r.typicalCostPct < 0 ? 'text-good' : ''}>{r.typicalCostPct > 0 ? '+' : ''}{r.typicalCostPct}%</span> },
        { key: 'd', header: 'Typical days', num: true, sort: (r) => r.typicalDays, render: (r) => r.typicalDays },
        { key: 'u', header: 'Used on', num: true, sort: (r) => uses[r.id] || 0, render: (r) => uses[r.id] || '—' },
      ]} />
      <RiskDrawer edit={edit} used={edit ? uses[edit.it.id] || 0 : 0} onClose={() => setEdit(null)} />
    </Panel>
  )
}

function RiskDrawer({ edit, used, onClose }: { edit: { it: RiskLibraryItem; isNew: boolean } | null; used: number; onClose: () => void }) {
  const [it, setIt] = useDraft<RiskLibraryItem | null>(edit?.it ?? null)
  if (!edit || !it) return null
  const save = () => {
    if (!it.title.trim()) { toast('Title is required', 'bad'); return }
    mutate((d) => { const i = d.riskLibrary.findIndex((x) => x.id === it.id); if (i >= 0) d.riskLibrary[i] = it; else d.riskLibrary.push(it) },
      { entity: 'risk-library', entityId: it.id, action: edit.isNew ? 'create' : 'update', summary: `${edit.isNew ? 'Added' : 'Updated'} library risk "${it.title}"` })
    toast(edit.isNew ? 'Library risk added' : 'Library risk saved'); onClose()
  }
  const remove = () => {
    mutate((d) => { d.riskLibrary = d.riskLibrary.filter((x) => x.id !== it.id) }, { entity: 'risk-library', entityId: it.id, action: 'delete', summary: `Retired library risk "${it.title}"${used ? ` (project risks keep their copy)` : ''}` })
    toast('Library risk retired'); onClose()
  }
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add library risk' : 'Edit library risk'} width={580}
      footer={<>{!edit.isNew && <ConfirmButton confirmLabel="Retire risk" onConfirm={remove}>Retire</ConfirmButton>}<span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Title"><Input value={it.title} onChange={(e) => setIt({ ...it, title: e.target.value })} /></Field>
          <Field label="Category"><Input value={it.category} onChange={(e) => setIt({ ...it, category: e.target.value })} /></Field>
        </div>
        <Field label="Cause"><TextArea rows={2} value={it.cause} onChange={(e) => setIt({ ...it, cause: e.target.value })} /></Field>
        <Field label="Event"><TextArea rows={2} value={it.event} onChange={(e) => setIt({ ...it, event: e.target.value })} /></Field>
        <Field label="Effect"><TextArea rows={2} value={it.effect} onChange={(e) => setIt({ ...it, effect: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Typical cost impact (% of base)" hint="Negative for opportunities"><Input type="number" step="0.5" value={it.typicalCostPct} onChange={(e) => setIt({ ...it, typicalCostPct: Number(e.target.value) })} /></Field>
          <Field label="Typical schedule impact (days)"><Input type="number" value={it.typicalDays} onChange={(e) => setIt({ ...it, typicalDays: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Suggest for work methods"><MultiCheck options={WORK_METHODS.map((w) => ({ id: w, label: humanizeId(w) }))} value={it.appliesTo} onChange={(v) => setIt({ ...it, appliesTo: v as WorkMethod[] })} /></Field>
        {used > 0 && <p className="text-[12px] text-muted">Used on {used} project risk{used > 1 ? 's' : ''}. Edits apply to future suggestions; existing project risks are not changed.</p>}
      </div>
    </Drawer>
  )
}

function HazardLib() {
  const items = useStore((s) => s.hazards)
  const plans = useStore((s) => s.safetyPlans)
  const [act, setAct] = useState('')
  const [edit, setEdit] = useState<{ it: HazardItem; isNew: boolean } | null>(null)
  const activities = Array.from(new Set(items.map((h) => h.activity)))
  const uses = useMemo(() => { const o: Record<string, number> = {}; for (const p of plans) if (p.status !== 'superseded') for (const h of p.hazardIds) o[h] = (o[h] || 0) + 1; return o }, [plans])
  const rows = items.filter((h) => !act || h.activity === act)
  return (
    <Panel title="Hazard & control library" subtitle="Activity → hazard → controls (hierarchy of controls), required permits and OQ tasks. Safety plans pull from this library." pad={false}
      actions={<><Select className="h-7 w-48 py-0.5" value={act} onChange={(e) => setAct(e.target.value)} options={[{ value: '', label: 'All activities' }, ...activities]} /><Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, it: { id: uid('hz'), activity: act || 'Excavation', hazard: '', controls: [{ type: 'engineering', text: '' }], permits: [], oqTasks: [], effective: useStore.getState().settings.asOf } })}>Add hazard</Button></>}>
      <Table rows={rows} rowKey={(r) => r.id} onRowClick={(it) => setEdit({ it, isNew: false })} columns={[
        { key: 'a', header: 'Activity', sort: (r) => r.activity, render: (r) => <span className="whitespace-nowrap font-semibold">{r.activity}</span> },
        { key: 'h', header: 'Hazard', sort: (r) => r.hazard, render: (r) => r.hazard },
        { key: 'c', header: 'Controls', render: (r) => <ul className="min-w-[260px] text-[12px]">{r.controls.map((c, i) => <li key={i}><Badge tone={c.type === 'engineering' ? 'good' : c.type === 'administrative' ? 'info' : 'neutral'}>{c.type === 'ppe' ? 'PPE' : c.type.slice(0, 5)}</Badge> {c.text}</li>)}</ul> },
        { key: 'p', header: 'Permits / OQ', render: (r) => <span className="text-[12px] text-muted">{[...r.permits, ...r.oqTasks.map((o) => 'OQ: ' + o)].join(' · ') || '—'}</span> },
        { key: 'u', header: 'Active plans', num: true, sort: (r) => uses[r.id] || 0, render: (r) => uses[r.id] || '—' },
      ]} />
      <HazardDrawer edit={edit} onClose={() => setEdit(null)} />
    </Panel>
  )
}

function HazardDrawer({ edit, onClose }: { edit: { it: HazardItem; isNew: boolean } | null; onClose: () => void }) {
  const [it, setIt] = useDraft<HazardItem | null>(edit?.it ?? null)
  if (!edit || !it) return null
  const save = () => {
    if (!it.hazard.trim()) { toast('Hazard is required', 'bad'); return }
    const clean = { ...it, controls: it.controls.filter((c) => c.text.trim()), effective: useStore.getState().settings.asOf }
    mutate((d) => { const i = d.hazards.findIndex((x) => x.id === it.id); if (i >= 0) d.hazards[i] = clean; else d.hazards.push(clean) },
      { entity: 'hazard-library', entityId: it.id, action: edit.isNew ? 'create' : 'update', summary: `${edit.isNew ? 'Added' : 'Updated'} hazard "${it.activity}: ${it.hazard}" (${clean.controls.length} controls)` })
    toast(edit.isNew ? 'Hazard added' : 'Hazard saved'); onClose()
  }
  const remove = () => {
    mutate((d) => { d.hazards = d.hazards.filter((x) => x.id !== it.id) }, { entity: 'hazard-library', entityId: it.id, action: 'delete', summary: `Retired hazard "${it.activity}: ${it.hazard}"` })
    toast('Hazard retired'); onClose()
  }
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add hazard' : 'Edit hazard'} width={600}
      footer={<>{!edit.isNew && <ConfirmButton confirmLabel="Retire hazard" onConfirm={remove}>Retire</ConfirmButton>}<span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Activity"><Input value={it.activity} onChange={(e) => setIt({ ...it, activity: e.target.value })} /></Field>
          <Field label="Hazard"><Input value={it.hazard} onChange={(e) => setIt({ ...it, hazard: e.target.value })} /></Field>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[12px] font-semibold text-muted">Controls</span><Button size="sm" onClick={() => setIt({ ...it, controls: [...it.controls, { type: 'administrative', text: '' }] })}>Add control</Button></div>
          {it.controls.map((c, i) => (
            <div key={i} className="grid grid-cols-[140px_1fr_auto] gap-2">
              <Select value={c.type} onChange={(e) => setIt({ ...it, controls: it.controls.map((x, j) => (j === i ? { ...x, type: e.target.value as ControlType } : x)) })} options={[{ value: 'engineering', label: 'Engineering' }, { value: 'administrative', label: 'Administrative' }, { value: 'ppe', label: 'PPE' }]} />
              <Input value={c.text} onChange={(e) => setIt({ ...it, controls: it.controls.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" className="text-bad" onClick={() => setIt({ ...it, controls: it.controls.filter((_, j) => j !== i) })}>✕</Button>
            </div>
          ))}
        </div>
        <Field label="Required permits" hint="Comma-separated"><Input value={it.permits.join(', ')} onChange={(e) => setIt({ ...it, permits: list(e.target.value) })} /></Field>
        <Field label="Operator qualification tasks" hint="Comma-separated"><Input value={it.oqTasks.join(', ')} onChange={(e) => setIt({ ...it, oqTasks: list(e.target.value) })} /></Field>
        <p className="text-[12px] text-muted">Saving stamps a new effective date. Approved safety plans keep the controls they were approved with; new and revised plans use the current library.</p>
      </div>
    </Drawer>
  )
}
