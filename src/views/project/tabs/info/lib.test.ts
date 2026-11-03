import { buildSeed } from '@/core/seed'
import { infoValue, missingInfo, reviseInfo } from '@/core/engine/info'
import { readiness } from '@/core/engine/gates'
import { produce } from 'immer'
import type { AppState } from '@/core/types'
import { cleanProposals, currentValues, displayValue, draftPrompt, fieldStats, infoCsv, infoSheetHtml, infoText, keyFromLabel, requirement, revisionsFor, sectionsOf, validKey, valuesAsOf } from './lib'

const seed = buildSeed()
const revise = (s: AppState, pid: string, edits: Record<string, string>, note: string) => produce(s, (d) => { reviseInfo(d, pid, edits, note) })

describe('revision numbering and reconstruction', () => {
  it('numbers revisions oldest = 1 and returns newest first', () => {
    const p = seed.projects[0]
    const revs = revisionsFor(seed, p.id)
    expect(revs.length).toBeGreaterThan(0)
    expect(revs[0].rev).toBe(revs.length)
    expect(revs[revs.length - 1].rev).toBe(1)
    expect(revs[0].at >= revs[revs.length - 1].at).toBe(true)
  })

  it('reconstructs the record as it stood at each revision', () => {
    const pid = 'prj-1006'
    let s = seed
    const before = currentValues(s, s.projects.find((p) => p.id === pid)!)
    const base = revisionsFor(s, pid).length
    s = revise(s, pid, { constraints: 'A', workWindows: 'Nights only' }, 'first')
    s = revise(s, pid, { constraints: 'B' }, 'second')
    s = revise(s, pid, { constraints: 'C', city: 'Springfield' }, 'third')
    const p = s.projects.find((x) => x.id === pid)!
    const cur = currentValues(s, p)
    const revs = revisionsFor(s, pid)
    expect(revs[0].rev).toBe(base + 3)
    expect(cur.constraints).toBe('C')
    expect(cur.city).toBe('Springfield')
    expect(p.location.city).toBe('Springfield') // bound field written to the project
    expect(valuesAsOf(cur, revs, base + 2).constraints).toBe('B')
    expect(valuesAsOf(cur, revs, base + 2).city).toBe(before.city)
    expect(valuesAsOf(cur, revs, base + 1).constraints).toBe('A')
    expect(valuesAsOf(cur, revs, base + 1).workWindows).toBe('Nights only')
    expect(valuesAsOf(cur, revs, base).constraints).toBe(before.constraints)
    expect(valuesAsOf(cur, revs, base).workWindows).toBe(before.workWindows)
    expect(valuesAsOf(cur, revs, base + 3)).toEqual(cur)
    // audit written by the engine
    expect(s.audit.filter((a) => a.entity === 'project-info' && a.entityId === pid).length).toBe(3)
  })

  it('ignores read-only fields and unchanged values', () => {
    const s = revise(seed, 'prj-1006', { pm: 'Somebody', name: seed.projects.find((p) => p.id === 'prj-1006')!.name }, 'noop')
    expect(s.infoRevisions.length).toBe(seed.infoRevisions.length)
  })
})

describe('requirements', () => {
  it('flags required fields by stage', () => {
    const def = seed.settings.infoFields.find((f) => f.key === 'workOrder')!
    expect(requirement(def, '', 3)).toBe('blocking')
    expect(requirement(def, '', 1)).toBe('later')
    expect(requirement(def, 'WOA-1', 3)).toBe('met')
    expect(requirement(seed.settings.infoFields.find((f) => f.key === 'pm')!, '', 3)).toBeUndefined()
  })

  it('field stats agree with missingInfo / readiness', () => {
    const active = seed.projects.filter((p) => p.status === 'active')
    const blockedBy = new Set(seed.settings.infoFields.flatMap((f) => fieldStats(seed, f).blockedCodes))
    const viaEngine = new Set(active.filter((p) => missingInfo(seed, p).length).map((p) => p.code))
    expect(blockedBy).toEqual(viaEngine)
    for (const code of viaEngine) {
      const p = seed.projects.find((x) => x.code === code)!
      expect(readiness(seed, p).missingInfo.length).toBeGreaterThan(0)
    }
  })
})

describe('exports', () => {
  const p = seed.projects.find((x) => x.code === 'PRJ-1003')!
  it('builds the formal sheet with header, every section and the revision log', () => {
    const html = infoSheetHtml(seed, p)
    const rev = revisionsFor(seed, p.id)[0].rev
    expect(html).toContain(seed.settings.orgName)
    expect(html).toContain('PRJ-1003')
    expect(html).toContain(`Rev ${rev}`)
    expect(html).toContain('Revision log')
    for (const sec of seed.settings.infoSections) expect(html).toContain(sec.replace(/&/g, '&amp;'))
    expect(html).not.toContain('<script')
  })
  it('escapes user values in the sheet', () => {
    const s = revise(seed, p.id, { constraints: '<b>x</b> & "y"' }, 'escape test')
    const html = infoSheetHtml(s, s.projects.find((x) => x.id === p.id)!)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
  })
  it('CSV has one row per field and text has every label', () => {
    const csv = infoCsv(seed, p)
    expect(csv.split('\n')[0]).toBe('Section,Field,Value')
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(seed.settings.infoFields.length + 1)
    const txt = infoText(seed, p)
    for (const f of seed.settings.infoFields) expect(txt).toContain(f.label)
  })
  it('formats values by type', () => {
    expect(displayValue({ key: 'x', label: 'x', section: 's', type: 'money' }, '1234567')).toBe('$1,234,567')
    expect(displayValue({ key: 'x', label: 'x', section: 's', type: 'date' }, '2026-10-28')).toBe('Oct 28, 2026')
    expect(displayValue({ key: 'x', label: 'x', section: 's', type: 'text' }, '  ')).toBe('')
  })
})

describe('configuration helpers', () => {
  it('groups fields by section order', () => {
    const secs = sectionsOf(seed)
    expect(secs.map((x) => x.name)).toEqual(seed.settings.infoSections)
    expect(secs.reduce((a, x) => a + x.fields.length, 0)).toBe(seed.settings.infoFields.length)
  })
  it('derives unique valid keys', () => {
    expect(keyFromLabel('Environmental lead', [])).toBe('environmentalLead')
    expect(keyFromLabel('Environmental lead', ['environmentalLead'])).toBe('environmentalLead2')
    expect(validKey(keyFromLabel('2nd crossing?', []))).toBe(true)
    expect(validKey('bad key')).toBe(false)
  })
})

describe('AI drafting', () => {
  const p = seed.projects.find((x) => x.code === 'PRJ-1006')!
  const defs = seed.settings.infoFields.filter((f) => ['alternatives', 'ceqaPath', 'hca', 'customersAffected'].includes(f.key))
  it('prompt carries the project facts and the exact output format', () => {
    const t = draftPrompt(seed, p, defs)
    expect(t).toContain(p.code)
    expect(t).toContain(p.scope.summary)
    expect(t).toContain('"fields"')
    expect(t).toContain('key "ceqaPath"')
  })
  it('keeps only valid proposals for requested fields', () => {
    const out = cleanProposals({ fields: [
      { key: 'alternatives', value: 'Replace; reroute', basis: 'scope' },
      { key: 'ceqaPath', value: 'exempt', basis: '' },
      { key: 'ceqaPath', value: 'EIR' },
      { key: 'hca', value: 'true' },
      { key: 'customersAffected', value: 'several' },
      { key: 'name', value: 'Not requested' },
    ] }, defs)
    expect(out.map((x) => [x.key, x.value])).toEqual([['alternatives', 'Replace; reroute'], ['ceqaPath', 'Exempt'], ['hca', 'Yes']])
    expect(cleanProposals(null, defs)).toEqual([])
  })
  it('infoValue reads system fields', () => {
    const f = seed.settings.infoFields.find((x) => x.key === 'pm')!
    expect(infoValue(p, f, seed)).toBeTruthy()
  })
})
