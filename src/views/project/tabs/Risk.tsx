// Project risk register, quantitative analysis and contingency (RK-01 … RK-11).
import { useMemo, useState } from 'react'
import type { MonteCarloResult, Risk as RiskT } from '@/core/types'
import { mutate, personName, useStore } from '@/core/store'
import { expectedCost, isActive, pert, riskScore } from '@/core/engine/risk'
import { position } from '@/core/engine/position'
import { askJSON, aiMessage, useAiAvailable } from '@/core/ai'
import { addDays, fmtDate, fmtMonth, groupBy, money, moneyDelta, pct, sum, uid, cx } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, Empty, Modal, Panel, SegButtons, Select, Stat, StatusBadge, Table, Input, Mono, type Column } from '@/ui/kit'
import { HBarChart, Histogram, LineChart, RiskMatrix } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { WorkflowStatus } from '@/views/shared/WorkflowStatus'
import { RiskEditor, ScoreChip } from '@/views/risk/RiskEditor'
import { DrawModal } from '@/views/risk/DrawModal'
import {
  PROB_BY_L, adequacy, budgetBase, burndown, contingencyBasis, delayedDate, exposureSummary, inServiceForecast, latestMonteCarlo, nextRiskCode, residualScore, riskFromLibrary, runMonteCarlo,
} from '@/views/risk/lib'

type View = 'active' | 'all' | 'closed'

export default function Risk({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const risks = s.risks.filter((r) => r.projectId === projectId)
  const [matrixMode, setMatrixMode] = useState<'inherent' | 'residual'>('inherent')
  const [cell, setCell] = useState<string | undefined>()
  const [view, setView] = useState<View>('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<{ risk: RiskT; isNew?: boolean } | null>(null)
  const [drawFor, setDrawFor] = useState<RiskT | null | undefined>(undefined)
  const [libOpen, setLibOpen] = useState(false)

  const summary = exposureSummary(risks, s.settings.asOf)
  const basis = contingencyBasis(s, projectId)
  const pos = position(s, projectId)

  const shown = risks
    .filter((r) => (view === 'active' ? isActive(r) : view === 'closed' ? !isActive(r) : true))
    .filter((r) => !cell || `${matrixMode === 'inherent' ? r.likelihood : r.residual.likelihood}-${matrixMode === 'inherent' ? r.consequence : r.residual.consequence}` === cell)
    .filter((r) => !q || (r.code + r.title + r.category + r.cause + r.event).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => riskScore(b) - riskScore(a) || expectedCost(b) - expectedCost(a))

  const cells: Record<string, number> = {}
  for (const r of risks.filter(isActive)) {
    const k = matrixMode === 'inherent' ? `${r.likelihood}-${r.consequence}` : `${r.residual.likelihood}-${r.residual.consequence}`
    cells[k] = (cells[k] || 0) + 1
  }

  const newRisk = () => setEditing({
    isNew: true,
    risk: {
      id: uid('rsk'), projectId, code: nextRiskCode(s, p), title: '', cause: '', event: '', effect: '', category: 'Third-party / substructures', kind: 'threat', ownerId: p.team.pm ?? s.currentUserId,
      status: 'open', likelihood: 3, consequence: 3, consequenceDim: 'Financial', probability: PROB_BY_L[2], cost: { min: 0, ml: 0, max: 0 }, scheduleDays: { min: 0, ml: 0, max: 0 },
      responses: [], residual: { likelihood: 2, consequence: 3 }, createdAt: s.settings.asOf,
    },
  })

  const cols: Column<RiskT>[] = [
    { key: 'code', header: 'Code', render: (r) => <Mono className="font-semibold">{r.code}</Mono>, sort: (r) => r.code },
    { key: 'title', header: 'Risk', render: (r) => <div className="min-w-[180px] max-w-[300px]"><div className="font-semibold">{r.title}</div><div className="truncate text-xs text-muted" title={r.event}>{r.event}</div></div>, sort: (r) => r.title },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-[12px]">{r.category}</span>, sort: (r) => r.category },
    { key: 'kind', header: 'Kind', render: (r) => <Badge tone={r.kind === 'opportunity' ? 'good' : 'neutral'}>{r.kind === 'opportunity' ? 'Opportunity' : 'Threat'}</Badge>, sort: (r) => r.kind },
    { key: 'owner', header: 'Owner', render: (r) => <span className="whitespace-nowrap text-[12px]">{personName(s, r.ownerId)}</span>, sort: (r) => personName(s, r.ownerId) },
    { key: 'score', header: 'L×C', render: (r) => <span className="inline-flex items-center gap-1"><ScoreChip l={r.likelihood} c={r.consequence} /><span className="text-[11px] text-faint">→</span><ScoreChip l={r.residual.likelihood} c={r.residual.consequence} title="Residual" /></span>, sort: (r) => riskScore(r) },
    { key: 'p', header: 'P', num: true, render: (r) => pct(r.probability), sort: (r) => r.probability },
    { key: 'ml', header: 'ML cost', num: true, render: (r) => money(r.cost.ml), sort: (r) => r.cost.ml },
    { key: 'pert', header: 'PERT', num: true, render: (r) => money(pert(r.cost)), sort: (r) => pert(r.cost) },
    { key: 'ev', header: 'Expected', num: true, render: (r) => <span className={r.kind === 'opportunity' ? 'text-good' : ''}>{money(expectedCost(r))}</span>, sort: (r) => expectedCost(r) },
    { key: 'days', header: 'Days', num: true, render: (r) => r.scheduleDays.ml, sort: (r) => r.scheduleDays.ml },
    { key: 'resp', header: 'Responses', render: (r) => { const done = r.responses.filter((x) => x.status === 'done').length; const late = r.responses.some((x) => x.status === 'open' && x.due < s.settings.asOf); return r.responses.length ? <span className="whitespace-nowrap text-[12px]">{done}/{r.responses.length} done{late && <Badge tone="bad" className="ml-1">Overdue</Badge>}</span> : riskScore(r) >= 15 && isActive(r) ? <Badge tone="bad">None — high</Badge> : <span className="text-faint">—</span> }, sort: (r) => r.responses.length },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, sort: (r) => r.status },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active risks" value={summary.active} sub={`${summary.high} high · ${risks.length - summary.active} closed`} />
        <Stat label="High without response" value={summary.highNoResponse} tone={summary.highNoResponse ? 'bad' : 'good'} sub={summary.highNoResponse ? 'Blocks gate readiness' : 'All high risks planned'} />
        <Stat label="Threat exposure" value={money(summary.threat)} sub="Σ probability × PERT" />
        <Stat label="Opportunities" value={money(summary.opportunity)} tone={summary.opportunity ? 'good' : undefined} sub="Expected savings" />
        <Stat label="Net exposure" value={money(summary.net)} sub={`~${summary.scheduleDays} expected days`} />
        <Stat label="Contingency left" value={basis ? money(basis.contingency) : '—'} sub={basis ? basis.source : 'No estimate yet'} tone={basis && summary.net > basis.contingency ? 'warn' : undefined} />
      </div>

      <Panel title="Risk register" subtitle={`${shown.length} of ${risks.length} shown${cell ? ` · cell L${cell.split('-')[0]} × C${cell.split('-')[1]}` : ''}`} pad={false}
        actions={<><Button size="sm" onClick={() => setLibOpen(true)}>Add from library</Button><Button size="sm" variant="primary" onClick={newRisk}>New risk</Button></>}>
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 border-b border-line p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-2"><span className="eyebrow">Heat map</span><SegButtons options={[{ id: 'inherent', label: 'Inherent' }, { id: 'residual', label: 'Residual' }]} value={matrixMode} onChange={(v) => { setMatrixMode(v); setCell(undefined) }} /></div>
            <RiskMatrix cells={cells} selected={cell} onPick={(l, c) => setCell((x) => (x === `${l}-${c}` ? undefined : `${l}-${c}`))} />
            <p className="text-[11px] text-faint">Active risks by likelihood (L) and consequence (C). Click a cell to filter the register; click again to clear.</p>
            {cell && <Button size="sm" variant="ghost" onClick={() => setCell(undefined)}>Clear cell filter</Button>}
            <ExposureByCategory risks={risks} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <SegButtons options={[{ id: 'active', label: 'Active' }, { id: 'closed', label: 'Closed / realized' }, { id: 'all', label: 'All' }]} value={view} onChange={setView} />
              <Input id="risk-search" className="max-w-[240px]" placeholder="Search risks" value={q} onChange={(e) => setQ(e.target.value)} />
              {summary.overdueResponses > 0 && <Badge tone="bad">{summary.overdueResponses} overdue response{summary.overdueResponses > 1 ? 's' : ''}</Badge>}
            </div>
            <Table rows={shown} columns={cols} rowKey={(r) => r.id} onRowClick={(r) => setEditing({ risk: r })} maxHeight={520}
              empty={<div className="p-4"><Empty title="No risks match">Change the filter, or add risks from the library for {p.workMethod.replace(/-/g, ' ')} work.</Empty></div>} />
          </div>
        </div>
      </Panel>

      <Quantitative projectId={projectId} />

      <Contingency projectId={projectId} onRequest={() => setDrawFor(null)} />

      <AiIdentify projectId={projectId} />

      <RiskEditor open={!!editing} risk={editing?.risk ?? null} isNew={editing?.isNew} onClose={() => setEditing(null)} onRequestDraw={pos.budgetKind === 'control' ? (r) => setDrawFor(r) : undefined} />
      <DrawModal open={drawFor !== undefined} projectId={projectId} risk={drawFor} onClose={() => setDrawFor(undefined)} />
      <LibraryModal open={libOpen} onClose={() => setLibOpen(false)} projectId={projectId} />
    </div>
  )
}

function ExposureByCategory({ risks }: { risks: RiskT[] }) {
  const g = groupBy(risks.filter((r) => isActive(r) && r.kind === 'threat'), (r) => r.category)
  const rows = Object.entries(g).map(([k, rs]) => ({ label: k, value: Math.round(sum(rs.map(expectedCost))) })).sort((a, b) => b.value - a.value).slice(0, 6)
  if (!rows.length) return null
  return <div className="flex flex-col gap-1.5"><span className="eyebrow">Threat exposure by category</span><HBarChart rows={rows} /></div>
}

// ───────────────────────────── Quantitative analysis (RK-06, RK-07)
function Quantitative({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const saved = latestMonteCarlo(s, projectId)
  const history = s.monteCarlo.filter((m) => m.projectId === projectId).slice().reverse()
  const [iterations, setIterations] = useState(5000)
  const [preview, setPreview] = useState<MonteCarloResult | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const basis = contingencyBasis(s, projectId)
  const live = useMemo(() => (saved ? null : runMonteCarlo(s, projectId, 3000)), [saved, s.risks, projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const mc = preview ?? history.find((h) => h.id === viewId) ?? saved ?? live
  const isSaved = !!mc && !preview && history.some((h) => h.id === mc.id)
  const ins = inServiceForecast(p)
  if (!basis) return <Panel title="Quantitative analysis"><Empty title="Nothing to simulate yet">Monte Carlo needs a base cost. It runs once the first estimate is drafted.</Empty></Panel>
  const run = () => {
    const r = runMonteCarlo(s, projectId, iterations, Math.floor(Math.random() * 1e6))
    if (r) { setPreview(r); setViewId(null); toast(`Simulated ${iterations.toLocaleString()} iterations`, 'info') }
  }
  const save = () => {
    const r = mc
    if (!r) return
    mutate((d) => { d.monteCarlo.push({ ...r, id: uid('mc'), date: d.settings.asOf }) }, { entity: 'monte-carlo', entityId: r.id, projectId, action: 'save', summary: `Saved Monte Carlo (${r.iterations.toLocaleString()} iterations): P50 ${money(r.costP.P50)}, P80 ${money(r.costP.P80)}` })
    setPreview(null); setViewId(null)
    toast('Monte Carlo results saved to the project record')
  }
  const a = mc ? adequacy(basis.contingency, mc) : null
  return (
    <Panel title="Quantitative analysis" subtitle={mc ? `${mc.iterations.toLocaleString()} iterations · base ${money(mc.baseCost)} (${basis.source}, excl. contingency) · ${isSaved ? `saved ${fmtDate(mc.date)}` : 'not saved'}` : undefined}
      actions={<>
        <Select id="mc-iter" className="w-[130px]" value={String(iterations)} onChange={(e) => setIterations(Number(e.target.value))} options={[1000, 5000, 10000, 20000].map((n) => ({ value: String(n), label: `${n.toLocaleString()} runs` }))} />
        <Button size="sm" onClick={run}>Run Monte Carlo</Button>
        <Button size="sm" variant={isSaved ? 'secondary' : 'primary'} disabled={isSaved || !mc} onClick={save}>{isSaved ? 'Saved' : 'Save results'}</Button>
      </>}>
      {mc && a && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {!isSaved && <div className="mb-2"><Badge tone="marker">{preview ? 'New run — save to keep it on the record' : 'Preview from the current register — not saved'}</Badge></div>}
            <Histogram bins={mc.histogram} markers={[{ x: mc.baseCost, label: 'Base', color: 'rgb(var(--muted))' }, { x: mc.costP.P50, label: 'P50' }, { x: mc.costP.P80, label: 'P80', color: 'rgb(var(--bad))' }]} />
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <table className="tbl">
                <thead><tr><th>Cost</th><th className="num">Total</th><th className="num">Over base</th></tr></thead>
                <tbody>{(['P10', 'P50', 'P80', 'P90'] as const).map((k) => <tr key={k}><td className="font-semibold">{k}</td><td className="num">{money(mc.costP[k])}</td><td className="num">{moneyDelta(mc.costP[k] - mc.baseCost)}</td></tr>)}</tbody>
              </table>
              <table className="tbl">
                <thead><tr><th>Schedule</th><th className="num">Risk delay</th><th className="num">In service</th></tr></thead>
                <tbody>{(['P10', 'P50', 'P80', 'P90'] as const).map((k) => <tr key={k}><td className="font-semibold">{k}</td><td className="num">{mc.scheduleP[k]} days</td><td className="num">{ins ? fmtDate(delayedDate(ins, mc.scheduleP[k])) : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className={cx('rounded-md border-2 p-4', a.tone === 'good' ? 'border-good/50 bg-good/5' : a.tone === 'warn' ? 'border-warn/60 bg-warn/5' : 'border-bad/60 bg-bad/5')}>
              <div className="eyebrow">Contingency adequacy</div>
              <div className={cx('mt-1 font-display text-[22px] font-bold', a.tone === 'good' ? 'text-good' : a.tone === 'warn' ? 'text-warn' : 'text-bad')}>{a.label}</div>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px] tabular-nums">
                <dt className="text-muted">Contingency remaining</dt><dd className="text-right font-semibold">{money(a.remaining)}</dd>
                <dt className="text-muted">Needed at P50 (P50 − base)</dt><dd className="text-right">{money(a.need50)}</dd>
                <dt className="text-muted">Needed at P80 (P80 − base)</dt><dd className="text-right">{money(a.need80)}</dd>
                <dt className="border-t border-line pt-1 font-semibold">{a.gap80 >= 0 ? 'Surplus at P80' : 'Shortfall at P80'}</dt><dd className={cx('border-t border-line pt-1 text-right font-bold', a.gap80 >= 0 ? 'text-good' : 'text-bad')}>{money(Math.abs(a.gap80))}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted">
                {a.verdict === 'adequate' ? `Remaining contingency covers the P80 outcome with ${money(a.gap80)} to spare (${Math.round(a.coverage * 100)}% of need).`
                  : a.verdict === 'p50-only' ? `Covers the median outcome but not P80. Mitigate top risks or plan a change request for ${money(-a.gap80)}.`
                    : a.verdict === 'short' ? `Below even the P50 requirement. Expect a funding change request; escalate to the sponsor.`
                      : 'No active quantified threats. Review the register before releasing contingency.'}
              </p>
            </div>
            {history.length > 0 && (
              <div>
                <div className="eyebrow mb-1">Saved runs</div>
                <table className="tbl"><thead><tr><th>Date</th><th className="num">Runs</th><th className="num">P50</th><th className="num">P80</th></tr></thead>
                  <tbody>{history.slice(0, 5).map((h) => <tr key={h.id} className={cx('clickable', mc.id === h.id && 'bg-marker/10')} onClick={() => { setPreview(null); setViewId(h.id) }}><td>{fmtDate(h.date)}</td><td className="num">{h.iterations.toLocaleString()}</td><td className="num">{money(h.costP.P50)}</td><td className="num">{money(h.costP.P80)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ───────────────────────────── Contingency drawdown & usage over time (RK-08)
function Contingency({ projectId, onRequest }: { projectId: string; onRequest: () => void }) {
  const s = useStore()
  const pos = position(s, projectId)
  const draws = s.contingencyDraws.filter((d) => d.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date))
  const fromChanges = s.changes.filter((c) => c.projectId === projectId && c.fundedFrom === 'contingency' && c.status === 'approved')
  const bd = burndown(s, projectId)
  const [openId, setOpenId] = useState<string | null>(draws.find((d) => d.status === 'in-review')?.id ?? null)
  const hasBudget = pos.budgetKind === 'control'
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Contingency drawdowns" subtitle={hasBudget ? `${money(pos.contingencyOriginal)} original · ${money(pos.contingencyUsed)} used · ${money(pos.contingencyRemaining)} remaining` : 'Contingency is held in the estimate until a control budget is authorized'}
        actions={<Button size="sm" variant="primary" onClick={onRequest} disabled={!hasBudget}>Request drawdown</Button>}>
        {hasBudget && <div className="mb-3"><div className="mb-1 flex justify-between text-xs text-muted"><span>Used {pct(pos.contingencyOriginal ? pos.contingencyUsed / pos.contingencyOriginal : 0)}</span><span>{money(pos.contingencyRemaining)} left</span></div><div className="h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full bg-link" style={{ width: `${Math.min(100, (pos.contingencyUsed / Math.max(1, pos.contingencyOriginal)) * 100)}%` }} /></div></div>}
        {draws.length === 0 && fromChanges.length === 0 && <Empty title="No drawdowns">Requests made against a realized risk appear here with their approval routing.</Empty>}
        <div className="flex flex-col divide-y divide-line">
          {draws.map((d) => {
            const r = s.risks.find((x) => x.id === d.riskId)
            return (
              <div key={d.id} className="py-2.5">
                <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
                  <b className="tabular-nums">{money(d.amount, 'full')}</b>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r ? <><Mono>{r.code}</Mono> {r.title}</> : d.reason}</span>
                  <StatusBadge status={d.status} />
                  <span className="text-xs text-faint">{fmtDate(d.date)}</span>
                </button>
                <p className="mt-0.5 text-xs text-muted">{d.reason}</p>
                {openId === d.id && d.workflowInstanceId && <div className="mt-2"><WorkflowStatus instanceId={d.workflowInstanceId} /></div>}
              </div>
            )
          })}
          {fromChanges.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[13px]">
              <b className="tabular-nums">{money(c.costImpact, 'full')}</b><span className="min-w-0 flex-1 truncate"><Mono>{c.code}</Mono> {c.title}</span><Badge>Change funded from contingency</Badge><span className="text-xs text-faint">{fmtDate(c.decidedAt)}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Contingency usage over time" subtitle="Contingency remaining each month vs. usage proportional to earned % complete">
        {bd && bd.length > 1 ? (
          <>
            <LineChart labels={bd.map((x) => fmtMonth(x.month).replace(' 20', " '"))} series={[{ name: 'Contingency remaining', values: bd.map((x) => x.remaining), area: true }, { name: 'Proportional to % complete', values: bd.map((x) => x.ideal), dashed: true, color: 'rgb(var(--muted))' }]} />
            {(() => {
              const last = bd[bd.length - 1]
              const ahead = last.remaining >= last.ideal
              return <Callout tone={ahead ? 'good' : 'warn'}>{pct(last.pctComplete)} complete (earned value). Remaining contingency is {money(Math.abs(last.remaining - last.ideal))} {ahead ? 'above' : 'below'} usage proportional to progress{ahead ? ' — spending slower than progress.' : ' — contingency is being consumed faster than work is earned.'}</Callout>
            })()}
          </>
        ) : <Empty title="No contingency usage yet">Contingency usage is tracked once a control budget is authorized and cost periods post.</Empty>}
      </Panel>
    </div>
  )
}

// ───────────────────────────── Library (RK-03)
function LibraryModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const lib = s.riskLibrary.filter((x) => x.appliesTo.includes(p.workMethod))
  const onReg = new Set(s.risks.filter((r) => r.projectId === projectId && isActive(r)).map((r) => r.libraryId))
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const base = budgetBase(s, projectId)
  const add = () => {
    const items = lib.filter((x) => pick[x.id])
    if (!items.length) return
    mutate((d) => { items.forEach((it, i) => d.risks.push(riskFromLibrary(d, p, it, base, i))) }, { entity: 'risk', entityId: projectId, projectId, action: 'create', summary: `Added ${items.length} risk(s) from library: ${items.map((x) => x.title).join(', ')}` })
    toast(`${items.length} risk${items.length > 1 ? 's' : ''} added from the library`)
    setPick({}); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} wide title="Add risks from the library"
      footer={<><span className="mr-auto self-center text-xs text-muted">Typical cost is the library % of {money(base)} budget; adjust on the risk after adding.</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!Object.values(pick).some(Boolean)} onClick={add}>Add selected</Button></>}>
      <p className="mb-3 text-[13px] text-muted">Library risks for <b className="text-ink">{p.workMethod.replace(/-/g, ' ')}</b> work, drawn from closed projects.</p>
      <div className="flex flex-col divide-y divide-line">
        {lib.map((it) => {
          const ml = Math.max(5000, Math.round((Math.abs(it.typicalCostPct) / 100) * base / 1000) * 1000)
          const has = onReg.has(it.id)
          return (
            <div key={it.id} className="flex items-start gap-3 py-2.5">
              <Checkbox checked={!!pick[it.id]} disabled={has} onChange={(v) => setPick({ ...pick, [it.id]: v })} label={<span className="sr-only">{it.title}</span>} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">{it.title}</b><Badge>{it.category}</Badge>{it.typicalCostPct < 0 && <Badge tone="good">Opportunity</Badge>}{has && <Badge tone="info">On register</Badge>}</div>
                <p className="text-xs text-muted">{it.cause} → {it.event} → {it.effect}</p>
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums"><div className="font-semibold">{money(ml)}</div><div className="text-faint">{it.typicalCostPct}% · {it.typicalDays} d</div></div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ───────────────────────────── AI risk identification (RK-11)
interface AiRisk { title: string; category: string; cause: string; event: string; effect: string; kind: 'threat' | 'opportunity'; likelihood: number; consequence: number; costMostLikely: number; scheduleDays: number; response: string; rationale: string }
function AiIdentify({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const ok = useAiAvailable()
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<(AiRisk & { key: string })[]>([])
  const [err, setErr] = useState('')
  const base = budgetBase(s, projectId)
  const go = async () => {
    setBusy(true); setErr('')
    const existing = s.risks.filter((r) => r.projectId === projectId).map((r) => `- ${r.title} (${r.category}, ${r.status})`).join('\n') || '- none'
    const prompt = `You are a utility capital-project risk analyst. Identify NEW risks for this gas utility project (fictional demo data). Do not repeat existing risks.

Project: ${p.code} ${p.name}
Scope: ${p.scope.summary}
In scope: ${p.scope.inScope.join('; ')}
Quantities: ${p.scope.quantities.map((x) => `${x.qty} ${x.unit} ${x.label}`).join('; ')}
Assumptions: ${p.scope.assumptions.join('; ')}
Work method: ${p.workMethod}; asset ${p.asset.type}, ${p.asset.diameterIn}" ${p.asset.material}, vintage ${p.asset.vintage}, MAOP ${p.asset.maopPsig} psig, records ${p.asset.recordsStatus}
Location: ${p.location.city}, ${p.location.county} County, ${p.location.terrain}, class location ${p.location.classLocation}, HCA ${p.location.hca ? 'yes' : 'no'}, disadvantaged community ${p.location.dac ? 'yes' : 'no'}
Contractor: ${p.contractor ?? 'not yet awarded'}
Budget basis: ${money(base, 'full')}
Existing risks:
${existing}

Return JSON exactly: {"risks":[{"title":string (max 8 words),"category":one of "Third-party / substructures","Permitting","Environmental","Material","Operations","Land / right-of-way","Technical","Productivity","Regulatory change","Weather","Records","Market","Safety","Design","Stakeholder","cause":string,"event":string,"effect":string,"kind":"threat"|"opportunity","likelihood":1-5,"consequence":1-5,"costMostLikely":whole US dollars,"scheduleDays":integer,"response":string (one concrete mitigation),"rationale":string (one sentence on why this project specifically)}]}. Give 4 to 6 risks specific to this scope and location.`
    try {
      const r = await askJSON<{ risks: AiRisk[] }>(prompt)
      setItems((r.risks ?? []).map((x) => ({ ...x, key: uid('ai') })))
      if (!r.risks?.length) setErr('No new risks suggested.')
    } catch (e) { setErr(aiMessage(e)) } finally { setBusy(false) }
  }
  const accept = (x: AiRisk & { key: string }) => {
    const L = Math.min(5, Math.max(1, Math.round(x.likelihood))) as RiskT['likelihood']
    const C = Math.min(5, Math.max(1, Math.round(x.consequence))) as RiskT['consequence']
    const ml = Math.max(1000, Math.round(Number(x.costMostLikely) || 0))
    const days = Math.max(0, Math.round(Number(x.scheduleDays) || 0))
    mutate((d) => {
      d.risks.push({
        id: uid('rsk'), projectId, code: nextRiskCode(d, p), title: x.title, cause: x.cause, event: x.event, effect: x.effect, category: x.category, kind: x.kind === 'opportunity' ? 'opportunity' : 'threat',
        ownerId: p.team.pm ?? d.currentUserId, status: 'open', likelihood: L, consequence: C, consequenceDim: x.category === 'Environmental' ? 'Environmental' : x.category === 'Safety' ? 'Safety' : days > 40 ? 'Schedule' : 'Financial',
        probability: PROB_BY_L[L - 1], cost: { min: Math.round(ml * 0.4), ml, max: Math.round(ml * 2.2) }, scheduleDays: { min: Math.round(days * 0.4), ml: days, max: days * 2 },
        responses: x.response ? [{ id: uid('rr'), action: x.response, ownerId: p.team.pm ?? d.currentUserId, due: addDays(d.settings.asOf, 30), status: 'open', cost: 0 }] : [],
        residual: { likelihood: Math.max(1, L - 1) as RiskT['likelihood'], consequence: C }, createdAt: d.settings.asOf,
      })
    }, { entity: 'risk', entityId: projectId, projectId, action: 'create', summary: `Accepted AI-suggested risk: ${x.title}` })
    setItems(items.filter((i) => i.key !== x.key))
    toast('Risk added to register')
  }
  if (!ok) return null
  return (
    <Panel title={<span className="flex items-center gap-2">Identify missing risks <AiTag>AI assist</AiTag></span>} subtitle="AI assist reads scope, location, work method and the current register, then suggests what is missing. Nothing is added until you accept it."
      actions={<Button size="sm" onClick={go} disabled={busy}>{busy ? 'Thinking…' : items.length ? 'Suggest again' : 'Suggest risks'}</Button>}>
      {err && <Callout tone="warn">{err}</Callout>}
      {busy && <p className="text-[13px] text-muted">Thinking… reviewing {s.risks.filter((r) => r.projectId === projectId).length} existing risks against the scope.</p>}
      {!busy && items.length === 0 && !err && <p className="text-[13px] text-muted">No suggestions yet.</p>}
      <div className="flex flex-col divide-y divide-line">
        {items.map((x) => (
          <div key={x.key} className="flex flex-col gap-1.5 py-3 md:flex-row md:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><AiTag /><b className="text-[13px]">{x.title}</b><Badge>{x.category}</Badge>{x.kind === 'opportunity' && <Badge tone="good">Opportunity</Badge>}<ScoreChip l={x.likelihood} c={x.consequence} /><span className="text-xs tabular-nums text-muted">ML {money(x.costMostLikely)} · {x.scheduleDays} d</span></div>
              <p className="mt-1 text-[13px]">{x.cause} → <b>{x.event}</b> → {x.effect}</p>
              <p className="text-xs text-muted">Response: {x.response}</p>
              <p className="text-xs italic text-faint">{x.rationale}</p>
            </div>
            <div className="flex shrink-0 gap-1.5"><Button size="sm" variant="primary" onClick={() => accept(x)}>Accept</Button><Button size="sm" variant="ghost" onClick={() => setItems(items.filter((i) => i.key !== x.key))}>Dismiss</Button></div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
