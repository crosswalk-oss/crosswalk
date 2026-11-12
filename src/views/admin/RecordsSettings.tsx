// Configuration → Records & forms: when approved deliverables are filed, where they go, and how each deliverable maps
// to its form, document type, records class and retention. One audited save.
import { useState } from 'react'
import type { DeliverableDef, RecordsMapping, RecordsSettings } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { allFields, formFor, formValues } from '@/core/engine/forms'
import { DEFAULT_RECORDS, mappingFor, recordsOf } from '@/core/engine/records'
import { Badge, Button, Callout, Field, Input, Modal, Panel, Select } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { SaveBar, cellInp, useDraft } from '../estimating/admin/shared'
import { FormBody } from '../records/DeliverableForm'

type Cfg = Omit<RecordsSettings, 'paused'>

export default function RecordsSettingsTab() {
  const s = useStore()
  const saved = recordsOf(s)
  const { paused: _p, ...current } = saved
  const D = useDraft<Cfg>(current)
  const d = D.draft
  const [preview, setPreview] = useState<DeliverableDef | null>(null)
  const roles = s.roles.map((r) => ({ value: r.id, label: r.name }))
  const setMap = (def: DeliverableDef, patch: Partial<RecordsMapping>) => D.set((x) => ({ ...x, mappings: { ...x.mappings, [def.id]: { ...(x.mappings[def.id] ?? mappingFor({ settings: { ...s.settings, records: x } }, def)), ...patch } } }))
  const save = () => {
    const changes: string[] = []
    if (saved.trigger !== d.trigger) changes.push(`file ${d.trigger === 'approval' ? 'on approval' : 'after records verification'}`)
    for (const k of ['system', 'baseUrl', 'rootFolder', 'verifierRole', 'mode'] as const) if (saved[k] !== d[k]) changes.push(`${k} → ${d[k]}`)
    const mapped = Object.keys(d.mappings).filter((k) => JSON.stringify(d.mappings[k]) !== JSON.stringify(saved.mappings[k]))
    if (mapped.length) changes.push(`records mapping for ${mapped.length} deliverable${mapped.length === 1 ? '' : 's'}`)
    mutate((x) => { x.settings.records = { ...d, paused: false } }, { entity: 'records-settings', entityId: 'records', action: 'update', summary: `Records & forms: ${changes.join('; ') || 'no change'}` })
    D.commit()
    toast('Records settings saved')
  }

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="Complete in Crosswalk, file to the records system">
        Every gate deliverable has a form in Crosswalk, pre-filled from the project. The owner completes it, the reviewer accepts it in the deliverable-review workflow, and Crosswalk files the PDF and its metadata to {d.system} — either on approval, or after records verifies it. Demo filing is simulated; see <a className="font-semibold text-link" href="#filing">Records filing</a> for the requests a live connector would send.
      </Callout>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="When to file">
          <div className="flex flex-col gap-3 text-[13px]">
            {(['approval', 'verification'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input type="radio" name="rec-trigger" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={d.trigger === k} onChange={() => D.set((x) => ({ ...x, trigger: k }))} />
                <span>{k === 'approval' ? <><b>On approval</b> <span className="text-muted">— as soon as the reviewer accepts the deliverable.</span></> : <><b>After records verification</b> <span className="text-muted">— records checks the approved deliverable (complete, correctly indexed) and files it with one click.</span></>}</span>
              </label>
            ))}
            {d.trigger === 'verification' && <Field label="Who verifies"><Select value={d.verifierRole} onChange={(e) => D.set((x) => ({ ...x, verifierRole: e.target.value as Cfg['verifierRole'] }))} options={roles} /></Field>}
          </div>
        </Panel>
        <Panel title="Records system">
          <div className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
            <Field label="System"><Input value={d.system} onChange={(e) => D.set((x) => ({ ...x, system: e.target.value }))} /></Field>
            <Field label="Connector"><Select value={d.mode} onChange={(e) => D.set((x) => ({ ...x, mode: e.target.value as Cfg['mode'] }))} options={[{ value: 'simulated', label: 'Simulated (demo)' }, { value: 'live', label: 'Live connector (not available in the demo)' }]} /></Field>
            <div className="sm:col-span-2"><Field label="REST endpoint" hint="Fictional in the demo."><Input value={d.baseUrl} onChange={(e) => D.set((x) => ({ ...x, baseUrl: e.target.value }))} /></Field></div>
            <div className="sm:col-span-2"><Field label="Folder pattern" hint="{program}, {project} and {stage} are filled in."><Input value={d.rootFolder} onChange={(e) => D.set((x) => ({ ...x, rootFolder: e.target.value }))} /></Field></div>
            <div><Button size="sm" variant="ghost" onClick={() => D.set((x) => ({ ...x, system: DEFAULT_RECORDS.system, baseUrl: DEFAULT_RECORDS.baseUrl, rootFolder: DEFAULT_RECORDS.rootFolder, mode: 'simulated' }))}>Restore defaults</Button></div>
          </div>
        </Panel>
      </div>

      {s.templates.map((tpl) => (
        <Panel key={tpl.id} pad={false} title={<span className="inline-flex items-center gap-2">{tpl.name}<Badge tone="marker">Records classes and retention — verify</Badge></span>} subtitle="Each gate deliverable, its form, and how it is filed. Edit a cell to override the default for that deliverable.">
          <div className="scroll-x">
            <table className="tbl min-w-[1300px]">
              <thead><tr><th>Stage</th><th style={{ minWidth: 220 }}>Deliverable</th><th>Form</th><th>Document type</th><th>Records class</th><th>Retention</th></tr></thead>
              <tbody>
                {tpl.stages.flatMap((st) => st.gate.deliverables.map((def, i) => {
                  const f = formFor(def.id)
                  const m = d.mappings[def.id] ?? mappingFor({ settings: { ...s.settings, records: d } }, def)
                  const custom = !!d.mappings[def.id]
                  return (
                    <tr key={`${st.id}-${def.id}`}>
                      <td className="whitespace-nowrap text-[12px] text-muted">{i === 0 ? `${st.index + 1} · ${st.name}` : ''}</td>
                      <td className="text-[12.5px]"><b>{def.name}</b>{def.condition && <span className="ml-1 text-[11px] text-faint">(when applicable)</span>}<div className="text-[11.5px] text-muted">{def.description}</div></td>
                      <td className="text-[12.5px]">{f ? <button type="button" className="text-left font-semibold text-link" onClick={() => setPreview(def)}>{f.name}<div className="text-[11px] font-normal text-muted">{allFields(f).length} fields · preview</div></button> : '—'}</td>
                      <td><Input aria-label={`${def.name} document type`} className={`${cellInp} min-w-[190px]`} value={m.docType} onChange={(e) => setMap(def, { docType: e.target.value })} /></td>
                      <td><Input aria-label={`${def.name} records class`} className={`${cellInp} min-w-[250px]`} value={m.recordsClass} onChange={(e) => setMap(def, { recordsClass: e.target.value })} /></td>
                      <td>
                        <Input aria-label={`${def.name} retention`} className={`${cellInp} min-w-[180px]`} value={m.retention} onChange={(e) => setMap(def, { retention: e.target.value })} />
                        {custom && <button type="button" className="mt-0.5 text-[11px] text-link" onClick={() => D.set((x) => { const { [def.id]: _, ...rest } = x.mappings; return { ...x, mappings: rest } })}>Use default</button>}
                      </td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      <div className="sticky bottom-0 z-10 overflow-hidden rounded-md border border-line bg-surface empty:hidden">
        <SaveBar dirty={D.dirty} onSave={save} onDiscard={D.reset} note="Applies to records filed from now on; records already filed keep their metadata." />
      </div>
      {preview && <FormPreview def={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function FormPreview({ def, onClose }: { def: DeliverableDef; onClose: () => void }) {
  const s = useStore()
  const t = formFor(def.id)!
  const p = s.projects.find((x) => x.status === 'active')!
  return (
    <Modal open xl onClose={onClose} title={<span>{t.name} <span className="text-[13px] font-normal text-muted">preview with {p.code}</span></span>} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-[13px] text-muted">{t.purpose} Fields marked "From Crosswalk" fill themselves from the project; the rest are completed by the owner.</p>
      <FormBody t={t} data={formValues(s, p, t, {})} editable={false} onChange={() => {}} />
    </Modal>
  )
}
