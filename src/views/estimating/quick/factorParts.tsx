// Class 5 factor model — presentational pieces shared by the quick estimate screens and the model admin:
// driver inputs, the itemized driver table, the build-up, the rate-table comparison, the BOE text and Monte Carlo.
import { useMemo, useState } from 'react'
import type { BasisOfEstimate, DriverKey, FactorInputs, FactorItem, PermitComplexity, Remoteness, SiteDrivers, SoilClass, TrafficLevel, WorkHours } from '@/core/types'
import { DRIVER_INFO, monteCarloFactor, type FactorResult } from '@/core/engine/factorModel'
import { cx, money, moneyDelta, pct } from '@/core/util'
import { Badge, Button, Checkbox, Field, Select } from '@/ui/kit'
import { Histogram, LineChart } from '@/ui/charts'
import { NumInput } from '../parts'

export const KIND_TONE: Record<string, 'info' | 'warn' | 'neutral' | 'ink' | 'marker'> = { physical: 'info', legal: 'warn', logistical: 'neutral', size: 'ink', region: 'ink', escalation: 'ink', adjustment: 'marker' }
export const KIND_LABEL: Record<string, string> = { physical: 'Physical', legal: 'Legal', logistical: 'Logistical', size: 'Size', region: 'Region', escalation: 'Escalation', adjustment: 'Estimator' }

/** Small "verify" tag for generated wording a human must check (AGENT_RULES 28). */
export function VerifyTag({ children = 'Draft wording — verify' }: { children?: React.ReactNode }) {
  return <Badge tone="marker" title="Generated from the pricing. An estimator must check this text before it is relied on.">{children}</Badge>
}

const opts = (k: DriverKey) => DRIVER_INFO[k].levels.map((l) => ({ value: l.value, label: l.label }))

/** The site drivers the factor model reads. Highlights values that differ from the project record. */
export function DriverInputs({ value, onChange, fromProject, idPrefix = 'drv', disabled }: { value: FactorInputs; onChange: (v: FactorInputs) => void; fromProject?: FactorInputs; idPrefix?: string; disabled?: boolean }) {
  const site = value.site
  const set = (patch: Partial<SiteDrivers>) => onChange({ ...value, site: { ...site, ...patch } })
  const diff = (k: keyof SiteDrivers) => !!fromProject && fromProject.site[k] !== site[k]
  const lab = (k: keyof SiteDrivers, text: string) => <span className="inline-flex items-center gap-1.5">{text}{diff(k) && <span className="h-1.5 w-1.5 rounded-full bg-marker" title="Differs from the project record" />}</span>
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={lab('soil', 'Soil / rock')}><Select disabled={disabled} id={`${idPrefix}-soil`} value={site.soil} onChange={(e) => set({ soil: e.target.value as SoilClass })} options={opts('soil')} /></Field>
      <Field label={lab('crossings', 'Road, rail & water crossings')}><NumInput disabled={disabled} id={`${idPrefix}-cross`} value={site.crossings} min={0} onChange={(v) => set({ crossings: Math.max(0, Math.round(v)) })} /></Field>
      <Field label={lab('permitComplexity', 'Permit complexity')}><Select disabled={disabled} id={`${idPrefix}-permit`} value={site.permitComplexity} onChange={(e) => set({ permitComplexity: e.target.value as PermitComplexity })} options={opts('permitComplexity')} /></Field>
      <Field label={lab('classLocation', 'Class location')}><Select disabled={disabled} id={`${idPrefix}-class`} value={String(site.classLocation)} onChange={(e) => set({ classLocation: Number(e.target.value) as SiteDrivers['classLocation'] })} options={opts('classLocation')} /></Field>
      <Field label={lab('traffic', 'Traffic')}><Select disabled={disabled} id={`${idPrefix}-traffic`} value={site.traffic} onChange={(e) => set({ traffic: e.target.value as TrafficLevel })} options={opts('traffic')} /></Field>
      <Field label={lab('workHours', 'Work-hour restrictions')}><Select disabled={disabled} id={`${idPrefix}-hours`} value={site.workHours} onChange={(e) => set({ workHours: e.target.value as WorkHours })} options={opts('workHours')} /></Field>
      <Field label={lab('remoteness', 'Remoteness / access')}><Select disabled={disabled} id={`${idPrefix}-remote`} value={site.remoteness} onChange={(e) => set({ remoteness: e.target.value as Remoteness })} options={opts('remoteness')} /></Field>
      <Field label={lab('hca', 'High consequence area')}><div className="flex h-[34px] items-center"><Checkbox disabled={disabled} id={`${idPrefix}-hca`} checked={site.hca} onChange={(v) => set({ hca: v })} label="Pipe is in an HCA" /></div></Field>
    </div>
  )
}

/** Itemized drivers: level, effective multiplier, weight and the $ each one adds to direct cost and to the total. */
export function DriverTable({ items, baseline, direct, total }: { items: FactorItem[]; baseline: number; direct: number; total: number }) {
  const k = direct ? total / direct : 1 // markups (tax, loaders, contingency) are proportional to direct cost
  const [all, setAll] = useState(false)
  const shown = all ? items : items.filter((x) => Math.abs(x.multiplier - 1) > 1e-9 || x.kind === 'region' || x.kind === 'escalation')
  const hidden = items.length - shown.length
  return (
    <div className="min-w-0">
      <div className="scroll-x">
        <table className="tbl [&_td]:py-1.5">
          <thead><tr><th>Driver</th><th>Level</th><th className="num">×</th><th className="num">Direct $</th><th className="num">All-in $</th></tr></thead>
          <tbody>
            <tr><td className="text-[12.5px] font-semibold">Base rate × quantity</td><td className="text-[12px] text-muted">Before drivers</td><td className="num text-[12px]">—</td><td className="num text-[12.5px] font-semibold">{money(baseline)}</td><td className="num text-[12.5px] text-muted">{money(baseline * k)}</td></tr>
            {shown.map((x) => (
              <tr key={x.id}>
                <td className="min-w-[150px] text-[12.5px]"><div className="flex flex-wrap items-center gap-1.5">{x.label}<Badge tone={KIND_TONE[x.kind]}>{KIND_LABEL[x.kind]}</Badge></div>{x.weight != null && x.weight < 1 && <div className="text-[11px] text-faint">weight {x.weight.toFixed(2)}</div>}</td>
                <td className="min-w-[110px] text-[12px] text-muted">{x.level}</td>
                <td className="num text-[12px]">{x.multiplier.toFixed(3)}</td>
                <td className={cx('num text-[12.5px]', x.effect > 0 ? 'text-bad' : x.effect < 0 ? 'text-good' : 'text-faint')}>{x.effect ? moneyDelta(x.effect) : '—'}</td>
                <td className={cx('num text-[12.5px]', x.effect > 0 ? 'text-bad' : x.effect < 0 ? 'text-good' : 'text-faint')}>{x.effect ? moneyDelta(x.effect * k) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-line"><td className="text-[12.5px] font-semibold" colSpan={3}>= Direct cost</td><td className="num text-[12.5px] font-semibold">{money(direct)}</td><td className="num text-[12.5px] font-semibold">{money(total)}</td></tr>
          </tbody>
        </table>
      </div>
      {hidden > 0 && <button className="mt-1 text-[12px] font-semibold text-link" onClick={() => setAll(true)}>Show {hidden} driver{hidden > 1 ? 's' : ''} at baseline (no effect)</button>}
      {all && <button className="mt-1 text-[12px] font-semibold text-link" onClick={() => setAll(false)}>Hide drivers at baseline</button>}
      <p className="mt-1 text-[11.5px] text-muted">Each driver's share of the change from the base is attributed by the log of its multiplier, so the shares add up exactly and do not depend on the order the factors are applied in. All-in includes sales tax, loaders and contingency.</p>
    </div>
  )
}

export interface FactorBuild { direct: number; tax: number; taxPct: number; loaders: number; loaderPct: number; contingency: number; contingencyPct: number; total: number }

/** direct → + sales tax → + loaders → + contingency = total. */
export function FactorBuildUp({ b }: { b: FactorBuild }) {
  const row = (label: React.ReactNode, value: React.ReactNode, strong?: boolean) => <tr className={cx(strong && 'border-t border-line')}><td className={cx('text-[12.5px]', strong && 'font-semibold')}>{label}</td><td className={cx('num text-[12.5px]', strong && 'font-semibold')}>{value}</td></tr>
  return (
    <table className="tbl [&_td]:py-1">
      <tbody>
        {row('Direct cost (after drivers)', money(b.direct))}
        {row(<>+ Sales tax <span className="text-faint">({b.taxPct}% on taxable material)</span></>, money(b.tax))}
        {row(<>+ Loaders <span className="text-faint">({b.loaderPct.toFixed(1)}%)</span></>, money(b.loaders))}
        {row(<>+ Contingency <span className="text-faint">({b.contingencyPct}% Class 5)</span></>, money(b.contingency))}
        <tr className="border-t-2 border-ink/60"><td className="font-display text-[13.5px] font-bold">= Total</td><td className="num font-display text-[13.5px] font-bold">{money(b.total)}</td></tr>
      </tbody>
    </table>
  )
}

export const buildOf = (r: FactorResult): FactorBuild => ({ direct: r.direct, tax: r.tax, taxPct: r.salesTax.pct, loaders: r.loaders, loaderPct: r.loaderPct, contingency: r.contingency, contingencyPct: r.contingencyPct, total: r.total })

/** Factor model vs the Class 5 rate-table (parametric) estimate for the same project. */
export function RateTableCompare({ factor, rateTable, low, high }: { factor: number; rateTable?: number; low: number; high: number }) {
  if (!rateTable) return <div className="rounded-md border border-line px-3 py-2 text-[12.5px] text-muted"><span className="eyebrow mr-2">Rate-table check</span>No rate-table rows for this asset and method, or no project yet.</div>
  const d = factor / rateTable - 1
  const inside = rateTable >= low && rateTable <= high
  return (
    <div className={cx('rounded-md border px-3 py-2.5', inside ? 'border-line' : 'border-warn/50 bg-warn/5')}>
      <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">Rate-table check</span><Badge tone={inside ? 'good' : 'warn'}>{inside ? 'Inside the model range' : 'Outside the model range'}</Badge></div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Factor model</div><div className="font-semibold tabular-nums">{money(factor)}</div></div>
        <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Class 5 rate table</div><div className="font-semibold tabular-nums">{money(rateTable)}</div></div>
        <div><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Difference</div><div className={cx('font-semibold tabular-nums', Math.abs(d) > 0.25 ? 'text-warn' : 'text-ink')}>{d >= 0 ? '+' : ''}{pct(d)}</div></div>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">{inside ? 'The parametric estimate priced from the rate table agrees within the model\'s P10–P90.' : 'The two methods disagree by more than the model range: check the drivers, the scope quantities, or whether the rate table reflects the site conditions.'}</p>
    </div>
  )
}

/** Generated basis-of-estimate text, flagged for human verification. */
export function BoeText({ basis, title = 'Basis of estimate' }: { basis: BasisOfEstimate; title?: string }) {
  return (
    <div className="rounded-md border border-marker/60 bg-marker/5 px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">{title}</span><VerifyTag /></div>
      <p className="mt-1.5"><b>Scope basis.</b> {basis.scopeBasis}</p>
      <div className="mt-1"><b>Assumptions.</b><ul className="ml-4 list-disc">{basis.assumptions.map((a, k) => <li key={k}>{a}</li>)}</ul></div>
      <p className="mt-1"><b>Exclusions.</b> {basis.exclusions.join('; ')}.</p>
      <p className="mt-1"><b>Contingency.</b> {basis.contingencyRationale}</p>
      <p className="mt-1"><b>Class.</b> {basis.classJustification}</p>
      <p className="mt-1.5 text-[11.5px] text-muted">Generated from the pricing above. An estimator checks and edits this wording before the estimate is used.</p>
    </div>
  )
}

/** Monte Carlo of a priced estimate: histogram with percentiles, S-curve, tornado of each uncertainty's contribution. */
export function MonteCarloPanel({ r, iterations = 5000, seed = 11 }: { r: Pick<FactorResult, 'total' | 'parts'>; iterations?: number; seed?: number }) {
  const mc = useMemo(() => monteCarloFactor(r, iterations, seed), [r, iterations, seed])
  const lo = Math.min(...mc.tornado.map((t) => t.low)), hi = Math.max(...mc.tornado.map((t) => t.high))
  const x = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(['P10', 'P50', 'P80', 'P90'] as const).map((k) => <div key={k} className="rounded border border-line px-2.5 py-1.5"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className="font-display text-[16px] font-bold tabular-nums">{money(mc.p[k])}</div></div>)}
        <div className="rounded border border-line px-2.5 py-1.5"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Mean</div><div className="font-display text-[16px] font-bold tabular-nums">{money(mc.mean)}</div></div>
      </div>
      <div>
        <div className="eyebrow mb-1">Distribution of total cost · {mc.iterations.toLocaleString('en-US')} draws</div>
        <Histogram bins={mc.histogram} markers={[{ x: mc.p.P10, label: 'P10' }, { x: mc.p.P50, label: 'P50' }, { x: mc.p.P80, label: 'P80', color: 'rgb(var(--warn))' }, { x: mc.p.P90, label: 'P90' }]} />
      </div>
      <div>
        <div className="eyebrow mb-1">S-curve · cost at each confidence level</div>
        <LineChart labels={mc.scurve.map((p) => `${p.pct}%`)} series={[{ name: 'Total cost', values: mc.scurve.map((p) => p.value), area: true }]} height={200} yMin={mc.scurve[0].value} />
      </div>
      <div>
        <div className="eyebrow mb-1">Tornado · P10–P90 swing from each source of uncertainty alone</div>
        <div className="flex flex-col gap-1.5">
          {mc.tornado.map((t) => (
            <div key={t.id} className="grid grid-cols-1 items-center gap-x-2 gap-y-0.5 text-[12px] sm:grid-cols-[minmax(0,200px)_1fr_auto]">
              <span className="truncate" title={t.label}>{t.label}</span>
              <span className="relative h-3.5 rounded-sm bg-sunken">
                <span className="absolute top-0 h-3.5 rounded-l-sm bg-good/60" style={{ left: x(t.low), width: `calc(${x(r.total)} - ${x(t.low)})` }} />
                <span className="absolute top-0 h-3.5 rounded-r-sm bg-bad/60" style={{ left: x(r.total), width: `calc(${x(t.high)} - ${x(r.total)})` }} />
                <span className="absolute -top-0.5 h-[18px] w-0.5 bg-ink" style={{ left: x(r.total) }} />
              </span>
              <span className="tabular-nums text-muted">{money(t.low)}–{money(t.high)} · <b className="text-ink">{pct(t.share)}</b> of variance</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11.5px] text-muted">Seeded draws (seed {mc.seed}) of the model's base-rate uncertainty and the uncertainty of each driver off its baseline, lognormal and independent, centred on the estimate. Same inputs, same result.</p>
    </div>
  )
}

/** Button that opens the Monte Carlo panel inline. */
export function MonteCarloToggle({ r, iterations }: { r: Pick<FactorResult, 'total' | 'parts'>; iterations?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div><Button size="sm" onClick={() => setOpen((v) => !v)}>{open ? 'Hide Monte Carlo' : 'Run Monte Carlo'}</Button></div>
      {open && <MonteCarloPanel r={r} iterations={iterations} />}
    </div>
  )
}
