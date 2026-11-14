// Process catalog (WF-01, WF-03, WF-12): every business process with its approvers and routing, the DOA matrix, and process analytics.
import { useMemo, useState } from 'react'
import type { AppState, DoaMatrix, RecordType, RoleId, WorkflowDef } from '@/core/types'
import { getState, mutate, useStore } from '@/core/store'
import { go, workflowHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { doaRoleFor } from '@/core/engine/workflow'
import { cx, fmtDate, fmtDateTime, money, pct } from '@/core/util'
import { Badge, Button, Callout, Empty, Field, Input, Modal, MoneyInput, PageHeader, Panel, SegButtons, Select, Stat, Table, Tabs, TextArea, Mono } from '@/ui/kit'
import { BarChart, HBarChart, SERIES } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { RECORD_TYPES, blankDef, describeAssignee, draftOf, fmtDur, isHuman, monthlyVolume, processStats, recordTypeLabel, slugify, tasksForAll, versionsOf, type ProcessStat } from './lib'
import { manualHtml } from './sop'
import { planReminders } from '@/core/engine/notify'
import { sendRemindersNow } from '@/views/admin/WorkflowSettings'

type Tab = 'catalog' | 'doa' | 'analytics'

export default function Catalog(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const [tab, setTab] = useState<Tab>('catalog')
  const [newOpen, setNewOpen] = useState(false)
  const keys = useMemo(() => Array.from(new Set(s.workflowDefs.map((d) => d.key))), [s.workflowDefs])
  const stats = useMemo(() => Object.fromEntries(keys.map((k) => [k, processStats(s, k)])) as Record<string, ProcessStat>, [s.workflows, s.workflowDefs, keys]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = (k: string) => { const v = versionsOf(s, k); return v.find((d) => d.status === 'published') ?? v[0] }
  const published = keys.map(current).filter((d) => d.status === 'published')
  const running = s.workflows.filter((w) => w.status === 'running')
  const overdue = running.reduce((a, w) => a + w.active.filter((x) => x.due && x.due < s.settings.asOf).length, 0)
  const year = s.workflows.filter((w) => w.completedAt && w.completedAt.slice(0, 10) >= `${Number(s.settings.asOf.slice(0, 4)) - 1}${s.settings.asOf.slice(4)}`)
  const allCycles = Object.values(stats).flatMap((x) => x.cycles)
  const pendingNotices = useMemo(() => planReminders(s).length, [s.workflows, s.settings.workflow]) // eslint-disable-line react-hooks/exhaustive-deps
  const manual = async () => {
    const r = await saveFile(`process-manual-${s.settings.asOf}.html`, manualHtml(getState(), published), 'text/html')
    toast(r === 'saved' ? `Process manual downloaded — ${published.length} SOPs` : r === 'declined' ? 'Download cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Configure" title="Workflows"
        subtitle="Every business process documented with its approvers, routing rules and approval authority. Edit a process to change how work routes — the SOP regenerates from the same definition."
        actions={<><Button icon={<Icon name="bell" className="h-4 w-4" />} onClick={sendRemindersNow} title={`Reminders ${s.settings.workflow.reminderDays} day(s) before due; escalation to the manager ${s.settings.workflow.escalateAfterDays ? `${s.settings.workflow.escalateAfterDays} day(s) overdue` : 'off'}`}>Send reminders now{pendingNotices > 0 && <span className="rounded-full bg-marker px-1.5 text-[11px] font-bold tabular-nums text-markerink">{pendingNotices}</span>}</Button><Button icon={<Icon name="doc" className="h-4 w-4" />} onClick={manual}>Download process manual</Button><Button variant="primary" icon={<Icon name="plus" className="h-4 w-4" />} onClick={() => setNewOpen(true)}>New process</Button></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Published processes" value={published.length} sub={`${keys.length - published.length ? `${keys.length - published.length} in draft · ` : ''}${s.workflowDefs.filter((d) => d.status === 'retired').length} retired versions`} />
        <Stat label="Requests in flight" value={running.length} sub={`${new Set(running.map((w) => w.projectId).filter(Boolean)).size} projects`} />
        <Stat label="Completed (12 mo)" value={year.length} sub={`${year.filter((w) => w.status === 'approved').length} approved`} />
        <Stat label="Median cycle time" value={fmtDur(allCycles.length ? allCycles.slice().sort((a, b) => a - b)[Math.floor(allCycles.length / 2)] : undefined)} sub="start to completion" />
        <Stat label="Overdue steps" value={overdue} tone={overdue ? 'bad' : 'good'} sub={<>past their SLA · <a href="#admin-notify" className="text-link">reminder rules</a></>} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'catalog', label: 'Process catalog', count: keys.length }, { id: 'doa', label: 'Delegation of authority' }, { id: 'analytics', label: 'Process analytics' }]} />
      {tab === 'catalog' && <CatalogTable s={s} keys={keys} stats={stats} current={current} />}
      {tab === 'doa' && <DoaEditor s={s} />}
      {tab === 'analytics' && <Analytics s={s} keys={keys} stats={stats} />}
      <NewProcessModal open={newOpen} onClose={() => setNewOpen(false)} s={s} keys={keys} current={current} />
    </div>
  )
}

function approversSummary(s: AppState, d: WorkflowDef): string {
  const out: string[] = []
  for (const n of d.nodes.filter((x) => x.type === 'approval')) { const t = describeAssignee(s, n.assignee, d.fields); if (!out.includes(t)) out.push(t) }
  return out.join(' → ') || '—'
}

function CatalogTable({ s, keys, stats, current }: { s: AppState; keys: string[]; stats: Record<string, ProcessStat>; current: (k: string) => WorkflowDef }) {
  const [q, setQ] = useState('')
  const [rt, setRt] = useState('')
  const rows = keys.map(current).filter((d) => (!rt || d.recordType === rt) && (!q || (d.name + ' ' + d.key + ' ' + d.description).toLowerCase().includes(q.toLowerCase())))
  return (
    <Panel pad={false} title="Process catalog" subtitle="Click a process to open the designer, test its routing or read its SOP."
      actions={<div className="flex flex-wrap gap-2"><Input aria-label="Search processes" placeholder="Search processes" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 w-[200px] py-0.5" /><Select aria-label="Record type" className="h-7 w-auto py-0.5" value={rt} onChange={(e) => setRt(e.target.value)} options={[{ value: '', label: 'All record types' }, ...RECORD_TYPES.filter((r) => keys.some((k) => current(k).recordType === r.id)).map((r) => ({ value: r.id, label: r.label }))]} /></div>}>
      <Table rowKey={(d) => d.key} rows={rows} onRowClick={(d) => go(workflowHref(d.key))} empty={<div className="p-4"><Empty title="No processes match">Clear the search or filter.</Empty></div>} columns={[
        { key: 'name', header: 'Process', sort: (d) => d.name, render: (d) => <div className="min-w-[220px] max-w-[340px]"><a href={workflowHref(d.key)} onClick={(e) => e.stopPropagation()} className="font-semibold text-ink hover:text-link">{d.name}</a><div className="line-clamp-2 text-[12px] text-muted">{d.description}</div></div> },
        { key: 'key', header: 'Key', render: (d) => <Mono className="text-muted">{d.key}</Mono> },
        { key: 'rt', header: 'Record', sort: (d) => d.recordType, render: (d) => <span className="whitespace-nowrap text-[12.5px]">{recordTypeLabel(d.recordType)}</span> },
        { key: 'v', header: 'Version', render: (d) => { const dr = draftOf(s, d.key); return <div className="flex flex-wrap items-center gap-1 whitespace-nowrap"><b>v{d.version}</b><Badge tone={d.status === 'published' ? 'good' : d.status === 'draft' ? 'info' : 'neutral'}>{d.status}</Badge>{dr && dr.id !== d.id && <Badge tone="info">draft v{dr.version}</Badge>}</div> } },
        { key: 'eff', header: 'Effective', sort: (d) => d.effective, render: (d) => <span className="whitespace-nowrap">{fmtDate(d.effective)}</span> },
        { key: 'own', header: 'Owner', render: (d) => <span className="whitespace-nowrap text-[12.5px]">{s.roles.find((r) => r.id === d.ownerRole)?.name}</span> },
        { key: 'steps', header: 'Steps', num: true, sort: (d) => d.nodes.filter((n) => isHuman(n.type)).length, render: (d) => <span title={`${d.nodes.length} nodes in total`}>{d.nodes.filter((n) => isHuman(n.type)).length}</span> },
        { key: 'appr', header: 'Approvers', render: (d) => <span className="block min-w-[160px] max-w-[240px] text-[12px]">{approversSummary(s, d)}{d.nodes.some((n) => n.type === 'condition') && <span className="ml-1 text-faint">· conditional routing</span>}</span> },
        { key: 'run', header: 'Running', num: true, sort: (d) => stats[d.key]?.running ?? 0, render: (d) => (stats[d.key]?.running ? <Badge tone="marker">{stats[d.key].running}</Badge> : <span className="text-faint">0</span>) },
        { key: 'cyc', header: 'Avg cycle', num: true, sort: (d) => stats[d.key]?.avgCycleH ?? -1, render: (d) => <span title={stats[d.key]?.completed ? `${stats[d.key].completed} completed` : 'No completed instances'}>{fmtDur(stats[d.key]?.avgCycleH)}</span> },
      ]} />
    </Panel>
  )
}

// ───────────────────────────── New process
function NewProcessModal({ open, onClose, s, keys, current }: { open: boolean; onClose: () => void; s: AppState; keys: string[]; current: (k: string) => WorkflowDef }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [from, setFrom] = useState<string>('')
  const [rt, setRt] = useState<RecordType>('change')
  const [owner, setOwner] = useState<RoleId>('pmo')
  const k = keyTouched ? key : slugify(name)
  const clash = keys.includes(k)
  const create = () => {
    if (!name.trim() || !k || clash) return
    const src = from ? current(from) : undefined
    const def: WorkflowDef = src
      ? { ...JSON.parse(JSON.stringify(src)), id: `wfd-${k}`, key: k, name: name.trim(), version: 1, status: 'draft', effective: s.settings.asOf }
      : blankDef(k, name.trim(), rt, owner, s.settings.asOf)
    if (!src) { def.description = `Routes ${recordTypeLabel(rt).toLowerCase()} records for review and approval.`; def.purpose = '' }
    mutate((d) => { d.workflowDefs.push(def) }, { entity: 'workflow-def', entityId: k, action: 'create', summary: `Created process ${def.name} (${k}) as draft v1${src ? ` from ${src.name}` : ''}` })
    toast(`Draft process created — design it, then publish`)
    onClose()
    setName(''); setKey(''); setKeyTouched(false); setFrom('')
    go(workflowHref(k))
  }
  return (
    <Modal open={open} onClose={onClose} title="New process" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || !k || clash} onClick={create}>Create draft</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Process name"><Input id="new-wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency work authorization" /></Field>
        <Field label="Process key" hint={clash ? <span className="text-bad">That key is already used.</span> : 'Stable identifier modules use to start this process. Lowercase and hyphens.'}>
          <Input className="font-mono" value={k} onChange={(e) => { setKeyTouched(true); setKey(slugify(e.target.value)) }} />
        </Field>
        <Field label="Start from">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} options={[{ value: '', label: 'Blank process (request → manager review → dollar-authority approval)' }, ...keys.map((x) => ({ value: x, label: `Duplicate: ${current(x).name} v${current(x).version}` }))]} />
        </Field>
        {!from && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Record type"><Select value={rt} onChange={(e) => setRt(e.target.value as RecordType)} options={RECORD_TYPES.map((r) => ({ value: r.id, label: r.label }))} /></Field>
            <Field label="Process owner"><Select value={owner} onChange={(e) => setOwner(e.target.value as RoleId)} options={s.roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
          </div>
        )}
        <Callout>New processes start as a draft. Nothing routes on them until you publish v1.</Callout>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Delegation of authority (WF-03)
function DoaEditor({ s }: { s: AppState }) {
  const [mid, setMid] = useState(s.doaMatrices[0]?.id)
  const m = s.doaMatrices.find((x) => x.id === mid) ?? s.doaMatrices[0]
  const me = s.people.find((p) => p.id === s.currentUserId)!
  const canEdit = me.roles.includes('finance') || me.roles.includes('admin')
  const [rows, setRows] = useState<DoaMatrix['rows'] | null>(null)
  const [effective, setEffective] = useState(s.settings.asOf)
  const [note, setNote] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  if (!m) return <Empty title="No DOA matrix">Create one to route approvals by dollar amount.</Empty>
  const work = rows ?? m.rows
  const sorted = work.slice().sort((a, b) => a.upTo - b.upTo)
  const dirty = !!rows && JSON.stringify(rows) !== JSON.stringify(m.rows)
  const programs = s.programs.filter((p) => p.doaMatrixId === m.id)
  const history = s.audit.filter((a) => a.entity === 'doa' && a.entityId === m.id).slice().reverse()
  const doaProcesses = Array.from(new Set(s.workflowDefs.filter((d) => d.status === 'published' && d.nodes.some((n) => n.assignee?.kind === 'doa')).map((d) => d.name)))
  // impact on in-flight requests that will reach (or sit at) a DOA step
  const impact = s.workflows.filter((w) => w.status === 'running').map((w) => {
    const def = s.workflowDefs.find((d) => d.id === w.defId)
    const doaNode = def?.nodes.find((n) => n.assignee?.kind === 'doa')
    if (!doaNode || doaNode.assignee?.kind !== 'doa') return null
    const amt = Math.abs(Number(w.data[doaNode.assignee.field] ?? 0))
    const before = doaRoleFor(s, w, amt)
    const after = (sorted.find((r) => amt <= r.upTo) ?? sorted[sorted.length - 1])?.roleId
    const at = w.active.some((a) => a.nodeId === doaNode.id)
    return { w, amt, before, after, at }
  }).filter(Boolean) as { w: (typeof s.workflows)[number]; amt: number; before?: RoleId; after?: RoleId; at: boolean }[]
  const changed = impact.filter((x) => x.before !== x.after)
  const set = (i: number, patch: Partial<DoaMatrix['rows'][number]>) => setRows(sorted.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const issues: string[] = []
  if (!sorted.length) issues.push('Add at least one tier.')
  if (sorted.length && sorted[sorted.length - 1].upTo < 1e12) issues.push('The last tier should have no upper limit so every amount has an approver.')
  if (new Set(sorted.map((r) => r.upTo)).size !== sorted.length) issues.push('Two tiers have the same limit.')
  const publish = () => {
    const nv = m.version + 1
    const summary = `Published ${m.name} v${nv} effective ${effective}: ${sorted.map((r) => `${r.upTo >= 1e12 ? 'above' : '≤' + money(r.upTo)} ${r.label}`).join(', ')}${note.trim() ? ` — ${note.trim()}` : ''}`
    mutate((d) => { const x = d.doaMatrices.find((y) => y.id === m.id)!; x.rows = sorted; x.version = nv; x.effective = effective }, { entity: 'doa', entityId: m.id, action: 'publish', summary })
    setRows(null); setNote('')
    toast(`${m.name} v${nv} published — new dollar-authority steps route on it`)
  }
  const createMatrix = () => {
    const id = `doa-${slugify(newName) || 'matrix'}`
    if (s.doaMatrices.some((x) => x.id === id)) { toast('A matrix with that name exists', 'bad'); return }
    mutate((d) => { d.doaMatrices.push({ id, name: newName.trim(), version: 1, effective: d.settings.asOf, rows: JSON.parse(JSON.stringify(m.rows)) }) }, { entity: 'doa', entityId: id, action: 'create', summary: `Created ${newName.trim()} v1 from ${m.name} v${m.version}` })
    setMid(id); setNewOpen(false); setNewName('')
    toast('Matrix created — assign it to programs in Configuration')
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title={<span className="flex flex-wrap items-center gap-2">{s.doaMatrices.length > 1 ? <Select aria-label="Matrix" className="h-7 w-auto py-0.5" value={m.id} onChange={(e) => { setMid(e.target.value); setRows(null) }} options={s.doaMatrices.map((x) => ({ value: x.id, label: x.name }))} /> : m.name}<Badge tone="good">v{m.version}</Badge><span className="text-[12px] font-normal text-muted">effective {fmtDate(m.effective)}</span></span>}
          subtitle={`Owned by Capital Finance. Used by ${programs.length ? programs.map((p) => p.code).join(', ') : 'no programs'}. A dollar-authority step routes to the first tier whose limit covers the amount.`}
          actions={canEdit ? <><Button size="sm" variant="ghost" onClick={() => setNewOpen(true)}>New matrix</Button><Button size="sm" onClick={() => setRows([...sorted.slice(0, -1), { upTo: Math.max(1000, (sorted[sorted.length - 2]?.upTo ?? 0) * 2), roleId: 'exec', label: 'New tier' }, ...sorted.slice(-1)])}>Add tier</Button></> : undefined} pad={false}>
          {!canEdit && <div className="px-4 pt-3"><Callout tone="info">Only Capital Finance or an administrator can change approval authority. You are viewing the matrix in force.</Callout></div>}
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th className="num">From</th><th className="num">Up to</th><th>Approver role</th><th>Label</th><th>People holding the role</th><th /></tr></thead>
              <tbody>
                {sorted.map((r, i) => {
                  const holders = s.people.filter((p) => p.roles.includes(r.roleId) && !p.company)
                  const last = i === sorted.length - 1
                  return (
                    <tr key={i}>
                      <td className="num text-muted">{i === 0 ? '$0' : money(sorted[i - 1].upTo + 1)}</td>
                      <td className="num w-[170px]">{last && r.upTo >= 1e12 ? <span className="text-muted">No limit</span> : canEdit ? <MoneyInput aria-label="Up to" className="h-7 py-0.5" value={r.upTo} onChange={(v) => set(i, { upTo: v })} /> : money(r.upTo, 'full')}</td>
                      <td className="min-w-[170px]">{canEdit ? <Select aria-label="Role" className="h-7 py-0.5" value={r.roleId} onChange={(e) => set(i, { roleId: e.target.value as RoleId })} options={s.roles.map((x) => ({ value: x.id, label: x.name }))} /> : s.roles.find((x) => x.id === r.roleId)?.name}</td>
                      <td className="min-w-[150px]">{canEdit ? <Input aria-label="Label" className="h-7 py-0.5" value={r.label} onChange={(e) => set(i, { label: e.target.value })} /> : r.label}</td>
                      <td className="text-[12px] text-muted">{holders.length ? holders.map((p) => p.name).join(', ') : <span className="text-bad">Nobody holds this role</span>}</td>
                      <td>{canEdit && !last && <button className="text-[12px] font-semibold text-bad hover:underline" onClick={() => setRows(sorted.filter((_, j) => j !== i))}>Remove</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <DoaBand rows={sorted} />
        </Panel>
        {dirty && (
          <Panel title={`Publish v${m.version + 1}`} subtitle="Publishing replaces the matrix in force from its effective date. Steps already assigned keep their approver; new dollar-authority steps route on the new tiers.">
            <div className="flex flex-col gap-3">
              {issues.map((x) => <Callout key={x} tone="bad">{x}</Callout>)}
              {changed.length > 0 ? (
                <Callout tone="warn" title={`${changed.length} in-flight request${changed.length > 1 ? 's' : ''} would route to a different tier`}>
                  <ul className="mt-1 list-disc pl-4">{changed.slice(0, 6).map((x) => <li key={x.w.id}>{x.w.title} ({money(x.amt)}): {s.roles.find((r) => r.id === x.before)?.name} → {s.roles.find((r) => r.id === x.after)?.name}{x.at ? ' — already at the approval step, keeps its current approver' : ''}</li>)}</ul>
                </Callout>
              ) : <Callout tone="good">No in-flight request changes tier.</Callout>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Field label="Effective date"><Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
                <Field label="Reason for change"><TextArea className="min-h-[38px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Board resolution 2026-14 raised director authority" /></Field>
              </div>
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRows(null)}>Discard</Button><Button variant="primary" disabled={!!issues.length} onClick={publish}>Publish v{m.version + 1}</Button></div>
            </div>
          </Panel>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <Panel title="Where it applies">
          <div className="flex flex-col gap-2 text-[13px]">
            <div><div className="eyebrow mb-1">Programs</div><div className="flex flex-wrap gap-1">{programs.map((p) => <Badge key={p.id} tone="ink">{p.code}</Badge>)}{!programs.length && <span className="text-muted">None</span>}</div></div>
            <div><div className="eyebrow mb-1">Processes with a dollar-authority step</div><ul className="list-disc pl-4 text-[12.5px]">{doaProcesses.map((n) => <li key={n}>{n}</li>)}</ul></div>
            <div><div className="eyebrow mb-1">In flight</div><span className="text-[12.5px]">{impact.length} running request{impact.length === 1 ? '' : 's'} route through dollar authority ({impact.filter((x) => x.at).length} at the approval step now).</span></div>
          </div>
        </Panel>
        <Panel title="Revision history" pad={false}>
          {history.length ? (
            <ol className="divide-y divide-line">{history.map((h) => <li key={h.id} className="px-4 py-2 text-[12.5px]"><div className="font-semibold">{h.summary.split(':')[0]}</div><div className="text-muted">{h.summary.split(':').slice(1).join(':')}</div><div className="text-[11px] text-faint">{fmtDateTime(h.at)} · {s.people.find((p) => p.id === h.actorId)?.name}</div></li>)}</ol>
          ) : <div className="px-4 py-3 text-[12.5px] text-muted">v{m.version} effective {fmtDate(m.effective)} was migrated into Crosswalk; no changes since.</div>}
        </Panel>
      </div>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New DOA matrix" footer={<><Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button><Button variant="primary" disabled={!newName.trim()} onClick={createMatrix}>Create</Button></>}>
        <Field label="Name" hint={`Starts as a copy of ${m.name} v${m.version}.`}><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Emergency work authority" /></Field>
      </Modal>
    </div>
  )
}

// Fills dark enough for the white labels on the band (4.5:1 or better); the chart greens and oranges are not.
const BAND = ['rgb(var(--c1))', 'rgb(var(--c4))', 'rgb(var(--good))', 'rgb(var(--warn))', 'rgb(var(--muted))', '#0f766e']
/** Log-scale band showing how authority steps up by amount. */
function DoaBand({ rows }: { rows: DoaMatrix['rows'] }) {
  if (!rows.length) return null
  const lo = Math.log10(10_000), hi = Math.log10(200_000_000)
  const x = (v: number) => ((Math.log10(Math.max(10_000, Math.min(v, 200_000_000))) - lo) / (hi - lo)) * 100
  let prev = 0
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="relative h-7 overflow-hidden rounded bg-sunken">
        {rows.map((r, i) => { const a = x(prev || 10_000), b = x(r.upTo); prev = r.upTo; return <div key={i} className="absolute top-0 flex h-7 items-center overflow-hidden border-r-2 border-surface px-1.5 text-[11px] font-semibold text-white" style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%`, background: BAND[i % BAND.length] }} title={r.label}><span className="truncate">{r.label}</span></div> })}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-faint tabular-nums">{[10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].map((v) => <span key={v}>{money(v)}</span>)}</div>
    </div>
  )
}

// ───────────────────────────── Analytics (WF-12)
function Analytics({ s, keys, stats }: { s: AppState; keys: string[]; stats: Record<string, ProcessStat> }) {
  const withData = keys.filter((k) => stats[k].total > 0)
  const [pick, setPick] = useState(withData.slice().sort((a, b) => stats[b].total - stats[a].total)[0] ?? keys[0])
  const [unit, setUnit] = useState<'avg' | 'p90'>('avg')
  const st = stats[pick]
  const vol = useMemo(() => monthlyVolume(s, 12), [s.workflows]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = useMemo(() => tasksForAll(s), [s.workflows]) // eslint-disable-line react-hooks/exhaustive-deps
  const exportCsv = async () => {
    const rows = keys.flatMap((k) => stats[k].steps.map((x) => ({ process: stats[k].name, key: k, step: x.label, decisions: x.n, avg_hours: x.avgH.toFixed(2), max_hours: x.maxH.toFixed(2), sla_days: x.slaDays ?? '', sla_breaches: x.breaches, returns: x.returns, waiting_now: x.runningNow })))
    const r = await saveFile(`process-analytics-${s.settings.asOf}.csv`, toCSV(rows), 'text/csv')
    toast(r === 'saved' ? 'Analytics exported' : 'Download cancelled', r === 'saved' ? 'good' : 'info')
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Cycle time by process" subtitle="Start to completion, completed instances" actions={<SegButtons value={unit} onChange={setUnit} options={[{ id: 'avg', label: 'Average' }, { id: 'p90', label: 'P90' }]} />}>
          {withData.some((k) => stats[k].completed) ? (
            <HBarChart format={(n) => fmtDur(n)} rows={withData.filter((k) => stats[k].completed).sort((a, b) => ((unit === 'avg' ? stats[b].avgCycleH : stats[b].p90CycleH) ?? 0) - ((unit === 'avg' ? stats[a].avgCycleH : stats[a].p90CycleH) ?? 0)).map((k) => ({ label: stats[k].name, value: (unit === 'avg' ? stats[k].avgCycleH : stats[k].p90CycleH) ?? 0, sub: `n=${stats[k].completed}`, color: k === pick ? SERIES[1] : SERIES[0] }))} />
          ) : <Empty title="No completed instances yet" />}
        </Panel>
        <Panel title="Volume" subtitle="Requests started and completed per month">
          <BarChart labels={vol.labels.map((k) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(k.slice(5)) - 1])} series={[{ name: 'Started', values: vol.started }, { name: 'Completed', values: vol.completed, color: SERIES[2] }]} format={(n) => String(Math.round(n))} height={200} />
        </Panel>
      </div>
      <Panel title="Process health" pad={false} actions={<Button size="sm" icon={<Icon name="download" className="h-3.5 w-3.5" />} onClick={exportCsv}>Export CSV</Button>}>
        <Table rowKey={(k) => k} rows={keys} onRowClick={(k) => setPick(k)} columns={[
          { key: 'n', header: 'Process', sort: (k) => stats[k].name, render: (k) => <span className={cx('font-semibold', k === pick && 'text-link')}>{stats[k].name}</span> },
          { key: 't', header: 'Instances', num: true, sort: (k) => stats[k].total, render: (k) => stats[k].total },
          { key: 'r', header: 'Running', num: true, sort: (k) => stats[k].running, render: (k) => stats[k].running },
          { key: 'a', header: 'Approved', num: true, render: (k) => stats[k].approved },
          { key: 'rj', header: 'Rejected / returned', num: true, render: (k) => stats[k].rejected + stats[k].returnedOut },
          { key: 'c', header: 'Avg cycle', num: true, sort: (k) => stats[k].avgCycleH ?? -1, render: (k) => fmtDur(stats[k].avgCycleH) },
          { key: 'rr', header: 'Return rate', num: true, sort: (k) => stats[k].returnRate, render: (k) => <span className={stats[k].returnRate > 0.2 ? 'text-warn font-semibold' : ''}>{pct(stats[k].returnRate)}</span> },
          { key: 'sla', header: 'SLA breaches', num: true, sort: (k) => stats[k].slaBreaches + stats[k].overdueNow, render: (k) => (stats[k].slaBreaches + stats[k].overdueNow ? <Badge tone="bad">{stats[k].slaBreaches + stats[k].overdueNow}</Badge> : <span className="text-good">0</span>) },
          { key: 'b', header: 'Bottleneck step', render: (k) => <span className="text-[12px]">{stats[k].bottleneck ? `${stats[k].bottleneck!.label} (${fmtDur(stats[k].bottleneck!.avgH)})` : '—'}</span> },
        ]} />
      </Panel>
      {st && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title={`Step timing — ${st.name}`} subtitle="Elapsed time from a step being entered to the assignee's decision, across every instance" actions={<a className="text-[12.5px] font-semibold text-link" href={workflowHref(pick)}>Open in designer →</a>}>
            {st.steps.length ? (
              <div className="flex flex-col gap-4">
                {st.bottleneck && <Callout tone="marker" title={`Bottleneck: ${st.bottleneck.label}`}>Averages {fmtDur(st.bottleneck.avgH)} per decision across {st.bottleneck.n} decisions{st.bottleneck.slaDays ? ` against a ${st.bottleneck.slaDays}-day SLA` : ''}. {st.bottleneck.runningNow ? `${st.bottleneck.runningNow} waiting there now.` : ''}</Callout>}
                <HBarChart format={(n) => fmtDur(n)} rows={st.steps.filter((x) => x.n).map((x) => ({ label: x.label, value: x.avgH, sub: `n=${x.n}`, color: x.nodeId === st.bottleneck?.nodeId ? SERIES[1] : SERIES[0] }))} />
                <div className="scroll-x">
                  <table className="tbl">
                    <thead><tr><th>Step</th><th className="num">Decisions</th><th className="num">Average</th><th className="num">Longest</th><th className="num">SLA</th><th className="num">Breaches</th><th className="num">Returns</th><th className="num">Waiting now</th><th className="num">Oldest wait</th></tr></thead>
                    <tbody>{st.steps.map((x) => <tr key={x.nodeId}><td>{x.label}</td><td className="num">{x.n}</td><td className="num">{fmtDur(x.avgH)}</td><td className="num">{fmtDur(x.maxH)}</td><td className="num">{x.slaDays ? `${x.slaDays} d` : '—'}</td><td className="num">{x.breaches || <span className="text-good">0</span>}</td><td className="num">{x.returns}</td><td className="num">{x.runningNow ? <Badge tone="marker">{x.runningNow}</Badge> : '0'}</td><td className="num">{x.runningNow ? fmtDur(x.oldestRunningH) : '—'}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            ) : <Empty title="No history yet">Step timing appears once requests run through this process.</Empty>}
          </Panel>
          <Panel title="Who is holding work" subtitle="Open steps by assignee, all processes" pad={false}>
            {load.length ? (
              <ol className="divide-y divide-line">
                {load.slice(0, 12).map((x) => (
                  <li key={x.person.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                    <span className="min-w-0 flex-1"><b>{x.person.name}</b><span className="block truncate text-[11.5px] text-muted">{x.person.title}</span></span>
                    {x.overdue > 0 && <Badge tone="bad">{x.overdue} overdue</Badge>}
                    <span className="w-8 text-right font-semibold tabular-nums">{x.count}</span>
                  </li>
                ))}
              </ol>
            ) : <div className="p-4 text-[13px] text-muted">No open steps.</div>}
          </Panel>
        </div>
      )}
    </div>
  )
}
