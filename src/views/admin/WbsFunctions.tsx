// Configuration: the WBS functions the forecast is spread against, and which cost categories roll up to each.
// Loaders, escalation and contingency are system categories allocated pro-rata (contingency held separately).
import { useMemo, useState } from 'react'
import type { WbsFunction } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { CONT_CAT, ESC_CAT } from '@/core/engine/estimates'
import { cx, uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Input, Panel, Select } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { useDraft } from './common'

const SYSTEM = [ESC_CAT, CONT_CAT] // overhead (cat-loaders) is assignable, e.g. to 900 Project Overhead
const TIMING: { value: WbsFunction['timing']; label: string }[] = [
  { value: 'early', label: 'Early (front-loaded)' },
  { value: 'mid', label: 'Mid (S-curve)' },
  { value: 'late', label: 'Late (back-loaded)' },
  { value: 'flat', label: 'Flat (even)' },
]

/** Validation of a WBS configuration against the cost categories. */
export function wbsIssues(fns: WbsFunction[], cats: { id: string; code: string; name: string }[]) {
  const direct = cats.filter((c) => !SYSTEM.includes(c.id))
  const owners = (id: string) => fns.filter((f) => f.categoryIds.includes(id))
  return {
    unmapped: direct.filter((c) => owners(c.id).length === 0),
    multi: direct.filter((c) => owners(c.id).length > 1),
    dupCodes: fns.filter((f, i) => fns.findIndex((x) => x.code.trim() === f.code.trim()) !== i).map((f) => f.code),
    blank: fns.filter((f) => !f.code.trim() || !f.name.trim()),
  }
}

export default function WbsFunctions(_props: { projectId?: string }) {
  const s = useStore()
  const [fns, setFns, dirty, discard] = useDraft(s.settings.wbsFunctions)
  const [mapView, setMapView] = useState<'by-category' | 'by-function'>('by-category')
  const direct = s.categories.filter((c) => !SYSTEM.includes(c.id))
  const system = s.categories.filter((c) => SYSTEM.includes(c.id))
  const issues = wbsIssues(fns, s.categories)
  const used = useMemo(() => {
    const out: Record<string, { forecasts: number; actuals: number }> = {}
    for (const f of s.forecasts) for (const [id, row] of Object.entries(f.spread ?? {})) if (Object.values(row).some(Boolean)) (out[id] ||= { forecasts: 0, actuals: 0 }).forecasts++
    for (const c of s.costPeriods) for (const id of Object.keys(c.byFunction ?? {})) (out[id] ||= { forecasts: 0, actuals: 0 }).actuals++
    return out
  }, [s.forecasts, s.costPeriods])

  const set = (i: number, patch: Partial<WbsFunction>) => setFns(fns.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const mapCat = (catId: string, fnId: string) => setFns(fns.map((f) => ({ ...f, categoryIds: f.id === fnId ? Array.from(new Set([...f.categoryIds, catId])) : f.categoryIds.filter((x) => x !== catId) })))
  const add = () => {
    const next = String(Math.max(0, ...fns.map((f) => Number(f.code) || 0)) + 1).padStart(2, '0')
    setFns([...fns, { id: uid('wbs'), code: next, name: 'New function', description: '', categoryIds: [], timing: 'mid' }])
  }
  const remove = (i: number) => setFns(fns.filter((_, j) => j !== i))
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= fns.length) return; const n = fns.slice(); [n[i], n[j]] = [n[j], n[i]]; setFns(n) }

  const save = () => {
    if (issues.blank.length) { toast('Every function needs a code and a name', 'bad'); return }
    if (issues.dupCodes.length) { toast(`Duplicate code ${issues.dupCodes[0]}`, 'bad'); return }
    if (issues.multi.length) { toast(`${issues.multi[0].name} is mapped to more than one function`, 'bad'); return }
    const before = s.settings.wbsFunctions
    const added = fns.filter((f) => !before.some((x) => x.id === f.id)).map((f) => `${f.code} ${f.name}`)
    const removed = before.filter((f) => !fns.some((x) => x.id === f.id)).map((f) => `${f.code} ${f.name}`)
    const edited = fns.filter((f) => { const o = before.find((x) => x.id === f.id); return o && JSON.stringify({ ...o, categoryIds: [] }) !== JSON.stringify({ ...f, categoryIds: [] }) }).map((f) => f.code)
    const remapped = direct.filter((c) => before.find((f) => f.categoryIds.includes(c.id))?.id !== fns.find((f) => f.categoryIds.includes(c.id))?.id).map((c) => `${c.code} → ${fns.find((f) => f.categoryIds.includes(c.id))?.code ?? 'unmapped'}`)
    mutate((d) => { d.settings.wbsFunctions = fns.map((f) => ({ ...f, code: f.code.trim(), name: f.name.trim() })) },
      { entity: 'wbs', entityId: 'wbs-functions', action: 'update', summary: `WBS functions updated${added.length ? ` · added ${added.join(', ')}` : ''}${removed.length ? ` · removed ${removed.join(', ')}` : ''}${edited.length ? ` · edited ${edited.join(', ')}` : ''}${remapped.length ? ` · remapped ${remapped.join(', ')}` : ''}${issues.unmapped.length ? ` · ${issues.unmapped.length} categories left unmapped` : ''}` })
    toast(issues.unmapped.length ? `WBS saved — ${issues.unmapped.length} categories still unmapped` : 'WBS functions saved', issues.unmapped.length ? 'bad' : 'good')
  }

  const removedWithHistory = s.settings.wbsFunctions.filter((f) => !fns.some((x) => x.id === f.id) && (used[f.id]?.forecasts || used[f.id]?.actuals))

  return (
    <div className="flex flex-col gap-4">
      <Panel title="WBS functions" pad={false}
        subtitle={`The standard work breakdown every project's forecast is spread against (${fns.length} functions). Typical timing sets the curve used when a helper fills a row; people can always type over it.`}
        actions={<>
          {dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}
          <Button size="sm" onClick={add}>Add function</Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save WBS</Button>
        </>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th style={{ width: 70 }}>Code</th><th style={{ minWidth: 200 }}>Function</th><th style={{ minWidth: 240 }}>Description</th><th style={{ width: 170 }}>Typical timing</th><th>Cost categories</th><th className="num">In use</th><th style={{ width: 120 }} /></tr></thead>
            <tbody>
              {fns.map((f, i) => {
                const u = used[f.id]
                const isNew = !s.settings.wbsFunctions.some((x) => x.id === f.id)
                return (
                  <tr key={f.id}>
                    <td><Input aria-label="Code" className={cx('h-7 py-0.5 font-mono', issues.dupCodes.includes(f.code) && 'border-bad')} value={f.code} onChange={(e) => set(i, { code: e.target.value })} /></td>
                    <td><div className="flex items-center gap-1.5"><Input aria-label="Name" className={cx('h-7 py-0.5', !f.name.trim() && 'border-bad')} value={f.name} onChange={(e) => set(i, { name: e.target.value })} />{isNew && <Badge tone="info">New</Badge>}</div></td>
                    <td><Input aria-label="Description" className="h-7 py-0.5" value={f.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                    <td><Select aria-label="Typical timing" className="h-7 py-0.5" value={f.timing} onChange={(e) => set(i, { timing: e.target.value as WbsFunction['timing'] })} options={TIMING} /></td>
                    <td><div className="flex flex-wrap gap-1">{f.categoryIds.length ? f.categoryIds.map((id) => { const c = s.categories.find((x) => x.id === id); return <Badge key={id} tone="neutral"><span className="font-mono">{c?.code ?? '?'}</span> {c?.name ?? id}</Badge> }) : <span className="text-[12px] text-faint">None mapped</span>}</div></td>
                    <td className="num text-[12px] text-muted">{u ? `${u.forecasts} fcst · ${u.actuals} periods` : '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                        <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === fns.length - 1} onClick={() => move(i, 1)}>↓</Button>
                        {u ? <ConfirmButton size="sm" variant="ghost" confirmLabel="Remove" onConfirm={() => remove(i)}>Remove</ConfirmButton> : <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(i)}>Remove</Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {removedWithHistory.length > 0 && (
          <div className="border-t border-line p-3">
            <Callout tone="warn" title="Removing functions with history">
              {removedWithHistory.map((f) => `${f.code} ${f.name}`).join(', ')} {removedWithHistory.length === 1 ? 'is' : 'are'} used by existing forecasts or actuals splits. Historic forecasts keep their stored spread (shown as a retired function); new versions and roll-ups by function will no longer include it, and its categories become unmapped until you move them.
            </Callout>
          </div>
        )}
      </Panel>

      <Panel title="Cost category mapping" pad={false}
        subtitle="Every direct cost category rolls up to exactly one function. Budgets and actuals are split to functions through this map."
        actions={<div className="inline-flex rounded border border-line bg-sunken p-0.5">
          {(['by-category', 'by-function'] as const).map((v) => <button key={v} onClick={() => setMapView(v)} className={cx('rounded-sm px-2.5 py-1 text-xs font-semibold', mapView === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>{v === 'by-category' ? 'By category' : 'Matrix'}</button>)}
        </div>}>
        {(issues.unmapped.length > 0 || issues.multi.length > 0) && (
          <div className="border-b border-line p-3">
            <Callout tone={issues.multi.length ? 'bad' : 'warn'} title={issues.multi.length ? 'Categories mapped twice' : `${issues.unmapped.length} unmapped categor${issues.unmapped.length === 1 ? 'y' : 'ies'}`}>
              {issues.multi.length > 0 && <div>{issues.multi.map((c) => `${c.code} ${c.name}`).join(', ')} — pick one function each.</div>}
              {issues.unmapped.length > 0 && <div>{issues.unmapped.map((c) => `${c.code} ${c.name}`).join(', ')} — budget and actuals in {issues.unmapped.length === 1 ? 'this category' : 'these categories'} are left out of the function split until mapped.</div>}
            </Callout>
          </div>
        )}
        {mapView === 'by-category' ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th style={{ width: 80 }}>Code</th><th>Cost category</th><th style={{ width: 140 }}>ERP element</th><th style={{ minWidth: 260 }}>Rolls up to</th></tr></thead>
              <tbody>
                {direct.map((c) => {
                  const owners = fns.filter((f) => f.categoryIds.includes(c.id))
                  return (
                    <tr key={c.id}>
                      <td className="font-mono text-[12px]">{c.code}</td>
                      <td>{c.name}</td>
                      <td className="font-mono text-[12px] text-muted">{c.erpCostElement}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Select aria-label={`Function for ${c.name}`} className={cx('h-7 py-0.5', !owners.length && 'border-warn', owners.length > 1 && 'border-bad')} value={owners[0]?.id ?? ''} onChange={(e) => mapCat(c.id, e.target.value)}
                            options={[{ value: '', label: '— Unmapped —' }, ...fns.map((f) => ({ value: f.id, label: `${f.code} ${f.name}` }))]} />
                          {!owners.length && <Badge tone="warn">Unmapped</Badge>}
                          {owners.length > 1 && <Badge tone="bad">{owners.length} functions</Badge>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {system.map((c) => (
                  <tr key={c.id} className="text-muted">
                    <td className="font-mono text-[12px]">{c.code}</td>
                    <td>{c.name} <Badge tone="info">System</Badge></td>
                    <td className="font-mono text-[12px]">{c.erpCostElement}</td>
                    <td className="text-[12px]">{c.id === CONT_CAT ? 'Held separately as “Contingency held” in the forecast' : 'Allocated to every function pro-rata to its direct cost'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th className="sticky left-0 z-[2] bg-sunken">Category</th>{fns.map((f) => <th key={f.id} className="text-center" title={f.name}>{f.code}</th>)}</tr></thead>
              <tbody>
                {direct.map((c) => (
                  <tr key={c.id}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-surface"><span className="font-mono text-[11px] text-faint">{c.code}</span> {c.name}</td>
                    {fns.map((f) => {
                      const on = f.categoryIds.includes(c.id)
                      return <td key={f.id} className="text-center"><input type="radio" name={`map-${c.id}`} aria-label={`${c.name} → ${f.name}`} className="h-4 w-4 accent-[rgb(var(--ink))]" checked={on} onChange={() => mapCat(c.id, f.id)} /></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">{fns.map((f) => `${f.code} ${f.name}`).join(' · ')}</div>
          </div>
        )}
        <div className="border-t border-line px-4 py-2 text-[12px] text-muted">Changes apply to budgets, actuals and new forecast versions from now on. Approved and submitted forecasts keep the spread they were approved with.{dirty && <b className="ml-1 text-ink">Unsaved changes.</b>}</div>
      </Panel>
    </div>
  )
}
