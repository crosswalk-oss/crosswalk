// The filed record: a deliverable's form as a PDF, with the approvals and the records metadata on the last page.
import type { AppState, FormValue, RecordsSubmission } from '@/core/types'
import { FORM_TEMPLATES, fieldText, type ChecklistValue, type DocField, type TableValue } from '@/core/engine/forms'
import { Writer } from '@/views/estimating/boe'

const person = (s: AppState, id?: string) => s.people.find((x) => x.id === id)?.name ?? '-'

function writeField(w: Writer, f: DocField, v: FormValue | undefined) {
  if (f.type === 'checklist') {
    const c = (v ?? {}) as ChecklistValue
    w.h3(f.label)
    w.table([{ label: 'Item', w: 5 }, { label: 'Answer', w: 1.4 }, { label: 'Note', w: 3 }], (f.items ?? []).map((i) => [i, c[i]?.v || '-', c[i]?.note ?? '']))
    return
  }
  if (f.type === 'table') {
    const rows = (Array.isArray(v) ? v : []) as TableValue
    w.h3(f.label)
    const cols = f.columns ?? (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k, type: 'text' as const })) : [])
    if (!rows.length || !cols.length) { w.p('None recorded', { muted: true }); return }
    w.table(cols.map((c) => ({ label: c.label, w: c.type === 'text' ? 3 : 1.6, align: c.type === 'money' || c.type === 'number' ? 'right' as const : undefined })),
      rows.map((r) => cols.map((c) => { const x = r[c.key]; return x == null ? '' : c.type === 'money' && typeof x === 'number' ? `$${Math.round(x).toLocaleString('en-US')}` : String(x) })))
    return
  }
  const text = fieldText(f, v)
  if (f.type === 'textarea') { w.h3(f.label); w.p(text || '-', { muted: !text }); return }
  w.table([{ label: f.label, w: 2 }, { label: '', w: 5 }], [[f.label, text || '-']])
}

/** Rebuilds exactly what was filed, from the submission's frozen snapshot. */
export function recordPdf(s: AppState, sub: RecordsSubmission): Blob {
  const t = FORM_TEMPLATES.find((x) => x.id === sub.snapshot.templateId)!
  const m = sub.metadata
  const w = new Writer(`Arroyo Valley Gas · ${m['Project Number']} · ${m.Deliverable} v${sub.version} · ${m['Records Class']} · Demo data, fictional utility`)
  w.doc.setFont('helvetica', 'normal'); w.doc.setFontSize(8.5); w.doc.setTextColor(120, 128, 140)
  w.doc.text('ARROYO VALLEY GAS · CAPITAL PROJECT RECORD', w.x, 36)
  w.h1(t.name)
  w.p(`${m['Project Number']} ${m['Project Name']} · ${m.Stage} · version ${sub.version}`, { muted: true })
  w.p(t.purpose)
  w.h2('Approvals')
  w.table([{ label: 'Role', w: 2 }, { label: 'Name', w: 3 }, { label: 'Date', w: 2 }], [
    ['Prepared by', person(s, sub.snapshot.ownerId), (s.deliverables.find((d) => d.id === sub.deliverableId)?.form?.savedAt ?? '').slice(0, 10)],
    ['Approved by', person(s, sub.snapshot.reviewerId), (sub.snapshot.acceptedAt ?? '').slice(0, 10)],
    ['Verified by (records)', sub.snapshot.verifiedById ? person(s, sub.snapshot.verifiedById) : '-', (sub.snapshot.verifiedAt ?? '').slice(0, 10)],
  ])
  for (const sec of t.sections) {
    w.h2(sec.title)
    if (sec.note) w.p(sec.note, { muted: true, size: 8.5 })
    const simple = sec.fields.filter((f) => !['checklist', 'table', 'textarea'].includes(f.type))
    if (simple.length) w.table([{ label: 'Field', w: 2 }, { label: 'Value', w: 5 }], simple.map((f) => [f.label, fieldText(f, sub.snapshot.data[f.key]) || '-']))
    for (const f of sec.fields.filter((x) => ['checklist', 'table', 'textarea'].includes(x.type))) writeField(w, f, sub.snapshot.data[f.key])
  }
  w.h2('Records metadata')
  w.table([{ label: 'Attribute', w: 2 }, { label: 'Value', w: 5 }], [['Folder', sub.folder], ...Object.entries(m).filter(([, v]) => v)])
  w.p(`Filed from Crosswalk ${sub.sentAt ? `on ${sub.sentAt.slice(0, 10)}` : ''}${sub.nodeId ? ` as node ${sub.nodeId}` : ''} (simulated records connector in this demo).`, { muted: true, size: 8.5 })
  return w.finish()
}
