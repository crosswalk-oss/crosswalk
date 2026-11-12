// Records filing: every approved deliverable Crosswalk has sent to the records system, with its metadata, the folder it
// went to, the PDF, and the exact requests a live OpenText connector would send.
import { useMemo, useState } from 'react'
import type { RecordsSubmission } from '@/core/types'
import { mutate, personName, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDateTime } from '@/core/util'
import { deliverableDef } from '@/core/engine/forms'
import { RECORD_STATUS_LABEL, recordsOf, requestPreview, retryRecord, verifyDeliverable } from '@/core/engine/records'
import { Badge, Button, Callout, PageHeader, Panel, SegButtons, Stat } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { recordPdf } from './pdf'
import { recordTone } from './DeliverableForm'

type Filter = 'all' | 'filed' | 'awaiting-verification' | 'failed'

export default function RecordsFiling() {
  const s = useStore()
  const rec = recordsOf(s)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const subs = useMemo(() => [...(s.recordsSubmissions ?? [])].sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt)), [s.recordsSubmissions])
  const shown = subs.filter((x) => filter === 'all' || x.status === filter)
  const inProgress = s.deliverables.filter((d) => d.form && (d.status === 'in-progress' || d.status === 'not-started' || d.status === 'returned')).length
  const inReview = s.deliverables.filter((d) => d.form && d.status === 'submitted').length
  const count = (st: RecordsSubmission['status']) => subs.filter((x) => x.status === st).length

  const pdf = async (sub: RecordsSubmission) => { const r = await saveFile(sub.fileName, recordPdf(s, sub), 'application/pdf'); if (r === 'saved') toast(`Downloaded ${sub.fileName}`) }
  const verify = (sub: RecordsSubmission) => {
    mutate((d) => { verifyDeliverable(d, sub.deliverableId, d.currentUserId) }, { entity: 'deliverable', entityId: sub.deliverableId, projectId: sub.projectId, action: 'verify', summary: `${sub.metadata.Deliverable} v${sub.version}: verified for records and filed to ${rec.system}` })
    toast(`Verified and filed to ${rec.system}`)
  }
  const retry = (sub: RecordsSubmission) => { mutate((d) => { retryRecord(d, sub.id) }, { entity: 'records', entityId: sub.id, projectId: sub.projectId, action: 'retry', summary: `Retried filing ${sub.fileName}` }) }
  const exportCsv = async () => {
    const rows = subs.map((x) => ({ status: RECORD_STATUS_LABEL[x.status], sent: x.sentAt ?? '', node: x.nodeId ?? '', file: x.fileName, folder: x.folder, ...x.metadata }))
    const r = await saveFile(`records-filing-${s.settings.asOf}.csv`, toCSV(rows), 'text/csv')
    if (r === 'saved') toast('Exported')
  }

  return (
    <div>
      <PageHeader eyebrow="Controls" title="Records filing"
        subtitle={`Deliverables are completed as forms in Crosswalk. When one is ${rec.trigger === 'approval' ? 'approved' : 'approved and verified by records'}, Crosswalk files the PDF and its metadata to ${rec.system} — no re-keying, no separate upload.`}
        actions={<><a href="#admin-records" className="text-[12.5px] font-semibold text-link">Configure</a><Button variant="secondary" onClick={exportCsv}>Export CSV</Button></>} />
      {rec.mode === 'simulated' && <Callout tone="info" title="Demo connector">Filing is simulated: nothing leaves Crosswalk. Each record shows the requests a live {rec.system} connector would send, so IT can review the integration.</Callout>}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Filed" value={String(count('filed'))} tone="good" />
        <Stat label="Awaiting verification" value={String(count('awaiting-verification'))} sub={rec.trigger === 'verification' ? 'Records verifies before filing' : 'Filing on approval'} />
        <Stat label="Failed" value={String(count('failed'))} tone={count('failed') ? 'bad' : undefined} />
        <Stat label="Forms in review" value={String(inReview)} sub="File as soon as they are accepted" />
        <Stat label="Forms in progress" value={String(inProgress)} />
      </div>
      <Panel className="mt-4" pad={false} title="Filed records" actions={<SegButtons value={filter} onChange={(v) => setFilter(v as Filter)} options={[{ id: 'all', label: 'All' }, { id: 'filed', label: 'Filed' }, { id: 'awaiting-verification', label: 'Awaiting verification' }, { id: 'failed', label: 'Failed' }]} />}>
        {!shown.length ? <div className="px-4 py-6 text-[13px] text-muted">Nothing here yet. Accept a deliverable whose form is complete and it appears here.</div> : (
          <div className="scroll-x">
            <table className="tbl min-w-[1100px]">
              <thead><tr><th>When</th><th>Project</th><th>Deliverable</th><th className="num">Ver.</th><th>Status</th><th>Records class</th><th>Node</th><th /></tr></thead>
              <tbody>
                {shown.map((x) => {
                  const def = deliverableDef(s, x)
                  const isOpen = open === x.id
                  return (
                    <FragmentRow key={x.id} open={isOpen} onToggle={() => setOpen(isOpen ? null : x.id)}
                      cells={<>
                        <td className="whitespace-nowrap text-[12.5px]">{fmtDateTime(x.sentAt ?? x.createdAt)}</td>
                        <td className="text-[12.5px]"><a href={projectHref(x.metadata['Project Number'], 'lifecycle')} className="font-mono text-[12px] font-semibold text-link" onClick={(e) => e.stopPropagation()}>{x.metadata['Project Number']}</a><div className="max-w-[220px] truncate text-muted">{x.metadata['Project Name']}</div></td>
                        <td className="text-[12.5px]"><b>{def?.name ?? x.metadata.Deliverable}</b><div className="text-muted">{x.metadata.Stage}</div></td>
                        <td className="num">{x.version}</td>
                        <td><Badge tone={recordTone(x.status)}>{RECORD_STATUS_LABEL[x.status]}</Badge></td>
                        <td className="text-[12px]">{x.metadata['Records Class']}<div className="text-faint">{x.metadata.Retention}</div></td>
                        <td className="font-mono text-[12px]">{x.nodeId ?? '—'}</td>
                        <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          {x.status === 'awaiting-verification' && <Button size="sm" variant="primary" onClick={() => verify(x)}>Verify and file</Button>}
                          {x.status === 'failed' && <Button size="sm" onClick={() => retry(x)}>Retry</Button>}
                          <Button size="sm" variant="ghost" onClick={() => pdf(x)}>PDF</Button>
                        </td>
                      </>}
                      detail={<SubmissionDetail sub={x} />} />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function FragmentRow({ cells, detail, open, onToggle }: { cells: React.ReactNode; detail: React.ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={cx('cursor-pointer', open && 'bg-sunken/40')} onClick={onToggle} aria-expanded={open}>{cells}</tr>
      {open && <tr><td colSpan={8} className="bg-sunken/30 p-0">{detail}</td></tr>}
    </>
  )
}

function SubmissionDetail({ sub }: { sub: RecordsSubmission }) {
  const s = useStore()
  const reqs = requestPreview(s, sub)
  return (
    <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
      <div>
        <div className="eyebrow mb-1">Metadata sent with the record</div>
        <table className="w-full text-[12.5px]">
          <tbody>
            <tr className="border-b border-line"><td className="py-1 pr-3 text-muted">Folder</td><td className="py-1">{sub.folder}</td></tr>
            <tr className="border-b border-line"><td className="py-1 pr-3 text-muted">File</td><td className="py-1 font-mono text-[12px]">{sub.fileName}</td></tr>
            {Object.entries(sub.metadata).map(([k, v]) => <tr key={k} className="border-b border-line last:border-0"><td className="py-1 pr-3 text-muted">{k}</td><td className="py-1">{v || '—'}</td></tr>)}
          </tbody>
        </table>
        <div className="mt-2 text-[11.5px] text-faint">Created {fmtDateTime(sub.createdAt)} by {personName(s, sub.createdById)} · trigger: {sub.trigger === 'approval' ? 'on approval' : 'after records verification'}</div>
      </div>
      <div>
        <div className="eyebrow mb-1">What a live {recordsOf(s).system} connector sends</div>
        <ol className="flex flex-col gap-2">
          {reqs.map((r, i) => (
            <li key={i} className="rounded-md border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-2.5 py-1 font-mono text-[11.5px]"><b>{r.method}</b><span className="truncate text-muted" title={r.url}>{r.url}</span></div>
              <pre className="max-h-48 overflow-auto px-2.5 py-1.5 text-[11px] leading-snug">{JSON.stringify(r.body, null, 2)}</pre>
            </li>
          ))}
        </ol>
        <div className="mt-1 text-[11.5px] text-muted">Content Server REST API: sign in, upload the PDF into the project folder (or add a version to the node already filed), then set the Capital Project Record category attributes.</div>
      </div>
    </div>
  )
}
