// Scope statement editor: in-scope / out-of-scope / assumptions picked from the estimating team's scope
// library (free text still allowed and flagged), quantities limited to the configured quantity types
// (label + fixed unit), and the capital / O&M split. These fields feed the estimate.
import { useState } from 'react'
import { useStore } from '@/core/store'
import type { ScopeStatement } from '@/core/types'
import { cx } from '@/core/util'
import { Button, Field, Input, Select } from '@/ui/kit'
import { Icon } from '@/ui/icons'

type ListKey = 'inScope' | 'outOfScope' | 'assumptions'

export function ScopeListEditor({ k, label, items, onChange }: { k: ListKey; label: string; items: string[]; onChange: (items: string[]) => void }) {
  const lib = useStore((s) => s.settings.estimating.scopeLibrary[k])
  const [own, setOwn] = useState('')
  const options = lib.filter((x) => !items.includes(x))
  const addOwn = () => { const v = own.trim(); if (v && !items.includes(v)) onChange([...items, v]); setOwn('') }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      <ul className="flex flex-col gap-1">
        {items.map((x, i) => (
          <li key={i} className="flex items-center gap-1">
            <Input aria-label={`${label} item ${i + 1}`} className={cx('h-7 py-0 text-[12.5px]', !lib.includes(x) && 'border-info/50')} value={x} onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
            <Button size="sm" variant="ghost" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</Button>
          </li>
        ))}
        {!items.length && <li className="text-[12px] text-faint">None yet</li>}
      </ul>
      <Select id={`scope-${k}-lib`} aria-label={`Add ${label.toLowerCase()} from the library`} className="h-8 py-1 text-[12.5px]" value="" onChange={(e) => e.target.value && onChange([...items, e.target.value])}
        options={[{ value: '', label: options.length ? 'Add from library…' : 'All library items added' }, ...options.map((o) => ({ value: o, label: o }))]} />
      <div className="flex gap-1">
        <Input id={`scope-${k}-own`} aria-label={`Add your own ${label.toLowerCase()} item`} className="h-8 py-1 text-[12.5px]" value={own} placeholder="Or type your own" onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn() } }} />
        <Button size="sm" onClick={addOwn} disabled={!own.trim()}>Add</Button>
      </div>
    </div>
  )
}

export function QuantityEditor({ quantities, onChange }: { quantities: ScopeStatement['quantities']; onChange: (q: ScopeStatement['quantities']) => void }) {
  const types = useStore((s) => s.settings.estimating.quantityTypes)
  const used = new Set(quantities.map((q) => q.typeId).filter(Boolean))
  const setType = (i: number, typeId: string) => {
    const t = types.find((x) => x.id === typeId)
    onChange(quantities.map((q, j) => (j === i ? { ...q, typeId: t?.id, label: t?.label ?? q.label, unit: t?.unit ?? q.unit } : q)))
  }
  const next = types.find((t) => !used.has(t.id))
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted">Quantities</span>
        <span className="text-[11px] text-faint">Types and units come from Estimating configuration</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {quantities.map((q, i) => {
          const t = types.find((x) => x.id === q.typeId)
          return (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_56px_auto] items-center gap-2">
              <Select aria-label="Quantity type" className={cx(!t && 'border-bad/60')} value={q.typeId ?? ''} onChange={(e) => setType(i, e.target.value)}
                options={[...(!t ? [{ value: '', label: `${q.label || 'Pick a type'} — choose a configured type` }] : []), ...types.filter((x) => x.id === q.typeId || !used.has(x.id)).map((x) => ({ value: x.id, label: x.label }))]} />
              <Input aria-label="Quantity" type="number" min={0} className="text-right tabular-nums" value={q.qty} onChange={(e) => onChange(quantities.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
              <span className="text-[12.5px] font-semibold text-muted" title="Unit fixed by the quantity type">{t?.unit ?? q.unit}</span>
              <Button variant="ghost" size="sm" aria-label="Remove quantity" onClick={() => onChange(quantities.filter((_, j) => j !== i))}>✕</Button>
            </div>
          )
        })}
        <div><Button size="sm" disabled={!next} icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => next && onChange([...quantities, { typeId: next.id, label: next.label, unit: next.unit, qty: 0 }])}>Add quantity</Button></div>
      </div>
    </div>
  )
}

export function CapitalSplitEditor({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(100, Math.round(n * 10) / 10)))
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Capital %" hint="Share of the work that is capital"><Input id="scope-capital" type="number" min={0} max={100} className="text-right tabular-nums" value={value ?? ''} onChange={(e) => e.target.value === '' ? onChange(undefined) : set(Number(e.target.value))} /></Field>
      <Field label="O&M %" hint="The rest is expensed"><Input id="scope-om" type="number" min={0} max={100} className="text-right tabular-nums" value={value === undefined ? '' : Math.round((100 - value) * 10) / 10} onChange={(e) => e.target.value === '' ? onChange(undefined) : set(100 - Number(e.target.value))} /></Field>
    </div>
  )
}

/** Validation for save: quantities must use configured types; split within 0–100. */
export function scopeProblems(sc: ScopeStatement, typeIds: string[]): string[] {
  const out: string[] = []
  if (sc.quantities.some((q) => !q.typeId || !typeIds.includes(q.typeId))) out.push('Every quantity needs a configured quantity type')
  if (sc.quantities.some((q) => !(q.qty >= 0))) out.push('Quantities must be zero or more')
  if (sc.capitalPct !== undefined && (sc.capitalPct < 0 || sc.capitalPct > 100)) out.push('Capital % must be 0–100')
  return out
}

