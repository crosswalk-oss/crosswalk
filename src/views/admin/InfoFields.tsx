// Configuration: Project Information sections and fields (PI-*). Edit in place, save once.
// Keys are immutable after create (they identify stored values and revision history).
import { useMemo, useState } from 'react'
import type { InfoFieldDef } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { cx } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Modal, Panel, Select, Stat } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { useDraft } from './common'
import { BIND_PATHS, FIELD_TYPES, SYSTEM_KEYS, fieldStats, keyFromLabel, validKey } from '../project/tabs/info/lib'

const move = <T,>(xs: T[], i: number, j: number) => { const a = xs.slice(); const [x] = a.splice(i, 1); a.splice(j, 0, x); return a }

export default function InfoFields() {
  const s = useStore()
  const std = s.templates.find((t) => t.id === 'tpl-standard') ?? s.templates[0]
  const source = useMemo(() => ({ sections: s.settings.infoSections, fields: s.settings.infoFields }), [s.settings.infoSections, s.settings.infoFields])
  const [d, setD, dirty, discard] = useDraft(source)
  const [adding, setAdding] = useState<string | null>(null)
  const [newSection, setNewSection] = useState('')
  const savedKeys = s.settings.infoFields.map((f) => f.key)
  const stats = useMemo(() => Object.fromEntries(d.fields.map((f) => [f.key, fieldStats({ ...s, settings: { ...s.settings, infoFields: d.fields } }, f)])), [s, d.fields])
  const active = s.projects.filter((p) => p.status === 'active')
  const blockedProjects = new Set(Object.values(stats).flatMap((x) => x.blockedCodes))

  const setField = (key: string, patch: Partial<InfoFieldDef>) => setD({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) })
  const removeField = (key: string) => setD({ ...d, fields: d.fields.filter((f) => f.key !== key) })
  const moveField = (key: string, dir: -1 | 1) => {
    const f = d.fields.find((x) => x.key === key)!
    const same = d.fields.filter((x) => x.section === f.section)
    const i = same.indexOf(f), j = i + dir
    if (j < 0 || j >= same.length) return
    const a = d.fields.indexOf(f), b = d.fields.indexOf(same[j])
    const fields = d.fields.slice(); fields[a] = same[j]; fields[b] = f
    setD({ ...d, fields })
  }
  const renameSection = (i: number, name: string) => {
    const old = d.sections[i]
    setD({ sections: d.sections.map((x, j) => (j === i ? name : x)), fields: d.fields.map((f) => (f.section === old ? { ...f, section: name } : f)) })
  }

  const problems: string[] = []
  const secNames = d.sections.map((x) => x.trim())
  if (secNames.some((x) => !x)) problems.push('A section has no name')
  if (new Set(secNames).size !== secNames.length) problems.push('Two sections have the same name')
  for (const f of d.fields) {
    if (!f.label.trim()) problems.push(`Field ${f.key} has no label`)
    if (f.type === 'select' && !(f.options ?? []).filter((o) => o.trim()).length) problems.push(`${f.label || f.key}: a choice list needs options`)
  }

  const save = () => {
    if (problems.length) { toast(problems[0], 'bad'); return }
    const before = s.settings.infoFields
    const added = d.fields.filter((f) => !before.some((x) => x.key === f.key)).map((f) => f.label)
    const removed = before.filter((f) => !d.fields.some((x) => x.key === f.key)).map((f) => f.label)
    const edited = d.fields.filter((f) => { const o = before.find((x) => x.key === f.key); return o && JSON.stringify(o) !== JSON.stringify(f) }).map((f) => f.label)
    const secChanged = JSON.stringify(s.settings.infoSections) !== JSON.stringify(d.sections)
    const fields = d.fields.map((f) => ({ ...f, options: f.type === 'select' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined, help: f.help?.trim() || undefined }))
    const parts = [secChanged && 'sections updated', added.length && `added ${added.join(', ')}`, edited.length && `edited ${edited.join(', ')}`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean)
    mutate((dr) => { dr.settings.infoSections = d.sections.map((x) => x.trim()); dr.settings.infoFields = fields },
      { entity: 'info-field', entityId: 'project-info', action: 'update', summary: `Project information fields: ${parts.join(' · ') || 'reordered'}` })
    toast('Project information fields saved')
  }

  const stageOptions = [{ value: '', label: 'Not required' }, ...std.stages.map((st) => ({ value: String(st.index), label: `Stage ${st.index + 1} · ${st.name}` }))]
  const bindOptions = (f: InfoFieldDef) => [{ value: '', label: 'Record only' }, ...BIND_PATHS.filter((b) => b.path === f.bind || !d.fields.some((x) => x.bind === b.path && x.key !== f.key)).map((b) => ({ value: b.path, label: `${b.label} (${b.path})` })), ...(f.bind && !BIND_PATHS.some((b) => b.path === f.bind) ? [{ value: f.bind, label: f.bind }] : [])]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fields" value={d.fields.length} sub={`${d.sections.length} sections · ${d.fields.filter((f) => f.bind).length} bound to project data`} />
        <Stat label="Required by a stage" value={d.fields.filter((f) => f.requiredAtStage !== undefined && !f.readOnly).length} sub="Empty required fields block the gate" />
        <Stat label="Active projects blocked" value={blockedProjects.size} sub={`of ${active.length} active, at their current stage`} tone={blockedProjects.size ? 'warn' : 'good'} />
        <Stat label="Empty values" value={Object.values(stats).reduce((a, x) => a + x.empty, 0)} sub="Across active projects, all fields" />
      </div>

      <Panel title="Project information fields" subtitle="The controlled data sheet every project carries. Requirements apply by stage number; condensed-template projects use the same stage numbers (stage 3 there is Construct & Close)." pad={false}
        actions={<>
          {dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}
          <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save fields</Button>
        </>}>
        {problems.length > 0 && dirty && <div className="border-b border-line px-4 py-2 text-[12px] font-semibold text-bad">{problems[0]}</div>}
        <div className="flex flex-col">
          {d.sections.map((sec, si) => {
            const fields = d.fields.filter((f) => f.section === sec)
            return (
              <section key={si} className="border-b border-line last:border-0">
                <div className="flex flex-wrap items-center gap-2 bg-sunken/60 px-4 py-2">
                  <span className="w-5 text-[11px] font-bold text-faint tabular-nums">{si + 1}</span>
                  <Input aria-label="Section name" className="h-8 max-w-xs py-1 font-display font-semibold" value={sec} onChange={(e) => renameSection(si, e.target.value)} />
                  <span className="text-[12px] text-muted">{fields.length} field{fields.length === 1 ? '' : 's'}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" disabled={si === 0} aria-label="Move section up" onClick={() => setD({ ...d, sections: move(d.sections, si, si - 1) })}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={si === d.sections.length - 1} aria-label="Move section down" onClick={() => setD({ ...d, sections: move(d.sections, si, si + 1) })}>↓</Button>
                    <Button size="sm" onClick={() => setAdding(sec)}>Add field</Button>
                    {!fields.length && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setD({ ...d, sections: d.sections.filter((_, j) => j !== si) })}>Remove</Button>}
                  </span>
                </div>
                {fields.length > 0 && (
                  <div className="scroll-x">
                    <table className="tbl">
                      <thead><tr>
                        <th style={{ width: 64 }}>Order</th><th style={{ minWidth: 220 }}>Label · key</th><th style={{ width: 130 }}>Type</th>
                        <th style={{ minWidth: 200 }}>Required at</th><th style={{ minWidth: 200 }}>Stored on</th><th className="num">Empty</th><th className="num">Blocking</th><th style={{ width: 80 }} />
                      </tr></thead>
                      <tbody>
                        {fields.map((f, fi) => (
                          <FieldRow key={f.key} f={f} first={fi === 0} last={fi === fields.length - 1} isNew={!savedKeys.includes(f.key)}
                            sections={d.sections} stageOptions={stageOptions} bindOptions={bindOptions(f)} stat={stats[f.key]} activeCount={active.length}
                            onChange={(patch) => setField(f.key, patch)} onMove={(dir) => moveField(f.key, dir)} onRemove={() => removeField(f.key)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Input aria-label="New section name" className="h-8 max-w-xs py-1" placeholder="New section name" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
          <Button size="sm" disabled={!newSection.trim() || d.sections.includes(newSection.trim())} onClick={() => { setD({ ...d, sections: [...d.sections, newSection.trim()] }); setNewSection('') }}>Add section</Button>
          <span className="text-[12px] text-muted">Removing a field hides it from the record; values already stored and their revision history are kept.</span>
        </div>
      </Panel>

      <AddFieldModal section={adding} onClose={() => setAdding(null)} taken={d.fields.map((f) => f.key)}
        stageOptions={stageOptions} bindOptions={bindOptions({ key: '', label: '', section: '', type: 'text' })}
        onAdd={(f) => { setD({ ...d, fields: [...d.fields, f] }); setAdding(null); toast(`Field “${f.label}” added — save to apply`, 'info') }} />
    </div>
  )
}

function FieldRow({ f, first, last, isNew, sections, stageOptions, bindOptions, stat, activeCount, onChange, onMove, onRemove }: {
  f: InfoFieldDef; first: boolean; last: boolean; isNew: boolean; sections: string[]; stageOptions: { value: string; label: string }[]; bindOptions: { value: string; label: string }[]
  stat?: { empty: number; blocked: number; blockedCodes: string[] }; activeCount: number
  onChange: (p: Partial<InfoFieldDef>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const system = SYSTEM_KEYS.includes(f.key)
  return (
    <>
      <tr className={cx(open && '[&>td]:border-b-0')}>
        <td>
          <span className="inline-flex">
            <button type="button" className="rounded px-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30" disabled={first} aria-label="Move up" onClick={() => onMove(-1)}>↑</button>
            <button type="button" className="rounded px-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30" disabled={last} aria-label="Move down" onClick={() => onMove(1)}>↓</button>
          </span>
        </td>
        <td>
          <Input aria-label="Label" className="h-7 py-0.5" value={f.label} onChange={(e) => onChange({ label: e.target.value })} />
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="font-mono text-[11px] text-faint">{f.key}</span>
            {isNew && <Badge tone="marker">New</Badge>}
            {f.readOnly && <Badge>Read-only</Badge>}
            {system && <Badge tone="info">System</Badge>}
          </div>
        </td>
        <td><Select aria-label="Type" className="h-7 py-0.5" disabled={system} value={f.type} onChange={(e) => onChange({ type: e.target.value as InfoFieldDef['type'] })} options={FIELD_TYPES.map((t) => ({ value: t.id, label: t.label }))} /></td>
        <td><Select aria-label="Required at stage" className="h-7 py-0.5" disabled={f.readOnly} value={f.requiredAtStage === undefined ? '' : String(f.requiredAtStage)} onChange={(e) => onChange({ requiredAtStage: e.target.value === '' ? undefined : Number(e.target.value) })} options={stageOptions} /></td>
        <td>{system ? <span className="text-[12px] text-muted">Computed from program / team</span>
          : <Select aria-label="Stored on" className="h-7 py-0.5" value={f.bind ?? ''} onChange={(e) => onChange({ bind: e.target.value || undefined })} options={bindOptions} />}</td>
        <td className="num">{f.readOnly ? <span className="text-faint">—</span> : <span className={cx(stat?.empty ? 'text-ink' : 'text-faint')} title={`${stat?.empty ?? 0} of ${activeCount} active projects`}>{stat?.empty ?? 0}</span>}</td>
        <td className="num">{stat?.blocked ? <span className="font-semibold text-bad" title={stat.blockedCodes.join(', ')}>{stat.blocked}</span> : <span className="text-faint">0</span>}</td>
        <td><Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : 'More'}</Button></td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={7}>
            <div className="grid grid-cols-1 gap-3 rounded border border-line bg-sunken/40 p-3 md:grid-cols-2">
              <Field label="Section"><Select value={f.section} onChange={(e) => onChange({ section: e.target.value })} options={sections} /></Field>
              <Field label="Help text" hint="Shown under the label while editing and on hover"><Input value={f.help ?? ''} onChange={(e) => onChange({ help: e.target.value })} /></Field>
              {f.type === 'select' && (
                <Field label="Options" hint="One per line" className="md:col-span-2">
                  <textarea className="inp" rows={Math.min(8, (f.options?.length ?? 0) + 1)} value={(f.options ?? []).join('\n')} onChange={(e) => onChange({ options: e.target.value.split('\n') })} />
                </Field>
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="h-4 w-4" checked={!!f.readOnly} disabled={system} onChange={(e) => onChange({ readOnly: e.target.checked || undefined })} />
                Read-only on the record (shown, never edited there)
              </label>
              {stat && stat.blockedCodes.length > 0 && (
                <div className="text-[12px] text-muted md:col-span-2">
                  Blocking: {stat.blockedCodes.map((c, i) => <span key={c}>{i ? ', ' : ''}<a className="font-mono text-link hover:underline" href={projectHref(c, 'info')}>{c}</a></span>)}
                </div>
              )}
              <div className="md:col-span-2">
                {system ? <span className="text-[12px] text-muted">System fields cannot be removed.</span>
                  : <ConfirmButton size="sm" confirmLabel="Remove field" onConfirm={onRemove}>Remove field</ConfirmButton>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddFieldModal({ section, onClose, taken, onAdd, stageOptions, bindOptions }: {
  section: string | null; onClose: () => void; taken: string[]; onAdd: (f: InfoFieldDef) => void
  stageOptions: { value: string; label: string }[]; bindOptions: { value: string; label: string }[]
}) {
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<InfoFieldDef['type']>('text')
  const [options, setOptions] = useState('')
  const [help, setHelp] = useState('')
  const [req, setReq] = useState('')
  const [bind, setBind] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const k = keyTouched ? key : keyFromLabel(label, taken)
  const err = !label.trim() ? 'Enter a label' : !validKey(k) ? 'Key must start with a letter and use letters and digits only' : taken.includes(k) ? 'That key is already used' : type === 'select' && !options.trim() ? 'Enter at least one option' : ''
  const reset = () => { setLabel(''); setKey(''); setKeyTouched(false); setType('text'); setOptions(''); setHelp(''); setReq(''); setBind(''); setReadOnly(false) }
  const close = () => { reset(); onClose() }
  const add = () => {
    if (err || !section) return
    onAdd({ section, key: k, label: label.trim(), type, options: type === 'select' ? options.split('\n').map((o) => o.trim()).filter(Boolean) : undefined, help: help.trim() || undefined, requiredAtStage: req === '' ? undefined : Number(req), bind: bind || undefined, readOnly: readOnly || undefined })
    reset()
  }
  const pickBind = (path: string) => {
    setBind(path)
    const b = BIND_PATHS.find((x) => x.path === path)
    if (b) { setType(b.type); if (b.options) setOptions(b.options.join('\n')); if (!label.trim()) setLabel(b.label) }
  }
  return (
    <Modal open={section !== null} onClose={close} title={`Add field to ${section ?? ''}`}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={!!err} onClick={add}>Add field</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Environmental lead" /></Field>
        <Field label="Key" hint="Permanent once saved"><Input className="font-mono" value={k} onChange={(e) => { setKey(e.target.value); setKeyTouched(true) }} /></Field>
        <Field label="Stored on"><Select value={bind} onChange={(e) => pickBind(e.target.value)} options={bindOptions} /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as InfoFieldDef['type'])} options={FIELD_TYPES.map((t) => ({ value: t.id, label: t.label }))} /></Field>
        {type === 'select' && <Field label="Options" hint="One per line" className="sm:col-span-2"><textarea className="inp" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} /></Field>}
        <Field label="Required at" className="sm:col-span-2"><Select value={req} onChange={(e) => setReq(e.target.value)} options={stageOptions} /></Field>
        <Field label="Help text" className="sm:col-span-2"><Input value={help} onChange={(e) => setHelp(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />Read-only on the record</label>
      </div>
      {req !== '' && <div className="mt-3"><Callout tone="warn">Projects already at or past this stage with the field empty will show it as a gate blocker as soon as you save.</Callout></div>}
      {err && label && <div className="mt-2 text-[12px] text-bad">{err}</div>}
    </Modal>
  )
}
