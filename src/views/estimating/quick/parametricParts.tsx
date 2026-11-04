// Class 5 parametric request — presentational pieces: the risk-item ratings (Low / Medium / High risk), the live
// result (headline with the Monte Carlo P10–P90, risk allowances, build-up, rate rows) and the Monte Carlo view.
import type { AppState, RiskItemDef, RiskLevel } from '@/core/types'
import { RISK_LEVELS, RISK_LEVEL_LABEL, riskItemsOf, type ParametricResult } from '@/core/engine/parametric'
import { cx, money, sum } from '@/core/util'
import { Badge, Select } from '@/ui/kit'
import { QuickHeadline } from './parts'
import { MonteCarloView, VerifyTag } from './factorParts'

const TONE: Record<RiskLevel, string> = { low: 'border-line', medium: 'border-warn/60 bg-warn/5', high: 'border-bad/50 bg-bad/5' }

/** One row per risk item: name, a Low / Medium / High risk dropdown, what the chosen level means, and its $ effect. */
export function RiskRatings({ s, value, onChange, result, disabled, original, idPrefix = 'risk' }: {
  s: AppState; value: Record<string, RiskLevel>; onChange?: (v: Record<string, RiskLevel>) => void; result?: ParametricResult; disabled?: boolean
  /** Ratings to compare against (e.g. the PM's, when an estimator re-rates). */ original?: Record<string, RiskLevel>; idPrefix?: string
}) {
  const items = riskItemsOf(s)
  const amount = (id: string) => result?.risks.find((r) => r.id === id)?.amount ?? 0
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((it: RiskItemDef) => {
        const lv = value[it.id] ?? 'low'
        const was = original?.[it.id] ?? 'low'
        return (
          <div key={it.id} className={cx('grid grid-cols-1 items-center gap-x-3 gap-y-1 rounded border px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_150px]', TONE[lv])}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold">
                <label htmlFor={`${idPrefix}-${it.id}`}>{it.name}</label>
                {amount(it.id) > 0 && <span className="text-[12px] font-normal tabular-nums text-muted">+{money(amount(it.id))}</span>}
                {original && was !== lv && <Badge tone="marker">was {RISK_LEVEL_LABEL[was].toLowerCase()}</Badge>}
              </div>
              <div className="text-[12px] text-muted">{it.levels[lv].label}</div>
            </div>
            {disabled || !onChange
              ? <span className="text-[12.5px] font-semibold sm:text-right">{RISK_LEVEL_LABEL[lv]}</span>
              : <Select id={`${idPrefix}-${it.id}`} aria-label={it.name} title={it.help} value={lv} onChange={(e) => onChange({ ...value, [it.id]: e.target.value as RiskLevel })}
                  options={RISK_LEVELS.map((k) => ({ value: k, label: RISK_LEVEL_LABEL[k] }))} />}
          </div>
        )
      })}
    </div>
  )
}

/** Rate table → risk allowances → tax, loaders, escalation → risk-based contingency (P80) → total. */
export function ParametricBuildUp({ r }: { r: ParametricResult }) {
  const row = (label: React.ReactNode, value: React.ReactNode, strong?: boolean) => (
    <tr className={cx(strong && 'border-t border-line')}><td className={cx('text-[12.5px]', strong && 'font-semibold')}>{label}</td><td className={cx('num text-[12.5px]', strong && 'font-semibold')}>{value}</td></tr>
  )
  const allowances = sum(r.riskLines.map((l) => l.unitCost))
  return (
    <table className="tbl [&_td]:py-1">
      <tbody>
        {row(<>Rate table <span className="text-faint">({r.rateLines.length} rows × {r.inputs.lengthFt.toLocaleString('en-US')} ft, {r.inputs.region})</span></>, money(r.rateDirect))}
        {row(<>+ Risk allowances <span className="text-faint">({r.riskPct}% most likely)</span></>, money(allowances))}
        {r.adjustmentLine ? row(<>+ Estimator adjustment <span className="text-faint">({r.adjustPct > 0 ? '+' : ''}{r.adjustPct}%)</span></>, money(r.adjustmentLine.unitCost)) : null}
        {row('= Direct cost', money(r.direct), true)}
        {row(<>+ Sales tax <span className="text-faint">({r.salesTax.pct}% on material)</span></>, money(r.tax))}
        {row(<>+ Loaders <span className="text-faint">({sum(r.loaders.map((l) => l.pct)).toFixed(1)}%)</span></>, money(r.loaderAmount))}
        {row(<>+ Escalation <span className="text-faint">({r.basisYear} → {r.inputs.midpointYear}, {r.escalationPct}%)</span></>, money(r.escalation))}
        {row('= Base estimate (most likely)', money(r.base), true)}
        {row(<>+ Risk-based contingency <span className="text-faint">(to P80, {r.contingencyPct}%)</span></>, money(r.contingency))}
        <tr className="border-t-2 border-ink/60"><td className="font-display text-[13.5px] font-bold">= Estimate at P80</td><td className="num font-display text-[13.5px] font-bold">{money(r.total)}</td></tr>
      </tbody>
    </table>
  )
}

/** The rate rows that priced the estimate (collapsible). */
export function RateRows({ r }: { r: ParametricResult }) {
  return (
    <details className="rounded border border-line px-3 py-2">
      <summary className="cursor-pointer text-[12.5px] font-semibold">Rate-table rows ({r.rateLines.length}) · {money(r.rateSpread.p10)}–{money(r.rateSpread.p90)} at the rows' P10–P90</summary>
      <div className="scroll-x mt-2">
        <table className="tbl">
          <thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit cost</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {r.rateLines.map((l) => <tr key={l.id}><td className="text-[12.5px]">{l.description}</td><td className="num">{l.qty.toLocaleString('en-US')}</td><td>{l.unit}</td><td className="num">{money(l.unitCost)}</td><td className="num">{money(l.qty * l.unitCost)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Headline at P80 with the Monte Carlo P10–P90 against the AACE Class 5 band. */
export function ParametricHeadline({ r, size = 'lg' }: { r: ParametricResult; size?: 'lg' | 'md' }) {
  return <QuickHeadline total={r.total} low={r.mc.p.P10} high={r.mc.p.P90} perUnit={r.perFoot} unit="ft" size={size} source="Monte Carlo" />
}

/** Full live result: headline, Monte Carlo (shown by default), build-up, rate rows. */
export function ParametricResultView({ r, compact }: { r: ParametricResult; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ParametricHeadline r={r} size={compact ? 'md' : 'lg'} />
      <div className="rounded-md border border-line p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2"><span className="eyebrow">Monte Carlo</span><Badge tone="info">{r.mc.iterations.toLocaleString('en-US')} draws</Badge><VerifyTag>Distributions — verify</VerifyTag></div>
        <MonteCarloView mc={r.mc} point={r.base} pointLabel="Base estimate (most likely)" note={<>Seeded draws (seed {r.mc.seed}): rate-table cost triangular on the rows' P10 / P50 / P90, and each risk item triangular on its min / most likely / max at the rating chosen, independent. The estimate is funded at P80; contingency is P80 less the most-likely base. Same inputs, same result.</>} />
      </div>
      <div><div className="eyebrow mb-1">How the number is built</div><ParametricBuildUp r={r} /></div>
      <RateRows r={r} />
    </div>
  )
}
