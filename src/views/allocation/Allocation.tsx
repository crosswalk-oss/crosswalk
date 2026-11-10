// Capital allocation: weight safety, added capacity and redundancy, set the capital available, and fund the
// combination of projects that delivers the most benefit. Saved to the shared database; every change is audited.
import { useEffect, useMemo, useState } from 'react'
import type { AllocationCriterion, AllocationDecision, AllocationSettings, AppState } from '@/core/types'
import { mutate, useMe, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, money } from '@/core/util'
import { HBarChart, LineChart } from '@/ui/charts'
import { Badge, Button, Callout, Panel, PageHeader, Select, Stat } from '@/ui/kit'
import type { Tone } from '@/ui/kit'
import { toast } from '@/ui/toast'
import {
  CRITERIA, DECISION_LABEL, STATUS_LABEL, allocationOf, authorizedFunding, optimize, saveAllocation, setBenefits, validateAllocation, weightShares,
  type AllocResult, type AllocRow, type AllocStatus,
} from '@/core/engine/allocation'

type Draft = Pick<AllocationSettings, 'weights' | 'fullCredit' | 'budget' | 'lockCommitted'>
const COLOR: Record<AllocationCriterion, string> = { safety: 'rgb(var(--bad))', capacity: 'rgb(var(--info))', redundancy: 'rgb(var(--good))' }
const STATUS_TONE: Record<AllocStatus, Tone> = { committed: 'ink', must: 'marker', funded: 'good', unfunded: 'warn', excluded: 'neutral' }
const pts = (n: number) => `${Math.round(n).toLocaleString('en-US')} pts`
const bn = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : money(n))

const draftOf = (a: AllocationSettings): Draft => ({ weights: { ...a.weights }, fullCredit: { ...a.fullCredit }, budget: a.budget, lockCommitted: a.lockCommitted })
const same = (x: Draft, y: Draft) => JSON.stringify(x) === JSON.stringify(y)

export default function Allocation() {
  const s = useStore()
  const me = useMe()
  const saved = useMemo(() => allocationOf(s), [s])
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved))
  const savedDraft = draftOf(saved)
  // pick up a save made by someone else when we have no unsaved edits
  const [base, setBase] = useState(savedDraft)
  useEffect(() => { if (!same(base, savedDraft)) { if (same(draft, base)) setDraft(savedDraft); setBase(savedDraft) } }, [JSON.stringify(savedDraft)]) // eslint-disable-line react-hooks/exhaustive-deps
  const cfg: AllocationSettings = { ...saved, ...draft }
  const problems = validateAllocation(cfg)
  const r = useMemo(() => optimize(s, cfg), [s, JSON.stringify(cfg)]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !same(draft, savedDraft)
  const auth = authorizedFunding(s)
  const shares = weightShares(draft.weights)

  const save = () => {
    if (problems.length) return
    const w = CRITERIA.map((c) => `${c.label} ${Math.round(shares[c.id] * 100)}%`).join(' / ')
    mutate((d) => { saveAllocation(d, draft) }, { entity: 'capital-allocation', entityId: 'portfolio', action: 'update', summary: `Saved capital allocation: weights ${w}; capital available ${bn(draft.budget)}; ${r.funded} of ${r.eligible} projects funded for ${pts(r.benefit)}` })
    toast('Capital allocation saved for everyone')
  }
  const decide = (row: AllocRow, v: AllocationDecision) => {
    mutate((d) => { saveAllocation(d, { decisions: { [row.project.id]: v } }) }, { entity: 'capital-allocation', entityId: row.project.id, action: 'update', summary: `${row.project.code}: ${DECISION_LABEL[row.decision]} → ${DECISION_LABEL[v]}` })
  }
  const exportCsv = async () => {
    const rows = r.rows.map((x) => ({
      project: x.project.code, name: x.project.name, program: s.programs.find((p) => p.id === x.project.programId)?.code, driver: x.project.driver, status: STATUS_LABEL[x.status], decision: DECISION_LABEL[x.decision],
      cost_to_complete: x.cost, safety_k_per_yr: x.project.benefits?.safetyK ?? 0, capacity_mmcfd: x.project.benefits?.capacityMmcfd ?? 0, redundancy_customers: x.project.benefits?.redundancyCustomers ?? 0,
      safety_pts: x.parts.safety.toFixed(1), capacity_pts: x.parts.capacity.toFixed(1), redundancy_pts: x.parts.redundancy.toFixed(1), benefit_pts: x.benefit.toFixed(1), pts_per_$M: Number.isFinite(x.perM) ? x.perM.toFixed(2) : '', basis: x.project.benefits?.basis ?? '',
    }))
    const res = await saveFile(`capital-allocation-${s.settings.asOf}.csv`, toCSV(rows), 'text/csv')
    if (res === 'saved') toast('Exported')
  }

  return (
    <div>
      <PageHeader eyebrow="Portfolio" title="Capital allocation"
        subtitle="Quantify what each project delivers in safety, added capacity and redundancy, weight what matters, and fund the combination of projects that gets the most benefit from the capital available."
        actions={<>
          <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
          {dirty && <Button variant="ghost" onClick={() => setDraft(savedDraft)}>Undo changes</Button>}
          <Button variant="primary" disabled={!dirty || problems.length > 0} onClick={save}>{dirty ? 'Save allocation' : 'Saved'}</Button>
        </>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Controls draft={draft} setDraft={setDraft} shares={shares} auth={auth} problems={problems} dirty={dirty} />
        <div className="flex min-w-0 flex-col gap-4">
          {r.overLocked > 0 && <Callout tone="bad" title="Committed and must-fund work is over the capital available">Locked projects need {bn(r.lockedCost)}, {bn(r.overLocked)} more than {bn(r.budget)}. Raise the capital available or change a Must fund decision.</Callout>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Benefit funded" value={pts(r.benefit)} sub={`${r.maxBenefit ? Math.round((r.benefit / r.maxBenefit) * 100) : 0}% of everything on the list`} />
            <Stat label="Capital allocated" value={bn(r.spend)} sub={`of ${bn(r.budget)} · ${bn(r.unused)} unused`} tone={r.overLocked ? 'bad' : undefined} />
            <Stat label="Projects funded" value={`${r.funded} of ${r.eligible}`} sub={`${r.rows.filter((x) => x.status === 'unfunded').length} not funded`} />
            {r.benefit - r.greedyBenefit >= 0.5
              ? <Stat label="Optimized vs rank order" value={`+${Math.round(r.benefit - r.greedyBenefit).toLocaleString('en-US')} pts`} tone="good" sub={`Funding in benefit-per-dollar order until the money runs out gets ${pts(r.greedyBenefit)}`} />
              : <Stat label="Benefit per $1M" value={(r.spend ? r.benefit / (r.spend / 1e6) : 0).toFixed(2)} sub="Rank order reaches the same plan at this capital level" />}
          </div>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Benefit for each level of capital" subtitle="The most benefit any combination of projects can deliver for the money (committed and must-fund work first).">
              <Frontier r={r} />
            </Panel>
            <Panel title="What the funded plan delivers">
              <Delivers r={r} s={s} />
            </Panel>
          </div>
        </div>
      </div>
      <Panel className="mt-4" pad={false} title="Projects" subtitle="Edit the benefit numbers in place. Committed projects (control budget in force) and Must fund are funded first; the optimizer picks the rest.">
        <ProjectTable r={r} s={s} meId={me.id} onDecide={decide} />
      </Panel>
    </div>
  )
}

function Controls({ draft, setDraft, shares, auth, problems, dirty }: { draft: Draft; setDraft: (d: Draft) => void; shares: Record<AllocationCriterion, number>; auth: ReturnType<typeof authorizedFunding>; problems: string[]; dirty: boolean }) {
  return (
    <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
      <Panel title="Weighting" subtitle="How much each kind of benefit counts. Drag to see the plan change; save to make it the portfolio's.">
        <div className="flex flex-col gap-4">
          {CRITERIA.map((c) => (
            <div key={c.id}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`w-${c.id}`} className="text-[13px] font-semibold"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COLOR[c.id] }} />{c.label}</label>
                <span className="font-display text-[18px] font-bold tabular-nums">{Math.round(shares[c.id] * 100)}%</span>
              </div>
              <input id={`w-${c.id}`} type="range" min={0} max={100} step={5} value={draft.weights[c.id]} aria-label={`${c.label} weight`} className="mt-1 w-full accent-[rgb(var(--ink))]"
                onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [c.id]: Number(e.target.value) } })} />
              <div className="text-[11.5px] text-muted">{c.help}</div>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {[{ l: 'Balanced', w: { safety: 34, capacity: 33, redundancy: 33 } }, { l: 'Safety first', w: { safety: 70, capacity: 15, redundancy: 15 } }, { l: 'Growth', w: { safety: 30, capacity: 50, redundancy: 20 } }, { l: 'Reliability', w: { safety: 30, capacity: 20, redundancy: 50 } }].map((p) => (
              <button key={p.l} type="button" onClick={() => setDraft({ ...draft, weights: p.w })} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:border-ink/40 hover:text-ink">{p.l}</button>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Capital available" subtitle="For the projects' cost to complete.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted">$</span>
            <CommitNum id="alloc-budget" ariaLabel="Capital available in millions" value={Math.round(draft.budget / 1e5) / 10} onCommit={(v) => setDraft({ ...draft, budget: Math.max(0, v) * 1e6 })} className="w-32" live />
            <span className="text-[13px] text-muted">million</span>
          </div>
          <input type="range" aria-label="Capital available" min={0} max={3000} step={10} value={Math.round(draft.budget / 1e6)} onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) * 1e6 })} className="w-full accent-[rgb(var(--ink))]" />
          <button type="button" className="self-start text-[12px] font-semibold text-link" onClick={() => setDraft({ ...draft, budget: auth.amount })}>Use authorized funding {auth.from}–{auth.to} ({bn(auth.amount)})</button>
          <label className="mt-1 flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={draft.lockCommitted} onChange={(e) => setDraft({ ...draft, lockCommitted: e.target.checked })} />
            <span>Fund committed projects first <span className="text-muted">(control budget in force, work under contract)</span></span>
          </label>
        </div>
      </Panel>
      <Panel title="How benefit is scored" subtitle="The amount of each measure worth 100 points. Points add up across projects.">
        <div className="flex flex-col gap-2">
          {CRITERIA.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span>100 pts of {c.label.toLowerCase()} =</span>
              <span className="flex items-center gap-1.5"><CommitNum ariaLabel={`${c.label} full-credit amount`} value={draft.fullCredit[c.id]} onCommit={(v) => setDraft({ ...draft, fullCredit: { ...draft.fullCredit, [c.id]: v } })} className="w-24" /><span className="w-[70px] text-muted">{c.unit}</span></span>
            </div>
          ))}
          <p className="text-[11.5px] text-muted">Benefit points = amount ÷ full-credit amount × 100 × weight. The optimizer checks every combination (an exact knapsack) and funds the set with the most points that fits the capital available.</p>
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="marker">Weights and scale — verify</Badge><span className="text-[11px] text-faint">Starting values are placeholders for the portfolio team.</span></div>
          <p className="text-[11.5px] text-muted">Engineering and system measures only. Community demographics and income are never inputs.</p>
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
        {' '}Where the curve flattens, more capital buys little more benefit.
      </p>
    </div>
  )
}

function Delivers({ r, s }: { r: AllocResult; s: AppState }) {
  const funded = r.rows.filter((x) => x.status === 'funded' || x.status === 'committed' || x.status === 'must')
  const tot = (f: 'safetyK' | 'capacityMmcfd' | 'redundancyCustomers') => funded.reduce((a, x) => a + (x.project.benefits?.[f] ?? 0), 0)
  const all = (f: 'safetyK' | 'capacityMmcfd' | 'redundancyCustomers') => r.rows.filter((x) => x.status !== 'excluded').reduce((a, x) => a + (x.project.benefits?.[f] ?? 0), 0)
  const line = (label: string, v: number, of: number, fmt: (n: number) => string) => (
    <div className="flex items-baseline justify-between gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0"><span className="text-muted">{label}</span><span><b className="tabular-nums">{fmt(v)}</b> <span className="text-faint">of {fmt(of)}</span></span></div>
  )
  const byProgram = s.programs.map((p) => ({ label: p.code, sub: p.name, value: funded.filter((x) => x.project.programId === p.id).reduce((a, x) => a + x.cost, 0) })).filter((x) => x.value > 0)
  return (
    <div className="flex flex-col gap-3">
      <HBarChart rows={CRITERIA.map((c) => ({ label: c.label, value: Math.round(r.byCriterion[c.id]), color: COLOR[c.id] }))} format={(n) => pts(n)} />
      <div>
        {line('Safety risk reduced', tot('safetyK'), all('safetyK'), (n) => `$${(n / 1000).toFixed(1)}M/yr`)}
        {line('Capacity added', tot('capacityMmcfd'), all('capacityMmcfd'), (n) => `${n.toLocaleString('en-US')} MMcfd`)}
        {line('Customers gaining a second feed', tot('redundancyCustomers'), all('redundancyCustomers'), (n) => n.toLocaleString('en-US'))}
      </div>
      <div><div className="eyebrow mb-1">Capital by program</div><HBarChart rows={byProgram} format={bn} /></div>
    </div>
  )
}

function ProjectTable({ r, s, meId, onDecide }: { r: AllocResult; s: AppState; meId: string; onDecide: (row: AllocRow, v: AllocationDecision) => void }) {
  const maxB = Math.max(...r.rows.map((x) => x.benefit), 1)
  const edit = (row: AllocRow, field: 'safetyK' | 'capacityMmcfd' | 'redundancyCustomers', v: number) => {
    const before = row.project.benefits?.[field] ?? 0
    if (before === v) return
    const c = CRITERIA.find((x) => x.field === field)!
    mutate((d) => { setBenefits(d, row.project.id, { [field]: v }, meId) }, { entity: 'project', entityId: row.project.id, action: 'update', summary: `${row.project.code} ${c.label.toLowerCase()} benefit ${before.toLocaleString('en-US')} → ${v.toLocaleString('en-US')} ${c.unit}` })
  }
  return (
    <div className="scroll-x">
      <table className="tbl min-w-[1080px]">
        <thead>
          <tr>
            <th>Project</th><th>Plan</th><th className="num">Cost to complete</th>
            {CRITERIA.map((c) => <th key={c.id} className="num" title={c.help}>{c.label}<div className="text-[10.5px] font-normal normal-case text-faint">{c.unit}</div></th>)}
            <th>Benefit</th><th className="num">Pts per $M</th><th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.project.id} className={cx(x.status === 'excluded' && 'opacity-60')}>
              <td className="min-w-[230px]">
                <a href={projectHref(x.project.code)} className="font-mono text-[12px] font-semibold text-link">{x.project.code}</a>
                <span className="ml-1.5 text-[11px] text-faint">{s.programs.find((p) => p.id === x.project.programId)?.code}</span>
                <div className="text-[12.5px]">{x.project.name}</div>
                {x.project.benefits?.basis && <div className="text-[11px] text-faint" title={x.project.benefits.basis}>{x.project.benefits.basis}</div>}
                {x.missing && <div className="text-[11px] text-warn">No benefit entered yet</div>}
              </td>
              <td>
                <Badge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Badge>
                {x.status === 'unfunded' && <div className="mt-0.5 text-[11px] text-muted">needs {bn(Math.max(0, x.cost - r.unused))} more</div>}
              </td>
              <td className="num">{bn(x.cost)}</td>
              {CRITERIA.map((c) => (
                <td key={c.id} className="num"><CommitNum ariaLabel={`${x.project.code} ${c.label}`} value={x.project.benefits?.[c.field] ?? 0} onCommit={(v) => edit(x, c.field, Math.max(0, v))} className="ml-auto w-[86px] py-0.5 text-[12.5px]" /></td>
              ))}
              <td className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex h-2.5 w-20 overflow-hidden rounded-sm bg-sunken" title={CRITERIA.map((c) => `${c.label} ${Math.round(x.parts[c.id])} pts`).join(' · ')}>
                    {CRITERIA.map((c) => <div key={c.id} style={{ width: `${(x.parts[c.id] / maxB) * 100}%`, background: COLOR[c.id] }} />)}
                  </div>
                  <span className="text-[12.5px] font-semibold tabular-nums">{Math.round(x.benefit)}</span>
                </div>
              </td>
              <td className="num font-semibold">{Number.isFinite(x.perM) ? x.perM.toFixed(1) : '—'}</td>
              <td>
                <Select aria-label={`${x.project.code} decision`} value={x.decision} onChange={(e) => onDecide(x, e.target.value as AllocationDecision)} className="min-w-[175px] py-0.5 text-[12.5px]"
                  options={(['auto', 'must', 'exclude'] as AllocationDecision[]).map((d) => ({ value: d, label: d === 'auto' && x.committed && x.locked ? 'Committed — funded' : DECISION_LABEL[d] }))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Number box that commits on blur or Enter (one audit entry per edit, not per keystroke). `live` also commits as you type. */
function CommitNum({ value, onCommit, className, ariaLabel, id, live }: { value: number; onCommit: (n: number) => void; className?: string; ariaLabel?: string; id?: string; live?: boolean }) {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')
  const [txt, setTxt] = useState(fmt(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(fmt(value)) }, [value, focus])
  const parse = (t: string) => { const n = Number(t.replace(/[$,\s]/g, '')); return t.trim() !== '' && Number.isFinite(n) ? n : null }
  const commit = () => { const n = parse(txt); if (n != null && n !== value) onCommit(n); else setTxt(fmt(value)) }
  return (
    <input id={id} aria-label={ariaLabel} inputMode="decimal" className={cx('inp text-right tabular-nums', className)} value={txt}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); commit() }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      onChange={(e) => { setTxt(e.target.value); if (live) { const n = parse(e.target.value); if (n != null) onCommit(n) } }} />
  )
}
