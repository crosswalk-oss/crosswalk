import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AllocationSettings } from '../types'
import { DEFAULT_CRITERIA, activeCriteria, allocationOf, authorizedFunding, describeAllocationChange, optimize, saveAllocation, scoreBenefits, setBenefits, validateAllocation } from './allocation'

const S = buildSeed()
const A = allocationOf(S)
const fundedCodes = (r: ReturnType<typeof optimize>) => r.rows.filter((x) => x.status === 'funded' || x.status === 'committed' || x.status === 'must').map((x) => x.project.code).sort()
const withWeights = (a: AllocationSettings, w: Record<string, number>): AllocationSettings => ({ ...a, criteria: a.criteria.map((c) => ({ ...c, weight: w[c.id] ?? 0 })) })

describe('capital allocation', () => {
  it('seeds six measures, benefits and delivery confidence for every active project, and a budget from authorized funding', () => {
    expect(activeCriteria(A).map((c) => c.id)).toEqual(['safety', 'reliability', 'capacity', 'redundancy', 'emissions', 'om'])
    for (const p of S.projects.filter((x) => x.status !== 'closed' && x.status !== 'cancelled')) {
      expect(p.benefits?.values, p.code).toBeTruthy()
      expect(p.benefits!.confidence).toBeGreaterThanOrEqual(70)
    }
    expect(A.budget).toBe(authorizedFunding(S).amount)
    expect(validateAllocation(A)).toEqual([])
  })

  it('scores benefit points linearly: amount ÷ 100-point amount × 100 × weight share × confidence', () => {
    const a = { criteria: [
      { id: 'safety', label: 'Safety', unit: '$K/yr', help: '', attribute: 'safety' as const, fullCredit: 1000, weight: 50, active: true },
      { id: 'capacity', label: 'Capacity', unit: 'MMcfd', help: '', attribute: 'reliability' as const, fullCredit: 25, weight: 25, active: true },
      { id: 'redundancy', label: 'Redundancy', unit: 'customers', help: '', attribute: 'reliability' as const, fullCredit: 10_000, weight: 25, active: true },
      { id: 'off', label: 'Off', unit: 'x', help: '', attribute: 'other' as const, fullCredit: 1, weight: 1000, active: false },
    ] }
    const b = { values: { safety: 2000, capacity: 25, redundancy: 5000, off: 99 }, confidence: 80 }
    const sc = scoreBenefits(b, a)
    expect(sc.parts.safety).toBeCloseTo(100)
    expect(sc.parts.capacity).toBeCloseTo(25)
    expect(sc.parts.redundancy).toBeCloseTo(12.5)
    expect(sc.parts.off).toBeUndefined() // switched-off measures don't count
    expect(sc.total).toBeCloseTo(137.5)
    expect(scoreBenefits(b, { ...a, useConfidence: true }).total).toBeCloseTo(110) // × 80%
    // weights are relative: doubling all of them changes nothing
    expect(scoreBenefits(b, { criteria: a.criteria.map((c) => ({ ...c, weight: c.weight * 2 })) }).total).toBeCloseTo(137.5)
    expect(scoreBenefits(undefined, a).total).toBe(0)
  })

  it('funds committed work first, never exceeds the capital available, and honors Must fund and Exclude', () => {
    const r = optimize(S, A)
    expect(r.spend).toBeLessThanOrEqual(r.budget)
    for (const x of r.rows.filter((y) => y.committed)) expect(x.status, x.project.code).toBe('committed')
    const pick = r.rows.find((x) => x.status === 'unfunded')!
    const top = r.rows.find((x) => x.status === 'funded')!
    const r2 = optimize(S, { ...A, decisions: { [pick.project.id]: 'must', [top.project.id]: 'exclude' } })
    expect(r2.rows.find((x) => x.project.id === pick.project.id)!.status).toBe('must')
    expect(r2.rows.find((x) => x.project.id === top.project.id)!.status).toBe('excluded')
    expect(r2.spend).toBeLessThanOrEqual(r2.budget)
  })

  it('finds the best combination (matches brute force) and never does worse than rank order', () => {
    for (const budget of [480e6, 520e6, 600e6, 900e6, 1_200e6]) {
      const flex = optimize(S, { ...A, budget }).rows.filter((x) => !x.locked).map((x) => x.project.id)
      const keep = flex.slice(0, 14)
      const r = optimize(S, { ...A, budget, decisions: Object.fromEntries(flex.filter((id) => !keep.includes(id)).map((id) => [id, 'exclude' as const])) })
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

  it('the weighting, the presets and delivery confidence change which projects are funded', () => {
    const budget = 1_200e6
    const growth = fundedCodes(optimize(S, withWeights({ ...A, budget }, { capacity: 100 })))
    const safety = fundedCodes(optimize(S, withWeights({ ...A, budget }, { safety: 100 })))
    expect(growth).not.toEqual(safety)
    const plans = new Set(A.presets.map((p) => fundedCodes(optimize(S, withWeights({ ...A, budget }, p.weights))).join()))
    expect(plans.size).toBeGreaterThan(2)
    // confidence discounts early-stage promises: an early project loses more points than a ready-to-build one
    const on = optimize(S, { ...A, budget, useConfidence: true }), off = optimize(S, { ...A, budget, useConfidence: false })
    expect(on.maxBenefit).toBeLessThan(off.maxBenefit)
    const ratio = (code: string) => on.rows.find((r) => r.project.code === code)!.benefit / off.rows.find((r) => r.project.code === code)!.benefit
    expect(ratio('PRJ-1006')).toBeCloseTo(0.7) // stage 0
    expect(ratio('PRJ-1001')).toBeCloseTo(0.95) // stage 3
  })

  it('switching a measure off removes it from scoring; an added measure counts once projects carry amounts', () => {
    const off = { ...A, criteria: A.criteria.map((c) => (c.id === 'safety' ? { ...c, active: false } : c)) }
    expect(optimize(S, off).rows.every((r) => r.parts.safety === undefined)).toBe(true)
    const added: AllocationSettings = { ...A, criteria: [...A.criteria, { id: 'custom-1', label: 'Hydrogen readiness', unit: 'miles', help: 'Pipe rated for hydrogen blends', attribute: 'other', fullCredit: 10, weight: 10, active: true }] }
    expect(validateAllocation(added)).toEqual([])
    const p = S.projects.find((x) => x.code === 'PRJ-1007')!
    const before = optimize(S, added).rows.find((r) => r.project.id === p.id)!.benefit
    const S2 = produce(S, (d) => { setBenefits(d, p.id, { values: { 'custom-1': 2.3 } }, 'u-me') })
    expect(optimize(S2, added).rows.find((r) => r.project.id === p.id)!.benefit).toBeGreaterThan(before)
  })

  it('is deterministic and ignores community attributes (location.dac and everything else in location)', () => {
    const r = optimize(S, A)
    expect(fundedCodes(optimize(S, A))).toEqual(fundedCodes(r))
    const flipped = produce(S, (d) => { for (const p of d.projects) { p.location.dac = !p.location.dac; p.location.city = 'X'; p.location.district = 'North' } })
    const r2 = optimize(flipped, A)
    expect(fundedCodes(r2)).toEqual(fundedCodes(r))
    expect(r2.benefit).toBe(r.benefit)
  })

  it('rejects measures named or described by community, demographic or income attributes', () => {
    for (const label of ['Disadvantaged community', 'Median income', 'DAC share', 'Census tract poverty rate', 'Race / ethnicity mix', 'Home value']) {
      const bad = { ...A, criteria: [...A.criteria, { ...DEFAULT_CRITERIA[0], id: 'x', label }] }
      expect(validateAllocation(bad).join(' '), label).toMatch(/community, demographic or income/)
    }
    for (const c of DEFAULT_CRITERIA) expect(validateAllocation({ ...A, criteria: [c] }), c.id).toEqual([])
  })

  it('saves settings and benefit edits, clamps negatives, reports bad settings and describes changes for the audit log', () => {
    const p = S.projects[0]
    const d = produce(S, (x) => {
      saveAllocation(x, { weights: { safety: 80 }, decisions: { [p.id]: 'exclude' }, useConfidence: false })
      setBenefits(x, p.id, { values: { safety: -5, capacity: 3 }, confidence: 140 }, 'u-me')
    })
    const a2 = allocationOf(d)
    expect(a2.criteria.find((c) => c.id === 'safety')!.weight).toBe(80)
    expect(a2.decisions[p.id]).toBe('exclude')
    expect(a2.useConfidence).toBe(false)
    expect(d.projects[0].benefits).toMatchObject({ values: { safety: 0, capacity: 3 }, confidence: 100, updatedById: 'u-me' })
    const broken = { ...A, criteria: A.criteria.map((c) => ({ ...c, weight: 0, fullCredit: c.id === 'safety' ? 0 : c.fullCredit })), budget: -1 }
    expect(validateAllocation(broken)).toHaveLength(3)
    const ch = describeAllocationChange(A, { ...a2, criteria: a2.criteria.map((c) => (c.id === 'om' ? { ...c, active: false } : c)).filter((c) => c.id !== 'emissions') })
    expect(ch).toEqual(expect.arrayContaining(['Safety weight 35 → 80', 'O&M savings switched off', 'removed measure Emissions reduced', 'risk-adjust by delivery confidence off']))
  })
})
