// Add or edit an internal order (IO): number, capital / O&M, status, and the WBS functions (estimate buckets) it carries.
// IOs are never deleted; an IO that is no longer used is closed.
import { useEffect, useState } from 'react'
import { mutate, useStore } from '@/core/store'
import type { InternalOrder, Project } from '@/core/types'
import { basisByFunction, nextIoNumber } from '@/core/engine/finance'
import { money, uid, cx } from '@/core/util'
import { Button, Callout, Checkbox, Drawer, Field, Input, SegButtons, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'

export function IoDrawer({ p, edit, onClose }: { p: Project; edit: { io?: InternalOrder; functionIds?: string[] } | null; onClose: () => void }) {
  const s = useStore()
  const [io, setIo] = useState<InternalOrder | null>(null)
  const isNew = !edit?.io
  useEffect(() => {
    if (!edit) { setIo(null); return }
    if (edit.io) setIo(JSON.parse(JSON.stringify(edit.io)))
    else setIo({ id: uid('io'), number: nextIoNumber(p, 'capital'), description: `${p.code} capital`, type: 'capital', status: 'requested', functionIds: edit.functionIds ?? [] })
  }, [edit]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!edit || !io) return null
  const basis = basisByFunction(s, p.id)
  const others = (p.finance?.ios ?? []).filter((x) => x.id !== io.id && x.status !== 'closed')
  const carriedElsewhere = (fn: string) => others.filter((x) => x.functionIds.includes(fn)).map((x) => x.number)
  const toggle = (fn: string, on: boolean) => setIo({ ...io, functionIds: on ? [...io.functionIds, fn] : io.functionIds.filter((x) => x !== fn) })
  const save = () => {
    if (!/^\d{6,10}$/.test(io.number.trim())) { toast('IO number must be 6–10 digits', 'bad'); return }
    if ((p.finance?.ios ?? []).some((x) => x.id !== io.id && x.number === io.number.trim())) { toast('That IO number is already on this project', 'bad'); return }
    if (!io.functionIds.length) { toast('Pick the WBS functions this IO carries', 'bad'); return }
    const clean: InternalOrder = { ...io, number: io.number.trim(), description: io.description.trim() || `${p.code} ${io.type === 'capital' ? 'capital' : 'O&M'}`, opened: io.status === 'requested' ? undefined : io.opened ?? s.settings.asOf }
    const prev = edit.io
    const parts: string[] = []
    if (prev) {
      if (prev.status !== clean.status) parts.push(`status ${prev.status} → ${clean.status}`)
      if (prev.type !== clean.type) parts.push(`type ${prev.type} → ${clean.type}`)
      const add = clean.functionIds.filter((f) => !prev.functionIds.includes(f)), rem = prev.functionIds.filter((f) => !clean.functionIds.includes(f))
      const code = (id: string) => s.settings.wbsFunctions.find((w) => w.id === id)?.code ?? id
      if (add.length) parts.push(`now carries ${add.map(code).join(', ')}`)
      if (rem.length) parts.push(`no longer carries ${rem.map(code).join(', ')}`)
    }
    mutate((d) => {
      const x = d.projects.find((y) => y.id === p.id)!
      x.finance ??= { ios: [] }
      const i = x.finance.ios.findIndex((y) => y.id === clean.id)
      if (i >= 0) x.finance.ios[i] = clean; else x.finance.ios.push(clean)
    }, { entity: 'internal-order', entityId: clean.id, projectId: p.id, action: isNew ? 'create' : 'update', summary: isNew ? `${p.code}: ${clean.status === 'requested' ? 'requested' : 'added'} ${clean.type === 'capital' ? 'capital' : 'O&M'} IO ${clean.number} carrying ${clean.functionIds.length} WBS function(s)` : `${p.code}: IO ${clean.number} ${parts.join('; ') || 'updated'}` })
    toast(isNew ? `IO ${clean.number} added` : `IO ${clean.number} saved`)
    onClose()
  }
  return (
    <Drawer open onClose={onClose} width={560} title={isNew ? 'Add internal order' : `Internal order ${io.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{isNew ? 'Add IO' : 'Save IO'}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type">
            <SegButtons options={[{ id: 'capital', label: 'Capital' }, { id: 'om', label: 'O&M' }]} value={io.type}
              onChange={(t) => setIo({ ...io, type: t, number: isNew ? nextIoNumber(p, t) : io.number, description: isNew ? `${p.code} ${t === 'capital' ? 'capital' : 'O&M'}` : io.description })} />
          </Field>
          <Field label="SAP internal order" hint="Assigned by plant accounting when opened"><Input id="io-number" className="font-mono" value={io.number} onChange={(e) => setIo({ ...io, number: e.target.value })} /></Field>
          <Field label="Description"><Input id="io-desc" value={io.description} onChange={(e) => setIo({ ...io, description: e.target.value })} /></Field>
          <Field label="Status">
            <Select id="io-status" value={io.status} onChange={(e) => setIo({ ...io, status: e.target.value as InternalOrder['status'], opened: e.target.value === 'open' ? io.opened ?? s.settings.asOf : io.opened })}
              options={[{ value: 'requested', label: 'Requested' }, { value: 'open', label: 'Open in SAP' }, { value: 'closed', label: 'Closed' }]} />
          </Field>
          {io.status !== 'requested' && <Field label="Opened"><Input id="io-opened" type="date" value={io.opened ?? ''} onChange={(e) => setIo({ ...io, opened: e.target.value })} /></Field>}
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-muted">WBS functions this IO carries</span>
            <span className="text-[11px] text-faint">Amounts: {basis.label}</span>
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {s.settings.wbsFunctions.map((fn) => {
              const other = carriedElsewhere(fn.id)
              const on = io.functionIds.includes(fn.id)
              return (
                <li key={fn.id} className={cx('flex items-center justify-between gap-2 px-2.5 py-1.5', on && other.length > 0 && 'bg-warn/5')}>
                  <Checkbox checked={on} onChange={(v) => toggle(fn.id, v)} label={<span><span className="font-mono text-[11.5px] text-faint">{fn.code}</span> {fn.name}</span>} />
                  <span className="flex shrink-0 items-center gap-2 text-[11.5px]">
                    {other.length > 0 && <span className={on ? 'font-semibold text-warn' : 'text-faint'}>also {other.join(', ')}</span>}
                    <span className="w-16 text-right tabular-nums text-muted">{basis.byFn[fn.id] ? money(basis.byFn[fn.id]) : '—'}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        {io.functionIds.some((f) => carriedElsewhere(f).length) && <Callout tone="warn">A function carried by two live IOs lets charges split between them. Keep one IO per function unless finance asked for the split.</Callout>}
        <Field label="Note"><TextArea id="io-note" value={io.note ?? ''} onChange={(e) => setIo({ ...io, note: e.target.value })} placeholder="e.g. O&M portion for abandonment of the replaced segment" /></Field>
      </div>
    </Drawer>
  )
}
