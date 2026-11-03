// Records completeness (RR-01), closeout checklist + workflow (CO-01), as-built / GIS handoff,
// unitization summary and lessons learned.
import { useMemo, useState } from 'react'
import type { AppState, CloseoutItem, Project, RecordItem, RoleId, WorkMethod } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { activeBudget, position } from '@/core/engine/position'
import { ownerForRole, templateFor } from '@/core/engine/gates'
import { startWorkflow } from '@/core/engine/workflow'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, money, num, pct, sum, uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Drawer, Empty, Field, Input, KV, Mono, Panel, Progress, Select, StatusBadge, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { FileButton, MultiCheck, RoleSelect, WORK_METHODS, humanizeId, inServiceDate, roleName } from '../../admin/common'

type RType = RecordItem['type']
const ALL_TYPES: RType[] = ['Weld log', 'NDE report', 'Pressure test chart', 'Material test report', 'As-built drawing', 'Coating inspection', 'MAOP validation']
const STD_CLOSEOUT: [string, RoleId][] = [['In-service date recorded', 'pm'], ['As-builts submitted to GIS', 'engineer'], ['Unitization data to plant accounting', 'project-controls'], ['Open POs and accruals cleared', 'project-controls'], ['Final cost reconciled to ERP', 'finance'], ['Lessons learned captured', 'pm'], ['Records verified complete', 'records'], ['Reasonableness package frozen', 'pmo']]

function defaultMatrix(p: Project): { types: RType[]; segs: string[] } {
  const types: RType[] = p.workMethod === 'hydrotest' ? ['Pressure test chart', 'MAOP validation', 'As-built drawing', 'Weld log'] : p.asset.type === 'valve-site' ? ['Weld log', 'NDE report', 'As-built drawing'] : ['Weld log', 'NDE report', 'Pressure test chart', 'Material test report', 'As-built drawing', 'Coating inspection']
  const segs = p.asset.type === 'compressor-station' ? ['Station piping', 'Unit 1', 'Unit 2'] : p.asset.type === 'valve-site' ? ['Site 1'] : ['Segment A', 'Segment B', 'Segment C']
  return { types, segs }
}

export function recordsCompleteness(s: Pick<AppState, 'records'>, pid: string) {
  const recs = s.records.filter((r) => r.projectId === pid)
  const verified = recs.filter((r) => r.status === 'verified').length
  const attached = recs.filter((r) => r.status === 'attached').length
  const missing = recs.filter((r) => r.status === 'missing').length
  return { recs, total: recs.length, verified, attached, missing, pct: recs.length ? verified / recs.length : 0 }
}

export default function Records({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const rc = recordsCompleteness(s, projectId)
  const items = s.closeout.filter((x) => x.projectId === projectId)
  const coDone = items.filter((x) => x.status !== 'open').length
  const wf = s.workflows.filter((w) => w.projectId === projectId && w.defKey === 'closeout').sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop()
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Records verified" value={rc.total ? pct(rc.pct) : '—'} tone={!rc.total ? undefined : rc.pct === 1 ? 'good' : rc.missing ? 'bad' : 'warn'} sub={rc.total ? `${rc.verified} verified · ${rc.attached} awaiting verification · ${rc.missing} missing` : 'No records matrix yet'} bar={rc.total ? rc.pct * 100 : undefined} />
        <Tile label="Closeout checklist" value={items.length ? `${coDone}/${items.length}` : '—'} tone={items.length && coDone === items.length ? 'good' : undefined} sub={items.length ? `${items.length - coDone} open item${items.length - coDone === 1 ? '' : 's'}` : 'Not started'} bar={items.length ? (coDone / items.length) * 100 : undefined} />
        <Tile label="Closeout workflow" value={wf ? <StatusBadge status={wf.status} /> : 'Not started'} sub={wf ? `Started ${fmtDate(wf.startedAt.slice(0, 10))}` : 'Starts when records and checklist are complete'} />
        <Tile label="In service" value={fmtDate(p.dates.inService ?? inServiceDate(p))} sub={p.dates.inService ? 'Recorded' : 'Forecast'} />
      </div>
      <RecordsMatrix p={p} />
      <Closeout p={p} items={items} rc={rc} wfId={wf?.id} wfStatus={wf?.status} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Handoff p={p} />
        <Unitization p={p} />
      </div>
      <Lessons p={p} />
    </div>
  )
}

function Tile({ label, value, sub, tone, bar }: { label: string; value: React.ReactNode; sub?: string; tone?: 'good' | 'warn' | 'bad'; bar?: number }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-surface px-4 py-3">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-1 font-display text-[22px] font-bold leading-none tabular-nums', tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {bar !== undefined && <Progress className="mt-2" value={bar} tone={tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'ink'} />}
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

// ───────────────────────────── Records matrix
function RecordsMatrix({ p }: { p: Project }) {
  const s = useStore()
  const me = useMe()
  const setUser = useStore((x) => x.setUser)
  const recs = s.records.filter((r) => r.projectId === p.id)
  const [sel, setSel] = useState<string | null>(null)
  const [newSeg, setNewSeg] = useState('')
  const [newType, setNewType] = useState<RType | ''>('')
  const segs = Array.from(new Set(recs.map((r) => r.segment)))
  const types = ALL_TYPES.filter((t) => recs.some((r) => r.type === t))
  const canVerify = me.roles.includes('records')
  const cell = (seg: string, t: RType) => recs.find((r) => r.segment === seg && r.type === t)
  const consIdx = templateFor(s, p).stages.findIndex((x) => /construct/i.test(x.name))

  const setup = () => {
    const m = defaultMatrix(p)
    mutate((d) => { for (const seg of m.segs) for (const t of m.types) d.records.push({ id: uid('rec'), projectId: p.id, type: t, segment: seg, status: 'missing' }) },
      { entity: 'records', entityId: p.id, projectId: p.id, action: 'create', summary: `${p.code}: set up records matrix (${m.segs.length} segments × ${m.types.length} record types)` })
    toast('Records matrix created')
  }
  const addSegment = () => {
    const seg = newSeg.trim()
    if (!seg || segs.includes(seg)) return
    const ts = types.length ? types : defaultMatrix(p).types
    mutate((d) => { for (const t of ts) d.records.push({ id: uid('rec'), projectId: p.id, type: t, segment: seg, status: 'missing' }) }, { entity: 'records', entityId: p.id, projectId: p.id, action: 'add-segment', summary: `${p.code}: added segment "${seg}" to records matrix` })
    setNewSeg(''); toast('Segment added')
  }
  const addType = () => {
    if (!newType) return
    mutate((d) => { for (const seg of segs) d.records.push({ id: uid('rec'), projectId: p.id, type: newType, segment: seg, status: 'missing' }) }, { entity: 'records', entityId: p.id, projectId: p.id, action: 'add-type', summary: `${p.code}: required ${newType} for all segments` })
    setNewType(''); toast(`${newType} now required`)
  }
  const verifyAllAttached = () => {
    const n = recs.filter((r) => r.status === 'attached').length
    mutate((d) => { for (const r of d.records) if (r.projectId === p.id && r.status === 'attached') { r.status = 'verified'; r.verifiedById = d.currentUserId } }, { entity: 'records', entityId: p.id, projectId: p.id, action: 'verify', summary: `${p.code}: verified ${n} attached record${n === 1 ? '' : 's'} as traceable, verifiable and complete` })
    toast(`${n} record${n === 1 ? '' : 's'} verified`)
  }
  const exportCsv = async () => {
    const r = await saveFile(`${p.code}-records-matrix.csv`, toCSV(recs.map((r) => ({ project: p.code, segment: r.segment, record_type: r.type, status: r.status, file: r.fileName ?? '', verified_by: r.verifiedById ? personName(s, r.verifiedById) : '' }))), 'text/csv')
    toast(r === 'saved' ? 'Records matrix exported' : 'Download not available here', r === 'saved' ? 'good' : 'info')
  }

  if (!recs.length) {
    return (
      <Panel title="Records completeness" subtitle="Traceable, verifiable and complete records by segment">
        <Empty title="No records matrix yet" action={<Button variant="primary" onClick={setup}>Set up records matrix</Button>}>
          {p.stageIndex < consIdx ? `Records are collected from construction onward (stage ${consIdx + 1}). You can set the matrix up early so field teams know what is required.` : 'Create the matrix of segments and required record types for this asset.'}
        </Empty>
      </Panel>
    )
  }
  const record = recs.find((r) => r.id === sel)
  const attachedN = recs.filter((r) => r.status === 'attached').length
  return (
    <Panel title="Records completeness" subtitle="Each segment needs every required record attached and verified by Records before the project can close" pad={false}
      actions={<>
        <Button size="sm" variant="ghost" onClick={exportCsv}>Export CSV</Button>
        {canVerify ? <Button size="sm" variant="primary" disabled={!attachedN} onClick={verifyAllAttached}>Verify {attachedN} attached</Button>
          : <Button size="sm" onClick={() => { setUser('u-rec'); toast('Now acting as Marco Delgado, Records Supervisor', 'info') }} title="Verification needs the Records role">Act as Records to verify</Button>}
      </>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Segment</th>{types.map((t) => <th key={t} className="text-center">{t}</th>)}<th className="num">Verified</th></tr></thead>
          <tbody>
            {segs.map((seg) => {
              const row = recs.filter((r) => r.segment === seg)
              const v = row.filter((r) => r.status === 'verified').length
              return (
                <tr key={seg}>
                  <td className="whitespace-nowrap font-semibold">{seg}</td>
                  {types.map((t) => {
                    const r = cell(seg, t)
                    if (!r) return <td key={t} className="text-center text-faint">n/a</td>
                    return (
                      <td key={t} className="text-center">
                        <button onClick={() => setSel(r.id)} className={cx('inline-flex min-w-[86px] items-center justify-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold', r.status === 'verified' ? 'border-good/40 bg-good/10 text-good' : r.status === 'attached' ? 'border-info/40 bg-info/10 text-info' : 'border-bad/40 bg-bad/10 text-bad', sel === r.id && 'ring-2 ring-ink')} title={r.fileName ?? 'No file'}>
                          {r.status === 'verified' ? '✓ Verified' : r.status === 'attached' ? 'Attached' : 'Missing'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="num">{v}/{row.length}</td>
                </tr>
              )
            })}
            <tr>
              <td className="text-[12px] font-semibold text-muted">By type</td>
              {types.map((t) => { const col = recs.filter((r) => r.type === t); const v = col.filter((r) => r.status === 'verified').length; return <td key={t} className="text-center text-[12px] tabular-nums text-muted">{v}/{col.length}</td> })}
              <td className="num font-semibold">{pct(recs.filter((r) => r.status === 'verified').length / recs.length)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-2.5">
        <Input className="h-7 w-44 py-0.5" placeholder="New segment name" value={newSeg} onChange={(e) => setNewSeg(e.target.value)} />
        <Button size="sm" disabled={!newSeg.trim()} onClick={addSegment}>Add segment</Button>
        <span className="mx-2 text-line">|</span>
        <Select className="h-7 w-52 py-0.5" value={newType} onChange={(e) => setNewType(e.target.value as RType)} options={[{ value: '', label: 'Require another record type…' }, ...ALL_TYPES.filter((t) => !types.includes(t))]} />
        <Button size="sm" disabled={!newType} onClick={addType}>Require</Button>
        {!canVerify && <span className="ml-auto text-[12px] text-muted">Attach as any team member; only the Records role can verify.</span>}
      </div>
      <RecordDrawer r={record} p={p} canVerify={canVerify} onClose={() => setSel(null)} />
    </Panel>
  )
}

function RecordDrawer({ r, p, canVerify, onClose }: { r?: RecordItem; p: Project; canVerify: boolean; onClose: () => void }) {
  const s = useStore()
  const [reason, setReason] = useState('')
  if (!r) return null
  const label = `${r.type} · ${r.segment}`
  const attach = (f: File) => {
    mutate((d) => { const x = d.records.find((y) => y.id === r.id)!; x.status = 'attached'; x.fileName = f.name; x.verifiedById = undefined }, { entity: 'record', entityId: r.id, projectId: p.id, action: 'attach', summary: `${p.code}: attached ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB) as ${label}` })
    toast('Record attached — awaiting verification')
  }
  const verify = () => {
    mutate((d) => { const x = d.records.find((y) => y.id === r.id)!; x.status = 'verified'; x.verifiedById = d.currentUserId }, { entity: 'record', entityId: r.id, projectId: p.id, action: 'verify', summary: `${p.code}: verified ${label} (${r.fileName})` })
    toast('Record verified'); onClose()
  }
  const reject = () => {
    if (!reason.trim()) { toast('Say why the record is rejected', 'bad'); return }
    mutate((d) => { const x = d.records.find((y) => y.id === r.id)!; x.status = 'missing'; x.verifiedById = undefined }, { entity: 'record', entityId: r.id, projectId: p.id, action: 'reject', summary: `${p.code}: rejected ${label} (${r.fileName}) — ${reason.trim()}` })
    setReason(''); toast('Record returned as missing', 'bad'); onClose()
  }
  const hist = s.audit.filter((a) => a.entityId === r.id).slice().reverse()
  return (
    <Drawer open onClose={onClose} title={label} width={520}>
      <div className="flex flex-col gap-4">
        <KV items={[['Status', <StatusBadge status={r.status} />], ['File', r.fileName ? <Mono>{r.fileName}</Mono> : '—'], ['Verified by', r.verifiedById ? personName(s, r.verifiedById) : '—'], ['Segment', r.segment]]} />
        {r.status !== 'verified' && (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="text-[13px] font-semibold">{r.status === 'missing' ? 'Attach the record' : 'Replace the attached file'}</div>
            <p className="text-[12px] text-muted">PDF scans of signed field records, test charts or mill certificates. The file name is kept as evidence; verification is a separate step by Records.</p>
            <FileButton size="md" variant={r.status === 'missing' ? 'primary' : 'secondary'} label={r.status === 'missing' ? 'Choose file…' : 'Replace file…'} onFile={attach} accept=".pdf,.tif,.tiff,.jpg,.png,.xlsx,.csv,.dwg" />
          </div>
        )}
        {r.status === 'attached' && (
          canVerify ? (
            <div className="flex flex-col gap-2 rounded-md border border-marker/60 bg-marker/5 p-3">
              <div className="text-[13px] font-semibold">Records verification</div>
              <p className="text-[12px] text-muted">Confirm the record is traceable (tied to this segment), verifiable (signed, legible, complete) and matches the as-built.</p>
              <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={verify}>Verify record</Button></div>
              <Input placeholder="Reason, if rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div><Button size="sm" variant="ghost" className="text-bad" onClick={reject}>Reject as incomplete</Button></div>
            </div>
          ) : <Callout tone="info">Awaiting verification by the Records role.</Callout>
        )}
        {r.status === 'verified' && <Callout tone="good">Verified records are locked. Records can reject and re-open them if a defect is found.</Callout>}
        {r.status === 'verified' && canVerify && (
          <div className="flex flex-wrap gap-2"><Input className="flex-1" placeholder="Reason for re-opening" value={reason} onChange={(e) => setReason(e.target.value)} /><Button variant="ghost" className="text-bad" onClick={reject}>Re-open</Button></div>
        )}
        {hist.length > 0 && (
          <div><div className="eyebrow mb-1">History</div><ul className="flex flex-col gap-1 text-[12px]">{hist.map((a) => <li key={a.id}><b>{personName(s, a.actorId)}</b> <span className="text-muted">{a.summary}</span></li>)}</ul></div>
        )}
      </div>
    </Drawer>
  )
}

// ───────────────────────────── Closeout
function Closeout({ p, items, rc, wfId, wfStatus }: { p: Project; items: CloseoutItem[]; rc: ReturnType<typeof recordsCompleteness>; wfId?: string; wfStatus?: string }) {
  const s = useStore()
  const [newItem, setNewItem] = useState('')
  const [newRole, setNewRole] = useState<RoleId>('pm')
  const pos = position(s, p.id)
  const openItems = items.filter((x) => x.status === 'open')
  const blocks: string[] = []
  if (!rc.total) blocks.push('No records matrix — records completeness cannot be shown')
  else if (rc.pct < 1) blocks.push(`${rc.total - rc.verified} of ${rc.total} records not verified (${rc.missing} missing, ${rc.attached} awaiting verification)`)
  if (!items.length) blocks.push('Closeout checklist not started')
  else if (openItems.length) blocks.push(`${openItems.length} checklist item${openItems.length === 1 ? '' : 's'} open`)
  if (pos.commitments > 0 && p.status !== 'closed') blocks.push(`${money(pos.commitments)} in open commitments`)
  const running = wfStatus === 'running'
  const approved = wfStatus === 'approved'
  const recordsBlock = blocks.filter((b) => !b.startsWith('$') && !b.includes('commitments'))

  const setStatus = (it: CloseoutItem, st: CloseoutItem['status']) => {
    mutate((d) => { const x = d.closeout.find((y) => y.id === it.id)!; x.status = st; x.done = st === 'done' ? d.settings.asOf : undefined }, { entity: 'closeout', entityId: it.id, projectId: p.id, action: st === 'done' ? 'complete' : st === 'n/a' ? 'not-applicable' : 'reopen', summary: `${p.code}: closeout item "${it.item}" ${st === 'done' ? 'completed' : st === 'n/a' ? 'marked not applicable' : 'reopened'}` })
    toast(st === 'done' ? 'Item completed' : st === 'n/a' ? 'Marked not applicable' : 'Item reopened')
  }
  const create = () => {
    mutate((d) => { for (const [item, role] of STD_CLOSEOUT) d.closeout.push({ id: uid('co'), projectId: p.id, item, ownerRole: role, status: 'open' }) }, { entity: 'closeout', entityId: p.id, projectId: p.id, action: 'create', summary: `${p.code}: started closeout checklist (${STD_CLOSEOUT.length} standard items)` })
    toast('Closeout checklist created')
  }
  const add = () => {
    if (!newItem.trim()) return
    mutate((d) => { d.closeout.push({ id: uid('co'), projectId: p.id, item: newItem.trim(), ownerRole: newRole, status: 'open' }) }, { entity: 'closeout', entityId: p.id, projectId: p.id, action: 'add-item', summary: `${p.code}: added closeout item "${newItem.trim()}" (${newRole})` })
    setNewItem(''); toast('Checklist item added')
  }
  const start = () => {
    let ok = false
    mutate((d) => {
      const inst = startWorkflow(d, 'closeout', { title: `${p.code} project closeout`, recordType: 'closeout', recordId: p.id, projectId: p.id, data: { inService: p.dates.inService ?? inServiceDate(p), recordsVerifiedPct: Math.round(rc.pct * 100), checklistDone: items.length - openItems.length, amount: pos.eac } })
      ok = !!inst
    }, { entity: 'closeout', entityId: p.id, projectId: p.id, action: 'submit', summary: `${p.code}: submitted for closeout (records ${pct(rc.pct)} verified, ${items.length - openItems.length}/${items.length} checklist items complete)` })
    toast(ok ? 'Closeout submitted for approval' : 'No published closeout workflow', ok ? 'good' : 'bad')
  }
  return (
    <Panel title="Closeout" subtitle="PM certifies completion → Records verifies → Plant Accounting accepts unitization → PMO freezes the evidence package" pad={false}
      actions={!items.length ? <Button size="sm" variant="primary" onClick={create}>Start closeout checklist</Button> : !wfId || (!running && !approved) ? <Button size="sm" variant={recordsBlock.length ? 'secondary' : 'marker'} disabled={recordsBlock.length > 0} onClick={start} title={recordsBlock.join('; ')}>{wfStatus ? 'Resubmit closeout' : 'Submit for closeout'}</Button> : undefined}>
      {!approved && blocks.length > 0 && (
        <div className="border-b border-line p-3">
          <Callout tone={recordsBlock.length ? 'bad' : 'warn'} title={recordsBlock.length ? 'Closeout is blocked' : 'Ready to submit, with notes'}>
            <ul className="ml-4 list-disc">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
          </Callout>
        </div>
      )}
      {approved && <div className="border-b border-line p-3"><Callout tone="good" title="Closeout accepted">PMO accepted closeout. Record the Gate {templateFor(s, p).stages.length} decision in Lifecycle & gates to close the project.</Callout></div>}
      {items.length > 0 && (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Item</th><th>Owner</th><th>Status</th><th>Completed</th><th style={{ width: 210 }} /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className={cx('font-semibold', it.status !== 'open' && 'text-muted')}>{it.item}</td>
                  <td className="whitespace-nowrap text-[12px]">{roleName(s.roles, it.ownerRole)}<div className="text-faint">{personName(s, ownerForRole(s, p, it.ownerRole))}</div></td>
                  <td><StatusBadge status={it.status === 'n/a' ? 'cancelled' : it.status} label={it.status === 'n/a' ? 'N/A' : undefined} /></td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDate(it.done)}</td>
                  <td className="whitespace-nowrap text-right">
                    {it.status === 'open' ? <><Button size="sm" variant="primary" disabled={running} onClick={() => setStatus(it, 'done')}>Mark done</Button><Button size="sm" variant="ghost" disabled={running} onClick={() => setStatus(it, 'n/a')}>N/A</Button></>
                      : <Button size="sm" variant="ghost" disabled={running || approved} onClick={() => setStatus(it, 'open')}>Reopen</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 0 && !running && !approved && (
        <form className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); add() }}>
          <Input className="h-7 min-w-[220px] flex-1 py-0.5" placeholder="Add a project-specific closeout item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <div className="w-52"><RoleSelect value={newRole} onChange={setNewRole} /></div>
          <Button size="sm" type="submit" disabled={!newItem.trim()}>Add item</Button>
        </form>
      )}
      {wfId && <div className="border-t border-line p-3"><WorkflowStatus instanceId={wfId} /></div>}
    </Panel>
  )
}

// ───────────────────────────── As-built / GIS handoff
function Handoff({ p }: { p: Project }) {
  const s = useStore()
  const asb = s.records.filter((r) => r.projectId === p.id && r.type === 'As-built drawing')
  const ready = asb.length > 0 && asb.every((r) => r.status === 'verified')
  const co = s.closeout.find((x) => x.projectId === p.id && /GIS/i.test(x.item))
  const [gis, setGis] = useState('')
  const addGis = () => {
    const id = gis.trim().toUpperCase()
    if (!id || p.gisIds.includes(id)) return
    mutate((d) => { d.projects.find((x) => x.id === p.id)!.gisIds.push(id) }, { entity: 'project', entityId: p.id, projectId: p.id, action: 'gis-link', summary: `${p.code}: linked GIS feature ${id}` })
    setGis(''); toast('GIS feature linked')
  }
  const handoff = () => {
    mutate((d) => {
      const x = d.closeout.find((y) => y.projectId === p.id && /GIS/i.test(y.item))
      if (x) { x.status = 'done'; x.done = d.settings.asOf }
    }, { entity: 'project', entityId: p.id, projectId: p.id, action: 'gis-handoff', summary: `${p.code}: as-builts handed off to GIS for features ${p.gisIds.join(', ')} (${asb.length} verified drawing${asb.length === 1 ? '' : 's'})` })
    toast('As-builts handed off to GIS')
  }
  return (
    <Panel title="As-built & GIS handoff" subtitle="Verified as-builts update the GIS features the project touched">
      <div className="flex flex-col gap-3">
        <KV cols={2} items={[
          ['Asset', `${humanizeId(p.asset.type)} · ${p.asset.lineId}`],
          ['Pipe', p.asset.diameterIn ? `${p.asset.diameterIn}" ${p.asset.material}, MAOP ${num(p.asset.maopPsig)} psig` : p.asset.material],
          ['As-built drawings', asb.length ? `${asb.filter((r) => r.status === 'verified').length}/${asb.length} verified` : 'None required yet'],
          ['GIS handoff', co ? <StatusBadge status={co.status} label={co.status === 'done' ? `Done ${fmtDate(co.done)}` : 'Open'} /> : '—'],
        ]} />
        <div>
          <div className="mb-1 text-[12px] font-semibold text-muted">GIS features</div>
          <div className="flex flex-wrap gap-1">{p.gisIds.map((g) => <Badge key={g}><Mono>{g}</Mono></Badge>)}</div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addGis() }}>
            <Input className="h-7 w-48 py-0.5 font-mono" placeholder="SEG-…" value={gis} onChange={(e) => setGis(e.target.value)} />
            <Button size="sm" type="submit" disabled={!gis.trim()}>Link feature</Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={ready && co?.status !== 'done' ? 'marker' : 'secondary'} disabled={!ready || co?.status === 'done'} onClick={handoff}>{co?.status === 'done' ? 'Handed off to GIS' : 'Hand off as-builts to GIS'}</Button>
          {!ready && asb.length > 0 && <span className="text-[12px] text-muted">All as-built drawings must be verified first.</span>}
        </div>
      </div>
    </Panel>
  )
}

// ───────────────────────────── Unitization
function Unitization({ p }: { p: Project }) {
  const s = useStore()
  const b = activeBudget(s, p.id)
  const pos = position(s, p.id)
  const rows = useMemo(() => {
    if (!b) return []
    const tot = sum(Object.values(b.byCategory))
    return Object.entries(b.byCategory).filter(([, v]) => v).map(([cid, v]) => {
      const c = s.categories.find((x) => x.id === cid)
      return { cid, code: c?.code ?? '', name: c?.name ?? cid, erp: c?.erpCostElement ?? '', budget: v, share: tot ? v / tot : 0, final: Math.round((tot ? v / tot : 0) * (pos.actualToDate || pos.eac)) }
    }).sort((a, z) => a.code.localeCompare(z.code))
  }, [b, s.categories, pos.actualToDate, pos.eac])
  const primary = p.scope.quantities[0]
  const basis = pos.actualToDate || pos.eac
  const exportCsv = async () => {
    const data = [
      ...p.scope.quantities.map((q) => ({ section: 'Asset unit', project: p.code, wbs: p.erpWbs, item: q.label, qty: q.qty, unit: q.unit, cost_element: '', amount: '' })),
      ...rows.map((r) => ({ section: 'Cost', project: p.code, wbs: p.erpWbs, item: `${r.code} ${r.name}`, qty: '', unit: '', cost_element: r.erp, amount: r.final })),
    ]
    const res = await saveFile(`${p.code}-unitization.csv`, toCSV(data), 'text/csv')
    if (res === 'saved') { mutate(() => {}, { entity: 'project', entityId: p.id, projectId: p.id, action: 'export-unitization', summary: `${p.code}: exported unitization package for plant accounting (${money(basis)} across ${rows.length} cost elements)` }); toast('Unitization package exported') }
    else toast('Download not available here', 'info')
  }
  if (!b) return <Panel title="Unitization summary"><Empty title="No budget yet">Unitization uses the control budget's cost breakdown once one exists.</Empty></Panel>
  return (
    <Panel title="Unitization summary" subtitle={`Asset units and cost by category for plant accounting · WBS ${p.erpWbs} · allocated on ${pos.actualToDate ? 'actual to date' : 'forecast'} ${money(basis)}`} pad={false}
      actions={<Button size="sm" onClick={exportCsv}>Export for plant accounting</Button>}>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-4 py-3">
        {p.scope.quantities.map((q) => <div key={q.label}><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{q.label}</div><div className="font-display text-[17px] font-bold tabular-nums">{num(q.qty)} <span className="text-[12px] font-normal text-muted">{q.unit}</span></div></div>)}
        {primary && primary.qty > 0 && <div><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Unit cost</div><div className="font-display text-[17px] font-bold tabular-nums">{money(basis / primary.qty)} <span className="text-[12px] font-normal text-muted">/ {primary.unit}</span></div></div>}
      </div>
      <div className="scroll-x" style={{ maxHeight: 340, overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Category</th><th>ERP element</th><th className="num">Budget</th><th className="num">Share</th><th className="num">Allocated</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.cid}><td className="whitespace-nowrap"><Mono className="text-faint">{r.code}</Mono> {r.name}</td><td><Mono>{r.erp}</Mono></td><td className="num">{money(r.budget)}</td><td className="num text-muted">{pct(r.share, 1)}</td><td className="num font-semibold">{money(r.final)}</td></tr>)}
            <tr><td colSpan={2} className="font-semibold">Total (excl. contingency)</td><td className="num font-semibold">{money(sum(rows.map((r) => r.budget)))}</td><td className="num">100%</td><td className="num font-semibold">{money(sum(rows.map((r) => r.final)))}</td></tr>
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ───────────────────────────── Lessons learned
function Lessons({ p }: { p: Project }) {
  const s = useStore()
  const mine = s.lessons.filter((l) => l.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date))
  const similar = s.lessons.filter((l) => l.projectId !== p.id && l.workMethods.includes(p.workMethod)).slice(0, 4)
  const [open, setOpen] = useState(false)
  const [d, setD] = useState({ title: '', category: 'Construction', text: '', workMethods: [p.workMethod] as WorkMethod[] })
  const save = () => {
    if (!d.title.trim() || !d.text.trim()) { toast('Add a title and what happened', 'bad'); return }
    const id = uid('les')
    mutate((x) => { x.lessons.push({ id, projectId: p.id, date: x.settings.asOf, title: d.title.trim(), category: d.category, text: d.text.trim(), workMethods: d.workMethods }) }, { entity: 'lesson', entityId: id, projectId: p.id, action: 'create', summary: `${p.code}: captured lesson "${d.title.trim()}" (${d.category}; ${d.workMethods.join(', ')})` })
    setD({ title: '', category: 'Construction', text: '', workMethods: [p.workMethod] }); setOpen(false); toast('Lesson captured')
  }
  const remove = (id: string, title: string) => {
    mutate((x) => { x.lessons = x.lessons.filter((l) => l.id !== id) }, { entity: 'lesson', entityId: id, projectId: p.id, action: 'delete', summary: `${p.code}: removed lesson "${title}"` })
    toast('Lesson removed')
  }
  return (
    <Panel title="Lessons learned" subtitle="Tagged by work method so estimators and PMs see them on similar projects" pad={false}
      actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>Add lesson</Button>}>
      {mine.length === 0 ? <div className="p-4"><Empty title="No lessons captured yet">Lessons are required for closeout. Capture what you would repeat or avoid.</Empty></div> : (
        <ul className="divide-y divide-line">
          {mine.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">{l.title}</b><Badge>{l.category}</Badge>{l.workMethods.map((w) => <Badge key={w} tone="info">{humanizeId(w)}</Badge>)}</div>
                <p className="mt-0.5 text-[13px] text-muted">{l.text}</p>
              </div>
              <span className="text-[12px] text-faint">{fmtDate(l.date)}</span>
              <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove" onConfirm={() => remove(l.id, l.title)}>Remove</ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      {similar.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <div className="eyebrow mb-1.5">From similar {humanizeId(p.workMethod).toLowerCase()} projects</div>
          <ul className="flex flex-col gap-1 text-[13px]">{similar.map((l) => <li key={l.id}><b>{l.title}</b> <span className="text-muted">· {s.projects.find((x) => x.id === l.projectId)?.code} · {l.category}</span></li>)}</ul>
        </div>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title="Capture a lesson" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save lesson</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Lesson (one line)"><Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Book outage windows at Gate 2" /></Field>
          <Field label="Category"><Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={['Estimating', 'Permitting', 'Scheduling', 'Procurement', 'Construction', 'Safety', 'Records', 'Stakeholder']} /></Field>
          <Field label="What happened and what to do next time"><TextArea rows={5} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} /></Field>
          <Field label="Applies to work methods"><MultiCheck options={WORK_METHODS.map((w) => ({ id: w, label: humanizeId(w) }))} value={d.workMethods} onChange={(v) => setD({ ...d, workMethods: v as WorkMethod[] })} /></Field>
        </div>
      </Drawer>
    </Panel>
  )
}
