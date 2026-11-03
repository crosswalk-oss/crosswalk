// "New RFI / change order": the single entry point for changing a commitment. Logs the field question and
// its cost against a commitment, optionally ties it to a project change request, and starts the
// 'commitment-change' workflow (PM → construction manager → project controls → approver by dollar authority).
import { useEffect, useMemo, useState } from 'react'
import { mutate, useStore } from '@/core/store'
import { commitmentRow, createCommitmentChange, nextCcoCode } from '@/core/engine/finance'
import { latestDef, simulate } from '@/core/engine/workflow'
import { money, moneyDelta, cx } from '@/core/util'
import { Button, Callout, Field, Input, KV, Modal, MoneyInput, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'

export interface CcoSeed { contractId?: string; changeId?: string }

export function CcoModal({ projectId, seed, onClose, onCreated }: { projectId: string; seed: CcoSeed | null; onClose: () => void; onCreated?: (ccoId: string, contractId: string) => void }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const contracts = s.contracts.filter((c) => c.projectId === projectId && c.status !== 'rfp' && c.status !== 'closed')
  const changes = s.changes.filter((c) => c.projectId === projectId && c.status !== 'rejected')
  const blank = { contractId: '', rfi: '', description: '', amount: 0, days: 0, changeId: '' }
  const [f, setF] = useState(blank)
  const open = !!seed
  useEffect(() => {
    if (seed) setF({ ...blank, contractId: seed.contractId ?? contracts[0]?.id ?? '', changeId: seed.changeId ?? '' })
  }, [open, seed?.contractId, seed?.changeId]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = s.contracts.find((c) => c.id === f.contractId)
  const row = k ? commitmentRow(s, k) : undefined
  const def = latestDef(s, 'commitment-change')
  const route = useMemo(() => (def && open ? simulate(s, def, { amount: f.amount, scheduleImpactDays: f.days, rfi: f.rfi }, projectId) : []), [s, def, f.amount, f.days, f.rfi, projectId, open])
  if (!seed) return null
  const submit = () => {
    if (!f.contractId) { toast('Pick the commitment this change applies to', 'bad'); return }
    if (!f.rfi.trim() || !f.description.trim()) { toast('Describe the RFI or field condition and the change', 'bad'); return }
    if (!f.amount && !f.days) { toast('Enter the cost or schedule impact', 'bad'); return }
    let id = '', code = ''
    mutate((d) => { const cc = createCommitmentChange(d, projectId, { contractId: f.contractId, rfi: f.rfi, description: f.description, amount: f.amount, scheduleImpactDays: f.days, changeId: f.changeId || undefined }); id = cc.id; code = cc.code })
    toast(`${code} submitted for approval`)
    onCreated?.(id, f.contractId)
    onClose()
  }
  const linked = changes.find((c) => c.id === f.changeId)
  return (
    <Modal open onClose={onClose} wide title={`New RFI / change order · ${nextCcoCode(s, p)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!contracts.length}>Submit for approval</Button></>}>
      {!contracts.length ? (
        <Callout tone="warn" title="No live commitment">RFI / change orders are raised against an awarded or active commitment. Add the commitment on the Finance tab first.</Callout>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-3">
            <Field label="Commitment">
              <Select id="cco-contract" value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}
                options={contracts.map((c) => ({ value: c.id, label: `${c.vendor} · ${c.type} · PO ${c.poNumber ?? '—'} · ${money(c.value + c.changeOrders)}` }))} />
            </Field>
            <Field label="RFI / field condition" hint="The question or condition that triggered the change">
              <Input id="cco-rfi" value={f.rfi} onChange={(e) => setF({ ...f, rfi: e.target.value })} placeholder="e.g. Unmarked 12-inch water main at Sta 42+10 conflicts with alignment" />
            </Field>
            <Field label="Change to the commitment">
              <TextArea id="cco-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What the vendor will do differently, how it was priced (unit rates, T&M, lump sum) and the evidence attached." />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount" hint="Negative for a credit"><MoneyInput id="cco-amount" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
              <Field label="Schedule impact (days)"><Input id="cco-days" type="number" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) || 0 })} /></Field>
            </div>
            <Field label="Project change request (optional)" hint="Link when the RFI is part of a change to the project baseline">
              <Select id="cco-change" value={f.changeId} onChange={(e) => setF({ ...f, changeId: e.target.value })}
                options={[{ value: '', label: 'Not linked — absorbed within the commitment' }, ...changes.map((c) => ({ value: c.id, label: `${c.code} ${c.title} (${c.status})` }))]} />
            </Field>
            {linked && linked.contractIds && !linked.contractIds.includes(f.contractId) && <Callout tone="info">{linked.code} will list this commitment as affected once the CCO is submitted.</Callout>}
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-sunken/40 p-3">
            <div className="eyebrow">Commitment after approval</div>
            {row && <KV cols={1} items={[
              ['Current commitment', <span key="c" className="tabular-nums">{money(row.current, 'full')}</span>],
              ['This change', <b key="t" className={cx('tabular-nums', f.amount > 0 ? 'text-bad' : f.amount < 0 ? 'text-good' : '')}>{moneyDelta(f.amount)}</b>],
              ['In review already', <span key="r" className="tabular-nums">{money(row.pendingChanges)}</span>],
              ['Commitment if approved', <b key="a" className="tabular-nums">{money(row.current + f.amount, 'full')}</b>],
              ['Remaining to invoice', <span key="rm" className="tabular-nums">{money(row.remaining + f.amount, 'full')}</span>],
              ...(row.c.poTotal ? [['Share of PO', <span key="po" className={cx('tabular-nums', row.poShare !== undefined && row.current + f.amount > row.poShare ? 'text-warn font-semibold' : '')}>{(((row.current + f.amount) / row.c.poTotal) * 100).toFixed(1)}% used · {row.c.pctOfPo ?? '—'}% planned</span>] as [string, JSX.Element]] : []),
            ]} />}
            <div className="eyebrow mt-1">Routing (live from the workflow)</div>
            <ol className="flex flex-col gap-1 text-[12.5px]">
              {route.map((r, i) => <li key={i} className="flex gap-2"><span className="w-4 text-right tabular-nums text-faint">{i + 1}</span><span className="min-w-0"><b>{r.node.label}</b><span className="block text-muted">{r.people.map((x) => x.name).join(', ') || 'Unassigned'}</span></span></li>)}
            </ol>
            <p className="text-[11.5px] text-muted">Approval adds the amount to the commitment's approved changes. Nobody edits a commitment value directly.</p>
          </div>
        </div>
      )}
    </Modal>
  )
}
