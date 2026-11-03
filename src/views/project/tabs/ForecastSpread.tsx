// Forecast tab: ETC / EAC by WBS function (the headline), then the time-phased grid where functions roll up and
// forecast line items are edited month by month. Each function carries a curve profile (built-in or custom) with a
// start/end window; applying it phases the function's ETC over its lines, every cell stays editable afterwards and
// a hand edit marks the profile "adjusted". Actual months sit before the forecast months and drill to the SAP rows.
import { useEffect, useMemo, useState } from 'react'
import type { AppState, FnProfile, Forecast, Project } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { actualsThrough, forecastMonths } from '@/core/engine/wbs'
import { openReconciliation } from '@/views/actuals/Reconcile'
import { actualsByLineMonth, budgetByLine, defaultLineSpread, lineGridOf, rollupGrid } from '@/core/engine/lines'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, fmtMonth, money, moneyDelta, sum } from '@/core/util'
import { projectHref } from '@/core/router'
import { Badge, Button, Callout, ConfirmButton, Empty, Field, Modal, Panel, SegButtons, Select, StatusBadge, TextArea } from '@/ui/kit'
import { BarChart, HBarChart, LineChart, SERIES } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { LineGrid, type DrillTarget, type Unit } from '../../forecast/Grid'
import { EtcEacTable } from '../../forecast/EtcEac'
import { LineTools, ProfileModal } from '../../forecast/Profiles'
import { ActualDrill } from '../../actuals/Drill'
import { forecastReportHtml } from '../../forecast/report'
import {
  applyFnProfile, applyLines, carryForwardLines, carryProfiles, compareVersions, copyVersion, currentCycle, cycleOf, diffSummary, etcEacAt,
  fnGroups, fnRefs, isEditable, lineActuals, lineCsvRows, lineRefs, linesToSpread, markAdjusted, monthLabel, priorApproved, profileName, rowTotal,
  sameSpread, shortMonth, statusOf, stripZeros, versionCutoff, versionsOf, working, type SlipMode, type Spread,
} from '../../forecast/lib'

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'In review', approved: 'Approved', returned: 'Returned' }
const statusBadge = (f: Forecast) => <StatusBadge status={statusOf(f) === 'submitted' ? 'in-review' : statusOf(f)} label={STATUS_LABEL[statusOf(f)]} />
type Profiles = Record<string, FnProfile>

export default function ForecastSpread({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)
  const versions = useMemo(() => versionsOf(s, projectId), [s.forecasts, projectId])
  const [selId, setSelId] = useState<string | undefined>(versions[0]?.id)
  const sel = versions.find((v) => v.id === selId) ?? versions[0]
  const budTotal = useMemo(() => { const b = budgetByLine(s, projectId); return sum(Object.values(b.byLine)) + b.contingency }, [s, projectId])
  if (!p) return <Empty title="Project not found" />
  if (!budTotal && !versions.length) {
    return <Empty title="No budget to forecast against">{p.code} has no authorized budget yet. The forecast opens once a planning budget is approved at Gate 1; until then the estimate carries the cost basis.</Empty>
  }
  if (!sel) return <FirstVersion s={s} p={p} onCreated={setSelId} />
  return <Editor key={sel.id} s={s} p={p} f={sel} versions={versions} onSelect={setSelId} />
}

function FirstVersion({ s, p, onCreated }: { s: AppState; p: Project; onCreated: (id: string) => void }) {
  const me = useMe()
  const create = () => {
    const { forecast } = copyVersion(s, p, undefined, { byId: me.id, note: 'First forecast — each line’s remaining budget phased by its function’s typical profile' })
    mutate((d) => { d.forecasts.push(forecast) }, { entity: 'forecast', entityId: forecast.id, projectId: p.id, action: 'create', summary: `Started first forecast version for ${p.code}: EAC ${money(forecast.eac, 'full')} spread from remaining budget by line item` })
    onCreated(forecast.id)
    toast('Draft forecast created')
  }
  return <Empty title="No forecast yet" action={<Button variant="marker" onClick={create} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Start first forecast</Button>}>Creates a draft that phases each forecast line’s remaining budget by its WBS function’s profile. Every cell stays editable.</Empty>
}

type View = 'months' | 'years'
interface Snap { lines: Spread; held: number; profiles: Profiles; what: string }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? {}))

function Editor({ s, p, f, versions, onSelect }: { s: AppState; p: Project; f: Forecast; versions: Forecast[]; onSelect: (id: string) => void }) {
  const me = useMe()
  const editable = isEditable(f)
  const stored = useMemo(() => stripZeros(lineGridOf(s, p, f)), [f])
  const [lines, setLines] = useState<Spread>(() => clone(stored))
  const [held, setHeld] = useState<number>(f.contingencyHeld ?? 0)
  const [note, setNote] = useState(f.note ?? '')
  const [profiles, setProfiles] = useState<Profiles>(() => clone(f.profiles ?? {}))
  const [undo, setUndo] = useState<Snap[]>([])
  const [view, setView] = useState<View>('months')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const through = actualsThrough(s, p.id)
  const cutoff = editable ? through : versionCutoff(s, f)
  const actGrid = useMemo(() => actualsByLineMonth(s, p.id), [s.costPeriods, s.settings.forecastLines, p.id])
  const pastMonths = useMemo(() => Array.from(new Set(Object.values(actGrid).flatMap((r) => Object.keys(r)))).filter((m) => m <= cutoff).sort(), [actGrid, cutoff])
  const [pastCollapsed, setPastCollapsed] = useState<Set<string>>(() => new Set(pastMonths.map((m) => m.slice(0, 4)).filter((y) => y < s.settings.asOf.slice(0, 4))))
  const [showPast, setShowPast] = useState(true)
  const [unit, setUnit] = useState<Unit>(1000)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(s.settings.wbsFunctions.map((x) => x.id)))
  const [profFn, setProfFn] = useState<string | null>(null)
  const [lineTool, setLineTool] = useState<string | null>(null)
  const [drill, setDrill] = useState<DrillTarget | null>(null)
  const [newOpen, setNewOpen] = useState<Forecast | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  // the stored record changed (saved, submitted, approved elsewhere): show what is stored
  useEffect(() => { setLines(clone(stored)); setHeld(f.contingencyHeld ?? 0); setNote(f.note ?? ''); setProfiles(clone(f.profiles ?? {})) }, [f, stored])

  const dirty = !sameSpread(lines, stored) || held !== (f.contingencyHeld ?? 0) || note !== (f.note ?? '') || JSON.stringify(profiles) !== JSON.stringify(f.profiles ?? {})
  const refs = useMemo(() => lineRefs(s, lines, stored), [s.settings.forecastLines, lines, stored])
  const groups = useMemo(() => fnGroups(s, refs), [s.settings.wbsFunctions, refs])
  const lineAct = useMemo(() => lineActuals(s, p.id, cutoff), [actGrid, p.id, cutoff])
  const B = useMemo(() => budgetByLine(s, p.id), [s, p.id])
  const W = useMemo(() => working(s, f, lines, held, profiles, note), [s, f, lines, held, profiles, note])
  const ee = useMemo(() => etcEacAt(s, p, W, cutoff), [s, p, W, cutoff])
  const baseMonths = useMemo(() => forecastMonths(s, p), [s, p])
  const futureMonths = useMemo(() => {
    const inGrid = Object.values(lines).flatMap((r) => Object.keys(r))
    const all = new Set([...(editable ? baseMonths : []), ...inGrid])
    return Array.from(all).sort()
  }, [lines, baseMonths, editable])
  const stale = editable ? sum(Object.values(lines).flatMap((r) => Object.entries(r).filter(([m]) => m <= through).map(([, v]) => v))) : 0

  const etcT = ee.totals.etc + held
  const eac = ee.totals.eac
  const prior = priorApproved(s, p.id, f.id)
  const latest = versions[0]
  const inst = s.workflows.find((w) => w.id === f.workflowInstanceId)
  const adjusted = Object.entries(profiles).filter(([, x]) => x.adjusted).map(([k]) => k)

  const snap = (what: string) => setUndo((u) => [...u.slice(-29), { lines, held, profiles, what }])
  const change = (next: Spread, what: string, fnIds: string[] = []) => { snap(what); setLines(next); setProfiles((pr) => fnIds.reduce(markAdjusted, pr)) }
  const changeHeld = (v: number) => { snap('contingency held'); setHeld(Math.max(0, v)) }
  const doUndo = () => { const last = undo[undo.length - 1]; if (!last) return; setLines(last.lines); setHeld(last.held); setProfiles(last.profiles); setUndo(undo.slice(0, -1)); toast(`Undid ${last.what}`, 'info') }
  const discard = () => { setLines(clone(stored)); setHeld(f.contingencyHeld ?? 0); setNote(f.note ?? ''); setProfiles(clone(f.profiles ?? {})); setUndo([]); toast('Changes discarded', 'info') }

  const fnLabel = (fnId: string) => { const x = s.settings.wbsFunctions.find((y) => y.id === fnId); return x ? `${x.code} ${x.name}` : fnId }
  const profileDiff = () => {
    const parts: string[] = []
    for (const fn of new Set([...Object.keys(profiles), ...Object.keys(f.profiles ?? {})])) {
      const a = f.profiles?.[fn], b = profiles[fn]
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      if (b && (!a || a.profileId !== b.profileId || a.start !== b.start || a.end !== b.end)) parts.push(`${fnLabel(fn)} profile ${profileName(s, b.profileId)} ${shortMonth(b.start)}–${shortMonth(b.end)}`)
      else if (b?.adjusted && !a?.adjusted) parts.push(`${fnLabel(fn)} adjusted by hand`)
    }
    return parts
  }
  const save = (quiet = false) => {
    const pd = profileDiff()
    const summary = diffSummary(refs, stored, lines, f.contingencyHeld ?? 0, held) + (pd.length ? ` · ${pd.join('; ')}` : '') + (note !== (f.note ?? '') ? ' · basis note updated' : '')
    mutate((d) => { const x = d.forecasts.find((y) => y.id === f.id); if (x) applyLines(d, x, lines, held, note.trim(), profiles) },
      { entity: 'forecast', entityId: f.id, projectId: p.id, action: 'update', summary: `${p.code} forecast ${f.date} saved — EAC ${money(W.eac, 'full')} (${moneyDelta(W.eac - f.eac)}): ${summary}` })
    if (!quiet) toast('Draft saved')
  }
  const select = (id: string) => {
    if (dirty) { toast('Save or discard your changes before switching versions', 'bad'); return }
    onSelect(id)
  }
  const respreadAll = () => { const d = defaultLineSpread(s, p); snap('re-spread from remaining budget'); setLines(stripZeros(d.lineSpread)); setProfiles(d.profiles); toast('Every line re-spread from remaining budget by its function’s default profile') }
  const fillPrior = () => {
    if (!prior) return
    const r = carryForwardLines(s, p, stripZeros(lineGridOf(s, p, prior)), versionCutoff(s, prior), 'net')
    snap('fill from last approved')
    setLines(r.spread)
    setHeld(prior.contingencyHeld ?? 0)
    setProfiles(carryProfiles(prior.profiles, baseMonths, new Set(Object.keys(r.movedBy).map((l) => refs.find((x) => x.id === l)?.fnId))))
    toast(`Filled from the ${fmtDate(prior.date)} approved version${r.moved ? ` · ${money(r.moved)} carried out of closed months` : ''}`)
  }
  const carryStale = () => {
    const r = carryForwardLines(s, p, lines, through, 'all')
    change(r.spread, 'carry forward closed months', Object.keys(r.movedBy).map((l) => refs.find((x) => x.id === l)?.fnId ?? ''))
    toast(`${money(r.moved)} moved out of closed months`)
  }
  const applyProf = (fnId: string, prof: Pick<FnProfile, 'profileId' | 'start' | 'end'>, total: number, what = 'applied') => {
    const r = applyFnProfile(s, p, lines, fnId, prof, total)
    snap(`${fnLabel(fnId)} profile`)
    setLines(r.lines)
    setProfiles((pr) => ({ ...pr, [fnId]: r.profile }))
    setProfFn(null)
    toast(`${profileName(s, prof.profileId)} ${what} to ${fnLabel(fnId)} · ${money(total)} ${shortMonth(prof.start)}–${shortMonth(prof.end)}`)
  }
  const resetProf = (fnId: string) => {
    const pr = profiles[fnId]
    if (!pr) return
    const ids = groups.find((g) => g.fn.id === fnId)?.lines.map((l) => l.id) ?? []
    applyProf(fnId, pr, sum(ids.map((id) => rowTotal(lines, id))), 're-applied')
  }

  const exportCsv = async () => {
    const res = await saveFile(`${p.code}-forecast-${f.date}-lines.csv`, toCSV(lineCsvRows(s, p, W, futureMonths)), 'text/csv')
    if (res === 'saved') toast('Forecast exported by line item')
  }
  const exportHtml = async () => {
    const res = await saveFile(`${p.code}-forecast-${f.date}.html`, forecastReportHtml(s, p, W), 'text/html')
    if (res === 'saved') toast('Forecast report saved')
  }

  const setAllYears = (v: View) => {
    setView(v)
    const years = new Set([...futureMonths, ...pastMonths].map((m) => m.slice(0, 4)))
    setCollapsed(v === 'years' ? years : new Set())
    setPastCollapsed(v === 'years' ? years : new Set())
  }
  const toggle = (set: Set<string>, y: string) => { const n = new Set(set); if (n.has(y)) n.delete(y); else n.add(y); return n }
  const allOpen = groups.every((g) => expanded.has(g.fn.id))

  const profGroup = groups.find((g) => g.fn.id === profFn)
  const toolLine = refs.find((l) => l.id === lineTool)
  const fnSpread = useMemo(() => linesToSpread(s, lines), [s.settings.forecastLines, lines])
  const fnActMonth = useMemo(() => rollupGrid(s, actGrid), [s.settings.forecastLines, actGrid])
  const drillActual = (t: { fnId?: string; lineId?: string }) => {
    const ids = t.lineId ? [t.lineId] : groups.find((g) => g.fn.id === t.fnId)?.lines.map((l) => l.id) ?? []
    setDrill({ ...t, months: pastMonths, amount: sum(ids.map((id) => lineAct[id] || 0)) })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header: version picker + summary */}
      <Panel pad={false}>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[17px] font-semibold">Forecast version</h2>
              {statusBadge(f)}
              {cycleOf(f.date) === currentCycle(s) && <Badge tone="info">{monthLabel(currentCycle(s))} cycle</Badge>}
              {adjusted.length > 0 && <Badge tone="warn" title={adjusted.map(fnLabel).join(', ')}>{adjusted.length} profile{adjusted.length === 1 ? '' : 's'} adjusted</Badge>}
              {dirty && <Badge tone="marker">Unsaved changes</Badge>}
            </div>
            <Select aria-label="Forecast version" className="max-w-full sm:w-[460px]" value={f.id} onChange={(e) => select(e.target.value)}
              options={versions.map((v) => ({ value: v.id, label: `${fmtDate(v.date)} · ${STATUS_LABEL[statusOf(v)]} · EAC ${money(v.eac)} · ${personName(s, v.byId)}` }))} />
            <div className="text-[12px] text-muted">
              Prepared by <b className="text-ink">{personName(s, f.byId)}</b> · actuals through <b className="text-ink">{fmtMonth(cutoff)}</b> from SAP
              {prior && <> · prior approved {fmtDate(prior.date)} EAC {money(prior.eac)} (<span className={eac > prior.eac ? 'text-bad' : 'text-good'}>{moneyDelta(eac - prior.eac)}</span>)</>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <>
                {undo.length > 0 && <Button size="sm" variant="ghost" onClick={doUndo}>Undo</Button>}
                {dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}
                <Button size="sm" disabled={!dirty} onClick={() => save()}>Save draft</Button>
                <Button size="sm" variant="primary" onClick={() => setSubmitOpen(true)}>Submit for review</Button>
              </>
            ) : (
              <Button size="sm" variant={f.id === latest.id ? 'marker' : 'secondary'} onClick={() => setNewOpen(f)} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Create new version from this</Button>
            )}
            {editable && <Button size="sm" variant="ghost" onClick={() => setNewOpen(latest)}>New version</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
          <Fig label="Budget" value={money(ee.totals.budget)} sub={`incl. ${money(B.contingency)} contingency`} />
          <Fig label="Actual to date" value={money(ee.totals.actual)} sub={`SAP through ${fmtMonth(cutoff)}`} />
          <Fig label="ETC" value={money(etcT)} sub={`${refs.length} lines · ${futureMonths.length} months`} />
          <Fig label="EAC" value={money(eac)} tone={eac > ee.totals.budget ? 'bad' : undefined} sub={f.eac !== eac ? `saved ${money(f.eac)}` : 'actuals + ETC + held'} />
          <Fig label="VAC" value={moneyDelta(ee.totals.vac)} tone={ee.totals.vac < 0 ? 'bad' : 'good'} sub={ee.totals.budget ? `${((ee.totals.vac / ee.totals.budget) * 100).toFixed(1)}% of budget` : 'budget − EAC'} />
          <Fig label="Contingency held" value={money(held)} sub={B.contingency ? `${Math.round((held / B.contingency) * 100)}% of ${money(B.contingency)}` : 'none in budget'} />
        </div>
      </Panel>

      {inst && <WorkflowStatus instanceId={inst.id} compact={statusOf(f) !== 'submitted'} />}
      {statusOf(f) === 'returned' && <Callout tone="bad" title="Returned for revision">{[...(inst?.history ?? [])].reverse().find((h) => h.action === 'return' || h.action === 'reject')?.comment ?? 'Revise the spread and resubmit.'}</Callout>}
      {stale > 0 && <Callout tone="warn" title={`${money(stale)} of ETC sits in months that have closed`}>
        <div className="flex flex-wrap items-center gap-2">SAP actuals are posted through {fmtMonth(through)}, so ETC in those months would be counted twice. <Button size="sm" onClick={carryStale}>Move it to the remaining months</Button></div>
      </Callout>}

      {/* ── Headline: ETC / EAC by function */}
      <Panel title="ETC / EAC by WBS function" pad={false}
        subtitle={`Budget, SAP actuals and estimate to complete by function, each expandable to its forecast line items. EAC = actual to date + ETC; VAC = budget − EAC.${editable ? ' Click a profile to change it.' : ''}`}
        actions={<span className="text-[11.5px] text-muted">Click an actual to see the SAP rows behind it</span>}>
        <EtcEacTable s={s} rows={ee.rows.map((r) => ({ ...r, lines: r.lines.map((l) => ({ id: l.line.id, code: l.line.code, name: l.line.name, budget: l.budget, actual: l.actual, etc: l.etc, eac: l.eac, vac: l.vac })) }))}
          contingencyBudget={B.contingency} contingencyHeld={held} totals={{ ...ee.totals, etc: etcT }}
          onProfile={editable ? setProfFn : undefined} onActual={drillActual} />
      </Panel>

      {/* ── Grid */}
      <Panel title="Spread by function and line item" pad={false}
        subtitle={editable ? 'Edit line items month by month (125000, $1.2M, 450K); function rows roll up. Arrows and Enter move between cells; paste a block from Excel to fill right and down. Click a function’s profile chip to phase it by a curve.' : `This version is ${STATUS_LABEL[statusOf(f)].toLowerCase()} and read-only. Create a new version to change it.`}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(allOpen ? new Set() : new Set(groups.map((g) => g.fn.id)))}>{allOpen ? 'Collapse to functions' : 'Expand all lines'}</Button>
          <SegButtons value={view} onChange={setAllYears} options={[{ id: 'months', label: 'Months' }, { id: 'years', label: 'Years' }]} />
          <SegButtons value={String(unit) as '1' | '1000'} onChange={(v) => setUnit(Number(v) as Unit)} options={[{ id: '1000', label: '$K' }, { id: '1', label: '$' }]} />
          <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" className="h-3.5 w-3.5" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />Actual months</label>
        </div>}>
        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
            <span className="eyebrow mr-1">Fill</span>
            <ConfirmButton size="sm" confirmLabel="Re-spread all" onConfirm={respreadAll}>Re-spread all from remaining budget</ConfirmButton>
            {prior && <ConfirmButton size="sm" confirmLabel="Replace with prior" onConfirm={fillPrior}>Fill from last approved ({fmtDate(prior.date)})</ConfirmButton>}
            {adjusted.length > 0 && <span className="flex flex-wrap items-center gap-1 text-[12px] text-muted">Reset to profile:{adjusted.map((fn) => <Button key={fn} size="sm" variant="ghost" onClick={() => resetProf(fn)}>{s.settings.wbsFunctions.find((x) => x.id === fn)?.code ?? fn}</Button>)}</span>}
            <span className="ml-auto text-[11.5px] text-faint">Figures in {unit === 1000 ? 'thousands of dollars' : 'dollars'} · typed numbers are read in the same unit</span>
          </div>
        )}
        <div className="p-2 sm:p-3">
          <LineGrid s={s} groups={groups} lines={lines} held={held} editable={editable} budget={B.byLine} budgetContingency={B.contingency} actual={lineAct}
            actualMonths={showPast ? pastMonths : []} actualGrid={actGrid} futureMonths={futureMonths} closedThrough={editable ? through : ''}
            collapsed={collapsed} onToggleYear={(y) => setCollapsed(toggle(collapsed, y))} pastCollapsed={pastCollapsed} onTogglePastYear={(y) => setPastCollapsed(toggle(pastCollapsed, y))}
            expanded={expanded} onToggleFn={(id) => setExpanded(toggle(expanded, id))} profiles={profiles}
            unit={unit} onChange={change} onHeld={changeHeld} onProfile={editable ? setProfFn : undefined} onLineTools={setLineTool} onDrill={setDrill} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm border border-line bg-ground" /><i>Actual</i> (SAP, read-only — click to drill)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm border border-link/40 bg-link/10" />Profile applied</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm border border-warn/50 bg-warn/10" />Profile adjusted by hand</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-bad" />EAC over budget</span>
          {editable && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-warn/15" />Closed month</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={exportCsv} icon={<Icon name="download" className="h-3.5 w-3.5" />}>CSV</Button>
            <Button size="sm" variant="ghost" onClick={exportHtml} icon={<Icon name="doc" className="h-3.5 w-3.5" />}>Report</Button>
            <a href="#actuals" className="self-center text-link hover:underline">SAP actuals</a>
            <button type="button" onClick={() => openReconciliation({ projectId: p.id })} className="self-center text-link hover:underline" title="Compare this project's SAP actuals with Crosswalk and this forecast">Reconcile with SAP</button>
            <a href={projectHref(p.id, 'cost')} className="self-center text-link hover:underline">Cost &amp; EVM</a>
          </span>
        </div>
      </Panel>

      {editable && (
        <Panel title="Forecast basis" subtitle="What moved since the last approved forecast and why. Reviewers see this with the spread.">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 06.10 re-profiled to the contractor’s mobilization plan; 09.10 paving held for the holiday moratorium." />
        </Panel>
      )}

      <Charts fns={fnRefs(s, fnSpread)} spread={fnSpread} held={held} actMonth={fnActMonth} pastMonths={pastMonths} futureMonths={futureMonths} budget={ee.totals.budget} byYear={view === 'years'} />

      <Compare s={s} p={p} versions={versions} current={W} />

      {profGroup && editable && (
        <ProfileModal s={s} p={p} fn={profGroup.fn} lines={profGroup.lines} grid={lines} months={baseMonths} profile={profiles[profGroup.fn.id]} actual={lineAct}
          onApply={(prof, total) => applyProf(profGroup.fn.id, prof, total)} onReset={profiles[profGroup.fn.id] ? () => { resetProf(profGroup.fn.id); setProfFn(null) } : undefined} onClose={() => setProfFn(null)} />
      )}
      {toolLine && editable && (
        <LineTools s={s} line={toolLine} row={lines[toolLine.id] ?? {}} months={futureMonths.filter((m) => m > through)} budget={B.byLine[toolLine.id] || 0} actual={lineAct[toolLine.id] || 0}
          onClose={() => setLineTool(null)}
          onApply={(row, what) => { change({ ...lines, [toolLine.id]: Object.fromEntries(Object.entries(row).filter(([, v]) => v)) }, `${toolLine.code} ${what}`, [toolLine.fnId]); setLineTool(null); toast(`${toolLine.code} ${what}`) }} />
      )}
      {drill && <ActualDrill projectId={p.id} lineId={drill.lineId} fnId={drill.fnId} months={drill.months} cellAmount={drill.amount} onClose={() => setDrill(null)} />}
      {newOpen && <NewVersion s={s} p={p} src={newOpen} onClose={() => setNewOpen(null)} onCreated={(id) => { setNewOpen(null); onSelect(id) }} dirty={dirty} />}
      {submitOpen && <SubmitModal s={s} p={p} f={f} eac={eac} budget={ee.totals.budget} adjusted={adjusted.map(fnLabel)} note={note} setNote={setNote} dirty={dirty} save={save} onClose={() => setSubmitOpen(false)} me={me.id} />}
    </div>
  )
}

function Fig({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2.5">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-0.5 font-display text-[20px] font-bold leading-tight tabular-nums', tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink')}>{value}</div>
      {sub && <div className="truncate text-[11.5px] text-muted">{sub}</div>}
    </div>
  )
}

// ───────────────────────────── New version
function NewVersion({ s, p, src, onClose, onCreated, dirty }: { s: AppState; p: Project; src: Forecast; onClose: () => void; onCreated: (id: string) => void; dirty: boolean }) {
  const me = useMe()
  const [slip, setSlip] = useState<SlipMode>('net')
  const [note, setNote] = useState(`${monthLabel(currentCycle(s))} cycle — copied from the ${fmtDate(src.date)} ${STATUS_LABEL[statusOf(src)].toLowerCase()} version`)
  const preview = useMemo(() => copyVersion(s, p, src, { byId: me.id, slip }), [s, p, src, me.id, slip])
  const staleTotal = sum(Object.values(lineGridOf(s, p, src)).flatMap((r) => Object.entries(r).filter(([m]) => m <= actualsThrough(s, p.id)).map(([, v]) => v)))
  const existing = versionsOf(s, p.id).find((v) => cycleOf(v.date) === currentCycle(s) && isEditable(v))
  const create = () => {
    const { forecast, moved } = copyVersion(s, p, src, { byId: me.id, slip, note: note.trim() })
    mutate((d) => { d.forecasts.push(forecast) }, { entity: 'forecast', entityId: forecast.id, projectId: p.id, action: 'create', summary: `New ${p.code} forecast version from the ${src.date} version: EAC ${money(forecast.eac, 'full')}${moved ? `; ${money(moved, 'full')} of ETC carried out of closed months` : ''}` })
    toast('New draft version created')
    onCreated(forecast.id)
  }
  return (
    <Modal open onClose={onClose} title="New forecast version" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create}>Create draft</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">Copies the {fmtDate(src.date)} version ({STATUS_LABEL[statusOf(src)]}, EAC {money(src.eac)}) line by line into a draft dated {fmtDate(s.settings.asOf)} with SAP actuals through {fmtMonth(actualsThrough(s, p.id))}. Function profiles carry over. The source version is not changed.</p>
        {dirty && <Callout tone="warn">You have unsaved changes on the open version. They stay unsaved; save first if you want them in the copy.</Callout>}
        {existing && <Callout tone="info">A draft for the {monthLabel(currentCycle(s))} cycle already exists ({fmtDate(existing.date)}). You can still create another; the newest one is the cycle’s working version.</Callout>}
        {staleTotal > 0 ? (
          <Field label={`${money(staleTotal)} of the source ETC falls in months that have now closed`}>
            <SegButtons value={slip} onChange={setSlip} options={[{ id: 'net', label: 'Carry forward what wasn’t spent' }, { id: 'all', label: 'Carry forward all' }, { id: 'drop', label: 'Drop it' }]} />
          </Field>
        ) : <p className="text-[12px] text-faint">No ETC in closed months — the spread carries over unchanged.</p>}
        <div className="grid grid-cols-3 gap-2 rounded border border-line bg-sunken/40 p-3 text-[12px]">
          <div><div className="eyebrow">Source EAC</div><div className="tabular-nums">{money(src.eac)}</div></div>
          <div><div className="eyebrow">New EAC</div><div className="font-semibold tabular-nums">{money(preview.forecast.eac)}</div></div>
          <div><div className="eyebrow">Moved forward</div><div className="tabular-nums">{money(preview.moved)}</div></div>
        </div>
        <Field label="Forecast basis note"><TextArea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Submit
function SubmitModal({ s, p, f, eac, budget, adjusted, note, setNote, dirty, save, onClose, me }: { s: AppState; p: Project; f: Forecast; eac: number; budget: number; adjusted: string[]; note: string; setNote: (v: string) => void; dirty: boolean; save: (quiet?: boolean) => void; onClose: () => void; me: string }) {
  const prior = priorApproved(s, p.id, f.id)
  const cycle = currentCycle(s)
  const submit = () => {
    if (!note.trim()) { toast('Add the forecast basis — what moved and why.', 'bad'); return }
    if (dirty || note !== f.note) save(true)
    const meP = s.people.find((x) => x.id === me)
    mutate((d) => {
      const x = d.forecasts.find((y) => y.id === f.id)
      if (!x) return
      const inst = startWorkflow(d, 'forecast-review', { title: `${p.code} ${monthLabel(cycle).split(' ')[0]} forecast`, recordType: 'forecast', recordId: f.id, projectId: p.id, data: { amount: x.eac, period: cycle, note: note.trim() } })
      const slot = inst?.active.find((a) => a.nodeId === 'prep')
      if (inst && slot && (slot.assigneeIds.includes(me) || meP?.roles.includes('admin'))) actOnWorkflow(d, inst.id, slot.nodeId, me, 'submit', slot.assigneeIds.includes(me) ? 'Forecast submitted' : 'Forecast submitted (as administrator)')
    }, { entity: 'forecast', entityId: f.id, projectId: p.id, action: 'submit', summary: `Submitted ${p.code} ${fmtMonth(cycle)} forecast for review: EAC ${money(eac, 'full')}${prior ? ` (${moneyDelta(eac - prior.eac)} vs prior approved)` : ''}` })
    toast('Submitted for review')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title="Submit forecast for review" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit for review</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 rounded border border-line bg-sunken/40 p-3 text-[12px]">
          <div><div className="eyebrow">EAC</div><div className="font-semibold tabular-nums">{money(eac, 'full')}</div></div>
          <div><div className="eyebrow">VAC</div><div className={cx('tabular-nums', budget - eac < 0 ? 'text-bad' : 'text-good')}>{moneyDelta(budget - eac)}</div></div>
          <div><div className="eyebrow">vs prior approved</div><div className="tabular-nums">{prior ? moneyDelta(eac - prior.eac) : '—'}</div></div>
        </div>
        {adjusted.length > 0 && <Callout tone="warn" title="Profiles adjusted by hand">{adjusted.join(', ')} {adjusted.length === 1 ? 'was' : 'were'} edited after the profile was applied. Say why in the basis so reviewers can follow the change.</Callout>}
        <p className="text-[12.5px] text-muted">Routes to project controls for validation against commitments and burn rate, then to the program manager. Approval locks this version.{dirty ? ' Your unsaved changes are saved first.' : ''}</p>
        <Field label="Forecast basis (required)"><TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What moved since the last approved forecast and why" /></Field>
      </div>
    </Modal>
  )
}

// ───────────────────────────── Charts
function Charts({ fns, spread, held, actMonth, pastMonths, futureMonths, budget, byYear }: {
  fns: ReturnType<typeof fnRefs>; spread: Spread; held: number; actMonth: Spread; pastMonths: string[]; futureMonths: string[]; budget: number; byYear: boolean
}) {
  const data = useMemo(() => {
    const past = pastMonths.slice(-12)
    const months = [...past, ...futureMonths]
    const top = [...fns].sort((a, b) => rowTotal(spread, b.id) - rowTotal(spread, a.id)).filter((x) => rowTotal(spread, x.id) > 0).slice(0, 5)
    const rest = fns.filter((x) => !top.includes(x))
    const actBy = (m: string) => sum(Object.values(actMonth).map((r) => r[m] || 0))
    const keyOf = (m: string) => (byYear ? m.slice(0, 4) : m)
    const labels = Array.from(new Set(months.map(keyOf)))
    const agg = (fn: (m: string) => number) => labels.map((k) => sum(months.filter((m) => keyOf(m) === k).map(fn)))
    const series = [
      { name: 'Actuals (SAP)', values: agg((m) => (past.includes(m) ? actBy(m) : 0)), color: 'rgb(var(--faint))' },
      ...top.map((x, i) => ({ name: `${x.code} ${x.name}`, values: agg((m) => spread[x.id]?.[m] || 0), color: [SERIES[0], SERIES[2], SERIES[5], SERIES[1], SERIES[3]][i] })),
      ...(rest.some((x) => rowTotal(spread, x.id)) ? [{ name: 'Other functions', values: agg((m) => sum(rest.map((x) => spread[x.id]?.[m] || 0))), color: 'rgb(var(--muted) / 0.55)' }] : []),
    ]
    const before = sum(Object.values(actMonth).flatMap((r) => Object.entries(r).filter(([m]) => !past.includes(m) && m <= (pastMonths[pastMonths.length - 1] ?? '')).map(([, v]) => v)))
    const byM: Record<string, number> = {}
    for (const r of Object.values(spread)) for (const [m, v] of Object.entries(r)) byM[m] = (byM[m] || 0) + v
    let acc = before
    const cum = months.map((m, i) => { acc += past.includes(m) ? actBy(m) : byM[m] || 0; if (i === months.length - 1) acc += held; return acc })
    const cumLabels = byYear ? labels : months.map(shortMonth)
    const cumVals = byYear ? labels.map((k) => cum[months.map(keyOf).lastIndexOf(k)]) : cum
    return { labels: byYear ? labels : labels.map(shortMonth), series, cumLabels, cumVals, pastN: byYear ? 0 : past.length }
  }, [fns, spread, held, actMonth, pastMonths, futureMonths, byYear])
  if (!futureMonths.length) return null
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Panel className="xl:col-span-3" title={byYear ? 'Spend by year' : 'Spend by month'} subtitle="Recent SAP actuals (grey) and forecast ETC by function — top five functions, the rest grouped">
        <BarChart labels={data.labels} series={data.series} stacked height={230} />
      </Panel>
      <Panel className="xl:col-span-2" title="Cumulative EAC vs budget" subtitle="Running total of actuals then forecast; contingency held lands in the last month">
        <LineChart labels={data.cumLabels} series={[{ name: 'Cumulative EAC', values: data.cumVals, area: true }, { name: 'Budget', values: data.cumLabels.map(() => budget), dashed: true, color: 'rgb(var(--ink))' }]} height={230}
          markers={data.pastN ? [{ index: data.pastN - 1, label: 'Actuals' }] : undefined} />
      </Panel>
    </div>
  )
}

// ───────────────────────────── Compare versions
function Compare({ s, p, versions, current }: { s: AppState; p: Project; versions: Forecast[]; current: Forecast }) {
  const others = versions.filter((v) => v.id !== current.id)
  const [aId, setAId] = useState<string>(() => (priorApproved(s, p.id, current.id) ?? others[0])?.id ?? '')
  const a = versions.find((v) => v.id === aId)
  const [tab, setTab] = useState<'fn' | 'line' | 'month'>('fn')
  const lineRows = useMemo(() => {
    if (!a) return []
    const ga = lineGridOf(s, p, a), gb = lineGridOf(s, p, current)
    const aa = lineActuals(s, p.id, versionCutoff(s, a)), ab = lineActuals(s, p.id, versionCutoff(s, current))
    return lineRefs(s, ga, gb).map((l) => {
      const etcA = rowTotal(ga, l.id), etcB = rowTotal(gb, l.id)
      const eacA = (aa[l.id] || 0) + etcA, eacB = (ab[l.id] || 0) + etcB
      return { ...l, etcA, etcB, eacA, eacB, delta: eacB - eacA }
    })
  }, [s, p, a, current])
  if (!a) return null
  const c = compareVersions(s, a, current)
  const label = (f: Forecast) => `${fmtDate(f.date)} · ${STATUS_LABEL[statusOf(f)]}`
  const profA = a.profiles ?? {}, profB = current.profiles ?? {}
  const profMoves = s.settings.wbsFunctions.filter((fn) => JSON.stringify(profA[fn.id] ?? null) !== JSON.stringify(profB[fn.id] ?? null) && profB[fn.id])
  return (
    <Panel title="Compare versions" subtitle="What moved between two forecasts — by function, line item and month" pad={false}
      actions={<div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Select aria-label="Compare against" className="h-8 w-auto py-1" value={aId} onChange={(e) => setAId(e.target.value)} options={others.map((v) => ({ value: v.id, label: label(v) }))} />
        <span className="text-muted">→ open version ({fmtDate(current.date)})</span>
      </div>}>
      <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-3">
        <div className="bg-surface p-4">
          <div className="eyebrow">EAC change</div>
          <div className={cx('mt-1 font-display text-[24px] font-bold tabular-nums', current.eac - a.eac > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(current.eac - a.eac)}</div>
          <div className="text-[12px] text-muted">{money(a.eac)} → {money(current.eac)}{c.heldB !== c.heldA ? ` · held contingency ${moneyDelta(c.heldB - c.heldA)}` : ''}</div>
          <div className="eyebrow mb-1.5 mt-4">Biggest movers</div>
          {c.movers.length ? <HBarChart rows={c.movers.map((r) => ({ label: `${r.code} ${r.name}`, value: r.delta, color: r.delta > 0 ? 'rgb(var(--bad))' : 'rgb(var(--good))' }))} format={moneyDelta} /> : <div className="text-[12px] text-faint">No function moved.</div>}
          {profMoves.length > 0 && <>
            <div className="eyebrow mb-1 mt-4">Profile changes</div>
            <ul className="flex flex-col gap-1 text-[12px]">{profMoves.map((fn) => <li key={fn.id}><span className="font-mono text-[11px] text-faint">{fn.code}</span> {profA[fn.id] ? profileName(s, profA[fn.id].profileId) : 'none'} → <b>{profileName(s, profB[fn.id].profileId)}</b>{profB[fn.id].adjusted && <span className="text-warn"> (adjusted)</span>}</li>)}</ul>
          </>}
        </div>
        <div className="bg-surface p-4 lg:col-span-2">
          <SegButtons value={tab} onChange={setTab} options={[{ id: 'fn', label: 'By function' }, { id: 'line', label: 'By line item' }, { id: 'month', label: 'By month' }]} />
          <div className="scroll-x mt-2 max-h-[340px] overflow-y-auto">
            {tab === 'fn' && (
              <table className="tbl">
                <thead><tr><th>Function</th><th className="num">ETC before</th><th className="num">ETC now</th><th className="num">EAC before</th><th className="num">EAC now</th><th className="num">Change</th></tr></thead>
                <tbody>{c.rows.map((r) => <tr key={r.id}><td><span className="font-mono text-[11px] text-faint">{r.code}</span> {r.name}</td><td className="num text-muted">{money(r.etcA)}</td><td className="num">{money(r.etcB)}</td><td className="num text-muted">{money(r.eacA)}</td><td className="num">{money(r.eacB)}</td><td className={cx('num font-semibold', r.delta > 0 ? 'text-bad' : r.delta < 0 ? 'text-good' : 'text-faint')}>{r.delta ? moneyDelta(r.delta) : '–'}</td></tr>)}</tbody>
              </table>
            )}
            {tab === 'line' && (
              <table className="tbl">
                <thead><tr><th>Line item</th><th className="num">ETC before</th><th className="num">ETC now</th><th className="num">EAC before</th><th className="num">EAC now</th><th className="num">Change</th></tr></thead>
                <tbody>{lineRows.map((r) => <tr key={r.id}><td className="whitespace-nowrap"><span className="font-mono text-[11px] text-faint">{r.code}</span> {r.name}</td><td className="num text-muted">{money(r.etcA)}</td><td className="num">{money(r.etcB)}</td><td className="num text-muted">{money(r.eacA)}</td><td className="num">{money(r.eacB)}</td><td className={cx('num font-semibold', r.delta > 0 ? 'text-bad' : r.delta < 0 ? 'text-good' : 'text-faint')}>{r.delta ? moneyDelta(r.delta) : '–'}</td></tr>)}</tbody>
              </table>
            )}
            {tab === 'month' && (
              <table className="tbl">
                <thead><tr><th>Month</th><th className="num">ETC before</th><th className="num">ETC now</th><th className="num">Change</th></tr></thead>
                <tbody>{c.months.map((m) => <tr key={m.month}><td>{fmtMonth(m.month)}</td><td className="num text-muted">{money(m.a)}</td><td className="num">{money(m.b)}</td><td className={cx('num', m.delta > 0 ? 'text-bad' : m.delta < 0 ? 'text-good' : 'text-faint')}>{m.delta ? moneyDelta(m.delta) : '–'}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-px border-t border-line bg-line md:grid-cols-2">
        <div className="bg-surface px-4 py-3 text-[12.5px]"><div className="eyebrow mb-1">Basis · {label(a)} · {personName(s, a.byId)}</div>{a.note || <span className="text-faint">No note.</span>}</div>
        <div className="bg-surface px-4 py-3 text-[12.5px]"><div className="eyebrow mb-1">Basis · open version · {personName(s, current.byId)}</div>{current.note || <span className="text-faint">No note yet.</span>}</div>
      </div>
    </Panel>
  )
}
