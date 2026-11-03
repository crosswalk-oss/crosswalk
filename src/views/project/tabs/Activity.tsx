// Project activity: the project's workflow instances (running first) and its audit trail as a filterable timeline.
import { useMemo, useState } from 'react'
import type { AuditEntry } from '@/core/types'
import { personName, useStore } from '@/core/store'
import { workflowHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, fmtDateTime } from '@/core/util'
import { Badge, Button, Empty, Field, Input, Panel, SegButtons, Select, StatusBadge, type Tone } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { fmtDur, nowMs, recordTypeLabel } from '../../workflows/lib'

const tone = (a: string): Tone => {
  const x = a.toLowerCase()
  if (['approve', 'accept', 'go', 'verify', 'complete', 'award', 'e-sign', 'publish'].some((k) => x.includes(k))) return 'good'
  if (['reject', 'cancel', 'recall', 'delete'].some((k) => x.includes(k))) return 'bad'
  if (['return', 'recycle', 'hold', 'waive'].some((k) => x.includes(k))) return 'warn'
  if (['start', 'submit', 'create', 'snapshot'].some((k) => x.includes(k))) return 'info'
  return 'neutral'
}

export default function Activity({ projectId }: { projectId: string; id?: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)
  const insts = useMemo(() => s.workflows.filter((w) => w.projectId === projectId).sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt.localeCompare(a.startedAt)), [s.workflows, projectId])
  const [wfFilter, setWfFilter] = useState<'running' | 'all'>('running')
  const [showAll, setShowAll] = useState(false)
  const running = insts.filter((w) => w.status === 'running')
  const shownInsts = (wfFilter === 'running' ? running : insts).slice(0, showAll ? 999 : 8)

  const audit = useMemo(() => s.audit.filter((a) => a.projectId === projectId).slice().sort((a, b) => b.at.localeCompare(a.at)), [s.audit, projectId])
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const entities = Array.from(new Set(audit.map((a) => a.entity))).sort()
  const actions = Array.from(new Set(audit.filter((a) => !entity || a.entity === entity).map((a) => a.action))).sort()
  const actors = Array.from(new Set(audit.map((a) => a.actorId)))
  const rows = audit.filter((a) => (!entity || a.entity === entity) && (!action || a.action === action) && (!actor || a.actorId === actor) && (!from || a.at.slice(0, 10) >= from) && (!to || a.at.slice(0, 10) <= to) && (!q || (a.summary + ' ' + personName(s, a.actorId)).toLowerCase().includes(q.toLowerCase())))
  const byDay = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = []
    for (const a of rows.slice(0, limit)) { const d = a.at.slice(0, 10); const last = out[out.length - 1]; if (last?.day === d) last.items.push(a); else out.push({ day: d, items: [a] }) }
    return out
  }, [rows, limit])
  const filtered = !!(entity || action || actor || from || to || q)

  const exportCsv = async () => {
    const data = rows.map((a) => ({ timestamp: a.at, project: p?.code ?? '', entity: a.entity, entity_id: a.entityId, action: a.action, actor: personName(s, a.actorId), actor_id: a.actorId, summary: a.summary }))
    if (!data.length) { toast('Nothing to export', 'info'); return }
    const r = await saveFile(`${p?.code ?? projectId}-audit-trail.csv`, toCSV(data), 'text/csv')
    toast(r === 'saved' ? `Exported ${data.length} audit entries` : r === 'declined' ? 'Export cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }

  const now = nowMs(s)
  const signed = insts.reduce((a, w) => a + w.history.filter((h) => h.signature).length, 0)
  const overdue = running.filter((w) => w.active.some((x) => x.due && x.due < s.settings.asOf)).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fig label="Workflows in progress" value={running.length} tone={running.length ? 'marker' : undefined} />
        <Fig label="Overdue steps" value={overdue} tone={overdue ? 'bad' : undefined} />
        <Fig label="Completed workflows" value={insts.length - running.length} />
        <Fig label="E-signed decisions" value={signed} />
      </div>

      <Panel title="Workflows" subtitle="Every approval on this project, with who acted, when and under which process version."
        actions={<SegButtons value={wfFilter} onChange={setWfFilter} options={[{ id: 'running', label: `Running (${running.length})` }, { id: 'all', label: `All (${insts.length})` }]} />}>
        {shownInsts.length ? (
          <div className="flex flex-col gap-2">
            {shownInsts.map((w) => (
              <div key={w.id} className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                  <b className="text-[13px] text-ink">{w.title}</b>
                  <span>{recordTypeLabel(w.recordType)}</span>
                  <span>started {fmtDate(w.startedAt.slice(0, 10))} by {personName(s, w.startedById)}</span>
                  <span>{w.status === 'running' ? `${fmtDur((now - Date.parse(w.startedAt)) / 36e5)} in flight` : w.completedAt ? `took ${fmtDur((Date.parse(w.completedAt) - Date.parse(w.startedAt)) / 36e5)}` : ''}</span>
                  <a href={workflowHref(w.defKey)} className="text-link">process v{w.defVersion}</a>
                </div>
                <WorkflowStatus instanceId={w.id} compact />
              </div>
            ))}
            {(wfFilter === 'running' ? running : insts).length > 8 && !showAll && <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all {(wfFilter === 'running' ? running : insts).length}</Button>}
          </div>
        ) : <Empty title={wfFilter === 'running' ? 'No workflows in progress' : 'No workflows yet'}>{wfFilter === 'running' && insts.length ? <button className="font-semibold text-link" onClick={() => setWfFilter('all')}>Show the {insts.length} completed</button> : 'Approvals started on this project appear here.'}</Empty>}
      </Panel>

      <Panel title="Audit trail" subtitle={`${audit.length} entries — every change to this project's records, who made it and when.`} pad={false}
        actions={<Button size="sm" icon={<Icon name="download" className="h-3.5 w-3.5" />} onClick={exportCsv}>Export CSV{filtered ? ` (${rows.length})` : ''}</Button>}>
        <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 md:grid-cols-6">
          <Field label="Search" className="col-span-2"><Input placeholder="Summary or person" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Entity"><Select value={entity} onChange={(e) => { setEntity(e.target.value); setAction('') }} options={[{ value: '', label: 'All' }, ...entities]} /></Field>
          <Field label="Action"><Select value={action} onChange={(e) => setAction(e.target.value)} options={[{ value: '', label: 'All' }, ...actions]} /></Field>
          <Field label="Actor"><Select value={actor} onChange={(e) => setActor(e.target.value)} options={[{ value: '', label: 'Anyone' }, ...actors.map((a) => ({ value: a, label: personName(s, a) }))]} /></Field>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-1.5" /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-1.5" /></Field>
          </div>
        </div>
        {filtered && <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[12px] text-muted">{rows.length} of {audit.length} entries <button className="font-semibold text-link" onClick={() => { setEntity(''); setAction(''); setActor(''); setFrom(''); setTo(''); setQ('') }}>Clear filters</button></div>}
        {byDay.length ? (
          <div className="px-4 py-3">
            {byDay.map((g) => (
              <div key={g.day} className="mb-3 last:mb-0">
                <div className="eyebrow mb-1.5">{fmtDate(g.day)}</div>
                <ol className="relative ml-2 border-l border-line">
                  {g.items.map((a) => (
                    <li key={a.id} className="mb-2 ml-4 last:mb-0">
                      <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', { good: 'bg-good', bad: 'bg-bad', warn: 'bg-warn', info: 'bg-info' }[tone(a.action) as 'good'] ?? 'bg-faint')} />
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                        <span className="w-[62px] shrink-0 tabular-nums text-faint">{new Date(a.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        <Badge tone="neutral">{a.entity}</Badge>
                        <Badge tone={tone(a.action)}>{a.action}</Badge>
                        <b>{personName(s, a.actorId)}</b>
                      </div>
                      <p className="ml-[70px] mt-0.5 text-[12.5px] text-muted max-sm:ml-0">{a.summary}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {rows.length > limit && <div className="pt-2"><Button size="sm" variant="ghost" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} older)</Button></div>}
          </div>
        ) : <div className="p-4"><Empty title={filtered ? 'No entries match' : 'No audit entries yet'}>{filtered ? 'Widen the filters.' : 'Changes to this project will be recorded here.'}</Empty></div>}
        <div className="border-t border-line px-4 py-2 text-[11.5px] text-faint">Last entry {audit[0] ? fmtDateTime(audit[0].at) : '—'} · entries cannot be edited or deleted.</div>
      </Panel>
    </div>
  )
}

function Fig({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'marker' }) {
  return <div className="min-w-0 rounded-md border border-line bg-surface px-3 py-2"><div className="eyebrow truncate">{label}</div><div className={cx('mt-0.5 font-display text-[22px] font-bold tabular-nums', tone === 'bad' && 'text-bad')}>{value}{tone === 'marker' && value > 0 && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-marker align-middle" />}</div></div>
}
