// Add or edit a commitment ("call-off"): the vendor PO the project uses, the share of that PO intended for
// this project, the scope it buys, the forecast lines it covers and the internal order it charges.
// Once awarded, the committed value is fixed; changes go through an RFI / change order.
import { useEffect, useState } from 'react'
import { mutate, useStore } from '@/core/store'
import type { Contract, Project } from '@/core/types'
import { basisByLine } from '@/core/engine/finance'
import { forecastLines } from '@/core/engine/lines'
import { money, uid, cx } from '@/core/util'
import { Button, Callout, Checkbox, Drawer, Field, Input, MoneyInput, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'

const TYPES: Contract['type'][] = ['Construction', 'Engineering', 'Materials', 'Inspection', 'Environmental']

export function CommitmentForm({ p, edit, onClose, onSaved }: { p: Project; edit: { c?: Contract; lineIds?: string[] } | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const s = useStore()
  const [c, setC] = useState<Contract | null>(null)
  const isNew = !edit?.c
  useEffect(() => {
    if (!edit) { setC(null); return }
    if (edit.c) setC(JSON.parse(JSON.stringify(edit.c)))
    else {
      const cap = p.finance?.ios.find((io) => io.type === 'capital' && io.status !== 'closed')
      setC({ id: uid('ctr'), projectId: p.id, number: '', vendor: '', type: 'Materials', value: 0, changeOrders: 0, invoiced: 0, status: 'active', awarded: s.settings.asOf, poNumber: '', poTotal: 0, pctOfPo: 100, scope: '', lineIds: edit.lineIds ?? [], ioId: cap?.id })
    }
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!edit || !c) return null
  const locked = !isNew && edit.c!.status !== 'rfp'
  const basis = basisByLine(s, p.id)
  const ios = p.finance?.ios ?? []
  const others = s.contracts.filter((x) => x.projectId === p.id && x.id !== c.id)
  const coveredBy = (lid: string) => others.filter((x) => x.lineIds?.includes(lid)).map((x) => x.vendor || x.number)
  const share = c.poTotal && c.pctOfPo !== undefined ? Math.round((c.poTotal * c.pctOfPo) / 100) : 0
  const setPct = (pct: number) => setC({ ...c, pctOfPo: pct, value: locked ? c.value : c.poTotal ? Math.round((c.poTotal * pct) / 100) : c.value })
  const setPoTotal = (v: number) => setC({ ...c, poTotal: v, value: locked ? c.value : v && c.pctOfPo !== undefined ? Math.round((v * c.pctOfPo) / 100) : c.value })
  const setValue = (v: number) => setC({ ...c, value: v, pctOfPo: c.poTotal ? Math.round((v / c.poTotal) * 1000) / 10 : c.pctOfPo })
  const lines = forecastLines(s).filter((l) => (basis.byLine[l.id] || 0) > 0 || c.lineIds?.includes(l.id))
  const save = () => {
    if (!c.vendor.trim()) { toast('Vendor is required', 'bad'); return }
    if (!c.poNumber?.trim() && c.status !== 'rfp') { toast('Enter the SAP PO number', 'bad'); return }
    if (c.poTotal && (c.pctOfPo === undefined || c.pctOfPo <= 0 || c.pctOfPo > 100)) { toast('% of PO must be between 0 and 100', 'bad'); return }
    if (!c.lineIds?.length) { toast('Assign at least one forecast line', 'bad'); return }
    if (!c.scope?.trim()) { toast('State the scope this commitment buys', 'bad'); return }
    const clean: Contract = { ...c, vendor: c.vendor.trim(), number: c.number.trim() || c.poNumber!.trim(), poNumber: c.poNumber?.trim(), scope: c.scope.trim() }
    const prev = edit.c
    const parts: string[] = []
    if (prev) {
      if (prev.pctOfPo !== clean.pctOfPo) parts.push(`% of PO ${prev.pctOfPo ?? '—'} → ${clean.pctOfPo}`)
      if (prev.poTotal !== clean.poTotal) parts.push(`PO total ${money(prev.poTotal)} → ${money(clean.poTotal)}`)
      if (prev.value !== clean.value) parts.push(`committed ${money(prev.value)} → ${money(clean.value)}`)
      if (prev.invoiced !== clean.invoiced) parts.push(`invoiced ${money(prev.invoiced)} → ${money(clean.invoiced)}`)
      if (prev.ioId !== clean.ioId) parts.push(`IO → ${ios.find((x) => x.id === clean.ioId)?.number ?? 'none'}`)
      if (JSON.stringify(prev.lineIds) !== JSON.stringify(clean.lineIds)) parts.push(`lines ${clean.lineIds!.length}`)
      if (prev.status !== clean.status) parts.push(`status ${prev.status} → ${clean.status}`)
      if (prev.scope !== clean.scope) parts.push('scope')
    }
    mutate((d) => { const i = d.contracts.findIndex((x) => x.id === clean.id); if (i >= 0) d.contracts[i] = clean; else d.contracts.push(clean) },
      { entity: 'contract', entityId: clean.id, projectId: p.id, action: isNew ? 'create' : 'update', summary: isNew ? `${p.code}: commitment added — ${clean.vendor} PO ${clean.poNumber}, ${clean.pctOfPo}% of ${money(clean.poTotal)} = ${money(clean.value)} for ${clean.lineIds!.length} line(s)` : `${p.code}: commitment ${clean.vendor} PO ${clean.poNumber} ${parts.join('; ') || 'updated'}` })
    toast(isNew ? 'Commitment added' : 'Commitment saved')
    onSaved?.(clean.id)
    onClose()
  }
  return (
    <Drawer open onClose={onClose} width={620} title={isNew ? 'Add commitment' : `Commitment · ${c.vendor}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{isNew ? 'Add commitment' : 'Save commitment'}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-muted">List each vendor PO the project uses. Blanket POs serve many projects, so record the PO total and the share of it this project intends to use; that share is the project's commitment.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vendor"><Input id="cm-vendor" value={c.vendor} onChange={(e) => setC({ ...c, vendor: e.target.value })} /></Field>
          <Field label="Type"><Select id="cm-type" value={c.type} onChange={(e) => setC({ ...c, type: e.target.value as Contract['type'] })} options={TYPES} /></Field>
          <Field label="SAP PO number"><Input id="cm-po" className="font-mono" value={c.poNumber ?? ''} onChange={(e) => setC({ ...c, poNumber: e.target.value })} placeholder="45xxxxxxxx" /></Field>
          <Field label="Contract / call-off no."><Input id="cm-num" className="font-mono" value={c.number} onChange={(e) => setC({ ...c, number: e.target.value })} placeholder="Defaults to the PO number" /></Field>
          <Field label="PO total (all projects)" hint="Blanket PO value"><MoneyInput id="cm-pototal" value={c.poTotal ?? 0} onChange={setPoTotal} /></Field>
          <Field label="% of PO for this project" hint={share ? `${money(share, 'full')} of the PO` : undefined}>
            <Input id="cm-pct" type="number" min={0} max={100} step={0.1} className="text-right tabular-nums" value={c.pctOfPo ?? ''} onChange={(e) => setPct(Number(e.target.value))} />
          </Field>
          <Field label="Committed for this project" hint={locked ? 'Fixed once awarded — change it with an RFI / change order' : 'PO total × % of PO; edit either'}>
            <MoneyInput id="cm-value" disabled={locked} value={c.value} onChange={setValue} />
          </Field>
          <Field label="Invoiced to date" hint="From SAP goods receipts / invoices"><MoneyInput id="cm-inv" value={c.invoiced} onChange={(v) => setC({ ...c, invoiced: v })} /></Field>
          <Field label="Internal order charged">
            <Select id="cm-io" value={c.ioId ?? ''} onChange={(e) => setC({ ...c, ioId: e.target.value || undefined })}
              options={[{ value: '', label: ios.length ? '— Select —' : 'No IOs yet' }, ...ios.map((io) => ({ value: io.id, label: `${io.number} · ${io.type === 'capital' ? 'Capital' : 'O&M'} (${io.status})` }))]} />
          </Field>
          <Field label="Status"><Select id="cm-status" value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as Contract['status'] })} options={[{ value: 'rfp', label: 'RFP / sourcing' }, { value: 'awarded', label: 'Awarded' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }]} /></Field>
        </div>
        {locked && c.changeOrders !== 0 && <Callout tone="info">Approved RFI / change orders: <b className="tabular-nums">{money(c.changeOrders, 'full')}</b> (current commitment {money(c.value + c.changeOrders, 'full')}). Approved changes come only from the RFI / CCO workflow.</Callout>}
        <Field label="Scope of work this commitment buys"><TextArea id="cm-scope" value={c.scope ?? ''} onChange={(e) => setC({ ...c, scope: e.target.value })} placeholder="e.g. Installation, tie-ins and restoration, Sta 0+00 to 48+50" /></Field>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-muted">Forecast lines covered</span>
            <span className="text-[11px] text-faint">Amounts: {basis.label}</span>
          </div>
          <ul className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
            {lines.map((l) => {
              const on = !!c.lineIds?.includes(l.id)
              const other = coveredBy(l.id)
              return (
                <li key={l.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                  <Checkbox checked={on} onChange={(v) => setC({ ...c, lineIds: v ? [...(c.lineIds ?? []), l.id] : (c.lineIds ?? []).filter((x) => x !== l.id) })} label={<span><span className="font-mono text-[11.5px] text-faint">{l.code}</span> {l.name}</span>} />
                  <span className="flex shrink-0 items-center gap-2 text-[11.5px]">
                    {other.length > 0 ? <span className="text-faint">also {other.join(', ')}</span> : <span className={cx(!on && 'font-semibold text-warn')}>{on ? '' : 'uncovered'}</span>}
                    <span className="w-16 text-right tabular-nums text-muted">{basis.byLine[l.id] ? money(basis.byLine[l.id]) : '—'}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Drawer>
  )
}
