import { produce } from 'immer'
import type { AppState } from '@/core/types'
import { buildSeed } from '@/core/seed'
import { estimateTotals } from '@/core/engine/estimates'
import { createFactorEstimate, factorInputsFromProject } from '@/core/engine/factorModel'
import { computeQuick, findHistorical, inputsFromProject } from '@/core/engine/quick'
import { actOnWorkflow, recallWorkflow, tasksFor } from '@/core/engine/workflow'
import { toCSV } from '@/core/download'
import {
  aaceCompare, adjustmentHistory, applyAdjustment, applyImport, canAdjust, deriveSuggestions, historicalCsvRows, matchNote, mixTotal, normalizeInputs,
  parseHistoricalCsv, planImport, previewAdjust, quickEligibility, readCsv, returnedToRequester, reviseQuickRequest, storedMatch, submitQuickRequest, validateHistorical, toFactorInputs, modelNote,
} from './lib'

const seed = buildSeed()
const pid = (s: AppState, code: string) => s.projects.find((p) => p.code === code)!.id

describe('quick estimate lib', () => {
  test('rows kept without a diameter band cover every diameter (no nearest-band fallback)', () => {
    const p = seed.projects.find((x) => x.code === 'PRJ-1006')! // hydrotest, 10"–16"
    const m = findHistorical(seed, inputsFromProject(seed, p))
    expect(m.row?.diameterBand).toBe('n/a')
    expect(m.match).toBe('exact')
    const v = seed.projects.find((x) => x.code === 'PRJ-1027')! // valve automation: one row for all sizes and settings
    const mv = findHistorical(seed, inputsFromProject(seed, v))
    expect(mv.match).toBe('any-terrain')
    expect(matchNote(seed, mv, inputsFromProject(seed, v)).tone).not.toBe('bad')
  })

  test('matchNote flags fallbacks, small samples and no data', () => {
    const i = normalizeInputs({ ...inputsFromProject(seed, seed.projects.find((x) => x.code === 'PRJ-1001')!), diameterBand: 'le-8' })
    const r = computeQuick(seed, i)
    expect(r.match).toBe('nearest-band')
    expect(matchNote(seed, r, i).tone).toBe('warn')
    const none = normalizeInputs({ ...i, assetType: 'distribution-main', workMethod: 'replace-hdd' })
    expect(matchNote(seed, computeQuick(seed, none), none).tone).toBe('bad')
  })

  test('normalizeInputs keeps method, unit and band consistent with the asset', () => {
    const i = normalizeInputs({ ...inputsFromProject(seed, seed.projects[0]), assetType: 'compressor-station' }, 'transmission-pipeline')
    expect(i.workMethod).toBe('compressor-replacement')
    expect(i.unit).toBe('hp')
    expect(i.diameterBand).toBe('n/a')
    expect(i.qty).toBe(10000)
  })

  test('AACE comparison of the historical spread', () => {
    const a = aaceCompare({ total: 100, low: 70, high: 150 })
    expect(a.lo).toBeCloseTo(-0.3)
    expect(a.hi).toBeCloseTo(0.5)
    expect(a.inside).toBe(true)
    expect(aaceCompare({ total: 100, low: 40, high: 150 }).inside).toBe(false)
  })

  test('eligibility blocks a second request while one is in review, and projects with an approved Class 3', () => {
    expect(quickEligibility(seed, pid(seed, 'PRJ-1012')).ok).toBe(false) // in review
    expect(quickEligibility(seed, pid(seed, 'PRJ-1001')).ok).toBe(false) // approved Class 3
    expect(quickEligibility(seed, pid(seed, 'PRJ-1006')).ok).toBe(true) // approved Class 5 can be re-requested
  })

  test('request → estimator adjusts → approve: approved with the adjustment recorded', () => {
    let s: AppState = produce(seed, (d) => { d.currentUserId = 'u-pm1' })
    const p = s.projects.find((x) => x.code === 'PRJ-1005')!
    const inputs = inputsFromProject(s, p)
    let res = { ok: false, estimateId: '', instId: '' } as ReturnType<typeof submitQuickRequest>
    s = produce(s, (d) => { res = submitQuickRequest(d, p.id, { inputs, note: 'Screening number for the GRC forecast', needBy: '2026-11-15' }) })
    expect(res.ok).toBe(true)
    const e0 = s.estimates.find((e) => e.id === res.estimateId)!
    expect(e0.method).toBe('quick')
    expect(e0.status).toBe('in-review')
    expect(e0.quick?.needBy).toBe('2026-11-15')
    // it lands in the estimators' inbox
    expect(tasksFor(s, 'u-est2').some((t) => t.inst.id === res.instId && t.node.id === 'est')).toBe(true)
    expect(canAdjust(s, e0, 'u-est2')).toBe(true)
    expect(canAdjust(s, e0, 'u-pm1')).toBe(false)
    const before = estimateTotals(e0).total
    const preview = previewAdjust(s, e0, 'p50', 8)!
    s = produce(s, (d) => { applyAdjustment(d, e0.id, { pct: 8, basis: 'p50', reason: 'Two bore pits in a bike path not in the population' }, 'u-est2') })
    const e1 = s.estimates.find((e) => e.id === e0.id)!
    const after = estimateTotals(e1).total
    expect(after).toBe(preview.total)
    expect(after / before).toBeCloseTo(1.08, 2)
    expect(e1.quick?.adjustment).toMatchObject({ pct: 8, byId: 'u-est2', fromTotal: before, toTotal: after })
    expect(s.workflows.find((w) => w.id === res.instId)!.data.amount).toBe(after)
    s = produce(s, (d) => { actOnWorkflow(d, res.instId!, 'est', 'u-est2', 'approve', 'Adjusted for bore pits') })
    const e2 = s.estimates.find((e) => e.id === e0.id)!
    expect(e2.status).toBe('approved')
    expect(e2.approvedById).toBe('u-est2')
    expect(e2.quick?.adjustment?.reason).toMatch(/bore pits/)
    const hist = adjustmentHistory(s, e0.id)
    expect(hist).toHaveLength(1)
    expect(hist[0]).toMatchObject({ byId: 'u-est2', pct: 8 })
    expect(storedMatch(s, e2)).toBe('exact')
  })

  test('adjusting reprices on the model version it was created with, even after a newer one is published', () => {
    const fp = seed.projects.find((x) => x.code === 'PRJ-1014')!
    let fid = ''
    const seedF = produce(seed, (d) => { fid = createFactorEstimate(d, fp.id, factorInputsFromProject(d, d.projects.find((x) => x.id === fp.id)!), 'x', 'u-pm1')!.id })
    const e = seedF.estimates.find((x) => x.id === fid)!
    expect(e.factor?.modelVersion).toBe(2)
    // publish the draft v3: v2 retired
    const s = produce(seedF, (d) => { for (const m of d.factorModels) m.status = m.version === 3 ? 'published' : m.status === 'published' ? 'retired' : m.status })
    const s2 = produce(s, (d) => applyAdjustment(d, e.id, { pct: 0, basis: 'p90', reason: 'Known market or vendor pricing' }, 'u-est1'))
    const e2 = s2.estimates.find((x) => x.id === e.id)!
    expect(e2.factor?.modelVersion).toBe(2)
    expect(estimateTotals(e2).total).toBeGreaterThan(estimateTotals(e).total)
    expect(estimateTotals(e2).total).toBe(previewAdjust(seedF, e, 'p90', 0)!.total)
    expect(e2.basis.assumptions.join(' ')).toMatch(/priced at P90: Known market or vendor pricing/)
  })

  test('requests price on the published factor model with the project drivers; a new need uses baseline drivers', () => {
    const p = seed.projects.find((x) => x.code === 'PRJ-1014')!
    const fi = toFactorInputs(seed, p, inputsFromProject(seed, p))
    expect(fi.site.soil).toBe(p.drivers!.soil)
    expect(fi.site.classLocation).toBe(p.location.classLocation)
    const blank = toFactorInputs(seed, undefined, { ...inputsFromProject(seed, p), district: 'West' })
    expect(blank.site.crossings).toBe(0)
    expect(blank.taxPct).toBeGreaterThan(0)
    let res = { ok: false } as ReturnType<typeof submitQuickRequest>
    const s = produce(seed, (d) => { res = submitQuickRequest(d, p.id, { inputs: fi, note: 'GRC', byId: 'u-pm4' }) })
    expect(res.ok).toBe(true)
    const e = s.estimates.find((x) => x.id === res.estimateId)!
    expect(e.factor?.modelVersion).toBe(2)
    expect(modelNote(s, e)?.label).toBe('Model v2')
    const none = produce(seed, (d) => { for (const m of d.factorModels) if (m.status === 'published') m.status = 'retired' })
    produce(none, (d) => { res = submitQuickRequest(d, p.id, { inputs: fi, note: 'GRC', byId: 'u-pm4' }) })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/No published factor model/)
  })

  test('a returned request is revised in place and routed again', () => {
    let s: AppState = produce(seed, (d) => { d.currentUserId = 'u-pm1' })
    const e = s.estimates.find((x) => x.method === 'quick' && x.status === 'in-review')!
    s = produce(s, (d) => { actOnWorkflow(d, e.workflowInstanceId!, 'est', 'u-est1', 'return', 'Quantity looks low') })
    expect(returnedToRequester(s, s.estimates.find((x) => x.id === e.id)!)?.event?.comment).toBe('Quantity looks low')
    const n = s.estimates.length
    const inputs = { ...e.quick!.inputs, qty: Math.round(e.quick!.inputs.qty * 1.5) || 2 }
    let res: ReturnType<typeof reviseQuickRequest> = { ok: false, message: '' }
    s = produce(s, (d) => { res = reviseQuickRequest(d, e.id, { inputs, note: 'Updated quantity', byId: s.workflows.find((w) => w.id === e.workflowInstanceId)!.startedById }) })
    expect(res.ok).toBe(true)
    expect(s.estimates.length).toBe(n)
    const r = s.estimates.find((x) => x.id === e.id)!
    expect(r.status).toBe('in-review')
    expect(r.version).toBe(e.version)
    expect(r.quick?.inputs.qty).toBe(inputs.qty)
    expect(r.workflowInstanceId).toBe(e.workflowInstanceId)
    expect(s.workflows.find((w) => w.id === e.workflowInstanceId)!.active[0].nodeId).toBe('est')
    // recalled to draft: routed on a fresh workflow
    const starter = s.workflows.find((w) => w.id === e.workflowInstanceId)!.startedById
    s = produce(s, (d) => { recallWorkflow(d, e.workflowInstanceId!, starter) })
    expect(s.estimates.find((x) => x.id === e.id)!.status).toBe('draft')
    s = produce(s, (d) => { res = reviseQuickRequest(d, e.id, { inputs, note: 'Again', byId: starter }) })
    expect(res.ok).toBe(true)
    expect(s.estimates.find((x) => x.id === e.id)!.workflowInstanceId).not.toBe(e.workflowInstanceId)
  })

  test('CSV export → import round-trips with no changes', () => {
    const csv = toCSV(historicalCsvRows(seed.historicalCosts))
    expect(readCsv('a,"b,c","d ""e"""\n1,2,3')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']])
    const parsed = parseHistoricalCsv(csv, seed)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(seed.historicalCosts.length)
    const plan = planImport(seed.historicalCosts, parsed.rows, 'merge')
    expect(plan.add.length + plan.update.length + plan.deactivate.length).toBe(0)
  })

  test('import merge updates and adds; replace deactivates rows not in the file', () => {
    const rows = historicalCsvRows(seed.historicalCosts.slice(0, 2)).map((r) => ({ ...r }))
    rows[0].p50 = Number(rows[0].p50) + 100
    rows[0].p90 = Number(rows[0].p90) + 100
    rows.push({ ...rows[1], id: '', assetType: 'distribution-main', workMethod: 'replace-hdd', diameterBand: 'le-8', terrain: 'urban', unit: 'ft' })
    const parsed = parseHistoricalCsv(toCSV(rows), seed)
    expect(parsed.errors).toEqual([])
    const merge = planImport(seed.historicalCosts, parsed.rows, 'merge')
    expect([merge.add.length, merge.update.length, merge.deactivate.length]).toEqual([1, 1, 0])
    const replace = planImport(seed.historicalCosts, parsed.rows, 'replace')
    expect(replace.deactivate.length).toBe(seed.historicalCosts.filter((h) => h.active).length - 2)
    const s = produce(seed, (d) => applyImport(d, replace))
    expect(s.historicalCosts.length).toBe(seed.historicalCosts.length + 1) // nothing deleted
    expect(s.historicalCosts.filter((h) => h.active)).toHaveLength(3)
  })

  test('import reports bad rows', () => {
    const rows = historicalCsvRows(seed.historicalCosts.slice(0, 1))
    const bad = toCSV([{ ...rows[0], p10: 99999, mix: 'cat-contract:0.5' }])
    const r = parseHistoricalCsv(bad, seed)
    expect(r.rows).toHaveLength(0)
    expect(r.errors[0]).toMatch(/P10 ≤ P50 ≤ P90/)
    expect(r.errors[0]).toMatch(/100%/)
    expect(parseHistoricalCsv('foo,bar\n1,2', seed).errors[0]).toMatch(/Missing column/)
  })

  test('validation: mix must total 100% and no duplicate active rows', () => {
    const h = seed.historicalCosts[0]
    expect(mixTotal(h.mix)).toBeCloseTo(100, 0)
    expect(validateHistorical(h, seed.historicalCosts)).toEqual([])
    expect(validateHistorical({ ...h, id: 'x' }, seed.historicalCosts).join()).toMatch(/Another active row/)
    expect(validateHistorical({ ...h, mix: { 'cat-contract': 0.4 } }, seed.historicalCosts).join()).toMatch(/total 100%/)
  })

  test('derive from closed projects suggests blended values and skips projects already sourced', () => {
    const sug = deriveSuggestions(seed)
    expect(sug.length).toBeGreaterThan(0)
    for (const x of sug) {
      expect(x.points.length).toBeGreaterThan(0)
      expect(x.suggested.p10).toBeLessThanOrEqual(x.suggested.p50)
      expect(x.suggested.p50).toBeLessThanOrEqual(x.suggested.p90)
      if (x.row) expect(x.suggested.n).toBe(x.row.n + x.points.length)
    }
    const upd = sug.find((x) => x.row)!
    const s = produce(seed, (d) => { const h = d.historicalCosts.find((y) => y.id === upd.row!.id)!; h.sources = upd.suggested.sources })
    expect(deriveSuggestions(s).some((x) => x.key === upd.key)).toBe(false)
  })
})
