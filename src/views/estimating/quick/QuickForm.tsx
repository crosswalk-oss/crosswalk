// Class 5 quick estimate request on the factor model: a handful of dropdowns pre-filled from the project scope and its
// cost drivers, a live forward-looking number with every driver itemized, the rate-table cross-check and the generated
// BOE, and one button that sends it to the estimating team (class5-review workflow).
import { useMemo, useState } from 'react'
import type { AppState, AssetType, DiameterBand, FactorInputs, FactorModel, Project, QuickInputs, Terrain, WorkMethod } from '@/core/types'
import { mutate, useMe, useStore } from '@/core/store'
import { DIAMETER_BANDS, QUICK_CATALOG, UNIT_LABEL } from '@/core/engine/quick'
import { factorBoe, factorInputsFromProject, priceFactor, publishedModel, rateTableEstimate, taxForDistrict } from '@/core/engine/factorModel'
import { salesTaxFor } from '@/core/engine/estimatingAdmin'
import { go } from '@/core/router'
import { cx } from '@/core/util'
import { Badge, Button, Callout, Field, Input, Panel, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { NumInput } from '../parts'
import { METHOD_LABEL, TERRAIN_LABEL, bandLabel, blankInputs, catalogOf, districtsOf, normalizeInputs, quickEligibility, canRevise, reviseQuickRequest, submitQuickRequest, toFactorInputs, type RequestResult } from './lib'
import { QuickBadge, QuickHeadline } from './parts'
import { BoeText, DriverInputs, DriverTable, FactorBuildUp, MonteCarloToggle, RateTableCompare, buildOf } from './factorParts'

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

/**
 * Full request: optional project picker (or a new need with no project), scope and driver inputs pre-filled from the
 * project, purpose, need-by, live result, "Send to estimating team". With `reviseId` it reprices a returned quick
 * estimate in place and routes it again.
 */
export function QuickRequest({ projectId, allowPicker, reviseId, onDone, onCancel }: { projectId?: string; allowPicker?: boolean; reviseId?: string; onDone?: (estimateId: string, projectId: string) => void; onCancel?: () => void }) {
  const s = useStore()
  const me = useMe()
  const model = publishedModel(s)
  const revising = reviseId ? s.estimates.find((e) => e.id === reviseId) : undefined
  const [pid, setPid] = useState<string>(revising?.projectId ?? projectId ?? NEW_NEED)
  const project = s.projects.find((p) => p.id === pid)
  const initial = (id: string): FactorInputs => {
    const p = s.projects.find((x) => x.id === id)
    if (revising?.quick) return toFactorInputs(s, p, revising.quick.inputs)
    return p && catalogOf(p.asset.type) ? (normalizeInputs(factorInputsFromProject(s, p)) as FactorInputs) : toFactorInputs(s, undefined, blankInputs(s))
  }
  const [inputs, setInputsRaw] = useState<FactorInputs>(() => initial(pid))
  const setInputs = (v: FactorInputs) => setInputsRaw(!project && v.district !== inputs.district ? { ...v, taxPct: taxForDistrict(s, v.district) } : v)
  const [note, setNote] = useState(revising?.quick?.requestNote ?? '')
  const [needBy, setNeedBy] = useState(revising?.quick?.needBy ?? '')
  const pickProject = (id: string) => { setPid(id); setInputsRaw(initial(id)) }
  const elig = revising ? { ok: canRevise(s, revising), reason: canRevise(s, revising) ? undefined : 'Only a returned or recalled estimate can be revised' } : project ? quickEligibility(s, project.id) : { ok: false, reason: undefined }
  const fromProject = project && catalogOf(project.asset.type) ? (normalizeInputs(factorInputsFromProject(s, project)) as FactorInputs) : undefined
  const differs = fromProject ? (['assetType', 'workMethod', 'diameterBand', 'terrain', 'district', 'qty', 'midpointYear'] as const).filter((k) => fromProject[k] !== inputs[k]) : []
  const driverDiffs = fromProject ? (Object.keys(inputs.site) as (keyof FactorInputs['site'])[]).filter((k) => fromProject.site[k] !== inputs.site[k]) : []
  const problems = [!model && 'No published factor model', !inputs.qty && 'Enter a quantity', !note.trim() && 'Say what the estimate is for', !elig.ok && elig.reason].filter(Boolean) as string[]
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
        <QuickInputsForm s={s} value={inputs} onChange={setInputs} />
        {differs.length > 0 && <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted"><span>Differs from the project record ({differs.join(', ').replace('assetType', 'asset').replace('workMethod', 'method').replace('diameterBand', 'band').replace('midpointYear', 'midpoint')}).</span><button className="font-semibold text-link" onClick={() => setInputsRaw({ ...fromProject!, site: inputs.site })}>Reset scope to project</button></div>}
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="eyebrow">Site cost drivers</span>{project && <span className="text-[11.5px] text-muted">{driverDiffs.length ? <>{driverDiffs.length} changed from the project record · <button className="font-semibold text-link" onClick={() => setInputsRaw({ ...inputs, site: { ...fromProject!.site } })}>Reset drivers</button></> : 'From the project record'}</span>}</div>
          <DriverInputs value={inputs} onChange={setInputs} fromProject={fromProject} />
          <p className="text-[11.5px] text-muted">Physical, legal and logistical conditions only. Community demographics and income are never model inputs.</p>
        </div>
        {pid !== NEW_NEED && <>
          <Field label="What is it for">
            <TextArea id="q-note" className="min-h-[60px]" placeholder="e.g. Screening number for the TY2028 GRC forecast" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="-mt-1 flex flex-wrap gap-1">{PURPOSES.map((x) => <button key={x} type="button" onClick={() => setNote(x)} className={cx('rounded border px-2 py-0.5 text-[11.5px]', note === x ? 'border-ink bg-ink text-surface' : 'border-line text-muted hover:text-ink')}>{x}</button>)}</div>
          <Field label="Needed by (optional)" className="max-w-[220px]"><Input id="q-needby" type="date" min={s.settings.asOf} value={needBy} onChange={(e) => setNeedBy(e.target.value)} /></Field>
        </>}
        {pid !== NEW_NEED ? (
          <div className="flex flex-col gap-2 rounded-md border border-marker/60 bg-marker/5 p-3">
            <div className="text-[12.5px] text-muted">Routes to the estimating team (any estimator) to check the drivers and the rate-table cross-check, adjust with a reason from the override list if needed, and approve. The approved number becomes the project's Class 5 estimate of record.</div>
            {problems.length > 0 && <ul className="text-[12px] text-warn">{problems.map((p) => <li key={p}>· {p}</li>)}</ul>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={problems.length > 0} onClick={send}>{revising ? 'Resubmit to estimating team' : 'Send to estimating team'}</Button>
              {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
            </div>
          </div>
        ) : (
          <Callout tone="info" title="No project yet">This number is not saved. When the need is confirmed, <button className="font-semibold text-link" onClick={() => go('#new-project')}>start a new project</button>, then request the quick estimate on it so the estimating team can review it.</Callout>
        )}
      </div>
      <Panel className="min-w-0 self-start" title={<span className="inline-flex items-center gap-2">Live estimate <QuickBadge /></span>} subtitle={project ? `${project.code} · ${project.name}` : 'Unsaved — new need'}>
        {model ? <FactorResultView s={s} model={model} inputs={inputs} project={project} /> : <Callout tone="bad" title="No published factor model">The estimating lead has to publish a factor model (Estimating → Administration → Factor model) before quick estimates can be priced.</Callout>}
      </Panel>
    </div>
  )
}
