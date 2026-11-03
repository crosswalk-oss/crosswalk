import { buildSeed } from '@/core/seed'
import { candidates, rank, fit, suggestFit, capacity, newScenario, shifted } from './model'

const s = buildSeed()
const years = [2026, 2027, 2028, 2029, 2030]

test('candidates exclude closed projects and carry risk reduced', () => {
  const cs = candidates(s)
  expect(cs.some((c) => c.project.status === 'closed')).toBe(false)
  expect(cs.length).toBeGreaterThan(20)
  expect(cs.every((c) => c.riskReduced >= 0)).toBe(true)
  expect(cs.filter((c) => c.proposed).length).toBeGreaterThan(0)
})

test('rank normalizes to 100 and puts mandatory first', () => {
  const sc = newScenario('t', '2026-10-28')
  const r = rank(candidates(s), sc)
  expect(Math.max(...r.map((x) => x.score))).toBe(100)
  const firstOptional = r.findIndex((x) => !x.mandatory)
  expect(r.slice(firstOptional).every((x) => !x.mandatory)).toBe(true)
})

test('shift moves only future years', () => {
  expect(shifted({ '2026': 10, '2027': 20, '2028': 5 }, 1, 2026)).toEqual({ '2026': 10, '2028': 20, '2029': 5 })
})

test('fit and suggestFit reduce over-authorization', () => {
  const cs = candidates(s)
  const sc = newScenario('t', '2026-10-28')
  // make a non-mandatory program tight
  for (const id of Object.keys(sc.items)) delete sc.items[id]
  const f0 = fit(s, cs, sc, years)
  const { scenario, moves } = suggestFit(s, cs, sc, years)
  const f1 = fit(s, cs, scenario, years)
  console.log('over before', f0.overAmount, f0.overYears, 'after', f1.overAmount, f1.overYears, moves.slice(0, 5))
  expect(f1.overAmount).toBeLessThanOrEqual(f0.overAmount)
  const cap = capacity(cs, scenario, years, 2026)
  expect(cap.districts.length).toBeGreaterThan(1)
})
