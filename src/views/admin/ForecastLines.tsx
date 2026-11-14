// Configuration: forecast line items. Each line rolls up to exactly one WBS function and owns the CBS categories
// whose budget belongs to it (a category belongs to one line). SAP actuals land on lines through the mapping table.
import { useMemo, useState } from 'react'
import type { CostCategory, ForecastLine, WbsFunction } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { CONT_CAT, ESC_CAT } from '@/core/engine/estimates'
import { cx, uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Modal, Panel, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'

const SYSTEM = [ESC_CAT, CONT_CAT] // overhead (cat-loaders) is assignable, e.g. to 900 Project Overhead

/** Validation of the line table against cost categories and the WBS function mapping. */
export function lineIssues(lines: ForecastLine[], cats: CostCategory[], fns: WbsFunction[]) {
  const act = lines.filter((l) => l.active)
  const direct = cats.filter((c) => !SYSTEM.includes(c.id))
  const owners = (id: string) => act.filter((l) => l.categoryIds.includes(id))
  const fnOfCat = (id: string) => fns.find((f) => f.categoryIds.includes(id))
  return {
    unassigned: direct.filter((c) => owners(c.id).length === 0),
    multi: direct.filter((c) => owners(c.id).length > 1),
    mismatch: act.flatMap((l) => l.categoryIds.map((c) => ({ l, c, fn: fnOfCat(c) })).filter((x) => x.fn && x.fn.id !== l.functionId)),
    dupCodes: act.filter((l, i) => act.findIndex((x) => x.code.trim() === l.code.trim()) !== i).map((l) => l.code),
    emptyFns: fns.filter((f) => !act.some((l) => l.functionId === f.id)),
  }
}

export default function ForecastLines(_props: { projectId?: string }) {
  const s = useStore()
  const lines = s.settings.forecastLines
  const fns = s.settings.wbsFunctions
  const [edit, setEdit] = useState<ForecastLine | null>(null)
  const [showInactive, setShowInactive] = useState(true)
  const issues = lineIssues(lines, s.categories, fns)
  const usage = useMemo(() => {
    const out: Record<string, { forecasts: number; periods: number; txns: number; rules: number }> = {}
    const u = (id: string) => (out[id] ||= { forecasts: 0, periods: 0, txns: 0, rules: 0 })
    for (const f of s.forecasts) for (const [id, row] of Object.entries(f.lineSpread ?? {})) if (Object.values(row).some(Boolean)) u(id).forecasts++
    for (const c of s.costPeriods) for (const [id, v] of Object.entries(c.byLine ?? {})) if (v) u(id).periods++
    for (const t of s.actualTxns) { if (t.lineId) u(t.lineId).txns++; for (const id of Object.keys(t.allocation ?? {})) u(id).txns++ }
    for (const r of s.settings.sapMappings) if (r.lineId) u(r.lineId).rules++
    return out
  }, [s.forecasts, s.costPeriods, s.actualTxns, s.settings.sapMappings])
  const inUse = (id: string) => { const x = usage[id]; return !!x && x.forecasts + x.periods + x.txns + x.rules > 0 }
  const catName = (id: string) => s.categories.find((c) => c.id === id)

  const save = (l: ForecastLine, isNew: boolean) => {
    const moved: string[] = []
    mutate((d) => {
      for (const o of d.settings.forecastLines) if (o.id !== l.id && o.active) {
        const keep = o.categoryIds.filter((c) => !l.categoryIds.includes(c))
        if (keep.length !== o.categoryIds.length) { moved.push(o.code); o.categoryIds = keep }
      }
      const i = d.settings.forecastLines.findIndex((x) => x.id === l.id)
      if (i >= 0) d.settings.forecastLines[i] = l
      else d.settings.forecastLines.push(l)
      d.settings.forecastLines.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    }, { entity: 'forecast-line', entityId: l.id, action: isNew ? 'create' : 'update', summary: `${isNew ? 'Added' : 'Updated'} forecast line ${l.code} ${l.name} (WBS ${fns.find((f) => f.id === l.functionId)?.code}; categories ${l.categoryIds.map((c) => catName(c)?.code ?? c).join(', ') || 'none'})${moved.length ? `; categories moved from ${moved.join(', ')}` : ''}` })
    toast(isNew ? `Line ${l.code} added` : `Line ${l.code} saved`)
    setEdit(null)
  }
  const setActive = (l: ForecastLine, active: boolean) => {
    mutate((d) => { const x = d.settings.forecastLines.find((y) => y.id === l.id); if (x) x.active = active }, { entity: 'forecast-line', entityId: l.id, action: active ? 'activate' : 'deactivate', summary: `${active ? 'Reactivated' : 'Deactivated'} forecast line ${l.code} ${l.name}` })
    toast(active ? `${l.code} reactivated` : `${l.code} deactivated — history kept`)
  }
  const remove = (l: ForecastLine) => {
    mutate((d) => { d.settings.forecastLines = d.settings.forecastLines.filter((x) => x.id !== l.id) }, { entity: 'forecast-line', entityId: l.id, action: 'delete', summary: `Deleted unused forecast line ${l.code} ${l.name}` })
    toast(`${l.code} deleted`)
  }
  const add = () => {
    const fn = fns[0]
    const n = lines.filter((l) => l.functionId === fn.id).length
    setEdit({ id: uid('fl'), code: `${fn.code}.${String((n + 1) * 10).padStart(2, '0')}`, name: '', functionId: fn.id, categoryIds: [], active: true })
  }

  const shown = lines.filter((l) => showInactive || l.active)
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="How lines are used">
        Forecasts are entered by line item and roll up to the WBS functions (CBS Level 3 codes 100–999). A line’s budget is the CBS categories it owns (overhead goes to 900 Project Overhead; escalation is allocated pro-rata); SAP actuals reach it through the rules on the <b>SAP mapping</b> tab. A line that has forecasts, actuals or rules can be deactivated but not deleted, so history stays traceable.
      </Callout>
      {(issues.unassigned.length > 0 || issues.multi.length > 0 || issues.mismatch.length > 0 || issues.dupCodes.length > 0 || issues.emptyFns.length > 0) ? (
        <Callout tone="warn" title="Coverage checks">
          <ul className="list-disc pl-4">
            {issues.unassigned.length > 0 && <li>{issues.unassigned.length} cost categor{issues.unassigned.length === 1 ? 'y has' : 'ies have'} no line, so their budget is left out of line totals: {issues.unassigned.map((c) => c.name).join(', ')}</li>}
            {issues.multi.map((c) => <li key={c.id}>{c.name} belongs to more than one active line</li>)}
            {issues.mismatch.map((x, i) => <li key={i}>{x.l.code} owns {catName(x.c)?.name}, which the WBS configuration maps to {x.fn?.code} {x.fn?.name} — budget and actuals will land in different functions</li>)}
            {issues.dupCodes.map((c) => <li key={c}>Duplicate line code {c}</li>)}
            {issues.emptyFns.length > 0 && <li>No active line under {issues.emptyFns.map((f) => `${f.code} ${f.name}`).join(', ')}</li>}
          </ul>
        </Callout>
      ) : <Callout tone="good">Every cost category belongs to exactly one active line, and every line sits under the WBS function its categories map to.</Callout>}

      <Panel title="Forecast line items" subtitle={`${lines.filter((l) => l.active).length} active · ${lines.filter((l) => !l.active).length} inactive · under ${fns.length} WBS functions`} pad={false}
        actions={<>
          <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" className="h-3.5 w-3.5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
          <Button size="sm" variant="primary" onClick={add} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Add line</Button>
        </>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Line item</th><th>Cost categories (budget)</th><th className="num">SAP rules</th><th>In use</th><th>Status</th><th /></tr></thead>
            <tbody>
              {fns.map((fn) => {
                const ls = shown.filter((l) => l.functionId === fn.id)
                return [
                  <tr key={fn.id} className="bg-sunken/50"><td colSpan={7} className="py-1.5 font-semibold"><span className="font-mono text-[11px] text-faint">{fn.code}</span> {fn.name}{!ls.length && <span className="ml-2 text-[12px] font-normal text-warn">no lines</span>}</td></tr>,
                  ...ls.map((l) => {
                    const u = usage[l.id]
                    return (
                      <tr key={l.id} className={cx(!l.active && 'text-muted')}>
                        <td className="whitespace-nowrap font-mono text-[12px] font-semibold">{l.code}</td>
                        <td className="min-w-[180px]"><div className={cx('font-semibold', !l.active && 'line-through')}>{l.name}</div>{l.note && <div className="text-[11.5px] text-muted">{l.note}</div>}</td>
                        <td className="min-w-[160px]"><div className="flex flex-wrap gap-1">{l.categoryIds.length ? l.categoryIds.map((c) => <Badge key={c} title={catName(c)?.name}>{catName(c)?.code ?? c} {catName(c)?.name}</Badge>) : <span className="text-[12px] text-faint">none — no budget</span>}</div></td>
                        <td className="num">{u?.rules ? u.rules : <span className="text-warn" title="No SAP rule sends cost here">0</span>}</td>
                        <td className="whitespace-nowrap text-[12px] text-muted">{u ? [u.forecasts && `${u.forecasts} forecasts`, u.periods && `${u.periods} actual periods`, u.txns && `${u.txns} SAP rows`].filter(Boolean).join(' · ') || '—' : '—'}</td>
                        <td>{l.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
                        <td className="whitespace-nowrap text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEdit(l)}>Edit</Button>
                          {l.active
                            ? (inUse(l.id) ? <ConfirmButton size="sm" variant="ghost" confirmLabel="Deactivate" onConfirm={() => setActive(l, false)}>Deactivate</ConfirmButton> : <ConfirmButton size="sm" variant="ghost" confirmLabel="Delete line" onConfirm={() => remove(l)}>Delete</ConfirmButton>)
                            : <Button size="sm" variant="ghost" onClick={() => setActive(l, true)}>Reactivate</Button>}
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {edit && <LineModal line={edit} isNew={!lines.some((l) => l.id === edit.id)} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  )
}

function LineModal({ line, isNew, onClose, onSave }: { line: ForecastLine; isNew: boolean; onClose: () => void; onSave: (l: ForecastLine, isNew: boolean) => void }) {
  const s = useStore()
  const [l, setL] = useState<ForecastLine>(line)
  const others = s.settings.forecastLines.filter((x) => x.id !== l.id && x.active)
  const ownerOf = (c: string) => others.find((x) => x.categoryIds.includes(c))
  const direct = s.categories.filter((c) => !SYSTEM.includes(c.id))
  const fn = s.settings.wbsFunctions.find((f) => f.id === l.functionId)
  const moves = l.categoryIds.map((c) => ({ c, o: ownerOf(c) })).filter((x) => x.o)
  const dup = others.some((x) => x.code.trim() === l.code.trim())
  const submit = () => {
    if (!l.code.trim() || !l.name.trim()) { toast('A line needs a code and a name', 'bad'); return }
    if (dup) { toast(`Code ${l.code} is already used`, 'bad'); return }
    onSave({ ...l, code: l.code.trim(), name: l.name.trim(), note: l.note?.trim() || undefined }, isNew)
  }
  const toggle = (c: string) => setL({ ...l, categoryIds: l.categoryIds.includes(c) ? l.categoryIds.filter((x) => x !== c) : [...l.categoryIds, c] })
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add forecast line' : `Edit ${line.code} ${line.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{isNew ? 'Add line' : 'Save line'}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <Field label="Code" hint={dup ? 'Already used' : 'e.g. 06.30'}><Input className="font-mono" value={l.code} onChange={(e) => setL({ ...l, code: e.target.value })} /></Field>
          <Field label="Name"><Input value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} placeholder="e.g. Directional drilling" /></Field>
        </div>
        <Field label="Rolls up to WBS function"><Select value={l.functionId} onChange={(e) => setL({ ...l, functionId: e.target.value })} options={s.settings.wbsFunctions.map((f) => ({ value: f.id, label: `${f.code} ${f.name}` }))} /></Field>
        <Field label="Cost categories whose budget belongs to this line" hint="A category belongs to one line; choosing one owned by another line moves it here when you save.">
          <div className="flex flex-wrap gap-1">
            {direct.map((c) => {
              const on = l.categoryIds.includes(c.id)
              const o = ownerOf(c.id)
              const fnOf = s.settings.wbsFunctions.find((f) => f.categoryIds.includes(c.id))
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => toggle(c.id)} title={`${c.name}${o ? ` — now on ${o.code}` : ''}${fnOf ? ` · WBS ${fnOf.code}` : ''}`}
                  className={cx('rounded border px-2 py-0.5 text-[12px] font-semibold', on ? 'border-link bg-link text-surface' : o ? 'border-dashed border-line bg-surface text-faint hover:text-ink' : 'border-line bg-surface text-muted hover:border-ink/40 hover:text-ink')}>
                  {c.name}{o && !on ? <span className="ml-1 font-mono text-[10.5px]">{o.code}</span> : null}
                </button>
              )
            })}
          </div>
        </Field>
        {moves.length > 0 && <Callout tone="warn">{moves.map((x) => `${s.categories.find((c) => c.id === x.c)?.name} moves from ${x.o!.code}`).join('; ')}.</Callout>}
        {l.categoryIds.some((c) => { const f = s.settings.wbsFunctions.find((x) => x.categoryIds.includes(c)); return f && f.id !== l.functionId }) && <Callout tone="warn">Some of these categories map to a different WBS function than {fn?.code} {fn?.name} in the WBS configuration.</Callout>}
        <Field label="Note"><TextArea rows={2} value={l.note ?? ''} onChange={(e) => setL({ ...l, note: e.target.value })} placeholder="What belongs on this line" /></Field>
      </div>
    </Modal>
  )
}
