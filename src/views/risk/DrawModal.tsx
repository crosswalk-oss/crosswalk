// Contingency drawdown request (RK-08): draws are made only against a named risk and routed by dollar authority.
import { useEffect, useState } from 'react'
import type { Risk } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { startWorkflow, doaRoleFor } from '@/core/engine/workflow'
import { position } from '@/core/engine/position'
import { isActive, pert } from '@/core/engine/risk'
import { money, uid } from '@/core/util'
import { Button, Callout, Checkbox, Field, Modal, MoneyInput, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { submitFirstForm } from './wf'

export function DrawModal({ projectId, risk, open, onClose }: { projectId: string; risk?: Risk | null; open: boolean; onClose: () => void }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const risks = s.risks.filter((r) => r.projectId === projectId && r.kind === 'threat' && (isActive(r) || r.status === 'realized'))
  const [riskId, setRiskId] = useState(risk?.id ?? risks[0]?.id ?? '')
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [realize, setRealize] = useState(true)
  const r = s.risks.find((x) => x.id === riskId)
  useEffect(() => {
    if (!open) return
    const rr = risk ?? risks[0]
    setRiskId(rr?.id ?? '')
    setAmount(rr ? Math.round(pert(rr.cost) / 1000) * 1000 : 0)
    setReason(rr ? `${rr.event}. ` : '')
    setRealize(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, risk?.id])
  const pos = position(s, projectId)
  const role = doaRoleFor(s, { projectId }, amount)
  const roleName = s.roles.find((x) => x.id === role)?.name
  const over = amount > pos.contingencyRemaining
  const submit = () => {
    if (!r) { toast('Pick the risk this draw is for.', 'bad'); return }
    if (amount <= 0) { toast('Enter the amount to draw.', 'bad'); return }
    if (!reason.trim()) { toast('Explain what happened.', 'bad'); return }
    const id = uid('cd')
    mutate((d) => {
      d.contingencyDraws.push({ id, projectId, riskId: r.id, amount, date: d.settings.asOf, reason: reason.trim(), status: 'in-review' })
      if (realize) { const x = d.risks.find((y) => y.id === r.id); if (x && isActive(x)) { x.status = 'realized'; x.closedAt = d.settings.asOf } }
      const inst = startWorkflow(d, 'contingency-drawdown', { title: `${p.code} contingency for ${r.title}`, recordType: 'contingency', recordId: id, projectId, data: { amount, risk: `${r.code} ${r.title}`, reason: reason.trim() } })
      submitFirstForm(d, inst?.id, 'Request submitted from the risk register')
    }, { entity: 'contingency', entityId: id, projectId, action: 'request', summary: `Requested ${money(amount, 'full')} contingency against ${r.code} ${r.title}` })
    toast('Contingency request submitted for approval')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Request contingency drawdown"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit for approval</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Risk realized" hint="Contingency is drawn only against an identified risk.">
          <Select id="draw-risk" value={riskId} onChange={(e) => { setRiskId(e.target.value); const x = s.risks.find((y) => y.id === e.target.value); if (x) setAmount(Math.round(pert(x.cost) / 1000) * 1000) }} options={risks.length ? risks.map((x) => ({ value: x.id, label: `${x.code} · ${x.title} (ML ${money(x.cost.ml)})` })) : [{ value: '', label: 'No threats on the register' }]} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount" hint={r ? `Risk range ${money(r.cost.min)} – ${money(r.cost.max)}` : undefined}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Contingency remaining"><div className={over ? 'pt-1.5 font-semibold tabular-nums text-bad' : 'pt-1.5 font-semibold tabular-nums'}>{money(pos.contingencyRemaining, 'full')}{over ? ' — request exceeds remaining' : ''}</div></Field>
        </div>
        <Field label="What happened"><TextArea id="draw-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Field condition, date found, evidence (photos, contractor quote, daily report)" /></Field>
        <Checkbox checked={realize} onChange={setRealize} label="Mark this risk realized (removes it from active exposure)" />
        <Callout tone="info">Routes to project controls for verification, then to <b>{roleName ?? 'the approver'}</b> under the dollar-authority matrix for {money(amount)}. Remaining contingency drops only when the draw is approved.</Callout>
      </div>
    </Modal>
  )
}
