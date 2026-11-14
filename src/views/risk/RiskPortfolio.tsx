// Portfolio risk view (RK-12) and lessons learned library (RK-10).
import { useMemo, useState } from 'react'
import type { Risk } from '@/core/types'
import { personName, useStore } from '@/core/store'
import { projectHref, go } from '@/core/router'
import { expectedCost, isActive, riskScore } from '@/core/engine/risk'
import { addDays, fmtDate, groupBy, money, sum, cx } from '@/core/util'
import { Badge, Callout, Empty, Input, Mono, PageHeader, Panel, SegButtons, Select, Stat, StatusBadge, Table, type Column } from '@/ui/kit'
import { HBarChart, RiskMatrix } from '@/ui/charts'
import { ProgramTag } from '@/views/shared/pickers'
import { ScoreChip } from './RiskEditor'
import { adequacy, contingencyBasis, latestMonteCarlo, lessonsLibrary, realizedDate, runMonteCarlo } from './lib'

export default function RiskPortfolio(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const [program, setProgram] = useState('')
  const [mode, setMode] = useState<'inherent' | 'residual'>('inherent')
  const [cell, setCell] = useState<string | undefined>()
  const live = s.projects.filter((p) => p.status === 'active' || p.status === 'on-hold')
  const projects = live.filter((p) => !program || p.programId === program)
  const pids = new Set(projects.map((p) => p.id))
  const risks = s.risks.filter((r) => pids.has(r.projectId))
  const active = risks.filter(isActive)
  const proj = (id: string) => s.projects.find((p) => p.id === id)!

  const cells: Record<string, number> = {}
  for (const r of active) { const k = mode === 'inherent' ? `${r.likelihood}-${r.consequence}` : `${r.residual.likelihood}-${r.residual.consequence}`; cells[k] = (cells[k] || 0) + 1 }
  const inCell = (r: Risk) => !cell || (mode === 'inherent' ? `${r.likelihood}-${r.consequence}` : `${r.residual.likelihood}-${r.residual.consequence}`) === cell

  const top = active.filter((r) => r.kind === 'threat' && inCell(r)).sort((a, b) => riskScore(b) - riskScore(a) || expectedCost(b) - expectedCost(a)).slice(0, 15)

  // Per-project adequacy (uses saved Monte Carlo when present, otherwise expected value as P50 proxy)
  const perProject = useMemo(() => projects.map((p) => {
    const pr = s.risks.filter((r) => r.projectId === p.id)
    const exp = Math.round(sum(pr.filter(isActive).map(expectedCost)))
    const basis = contingencyBasis(s, p.id)
    const saved = latestMonteCarlo(s, p.id)
    const mc = saved ?? (basis ? runMonteCarlo(s, p.id, 2000) ?? undefined : undefined)
    const a = basis && mc ? adequacy(basis.contingency, mc) : null
    return { p, exp, cont: basis?.contingency ?? 0, a, mc, saved: !!saved }
  }), [s.risks, s.monteCarlo, s.budgets, s.contingencyDraws, s.changes, s.estimates, program]) // eslint-disable-line react-hooks/exhaustive-deps

  const byProgram = s.programs.filter((pg) => !program || pg.id === program).map((pg) => {
    const rows = perProject.filter((x) => x.p.programId === pg.id)
    const exposure = sum(rows.map((x) => x.exp))
    const cont = sum(rows.map((x) => x.cont))
    const short = rows.filter((x) => x.a?.verdict === 'p50-only').length
    const uncovered = rows.filter((x) => x.a?.verdict === 'short' || (!x.a && x.exp > x.cont)).length
    return { pg, n: rows.length, exposure, cont, ratio: cont ? exposure / cont : 0, short, uncovered, highs: s.risks.filter((r) => rows.some((x) => x.p.id === r.projectId) && isActive(r) && riskScore(r) >= 15).length }
  })

  const byCat = Object.entries(groupBy(active.filter((r) => r.kind === 'threat'), (r) => r.category)).map(([k, rs]) => ({ label: k, value: Math.round(sum(rs.map(expectedCost))), sub: `${rs.length}` })).sort((a, b) => b.value - a.value)
  const totalExp = sum(byCat.map((x) => x.value))
  const topCatShare = byCat[0] ? byCat[0].value / Math.max(1, totalExp) : 0

  const since = addDays(s.settings.asOf, -90)
  const realized = risks.filter((r) => r.status === 'realized' && realizedDate(s, r) >= since).sort((a, b) => realizedDate(s, b).localeCompare(realizedDate(s, a)))
  const drawsFor = (r: Risk) => s.contingencyDraws.filter((d) => d.riskId === r.id)

  const totals = { exposure: sum(perProject.map((x) => x.exp)), cont: sum(perProject.map((x) => x.cont)) }
  const highNoResp = active.filter((r) => riskScore(r) >= 15 && r.responses.length === 0).length

  const topCols: Column<Risk>[] = [
    { key: 'proj', header: 'Project', render: (r) => <a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(r.projectId, 'risk')} onClick={(e) => e.stopPropagation()}>{proj(r.projectId).code}</a>, sort: (r) => proj(r.projectId).code },
    { key: 'code', header: 'Risk', render: (r) => <div className="min-w-[200px]"><div className="font-semibold"><Mono className="mr-1 text-muted">{r.code}</Mono>{r.title}</div><div className="text-xs text-muted">{proj(r.projectId).name}</div></div>, sort: (r) => r.title },
    { key: 'cat', header: 'Category', render: (r) => <span className="text-[12px]">{r.category}</span>, sort: (r) => r.category },
    { key: 'score', header: 'L×C', render: (r) => <ScoreChip l={r.likelihood} c={r.consequence} />, sort: (r) => riskScore(r) },
    { key: 'ev', header: 'Expected', num: true, render: (r) => money(expectedCost(r)), sort: (r) => expectedCost(r) },
    { key: 'ml', header: 'ML cost', num: true, render: (r) => money(r.cost.ml), sort: (r) => r.cost.ml },
    { key: 'owner', header: 'Owner', render: (r) => <span className="whitespace-nowrap text-[12px]">{personName(s, r.ownerId)}</span> },
    { key: 'resp', header: 'Response', render: (r) => (r.responses.length ? <span className="text-[12px]">{r.responses.filter((x) => x.status === 'done').length}/{r.responses.length} done</span> : <Badge tone="bad">None</Badge>) },
  ]

  return (
    <div>
      <PageHeader eyebrow="Controls" title="Portfolio risk" subtitle="Every active risk across live projects, how much contingency stands behind it, and what we learned from the ones that happened."
        actions={<Select id="risk-program" aria-label="Program" className="w-[260px]" value={program} onChange={(e) => { setProgram(e.target.value); setCell(undefined) }} options={[{ value: '', label: 'All programs' }, ...s.programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active risks" value={active.length} sub={`${projects.length} live projects`} />
        <Stat label="High (≥15)" value={active.filter((r) => riskScore(r) >= 15).length} tone="bad" sub={`${highNoResp} without a response`} />
        <Stat label="Expected exposure" value={money(totals.exposure)} sub="Net of opportunities" />
        <Stat label="Contingency held" value={money(totals.cont)} sub={`${totals.cont ? Math.round((totals.exposure / totals.cont) * 100) : 0}% of it at risk`} />
        <Stat label="Realized, 90 days" value={realized.length} sub={money(sum(realized.flatMap(drawsFor).map((d) => d.amount))) + ' drawn'} tone={realized.length ? 'warn' : undefined} />
        <Stat label="Lessons on file" value={lessonsLibrary(s).length} sub="Searchable below" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Heat map" actions={<SegButtons options={[{ id: 'inherent', label: 'Inherent' }, { id: 'residual', label: 'Residual' }]} value={mode} onChange={(v) => { setMode(v); setCell(undefined) }} />}>
          <RiskMatrix cells={cells} selected={cell} onPick={(l, c) => setCell((x) => (x === `${l}-${c}` ? undefined : `${l}-${c}`))} />
          <p className="mt-2 text-[11px] text-faint">{cell ? `Filtering top risks to L${cell[0]} × C${cell[2]}. Click again to clear.` : 'Click a cell to filter the top-risk list.'}</p>
        </Panel>
        <Panel title="Top 15 threats" subtitle="Ranked by score, then expected cost. Click to open the project register." pad={false}>
          <Table rows={top} columns={topCols} rowKey={(r) => r.id} onRowClick={(r) => go(projectHref(r.projectId, 'risk'))} maxHeight={460} empty={<div className="p-4"><Empty title="No risks in this cell" /></div>} />
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Exposure and contingency by program" pad={false}>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Program</th><th className="num">Projects</th><th className="num">High risks</th><th className="num">Exposure</th><th className="num">Contingency</th><th className="num">Exposure ÷ cont.</th><th>Adequacy</th></tr></thead>
              <tbody>
                {byProgram.map((x) => (
                  <tr key={x.pg.id}>
                    <td><span className="flex items-center gap-2"><ProgramTag programId={x.pg.id} /><span className="text-[12px]">{x.pg.name}</span></span></td>
                    <td className="num">{x.n}</td>
                    <td className="num">{x.highs}</td>
                    <td className="num">{money(x.exposure)}</td>
                    <td className="num">{money(x.cont)}</td>
                    <td className={cx('num font-semibold', x.ratio > 1 ? 'text-bad' : x.ratio > 0.7 ? 'text-warn' : 'text-good')}>{x.cont ? `${Math.round(x.ratio * 100)}%` : '—'}</td>
                    <td>{x.uncovered ? <Badge tone="bad">{x.uncovered} short of P50</Badge> : null}{x.short ? <Badge tone="warn" className="ml-1">{x.short} below P80</Badge> : null}{!x.uncovered && !x.short && x.n ? <Badge tone="good">Covered at P80</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line p-4">
            <div className="eyebrow mb-2">Expected exposure by program</div>
            <HBarChart rows={byProgram.filter((x) => x.n).map((x) => ({ label: x.pg.code + ' · ' + x.pg.name, value: x.exposure, color: x.ratio > 1 ? 'rgb(var(--bad))' : x.ratio > 0.7 ? 'rgb(var(--warn))' : undefined }))} />
          </div>
        </Panel>

        <Panel title="Concentration by category" subtitle="Where threat exposure clusters across the portfolio">
          {byCat.length ? <HBarChart rows={byCat.slice(0, 10)} /> : <Empty title="No active threats" />}
          {topCatShare > 0.25 && <div className="mt-3"><Callout tone="warn" title="Concentration">{byCat[0].label} carries {Math.round(topCatShare * 100)}% of portfolio threat exposure across {byCat[0].sub} risks. A program-level response (standard practice, master agreement, or early action) is likely cheaper than project-by-project mitigation.</Callout></div>}
        </Panel>
      </div>

      <Panel className="mt-4" title="Contingency adequacy by project" subtitle="Contingency remaining vs the P80 requirement. Uses each project's saved Monte Carlo run, or a live run from the current register." pad={false}>
        <AdequacyTable rows={perProject} />
      </Panel>

      <Panel className="mt-4" title="Risks realized in the last 90 days" subtitle={`Since ${fmtDate(since)}`} pad={false}>
        {realized.length === 0 ? <div className="p-4"><Empty title="Nothing realized in 90 days" /></div> : (
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Date</th><th>Project</th><th>Risk</th><th>Category</th><th className="num">ML</th><th className="num">Drawn</th><th>Draw status</th><th>Lesson</th></tr></thead>
            <tbody>{realized.map((r) => { const ds = drawsFor(r); return (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDate(realizedDate(s, r))}</td>
                <td><a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(r.projectId, 'risk')}>{proj(r.projectId).code}</a></td>
                <td><Mono className="mr-1 text-muted">{r.code}</Mono>{r.title}</td>
                <td className="text-[12px]">{r.category}</td>
                <td className="num">{money(r.cost.ml)}</td>
                <td className="num">{ds.length ? money(sum(ds.map((d) => d.amount))) : '—'}</td>
                <td>{ds.map((d) => <StatusBadge key={d.id} status={d.status} />)}</td>
                <td className="max-w-[280px] text-[12px] text-muted">{r.lesson ?? <span className="text-faint">Not yet captured</span>}</td>
              </tr>) })}</tbody>
          </table></div>
        )}
      </Panel>

      <LessonsLibrary />
    </div>
  )
}

function AdequacyTable({ rows }: { rows: { p: { id: string; code: string; name: string; programId: string }; exp: number; cont: number; a: ReturnType<typeof adequacy> | null; mc?: { date: string; iterations: number }; saved: boolean }[] }) {
  const sorted = rows.filter((r) => r.cont || r.exp).slice().sort((a, b) => (a.a ? a.a.gap80 : a.cont - a.exp) - (b.a ? b.a.gap80 : b.cont - b.exp))
  return (
    <div className="scroll-x" style={{ maxHeight: 420, overflowY: 'auto' }}><table className="tbl">
      <thead><tr><th>Project</th><th className="num">Exposure</th><th className="num">Contingency left</th><th className="num">P80 need</th><th className="num">Surplus / gap</th><th>Verdict</th><th>Analysis</th></tr></thead>
      <tbody>{sorted.map(({ p, exp, cont, a, mc, saved }) => (
        <tr key={p.id}>
          <td><a href={projectHref(p.id, 'risk')} className="flex items-center gap-2 hover:underline"><ProgramTag programId={p.programId} /><span className="font-mono text-[12px] font-semibold">{p.code}</span><span className="truncate text-[12px] text-muted">{p.name}</span></a></td>
          <td className="num">{money(exp)}</td>
          <td className="num">{money(cont)}</td>
          <td className="num">{a ? money(a.need80) : '—'}</td>
          <td className={cx('num font-semibold', (a ? a.gap80 : cont - exp) < 0 ? 'text-bad' : 'text-good')}>{money(a ? a.gap80 : cont - exp)}</td>
          <td>{a ? <Badge tone={a.tone}>{a.label}</Badge> : exp > cont ? <Badge tone="bad">Exposure exceeds contingency</Badge> : <Badge>Not simulated</Badge>}</td>
          <td className="text-[12px] text-muted">{mc ? (saved ? `Saved run ${fmtDate(mc.date)}` : `Live run, ${mc.iterations.toLocaleString()} iterations`) : 'Expected value only'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

function LessonsLibrary() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [wm, setWm] = useState('')
  const all = lessonsLibrary(s)
  const cats = Array.from(new Set(all.map((l) => l.category))).sort()
  const methods = Array.from(new Set(all.flatMap((l) => l.workMethods))).sort()
  const rows = all.filter((l) => (!cat || l.category === cat) && (!wm || l.workMethods.includes(wm)) && (!q || (l.title + ' ' + l.text + ' ' + l.category).toLowerCase().includes(q.toLowerCase())))
  const proj = (id: string) => s.projects.find((p) => p.id === id)
  return (
    <Panel className="mt-4" title="Lessons learned library" subtitle="Published lessons and closed risks that carry a lesson. Shown to teams planning similar work." pad={false}
      actions={<>
        <Input id="lesson-q" className="w-[200px]" placeholder="Search lessons" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="lesson-cat" aria-label="Lesson category" className="w-[160px]" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...cats]} />
        <Select id="lesson-wm" aria-label="Work method" className="w-[190px]" value={wm} onChange={(e) => setWm(e.target.value)} options={[{ value: '', label: 'All work methods' }, ...methods.map((m) => ({ value: m, label: m.replace(/-/g, ' ') }))]} />
      </>}>
      {rows.length === 0 ? <div className="p-4"><Empty title="No lessons match">Try a broader search.</Empty></div> : (
        <div className="flex flex-col divide-y divide-line" style={{ maxHeight: 480, overflowY: 'auto' }}>
          {rows.map((l) => {
            const p = proj(l.projectId)
            return (
              <div key={l.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[13px]">{l.title}</b><Badge>{l.category}</Badge>
                  {l.workMethods.map((m) => <Badge key={m} tone="info">{m.replace(/-/g, ' ')}</Badge>)}
                  <span className="ml-auto text-xs text-faint">{fmtDate(l.date)}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted">{l.text}</p>
                <div className="mt-1 text-xs text-faint">{l.source} · {p ? <a className="text-link hover:underline" href={projectHref(p.id, 'risk')}>{p.code} {p.name}</a> : '—'}</div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

