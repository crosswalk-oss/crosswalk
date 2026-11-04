// A Class 5 quick estimate as the requester and the estimating team see it: the request, inputs and site drivers,
// the factor-model pricing with every driver itemized, the rate-table cross-check, the generated BOE, Monte Carlo,
// the estimator's Adjust panel during review (reason from the override list), and the adjustment history.
// Older quick estimates priced from the historical cost table still render with their matched row.
import { useState } from 'react'
import type { AppState, Estimate, FactorInputs, Project, QuickEstimate, RiskLevel } from '@/core/types'
import { getState, mutate, personName, useMe, useStore } from '@/core/store'
import { estimateTotals } from '@/core/engine/estimates'
import { UNIT_LABEL } from '@/core/engine/quick'
import { DRIVER_INFO, factorInputsFromProject, levelOf, levelLabel, previewFactorAdjust, priceFactor, publishedModel } from '@/core/engine/factorModel'
import { cx, fmtDate, fmtDateTime, money, moneyDelta, pct, sum } from '@/core/util'
import { Badge, Button, Callout, ClassBadge, Field, KV, Modal, Panel, SegButtons, Select, StatusBadge, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { BoeDownload } from '../BoeDownload'
import { NumInput } from '../parts'
import { ASSET_LABEL, METHOD_LABEL, TERRAIN_LABEL, adjustmentHistory, applyAdjustment, bandLabel, canAdjust, isBanded, previewAdjust, returnedToRequester, reviewSlot, storedMatch, canRevise } from './lib'
import { BuildUp, MatchedRow, QuickBadge, QuickHeadline, type BuildUpData } from './parts'
import { QuickRequest } from './QuickForm'
import { BoeText, DriverTable, MonteCarloPanel, MonteCarloView, RateTableCompare, VerifyTag } from './factorParts'
import { ParametricBuildUp, ParametricHeadline, ParametricResultView, RateRows, RiskRatings } from './parametricParts'
import { previewParametric, type priceParametric } from '@/core/engine/parametric'

/** Build-up of a saved quick estimate (from what was stored when it was priced or adjusted). */
function savedBuildUp(s: AppState, e: Estimate): BuildUpData | undefined {
  const q = e.quick
  if (!q) return
  const t = estimateTotals(e)
  const row = s.historicalCosts.find((h) => h.id === q.historicalCostId)
  return { baseRate: q.baseRate, basis: q.basis.toUpperCase(), baseYear: row?.baseYear, qty: q.inputs.qty, unit: q.inputs.unit, district: q.inputs.district, regionFactor: q.regionFactor, escalationFactor: q.escalationFactor, midpointYear: q.inputs.midpointYear, adjustPct: q.adjustment?.pct, direct: t.lines, loaders: t.loaders, loaderPct: sum(e.loaders.map((l) => l.pct)), contingency: t.contingency, contingencyPct: e.contingency.pct, total: t.total }
}

export function QuickEstimateView({ estimate: e, project, onCopy, inbox }: { estimate: Estimate; project: Project; onCopy?: (src: Estimate) => void; inbox?: boolean }) {
  const s = useStore()
  const me = useMe()
  const [revise, setRevise] = useState(false)
  const q = e.quick
  if (!q) return <Callout tone="warn">This estimate has no quick estimate record.</Callout>
  const t = estimateTotals(e)
  const row = s.historicalCosts.find((h) => h.id === q.historicalCostId)
  const match = storedMatch(s, e)
  const b = savedBuildUp(s, e)!
  const wf = s.workflows.find((w) => w.id === e.workflowInstanceId)
  const rv = reviewSlot(s, e)
  const lastReturn = wf && wf.status !== 'running' && wf.status !== 'approved' ? [...wf.history].reverse().find((h) => h.action === 'return' || h.action === 'reject' || h.action === 'recall') : undefined
  const back = returnedToRequester(s, e)
  const revisable = canRevise(s, e) && (!!me.roles.includes('admin') || (back ? back.slot.assigneeIds.includes(me.id) : (wf?.startedById ?? e.createdById) === me.id))
  const adjustable = canAdjust(s, e, me.id)
  const hist = adjustmentHistory(s, e.id)
  const requestPanel = (
    <Panel title="Request" pad>
      <div className="flex flex-col gap-3">
        <div className="rounded border border-line bg-sunken/40 px-3 py-2 text-[13px]"><div className="eyebrow mb-0.5">What it is for</div>{q.requestNote || <span className="text-muted">Not stated</span>}</div>
        {e.parametric ? <KV cols={2} items={[
          ['Requested by', `${personName(s, wf?.startedById ?? e.createdById)} · ${fmtDate(e.createdAt.slice(0, 10))}`],
          ['Needed by', q.needBy ? <span className={cx(q.needBy < s.settings.asOf && e.status === 'in-review' && 'font-semibold text-bad')}>{fmtDate(q.needBy)}</span> : 'No date'],
          ['Length of pipe', `${e.parametric.inputs.lengthFt.toLocaleString('en-US')} ft`],
          ['Location', `${e.parametric.inputs.region} (×${(s.settings.estimating.regionFactors[e.parametric.inputs.region] ?? 1).toFixed(2)})`],
          ['Pipe and work', `${e.parametric.inputs.diameterIn}" ${ASSET_LABEL[e.parametric.inputs.assetType].toLowerCase()} · ${METHOD_LABEL[e.parametric.inputs.workMethod].toLowerCase()}`],
          ['Spend midpoint', String(e.parametric.inputs.midpointYear)],
          ['Priced at', `Rate table v${e.parametric.rateTableVersion} + risk ratings · P80`],
          ['Risks above low', String(Object.values(e.parametric.inputs.risks).filter((v) => v !== 'low').length)],
        ]} /> : <KV cols={2} items={[
          ['Requested by', `${personName(s, wf?.startedById ?? e.createdById)} · ${fmtDate(e.createdAt.slice(0, 10))}`],
          ['Needed by', q.needBy ? <span className={cx(q.needBy < s.settings.asOf && e.status === 'in-review' && 'font-semibold text-bad')}>{fmtDate(q.needBy)}</span> : 'No date'],
          ['Asset · method', `${ASSET_LABEL[q.inputs.assetType]} · ${METHOD_LABEL[q.inputs.workMethod]}`],
          ['Diameter band', isBanded(q.inputs.assetType) ? bandLabel(q.inputs.diameterBand) : 'Not banded'],
          ['Setting · region', `${TERRAIN_LABEL[q.inputs.terrain]} · ${q.inputs.district} (×${q.regionFactor.toFixed(2)})`],
          ['Quantity', `${q.inputs.qty.toLocaleString('en-US')} ${UNIT_LABEL[q.inputs.unit]}`],
          ['Spend midpoint', String(q.inputs.midpointYear)],
          ['Priced at', e.factor ? `Factor model v${e.factor.modelVersion}${q.basis !== 'p50' ? ` · ${q.basis.toUpperCase()}` : ''}` : `${q.basis.toUpperCase()} of history`],
        ]} />}
        {e.factor && 'site' in q.inputs && <DriverSummary inputs={q.inputs as FactorInputs} />}
      </div>
    </Panel>
  )
  return (
    <div className="flex flex-col gap-3">
      {!inbox && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-muted">v{e.version}</span>
              <h2 className="font-display text-[18px] font-bold leading-tight">{e.title}</h2>
              <QuickBadge /><ClassBadge cls={e.cls} size="lg" /><StatusBadge status={e.status} />
              {q.adjustment && (e.parametric?.adjustment ? <Badge tone="marker">Reviewed{e.parametric.adjustment.changed.length ? ` · ${e.parametric.adjustment.changed.length} rating${e.parametric.adjustment.changed.length > 1 ? 's' : ''} changed` : ''}{e.parametric.adjustment.pct ? ` · ${e.parametric.adjustment.pct > 0 ? '+' : ''}${e.parametric.adjustment.pct}%` : ''}</Badge> : <Badge tone="marker">Adjusted {q.adjustment.pct > 0 ? '+' : ''}{q.adjustment.pct}%</Badge>)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Requested by <b className="text-ink">{personName(s, wf?.startedById ?? e.createdById)}</b> · {fmtDate(e.createdAt.slice(0, 10))}</span>
              {e.approvedAt && <span>Approved by <b className="text-ink">{personName(s, e.approvedById)}</b> · {fmtDate(e.approvedAt.slice(0, 10))}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {revisable && <Button variant="marker" onClick={() => setRevise(true)}>Revise and resubmit</Button>}
            <BoeDownload get={() => getState().estimates.find((x) => x.id === e.id) ?? e} project={project} />
            {onCopy && (e.status === 'approved' || e.status === 'superseded') && <Button onClick={() => onCopy(e)}>New version from this</Button>}
          </div>
        </div>
      )}
      {!inbox && back && <Callout tone="warn" title="Returned by the estimating team">{back.event?.comment ? <>“{back.event.comment}” — {personName(s, back.event.actorId)}, {fmtDateTime(back.event.at)}. </> : null}{revisable ? 'Revise the inputs and resubmit, or submit it unchanged in the workflow panel below.' : `Waiting on ${back.slot.assigneeIds.map((id) => personName(s, id)).join(', ')} to revise and resubmit.`}</Callout>}
      {!inbox && e.status === 'in-review' && rv && !back && <Callout tone="info" title="With the estimating team">Waiting on {rv.slot.assigneeIds.map((id) => personName(s, id)).join(' or ')}{rv.slot.due ? ` · due ${fmtDate(rv.slot.due)}` : ''}. Any estimator can check {e.parametric ? 'the risk ratings and rate table' : 'the match'}, adjust with a reason and approve. {e.parametric ? 'The requester cannot change the number after sending it.' : ''}</Callout>}
      {!inbox && e.status === 'approved' && <Callout tone="good" title="Approved — estimate of record">Approved by {personName(s, e.approvedById)}{q.adjustment ? ` after a ${q.adjustment.pct > 0 ? '+' : ''}${q.adjustment.pct}% adjustment` : ' as requested'}. It becomes the planning budget at the Gate 1 decision. Mature it to Class 3 with a new line-item version.</Callout>}
      {!inbox && e.status === 'draft' && <Callout tone="warn" title={lastReturn?.action === 'recall' ? 'Recalled by the requester' : 'Returned by the estimating team'}>{lastReturn?.comment ? <>“{lastReturn.comment}” — {personName(s, lastReturn.actorId)}, {fmtDateTime(lastReturn.at)}. </> : null}Revise the inputs and resubmit.</Callout>}

      {e.parametric ? <ParametricDetail s={s} e={e} inbox={inbox} requestPanel={requestPanel} /> : e.factor ? <FactorDetail s={s} e={e} inbox={inbox} requestPanel={requestPanel} /> : <div className={cx('grid grid-cols-1 gap-3', !inbox && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]')}>
        <div className="flex min-w-0 flex-col gap-3">
          {inbox ? <QuickHeadline total={t.total} low={q.range.low} high={q.range.high} perUnit={q.inputs.qty ? t.total / q.inputs.qty : 0} unit={q.inputs.unit} size="md" /> : requestPanel}
          {inbox && <div className="rounded border border-line bg-sunken/40 px-3 py-2 text-[13px]"><div className="eyebrow mb-0.5">What it is for</div>{q.requestNote || <span className="text-muted">Not stated</span>}<div className="mt-1 text-[11.5px] text-muted">{ASSET_LABEL[q.inputs.assetType]} · {METHOD_LABEL[q.inputs.workMethod]}{isBanded(q.inputs.assetType) ? ` · ${bandLabel(q.inputs.diameterBand)}` : ''} · {q.inputs.qty.toLocaleString('en-US')} {UNIT_LABEL[q.inputs.unit]} · {TERRAIN_LABEL[q.inputs.terrain].toLowerCase()} · {q.inputs.district} · {q.inputs.midpointYear} midpoint{q.needBy ? ` · needed by ${fmtDate(q.needBy)}` : ''}</div></div>}
          {inbox && <MatchedRow s={s} row={row} match={match} inputs={q.inputs} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {!inbox && <Panel title="Estimate" subtitle={`${e.status === 'approved' ? 'As approved' : 'As priced'} from the historical cost table`}>
            <div className="flex flex-col gap-3">
              <QuickHeadline total={t.total} low={q.range.low} high={q.range.high} perUnit={q.inputs.qty ? t.total / q.inputs.qty : 0} unit={q.inputs.unit} size="md" />
              <BuildUp b={b} />
            </div>
          </Panel>}
          {!inbox && <MatchedRow s={s} row={row} match={match} inputs={q.inputs} />}
          {inbox && <details className="rounded border border-line px-3 py-2"><summary className="cursor-pointer text-[12.5px] font-semibold">Build-up</summary><div className="mt-2"><BuildUp b={b} /></div></details>}
        </div>
      </div>}

      {adjustable && (e.parametric ? <ParametricAdjustPanel s={s} e={e} /> : e.factor ? <FactorAdjustPanel s={s} e={e} /> : <AdjustPanel s={s} e={e} />)}
      {!adjustable && e.status === 'in-review' && inbox && <p className="text-[12px] text-muted">Only the estimating team can adjust this estimate.</p>}
      {(hist.length > 0 || q.adjustment) && <AdjustmentHistory s={s} e={e} />}
      {!inbox && e.workflowInstanceId && <WorkflowStatus instanceId={e.workflowInstanceId} compact={e.status !== 'in-review'} />}

      {revise && (
        <Modal open wide onClose={() => setRevise(false)} title={`Revise quick estimate v${e.version}`}>
          <QuickRequest reviseId={e.id} onCancel={() => setRevise(false)} onDone={() => setRevise(false)} />
        </Modal>
      )}
    </div>
  )
}

/** The site drivers a factor estimate was priced with, as short chips. */
function DriverSummary({ inputs }: { inputs: FactorInputs }) {
  const dv = { ...inputs.site, terrain: inputs.terrain }
  const keys = ['soil', 'crossings', 'permitComplexity', 'classLocation', 'hca', 'traffic', 'workHours', 'remoteness'] as const
  return (
    <div><div className="eyebrow mb-1">Site drivers</div>
      <div className="flex flex-wrap gap-1">{keys.map((k) => { const lv = levelOf(dv, k); const off = lv !== DRIVER_INFO[k].baseline; return <span key={k} className={cx('rounded border px-1.5 py-0.5 text-[11.5px]', off ? 'border-ink/40 text-ink' : 'border-line text-muted')}>{DRIVER_INFO[k].label}: <b>{k === 'crossings' ? inputs.site.crossings : levelLabel(k, lv)}</b></span> })}</div>
    </div>
  )
}

/** Saved factor-model pricing: headline, itemized drivers, rate-table check, BOE, Monte Carlo. */
function FactorDetail({ s, e, inbox, requestPanel }: { s: AppState; e: Estimate; inbox?: boolean; requestPanel: React.ReactNode }) {
  const q = e.quick!, fx = e.factor!
  const t = estimateTotals(e)
  const [mc, setMc] = useState(false)
  const live = mc ? previewFactorAdjust(s, e, fx.adjustment?.pct ?? 0, q.basis) : undefined
  const headline = <QuickHeadline total={t.total} low={fx.p10} high={fx.p90} perUnit={q.inputs.qty ? t.total / q.inputs.qty : 0} unit={q.inputs.unit} size="md" source="Model" />
  const drivers = <div><div className="eyebrow mb-1">Cost drivers · factor model v{fx.modelVersion}</div><DriverTable items={fx.items} baseline={fx.baseline} direct={t.lines} total={t.total} /></div>
  const build = (
    <table className="tbl [&_td]:py-1"><tbody>
      <tr><td className="text-[12.5px]">Direct cost</td><td className="num text-[12.5px]">{money(t.lines)}</td></tr>
      <tr><td className="text-[12.5px]">+ Sales tax <span className="text-faint">({e.salesTax?.pct ?? 0}%)</span></td><td className="num text-[12.5px]">{money(t.tax)}</td></tr>
      <tr><td className="text-[12.5px]">+ Loaders <span className="text-faint">({sum(e.loaders.map((l) => l.pct)).toFixed(1)}%)</span></td><td className="num text-[12.5px]">{money(t.loaders)}</td></tr>
      <tr><td className="text-[12.5px]">+ Contingency <span className="text-faint">({e.contingency.pct}% Class 5)</span></td><td className="num text-[12.5px]">{money(t.contingency)}</td></tr>
      <tr className="border-t-2 border-ink/60"><td className="font-display text-[13.5px] font-bold">= Total</td><td className="num font-display text-[13.5px] font-bold">{money(t.total)}</td></tr>
    </tbody></table>
  )
  const extras = (
    <>
      <RateTableCompare factor={t.total} rateTable={fx.rateTable} low={fx.p10} high={fx.p90} />
      <BoeText basis={e.basis} />
      <div className="flex flex-col gap-3 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="eyebrow">Monte Carlo</span><Button size="sm" onClick={() => setMc((v) => !v)}>{mc ? 'Hide' : 'Run Monte Carlo'}</Button></div>
        {mc && live ? <MonteCarloPanel r={live} iterations={s.settings.factorModel.iterations} /> : !mc ? <p className="text-[12px] text-muted">Simulate the total from the model's base-rate uncertainty and each driver off its baseline: histogram, S-curve and tornado.</p> : <p className="text-[12px] text-warn">The model version this estimate was priced on is no longer available.</p>}
      </div>
    </>
  )
  if (inbox) return (
    <div className="flex flex-col gap-3">
      {headline}
      <div className="rounded border border-line bg-sunken/40 px-3 py-2 text-[13px]"><div className="eyebrow mb-0.5">What it is for</div>{q.requestNote || <span className="text-muted">Not stated</span>}<div className="mt-1 text-[11.5px] text-muted">{ASSET_LABEL[q.inputs.assetType]} · {METHOD_LABEL[q.inputs.workMethod]}{isBanded(q.inputs.assetType) ? ` · ${bandLabel(q.inputs.diameterBand)}` : ''} · {q.inputs.qty.toLocaleString('en-US')} {UNIT_LABEL[q.inputs.unit]} · {TERRAIN_LABEL[q.inputs.terrain].toLowerCase()} · {q.inputs.district} · {q.inputs.midpointYear} midpoint{q.needBy ? ` · needed by ${fmtDate(q.needBy)}` : ''}</div>{'site' in q.inputs && <div className="mt-2"><DriverSummary inputs={q.inputs as FactorInputs} /></div>}</div>
      {drivers}
      <RateTableCompare factor={t.total} rateTable={fx.rateTable} low={fx.p10} high={fx.p90} />
      <details className="rounded border border-line px-3 py-2"><summary className="cursor-pointer text-[12.5px] font-semibold">Build-up and basis of estimate</summary><div className="mt-2 flex flex-col gap-3">{build}<BoeText basis={e.basis} /></div></details>
    </div>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col gap-3">{requestPanel}</div>
        <Panel className="min-w-0" title="Estimate" subtitle={`${e.status === 'approved' ? 'As approved' : 'As priced'} with the Class 5 factor model`}>
          <div className="flex flex-col gap-3">{headline}{drivers}{build}</div>
        </Panel>
      </div>
      {extras}
    </div>
  )
}

/** Estimating-team adjustment of a factor estimate: %, optional percentile basis, reason from the override list. */
function FactorAdjustPanel({ s, e }: { s: AppState; e: Estimate }) {
  const me = useMe()
  const q = e.quick!
  const reasons = s.settings.factorModel.overrideReasons
  const [pctAdj, setPct] = useState<number>(q.adjustment?.pct ?? 0)
  const [basis, setBasis] = useState<QuickEstimate['basis']>(q.basis)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const before = estimateTotals(e).total
  const r = previewAdjust(s, e, basis, pctAdj)
  const after = r ? Math.round(r.total) : before
  const changed = pctAdj !== (e.factor?.adjustment?.pct ?? q.adjustment?.pct ?? 0) || basis !== q.basis
  const ok = changed && !!reason
  const apply = () => {
    if (!ok) return
    mutate((d) => applyAdjustment(d, e.id, { pct: pctAdj, basis, reason, note: note.trim() || undefined }, me.id))
    toast(`Adjusted: ${money(before)} → ${money(after)}`)
    setReason(''); setNote('')
  }
  return (
    <Panel className="border-marker/70" title="Adjust (estimating team)" subtitle="Scale the model result and/or price it at another percentile of the model range. Pick the override reason; it is kept with the estimate, in its BOE and in the audit trail.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Priced at"><SegButtons value={basis} onChange={setBasis} options={[{ id: 'p10', label: 'P10' }, { id: 'p50', label: 'P50' }, { id: 'p90', label: 'P90' }]} /></Field>
            <Field label="Adjustment %" className="w-28"><NumInput id="adj-pct" value={pctAdj} onChange={(v) => setPct(Math.max(-90, Math.min(300, Math.round(v * 10) / 10)))} /></Field>
            <div className="flex flex-wrap gap-1 pb-0.5">{[-10, -5, 0, 5, 10, 15, 25].map((v) => <button key={v} type="button" onClick={() => setPct(v)} className={cx('rounded border px-1.5 py-0.5 text-[11.5px] tabular-nums', pctAdj === v ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{v > 0 ? '+' : ''}{v}%</button>)}</div>
          </div>
          <Field label="Override reason (required)"><Select id="adj-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} options={[{ value: '', label: 'Choose a reason…' }, ...reasons.map((x) => ({ value: x, label: x }))]} /></Field>
          <Field label="Note (optional)" hint="What about this project the drivers do not capture"><TextArea id="adj-note" className="min-h-[52px]" placeholder="e.g. Two HDD crossings under the flood-control channel." value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!ok} onClick={apply}>Apply adjustment</Button>
            {!changed && <span className="text-[12px] text-muted">Change the % or the percentile to adjust.</span>}
            {changed && !reason && <span className="text-[12px] text-warn">Choose an override reason to apply.</span>}
            <span className="text-[12px] text-muted">Then approve or return below.</span>
          </div>
        </div>
        <div className="rounded-md border border-line bg-sunken/40 p-3">
          <div className="eyebrow">Before → after</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2 font-display tabular-nums">
            <span className="text-[17px] text-muted line-through decoration-faint">{money(before)}</span>
            <span aria-hidden className="text-muted">→</span>
            <span className="text-[22px] font-bold">{money(after)}</span>
          </div>
          <div className={cx('text-[12.5px] font-semibold tabular-nums', after > before ? 'text-bad' : after < before ? 'text-good' : 'text-muted')}>{after === before ? 'No change' : `${moneyDelta(after - before)} (${after > before ? '+' : ''}${pct(after / before - 1, 1)})`}</div>
          {r && <div className="mt-2 text-[11.5px] text-muted">New range {money(r.low)} – {money(r.high)}</div>}
          <div className="mt-2"><VerifyTag>BOE updated — verify</VerifyTag></div>
        </div>
      </div>
    </Panel>
  )
}

function AdjustPanel({ s, e }: { s: AppState; e: Estimate }) {
  const me = useMe()
  const q = e.quick!
  const [pctAdj, setPct] = useState<number>(q.adjustment?.pct ?? 0)
  const [basis, setBasis] = useState<QuickEstimate['basis']>(q.basis)
  const [reason, setReason] = useState('')
  const before = estimateTotals(e).total
  const r = previewAdjust(s, e, basis, pctAdj)
  const after = r ? Math.round(r.total) : before
  const changed = pctAdj !== (q.adjustment?.pct ?? 0) || basis !== q.basis
  const apply = () => {
    if (!changed || !reason.trim()) return
    mutate((d) => applyAdjustment(d, e.id, { pct: pctAdj, basis, reason: reason.trim() }, me.id))
    toast(`Adjusted: ${money(before)} → ${money(after)}`)
    setReason('')
  }
  return (
    <Panel className="border-marker/70" title="Adjust (estimating team)" subtitle="Scale the historical figure and/or change the percentile it is priced at. A reason is required and is kept with the estimate and in the audit trail.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Percentile basis"><SegButtons value={basis} onChange={setBasis} options={[{ id: 'p10', label: 'P10' }, { id: 'p50', label: 'P50' }, { id: 'p90', label: 'P90' }]} /></Field>
            <Field label="Adjustment %" className="w-28"><NumInput id="adj-pct" value={pctAdj} onChange={(v) => setPct(Math.max(-90, Math.min(300, Math.round(v * 10) / 10)))} /></Field>
            <div className="flex flex-wrap gap-1 pb-0.5">{[-10, -5, 0, 5, 10, 15, 25].map((v) => <button key={v} type="button" onClick={() => setPct(v)} className={cx('rounded border px-1.5 py-0.5 text-[11.5px] tabular-nums', pctAdj === v ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{v > 0 ? '+' : ''}{v}%</button>)}</div>
          </div>
          <Field label="Reason (required)" hint="What about this project is not represented in the historical population?">
            <TextArea id="adj-reason" className="min-h-[60px]" placeholder="e.g. Two HDD crossings under the flood-control channel are not represented in the history." value={reason} onChange={(ev) => setReason(ev.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!changed || !reason.trim()} onClick={apply}>Apply adjustment</Button>
            {!changed && <span className="text-[12px] text-muted">Change the % or the basis to adjust.</span>}
            {changed && !reason.trim() && <span className="text-[12px] text-warn">Add a reason to apply.</span>}
            <span className="text-[12px] text-muted">Then approve or return below.</span>
          </div>
        </div>
        <div className="rounded-md border border-line bg-sunken/40 p-3">
          <div className="eyebrow">Before → after</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2 font-display tabular-nums">
            <span className="text-[17px] text-muted line-through decoration-faint">{money(before)}</span>
            <span aria-hidden className="text-muted">→</span>
            <span className="text-[22px] font-bold">{money(after)}</span>
          </div>
          <div className={cx('text-[12.5px] font-semibold tabular-nums', after > before ? 'text-bad' : after < before ? 'text-good' : 'text-muted')}>{after === before ? 'No change' : `${moneyDelta(after - before)} (${after > before ? '+' : ''}${pct(after / before - 1, 1)})`}</div>
          {r && <div className="mt-2 text-[11.5px] text-muted">New range {money(r.low)} – {money(r.high)} · {basis.toUpperCase()} rate ${Math.round(r.baseRate).toLocaleString('en-US')}/{q.inputs.unit}</div>}
        </div>
      </div>
    </Panel>
  )
}

function AdjustmentHistory({ s, e }: { s: AppState; e: Estimate }) {
  const hist = adjustmentHistory(s, e.id)
  const q = e.quick!
  const rows = hist.length ? hist : q.adjustment ? [{ at: q.adjustment.at, byId: q.adjustment.byId, pct: q.adjustment.pct, basis: q.basis.toUpperCase(), from: q.adjustment.fromTotal, to: q.adjustment.toTotal, reason: q.adjustment.reason, raw: '' }] : []
  return (
    <Panel pad={false} title="Adjustment history" subtitle="Every estimator adjustment, oldest first">
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>When</th><th>By</th><th className="num">Adjustment</th><th>Basis</th><th className="num">Before → after</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((h, k) => (
              <tr key={k}>
                <td className="whitespace-nowrap text-[12px]">{fmtDateTime(h.at)}</td>
                <td className="whitespace-nowrap text-[12.5px]">{personName(s, h.byId)}</td>
                <td className="num font-semibold">{h.pct != null ? `${h.pct > 0 ? '+' : ''}${h.pct}%` : '—'}</td>
                <td>{h.basis ?? '—'}</td>
                <td className="num whitespace-nowrap text-[12.5px]">{h.from != null && h.to != null ? <>{money(h.from)} → <b>{money(h.to)}</b></> : '—'}</td>
                <td className="min-w-[220px] text-[12.5px]">{h.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/** Inbox record summary for a quick estimate task (the inbox renders the approve / return controls). */
export function QuickReviewSummary({ estimateId }: { estimateId: string }) {
  const e = useStore((s) => s.estimates.find((x) => x.id === estimateId))
  const p = useStore((s) => s.projects.find((x) => x.id === e?.projectId))
  if (!e || !p) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2"><QuickBadge /><span className="text-[12px] text-muted">v{e.version} · {e.title}</span><StatusBadge status={e.status} /></div>
      <QuickEstimateView estimate={e} project={p} inbox />
    </div>
  )
}

/** Saved parametric pricing (repriced live from the stored inputs so the Monte Carlo charts show): ratings, result, BOE, model check. */
function ParametricDetail({ s, e, inbox, requestPanel }: { s: AppState; e: Estimate; inbox?: boolean; requestPanel: React.ReactNode }) {
  const par = e.parametric!
  const r = previewParametric(s, e, par.inputs.risks, par.adjustment?.pct ?? 0)
  const p = s.projects.find((x) => x.id === e.projectId)
  const model = publishedModel(s)
  const check = model && p ? priceFactor(s, model, factorInputsFromProject(s, p)) : undefined
  const modelCheck = check?.base ? (
    <div className="rounded-md border border-line px-3 py-2 text-[12.5px]">
      <span className="eyebrow">Model check (estimating team)</span>
      <div className="mt-0.5">Class 5 factor model v{model!.version} on the project's recorded drivers: <b className="tabular-nums">{money(check.total)}</b> (P10–P90 {money(check.p10)}–{money(check.p90)}), {check.total >= estimateTotals(e).total ? '+' : '−'}{pct(Math.abs(check.total / estimateTotals(e).total - 1))} from this estimate.</div>
    </div>
  ) : null
  if (!r) return <Callout tone="warn" title="Cannot reprice">The rate table no longer has rows for this pipe and work method. The saved total is {money(estimateTotals(e).total)}.</Callout>
  const ratings = <div><div className="eyebrow mb-1">Risk ratings{par.adjustment?.changed.length ? ' (estimator changes marked)' : ''}</div><RiskRatings s={s} value={par.inputs.risks} result={r} disabled original={par.requestedRisks} /></div>
  if (inbox) return (
    <div className="flex flex-col gap-3">
      <ParametricHeadline r={r} size="md" />
      <div className="rounded border border-line bg-sunken/40 px-3 py-2 text-[13px]"><div className="eyebrow mb-0.5">What it is for</div>{e.quick?.requestNote || <span className="text-muted">Not stated</span>}<div className="mt-1 text-[11.5px] text-muted">{par.inputs.lengthFt.toLocaleString('en-US')} ft · {par.inputs.diameterIn}" {ASSET_LABEL[par.inputs.assetType].toLowerCase()} · {METHOD_LABEL[par.inputs.workMethod].toLowerCase()} · {par.inputs.region} · {par.inputs.midpointYear} midpoint{e.quick?.needBy ? ` · needed by ${fmtDate(e.quick.needBy)}` : ''}</div></div>
      {ratings}
      <details className="rounded border border-line px-3 py-2"><summary className="cursor-pointer text-[12.5px] font-semibold">Build-up, Monte Carlo and basis of estimate</summary><div className="mt-2 flex flex-col gap-3"><ParametricResultView r={r} compact />{modelCheck}<BoeText basis={e.basis} /></div></details>
    </div>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col gap-3">{requestPanel}<Panel title="Risk ratings">{ratings}</Panel></div>
        <Panel className="min-w-0" title="Estimate" subtitle={`${e.status === 'approved' ? 'As approved' : 'As priced'} from the rate table and risk ratings, funded at P80`}>
          <div className="flex flex-col gap-3"><ParametricHeadline r={r} size="md" /><ParametricBuildUp r={r} /><RateRows r={r} /></div>
        </Panel>
      </div>
      <Panel title="Monte Carlo" subtitle={`${r.mc.iterations.toLocaleString('en-US')} seeded draws of the rate-table cost and each rated risk`}>
        <ParametricMonteCarlo r={r} />
      </Panel>
      {modelCheck}
      <BoeText basis={e.basis} />
    </div>
  )
}

/** The Monte Carlo of a saved parametric estimate. */
function ParametricMonteCarlo({ r }: { r: NonNullable<ReturnType<typeof priceParametric>> }) {
  return <MonteCarloView mc={r.mc} point={r.base} pointLabel="Base estimate (most likely)" note={<>Rate-table cost triangular on the rows' P10 / P50 / P90; each risk item triangular on its min / most likely / max at its rating, independent. Funded at P80 ({money(r.mc.p.P80)}); contingency is P80 less the most-likely base.</>} />
}

/** Estimating-team review of a parametric request: re-rate any risk item and/or apply a ± %, with a reason. */
function ParametricAdjustPanel({ s, e }: { s: AppState; e: Estimate }) {
  const me = useMe()
  const par = e.parametric!
  const reasons = s.settings.factorModel?.overrideReasons ?? []
  const [risks, setRisks] = useState<Record<string, RiskLevel>>({ ...par.inputs.risks })
  const [pctAdj, setPct] = useState<number>(par.adjustment?.pct ?? 0)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const before = estimateTotals(e).total
  const r = previewParametric(s, e, risks, pctAdj)
  const after = r ? r.total : before
  const changedRisks = Object.keys(risks).filter((k) => risks[k] !== par.inputs.risks[k])
  const changed = changedRisks.length > 0 || pctAdj !== (par.adjustment?.pct ?? 0)
  const ok = changed && !!reason
  const apply = () => {
    if (!ok) return
    mutate((d) => applyAdjustment(d, e.id, { pct: pctAdj, basis: 'p50', reason, note: note.trim() || undefined, risks }, me.id))
    toast(`Adjusted: ${money(before)} → ${money(after)}`)
    setReason(''); setNote('')
  }
  return (
    <Panel className="border-marker/70" title="Review and adjust (estimating team)" subtitle="Change any risk rating and/or apply a ± % to direct cost. The Monte Carlo re-runs; pick a reason. Kept with the estimate, in its BOE and in the audit trail.">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <RiskRatings s={s} value={risks} onChange={setRisks} result={r} original={par.requestedRisks ?? par.inputs.risks} idPrefix="adj-risk" />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Adjustment % of direct" className="w-36"><NumInput id="adj-pct" value={pctAdj} onChange={(v) => setPct(Math.max(-50, Math.min(100, Math.round(v * 10) / 10)))} /></Field>
            <div className="flex flex-wrap gap-1 pb-0.5">{[-10, -5, 0, 5, 10, 15].map((v) => <button key={v} type="button" onClick={() => setPct(v)} className={cx('rounded border px-1.5 py-0.5 text-[11.5px] tabular-nums', pctAdj === v ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{v > 0 ? '+' : ''}{v}%</button>)}</div>
          </div>
          <Field label="Reason (required)">{reasons.length ? <Select id="adj-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} options={[{ value: '', label: 'Choose a reason…' }, ...reasons.map((x) => ({ value: x, label: x }))]} /> : <TextArea id="adj-reason" value={reason} onChange={(ev) => setReason(ev.target.value)} />}</Field>
          <Field label="Note (optional)"><TextArea id="adj-note" className="min-h-[52px]" placeholder="e.g. Geotech borings found rock along the first 2,000 ft." value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!ok} onClick={apply}>Apply</Button>
            {!changed && <span className="text-[12px] text-muted">Change a rating or the % to adjust.</span>}
            {changed && !reason && <span className="text-[12px] text-warn">Choose a reason to apply.</span>}
            <span className="text-[12px] text-muted">Then approve or return below.</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken/40 p-3 sm:max-w-sm">
          <div className="eyebrow">Before → after (P80)</div>
          <div className="flex flex-wrap items-baseline gap-2 font-display tabular-nums">
            <span className="text-[17px] text-muted line-through decoration-faint">{money(before)}</span><span aria-hidden className="text-muted">→</span><span className="text-[22px] font-bold">{money(after)}</span>
          </div>
          <div className={cx('text-[12.5px] font-semibold tabular-nums', after > before ? 'text-bad' : after < before ? 'text-good' : 'text-muted')}>{after === before ? 'No change' : `${moneyDelta(after - before)} (${after > before ? '+' : ''}${pct(after / before - 1, 1)})`}</div>
          {r && <div className="text-[11.5px] text-muted">New P10–P90 {money(r.mc.p.P10)} – {money(r.mc.p.P90)}</div>}
          {changedRisks.length > 0 && <div className="text-[11.5px] text-muted">{changedRisks.length} rating{changedRisks.length > 1 ? 's' : ''} changed</div>}
          <VerifyTag>BOE updated — verify</VerifyTag>
        </div>
      </div>
    </Panel>
  )
}
