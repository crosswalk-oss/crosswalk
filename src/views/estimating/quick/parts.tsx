// Presentational pieces for the Class 5 quick estimate: result headline, range vs AACE, build-up, matched row.
import type { AppState, HistoricalCost, HistUnit, QuickInputs } from '@/core/types'
import type { QuickResult } from '@/core/engine/quick'
import { personName } from '@/core/store'
import { cx, fmtDate, money, pct } from '@/core/util'
import { Badge } from '@/ui/kit'
import { ASSET_LABEL, METHOD_LABEL, QUICK_LABEL, TERRAIN_LABEL, aaceCompare, bandLabel, fmtRate, matchNote } from './lib'

export function QuickBadge({ className }: { className?: string }) {
  return <Badge tone="info" className={className} title="Class 5 quick estimate from the historical cost table">{QUICK_LABEL}</Badge>
}

/** P10–P90 band from history inside the AACE Class 5 band, with the point estimate. */
export function RangeCompare({ low, point, high, aaceLow, aaceHigh, source = 'Historical' }: { low: number; point: number; high: number; aaceLow: number; aaceHigh: number; source?: string }) {
  const mx = Math.max(high, aaceHigh) * 1.03 || 1
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / mx) * 100))}%`
  return (
    <div className="relative h-7 w-full" aria-label={`Range ${money(low)} to ${money(high)}, point ${money(point)}`}>
      <div className="absolute top-[13px] h-0.5 w-full bg-line" />
      <div className="absolute top-[6px] h-4 rounded-sm border border-dashed border-faint" style={{ left: x(aaceLow), width: `calc(${x(aaceHigh)} - ${x(aaceLow)})` }} title={`AACE Class 5: ${money(aaceLow)} – ${money(aaceHigh)}`} />
      <div className="absolute top-[9px] h-2.5 rounded-sm bg-info/45" style={{ left: x(low), width: `calc(${x(high)} - ${x(low)})` }} title={`${source} P10–P90: ${money(low)} – ${money(high)}`} />
      <div className="absolute top-[3px] h-[22px] w-[3px] -translate-x-1/2 rounded-sm bg-ink" style={{ left: x(point) }} title={`Estimate ${money(point)}`} />
    </div>
  )
}

export function RangeLegend({ source = 'Historical' }: { source?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-info/45" />{source} P10–P90</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-faint" />AACE Class 5 −50% / +100%</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-[3px] bg-ink" />Estimate</span>
    </div>
  )
}

/** Headline total, $/unit and the range bar. */
export function QuickHeadline({ total, low, high, perUnit, unit, size = 'lg', source = 'Historical' }: { total: number; low: number; high: number; perUnit: number; unit: HistUnit; size?: 'lg' | 'md'; source?: string }) {
  const a = aaceCompare({ total, low, high })
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="eyebrow">Forward-looking estimate</div>
          <div className={cx('font-display font-bold leading-tight tabular-nums', size === 'lg' ? 'text-[32px]' : 'text-[26px]')}>{money(total)}</div>
        </div>
        <div className="text-right text-[12px] text-muted"><b className="text-[14px] tabular-nums text-ink">{fmtRate(perUnit, unit)}</b><div>all-in, incl. loaders and contingency</div></div>
      </div>
      <RangeCompare low={low} point={total} high={high} aaceLow={a.aaceLow} aaceHigh={a.aaceHigh} source={source} />
      <div className="flex justify-between text-[11.5px] tabular-nums text-muted"><span>P10 <b className="text-ink">{money(low)}</b></span><span>P90 <b className="text-ink">{money(high)}</b></span></div>
      <RangeLegend source={source} />
      <p className="text-[12px] text-muted">
        {source} spread {pct(a.lo)} / +{pct(a.hi)} around the estimate{' '}
        {a.inside ? <>sits <b className="text-good">inside</b> the AACE Class 5 range ({pct(a.aaceLo)} / +{pct(a.aaceHi)}: {money(a.aaceLow)}–{money(a.aaceHigh)}).</> : <>is <b className="text-warn">wider than</b> the AACE Class 5 range ({pct(a.aaceLo)} / +{pct(a.aaceHi)}): treat the {source === 'Historical' ? 'history' : `${source.toLowerCase()} range`} as thin.</>}
      </p>
    </div>
  )
}

export interface BuildUpData { baseRate: number; basis: string; baseYear?: number; qty: number; unit: HistUnit; district: string; regionFactor: number; escalationFactor: number; midpointYear: number; adjustPct?: number; direct: number; loaders: number; loaderPct: number; contingency: number; contingencyPct: number; total: number }

export function buildUpFromResult(r: QuickResult, i: QuickInputs, loaderPct: number): BuildUpData {
  return { baseRate: r.baseRate, basis: 'P50', baseYear: r.row?.baseYear, qty: i.qty, unit: i.unit, district: i.district, regionFactor: r.regionFactor, escalationFactor: r.escalationFactor, midpointYear: i.midpointYear, direct: r.direct, loaders: r.loaders, loaderPct, contingency: r.contingency, contingencyPct: r.contingencyPct, total: r.total }
}

/** historical rate × qty × region × escalation → direct; + loaders; + contingency. */
export function BuildUp({ b }: { b: BuildUpData }) {
  const row = (label: React.ReactNode, value: React.ReactNode, strong?: boolean) => (
    <tr className={cx(strong && 'border-t border-line')}><td className={cx('text-[12.5px]', strong && 'font-semibold')}>{label}</td><td className={cx('num text-[12.5px]', strong && 'font-semibold')}>{value}</td></tr>
  )
  return (
    <table className="tbl [&_td]:py-1">
      <tbody>
        {row(<>Historical direct rate <span className="text-faint">({b.basis}{b.baseYear ? `, ${b.baseYear}$` : ''})</span></>, fmtRate(b.baseRate, b.unit))}
        {row(<>× Quantity</>, `${b.qty.toLocaleString('en-US')} ${b.unit}`)}
        {row(<>× Region factor <span className="text-faint">({b.district})</span></>, `×${b.regionFactor.toFixed(2)}`)}
        {row(<>× Escalation <span className="text-faint">({b.baseYear ?? '—'} → {b.midpointYear} midpoint)</span></>, `×${b.escalationFactor.toFixed(3)}`)}
        {b.adjustPct ? row(<>× Estimator adjustment</>, `${b.adjustPct > 0 ? '+' : ''}${b.adjustPct}%`) : null}
        {row('= Direct cost', money(b.direct), true)}
        {row(<>+ Loaders <span className="text-faint">({b.loaderPct.toFixed(1)}%)</span></>, money(b.loaders))}
        {row(<>+ Contingency <span className="text-faint">({b.contingencyPct}% Class 5)</span></>, money(b.contingency))}
        <tr className="border-t-2 border-ink/60"><td className="font-display text-[13.5px] font-bold">= Total</td><td className="num font-display text-[13.5px] font-bold">{money(b.total)}</td></tr>
      </tbody>
    </table>
  )
}

export const rowTitle = (h: Pick<HistoricalCost, 'assetType' | 'workMethod' | 'diameterBand' | 'terrain'>) => `${ASSET_LABEL[h.assetType]} · ${METHOD_LABEL[h.workMethod]} · ${bandLabel(h.diameterBand)} · ${TERRAIN_LABEL[h.terrain]}`

/** Which historical row priced the estimate, with a visible warning when it was a fallback or a thin sample. */
export function MatchedRow({ s, row, match, inputs }: { s: AppState; row?: HistoricalCost; match: QuickResult['match']; inputs: QuickInputs }) {
  const m = matchNote(s, { row, match }, inputs)
  return (
    <div className={cx('rounded-md border px-3 py-2.5', m.tone === 'good' ? 'border-line' : m.tone === 'warn' ? 'border-warn/50 bg-warn/5' : 'border-bad/50 bg-bad/5')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Historical row</span>
        <Badge tone={m.tone === 'good' ? 'good' : m.tone === 'warn' ? 'warn' : 'bad'}>{m.label}</Badge>
        {row && <span className="font-mono text-[11px] text-faint">{row.id}</span>}
        {row && !row.active && <Badge tone="bad">Since deactivated</Badge>}
      </div>
      {row && <div className="mt-1 text-[13px] font-semibold">{rowTitle(row)}</div>}
      <p className={cx('mt-0.5 text-[12px]', m.tone === 'good' ? 'text-muted' : m.tone === 'warn' ? 'text-warn' : 'text-bad')}>{m.detail}</p>
      {row && (
        <div className="mt-1.5 grid grid-cols-3 gap-2 text-[12px] sm:grid-cols-5">
          <Mini k="P10" v={fmtRate(row.p10, row.unit)} />
          <Mini k="P50" v={fmtRate(row.p50, row.unit)} strong />
          <Mini k="P90" v={fmtRate(row.p90, row.unit)} />
          <Mini k="Projects" v={<span className={cx(row.n < 5 && 'text-warn')}>n = {row.n}</span>} />
          <Mini k="Base year" v={`${row.baseYear}$`} />
        </div>
      )}
      {row && <div className="mt-1.5 text-[11.5px] text-muted">Sources: {row.sources.length ? row.sources.join(', ') : '—'} · updated {fmtDate(row.updatedAt)} by {personName(s, row.updatedById)}{row.note ? ` · ${row.note}` : ''}</div>}
    </div>
  )
}

function Mini({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className="min-w-0"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className={cx('tabular-nums', strong && 'font-semibold')}>{v}</div></div>
}
