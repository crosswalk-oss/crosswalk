// Class 5 request a PM fills in: length of pipe, location and a Low / Medium / High risk rating per risk item, priced
// automatically from the rate table with a Monte Carlo, and one button that sends it to the estimating team
// (class5-review workflow). The factor-model pieces below are kept for the estimator's model check and older records.
import { useMemo, useState } from 'react'
import type { AppState, AssetType, DiameterBand, FactorInputs, FactorModel, ParametricInputs, Project, QuickInputs, Terrain, WorkMethod } from '@/core/types'
import { parametricInputsFromProject, priceParametric } from '@/core/engine/parametric'
import { mutate, useMe, useStore } from '@/core/store'
import { DIAMETER_BANDS, QUICK_CATALOG, UNIT_LABEL } from '@/core/engine/quick'
import { factorBoe, factorInputsFromProject, priceFactor, publishedModel, rateTableEstimate, taxForDistrict } from '@/core/engine/factorModel'
import { salesTaxFor } from '@/core/engine/estimatingAdmin'
import { go } from '@/core/router'
import { cx } from '@/core/util'
import { Badge, Button, Callout, Field, Input, Panel, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { NumInput } from '../parts'
import { ASSET_LABEL, METHOD_LABEL, TERRAIN_LABEL, bandLabel, blankInputs, catalogOf, districtsOf, normalizeInputs, quickEligibility, canRevise, reviseQuickRequest, submitQuickRequest, toFactorInputs, type RequestResult } from './lib'
import { QuickBadge, QuickHeadline } from './parts'
import { BoeText, DriverInputs, DriverTable, FactorBuildUp, MonteCarloToggle, RateTableCompare, buildOf } from './factorParts'
import { ParametricResultView, RiskRatings } from './parametricParts'

const PURPOSES = ['Screening number for the GRC forecast', 'Planning budget for the Gate 1 business case', 'Portfolio plan placeholder until a route is selected']
export const NEW_NEED = '__new'

/** The scope dropdowns. Controlled; keeps method, unit and band consistent with the asset. */
export function QuickInputsForm<T extends QuickInputs>({ s, value, onChange, idPrefix = 'q' }: { s: AppState; value: T; onChange: (v: T) => void; idPrefix?: string }) {
  const c = catalogOf(value.assetType)!
  const y = Number(s.settings.asOf.slice(0, 4))
  const set = (patch: Partial<QuickInputs>) => onChange(normalizeInputs({ ...value, ...patch }, value.assetType) as T)
  const rf = s.settings.estimating?.regionFactors ?? s.settings.quickEstimate.regionFactors
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Asset type"><Select id={`${idPrefix}-asset`} value={value.assetType} onChange={(e) => set({ assetType: e.target.value as AssetType })} options={QUICK_CATALOG.map((x) => ({ value: x.asset, label: x.label }))} /></Field>
      <Field label="Work method"><Select id={`${idPrefix}-method`} value={value.workMethod} onChange={(e) => set({ workMethod: e.target.value as WorkMethod })} options={c.methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} /></Field>
      {c.banded && <Field label="Diameter band"><Select id={`${idPrefix}-band`} value={value.diameterBand} onChange={(e) => set({ diameterBand: e.target.value as DiameterBand })} options={DIAMETER_BANDS.filter((b) => b.id !== 'n/a').map((b) => ({ value: b.id, label: b.label }))} /></Field>}
      <Field label="Setting"><Select id={`${idPrefix}-terrain`} value={value.terrain} onChange={(e) => set({ terrain: e.target.value as Terrain })} options={(['urban', 'suburban', 'rural'] as Terrain[]).map((t) => ({ value: t, label: TERRAIN_LABEL[t] }))} /></Field>
      <Field label="Region (district)"><Select id={`${idPrefix}-district`} value={value.district} onChange={(e) => set({ district: e.target.value })} options={districtsOf(s).map((d) => ({ value: d, label: `${d} · ×${(rf[d] ?? 1).toFixed(2)}` }))} /></Field>
      <Field label={`Quantity (${UNIT_LABEL[c.unit]})`}><NumInput id={`${idPrefix}-qty`} value={value.qty} min={0} onChange={(v) => set({ qty: c.unit === 'ft' || c.unit === 'hp' ? Math.round(v) : Math.max(1, Math.round(v)) })} /></Field>
      <Field label="Spend midpoint year" hint="Year most of the money is spent"><Select id={`${idPrefix}-mid`} value={String(value.midpointYear)} onChange={(e) => set({ midpointYear: Number(e.target.value) })} options={Array.from({ length: 7 }, (_, k) => String(y + k))} /></Field>
    </div>
  )
}

/** The live factor-model result for a set of inputs. */
export function FactorResultView({ s, model, inputs, project }: { s: AppState; model: FactorModel; inputs: FactorInputs; project?: Project }) {
  const r = useMemo(() => priceFactor(s, model, inputs, project ? { salesTax: { ...salesTaxFor(s, project), pct: inputs.taxPct } } : {}), [s, model, inputs, project])
  const rt = useMemo(() => (project ? rateTableEstimate(s, project)?.total : undefined), [s, project])
  const boe = useMemo(() => factorBoe(model, inputs, r, rt), [model, inputs, r, rt])
  if (!r.base) return <Callout tone="bad" title="No base rate">Factor model v{model.version} has no base rate for {METHOD_LABEL[inputs.workMethod].toLowerCase()} on this asset type. Ask the estimating team to add one, or prepare a rate-table estimate.</Callout>
  return (
    <div className="flex flex-col gap-3">
      <QuickHeadline total={r.total} low={r.p10} high={r.p90} perUnit={r.perUnit} unit={inputs.unit} source="Model" />
      <ModelLine model={model} r={r} inputs={inputs} />
      <div><div className="eyebrow mb-1">Cost drivers</div><DriverTable items={r.items} baseline={r.baseline} direct={r.direct} total={r.total} /></div>
      <FactorBuildUp b={buildOf(r)} />
      <RateTableCompare factor={r.total} rateTable={rt} low={r.p10} high={r.p90} />
      <details className="rounded border border-line px-3 py-2"><summary className="cursor-pointer text-[12.5px] font-semibold">Generated basis of estimate</summary><div className="mt-2"><BoeText basis={boe} /></div></details>
      <MonteCarloToggle r={r} iterations={s.settings.factorModel.iterations} />
    </div>
  )
}

/** Which model version and base rate priced the number. */
export function ModelLine({ model, r, inputs }: { model: FactorModel; r: ReturnType<typeof priceFactor>; inputs: FactorInputs }) {
  const b = r.base!
  return (
    <div className={cx('rounded-md border px-3 py-2 text-[12px]', r.match === 'exact' ? 'border-line' : 'border-warn/50 bg-warn/5')}>
      <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">Factor model</span><Badge tone="ink">v{model.version}</Badge><Badge tone={model.status === 'published' ? 'good' : 'warn'}>{model.status}</Badge>{r.match === 'nearest-band' && <Badge tone="warn">Base rate from nearest band</Badge>}</div>
      <div className="mt-1 text-muted">Base rate <b className="text-ink">${Math.round(b.rate).toLocaleString('en-US')}/{b.unit}</b> ({bandLabel(b.diameterBand)}, {b.baseYear}$, {b.n} closed projects) at a {b.refQty.toLocaleString('en-US')} {b.unit} reference · size scale {model.scaleExponent.toFixed(2)} · base cv {model.baseCv.toFixed(2)} · {UNIT_LABEL[inputs.unit]}: {inputs.qty.toLocaleString('en-US')}</div>
    </div>
  )
}

const PIPE_SIZES = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 30, 36]

/**
 * PM request for a Class 5 estimate: length of pipe, location and a Low / Medium / High risk rating per risk item.
 * The pipe and work method come from the project record. Priced automatically from the rate table with a Monte
 * Carlo; only the estimating team adjusts it, in the next workflow step. With `reviseId` it reprices a returned
 * estimate in place and routes it again.
 */
export function QuickRequest({ projectId, allowPicker, reviseId, onDone, onCancel }: { projectId?: string; allowPicker?: boolean; reviseId?: string; onDone?: (estimateId: string, projectId: string) => void; onCancel?: () => void }) {
  const s = useStore()
  const me = useMe()
  const revising = reviseId ? s.estimates.find((e) => e.id === reviseId) : undefined
  const [pid, setPid] = useState<string>(revising?.projectId ?? projectId ?? NEW_NEED)
  const project = s.projects.find((p) => p.id === pid)
  const initial = (id: string): ParametricInputs => {
    if (revising?.parametric) return JSON.parse(JSON.stringify(revising.parametric.inputs))
    return parametricInputsFromProject(s, s.projects.find((x) => x.id === id))
  }
  const [inputs, setInputs] = useState<ParametricInputs>(() => initial(pid))
  const [pipeOpen, setPipeOpen] = useState(false)
  const [note, setNote] = useState(revising?.quick?.requestNote ?? '')
  const [needBy, setNeedBy] = useState(revising?.quick?.needBy ?? '')
  const pickProject = (id: string) => { setPid(id); setInputs(initial(id)) }
  const set = (patch: Partial<ParametricInputs>) => setInputs((v) => ({ ...v, ...patch }))
  const r = useMemo(() => priceParametric(s, inputs, project), [s, inputs, project])
  const elig = revising ? { ok: canRevise(s, revising), reason: canRevise(s, revising) ? undefined : 'Only a returned or recalled estimate can be revised' } : project ? quickEligibility(s, project.id) : { ok: false, reason: undefined }
  const fromProject = project ? parametricInputsFromProject(s, project) : undefined
  const changedRisks = fromProject ? Object.keys(inputs.risks).filter((k) => inputs.risks[k] !== fromProject.risks[k]).length : 0
  const pipeCats = QUICK_CATALOG.filter((c) => c.unit === 'ft')
  const methods = catalogOf(inputs.assetType)?.methods ?? []
  const y = Number(s.settings.asOf.slice(0, 4))
  const problems = [!inputs.lengthFt && 'Enter the length of pipe', inputs.lengthFt > 0 && !r && 'The rate table has no rows for this pipe and work method — ask the estimating team', !note.trim() && 'Say what the estimate is for', !elig.ok && elig.reason].filter(Boolean) as string[]
  const send = () => {
    if (problems.length || !project) return
    let res: RequestResult = { ok: false, message: '' }
    mutate((d) => {
      const a = { inputs, note, needBy: needBy || undefined, byId: me.id }
      res = reviseId ? reviseQuickRequest(d, reviseId, a) : submitQuickRequest(d, project.id, a)
    })
    toast(res.message, res.ok ? 'good' : 'bad')
    if (res.ok && res.estimateId) onDone?.(res.estimateId, project.id)
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {allowPicker && !revising && (
          <Field label="Project" hint={pid === NEW_NEED ? 'No project yet: see the number now, create the project when the need is confirmed.' : undefined}>
            <Select id="q-project" value={pid} onChange={(e) => pickProject(e.target.value)} options={[{ value: NEW_NEED, label: 'New need — no project yet' }, ...s.projects.filter((p) => p.status === 'active' || p.status === 'on-hold').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Length of pipe (feet)"><NumInput id="q-length" value={inputs.lengthFt} min={0} onChange={(v) => set({ lengthFt: Math.max(0, Math.round(v)) })} /></Field>
          <Field label="Location (region)"><Select id="q-region" value={inputs.region} onChange={(e) => set({ region: e.target.value })} options={s.settings.estimating.regions.map((g) => ({ value: g, label: `${g} · ×${(s.settings.estimating.regionFactors[g] ?? 1).toFixed(2)}` }))} /></Field>
        </div>
        <div className="rounded border border-line bg-sunken/40 px-3 py-2 text-[12.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="text-muted">Pipe and work:</span> <b>{inputs.diameterIn}" {ASSET_LABEL[inputs.assetType].toLowerCase()}</b> · {METHOD_LABEL[inputs.workMethod].toLowerCase()} · {inputs.midpointYear} spend midpoint <span className="text-faint">{project ? '(from the project record)' : ''}</span></span>
            <button type="button" className="font-semibold text-link" onClick={() => setPipeOpen((v) => !v)}>{pipeOpen ? 'Done' : 'Change'}</button>
          </div>
          {pipeOpen && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Pipe type"><Select id="q-asset" value={inputs.assetType} onChange={(e) => { const a = e.target.value as AssetType; set({ assetType: a, workMethod: catalogOf(a)?.methods.includes(inputs.workMethod) ? inputs.workMethod : catalogOf(a)!.methods[0] }) }} options={pipeCats.map((c) => ({ value: c.asset, label: c.label }))} /></Field>
              <Field label="Work method"><Select id="q-method" value={inputs.workMethod} onChange={(e) => set({ workMethod: e.target.value as WorkMethod })} options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} /></Field>
              <Field label="Pipe size"><Select id="q-dia" value={String(inputs.diameterIn)} onChange={(e) => set({ diameterIn: Number(e.target.value) })} options={[...new Set([...PIPE_SIZES, inputs.diameterIn])].sort((a, b) => a - b).map((d) => ({ value: String(d), label: `${d}"` }))} /></Field>
              <Field label="Spend midpoint year"><Select id="q-mid" value={String(inputs.midpointYear)} onChange={(e) => set({ midpointYear: Number(e.target.value) })} options={Array.from({ length: 7 }, (_, k) => String(y + k))} /></Field>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow">Risks that drive the estimate</span>
            {fromProject && <span className="text-[11.5px] text-muted">{changedRisks ? <>{changedRisks} changed from the project record · <button className="font-semibold text-link" onClick={() => set({ risks: { ...fromProject.risks } })}>Reset</button></> : 'Pre-filled from the project record'}</span>}
          </div>
          <RiskRatings s={s} value={inputs.risks} onChange={(risks) => set({ risks })} result={r} idPrefix="q-risk" />
          <p className="text-[11.5px] text-muted">Physical, legal and logistical conditions only. Community demographics and income are never estimate inputs.</p>
        </div>
        {pid !== NEW_NEED && <>
          <Field label="What is it for">
            <TextArea id="q-note" className="min-h-[60px]" placeholder="e.g. Screening number for the TY2028 GRC forecast" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="-mt-1 flex flex-wrap gap-1">{PURPOSES.map((x) => <button key={x} type="button" onClick={() => setNote(x)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', note === x ? 'border-link bg-link text-surface' : 'border-line text-muted hover:text-ink')}>{x}</button>)}</div>
          <Field label="Needed by (optional)" className="max-w-[220px]"><Input id="q-needby" type="date" min={s.settings.asOf} value={needBy} onChange={(e) => setNeedBy(e.target.value)} /></Field>
        </>}
        {pid !== NEW_NEED ? (
          <div className="flex flex-col gap-2 rounded-md border border-marker/60 bg-marker/5 p-3">
            <div className="text-[12.5px] text-muted">Goes to the estimating team (any estimator). They check the risk ratings and the rate table, adjust with a reason if needed, and approve. The approved number becomes the project's Class 5 estimate of record.</div>
            {problems.length > 0 && <ul className="text-[12px] text-warn">{problems.map((p) => <li key={p}>· {p}</li>)}</ul>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={problems.length > 0} onClick={send}>{revising ? 'Resubmit to estimating team' : 'Send to estimating team'}</Button>
              {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
            </div>
          </div>
        ) : (
          <Callout tone="info" title="No project yet">This number is not saved. When the need is confirmed, <button className="font-semibold text-link" onClick={() => go('#new-project')}>start a new project</button>, then request the Class 5 estimate on it so the estimating team can review it.</Callout>
        )}
      </div>
      <Panel className="min-w-0 self-start" title={<span className="inline-flex items-center gap-2">Live estimate <Badge tone="info">Class 5 · parametric</Badge></span>} subtitle={project ? `${project.code} · ${project.name}` : 'Unsaved — new need'}>
        {r ? <ParametricResultView r={r} /> : <Callout tone={inputs.lengthFt ? 'bad' : 'info'} title={inputs.lengthFt ? 'No rate-table rows' : 'Enter the length of pipe'}>{inputs.lengthFt ? `The rate table has no rows for ${METHOD_LABEL[inputs.workMethod].toLowerCase()} on ${ASSET_LABEL[inputs.assetType].toLowerCase()}. Ask the estimating team to add them.` : 'The estimate fills in from the rate table as soon as there is a length.'}</Callout>}
      </Panel>
    </div>
  )
}
