import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import { CRITERIA, allocationOf, authorizedFunding, optimize, saveAllocation, scoreBenefits, setBenefits, validateAllocation } from './allocation'

const S = buildSeed()
const A = allocationOf(S)
const fundedCodes = (r: ReturnType<typeof optimize>) => r.rows.filter((x) => x.status === 'funded' || x.status === 'committed' || x.status === 'must').map((x) => x.project.code).sort()

describe('capital allocation', () => {
  it('seeds benefits for every active project and a budget from authorized funding', () => {
    for (const p of S.projects.filter((x) => x.status !== 'closed' && x.status !== 'cancelled')) expect(p.benefits, p.code).toBeTruthy()
    expect(A.budget).toBe(authorizedFunding(S).amount)
    expect(validateAllocation(A)).toEqual([])
  })

  it('scores benefit points linearly: amount ÷ full credit × 100 × weight share', () => {
    const a = { weights: { safety: 50, capacity: 25, redundancy: 25 }, fullCredit: { safety: 1000, capacity: 25, redundancy: 10_000 } }
    const sc = scoreBenefits({ safetyK: 2000, capacityMmcfd: 25, redundancyCustomers: 5000 }, a)
    expect(sc.parts.safety).toBeCloseTo(100)
    expect(sc.parts.capacity).toBeCloseTo(25)
    expect(sc.parts.redundancy).toBeCloseTo(12.5)
    expect(sc.total).toBeCloseTo(137.5)
    // weights are relative: doubling all of them changes nothing
    expect(scoreBenefits({ safetyK: 2000, capacityMmcfd: 25, redundancyCustomers: 5000 }, { ...a, weights: { safety: 100, capacity: 50, redundancy: 50 } }).total).toBeCloseTo(137.5)
    expect(scoreBenefits(undefined, a).total).toBe(0)
  })

  it('funds committed work first, never exceeds the capital available, and honors Must fund and Exclude', () => {
    const r = optimize(S, A)
    expect(r.spend).toBeLessThanOrEqual(r.budget)
    for (const x of r.rows.filter((y) => y.committed)) expect(x.status, x.project.code).toBe('committed')
    const pick = r.rows.find((x) => x.status === 'unfunded')!
    const top = r.rows.find((x) => x.status === 'funded')!
    const a2 = { ...A, decisions: { [pick.project.id]: 'must' as const, [top.project.id]: 'exclude' as const } }
    const r2 = optimize(S, a2)
    expect(r2.rows.find((x) => x.project.id === pick.project.id)!.status).toBe('must')
    expect(r2.rows.find((x) => x.project.id === top.project.id)!.status).toBe('excluded')
    expect(r2.spend).toBeLessThanOrEqual(r2.budget)
  })

  it('finds the best combination (matches brute force) and never does worse than rank order', () => {
    for (const budget of [480e6, 520e6, 600e6, 900e6, 1_200e6]) {
      // keep the flexible set small enough to enumerate
      const flex = optimize(S, { ...A, budget }).rows.filter((x) => !x.locked).map((x) => x.project.id)
      const keep = flex.slice(0, 14)
      const a = { ...A, budget, decisions: Object.fromEntries(flex.filter((id) => !keep.includes(id)).map((id) => [id, 'exclude' as const])) }
      const r = optimize(S, a)
      const items = r.rows.filter((x) => !x.locked && x.decision !== 'exclude')
      const cap = budget - r.lockedCost
      let best = 0
      for (let m = 0; m < 1 << items.length; m++) {
        let c = 0, b = 0
        items.forEach((x, i) => { if (m & (1 << i)) { c += Math.ceil(x.cost / r.unit) * r.unit; b += x.benefit } })
        if (c <= Math.floor(cap / r.unit) * r.unit && b > best) best = b
      }
      const lockedB = r.rows.filter((x) => x.locked).reduce((s, x) => s + x.benefit, 0)
      expect(r.benefit, `budget ${budget}`).toBeCloseTo(lockedB + best, 6)
      expect(r.benefit + 1e-9).toBeGreaterThanOrEqual(r.greedyBenefit)
    }
  })

  it('the frontier rises with capital and ends at every eligible project funded', () => {
    const r = optimize(S, A)
    for (let i = 1; i < r.frontier.length; i++) expect(r.frontier[i].benefit + 1e-9).toBeGreaterThanOrEqual(r.frontier[i - 1].benefit)
    expect(r.frontier.at(-1)!.benefit).toBeCloseTo(r.maxBenefit, 6)
    expect(r.frontier[0].budget).toBe(r.lockedCost)
  })

  it('the weighting changes which projects are funded', () => {
    const budget = 1_200e6
    const growth = fundedCodes(optimize(S, { ...A, budget, weights: { safety: 0, capacity: 100, redundancy: 0 } }))
    const safety = fundedCodes(optimize(S, { ...A, budget, weights: { safety: 100, capacity: 0, redundancy: 0 } }))
    expect(growth).not.toEqual(safety)
  })

  it('is deterministic and ignores community attributes (location.dac and everything else in location)', () => {
    const r = optimize(S, A)
    expect(fundedCodes(optimize(S, A))).toEqual(fundedCodes(r))
    const flipped = produce(S, (d) => { for (const p of d.projects) { p.location.dac = !p.location.dac; p.location.city = 'X'; p.location.district = 'North' } })
    const r2 = optimize(flipped, A)
    expect(fundedCodes(r2)).toEqual(fundedCodes(r))
    expect(r2.benefit).toBe(r.benefit)
    for (const c of CRITERIA) expect(`${c.id} ${c.label} ${c.help}`).not.toMatch(/\bdac\b|disadvantag|income|wealth|race|ethnic|home.?value|zip|census|demograph|poverty/i)
  })

  it('saves settings and benefit edits; negatives are clamped; bad settings are reported', () => {
    const p = S.projects[0]
    const d = produce(S, (x) => {
      saveAllocation(x, { weights: { safety: 80, capacity: 10, redundancy: 10 }, decisions: { [p.id]: 'exclude' } })
      setBenefits(x, p.id, { safetyK: -5, capacityMmcfd: 3 }, 'u-me')
    })
    expect(allocationOf(d).weights.safety).toBe(80)
    expect(allocationOf(d).decisions[p.id]).toBe('exclude')
    expect(d.projects[0].benefits).toMatchObject({ safetyK: 0, capacityMmcfd: 3, updatedById: 'u-me' })
    expect(validateAllocation({ weights: { safety: 0, capacity: 0, redundancy: 0 }, fullCredit: { safety: 0, capacity: 1, redundancy: 1 }, budget: -1 })).toHaveLength(3)
  })
})
