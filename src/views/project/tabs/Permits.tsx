// Permits & conditions, land rights, contracts (with award workflow) and long-lead materials (V1.5) + AI-03.
import { useEffect, useState } from 'react'
import type { Contract, LandRight, LongLeadItem, Permit } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { startWorkflow } from '@/core/engine/workflow'
import { permissions } from '@/core/engine/gates'
import { askJSON, aiMessage, useAiAvailable } from '@/core/ai'
import { addDays, cx, daysBetween, fmtDate, money, sum, uid } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, Drawer, Empty, Field, Input, MoneyInput, Panel, Select, Stat, StatusBadge, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { constructionStart, useDraft } from '../../admin/common'

export default function Permits({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const asOf = s.settings.asOf
  const permits = s.permits.filter((x) => x.projectId === projectId)
  const land = s.landRights.filter((x) => x.projectId === projectId)
  const contracts = s.contracts.filter((x) => x.projectId === projectId)
  const longLead = s.longLead.filter((x) => x.projectId === projectId)
  const cStart = constructionStart(p)
  const started = !!cStart && cStart <= asOf

  const openConds = permits.flatMap((x) => x.conditions.filter((c) => c.status === 'open'))
  const overdueConds = openConds.filter((c) => c.due && c.due < asOf)
  const expiring = permits.filter((x) => x.expires && x.status === 'issued' && daysBetween(asOf, x.expires) <= 60)
  const landLate = land.filter((l) => l.status !== 'acquired' && ((cStart && l.needBy > cStart) || l.needBy < asOf))
  const llLate = longLead.filter((l) => l.status !== 'received' && (l.eta > l.requiredOnSite || (cStart && l.eta > cStart)))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Permits issued" value={`${permits.filter((x) => x.status === 'issued').length}/${permits.length}`} tone={permits.some((x) => x.status !== 'issued') ? 'warn' : 'good'} sub={expiring.length ? `${expiring.length} expiring within 60 days` : 'None expiring within 60 days'} />
        <Stat label="Open permit conditions" value={openConds.length} tone={overdueConds.length ? 'bad' : undefined} sub={overdueConds.length ? `${overdueConds.length} past due` : 'None past due'} />
        <Stat label="Land rights acquired" value={`${land.filter((l) => l.status === 'acquired').length}/${land.length}`} tone={landLate.length ? 'bad' : undefined} sub={landLate.length ? `${landLate.length} at risk vs schedule` : cStart ? `Construction start ${fmtDate(cStart)}` : 'No construction date'} />
        <Stat label="Contracts committed" value={money(sum(contracts.filter((c) => c.status !== 'rfp').map((c) => c.value + c.changeOrders)))} sub={`${money(sum(contracts.map((c) => c.invoiced)))} invoiced · ${llLate.length} late material item${llLate.length === 1 ? '' : 's'}`} tone={llLate.length ? 'warn' : undefined} />
      </div>
      <PermitsPanel projectId={projectId} permits={permits} asOf={asOf} started={started} />
      <LandPanel projectId={projectId} land={land} asOf={asOf} cStart={cStart} />
      <ContractsPanel projectId={projectId} contracts={contracts} canAward={permissions(s, p).has('contract-award')} />
      <LongLeadPanel projectId={projectId} items={longLead} asOf={asOf} cStart={cStart} />
    </div>
  )
}

// ───────────────────────────── Permits
function PermitsPanel({ projectId, permits, asOf, started }: { projectId: string; permits: Permit[]; asOf: string; started: boolean }) {
  const aiOn = useAiAvailable()
  const p = useStore((s) => s.projects.find((x) => x.id === projectId)!)
  const [edit, setEdit] = useState<{ pm: Permit; isNew: boolean } | null>(null)
  const [extract, setExtract] = useState<Permit | null>(null)
  const [open, setOpen] = useState<string | null>(permits.find((x) => x.conditions.some((c) => c.status === 'open'))?.id ?? null)
  const toggle = (pm: Permit, cid: string) => {
    const c = pm.conditions.find((x) => x.id === cid)!
    const next = c.status === 'open' ? 'met' : 'open'
    mutate((d) => { const x = d.permits.find((y) => y.id === pm.id)!.conditions.find((y) => y.id === cid)!; x.status = next }, { entity: 'permit', entityId: pm.id, projectId, action: next === 'met' ? 'condition-met' : 'condition-reopened', summary: `${pm.type} ${pm.number}: condition "${c.text}" marked ${next}` })
    toast(next === 'met' ? 'Condition marked met' : 'Condition reopened')
  }
  return (
    <Panel title="Permits & conditions" subtitle="Agency permits with expiry tracking. Construction NTP is blocked while any permit is not issued." pad={false}
      actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, pm: { id: uid('pmt'), projectId, agency: '', type: '', number: '', status: 'not-applied', conditions: [] } })}>Add permit</Button>}>
      {permits.length === 0 ? <div className="p-4"><Empty title="No permits recorded">Add the encroachment, discharge, air or CEQA permits this project needs.</Empty></div> : (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Permit</th><th>Number</th><th>Status</th><th>Applied</th><th>Issued</th><th>Expires</th><th className="num">Conditions</th><th /></tr></thead>
            <tbody>
              {permits.map((pm) => {
                const days = pm.expires ? daysBetween(asOf, pm.expires) : undefined
                const oc = pm.conditions.filter((c) => c.status === 'open')
                const isOpen = open === pm.id
                return [
                  <tr key={pm.id} className="clickable" onClick={() => setOpen(isOpen ? null : pm.id)}>
                    <td className="min-w-[200px]"><b>{pm.type}</b><div className="text-[12px] text-muted">{pm.agency}</div></td>
                    <td className="font-mono text-[12px]">{pm.number || '—'}</td>
                    <td><StatusBadge status={pm.status} />{pm.status !== 'issued' && started && <div className="mt-0.5 text-[11px] text-bad">Construction underway</div>}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(pm.applied)}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(pm.issued)}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(pm.expires)}{days !== undefined && pm.status === 'issued' && (days < 0 ? <div><Badge tone="bad">Expired {-days}d ago</Badge></div> : days <= 60 ? <div><Badge tone="warn">{days}d left</Badge></div> : null)}</td>
                    <td className="num">{oc.length ? <Badge tone={oc.some((c) => c.due && c.due < asOf) ? 'bad' : 'info'}>{oc.length} open</Badge> : <span className="text-[12px] text-faint">{pm.conditions.length} met</span>}</td>
                    <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" onClick={() => setEdit({ pm, isNew: false })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : pm.id)}>{isOpen ? 'Hide' : 'Conditions'}</Button></td>
                  </tr>,
                  isOpen && (
                    <tr key={pm.id + '-c'}>
                      <td colSpan={8} className="bg-sunken/40">
                        <div className="flex flex-col gap-2 py-1">
                          {pm.conditions.length === 0 && <p className="text-[13px] text-muted">No conditions recorded.</p>}
                          {pm.conditions.map((c) => {
                            const late = c.status === 'open' && c.due && c.due < asOf
                            return (
                              <div key={c.id} className="flex flex-wrap items-start gap-3 text-[13px]">
                                <Checkbox checked={c.status === 'met'} onChange={() => toggle(pm, c.id)} label={<span className={cx(c.status === 'met' && 'text-muted line-through')}>{c.text}</span>} />
                                <span className={cx('ml-auto whitespace-nowrap text-[12px]', late ? 'font-semibold text-bad' : 'text-muted')}>{c.due ? `Due ${fmtDate(c.due)}${late ? ' · past due' : ''}` : 'No due date'}</span>
                              </div>
                            )
                          })}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <AddCondition pm={pm} projectId={projectId} />
                            {aiOn && <Button size="sm" onClick={() => setExtract(pm)}><AiTag>AI</AiTag> Extract conditions from permit text</Button>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      <PermitDrawer edit={edit} onClose={() => setEdit(null)} projectCode={p.code} />
      <ExtractDrawer permit={extract} onClose={() => setExtract(null)} projectName={p.name} asOf={asOf} />
    </Panel>
  )
}

function AddCondition({ pm, projectId }: { pm: Permit; projectId: string }) {
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const add = () => {
    if (!text.trim()) return
    mutate((d) => { d.permits.find((x) => x.id === pm.id)!.conditions.push({ id: uid('pc'), text: text.trim(), due: due || undefined, status: 'open' }) }, { entity: 'permit', entityId: pm.id, projectId, action: 'condition-added', summary: `${pm.type} ${pm.number}: added condition "${text.trim()}"${due ? ` due ${due}` : ''}` })
    setText(''); setDue(''); toast('Condition added')
  }
  return (
    <form className="flex min-w-0 flex-1 flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
      <Input className="h-7 min-w-[220px] flex-1 py-0.5" placeholder="New condition" value={text} onChange={(e) => setText(e.target.value)} />
      <Input className="h-7 w-[150px] py-0.5" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
      <Button size="sm" type="submit" disabled={!text.trim()}>Add condition</Button>
    </form>
  )
}

function PermitDrawer({ edit, onClose, projectCode }: { edit: { pm: Permit; isNew: boolean } | null; onClose: () => void; projectCode: string }) {
  const [pm, setPm] = useDraft<Permit | null>(edit?.pm ?? null)
  if (!edit || !pm) return null
  const save = () => {
    if (!pm.type.trim() || !pm.agency.trim()) { toast('Agency and permit type are required', 'bad'); return }
    const prev = edit.pm
    const fix: Permit = { ...pm, issued: pm.status === 'issued' ? pm.issued ?? useStore.getState().settings.asOf : pm.issued, applied: pm.status !== 'not-applied' ? pm.applied ?? useStore.getState().settings.asOf : pm.applied }
    mutate((d) => { const i = d.permits.findIndex((x) => x.id === pm.id); if (i >= 0) d.permits[i] = fix; else d.permits.push(fix) },
      { entity: 'permit', entityId: pm.id, projectId: pm.projectId, action: edit.isNew ? 'create' : prev.status !== pm.status ? `status-${pm.status}` : 'update', summary: edit.isNew ? `${projectCode}: added ${pm.type} (${pm.agency})` : `${projectCode}: ${pm.type} ${pm.number}${prev.status !== pm.status ? ` ${prev.status} → ${pm.status}` : ' updated'}${prev.expires !== pm.expires ? `, expires ${pm.expires}` : ''}` })
    toast(edit.isNew ? 'Permit added' : 'Permit saved'); onClose()
  }
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add permit' : `${pm.type}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save permit</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Agency"><Input value={pm.agency} onChange={(e) => setPm({ ...pm, agency: e.target.value })} placeholder="City of …" /></Field>
        <Field label="Permit type"><Input value={pm.type} onChange={(e) => setPm({ ...pm, type: e.target.value })} placeholder="Encroachment permit" /></Field>
        <Field label="Permit number"><Input className="font-mono" value={pm.number} onChange={(e) => setPm({ ...pm, number: e.target.value })} /></Field>
        <Field label="Status"><Select value={pm.status} onChange={(e) => setPm({ ...pm, status: e.target.value as Permit['status'] })} options={[{ value: 'not-applied', label: 'Not applied' }, { value: 'applied', label: 'Applied' }, { value: 'issued', label: 'Issued' }, { value: 'expired', label: 'Expired' }]} /></Field>
        <Field label="Applied"><Input type="date" value={pm.applied ?? ''} onChange={(e) => setPm({ ...pm, applied: e.target.value || undefined })} /></Field>
        <Field label="Issued"><Input type="date" value={pm.issued ?? ''} onChange={(e) => setPm({ ...pm, issued: e.target.value || undefined })} /></Field>
        <Field label="Expires"><Input type="date" value={pm.expires ?? ''} onChange={(e) => setPm({ ...pm, expires: e.target.value || undefined })} /></Field>
      </div>
    </Drawer>
  )
}

interface Extracted { text: string; due?: string; dueBasis?: string; accept: boolean }

function ExtractDrawer({ permit, onClose, projectName, asOf }: { permit: Permit | null; onClose: () => void; projectName: string; asOf: string }) {
  const ai = useAiAvailable()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<Extracted[]>([])
  const [err, setErr] = useState('')
  if (!permit) return null
  const sample = `CONDITIONS OF APPROVAL — ${permit.type.toUpperCase()} ${permit.number}\n1. Permittee shall notify the City Inspector at least 48 hours prior to commencing work.\n2. No lane closures on arterial streets between 7:00–9:00 AM or 4:00–6:00 PM.\n3. Submit a traffic control plan stamped by a registered engineer no later than 10 working days before start.\n4. All trenches in the roadway shall be plated or backfilled at the end of each work day.\n5. Final paving shall be completed within 30 days of trench backfill and shall extend curb to lane line.\n6. Provide written notice to all fronting residents and businesses 72 hours before work.`
  const run = async () => {
    setBusy(true); setErr(''); setItems([])
    try {
      const prompt = `You extract compliance conditions from a permit issued to a gas utility for a capital project.
Project: ${projectName}. Permit: ${permit.type} ${permit.number} from ${permit.agency}. Today is ${asOf}.
Return JSON exactly: {"conditions":[{"text":"<one obligation, imperative, under 140 chars>","due":"YYYY-MM-DD or null","dueBasis":"<short phrase if the deadline is relative, e.g. '48 h before start', else null>"}]}
Rules: one entry per distinct obligation the utility or its contractor must meet; skip boilerplate definitions and agency obligations; use a calendar date only if the text states one; do not invent conditions.
Already tracked (do not repeat): ${JSON.stringify(permit.conditions.map((c) => c.text))}
PERMIT TEXT:
"""${text.slice(0, 12000)}"""`
      const r = await askJSON<{ conditions: { text: string; due?: string | null; dueBasis?: string | null }[] }>(prompt)
      const list = (r?.conditions ?? []).filter((c) => c && typeof c.text === 'string' && c.text.trim())
      setItems(list.map((c) => ({ text: c.text.trim(), due: c.due && /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : undefined, dueBasis: c.dueBasis ?? undefined, accept: true })))
      if (!list.length) setErr('No conditions found in that text.')
    } catch (e) { setErr(aiMessage(e)) } finally { setBusy(false) }
  }
  const accept = () => {
    const chosen = items.filter((x) => x.accept && x.text.trim())
    mutate((d) => { const pm = d.permits.find((x) => x.id === permit.id)!; for (const c of chosen) pm.conditions.push({ id: uid('pc'), text: c.text, due: c.due, status: 'open' }) },
      { entity: 'permit', entityId: permit.id, projectId: permit.projectId, action: 'conditions-accepted', summary: `${permit.type} ${permit.number}: accepted ${chosen.length} AI-extracted condition${chosen.length === 1 ? '' : 's'} after review` })
    toast(`${chosen.length} condition${chosen.length === 1 ? '' : 's'} added`); setItems([]); setText(''); onClose()
  }
  return (
    <Drawer open onClose={onClose} width={640} title={<span className="flex items-center gap-2">Extract permit conditions <AiTag>AI assist</AiTag></span>}
      footer={items.length ? <><Button variant="ghost" onClick={() => setItems([])}>Discard</Button><Button variant="primary" disabled={!items.some((x) => x.accept)} onClick={accept}>Accept {items.filter((x) => x.accept).length} condition{items.filter((x) => x.accept).length === 1 ? '' : 's'}</Button></> : undefined}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">Paste the conditions-of-approval section of <b className="text-ink">{permit.type} {permit.number}</b>. AI assist drafts a list of obligations; you review each one before it is added to the tracker.</p>
        <TextArea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste permit text…" />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!text.trim() || busy || ai === false} onClick={run}>{busy ? 'Thinking…' : 'Extract conditions'}</Button>
          {!text && <Button variant="ghost" onClick={() => setText(sample)}>Use sample permit text</Button>}
        </div>
        {err && <Callout tone="bad">{err}</Callout>}
        {items.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-info/40 bg-info/5 p-3">
            <div className="flex items-center gap-2"><AiTag /> <span className="text-[13px] font-semibold">{items.length} conditions found — review before accepting</span></div>
            {items.map((c, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_150px] items-start gap-2">
                <input type="checkbox" className="mt-2 h-4 w-4" checked={c.accept} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, accept: e.target.checked } : x)))} aria-label="Accept" />
                <div><Input className="h-8" value={c.text} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />{c.dueBasis && <div className="mt-0.5 text-[11px] text-muted">Deadline: {c.dueBasis}</div>}</div>
                <Input className="h-8" type="date" value={c.due ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, due: e.target.value || undefined } : x)))} aria-label="Due" />
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}

// ───────────────────────────── Land rights
function LandPanel({ projectId, land, asOf, cStart }: { projectId: string; land: LandRight[]; asOf: string; cStart?: string }) {
  const code = useStore((s) => s.projects.find((x) => x.id === projectId)!.code)
  const [edit, setEdit] = useState<{ lr: LandRight; isNew: boolean } | null>(null)
  const flag = (l: LandRight) => {
    if (l.status === 'acquired') return null
    if (l.needBy < asOf) return <Badge tone="bad">Need-by passed</Badge>
    if (cStart && l.needBy > cStart) return <Badge tone="bad">After construction start</Badge>
    if (daysBetween(asOf, l.needBy) <= 45) return <Badge tone="warn">{daysBetween(asOf, l.needBy)}d to need-by</Badge>
    return null
  }
  return (
    <Panel title="Land rights" subtitle={cStart ? `Need-by dates are checked against construction start ${fmtDate(cStart)}` : 'Parcels, rights and acquisition status'} pad={false}
      actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, lr: { id: uid('lr'), projectId, parcel: '', owner: '', type: 'Temporary right of entry', status: 'identified', needBy: cStart ? addDays(cStart, -30) : asOf, cost: 0 } })}>Add parcel</Button>}>
      {land.length === 0 ? <div className="p-4"><Empty title="No land rights">This project has no parcels recorded.</Empty></div> : (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Parcel</th><th>Owner</th><th>Right</th><th>Status</th><th>Need by</th><th>Schedule check</th><th className="num">Cost</th><th /></tr></thead>
            <tbody>
              {land.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setEdit({ lr: l, isNew: false })}>
                  <td className="whitespace-nowrap font-mono text-[12px]">{l.parcel}</td>
                  <td>{l.owner}</td>
                  <td className="text-[12px]">{l.type}</td>
                  <td><StatusBadge status={l.status} /></td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDate(l.needBy)}</td>
                  <td>{flag(l) ?? <span className="text-[12px] text-faint">{l.status === 'acquired' ? 'Secured' : 'On track'}</span>}</td>
                  <td className="num">{money(l.cost)}</td>
                  <td><Button size="sm" variant="ghost">Edit</Button></td>
                </tr>
              ))}
              <tr><td colSpan={6} className="text-right text-[12px] font-semibold text-muted">Total land cost</td><td className="num font-semibold">{money(sum(land.map((l) => l.cost)))}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      {(() => {
        const [lr, setLr] = [edit?.lr, (v: LandRight) => setEdit(edit ? { ...edit, lr: v } : null)]
        if (!edit || !lr) return null
        const save = () => {
          if (!lr.parcel.trim()) { toast('Parcel is required', 'bad'); return }
          mutate((d) => { const i = d.landRights.findIndex((x) => x.id === lr.id); if (i >= 0) d.landRights[i] = lr; else d.landRights.push(lr) },
            { entity: 'land-right', entityId: lr.id, projectId, action: edit.isNew ? 'create' : 'update', summary: `${code}: ${edit.isNew ? 'added' : 'updated'} ${lr.type.toLowerCase()} on ${lr.parcel} (${lr.status}, need by ${lr.needBy})` })
          toast(edit.isNew ? 'Parcel added' : 'Land right saved'); setEdit(null)
        }
        return (
          <Drawer open onClose={() => setEdit(null)} title={edit.isNew ? 'Add parcel' : lr.parcel} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Parcel (APN)"><Input className="font-mono" value={lr.parcel} onChange={(e) => setLr({ ...lr, parcel: e.target.value })} /></Field>
              <Field label="Owner"><Input value={lr.owner} onChange={(e) => setLr({ ...lr, owner: e.target.value })} /></Field>
              <Field label="Right"><Select value={lr.type} onChange={(e) => setLr({ ...lr, type: e.target.value as LandRight['type'] })} options={['Temporary right of entry', 'Permanent easement', 'Fee purchase', 'License']} /></Field>
              <Field label="Status"><Select value={lr.status} onChange={(e) => setLr({ ...lr, status: e.target.value as LandRight['status'] })} options={['identified', 'negotiating', 'acquired']} /></Field>
              <Field label="Need by" hint={cStart ? `Construction start ${fmtDate(cStart)}` : undefined}><Input type="date" value={lr.needBy} onChange={(e) => setLr({ ...lr, needBy: e.target.value })} /></Field>
              <Field label="Cost"><MoneyInput value={lr.cost} onChange={(v) => setLr({ ...lr, cost: v })} /></Field>
            </div>
          </Drawer>
        )
      })()}
    </Panel>
  )
}

// ───────────────────────────── Contracts
function ContractsPanel({ projectId, contracts, canAward }: { projectId: string; contracts: Contract[]; canAward: boolean }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const [edit, setEdit] = useState<{ c: Contract; isNew: boolean } | null>(null)
  const [award, setAward] = useState<Contract | null>(null)
  const [show, setShow] = useState<string | null>(contracts.find((c) => c.workflowInstanceId && s.workflows.find((w) => w.id === c.workflowInstanceId)?.status === 'running')?.id ?? null)
  const running = (c: Contract) => c.workflowInstanceId && s.workflows.find((w) => w.id === c.workflowInstanceId)?.status === 'running'
  return (
    <Panel title="Contracts" subtitle={canAward ? 'Awards route through supply, legal (if non-standard) and the approver with dollar authority' : 'Contract award unlocks when the authorization gate is passed (or an early-start waiver is approved)'} pad={false}
      actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, c: { id: uid('ctr'), projectId, number: '', vendor: '', type: 'Construction', value: 0, changeOrders: 0, invoiced: 0, status: 'rfp' } })}>Add contract</Button>}>
      {contracts.length === 0 ? <div className="p-4"><Empty title="No contracts yet">Contracts appear once engineering or construction is sourced.</Empty></div> : (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Contract</th><th>Vendor</th><th>Type</th><th>Status</th><th className="num">Value</th><th className="num">Change orders</th><th className="num">Invoiced</th><th style={{ width: 130 }}>Billed</th><th /></tr></thead>
            <tbody>
              {contracts.map((c) => {
                const total = c.value + c.changeOrders
                const billed = total ? c.invoiced / total : 0
                return [
                  <tr key={c.id}>
                    <td className="whitespace-nowrap font-mono text-[12px] font-semibold">{c.number || 'Pending'}{c.awarded && <div className="font-sans text-[11px] font-normal text-faint">Awarded {fmtDate(c.awarded)}</div>}</td>
                    <td>{c.vendor || <span className="text-faint">TBD</span>}</td>
                    <td className="text-[12px]">{c.type}</td>
                    <td><StatusBadge status={running(c) ? 'in-review' : c.status} label={running(c) ? 'Award in review' : c.status === 'rfp' ? 'RFP' : undefined} /></td>
                    <td className="num">{money(c.value)}</td>
                    <td className="num">{c.changeOrders ? <span className={c.changeOrders / Math.max(1, c.value) > 0.1 ? 'text-bad' : ''}>{money(c.changeOrders)}<div className="text-[11px] text-faint">{((c.changeOrders / Math.max(1, c.value)) * 100).toFixed(1)}%</div></span> : '—'}</td>
                    <td className="num">{money(c.invoiced)}</td>
                    <td><div className="h-1.5 rounded-full bg-sunken"><div className={cx('h-1.5 rounded-full', billed > 1 ? 'bg-bad' : 'bg-link')} style={{ width: `${Math.min(100, billed * 100)}%` }} /></div><div className="text-[11px] tabular-nums text-faint">{(billed * 100).toFixed(0)}%</div></td>
                    <td className="whitespace-nowrap">
                      {c.status === 'rfp' && !running(c) && <Button size="sm" variant={canAward ? 'marker' : 'secondary'} disabled={!canAward} title={canAward ? undefined : 'Pass the authorization gate first'} onClick={() => setAward(c)}>Start award</Button>}
                      {c.workflowInstanceId && <Button size="sm" variant="ghost" onClick={() => setShow(show === c.id ? null : c.id)}>{show === c.id ? 'Hide' : 'Workflow'}</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ c, isNew: false })}>Edit</Button>
                    </td>
                  </tr>,
                  show === c.id && c.workflowInstanceId && <tr key={c.id + '-wf'}><td colSpan={9} className="bg-sunken/40"><WorkflowStatus instanceId={c.workflowInstanceId} /></td></tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      <ContractDrawer edit={edit} onClose={() => setEdit(null)} code={p.code} />
      <AwardModal c={award} onClose={() => setAward(null)} onStarted={(id) => setShow(id)} code={p.code} />
    </Panel>
  )
}

function ContractDrawer({ edit, onClose, code }: { edit: { c: Contract; isNew: boolean } | null; onClose: () => void; code: string }) {
  const [c, setC] = useDraft<Contract | null>(edit?.c ?? null)
  if (!edit || !c) return null
  const locked = !edit.isNew && edit.c.status !== 'rfp'
  const save = () => {
    if (!c.vendor.trim() && c.status !== 'rfp') { toast('Vendor is required once awarded', 'bad'); return }
    const prev = edit.c
    const parts: string[] = []
    if (prev.changeOrders !== c.changeOrders) parts.push(`change orders ${money(prev.changeOrders)} → ${money(c.changeOrders)}`)
    if (prev.invoiced !== c.invoiced) parts.push(`invoiced ${money(prev.invoiced)} → ${money(c.invoiced)}`)
    if (prev.status !== c.status) parts.push(`status ${prev.status} → ${c.status}`)
    if (prev.value !== c.value) parts.push(`value ${money(prev.value)} → ${money(c.value)}`)
    mutate((d) => { const i = d.contracts.findIndex((x) => x.id === c.id); if (i >= 0) d.contracts[i] = c; else d.contracts.push(c) },
      { entity: 'contract', entityId: c.id, projectId: c.projectId, action: edit.isNew ? 'create' : 'update', summary: edit.isNew ? `${code}: added ${c.type.toLowerCase()} contract ${c.number || '(RFP)'} ${c.vendor}` : `${code}: contract ${c.number} ${parts.join(', ') || 'updated'}` })
    toast(edit.isNew ? 'Contract added' : 'Contract saved'); onClose()
  }
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add contract' : `Contract ${c.number || '(RFP)'}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save contract</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Contract number"><Input className="font-mono" value={c.number} onChange={(e) => setC({ ...c, number: e.target.value })} /></Field>
          <Field label="Vendor"><Input value={c.vendor} onChange={(e) => setC({ ...c, vendor: e.target.value })} /></Field>
          <Field label="Type"><Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value as Contract['type'] })} options={['Construction', 'Engineering', 'Materials', 'Inspection', 'Environmental']} /></Field>
          <Field label="Status" hint={edit.c.status === 'rfp' ? 'Use "Start award" to move an RFP to awarded' : undefined}><Select value={c.status} disabled={edit.c.status === 'rfp' && !edit.isNew} onChange={(e) => setC({ ...c, status: e.target.value as Contract['status'] })} options={[{ value: 'rfp', label: 'RFP' }, { value: 'awarded', label: 'Awarded' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }]} /></Field>
          <Field label="Contract value" hint={locked ? 'Fixed at award; use change orders' : undefined}><MoneyInput disabled={locked} value={c.value} onChange={(v) => setC({ ...c, value: v })} /></Field>
          <Field label="Approved change orders" hint="Changes come only through RFI / change orders on the Finance tab"><div className="inp bg-sunken tabular-nums">{money(c.changeOrders)}</div></Field>
          <Field label="Invoiced to date"><MoneyInput value={c.invoiced} onChange={(v) => setC({ ...c, invoiced: v })} /></Field>
        </div>
      </div>
    </Drawer>
  )
}

function AwardModal({ c, onClose, onStarted, code }: { c: Contract | null; onClose: () => void; onStarted: (id: string) => void; code: string }) {
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState(0)
  const [nonStandard, setNonStandard] = useState(false)
  const [num, setNum] = useState('')
  const key = c?.id
  useEffect(() => { if (c) { setVendor(c.vendor); setAmount(c.value); setNonStandard(false); setNum(c.number) } }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null
  const start = () => {
    if (!vendor.trim() || !amount) { toast('Vendor and award value are required', 'bad'); return }
    let instId = ''
    mutate((d) => {
      const x = d.contracts.find((y) => y.id === c.id)!
      x.vendor = vendor.trim(); x.value = amount; if (num) x.number = num
      const inst = startWorkflow(d, 'contract-award', { title: `${code} award ${c.type.toLowerCase()} contract to ${vendor.trim()}`, recordType: 'contract', recordId: c.id, projectId: c.projectId, data: { amount, nonStandard, vendor: vendor.trim() } })
      instId = inst?.id ?? ''
    }, { entity: 'contract', entityId: c.id, projectId: c.projectId, action: 'submit-award', summary: `${code}: submitted ${c.type.toLowerCase()} award to ${vendor.trim()} for ${money(amount)}${nonStandard ? ' (non-standard terms — legal review)' : ''}` })
    toast(instId ? 'Award submitted for approval' : 'No published contract-award workflow', instId ? 'good' : 'bad')
    onStarted(c.id); onClose()
  }
  return (
    <Drawer open onClose={onClose} title="Start contract award" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={start}>Submit for approval</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">The PM confirms the recommendation, supply reviews, legal reviews when terms are non-standard, and the approver is chosen from the delegation-of-authority matrix by award value.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Recommended vendor"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
          <Field label="Contract number"><Input className="font-mono" value={num} onChange={(e) => setNum(e.target.value)} placeholder="Assigned at award" /></Field>
          <Field label="Award value"><MoneyInput value={amount} onChange={setAmount} /></Field>
        </div>
        <Checkbox checked={nonStandard} onChange={setNonStandard} label="Non-standard terms (limitation of liability, indemnity or payment terms changed) — adds legal review" />
      </div>
    </Drawer>
  )
}

// ───────────────────────────── Long-lead materials
function LongLeadPanel({ projectId, items, asOf, cStart }: { projectId: string; items: LongLeadItem[]; asOf: string; cStart?: string }) {
  const code = useStore((s) => s.projects.find((x) => x.id === projectId)!.code)
  const [edit, setEdit] = useState<{ it: LongLeadItem; isNew: boolean } | null>(null)
  const setStatus = (it: LongLeadItem, st: LongLeadItem['status']) => {
    mutate((d) => { const x = d.longLead.find((y) => y.id === it.id)!; x.status = st; if (st === 'received' && x.eta > asOf) x.eta = asOf }, { entity: 'long-lead', entityId: it.id, projectId, action: `status-${st}`, summary: `${code}: ${it.item} marked ${st}` })
    toast(`Marked ${st}`)
  }
  return (
    <Panel title="Long-lead materials" subtitle={cStart ? `ETA vs required-on-site, and against construction start ${fmtDate(cStart)}` : 'Required-on-site vs vendor ETA'} pad={false}
      actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, it: { id: uid('ll'), projectId, item: '', qty: '', vendor: '', requiredOnSite: cStart ?? asOf, eta: cStart ?? asOf, status: 'requested' } })}>Add item</Button>}>
      {items.length === 0 ? <div className="p-4"><Empty title="No long-lead items">Add pipe, valves and major equipment with their need dates.</Empty></div> : (
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Item</th><th>Qty</th><th>Vendor</th><th>Required on site</th><th>ETA</th><th className="num">Float</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((it) => {
                const float = daysBetween(it.eta, it.requiredOnSite)
                const afterStart = cStart && it.eta > cStart && it.status !== 'received'
                const late = it.status !== 'received' && float < 0
                return (
                  <tr key={it.id}>
                    <td className="min-w-[180px] font-semibold">{it.item}{afterStart && <div className="text-[11px] font-normal text-bad">ETA after construction start</div>}</td>
                    <td className="whitespace-nowrap text-[12px]">{it.qty}</td>
                    <td className="text-[12px]">{it.vendor}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(it.requiredOnSite)}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(it.eta)}</td>
                    <td className="num">{it.status === 'received' ? <span className="text-faint">—</span> : <Badge tone={late ? 'bad' : float < 14 ? 'warn' : 'good'}>{float > 0 ? '+' : ''}{float}d</Badge>}</td>
                    <td><Select aria-label={`Status of ${it.item}`} className="h-7 w-[120px] py-0.5" value={it.status} onChange={(e) => setStatus(it, e.target.value as LongLeadItem['status'])} options={['requested', 'ordered', 'shipped', 'received']} /></td>
                    <td><Button size="sm" variant="ghost" onClick={() => setEdit({ it, isNew: false })}>Edit</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (() => {
        const it = edit.it
        const setIt = (v: LongLeadItem) => setEdit({ ...edit, it: v })
        const save = () => {
          if (!it.item.trim()) { toast('Item is required', 'bad'); return }
          const prev = edit.it
          mutate((d) => { const i = d.longLead.findIndex((x) => x.id === it.id); if (i >= 0) d.longLead[i] = it; else d.longLead.push(it) },
            { entity: 'long-lead', entityId: it.id, projectId, action: edit.isNew ? 'create' : 'update', summary: `${code}: ${edit.isNew ? 'added' : 'updated'} long-lead ${it.item} (ETA ${it.eta}, need ${it.requiredOnSite})${!edit.isNew && prev.eta !== it.eta ? ` — ETA moved from ${prev.eta}` : ''}` })
          toast(edit.isNew ? 'Item added' : 'Item saved'); setEdit(null)
        }
        return (
          <Drawer open onClose={() => setEdit(null)} title={edit.isNew ? 'Add long-lead item' : it.item} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Item" className="sm:col-span-2"><Input value={it.item} onChange={(e) => setIt({ ...it, item: e.target.value })} /></Field>
              <Field label="Quantity"><Input value={it.qty} onChange={(e) => setIt({ ...it, qty: e.target.value })} placeholder="e.g. 12,000 ft" /></Field>
              <Field label="Vendor"><Input value={it.vendor} onChange={(e) => setIt({ ...it, vendor: e.target.value })} /></Field>
              <Field label="Required on site"><Input type="date" value={it.requiredOnSite} onChange={(e) => setIt({ ...it, requiredOnSite: e.target.value })} /></Field>
              <Field label="Vendor ETA"><Input type="date" value={it.eta} onChange={(e) => setIt({ ...it, eta: e.target.value })} /></Field>
              <Field label="Status"><Select value={it.status} onChange={(e) => setIt({ ...it, status: e.target.value as LongLeadItem['status'] })} options={['requested', 'ordered', 'shipped', 'received']} /></Field>
            </div>
          </Drawer>
        )
      })()}
    </Panel>
  )
}
