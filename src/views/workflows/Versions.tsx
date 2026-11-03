// Version history and live instances of one process; select an instance to see where it sits on its own version's diagram.
import { useMemo, useState } from 'react'
import type { AppState, WorkflowDef } from '@/core/types'
import { personName } from '@/core/store'
import { projectHref } from '@/core/router'
import { fmtDate, fmtDateTime } from '@/core/util'
import { Badge, Button, Empty, Panel, SegButtons, StatusBadge, Table } from '@/ui/kit'
import { WorkflowStatus } from '../shared/WorkflowStatus'
import { Canvas } from './canvas'
import { fmtDur, nowMs, versionsOf } from './lib'
import { revisions } from './sop'

export function VersionsPanel({ s, defKey, current, onOpen }: { s: AppState; defKey: string; current: WorkflowDef; onOpen: (id: string) => void }) {
  const versions = versionsOf(s, defKey)
  const revs = revisions(s, current)
  const [filter, setFilter] = useState<'running' | 'done' | 'all'>('running')
  const insts = useMemo(() => s.workflows.filter((w) => w.defKey === defKey && (filter === 'all' || (filter === 'running' ? w.status === 'running' : w.status !== 'running'))).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [s.workflows, defKey, filter])
  const [pick, setPick] = useState<string | undefined>()
  const sel = s.workflows.find((w) => w.id === pick) ?? insts[0]
  const selDef = sel && s.workflowDefs.find((d) => d.id === sel.defId)
  const now = nowMs(s)
  const proj = (id?: string) => s.projects.find((p) => p.id === id)
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Versions" subtitle="Published versions are immutable. Publishing retires the previous version; requests already in flight finish on the version they started on." pad={false}>
        <Table rowKey={(v) => v.id} rows={versions} columns={[
          { key: 'v', header: 'Version', render: (v) => <b>v{v.version}</b>, sort: (v) => v.version },
          { key: 'st', header: 'Status', render: (v) => <Badge tone={v.status === 'published' ? 'good' : v.status === 'draft' ? 'info' : 'neutral'}>{v.status}</Badge> },
          { key: 'eff', header: 'Effective', render: (v) => fmtDate(v.effective) },
          { key: 'steps', header: 'Steps', num: true, render: (v) => v.nodes.length },
          { key: 'inst', header: 'Instances', num: true, render: (v) => s.workflows.filter((w) => w.defId === v.id).length },
          { key: 'run', header: 'Running', num: true, render: (v) => { const n = s.workflows.filter((w) => w.defId === v.id && w.status === 'running').length; return n ? <Badge tone="marker">{n}</Badge> : '0' } },
          { key: 'chg', header: 'Change', render: (v) => <span className="text-[12px] text-muted">{revs.find((r) => r.version === v.version)?.summary}</span> },
          { key: 'open', header: '', render: (v) => <Button size="sm" variant="ghost" onClick={() => onOpen(v.id)}>Open</Button> },
        ]} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Instances" actions={<SegButtons value={filter} onChange={(f) => { setFilter(f); setPick(undefined) }} options={[{ id: 'running', label: 'Running' }, { id: 'done', label: 'Completed' }, { id: 'all', label: 'All' }]} />} pad={false}>
          <Table rowKey={(w) => w.id} rows={insts} maxHeight={520} onRowClick={(w) => setPick(w.id)} empty={<div className="p-4"><Empty title="Nothing here">No {filter === 'running' ? 'running' : filter === 'done' ? 'completed' : ''} instances of this process.</Empty></div>} columns={[
            { key: 't', header: 'Request', render: (w) => <div className={w.id === sel?.id ? 'font-semibold text-link' : ''}><div className="max-w-[300px] truncate">{w.title}</div><div className="text-[11.5px] text-faint">{proj(w.projectId)?.code ?? 'Portfolio'} · v{w.defVersion} · by {personName(s, w.startedById)}</div></div> },
            { key: 'at', header: 'Where', render: (w) => w.status === 'running' ? <span className="text-[12px]">{w.active.map((a) => s.workflowDefs.find((d) => d.id === w.defId)?.nodes.find((n) => n.id === a.nodeId)?.label).join(', ')}</span> : <StatusBadge status={w.status} /> },
            { key: 'age', header: 'Age', num: true, sort: (w) => w.startedAt, render: (w) => fmtDur(((w.completedAt ? Date.parse(w.completedAt) : now) - Date.parse(w.startedAt)) / 36e5) },
          ]} />
        </Panel>
        {sel && selDef ? (
          <div className="flex min-w-0 flex-col gap-3">
            <Panel title={sel.title} subtitle={<>Started {fmtDateTime(sel.startedAt)} on v{sel.defVersion}{sel.projectId && <> · <a className="text-link" href={projectHref(sel.projectId, 'activity')}>{proj(sel.projectId)?.code}</a></>}</>} pad={false}>
              <div className="max-h-[320px] overflow-auto"><Canvas s={s} def={selDef} readOnly zoom={0.72} active={new Set(sel.active.map((a) => a.nodeId))} done={new Set(sel.history.filter((h) => h.action === 'approve' || h.action === 'submit').map((h) => h.nodeId))} /></div>
            </Panel>
            <WorkflowStatus instanceId={sel.id} />
          </div>
        ) : <Empty title="Select an instance">Pick a request to see where it sits.</Empty>}
      </div>
    </div>
  )
}
