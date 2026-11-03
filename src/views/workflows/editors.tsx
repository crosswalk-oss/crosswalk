// Property editors used by the designer: assignee, condition, form fields, process settings, validation checklist.
import type { AppState, Assignee, Condition, ConditionOp, FormField, RoleId, TeamPosition, WfEdge, WorkflowDef } from '@/core/types'
import { resolveAssignees } from '@/core/engine/workflow'
import { cx, describeCondition, evalCondition } from '@/core/util'
import { Badge, Button, Checkbox, Field, Input, Select, TextArea } from '@/ui/kit'
import { PROJECT_PATHS, RECORD_TYPES, TEAM_POSITIONS, conditionValueText, parseConditionValue, previewInstance, type Check } from './lib'

export interface Preview { projectId?: string; requesterId: string; data: Record<string, unknown> }

const KINDS: { value: Assignee['kind']; label: string }[] = [
  { value: 'team-position', label: 'Position on the project team' },
  { value: 'role', label: 'Anyone holding a role' },
  { value: 'doa', label: 'Approver by dollar authority (DOA)' },
  { value: 'person', label: 'A named person' },
  { value: 'requester', label: 'The requester' },
  { value: 'manager-of-requester', label: "The requester's manager" },
]

export function AssigneeEditor({ s, value, onChange, fields, preview }: { s: AppState; value?: Assignee; onChange: (a: Assignee | undefined) => void; fields: FormField[]; preview: Preview }) {
  const kind = value?.kind ?? ''
  const moneyFields = fields.filter((f) => f.type === 'money' || f.type === 'number')
  const setKind = (k: string) => {
    switch (k) {
      case 'role': return onChange({ kind: 'role', roleId: 'pmo' })
      case 'team-position': return onChange({ kind: 'team-position', position: 'pm' })
      case 'person': return onChange({ kind: 'person', personId: s.people.find((p) => !p.company)?.id ?? s.people[0].id })
      case 'doa': return onChange({ kind: 'doa', field: moneyFields[0]?.key ?? 'amount' })
      case 'requester': return onChange({ kind: 'requester' })
      case 'manager-of-requester': return onChange({ kind: 'manager-of-requester' })
      default: return onChange(undefined)
    }
  }
  const project = s.projects.find((p) => p.id === preview.projectId)
  const resolved = value ? resolveAssignees(s, previewInstance({ id: 'p', key: 'p', version: 0 } as WorkflowDef, preview.projectId, preview.requesterId, preview.data), value) : []
  return (
    <div className="flex flex-col gap-2">
      <Field label="Assigned to">
        <Select id="wf-assignee-kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: '— Not assigned —' }, ...KINDS]} />
      </Field>
      {value?.kind === 'role' && (
        <Field label="Role"><Select value={value.roleId} onChange={(e) => onChange({ kind: 'role', roleId: e.target.value as RoleId })} options={s.roles.map((r) => ({ value: r.id, label: `${r.name} (${s.people.filter((p) => p.roles.includes(r.id)).length})` }))} /></Field>
      )}
      {value?.kind === 'team-position' && (
        <Field label="Team position" hint="Resolved from each project's team roster.">
          <Select value={value.position} onChange={(e) => onChange({ kind: 'team-position', position: e.target.value as TeamPosition })} options={TEAM_POSITIONS.map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
      )}
      {value?.kind === 'person' && (
        <Field label="Person"><Select value={value.personId} onChange={(e) => onChange({ kind: 'person', personId: e.target.value })} options={s.people.map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))} /></Field>
      )}
      {value?.kind === 'doa' && (
        <Field label="Amount field" hint="The DOA matrix picks the approver whose limit first covers this amount.">
          <Select value={value.field} onChange={(e) => onChange({ kind: 'doa', field: e.target.value })} options={moneyFields.length ? moneyFields.map((f) => ({ value: f.key, label: `${f.label} (${f.key})` })) : [{ value: value.field, label: `${value.field} — add a money field` }]} />
        </Field>
      )}
      {value && (
        <div className="rounded border border-line bg-sunken/60 px-2.5 py-2 text-[12px]">
          <div className="text-faint">Resolves to on {project ? <b className="font-mono text-ink">{project.code}</b> : 'no project'} with the test values</div>
          <div className="mt-0.5 font-semibold">{resolved.length ? resolved.map((id) => s.people.find((p) => p.id === id)?.name).join(', ') : <span className="text-bad">Nobody — this step would be skipped</span>}</div>
        </div>
      )}
    </div>
  )
}

const OPS: { value: ConditionOp; label: string }[] = [
  { value: 'gt', label: 'greater than' }, { value: 'gte', label: 'at least' }, { value: 'lt', label: 'less than' }, { value: 'lte', label: 'at most' },
  { value: 'eq', label: 'equals' }, { value: 'ne', label: 'does not equal' }, { value: 'in', label: 'is one of' }, { value: 'truthy', label: 'is yes / set' }, { value: 'falsy', label: 'is no / empty' },
]

export function ConditionEditor({ s, edge, def, onChange, preview }: { s: AppState; edge: WfEdge; def: WorkflowDef; onChange: (c: Condition | undefined) => void; preview: Preview }) {
  const c = edge.condition
  const fieldOpts = [
    ...def.fields.map((f) => ({ value: f.key, label: `Form · ${f.label}` })),
    ...PROJECT_PATHS.map((p) => ({ value: p.path, label: p.label })),
  ]
  if (c && !fieldOpts.some((o) => o.value === c.field)) fieldOpts.unshift({ value: c.field, label: c.field })
  const formField = c && def.fields.find((f) => f.key === c.field)
  const ctx = { ...preview.data, project: s.projects.find((p) => p.id === preview.projectId) }
  const others = def.edges.filter((e) => e.from === edge.from && e.id !== edge.id)
  const hasOtherDefault = others.some((e) => !e.condition)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button className={cx('flex-1 rounded border px-2 py-1 text-[12px] font-semibold', !c ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')} onClick={() => onChange(undefined)}>Default path</button>
        <button className={cx('flex-1 rounded border px-2 py-1 text-[12px] font-semibold', c ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')} onClick={() => onChange(c ?? { field: def.fields.find((f) => f.type === 'money' || f.type === 'number')?.key ?? fieldOpts[0]?.value ?? 'amount', op: 'gt', value: 0 })}>Rule</button>
      </div>
      {!c && <p className="text-[12px] text-muted">Taken when no rule on the other paths matches.{hasOtherDefault && <span className="text-bad"> Another path from this decision is already the default — a decision needs exactly one.</span>}</p>}
      {c && (
        <>
          <Field label="When"><Select id="wf-cond-field" value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })} options={fieldOpts} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Operator"><Select value={c.op} onChange={(e) => { const op = e.target.value as ConditionOp; onChange({ ...c, op, value: op === 'truthy' || op === 'falsy' ? undefined : parseConditionValue(conditionValueText(c), op) }) }} options={OPS} /></Field>
            {c.op !== 'truthy' && c.op !== 'falsy' && (
              <Field label={c.op === 'in' ? 'Values (comma separated)' : 'Value'}>
                {formField?.type === 'select' && c.op !== 'in' ? (
                  <Select value={conditionValueText(c)} onChange={(e) => onChange({ ...c, value: parseConditionValue(e.target.value, c.op) })} options={(formField.options ?? []).filter(Boolean)} />
                ) : (
                  <Input value={conditionValueText(c)} onChange={(e) => onChange({ ...c, value: parseConditionValue(e.target.value, c.op) })} />
                )}
              </Field>
            )}
          </div>
          <div className="rounded border border-line bg-sunken/60 px-2.5 py-2 text-[12px]">
            <div className="font-mono text-[11.5px]">{describeCondition(c)}</div>
            <div className="mt-1 text-faint">With the test values: {evalCondition(c, ctx) ? <Badge tone="good">true — takes this path</Badge> : <Badge>false</Badge>}</div>
          </div>
        </>
      )}
    </div>
  )
}

export function FieldsEditor({ fields, onChange, readOnly, usedKeys }: { fields: FormField[]; onChange: (f: FormField[]) => void; readOnly?: boolean; usedKeys: Set<string> }) {
  const set = (i: number, patch: Partial<FormField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && <p className="text-[12px] text-muted">No form fields. Add the values requesters enter — routing rules and dollar authority read them.</p>}
      {fields.map((f, i) => (
        <div key={i} className="rounded border border-line p-2">
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-1.5">
            <Input aria-label="Field label" value={f.label} disabled={readOnly} onChange={(e) => set(i, { label: e.target.value })} className="h-7 py-0.5" />
            <Select aria-label="Field type" value={f.type} disabled={readOnly} onChange={(e) => set(i, { type: e.target.value as FormField['type'] })} className="h-7 py-0.5" options={['text', 'textarea', 'money', 'number', 'date', 'select', 'boolean']} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input aria-label="Field key" value={f.key} disabled={readOnly} onChange={(e) => set(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} className="h-7 w-[130px] py-0.5 font-mono text-[12px]" />
            <Checkbox checked={!!f.required} disabled={readOnly} onChange={(v) => set(i, { required: v })} label={<span className="text-[12px]">Required</span>} />
            {usedKeys.has(f.key) && <Badge tone="info" title="Used by a routing rule or dollar-authority step">routes</Badge>}
            {!readOnly && <button className="ml-auto text-[12px] font-semibold text-bad hover:underline" onClick={() => onChange(fields.filter((_, j) => j !== i))}>Remove</button>}
          </div>
          {f.type === 'select' && <Input aria-label="Options" className="mt-1.5 h-7 py-0.5 text-[12px]" placeholder="Options, comma separated" disabled={readOnly} value={(f.options ?? []).join(', ')} onChange={(e) => set(i, { options: e.target.value.split(',').map((x) => x.trim()) })} />}
        </div>
      ))}
      {!readOnly && <Button size="sm" onClick={() => onChange([...fields, { key: `field${fields.length + 1}`, label: 'New field', type: 'text' }])}>Add field</Button>}
    </div>
  )
}

export function ProcessSettings({ s, def, onChange, readOnly }: { s: AppState; def: WorkflowDef; onChange: (p: Partial<WorkflowDef>) => void; readOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Process name"><Input id="wf-name" value={def.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Record type"><Select value={def.recordType} disabled={readOnly} onChange={(e) => onChange({ recordType: e.target.value as WorkflowDef['recordType'] })} options={RECORD_TYPES.map((r) => ({ value: r.id, label: r.label }))} /></Field>
        <Field label="Process owner"><Select value={def.ownerRole} disabled={readOnly} onChange={(e) => onChange({ ownerRole: e.target.value as RoleId })} options={s.roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
      </div>
      <Field label="Description" hint="Shown in the catalog and the SOP scope."><TextArea value={def.description} disabled={readOnly} onChange={(e) => onChange({ description: e.target.value })} className="min-h-[60px]" /></Field>
      <Field label="Purpose" hint="Why the control exists — the first section of the SOP."><TextArea value={def.purpose} disabled={readOnly} onChange={(e) => onChange({ purpose: e.target.value })} className="min-h-[60px]" /></Field>
    </div>
  )
}

export function Checklist({ checks, onPick }: { checks: Check[]; onPick?: (c: Check) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {checks.map((c) => (
        <li key={c.id}>
          <button disabled={c.ok || !onPick} onClick={() => onPick?.(c)} className={cx('flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[12.5px]', !c.ok && onPick && 'hover:bg-sunken')}>
            <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-surface', c.ok ? 'bg-good' : c.level === 'error' ? 'bg-bad' : 'bg-warn')}>{c.ok ? '✓' : c.level === 'error' ? '✕' : '!'}</span>
            <span className="min-w-0"><span className={cx(c.ok ? 'text-muted' : 'font-semibold')}>{c.label}</span>{!c.ok && c.detail && <span className="block text-[11.5px] text-muted">{c.detail}</span>}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
