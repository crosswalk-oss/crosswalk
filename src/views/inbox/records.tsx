import { functionRows } from '@/core/engine/wbs'
// Record summaries shown next to a workflow task, so an approver can decide without hunting for the record.
import type { AppState, DeliverableDef, WorkflowInstance } from '@/core/types'
import { personName } from '@/core/store'
import { projectHref } from '@/core/router'
import { estimateTotals } from '@/core/engine/estimates'
import { position } from '@/core/engine/position'
import { readiness, stageName, templateFor } from '@/core/engine/gates'
import { categoryName } from '@/core/store'
import { fmtDate, money, moneyDelta } from '@/core/util'
import { Badge, Callout, ClassBadge, KV, Progress, StatusBadge } from '@/ui/kit'
import { ProgramTag } from '../shared/pickers'
import { QuickReviewSummary } from '../estimating/quick/QuickView'
import { FactorModelReviewSummary } from '../estimating/admin/FactorModel'
import { commitmentRow } from '@/core/engine/finance'
import { lineById } from '@/core/engine/lines'

export function deliverableDef(s: AppState, defId: string): DeliverableDef | undefined {
  for (const t of s.templates) for (const st of t.stages) { const d = st.gate.deliverables.find((x) => x.id === defId); if (d) return d }
  return undefined
}

/** Which project tab holds the record behind an instance. */
export function recordTab(inst: WorkflowInstance): string {
  switch (inst.recordType) {
    case 'estimate': return 'estimates'
    case 'change': return 'changes'
    case 'safety-plan': return 'safety'
    case 'contingency': return 'risk'
    case 'variance': return 'cost'
    case 'contract': return 'permits'
    case 'closeout': return 'records'
    case 'budget': return 'baselines'
    case 'forecast': return 'forecast'
    case 'commitment-change': return 'finance'
    default: return 'lifecycle'
  }
}

export function recordHref(inst: WorkflowInstance): string | undefined {
  if (inst.projectId) return projectHref(inst.projectId, recordTab(inst))
  if (inst.recordType === 'initiation') return '#allocation'
  return undefined
}

export function ProjectLine({ s, projectId }: { s: AppState; projectId?: string }) {
  const p = s.projects.find((x) => x.id === projectId)
  if (!p) return <div className="text-[12px] text-muted">Portfolio-level request (no project yet)</div>
  const pos = position(s, p.id)
  return (
    <div className="rounded border border-line bg-sunken/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]"><ProgramTag programId={p.programId} /><a href={projectHref(p.id)} className="font-mono font-semibold text-link">{p.code}</a><span className="min-w-0 truncate font-semibold">{p.name}</span></div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted">
        <span>{stageName(s, p)}</span><span>PM {personName(s, p.team.pm)}</span>
        {pos.currentBudget > 0 && <span>Budget <b className="text-ink tabular-nums">{money(pos.currentBudget)}</b></span>}
        {pos.eac > 0 && <span>EAC <b className={pos.currentBudget && pos.eac > pos.currentBudget ? 'text-bad tabular-nums' : 'text-ink tabular-nums'}>{money(pos.eac)}</b></span>}
      </div>
    </div>
  )
}

export function RecordSummary({ s, inst }: { s: AppState; inst: WorkflowInstance }) {
  const p = s.projects.find((x) => x.id === inst.projectId)
  const pos = p ? position(s, p.id) : undefined
  const d = inst.data
  switch (inst.recordType) {
    case 'estimate': {
      const e = s.estimates.find((x) => x.id === inst.recordId)
      if (!e) break
      if (e.method === 'quick') return <QuickReviewSummary estimateId={e.id} />
      const t = estimateTotals(e)
      const prev = s.estimates.filter((x) => x.projectId === e.projectId && x.status === 'approved' && x.id !== e.id).sort((a, b) => b.version - a.version)[0]
      const pt = prev && estimateTotals(prev)
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-end gap-3"><div className="font-display text-[26px] font-bold leading-none tabular-nums">{money(t.total)}</div><ClassBadge cls={e.cls} size="lg" /><span className="text-[12px] text-muted">v{e.version} · {e.method}</span></div>
          <div className="text-[12px] text-muted">Range {money(t.low)} – {money(t.high)} at Class {e.cls}{pt && <> · vs approved Class {prev!.cls} {money(pt.total)} (<b className={t.total > pt.total ? 'text-bad' : 'text-good'}>{moneyDelta(t.total - pt.total)}</b>)</>}</div>
          <KV cols={2} items={[['Base (direct + loaders + escalation)', money(t.base)], ['Contingency', `${money(t.contingency)} (${e.contingency.pct}% ${e.contingency.method})`], ['Lines', String(e.lines.length)], ['Prepared by', personName(s, e.createdById)]]} />
          {e.basis.classJustification && <p className="text-[12.5px] text-muted"><b className="text-ink">Class basis:</b> {e.basis.classJustification}</p>}
        </div>
      )
    }
    case 'change': {
      const c = s.changes.find((x) => x.id === inst.recordId)
      if (!c) break
      const remaining = pos?.contingencyRemaining ?? 0
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-end gap-4">
            <div><div className="eyebrow">Cost impact</div><div className="font-display text-[24px] font-bold tabular-nums">{moneyDelta(c.costImpact)}</div></div>
            <div><div className="eyebrow">Schedule</div><div className={`font-display text-[24px] font-bold tabular-nums ${c.scheduleImpactDays > 30 ? 'text-warn' : ''}`}>{c.scheduleImpactDays ? `+${c.scheduleImpactDays} d` : '0 d'}</div></div>
            <Badge tone="ink">{c.code}</Badge><StatusBadge status={c.status} />
          </div>
          <KV cols={2} items={[['Root cause', c.rootCause], ['Funded from', c.fundedFrom === 'contingency' ? 'Contingency' : c.fundedFrom === 'new-funding' ? 'New funding' : 'None'], ['Cost category', categoryName(s, c.categoryId)], ['Contingency remaining', <span key="r" className={c.fundedFrom === 'contingency' && c.costImpact > remaining ? 'font-semibold text-bad' : ''}>{money(remaining)}</span>]]} />
          {c.fundedFrom === 'contingency' && c.costImpact > remaining && <Callout tone="bad">This change exceeds remaining contingency by {money(c.costImpact - remaining)}.</Callout>}
          <p className="text-[12.5px] text-muted">{c.description}{c.scopeImpact && c.scopeImpact !== 'None' ? ` Scope: ${c.scopeImpact}` : ''}</p>
        </div>
      )
    }
    case 'safety-plan': {
      const sp = s.safetyPlans.find((x) => x.id === inst.recordId)
      if (!sp) break
      const expiring = sp.tickets.filter((t) => t.expires < s.settings.asOf).length
      const oqOn = !!s.settings.features?.opQual
      const nonCompliant = sp.crew.filter((c) => c.prequal === 'Non-compliant' || (oqOn && c.oqExpires < s.settings.asOf)).length
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">Work package {sp.workPackage}</b><Badge>v{sp.version}</Badge><StatusBadge status={sp.status} /></div>
          <KV cols={2} items={[['Contractor', sp.contractor], ['Activities', sp.activities.join(', ')], ['Hazards covered', String(sp.hazardIds.length)], ['Crew', `${sp.crew.length} people`], ['Tickets & permits', `${sp.tickets.length}${expiring ? ` (${expiring} expired)` : ''}`], ['Heat / traffic plan', `${sp.heatPlan ? 'Yes' : 'No'} / ${sp.trafficPlan ? 'Yes' : 'No'}`]]} />
          {(nonCompliant > 0 || expiring > 0) && <Callout tone="warn">{nonCompliant ? `${nonCompliant} crew member(s) with ${oqOn ? 'lapsed OQ or ' : ''}non-compliant prequalification. ` : ''}{expiring ? `${expiring} ticket(s) expired.` : ''}</Callout>}
          <p className="text-[12px] text-muted">Site: {sp.site.address} · Hospital {sp.site.hospital} · Muster {sp.site.musterPoint}</p>
        </div>
      )
    }
    case 'deliverable': {
      const dl = s.deliverables.find((x) => x.id === inst.recordId)
      if (!dl) break
      const def = deliverableDef(s, dl.defId)
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{def?.name ?? String(d.deliverable ?? 'Deliverable')}</b><Badge>v{dl.version}</Badge><StatusBadge status={dl.status} /></div>
          {def && <p className="text-[12.5px] text-muted">{def.description}</p>}
          {def && <Callout tone="info" title="Acceptance criteria">{def.acceptance}</Callout>}
          <KV cols={2} items={[['Owner', personName(s, dl.ownerId)], ['Due', fmtDate(dl.due)], ['Stage', p ? templateFor(s, p).stages[dl.stageIndex]?.name : '—'], ['Evidence', `${dl.evidence.length} file${dl.evidence.length === 1 ? '' : 's'}`]]} />
          {dl.evidence.length > 0 && <ul className="flex flex-col gap-0.5 text-[12.5px]">{dl.evidence.map((ev) => <li key={ev.id} className="flex justify-between gap-2"><span className="truncate">{ev.name}</span><span className="shrink-0 text-faint">{ev.sizeKb.toLocaleString()} KB</span></li>)}</ul>}
          {dl.evidence.length === 0 && <Callout tone="warn">No evidence attached. Return it if the criteria need a document.</Callout>}
        </div>
      )
    }
    case 'variance': {
      const v = s.variances.find((x) => x.id === inst.recordId)
      if (!v) break
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-end gap-3"><div className="font-display text-[22px] font-bold tabular-nums text-bad">{v.metric === 'eac' ? moneyDelta(v.amount) : `+${v.amount} days`}</div><span className="text-[12.5px]">{v.description}</span></div>
          <KV cols={2} items={[['Root cause', v.rootCause ?? '—'], ['Author', personName(s, v.authorId)], ['Budget', money(pos?.currentBudget)], ['Forecast (EAC)', money(pos?.eac)]]} />
          <div className="rounded border border-line px-3 py-2 text-[13px]"><div className="eyebrow mb-1">Explanation</div>{v.narrative || <span className="text-muted">No narrative yet.</span>}</div>
        </div>
      )
    }
    case 'contingency': {
      const c = s.contingencyDraws.find((x) => x.id === inst.recordId)
      if (!c) break
      const risk = s.risks.find((r) => r.id === c.riskId)
      const remaining = pos?.contingencyRemaining ?? 0
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-end gap-4">
            <div><div className="eyebrow">Drawdown</div><div className="font-display text-[24px] font-bold tabular-nums">{money(c.amount)}</div></div>
            <div><div className="eyebrow">Contingency left</div><div className="font-display text-[24px] font-bold tabular-nums">{money(remaining)}</div></div>
            <div><div className="eyebrow">After this draw</div><div className={`font-display text-[24px] font-bold tabular-nums ${remaining - c.amount < 0 ? 'text-bad' : ''}`}>{money(remaining - c.amount)}</div></div>
          </div>
          {pos && pos.contingencyOriginal > 0 && <Progress value={((pos.contingencyUsed + c.amount) / pos.contingencyOriginal) * 100} tone={(pos.contingencyUsed + c.amount) / pos.contingencyOriginal > 0.75 ? 'warn' : 'ink'} />}
          <KV cols={2} items={[['Risk realized', risk ? <span key="r"><b>{risk.code}</b> {risk.title}</span> : String(d.risk ?? '—')], ['Risk most-likely cost', risk ? money(risk.cost.ml) : '—']]} />
          <p className="text-[12.5px] text-muted">{c.reason}</p>
        </div>
      )
    }
    case 'gate': {
      if (!p) break
      const r = readiness(s, p)
      const gate = templateFor(s, p).stages[p.stageIndex]?.gate
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">{gate?.name}</b>{String(d.recommendation ?? '') && <Badge tone="info">PM recommends: {String(d.recommendation)}</Badge>}</div>
          <div className="flex items-center gap-3"><div className="font-display text-[26px] font-bold tabular-nums">{r.pct}%</div><div className="flex-1"><Progress value={r.pct} tone={r.ready ? 'good' : r.pct >= 75 ? 'warn' : 'bad'} /><div className="mt-1 text-[11.5px] text-muted">{r.done} of {r.total} deliverables accepted</div></div></div>
          <KV cols={2} items={[['Estimate', r.estimateRequired ? <span key="e" className={r.estimateOk ? 'text-good' : 'text-bad'}>{r.estimateClass ? `Class ${r.estimateClass}` : 'None approved'} (needs Class {r.estimateRequired})</span> : 'No class requirement'], ['High risks without response', <span key="h" className={r.highRisks ? 'text-bad' : ''}>{r.highRisks}</span>]]} />
          {r.blockers.length ? <Callout tone="warn" title="Blockers">{r.blockers.map((b) => <div key={b}>{b}</div>)}</Callout> : <Callout tone="good">Packet complete — ready for the board.</Callout>}
          {r.missing.length > 0 && <div className="text-[12px] text-muted">Outstanding: {r.missing.map((m) => m.name).join(', ')}</div>}
        </div>
      )
    }
    case 'waiver': {
      const dl = s.deliverables.find((x) => x.id === d.deliverableId)
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2"><b className="text-[15px]">Exception request</b>{String(d.permission ?? '') && <Badge tone="warn">{String(d.permission)}</Badge>}</div>
          <p className="text-[13px]">{String(d.reason ?? '')}</p>
          {dl && <KV cols={2} items={[['Deliverable affected', deliverableDef(s, dl.defId)?.name ?? '—'], ['Deliverable status', <StatusBadge key="s" status={dl.status} />]]} />}
          <Callout tone="info">Approved exceptions are flagged on every later gate packet and the rate-case evidence package.</Callout>
        </div>
      )
    }
    case 'initiation':
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-end gap-3"><div><div className="eyebrow">Rough order of magnitude</div><div className="font-display text-[24px] font-bold tabular-nums">{money(Number(d.amount ?? 0))}</div></div></div>
          <div className="rounded border border-line px-3 py-2 text-[13px]"><div className="eyebrow mb-1">Need</div>{String(d.need ?? '')}</div>
          <p className="text-[12px] text-muted">Submitted by {personName(s, inst.startedById)}. Approval creates the project in Initiation with a Class 5 estimate to prepare.</p>
        </div>
      )
    case 'forecast': {
      const f = s.forecasts.find((x) => x.id === inst.recordId)
      if (!f || !p) break
      const prior = s.forecasts.filter((x) => x.projectId === f.projectId && x.status === 'approved' && x.id !== f.id).sort((a, b) => a.date.localeCompare(b.date)).pop()
      const rows = functionRows(s, p, f)
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-end gap-3"><div className="font-display text-[26px] font-bold leading-none tabular-nums">{money(f.eac)}</div><span className="text-[12px] text-muted">EAC · budget {money(pos?.currentBudget)}{prior && <> · vs prior approved <b className={f.eac > prior.eac ? 'text-bad' : 'text-good'}>{moneyDelta(f.eac - prior.eac)}</b></>}</span></div>
          <table className="tbl"><thead><tr><th>WBS function</th><th className="num">Budget</th><th className="num">ETC</th><th className="num">EAC</th><th className="num">Var.</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.fn.id}><td><span className="font-mono text-[11px] text-faint">{r.fn.code}</span> {r.fn.name}</td><td className="num">{money(r.budget)}</td><td className="num">{money(r.etc)}</td><td className="num">{money(r.eac)}</td><td className={'num ' + (r.variance < 0 ? 'text-bad' : 'text-muted')}>{moneyDelta(r.variance)}</td></tr>)}</tbody></table>
          {f.note && <p className="text-[12.5px] text-muted"><b className="text-ink">Basis:</b> {f.note}</p>}
        </div>
      )
    }
    case 'commitment-change': return <CommitmentChangeSummary s={s} id={inst.recordId} />
    case 'factor-model': return <FactorModelReviewSummary s={s} id={inst.recordId} />
    case 'contract': {
      const c = s.contracts.find((x) => x.id === inst.recordId)
      return <KV cols={2} items={[['Vendor', c?.vendor ?? String(d.vendor ?? '—')], ['Value', money(c?.value ?? Number(d.amount ?? 0))], ['Type', c?.type ?? '—'], ['Non-standard terms', d.nonStandard ? 'Yes' : 'No']]} />
    }
  }
  const entries = Object.entries(d).filter(([k]) => !k.startsWith('__'))
  return entries.length ? <KV cols={2} items={entries.map(([k, v]) => [k, typeof v === 'number' && k.toLowerCase().includes('amount') ? money(v) : String(v ?? '—')])} /> : <p className="text-[13px] text-muted">No form data.</p>
}


/** RFI / contract change order: what the vendor is asked to do, and the commitment before and after. */
function CommitmentChangeSummary({ s, id }: { s: AppState; id: string }) {
  const x = s.commitmentChanges.find((c) => c.id === id)
  if (!x) return <p className="text-[13px] text-muted">Record not found.</p>
  const k = s.contracts.find((c) => c.id === x.contractId)
  const r = k ? commitmentRow(s, k) : undefined
  const ch = s.changes.find((c) => c.id === x.changeId)
  const live = x.status === 'in-review' || x.status === 'draft'
  const after = r ? r.current + (live ? x.amount : 0) : 0
  const io = k ? s.projects.find((p) => p.id === k.projectId)?.finance?.ios.find((i) => i.id === k.ioId) : undefined
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-4">
        <div><div className="eyebrow">Change amount</div><div className={`font-display text-[24px] font-bold tabular-nums ${x.amount > 0 ? 'text-bad' : x.amount < 0 ? 'text-good' : ''}`}>{moneyDelta(x.amount)}</div></div>
        <div><div className="eyebrow">Schedule</div><div className={`font-display text-[24px] font-bold tabular-nums ${x.scheduleImpactDays > 0 ? 'text-warn' : ''}`}>{x.scheduleImpactDays ? `+${x.scheduleImpactDays} d` : '0 d'}</div></div>
        <Badge tone="ink">{x.code}</Badge><StatusBadge status={x.status} />
      </div>
      <div className="rounded border border-line px-3 py-2 text-[13px]"><div className="eyebrow mb-1">RFI / field condition</div><b>{x.rfi}</b><div className="mt-1 text-muted">{x.description}</div></div>
      {k && r && <KV cols={2} items={[
        ['Commitment', <span key="v"><b>{k.vendor}</b> · {k.type}</span>], ['SAP PO', `${k.poNumber ?? '—'}${k.pctOfPo !== undefined ? ` · ${k.pctOfPo}% of ${money(k.poTotal)}` : ''}`],
        ['Current commitment', money(r.current)], [live ? 'If approved' : 'After decision', <b key="a" className="tabular-nums">{money(after)}</b>],
        ['Invoiced', `${money(r.invoiced)} (${r.current ? Math.round((r.invoiced / r.current) * 100) : 0}%)`], ['Other changes in review', money(r.pendingChanges - (x.status === 'in-review' ? x.amount : 0))],
        ['Internal order', io ? `${io.number} · ${io.type === 'capital' ? 'Capital' : 'O&M'}` : 'None'], ['Forecast lines', (k.lineIds ?? []).map((l) => lineById(s, l)?.code).join(', ') || '—'],
      ]} />}
      {k?.scope && <p className="text-[12.5px] text-muted"><b className="text-ink">Commitment scope:</b> {k.scope}</p>}
      {ch ? <Callout tone="info">Rolls into project change <b>{ch.code}</b> {ch.title} ({ch.status}).</Callout> : <p className="text-[12px] text-muted">Absorbed within the commitment; no project baseline change linked.</p>}
      {live && r && k && !!k.poTotal && after > (r.poShare ?? Infinity) && <Callout tone="warn">Approval takes this project to {((after / k.poTotal) * 100).toFixed(1)}% of the PO against {k.pctOfPo}% planned. Raise the planned share with supply.</Callout>}
    </div>
  )
}
