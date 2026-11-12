// Fill a deliverable's form in Crosswalk: pre-filled from the project, saved as a draft, submitted for review, and — once
// approved (or verified) — filed to the records system as a PDF with its metadata.
import { useMemo, useState } from 'react'
import type { AppState, Deliverable, DeliverableDef, FormValue, Project } from '@/core/types'
import { mutate, personName, useMe } from '@/core/store'
import { allFields, formFor, formValues, missingFields, type ChecklistValue, type DocField, type DocFormTemplate, type TableValue } from '@/core/engine/forms'
import { RECORD_STATUS_LABEL, previewSubmission, recordsOf, submissionsFor, verifyDeliverable } from '@/core/engine/records'
import { saveFile } from '@/core/download'
import { cx, fmtDateTime, money, nowISO } from '@/core/util'
import { Badge, Button, Callout, Input, Modal, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { recordPdf } from './pdf'

const LOCKED: Deliverable['status'][] = ['submitted', 'accepted', 'waived']

export function recordTone(st?: string) { return st === 'filed' ? 'good' : st === 'failed' ? 'bad' : st === 'awaiting-verification' ? 'marker' : 'info' }

export function DeliverableFormModal({ s, p, def, d, onClose, onSubmit, busy }: { s: AppState; p: Project; def: DeliverableDef; d: Deliverable; onClose: () => void; onSubmit?: () => void; busy?: boolean }) {
  const me = useMe()
  const t = formFor(def.id)!
  const [data, setData] = useState<Record<string, FormValue>>(() => formValues(s, p, t, d.form?.data ?? {}))
  const [dirty, setDirty] = useState(false)
  const editable = !LOCKED.includes(d.status) && !busy
  const missing = missingFields(t, data)
  const required = allFields(t).filter((f) => f.required && !f.readOnly).length
  const subs = submissionsFor(s, d.id)
  const rec = recordsOf(s)
  const latest = subs[0]
  const set = (k: string, v: FormValue) => { setData((x) => ({ ...x, [k]: v })); setDirty(true) }

  const save = (quiet = false) => {
    const keep = Object.fromEntries(allFields(t).filter((f) => !f.readOnly).map((f) => [f.key, data[f.key]]))
    mutate((x) => {
      const y = x.deliverables.find((z) => z.id === d.id)!
      y.form = { templateId: t.id, templateVersion: t.version, data: keep, savedAt: nowISO(), savedById: x.currentUserId }
      if (y.status === 'not-started' || y.status === 'returned') y.status = 'in-progress'
      y.updatedAt = nowISO()
    }, { entity: 'deliverable', entityId: d.id, projectId: p.id, action: 'form', summary: `${def.name}: form saved (${required - missing.length} of ${required} required answers)` })
    setDirty(false)
    if (!quiet) toast('Form saved')
  }
  const submit = () => {
    if (missing.length) { toast(`Answer the required fields first: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`, 'bad'); return }
    save(true)
    onSubmit?.()
    onClose()
  }
  const pdf = async () => {
    const sub = latest?.status === 'filed' ? latest : previewSubmission(s, { ...d, form: { templateId: t.id, templateVersion: t.version, data, savedAt: nowISO(), savedById: me.id } })
    if (!sub) return
    const res = await saveFile(sub.fileName, recordPdf(s, sub), 'application/pdf')
    if (res === 'saved') toast(`Downloaded ${sub.fileName}`)
  }
  const verify = () => {
    mutate((x) => { verifyDeliverable(x, d.id, x.currentUserId) }, { entity: 'deliverable', entityId: d.id, projectId: p.id, action: 'verify', summary: `${def.name}: verified for records and filed to ${rec.system}` })
    toast(`Verified and filed to ${rec.system}`)
  }

  return (
    <Modal open xl onClose={() => { if (dirty && editable && !confirmLeave()) return; onClose() }}
      title={<span className="flex flex-wrap items-center gap-2">{t.name}<span className="text-[13px] font-normal text-muted">{p.code} · v{d.version || 1}</span></span>}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('mr-auto text-[12px]', missing.length ? 'text-warn' : 'text-good')}>{missing.length ? `${missing.length} required answer${missing.length === 1 ? '' : 's'} left` : 'All required answers complete'}</span>
          <Button variant="secondary" onClick={pdf}>{latest?.status === 'filed' ? 'Download filed PDF' : 'Preview PDF'}</Button>
          {editable && <Button variant="secondary" onClick={() => save()} disabled={!dirty}>Save draft</Button>}
          {editable && onSubmit && <Button variant="primary" onClick={submit} disabled={missing.length > 0}>Save and submit for review</Button>}
          {!editable && <Button variant="primary" onClick={onClose}>Close</Button>}
        </div>
      }>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">{t.purpose} Grey fields come straight from Crosswalk and can't be edited here.</p>
        <RecordStatus s={s} d={d} onVerify={verify} />
        {!editable && d.status === 'submitted' && <Callout tone="info" title="In review">The reviewer is checking this form. It is locked until they accept it or return it.</Callout>}
        <FormBody t={t} data={data} editable={editable} onChange={set} />
      </div>
    </Modal>
  )
}

function confirmLeave() { try { return window.confirm('Discard unsaved changes to this form?') } catch { return true } }

/** Where the record stands in the records system. */
export function RecordStatus({ s, d, onVerify }: { s: AppState; d: Deliverable; onVerify?: () => void }) {
  const rec = recordsOf(s)
  const subs = submissionsFor(s, d.id)
  const latest = subs[0]
  if (d.status !== 'accepted' && !latest) {
    return <div className="rounded-md border border-line bg-sunken/40 px-3 py-2 text-[12.5px] text-muted">When this is {rec.trigger === 'approval' ? 'approved' : 'approved and verified by records'}, Crosswalk files the PDF and its metadata to <b className="text-ink">{rec.system}</b>.</div>
  }
  if (d.status === 'accepted' && !latest) {
    return <div className="rounded-md border border-line bg-sunken/40 px-3 py-2 text-[12.5px] text-muted">Accepted before records filing was switched on; not filed from Crosswalk.</div>
  }
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[12.5px]', latest.status === 'filed' ? 'border-good/40 bg-good/5' : latest.status === 'awaiting-verification' ? 'border-marker/50 bg-marker/10' : 'border-bad/40 bg-bad/5')}>
      <Badge tone={recordTone(latest.status)}>{RECORD_STATUS_LABEL[latest.status]}</Badge>
      {latest.status === 'filed' && <span>Filed to <b>{rec.system}</b> as node <span className="font-mono">{latest.nodeId}</span> on {fmtDateTime(latest.sentAt)}</span>}
      {latest.status === 'awaiting-verification' && <span>Approved. Records verifies it before it is filed to <b>{rec.system}</b>.</span>}
      {latest.status === 'failed' && <span>{latest.error}</span>}
      <span className="basis-full truncate text-[11.5px] text-muted" title={latest.folder}>{latest.folder} / {latest.fileName}</span>
      {latest.status === 'awaiting-verification' && onVerify && <Button size="sm" variant="primary" onClick={onVerify}>Verify and file</Button>}
      {d.verifiedById && <span className="text-[11.5px] text-muted">Verified by {personName(s, d.verifiedById)} {fmtDateTime(d.verifiedAt)}</span>}
      <a href="#filing" className="text-[12px] font-semibold text-link">Records filing →</a>
    </div>
  )
}

export function FormBody({ t, data, editable, onChange }: { t: DocFormTemplate; data: Record<string, FormValue>; editable: boolean; onChange: (k: string, v: FormValue) => void }) {
  return (
    <div className="flex flex-col gap-5">
      {t.sections.map((sec) => (
        <section key={sec.title}>
          <h3 className="mb-1 border-b border-line pb-1 font-display text-[14.5px] font-semibold">{sec.title}</h3>
          {sec.note && <p className="mb-2 text-[12px] text-muted">{sec.note}</p>}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            {sec.fields.map((f) => <FieldBox key={f.key} f={f} v={data[f.key]} editable={editable && !f.readOnly} onChange={(v) => onChange(f.key, v)} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function FieldBox({ f, v, editable, onChange }: { f: DocField; v: FormValue | undefined; editable: boolean; onChange: (v: FormValue) => void }) {
  const wide = f.type === 'textarea' || f.type === 'table' || f.type === 'checklist'
  const id = `ff-${f.key}`
  return (
    <div className={cx(wide && 'md:col-span-2')}>
      <label htmlFor={id} className="mb-0.5 flex items-baseline gap-1.5 text-[12.5px] font-semibold">
        {f.label}{f.required && !f.readOnly && <span className="text-bad" aria-label="required">*</span>}
        {f.unit && <span className="font-normal text-faint">({f.unit})</span>}
        {f.readOnly && <span className="rounded bg-sunken px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">From Crosswalk</span>}
      </label>
      {f.help && <div className="mb-1 text-[11.5px] text-muted">{f.help}</div>}
      <FieldInput id={id} f={f} v={v} editable={editable} onChange={onChange} />
    </div>
  )
}

function FieldInput({ id, f, v, editable, onChange }: { id: string; f: DocField; v: FormValue | undefined; editable: boolean; onChange: (v: FormValue) => void }) {
  const ro = 'inp bg-sunken/60 text-ink'
  switch (f.type) {
    case 'textarea': return editable ? <TextArea id={id} className="min-h-[72px]" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} /> : <div className={cx(ro, 'min-h-[38px] whitespace-pre-wrap')}>{String(v ?? '') || '—'}</div>
    case 'select': return editable ? <Select id={id} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} /> : <div className={ro}>{String(v ?? '') || '—'}</div>
    case 'boolean': return <label className="flex items-center gap-2 text-[13px]"><input id={id} type="checkbox" disabled={!editable} className="h-4 w-4 accent-[rgb(var(--ink))]" checked={!!v} onChange={(e) => onChange(e.target.checked)} />{v ? 'Yes' : 'No'}</label>
    case 'date': return editable ? <Input id={id} type="date" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} /> : <div className={ro}>{String(v ?? '') || '—'}</div>
    case 'number': case 'money': {
      if (!editable) return <div className={cx(ro, 'tabular-nums')}>{v === '' || v == null ? '—' : f.type === 'money' ? money(Number(v), 'full') : Number(v).toLocaleString('en-US')}</div>
      return <Input id={id} type="number" inputMode="decimal" value={v === '' || v == null ? '' : String(v)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    }
    case 'checklist': return <Checklist f={f} v={(v ?? {}) as ChecklistValue} editable={editable} onChange={onChange} />
    case 'table': return <TableInput f={f} v={(Array.isArray(v) ? v : []) as TableValue} editable={editable} onChange={onChange} />
    default: return editable ? <Input id={id} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} /> : <div className={ro}>{String(v ?? '') || '—'}</div>
  }
}

function Checklist({ f, v, editable, onChange }: { f: DocField; v: ChecklistValue; editable: boolean; onChange: (v: FormValue) => void }) {
  const choices = f.choices ?? ['Yes', 'No', 'N/A']
  return (
    <div className="divide-y divide-line rounded-md border border-line">
      {(f.items ?? []).map((item) => (
        <div key={item} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-[12.5px]">
          <span className="min-w-[180px] flex-1">{item}</span>
          <div className="inline-flex rounded border border-line p-0.5" role="radiogroup" aria-label={item}>
            {choices.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={v[item]?.v === c} disabled={!editable}
                onClick={() => onChange({ ...v, [item]: { ...v[item], v: c } })}
                className={cx('rounded px-2 py-0.5 text-[11.5px] font-semibold', v[item]?.v === c ? (c === 'No' || c === 'Issue' ? 'bg-bad text-white' : c === 'Watch' ? 'bg-marker text-markerink' : 'bg-ink text-white') : 'text-muted', editable && 'hover:text-ink')}>{c}</button>
            ))}
          </div>
          {(editable || v[item]?.note) && (editable
            ? <input aria-label={`${item} note`} className="inp w-full py-0.5 text-[12px] sm:w-56" placeholder="Note" value={v[item]?.note ?? ''} onChange={(e) => onChange({ ...v, [item]: { v: v[item]?.v ?? '', note: e.target.value } })} />
            : <span className="text-[12px] text-muted">{v[item]?.note}</span>)}
        </div>
      ))}
    </div>
  )
}

function TableInput({ f, v, editable, onChange }: { f: DocField; v: TableValue; editable: boolean; onChange: (v: FormValue) => void }) {
  const cols = useMemo(() => f.columns ?? (v[0] ? Object.keys(v[0]).map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), type: 'text' as const })) : []), [f.columns, v])
  const rows = v.length || !editable ? v : [Object.fromEntries(cols.map((c) => [c.key, '']))]
  const setCell = (i: number, k: string, x: string | number) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)))
  if (!cols.length) return <div className="text-[12.5px] text-faint">Nothing recorded.</div>
  return (
    <div className="scroll-x rounded-md border border-line">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c.key} className={cx((c.type === 'number' || c.type === 'money') && 'num')}>{c.label}</th>)}{editable && <th style={{ width: 28 }} />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className={cx((c.type === 'number' || c.type === 'money') && 'num')}>
                  {!editable ? <span className="text-[12.5px]">{c.type === 'money' && typeof r[c.key] === 'number' ? money(r[c.key] as number, 'full') : String(r[c.key] ?? '')}</span>
                    : c.type === 'select' ? <select aria-label={`${c.label} row ${i + 1}`} className="inp py-0.5 text-[12.5px]" value={String(r[c.key] ?? '')} onChange={(e) => setCell(i, c.key, e.target.value)}><option value="">—</option>{(c.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                    : <input aria-label={`${c.label} row ${i + 1}`} type={c.type === 'date' ? 'date' : c.type === 'number' || c.type === 'money' ? 'number' : 'text'} className={cx('inp py-0.5 text-[12.5px]', (c.type === 'number' || c.type === 'money') && 'text-right')} value={String(r[c.key] ?? '')}
                        onChange={(e) => setCell(i, c.key, c.type === 'number' || c.type === 'money' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
                </td>
              ))}
              {editable && <td><button type="button" aria-label={`Remove row ${i + 1}`} className="text-muted hover:text-bad" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && <div className="border-t border-line px-2 py-1"><button type="button" className="text-[12px] font-semibold text-link" onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c.key, '']))])}>+ Add row</button></div>}
    </div>
  )
}
