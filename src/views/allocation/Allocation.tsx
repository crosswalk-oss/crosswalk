// Capital allocation: weight the benefit measures, set the capital available, and fund the combination of projects
// that delivers the most benefit. Measures, scale and presets are set in Configuration → Capital allocation.
// Saved to the shared database; every change is audited.
import { useEffect, useMemo, useState } from 'react'
import type { AllocationCriterion, AllocationDecision, AllocationSettings, AppState } from '@/core/types'
import { mutate, useMe, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx } from '@/core/util'
import { BarChart, HBarChart, LineChart } from '@/ui/charts'
import { Badge, Button, Callout, Panel, PageHeader, Select, Stat } from '@/ui/kit'
import type { Tone } from '@/ui/kit'
import { toast } from '@/ui/toast'
import {
  ATTRIBUTE_LABEL, DECISION_LABEL, STATUS_LABEL, activeCriteria, allocationOf, annualLimits, authorizedFunding, dependencyLoop, benefitValue, confidenceOf, optimize, saveAllocation, setBenefits, validateAllocation, weightShares,
  type AllocResult, type AllocRow, type AllocStatus,
} from '@/core/engine/allocation'
import { CommitNum, bn, fmtAmount, measureColor, pts } from './parts'

type Draft = { weights: Record<AllocationCriterion, number>; budget: number; lockCommitted: boolean; useConfidence: boolean; annual: AllocationSettings['annual']; timing: AllocationSettings['timing'] }
const STATUS_TONE: Record<AllocStatus, Tone> = { committed: 'ink', must: 'marker', funded: 'good', unfunded: 'warn', excluded: 'neutral' }
const ADMIN = '#admin-allocation'

const draftOf = (a: AllocationSettings): Draft => ({ weights: Object.fromEntries(a.criteria.map((c) => [c.id, c.weight])), budget: a.budget, lockCommitted: a.lockCommitted, useConfidence: a.useConfidence, annual: a.annual, timing: a.timing })
const same = (x: Draft, y: Draft) => JSON.stringify(x) === JSON.stringify(y)

export default function Allocation() {
  const s = useStore()
  const me = useMe()
  const saved = useMemo(() => allocationOf(s), [s])
  const savedDraft = draftOf(saved)
  const [draft, setDraft] = useState<Draft>(() => savedDraft)
  // pick up a save made elsewhere (another viewer, or Configuration) when there are no unsaved edits here
  const [base, setBase] = useState(savedDraft)
  useEffect(() => { if (!same(base, savedDraft)) { if (same(draft, base)) setDraft(savedDraft); setBase(savedDraft) } }, [JSON.stringify(savedDraft)]) // eslint-disable-line react-hooks/exhaustive-deps
  const cfg: AllocationSettings = { ...saved, budget: draft.budget, lockCommitted: draft.lockCommitted, useConfidence: draft.useConfidence, annual: draft.annual, timing: draft.timing, criteria: saved.criteria.map((c) => ({ ...c, weight: draft.weights[c.id] ?? c.weight })) }
  const problems = validateAllocation(cfg)
  const r = useMemo(() => optimize(s, cfg), [s, JSON.stringify(cfg)]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !same(draft, savedDraft)
  const auth = authorizedFunding(s)
  const shares = weightShares(cfg)
  const act = activeCriteria(cfg)

  const save = () => {
    if (problems.length) return
    const w = act.map((c) => `${c.label} ${Math.round((shares[c.id] ?? 0) * 100)}%`).join(' / ')
    const capital = draft.annual.on ? `limits by year ${r.yearly.map((y) => `${y.year} ${bn(y.limit ?? 0)}`).join(', ')}, up to ${draft.annual.maxDeferYears} yr later` : `capital available ${bn(draft.budget)}`
    mutate((d) => { saveAllocation(d, { weights: draft.weights, budget: draft.budget, lockCommitted: draft.lockCommitted, useConfidence: draft.useConfidence, annual: draft.annual, timing: draft.timing }) },
      { entity: 'capital-allocation', entityId: 'portfolio', action: 'update', summary: `Saved capital allocation: weights ${w}; ${capital}; ${r.funded} of ${r.eligible} projects funded${r.deferred ? ` (${r.deferred} start later)` : ''} for ${pts(r.benefit)}` })
    toast('Capital allocation saved for everyone')
  }
  const decide = (row: AllocRow, v: AllocationDecision) => {
    mutate((d) => { saveAllocation(d, { decisions: { [row.project.id]: v } }) }, { entity: 'capital-allocation', entityId: row.project.id, action: 'update', summary: `${row.project.code}: ${DECISION_LABEL[row.decision]} → ${DECISION_LABEL[v]}` })
  }
  const setNeeds = (row: AllocRow, requiresId: string, add: boolean) => {
    const other = s.projects.find((p) => p.id === requiresId)
    if (add && dependencyLoop(saved.dependencies, row.project.id, requiresId)) { toast(`${other?.code} already depends on ${row.project.code}`); return }
    const next = add ? [...saved.dependencies, { projectId: row.project.id, requiresId }] : saved.dependencies.filter((d) => !(d.projectId === row.project.id && d.requiresId === requiresId))
    mutate((d) => { saveAllocation(d, { dependencies: next }) }, { entity: 'capital-allocation', entityId: row.project.id, action: 'update', summary: `${row.project.code} ${add ? 'now needs' : 'no longer needs'} ${other?.code ?? requiresId}` })
  }
  const exportCsv = async () => {
    const rows = r.rows.map((x) => ({
      project: x.project.code, name: x.project.name, program: s.programs.find((p) => p.id === x.project.programId)?.code, driver: x.project.driver, status: STATUS_LABEL[x.status], decision: DECISION_LABEL[x.decision], cost_to_complete: x.cost,
      ...Object.fromEntries(act.flatMap((c) => [[`${c.id}_${c.unit}`, benefitValue(x.project.benefits, c.id)], [`${c.id}_pts`, (x.parts[c.id] ?? 0).toFixed(1)]])),
      delivery_confidence_pct: confidenceOf(x.project.benefits), in_service: x.inService, starts_later_yrs: x.defer, needs: x.needs.map((id) => s.projects.find((p) => p.id === id)?.code).join(' '), note: x.note ?? '', benefit_pts: x.benefit.toFixed(1), counted_pts: x.counted.toFixed(1), pts_per_$M: Number.isFinite(x.perM) ? x.perM.toFixed(2) : '', basis: x.project.benefits?.basis ?? '',
    }))
    const res = await saveFile(`capital-allocation-${s.settings.asOf}.csv`, toCSV(rows), 'text/csv')
    if (res === 'saved') toast('Exported')
  }

  return (
    <div>
      <PageHeader eyebrow="Portfolio" title="Capital allocation"
        subtitle="Quantify what each project delivers, weight what matters, and fund the combination of projects that gets the most benefit from the capital available."
        actions={<>
          <a href={ADMIN} className="text-[12.5px] font-semibold text-link">Configure measures</a>
          <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
          {dirty && <Button variant="ghost" onClick={() => setDraft(savedDraft)}>Undo changes</Button>}
          <Button variant="primary" disabled={!dirty || problems.length > 0} onClick={save}>{dirty ? 'Save allocation' : 'Saved'}</Button>
        </>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Controls cfg={cfg} draft={draft} setDraft={setDraft} shares={shares} auth={auth} problems={problems} dirty={dirty} r={r} s={s} />
        <div className="flex min-w-0 flex-col gap-4">
          {r.overLocked > 0 && <Callout tone="bad" title="Committed and must-fund work is over the capital available">{r.mode === 'annual' ? <>Locked projects alone exceed the limit in {r.overLockedYears.join(', ')} by {bn(r.overLocked)}. Raise those limits or change a Must fund decision.</> : <>Locked projects need {bn(r.lockedCost)}, {bn(r.overLocked)} more than {bn(r.budget)}. Raise the capital available or change a Must fund decision.</>}</Callout>}
          {r.problems.map((m) => <Callout key={m} tone="warn" title="Prerequisite conflict">{m}</Callout>)}
          {!r.exact && <Callout tone="info" title="Best plan found">This combination of limits is large enough that the search stopped at its time limit. The plan shown is the best found and is never worse than rank order; it may not be the single best possible.</Callout>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Benefit funded" value={pts(r.benefit)} sub={`${r.maxBenefit ? Math.round((r.benefit / r.maxBenefit) * 100) : 0}% of everything on the list`} />
            <Stat label="Capital allocated" value={bn(r.spend)} sub={r.mode === 'annual' ? `limits ${r.yearly[0]?.year}–${r.yearly.at(-1)?.year} total ${bn(r.budget)}` : `of ${bn(r.budget)} · ${bn(r.unused)} unused`} tone={r.overLocked ? 'bad' : undefined} />
            <Stat label="Projects funded" value={`${r.funded} of ${r.eligible}`} sub={`${r.rows.filter((x) => x.status === 'unfunded').length} not funded${r.deferred ? ` · ${r.deferred} start later` : ''}`} />
            {r.benefit - r.greedyBenefit >= 0.5
              ? <Stat label="Optimized vs rank order" value={`+${Math.round(r.benefit - r.greedyBenefit).toLocaleString('en-US')} pts`} tone="good" sub={`Funding in benefit-per-dollar order until the money runs out gets ${pts(r.greedyBenefit)}`} />
              : <Stat label="Benefit per $1M" value={(r.spend ? r.benefit / (r.spend / 1e6) : 0).toFixed(2)} sub="Rank order reaches the same plan at this capital level" />}
          </div>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Benefit for each level of capital" subtitle="The most benefit any combination of projects can deliver for the money (committed and must-fund work first).">
              <Frontier r={r} />
            </Panel>
            <Panel title="What the funded plan delivers">
              <Delivers r={r} s={s} cfg={cfg} />
            </Panel>
          </div>
          <Panel title="Spend by year" subtitle={r.mode === 'annual' ? 'The funded plan against each year\'s limit, after any project starts later.' : 'The funded plan by year. Turn on Limit by year to hold each year to its own cap.'}>
            <BarChart labels={r.yearly.map((y) => y.year)} stacked format={bn} height={210} targets={r.mode === 'annual' ? r.yearly.map((y) => y.limit) : undefined}
              series={[{ name: 'Committed and must fund', values: r.yearly.map((y) => y.committed), color: 'rgb(var(--ink) / 0.75)' }, { name: 'Funded as planned', values: r.yearly.map((y) => y.funded), color: 'rgb(var(--good))' }, { name: 'Funded, starting later', values: r.yearly.map((y) => y.deferred), color: 'rgb(var(--marker))' }]} />
          </Panel>
        </div>
      </div>
      <Panel className="mt-4" pad={false} title="Projects" subtitle={`Edit the benefit amounts in place. Committed projects (control budget in force) and Must fund are funded first; the optimizer picks the rest.${cfg.useConfidence ? ' Benefit is multiplied by delivery confidence.' : ''}`}>
        <ProjectTable r={r} s={s} cfg={cfg} meId={me.id} onDecide={decide} onNeeds={setNeeds} />
      </Panel>
    </div>
  )
}

function Controls({ cfg, draft, setDraft, shares, auth, problems, dirty, r, s }: { cfg: AllocationSettings; draft: Draft; setDraft: (d: Draft) => void; shares: Record<AllocationCriterion, number>; auth: ReturnType<typeof authorizedFunding>; problems: string[]; dirty: boolean; r: AllocResult; s: AppState }) {
  const act = activeCriteria(cfg)
  return (
    <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
      <Panel title="Weighting" subtitle="How much each kind of benefit counts. Drag to see the plan change; save to make it the portfolio's."
        actions={<a href={ADMIN} className="text-[12px] font-semibold text-link">Measures</a>}>
        <div className="flex flex-col gap-3.5">
          {act.map((c) => (
            <div key={c.id}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`w-${c.id}`} className="min-w-0 text-[13px] font-semibold">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: measureColor(cfg, c.id) }} />{c.label}
                  <span className="ml-1.5 text-[11px] font-normal text-faint">{ATTRIBUTE_LABEL[c.attribute]}</span>
                </label>
                <span className="font-display text-[17px] font-bold tabular-nums">{Math.round((shares[c.id] ?? 0) * 100)}%</span>
              </div>
              <input id={`w-${c.id}`} type="range" min={0} max={100} step={1} value={draft.weights[c.id] ?? 0} aria-label={`${c.label} weight`} title={c.help} className="mt-0.5 w-full accent-[rgb(var(--ink))]"
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [c.id]: Number(e.target.value) } })} />
            </div>
          ))}
          {cfg.presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cfg.presets.map((p) => (
                <button key={p.id} type="button" onClick={() => setDraft({ ...draft, weights: { ...draft.weights, ...Object.fromEntries(act.map((c) => [c.id, p.weights[c.id] ?? 0])) } })} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:border-ink/40 hover:text-ink">{p.name}</button>
              ))}
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Capital available" subtitle="For the projects' cost to complete.">
        <div className="flex flex-col gap-2">
          <div className="inline-flex self-start rounded-md border border-line p-0.5 text-[12.5px]" role="group" aria-label="How capital is limited">
            {([false, true] as const).map((on) => (
              <button key={String(on)} type="button" aria-pressed={draft.annual.on === on} onClick={() => setDraft({ ...draft, annual: { ...draft.annual, on } })}
                className={cx('rounded px-2.5 py-1 font-semibold', draft.annual.on === on ? 'bg-link text-white' : 'text-muted hover:text-ink')}>{on ? 'Limit by year' : 'One total'}</button>
            ))}
          </div>
          {!draft.annual.on ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">$</span>
                <CommitNum id="alloc-budget" ariaLabel="Capital available in millions" value={Math.round(draft.budget / 1e5) / 10} onCommit={(v) => setDraft({ ...draft, budget: Math.max(0, v) * 1e6 })} className="w-32" live />
                <span className="text-[13px] text-muted">million</span>
              </div>
              <input type="range" aria-label="Capital available" min={0} max={3000} step={10} value={Math.round(draft.budget / 1e6)} onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) * 1e6 })} className="w-full accent-[rgb(var(--ink))]" />
              <button type="button" className="self-start text-[12px] font-semibold text-link" onClick={() => setDraft({ ...draft, budget: auth.amount })}>Use authorized funding {auth.from}–{auth.to} ({bn(auth.amount)})</button>
            </>
          ) : (
            <>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {r.yearly.map((y) => {
                    const lim = annualLimits(s, draft, [y.year])[y.year]
                    return (
                      <tr key={y.year} className="border-b border-line last:border-0">
                        <td className="py-1 pr-2 font-semibold">{y.year}</td>
                        <td className="py-1"><span className="flex items-center gap-1"><span className="text-muted">$</span><CommitNum ariaLabel={`${y.year} limit in millions`} value={Math.round(lim.amount / 1e5) / 10} onCommit={(v) => setDraft({ ...draft, annual: { ...draft.annual, limits: { ...draft.annual.limits, [y.year]: Math.max(0, v) * 1e6 } } })} className="w-24 py-0.5" /><span className="text-muted">M</span></span></td>
                        <td className="py-1 pl-2 text-[11px] leading-tight text-faint">{lim.custom ? <button type="button" className="text-link" onClick={() => { const { [y.year]: _, ...rest } = draft.annual.limits; setDraft({ ...draft, annual: { ...draft.annual, limits: rest } }) }}>Reset to default</button> : lim.basis}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <label className="flex items-center gap-2 text-[12.5px]">
                <span>Projects may start up to</span>
                <Select aria-label="Most years a project may start later" value={String(draft.annual.maxDeferYears)} onChange={(e) => setDraft({ ...draft, annual: { ...draft.annual, maxDeferYears: Number(e.target.value) } })} className="w-20 py-0.5"
                  options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} />
                <span>{draft.annual.maxDeferYears === 1 ? 'year later' : 'years later'}</span>
              </label>
            </>
          )}
          <label className="mt-1 flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={draft.lockCommitted} onChange={(e) => setDraft({ ...draft, lockCommitted: e.target.checked })} />
            <span>Fund committed projects first <span className="text-muted">(control budget in force, work under contract)</span></span>
          </label>
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={draft.useConfidence} onChange={(e) => setDraft({ ...draft, useConfidence: e.target.checked })} />
            <span>Risk-adjust benefit by delivery confidence <span className="text-muted">(the chance scope, permits and schedule hold)</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={draft.timing.on} onChange={(e) => setDraft({ ...draft, timing: { ...draft.timing, on: e.target.checked } })} />
              <span>Count benefit from its in-service year, discounted</span>
            </label>
            {draft.timing.on && <span className="flex items-center gap-1"><CommitNum ariaLabel="Discount rate percent a year" value={draft.timing.discountPct} onCommit={(v) => setDraft({ ...draft, timing: { ...draft.timing, discountPct: Math.min(20, Math.max(0, v)) } })} className="w-14 py-0.5" /><span className="text-muted">% a year</span></span>}
          </div>
        </div>
      </Panel>
      <Panel title="How benefit is scored" actions={<a href={ADMIN} className="text-[12px] font-semibold text-link">Change</a>}>
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          {act.map((c) => <div key={c.id} className="flex justify-between gap-2"><span className="text-muted">100 pts of {c.label.toLowerCase()}</span><b className="tabular-nums">{fmtAmount(c.fullCredit, c)}</b></div>)}
          <p className="mt-1 text-[11.5px] text-muted">Benefit points = amount ÷ the 100-point amount × 100 × weight{cfg.useConfidence ? ' × delivery confidence' : ''}{cfg.timing.on ? ` × a ${cfg.timing.discountPct}% a year discount for each year until it is in service` : ''}. The optimizer checks every combination{r.method === 'search' ? ' of fund, start later or don\'t fund, respecting limits by year and prerequisites,' : ' (an exact knapsack)'} and funds the set with the most points that fits.</p>
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="marker">Measures and scale — verify</Badge><span className="text-[11px] text-faint">Starting values are placeholders for the portfolio team.</span></div>
          <p className="text-[11.5px] text-muted">Engineering, system and financial measures only. Community demographics and income are never inputs.</p>
        </div>
      </Panel>
      {problems.length > 0 && <Callout tone="bad" title="Fix before saving"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Callout>}
      {dirty && !problems.length && <div className="text-[12px] text-warn">Unsaved changes: you are seeing a what-if. Save to make it the plan everyone sees.</div>}
    </div>
  )
}

function Frontier({ r }: { r: AllocResult }) {
  const f = r.frontier
  const idx = f.reduce((best, p, i) => (Math.abs(p.budget - r.budget) < Math.abs(f[best].budget - r.budget) ? i : best), 0)
  const beyond = r.budget > f[f.length - 1].budget
  return (
    <div>
      <LineChart labels={f.map((p) => bn(p.budget))} series={[{ name: 'Most benefit achievable', values: f.map((p) => Math.round(p.benefit)), area: true }]} format={(n) => `${Math.round(n)}`}
        markers={beyond ? undefined : [{ index: idx, label: idx > f.length * 0.7 ? 'Available' : `Available ${bn(r.budget)}` }]} height={230} />
      <p className="mt-1 text-[12px] text-muted">
        Starts at the committed and must-fund work ({bn(r.lockedCost)}) and ends with every eligible project funded ({bn(f[f.length - 1].budget)}, {pts(r.maxBenefit)}).
        {' '}Where the curve flattens, more capital buys little more benefit.{r.frontierNote ? ` ${r.frontierNote}` : ''}
      </p>
    </div>
  )
}

function Delivers({ r, s, cfg }: { r: AllocResult; s: AppState; cfg: AllocationSettings }) {
  const funded = r.rows.filter((x) => x.status === 'funded' || x.status === 'committed' || x.status === 'must')
  const eligible = r.rows.filter((x) => x.status !== 'excluded')
  const act = activeCriteria(cfg)
  const byProgram = s.programs.map((p) => ({ label: p.code, sub: p.name, value: funded.filter((x) => x.project.programId === p.id).reduce((a, x) => a + x.cost, 0) })).filter((x) => x.value > 0)
  return (
    <div className="flex flex-col gap-3">
      <HBarChart rows={act.map((c) => ({ label: c.label, value: Math.round(r.byCriterion[c.id] ?? 0), color: measureColor(cfg, c.id) }))} format={(n) => pts(n)} />
      <div>
        {act.map((c) => {
          const v = funded.reduce((a, x) => a + benefitValue(x.project.benefits, c.id), 0)
          const of = eligible.reduce((a, x) => a + benefitValue(x.project.benefits, c.id), 0)
          return <div key={c.id} className="flex items-baseline justify-between gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0"><span className="text-muted">{c.label}</span><span className="text-right"><b className="tabular-nums">{fmtAmount(v, c)}</b> <span className="text-faint">of {fmtAmount(of, c)}</span></span></div>
        })}
        {cfg.useConfidence && <div className="pt-1 text-[11px] text-faint">Amounts as planned; points are risk-adjusted by delivery confidence.</div>}
      </div>
      <div><div className="eyebrow mb-1">Capital by program</div><HBarChart rows={byProgram} format={bn} /></div>
    </div>
  )
}

function ProjectTable({ r, s, cfg, meId, onDecide, onNeeds }: { r: AllocResult; s: AppState; cfg: AllocationSettings; meId: string; onDecide: (row: AllocRow, v: AllocationDecision) => void; onNeeds: (row: AllocRow, requiresId: string, add: boolean) => void }) {
  const codeOf = (id: string) => s.projects.find((p) => p.id === id)?.code ?? id
  const noteOf = (row: AllocRow, id: string) => cfg.dependencies.find((d) => d.projectId === row.project.id && d.requiresId === id)?.note
  const act = activeCriteria(cfg)
  const maxB = Math.max(...r.rows.map((x) => x.benefit), 1)
  const edit = (row: AllocRow, id: AllocationCriterion, v: number) => {
    const c = cfg.criteria.find((x) => x.id === id)!
    const before = benefitValue(row.project.benefits, id)
    if (before === v) return
    mutate((d) => { setBenefits(d, row.project.id, { values: { [id]: v } }, meId) }, { entity: 'project', entityId: row.project.id, action: 'update', summary: `${row.project.code} ${c.label.toLowerCase()} benefit ${before.toLocaleString('en-US')} → ${v.toLocaleString('en-US')} ${c.unit}` })
  }
  const editConf = (row: AllocRow, v: number) => {
    const before = confidenceOf(row.project.benefits)
    const next = Math.min(100, Math.max(0, v))
    if (before === next) return
    mutate((d) => { setBenefits(d, row.project.id, { confidence: next }, meId) }, { entity: 'project', entityId: row.project.id, action: 'update', summary: `${row.project.code} delivery confidence ${before}% → ${next}%` })
  }
  return (
    <div className="scroll-x">
      <table className="tbl" style={{ minWidth: 1060 + act.length * 92 + (cfg.useConfidence ? 80 : 0) }}>
        <thead>
          <tr>
            <th>Project</th><th>Plan</th><th className="num">Cost to complete</th>
            <th>Benefit</th><th className="num">Pts per $M</th><th>Decision</th><th title="Year the benefit starts">In service</th><th title="Projects this one needs before it delivers its benefit">Needs</th>
            {act.map((c) => <th key={c.id} className="num" title={c.help}><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: measureColor(cfg, c.id) }} />{c.label}<div className="text-[10.5px] font-normal normal-case text-faint">{c.unit}</div></th>)}
            {cfg.useConfidence && <th className="num" title="Chance the benefit is delivered as planned">Confidence<div className="text-[10.5px] font-normal normal-case text-faint">%</div></th>}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.project.id} className={cx(x.status === 'excluded' && 'opacity-60')}>
              <td className="min-w-[220px]">
                <a href={projectHref(x.project.code)} className="font-mono text-[12px] font-semibold text-link">{x.project.code}</a>
                <span className="ml-1.5 text-[11px] text-faint">{s.programs.find((p) => p.id === x.project.programId)?.code}</span>
                <div className="text-[12.5px]">{x.project.name}</div>
                {x.project.benefits?.basis && <div className="text-[11px] text-faint" title={x.project.benefits.basis}>{x.project.benefits.basis}</div>}
                {x.missing && <div className="text-[11px] text-warn">No benefit entered yet</div>}
              </td>
              <td>
                <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>
                {x.status === 'funded' && x.defer > 0 && <div className="mt-0.5 text-[11px] font-semibold text-marker">starts {x.defer} yr later</div>}
                {x.note && <div className="mt-0.5 max-w-[150px] text-[11px] text-muted">{x.note}</div>}
                {x.status === 'unfunded' && !x.note && r.mode === 'total' && <div className="mt-0.5 text-[11px] text-muted">needs {bn(Math.max(0, x.cost - r.unused))} more</div>}
              </td>
              <td className="num">{bn(x.cost)}</td>
              <td className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex h-2.5 w-20 overflow-hidden rounded-sm bg-sunken" title={act.map((c) => `${c.label} ${Math.round(x.parts[c.id] ?? 0)} pts`).join(' · ')}>
                    {act.map((c) => <div key={c.id} style={{ width: `${((x.parts[c.id] ?? 0) / maxB) * 100}%`, background: measureColor(cfg, c.id) }} />)}
                  </div>
                  <span className="text-[12.5px] font-semibold tabular-nums">{Math.round(x.benefit)}</span>
                </div>
              </td>
              <td className="num font-semibold">{Number.isFinite(x.perM) ? x.perM.toFixed(2) : '—'}</td>
              <td>
                <Select aria-label={`${x.project.code} decision`} value={x.decision} onChange={(e) => onDecide(x, e.target.value as AllocationDecision)} className="min-w-[175px] py-0.5 text-[12.5px]"
                  options={(['auto', 'must', 'exclude'] as AllocationDecision[]).map((d) => ({ value: d, label: d === 'auto' && x.committed && x.locked ? 'Committed' : DECISION_LABEL[d] }))} />
              </td>
              <td className="whitespace-nowrap text-[12.5px] tabular-nums">
                {x.inService + (x.status === 'funded' ? x.defer : 0)}
                {x.status === 'funded' && x.defer > 0 && <span className="ml-1 text-[11px] text-faint">(was {x.inService})</span>}
                {cfg.timing.on && <div className="text-[10.5px] text-faint">× {(x.counted && x.benefit ? (x.timeFactor * x.counted) / x.benefit : x.timeFactor).toFixed(2)} timing</div>}
              </td>
              <td className="min-w-[150px]">
                <div className="flex flex-wrap items-center gap-1">
                  {x.needs.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px]" title={noteOf(x, id) ?? `Needs ${codeOf(id)}`}>
                      {codeOf(id)}<button type="button" aria-label={`Remove ${codeOf(id)} from ${x.project.code} needs`} className="text-muted hover:text-bad" onClick={() => onNeeds(x, id, false)}>×</button>
                    </span>
                  ))}
                  <select aria-label={`${x.project.code} add prerequisite`} value="" className="max-w-[86px] rounded border border-dashed border-line bg-transparent px-1 py-0.5 text-[11px] text-muted"
                    onChange={(e) => { if (e.target.value) onNeeds(x, e.target.value, true) }}>
                    <option value="">+ needs…</option>
                    {r.rows.filter((o) => o.project.id !== x.project.id && !x.needs.includes(o.project.id)).map((o) => <option key={o.project.id} value={o.project.id}>{o.project.code}</option>)}
                  </select>
                </div>
              </td>
              {act.map((c) => (
                <td key={c.id} className="num"><CommitNum ariaLabel={`${x.project.code} ${c.label}`} value={benefitValue(x.project.benefits, c.id)} onCommit={(v) => edit(x, c.id, Math.max(0, v))} className="ml-auto w-[80px] py-0.5 text-[12.5px]" /></td>
              ))}
              {cfg.useConfidence && <td className="num"><CommitNum ariaLabel={`${x.project.code} delivery confidence`} value={confidenceOf(x.project.benefits)} onCommit={(v) => editConf(x, v)} className="ml-auto w-[60px] py-0.5 text-[12.5px]" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
