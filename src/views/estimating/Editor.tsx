// Estimate builder / viewer (ES-04, ES-06, ES-07, ES-08, ES-09, ES-12).
// Drafts are edited in a working copy and saved as one audited change; anything else is read-only.
import { prefs } from '@/core/data'
import { useEffect, useMemo, useRef, useState } from 'react'
import { produce } from 'immer'
import type { AaceClass, AppState, Estimate, EstimateLine, LineSource, MonteCarloResult, Project } from '@/core/types'
import { getState, mutate, personName, useMe, useStore } from '@/core/store'
import { CLASS_RANGES, benchmark, computeClass, estimateTotals, lineTotal, maturityItems, missingFor, regionalUnitCost } from '@/core/engine/estimates'
import { applyTables, canOverrideUnitCost, contingencyForClass, currentLoaders, escalationPctFor, basisYearOf, loaderYear, pricedOnVersion, pricingFor, rowForRegion, salesTaxFor, scopeQuantities, tablesDrift } from '@/core/engine/estimatingAdmin'
import { templateFor } from '@/core/engine/gates'
import { monteCarlo } from '@/core/engine/risk'
import { ask, aiMessage, useAiAvailable } from '@/core/ai'
import { cx, fmtDate, money, moneyDelta, pct, sum, uid } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, ClassBadge, Field, Input, Modal, Panel, SegButtons, Select, StatusBadge, Tabs, TextArea } from '@/ui/kit'
import { BoeDownload } from './BoeDownload'
import { Histogram, RangeBar } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '../shared/WorkflowStatus'
import {
  SOURCE_LABEL, activeRisks, benchmarkExceptions, catCode, catName, classJustification, contingencyRationale,
  directCategories, estimateFacts, displayTitle, isEditable, latestApproved, methodLabel, midpointYear, riskBasedPct, sourceSummary, submitEstimate, workPackages,
} from './lib'
import { NumInput, SpreadBar, cellInp } from './parts'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
type SubTab = 'lines' | 'maturity' | 'markups' | 'boe'

export function EstimateEditor({ estimate, project, onCopy }: { estimate: Estimate; project: Project; onCopy: (src: Estimate) => void }) {
  const s = useStore()
  const editable = isEditable(estimate)
  const [w, setW] = useState<Estimate>(() => clone(estimate))
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<SubTab>('lines')
  const wRef = useRef(w), dirtyRef = useRef(dirty)
  wRef.current = w; dirtyRef.current = dirty

  // Switching estimates: autosave unsaved edits of the one being left.
  useEffect(() => {
    setW(clone(estimate)); setDirty(false)
    return () => { if (dirtyRef.current) { persist(wRef.current, true); toast(`Saved changes to v${wRef.current.version}`) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate.id])
  // External changes (status, workflow) flow in when nothing is pending locally.
  useEffect(() => { if (!dirtyRef.current) setW(clone(estimate)) }, [estimate])

  const cur = editable ? w : estimate
  const items = maturityItems(s)
  const cls = computeClass(cur.maturity, items)
  const live: Estimate = { ...cur, cls: editable ? cls : cur.cls }
  const t = estimateTotals(live)
  const edit = (fn: (d: Estimate) => void) => { if (!editable) return; setW((x) => produce(x, fn)); setDirty(true) }

  const risks = useMemo(() => activeRisks(s, project.id), [s.risks, project.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const mc = useMemo(() => (t.base > 0 ? monteCarlo(project.id, risks, t.base, 0, s.settings.asOf, 3000) : undefined), [risks, t.base, project.id, s.settings.asOf])

  function persist(x: Estimate, auto = false) {
    const c = computeClass(x.maturity, maturityItems(getState()))
    const tt = estimateTotals({ ...x, cls: c })
    const prev = getState().estimates.find((y) => y.id === x.id)
    const ovr = x.lines.filter((l) => l.override && JSON.stringify(prev?.lines.find((y) => y.id === l.id)?.override) !== JSON.stringify(l.override))
      .map((l) => `${l.description} ${money(l.override!.fromUnitCost, 'full')} → ${money(l.unitCost, 'full')}/${l.unit} (${l.override!.reason})`)
    const unovr = (prev?.lines ?? []).filter((l) => l.override && !x.lines.find((y) => y.id === l.id)?.override).map((l) => l.description)
    mutate((d) => {
      const e = d.estimates.find((y) => y.id === x.id)
      if (!e || e.status !== 'draft') return
      e.title = x.title; e.method = x.method; e.lines = x.lines; e.maturity = x.maturity; e.loaders = x.loaders
      e.escalationPct = x.escalationPct; e.contingency = x.contingency; e.basis = x.basis; e.cls = c
      e.salesTax = x.salesTax; e.region = x.region; e.rateTableVersion = x.rateTableVersion
    }, { entity: 'estimate', entityId: x.id, projectId: x.projectId, action: auto ? 'autosave' : 'save', summary: `${auto ? 'Autosaved' : 'Saved'} draft v${x.version}: ${x.lines.length} lines, Class ${c}, ${money(tt.total)} (${money(tt.low)}–${money(tt.high)})${ovr.length ? `; unit-cost override${ovr.length > 1 ? 's' : ''}: ${ovr.join('; ')}` : ''}${unovr.length ? `; override removed: ${unovr.join(', ')}` : ''}` })
  }
  const save = () => { persist(w); setDirty(false); toast('Draft saved') }
  const discard = () => { setW(clone(estimate)); setDirty(false); toast('Changes discarded', 'info') }

  // ── Submit for approval (ES-09)
  const issues = submitIssues(live, t)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const submit = () => {
    const x = w
    persist(x)
    setDirty(false)
    const c = computeClass(x.maturity, maturityItems(getState()))
    const total = estimateTotals({ ...x, cls: c }).total
    let msg = ''
    mutate((d) => { msg = submitEstimate(d, x.id, x.contingency.method === 'risk-based' ? mc : undefined) }, { entity: 'estimate', entityId: x.id, projectId: project.id, action: 'submit', summary: `Submitted v${x.version} Class ${c} estimate (${money(total)}) for approval` })
    setConfirmSubmit(false)
    toast(msg)
  }
  const boeEstimate = () => { const e = getState().estimates.find((x) => x.id === estimate.id)!; return editable ? { ...wRef.current, cls: computeClass(wRef.current.maturity, maturityItems(getState())) } : e }
  const boeMc = live.contingency.method === 'risk-based' ? mc : undefined
  const rateV = s.settings.estimating.rateTableVersion
  const pricedV = cur.method === 'quick' ? undefined : pricedOnVersion(s, cur)
  const drift = editable ? tablesDrift(s, project, w) : []

  const prevApproved = latestApproved(s, project.id)
  const compareTo = prevApproved && prevApproved.id !== estimate.id ? prevApproved : undefined
  const gate = templateFor(s, project).stages[project.stageIndex]?.gate

  return (
    <div className="flex flex-col gap-3">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-muted">v{cur.version}</span>
            {editable ? (
              <Input id="est-title" aria-label="Estimate title" className="h-8 max-w-sm font-display text-[16px] font-semibold" value={w.title} onChange={(e) => edit((d) => { d.title = e.target.value })} />
            ) : <h2 className="font-display text-[18px] font-bold leading-tight">{displayTitle(cur)}</h2>}
            <ClassBadge cls={live.cls} size="lg" />
            <StatusBadge status={cur.status} />
            {dirty && <Badge tone="marker">Unsaved changes</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">Method {editable ? <SegButtons value={w.method} onChange={(v) => edit((d) => { d.method = v })} options={[{ id: 'parametric', label: 'Rate-table (Class 5)' }, { id: 'line-item', label: 'Line-item' }]} /> : <b className="text-ink">{methodLabel(cur.method)}</b>}</span>
            {pricedV != null && <span className="inline-flex items-center gap-1.5">Rate table <b className="text-ink">v{pricedV}</b>{pricedV < rateV && <Badge tone="warn" title={`Rate table v${rateV} has been published since this estimate was priced`}>v{rateV} available</Badge>}</span>}
            <span>Region <b className="text-ink">{cur.region ?? project.location.district}</b></span>
            <span>Prepared by <b className="text-ink">{personName(s, cur.createdById)}</b> · {fmtDate(cur.createdAt.slice(0, 10))}</span>
            {cur.approvedAt && <span>Approved by <b className="text-ink">{personName(s, cur.approvedById)}</b> · {fmtDate(cur.approvedAt.slice(0, 10))}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && dirty && <><Button variant="ghost" onClick={discard}>Discard changes</Button><Button onClick={save}>Save draft</Button></>}
          {editable && <Button variant="marker" onClick={() => setConfirmSubmit(true)}>Submit for approval</Button>}
          <BoeDownload get={boeEstimate} project={project} mc={boeMc} />
          {!editable && cur.status !== 'in-review' && <Button onClick={() => onCopy(estimate)}>New version from this</Button>}
        </div>
      </div>

      {!editable && (
        <Callout tone={cur.status === 'approved' ? 'good' : cur.status === 'in-review' ? 'info' : 'warn'} title={cur.status === 'approved' ? 'Approved and locked' : cur.status === 'in-review' ? 'In review — locked while routing' : cur.status === 'superseded' ? 'Superseded — locked' : 'Rejected — locked'}>
          {cur.status === 'approved' && <>This version is the estimate of record{cur.approvedAt ? ` since ${fmtDate(cur.approvedAt.slice(0, 10))}` : ''}. To revise it, create a new version; the approved one stays exactly as signed.</>}
          {cur.status === 'in-review' && <>The estimate is in the approval workflow. The submitter can recall it to make changes; approvers act below.</>}
          {cur.status === 'superseded' && <>A later approved version replaced this one. It is kept unchanged for the record and for accuracy tracking.</>}
          {cur.status === 'rejected' && <>Create a new version to address the reviewer comments.</>}
        </Callout>
      )}
      {editable && drift.length > 0 && (
        <Callout tone="marker" title="Portfolio tables have changed since this draft was priced">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Loaders, escalation and sales tax are locked to the estimating team's tables: {drift.join('; ')}.</span>
            <Button size="sm" onClick={() => { edit((d) => { const x = applyTables(getState(), project, d as Estimate); d.loaders = x.loaders; d.escalationPct = x.escalationPct; d.salesTax = x.salesTax; d.region = x.region }); toast('Current portfolio tables applied — review and save', 'info') }}>Apply current tables</Button>
          </div>
        </Callout>
      )}
      {cur.workflowInstanceId && <WorkflowStatus instanceId={cur.workflowInstanceId} compact={cur.status !== 'in-review'} />}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs<SubTab> value={tab} onChange={setTab} tabs={[
            { id: 'lines', label: 'Line items', count: cur.lines.length },
            { id: 'maturity', label: <span className="inline-flex items-center gap-1.5">Maturity & class <ClassBadge cls={live.cls} /></span> },
            { id: 'markups', label: 'Markups & contingency' },
            { id: 'boe', label: 'Basis of estimate' },
          ]} />
          {tab === 'lines' && <LineGrid s={s} project={project} e={cur} editable={editable} edit={edit} />}
          {tab === 'maturity' && <MaturityPanel s={s} project={project} e={cur} cls={live.cls} editable={editable} edit={edit} gateClass={gate?.requiredEstimateClass} gateName={gate?.name} />}
          {tab === 'markups' && <MarkupsPanel s={s} project={project} e={live} editable={editable} edit={edit} mc={mc} riskCount={risks.length} base={t.base} />}
          {tab === 'boe' && <BoePanel s={s} project={project} e={live} editable={editable} edit={edit} mc={mc} riskCount={risks.length} download={<BoeDownload size="sm" variant="primary" get={boeEstimate} project={project} mc={boeMc} />} />}
        </div>
        <TotalsPanel s={s} e={live} compareTo={compareTo} />
      </div>

      <Modal open={confirmSubmit} onClose={() => setConfirmSubmit(false)} title={`Submit v${w.version} for approval`}
        footer={<><Button variant="ghost" onClick={() => setConfirmSubmit(false)}>Cancel</Button><Button variant="primary" disabled={issues.some((i) => i.block)} onClick={submit}>Submit for approval</Button></>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Mini label="Total" value={money(t.total)} />
            <Mini label="AACE class" value={<ClassBadge cls={cls} size="lg" />} />
            <Mini label="Expected range" value={`${money(t.low)}–${money(t.high)}`} />
          </div>
          <p className="text-muted">Routes through <b className="text-ink">Estimate approval</b>: estimating lead review, PM concurrence, project controls acceptance, then the version locks. The amount ({money(t.total)}) and class travel with the request.</p>
          {gate?.requiredEstimateClass && cls > gate.requiredEstimateClass && <Callout tone="warn" title={`${gate.name} needs Class ${gate.requiredEstimateClass}`}>This draft computes to Class {cls}. It can be approved, but it will not satisfy the gate until the maturity items for Class {gate.requiredEstimateClass} are complete.</Callout>}
          {issues.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {issues.map((i) => <li key={i.text} className={cx('flex gap-2', i.block ? 'text-bad' : 'text-warn')}><span aria-hidden>{i.block ? '✕' : '!'}</span>{i.text}</li>)}
            </ul>
          ) : <Callout tone="good">All checks pass: lines priced, basis of estimate complete, no unexplained benchmark exceptions.</Callout>}
        </div>
      </Modal>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded border border-line px-3 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div><div className="mt-0.5 font-display text-[17px] font-bold tabular-nums">{value}</div></div>
}

function submitIssues(e: Estimate, t: ReturnType<typeof estimateTotals>) {
  const out: { text: string; block: boolean }[] = []
  if (!e.lines.length) out.push({ text: 'Add at least one line item.', block: true })
  const unpriced = e.lines.filter((l) => !(l.qty > 0) || !(l.unitCost > 0))
  if (unpriced.length) out.push({ text: `${unpriced.length} line(s) have zero quantity or unit cost.`, block: true })
  const nodesc = e.lines.filter((l) => !l.description.trim())
  if (nodesc.length) out.push({ text: `${nodesc.length} line(s) have no description.`, block: true })
  if (!e.basis.scopeBasis.trim()) out.push({ text: 'Basis of estimate needs a scope basis.', block: true })
  if (!e.basis.classJustification.trim()) out.push({ text: 'Basis of estimate needs a class justification.', block: false })
  if (!e.basis.contingencyRationale.trim()) out.push({ text: 'Basis of estimate needs a contingency rationale.', block: false })
  if (!e.basis.assumptions.length) out.push({ text: 'No assumptions recorded.', block: false })
  const st = getState()
  const ex = benchmarkExceptions(e, st.rates, st.settings.estimating.regionFactors).filter((x) => !x.line.override)
  if (ex.length && !e.basis.assumptions.some((a) => /benchmark|library|rate table|above|below|quote/i.test(a))) out.push({ text: `${ex.length} line(s) are more than 25% from the rate-table median; explain them in the assumptions.`, block: false })
  const units = new Set(st.settings.estimating.units.map((u) => u.id))
  const badUnit = e.lines.filter((l) => !units.has(l.unit))
  if (badUnit.length) out.push({ text: `${badUnit.length} line(s) use a unit that is not on the allowed-units list (${Array.from(new Set(badUnit.map((l) => l.unit))).join(', ')}).`, block: true })
  const p = st.projects.find((x) => x.id === e.projectId)
  const drift = p ? tablesDrift(st, p, e) : []
  if (drift.length) out.push({ text: `Markups differ from the portfolio tables (${drift.join('; ')}). Apply the current tables first.`, block: true })
  if (t.total <= 0) out.push({ text: 'Total is zero.', block: true })
  return out
}

// ───────────────────────────── Line items grid
type EditFn = (fn: (d: Estimate) => void) => void

function LineGrid({ s, project, e, editable, edit }: { s: AppState; project: Project; e: Estimate; editable: boolean; edit: EditFn }) {
  const me = useMe()
  const canPrice = canOverrideUnitCost(me)
  const cats = directCategories(s)
  const wps = workPackages(e)
  const units = s.settings.estimating.units
  const [picker, setPicker] = useState<string | null>(null)
  const [newWp, setNewWp] = useState('')
  const [override, setOverride] = useState<EstimateLine | null>(null)
  const pr = { region: e.region ?? project.location.district, regionFactors: s.settings.estimating.regionFactors }
  const exceptions = benchmarkExceptions({ ...e, region: pr.region }, s.rates, pr.regionFactors)
  const overrides = e.lines.filter((l) => l.override).length
  const upd = (id: string, fn: (l: EstimateLine) => void) => edit((d) => { const l = d.lines.find((x) => x.id === id); if (l) fn(l) })
  const addLine = (wp: string) => edit((d) => { d.lines.push({ id: uid('ln'), categoryId: 'cat-contract', workPackage: wp, description: '', qty: 1, unit: 'LS', unitCost: 0, source: 'judgment', confidence: 'medium' }) })
  const renameWp = (from: string, to: string) => edit((d) => { d.lines.forEach((l) => { if (l.workPackage === from) l.workPackage = to }) })
  const unitOpts = (u: string) => [...(units.some((x) => x.id === u) ? [] : [{ value: u, label: `${u} (not allowed)` }]), ...units.map((x) => ({ value: x.id, label: `${x.id} · ${x.label}` }))]

  return (
    <Panel pad={false} title="Line items by work package" subtitle={`${e.lines.length} lines · ${wps.length} work package${wps.length === 1 ? '' : 's'} · direct cost ${money(sum(e.lines.map(lineTotal)))}`}
      actions={<>
        {overrides > 0 && <Badge tone="marker" title="Unit costs overridden by the estimating team, each with a reason">{overrides} override{overrides > 1 ? 's' : ''}</Badge>}
        {exceptions.length > 0 && <Badge tone="warn" title="Unit cost more than 25% from the rate-table median for the region">{exceptions.length} benchmark exception{exceptions.length > 1 ? 's' : ''}</Badge>}
        {editable && <form className="flex items-center gap-1" onSubmit={(ev) => { ev.preventDefault(); if (!newWp.trim()) return; addLine(newWp.trim()); setNewWp('') }}>
          <Input id="new-wp" aria-label="New work package name" className="h-7 w-40 text-xs" placeholder="New work package" value={newWp} onChange={(ev) => setNewWp(ev.target.value)} />
          <Button size="sm" type="submit" disabled={!newWp.trim()}>Add package</Button>
        </form>}
      </>}>
      {editable && <div className="border-b border-line bg-sunken/40 px-4 py-2 text-[12px] text-muted">
        <b className="text-ink">Locked pricing.</b> Unit costs come from rate table v{s.settings.estimating.rateTableVersion} for the <b className="text-ink">{pr.region}</b> region and are locked. {canPrice ? 'As a member of the estimating team you can override a rate-table unit cost with a reason, and price quote or judgment lines.' : 'Only the estimating team can override a unit cost (with a reason). Add lines from the rate table to price them.'} Units are limited to the allowed-units list.
      </div>}
      {!e.lines.length && <div className="p-4"><Callout tone="info" title="No lines yet">{editable ? 'Add a work package, then add lines from the rate table or by hand.' : 'This estimate has no line items.'}</Callout></div>}
      <div className="scroll-x">
        <table className="tbl min-w-[1020px]">
          <thead>
            <tr>
              <th style={{ width: 170 }}>Category</th><th>Description</th><th className="num" style={{ width: 92 }}>Qty</th><th style={{ width: 92 }}>Unit</th>
              <th className="num" style={{ width: 128 }}>Unit cost</th><th className="num" style={{ width: 96 }}>Line total</th><th style={{ width: 118 }}>Source</th><th style={{ width: 88 }}>Confidence</th>
              <th style={{ width: 150 }}>vs rate table P50</th>{editable && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {wps.map((wp) => {
              const ls = e.lines.filter((l) => l.workPackage === wp)
              return (
                <WpGroup key={wp} wp={wp} total={sum(ls.map(lineTotal))} n={ls.length} editable={editable} onRename={(to) => renameWp(wp, to)} onAdd={() => addLine(wp)} onLibrary={() => setPicker(wp)} cols={editable ? 10 : 9}>
                  {ls.map((l) => {
                    const b = benchmark(l, s.rates, pr)
                    const r = l.rateId ? s.rates.find((x) => x.id === l.rateId) : undefined
                    const fromRate = !!r && l.source === 'library'
                    const priceEditable = editable && canPrice && !fromRate
                    return (
                      <tr key={l.id}>
                        <td>{editable && !r ? <Select aria-label="Category" className={cellInp} value={l.categoryId} onChange={(ev) => upd(l.id, (x) => { x.categoryId = ev.target.value })} options={cats.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} /> : <span className="text-[12px]"><span className="font-mono text-faint">{catCode(s, l.categoryId)}</span> {catName(s, l.categoryId)}</span>}</td>
                        <td>{editable ? <Input aria-label="Description" className={cx(cellInp, !l.description.trim() && 'border-bad/60')} value={l.description} onChange={(ev) => upd(l.id, (x) => { x.description = ev.target.value })} /> : <span className="text-[12.5px]">{l.description}</span>}
                          {l.override && <div className="mt-0.5 text-[11px] text-markerink"><span className="rounded bg-marker/40 px-1 font-semibold">Override</span> {personName(s, l.override.byId)}: {l.override.reason}</div>}
                        </td>
                        <td className="num">{editable ? <NumInput ariaLabel="Quantity" className={cellInp} value={l.qty} min={0} onChange={(v) => upd(l.id, (x) => { x.qty = v })} /> : l.qty.toLocaleString('en-US')}</td>
                        <td>{editable && !r ? <Select aria-label="Unit" className={cx(cellInp, !units.some((u) => u.id === l.unit) && 'border-bad/60')} value={l.unit} onChange={(ev) => upd(l.id, (x) => { x.unit = ev.target.value })} options={unitOpts(l.unit)} /> : <span title={r ? 'Unit set by the rate table' : undefined}>{l.unit}</span>}</td>
                        <td className="num">
                          {priceEditable ? <NumInput ariaLabel="Unit cost" className={cellInp} value={l.unitCost} min={0} onChange={(v) => upd(l.id, (x) => { x.unitCost = Math.round(v * 100) / 100 })} /> : (
                            <div className="flex items-center justify-end gap-1">
                              <span title={fromRate ? 'From the rate table — locked' : l.override ? `Overridden from ${money(l.override.fromUnitCost, 'full')}` : 'Priced by the estimating team'}>{money(l.unitCost, l.unitCost < 1e4 ? 'full' : 'compact')}</span>
                              {editable && canPrice && r && <button className="rounded px-1 text-[11px] font-semibold text-link hover:bg-sunken" onClick={() => setOverride(l)} title="Override the rate-table unit cost (reason required)">{l.override ? 'Edit' : 'Override'}</button>}
                              {editable && !canPrice && (r || l.unitCost > 0) && <span title="Locked: only the estimating team can change unit costs" className="rounded border border-line px-1 text-[9.5px] font-semibold uppercase tracking-wide text-faint">Locked</span>}
                            </div>
                          )}
                        </td>
                        <td className="num font-semibold">{money(lineTotal(l))}</td>
                        <td>{editable && canPrice && !fromRate ? <Select aria-label="Source" className={cellInp} value={l.source} onChange={(ev) => upd(l.id, (x) => { x.source = ev.target.value as LineSource })} options={(['quote', 'analog', 'judgment', ...(r ? ['library'] : [])] as LineSource[]).map((v) => ({ value: v, label: SOURCE_LABEL[v] }))} /> : <span className="text-[12px]">{SOURCE_LABEL[l.source]}</span>}</td>
                        <td>{editable ? <Select aria-label="Confidence" className={cellInp} value={l.confidence} onChange={(ev) => upd(l.id, (x) => { x.confidence = ev.target.value as EstimateLine['confidence'] })} options={['low', 'medium', 'high']} /> : <Badge tone={l.confidence === 'high' ? 'good' : l.confidence === 'low' ? 'warn' : 'neutral'}>{l.confidence}</Badge>}</td>
                        <td>
                          {b && r ? (
                            <div className="flex items-center gap-2" title={`Rate table ${r.description}${r.region ? ` (${r.region})` : ` × ${pr.region} factor`}: P50 ${money(b.ref, 'full')} · P10 ${money(r.p10, 'full')} · P90 ${money(r.p90, 'full')} (n=${r.sampleSize}, ${r.basisYear}$)`}>
                              <Badge tone={b.flag ? (b.pct > 0 ? 'bad' : 'warn') : 'neutral'}>{b.pct > 0 ? '+' : ''}{pct(b.pct)}</Badge>
                              <span className="hidden sm:block"><SpreadBar p10={r.p10} p50={r.p50} p90={r.p90} /></span>
                            </div>
                          ) : <span className="text-[11px] text-faint">Not from the rate table</span>}
                        </td>
                        {editable && <td className="text-right">
                          {wps.length > 1 && <select aria-label="Move to work package" title="Move to work package" className="mb-1 w-6 cursor-pointer bg-transparent text-[11px] text-muted" value="" onChange={(ev) => ev.target.value && upd(l.id, (x) => { x.workPackage = ev.target.value })}><option value="">⇅</option>{wps.filter((x) => x !== wp).map((x) => <option key={x} value={x}>Move to {x}</option>)}</select>}
                          <button className="rounded px-1 text-muted hover:bg-bad/10 hover:text-bad" aria-label="Remove line" title="Remove line" onClick={() => edit((d) => { d.lines = d.lines.filter((x) => x.id !== l.id) })}>✕</button>
                        </td>}
                      </tr>
                    )
                  })}
                </WpGroup>
              )
            })}
          </tbody>
        </table>
      </div>
      {editable && <RatePicker open={picker != null} onClose={() => setPicker(null)} s={s} project={project} region={pr.region} wp={picker ?? ''} onPick={(l) => { edit((d) => { d.lines.push(l) }); toast(`Added ${l.description}`) }} />}
      {override && <OverrideModal s={s} line={override} region={pr.region} onClose={() => setOverride(null)} onSave={(unitCost, reason) => {
        upd(override.id, (x) => {
          if (reason === null) { if (x.override) { x.unitCost = x.override.fromUnitCost; delete x.override; x.source = 'library' } return }
          x.override = { byId: me.id, at: new Date().toISOString(), reason, fromUnitCost: x.override?.fromUnitCost ?? x.unitCost }
          x.unitCost = unitCost
          x.source = 'library'
        })
        setOverride(null)
        toast(reason === null ? 'Override removed — rate-table unit cost restored' : 'Unit cost overridden — save the draft to keep it', 'info')
      }} />}
    </Panel>
  )
}

/** Estimating-team override of a locked rate-table unit cost. A reason is mandatory and goes into the BOE. */
function OverrideModal({ s, line, region, onClose, onSave }: { s: AppState; line: EstimateLine; region: string; onClose: () => void; onSave: (unitCost: number, reason: string | null) => void }) {
  const r = s.rates.find((x) => x.id === line.rateId)
  const rateCost = line.override?.fromUnitCost ?? line.unitCost
  const [v, setV] = useState(line.unitCost)
  const [reason, setReason] = useState(line.override?.reason ?? '')
  const ok = v > 0 && reason.trim().length >= 8 && (v !== rateCost || !!line.override)
  return (
    <Modal open onClose={onClose} title="Override rate-table unit cost"
      footer={<>{line.override && <Button variant="ghost" onClick={() => onSave(rateCost, null)}>Remove override</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onSave(Math.round(v * 100) / 100, reason.trim())}>Save override</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div><b>{line.description}</b><div className="text-xs text-muted">{line.workPackage} · {line.qty.toLocaleString('en-US')} {line.unit}{r ? ` · rate table P10 ${money(r.p10, 'full')} / P50 ${money(r.p50, 'full')} / P90 ${money(r.p90, 'full')} (base), ${region} region` : ''}</div></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate-table unit cost"><div className="pt-1 font-semibold tabular-nums">{money(rateCost, 'full')}</div></Field>
          <Field label="Override unit cost"><NumInput id="ovr-cost" value={v} min={0} onChange={setV} /></Field>
        </div>
        <Field label="Reason (required)" hint="Recorded on the line, in the audit trail and in the basis of estimate."><TextArea id="ovr-reason" className="min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vendor quote Q-2291 for 24-inch X65 dated 10/14 is 18% above the table" /></Field>
        {v > 0 && rateCost > 0 && <p className="text-xs text-muted">Change {v >= rateCost ? '+' : ''}{pct(v / rateCost - 1, 1)} · line total {money(Math.round(line.qty * rateCost))} → <b className="text-ink">{money(Math.round(line.qty * v))}</b></p>}
      </div>
    </Modal>
  )
}

function WpGroup({ wp, total, n, editable, onRename, onAdd, onLibrary, children, cols }: { wp: string; total: number; n: number; editable: boolean; onRename: (to: string) => void; onAdd: () => void; onLibrary: () => void; children: React.ReactNode; cols: number }) {
  const [name, setName] = useState(wp)
  useEffect(() => setName(wp), [wp])
  return (
    <>
      <tr className="bg-sunken/60">
        <td colSpan={cols} className="!py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {editable ? <input aria-label="Work package name" className="rounded border border-transparent bg-transparent px-1 font-display text-[13.5px] font-bold hover:border-line focus:border-link focus:outline-none" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== wp) onRename(name.trim()); else setName(wp) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
              : <span className="font-display text-[13.5px] font-bold">{wp}</span>}
            <span className="text-xs text-muted">{n} line{n === 1 ? '' : 's'}</span>
            <span className="ml-auto font-semibold tabular-nums">{money(total)}</span>
            {editable && <><Button size="sm" variant="ghost" onClick={onLibrary}>+ From library</Button><Button size="sm" variant="ghost" onClick={onAdd}>+ Line</Button></>}
          </div>
        </td>
      </tr>
      {children}
    </>
  )
}

function RatePicker({ open, onClose, s, project, region, wp, onPick }: { open: boolean; onClose: () => void; s: AppState; project: Project; region: string; wp: string; onPick: (l: EstimateLine) => void }) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const pr = pricingFor(s, project, region)
  // one row per item: the region's own row when the table keeps one, else the base row (priced × region factor)
  const rows = s.rates.filter((r) => !r.region && (all || (r.assetType === project.asset.type && r.workMethod === project.workMethod)) && (!q || (r.description + ' ' + catName(s, r.categoryId)).toLowerCase().includes(q.toLowerCase())))
    .map((b) => rowForRegion(s.rates, b, region)).slice(0, 120)
  const sq = scopeQuantities(s, project)
  const qtyFor = (unit: string) => unit === 'ft' ? sq.lengthFt || 1 : unit === 'mi' ? +((sq.lengthFt || 0) / 5280).toFixed(2) || 1 : unit === 'ea' || unit === 'site' ? (project.asset.type === 'valve-site' ? sq.sites : sq.tieIns ?? sq.sites) || 1 : unit === 'hp' ? sq.hp ?? 1 : 1
  return (
    <Modal open={open} onClose={onClose} wide title={`Add from rate table v${s.settings.estimating.rateTableVersion} · ${wp}`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input id="rate-q" className="max-w-xs" placeholder="Search rates" value={q} onChange={(e) => setQ(e.target.value)} />
        <Checkbox checked={all} onChange={setAll} label="Show all asset types and methods" />
        <span className="text-xs text-muted">Priced for the <b className="text-ink">{region}</b> region · quantities from the scope statement</span>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Rate</th><th>Category</th><th>Unit</th><th className="num">P50 (base)</th><th className="num">{region} unit cost</th><th className="num">n</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const u = regionalUnitCost(r, pr)
              return (
                <tr key={r.id}>
                  <td className="text-[12.5px]">{r.description}{all && <div className="text-[11px] text-faint">{r.assetType} · {r.workMethod}</div>}</td>
                  <td className="text-[12px]">{catName(s, r.categoryId)}</td><td>{r.unit}</td>
                  <td className="num text-muted">{money(r.p50, r.p50 < 1e4 ? 'full' : 'compact')}</td>
                  <td className="num font-semibold">{money(u.unitCost, u.unitCost < 1e4 ? 'full' : 'compact')}<div className="text-[10.5px] font-normal text-faint">{u.regional ? 'Regional rate' : `× ${u.factor.toFixed(2)} factor`}</div></td>
                  <td className="num">{r.sampleSize}</td>
                  <td><Button size="sm" onClick={() => onPick({ id: uid('ln'), categoryId: r.categoryId, workPackage: wp, description: r.description, qty: qtyFor(r.unit), unit: r.unit, unitCost: u.unitCost, source: 'library', rateId: r.id, confidence: r.sampleSize >= 8 ? 'medium' : 'low' })}>Add</Button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <p className="py-6 text-center text-[13px] text-muted">No rates match. Turn on all asset types or clear the search.</p>}
      </div>
    </Modal>
  )
}

// ───────────────────────────── Maturity checklist (ES-04)
function evidenceFor(s: AppState, p: Project, e: Estimate, key: string): { text: string; ok?: boolean } | undefined {
  const dl = (ids: string[]) => s.deliverables.filter((x) => x.projectId === p.id && ids.includes(x.defId)).sort((a, b) => b.stageIndex - a.stageIndex)[0]
  const dtxt = (ids: string[], name: string) => { const d = dl(ids); return d ? { text: `${name}: ${d.status.replace(/-/g, ' ')}`, ok: d.status === 'accepted' || d.status === 'waived' } : undefined }
  const permits = s.permits.filter((x) => x.projectId === p.id)
  const land = s.landRights.filter((x) => x.projectId === p.id)
  const risks = activeRisks(s, p.id)
  switch (key) {
    case 'need-defined': return dtxt(['d-charter', 'ds-charter'], 'Charter')
    case 'route-selected': return dtxt(['d-options'], 'Option analysis') ?? (p.stageIndex >= 1 ? { text: 'Option gate passed', ok: true } : undefined)
    case 'scope-quantities': return { text: `${p.scope.quantities.length} quantities in the scope statement`, ok: p.scope.quantities.length > 0 }
    case 'design-30': return dtxt(['d-design', 'ds-design'], 'Design package')
    case 'survey-complete': return dtxt(['d-site'], 'Site assessment & survey')
    case 'permits-identified': return { text: `${permits.length} permit${permits.length === 1 ? '' : 's'} in the permit matrix`, ok: permits.length > 0 }
    case 'land-identified': return { text: `${land.length} parcel${land.length === 1 ? '' : 's'} identified`, ok: land.length > 0 }
    case 'material-quotes': { const n = e.lines.filter((l) => l.source === 'quote').length; return { text: `${n} line${n === 1 ? '' : 's'} priced from vendor quotes`, ok: n > 0 } }
    case 'risk-register': { const q = risks.filter((r) => r.cost.max > 0); return { text: `${q.length} active risk${q.length === 1 ? '' : 's'} with three-point cost`, ok: q.length >= 3 } }
    case 'schedule-baseline': return dtxt(['d-sched', 'ds-sched'], 'Schedule')
    case 'contractor-bids': { const c = s.contracts.filter((x) => x.projectId === p.id && x.type === 'Construction'); return c.length ? { text: `Construction contract: ${c[0].status}`, ok: c[0].status !== 'rfp' } : undefined }
    case 'ifc': return dtxt(['d-design', 'ds-design'], 'IFC design')
    case 'land-acquired': return land.length ? { text: `${land.filter((x) => x.status === 'acquired').length} of ${land.length} parcels acquired`, ok: land.every((x) => x.status === 'acquired') } : undefined
  }
}

function MaturityPanel({ s, project, e, cls, editable, edit, gateClass, gateName }: { s: AppState; project: Project; e: Estimate; cls: AaceClass; editable: boolean; edit: EditFn; gateClass?: AaceClass; gateName?: string }) {
  const MATURITY_ITEMS = maturityItems(s)
  const target: AaceClass = cls > 3 ? 3 : (Math.max(1, cls - 1) as AaceClass)
  const missing3 = missingFor(e.maturity, 3, MATURITY_ITEMS)
  const missingNext = cls > 1 ? missingFor(e.maturity, (cls - 1) as AaceClass, MATURITY_ITEMS) : []
  const r = CLASS_RANGES[cls]
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Panel pad={false} title="Maturity checklist" subtitle="The AACE class is computed from these items (maintained by the estimating team). It is never typed by hand."
        actions={editable && (() => {
          const supported = MATURITY_ITEMS.filter((m) => !e.maturity[m.key] && evidenceFor(s, project, e, m.key)?.ok)
          return supported.length > 0 && <Button size="sm" onClick={() => { edit((d) => { supported.forEach((m) => { d.maturity[m.key] = true }) }); toast(`Checked ${supported.length} item${supported.length > 1 ? 's' : ''} supported by project records — review and save`, 'info') }}>Check {supported.length} supported by records</Button>
        })()}>
        {[5, 4, 3, 2, 1].map((c) => {
          const items = MATURITY_ITEMS.filter((m) => m.forClass === c)
          const done = items.filter((m) => e.maturity[m.key]).length
          return (
            <div key={c} className="border-b border-line last:border-0">
              <div className="flex items-center gap-2 bg-sunken/50 px-4 py-1.5">
                <ClassBadge cls={c as AaceClass} /><span className="text-[12px] font-semibold">Needed for Class {c}</span>
                <span className="text-xs text-muted">{CLASS_RANGES[c as AaceClass].use}</span>
                <span className={cx('ml-auto text-xs font-semibold tabular-nums', done === items.length ? 'text-good' : 'text-muted')}>{done}/{items.length}</span>
              </div>
              <ul className="divide-y divide-line/60">
                {items.map((m) => {
                  const ev = evidenceFor(s, project, e, m.key)
                  return (
                    <li key={m.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <Checkbox id={`mat-${m.key}`} checked={!!e.maturity[m.key]} disabled={!editable} onChange={(v) => edit((d) => { d.maturity[m.key] = v })} label={<span><b className="font-semibold">{m.label}</b><span className="ml-1.5 text-xs text-muted">{m.hint}</span></span>} />
                      </div>
                      {ev && <span className={cx('text-[11.5px]', ev.ok ? 'text-good' : 'text-faint')} title="What Crosswalk records show">{ev.ok ? '● ' : '○ '}{ev.text}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title="Computed class">
          <div className="flex items-center gap-3">
            <ClassBadge cls={cls} size="lg" />
            <div className="min-w-0 text-[13px]"><div className="font-semibold">Class {cls} · definition {r.definition}</div><div className="text-xs text-muted">{r.use}</div></div>
          </div>
          <div className="mt-3 text-xs text-muted">Expected accuracy <b className="text-ink">{pct(r.low)} to +{pct(r.high)}</b></div>
          {gateClass && <div className={cx('mt-3 rounded border px-2.5 py-2 text-xs', cls <= gateClass ? 'border-good/40 bg-good/5 text-good' : 'border-warn/40 bg-warn/5')}>{gateName}: requires Class {gateClass}. {cls <= gateClass ? 'This estimate meets it.' : `This estimate is Class ${cls}.`}</div>}
        </Panel>
        <Panel title={cls <= 3 ? `What's missing for Class ${target}` : "What's missing for Class 3"}>
          {(cls <= 3 ? missingNext : missing3).length === 0 ? <p className="text-[13px] text-good">{cls === 1 ? 'Every maturity item is complete.' : 'Nothing — complete.'}</p> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {(cls <= 3 ? missingNext : missing3).map((m) => <li key={m.key} className="flex gap-2"><ClassBadge cls={m.forClass} /><span className="min-w-0">{m.label}<span className="block text-xs text-faint">{m.hint}</span></span></li>)}
            </ul>
          )}
          {cls > 3 && missingNext.length > 0 && missingNext.length !== missing3.length && <p className="mt-3 text-xs text-muted">Next step: {missingNext.length} item{missingNext.length > 1 ? 's' : ''} to reach Class {cls - 1}.</p>}
        </Panel>
      </div>
    </div>
  )
}

// ───────────────────────────── Markups & contingency (ES-06, ES-07, RK-06)
function MarkupsPanel({ s, project, e, editable, edit, mc, riskCount, base }: { s: AppState; project: Project; e: Estimate; editable: boolean; edit: EditFn; mc?: MonteCarloResult; riskCount: number; base: number }) {
  const t = estimateTotals(e)
  const latestYear = loaderYear(s)
  const std = currentLoaders(s)
  const mid = midpointYear(s, project)
  const by = basisYearOf(s, e.lines)
  const suggestedEsc = escalationPctFor(s, by, mid)
  const tax = salesTaxFor(s, project)
  const p50 = mc ? riskBasedPct(mc, 'P50') : 0
  const p80 = mc ? riskBasedPct(mc, 'P80') : 0
  const conf = e.contingency.confidence ?? 'P80'
  const implied = conf === 'P50' ? p50 : p80
  const guide = contingencyForClass(s, e.cls)
  const isQuick = e.method === 'quick'
  const setRisk = (c: 'P50' | 'P80') => edit((d) => { d.contingency = { method: 'risk-based', confidence: c, pct: c === 'P50' ? p50 : p80 }; d.basis.contingencyRationale = contingencyRationale({ cls: d.cls, contingency: d.contingency }, mc, riskCount, guide) })
  const loadersDiffer = std.length !== e.loaders.length || std.some((x) => !e.loaders.some((y) => y.name === x.name && Math.abs(y.pct - x.pct) < 0.001))
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel title={<span className="inline-flex items-center gap-2">Loaders <Badge tone="ink">Portfolio · locked</Badge></span>} subtitle={`Applied to direct cost · ${latestYear} portfolio table`}
        actions={editable && loadersDiffer && <Button size="sm" onClick={() => edit((d) => { d.loaders = std })}>Apply {latestYear} table</Button>}>
        <table className="tbl">
          <thead><tr><th>Loader</th><th className="num" style={{ width: 90 }}>Rate %</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {e.loaders.map((l, i) => {
              const stdRate = std.find((x) => x.name === l.name)
              return (
                <tr key={i}>
                  <td>{l.name}{(!stdRate || stdRate.pct !== l.pct) && <div className="text-[11px] text-warn">{stdRate ? `Portfolio table now ${stdRate.pct}%` : 'Not in the current portfolio table'}</div>}</td>
                  <td className="num">{l.pct}%</td>
                  <td className="num">{money(Math.round(t.lines * l.pct / 100))}</td>
                </tr>
              )
            })}
            <tr><td className="font-semibold">Total loaders</td><td className="num font-semibold">{sum(e.loaders.map((l) => l.pct)).toFixed(1)}%</td><td className="num font-semibold">{money(t.loaders)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-muted">Payroll taxes, AFUDC and overheads are set portfolio-wide by the estimating team in <a className="font-semibold text-link" href="#estimating" onClick={() => { try { prefs.setRaw('crosswalk:estimating:tab', 'admin'); prefs.setRaw('crosswalk:estimating:admin', 'markups') } catch { /* storage blocked */ } }}>Estimating administration</a>. They cannot be changed on a project estimate.</p>
      </Panel>

      <Panel title={<span className="inline-flex items-center gap-2">Escalation <Badge tone="ink">Portfolio · locked</Badge></span>} subtitle="Applied to direct cost plus sales tax and loaders">
        <div className="flex flex-wrap items-end gap-4">
          <div><div className="text-xs text-muted">Escalation</div><div className="font-display text-[20px] font-bold tabular-nums">{e.escalationPct}%</div></div>
          <div className="text-[13px]"><div className="text-xs text-muted">Amount</div><div className="font-semibold tabular-nums">{money(t.escalation)}</div></div>
        </div>
        {isQuick ? <p className="mt-3 text-xs text-muted">Escalation is already in the escalated historical rate of the quick estimate.</p> : (
          <div className="mt-3 rounded border border-line bg-sunken/40 px-3 py-2 text-xs text-muted">
            Rate-table rows are in {by}$. Spend midpoint for this project is <b className="text-ink">{mid}</b> (today to in-service forecast). Compounding the portfolio escalation table ({Object.entries(s.settings.escalationByYear).filter(([y]) => +y > by && +y <= mid).map(([y, v]) => `${y} ${v}%`).join(', ') || 'no years'}) gives <b className="text-ink">{suggestedEsc}%</b>.
            {editable && Math.abs(suggestedEsc - e.escalationPct) > 0.05 && <div className="mt-1.5"><Button size="sm" onClick={() => edit((d) => { d.escalationPct = suggestedEsc })}>Apply {suggestedEsc}% from the table</Button></div>}
          </div>
        )}
      </Panel>

      {!isQuick && (
        <Panel className="lg:col-span-2" title="Sales tax" subtitle="Computed on taxable categories from the county sales-tax table and the project's county split">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="scroll-x">
              <table className="tbl">
                <thead><tr><th>County</th><th className="num">Share of work</th><th className="num">Tax rate</th><th className="num">Weighted</th></tr></thead>
                <tbody>
                  {(e.salesTax ?? tax).counties.map((c) => <tr key={c.county}><td>{c.county}</td><td className="num">{pct(c.share)}</td><td className="num">{c.rate}%</td><td className="num">{(c.share * c.rate).toFixed(3)}%</td></tr>)}
                  <tr><td className="font-semibold">Effective rate</td><td /><td /><td className="num font-semibold">{(e.salesTax ?? tax).pct}%</td></tr>
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-1 text-[13px]">
              <div className="text-xs text-muted">Taxable categories</div>
              <div className="text-[12px]">{(e.salesTax ?? tax).categoryIds.map((c) => catName(s, c)).join(', ')}</div>
              <div className="mt-2 text-xs text-muted">Sales tax on this estimate</div>
              <div className="font-display text-[20px] font-bold tabular-nums">{e.salesTax ? money(t.tax) : '—'}</div>
              {!e.salesTax && <p className="text-xs text-warn">Not applied to this version (priced before the county tax table).</p>}
              {editable && (!e.salesTax || Math.abs(e.salesTax.pct - tax.pct) > 0.0005) && <Button size="sm" onClick={() => edit((d) => { d.salesTax = tax })}>Apply {tax.pct}% from the county table</Button>}
            </div>
          </div>
        </Panel>
      )}

      <Panel className="lg:col-span-2" title="Contingency" subtitle="Deterministic by class from the estimating team's table, or risk-based from the project's quantified risk register"
        actions={editable ? <SegButtons value={e.contingency.method} onChange={(m) => m === 'risk-based' ? setRisk(conf) : edit((d) => { d.contingency = { method: 'deterministic', pct: guide }; d.basis.contingencyRationale = contingencyRationale({ cls: d.cls, contingency: d.contingency }, undefined, undefined, guide) })} options={[{ id: 'deterministic', label: 'Deterministic %' }, { id: 'risk-based', label: 'Risk-based (Monte Carlo)' }]} /> : <Badge>{e.contingency.method === 'risk-based' ? `Risk-based · ${conf}` : 'Deterministic'}</Badge>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-3">
              <Field label="Contingency % of base" className="w-36">{editable && e.contingency.method === 'deterministic' ? <NumInput id="cont-pct" value={e.contingency.pct} min={0} onChange={(v) => edit((d) => { d.contingency.pct = v })} /> : <div className="font-display text-[22px] font-bold tabular-nums">{e.contingency.pct}%</div>}</Field>
              <div className="pb-1 text-[13px]"><div className="text-xs text-muted">Amount</div><div className="font-semibold tabular-nums">{money(t.contingency)}</div></div>
            </div>
            {e.contingency.method === 'deterministic' ? (
              <div className="text-xs text-muted">Estimating standard for Class {e.cls}: <b className="text-ink">{guide}%</b>.{editable && e.contingency.pct !== guide && <> <button className="font-semibold text-link" onClick={() => edit((d) => { d.contingency.pct = guide })}>Use {guide}%</button></>}</div>
            ) : (
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2"><span className="text-muted">Confidence</span>{editable ? <SegButtons value={conf} onChange={(c) => setRisk(c)} options={[{ id: 'P50', label: `P50 · ${p50}%` }, { id: 'P80', label: `P80 · ${p80}%` }]} /> : <b>{conf}</b>}</div>
                {mc && Math.abs(implied - e.contingency.pct) > 0.05 && (
                  <div className="rounded border border-marker/60 bg-marker/10 px-2 py-1.5">The risk register now implies <b>{implied}%</b> at {conf}; this estimate carries {e.contingency.pct}%.{editable && <> <button className="font-semibold text-link" onClick={() => setRisk(conf)}>Apply {implied}%</button></>}</div>
                )}
              </div>
            )}
          </div>
          <div className="min-w-0">
            {mc && riskCount > 0 ? (
              <>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                  <span>Monte Carlo of {riskCount} active risks on base {money(base)} · {mc.iterations.toLocaleString('en-US')} iterations</span>
                  <a className="font-semibold text-link" href={`#p-${project.id.replace(/\D/g, '')}-risk`}>Open risk register</a>
                </div>
                <Histogram bins={mc.histogram} height={170} markers={[{ x: mc.costP.P50, label: 'P50', color: 'rgb(var(--link))' }, { x: mc.costP.P80, label: 'P80', color: 'rgb(var(--bad))' }]} />
                <div className="mt-1 grid grid-cols-4 gap-2 text-center text-[11.5px]">
                  {(['P10', 'P50', 'P80', 'P90'] as const).map((k) => <div key={k} className="rounded bg-sunken/60 py-1"><div className="text-faint">{k}</div><div className="font-semibold tabular-nums">{money(mc.costP[k])}</div><div className="text-faint">+{riskBasedPct(mc, k as 'P50')}%</div></div>)}
                </div>
              </>
            ) : <Callout tone="info" title="No quantified risks">Add risks with three-point cost impacts on the project's risk register to size contingency from risk. Until then use the deterministic class percentage.</Callout>}
          </div>
        </div>
      </Panel>
    </div>
  )
}

// ───────────────────────────── Basis of estimate (ES-08)
interface BoeDraft { scopeBasis: string; assumptions: string[]; exclusions: string[]; contingencyRationale: string; classJustification: string }

function BoePanel({ s, project, e, editable, edit, mc, riskCount, download }: { s: AppState; project: Project; e: Estimate; editable: boolean; edit: EditFn; mc?: MonteCarloResult; riskCount: number; download: React.ReactNode }) {
  const ai = useAiAvailable()
  const [busy, setBusy] = useState(false)
  const [stream, setStream] = useState('')
  const [draft, setDraft] = useState<BoeDraft | null>(null)
  const [err, setErr] = useState('')
  const t = estimateTotals(e)
  const srcs = sourceSummary(e)
  const ex = benchmarkExceptions(e, s.rates, s.settings.estimating.regionFactors)
  const guide = contingencyForClass(s, e.cls)
  const runAi = async () => {
    setBusy(true); setErr(''); setDraft(null); setStream('Thinking…')
    const facts = estimateFacts(s, e)
    const prompt = `You are a senior cost estimator at a US gas utility writing the Basis of Estimate (BOE) for a capital project estimate, following AACE 34R-05 practice. Data is a fictional demo.
Write from the facts below only. Do not invent quantities, prices or permits that are not implied by the facts. Be specific and concise, utility-professional tone.

FACTS (JSON):
${JSON.stringify(facts)}

Return ONLY a JSON object, no prose and no code fences, with exactly these keys:
{"scopeBasis": string (2-4 sentences: what is estimated and from what definition), "assumptions": string[] (5-8 items), "exclusions": string[] (3-6 items), "contingencyRationale": string (1-3 sentences consistent with the contingency method and percent given), "classJustification": string (1-3 sentences tying the AACE class to the completed and missing maturity items)}`
    try {
      const txt = await ask(prompt, { onText: (x) => setStream(x) })
      const m = txt.match(/\{[\s\S]*\}/)
      const j = JSON.parse(m ? m[0] : txt) as BoeDraft
      if (!j.scopeBasis || !Array.isArray(j.assumptions)) throw new Error('bad')
      setDraft({ scopeBasis: j.scopeBasis, assumptions: j.assumptions.map(String), exclusions: (j.exclusions ?? []).map(String), contingencyRationale: String(j.contingencyRationale ?? ''), classJustification: String(j.classJustification ?? '') })
    } catch (x) { setErr(x instanceof Error && x.message === 'bad' ? 'The AI reply had an unexpected format. Try again.' : aiMessage(x)) } finally { setBusy(false); setStream('') }
  }
  const accept = () => {
    if (!draft) return
    edit((d) => { d.basis = { ...draft } })
    mutate(() => {}, { entity: 'estimate', entityId: e.id, projectId: project.id, action: 'ai-accept', summary: `Accepted AI-drafted basis of estimate into draft v${e.version} (edited by ${personName(getState(), getState().currentUserId)} before saving)` })
    setDraft(null); toast('AI draft accepted into the BOE — review and save')
  }
  const list = (v: string) => v.split('\n').map((x) => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Panel title="Basis of estimate" subtitle="What the number rests on. Exported with every line, markup, source and approval."
        actions={<>
          {editable && ai !== false && <Button size="sm" onClick={runAi} disabled={busy} icon={<span aria-hidden>✦</span>}>{busy ? 'Drafting…' : 'AI draft BOE'}</Button>}
          {download}
        </>}>
        {err && <div className="mb-3"><Callout tone="bad">{err}</Callout></div>}
        {busy && <div className="mb-3 whitespace-pre-wrap rounded border border-info/40 bg-info/5 px-3 py-2 font-mono text-[11.5px] text-muted">{stream.slice(-600)}</div>}
        {draft && (
          <div className="mb-4 rounded-md border border-info/50 bg-info/5 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2"><AiTag /><span className="text-[13px] font-semibold">Suggested basis of estimate</span><span className="text-xs text-muted">Nothing changes until you accept.</span>
              <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button><Button size="sm" variant="primary" onClick={accept}>Accept into draft</Button></span></div>
            <div className="flex flex-col gap-2 text-[13px]">
              <p><b>Scope basis.</b> {draft.scopeBasis}</p>
              <div><b>Assumptions</b><ul className="ml-5 list-disc">{draft.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>
              <div><b>Exclusions</b><ul className="ml-5 list-disc">{draft.exclusions.map((a) => <li key={a}>{a}</li>)}</ul></div>
              <p><b>Contingency.</b> {draft.contingencyRationale}</p>
              <p><b>Class.</b> {draft.classJustification}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <Field label="Scope basis">{editable ? <TextArea id="boe-scope" value={e.basis.scopeBasis} onChange={(x) => edit((d) => { d.basis.scopeBasis = x.target.value })} /> : <p className="text-[13px]">{e.basis.scopeBasis || '—'}</p>}</Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Assumptions" hint={editable ? 'One per line' : undefined}>{editable ? <ListArea id="boe-assume" value={e.basis.assumptions} onChange={(v) => edit((d) => { d.basis.assumptions = list(v) })} /> : <Bullets items={e.basis.assumptions} />}</Field>
            <Field label="Exclusions" hint={editable ? 'One per line' : undefined}>{editable ? <ListArea id="boe-excl" value={e.basis.exclusions} onChange={(v) => edit((d) => { d.basis.exclusions = list(v) })} /> : <Bullets items={e.basis.exclusions} />}</Field>
          </div>
          <Field label={<span className="flex items-center justify-between gap-2">Contingency rationale {editable && <button type="button" className="text-[11px] font-semibold text-link" onClick={(ev) => { ev.preventDefault(); edit((d) => { d.basis.contingencyRationale = contingencyRationale(e, mc, riskCount, guide) }) }}>Generate from contingency settings</button>}</span>}>
            {editable ? <TextArea id="boe-cont" className="min-h-[56px]" value={e.basis.contingencyRationale} onChange={(x) => edit((d) => { d.basis.contingencyRationale = x.target.value })} /> : <p className="text-[13px]">{e.basis.contingencyRationale || '—'}</p>}
          </Field>
          <Field label={<span className="flex items-center justify-between gap-2">Class justification {editable && <button type="button" className="text-[11px] font-semibold text-link" onClick={(ev) => { ev.preventDefault(); edit((d) => { d.basis.classJustification = classJustification(d.maturity, maturityItems(s)) }) }}>Generate from maturity checklist</button>}</span>}>
            {editable ? <TextArea id="boe-class" className="min-h-[56px]" value={e.basis.classJustification} onChange={(x) => edit((d) => { d.basis.classJustification = x.target.value })} /> : <p className="text-[13px]">{e.basis.classJustification || '—'}</p>}
          </Field>
        </div>
      </Panel>
      <div className="flex flex-col gap-3">
        <Panel title="Sources of pricing" pad={false}>
          <table className="tbl">
            <thead><tr><th>Source</th><th className="num">Lines</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
            <tbody>{srcs.map((x) => <tr key={x.source}><td>{SOURCE_LABEL[x.source]}</td><td className="num">{x.n}</td><td className="num">{money(x.amount)}</td><td className="num text-muted">{t.lines ? pct(x.amount / t.lines) : '—'}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Benchmark exceptions" subtitle="Lines more than 25% from the rate-table P50 for the region">
          {ex.length === 0 ? <p className="text-[13px] text-good">None. Every rate-table line is within 25% of its median.</p> : (
            <ul className="flex flex-col gap-1.5 text-[12.5px]">
              {ex.map((x) => <li key={x.line.id} className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="text-faint">{x.line.workPackage}</span> · {x.line.description}</span><Badge tone={x.b.pct > 0 ? 'bad' : 'warn'}>{x.b.pct > 0 ? '+' : ''}{pct(x.b.pct)}</Badge></li>)}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function ListArea({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(value.join('\n'))
  const joined = value.join('\n')
  const last = useRef(joined)
  useEffect(() => { if (joined !== last.current) { setTxt(joined); last.current = joined } }, [joined])
  return <TextArea id={id} className="min-h-[120px]" value={txt} onChange={(e) => { setTxt(e.target.value); onChange(e.target.value); last.current = e.target.value.split('\n').map((x) => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).join('\n') }} />
}
const Bullets = ({ items }: { items: string[] }) => items.length ? <ul className="ml-5 list-disc text-[13px]">{items.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="text-[13px] text-muted">None recorded</p>

// ───────────────────────────── Live totals (ES-05)
function TotalsPanel({ s, e, compareTo }: { s: AppState; e: Estimate; compareTo?: Estimate }) {
  const t = estimateTotals(e)
  const cats = Object.entries(t.direct).sort((a, b) => b[1] - a[1])
  const r = CLASS_RANGES[e.cls]
  const prev = compareTo ? estimateTotals(compareTo) : undefined
  return (
    <aside className="min-w-0 xl:sticky xl:top-3 xl:self-start">
      <Panel pad={false} title="Estimate totals" subtitle="Updates as you edit">
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">Total estimate</span>
            <ClassBadge cls={e.cls} />
          </div>
          <div className="font-display text-[30px] font-bold leading-tight tabular-nums">{money(t.total)}</div>
          <div className="text-xs text-muted tabular-nums">{money(t.total, 'full')}</div>
          <div className="mt-3"><RangeBar low={t.low} point={t.total} high={t.high} /></div>
          <div className="flex justify-between text-[11.5px] tabular-nums text-muted"><span>Low {money(t.low)} ({pct(r.low)})</span><span>High {money(t.high)} (+{pct(r.high)})</span></div>
          {prev && compareTo && <div className="mt-2 rounded bg-sunken/60 px-2 py-1.5 text-xs">vs approved v{compareTo.version} (Class {compareTo.cls}, {money(prev.total)}): <b className={t.total > prev.total ? 'text-bad' : 'text-good'}>{moneyDelta(t.total - prev.total)}</b> ({prev.total ? (t.total >= prev.total ? '+' : '') + pct(t.total / prev.total - 1, 1) : '—'})</div>}
        </div>
        <table className="tbl">
          <tbody>
            {cats.map(([k, v]) => <tr key={k}><td className="text-[12px]"><span className="font-mono text-faint">{catCode(s, k)}</span> {catName(s, k)}</td><td className="num text-[12px]">{money(v)}</td></tr>)}
            <tr><td className="font-semibold">Direct cost</td><td className="num font-semibold">{money(t.lines)}</td></tr>
            {e.salesTax && <tr><td>Sales tax <span className="text-faint">({e.salesTax.pct}% on material{e.salesTax.counties.length > 1 ? `, ${e.salesTax.counties.length} counties` : ''})</span></td><td className="num">{money(t.tax)}</td></tr>}
            <tr><td>Loaders <span className="text-faint">({sum(e.loaders.map((l) => l.pct)).toFixed(1)}%, portfolio)</span></td><td className="num">{money(t.loaders)}</td></tr>
            <tr><td>Escalation <span className="text-faint">({e.escalationPct}%)</span></td><td className="num">{money(t.escalation)}</td></tr>
            <tr><td className="font-semibold">Base estimate</td><td className="num font-semibold">{money(t.base)}</td></tr>
            <tr><td>Contingency <span className="text-faint">({e.contingency.pct}% {e.contingency.method === 'risk-based' ? e.contingency.confidence ?? 'P80' : 'det.'})</span></td><td className="num">{money(t.contingency)}</td></tr>
            <tr><td className="font-display text-[14px] font-bold">Total</td><td className="num font-display text-[14px] font-bold">{money(t.total)}</td></tr>
          </tbody>
        </table>
      </Panel>
    </aside>
  )
}
