// Schedule (or reschedule) a gate review board date for a project's current gate. Used by the gate
// calendar and the project's lifecycle tab.
import { useEffect, useState } from 'react'
import { mutate, useStore } from '@/core/store'
import { templateFor } from '@/core/engine/gates'
import { addDays, fmtDate, uid } from '@/core/util'
import { Button, Callout, Checkbox, Field, Input, Modal } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProjectSelect } from '../shared/pickers'

export function ScheduleReviewModal({ open, onClose, projectId: fixed }: { open: boolean; onClose: () => void; projectId?: string }) {
  const s = useStore()
  const [pid, setPid] = useState(fixed ?? '')
  const [date, setDate] = useState(addDays(s.settings.asOf, 21))
  const [board, setBoard] = useState<string[]>([])
  const p = s.projects.find((x) => x.id === pid)
  const existing = p ? s.gateReviews.find((g) => g.projectId === p.id && g.stageIndex === p.stageIndex && g.status === 'scheduled') : undefined
  useEffect(() => {
    if (!open) return
    const id = fixed ?? pid
    setPid(id)
    const proj = s.projects.find((x) => x.id === id)
    const ex = proj ? s.gateReviews.find((g) => g.projectId === proj.id && g.stageIndex === proj.stageIndex && g.status === 'scheduled') : undefined
    setBoard(ex?.board ?? (proj ? [proj.team.sponsor, 'u-pmo2'].filter(Boolean) as string[] : []))
    if (ex) setDate(ex.scheduled)
  }, [open, fixed, pid]) // eslint-disable-line react-hooks/exhaustive-deps
  const eligible = s.people.filter((x) => !x.company && (x.roles.includes('gate-board') || x.roles.includes('sponsor') || x.roles.includes('exec')))
  const gate = p ? templateFor(s, p).stages[p.stageIndex]?.gate : undefined
  const active = s.projects.filter((x) => x.status === 'active')
  const save = () => {
    if (!p || !gate) return
    if (!board.length) { toast('Pick at least one board member', 'bad'); return }
    if (date < s.settings.asOf) { toast('Pick a date from today on', 'bad'); return }
    if (existing) {
      mutate((d) => { const g = d.gateReviews.find((x) => x.id === existing.id)!; g.scheduled = date; g.board = board }, { entity: 'gate-review', entityId: existing.id, projectId: p.id, action: 'reschedule', summary: `${gate.name} review moved ${existing.scheduled} → ${date}` })
      toast(`Gate review moved to ${fmtDate(date)}`)
    } else {
      const id = uid('gr')
      mutate((d) => { d.gateReviews.push({ id, projectId: p.id, stageIndex: p.stageIndex, scheduled: date, board, status: 'scheduled' }) }, { entity: 'gate-review', entityId: id, projectId: p.id, action: 'schedule', summary: `${gate.name} review scheduled for ${date}` })
      toast(`Gate review scheduled for ${fmtDate(date)}`)
    }
    onClose()
  }
  const cancelReview = () => {
    if (!existing || !p) return
    mutate((d) => { d.gateReviews.find((x) => x.id === existing.id)!.status = 'cancelled' }, { entity: 'gate-review', entityId: existing.id, projectId: p.id, action: 'cancel', summary: `${gate?.name} review on ${existing.scheduled} cancelled` })
    toast('Gate review cancelled')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Reschedule gate review' : 'Schedule gate review'}
      footer={<>{existing && <Button variant="ghost" className="mr-auto text-bad" onClick={cancelReview}>Cancel review</Button>}<Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" disabled={!p} onClick={save}>{existing ? 'Save new date' : 'Schedule review'}</Button></>}>
      <div className="flex flex-col gap-3">
        {!fixed && <Field label="Project"><ProjectSelectActive value={pid} onChange={setPid} ids={active.map((x) => x.id)} /></Field>}
        {p && gate && <Callout tone="info"><b>{p.code}</b> · {gate.name}. Decision roles: {gate.decisionRoles.map((r) => s.roles.find((x) => x.id === r)?.name ?? r).join(', ')}.</Callout>}
        {existing && <Callout tone="warn">Already scheduled for {fmtDate(existing.scheduled)}. Saving moves it.</Callout>}
        <Field label="Board date"><Input id="gr-date" type="date" value={date} min={s.settings.asOf} onChange={(e) => setDate(e.target.value)} /></Field>
        <div>
          <div className="mb-1 text-[12px] font-semibold text-muted">Board members</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {eligible.map((x) => <Checkbox key={x.id} checked={board.includes(x.id)} onChange={(v) => setBoard(v ? [...board, x.id] : board.filter((b) => b !== x.id))} label={<span>{x.name}<span className="block text-[11px] text-muted">{x.title}</span></span>} />)}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ProjectSelectActive({ value, onChange, ids }: { value: string; onChange: (v: string) => void; ids: string[] }) {
  const projects = useStore((s) => s.projects.filter((p) => ids.includes(p.id)))
  return (
    <select id="gr-project" className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select an active project —</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
    </select>
  )
}
export { ProjectSelect }
