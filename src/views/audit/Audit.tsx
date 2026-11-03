// Full audit log: who changed what, when, filterable and exportable, with per-record history.
import { useMemo, useState } from 'react'
import type { AuditEntry } from '@/core/types'
import { personName, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDateTime, num } from '@/core/util'
import { Avatar, Badge, Button, Drawer, Empty, Field, Input, KV, PageHeader, Panel, Select, StatusBadge, type Tone } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProjectSelect } from '../shared/pickers'
import { WorkflowStatus } from '../shared/WorkflowStatus'

const PAGE = 100

const actionTone = (a: string): Tone => {
  const x = a.toLowerCase()
  if (['approve', 'go', 'accept', 'verify', 'complete', 'award'].some((k) => x.includes(k))) return 'good'
  if (['reject', 'delete', 'cancel', 'recall'].some((k) => x.includes(k))) return 'bad'
  if (['return', 'recycle', 'hold', 'waive'].some((k) => x.includes(k))) return 'warn'
  if (['start', 'submit', 'create', 'import', 'export'].some((k) => x.includes(k))) return 'info'
  return 'neutral'
}

export default function Audit(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const [actor, setActor] = useState('')
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [project, setProject] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [drill, setDrill] = useState<{ entity: string; entityId: string } | null>(null)

  const all = useMemo(() => [...s.audit].sort((a, b) => b.at.localeCompare(a.at)), [s.audit])
  const entities = useMemo(() => Array.from(new Set(s.audit.map((a) => a.entity))).sort(), [s.audit])
  const actions = useMemo(() => Array.from(new Set(s.audit.filter((a) => !entity || a.entity === entity).map((a) => a.action))).sort(), [s.audit, entity])
  const code = (pid?: string) => (pid ? s.projects.find((p) => p.id === pid)?.code ?? pid : '')
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return all.filter((a) =>
      (!actor || a.actorId === actor) && (!entity || a.entity === entity) && (!action || a.action === action) && (!project || a.projectId === project) &&
      (!from || a.at.slice(0, 10) >= from) && (!to || a.at.slice(0, 10) <= to) &&
      (!ql || (a.summary + ' ' + a.entityId + ' ' + code(a.projectId) + ' ' + personName(s, a.actorId)).toLowerCase().includes(ql)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, actor, entity, action, project, from, to, q])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const pg = Math.min(page, pages - 1)
  const shown = rows.slice(pg * PAGE, pg * PAGE + PAGE)
  const filtered = actor || entity || action || project || from || to || q
  const clear = () => { setActor(''); setEntity(''); setAction(''); setProject(''); setFrom(''); setTo(''); setQ(''); setPage(0) }
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0) }

  const exportCsv = async () => {
    const data = rows.map((a) => ({ timestamp: a.at, actor: personName(s, a.actorId), actor_id: a.actorId, entity: a.entity, entity_id: a.entityId, project: code(a.projectId), action: a.action, summary: a.summary }))
    const r = await saveFile(`audit-log-${s.settings.asOf}${filtered ? '-filtered' : ''}.csv`, toCSV(data), 'text/csv')
    toast(r === 'saved' ? `Exported ${num(data.length)} audit entries` : 'Download not available here', r === 'saved' ? 'good' : 'info')
  }

  const actors = new Set(rows.map((a) => a.actorId)).size
  const last7 = all.filter((a) => a.at.slice(0, 10) >= new Date(Date.parse(s.settings.asOf) - 7 * 864e5).toISOString().slice(0, 10)).length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Configure" title="Audit log"
        subtitle="Every decision, approval, configuration change and record edit, with who made it and when. Entries are append-only and cannot be edited or deleted."
        actions={<Button onClick={exportCsv}>Export {filtered ? 'filtered ' : ''}CSV</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KVStat label="Entries" value={num(s.audit.length)} />
        <KVStat label="Matching filters" value={num(rows.length)} />
        <KVStat label="People in result" value={num(actors)} />
        <KVStat label="Last 7 days" value={num(last7)} />
      </div>
      <Panel pad={false}>
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <Field label="Search" className="sm:col-span-2"><Input id="audit-q" placeholder="Summary, record id, project, person" value={q} onChange={(e) => reset(setQ)(e.target.value)} /></Field>
          <Field label="Actor"><Select value={actor} onChange={(e) => reset(setActor)(e.target.value)} options={[{ value: '', label: 'Anyone' }, { value: 'system', label: 'System' }, ...s.people.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
          <Field label="Entity"><Select value={entity} onChange={(e) => { setEntity(e.target.value); setAction(''); setPage(0) }} options={[{ value: '', label: 'All entities' }, ...entities]} /></Field>
          <Field label="Action"><Select value={action} onChange={(e) => reset(setAction)(e.target.value)} options={[{ value: '', label: 'All actions' }, ...actions]} /></Field>
          <Field label="Project"><ProjectSelect includeAll value={project} onChange={reset(setProject)} /></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} /></Field>
        </div>
        {filtered && <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[12px] text-muted"><span>{num(rows.length)} of {num(s.audit.length)} entries</span><Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button></div>}
        {rows.length === 0 ? <div className="p-4"><Empty title="No entries match">Widen the date range or clear a filter.</Empty></div> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th style={{ width: 170 }}>When</th><th>Who</th><th>Action</th><th>Record</th><th>Project</th><th>Summary</th></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => setDrill({ entity: a.entity, entityId: a.entityId })}>
                    <td className="whitespace-nowrap text-[12px] tabular-nums text-muted">{fmtDateTime(a.at)}</td>
                    <td className="whitespace-nowrap"><span className="flex items-center gap-1.5">{a.actorId !== 'system' && <Avatar name={personName(s, a.actorId)} size={18} />}<span className="text-[13px]">{personName(s, a.actorId)}</span></span></td>
                    <td><Badge tone={actionTone(a.action)}>{a.action}</Badge></td>
                    <td className="whitespace-nowrap"><span className="text-[12px] font-semibold">{a.entity}</span> <span className="font-mono text-[11px] text-faint">{a.entityId.length > 18 ? a.entityId.slice(0, 16) + '…' : a.entityId}</span></td>
                    <td>{a.projectId ? <a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(a.projectId)} onClick={(e) => e.stopPropagation()}>{code(a.projectId)}</a> : <span className="text-faint">—</span>}</td>
                    <td className="min-w-[280px] text-[13px]">{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > PAGE && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
            <span>Showing {num(pg * PAGE + 1)}–{num(Math.min(rows.length, pg * PAGE + PAGE))} of {num(rows.length)}</span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={pg === 0} onClick={() => setPage(0)}>First</Button>
              <Button size="sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>Newer</Button>
              <span className="px-2 tabular-nums">Page {pg + 1} of {pages}</span>
              <Button size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Older</Button>
              <Button size="sm" variant="ghost" disabled={pg >= pages - 1} onClick={() => setPage(pages - 1)}>Last</Button>
            </span>
          </div>
        )}
      </Panel>
      <RecordHistory drill={drill} onClose={() => setDrill(null)} all={all} />
    </div>
  )
}

function KVStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-line bg-surface px-4 py-2.5"><div className="eyebrow">{label}</div><div className="font-display text-[20px] font-bold tabular-nums">{value}</div></div>
}

/** Describe the record behind an audit entry and show its full history. */
function RecordHistory({ drill, onClose, all }: { drill: { entity: string; entityId: string } | null; onClose: () => void; all: AuditEntry[] }) {
  const s = useStore()
  if (!drill) return null
  const hist = all.filter((a) => a.entityId === drill.entityId && a.entity === drill.entity).slice().reverse()
  const first = hist[0]
  const wf = drill.entity === 'workflow' ? s.workflows.find((w) => w.id === drill.entityId) : s.workflows.find((w) => w.recordId === drill.entityId)
  const p = s.projects.find((x) => x.id === (first?.projectId ?? drill.entityId))
  const facts: [string, React.ReactNode][] = [['Entity', drill.entity], ['Record id', <span className="font-mono text-[12px]">{drill.entityId}</span>]]
  if (p) facts.push(['Project', <a className="text-link hover:underline" href={projectHref(p.id)}>{p.code} · {p.name}</a>])
  if (wf) facts.push(['Workflow', <span>{wf.title} <StatusBadge status={wf.status} /></span>], ['Process', `${wf.defKey} v${wf.defVersion}`])
  const linked = wf ? s.audit.filter((a) => a.entityId === wf.recordId && a.entity !== 'workflow').length : 0
  return (
    <Drawer open onClose={onClose} title="Record history" width={620}>
      <div className="flex flex-col gap-4">
        <KV items={facts} />
        {linked > 0 && <p className="text-[12px] text-muted">{linked} more entr{linked === 1 ? 'y' : 'ies'} on the underlying {wf!.recordType} record.</p>}
        <div>
          <div className="eyebrow mb-2">{hist.length} audit entr{hist.length === 1 ? 'y' : 'ies'}, oldest first</div>
          <ol className="relative ml-2 border-l border-line">
            {hist.map((a) => (
              <li key={a.id} className="mb-3 ml-4">
                <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', info: 'bg-info' }[actionTone(a.action) as string] ?? 'bg-faint')} />
                <div className="flex flex-wrap items-center gap-x-2 text-[13px]"><b>{personName(s, a.actorId)}</b><Badge tone={actionTone(a.action)}>{a.action}</Badge><span className="text-[11px] text-faint">{fmtDateTime(a.at)}</span></div>
                <p className="text-[13px] text-muted">{a.summary}</p>
              </li>
            ))}
          </ol>
        </div>
        {wf && <WorkflowStatus instanceId={wf.id} compact />}
      </div>
    </Drawer>
  )
}
