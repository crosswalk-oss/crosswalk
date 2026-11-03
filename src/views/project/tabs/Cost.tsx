import { projectHref, go } from '@/core/router'
// Cost & forecast: EVM from monthly cost periods, monthly forecast cycle with PM sign-off (CC-02),
// variance explanations with AI-drafted narrative (BL-05/06/11), ERP reconciliation (CC-01).
import { useMemo, useState } from 'react'
import { mutate, useStore, personName } from '@/core/store'
import type { AppState, Forecast, RootCause, Variance } from '@/core/types'
import { ROOT_CAUSES } from '@/core/types'
import { evmSeries, evmMetrics } from '@/core/engine/evm'
import { latestOf, position, thresholdBreaches } from '@/core/engine/position'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { ask, aiMessage, useAiAvailable } from '@/core/ai'
import { daysBetween, fmtDate, fmtMonth, money, moneyDelta, pct, sum, uid, cx } from '@/core/util'
import { AiTag, Badge, Button, Callout, Checkbox, Drawer, Empty, Field, Input, KV, Modal, MoneyInput, Panel, Select, Stat, StatusBadge, Table, TextArea, Mono, Section } from '@/ui/kit'
import { LineChart } from '@/ui/charts'
import { WorkflowStatus } from '../../shared/WorkflowStatus'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { erpRecon } from './controls/trace'

const short = (k: string) => fmtMonth(k).replace(/ (\d\d)(\d\d)$/, " '$2")

export default function Cost({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const pos = useMemo(() => position(s, projectId), [s, projectId])
  const periods = useMemo(() => s.costPeriods.filter((c) => c.projectId === projectId).sort((a, b) => a.period.localeCompare(b.period)), [s.costPeriods, projectId])
  const series = useMemo(() => evmSeries(periods), [periods])
  const m = useMemo(() => evmMetrics(periods, pos.baseBudget), [periods, pos.baseBudget])
  const [fcOpen, setFcOpen] = useState(false)
  const [varOpen, setVarOpen] = useState<VarTarget | null>(null)

  if (!periods.length && !pos.currentBudget) {
    return <Empty title="No cost history yet">{p.code} has no approved budget or ERP actuals. Cost periods start posting once the planning budget is authorized at Gate 1.</Empty>
  }
  const approvedChanges = s.changes.filter((c) => c.projectId === projectId && c.status === 'approved' && c.decidedAt)
  const markers = Array.from(new Map(approvedChanges.map((c) => [series.findIndex((x) => x.period === c.decidedAt!.slice(0, 7)), c] as const)).entries()).filter(([i]) => i >= 0).map(([i, c]) => ({ index: i, label: c.code.replace(/^CR-\d+-/, 'CR-') }))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="CPI" value={m.cpi.toFixed(2)} tone={m.cpi < 0.95 ? 'bad' : m.cpi < 1 ? 'warn' : 'good'} sub={`CV ${moneyDelta(m.cv)}`} />
        <Stat label="SPI" value={m.spi.toFixed(2)} tone={m.spi < 0.95 ? 'bad' : m.spi < 1 ? 'warn' : 'good'} sub={`SV ${moneyDelta(m.sv)}`} />
        <Stat label="% complete" value={pct(m.pctComplete)} sub={`EV ${money(m.ev)} of BAC`} />
        <Stat label="BAC" value={money(m.bac)} sub="Budget excl. contingency left" />
        <Stat label="EAC (CPI method)" value={money(m.eac)} tone={m.eac > m.bac ? 'bad' : undefined} sub={`ETC ${money(m.etc)}`} />
        <Stat label="VAC" value={moneyDelta(m.vac)} tone={m.vac < 0 ? 'bad' : 'good'} />
        <Stat label="TCPI" value={m.tcpi.toFixed(2)} tone={m.tcpi > 1.1 ? 'bad' : m.tcpi > 1 ? 'warn' : undefined} sub="Efficiency to finish on BAC" />
        <Stat label="Signed EAC" value={money(pos.eac)} sub={`vs budget ${moneyDelta(pos.currentBudget - pos.eac)}`} tone={pos.eac > pos.currentBudget ? 'bad' : undefined} />
      </div>

      <Panel title="Earned value S-curve" subtitle={`Cumulative planned, earned and actual cost from ${periods.length} ERP periods · dashed lines: BAC and signed forecast EAC · markers: approved changes`}>
        {series.length > 1 ? (
          <LineChart labels={series.map((x) => short(x.period))} markers={markers} height={260} series={[
            { name: 'Planned (PV)', values: series.map((x) => x.cumPv), color: 'rgb(var(--muted))' },
            { name: 'Earned (EV)', values: series.map((x) => x.cumEv), color: 'rgb(var(--good))' },
            { name: 'Actual (AC)', values: series.map((x) => x.cumAc), color: 'rgb(var(--link))', area: true },
            { name: 'BAC', values: series.map(() => m.bac), color: 'rgb(var(--ink))', dashed: true },
            { name: 'EAC (signed)', values: series.map(() => pos.eac), color: 'rgb(var(--bad))', dashed: true },
          ]} />
        ) : <p className="text-[13px] text-muted">One period posted so far.</p>}
      </Panel>

      <VariancePanel s={s} projectId={projectId} onWrite={setVarOpen} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ForecastPanel s={s} projectId={projectId} onNew={() => go(projectHref(projectId, 'forecast'))} />
        <ReconPanel s={s} projectId={projectId} />
      </div>

      <Panel title="Monthly cost periods" subtitle={`ERP WBS ${p.erpWbs} · values for each month (not cumulative)`} pad={false}>
        <Table rows={[...series].reverse()} rowKey={(x) => x.period} maxHeight={420} dense columns={[
          { key: 'p', header: 'Period', render: (x) => fmtMonth(x.period), sort: (x) => x.period },
          { key: 'pv', header: 'Planned', num: true, render: (x) => money(x.pv, 'full') },
          { key: 'ev', header: 'Earned', num: true, render: (x) => money(x.ev, 'full') },
          { key: 'ac', header: 'Actual', num: true, render: (x) => <span className={x.ac > x.ev * 1.08 ? 'text-bad' : ''}>{money(x.ac, 'full')}</span> },
          { key: 'cm', header: 'Commitments', num: true, render: (x) => money(periods.find((c) => c.period === x.period)?.commitments, 'full') },
          { key: 'cac', header: 'Cum. actual', num: true, render: (x) => money(x.cumAc) },
          { key: 'cpi', header: 'Cum. CPI', num: true, render: (x) => (x.cumAc ? (x.cumEv / x.cumAc).toFixed(2) : '—') },
        ]} />
      </Panel>

      <ForecastModal open={fcOpen} onClose={() => setFcOpen(false)} projectId={projectId} />
      {varOpen && <VarianceDrawer key={varOpen.id ?? varOpen.breach?.description} projectId={projectId} varianceId={varOpen.id} breach={varOpen.breach} preChanges={varOpen.changeIds} onClose={() => setVarOpen(null)} />}
    </div>
  )
}

// ───────────────────────────── Variances
type VarTarget = { id?: string; breach?: { metric: 'eac' | 'milestone'; description: string; amount: number }; changeIds?: string[] }
function VariancePanel({ s, projectId, onWrite }: { s: AppState; projectId: string; onWrite: (x: VarTarget) => void }) {
  const p = s.projects.find((x) => x.id === projectId)!
  const variances = s.variances.filter((v) => v.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date))
  const breaches = p.status === 'active' ? thresholdBreaches(s, p) : []
  const unexplained = breaches.filter((b) => !variances.some((v) => v.description === b.description))
  const t = s.settings.varianceThresholds
  const cur = latestOf(s, projectId, 'current') ?? latestOf(s, projectId, 'original')
  const pos = position(s, projectId)
  const unexplainedChanges = s.changes.filter((c) => c.projectId === projectId && c.status === 'approved' && (Math.abs(c.costImpact) >= t.eacAbs || c.rootCause === 'Estimate error') && !variances.some((v) => v.changeIds.includes(c.id) && v.status !== 'required'))
  const [pick, setPick] = useState('')
  const explain = () => { const c = unexplainedChanges.find((x) => x.id === (pick || unexplainedChanges[0]?.id)); if (c) onWrite({ breach: { metric: 'eac', description: `${c.code} cost growth — ${c.title}`, amount: c.costImpact }, changeIds: [c.id] }) }
  return (
    <Panel title="Variance explanations" subtitle={`Thresholds: EAC above Current baseline by more than ${t.eacPct}% or ${money(t.eacAbs)}; milestone slip over ${t.milestoneDays} days`}
      actions={unexplainedChanges.length ? <><Select className="w-auto max-w-[260px]" value={pick || unexplainedChanges[0].id} onChange={(e) => setPick(e.target.value)} options={unexplainedChanges.map((c) => ({ value: c.id, label: `${c.code} · ${moneyDelta(c.costImpact)}` }))} /><Button size="sm" onClick={explain}>Explain change</Button></> : undefined}>
      {unexplainedChanges.length > 0 && <p className="mb-3 text-xs text-muted">{unexplainedChanges.length} approved change{unexplainedChanges.length > 1 ? 's' : ''} of {money(t.eacAbs)} or more {unexplainedChanges.length > 1 ? 'have' : 'has'} no variance narrative; reviewers expect one for material cost growth.</p>}
      {unexplained.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {unexplained.map((b) => (
            <div key={b.description} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-marker bg-marker/10 px-3 py-2">
              <div className="min-w-0 text-[13px]"><Badge tone="bad">Breach</Badge> <b>{b.description}</b> <span className="text-muted">· {b.metric === 'eac' ? moneyDelta(b.amount) : `${b.amount} days`} · explanation required before period close</span></div>
              <Button size="sm" variant="marker" onClick={() => onWrite({ breach: b })}>Write explanation</Button>
            </div>
          ))}
        </div>
      )}
      {variances.length ? (
        <Table rows={variances} rowKey={(v) => v.id} onRowClick={(v) => onWrite({ id: v.id })} dense columns={[
          { key: 'd', header: 'Date', render: (v) => fmtDate(v.date), width: 110 },
          { key: 'm', header: 'Metric', render: (v) => <Badge>{v.metric === 'eac' ? 'EAC' : 'Milestone'}</Badge> },
          { key: 'x', header: 'What crossed the threshold', render: (v) => <span className="block min-w-[220px]">{v.description}{v.narrative && <span className="mt-0.5 block line-clamp-2 text-xs text-muted">{v.narrative}</span>}</span> },
          { key: 'a', header: 'Amount', num: true, render: (v) => (v.metric === 'eac' ? moneyDelta(v.amount) : `${v.amount} d`) },
          { key: 'r', header: 'Root cause', render: (v) => v.rootCause ?? <span className="text-faint">—</span> },
          { key: 'l', header: 'Linked', render: (v) => <span className="text-xs text-muted">{v.changeIds.length} chg · {v.riskIds.length} risk</span> },
          { key: 's', header: 'Status', render: (v) => <StatusBadge status={v.status} /> },
        ]} />
      ) : !unexplained.length ? (
        <Callout tone="good" title="Within thresholds">
          {cur ? <>Signed EAC {money(pos.eac)} is {moneyDelta(pos.eac - cur.budget.total)} against the Current baseline of {money(cur.budget.total)} ({fmtDate(cur.date)}); no milestone has slipped more than {t.milestoneDays} days. No explanation is due.</> : 'No Current baseline yet — thresholds apply once the control budget is authorized.'}
        </Callout>
      ) : null}
    </Panel>
  )
}

function VarianceDrawer({ projectId, varianceId, breach, preChanges, onClose }: { projectId: string; varianceId?: string; breach?: { metric: 'eac' | 'milestone'; description: string; amount: number }; preChanges?: string[]; onClose: () => void }) {
  const s = useStore()
  const ai = useAiAvailable()
  const p = s.projects.find((x) => x.id === projectId)!
  const v = s.variances.find((x) => x.id === varianceId)
  const subject = v ?? (breach ? { metric: breach.metric, description: breach.description, amount: breach.amount } : undefined)
  const editable = !v || v.status === 'required' || v.status === 'returned'
  const [rootCause, setRootCause] = useState<RootCause>(v?.rootCause ?? 'Productivity')
  const [narrative, setNarrative] = useState(v?.narrative ?? '')
  const [changeIds, setChangeIds] = useState<string[]>(v?.changeIds ?? preChanges ?? [])
  const [riskIds, setRiskIds] = useState<string[]>(v?.riskIds ?? [])
  const [busy, setBusy] = useState(false)
  const [aiDraft, setAiDraft] = useState(false)
  if (!subject) return null
  const changes = s.changes.filter((c) => c.projectId === projectId && (c.status === 'approved' || c.status === 'in-review'))
  const risks = s.risks.filter((r) => r.projectId === projectId && (r.status === 'realized' || r.status === 'open' || r.status === 'mitigating'))
  const pos = position(s, projectId)
  const cur = latestOf(s, projectId, 'current') ?? latestOf(s, projectId, 'original')
  const periods = s.costPeriods.filter((c) => c.projectId === projectId)
  const m = evmMetrics(periods, pos.baseBudget)
  const toggle = (xs: string[], id: string) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])

  const draft = async () => {
    setBusy(true); setAiDraft(false); setNarrative('Thinking…')
    const linked = changes.filter((c) => c.status === 'approved')
    const realized = s.risks.filter((r) => r.projectId === projectId && r.status === 'realized')
    const recent = periods.slice().sort((a, b) => a.period.localeCompare(b.period)).slice(-4)
    const slips = p.milestones.filter((x) => !x.actual).map((x) => { const b = cur?.milestones.find((y) => y.name === x.name); return b ? `${x.name}: baseline-current ${b.forecast}, forecast ${x.forecast} (${daysBetween(b.forecast, x.forecast)} days)` : '' }).filter(Boolean)
    const prompt = `You are drafting a variance explanation for a gas utility capital project. It will be reviewed by project controls and a program manager and may be produced in a CPUC reasonableness review, so state facts plainly and do not speculate beyond the data.

Project: ${p.code} ${p.name} (${p.workMethod.replace(/-/g, ' ')}, ${p.location.city}, ${p.location.terrain}). Contractor: ${p.contractor ?? 'not recorded'}.
Breach: ${subject.description}. Amount: ${subject.metric === 'eac' ? money(subject.amount, 'full') : subject.amount + ' days'}.
Current baseline ${cur ? `${money(cur.budget.total, 'full')} (${cur.label}, ${cur.date})` : 'none'}; signed EAC ${money(pos.eac, 'full')}; actual to date ${money(pos.actualToDate, 'full')}; contingency remaining ${money(pos.contingencyRemaining, 'full')} of ${money(pos.contingencyOriginal, 'full')}.
EVM: CPI ${m.cpi.toFixed(2)}, SPI ${m.spi.toFixed(2)}, ${pct(m.pctComplete)} complete, CPI-based EAC ${money(m.eac, 'full')}.
Last periods (planned/earned/actual): ${recent.map((r) => `${r.period} ${money(r.planned)}/${money(r.earned)}/${money(r.actual)}`).join('; ')}.
Approved changes: ${linked.map((c) => `${c.code} "${c.title}" ${money(c.costImpact)} ${c.rootCause}, ${c.scheduleImpactDays} days, decided ${c.decidedAt}`).join('; ') || 'none'}.
Realized risks: ${realized.map((r) => `${r.code} "${r.title}" most-likely ${money(r.cost.ml)}`).join('; ') || 'none'}.
Milestones: ${slips.join('; ') || 'none'}.
Root cause selected by the analyst: ${rootCause}.

Write the narrative only: 3 to 5 sentences, plain prose, no headings or bullets. Cover what happened, the cost or schedule effect with figures, the corrective action, and the expected trend. Cite change codes where relevant.`
    try {
      const text = await ask(prompt, { onText: setNarrative })
      setNarrative(text.trim()); setAiDraft(true)
    } catch (e) { setNarrative(v?.narrative ?? ''); toast(aiMessage(e), 'bad') } finally { setBusy(false) }
  }

  const submit = () => {
    if (narrative.trim().length < 40) { toast('Write a narrative of at least a couple of sentences.', 'bad'); return }
    const me = s.currentUserId
    let autoSubmitted = false
    mutate((d) => {
      let rec = d.variances.find((x) => x.id === varianceId)
      if (!rec) {
        rec = { id: uid('var'), projectId, date: d.settings.asOf, metric: subject.metric, description: subject.description, amount: subject.amount, narrative: '', status: 'required', changeIds: [], riskIds: [] } as Variance
        d.variances.push(rec)
      }
      Object.assign(rec, { rootCause, narrative: narrative.trim(), changeIds, riskIds, authorId: me })
      const inst = startWorkflow(d, 'variance-explanation', { title: `${p.code} variance: ${rec.description}`, recordType: 'variance', recordId: rec.id, projectId, data: { rootCause, narrative: narrative.trim(), amount: rec.metric === 'eac' ? rec.amount : 0 } })
      const isAdmin = d.people.find((x) => x.id === me)?.roles.includes('admin')
      const slot = inst?.active.find((a) => a.assigneeIds.includes(me)) ?? (isAdmin ? inst?.active[0] : undefined)
      if (inst && slot) { actOnWorkflow(d, inst.id, slot.nodeId, me, 'submit', 'Explanation written'); autoSubmitted = true }
    }, { entity: 'variance', entityId: varianceId ?? subject.description, projectId, action: 'submit', summary: `Submitted variance explanation: ${subject.description} (${rootCause})` })
    toast(autoSubmitted ? 'Submitted for controls validation' : `Saved — waiting on ${personName(s, p.team.pm)} to submit`)
    onClose()
  }

  return (
    <Drawer open onClose={onClose} width={620} title="Variance explanation"
      footer={editable ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={busy}>Submit explanation</Button></> : <Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <Callout tone={v?.status === 'accepted' ? 'good' : 'marker'} title={subject.description}>
          {subject.metric === 'eac' ? `${moneyDelta(subject.amount)} ${preChanges?.length ? "of approved cost growth" : "over the Current baseline"}` : `${subject.amount} days of slip`}. Current baseline {cur ? `${money(cur.budget.total)} (${fmtDate(cur.date)})` : '—'} · signed EAC {money(pos.eac)} · CPI {m.cpi.toFixed(2)} · SPI {m.spi.toFixed(2)}.
        </Callout>
        {v?.workflowInstanceId && <WorkflowStatus instanceId={v.workflowInstanceId} />}
        {v?.status === 'returned' && <Callout tone="bad" title="Returned for revision">Revise the narrative and resubmit; the reviewer's comment is in the workflow history above.</Callout>}
        <Field label="Root cause"><Select disabled={!editable} value={rootCause} onChange={(e) => setRootCause(e.target.value as RootCause)} options={[...ROOT_CAUSES]} /></Field>
        <Field label={<span className="flex items-center gap-2">Narrative {aiDraft && <AiTag />}</span>} hint={aiDraft ? 'AI drafted from the figures above. Edit it until it is yours; it is submitted under your name.' : 'What happened, the effect in dollars or days, the corrective action, and the expected trend.'}>
          <TextArea disabled={!editable || busy} className="min-h-[140px]" value={narrative} onChange={(e) => { setNarrative(e.target.value); setAiDraft(false) }} />
        </Field>
        {editable && ai !== false && <div><Button size="sm" onClick={draft} disabled={busy || ai === null}>{busy ? 'Thinking…' : 'AI draft narrative'}</Button> <span className="text-xs text-faint">Uses the breach, approved changes, realized risks and cost periods.</span></div>}
        <Section title="Linked changes">
          {changes.length ? changes.map((c) => <Checkbox key={c.id} disabled={!editable} checked={changeIds.includes(c.id)} onChange={() => setChangeIds(toggle(changeIds, c.id))} label={<span><Mono>{c.code}</Mono> {c.title} <span className="text-muted">· {moneyDelta(c.costImpact)} · {c.status}</span></span>} />) : <p className="text-[13px] text-muted">No changes on this project.</p>}
        </Section>
        <Section title="Linked risks">
          {risks.length ? risks.map((r) => <Checkbox key={r.id} disabled={!editable} checked={riskIds.includes(r.id)} onChange={() => setRiskIds(toggle(riskIds, r.id))} label={<span><Mono>{r.code}</Mono> {r.title} <span className="text-muted">· {r.status} · ML {money(r.cost.ml)}</span></span>} />) : <p className="text-[13px] text-muted">No open or realized risks.</p>}
        </Section>
      </div>
    </Drawer>
  )
}

// ───────────────────────────── Forecast cycle (CC-02)
function ForecastPanel({ s, projectId, onNew }: { s: AppState; projectId: string; onNew: () => void }) {
  const p = s.projects.find((x) => x.id === projectId)!
  const me = s.people.find((x) => x.id === s.currentUserId)!
  const fcs = s.forecasts.filter((f) => f.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date))
  const cycle = s.settings.asOf.slice(0, 7)
  const thisCycle = fcs.find((f) => f.date.slice(0, 7) === cycle)
  const canSign = me.id === p.team.pm || me.roles.includes('admin')
  const sign = (f: Forecast) => {
    mutate((d) => { const x = d.forecasts.find((y) => y.id === f.id); if (x) x.locked = true }, { entity: 'forecast', entityId: f.id, projectId, action: 'sign-off', summary: `PM sign-off locked ${fmtMonth(f.date.slice(0, 7))} forecast EAC ${money(f.eac, 'full')}${me.id !== p.team.pm ? ' (as administrator)' : ''}` })
    toast('Forecast signed and locked')
  }
  const signer = (f: Forecast) => [...s.audit].reverse().find((a) => a.entity === 'forecast' && a.entityId === f.id && a.action === 'sign-off')
  return (
    <Panel title="Forecast history" subtitle={`Monthly cycle · ${fmtMonth(cycle)} ${thisCycle ? (thisCycle.locked ? 'signed' : 'awaiting PM sign-off') : 'not started'}`}
      actions={<Button size="sm" variant={thisCycle ? 'secondary' : 'marker'} onClick={onNew} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Spread forecast by WBS</Button>} pad={false}>
      {fcs.length ? (
        <Table rows={fcs} rowKey={(f) => f.id} dense columns={[
          { key: 'd', header: 'Date', render: (f) => fmtDate(f.date) },
          { key: 'e', header: 'EAC', num: true, render: (f) => money(f.eac, 'full') },
          { key: 'c', header: 'Change', num: true, render: (f) => { const prev = fcs[fcs.indexOf(f) + 1]; return prev ? <span className={f.eac > prev.eac ? 'text-bad' : 'text-good'}>{moneyDelta(f.eac - prev.eac)}</span> : '—' } },
          { key: 'y', header: 'By year', render: (f) => <span className="text-xs text-muted">{Object.entries(f.byYear).map(([y, v]) => `${y} ${money(v)}`).join(' · ')}</span> },
          { key: 'n', header: 'Note', render: (f) => <span className="block min-w-[140px] text-xs">{f.note}<span className="block text-faint">by {personName(s, f.byId)}</span></span> },
          { key: 'l', header: 'Sign-off', render: (f) => (f.locked ? <span title={signer(f) ? `Signed by ${personName(s, signer(f)!.actorId)}` : 'Signed in the forecast cycle'}><Badge tone="good">Locked</Badge></span> : canSign ? <Button size="sm" variant="marker" onClick={() => sign(f)}>{me.id === p.team.pm ? 'Sign & lock' : 'Sign as admin'}</Button> : <Badge tone="marker">Awaiting {personName(s, p.team.pm)}</Badge>) },
        ]} />
      ) : <div className="p-4"><Empty title="No forecasts yet">Start the first forecast cycle for this project.</Empty></div>}
    </Panel>
  )
}

function ForecastModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const pos = position(s, projectId)
  const last = s.forecasts.filter((f) => f.projectId === projectId).sort((a, b) => a.date.localeCompare(b.date)).pop()
  const y0 = Number(s.settings.asOf.slice(0, 4))
  const endY = Math.max(y0, ...Object.keys(last?.byYear ?? {}).map(Number), Number((p.milestones.find((m) => /in.service/i.test(m.name))?.forecast ?? s.settings.asOf).slice(0, 4)))
  const years = Array.from({ length: endY - y0 + 1 }, (_, i) => String(y0 + i))
  const init = () => { const base = last?.byYear ?? {}; const W = sum(years.map((y) => base[y] ?? 0)) || 1; return Object.fromEntries(years.map((y) => [y, Math.round(((base[y] ?? 1 / years.length) / W) * (last?.eac ?? pos.eac))])) as Record<string, number> }
  const [eac, setEac] = useState(last?.eac ?? pos.eac)
  const [byYear, setByYear] = useState<Record<string, number>>(init)
  const [note, setNote] = useState('')
  const total = sum(Object.values(byYear))
  const rescale = () => { const W = total || 1; let acc = 0; setByYear(Object.fromEntries(years.map((y, i) => { const v = i === years.length - 1 ? eac - acc : Math.round((byYear[y] / W) * eac); acc += v; return [y, v] }))) }
  const submit = () => {
    if (!note.trim()) { toast('Add a forecast note (what moved and why).', 'bad'); return }
    if (Math.abs(total - eac) > 1) { toast('The by-year spread must add up to the EAC.', 'bad'); return }
    mutate((d) => { d.forecasts.push({ id: uid('fc'), projectId, date: d.settings.asOf, eac, byYear, note: note.trim(), byId: d.currentUserId, locked: false }) }, { entity: 'forecast', entityId: projectId, projectId, action: 'create', summary: `Entered ${fmtMonth(s.settings.asOf.slice(0, 7))} forecast EAC ${money(eac, 'full')} (${moneyDelta(eac - (last?.eac ?? 0))})` })
    toast(`Forecast submitted — ${personName(s, p.team.pm)} signs to lock it`)
    setNote(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`${fmtMonth(s.settings.asOf.slice(0, 7))} forecast cycle`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit forecast</Button></>}>
      <div className="flex flex-col gap-3">
        <KV cols={3} items={[['Prior signed EAC', money(last?.eac, 'full')], ['Actual to date', money(pos.actualToDate, 'full')], ['Current budget', money(pos.currentBudget, 'full')]]} />
        <Field label="Estimate at completion"><MoneyInput value={eac} onChange={setEac} /></Field>
        <Section title="Spread by year" actions={<Button size="sm" variant="ghost" onClick={rescale}>Rescale to EAC</Button>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {years.map((y) => <Field key={y} label={y}><MoneyInput value={byYear[y] ?? 0} onChange={(v) => setByYear({ ...byYear, [y]: v })} /></Field>)}
          </div>
          <div className={cx('text-xs tabular-nums', Math.abs(total - eac) > 1 ? 'font-semibold text-bad' : 'text-muted')}>Spread total {money(total, 'full')} {Math.abs(total - eac) > 1 ? `· ${moneyDelta(total - eac)} vs EAC` : '· ties to EAC'}</div>
        </Section>
        <Field label="Forecast note"><TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Segment B rock productivity carried to completion; CR-1001-02 assumed approved." /></Field>
        <p className="text-xs text-faint">The PM's sign-off locks the forecast. Locked forecasts cannot be edited; the next cycle creates a new version.</p>
      </div>
    </Modal>
  )
}

// ───────────────────────────── ERP reconciliation (CC-01)
function ReconPanel({ s, projectId }: { s: AppState; projectId: string }) {
  const p = s.projects.find((x) => x.id === projectId)!
  const r = useMemo(() => erpRecon(s, projectId), [s, projectId])
  const [mapTo, setMapTo] = useState(r.rows[0]?.categoryId ?? '')
  const mapLine = () => {
    const u = r.unmapped
    if (!u) return
    const cat = s.categories.find((c) => c.id === mapTo)
    mutate(() => {}, { entity: 'erp-recon', entityId: `${projectId}:${u.period}`, projectId, action: 'map', summary: `Mapped ${money(u.amount, 'full')} suspense posting (${u.period}) to ${cat?.code} ${cat?.name}` })
    toast('Posting mapped; journal correction requested')
  }
  const tie = r.erpTotal === r.mainlineTotal
  return (
    <Panel title="ERP reconciliation" subtitle={`WBS ${p.erpWbs} · actuals by cost element vs budget by category`} pad={false}>
      <Table rows={r.rows} rowKey={(x) => x.categoryId} dense maxHeight={300} columns={[
        { key: 'c', header: 'Category', render: (x) => <span>{x.name} <Mono className="text-faint">{x.element}</Mono></span> },
        { key: 'b', header: 'Budget', num: true, render: (x) => money(x.budget) },
        { key: 'a', header: 'Actual', num: true, render: (x) => money(x.actual) },
        { key: 'p', header: 'Spent', num: true, render: (x) => <span className={x.actual > x.budget ? 'font-semibold text-bad' : ''}>{x.budget ? pct(x.actual / x.budget) : '—'}</span>, sort: (x) => (x.budget ? x.actual / x.budget : 0) },
      ]} />
      <div className="flex flex-col gap-2 border-t border-line p-3 text-[13px]">
        {r.unmapped ? (
          <div className="flex flex-col gap-2 rounded-md border border-marker bg-marker/10 p-2.5">
            <div><Badge tone="marker">Unmapped</Badge> <b className="tabular-nums">{money(r.unmapped.amount, 'full')}</b> in {fmtMonth(r.unmapped.period)} — {r.unmapped.text}.</div>
            <div className="flex flex-wrap items-center gap-2"><Select className="w-auto min-w-[200px]" value={mapTo} onChange={(e) => setMapTo(e.target.value)} options={r.rows.map((x) => ({ value: x.categoryId, label: x.name }))} /><Button size="sm" onClick={mapLine}>Map to category</Button></div>
          </div>
        ) : <div className="text-good">All postings mapped to cost categories.</div>}
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span>ERP actual {money(r.erpTotal, 'full')} · Crosswalk cost periods {money(r.mainlineTotal, 'full')} <Badge tone={tie ? 'good' : 'bad'}>{tie ? 'Ties' : 'Out of balance'}</Badge></span>
          <span>Budget by category {money(r.budgetTotal)} (excl. contingency)</span>
        </div>
        <p className="text-[11px] text-faint">Cost-element detail is simulated from the period totals for this demo; totals come from the ERP cost periods.</p>
      </div>
    </Panel>
  )
}

