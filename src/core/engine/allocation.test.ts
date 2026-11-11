import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AllocationSettings } from '../types'
import { DEFAULT_CRITERIA, activeCriteria, allocationOf, annualLimitDefault, authorizedFunding, costByYear, costToComplete, dependencyLoop, describeAllocationChange, optimize, saveAllocation, scoreBenefits, setBenefits, timeFactor, validateAllocation } from './allocation'

const S = buildSeed()
const A0 = allocationOf(S)
// most tests exercise the single-total knapsack; prerequisites get their own tests
const A = { ...A0, dependencies: [] }
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

  it('spreads cost to complete by year from this year on, and defaults yearly limits from authorized funding', () => {
    const y0 = Number(S.settings.asOf.slice(0, 4))
    for (const p of S.projects.filter((x) => x.status === 'active')) {
      const c = costToComplete(S, p), by = costByYear(S, p, c)
      expect(Object.values(by).reduce((a, b) => a + b, 0), p.code).toBe(c)
      for (const y of Object.keys(by)) expect(Number(y)).toBeGreaterThanOrEqual(y0)
    }
    const spent = S.costPeriods.filter((c) => c.period.startsWith(`${y0}-`)).reduce((a, c) => a + c.actual, 0)
    const auth = (y: number) => S.funding.filter((f) => f.year === y).reduce((a, f) => a + f.authorized, 0)
    expect(annualLimitDefault(S, String(y0)).amount).toBe(Math.max(0, auth(y0) - spent))
    expect(annualLimitDefault(S, String(y0 + 1)).amount).toBe(auth(y0 + 1))
    expect(annualLimitDefault(S, String(y0 + 5)).basis).toMatch(/Planning assumption/)
  })

  it('limits by year: never over a year\'s limit, deferral moves spend later, and allowing deferral never lowers benefit', () => {
    const r0 = optimize(S, { ...A, annual: { ...A.annual, on: true, maxDeferYears: 0 } })
    const r1 = optimize(S, { ...A, annual: { ...A.annual, on: true, maxDeferYears: 1 } })
    for (const r of [r0, r1]) {
      expect(r.mode).toBe('annual')
      expect(r.exact).toBe(true)
      for (const y of r.yearly) expect(y.funded + y.deferred, y.year).toBeLessThanOrEqual(Math.max(0, (y.limit ?? 0) - y.committed) + 1)
    }
    expect(r0.deferred).toBe(0)
    expect(r1.benefit).toBeGreaterThanOrEqual(r0.benefit - 1e-9)
    expect(r1.rows.some((x) => x.defer > 0)).toBe(true)
    const d = r1.rows.find((x) => x.defer > 0)!
    expect(d.counted).toBeLessThan(d.benefit) // later in service → discounted
  })

  it('prerequisites: never funds a project without its prerequisite, or earlier than it', () => {
    const pid = (c: string) => S.projects.find((p) => p.code === c)!.id
    const deps = [{ projectId: pid('PRJ-1021'), requiresId: pid('PRJ-1022') }, { projectId: pid('PRJ-1018'), requiresId: pid('PRJ-1017') }]
    for (const a of [{ ...A, budget: 1_200e6, dependencies: deps }, { ...A, dependencies: deps, annual: { ...A.annual, on: true, maxDeferYears: 2 } }]) {
      const r = optimize(S, a)
      expect(r.method).toBe('search')
      const st = (id: string) => r.rows.find((x) => x.project.id === id)!
      for (const dep of deps) {
        const x = st(dep.projectId), q = st(dep.requiresId)
        if (x.status === 'funded') { expect(['funded', 'committed', 'must']).toContain(q.status); expect(q.defer).toBeLessThanOrEqual(x.defer) }
      }
    }
    // 1021 needs 1022 at $1.2B: the optimizer would rather skip both than fund the pair
    const r = optimize(S, { ...A, budget: 1_200e6, dependencies: deps.slice(0, 1) })
    const x = r.rows.find((y) => y.project.code === 'PRJ-1021')!
    expect(x.status).toBe('unfunded')
    expect(x.note).toMatch(/Needs PRJ-1022/)
    // a committed project's prerequisite is funded too
    const c = optimize(S, { ...A, dependencies: [{ projectId: pid('PRJ-1001'), requiresId: pid('PRJ-1022') }] }).rows.find((y) => y.project.code === 'PRJ-1022')!
    expect(c.status).toBe('must')
    expect(c.note).toMatch(/Needed by PRJ-1001/)
    expect(dependencyLoop(deps, pid('PRJ-1022'), pid('PRJ-1021'))).toBe(true)
    expect(dependencyLoop(deps, pid('PRJ-1021'), pid('PRJ-1017'))).toBe(false)
  })

  it('the search finds the best plan with yearly limits, deferral and prerequisites (matches brute force)', () => {
    const base = optimize(S, A).rows.filter((x) => !x.locked).map((x) => x.project.id)
    const keep = base.slice(0, 8)
    const exclude = Object.fromEntries(base.filter((id) => !keep.includes(id)).map((id) => [id, 'exclude' as const]))
    const y0 = Number(S.settings.asOf.slice(0, 4))
    for (const scale of [0.35, 0.6]) {
      const limits = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(y0 + i), annualLimitDefault(S, String(y0 + i)).amount * scale]))
      const a = { ...A, decisions: exclude, dependencies: [{ projectId: keep[0], requiresId: keep[3] }, { projectId: keep[5], requiresId: keep[1] }], annual: { on: true, maxDeferYears: 1, limits } }
      const r = optimize(S, a)
      expect(r.exact).toBe(true)
      const items = r.rows.filter((x) => keep.includes(x.project.id))
      const locked = r.rows.filter((x) => x.locked)
      const years = r.yearly.map((y) => y.year)
      const capY = Object.fromEntries(years.map((y) => [y, Math.max(0, (r.yearly.find((q) => q.year === y)!.limit ?? 0) - locked.reduce((s2, x) => s2 + (x.byYear[y] ?? 0), 0))]))
      let best = 0
      const choice = new Array(items.length).fill(-1)
      const rec = (i: number) => {
        if (i === items.length) {
          const use: Record<string, number> = {}
          let b = 0
          for (let k = 0; k < items.length; k++) {
            const d = choice[k]; if (d < 0) continue
            for (const [y, v] of Object.entries(items[k].byYear)) { const yy = String(Number(y) + d); if (!(yy in capY)) return; use[yy] = (use[yy] ?? 0) + v }
            b += items[k].beforeTiming * timeFactor(S, a, items[k].inService, d)
          }
          for (const y of Object.keys(use)) if (use[y] > capY[y] + 1e-6) return
          for (const dep of a.dependencies) {
            const i1 = items.findIndex((x) => x.project.id === dep.projectId), i2 = items.findIndex((x) => x.project.id === dep.requiresId)
            if (choice[i1] >= 0 && (choice[i2] < 0 || choice[i2] > choice[i1])) return
          }
          if (b > best) best = b
          return
        }
        for (const d of [-1, 0, 1]) { choice[i] = d; rec(i + 1) }
      }
      rec(0)
      const lockedB = locked.reduce((s2, x) => s2 + x.benefit, 0)
      expect(r.benefit, `scale ${scale}`).toBeCloseTo(lockedB + best, 6)
    }
  })

  it('timing discounts benefit by the years until it is in service; off means no discount', () => {
    const a = { ...A, timing: { on: true, discountPct: 10 } }
    const y0 = Number(S.settings.asOf.slice(0, 4))
    expect(timeFactor(S, a, y0)).toBe(1)
    expect(timeFactor(S, a, y0 + 2)).toBeCloseTo(1 / 1.21)
    expect(timeFactor(S, a, y0 + 2, 1)).toBeCloseTo(1 / 1.331)
    expect(timeFactor(S, { ...a, timing: { on: false, discountPct: 10 } }, y0 + 5)).toBe(1)
    expect(optimize(S, { ...A, timing: { on: false, discountPct: 5 } }).maxBenefit).toBeGreaterThan(optimize(S, A).maxBenefit)
  })
})
