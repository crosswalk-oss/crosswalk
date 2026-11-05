import { produce } from 'immer'
import { buildSeed } from '../seed'
import { estimateTotals } from './estimates'
import { DEFAULT_RISK_ITEMS, adjustParametricEstimate, createParametricEstimate, monteCarloParametric, parametricInputsFromProject, priceParametric, riskItemsOf, risksFromProject, validateRiskItems } from './parametric'
import type { ParametricInputs, RiskLevel } from '../types'

const S = buildSeed()
const pipe = S.projects.find((p) => p.asset.lengthFt > 1000 && priceParametric(S, parametricInputsFromProject(S, p), p))!
const base = (): ParametricInputs => ({ ...parametricInputsFromProject(S, pipe), risks: Object.fromEntries(riskItemsOf(S).map((r) => [r.id, 'low' as RiskLevel])) })

describe('Class 5 parametric pricing', () => {
  it('prices from the rate table automatically: lines × length, region applied, totals tie out', () => {
    const r = priceParametric(S, base(), pipe)!
    expect(r.rateLines.length).toBeGreaterThan(0)
    expect(r.rateLines.every((l) => l.rateId)).toBe(true)
    expect(r.rateDirect).toBe(Math.round(r.rateLines.reduce((a, l) => a + l.qty * l.unitCost, 0)))
    expect(r.riskLines).toHaveLength(0) // all low → no allowances
    expect(r.base).toBe(r.direct + r.tax + r.loaderAmount + r.escalation)
    expect(r.total).toBe(r.base + r.contingency)
    expect(r.perFoot).toBeCloseTo(r.total / r.inputs.lengthFt, 6)
    const longer = priceParametric(S, { ...base(), lengthFt: base().lengthFt * 2 }, pipe)!
    expect(longer.rateDirect / r.rateDirect).toBeGreaterThan(1.5)
  })
  it('a region with a higher factor costs more', () => {
    const f = S.settings.estimating.regionFactors
    const [cheap, dear] = Object.keys(f).sort((a, b) => f[a] - f[b]).filter((k, i, a) => i === 0 || i === a.length - 1)
    expect(priceParametric(S, { ...base(), region: dear }, pipe)!.rateDirect).toBeGreaterThan(priceParametric(S, { ...base(), region: cheap }, pipe)!.rateDirect)
  })
  it('each risk item rated higher adds an itemized allowance and raises the point estimate', () => {
    const low = priceParametric(S, base(), pipe)!
    const med = priceParametric(S, { ...base(), risks: { ...base().risks, traffic: 'medium' } }, pipe)!
    const high = priceParametric(S, { ...base(), risks: { ...base().risks, traffic: 'high' } }, pipe)!
    expect(med.riskLines.map((l) => l.categoryId)).toEqual(['cat-traffic'])
    expect(med.risks.find((x) => x.id === 'traffic')!.amount).toBe(Math.round(low.rateDirect * 0.05))
    expect(high.base).toBeGreaterThan(med.base)
    expect(med.base).toBeGreaterThan(low.base)
  })
  it('estimator % adjustment is its own line and scales the result', () => {
    const r = priceParametric(S, base(), pipe, { adjustPct: 10 })!
    expect(r.adjustmentLine?.unitCost).toBe(Math.round(priceParametric(S, base(), pipe)!.direct * 0.1))
    expect(r.total).toBeGreaterThan(priceParametric(S, base(), pipe)!.total)
  })
})

describe('Monte Carlo', () => {
  it('is deterministic for a seed, with ordered percentiles; the estimate is funded at P80', () => {
    const a = priceParametric(S, { ...base(), risks: { ...base().risks, soil: 'high', permits: 'medium' } }, pipe)!
    const b = priceParametric(S, { ...base(), risks: { ...base().risks, soil: 'high', permits: 'medium' } }, pipe)!
    expect(a.mc.p).toEqual(b.mc.p)
    expect(a.mc.p.P10).toBeLessThanOrEqual(a.mc.p.P50)
    expect(a.mc.p.P50).toBeLessThanOrEqual(a.mc.p.P80)
    expect(a.mc.p.P80).toBeLessThanOrEqual(a.mc.p.P90)
    expect(Math.abs(a.total - a.mc.p.P80) / a.mc.p.P80).toBeLessThan(0.002)
    expect(a.contingency).toBeGreaterThanOrEqual(0)
    expect(a.mc.histogram.reduce((s, h) => s + h.n, 0)).toBe(a.mc.iterations)
  })
  it('P50 sits at or a little above the most-likely figure (cost risk skews up)', () => {
    const r = priceParametric(S, { ...base(), risks: { ...base().risks, traffic: 'medium', crossings: 'medium' } }, pipe)!
    expect(r.mc.p.P50).toBeGreaterThanOrEqual(r.base * 0.98)
    expect(r.mc.p.P50 / r.base - 1).toBeLessThan(0.15)
  })
  it('raising an item to high moves P80 up and widens the range', () => {
    const lo = priceParametric(S, base(), pipe)!
    const hi = priceParametric(S, { ...base(), risks: { ...base().risks, soil: 'high' } }, pipe)!
    expect(hi.mc.p.P80).toBeGreaterThan(lo.mc.p.P80)
    expect(hi.mc.p.P90 - hi.mc.p.P10).toBeGreaterThan(lo.mc.p.P90 - lo.mc.p.P10)
  })
  it('the tornado is sorted by swing and names the rated items', () => {
    const r = priceParametric(S, { ...base(), risks: { ...base().risks, soil: 'high', workhours: 'medium' } }, pipe)!
    const sw = r.mc.tornado.map((t) => t.swing)
    expect(sw).toEqual([...sw].sort((a, b) => b - a))
    expect(r.mc.tornado.some((t) => t.id === 'soil')).toBe(true)
    expect(r.mc.tornado.some((t) => t.id === 'rate-table')).toBe(true)
  })
  it('handles a degenerate rate spread without NaN', () => {
    const mc = monteCarloParametric({ rateP10: 100, rateP50: 100, rateP90: 100, risks: [], markup: 1.2, rateDirect: 100 }, 1000, 3)
    expect(mc.p.P10).toBe(120)
    expect(mc.p.P90).toBe(120)
  })
})

describe('Risk items: fair and administrable', () => {
  it('the default items are physical, legal or logistical and validate', () => {
    expect(validateRiskItems(DEFAULT_RISK_ITEMS)).toEqual([])
    expect(validateRiskItems([{ ...DEFAULT_RISK_ITEMS[0], id: 'x', name: 'Disadvantaged community', help: '' }]).join()).toMatch(/physical, legal or logistical/)
    expect(validateRiskItems([{ ...DEFAULT_RISK_ITEMS[0], id: 'y', levels: { ...DEFAULT_RISK_ITEMS[0].levels, low: { label: 'x', min: 5, mode: 1, max: 2 } } }]).join()).toMatch(/min ≤ most likely ≤ max/)
  })
  it('pre-fills ratings from the project drivers', () => {
    const urban = S.projects.find((p) => p.location.terrain === 'urban')!
    expect(risksFromProject(S, urban).restoration).toBe('high')
    expect(Object.keys(risksFromProject(S, urban)).sort()).toEqual(riskItemsOf(S).map((r) => r.id).sort())
  })
  it('estimates are identical whether or not the project is flagged as a disadvantaged community', () => {
    for (const p of S.projects.filter((x) => x.asset.lengthFt > 0).slice(0, 10)) {
      const flipped = produce(S, (d) => { const q = d.projects.find((x) => x.id === p.id)!; q.location.dac = !q.location.dac })
      const q2 = flipped.projects.find((x) => x.id === p.id)!
      const a = priceParametric(S, parametricInputsFromProject(S, p), p), b = priceParametric(flipped, parametricInputsFromProject(flipped, q2), q2)
      expect(b?.total).toBe(a?.total)
      expect(b?.mc.p).toEqual(a?.mc.p)
      expect(JSON.stringify(parametricInputsFromProject(S, p))).not.toMatch(/dac/)
    }
  })
})

describe('Saved estimates and estimator review', () => {
  it('a PM request creates a priced draft; totals match the pricing; audited', () => {
    const i = { ...base(), risks: { ...base().risks, traffic: 'high' as RiskLevel } }
    let id = ''
    const s2 = produce(S, (d) => { id = createParametricEstimate(d, pipe.id, i, 'Planning budget', 'u-pm1')!.id })
    const e = s2.estimates.find((x) => x.id === id)!
    const r = priceParametric(S, i, pipe)!
    expect(estimateTotals(e).total).toBe(r.total)
    expect(e.parametric?.mc.p).toEqual(r.mc.p)
    expect(e.contingency).toMatchObject({ method: 'risk-based', confidence: 'P80' })
    expect(e.basis?.contingencyRationale).toMatch(/Monte Carlo/)
    expect(s2.audit.at(-1)?.summary).toMatch(/parametric estimate/)
  })
  it('the estimator can change ratings and apply a %; before/after and the reason are kept', () => {
    let id = ''
    let s2 = produce(S, (d) => { id = createParametricEstimate(d, pipe.id, base(), 'x', 'u-pm1')!.id })
    const before = estimateTotals(s2.estimates.find((x) => x.id === id)!).total
    s2 = produce(s2, (d) => adjustParametricEstimate(d, id, { risks: { soil: 'high' }, pct: 5, reason: 'Geotech shows rock' }, 'u-est1'))
    const e = s2.estimates.find((x) => x.id === id)!
    expect(e.parametric?.inputs.risks.soil).toBe('high')
    expect(e.parametric?.adjustment).toMatchObject({ pct: 5, fromTotal: before, byId: 'u-est1' })
    expect(e.parametric?.adjustment?.changed.join()).toMatch(/Soil & rock conditions low → high/)
    expect(estimateTotals(e).total).toBeGreaterThan(before)
    expect(s2.audit.at(-1)).toMatchObject({ action: 'adjust', actorId: 'u-est1' })
  })
})
