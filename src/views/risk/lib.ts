// Risk & contingency helpers (RK-*). Pure functions over AppState so they can be unit-tested.
import type { AppState, MonteCarloResult, Project, Risk, RiskLibraryItem } from '@/core/types'
import { activeBudget, position } from '@/core/engine/position'
import { estimateTotals } from '@/core/engine/estimates'
import { expectedCost, isActive, monteCarlo, riskBand, riskScore } from '@/core/engine/risk'
import { addDays, daysBetween, monthRange, sum, uid } from '@/core/util'

export const RISK_CATEGORIES = [
  'Third-party / substructures', 'Permitting', 'Environmental', 'Material', 'Operations', 'Land / right-of-way', 'Technical',
  'Productivity', 'Regulatory change', 'Weather', 'Records', 'Market', 'Safety', 'Design', 'Stakeholder',
]
export const CONSEQUENCE_DIMS = ['Safety', 'Reliability', 'Environmental', 'Financial', 'Schedule', 'Reputational'] as const
export const PROB_BY_L = [0.05, 0.15, 0.35, 0.6, 0.85]

export const bandTone = (score: number): 'bad' | 'warn' | 'good' => {
  const b = riskBand(score)
  return b === 'high' ? 'bad' : b === 'medium' ? 'warn' : 'good'
}
export const residualScore = (r: Risk) => r.residual.likelihood * r.residual.consequence

/** Where the project's contingency number comes from: the budget in force, else the latest live estimate. */
export interface ContingencyBasis { base: number; contingency: number; original: number; source: string }
export function contingencyBasis(s: AppState, pid: string): ContingencyBasis | null {
  const pos = position(s, pid)
  if (pos.budgetKind) return { base: pos.baseBudget, contingency: pos.contingencyRemaining, original: pos.contingencyOriginal, source: pos.budgetKind === 'control' ? 'Control budget' : 'Planning budget' }
  const est = s.estimates.filter((e) => e.projectId === pid && e.status !== 'rejected' && e.status !== 'superseded').sort((a, b) => b.version - a.version)[0]
  if (!est) return null
  const t = estimateTotals(est)
  return { base: t.base, contingency: t.contingency, original: t.contingency, source: `Class ${est.cls} estimate v${est.version} (${est.status.replace('-', ' ')})` }
}

/** In-service milestone forecast (the date schedule risk pushes out). */
export function inServiceForecast(p: Project): string | undefined {
  const m = p.milestones.find((x) => /in service/i.test(x.name))
  return m && !m.actual ? m.forecast : undefined
}

/**
 * Run the engine Monte Carlo for a project. Base cost = budget (or estimate) excluding contingency;
 * schedule percentiles are risk-driven delay in days (base 0), applied to the in-service forecast.
 */
export function runMonteCarlo(s: AppState, pid: string, iterations = 5000, seed = 7): MonteCarloResult | null {
  const basis = contingencyBasis(s, pid)
  if (!basis) return null
  return monteCarlo(pid, s.risks.filter((r) => r.projectId === pid), basis.base, 0, s.settings.asOf, iterations, seed)
}
export const latestMonteCarlo = (s: AppState, pid: string) => s.monteCarlo.filter((m) => m.projectId === pid).slice(-1)[0]

export type Verdict = 'adequate' | 'p50-only' | 'short' | 'no-risk'
export interface Adequacy { remaining: number; need50: number; need80: number; gap80: number; verdict: Verdict; coverage: number; label: string; tone: 'good' | 'warn' | 'bad' }
/** Contingency adequacy (RK-06): contingency remaining vs the P80 − base requirement from Monte Carlo. */
export function adequacy(remaining: number, mc: Pick<MonteCarloResult, 'costP' | 'baseCost'>): Adequacy {
  const need50 = Math.max(0, mc.costP.P50 - mc.baseCost)
  const need80 = Math.max(0, mc.costP.P80 - mc.baseCost)
  const gap80 = remaining - need80
  const coverage = need80 ? remaining / need80 : remaining > 0 ? 9.99 : 1
  if (need80 === 0) return { remaining, need50, need80, gap80, coverage, verdict: 'no-risk', label: 'No quantified risk to cover', tone: 'good' }
  if (remaining >= need80) return { remaining, need50, need80, gap80, coverage, verdict: 'adequate', label: 'Adequate at P80', tone: 'good' }
  if (remaining >= need50) return { remaining, need50, need80, gap80, coverage, verdict: 'p50-only', label: 'Covers P50 only', tone: 'warn' }
  return { remaining, need50, need80, gap80, coverage, verdict: 'short', label: 'Short of P50', tone: 'bad' }
}

/** Contingency burn-down (RK-08): remaining contingency each month vs a draw-down proportional to % complete. */
export interface BurnPoint { month: string; remaining: number; ideal: number; pctComplete: number }
export function burndown(s: AppState, pid: string): BurnPoint[] | null {
  const b = activeBudget(s, pid)
  if (!b || b.kind !== 'control') return null
  const pos = position(s, pid)
  const start = b.createdAt.slice(0, 7)
  const end = s.settings.asOf.slice(0, 7)
  if (start > end) return null
  const periods = s.costPeriods.filter((c) => c.projectId === pid)
  const snaps = s.snapshots.filter((x) => x.projectId === pid && x.date >= b.createdAt).sort((a, c) => a.date.localeCompare(c.date))
  const bac = Math.max(1, pos.baseBudget)
  let cumEv = sum(periods.filter((p) => p.period < start).map((p) => p.earned))
  return monthRange(start, end).map((m) => {
    cumEv += sum(periods.filter((p) => p.period === m).map((p) => p.earned))
    const pct = Math.min(1, cumEv / bac)
    const snap = [...snaps].reverse().find((x) => x.date.slice(0, 7) <= m)
    const remaining = m === end ? pos.contingencyRemaining : snap?.budget.contingencyRemaining ?? pos.contingencyOriginal
    return { month: m, remaining, ideal: Math.round(pos.contingencyOriginal * (1 - pct)), pctComplete: pct }
  })
}

export function nextRiskCode(s: AppState, p: Project, offset = 0): string {
  const nums = s.risks.filter((r) => r.projectId === p.id).map((r) => Number(r.code.split('-').pop()) || 0)
  return `R-${p.code.slice(4)}-${String(Math.max(0, ...nums) + 1 + offset).padStart(2, '0')}`
}

/** Seed a register entry from the risk library, typical cost taken as a % of the project budget (RK-03). */
export function riskFromLibrary(s: AppState, p: Project, item: RiskLibraryItem, budgetBase: number, offset = 0): Risk {
  const ml = Math.max(5000, Math.round((Math.abs(item.typicalCostPct) / 100) * budgetBase / 1000) * 1000)
  return {
    id: uid('rsk'), projectId: p.id, code: nextRiskCode(s, p, offset), title: item.title, cause: item.cause, event: item.event, effect: item.effect, category: item.category,
    kind: item.typicalCostPct < 0 ? 'opportunity' : 'threat', ownerId: p.team.pm ?? s.currentUserId, status: 'open', likelihood: 3, consequence: 3,
    consequenceDim: item.category === 'Environmental' ? 'Environmental' : item.typicalDays > 40 ? 'Schedule' : 'Financial',
    probability: PROB_BY_L[2], cost: { min: Math.round(ml * 0.4), ml, max: Math.round(ml * 2.2) },
    scheduleDays: { min: Math.round(item.typicalDays * 0.4), ml: item.typicalDays, max: Math.round(item.typicalDays * 2) },
    responses: [], residual: { likelihood: 2, consequence: 3 }, libraryId: item.id, createdAt: s.settings.asOf,
  }
}

/** Budget figure library percentages apply to. */
export function budgetBase(s: AppState, pid: string): number {
  const pos = position(s, pid)
  if (pos.currentBudget) return pos.currentBudget
  return contingencyBasis(s, pid)?.base ?? 0
}

/** When a realized risk happened: its close date, else its contingency draw, else creation. */
export function realizedDate(s: AppState, r: Risk): string {
  return r.closedAt ?? s.contingencyDraws.filter((d) => d.riskId === r.id).map((d) => d.date).sort().pop() ?? r.createdAt
}

export interface LessonRow { id: string; projectId: string; date: string; title: string; category: string; text: string; workMethods: string[]; source: string }
/** Lessons library (RK-10): published lessons plus closed risks that carry a lesson. */
export function lessonsLibrary(s: AppState): LessonRow[] {
  const rows: LessonRow[] = s.lessons.map((l) => ({ id: l.id, projectId: l.projectId, date: l.date, title: l.title, category: l.category, text: l.text, workMethods: l.workMethods, source: 'Lessons register' }))
  for (const r of s.risks) {
    if (!r.lesson) continue
    const p = s.projects.find((x) => x.id === r.projectId)
    rows.push({ id: r.id, projectId: r.projectId, date: r.closedAt ?? r.createdAt, title: r.title, category: r.category, text: r.lesson, workMethods: p ? [p.workMethod] : [], source: `Closed risk ${r.code}` })
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

export function exposureSummary(risks: Risk[], asOf: string) {
  const act = risks.filter(isActive)
  const threats = act.filter((r) => r.kind === 'threat')
  const opps = act.filter((r) => r.kind === 'opportunity')
  return {
    active: act.length,
    high: act.filter((r) => riskScore(r) >= 15).length,
    highNoResponse: act.filter((r) => riskScore(r) >= 15 && r.responses.length === 0).length,
    threat: Math.round(sum(threats.map(expectedCost))),
    opportunity: Math.round(-sum(opps.map(expectedCost))),
    net: Math.round(sum(act.map(expectedCost))),
    overdueResponses: act.flatMap((r) => r.responses).filter((x) => x.status === 'open' && x.due < asOf).length,
    scheduleDays: Math.round(sum(threats.map((r) => r.probability * r.scheduleDays.ml))),
  }
}

/** Schedule date for a percentile delay on the in-service forecast. */
export const delayedDate = (forecast: string | undefined, days: number) => (forecast ? addDays(forecast, Math.max(0, days)) : undefined)
export const daysLate = (a?: string, b?: string) => (a && b ? daysBetween(a, b) : 0)
