// Lifecycle template editor (SG-01..03): stages, gates, deliverables and their conditions.
import { useMemo, useState } from 'react'
import type { AaceClass, DeliverableDef, DeliverableKind, LifecycleTemplate, RoleId } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { ensureDeliverables } from '@/core/engine/gates'
import { cx, describeCondition, evalCondition, uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Drawer, Empty, Field, Input, Panel, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { ConditionEditor, MultiCheck, PERMISSIONS, RoleSelect, clone, roleName, useDraft } from './common'

const KINDS: DeliverableKind[] = ['document', 'estimate', 'risk-register', 'safety-plan', 'schedule', 'checklist', 'permit', 'records']

export default function Templates() {
  const templates = useStore((s) => s.templates)
  const programs = useStore((s) => s.programs)
  const [sel, setSel] = useState(templates[0]?.id)
  const tpl = templates.find((t) => t.id === sel) ?? templates[0]
  const duplicate = () => {
    if (!tpl) return
    const copy: LifecycleTemplate = clone(tpl)
    const suffix = uid('x').slice(-4)
    copy.id = uid('tpl')
    copy.name = `${tpl.name} (copy)`
    copy.stages.forEach((st) => { st.id = `${st.id}-${suffix}`; st.gate.id = `${st.gate.id}-${suffix}`; st.gate.deliverables.forEach((d) => { d.id = `${d.id}-${suffix}` }) })
    mutate((d) => { d.templates.push(copy) }, { entity: 'template', entityId: copy.id, action: 'create', summary: `Duplicated lifecycle template "${tpl.name}" as "${copy.name}"` })
    setSel(copy.id)
    toast('Template duplicated')
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div className="eyebrow px-1">Templates</div>
        {templates.map((t) => {
          const using = programs.filter((p) => p.lifecycleTemplateId === t.id)
          return (
            <button key={t.id} onClick={() => setSel(t.id)} className={cx('rounded-md border px-3 py-2.5 text-left', t.id === tpl?.id ? 'border-ink bg-surface shadow-sm' : 'border-line bg-surface hover:border-ink/40')}>
              <div className="text-[13px] font-semibold leading-snug">{t.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                <span>{t.stages.length} stages · {t.stages.reduce((a, st) => a + st.gate.deliverables.length, 0)} deliverables</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">{using.length ? using.map((p) => <ProgramTag key={p.id} programId={p.id} />) : <span className="text-[11px] text-faint">Not assigned to a program</span>}</div>
            </button>
          )
        })}
        <Button size="sm" onClick={duplicate}>Duplicate selected template</Button>
        <p className="px-1 text-[11px] text-faint">Duplicate a template to tailor it for a new program, then assign it on the Programs tab.</p>
      </div>
      {tpl ? <TemplateEditor key={tpl.id} tpl={tpl} onDeleted={() => setSel(templates[0]?.id)} /> : <Empty title="No templates" />}
    </div>
  )
}

function TemplateEditor({ tpl, onDeleted }: { tpl: LifecycleTemplate; onDeleted: () => void }) {
  const programs = useStore((s) => s.programs)
  const allProjects = useStore((s) => s.projects)
  const roles = useStore((s) => s.roles)
  const [draft, setDraft, dirty, discard] = useDraft(tpl)
  const [stageIdx, setStageIdx] = useState(0)
  const [editing, setEditing] = useState<{ def: DeliverableDef; isNew: boolean } | null>(null)
  const using = programs.filter((p) => p.lifecycleTemplateId === tpl.id)
  const projects = useMemo(() => allProjects.filter((p) => using.some((u) => u.id === p.programId)), [allProjects, using])
  const st = draft.stages[stageIdx] ?? draft.stages[0]
  const atStage = projects.filter((p) => p.stageIndex === stageIdx && p.status === 'active')

  const setStage = (fn: (s: typeof st) => void) => setDraft((d) => { const n = clone(d); fn(n.stages[stageIdx]); return n })
  const moveDel = (i: number, dir: -1 | 1) => setStage((s) => { const a = s.gate.deliverables; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]] })
  const removeDel = (i: number) => setStage((s) => { s.gate.deliverables.splice(i, 1) })

  const save = () => {
    const changes = diffTemplate(tpl, draft)
    let created = 0
    mutate((d) => {
      const i = d.templates.findIndex((t) => t.id === tpl.id)
      d.templates[i] = clone(draft)
      const before = d.deliverables.length
      for (const p of d.projects) if (p.status === 'active' && using.some((u) => u.id === p.programId)) ensureDeliverables(d, p)
      created = d.deliverables.length - before
    }, { entity: 'template', entityId: tpl.id, action: 'update', summary: `Updated lifecycle template "${draft.name}": ${changes.join('; ') || 'no field changes'}` })
    toast(created ? `Template saved · ${created} new deliverable${created > 1 ? 's' : ''} assigned to active projects` : 'Template saved')
  }
  const remove = () => {
    mutate((d) => { d.templates = d.templates.filter((t) => t.id !== tpl.id) }, { entity: 'template', entityId: tpl.id, action: 'delete', summary: `Deleted unused lifecycle template "${tpl.name}"` })
    toast('Template deleted')
    onDeleted()
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {dirty && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-marker bg-marker/10 px-3 py-2">
          <span className="text-[13px] font-semibold">Unsaved changes to this template</span>
          <span className="flex gap-2"><Button size="sm" variant="ghost" onClick={discard}>Discard</Button><Button size="sm" variant="primary" onClick={save}>Save changes</Button></span>
        </div>
      )}
      <Panel title="Template" subtitle={`${draft.stages.length} stages · used by ${using.length ? using.map((u) => u.code).join(', ') : 'no programs'} · ${projects.length} projects`}
        actions={using.length === 0 ? <ConfirmButton size="sm" confirmLabel="Delete template" onConfirm={remove}>Delete</ConfirmButton> : undefined}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Template name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Description"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
        </div>
      </Panel>

      <div className="scroll-x">
        <ol className="flex min-w-max gap-1">
          {draft.stages.map((x, i) => (
            <li key={x.id}>
              <button onClick={() => setStageIdx(i)} className={cx('flex w-[190px] flex-col rounded-md border px-3 py-2 text-left', i === stageIdx ? 'border-marker bg-marker/10' : 'border-line bg-surface hover:border-ink/40')}>
                <span className="eyebrow">Stage {i + 1}</span>
                <span className="truncate text-[13px] font-semibold">{x.name}</span>
                <span className="truncate text-[11px] text-muted">{x.gate.name} · {x.gate.deliverables.length} deliverables</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`Stage ${stageIdx + 1}`} subtitle={`${atStage.length} active project${atStage.length === 1 ? '' : 's'} in this stage`}>
          <div className="flex flex-col gap-3">
            <Field label="Stage name"><Input value={st.name} onChange={(e) => setStage((s) => { s.name = e.target.value })} /></Field>
            <Field label="Purpose"><TextArea rows={2} value={st.purpose} onChange={(e) => setStage((s) => { s.purpose = e.target.value })} /></Field>
          </div>
        </Panel>
        <Panel title="Gate at end of stage" subtitle="Who decides, what the estimate must reach, and what passing unlocks">
          <div className="flex flex-col gap-3">
            <Field label="Gate name"><Input value={st.gate.name} onChange={(e) => setStage((s) => { s.gate.name = e.target.value })} /></Field>
            <Field label="Decision roles"><MultiCheck options={roles.filter((r) => ['sponsor', 'exec', 'gate-board', 'program-manager', 'pmo', 'finance'].includes(r.id) || st.gate.decisionRoles.includes(r.id)).map((r) => ({ id: r.id, label: r.name }))} value={st.gate.decisionRoles} onChange={(v) => setStage((s) => { s.gate.decisionRoles = v as RoleId[] })} /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Required estimate class" hint="Approved estimate must reach this class or better">
                <Select value={String(st.gate.requiredEstimateClass ?? '')} onChange={(e) => setStage((s) => { s.gate.requiredEstimateClass = e.target.value ? (Number(e.target.value) as AaceClass) : undefined })}
                  options={[{ value: '', label: 'No estimate requirement' }, ...[5, 4, 3, 2, 1].map((c) => ({ value: String(c), label: `Class ${c}` }))]} />
              </Field>
              <Field label="Budget event on Go" hint="Converts the approved estimate into a budget">
                <Select value={st.gate.budgetEvent ?? ''} onChange={(e) => setStage((s) => { s.gate.budgetEvent = (e.target.value || undefined) as 'planning' | 'control' | undefined })}
                  options={[{ value: '', label: 'None' }, { value: 'planning', label: 'Planning budget' }, { value: 'control', label: 'Control budget + baselines' }]} />
              </Field>
            </div>
            <Field label="Unlocks when passed"><MultiCheck options={PERMISSIONS} value={st.gate.unlocks} onChange={(v) => setStage((s) => { s.gate.unlocks = v })} /></Field>
          </div>
        </Panel>
      </div>

      <Panel title="Required deliverables" subtitle={`${st.gate.deliverables.length} defined · conditional items apply only to matching projects`} pad={false}
        actions={<Button size="sm" variant="primary" onClick={() => setEditing({ isNew: true, def: { id: uid('d'), name: '', description: '', kind: 'document', ownerRole: 'pm', reviewerRole: 'pmo', acceptance: '' } })}>Add deliverable</Button>}>
        {st.gate.deliverables.length === 0 ? <div className="p-4"><Empty title="No deliverables">Add the documents and records this gate must see.</Empty></div> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th style={{ width: 36 }}>#</th><th>Deliverable</th><th>Kind</th><th>Owner → reviewer</th><th>Applies when</th><th className="num">Projects</th><th style={{ width: 150 }} /></tr></thead>
              <tbody>
                {st.gate.deliverables.map((d, i) => {
                  const hits = projects.filter((p) => evalCondition(d.condition, p)).length
                  return (
                    <tr key={d.id}>
                      <td className="tabular-nums text-faint">{i + 1}</td>
                      <td className="min-w-[220px]"><button className="text-left font-semibold hover:text-link" onClick={() => setEditing({ def: clone(d), isNew: false })}>{d.name || <span className="text-faint">Untitled</span>}</button><div className="text-[12px] text-muted">{d.acceptance && <>Accept: {d.acceptance}</>}</div></td>
                      <td><Badge>{d.kind}</Badge></td>
                      <td className="whitespace-nowrap text-[12px]">{roleName(roles, d.ownerRole)} → {roleName(roles, d.reviewerRole)}</td>
                      <td>{d.condition ? <Badge tone="info">{describeCondition(d.condition)}</Badge> : <span className="text-[12px] text-faint">Always</span>}</td>
                      <td className="num">{hits}/{projects.length}</td>
                      <td>
                        <span className="flex justify-end gap-0.5">
                          <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveDel(i, -1)}>↑</Button>
                          <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === st.gate.deliverables.length - 1} onClick={() => moveDel(i, 1)}>↓</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ def: clone(d), isNew: false })}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-bad" onClick={() => removeDel(i)}>Remove</Button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">Saving adds newly required deliverables to active projects at their current stage. Existing deliverable records and past gate decisions are never changed.</div>
      </Panel>

      <DeliverableDrawer editing={editing} projects={projects} onClose={() => setEditing(null)} onSave={(def) => {
        setStage((s) => { const i = s.gate.deliverables.findIndex((x) => x.id === def.id); if (i >= 0) s.gate.deliverables[i] = def; else s.gate.deliverables.push(def) })
        setEditing(null)
        toast('Deliverable updated — save the template to publish', 'info')
      }} />
    </div>
  )
}

function DeliverableDrawer({ editing, projects, onClose, onSave }: { editing: { def: DeliverableDef; isNew: boolean } | null; projects: ReturnType<typeof useStore.getState>['projects']; onClose: () => void; onSave: (d: DeliverableDef) => void }) {
  const [d, setD] = useDraft<DeliverableDef | null>(editing?.def ?? null)
  if (!editing || !d) return null
  return (
    <Drawer open onClose={onClose} title={editing.isNew ? 'Add deliverable' : 'Edit deliverable'} width={600}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!d.name.trim()} onClick={() => onSave(d)}>{editing.isNew ? 'Add to gate' : 'Apply'}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Traffic management plan" /></Field>
        <Field label="Description"><TextArea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Kind"><Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as DeliverableKind })} options={KINDS} /></Field>
          <Field label="Owner role"><RoleSelect value={d.ownerRole} onChange={(r) => setD({ ...d, ownerRole: r })} /></Field>
          <Field label="Reviewer role"><RoleSelect value={d.reviewerRole} onChange={(r) => setD({ ...d, reviewerRole: r })} /></Field>
        </div>
        <Field label="Acceptance criteria" hint="Shown to the reviewer when the deliverable is submitted"><TextArea rows={2} value={d.acceptance} onChange={(e) => setD({ ...d, acceptance: e.target.value })} /></Field>
        <ConditionEditor value={d.condition} onChange={(c) => setD({ ...d, condition: c })} projects={projects} />
        {d.ownerRole === d.reviewerRole && <Callout tone="warn">Owner and reviewer are the same role. Separation of duties is stronger when a different role reviews.</Callout>}
      </div>
    </Drawer>
  )
}

function diffTemplate(a: LifecycleTemplate, b: LifecycleTemplate): string[] {
  const out: string[] = []
  if (a.name !== b.name) out.push(`renamed to "${b.name}"`)
  if (a.description !== b.description) out.push('description edited')
  b.stages.forEach((sb, i) => {
    const sa = a.stages[i]
    if (!sa) return
    const parts: string[] = []
    if (sa.name !== sb.name) parts.push('name')
    if (sa.purpose !== sb.purpose) parts.push('purpose')
    if (sa.gate.name !== sb.gate.name) parts.push('gate name')
    if (JSON.stringify(sa.gate.decisionRoles) !== JSON.stringify(sb.gate.decisionRoles)) parts.push(`decision roles → ${sb.gate.decisionRoles.join(', ')}`)
    if (sa.gate.requiredEstimateClass !== sb.gate.requiredEstimateClass) parts.push(`estimate class → ${sb.gate.requiredEstimateClass ? 'Class ' + sb.gate.requiredEstimateClass : 'none'}`)
    if (sa.gate.budgetEvent !== sb.gate.budgetEvent) parts.push(`budget event → ${sb.gate.budgetEvent ?? 'none'}`)
    if (JSON.stringify(sa.gate.unlocks) !== JSON.stringify(sb.gate.unlocks)) parts.push(`unlocks → ${sb.gate.unlocks.join(', ') || 'none'}`)
    const ida = sa.gate.deliverables.map((x) => x.id), idb = sb.gate.deliverables.map((x) => x.id)
    const added = sb.gate.deliverables.filter((x) => !ida.includes(x.id)).map((x) => x.name)
    const removed = sa.gate.deliverables.filter((x) => !idb.includes(x.id)).map((x) => x.name)
    const edited = sb.gate.deliverables.filter((x) => { const o = sa.gate.deliverables.find((y) => y.id === x.id); return o && JSON.stringify(o) !== JSON.stringify(x) }).map((x) => x.name)
    if (added.length) parts.push(`added ${added.join(', ')}`)
    if (removed.length) parts.push(`removed ${removed.join(', ')}`)
    if (edited.length) parts.push(`edited ${edited.join(', ')}`)
    if (!added.length && !removed.length && ida.filter((x) => idb.includes(x)).join() !== idb.filter((x) => ida.includes(x)).join()) parts.push('deliverables reordered')
    if (parts.length) out.push(`Stage ${i + 1} ${sb.name}: ${parts.join(', ')}`)
  })
  return out
}
