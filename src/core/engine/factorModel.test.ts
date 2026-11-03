import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import type { AppState, FactorModel } from '../types'
import { buildSeed } from '../seed'
import { sum } from '../util'
import { estimateTotals } from './estimates'
import {
  DRIVER_KEYS, adjustFactorEstimate, backtest, baseRateFor, createFactorEstimate, diffModels, discardDraft, factorInputsFromProject, gateCheck,
  levelOf, monteCarloFactor, newDraft, openDraft, priceFactor, publishedModel, rateTableEstimate, saveDraft, validateModel,
} from './factorModel'
import { returnedForRevision, submitBlockers, submitFactorModel, withdrawFactorModel } from './factorWorkflow'
import { actOnWorkflow, tasksFor } from './workflow'

const S = buildSeed()
const pub = publishedModel(S)!
const proj = (code: string) => S.projects.find((p) => p.code === code)!

describe('Factor model seed', () => {
  it('has exactly one published model, a draft, and a retired version', () => {
    expect(S.factorModels.filter((m) => m.status === 'published')).toHaveLength(1)
    expect(openDraft(S)?.status).toBe('draft')
    expect(S.factorModels.some((m) => m.status === 'retired')).toBe(true)
    expect(S.settings.factorModel.overrideReasons.length).toBeGreaterThanOrEqual(4)
  })
  it('every project has drivers and the backtest set has ~60 closed projects', () => {
    for (const p of S.projects) expect(p.drivers, p.code).toBeTruthy()
    expect(S.backtestProjects.length).toBeGreaterThanOrEqual(55)
    expect(S.backtestProjects.every((r) => r.actual > 0)).toBe(true)
  })
  it('seed is deterministic', () => {
    const T = buildSeed()
    expect(T.backtestProjects.map((r) => r.actual)).toEqual(S.backtestProjects.map((r) => r.actual))
    expect(T.projects.map((p) => p.drivers)).toEqual(S.projects.map((p) => p.drivers))
  })
  it('base rates start from the historical cost table P50s', () => {
    for (const b of pub.baseRates) expect(S.historicalCosts.find((h) => h.id === b.sourceRowId)?.p50).toBe(b.rate)
  })
})

describe('Pricing', () => {
  const p = proj('PRJ-1005')
  const i = factorInputsFromProject(S, p)
  const r = priceFactor(S, pub, i)
  it('finds a base rate and itemizes every driver; item effects add up to direct − baseline', () => {
    expect(r.base).toBeTruthy()
    expect(r.match).toBe('exact')
    expect(sum(r.items.map((x) => x.effect))).toBe(r.direct - r.baseline)
    const applicable = pub.factors.filter((f) => !f.appliesTo || f.appliesTo.includes(i.assetType))
    for (const f of applicable) expect(r.items.some((x) => x.id === f.id)).toBe(true)
    expect(r.items.some((x) => x.id === 'region')).toBe(true)
    expect(r.items.some((x) => x.id === 'escalation')).toBe(true)
  })
  it('direct follows the formula and the total matches the estimate tables', () => {
    const expected = r.baseline * r.scale * r.factorProduct * r.regionFactor * r.escalationFactor
    expect(Math.abs(r.direct - expected)).toBeLessThanOrEqual(1)
    expect(r.total).toBe(estimateTotals({ lines: r.lines, loaders: S.settings.loaderRates.filter((x) => x.year === 2026), escalationPct: 0, contingency: { method: 'deterministic', pct: r.contingencyPct }, cls: 5, salesTax: r.salesTax }).total)
    expect(r.p10).toBeLessThan(r.p50)
    expect(r.p90).toBeGreaterThan(r.p50)
    expect(r.p90 / r.p50).toBeCloseTo(Math.exp(1.2816 * r.sigma), 3)
  })
  it('a driver moves the cost by its weighted multiplier; weight 0 makes it neutral', () => {
    const soft = { ...i, site: { ...i.site, soil: 'normal' as const } }
    const rock = { ...i, site: { ...i.site, soil: 'rock' as const } }
    const m = pub.factors.find((f) => f.id === 'f-soil')!.levels.find((l) => l.value === 'rock')!.multiplier
    expect(priceFactor(S, pub, rock).direct / priceFactor(S, pub, soft).direct).toBeCloseTo(m, 3)
    const zero: FactorModel = { ...pub, factors: pub.factors.map((f) => (f.id === 'f-soil' ? { ...f, weight: 0 } : f)) }
    expect(priceFactor(S, zero, rock).direct).toBe(priceFactor(S, zero, soft).direct)
    expect(priceFactor(S, { ...pub, factors: pub.factors.map((f) => (f.id === 'f-soil' ? { ...f, weight: 0.5 } : f)) }, rock).direct / priceFactor(S, pub, soft).direct).toBeCloseTo(1 + 0.5 * (m - 1), 3)
  })
  it('size scale: below 1 the unit cost falls as quantity grows', () => {
    const small = priceFactor(S, pub, { ...i, qty: 2000 }), big = priceFactor(S, pub, { ...i, qty: 40000 })
    expect(big.direct / 40000).toBeLessThan(small.direct / 2000)
    expect(priceFactor(S, { ...pub, scaleExponent: 1 }, { ...i, qty: 40000 }).scale).toBe(1)
  })
  it('crossings are banded; booleans read yes/no', () => {
    const d = { ...i.site, terrain: i.terrain }
    expect(levelOf({ ...d, crossings: 0 }, 'crossings')).toBe('0')
    expect(levelOf({ ...d, crossings: 2 }, 'crossings')).toBe('1-2')
    expect(levelOf({ ...d, crossings: 7 }, 'crossings')).toBe('6+')
    expect(levelOf({ ...d, hca: true }, 'hca')).toBe('yes')
  })
  it('falls back to the nearest diameter band, and reports none for an asset it has no rate for', () => {
    expect(baseRateFor(pub, { assetType: 'transmission-pipeline', workMethod: 'replace-open-trench', diameterBand: 'le-8' }).match).toBe('nearest-band')
    expect(baseRateFor(pub, { assetType: 'storage-field', workMethod: 'abandon', diameterBand: 'n/a' }).match).toBe('none')
  })
  it('the rate-table comparison prices the same project', () => {
    expect(rateTableEstimate(S, p)!.total).toBeGreaterThan(0)
  })
})

describe('Backtest and publish gate', () => {
  const bt = backtest(S, pub)
  it('backtests every closed project and reports accuracy by asset type', () => {
    expect(bt.n).toBe(S.backtestProjects.length)
    expect(sum(bt.byAsset.map((g) => g.n))).toBe(bt.n)
    expect(bt.points.every((x) => x.p10 < x.predicted && x.predicted < x.p90)).toBe(true)
  })
  it('the published model meets the default gate', () => {
    const g = gateCheck(bt, S.settings.factorModel.gate)
    expect(g.reasons).toEqual([])
    expect(bt.mape).toBeLessThanOrEqual(25)
    expect(bt.coverage).toBeGreaterThanOrEqual(70)
    expect(bt.coverage).toBeLessThanOrEqual(95)
  })
  it('a badly calibrated model fails the gate with reasons', () => {
    const wide = { ...pub, baseCv: 0.9 }
    const g = gateCheck(backtest(S, wide), S.settings.factorModel.gate)
    expect(g.ok).toBe(false)
    expect(g.reasons.join()).toMatch(/P10–P90/)
    const biased: FactorModel = { ...pub, baseRates: pub.baseRates.map((b) => ({ ...b, rate: b.rate * 1.5 })) }
    expect(gateCheck(backtest(S, biased), S.settings.factorModel.gate).reasons.join()).toMatch(/Bias/)
  })
  it('validation rejects out-of-range weights and a baseline level that is not 1', () => {
    const bad: FactorModel = { ...pub, factors: pub.factors.map((f, k) => (k === 0 ? { ...f, weight: 1.5, levels: f.levels.map((l) => ({ ...l, multiplier: 1.1 })) } : f)) }
    const v = validateModel(bad)
    expect(v.some((x) => /weight/.test(x))).toBe(true)
    expect(v.some((x) => /baseline/.test(x))).toBe(true)
  })
})

describe('Versions, submission and approval', () => {
  it('diffs report weight and multiplier changes', () => {
    const draft = openDraft(S)!
    const d = diffModels(pub, draft)
    expect(d.some((x) => /Traffic: weight 0\.80 → 0\.90/.test(x))).toBe(true)
    expect(d.some((x) => /Rock: ×1\.35 → ×1\.42/.test(x))).toBe(true)
  })
  it('save draft writes a diff to the audit trail; only one open draft at a time', () => {
    const draft = openDraft(S)!
    const next = produce(S, (d) => { saveDraft(d, { ...draft, factors: draft.factors.map((f) => (f.id === 'f-hours' ? { ...f, weight: 0.7 } : f)) }, 'u-est2') })
    expect(next.audit[next.audit.length - 1].summary).toMatch(/Work-hour restrictions: weight 1\.00 → 0\.70/)
    let again: unknown = 'x'
    produce(S, (d) => { again = newDraft(d, 'u-est1') })
    expect(again).toBeUndefined()
  })
  it('submit is blocked with reasons when the gate fails, and nothing changes', () => {
    const draft = openDraft(S)!
    const s1 = produce(S, (d) => { d.settings.factorModel.gate.maxMape = 5 })
    expect(submitBlockers(s1, draft.id)[0]).toMatch(/Mean absolute % error/)
    let res: ReturnType<typeof submitFactorModel> | undefined
    const s2 = produce(s1, (d) => { res = submitFactorModel(d, draft.id, 'u-est2') })
    expect(res!.ok).toBe(false)
    expect(s2.factorModels.find((m) => m.id === draft.id)!.status).toBe('draft')
    expect(s2.workflows.length).toBe(s1.workflows.length)
  })
  it('submit → estimating lead approves → published; prior version retired; audited', () => {
    const draft = openDraft(S)!
    let res: ReturnType<typeof submitFactorModel> | undefined
    let s: AppState = produce(S, (d) => { res = submitFactorModel(d, draft.id, 'u-est2', 'Refit after closeouts') })
    expect(res!.ok).toBe(true)
    const m = s.factorModels.find((x) => x.id === draft.id)!
    expect(m.status).toBe('in-review')
    expect(m.backtest?.passed).toBe(true)
    const task = tasksFor(s, 'u-estl').find((t) => t.inst.id === res!.instId)!
    expect(task.node.id).toBe('lead')
    s = produce(s, (d) => { actOnWorkflow(d, res!.instId!, 'lead', 'u-estl', 'approve', 'Approved') })
    expect(s.factorModels.find((x) => x.id === draft.id)!.status).toBe('published')
    expect(s.factorModels.find((x) => x.id === pub.id)!.status).toBe('retired')
    expect(s.factorModels.filter((x) => x.status === 'published')).toHaveLength(1)
    expect(s.audit.some((a) => a.entityId === draft.id && a.action === 'publish')).toBe(true)
    expect(s.audit.some((a) => a.entityId === pub.id && a.action === 'retire')).toBe(true)
    // new quick estimates price on the newly published version
    const e = produce(s, (d) => { createFactorEstimate(d, proj('PRJ-1014').id, factorInputsFromProject(d, proj('PRJ-1014')), 'x') }).estimates.at(-1)!
    expect(e.factor?.modelVersion).toBe(m.version)
  })
  it('the person who submitted a model cannot approve it, even as an estimating lead or admin', () => {
    const draft = openDraft(S)!
    let res: ReturnType<typeof submitFactorModel> | undefined
    const s = produce(S, (d) => { res = submitFactorModel(d, draft.id, 'u-estl') })
    expect(res!.ok).toBe(true)
    expect(() => produce(s, (d) => { actOnWorkflow(d, res!.instId!, 'lead', 'u-estl', 'approve', 'Self') })).toThrow(/cannot approve/)
    expect(s.factorModels.find((x) => x.id === draft.id)!.status).toBe('in-review')
  })
  it('returned in review goes back to an editable draft; discard keeps the record as retired', () => {
    const draft = openDraft(S)!
    let res: ReturnType<typeof submitFactorModel> | undefined
    let s: AppState = produce(S, (d) => { res = submitFactorModel(d, draft.id, 'u-est2') })
    s = produce(s, (d) => { actOnWorkflow(d, res!.instId!, 'lead', 'u-estl', 'return', 'Explain the rock change') })
    expect(returnedForRevision(s, draft.id)?.event?.comment).toBe('Explain the rock change')
    s = produce(s, (d) => { expect(withdrawFactorModel(d, draft.id, 'u-est2')).toBe(true) })
    expect(s.factorModels.find((x) => x.id === draft.id)!.status).toBe('draft')
    // rejected outright: back to draft too
    s = produce(s, (d) => { res = submitFactorModel(d, draft.id, 'u-est2') })
    s = produce(s, (d) => { actOnWorkflow(d, res!.instId!, 'lead', 'u-estl', 'reject', 'Not this cycle') })
    expect(s.factorModels.find((x) => x.id === draft.id)!.status).toBe('draft')
    s = produce(s, (d) => { discardDraft(d, draft.id, 'u-est2') })
    expect(s.factorModels.find((x) => x.id === draft.id)!.status).toBe('retired')
    s = produce(s, (d) => { newDraft(d, 'u-est1') })
    expect(openDraft(s)?.parentVersion).toBe(pub.version)
  })
})

describe('Monte Carlo', () => {
  const r = priceFactor(S, pub, factorInputsFromProject(S, proj('PRJ-1001')))
  const mc = monteCarloFactor(r, 5000, 11)
  it('is seeded and pure', () => {
    expect(monteCarloFactor(r, 5000, 11)).toEqual(mc)
    expect(monteCarloFactor(r, 5000, 12).p.P50).not.toBe(mc.p.P50)
  })
  it('centres on the point estimate and matches the analytic range', () => {
    expect(Math.abs(mc.p.P50 / r.total - 1)).toBeLessThan(0.03)
    expect(Math.abs(mc.p.P10 / r.p10 - 1)).toBeLessThan(0.04)
    expect(Math.abs(mc.p.P90 / r.p90 - 1)).toBeLessThan(0.04)
    expect(mc.p.P80).toBeLessThan(mc.p.P90)
  })
  it('histogram, S-curve and tornado', () => {
    expect(sum(mc.histogram.map((b) => b.n))).toBe(5000)
    expect(mc.scurve[0].pct).toBe(0)
    expect(mc.scurve.at(-1)!.pct).toBe(100)
    for (let k = 1; k < mc.scurve.length; k++) expect(mc.scurve[k].value).toBeGreaterThanOrEqual(mc.scurve[k - 1].value)
    expect(sum(mc.tornado.map((t) => t.share))).toBeCloseTo(1, 6)
    expect(mc.tornado[0].id).toBe('base')
  })
})

describe('Quick estimates on the factor model', () => {
  const p = proj('PRJ-1014')
  it('creates a Class 5 quick estimate whose totals equal the model price, with drivers, range and BOE', () => {
    const i = factorInputsFromProject(S, p)
    const r = priceFactor(S, pub, i, { salesTax: undefined })
    const next = produce(S, (d) => { createFactorEstimate(d, p.id, i, 'test') })
    const e = next.estimates.at(-1)!
    expect(e.method).toBe('quick')
    expect(e.cls).toBe(5)
    expect(e.factor?.modelVersion).toBe(pub.version)
    expect(Math.abs(estimateTotals(e).total - r.total)).toBeLessThanOrEqual(2)
    expect(e.factor?.items.length).toBeGreaterThan(4)
    expect(e.quick?.range.low).toBe(e.factor?.p10)
    expect(e.basis.scopeBasis).toMatch(/factor model v2/)
    expect(e.factor?.rateTable).toBeGreaterThan(0)
  })
  it('estimator adjustment needs a reason; before/after kept; BOE records it', () => {
    const e0 = S.estimates.find((e) => e.factor && e.status === 'in-review')!
    const next = produce(S, (d) => { adjustFactorEstimate(d, e0.id, { pct: -10, reason: S.settings.factorModel.overrideReasons[1], note: 'Shorter route' }, 'u-est2') })
    const e = next.estimates.find((x) => x.id === e0.id)!
    expect(e.quick!.adjustment!.pct).toBe(-10)
    expect(e.quick!.adjustment!.toTotal).toBe(estimateTotals(e).total)
    expect(e.quick!.adjustment!.toTotal / e.quick!.adjustment!.fromTotal).toBeCloseTo(0.9, 2)
    expect(e.factor!.adjustment!.reason).toBe(S.settings.factorModel.overrideReasons[1])
    expect(e.basis.assumptions.join(' ')).toMatch(/Shorter route/)
    expect(next.audit.at(-1)!.summary).toMatch(/−?-?10%: \$[\d.]+M → \$[\d.]+M — /)
  })
  it('driver keys are a closed list', () => {
    expect([...DRIVER_KEYS].sort()).toEqual(['classLocation', 'crossings', 'hca', 'permitComplexity', 'remoteness', 'soil', 'terrain', 'traffic', 'workHours'])
  })
})
