// Portfolio planning model (V2): benefit-cost ranking, fit-to-funding scenarios and capacity.
import type { AppState, Driver, ID, Project, Risk } from '@/core/types'
import { activeBudget, position } from '@/core/engine/position'
import { estimateTotals, spreadByYear } from '@/core/engine/estimates'
import { expectedCost, isActive, riskScore } from '@/core/engine/risk'
import { templateFor } from '@/core/engine/gates'
import { sum } from '@/core/util'

export interface Weights { driver: Record<Driver, number>; hca: number; dac: number }
export const DEFAULT_WEIGHTS: Weights = {
  driver: { 'Safety / compliance': 1.5, Reliability: 1.2, Environmental: 1.1, Capacity: 1.0, 'Customer / new business': 0.9, Relocation: 0.8 },
  hca: 1.25,
  dac: 1.1,
}

export interface ScenarioItem { include: boolean; defer: number; mandatory?: boolean }
export interface Scenario {
  id: string
  name: string
  createdAt: string
  basis: 'budget' | 'eac'
  weights: Weights
  items: Record<ID, ScenarioItem>
  capacityLimit: number
}

export interface Candidate {
  project: Project
  stageName: string
  /** Committed = control budget in force; scope is authorized and spend is under contract. */
  committed: boolean
  proposed: boolean // no budget yet (estimate only)
  mandatoryDefault: boolean
  costBasis: 'control budget' | 'planning budget' | 'estimate'
  byYear: Record<string, number> // planned spend by year on the chosen basis
  remaining: number // forecast spend not yet incurred
  riskReduced: number // inherent − residual expected cost of active threats
  inherent: number
  residual: number
  constructionWindow?: { start: string; end: string }
}

/** Residual expected cost: scale the inherent expected cost by residual / inherent score. */
export function residualExpected(r: Risk): number {
  const inh = riskScore(r)
  const res = r.residual.likelihood * r.residual.consequence
  return expectedCost(r) * (inh ? res / inh : 1)
}

export function riskReducedFor(s: Pick<AppState, 'risks'>, pid: string): { inherent: number; residual: number; reduced: number } {
  const rs = s.risks.filter((r) => r.projectId === pid && isActive(r) && r.kind === 'threat')
  const inherent = sum(rs.map(expectedCost))
  const residual = sum(rs.map(residualExpected))
  return { inherent: Math.round(inherent), residual: Math.round(residual), reduced: Math.round(inherent - residual) }
}

const ms = (p: Project, ...names: string[]) => { for (const n of names) { const m = p.milestones.find((x) => x.name === n); if (m) return m.actual ?? m.forecast } return undefined }

export function candidates(s: AppState, basis: 'budget' | 'eac' = 'budget'): Candidate[] {
  const asOfYear = Number(s.settings.asOf.slice(0, 4))
  const out: Candidate[] = []
  for (const p of s.projects) {
    if (p.status === 'closed' || p.status === 'cancelled') continue
    const tpl = templateFor(s, p)
    const b = activeBudget(s, p.id)
    const pos = position(s, p.id)
    let byYear: Record<string, number> = {}
    let costBasis: Candidate['costBasis'] = 'estimate'
    if (b) {
      byYear = { ...b.byYear }
      costBasis = b.kind === 'control' ? 'control budget' : 'planning budget'
      if (basis === 'eac' && pos.eac && b.total) {
        // spread the forecast overrun/underrun across the remaining years
        const delta = pos.eac - pos.currentBudget
        const fut = Object.keys(byYear).filter((y) => Number(y) >= asOfYear)
        const futTotal = sum(fut.map((y) => byYear[y]))
        if (fut.length && futTotal > 0) for (const y of fut) byYear[y] = Math.round(byYear[y] + (delta * byYear[y]) / futTotal)
      }
    } else {
      const est = s.estimates.filter((e) => e.projectId === p.id && e.status !== 'rejected' && e.status !== 'superseded').sort((a, c) => a.version - c.version).pop()
      const total = est ? estimateTotals(est).total : 0
      const start = ms(p, 'Business case approved', 'Plan approved') ?? s.settings.asOf
      const end = ms(p, 'In service', 'In service & closed') ?? start
      byYear = total ? spreadByYear(total, start, end) : {}
    }
    const r = riskReducedFor(s, p.id)
    const cs = ms(p, 'Construction start', 'Construction authorized')
    const ce = ms(p, 'In service', 'In service & closed')
    const spentYears = Object.keys(byYear).filter((y) => Number(y) < asOfYear)
    const remaining = Math.max(0, sum(Object.values(byYear)) - Math.max(pos.actualToDate, sum(spentYears.map((y) => byYear[y]))))
    out.push({
      project: p,
      stageName: tpl.stages[p.stageIndex]?.name ?? '—',
      committed: b?.kind === 'control',
      proposed: !b,
      mandatoryDefault: p.driver === 'Safety / compliance',
      costBasis,
      byYear,
      remaining,
      riskReduced: r.reduced,
      inherent: r.inherent,
      residual: r.residual,
      constructionWindow: cs && ce ? { start: cs, end: ce } : undefined,
    })
  }
  return out
}

export interface Ranked extends Candidate { perMillion: number; weight: number; score: number; mandatory: boolean; rank: number }

/** Benefit-cost: risk $ reduced per $M of remaining spend, times driver and consequence weights. Normalized so the best = 100. */
export function rank(cs: Candidate[], sc: Pick<Scenario, 'weights' | 'items'>): Ranked[] {
  const raw = cs.map((c) => {
    const denom = Math.max(c.remaining, 250_000) / 1e6
    const perMillion = c.riskReduced / denom
    const w = (sc.weights.driver[c.project.driver] ?? 1) * (c.project.location.hca ? sc.weights.hca : 1) * (c.project.location.dac ? sc.weights.dac : 1)
    const mandatory = sc.items[c.project.id]?.mandatory ?? c.mandatoryDefault
    return { ...c, perMillion, weight: w, score: perMillion * w, mandatory, rank: 0 }
  })
  const max = Math.max(...raw.map((r) => r.score), 1)
  raw.forEach((r) => { r.score = Math.round((r.score / max) * 1000) / 10 })
  raw.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.score - a.score)
  raw.forEach((r, i) => { r.rank = i + 1 })
  return raw
}

export const itemOf = (sc: Scenario, pid: string): ScenarioItem => sc.items[pid] ?? { include: true, defer: 0 }

/** Shift future-year spend (years after the as-of year) by `defer` years; current and past years are sunk. */
export function shifted(byYear: Record<string, number>, defer: number, asOfYear: number): Record<string, number> {
  if (!defer) return byYear
  const out: Record<string, number> = {}
  for (const [y, v] of Object.entries(byYear)) {
    const n = Number(y)
    const k = String(n > asOfYear ? n + defer : n)
    out[k] = (out[k] || 0) + v
  }
  return out
}

export interface Fit {
  years: number[]
  byProgram: Record<ID, Record<number, { authorized: number; planned: number }>>
  total: Record<number, { authorized: number; planned: number }>
  overYears: number // program-years over authorization
  overAmount: number
  riskFunded: number
  deferred: number
  excluded: number
}

export function fit(s: AppState, cs: Candidate[], sc: Scenario, years: number[]): Fit {
  const asOfYear = Number(s.settings.asOf.slice(0, 4))
  const byProgram: Fit['byProgram'] = {}
  const total: Fit['total'] = {}
  for (const y of years) total[y] = { authorized: 0, planned: 0 }
  for (const pr of s.programs) {
    byProgram[pr.id] = {}
    for (const y of years) {
      const a = s.funding.find((f) => f.programId === pr.id && f.year === y)?.authorized ?? 0
      byProgram[pr.id][y] = { authorized: a, planned: 0 }
      total[y].authorized += a
    }
  }
  let riskFunded = 0, deferred = 0, excluded = 0
  for (const c of cs) {
    const it = itemOf(sc, c.project.id)
    if (!it.include) { excluded++; continue }
    if (it.defer) deferred++
    riskFunded += c.riskReduced
    const sh = shifted(c.byYear, it.defer, asOfYear)
    for (const [yk, v] of Object.entries(sh)) {
      const y = Number(yk)
      if (!byProgram[c.project.programId]?.[y]) continue
      byProgram[c.project.programId][y].planned += v
      total[y].planned += v
    }
  }
  let overYears = 0, overAmount = 0
  for (const pid of Object.keys(byProgram)) for (const y of years) {
    const c = byProgram[pid][y]
    if (y >= asOfYear && c.planned > c.authorized) { overYears++; overAmount += c.planned - c.authorized }
  }
  return { years, byProgram, total, overYears, overAmount: Math.round(overAmount), riskFunded, deferred, excluded }
}

/**
 * Suggest a fit: in each program-year over authorization (from next year on), defer the lowest-ranked
 * flexible project (not committed, not mandatory) by one more year, up to `maxDefer`. Deterministic and bounded.
 */
export function suggestFit(s: AppState, cs: Candidate[], sc: Scenario, years: number[], maxDefer = 3): { scenario: Scenario; moves: string[] } {
  const asOfYear = Number(s.settings.asOf.slice(0, 4))
  const next: Scenario = JSON.parse(JSON.stringify(sc))
  const moves: string[] = []
  const ranked = rank(cs, next)
  const stuck = new Set<string>()
  const rejected = new Set<string>()
  for (let guard = 0; guard < 300; guard++) {
    const f = fit(s, cs, next, years)
    let target: { pid: string; y: number } | null = null
    outer: for (const y of years.filter((x) => x > asOfYear)) for (const pr of s.programs) {
      const c = f.byProgram[pr.id][y]
      if (c.planned > c.authorized * 1.0001 && !stuck.has(pr.id + '|' + y)) { target = { pid: pr.id, y }; break outer }
    }
    if (!target) break
    const tg = target
    const pick = [...ranked].reverse().find((r) => {
      const it = itemOf(next, r.project.id)
      if (rejected.has(r.project.id + '|' + tg.y) || r.project.programId !== tg.pid || r.committed || r.mandatory || !it.include || it.defer >= maxDefer) return false
      return (shifted(r.byYear, it.defer, asOfYear)[String(tg.y)] ?? 0) > 0
    })
    if (!pick) { stuck.add(tg.pid + '|' + tg.y); continue }
    const it = itemOf(next, pick.project.id)
    next.items[pick.project.id] = { ...it, defer: it.defer + 1 }
    // keep a deferral only if it lowers total over-authorization (otherwise it just moves the problem)
    if (fit(s, cs, next, years).overAmount >= f.overAmount) { next.items[pick.project.id] = it; rejected.add(pick.project.id + '|' + tg.y); continue }
    moves.push(`${pick.project.code} deferred +${it.defer + 1} yr (score ${pick.score}) to relieve ${s.programs.find((p) => p.id === tg.pid)?.code} ${tg.y}`)
  }
  return { scenario: next, moves }
}

/** Projects in construction per district per year under the scenario (deferral shifts the window). */
export function capacity(cs: Candidate[], sc: Scenario, years: number[], asOfYear: number): { districts: string[]; grid: Record<string, Record<number, string[]>> } {
  const grid: Record<string, Record<number, string[]>> = {}
  for (const c of cs) {
    const it = itemOf(sc, c.project.id)
    if (!it.include || !c.constructionWindow) continue
    const d = c.project.location.district
    grid[d] ||= Object.fromEntries(years.map((y) => [y, []]))
    let y0 = Number(c.constructionWindow.start.slice(0, 4)), y1 = Number(c.constructionWindow.end.slice(0, 4))
    if (it.defer && y0 > asOfYear) { y0 += it.defer; y1 += it.defer } else if (it.defer && y1 > asOfYear) y1 += it.defer
    for (let y = y0; y <= y1; y++) if (grid[d][y]) grid[d][y].push(c.project.code)
  }
  return { districts: Object.keys(grid).sort(), grid }
}

export function newScenario(name: string, at: string, from?: Scenario): Scenario {
  return { id: 'scn_' + Math.random().toString(36).slice(2, 9), name, createdAt: at, basis: from?.basis ?? 'budget', weights: JSON.parse(JSON.stringify(from?.weights ?? DEFAULT_WEIGHTS)), items: JSON.parse(JSON.stringify(from?.items ?? {})), capacityLimit: from?.capacityLimit ?? 3 }
}
