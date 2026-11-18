// Hand-drawn SVG charts on one scale each. All colors are theme tokens.
import React, { useState } from 'react'
import { money } from '@/core/util'

// Blue, berry, green and orange are the four deck colours (chart-strength fills); index 2 stays green because callers use it for "completed".
export const SERIES = ['rgb(var(--c1))', 'rgb(var(--c4))', 'rgb(var(--c2))', 'rgb(var(--c3))', 'rgb(var(--muted))', '#0f766e']
const AXIS = 'rgb(var(--line))'
const TEXT = 'rgb(var(--muted))'

function niceTicks(min: number, max: number, n = 4): number[] {
  if (max === min) max = min + 1
  const span = max - min
  const step0 = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const lo = Math.floor(min / step) * step
  const out: number[] = []
  // the top tick always covers the largest value, so nothing is drawn off the chart
  for (let v = lo; ; v += step) { out.push(Math.round(v * 1e6) / 1e6); if (v >= max - 1e-9 || out.length > 50) break }
  return out
}

export interface LineSeries { name: string; values: (number | null)[]; color?: string; dashed?: boolean; area?: boolean }

/** Line chart over categorical x labels (months, dates). */
export function LineChart({ labels, series, height = 220, format = money, markers, yMin }: { labels: string[]; series: LineSeries[]; height?: number; format?: (n: number) => string; markers?: { index: number; label: string }[]; yMin?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = height, L = 64, Rm = 16, T = 14, B = 30
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  const max = Math.max(...vals, 0), min = Math.min(yMin ?? 0, ...vals)
  const ticks = niceTicks(min, max)
  const ymin = ticks[0], ymax = ticks[ticks.length - 1]
  const X = (i: number) => L + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * (W - L - Rm))
  const Y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin || 1)) * (H - T - B)
  const every = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Line chart: ${series.map((x) => x.name).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - Rm} y1={Y(t)} y2={Y(t)} stroke={AXIS} strokeWidth={1} /><text x={L - 8} y={Y(t) + 4} textAnchor="end" fontSize={11} fill={TEXT}>{format(t)}</text></g>)}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={X(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={TEXT}>{l}</text>)}
        {markers?.map((m) => <g key={m.index}><line x1={X(m.index)} x2={X(m.index)} y1={T} y2={H - B} stroke="rgb(var(--ink))" strokeDasharray="3 3" strokeWidth={1} /><text x={X(m.index) + 4} y={T + 10} fontSize={11} fill="rgb(var(--ink))">{m.label}</text></g>)}
        {series.map((s, si) => {
          const c = s.color ?? SERIES[si % SERIES.length]
          const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)] as const))
          let d = ''
          pts.forEach((p, i) => { if (!p) return; d += (d && pts[i - 1] ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) })
          const valid = pts.filter(Boolean) as (readonly [number, number])[]
          const area = s.area && valid.length ? `M${valid[0][0]} ${Y(Math.max(ymin, 0))}L` + valid.map((p) => `${p[0]} ${p[1]}`).join('L') + `L${valid[valid.length - 1][0]} ${Y(Math.max(ymin, 0))}Z` : ''
          const last = valid[valid.length - 1]
          return <g key={s.name}>{area && <path d={area} fill={c} opacity={0.1} />}<path d={d} fill="none" stroke={c} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />{last && <circle cx={last[0]} cy={last[1]} r={3.5} fill={c} />}</g>
        })}
        {labels.map((_, i) => <rect key={i} x={X(i) - (W - L) / labels.length / 2} y={T} width={(W - L) / labels.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke={TEXT} strokeWidth={1} />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s, si) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: s.color ?? SERIES[si % SERIES.length], borderTop: s.dashed ? '2px dashed' : undefined }} />{s.name}{hover != null && s.values[hover] != null && <b className="tabular-nums text-ink">{format(s.values[hover] as number)}</b>}</span>)}
        {hover != null && <span className="text-faint">{labels[hover]}</span>}
      </div>
    </div>
  )
}

/** Vertical bars; multiple series render side by side (grouped) or stacked. */
export function BarChart({ labels, series, height = 220, format = money, stacked, highlight, targets, targetLabel = 'Limit' }: { labels: string[]; series: { name: string; values: number[]; color?: string }[]; height?: number; format?: (n: number) => string; stacked?: boolean; highlight?: number; targets?: (number | undefined)[]; targetLabel?: string }) {
  const W = 720, H = height, L = 64, Rm = 12, T = 12, B = 30
  const totals = labels.map((_, i) => (stacked ? series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0) : Math.max(...series.map((s) => s.values[i] || 0))))
  const ticks = niceTicks(0, Math.max(...totals, ...(targets ?? []).map((v) => v ?? 0), 1))
  const ymax = ticks[ticks.length - 1]
  const bw = (W - L - Rm) / labels.length
  const Y = (v: number) => T + (1 - v / ymax) * (H - T - B)
  const every = Math.max(1, Math.ceil(labels.length / 10))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart: ${series.map((x) => x.name).join(', ')}`}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - Rm} y1={Y(t)} y2={Y(t)} stroke={AXIS} /><text x={L - 8} y={Y(t) + 4} textAnchor="end" fontSize={11} fill={TEXT}>{format(t)}</text></g>)}
        {labels.map((l, i) => {
          const x0 = L + i * bw
          let acc = 0
          return (
            <g key={i} opacity={highlight == null || highlight === i ? 1 : 0.45}>
              <title>{l + ': ' + series.map((s) => `${s.name} ${format(s.values[i] || 0)}`).join(', ')}</title>
              {series.map((s, si) => {
                const v = Math.max(0, s.values[i] || 0)
                const c = s.color ?? SERIES[si % SERIES.length]
                if (stacked) { const y = Y(acc + v), h = Y(acc) - y; acc += v; return <rect key={si} x={x0 + bw * 0.18} y={y} width={bw * 0.64} height={Math.max(0, h)} fill={c} /> }
                const gw = (bw * 0.7) / series.length
                return <rect key={si} x={x0 + bw * 0.15 + si * gw} y={Y(v)} width={gw - 1} height={Math.max(0, Y(0) - Y(v))} fill={c} rx={1} />
              })}
              {i % every === 0 && <text x={x0 + bw / 2} y={H - 10} textAnchor="middle" fontSize={11} fill={TEXT}>{l}</text>}
              {targets?.[i] != null && <g><line x1={x0 + bw * 0.08} x2={x0 + bw * 0.92} y1={Y(targets[i]!)} y2={Y(targets[i]!)} stroke="rgb(var(--bad))" strokeWidth={2} strokeDasharray="5 3" /><title>{`${l} ${targetLabel.toLowerCase()} ${format(targets[i]!)}`}</title></g>}
            </g>
          )
        })}
      </svg>
      {(series.length > 1 || targets) && <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">{series.map((s, si) => <span key={s.name} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color ?? SERIES[si % SERIES.length] }} />{s.name}</span>)}{targets && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-bad" />{targetLabel}</span>}</div>}
    </div>
  )
}

/** Horizontal bars with labels on the left — for ranked lists. */
export function HBarChart({ rows, format = money, max }: { rows: { label: string; value: number; color?: string; sub?: string }[]; format?: (n: number) => string; max?: number }) {
  const m = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate" title={r.label}>{r.label}{r.sub && <span className="ml-1 text-faint">{r.sub}</span>}</span>
          <span className="h-3 rounded-sm bg-sunken"><span className="block h-3 rounded-sm" style={{ width: `${(Math.abs(r.value) / m) * 100}%`, background: r.color ?? SERIES[0] }} /></span>
          <span className="tabular-nums text-muted">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Split a label into at most two lines of about `n` characters (word boundaries; ellipsis if still too long). */
function wrap2(label: string, n: number): string[] {
  if (label.length <= n) return [label]
  const words = label.split(' ')
  let a = ''
  while (words.length && (a + ' ' + words[0]).trim().length <= n) a = (a + ' ' + words.shift()).trim()
  if (!a) a = words.shift() ?? ''
  let b = words.join(' ')
  if (b.length > n) b = b.slice(0, n - 1) + '…'
  return b ? [a, b] : [a]
}

/** Waterfall bridge from one total to another (estimate or baseline bridge). Steps marked `subtotal` draw a running-total bar. */
export function Waterfall({ start, end, steps, startLabel = 'From', endLabel = 'To', height = 240 }: { start: number; end: number; steps: { label: string; delta: number; subtotal?: boolean }[]; startLabel?: string; endLabel?: string; height?: number }) {
  const W = 720, H = height, L = 64, Rm = 12, T = 18, B = 46
  const bars: { label: string; y0: number; y1: number; kind: 'total' | 'up' | 'down' }[] = [{ label: startLabel, y0: 0, y1: start, kind: 'total' }]
  let acc = start
  for (const s of steps) { if (s.subtotal) { bars.push({ label: s.label, y0: 0, y1: acc, kind: 'total' }); continue } bars.push({ label: s.label, y0: acc, y1: acc + s.delta, kind: s.delta >= 0 ? 'up' : 'down' }); acc += s.delta }
  bars.push({ label: endLabel, y0: 0, y1: end, kind: 'total' })
  const hi = Math.max(...bars.map((b) => Math.max(b.y0, b.y1)))
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.y0, b.y1)))
  const ticks = niceTicks(lo, hi)
  const ymin = ticks[0], ymax = ticks[ticks.length - 1]
  const Y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B)
  const bw = (W - L - Rm) / bars.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Waterfall chart from ${startLabel} to ${endLabel}`}>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - Rm} y1={Y(t)} y2={Y(t)} stroke={AXIS} /><text x={L - 8} y={Y(t) + 4} textAnchor="end" fontSize={11} fill={TEXT}>{money(t)}</text></g>)}
      {bars.map((b, i) => {
        const x = L + i * bw + bw * 0.15, w = bw * 0.7
        const top = Y(Math.max(b.y0, b.y1)), h = Math.max(1.5, Math.abs(Y(b.y0) - Y(b.y1)))
        const c = b.kind === 'total' ? 'rgb(var(--ink))' : b.kind === 'up' ? 'rgb(var(--bad))' : 'rgb(var(--good))'
        const delta = b.y1 - b.y0
        return (
          <g key={i}>
            <rect x={x} y={top} width={w} height={h} fill={c} opacity={b.kind === 'total' ? 0.85 : 0.8} rx={1} />
            {i < bars.length - 1 && <line x1={x + w} x2={x + bw} y1={Y(b.y1)} y2={Y(b.y1)} stroke={TEXT} strokeDasharray="2 2" />}
            <text x={x + w / 2} y={top - 4} textAnchor="middle" fontSize={10.5} fill="rgb(var(--ink))">{b.kind === 'total' ? money(b.y1) : (delta > 0 ? '+' : '') + money(delta)}</text>
            <text x={x + w / 2} y={H - B + 14} textAnchor="middle" fontSize={10.5} fill={TEXT}>{wrap2(b.label, Math.max(10, Math.floor(bw / 6.2))).map((ln, k) => <tspan key={k} x={x + w / 2} dy={k ? 12 : 0}>{ln}</tspan>)}<title>{b.label}</title></text>
          </g>
        )
      })}
    </svg>
  )
}

export function Sparkline({ values, width = 90, height = 24, color = SERIES[0] }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} />
  const mx = Math.max(...values), mn = Math.min(...values)
  const X = (i: number) => (i / (values.length - 1)) * (width - 4) + 2
  const Y = (v: number) => height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('')
  return <svg width={width} height={height} aria-hidden><path d={d} fill="none" stroke={color} strokeWidth={1.5} /><circle cx={X(values.length - 1)} cy={Y(values[values.length - 1])} r={2.5} fill={color} /></svg>
}

/** Histogram with percentile markers (Monte Carlo). */
export function Histogram({ bins, markers, format = money, height = 200 }: { bins: { x: number; n: number }[]; markers?: { x: number; label: string; color?: string }[]; format?: (n: number) => string; height?: number }) {
  const W = 720, H = height, L = 16, Rm = 16, T = 22, B = 28
  if (!bins.length) return null
  const lo = bins[0].x, hi = bins[bins.length - 1].x
  const mx = Math.max(...bins.map((b) => b.n))
  const X = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - L - Rm)
  const bw = (W - L - Rm) / bins.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Histogram of simulated outcomes">
      {bins.map((b, i) => { const h = (b.n / mx) * (H - T - B); return <rect key={i} x={L + i * bw} y={H - B - h} width={bw - 1} height={h} fill="rgb(var(--link))" opacity={0.55} /> })}
      <line x1={L} x2={W - Rm} y1={H - B} y2={H - B} stroke={AXIS} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={L + f * (W - L - Rm)} y={H - 10} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={11} fill={TEXT}>{format(lo + f * (hi - lo))}</text>)}
      {markers?.map((m, i) => <g key={m.label}><line x1={X(m.x)} x2={X(m.x)} y1={T - 4} y2={H - B} stroke={m.color ?? 'rgb(var(--ink))'} strokeWidth={1.5} strokeDasharray="4 3" /><text x={X(m.x)} y={T - 8 + (i % 2) * 0} textAnchor="middle" fontSize={11} fontWeight={600} fill={m.color ?? 'rgb(var(--ink))'}>{m.label}</text></g>)}
    </svg>
  )
}

/** 5×5 likelihood × consequence heat map with counts; click a cell to filter. */
export function RiskMatrix({ cells, onPick, selected }: { cells: Record<string, number>; onPick?: (l: number, c: number) => void; selected?: string }) {
  const tone = (l: number, c: number) => { const s = l * c; return s >= 15 ? 'bg-bad text-white' : s >= 8 ? 'bg-warn/50 text-ink' : 'bg-good/25 text-ink' }
  return (
    <div className="inline-grid grid-cols-[auto_repeat(5,minmax(34px,48px))] gap-1 text-[11px]">
      {[5, 4, 3, 2, 1].map((l) => (
        <React.Fragment key={l}>
          <div className="flex items-center justify-end pr-1 text-faint">L{l}</div>
          {[1, 2, 3, 4, 5].map((c) => {
            const k = `${l}-${c}`, n = cells[k] || 0
            return <button key={k} aria-label={`Likelihood ${l}, consequence ${c}: ${n} risk${n === 1 ? '' : 's'}`} onClick={() => onPick?.(l, c)} className={`flex h-9 items-center justify-center rounded-sm font-bold tabular-nums ${tone(l, c)} ${selected === k ? 'ring-2 ring-ink' : ''} ${n ? '' : 'opacity-40'}`}>{n || ''}</button>
          })}
        </React.Fragment>
      ))}
      <div />
      {[1, 2, 3, 4, 5].map((c) => <div key={c} className="text-center text-faint">C{c}</div>)}
    </div>
  )
}

/** Labeled range bar: shows an estimate's low–high band and the point value (AACE ranges). */
export function RangeBar({ low, point, high, scaleMax }: { low: number; point: number; high: number; scaleMax?: number }) {
  const mx = scaleMax ?? high * 1.05
  const pct = (v: number) => `${(v / mx) * 100}%`
  return (
    <div className="relative h-5 w-full">
      <div className="absolute top-2 h-1 w-full rounded bg-sunken" />
      <div className="absolute top-1.5 h-2 rounded bg-info/40" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
      <div className="absolute top-0.5 h-4 w-1 rounded bg-link" style={{ left: pct(point) }} title={money(point)} />
    </div>
  )
}
