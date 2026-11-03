import { produce } from 'immer'
import { buildSeed } from '../seed'
import { computeClass, estimateTotals, maturityItems, parametricLines, ratesFor, regionalUnitCost } from './estimates'
import { applyReprice, currentEstimateOf, keepHistorical, pricedOnVersion, publishRateTable, rateTableVersionAt, repriceCandidates, salesTaxFor, scopeQuantities } from './estimatingAdmin'
import { computeQuick, inputsFromProject } from './quick'

const s = buildSeed()
const P = (code: string) => s.projects.find((p) => p.code === code)!

test('sales tax is weighted by the county split and lands in taxable categories', () => {
  const split = s.projects.find((p) => (p.counties?.length ?? 0) > 1)!
  const t = salesTaxFor(s, split)
  const rate = (c: string) => s.settings.estimating.taxRates.find((x) => x.county === c)!.rate
  const expect_ = split.counties!.reduce((a, c) => a + (c.pct / 100) * rate(c.county), 0)
  expect(t.pct).toBeCloseTo(expect_, 2)
  const e = { cls: 3 as const, lines: [{ id: 'a', categoryId: 'cat-pipe', workPackage: '', description: '', qty: 100, unit: 'ft', unitCost: 100, source: 'library' as const, confidence: 'medium' as const }, { id: 'b', categoryId: 'cat-contract', workPackage: '', description: '', qty: 1, unit: 'LS', unitCost: 10000, source: 'library' as const, confidence: 'medium' as const }], loaders: [], escalationPct: 0, contingency: { method: 'deterministic' as const, pct: 0 }, salesTax: { pct: 10, counties: [], categoryIds: ['cat-pipe'] } }
  const tt = estimateTotals(e)
  expect(tt.tax).toBe(1000)
  expect(tt.lines).toBe(20000)
  expect(tt.byCategory['cat-pipe']).toBe(11000)
  expect(tt.total).toBe(21000)
  // estimates without a stamp are unchanged
  expect(estimateTotals({ ...e, salesTax: undefined }).total).toBe(20000)
})

test('region selects regional rows, else base × factor', () => {
  const p = P('PRJ-1001') // West
  const cfg = s.settings.estimating
  const pool = s.rates.filter((r) => r.assetType === p.asset.type && r.workMethod === p.workMethod && !r.region)
  const r0 = pool.find((r) => r.categoryId === 'cat-traffic' && r.terrain === p.location.terrain)!
  const rates = [...s.rates.filter((r) => !r.region), { ...r0, id: 'rate-west-traffic', region: 'West', p50: 999 }, { ...r0, id: 'rate-east-traffic', region: 'East', p50: 1 }]
  const picked = ratesFor(p, rates).find((r) => r.categoryId === 'cat-traffic')!
  expect(picked.id).toBe('rate-west-traffic')
  const lines = parametricLines(p, rates, { region: 'West', regionFactors: cfg.regionFactors })
  expect(lines.find((l) => l.categoryId === 'cat-traffic')!.unitCost).toBe(999)
  const pipe = lines.find((l) => l.categoryId === 'cat-pipe')!
  const base = s.rates.find((r) => r.id === pipe.rateId)!
  expect(pipe.unitCost).toBeCloseTo(regionalUnitCost(base, { region: 'West', regionFactors: cfg.regionFactors }).unitCost, 2)
  expect(pipe.unitCost).toBeGreaterThan(base.p50) // West factor > 1
  expect(rates.filter((r) => r.region === 'East').some((r) => ratesFor(p, rates).includes(r))).toBe(false)
})

test('scope statement feeds the rate-table estimate inputs', () => {
  const p = P('PRJ-1001')
  const q = scopeQuantities(s, p)
  expect(q.lengthFt).toBeGreaterThan(0)
  const v = P('PRJ-1026')
  expect(scopeQuantities(s, v).sites).toBe(3)
})

test('maturity checklist comes from settings', () => {
  const items = maturityItems(s)
  expect(items.length).toBeGreaterThan(5)
  const all3 = Object.fromEntries(items.map((m) => [m.key, m.forClass >= 3]))
  expect(computeClass(all3, items)).toBe(3)
  const extra = [...items, { key: 'x-new', label: 'New', forClass: 3 as const, hint: '' }]
  expect(computeClass(all3, extra)).toBe(4)
})

test('rate table versions, bulk reprice and keep decisions', () => {
  const v = s.settings.estimating.rateTableVersion
  expect(rateTableVersionAt(s, '2025-03-01T00:00:00Z')).toBe(1)
  const plans = repriceCandidates(s)
  expect(plans.length).toBeGreaterThan(3)
  expect(plans.every((p) => p.fromVersion < v && p.estimate.method !== 'quick')).toBe(true)
  const ok = plans.filter((p) => p.eligible)
  expect(ok.length).toBeGreaterThan(0)

  const st = produce(s, (d) => {
    const r = applyReprice(d, ok.slice(0, 2).map((p) => p.estimate.id), 'test')
    expect(r.created.length + r.updated.length).toBe(2)
    for (const e of r.created) {
      expect(e.status).toBe('draft')
      expect(e.rateTableVersion).toBe(v)
      expect(e.loaders.length).toBeGreaterThan(0)
      expect(e.salesTax).toBeDefined()
    }
    keepHistorical(d, [ok[2]?.estimate.id ?? ok[0].estimate.id], 'construction under way')
  })
  const after = repriceCandidates(st)
  expect(after.length).toBe(plans.length - 2)
  expect(after.some((p) => p.kept)).toBe(true)
  for (const p of ok.slice(0, 2)) expect(pricedOnVersion(st, currentEstimateOf(st, p.project.id)!)).toBe(v)

  const st2 = produce(st, (d) => {
    const rates = d.rates.map((r) => (r.categoryId === 'cat-contract' ? { ...r, p50: Math.round(r.p50 * 1.1) } : r))
    const res = publishRateTable(d, JSON.parse(JSON.stringify(rates)), 'contract +10%')
    expect(res.version).toBe(v + 1)
    expect(res.changes.length).toBeGreaterThan(5)
  })
  expect(st2.settings.estimating.rateTableHistory.slice(-1)[0].note).toBe('contract +10%')
  const after2 = repriceCandidates(st2)
  expect(after2.length).toBeGreaterThan(after.length) // the fresh drafts are now stale too
  expect(after2.some((p) => !p.eligible && p.estimate.status === 'in-review')).toBe(true)
})

test('quick estimates read region factors and class 5 contingency from administration', () => {
  const p = P('PRJ-1006')
  const i = inputsFromProject(s, p)
  const a = computeQuick(s, i)
  const st = produce(s, (d) => { d.settings.estimating.regionFactors[p.location.district] = 2; d.settings.estimating.contingencyByClass['5'] = 40 })
  const b = computeQuick(st, i)
  expect(b.contingencyPct).toBe(40)
  expect(b.direct).toBeGreaterThan(a.direct * 1.5)
})
