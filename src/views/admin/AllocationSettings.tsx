// Configuration → Capital allocation: the benefit measures projects are scored on (name, group, unit, 100-point
// amount, weight, on/off), the weighting presets, and the funding rules. One audited save.
import { useMemo, useState } from 'react'
import type { AllocationAttribute, AllocationCriterionDef, AllocationSettings, Project } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import {
  ATTRIBUTE_LABEL, DEFAULT_CRITERIA, DEFAULT_PRESETS, activeCriteria, allocationOf, annualLimits, authorizedFunding, dependencyLoop, isAllocCandidate, describeAllocationChange, optimize, validateAllocation, weightShares,
} from '@/core/engine/allocation'
import { Badge, Button, Callout, Input, Panel, Select, Stat } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { SaveBar, cellInp, useDraft } from '../estimating/admin/shared'
import { CommitNum, bn, measureColor, pts } from '../allocation/parts'

type Cfg = Omit<AllocationSettings, 'decisions'>
const ATTRS = Object.keys(ATTRIBUTE_LABEL) as AllocationAttribute[]
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export default function AllocationSettingsTab() {
  const s = useStore()
  const saved = allocationOf(s)
  const { decisions, ...current } = saved
  const D = useDraft<Cfg>(current)
  const d = D.draft
  const problems = validateAllocation(d)
  const shares = weightShares(d)
  const act = activeCriteria(d)
  const preview = useMemo(() => (problems.length ? null : optimize(s, { ...d, decisions })), [s, JSON.stringify(d)]) // eslint-disable-line react-hooks/exhaustive-deps
  const auth = authorizedFunding(s)
  const candidates = s.projects.filter(isAllocCandidate)
  const codeOf = (id: string) => s.projects.find((p) => p.id === id)?.code ?? id
  const nameOf = (id: string) => s.projects.find((p) => p.id === id)?.name ?? ''

  const setC = (i: number, patch: Partial<AllocationCriterionDef>) => D.set((x) => { x.criteria[i] = { ...x.criteria[i], ...patch }; return x })
  const addMeasure = () => D.set((x) => {
    let n = 1
    while (x.criteria.some((c) => c.id === `custom-${n}`)) n++
    x.criteria.push({ id: `custom-${n}`, label: 'New measure', unit: 'units/yr', help: '', attribute: 'other', fullCredit: 100, weight: 10, active: true })
    return x
  })
  const save = () => {
    if (problems.length) return
    const changes = describeAllocationChange(saved, { ...d, decisions })
    mutate((st) => { st.settings.allocation = { ...clone(d), decisions: { ...decisions } } }, { entity: 'capital-allocation', entityId: 'settings', action: 'update', summary: `Capital allocation settings: ${changes.join('; ') || 'no change'}` })
    D.commit()
    toast('Capital allocation settings saved')
  }

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="How capital allocation scores projects">
        Each project carries an amount for every measure below. Benefit points = amount ÷ the 100-point amount × 100 × the measure's share of the weights{d.useConfidence ? ' × the project\'s delivery confidence' : ''}.
        Points add across projects; the optimizer funds the combination with the most points that fits the capital available. The weights set here are the portfolio's saved weighting, and anyone can try a what-if on the <a className="font-semibold text-link" href="#allocation">Capital allocation</a> page.
      </Callout>

      <Panel pad={false} title={<span className="inline-flex items-center gap-2">Benefit measures <Badge tone="info">{act.length} on</Badge><Badge tone="marker">Values — verify</Badge></span>}
        subtitle="Group each measure under the consequence it reduces (safety, reliability, financial, environmental), so scoring lines up with the risk framework used in rate filings. Engineering, system and financial measures only: community demographics and income are rejected."
        actions={<div className="flex gap-2"><Button size="sm" onClick={addMeasure} disabled={d.criteria.length >= 10}>+ Add measure</Button><Button size="sm" variant="ghost" onClick={() => D.set((x) => ({ ...x, criteria: clone(DEFAULT_CRITERIA) }))}>Restore defaults</Button></div>}>
        <div className="scroll-x">
          <table className="tbl min-w-[1050px]">
            <thead><tr><th style={{ width: 44 }}>On</th><th style={{ minWidth: 260 }}>Measure</th><th>Group</th><th>Unit</th><th className="num">100 points =</th><th className="num">Weight</th><th className="num">Share</th><th style={{ width: 30 }} /></tr></thead>
            <tbody>
              {d.criteria.map((c, i) => (
                <tr key={c.id} className={c.active ? '' : 'opacity-60'}>
                  <td className="align-top"><input type="checkbox" aria-label={`${c.label} on`} className="mt-1.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={c.active} onChange={(e) => setC(i, { active: e.target.checked })} /></td>
                  <td className="align-top">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: measureColor(d, c.id) }} /><Input aria-label="Measure name" className={cellInp} value={c.label} onChange={(e) => setC(i, { label: e.target.value })} /></div>
                      <Input aria-label={`${c.label} description`} className={cellInp} placeholder="What it measures and where the number comes from" value={c.help} onChange={(e) => setC(i, { help: e.target.value })} />
                      <span className="font-mono text-[10.5px] text-faint">key: {c.id}</span>
                    </div>
                  </td>
                  <td className="align-top"><Select aria-label={`${c.label} group`} className={cellInp} value={c.attribute} onChange={(e) => setC(i, { attribute: e.target.value as AllocationAttribute })} options={ATTRS.map((a) => ({ value: a, label: ATTRIBUTE_LABEL[a] }))} /></td>
                  <td className="align-top"><Input aria-label={`${c.label} unit`} className={`${cellInp} w-28`} value={c.unit} onChange={(e) => setC(i, { unit: e.target.value })} /></td>
                  <td className="num align-top"><CommitNum ariaLabel={`${c.label} 100-point amount`} className={`${cellInp} ml-auto w-28`} value={c.fullCredit} onCommit={(v) => setC(i, { fullCredit: v })} /></td>
                  <td className="num align-top"><CommitNum ariaLabel={`${c.label} weight`} className={`${cellInp} ml-auto w-20`} value={c.weight} onCommit={(v) => setC(i, { weight: v })} /></td>
                  <td className="num align-top pt-2.5 font-semibold">{c.active ? `${Math.round((shares[c.id] ?? 0) * 100)}%` : '—'}</td>
                  <td className="align-top"><button className="mt-1 text-muted hover:text-bad" aria-label={`Remove ${c.label}`} onClick={() => D.set((x) => ({ ...x, criteria: x.criteria.filter((_, k) => k !== i) }))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
          Switching a measure off keeps every project's amounts, so it can be switched back on. Removing it hides the amounts; restoring the same key brings them back.
        </div>
      </Panel>

      <Panel pad={false} title="Weighting presets" subtitle="One-click weightings on the Capital allocation page. Weights are relative; each preset is normalized to 100% across the measures that are on."
        actions={<div className="flex gap-2"><Button size="sm" onClick={() => D.set((x) => { let n = x.presets.length + 1; while (x.presets.some((q) => q.id === `preset-${n}`)) n++; x.presets.push({ id: `preset-${n}`, name: 'New preset', weights: Object.fromEntries(x.criteria.map((c) => [c.id, c.weight])) }); return x })}>+ Add preset from current weights</Button><Button size="sm" variant="ghost" onClick={() => D.set((x) => ({ ...x, presets: clone(DEFAULT_PRESETS) }))}>Restore defaults</Button></div>}>
        <div className="scroll-x">
          <table className="tbl" style={{ minWidth: 260 + act.length * 110 }}>
            <thead><tr><th style={{ minWidth: 180 }}>Preset</th>{act.map((c) => <th key={c.id} className="num">{c.label}</th>)}<th style={{ width: 30 }} /></tr></thead>
            <tbody>
              {d.presets.map((p, i) => {
                const tot = act.reduce((a, c) => a + Math.max(0, p.weights[c.id] ?? 0), 0)
                return (
                  <tr key={p.id}>
                    <td><Input aria-label="Preset name" className={cellInp} value={p.name} onChange={(e) => D.set((x) => { x.presets[i].name = e.target.value; return x })} /></td>
                    {act.map((c) => (
                      <td key={c.id} className="num">
                        <div className="flex items-center justify-end gap-1.5">
                          <CommitNum ariaLabel={`${p.name} ${c.label} weight`} className={`${cellInp} w-16`} value={p.weights[c.id] ?? 0} onCommit={(v) => D.set((x) => { x.presets[i].weights[c.id] = Math.max(0, v); return x })} />
                          <span className="w-9 text-[11px] text-faint">{tot ? Math.round(((p.weights[c.id] ?? 0) / tot) * 100) : 0}%</span>
                        </div>
                      </td>
                    ))}
                    <td><button className="text-muted hover:text-bad" aria-label={`Remove ${p.name}`} onClick={() => D.set((x) => ({ ...x, presets: x.presets.filter((_, k) => k !== i) }))}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel title="Funding rules">
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Capital available</span><span className="text-muted">$</span>
              <CommitNum ariaLabel="Capital available in millions" className="w-32" value={Math.round(d.budget / 1e5) / 10} onCommit={(v) => D.set((x) => ({ ...x, budget: Math.max(0, v) * 1e6 }))} />
              <span className="text-muted">million</span>
              <button type="button" className="text-[12px] font-semibold text-link" onClick={() => D.set((x) => ({ ...x, budget: auth.amount }))}>Use authorized funding {auth.from}–{auth.to} ({bn(auth.amount)})</button>
            </div>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={d.lockCommitted} onChange={(e) => D.set((x) => ({ ...x, lockCommitted: e.target.checked }))} /><span>Fund committed projects first <span className="text-muted">— a control budget is in force and work is under contract, so stopping it costs more than it saves.</span></span></label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={d.useConfidence} onChange={(e) => D.set((x) => ({ ...x, useConfidence: e.target.checked }))} /><span>Risk-adjust benefit by delivery confidence <span className="text-muted">— each project's points × the chance its scope, permits and schedule hold, so early-stage promises don't outrank work that is ready to build.</span></span></label>
            <div className="flex flex-wrap items-start gap-2">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={d.timing.on} onChange={(e) => D.set((x) => ({ ...x, timing: { ...x.timing, on: e.target.checked } }))} /><span>Count benefit from its in-service year, discounted at</span></label>
              <span className="flex items-center gap-1"><CommitNum ariaLabel="Discount rate percent a year" className="w-14 py-0.5" value={d.timing.discountPct} disabled={!d.timing.on} onCommit={(v) => D.set((x) => ({ ...x, timing: { ...x.timing, discountPct: Math.min(20, Math.max(0, v)) } }))} /><span>% a year</span></span>
              <span className="basis-full pl-6 text-muted">A benefit that starts in four years is worth less than one that starts next year. <Badge tone="marker">Rate — verify with finance</Badge></span>
            </div>
            <div className="border-t border-line pt-3">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={d.annual.on} onChange={(e) => D.set((x) => ({ ...x, annual: { ...x.annual, on: e.target.checked } }))} /><span className="font-semibold">Limit spend year by year <span className="font-normal text-muted">instead of one total, the way rate-case funding is authorized</span></span></label>
              <div className={d.annual.on ? 'mt-2 pl-6' : 'mt-2 pl-6 opacity-50'}>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-faint"><th className="py-1">Year</th><th className="py-1">Limit</th><th className="py-1">Basis</th></tr></thead>
                  <tbody>
                    {(preview?.yearly ?? []).map((y) => {
                      const lim = annualLimits(s, d, [y.year])[y.year]
                      return (
                        <tr key={y.year} className="border-t border-line">
                          <td className="py-1 font-semibold">{y.year}</td>
                          <td className="py-1"><span className="flex items-center gap-1">$<CommitNum ariaLabel={`${y.year} limit in millions`} className="w-24 py-0.5" value={Math.round(lim.amount / 1e5) / 10} onCommit={(v) => D.set((x) => ({ ...x, annual: { ...x.annual, limits: { ...x.annual.limits, [y.year]: Math.max(0, v) * 1e6 } } }))} />M</span></td>
                          <td className="py-1 text-[11.5px] text-muted">{lim.custom ? <>Set by the portfolio team · <button type="button" className="text-link" onClick={() => D.set((x) => { const { [y.year]: _, ...rest } = x.annual.limits; return { ...x, annual: { ...x.annual, limits: rest } } })}>reset</button></> : lim.basis}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <label className="mt-2 flex items-center gap-2">Projects may start up to
                  <Select aria-label="Most years a project may start later" className="w-16 py-0.5" value={String(d.annual.maxDeferYears)} onChange={(e) => D.set((x) => ({ ...x, annual: { ...x.annual, maxDeferYears: Number(e.target.value) } }))} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} />
                  years later to fit a year's limit (their spend and benefit move with them).
                </label>
              </div>
            </div>
          </div>
        </Panel>
        <Panel title="Preview with these settings" subtitle="Before saving: what the optimizer funds with the decisions already made on the Capital allocation page.">
          {preview ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Projects funded" value={`${preview.funded} of ${preview.eligible}`} />
              <Stat label="Benefit funded" value={pts(preview.benefit)} sub={`${preview.maxBenefit ? Math.round((preview.benefit / preview.maxBenefit) * 100) : 0}% of the list`} />
              <Stat label="Capital allocated" value={bn(preview.spend)} sub={`of ${bn(preview.budget)}`} />
              <Stat label="Vs rank order" value={`+${Math.round(preview.benefit - preview.greedyBenefit)} pts`} tone={preview.benefit - preview.greedyBenefit >= 0.5 ? 'good' : undefined} />
              <div className="col-span-2 text-[12px] text-muted md:col-span-4">Not funded: {preview.rows.filter((x) => x.status === 'unfunded').map((x) => x.project.code).join(', ') || 'none'}</div>
            </div>
          ) : <div className="text-[12.5px] text-muted">Fix the problems below to see a preview.</div>}
        </Panel>
      </div>

      <Panel pad={false} title="Prerequisites" subtitle="A project that only delivers its benefit once another is done. The optimizer never funds it without its prerequisite, and never starts it earlier than the prerequisite. Also editable in the Needs column on the Capital allocation page.">
        <div className="scroll-x">
          <table className="tbl min-w-[760px]">
            <thead><tr><th>Project</th><th>Needs</th><th>Why</th><th style={{ width: 30 }} /></tr></thead>
            <tbody>
              {d.dependencies.map((dep, i) => (
                <tr key={`${dep.projectId}-${dep.requiresId}`}>
                  <td className="text-[12.5px]"><b className="font-mono text-[12px]">{codeOf(dep.projectId)}</b> <span className="text-muted">{nameOf(dep.projectId)}</span></td>
                  <td className="text-[12.5px]"><b className="font-mono text-[12px]">{codeOf(dep.requiresId)}</b> <span className="text-muted">{nameOf(dep.requiresId)}</span></td>
                  <td><Input aria-label="Why" className={cellInp} value={dep.note ?? ''} placeholder="e.g. ties into the new regulator station" onChange={(e) => D.set((x) => { x.dependencies[i] = { ...x.dependencies[i], note: e.target.value }; return x })} /></td>
                  <td><button className="text-muted hover:text-bad" aria-label={`Remove ${codeOf(dep.projectId)} needs ${codeOf(dep.requiresId)}`} onClick={() => D.set((x) => ({ ...x, dependencies: x.dependencies.filter((_, k) => k !== i) }))}>✕</button></td>
                </tr>
              ))}
              {!d.dependencies.length && <tr><td colSpan={4} className="text-[12.5px] text-muted">No prerequisites yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <AddDependency projects={candidates} onAdd={(projectId, requiresId) => {
          if (dependencyLoop(d.dependencies, projectId, requiresId)) { toast('That would make a loop: the other project already needs this one'); return }
          if (d.dependencies.some((x) => x.projectId === projectId && x.requiresId === requiresId)) return
          D.set((x) => ({ ...x, dependencies: [...x.dependencies, { projectId, requiresId }] }))
        }} />
      </Panel>

      {problems.length > 0 && <Callout tone="bad" title="Fix before saving"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Callout>}
      <div className="sticky bottom-0 z-10 overflow-hidden rounded-md border border-line bg-surface empty:hidden">
        <SaveBar dirty={D.dirty} onSave={save} onDiscard={D.reset} disabled={problems.length > 0} note="Saving changes how every project is scored for everyone, and is written to the audit log." />
      </div>
    </div>
  )
}

function AddDependency({ projects, onAdd }: { projects: Project[]; onAdd: (projectId: string, requiresId: string) => void }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const opts = [{ value: '', label: 'Choose a project' }, ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px]">
      <Select aria-label="Project" className="max-w-[300px] py-1" value={a} onChange={(e) => setA(e.target.value)} options={opts} />
      <span className="text-muted">needs</span>
      <Select aria-label="Prerequisite" className="max-w-[300px] py-1" value={b} onChange={(e) => setB(e.target.value)} options={opts} />
      <Button size="sm" disabled={!a || !b || a === b} onClick={() => { onAdd(a, b); setA(''); setB('') }}>Add prerequisite</Button>
    </div>
  )
}
