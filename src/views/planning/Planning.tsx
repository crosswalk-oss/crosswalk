// Portfolio planning (V2): rank projects by risk reduced per dollar, fit them into authorized
// funding with deferral/exclusion scenarios, and check construction capacity by district.
import { useEffect, useMemo, useState } from 'react'
import type { Driver } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { saveFile, toCSV } from '@/core/download'
import { cx, fmtDate, money, moneyDelta, sum } from '@/core/util'
import { BarChart } from '@/ui/charts'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Panel, PageHeader, SegButtons, Select, Stat, Tabs } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { lsGet, lsSet } from '../admin/common'
import { DEFAULT_WEIGHTS, capacity, candidates, fit, itemOf, newScenario, rank, shifted, suggestFit, type Ranked, type Scenario } from './model'

const LS = 'crosswalk:planning:scenarios:v1'
const YEARS_AHEAD = 5

export default function Planning(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const asOfYear = Number(s.settings.asOf.slice(0, 4))
  const years = useMemo(() => Array.from({ length: YEARS_AHEAD }, (_, i) => asOfYear + i), [asOfYear])

  const [scenarios, setScenarios] = useState<Scenario[]>(() => lsGet<Scenario[]>(LS, []))
  const [activeId, setActiveId] = useState<string>(() => lsGet<Scenario[]>(LS, [])[0]?.id ?? '')
  const [compareId, setCompareId] = useState<string>('')
  const [program, setProgram] = useState('')
  const [view, setView] = useState<'rank' | 'fund' | 'capacity' | 'compare'>('rank')

  // First visit: seed "as budgeted" and a suggested fit so compare works immediately.
  useEffect(() => {
    if (scenarios.length) return
    const base = newScenario('Current plan (as budgeted)', s.settings.asOf)
    const cs = candidates(s, base.basis)
    const sug = suggestFit(s, cs, { ...newScenario('Fit to authorization', s.settings.asOf, base) }, years)
    const fitSc = { ...sug.scenario, name: 'Fit to authorization (suggested)' }
    setScenarios([base, fitSc]); setActiveId(base.id); setCompareId(fitSc.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (scenarios.length) lsSet(LS, scenarios) }, [scenarios])

  const sc = scenarios.find((x) => x.id === activeId) ?? scenarios[0]
  const cs = useMemo(() => (sc ? candidates(s, sc.basis) : []), [s, sc?.basis])
  const ranked = useMemo(() => (sc ? rank(cs, sc) : []), [cs, sc])
  const f = useMemo(() => (sc ? fit(s, cs, sc, years) : null), [s, cs, sc, years])
  if (!sc || !f) return <PageHeader title="Portfolio planning" subtitle="Preparing scenarios…" />

  const update = (fn: (x: Scenario) => Scenario) => setScenarios((all) => all.map((x) => (x.id === sc.id ? fn(x) : x)))
  const setItem = (pid: string, patch: Partial<{ include: boolean; defer: number; mandatory: boolean }>) => update((x) => ({ ...x, items: { ...x.items, [pid]: { ...itemOf(x, pid), ...patch } } }))
  const audit = (action: string, summary: string) => mutate(() => {}, { entity: 'planning-scenario', entityId: sc.id, action, summary })

  const saveAs = () => {
    const n = newScenario(`${sc.name.replace(/ \(copy.*\)$/, '')} (copy ${scenarios.length + 1})`, s.settings.asOf, sc)
    setScenarios([...scenarios, n]); setCompareId(sc.id); setActiveId(n.id)
    audit('create', `Saved planning scenario "${n.name}" from "${sc.name}"`)
    toast('Scenario saved as a copy')
  }
  const remove = () => {
    const rest = scenarios.filter((x) => x.id !== sc.id)
    const fallback = rest.length ? rest : [newScenario('Current plan (as budgeted)', s.settings.asOf)]
    setScenarios(fallback); setActiveId(fallback[0].id); if (compareId === sc.id) setCompareId('')
    audit('delete', `Deleted planning scenario "${sc.name}"`)
    toast('Scenario deleted')
  }
  const suggest = () => {
    const r = suggestFit(s, cs, sc, years)
    update(() => ({ ...r.scenario, id: sc.id, name: sc.name }))
    audit('update', `Suggested fit on "${sc.name}": ${r.moves.length} deferral${r.moves.length === 1 ? '' : 's'}${r.moves.length ? ' — ' + r.moves.slice(0, 4).join('; ') : ''}`)
    toast(r.moves.length ? `${r.moves.length} deferral${r.moves.length === 1 ? '' : 's'} suggested` : 'Already within authorization where flexible projects allow', r.moves.length ? 'good' : 'info')
  }
  const clearAll = () => { update((x) => ({ ...x, items: {} })); toast('Scenario reset to the budgeted plan', 'info') }
  const exportCsv = async () => {
    const rows = ranked.map((r) => {
      const it = itemOf(sc, r.project.id)
      const sh = shifted(r.byYear, it.include ? it.defer : 0, asOfYear)
      return {
        scenario: sc.name, rank: r.rank, project: r.project.code, name: r.project.name, program: s.programs.find((p) => p.id === r.project.programId)?.code, stage: r.stageName,
        driver: r.project.driver, mandatory: r.mandatory ? 'Y' : 'N', committed: r.committed ? 'Y' : 'N', cost_basis: r.costBasis, remaining_spend: Math.round(r.remaining),
        inherent_risk: r.inherent, residual_risk: r.residual, risk_reduced: r.riskReduced, risk_per_$M: Math.round(r.perMillion), weight: r.weight.toFixed(2), score: r.score,
        included: it.include ? 'Y' : 'N', defer_years: it.defer,
        ...Object.fromEntries(years.map((y) => [`plan_${y}`, it.include ? Math.round(sh[String(y)] ?? 0) : 0])),
      }
    })
    const r = await saveFile(`planning-${sc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.settings.asOf}.csv`, toCSV(rows), 'text/csv')
    if (r === 'saved') { audit('export', `Exported planning scenario "${sc.name}" (${rows.length} projects)`); toast('Scenario CSV saved') } else toast('Download not available here', 'info')
  }

  const progIds = program ? [program] : s.programs.map((p) => p.id)
  const series = years.map((y) => ({ y, a: sum(progIds.map((pid) => f.byProgram[pid]?.[y]?.authorized ?? 0)), p: sum(progIds.map((pid) => f.byProgram[pid]?.[y]?.planned ?? 0)) }))
  const nextYr = series[1] ?? series[0]
  const mandatoryUnfunded = ranked.filter((r) => r.mandatory && !itemOf(sc, r.project.id).include)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Controls · V2" title="Portfolio planning"
        subtitle="Rank active and proposed projects by risk reduced per dollar, then fit the portfolio into authorized funding by program and year. Scenarios are working drafts: they do not change any project, budget or baseline."
        actions={<><Button onClick={exportCsv}>Export scenario CSV</Button><Button variant="marker" onClick={suggest}>Suggest fit to funding</Button></>} />

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface px-3 py-2.5">
        <Field label="Scenario" className="w-64"><Select value={sc.id} onChange={(e) => setActiveId(e.target.value)} options={scenarios.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        <Field label="Name" className="min-w-[200px] flex-1"><Input value={sc.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Cost basis"><SegButtons options={[{ id: 'budget', label: 'Budget' }, { id: 'eac', label: 'Forecast (EAC)' }]} value={sc.basis} onChange={(b) => update((x) => ({ ...x, basis: b }))} /></Field>
        <div className="flex flex-wrap gap-2 pb-0.5">
          <Button size="sm" onClick={saveAs}>Save as copy</Button>
          <Button size="sm" variant="ghost" onClick={clearAll}>Reset choices</Button>
          <ConfirmButton size="sm" variant="ghost" confirmLabel="Delete scenario" onConfirm={remove}>Delete</ConfirmButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Projects in plan" value={`${ranked.length - f.excluded}/${ranked.length}`} sub={`${f.deferred} deferred · ${f.excluded} excluded · ${ranked.filter((r) => r.proposed).length} proposed`} />
        <Stat label={`${nextYr.y} planned vs authorized`} value={moneyDelta(nextYr.p - nextYr.a)} tone={nextYr.p > nextYr.a ? 'bad' : 'good'} sub={`${money(nextYr.p)} planned · ${money(nextYr.a)} authorized${program ? '' : ' (all programs)'}`} />
        <Stat label={`Over authorization ${asOfYear}–${years[years.length - 1]}`} value={money(f.overAmount)} tone={f.overAmount > 0 ? 'bad' : 'good'} sub={`${f.overYears} program-year${f.overYears === 1 ? '' : 's'} over`} />
        <Stat label="Risk reduced (funded)" value={money(f.riskFunded)} sub={`of ${money(sum(ranked.map((r) => r.riskReduced)))} available · expected-cost basis`} />
      </div>

      {mandatoryUnfunded.length > 0 && <Callout tone="bad" title="Mandatory work excluded">{mandatoryUnfunded.map((r) => r.project.code).join(', ')} {mandatoryUnfunded.length === 1 ? 'is' : 'are'} flagged safety/compliance mandatory but excluded from this scenario. Excluding mandatory work needs a regulatory deferral basis.</Callout>}

      <Tabs value={view} onChange={setView} tabs={[{ id: 'rank', label: 'Ranking & choices', count: ranked.length }, { id: 'fund', label: 'Fit to funding' }, { id: 'capacity', label: 'Construction capacity' }, { id: 'compare', label: 'Compare scenarios', count: scenarios.length }]} />

      {view === 'rank' && <RankTable ranked={ranked} sc={sc} setItem={setItem} years={years} asOfYear={asOfYear} weights={<Weights sc={sc} update={update} />} />}
      {view === 'fund' && (
        <div className="flex flex-col gap-4">
          <Panel title="Authorized vs planned by year" subtitle={`${program ? s.programs.find((p) => p.id === program)?.name : 'All programs'} · ${sc.basis === 'eac' ? 'forecast' : 'budget'} basis with this scenario's deferrals and exclusions`}
            actions={<Select className="h-7 w-56 py-0.5" value={program} onChange={(e) => setProgram(e.target.value)} options={[{ value: '', label: 'All programs' }, ...s.programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />}>
            <BarChart labels={series.map((x) => String(x.y))} series={[{ name: 'Authorized', values: series.map((x) => x.a), color: 'rgb(var(--muted))' }, { name: 'Planned (scenario)', values: series.map((x) => x.p), color: 'rgb(var(--link))' }]} height={240} />
          </Panel>
          <FundingTable f={f} years={years} asOfYear={asOfYear} onPick={setProgram} selected={program} />
        </div>
      )}
      {view === 'capacity' && <Capacity cs={cs} sc={sc} years={years} asOfYear={asOfYear} update={update} />}
      {view === 'compare' && <Compare scenarios={scenarios} a={sc} bId={compareId} setB={setCompareId} years={years} />}
    </div>
  )
}

function RankTable({ ranked, sc, setItem, years, asOfYear, weights }: { ranked: Ranked[]; sc: Scenario; setItem: (pid: string, p: Partial<{ include: boolean; defer: number; mandatory: boolean }>) => void; years: number[]; asOfYear: number; weights: React.ReactNode }) {
  const [filter, setFilter] = useState<'all' | 'flex' | 'mandatory' | 'proposed'>('all')
  const rows = ranked.filter((r) => filter === 'all' || (filter === 'flex' ? !r.mandatory && !r.committed : filter === 'mandatory' ? r.mandatory : r.proposed))
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel title="Benefit-cost ranking" subtitle="Score = risk $ reduced (inherent − residual expected cost of active threats) per $M of remaining spend × driver and consequence weights; best = 100. Mandatory work ranks first." pad={false}
        actions={<SegButtons options={[{ id: 'all', label: 'All' }, { id: 'flex', label: 'Flexible' }, { id: 'mandatory', label: 'Mandatory' }, { id: 'proposed', label: 'Proposed' }]} value={filter} onChange={setFilter} />}>
        <div className="scroll-x" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <table className="tbl">
            <thead><tr><th className="num">#</th><th>Project</th><th>Stage</th><th className="num">Remaining</th><th className="num">Risk reduced</th><th className="num">Per $M</th><th style={{ width: 130 }}>Score</th><th>Mandatory</th><th>Include</th><th>Defer</th>{years.slice(1, 4).map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const it = itemOf(sc, r.project.id)
                const sh = shifted(r.byYear, it.defer, asOfYear)
                return (
                  <tr key={r.project.id} className={cx(!it.include && 'opacity-50')}>
                    <td className="num text-faint">{r.rank}</td>
                    <td className="min-w-[220px]">
                      <div className="flex items-center gap-1.5"><ProgramTag programId={r.project.programId} /><a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(r.project.id)}>{r.project.code}</a>{r.committed && <Badge tone="info" title="Control budget in force">Committed</Badge>}{r.proposed && <Badge>Proposed</Badge>}</div>
                      <div className="truncate text-[12px]" title={r.project.name}>{r.project.name}</div>
                      <div className="text-[11px] text-faint">{r.project.driver}{r.project.location.hca ? ' · HCA' : ''}{r.project.location.dac ? ' · DAC' : ''} · {r.project.location.district}</div>
                    </td>
                    <td className="text-[12px]">{r.stageName}<div className="text-[11px] text-faint">{r.costBasis}</div></td>
                    <td className="num">{money(r.remaining)}</td>
                    <td className="num" title={`Inherent ${money(r.inherent)} → residual ${money(r.residual)}`}>{money(r.riskReduced)}</td>
                    <td className="num text-muted">{money(r.perMillion)}</td>
                    <td><div className="flex items-center gap-2"><span className="h-2 flex-1 rounded-sm bg-sunken"><span className={cx('block h-2 rounded-sm', r.mandatory ? 'bg-ink' : 'bg-link')} style={{ width: `${r.score}%` }} /></span><span className="w-9 text-right text-[12px] tabular-nums">{r.score.toFixed(0)}</span></div></td>
                    <td><input type="checkbox" aria-label="Mandatory" className="h-4 w-4" checked={r.mandatory} onChange={(e) => setItem(r.project.id, { mandatory: e.target.checked })} /></td>
                    <td><input type="checkbox" aria-label="Include" className="h-4 w-4" checked={it.include} onChange={(e) => setItem(r.project.id, { include: e.target.checked })} /></td>
                    <td><select aria-label="Defer years" className="inp h-7 w-[72px] py-0.5" value={it.defer} disabled={!it.include} onChange={(e) => setItem(r.project.id, { defer: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `+${n} yr` : 'None'}</option>)}</select>{it.defer > 0 && r.committed && <div className="text-[10px] text-warn">Under contract</div>}</td>
                    {years.slice(1, 4).map((y) => <td key={y} className="num text-[12px] text-muted">{it.include && sh[String(y)] ? money(sh[String(y)]) : '—'}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {weights}
    </div>
  )
}

function Weights({ sc, update }: { sc: Scenario; update: (fn: (x: Scenario) => Scenario) => void }) {
  const drivers = Object.keys(DEFAULT_WEIGHTS.driver) as Driver[]
  const set = (patch: Partial<Scenario['weights']>) => update((x) => ({ ...x, weights: { ...x.weights, ...patch } }))
  return (
    <Panel title="Scoring weights" subtitle="Multipliers on risk reduced per $M">
      <div className="flex flex-col gap-2">
        {drivers.map((d) => (
          <label key={d} className="grid grid-cols-[1fr_72px] items-center gap-2 text-[12px]"><span>{d}</span><Input className="h-7 py-0.5 text-right tabular-nums" type="number" step="0.1" min={0} value={sc.weights.driver[d]} onChange={(e) => set({ driver: { ...sc.weights.driver, [d]: Number(e.target.value) } })} /></label>
        ))}
        <div className="my-1 border-t border-line" />
        <label className="grid grid-cols-[1fr_72px] items-center gap-2 text-[12px]"><span>High-consequence area</span><Input className="h-7 py-0.5 text-right tabular-nums" type="number" step="0.05" value={sc.weights.hca} onChange={(e) => set({ hca: Number(e.target.value) })} /></label>
        <label className="grid grid-cols-[1fr_72px] items-center gap-2 text-[12px]"><span>Disadvantaged community</span><Input className="h-7 py-0.5 text-right tabular-nums" type="number" step="0.05" value={sc.weights.dac} onChange={(e) => set({ dac: Number(e.target.value) })} /></label>
        <Button size="sm" variant="ghost" onClick={() => set(JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)))}>Restore defaults</Button>
        <p className="text-[11px] text-faint">Safety/compliance work is marked mandatory by default. Uncheck mandatory on a project to let the fit defer it.</p>
      </div>
    </Panel>
  )
}

function FundingTable({ f, years, asOfYear, onPick, selected }: { f: ReturnType<typeof fit>; years: number[]; asOfYear: number; onPick: (pid: string) => void; selected: string }) {
  const programs = useStore((s) => s.programs)
  return (
    <Panel title="Over / under authorization by program" subtitle="Planned minus authorized. Click a program to chart it." pad={false}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Program</th>{years.map((y) => <th key={y} className="num">{y}</th>)}<th className="num">Net {years[0]}–{years[years.length - 1]}</th></tr></thead>
          <tbody>
            {programs.map((p) => {
              const net = sum(years.map((y) => f.byProgram[p.id][y].planned - f.byProgram[p.id][y].authorized))
              return (
                <tr key={p.id} className={cx('clickable', selected === p.id && 'bg-marker/10')} onClick={() => onPick(selected === p.id ? '' : p.id)}>
                  <td className="whitespace-nowrap"><ProgramTag programId={p.id} /> <span className="text-[12px] text-muted">{p.name}</span></td>
                  {years.map((y) => {
                    const c = f.byProgram[p.id][y]
                    const d = c.planned - c.authorized
                    return <td key={y} className="num"><span className={cx('font-semibold', d > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(d)}</span><div className="text-[11px] text-faint">{money(c.planned)} / {money(c.authorized)}</div></td>
                  })}
                  <td className={cx('num font-semibold', net > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(net)}</td>
                </tr>
              )
            })}
            <tr>
              <td className="font-semibold">Portfolio</td>
              {years.map((y) => { const d = f.total[y].planned - f.total[y].authorized; return <td key={y} className="num"><b className={d > 0 ? 'text-bad' : 'text-good'}>{moneyDelta(d)}</b><div className="text-[11px] text-faint">{money(f.total[y].planned)} / {money(f.total[y].authorized)}</div></td> })}
              <td className="num font-semibold">{moneyDelta(sum(years.map((y) => f.total[y].planned - f.total[y].authorized)))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-2 text-[12px] text-muted">Authorized envelopes come from Configuration → Programs & funding. {asOfYear} spend is largely committed; deferral moves only spend after {asOfYear}.</div>
    </Panel>
  )
}

function Capacity({ cs, sc, years, asOfYear, update }: { cs: ReturnType<typeof candidates>; sc: Scenario; years: number[]; asOfYear: number; update: (fn: (x: Scenario) => Scenario) => void }) {
  const cap = useMemo(() => capacity(cs, sc, years, asOfYear), [cs, sc, years, asOfYear])
  const over = cap.districts.flatMap((d) => years.filter((y) => cap.grid[d][y].length > sc.capacityLimit).map((y) => `${d} ${y}`))
  return (
    <Panel title="Projects in construction by district and year" subtitle="Construction window = construction start (or authorization) through in service, shifted by this scenario's deferrals"
      actions={<label className="flex items-center gap-2 text-[12px] text-muted">Crew capacity per district <Input className="h-7 w-16 py-0.5 text-right" type="number" min={1} value={sc.capacityLimit} onChange={(e) => update((x) => ({ ...x, capacityLimit: Math.max(1, Number(e.target.value)) }))} /></label>}>
      {over.length > 0 && <div className="mb-3"><Callout tone="warn" title="Over crew capacity">{over.join(', ')}. Consider deferring a flexible project or adding a second contractor.</Callout></div>}
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>District</th>{years.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
          <tbody>
            {cap.districts.map((d) => (
              <tr key={d}>
                <td className="font-semibold">{d}</td>
                {years.map((y) => {
                  const list = cap.grid[d][y]
                  const n = list.length
                  const tone = n > sc.capacityLimit ? 'bg-bad/15 text-bad' : n === sc.capacityLimit ? 'bg-warn/15 text-warn' : n ? 'bg-good/10 text-ink' : 'text-faint'
                  return (
                    <td key={y} className="num align-top">
                      <span className={cx('inline-block min-w-[2rem] rounded px-1.5 text-center font-display text-[16px] font-bold', tone)}>{n}</span>
                      <div className="mt-0.5 flex flex-wrap justify-end gap-x-1 text-[10.5px]">{list.map((c) => <a key={c} className="font-mono text-link hover:underline" href={projectHref(c)}>{c.slice(4)}</a>)}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Compare({ scenarios, a, bId, setB, years }: { scenarios: Scenario[]; a: Scenario; bId: string; setB: (id: string) => void; years: number[] }) {
  const s = useStore()
  const b = scenarios.find((x) => x.id === bId && x.id !== a.id) ?? scenarios.find((x) => x.id !== a.id)
  const calc = (x: Scenario) => { const cs = candidates(s, x.basis); return { cs, f: fit(s, cs, x, years), r: rank(cs, x) } }
  const A = useMemo(() => calc(a), [s, a, years])
  const B = useMemo(() => (b ? calc(b) : null), [s, b, years])
  if (!b || !B) return <Panel title="Compare scenarios"><p className="text-[13px] text-muted">Save a copy of this scenario, change it, then compare the two here.</p></Panel>
  const diffs = A.r.map((r) => ({ r, ia: itemOf(a, r.project.id), ib: itemOf(b, r.project.id) })).filter((x) => x.ia.include !== x.ib.include || x.ia.defer !== x.ib.defer)
  const metric = (label: string, va: number, vb: number, fmt = money, lowerBetter = true) => {
    const d = vb - va
    return <tr><td>{label}</td><td className="num">{fmt(va)}</td><td className="num">{fmt(vb)}</td><td className={cx('num font-semibold', d === 0 ? 'text-faint' : (d < 0) === lowerBetter ? 'text-good' : 'text-bad')}>{d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)}</td></tr>
  }
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Compare scenarios" subtitle="A is the scenario selected above" actions={<Select className="h-7 w-72 py-0.5" value={b.id} onChange={(e) => setB(e.target.value)} options={scenarios.filter((x) => x.id !== a.id).map((x) => ({ value: x.id, label: `B: ${x.name}` }))} />} pad={false}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Measure</th><th className="num">A · {a.name}</th><th className="num">B · {b.name}</th><th className="num">B − A</th></tr></thead>
            <tbody>
              {metric(`Over authorization ${years[0]}–${years[years.length - 1]}`, A.f.overAmount, B.f.overAmount)}
              {metric('Program-years over', A.f.overYears, B.f.overYears, (n) => String(n))}
              {metric('Risk reduced (funded)', A.f.riskFunded, B.f.riskFunded, money, false)}
              {metric('Projects deferred', A.f.deferred, B.f.deferred, (n) => String(n))}
              {metric('Projects excluded', A.f.excluded, B.f.excluded, (n) => String(n))}
              {years.map((y) => <tr key={y}><td className="text-muted">Planned {y} (authorized {money(A.f.total[y].authorized)})</td><td className="num">{money(A.f.total[y].planned)}</td><td className="num">{money(B.f.total[y].planned)}</td><td className="num">{moneyDelta(B.f.total[y].planned - A.f.total[y].planned)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Project choices that differ" subtitle={`${diffs.length} project${diffs.length === 1 ? '' : 's'}`} pad={false}>
        {diffs.length === 0 ? <p className="p-4 text-[13px] text-muted">Both scenarios make the same include and deferral choices.</p> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Project</th><th className="num">Score</th><th>A</th><th>B</th><th className="num">Risk reduced</th></tr></thead>
              <tbody>{diffs.map(({ r, ia, ib }) => {
                const lbl = (i: { include: boolean; defer: number }) => (!i.include ? <Badge tone="bad">Excluded</Badge> : i.defer ? <Badge tone="warn">Defer +{i.defer} yr</Badge> : <Badge tone="good">As planned</Badge>)
                return <tr key={r.project.id}><td><a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(r.project.id)}>{r.project.code}</a> <span className="text-[12px]">{r.project.name}</span></td><td className="num">{r.score.toFixed(0)}</td><td>{lbl(ia)}</td><td>{lbl(ib)}</td><td className="num">{money(r.riskReduced)}</td></tr>
              })}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-[12px] text-faint">Scenarios are saved in this browser. Created {fmtDate(a.createdAt)} (A) and {fmtDate(b.createdAt)} (B).</p>
    </div>
  )
}
