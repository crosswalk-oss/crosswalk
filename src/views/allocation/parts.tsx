// Shared pieces for capital allocation: measure colors, amount formatting, and a commit-on-blur number box.
import { useEffect, useState } from 'react'
import type { AllocationCriterionDef, AllocationSettings } from '@/core/types'
import { cx, money } from '@/core/util'

const PALETTE = ['rgb(var(--bad))', 'rgb(var(--marker))', 'rgb(var(--info))', '#7c3aed', 'rgb(var(--good))', '#475569', '#0f766e', '#b45309', '#be185d', '#0369a1']
/** Stable color per measure (by its place in the configured list, so switching one off doesn't recolor the rest). */
export const measureColor = (a: Pick<AllocationSettings, 'criteria'>, id: string) => PALETTE[Math.max(0, a.criteria.findIndex((c) => c.id === id)) % PALETTE.length]

export const pts = (n: number) => `${Math.round(n).toLocaleString('en-US')} pts`
export const bn = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : money(n))

/** An amount in a measure's unit: '$K/yr' → $1.2M/yr, otherwise number + unit. */
export function fmtAmount(v: number, c: Pick<AllocationCriterionDef, 'unit'>): string {
  const u = c.unit.trim()
  if (/^\$K/i.test(u)) { const rest = u.replace(/^\$K/i, ''); return v >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M${rest}` : `$${v.toLocaleString('en-US')}K${rest}` }
  if (/^\$M/i.test(u)) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}M${u.slice(2)}`
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${u}`
}

/** Number box that commits on blur or Enter (one audit entry per edit, not per keystroke). `live` also commits as you type. */
export function CommitNum({ value, onCommit, className, ariaLabel, id, live, disabled }: { value: number; onCommit: (n: number) => void; className?: string; ariaLabel?: string; id?: string; live?: boolean; disabled?: boolean }) {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')
  const [txt, setTxt] = useState(fmt(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(fmt(value)) }, [value, focus])
  const parse = (t: string) => { const n = Number(t.replace(/[$,%\s]/g, '')); return t.trim() !== '' && Number.isFinite(n) ? n : null }
  const commit = () => { const n = parse(txt); if (n != null && n !== value) onCommit(n); else setTxt(fmt(value)) }
  return (
    <input id={id} aria-label={ariaLabel} disabled={disabled} inputMode="decimal" className={cx('inp text-right tabular-nums', className)} value={txt}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); commit() }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setTxt(e.target.value); if (live) { const n = parse(e.target.value); if (n != null) onCommit(n) } }} />
  )
}
