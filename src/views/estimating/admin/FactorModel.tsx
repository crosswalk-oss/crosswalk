// Estimating → Administration → Factor model: the versioned Class 5 factor model. The estimating team edits a draft
// (driver weights, level multipliers, uncertainty, base rates, size scale), runs the backtest against fictional closed
// projects, compares it with the published version and submits it for approval; the estimating lead's approval publishes
// it and retires the prior version. Everyone else sees it read-only.
import { useMemo, useState } from 'react'
import type { AppState, FactorModel, FactorModelSettings, ModelFactor } from '@/core/types'
import { mutate, personName, useMe } from '@/core/store'
import {
  DRIVER_INFO, backtest, diffModels, discardDraft, factorInputsFromProject, gateCheck, modelsByVersion, newDraft, openDraft, priceFactor, publishedModel, saveDraft, validateModel,
  type BacktestResult,
} from '@/core/engine/factorModel'
import { returnedForRevision, submitBlockers, submitFactorModel, withdrawFactorModel } from '@/core/engine/factorWorkflow'
import { cx, fmtDate, fmtDateTime, money, pct } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Panel, StatusBadge, Tabs, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { NumInput } from '../parts'
import { ASSET_LABEL, METHOD_LABEL, bandLabel } from '../quick/lib'
import { KIND_LABEL, KIND_TONE } from '../quick/factorParts'
import { cellInp, useDraft } from './shared'

type View = 'factors' | 'rates' | 'backtest' | 'compare' | 'history' | 'settings'
const statusTone = (st: FactorModel['status']) => (st === 'published' ? 'good' : st === 'draft' ? 'marker' : st === 'in-review' ? 'info' : 'neutral')

export function FactorModelAdmin({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const me = useMe()
  const pub = publishedModel(s)
  const draft = openDraft(s)
  const [which, setWhich] = useState<'draft' | 'published'>(draft ? 'draft' : 'published')
  const shown = (which === 'draft' && draft) || pub || draft
  const start = () => {
    let v = 0
    mutate((d) => { v = newDraft(d, me.id)?.version ?? 0 })
    if (v) { setWhich('draft'); toast(`Draft v${v} started from v${pub?.version}`) }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-surface px-4 py-2.5 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5">Published {pub ? <><Badge tone="good">v{pub.version}</Badge><span className="text-muted">approved {fmtDate(pub.approvedAt?.slice(0, 10))} by {personName(s, pub.approvedById)}</span></> : <Badge tone="bad">none</Badge>}</span>
        <span className="inline-flex items-center gap-1.5">Draft {draft ? <><Badge tone={statusTone(draft.status)}>v{draft.version} · {draft.status}</Badge><span className="text-muted">{personName(s, draft.createdById)}</span></> : <span className="text-muted">none open</span>}</span>
        <span className="text-muted">Gate: MAPE ≤ {s.settings.factorModel.gate.maxMape}% · |bias| ≤ {s.settings.factorModel.gate.maxAbsBias}% · coverage {s.settings.factorModel.gate.minCoverage}–{s.settings.factorModel.gate.maxCoverage}%</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {draft && pub && <span className="inline-flex rounded border border-line bg-sunken p-0.5">{(['draft', 'published'] as const).map((w) => <button key={w} onClick={() => setWhich(w)} className={cx('rounded-sm px-2.5 py-1 text-xs font-semibold', which === w ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>{w === 'draft' ? `Draft v${draft.version}` : `Published v${pub.version}`}</button>)}</span>}
          {canEdit && !draft && <Button size="sm" variant="primary" onClick={start}>Start a new draft from v{pub?.version}</Button>}
        </span>
      </div>
      <Callout tone="info" title="How the factor model prices a Class 5 estimate">
        Direct cost = base $/unit × quantity × size scale × each driver's multiplier (blended toward 1 by its weight) × region × escalation; sales tax, loaders and contingency come from the estimating tables. Drivers are physical, legal or logistical conditions only — never community demographics or income. The range is lognormal from the base-rate cv and the cv of each driver that is off its baseline.
      </Callout>
      {shown ? <ModelWorkspace key={shown.id} s={s} model={shown} pub={pub} canEdit={canEdit} /> : <Callout tone="warn">No factor model yet.</Callout>}
    </div>
  )
}

function ModelWorkspace({ s, model, pub, canEdit }: { s: AppState; model: FactorModel; pub?: FactorModel; canEdit: boolean }) {
  const me = useMe()
  const wc = useDraft<FactorModel>(model)
  const m = wc.draft
  const editable = canEdit && model.status === 'draft'
  const [view, setView] = useState<View>('factors')
  const [bt, setBt] = useState<{ result: BacktestResult; dirty: boolean } | null>(null)
  const [note, setNote] = useState('')
  const blockers = useMemo(() => (model.status === 'draft' ? submitBlockers(s, model.id) : []), [s, model])
  const invalid = validateModel(m)
  const back = returnedForRevision(s, model.id)
  const wf = model.workflowInstanceId ? s.workflows.find((w) => w.id === model.workflowInstanceId) : undefined
  const runBt = () => { setBt({ result: backtest(s, m), dirty: wc.dirty }); setView('backtest') }
  const save = () => {
    if (invalid.length) { toast(invalid[0], 'bad'); return }
    let changes: string[] = []
    mutate((d) => { changes = saveDraft(d, m, me.id) })
    wc.commit()
    toast(changes.length ? `Draft saved: ${changes.length} change${changes.length > 1 ? 's' : ''}` : 'Draft saved')
  }
  const submit = () => {
    let res: ReturnType<typeof submitFactorModel> = { ok: false, reasons: [] }
    mutate((d) => { res = submitFactorModel(d, model.id, me.id, note.trim()) })
    toast(res.ok ? 'Submitted for approval to the estimating lead' : res.reasons[0] ?? 'Not submitted', res.ok ? 'good' : 'bad')
    if (res.ok) setNote('')
  }
  const withdraw = () => { mutate((d) => { withdrawFactorModel(d, model.id, me.id) }); toast('Withdrawn to draft') }
  const canWithdraw = model.status === 'in-review' && (wf?.startedById === me.id || me.roles.includes('admin') || me.roles.includes('estimating-lead'))
  const set = (fn: (x: FactorModel) => FactorModel) => wc.set(fn)
  const setFactor = (id: string, fn: (f: ModelFactor) => ModelFactor) => set((x) => ({ ...x, factors: x.factors.map((f) => (f.id === id ? fn(f) : f)) }))
  const submitReasons = wc.dirty ? ['Save the draft first'] : blockers
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-[17px] font-bold">{model.name} v{model.version}</h2>
          <StatusBadge status={model.status} />
          {model.parentVersion && <span className="text-[12px] text-muted">from v{model.parentVersion}</span>}
          <span className="text-[12px] text-muted">created {fmtDate(model.createdAt.slice(0, 10))} by {personName(s, model.createdById)}{model.approvedAt ? ` · approved ${fmtDate(model.approvedAt.slice(0, 10))} by ${personName(s, model.approvedById)}` : ''}</span>
          {editable ? <Badge tone="good">You can edit this draft</Badge> : <Badge>Read-only</Badge>}
        </div>
        {(editable || model.notes) && (editable
          ? <Field label="Change note"><TextArea id="fm-notes" className="min-h-[44px]" value={m.notes} onChange={(e) => set((x) => ({ ...x, notes: e.target.value }))} placeholder="What changed and why (kept with the version)" /></Field>
          : <p className="text-[12.5px] text-muted">{model.notes}</p>)}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runBt}>Run backtest</Button>
          {editable && <>
            <Button size="sm" variant="primary" disabled={!wc.dirty} onClick={save}>Save draft</Button>
            {wc.dirty && <Button size="sm" variant="ghost" onClick={() => wc.reset()}>Discard changes</Button>}
            {wc.dirty && <Badge tone="marker">Unsaved changes</Badge>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <ConfirmButton size="sm" onConfirm={() => { mutate((d) => discardDraft(d, model.id, me.id)); toast('Draft discarded') }} confirmLabel="Discard draft">Discard draft</ConfirmButton>
            </span>
          </>}
          {canWithdraw && <Button size="sm" variant="marker" onClick={withdraw}>Withdraw to edit</Button>}
        </div>
        {invalid.length > 0 && editable && <ul className="text-[12px] text-bad">{invalid.map((x) => <li key={x}>· {x}</li>)}</ul>}
        {editable && (
          <div className="flex flex-col gap-2 rounded-md border border-marker/60 bg-marker/5 p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">Submit for approval</span><span className="text-[12px] text-muted">Routes to the estimating lead. Approval publishes v{model.version} and retires v{pub?.version ?? '—'}.</span></div>
            <Input id="fm-submit-note" placeholder="Note for the approver (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {submitReasons.length > 0 && <div className="text-[12px] text-bad"><b>Blocked by the publish gate:</b><ul>{submitReasons.map((x) => <li key={x}>· {x}</li>)}</ul></div>}
            <div><Button variant="primary" disabled={submitReasons.length > 0} onClick={submit}>Submit for approval</Button></div>
          </div>
        )}
        {back && <Callout tone="warn" title="Returned by the estimating lead">{back.event?.comment ? <>“{back.event.comment}” — {personName(s, back.event.actorId)}, {fmtDateTime(back.event.at)}. </> : null}Withdraw it to edit, or resubmit unchanged in the workflow panel.</Callout>}
        {model.status === 'in-review' && model.backtest && <p className="text-[12px] text-muted">Submitted {fmtDateTime(model.submittedAt)} with backtest MAPE {model.backtest.mape}%, bias {model.backtest.bias > 0 ? '+' : ''}{model.backtest.bias}%, coverage {model.backtest.coverage}% (n = {model.backtest.n}).</p>}
        {wf && model.status === 'in-review' && <WorkflowStatus instanceId={wf.id} />}
      </div>

      <Tabs<View> value={view} onChange={setView} tabs={[
        { id: 'factors', label: 'Factors', count: m.factors.length },
        { id: 'rates', label: 'Base rates & uncertainty' },
        { id: 'backtest', label: 'Backtest' },
        { id: 'compare', label: 'Draft vs published' },
        { id: 'history', label: 'Version history' },
        { id: 'settings', label: 'Override reasons & gate' },
      ]} />
      {view === 'factors' && <FactorsTable m={m} editable={editable} setFactor={setFactor} />}
      {view === 'rates' && <BaseRates m={m} editable={editable} set={set} />}
      {view === 'backtest' && <BacktestView s={s} m={m} run={bt} onRun={runBt} />}
      {view === 'compare' && <Compare s={s} m={m} pub={pub} />}
      {view === 'history' && <History s={s} />}
      {view === 'settings' && <SettingsEditor s={s} canEdit={canEdit} />}
    </div>
  )
}

// ───────────────────────────── Factors
function FactorsTable({ m, editable, setFactor }: { m: FactorModel; editable: boolean; setFactor: (id: string, fn: (f: ModelFactor) => ModelFactor) => void }) {
  return (
    <Panel pad={false} title="Driver factors" subtitle="Each factor binds to one physical, legal or logistical driver. The baseline level (the typical historical project) is fixed at ×1.00; weight blends the effect toward 1.">
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Factor</th><th>Weight</th><th>Level multipliers</th><th className="num">cv</th></tr></thead>
          <tbody>
            {m.factors.map((f) => {
              const info = DRIVER_INFO[f.driver]
              return (
                <tr key={f.id}>
                  <td className="min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">{f.name}<Badge tone={KIND_TONE[f.kind]}>{KIND_LABEL[f.kind]}</Badge></div>
                    <div className="text-[11.5px] text-muted">Driver: {info?.label ?? String(f.driver)}</div>
                    <div className="text-[11px] text-faint">{f.appliesTo?.length ? f.appliesTo.map((a) => ASSET_LABEL[a]).join(', ') : 'All asset types'}</div>
                    {f.note && <div className="text-[11px] text-faint">{f.note}</div>}
                  </td>
                  <td className="min-w-[150px]">
                    <div className="flex items-center gap-2">
                      <input type="range" aria-label={`${f.name} weight`} min={0} max={1} step={0.05} value={f.weight} disabled={!editable} onChange={(e) => setFactor(f.id, (x) => ({ ...x, weight: Number(e.target.value) }))} className="w-24 accent-ink" />
                      <span className="w-9 text-right font-mono text-[12px] tabular-nums">{f.weight.toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="min-w-[260px]">
                    <div className="flex flex-wrap gap-1.5">
                      {f.levels.map((l) => {
                        const base = info?.baseline === l.value
                        return (
                          <label key={l.value} className={cx('flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11.5px]', base ? 'border-ink/40 bg-sunken' : 'border-line')} title={base ? 'Baseline level: fixed at 1.00' : undefined}>
                            <span className="whitespace-nowrap text-muted">{l.label}</span>
                            {editable && !base
                              ? <NumInput ariaLabel={`${f.name} ${l.label} multiplier`} className={cx(cellInp, 'w-14')} value={l.multiplier} min={0.01} onChange={(v) => setFactor(f.id, (x) => ({ ...x, levels: x.levels.map((y) => (y.value === l.value ? { ...y, multiplier: Math.round(v * 1000) / 1000 } : y)) }))} />
                              : <b className="font-mono tabular-nums">×{l.multiplier.toFixed(2)}</b>}
                          </label>
                        )
                      })}
                    </div>
                  </td>
                  <td className="num">{editable ? <NumInput ariaLabel={`${f.name} cv`} className={cx(cellInp, 'w-16')} value={f.cv} min={0} onChange={(v) => setFactor(f.id, (x) => ({ ...x, cv: Math.min(0.99, Math.round(v * 1000) / 1000) }))} /> : f.cv.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ───────────────────────────── Base rates
function BaseRates({ m, editable, set }: { m: FactorModel; editable: boolean; set: (fn: (x: FactorModel) => FactorModel) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Scale and uncertainty">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Size scale exponent" hint="Cost ∝ quantity^scale around the reference quantity; below 1 = economies of scale">{editable ? <NumInput id="fm-scale" value={m.scaleExponent} onChange={(v) => set((x) => ({ ...x, scaleExponent: Math.round(v * 1000) / 1000 }))} /> : <b className="font-mono">{m.scaleExponent.toFixed(2)}</b>}</Field>
          <Field label="Base-rate uncertainty (cv)" hint="Spread of the base $/unit before drivers">{editable ? <NumInput id="fm-cv" value={m.baseCv} onChange={(v) => set((x) => ({ ...x, baseCv: Math.round(v * 1000) / 1000 }))} /> : <b className="font-mono">{m.baseCv.toFixed(2)}</b>}</Field>
          <div className="text-[12px] text-muted">P10–P90 for base uncertainty alone: ×{Math.exp(-1.2816 * Math.sqrt(Math.log(1 + m.baseCv ** 2))).toFixed(2)} – ×{Math.exp(1.2816 * Math.sqrt(Math.log(1 + m.baseCv ** 2))).toFixed(2)} of the estimate.</div>
        </div>
      </Panel>
      <Panel pad={false} title="Base rates" subtitle="Direct $/unit for the typical project, started from the historical cost table P50s (base-year dollars).">
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Asset · method</th><th>Diameter</th><th className="num">Rate $/unit</th><th className="num">Reference qty</th><th className="num">Base yr</th><th className="num">n</th><th>Source</th></tr></thead>
            <tbody>
              {m.baseRates.map((b) => (
                <tr key={b.id}>
                  <td className="min-w-[180px] text-[12.5px]">{ASSET_LABEL[b.assetType]} · {METHOD_LABEL[b.workMethod]}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{bandLabel(b.diameterBand)}</td>
                  <td className="num">{editable ? <NumInput ariaLabel={`Rate ${b.id}`} className={cx(cellInp, 'w-28')} value={b.rate} min={0} onChange={(v) => set((x) => ({ ...x, baseRates: x.baseRates.map((y) => (y.id === b.id ? { ...y, rate: Math.round(v) } : y)) }))} /> : <span className="font-semibold">${Math.round(b.rate).toLocaleString('en-US')}/{b.unit}</span>}</td>
                  <td className="num">{editable ? <NumInput ariaLabel={`Reference ${b.id}`} className={cx(cellInp, 'w-24')} value={b.refQty} min={1} onChange={(v) => set((x) => ({ ...x, baseRates: x.baseRates.map((y) => (y.id === b.id ? { ...y, refQty: Math.max(1, Math.round(v)) } : y)) }))} /> : `${b.refQty.toLocaleString('en-US')} ${b.unit}`}</td>
                  <td className="num">{b.baseYear}</td>
                  <td className="num">{b.n}</td>
                  <td className="font-mono text-[11.5px] text-faint">{b.sourceRowId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

// ───────────────────────────── Backtest
function Metric({ label, value, ok, limit }: { label: string; value: string; ok?: boolean; limit?: string }) {
  return (
    <div className={cx('rounded-md border px-3 py-2', ok === false ? 'border-bad/50 bg-bad/5' : 'border-line')}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="font-display text-[20px] font-bold tabular-nums">{value}</div>
      {limit && <div className={cx('text-[11px]', ok ? 'text-good' : 'text-bad')}>{ok ? 'Meets' : 'Fails'} {limit}</div>}
    </div>
  )
}

function BacktestView({ s, m, run, onRun }: { s: AppState; m: FactorModel; run: { result: BacktestResult; dirty: boolean } | null; onRun: () => void }) {
  if (!run) return (
    <Panel title="Backtest" subtitle={`${s.backtestProjects.length} fictional closed projects with known drivers and final cost`}>
      <div className="flex flex-col items-start gap-2">
        {m.backtest && <p className="text-[12.5px] text-muted">At submission ({fmtDateTime(m.backtest.at)}): MAPE {m.backtest.mape}%, median {m.backtest.medianApe}%, bias {m.backtest.bias > 0 ? '+' : ''}{m.backtest.bias}%, P10–P90 coverage {m.backtest.coverage}% (n = {m.backtest.n}) — {m.backtest.passed ? 'passed the gate' : 'did not pass'}.</p>}
        <Button variant="primary" onClick={onRun}>Run backtest</Button>
      </div>
    </Panel>
  )
  const bt = run.result
  const g = gateCheck(bt, s.settings.factorModel.gate)
  const worst = bt.points.slice().sort((a, b) => b.ape - a.ape).slice(0, 8)
  return (
    <div className="flex flex-col gap-3">
      <Panel title="Backtest results" subtitle={`Predicted cost (direct + tax + loaders, no contingency) vs final actual cost for ${bt.n} closed projects${run.dirty ? ' · includes unsaved changes' : ''}`} actions={<Button size="sm" onClick={onRun}>Run again</Button>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="MAPE" value={`${bt.mape.toFixed(1)}%`} ok={g.checks[0].ok} limit={g.checks[0].limit} />
            <Metric label="Median abs % error" value={`${bt.medianApe.toFixed(1)}%`} />
            <Metric label="Bias" value={`${bt.bias > 0 ? '+' : ''}${bt.bias.toFixed(1)}%`} ok={g.checks[1].ok} limit={g.checks[1].limit} />
            <Metric label="Inside P10–P90" value={`${bt.coverage.toFixed(1)}%`} ok={g.checks[2].ok} limit={g.checks[2].limit} />
            <Metric label="Projects" value={String(bt.n)} ok={g.checks[3].ok} limit={g.checks[3].limit} />
          </div>
          <Badge tone={g.ok ? 'good' : 'bad'} className="self-start">{g.ok ? 'Meets the publish gate' : `Fails the publish gate: ${g.reasons.length} check${g.reasons.length > 1 ? 's' : ''}`}</Badge>
          <div><div className="eyebrow mb-1">Predicted vs actual (log scale)</div><Scatter points={bt.points} /></div>
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel pad={false} title="By asset type">
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Asset type</th><th className="num">n</th><th className="num">MAPE</th><th className="num">Bias</th><th className="num">Coverage</th></tr></thead>
            <tbody>{bt.byAsset.map((r) => <tr key={r.assetType}><td className="text-[12.5px]">{ASSET_LABEL[r.assetType as keyof typeof ASSET_LABEL] ?? r.assetType}</td><td className="num">{r.n}</td><td className="num">{r.mape.toFixed(1)}%</td><td className={cx('num', Math.abs(r.bias) > s.settings.factorModel.gate.maxAbsBias && 'text-warn')}>{r.bias > 0 ? '+' : ''}{r.bias.toFixed(1)}%</td><td className="num">{r.coverage.toFixed(0)}%</td></tr>)}</tbody>
          </table></div>
          {bt.byAsset.some((r) => r.n < 5) && <p className="px-4 pb-3 text-[11.5px] text-muted">Asset types with fewer than 5 projects are reported but carry little weight.</p>}
        </Panel>
        <Panel pad={false} title="Largest misses">
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Project</th><th className="num">Predicted</th><th className="num">Actual</th><th className="num">Error</th></tr></thead>
            <tbody>{worst.map((p) => <tr key={p.id}><td className="min-w-[180px] text-[12.5px]"><span className="font-mono text-[11.5px] text-muted">{p.code}</span> {p.name}</td><td className="num">{money(p.predicted)}</td><td className="num">{money(p.actual)}</td><td className={cx('num', p.inside ? '' : 'font-semibold text-bad')}>{p.err > 0 ? '+' : ''}{pct(p.err)}</td></tr>)}</tbody>
          </table></div>
        </Panel>
      </div>
    </div>
  )
}

/** Predicted vs actual on log axes, with the 1:1 line and ±25% guides; points outside P10–P90 in red. */
function Scatter({ points }: { points: BacktestResult['points'] }) {
  const W = 720, H = 300, L = 64, R = 16, T = 12, B = 34
  const vals = points.flatMap((p) => [p.predicted, p.actual]).filter((v) => v > 0)
  const lo = Math.log10(Math.min(...vals) * 0.8), hi = Math.log10(Math.max(...vals) * 1.25)
  const X = (v: number) => L + ((Math.log10(v) - lo) / (hi - lo)) * (W - L - R)
  const Y = (v: number) => T + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - T - B)
  const ticks = Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, k) => Math.pow(10, Math.ceil(lo) + k))
  const a = Math.pow(10, lo), b = Math.pow(10, hi)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Predicted versus actual cost">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="rgb(var(--line))" /><text x={L - 6} y={Y(t) + 4} textAnchor="end" fontSize={11} fill="rgb(var(--muted))">{money(t)}</text><text x={X(t)} y={H - 12} textAnchor="middle" fontSize={11} fill="rgb(var(--muted))">{money(t)}</text></g>)}
        <line x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke="rgb(var(--ink))" strokeWidth={1.2} />
        <line x1={X(a)} y1={Y(a * 1.25)} x2={X(b / 1.25)} y2={Y(b)} stroke="rgb(var(--muted))" strokeDasharray="4 4" />
        <line x1={X(a * 1.25)} y1={Y(a)} x2={X(b)} y2={Y(b / 1.25)} stroke="rgb(var(--muted))" strokeDasharray="4 4" />
        {points.map((p) => <circle key={p.id} cx={X(p.actual)} cy={Y(p.predicted)} r={4} fill={p.inside ? 'rgb(var(--link))' : 'rgb(var(--bad))'} opacity={0.75}><title>{`${p.code} ${p.name}: predicted ${money(p.predicted)}, actual ${money(p.actual)} (${p.err > 0 ? '+' : ''}${(p.err * 100).toFixed(0)}%)`}</title></circle>)}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>x: actual · y: predicted</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-link" />Actual inside P10–P90</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-bad" />Outside</span>
        <span>Solid line 1:1 · dashed ±25%</span>
      </div>
    </div>
  )
}

// ───────────────────────────── Compare
function Compare({ s, m, pub }: { s: AppState; m: FactorModel; pub?: FactorModel }) {
  const data = useMemo(() => {
    if (!pub || pub.id === m.id) return
    const a = backtest(s, pub), b = backtest(s, m)
    const projects = s.projects.filter((p) => p.status === 'active' && p.stageIndex <= 1).slice(0, 10).map((p) => {
      const i = factorInputsFromProject(s, p)
      const x = priceFactor(s, pub, i), y = priceFactor(s, m, i)
      return { p, a: x.total, b: y.total }
    }).filter((r) => r.a > 0)
    return { a, b, diff: diffModels(pub, m), projects }
  }, [s, m, pub])
  if (!data || !pub) return <Panel title="Draft vs published"><p className="text-[13px] text-muted">{pub && pub.id === m.id ? 'You are viewing the published model. Open the draft (or start one) to compare it with the published version.' : 'No published model to compare with.'}</p></Panel>
  const row = (label: string, x: number, y: number, unit = '%', better: 'lower' | 'abs' | 'none' = 'lower') => {
    const d = y - x
    const good = better === 'lower' ? d < 0 : better === 'abs' ? Math.abs(y) < Math.abs(x) : false
    return <tr key={label}><td className="text-[12.5px]">{label}</td><td className="num">{x.toFixed(1)}{unit}</td><td className="num font-semibold">{y.toFixed(1)}{unit}</td><td className={cx('num', d && better !== 'none' ? (good ? 'text-good' : 'text-bad') : 'text-muted')}>{d > 0 ? '+' : ''}{d.toFixed(1)}</td></tr>
  }
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel pad={false} title="Backtest: published vs this version">
        <div className="scroll-x"><table className="tbl">
          <thead><tr><th>Metric</th><th className="num">v{pub.version}</th><th className="num">v{m.version}</th><th className="num">Δ</th></tr></thead>
          <tbody>
            {row('MAPE', data.a.mape, data.b.mape)}
            {row('Median abs % error', data.a.medianApe, data.b.medianApe)}
            {row('Bias', data.a.bias, data.b.bias, '%', 'abs')}
            {row('Inside P10–P90', data.a.coverage, data.b.coverage, '%', 'none')}
          </tbody>
        </table></div>
      </Panel>
      <Panel title={`What changed (v${pub.version} → v${m.version})`} subtitle="Weights, multipliers, uncertainty and base rates, including unsaved edits">
        {data.diff.length ? <ul className="flex flex-col gap-1 text-[12.5px]">{data.diff.map((x) => <li key={x} className="rounded border border-line px-2 py-1 font-mono text-[11.5px]">{x}</li>)}</ul> : <p className="text-[13px] text-muted">No differences.</p>}
      </Panel>
      <Panel pad={false} title="Effect on early-stage projects" subtitle="Class 5 total under each version, same inputs" className="xl:col-span-2">
        <div className="scroll-x"><table className="tbl">
          <thead><tr><th>Project</th><th className="num">v{pub.version}</th><th className="num">v{m.version}</th><th className="num">Δ</th></tr></thead>
          <tbody>{data.projects.map((r) => <tr key={r.p.id}><td className="min-w-[200px] text-[12.5px]"><span className="font-mono text-[11.5px] text-muted">{r.p.code}</span> {r.p.name}</td><td className="num">{money(r.a)}</td><td className="num font-semibold">{money(r.b)}</td><td className={cx('num', r.b > r.a ? 'text-bad' : r.b < r.a ? 'text-good' : 'text-muted')}>{r.b === r.a ? '—' : `${r.b > r.a ? '+' : ''}${pct(r.b / r.a - 1, 1)}`}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </div>
  )
}

// ───────────────────────────── History
function History({ s }: { s: AppState }) {
  const versions = modelsByVersion(s)
  const log = s.audit.filter((a) => a.entity === 'factor-model').slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <Panel pad={false} title="Versions" subtitle="Exactly one version is published at a time; approval retires the one it replaces. Records are never deleted.">
        <div className="scroll-x"><table className="tbl">
          <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Approved</th><th className="num">Backtest</th><th>Changes from parent</th></tr></thead>
          <tbody>
            {versions.map((m) => {
              const parent = s.factorModels.find((x) => x.version === m.parentVersion)
              const diff = parent ? diffModels(parent, m) : []
              const shown = open === m.id ? diff : diff.slice(0, 3)
              return (
                <tr key={m.id}>
                  <td className="font-mono font-semibold">v{m.version}</td>
                  <td><StatusBadge status={m.status} /></td>
                  <td className="whitespace-nowrap text-[12px]">{fmtDate(m.createdAt.slice(0, 10))}<div className="text-muted">{personName(s, m.createdById)}</div></td>
                  <td className="whitespace-nowrap text-[12px]">{m.approvedAt ? <>{fmtDate(m.approvedAt.slice(0, 10))}<div className="text-muted">{personName(s, m.approvedById)}</div></> : '—'}{m.retiredAt && <div className="text-faint">retired {fmtDate(m.retiredAt.slice(0, 10))}</div>}</td>
                  <td className="num whitespace-nowrap text-[12px]">{m.backtest ? <>MAPE {m.backtest.mape}%<div className="text-muted">bias {m.backtest.bias > 0 ? '+' : ''}{m.backtest.bias}% · cov {m.backtest.coverage}%</div></> : <span className="text-faint">not run at submission</span>}</td>
                  <td className="min-w-[260px] text-[11.5px]">
                    {m.notes && <div className="mb-1 text-[12px]">{m.notes}</div>}
                    {shown.map((x) => <div key={x} className="font-mono text-muted">{x}</div>)}
                    {diff.length > 3 && <button className="text-[11.5px] font-semibold text-link" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? 'Show less' : `+${diff.length - 3} more`}</button>}
                    {!parent && <span className="text-faint">First version</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </Panel>
      <Panel pad={false} title="Audit trail" subtitle="Drafts, edits (with weight diffs), submissions, approvals and retirements">
        <div className="scroll-x"><table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th></tr></thead>
          <tbody>{log.map((a) => <tr key={a.id}><td className="whitespace-nowrap text-[12px]">{fmtDateTime(a.at)}</td><td className="whitespace-nowrap text-[12.5px]">{personName(s, a.actorId)}</td><td><Badge>{a.action}</Badge></td><td className="min-w-[300px] text-[12.5px]">{a.summary}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </div>
  )
}

// ───────────────────────────── Override reasons and gate
function SettingsEditor({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const me = useMe()
  const wc = useDraft<FactorModelSettings>(s.settings.factorModel)
  const c = wc.draft
  const [add, setAdd] = useState('')
  const editable = canEdit && (me.roles.includes('estimating-lead') || me.roles.includes('admin') || me.roles.includes('estimator'))
  const problems = [!c.overrideReasons.length && 'Keep at least one override reason', !(c.gate.minCoverage < c.gate.maxCoverage) && 'Coverage minimum must be below the maximum', !(c.gate.maxMape > 0) && 'MAPE limit must be above 0', !(c.iterations >= 500 && c.iterations <= 50000) && 'Monte Carlo draws: 500–50,000'].filter(Boolean) as string[]
  const save = () => {
    if (problems.length) return
    const before = s.settings.factorModel
    const changes: string[] = []
    for (const r of c.overrideReasons) if (!before.overrideReasons.includes(r)) changes.push(`added reason "${r}"`)
    for (const r of before.overrideReasons) if (!c.overrideReasons.includes(r)) changes.push(`removed reason "${r}"`)
    for (const k of Object.keys(c.gate) as (keyof typeof c.gate)[]) if (c.gate[k] !== before.gate[k]) changes.push(`gate ${k} ${before.gate[k]} → ${c.gate[k]}`)
    if (c.iterations !== before.iterations) changes.push(`Monte Carlo draws ${before.iterations} → ${c.iterations}`)
    mutate((d) => { d.settings.factorModel = JSON.parse(JSON.stringify(c)) }, { entity: 'factor-model', entityId: 'factor-model-settings', action: 'settings', summary: `Factor model settings: ${changes.join('; ') || 'no changes'}` })
    wc.commit()
    toast('Saved')
  }
  const g = (k: keyof FactorModelSettings['gate'], label: string, hint?: string) => <Field label={label} hint={hint}>{editable ? <NumInput id={`gate-${k}`} value={c.gate[k]} min={0} onChange={(v) => wc.set((x) => ({ ...x, gate: { ...x.gate, [k]: Math.round(v * 10) / 10 } }))} /> : <b className="font-mono">{c.gate[k]}</b>}</Field>
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel title="Override reasons" subtitle="An estimator adjusting a quick estimate must pick one of these.">
        <ul className="flex flex-col gap-1.5">
          {c.overrideReasons.map((r, k) => (
            <li key={k} className="flex items-center gap-2">
              {editable ? <Input aria-label={`Reason ${k + 1}`} className="h-8 py-0.5 text-[13px]" value={r} onChange={(e) => wc.set((x) => ({ ...x, overrideReasons: x.overrideReasons.map((y, j) => (j === k ? e.target.value : y)) }))} /> : <span className="text-[13px]">{r}</span>}
              {editable && <Button size="sm" variant="ghost" onClick={() => wc.set((x) => ({ ...x, overrideReasons: x.overrideReasons.filter((_, j) => j !== k) }))}>Remove</Button>}
            </li>
          ))}
        </ul>
        {editable && <div className="mt-2 flex gap-2"><Input aria-label="New reason" className="h-8 py-0.5 text-[13px]" placeholder="Add a reason" value={add} onChange={(e) => setAdd(e.target.value)} /><Button size="sm" disabled={!add.trim() || c.overrideReasons.includes(add.trim())} onClick={() => { wc.set((x) => ({ ...x, overrideReasons: [...x.overrideReasons, add.trim()] })); setAdd('') }}>Add</Button></div>}
      </Panel>
      <Panel title="Publish gate and simulation" subtitle="A draft can be submitted only when its backtest meets every threshold.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {g('maxMape', 'Max MAPE (%)')}
          {g('maxAbsBias', 'Max |bias| (%)')}
          {g('minCoverage', 'Min P10–P90 coverage (%)', 'Below this the range is too narrow')}
          {g('maxCoverage', 'Max P10–P90 coverage (%)', 'Above this the range is too wide')}
          <Field label="Monte Carlo draws">{editable ? <NumInput id="mc-iter" value={c.iterations} min={500} onChange={(v) => wc.set((x) => ({ ...x, iterations: Math.round(v) }))} /> : <b className="font-mono">{c.iterations.toLocaleString('en-US')}</b>}</Field>
        </div>
      </Panel>
      {editable && wc.dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-marker/10 px-4 py-2 xl:col-span-2">
          <Badge tone="marker">Unsaved changes</Badge>
          {problems.map((p) => <span key={p} className="text-[12px] text-bad">{p}</span>)}
          <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => wc.reset()}>Discard</Button><Button size="sm" variant="primary" disabled={problems.length > 0} onClick={save}>Save changes</Button></span>
        </div>
      )}
    </div>
  )
}

/** Inbox summary for a factor-model approval task: backtest at submission and what changed. */
export function FactorModelReviewSummary({ s, id }: { s: AppState; id: string }) {
  const m = s.factorModels.find((x) => x.id === id)
  if (!m) return <p className="text-[13px] text-muted">Model not found.</p>
  const parent = s.factorModels.find((x) => x.version === m.parentVersion)
  const diff = parent ? diffModels(parent, m) : []
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2"><b className="font-display text-[16px]">Factor model v{m.version}</b><StatusBadge status={m.status} />{parent && <span className="text-[12px] text-muted">replaces v{parent.version}</span>}</div>
      {m.backtest && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="MAPE" value={`${m.backtest.mape}%`} /><Metric label="Bias" value={`${m.backtest.bias > 0 ? '+' : ''}${m.backtest.bias}%`} /><Metric label="Coverage" value={`${m.backtest.coverage}%`} /><Metric label="Projects" value={String(m.backtest.n)} /></div>}
      {m.notes && <p className="text-[13px]">{m.notes}</p>}
      {diff.length > 0 && <ul className="text-[11.5px]">{diff.map((x) => <li key={x} className="font-mono text-muted">· {x}</li>)}</ul>}
      <a href="#estimating" className="text-[12.5px] font-semibold text-link">Open Estimating → Administration → Factor model</a>
    </div>
  )
}
