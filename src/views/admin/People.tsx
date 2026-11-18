// People & roles, custom fields (PI-01) and variance thresholds.
import { useMemo, useState } from 'react'
import type { Person, RoleId } from '@/core/types'
import { mutate, personName, useStore } from '@/core/store'
import { money, uid } from '@/core/util'
import { Avatar, Badge, Button, Drawer, Field, Input, MoneyInput, Panel, Select, Table } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { PersonSelect } from '../shared/pickers'
import { MultiCheck, roleName, useDraft } from './common'

export function PeopleTab() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [edit, setEdit] = useState<{ p: Person; isNew: boolean } | null>(null)
  const rows = s.people.filter((p) => (!q || (p.name + p.title + (p.company ?? '')).toLowerCase().includes(q.toLowerCase())) && (!role || p.roles.includes(role as RoleId)))
  const holders = useMemo(() => Object.fromEntries(s.roles.map((r) => [r.id, s.people.filter((p) => p.roles.includes(r.id)).length])), [s.roles, s.people])
  return (
    <div className="flex flex-col gap-4">
      <Panel title="People" subtitle={`${s.people.length} people · ${s.people.filter((p) => p.company).length} contractor staff. Roles drive workflow routing; dollar authority drives approvals.`} pad={false}
        actions={<>
          <Input aria-label="Search people" className="h-7 w-44 py-0.5" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Role" className="h-7 w-44 py-0.5" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: '', label: 'All roles' }, ...s.roles.map((r) => ({ value: r.id, label: r.name }))]} />
          <Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, p: { id: uid('u'), name: '', title: '', roles: [], email: '', dollarAuthority: 0 } })}>Add person</Button>
        </>}>
        <Table rows={rows} rowKey={(r) => r.id} onRowClick={(p) => setEdit({ p, isNew: false })} maxHeight={520} columns={[
          { key: 'n', header: 'Name', sort: (r) => r.name, render: (r) => <span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={r.name} /><span><b>{r.name}</b><div className="text-[12px] text-muted">{r.email}</div></span></span> },
          { key: 't', header: 'Title', sort: (r) => r.title, render: (r) => <span className="text-[13px]">{r.title}{r.company && <div className="text-[12px] text-muted">{r.company}</div>}</span> },
          { key: 'r', header: 'Roles', render: (r) => <span className="flex min-w-[160px] flex-wrap gap-1">{r.roles.map((x) => <Badge key={x}>{roleName(s.roles, x)}</Badge>)}</span> },
          { key: 'm', header: 'Manager', sort: (r) => personName(s, r.managerId), render: (r) => <span className="whitespace-nowrap text-[12px]">{r.managerId ? personName(s, r.managerId) : '—'}</span> },
          { key: 'd', header: 'Dollar authority', num: true, sort: (r) => r.dollarAuthority, render: (r) => (r.dollarAuthority ? money(r.dollarAuthority) : <span className="text-faint">—</span>) },
          { key: 'o', header: 'Status', render: (r) => (r.outOfOffice && s.settings.asOf >= r.outOfOffice.from && s.settings.asOf <= r.outOfOffice.to ? <Badge tone="warn">Out · delegate {personName(s, r.outOfOffice.delegateId)}</Badge> : <Badge tone="good">Active</Badge>) },
        ]} />
      </Panel>
      <RoleCatalog holders={holders} />
      <Thresholds />
      <PersonDrawer edit={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

function PersonDrawer({ edit, onClose }: { edit: { p: Person; isNew: boolean } | null; onClose: () => void }) {
  const roles = useStore((s) => s.roles)
  const [p, setP] = useDraft<Person | null>(edit?.p ?? null)
  if (!edit || !p) return null
  const save = () => {
    if (!p.name.trim()) { toast('Name is required', 'bad'); return }
    const email = p.email || `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@arroyovalleygas.com`
    const prev = edit.p
    const rolesChanged = JSON.stringify(prev.roles) !== JSON.stringify(p.roles)
    mutate((d) => { const n = { ...p, email }; const i = d.people.findIndex((x) => x.id === p.id); if (i >= 0) d.people[i] = n; else d.people.push(n) },
      { entity: 'person', entityId: p.id, action: edit.isNew ? 'create' : 'update', summary: edit.isNew ? `Added ${p.name} (${p.title}) with roles ${p.roles.join(', ') || 'none'}` : `Updated ${p.name}${rolesChanged ? ` — roles ${prev.roles.join(', ') || 'none'} → ${p.roles.join(', ') || 'none'}` : ''}${prev.dollarAuthority !== p.dollarAuthority ? ` — authority ${money(prev.dollarAuthority)} → ${money(p.dollarAuthority)}` : ''}` })
    toast(edit.isNew ? 'Person added' : 'Person saved'); onClose()
  }
  const oo = p.outOfOffice
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add person' : p.name} width={580}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Title"><Input value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></Field>
          <Field label="Email"><Input value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field>
          <Field label="Company" hint="Leave blank for utility employees"><Input value={p.company ?? ''} onChange={(e) => setP({ ...p, company: e.target.value || undefined })} /></Field>
          <Field label="Manager"><PersonSelect includeEmpty value={p.managerId} onChange={(id) => setP({ ...p, managerId: id || undefined })} /></Field>
          <Field label="Dollar authority" hint="Maximum this person may approve"><MoneyInput value={p.dollarAuthority} onChange={(v) => setP({ ...p, dollarAuthority: v })} /></Field>
        </div>
        <Field label="Roles"><MultiCheck options={roles.map((r) => ({ id: r.id, label: r.name }))} value={p.roles} onChange={(v) => setP({ ...p, roles: v as RoleId[] })} /></Field>
        <div className="rounded-md border border-line p-3">
          <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" className="h-4 w-4" checked={!!oo} onChange={(e) => setP({ ...p, outOfOffice: e.target.checked ? { from: useStore.getState().settings.asOf, to: useStore.getState().settings.asOf, delegateId: p.managerId ?? 'u-me' } : undefined })} />Out of office — route approvals to a delegate</label>
          {oo && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="From"><Input type="date" value={oo.from} onChange={(e) => setP({ ...p, outOfOffice: { ...oo, from: e.target.value } })} /></Field>
              <Field label="To"><Input type="date" value={oo.to} onChange={(e) => setP({ ...p, outOfOffice: { ...oo, to: e.target.value } })} /></Field>
              <Field label="Delegate"><PersonSelect value={oo.delegateId} onChange={(id) => setP({ ...p, outOfOffice: { ...oo, delegateId: id } })} /></Field>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function RoleCatalog({ holders }: { holders: Record<string, number> }) {
  const roles = useStore((s) => s.roles)
  const [rows, setRows, dirty, discard] = useDraft(roles)
  const save = () => {
    const edited = rows.filter((r) => JSON.stringify(r) !== JSON.stringify(roles.find((x) => x.id === r.id))).map((r) => r.name)
    mutate((d) => { d.roles = rows }, { entity: 'role', entityId: 'catalog', action: 'update', summary: `Role catalog updated: ${edited.join(', ')}` })
    toast('Role catalog saved')
  }
  return (
    <Panel title="Role catalog" subtitle="Role identifiers are fixed because workflows and templates route by them; names and descriptions are editable." pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save roles</Button></>}>
      <div className="scroll-x" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr><th style={{ width: 150 }}>ID</th><th style={{ width: 220 }}>Name</th><th>Description</th><th className="num">People</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="font-mono text-[12px] text-muted">{r.id}</td>
                <td><Input className="h-7 py-0.5" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                <td><Input className="h-7 py-0.5" value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                <td className="num">{holders[r.id] ? holders[r.id] : <span className="text-warn" title="No one holds this role; workflow steps routed to it will be skipped">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Thresholds() {
  const t = useStore((s) => s.settings.varianceThresholds)
  const [v, setV, dirty, discard] = useDraft(t)
  const save = () => {
    mutate((d) => { d.settings.varianceThresholds = v }, { entity: 'settings', entityId: 'varianceThresholds', action: 'update', summary: `Variance thresholds: EAC ${t.eacPct}% / ${money(t.eacAbs)} → ${v.eacPct}% / ${money(v.eacAbs)}; milestone ${t.milestoneDays} → ${v.milestoneDays} days` })
    toast('Variance thresholds saved')
  }
  return (
    <Panel title="Variance thresholds" subtitle="Crossing either EAC threshold, or slipping a milestone past the day limit versus the Current baseline, requires a variance explanation."
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save thresholds</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="EAC over Current baseline (%)"><Input type="number" step="0.5" value={v.eacPct} onChange={(e) => setV({ ...v, eacPct: Number(e.target.value) })} /></Field>
        <Field label="EAC over Current baseline ($)"><MoneyInput value={v.eacAbs} onChange={(n) => setV({ ...v, eacAbs: n })} /></Field>
        <Field label="Milestone slip (days)"><Input type="number" value={v.milestoneDays} onChange={(e) => setV({ ...v, milestoneDays: Number(e.target.value) })} /></Field>
      </div>
    </Panel>
  )
}

export function CustomFields() {
  const s = useStore()
  const [rows, setRows, dirty, discard] = useDraft(s.settings.fieldDefs)
  const filled = (key: string) => s.projects.filter((p) => p.customFields?.[key]).length
  const applicable = (ids: string[]) => s.projects.filter((p) => ids.length === 0 || ids.includes(p.programId))
  const keyErr = (k: string, i: number) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(k) ? 'Letters and digits only' : rows.findIndex((r) => r.key === k) !== i ? 'Duplicate key' : ''
  const save = () => {
    if (rows.some((r, i) => keyErr(r.key, i))) { toast('Fix field keys first', 'bad'); return }
    mutate((d) => { d.settings.fieldDefs = rows }, { entity: 'settings', entityId: 'fieldDefs', action: 'update', summary: `Custom project fields: ${rows.map((r) => `${r.label} [${r.key}]${r.requiredAtStage !== undefined ? ` required from stage ${r.requiredAtStage + 1}` : ''}`).join('; ')}` })
    toast('Custom fields saved')
  }
  const stageMax = Math.max(...s.templates.map((t) => t.stages.length))
  return (
    <Panel title="Custom project fields" subtitle="Extra fields on the project information record, scoped by program. A required field blocks gate readiness from its stage onward." pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={() => setRows([...rows, { key: 'newField' + (rows.length + 1), label: 'New field', programIds: [] }])}>Add field</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save fields</Button></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th style={{ width: 170 }}>Key</th><th style={{ width: 230 }}>Label</th><th>Programs</th><th style={{ width: 170 }}>Required from</th><th className="num">Filled</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const err = keyErr(r.key, i)
              const app = applicable(r.programIds)
              return (
                <tr key={i}>
                  <td><Input className={`h-7 py-0.5 font-mono ${err ? 'border-bad' : ''}`} title={err} value={r.key} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />{err && <div className="text-[11px] text-bad">{err}</div>}</td>
                  <td><Input className="h-7 py-0.5" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                  <td><MultiCheck options={s.programs.map((p) => ({ id: p.id, label: p.code }))} value={r.programIds} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, programIds: v } : x)))} />{r.programIds.length === 0 && <div className="mt-0.5 text-[11px] text-faint">All programs</div>}</td>
                  <td><Select className="h-7 py-0.5" value={r.requiredAtStage === undefined ? '' : String(r.requiredAtStage)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, requiredAtStage: e.target.value === '' ? undefined : Number(e.target.value) } : x)))} options={[{ value: '', label: 'Optional' }, ...Array.from({ length: stageMax }, (_, k) => ({ value: String(k), label: `Stage ${k + 1}` }))]} /></td>
                  <td className="num">{filled(r.key)}/{app.length}</td>
                  <td><Button size="sm" variant="ghost" className="text-bad" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <FieldValues />
    </Panel>
  )
}

/** Fill custom-field values in bulk for the selected field. */
function FieldValues() {
  const s = useStore()
  const [key, setKey] = useState(s.settings.fieldDefs[0]?.key ?? '')
  const def = s.settings.fieldDefs.find((f) => f.key === key)
  const projects = def ? s.projects.filter((p) => def.programIds.length === 0 || def.programIds.includes(p.programId)) : []
  const [vals, setVals, dirty] = useDraft(Object.fromEntries(projects.map((p) => [p.id, p.customFields?.[key] ?? ''])))
  if (!def) return null
  const save = () => {
    const changed = projects.filter((p) => (p.customFields?.[key] ?? '') !== vals[p.id])
    mutate((d) => { for (const p of d.projects) if (p.id in vals) { p.customFields = { ...(p.customFields ?? {}), [key]: vals[p.id] }; if (!vals[p.id]) delete p.customFields[key] } },
      { entity: 'project', entityId: key, action: 'update', summary: `Set ${def.label} on ${changed.length} project${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 6).map((p) => `${p.code}=${vals[p.id] || '(blank)'}`).join(', ')}` })
    toast(`${def.label} saved on ${changed.length} project${changed.length === 1 ? '' : 's'}`)
  }
  return (
    <div className="border-t border-line p-4">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <Field label="Edit values for"><Select className="w-64" value={key} onChange={(e) => setKey(e.target.value)} options={s.settings.fieldDefs.map((f) => ({ value: f.key, label: f.label }))} /></Field>
        <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save values</Button>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const missing = def.requiredAtStage !== undefined && p.stageIndex >= def.requiredAtStage && !vals[p.id] && p.status === 'active'
          return (
            <label key={p.id} className="grid grid-cols-[86px_1fr] items-center gap-2 text-[12px]">
              <span className={`font-mono font-semibold ${missing ? 'text-bad' : ''}`} title={missing ? 'Required at this stage' : p.name}>{p.code}</span>
              <Input className="h-7 py-0.5" value={vals[p.id] ?? ''} placeholder={missing ? 'Required' : ''} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} />
            </label>
          )
        })}
      </div>
    </div>
  )
}
