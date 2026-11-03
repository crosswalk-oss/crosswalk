// Project estimates (Module 2): versions, the estimate builder, budgets created from estimates,
// version compare, and accuracy against actuals. ES-01..ES-13.
import { prefs } from '@/core/data'
import { useEffect, useMemo, useState } from 'react'
import type { AppState, Estimate, Project } from '@/core/types'
import { getState, mutate, personName, useMe, useStore } from '@/core/store'
import { CLASS_RANGES, CONT_CAT, createBudgetFromEstimate, estimateBridge, estimateTotals } from '@/core/engine/estimates'
import { startWorkflow } from '@/core/engine/workflow'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { activeBudget, position, projectBudgets } from '@/core/engine/position'
import { templateFor } from '@/core/engine/gates'
import { cx, fmtDate, money, moneyDelta, pct, sum } from '@/core/util'
import { Badge, Button, Callout, ClassBadge, Empty, Field, Modal, Panel, Select, StatusBadge, Table, Input, type Column } from '@/ui/kit'
import { RangeBar, Waterfall } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { EstimateEditor } from '@/views/estimating/Editor'
import { AccPct, Legend, NumInput, OutcomeBar, Swatch } from '@/views/estimating/parts'
import { QuickEstimateView } from '@/views/estimating/quick/QuickView'
import { QuickRequest } from '@/views/estimating/quick/QuickForm'
import { QuickBadge } from '@/views/estimating/quick/parts'
import { quickEligibility } from '@/views/estimating/quick/lib'
import {
  accuracyForProject, budgetKindAvailable, buildFromExisting, buildParametric, catCode, catName, defaultInputs, defaultPackages, describeInputs, inputSources, latestEstimate,
  displayTitle, methodLabel, outcomeFor, projectEstimates, shortCat,
} from '@/views/estimating/lib'
import { pricedOnVersion, salesTaxFor } from '@/core/engine/estimatingAdmin'
import { projectHref } from '@/core/router'

const pickKey = (pid: string) => `crosswalk:est-sel:${pid}`

export default function Estimates({ projectId }: { projectId: string }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === projectId)
  const ests = useMemo(() => projectEstimates(s, projectId), [s.estimates, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<string | undefined>(() => { try { return prefs.getRaw(pickKey(projectId)) ?? undefined } catch { return undefined } })
  const [showNew5, setShowNew5] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [copyFrom, setCopyFrom] = useState<Estimate | null>(null)
  useEffect(() => { try { if (sel) prefs.setRaw(pickKey(projectId), sel) } catch { /* storage blocked */ } }, [sel, projectId])
  if (!p) return <></>
  const selected = ests.find((e) => e.id === sel) ?? ests.find((e) => e.status === 'draft') ?? ests.find((e) => e.status === 'in-review') ?? ests[ests.length - 1]
  const latest = latestEstimate(s, projectId)
  const hasDraft = ests.some((e) => e.status === 'draft')
  const canEstimate = me.roles.some((r) => ['estimator', 'estimating-lead', 'pmo', 'admin', 'project-controls', 'pm'].includes(r))
  const gate = templateFor(s, p).stages[p.stageIndex]?.gate
  const approved = ests.filter((e) => e.status === 'approved').pop()
  const quickOk = quickEligibility(s, p.id)
  const canRequest = !me.company
  const quickBtn = (primary?: boolean) => canRequest && <Button variant={primary ? 'primary' : 'secondary'} onClick={() => setShowQuick(true)} disabled={!quickOk.ok} title={quickOk.reason}>Request Class 5 quick estimate</Button>

  const createClass3 = () => {
    if (!latest) return
    const e = buildFromExisting(getState(), latest, me.id, { split: latest.method === 'parametric' ? defaultPackages(p) : undefined, toClass3: true })
    mutate((d) => { d.estimates.push(e) }, { entity: 'estimate', entityId: e.id, projectId: p.id, action: 'create', summary: `Created draft v${e.version} (Class 3 line-item) from v${latest.version}${latest.method === 'parametric' ? ` rate-table estimate, split into ${defaultPackages(p).join(', ')}` : ''}` })
    setSel(e.id)
    toast(`Draft v${e.version} created from v${latest.version}`)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Summary label="Estimate of record" value={approved ? money(estimateTotals(approved).total) : '—'} sub={approved ? <span className="inline-flex items-center gap-1.5"><ClassBadge cls={approved.cls} /> v{approved.version} · approved {fmtDate(approved.approvedAt?.slice(0, 10))}</span> : 'None approved yet'} />
        <Summary label="Expected range" value={approved ? `${money(estimateTotals(approved).low)}–${money(estimateTotals(approved).high)}` : '—'} sub={approved ? `AACE Class ${approved.cls}: ${pct(CLASS_RANGES[approved.cls].low)} / +${pct(CLASS_RANGES[approved.cls].high)}` : undefined} />
        <Summary label={activeBudget(s, p.id)?.kind === 'control' ? 'Control budget' : 'Planning budget'} value={money(activeBudget(s, p.id)?.total)} sub={activeBudget(s, p.id) ? `From estimate v${s.estimates.find((e) => e.id === activeBudget(s, p.id)?.estimateId)?.version ?? '—'}` : 'Created at the gate from an approved estimate'} />
        <Summary label="Gate requirement" value={gate?.requiredEstimateClass ? <span className="inline-flex items-center gap-2"><ClassBadge cls={gate.requiredEstimateClass} size="lg" /><span className="text-[14px]">{approved && approved.cls <= gate.requiredEstimateClass ? 'Met' : 'Not met'}</span></span> : 'None'} sub={gate?.name ?? 'Final stage'} tone={gate?.requiredEstimateClass ? (approved && approved.cls <= gate.requiredEstimateClass ? 'good' : 'warn') : undefined} />
      </div>

      {/* versions */}
      <Panel pad={false} title="Estimate versions" subtitle="Approved and superseded versions are locked. Every change creates a new version."
        actions={<>
          {!canEstimate && quickBtn()}
          {canEstimate && <>{quickBtn()}
          <Button onClick={() => setShowNew5(true)} disabled={hasDraft} title={hasDraft ? 'Finish or submit the open draft first' : 'Class 5 priced from the rate table using the scope statement quantities'}>New Class 5 rate-table estimate</Button>
          <Button variant="primary" onClick={createClass3} disabled={!latest || hasDraft || latest.status === 'in-review'} title={hasDraft ? 'Finish or submit the open draft first' : !latest ? 'Create a Class 5 first' : latest.status === 'in-review' ? `Wait for v${latest.version} to finish review` : undefined}>New Class 3 from latest</Button>
          </>}
        </>}>
        {ests.length === 0 ? <div className="p-4"><Empty title="No estimates yet" action={<div className="flex flex-wrap justify-center gap-2">{quickBtn(true)}{canEstimate && <Button onClick={() => setShowNew5(true)}>New Class 5 rate-table estimate</Button>}</div>}>Ask the estimating team for a historical quick estimate (a few dropdowns), or build a Class 5 rate-table estimate that prices the scope statement quantities from the rate table. The approved Class 5 becomes the planning budget at Gate 1.</Empty></div> : (
          <VersionTable s={s} ests={ests} selectedId={selected?.id} onSelect={(e) => setSel(e.id)} />
        )}
      </Panel>

      {selected && (selected.method === 'quick'
        ? <QuickEstimateView key={selected.id} estimate={selected} project={p} onCopy={(src) => setCopyFrom(src)} />
        : <EstimateEditor key={selected.id} estimate={selected} project={p} onCopy={(src) => setCopyFrom(src)} />)}

      <BudgetsPanel s={s} project={p} onOpenEstimate={(id) => { setSel(id); document.getElementById('main')?.scrollTo?.({ top: 0, behavior: 'smooth' }) }} />
      {ests.length >= 2 && <ComparePanel s={s} ests={ests} />}
      <AccuracyPanel s={s} project={p} />

      {showNew5 && <NewParametric project={p} onClose={() => setShowNew5(false)} onCreated={(id) => { setSel(id); setShowNew5(false) }} />}
      {showQuick && (
        <Modal open wide onClose={() => setShowQuick(false)} title={`Request Class 5 quick estimate · ${p.code}`}>
          <QuickRequest projectId={p.id} onCancel={() => setShowQuick(false)} onDone={(id) => { setSel(id); setShowQuick(false) }} />
        </Modal>
      )}
      {copyFrom && <CopyModal project={p} src={copyFrom} onClose={() => setCopyFrom(null)} onCreated={(id) => { setSel(id); setCopyFrom(null) }} />}
    </div>
  )
}

function Summary({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className={cx('min-w-0 rounded-md border bg-surface px-4 py-3', tone === 'warn' ? 'border-warn/50' : 'border-line')}>
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-1 font-display text-[21px] font-bold leading-tight tabular-nums', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

// ───────────────────────────── Version list
function VersionTable({ s, ests, selectedId, onSelect }: { s: AppState; ests: Estimate[]; selectedId?: string; onSelect: (e: Estimate) => void }) {
  const totals = ests.map((e) => estimateTotals(e))
  const scaleMax = Math.max(...totals.map((t) => t.high)) * 1.04
  const rows = ests.map((e, i) => ({ e, t: totals[i] })).reverse()
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'v', header: 'Ver', width: 54, sort: (r) => r.e.version, render: (r) => <span className="inline-flex items-center gap-1.5"><span className={cx('h-4 w-1 rounded-full', r.e.id === selectedId ? 'bg-marker' : 'bg-transparent')} /><span className="font-mono font-semibold">v{r.e.version}</span></span> },
    { key: 'title', header: 'Title', render: (r) => <div><span className="font-semibold">{displayTitle(r.e)}</span>{r.e.repricedFrom && <div className="text-[11px] text-faint">Repriced from v{r.e.repricedFrom.fromVersion} to rate table v{r.e.repricedFrom.toRateTable}</div>}</div> },
    { key: 'cls', header: 'Class', sort: (r) => r.e.cls, render: (r) => <ClassBadge cls={r.e.cls} /> },
    { key: 'm', header: 'Method', render: (r) => r.e.method === 'quick' ? <QuickBadge /> : <span className="text-[12px] text-muted">{methodLabel(r.e.method)}<div className="text-[11px] text-faint">Rate table v{pricedOnVersion(s, r.e)}{pricedOnVersion(s, r.e) < s.settings.estimating.rateTableVersion ? ' (older)' : ''}</div></span> },
    { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.e.status} /> },
    { key: 'tot', header: 'Total', num: true, sort: (r) => r.t.total, render: (r) => <b>{money(r.t.total)}</b> },
    { key: 'rng', header: 'Range (low – high)', width: 230, render: (r) => <div className="min-w-[180px]"><RangeBar low={r.t.low} point={r.t.total} high={r.t.high} scaleMax={scaleMax} /><div className="flex justify-between text-[11px] tabular-nums text-faint"><span>{money(r.t.low)}</span><span>{money(r.t.high)}</span></div></div> },
    { key: 'by', header: 'Created by', render: (r) => <span className="text-[12px]">{personName(s, r.e.createdById)}<div className="text-faint">{fmtDate(r.e.createdAt.slice(0, 10))}</div></span> },
    { key: 'ap', header: 'Approved', render: (r) => r.e.approvedAt ? <span className="text-[12px]">{personName(s, r.e.approvedById)}<div className="text-faint">{fmtDate(r.e.approvedAt.slice(0, 10))}</div></span> : <span className="text-faint">—</span> },
  ]
  return <Table rows={rows} columns={cols} rowKey={(r) => r.e.id} onRowClick={(r) => onSelect(r.e)} />
}

// ───────────────────────────── New Class 5 rate-table estimate (ES-01)
/** Class 5 from the rate table: quantities, diameter and region are read from the scope statement and the project record. */
function NewParametric({ project, onClose, onCreated }: { project: Project; onClose: () => void; onCreated: (id: string) => void }) {
  const s = useStore()
  const me = useMe()
  const inp = useMemo(() => defaultInputs(project, s), [project, s])
  const src = useMemo(() => inputSources(s, project), [project, s])
  const preview = useMemo(() => buildParametric(s, project, inp, me.id), [s, project, inp, me.id])
  const t = estimateTotals(preview)
  const linear = project.asset.type === 'transmission-pipeline' || project.asset.type === 'distribution-main'
  const valve = project.asset.type === 'valve-site'
  const station = !linear && !valve
  const tax = salesTaxFor(s, project)
  const rf = s.settings.estimating.regionFactors[inp.region] ?? 1
  const regionalRows = preview.lines.filter((l) => s.rates.find((r) => r.id === l.rateId)?.region).length
  const qt = (id?: string) => s.settings.estimating.quantityTypes.find((x) => x.id === id)
  const create = () => {
    const e = buildParametric(getState(), project, inp, me.id)
    mutate((d) => { d.estimates.push(e) }, { entity: 'estimate', entityId: e.id, projectId: project.id, action: 'create', summary: `Created Class 5 rate-table draft v${e.version} from the scope statement (${describeInputs(project, inp)}; rate table v${e.rateTableVersion}): ${money(t.total)}` })
    toast(`Class 5 draft v${e.version} created`)
    onCreated(e.id)
  }
  const fact = (label: string, value: React.ReactNode, from?: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right"><b className="tabular-nums">{value}</b>{from && <span className="block text-[11px] text-faint">{from}</span>}</span>
    </div>
  )
  return (
    <Modal open onClose={onClose} wide title="New Class 5 rate-table estimate"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} disabled={!preview.lines.length}>Create draft v{preview.version}</Button></>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-[13px] text-muted">Prices the scope from rate table <b className="text-ink">v{s.settings.estimating.rateTableVersion}</b> (P50) for <b className="text-ink">{project.asset.type.replace(/-/g, ' ')}</b> · <b className="text-ink">{project.workMethod.replace(/-/g, ' ')}</b>. Inputs are read from the project's scope statement — nothing to type.</p>
          <div className="rounded border border-line px-3 py-1 text-[13px]">
            {linear && fact('Length', `${inp.lengthFt.toLocaleString('en-US')} ft`, src.lengthFt)}
            {(linear || valve) && fact('Diameter', `${inp.diameterIn}"`, src.diameterIn)}
            {valve && fact('Valve sites', inp.sites, src.sites)}
            {inp.tieIns != null && fact('Tie-ins', inp.tieIns, src.tieIns)}
            {inp.services != null && fact('Services', inp.services, src.services)}
            {inp.hp != null && fact('Station capacity', `${inp.hp.toLocaleString('en-US')} hp`, src.hp)}
            {fact('Region', `${inp.region} (×${rf.toFixed(2)})`, regionalRows ? `${regionalRows} regional rate row${regionalRows > 1 ? 's' : ''}; others × factor` : 'Base rates × region factor')}
            {fact('Sales tax', `${tax.pct}%`, tax.counties.map((c) => `${c.county} ${Math.round(c.share * 100)}%`).join(', '))}
          </div>
          {project.scope.quantities.length > 0 && (
            <div className="text-[12px]">
              <div className="eyebrow mb-1">Scope statement quantities</div>
              <ul className="flex flex-col gap-0.5">
                {project.scope.quantities.map((q, i) => <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate">{q.label}</span><span className="shrink-0 tabular-nums text-muted">{q.qty.toLocaleString('en-US')} {q.unit}{qt(q.typeId)?.feeds ? <span className="ml-1 text-faint">→ {qt(q.typeId)!.feeds}</span> : ''}</span></li>)}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] text-muted">To change a quantity, edit the scope statement on the <a className="font-semibold text-link" href={projectHref(project.id, 'overview')}>Overview</a>; terrain-specific rows are matched from the project record ({project.location.terrain}).</p>
          {station && <Callout tone="info">Stations price as lump sums from {s.rates.filter((r) => r.assetType === project.asset.type && r.workMethod === project.workMethod)[0]?.sampleSize ?? 3} comparable stations.</Callout>}
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div><div className="eyebrow">Preview total</div><div className="font-display text-[26px] font-bold tabular-nums">{money(t.total)}</div></div>
            <div className="text-right text-xs text-muted"><ClassBadge cls={preview.cls} /> range {money(t.low)}–{money(t.high)}<div>Escalation {preview.escalationPct}% · contingency {preview.contingency.pct}% · loaders {sum(preview.loaders.map((l) => l.pct)).toFixed(1)}% · tax {money(t.tax)}</div></div>
          </div>
          <div className="scroll-x max-h-[320px] overflow-y-auto rounded border border-line">
            <table className="tbl">
              <thead><tr><th>Category</th><th>Rate</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit cost</th><th className="num">Total</th></tr></thead>
              <tbody>
                {preview.lines.map((l) => <tr key={l.id}><td className="text-[12px]">{shortCat(s, l.categoryId)}</td><td className="text-[12px]">{l.description}</td><td className="num">{l.qty.toLocaleString('en-US')}</td><td>{l.unit}</td><td className="num">{money(l.unitCost, l.unitCost < 1e4 ? 'full' : 'compact')}</td><td className="num font-semibold">{money(Math.round(l.qty * l.unitCost))}</td></tr>)}
              </tbody>
            </table>
            {!preview.lines.length && <p className="p-4 text-[13px] text-muted">No rate-table rows for this asset type and work method.</p>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────────── New version from a locked estimate
function CopyModal({ project, src, onClose, onCreated }: { project: Project; src: Estimate; onClose: () => void; onCreated: (id: string) => void }) {
  const me = useMe()
  const [split, setSplit] = useState(src.method === 'parametric' || src.method === 'quick')
  const [wps, setWps] = useState(defaultPackages(project).join(', '))
  const create = () => {
    const list = wps.split(',').map((x) => x.trim()).filter(Boolean)
    const e = buildFromExisting(getState(), src, me.id, { split: split ? list : undefined, toClass3: split })
    mutate((d) => { d.estimates.push(e) }, { entity: 'estimate', entityId: e.id, projectId: project.id, action: 'create', summary: `Created draft v${e.version} from v${src.version}${split ? ` split into ${list.join(', ')}` : ''}` })
    toast(`Draft v${e.version} created from v${src.version}`)
    onCreated(e.id)
  }
  const hasDraft = useStore((s) => s.estimates.some((e) => e.projectId === project.id && e.status === 'draft'))
  return (
    <Modal open onClose={onClose} title={`New version from v${src.version}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} disabled={hasDraft}>Create draft</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted">Copies every line, markup, maturity item and BOE section into a new draft. v{src.version} stays locked as it was {src.status}.</p>
        {hasDraft && <Callout tone="warn">This project already has an open draft. Submit or finish it first.</Callout>}
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={split} onChange={(e) => setSplit(e.target.checked)} /><span>Split into work packages as a Class 3 line-item estimate</span></label>
        {split && <Field label="Work packages" hint="Comma-separated. Linear quantities split evenly; lump sums go to the first package."><Input id="copy-wps" value={wps} onChange={(e) => setWps(e.target.value)} /></Field>}
      </div>
    </Modal>
  )
}

// ───────────────────────────── Budgets (ES-10)
function BudgetsPanel({ s, project, onOpenEstimate }: { s: AppState; project: Project; onOpenEstimate: (id: string) => void }) {
  const bs = projectBudgets(s, project.id)
  const active = activeBudget(s, project.id)
  const years = Array.from(new Set(bs.flatMap((b) => Object.keys(b.byYear)))).sort()
  const cats = Array.from(new Set(bs.flatMap((b) => Object.keys(b.byCategory)))).sort((a, b) => catCode(s, a).localeCompare(catCode(s, b)))
  const [view, setView] = useState<'year' | 'cat'>('year')
  const avail = budgetKindAvailable(s, project)
  const approvedEst = s.estimates.filter((e) => e.projectId === project.id && e.status === 'approved').pop()
  const canCreate = !!avail && !!approvedEst && !bs.some((b) => b.estimateId === approvedEst.id && b.kind === avail.kind)
  const authFor = (bid: string) => s.workflows.filter((w) => w.recordType === 'budget' && w.recordId === bid).pop()
  const createBudget = () => {
    if (!avail || !approvedEst) return
    const t = estimateTotals(approvedEst)
    let msg = ''
    mutate((d) => {
      const e = d.estimates.find((x) => x.id === approvedEst.id)!
      const b = createBudgetFromEstimate(d, e, avail.kind)
      b.postedToErp = false
      const inst = startWorkflow(d, 'budget-authorization', { title: `${project.code} ${avail.kind} budget from estimate v${e.version}`, recordType: 'budget', recordId: b.id, projectId: project.id, data: { amount: b.total, wbs: project.erpWbs } })
      const who = inst?.active[0]?.assigneeIds.map((id) => personName(d, id)).join(', ')
      msg = inst ? `Budget version created — authorization with ${who || 'approvers'}` : 'Budget version created'
    }, { entity: 'budget', entityId: approvedEst.id, projectId: project.id, action: 'create', summary: `Created ${avail.kind} budget version ${money(t.total)} from approved estimate v${approvedEst.version} (Class ${approvedEst.cls}); routed for budget authorization` })
    toast(msg)
  }
  const togglePost = (id: string) => {
    const b = bs.find((x) => x.id === id)!
    const wf = authFor(id)
    if (!b.postedToErp && wf && wf.status === 'running') { toast('Budget authorization is still in progress', 'info'); return }
    mutate((d) => { const x = d.budgets.find((y) => y.id === id); if (x) x.postedToErp = !x.postedToErp }, { entity: 'budget', entityId: id, projectId: project.id, action: b.postedToErp ? 'unpost' : 'post', summary: `${b.postedToErp ? 'Flagged not posted' : 'Posted'} ${b.kind} budget ${money(b.total)} to ERP WBS ${project.erpWbs}` })
    toast(b.postedToErp ? 'Marked as not posted to ERP' : `Posted to ERP WBS ${project.erpWbs}`)
  }
  const createBtn = canCreate && <Button size="sm" variant="primary" onClick={createBudget}>Create {avail!.kind} budget from v{approvedEst!.version}</Button>
  if (!bs.length) return (
    <Panel title="Budget versions" actions={createBtn}><Empty title="No budget yet">The planning budget is created from the approved Class 5 estimate at {templateFor(s, project).stages[0].gate.name}; the control budget from the approved Class 3 at the authorization gate.</Empty></Panel>
  )
  const pos = position(s, project.id)
  return (
    <Panel pad={false} title="Budget versions" subtitle={`Created from approved estimates at gate decisions · ERP WBS ${project.erpWbs}`}
      actions={<>{createBtn}<div className="inline-flex rounded border border-line bg-sunken p-0.5 text-xs">{(['year', 'cat'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cx('rounded-sm px-2.5 py-1 font-semibold', view === v ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>{v === 'year' ? 'By year' : 'By category'}</button>)}</div></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Budget</th><th>From estimate</th><th>Created</th><th>ERP</th>
              <th className="num">Base</th><th className="num">Contingency</th><th className="num">Total</th>
              {view === 'year' ? years.map((y) => <th key={y} className="num">{y}</th>) : cats.map((c) => <th key={c} className="num" title={catName(s, c)}>{shortCat(s, c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {bs.map((b) => {
              const e = s.estimates.find((x) => x.id === b.estimateId)
              return (
                <tr key={b.id} className={cx(b.id === active?.id && 'bg-marker/5')}>
                  <td><div className="flex items-center gap-1.5"><Badge tone={b.kind === 'control' ? 'ink' : 'neutral'}>{b.kind === 'control' ? 'Control' : 'Planning'}</Badge>{b.id === active?.id && <Badge tone="good">In force</Badge>}</div></td>
                  <td>{e ? <button className="inline-flex items-center gap-1.5 text-link hover:underline" onClick={() => onOpenEstimate(e.id)}><span className="font-mono">v{e.version}</span><ClassBadge cls={e.cls} /></button> : '—'}</td>
                  <td className="text-[12px]">{fmtDate(b.createdAt)}</td>
                  <td><button onClick={() => togglePost(b.id)} title="Toggle ERP posted flag">{b.postedToErp ? <Badge tone="good">Posted</Badge> : authFor(b.id)?.status === 'approved' ? <Badge tone="marker">Authorized · post to ERP</Badge> : <Badge tone="warn">Not posted</Badge>}</button>{authFor(b.id) && <div className="mt-0.5"><StatusBadge status={authFor(b.id)!.status} label={authFor(b.id)!.status === 'running' ? 'Authorizing' : undefined} /></div>}</td>
                  <td className="num">{money(b.total - b.contingency)}</td><td className="num">{money(b.contingency)}</td><td className="num font-semibold">{money(b.total)}</td>
                  {view === 'year' ? years.map((y) => <td key={y} className="num text-[12px]">{b.byYear[y] ? money(b.byYear[y]) : '—'}</td>) : cats.map((c) => <td key={c} className="num text-[12px]">{b.byCategory[c] ? money(b.byCategory[c]) : '—'}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {bs.map((b) => authFor(b.id)).filter((w) => w && w.status === 'running').map((w) => <div key={w!.id} className="border-t border-line px-4 py-2"><WorkflowStatus instanceId={w!.id} compact /></div>)}
      {active && <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
        <span>Budget in force <b className="text-ink">{money(pos.currentBudget)}</b>{pos.currentBudget !== active.total && <> (incl. {moneyDelta(pos.currentBudget - active.total)} approved new funding)</>}</span>
        <span>Contingency used <b className="text-ink">{money(pos.contingencyUsed)}</b> of {money(pos.contingencyOriginal)}</span>
        <span>EAC <b className={pos.eac > pos.currentBudget ? 'text-bad' : 'text-ink'}>{money(pos.eac)}</b></span>
      </div>}
    </Panel>
  )
}

// ───────────────────────────── Compare (ES-11)
function ComparePanel({ s, ests }: { s: AppState; ests: Estimate[] }) {
  const defA = ests.length >= 2 ? ests[ests.length - 2].id : ests[0].id
  const [a, setA] = useState(defA)
  const [b, setB] = useState(ests[ests.length - 1].id)
  useEffect(() => { if (!ests.some((e) => e.id === a)) setA(defA); if (!ests.some((e) => e.id === b)) setB(ests[ests.length - 1].id) }, [ests]) // eslint-disable-line react-hooks/exhaustive-deps
  const ea = ests.find((e) => e.id === a) ?? ests[0], eb = ests.find((e) => e.id === b) ?? ests[ests.length - 1]
  const br = estimateBridge(ea, eb)
  const ta = estimateTotals(ea), tb = estimateTotals(eb)
  const steps = br.steps.slice().sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  const top = steps.slice(0, 9)
  const rest = steps.slice(9)
  const wfSteps = [...top.map((x) => ({ label: shortCat(s, x.categoryId), delta: x.delta })), ...(rest.length ? [{ label: `Other (${rest.length})`, delta: sum(rest.map((x) => x.delta)) }] : [])]
  const cats = Array.from(new Set([...Object.keys(ta.byCategory), ...Object.keys(tb.byCategory)])).sort((x, y) => catCode(s, x).localeCompare(catCode(s, y)))
  const opt = ests.map((e) => ({ value: e.id, label: `v${e.version} · Class ${e.cls} · ${e.status} · ${money(estimateTotals(e).total)}` }))
  const lineCount = (e: Estimate, c: string) => e.lines.filter((l) => l.categoryId === c).length
  return (
    <Panel title="Compare versions" subtitle="Bridge from one estimate to another by cost category"
      actions={<div className="flex flex-wrap items-center gap-2 text-xs"><Select id="cmp-a" aria-label="From version" className="h-7 w-auto text-xs" value={ea.id} onChange={(e) => setA(e.target.value)} options={opt} /><span className="text-muted">to</span><Select id="cmp-b" aria-label="To version" className="h-7 w-auto text-xs" value={eb.id} onChange={(e) => setB(e.target.value)} options={opt} /></div>}>
      {ea.id === eb.id ? <Callout tone="info">Pick two different versions.</Callout> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[13px]"><span>v{ea.version} <ClassBadge cls={ea.cls} /> {money(ta.total)}</span><span className="text-muted">→</span><span>v{eb.version} <ClassBadge cls={eb.cls} /> {money(tb.total)}</span><b className={tb.total > ta.total ? 'text-bad' : 'text-good'}>{moneyDelta(tb.total - ta.total)} ({ta.total ? (tb.total >= ta.total ? '+' : '') + pct(tb.total / ta.total - 1, 1) : '—'})</b></div>
            <Waterfall start={ta.total} end={tb.total} steps={wfSteps} startLabel={`v${ea.version} C${ea.cls}`} endLabel={`v${eb.version} C${eb.cls}`} height={260} />
            <Legend items={[{ swatch: <Swatch className="bg-bad/80" />, label: 'Increase' }, { swatch: <Swatch className="bg-good/80" />, label: 'Decrease' }, { swatch: <Swatch className="bg-ink/85" />, label: 'Version total' }]} />
            <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
              <span>Range v{ea.version}: {money(ta.low)}–{money(ta.high)}</span><span>Range v{eb.version}: {money(tb.low)}–{money(tb.high)}</span>
              <span>{tb.total >= ta.low && tb.total <= ta.high ? `v${eb.version} falls inside v${ea.version}'s expected range` : `v${eb.version} falls outside v${ea.version}'s expected range`}</span>
            </div>
          </div>
          <div className="scroll-x max-h-[380px] overflow-y-auto rounded border border-line">
            <table className="tbl">
              <thead><tr><th>Category</th><th className="num">v{ea.version}</th><th className="num">v{eb.version}</th><th className="num">Change</th></tr></thead>
              <tbody>
                {cats.map((c) => {
                  const x = ta.byCategory[c] || 0, y = tb.byCategory[c] || 0
                  return <tr key={c}><td className="text-[12px]"><span className="font-mono text-faint">{catCode(s, c)}</span> {catName(s, c)}<div className="text-[11px] text-faint">{lineCount(ea, c)} → {lineCount(eb, c)} lines</div></td><td className="num">{money(x)}</td><td className="num">{money(y)}</td><td className={cx('num font-semibold', y > x ? 'text-bad' : y < x ? 'text-good' : 'text-faint')}>{y === x ? '—' : moneyDelta(y - x)}</td></tr>
                })}
                <tr><td className="font-semibold">Base</td><td className="num">{money(ta.base)}</td><td className="num">{money(tb.base)}</td><td className="num font-semibold">{moneyDelta(tb.base - ta.base)}</td></tr>
                <tr><td className="text-[12px]"><span className="font-mono text-faint">{catCode(s, CONT_CAT)}</span> Contingency <span className="text-faint">({ea.contingency.pct}% → {eb.contingency.pct}%)</span></td><td className="num">{money(ta.contingency)}</td><td className="num">{money(tb.contingency)}</td><td className={cx('num font-semibold', tb.contingency > ta.contingency ? 'text-bad' : 'text-good')}>{moneyDelta(tb.contingency - ta.contingency)}</td></tr>
                <tr><td className="font-display font-bold">Total</td><td className="num font-bold">{money(ta.total)}</td><td className="num font-bold">{money(tb.total)}</td><td className="num font-bold">{moneyDelta(tb.total - ta.total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ───────────────────────────── Accuracy (ES-13)
function AccuracyPanel({ s, project }: { s: AppState; project: Project }) {
  const o = outcomeFor(s, project)
  const pts = accuracyForProject(s, project)
  if (!o || !pts.length) return (
    <Panel title="Estimate accuracy"><p className="text-[13px] text-muted">Accuracy is tracked once the project has actual cost. Each approved class estimate will be compared with the current forecast, then with final cost at closeout.</p></Panel>
  )
  const scaleMax = Math.max(o.value, ...pts.map((x) => x.high)) * 1.05
  return (
    <Panel title="Estimate accuracy" subtitle={o.basis === 'final' ? `Approved estimates vs final cost ${money(o.value)}` : `Approved estimates vs current forecast (EAC) ${money(o.value)} · final accuracy is set at closeout`}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Estimate</th><th>Approved</th><th className="num">Estimate</th><th style={{ minWidth: 220 }}>AACE range · <span className="normal-case">◆ outcome</span></th><th className="num">{o.basis === 'final' ? 'Final' : 'EAC'}</th><th className="num">Accuracy</th><th>Within class range</th></tr></thead>
          <tbody>
            {pts.map((x) => (
              <tr key={x.estimateId}>
                <td><span className="font-mono">v{x.version}</span> <ClassBadge cls={x.cls} /></td>
                <td className="text-[12px]">{fmtDate(x.approvedAt?.slice(0, 10))}</td>
                <td className="num">{money(x.estimate)}</td>
                <td><OutcomeBar low={x.low} point={x.estimate} high={x.high} outcome={x.outcome} scaleMax={scaleMax} /></td>
                <td className="num">{money(x.outcome)}</td>
                <td className="num"><AccPct v={x.acc} cls={x.cls} /></td>
                <td>{x.within ? <Badge tone="good">Yes · {pct(CLASS_RANGES[x.cls].low)} / +{pct(CLASS_RANGES[x.cls].high)}</Badge> : <Badge tone="bad">No · {pct(CLASS_RANGES[x.cls].low)} / +{pct(CLASS_RANGES[x.cls].high)}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-muted">Accuracy = outcome ÷ estimate − 1. Portfolio accuracy by class, program and estimator is on <a className="font-semibold text-link" href="#estimating">Estimating</a>.</div>
    </Panel>
  )
}

