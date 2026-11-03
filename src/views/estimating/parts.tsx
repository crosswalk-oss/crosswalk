// Small presentational pieces for the estimating module. Token colors only.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AaceClass } from '@/core/types'
import { CLASS_RANGES } from '@/core/engine/estimates'
import { cx, money, pct } from '@/core/util'

/** Numeric input that lets people type freely and commits a number on every valid change. */
export function NumInput({ value, onChange, className, step, min, id, ariaLabel, disabled }: { value: number; onChange: (n: number) => void; className?: string; step?: number; min?: number; id?: string; ariaLabel?: string; disabled?: boolean }) {
  const [txt, setTxt] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setTxt(fmt(value)) }, [value])
  return (
    <input id={id} aria-label={ariaLabel} disabled={disabled} inputMode="decimal" className={cx('inp text-right tabular-nums', className)} value={txt} step={step} min={min}
      onFocus={() => { focused.current = true; setTxt(String(value)) }}
      onBlur={() => { focused.current = false; setTxt(fmt(value)) }}
      onChange={(e) => {
        setTxt(e.target.value)
        const n = Number(e.target.value.replace(/[$,\s%]/g, ''))
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(min != null ? Math.max(min, n) : n)
      }} />
  )
}
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')

export const cellInp = 'h-7 px-1.5 py-0.5 text-[12px]'

/** P10–P90 spread around the median on a common relative axis (0.5×–1.6× of P50). */
export function SpreadBar({ p10, p50, p90 }: { p10: number; p50: number; p90: number }) {
  const lo = 0.5, hi = 1.6
  const x = (v: number) => `${((Math.min(hi, Math.max(lo, v / (p50 || 1))) - lo) / (hi - lo)) * 100}%`
  return (
    <div className="relative h-4 w-28" title={`P10 ${money(p10, 'full')} · P50 ${money(p50, 'full')} · P90 ${money(p90, 'full')}`}>
      <div className="absolute top-[7px] h-0.5 w-full bg-line" />
      <div className="absolute top-[5px] h-1.5 rounded-sm bg-info/45" style={{ left: x(p10), width: `calc(${x(p90)} - ${x(p10)})` }} />
      <div className="absolute top-0.5 h-3 w-0.5 bg-ink" style={{ left: x(p50) }} />
    </div>
  )
}

/** One horizontal accuracy bar: AACE band around the estimate, with the outcome marker. */
export function OutcomeBar({ low, point, high, outcome, scaleMax }: { low: number; point: number; high: number; outcome?: number; scaleMax: number }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`
  return (
    <div className="relative h-6 w-full min-w-[140px]">
      <div className="absolute top-[11px] h-0.5 w-full bg-line" />
      <div className="absolute top-[7px] h-2.5 rounded-sm border border-info/50 bg-info/20" style={{ left: p(low), width: `calc(${p(high)} - ${p(low)})` }} />
      <div className="absolute top-1 h-4 w-[3px] rounded-sm bg-ink" style={{ left: p(point) }} title={`Estimate ${money(point)}`} />
      {outcome != null && <div className="absolute top-[5px] h-3 w-3 -translate-x-1/2 rotate-45 border-2 border-surface bg-marker" style={{ left: p(outcome) }} title={`Outcome ${money(outcome)}`} />}
    </div>
  )
}

export function AccPct({ v, cls }: { v: number; cls: AaceClass }) {
  const r = CLASS_RANGES[cls]
  const ok = v >= r.low && v <= r.high
  return <span className={cx('tabular-nums font-semibold', ok ? 'text-good' : 'text-bad')}>{v > 0 ? '+' : ''}{pct(v, 1)}</span>
}

export interface StripRow { label: string; sub?: string; low: number; high: number; points: { v: number; title: string }[]; mean?: number }

/** Strip plot of accuracy (outcome ÷ estimate − 1) by class against the AACE expected band. */
export function AccuracyStrip({ rows, domain }: { rows: StripRow[]; domain: [number, number] }) {
  const W = 720, L = 110, R = 18, RH = 58, T = 8, B = 26
  const H = T + rows.length * RH + B
  const [d0, d1] = domain
  const X = (v: number) => L + ((Math.max(d0, Math.min(d1, v)) - d0) / (d1 - d0)) * (W - L - R)
  const span = d1 - d0
  const step = span > 1.2 ? 0.25 : span > 0.6 ? 0.1 : 0.05
  const ticks: number[] = []
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Estimate accuracy by class">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t)} x2={X(t)} y1={T} y2={H - B} stroke="rgb(var(--line))" strokeWidth={t === 0 ? 0 : 1} />
          <text x={X(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="rgb(var(--muted))">{t > 0 ? '+' : ''}{Math.round(t * 100)}%</text>
        </g>
      ))}
      <line x1={X(0)} x2={X(0)} y1={T} y2={H - B} stroke="rgb(var(--ink))" strokeWidth={1.2} strokeDasharray="3 3" />
      {rows.map((r, i) => {
        const y0 = T + i * RH, cy = y0 + RH / 2
        return (
          <g key={r.label}>
            <text x={8} y={cy - 2} fontSize={12.5} fontWeight={700} fill="rgb(var(--ink))">{r.label}</text>
            {r.sub && <text x={8} y={cy + 13} fontSize={11} fill="rgb(var(--muted))">{r.sub}</text>}
            <rect x={X(r.low)} y={cy - 14} width={Math.max(1, X(r.high) - X(r.low))} height={28} rx={3} fill="rgb(var(--info))" fillOpacity={0.13} stroke="rgb(var(--info))" strokeOpacity={0.5} />
            <text x={X(r.low) + 4} y={cy - 17} fontSize={10} fill="rgb(var(--info))">AACE {r.low > 0 ? '+' : ''}{Math.round(r.low * 100)}% to +{Math.round(r.high * 100)}%</text>
            {r.points.map((p, k) => (
              <circle key={k} cx={X(p.v)} cy={cy + ((k * 7) % 21) - 10} r={4.5} fill={p.v >= r.low && p.v <= r.high ? 'rgb(var(--link))' : 'rgb(var(--bad))'} fillOpacity={0.8} stroke="rgb(var(--surface))" strokeWidth={1}>
                <title>{p.title}</title>
              </circle>
            ))}
            {r.mean != null && (
              <g>
                <line x1={X(r.mean)} x2={X(r.mean)} y1={cy - 16} y2={cy + 16} stroke="rgb(var(--ink))" strokeWidth={3} />
                <text x={X(r.mean)} y={cy + 27} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="rgb(var(--ink))">mean {r.mean > 0 ? '+' : ''}{(r.mean * 100).toFixed(1)}%</text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function Legend({ items }: { items: { swatch: ReactNode; label: string }[] }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5">{i.swatch}{i.label}</span>)}</div>
}
export const Swatch = ({ className }: { className: string }) => <span className={cx('inline-block h-2.5 w-2.5 rounded-sm', className)} />
