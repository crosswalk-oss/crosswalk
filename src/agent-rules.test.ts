// Guard tests for AGENT_RULES.md. These fail the build if a change breaks a rule the code can check.
import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildSeed } from './core/seed'
import { computeQuick, inputsFromProject } from './core/engine/quick'
import { estimateTotals, parametricLines } from './core/engine/estimates'
import { auditIntact, useStore } from './core/store'
import { parametricInputsFromProject, priceParametric, riskItemsOf, validateRiskItems } from './core/engine/parametric'
import { DRIVER_KEYS, backtest, createFactorEstimate, factorInputsFromProject, priceFactor, publishedModel, validateModel } from './core/engine/factorModel'

const ROOT = path.resolve(__dirname, '..')
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p)) : [p]
  })
}
const SRC = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))
const PROD = SRC.filter((f) => !/\.test\.tsx?$/.test(f))
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/')
const read = (f: string) => fs.readFileSync(f, 'utf8')
const S = buildSeed()

describe('Rule 1–5: fictional data only', () => {
  it('no real-looking pipeline line numbers in the seed (fictional lines are AV-xx)', () => {
    for (const p of S.projects) {
      expect(p.name, p.code).not.toMatch(/Line \d/)
      expect(p.asset.lineId, p.code).not.toMatch(/^\d+(-\d+)?$/)
    }
  })
  it('no regulatory proceeding numbers in the real docket format', () => {
    for (const f of PROD) expect(read(f), rel(f)).not.toMatch(/\b[AD]\.\d{2}-\d{2}-\d{3}\b/)
  })
  it('vendor names follow the fictional "… Co." convention', () => {
    const vendors = new Set([...S.contracts.map((c) => c.vendor), ...S.longLead.map((l) => l.vendor), ...S.actualTxns.map((t) => t.vendor).filter(Boolean)])
    for (const v of vendors) expect(v, v).toMatch(/Co\.$|^City of Arroyo Valley$/)
  })
  // Blocked company and internal-system names are stored as hashes so this public test does not publish them.
  // To add one: node -e "console.log(require('crypto').createHash('sha256').update('<word in lowercase>').digest('hex').slice(0,16))"
  const BLOCKED = new Set(['82efad7021f8edae', '00c1c9a927cc3ccb', 'e8ae129e089fe716', '128d077252ff6e80', 'c4bc92512b4cf86e', '50fb28b23c1e32dd', '1c9fcf1f738dff9e', '69d41313de163800'])
  const hash = (w: string) => createHash('sha256').update(w).digest('hex').slice(0, 16)
  it('no company names, branding or internal system names in the source or docs', () => {
    const docs = ['README.md', 'CONTRIBUTING.md', 'AGENT_RULES.md', 'NOTICE', 'index.html'].map((f) => path.join(ROOT, f))
    for (const f of [...PROD, ...docs]) {
      const hits = [...new Set(read(f).toLowerCase().match(/[a-z0-9&]+/g) ?? [])].filter((w) => BLOCKED.has(hash(w)))
      expect(hits, rel(f)).toEqual([])
    }
  })
})

describe('Rule 10–12: no AI or outside calls in the running app, no secrets', () => {
  it('AI assist and outside map services are off in the demo data', () => {
    expect(S.settings.ai.enabled).toBe(false)
    expect(S.settings.ai.endpoint).toBe('')
    expect(S.settings.gis.allowExternal).toBe(false)
    expect(S.settings.gis.basemap).toBe('none')
  })
  it('network calls exist only behind those two switches, plus the app talking to its own API', () => {
    const net = PROD.filter((f) => /\bfetch\(|XMLHttpRequest|new WebSocket|navigator\.sendBeacon/.test(read(f))).map(rel)
    expect(net.sort()).toEqual(['src/core/ai.ts', 'src/core/data/server.ts', 'src/views/admin/GisSettings.tsx'])
    // the data client only ever calls its own API, by relative URL
    const calls = [...read(path.join(ROOT, 'src/core/data/server.ts')).matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim())
    expect(calls).toEqual(["'api/' + path"])
  })
  it('index.html loads nothing from outside (no CDN fonts or scripts)', () => {
    expect(read(path.join(ROOT, 'index.html'))).not.toMatch(/https?:\/\//)
  })
  it('no secrets in code; .env files are ignored', () => {
    for (const f of PROD) expect(read(f), rel(f)).not.toMatch(/(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/)
    expect(read(path.join(ROOT, '.gitignore'))).toMatch(/^\.env/m)
  })
})

describe('Rule 13–15: fairness in the estimating model', () => {
  it('no engine code reads location.dac', () => {
    for (const f of PROD.filter((f) => rel(f).startsWith('src/core/engine/'))) expect(read(f), rel(f)).not.toMatch(/\bdac\b/)
  })
  it('estimates are identical whether or not a project is flagged as a disadvantaged community', () => {
    for (const p of S.projects.filter((x) => x.asset.lengthFt > 0).slice(0, 8)) {
      const flipped = produce(S, (d) => { const q = d.projects.find((x) => x.id === p.id)!; q.location.dac = !q.location.dac })
      const q2 = flipped.projects.find((x) => x.id === p.id)!
      expect(computeQuick(flipped, inputsFromProject(flipped, q2)).total).toBe(computeQuick(S, inputsFromProject(S, p)).total)
      const t = (lines: ReturnType<typeof parametricLines>) => estimateTotals({ lines, loaders: [], escalationPct: 0, contingency: { method: 'deterministic', pct: 0 }, cls: 5 }).total
      expect(t(parametricLines(q2, flipped.rates))).toBe(t(parametricLines(p, S.rates)))
    }
  })
  // Factor model (rules 13–15): factors bind only to physical, legal or logistical drivers.
  const FORBIDDEN = /\bdac\b|disadvantag|income|wealth|race|ethnic|home.?value|property.?value|zip|postal|census|demograph|poverty|language/i
  it('every factor in every model version binds to an allowed driver, never a demographic or wealth attribute', () => {
    expect(S.factorModels.length).toBeGreaterThan(0)
    for (const m of S.factorModels) for (const f of m.factors) {
      expect(DRIVER_KEYS, `${m.version}/${f.id}`).toContain(f.driver)
      expect(String(f.driver), f.id).not.toMatch(FORBIDDEN)
      expect(`${f.id} ${f.name}`, f.id).not.toMatch(FORBIDDEN)
      expect(['physical', 'legal', 'logistical']).toContain(f.kind)
    }
    for (const k of DRIVER_KEYS) expect(k).not.toMatch(FORBIDDEN)
    for (const r of S.backtestProjects) for (const k of Object.keys(r.drivers)) expect(DRIVER_KEYS, r.id).toContain(k)
  })
  it('a factor bound to location.dac (or any other attribute) is rejected and has no effect on price', () => {
    const m = publishedModel(S)!
    const bad = { ...m, factors: [...m.factors, { id: 'f-x', name: 'Community', kind: 'legal' as const, driver: 'dac' as never, weight: 1, cv: 0.1, levels: [{ value: 'true', label: 'Yes', multiplier: 1.3 }, { value: 'false', label: 'No', multiplier: 1 }] }] }
    expect(validateModel(bad).join()).toMatch(/not a physical, legal or logistical driver/)
    const p = S.projects[0]
    expect(priceFactor(S, bad, factorInputsFromProject(S, p)).direct).toBe(priceFactor(S, m, factorInputsFromProject(S, p)).direct)
  })
  it('factor-model inputs carry no community attributes, and estimates are invariant to location.dac', () => {
    for (const p of S.projects) {
      const i = factorInputsFromProject(S, p)
      expect(Object.keys(i.site).sort()).toEqual(['classLocation', 'crossings', 'hca', 'permitComplexity', 'remoteness', 'soil', 'traffic', 'workHours'])
      expect(JSON.stringify(i)).not.toMatch(/"dac"/)
      const flipped = produce(S, (d) => { const q = d.projects.find((x) => x.id === p.id)!; q.location.dac = !q.location.dac })
      const q2 = flipped.projects.find((x) => x.id === p.id)!
      for (const m of S.factorModels) {
        const a = priceFactor(S, m, factorInputsFromProject(S, p)), b = priceFactor(flipped, m, factorInputsFromProject(flipped, q2))
        expect([b.total, b.p10, b.p90], p.code).toEqual([a.total, a.p10, a.p90])
      }
      const e1 = produce(S, (d) => { createFactorEstimate(d, p.id, factorInputsFromProject(d, d.projects.find((x) => x.id === p.id)!), 'x') }).estimates.at(-1)!
      const e2 = produce(flipped, (d) => { createFactorEstimate(d, p.id, factorInputsFromProject(d, d.projects.find((x) => x.id === p.id)!), 'x') }).estimates.at(-1)!
      expect(estimateTotals(e2).total, p.code).toBe(estimateTotals(e1).total)
    }
    const all = (s: typeof S) => s.factorModels.map((m) => backtest(s, m).mape)
    expect(all(produce(S, (d) => { for (const p of d.projects) p.location.dac = !p.location.dac }))).toEqual(all(S))
  })
})

describe('Rule 13–15: Class 5 parametric request (rate table + risk items)', () => {
  it('risk items are physical, legal or logistical, and estimates ignore location.dac', () => {
    expect(validateRiskItems(riskItemsOf(S))).toEqual([])
    for (const p of S.projects.filter((x) => x.asset.lengthFt > 0).slice(0, 8)) {
      const flipped = produce(S, (d) => { const q = d.projects.find((x) => x.id === p.id)!; q.location.dac = !q.location.dac })
      const q2 = flipped.projects.find((x) => x.id === p.id)!
      const a = priceParametric(S, parametricInputsFromProject(S, p), p), b = priceParametric(flipped, parametricInputsFromProject(flipped, q2), q2)
      expect([b?.total, b?.mc.p.P10, b?.mc.p.P90], p.code).toEqual([a?.total, a?.mc.p.P10, a?.mc.p.P90])
    }
  })
  it('every estimate shows its drivers itemized: rate rows, each rated risk allowance, and the Monte Carlo tornado', () => {
    const p = S.projects.find((x) => x.asset.lengthFt > 1000 && priceParametric(S, parametricInputsFromProject(S, x), x))!
    const r = priceParametric(S, { ...parametricInputsFromProject(S, p), risks: { ...parametricInputsFromProject(S, p).risks, soil: 'high' } }, p)!
    expect(r.rateLines.length).toBeGreaterThan(0)
    expect(r.riskLines.some((l) => /Soil/.test(l.description))).toBe(true)
    expect(r.mc.tornado.length).toBeGreaterThan(1)
  })
})

describe('Rule 16–17: pure engine, one data-access interface', () => {
  it('src/core/engine imports nothing from UI, storage, network or frameworks', () => {
    for (const f of PROD.filter((f) => rel(f).startsWith('src/core/engine/'))) {
      const src = read(f)
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      for (const i of imports) expect(i, `${rel(f)} imports ${i}`).toMatch(/^(\.\.\/types|\.\.\/util|\.\/[a-zA-Z]+)$/)
      expect(src, rel(f)).not.toMatch(/\b(window|document|localStorage)\.|\bfetch\(/)
    }
  })
  it('nothing outside src/core/data touches browser storage', () => {
    for (const f of PROD.filter((f) => !rel(f).startsWith('src/core/data/'))) expect(read(f), rel(f)).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/)
  })
})

describe('Rule 21: append-only audit log', () => {
  it('auditIntact accepts appends and rejects edits or deletions', () => {
    const a = S.audit.slice(0, 3)
    expect(auditIntact(a, [...a, { ...a[0], id: 'new' }])).toBe(true)
    expect(auditIntact(a, a.slice(1))).toBe(false)
    expect(auditIntact(a, [{ ...a[0], summary: 'edited' }, a[1], a[2]])).toBe(false)
  })
  it('the store refuses an update that removes audit entries', () => {
    const before = useStore.getState().audit.length
    useStore.getState().update((d) => { d.audit.splice(0, 1); d.settings.orgName = 'changed' })
    expect(useStore.getState().audit.length).toBe(before)
    expect(useStore.getState().settings.orgName).not.toBe('changed')
  })
})
