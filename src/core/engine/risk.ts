import type { MonteCarloResult, Risk } from '../types'
import { rng, triangular, uid } from '../util'

export const riskScore = (r: Pick<Risk, 'likelihood' | 'consequence'>) => r.likelihood * r.consequence
export function riskBand(score: number): 'high' | 'medium' | 'low' {
  return score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low'
}
// VERIFY: PERT mean (min + 4·most likely + max) / 6 for 3-point risk impacts.
export const pert = (t: { min: number; ml: number; max: number }) => (t.min + 4 * t.ml + t.max) / 6
export const isActive = (r: Risk) => r.status === 'open' || r.status === 'mitigating'

/** Expected cost of a risk (negative for opportunities). */
export function expectedCost(r: Risk): number {
  const v = r.probability * pert(r.cost)
  return r.kind === 'opportunity' ? -v : v
}
export function exposure(risks: Risk[]): number {
  return Math.round(risks.filter(isActive).reduce((a, r) => a + expectedCost(r), 0))
}
export const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']
export const CONSEQUENCE_LABELS = ['Minimal', 'Minor', 'Moderate', 'Major', 'Severe']

/**
 * Monte Carlo cost and schedule (RK-07). Each active risk fires with its probability;
 * when it fires its impact is drawn from a triangular distribution.
 */
// VERIFY: each risk fires independently with its probability; impacts are triangular; no correlation between risks.
export function monteCarlo(projectId: string, risks: Risk[], baseCost: number, baseDays: number, date: string, iterations = 5000, seed = 7): MonteCarloResult {
  const R = rng(seed)
  const active = risks.filter(isActive)
  const costs: number[] = new Array(iterations)
  const days: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let c = baseCost, s = baseDays
    for (const r of active) {
      if (R.next() < r.probability) {
        const sign = r.kind === 'opportunity' ? -1 : 1
        c += sign * triangular(R.next(), r.cost.min, r.cost.ml, r.cost.max)
        s += sign * triangular(R.next(), r.scheduleDays.min, r.scheduleDays.ml, r.scheduleDays.max)
      }
    }
    costs[i] = c
    days[i] = s
  }
  costs.sort((a, b) => a - b)
  days.sort((a, b) => a - b)
  const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
  const lo = costs[0], hi = costs[costs.length - 1]
  const bins = 30
  const w = (hi - lo) / bins || 1
  const histogram = Array.from({ length: bins }, (_, i) => ({ x: Math.round(lo + w * (i + 0.5)), n: 0 }))
  for (const c of costs) histogram[Math.min(bins - 1, Math.floor((c - lo) / w))].n++
  return {
    id: uid('mc'),
    projectId,
    date,
    iterations,
    baseCost,
    costP: { P10: Math.round(q(costs, 0.1)), P50: Math.round(q(costs, 0.5)), P80: Math.round(q(costs, 0.8)), P90: Math.round(q(costs, 0.9)) },
    scheduleP: { P10: Math.round(q(days, 0.1)), P50: Math.round(q(days, 0.5)), P80: Math.round(q(days, 0.8)), P90: Math.round(q(days, 0.9)) },
    histogram,
  }
}
