// Cost breakdown structure, loader rates and escalation.
import { useMemo } from 'react'
import type { CostCategory, CostGroup } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { LOADER_CAT, ESC_CAT, CONT_CAT } from '@/core/engine/estimates'
import { sum, uid } from '@/core/util'
import { Badge, Button, Input, Panel, Select } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { useDraft } from './common'

const GROUPS: CostGroup[] = ['direct', 'indirect', 'escalation', 'contingency']
const SYSTEM = [LOADER_CAT, ESC_CAT, CONT_CAT]

export default function Cbs() {
  const s = useStore()
  const usage = useMemo(() => {
    const out: Record<string, number> = {}
    for (const e of s.estimates) for (const l of e.lines) out[l.categoryId] = (out[l.categoryId] || 0) + 1
    for (const r of s.rates) out[r.categoryId] = (out[r.categoryId] || 0) + 1
    return out
  }, [s.estimates, s.rates])
  const [cats, setCats, dirty, discard] = useDraft(s.categories)
  const set = (i: number, patch: Partial<CostCategory>) => setCats(cats.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const dupCodes = cats.filter((c, i) => cats.findIndex((x) => x.code === c.code) !== i).map((c) => c.code)
  const save = () => {
    if (dupCodes.length) { toast(`Duplicate code ${dupCodes[0]}`, 'bad'); return }
    const added = cats.filter((c) => !s.categories.some((x) => x.id === c.id)).map((c) => c.code)
    const removed = s.categories.filter((c) => !cats.some((x) => x.id === c.id)).map((c) => c.code)
    const edited = cats.filter((c) => { const o = s.categories.find((x) => x.id === c.id); return o && JSON.stringify(o) !== JSON.stringify(c) }).map((c) => c.code)
    mutate((d) => { d.categories = cats }, { entity: 'cost-category', entityId: 'cbs', action: 'update', summary: `Cost breakdown structure updated${added.length ? ` · added ${added.join(', ')}` : ''}${edited.length ? ` · edited ${edited.join(', ')}` : ''}${removed.length ? ` · removed ${removed.join(', ')}` : ''}` })
    toast('Cost breakdown structure saved')
  }
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Cost breakdown structure" subtitle="Categories estimates, budgets and actuals roll up to. The ERP cost element maps each category to the general ledger." pad={false}
        actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={() => setCats([...cats, { id: uid('cat'), code: String(Math.max(...cats.map((c) => Number(c.code) || 0)) + 5), name: 'New category', group: 'direct', erpCostElement: '' }])}>Add category</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save CBS</Button></>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th style={{ width: 90 }}>Code</th><th>Category</th><th style={{ width: 140 }}>Group</th><th style={{ width: 150 }}>ERP cost element</th><th className="num">In use</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>
              {cats.map((c, i) => {
                const sys = SYSTEM.includes(c.id)
                const used = usage[c.id] || 0
                return (
                  <tr key={c.id}>
                    <td><Input className={`h-7 py-0.5 font-mono ${dupCodes.includes(c.code) ? 'border-bad' : ''}`} value={c.code} onChange={(e) => set(i, { code: e.target.value })} /></td>
                    <td><div className="flex items-center gap-2"><Input className="h-7 py-0.5" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />{sys && <Badge tone="info" title="Computed by the estimating engine">System</Badge>}</div></td>
                    <td><Select className="h-7 py-0.5" disabled={sys} value={c.group} onChange={(e) => set(i, { group: e.target.value as CostGroup })} options={GROUPS} /></td>
                    <td><Input className="h-7 py-0.5 font-mono" value={c.erpCostElement} onChange={(e) => set(i, { erpCostElement: e.target.value })} /></td>
                    <td className="num text-muted">{used || '—'}</td>
                    <td>{!sys && !used && <Button size="sm" variant="ghost" className="text-bad" onClick={() => setCats(cats.filter((_, j) => j !== i))}>Remove</Button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-[12px] text-muted">Categories referenced by estimate lines or library rates cannot be removed; rename or remap them instead.</div>
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Loaders />
        <Escalation />
      </div>
    </div>
  )
}

function Loaders() {
  const rates = useStore((s) => s.settings.loaderRates)
  const [rows, setRows, dirty, discard] = useDraft(rates)
  const years = Array.from(new Set(rows.map((r) => r.year))).sort()
  const save = () => {
    mutate((d) => { d.settings.loaderRates = rows }, { entity: 'settings', entityId: 'loaderRates', action: 'update', summary: `Loader rates updated: ${rows.map((r) => `${r.year} ${r.name} ${r.pct}%`).join(', ')}` })
    toast('Loader rates saved')
  }
  return (
    <Panel title="Loader rates" subtitle="Overheads applied to direct cost on new estimates" pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={() => setRows([...rows, { year: years[years.length - 1] ?? 2026, name: 'New loader', pct: 1 }])}>Add</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save</Button></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>Year</th><th>Loader</th><th className="num" style={{ width: 110 }}>Rate %</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><Input className="h-7 py-0.5 tabular-nums" type="number" value={r.year} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, year: Number(e.target.value) } : x)))} /></td>
                <td><Input className="h-7 py-0.5" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                <td><Input className="h-7 py-0.5 text-right tabular-nums" type="number" step="0.1" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} /></td>
                <td><Button size="sm" variant="ghost" className="text-bad" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button></td>
              </tr>
            ))}
            {years.map((y) => <tr key={'t' + y}><td className="text-muted">{y}</td><td className="text-muted">Total loaders</td><td className="num font-semibold">{sum(rows.filter((r) => r.year === y).map((r) => r.pct)).toFixed(1)}%</td><td /></tr>)}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Escalation() {
  const esc = useStore((s) => s.settings.escalationByYear)
  const [rows, setRows, dirty, discard] = useDraft(esc)
  const years = Object.keys(rows).sort()
  const cumulative = (y: string) => years.filter((x) => x <= y).reduce((a, x) => a * (1 + rows[x] / 100), 1)
  const save = () => {
    mutate((d) => { d.settings.escalationByYear = rows }, { entity: 'settings', entityId: 'escalationByYear', action: 'update', summary: `Escalation updated: ${years.map((y) => `${y} ${rows[y]}%`).join(', ')}` })
    toast('Escalation rates saved')
  }
  return (
    <Panel title="Escalation by year" subtitle="Annual cost escalation used to bring library rates to the year of spend" pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={() => { const y = String(Number(years[years.length - 1] ?? 2025) + 1); setRows({ ...rows, [y]: rows[years[years.length - 1]] ?? 3 }) }}>Add year</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save</Button></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Year</th><th className="num" style={{ width: 120 }}>Annual %</th><th className="num">Cumulative from {years[0]}</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="tabular-nums">{y}</td>
                <td><Input className="h-7 py-0.5 text-right tabular-nums" type="number" step="0.1" value={rows[y]} onChange={(e) => setRows({ ...rows, [y]: Number(e.target.value) })} /></td>
                <td className="num text-muted">{((cumulative(y) - 1) * 100).toFixed(1)}%</td>
                <td>{y === years[years.length - 1] && years.length > 1 && <Button size="sm" variant="ghost" className="text-bad" onClick={() => { const n = { ...rows }; delete n[y]; setRows(n) }}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
