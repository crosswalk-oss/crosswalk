import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AppState, Deliverable, FormValue, Project } from '../types'
import { templateFor } from './gates'
import { FORM_FOR_DEF, FORM_TEMPLATES, allFields } from './forms'
import { CARRY_LINKS, carriedFor, carriedNotes, formValuesFor, isBlank } from './carry'

const S = buildSeed()
const tpl = (id: string) => FORM_TEMPLATES.find((t) => t.id === id)!
const field = (ref: string) => { const [t, k] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)]; return { t: tpl(t), f: tpl(t) ? allFields(tpl(t)).find((x) => x.key === k) : undefined } }

/** A project whose lifecycle uses both forms, and where each sits in it. */
function setup(fromForm: string, toForm: string) {
  for (const p of S.projects) {
    const stages = templateFor(S, p).stages
    const find = (form: string) => { for (const st of stages) { const def = st.gate.deliverables.find((d) => FORM_FOR_DEF[d.id] === form); if (def) return { stageIndex: st.index, defId: def.id } } return undefined }
    const a = find(fromForm), b = find(toForm)
    if (a && b && a.stageIndex <= b.stageIndex) return { p, a, b }
  }
  throw new Error(`no project uses ${fromForm} then ${toForm}`)
}
const deliverable = (p: Project, at: { stageIndex: number; defId: string }, id: string, data?: Record<string, FormValue>, status: Deliverable['status'] = 'in-progress'): Deliverable => ({
  id, projectId: p.id, stageIndex: at.stageIndex, defId: at.defId, status, version: 1, evidence: [], updatedAt: '2026-10-01T00:00:00.000Z',
  ...(data ? { form: { templateId: FORM_FOR_DEF[at.defId], templateVersion: 1, data, savedAt: '2026-10-01T00:00:00.000Z', savedById: 'u-me' } } : {}),
})
/** The seed with only these two deliverables on the project, so nothing else supplies an answer. */
const withOnly = (p: Project, list: Deliverable[]): AppState => produce(S, (d) => { d.deliverables = [...d.deliverables.filter((x) => x.projectId !== p.id), ...list] })

describe('carry-forward between deliverables', () => {
  it('every link points at real fields of compatible types, and table links at real columns', () => {
    for (const l of CARRY_LINKS) {
      const to = field(l.to), from = field(l.from)
      expect(to.f, l.to).toBeTruthy(); expect(from.f, l.from).toBeTruthy()
      expect(to.f!.readOnly, `${l.to} is filled from the project, not carried`).toBeFalsy()
      if (to.f!.type === 'table') {
        expect(from.f!.type).toBe('table'); expect(l.columns, l.to).toBeTruthy()
        for (const [toCol, fromCol] of Object.entries(l.columns!)) { expect(to.f!.columns!.some((c) => c.key === toCol), `${l.to}.${toCol}`).toBe(true); expect(from.f!.columns!.some((c) => c.key === fromCol), `${l.from}.${fromCol}`).toBe(true) }
      } else {
        const num = (t: string) => t === 'number' || t === 'money'
        expect(num(to.f!.type), `${l.from} → ${l.to}`).toBe(num(from.f!.type))
      }
    }
  })

  it('an answer typed on an earlier deliverable is offered on the later one, with its source', () => {
    const { p, a, b } = setup('f-bod', 'f-ifc')
    const later = deliverable(p, b, 'dl-ifc')
    const s = withOnly(p, [deliverable(p, a, 'dl-bod', { eor: 'R. Example, PE' }), later])
    const carried = carriedFor(s, p, later, tpl('f-ifc'))
    expect(carried.eor).toMatchObject({ value: 'R. Example, PE', fromDeliverableId: 'dl-bod' })
    expect(carried.eor.fromName).toBeTruthy(); expect(carried.eor.fromStage).toMatch(/^Stage \d+ · /)
    const v = formValuesFor(s, p, later, tpl('f-ifc'))
    expect(v.eor).toBe('R. Example, PE')
    expect(carriedNotes(carried, v).eor).toMatch(/^Carried from .+ \(Stage \d+ · .+\)$/)
    expect(carriedNotes(carried, { ...v, eor: 'Someone else' }).eor).toBeUndefined() // edited: no longer "carried"
  })

  it('a saved answer wins; a locked form is never changed; a later deliverable is not a source', () => {
    const { p, a, b } = setup('f-bod', 'f-ifc')
    const src = deliverable(p, a, 'dl-bod', { eor: 'R. Example, PE' })
    const typed = deliverable(p, b, 'dl-ifc', { eor: 'T. Sample, PE' })
    expect(formValuesFor(withOnly(p, [src, typed]), p, typed, tpl('f-ifc')).eor).toBe('T. Sample, PE')
    for (const status of ['submitted', 'accepted', 'waived'] as const) {
      const locked = deliverable(p, b, 'dl-ifc', { rev: 'B' }, status)
      expect(formValuesFor(withOnly(p, [src, locked]), p, locked, tpl('f-ifc')).eor).toBe('')
    }
    if (a.stageIndex < b.stageIndex) { // the earlier form never takes from the later one
      const early = deliverable(p, a, 'dl-bod')
      const s = withOnly(p, [early, deliverable(p, b, 'dl-ifc', { eor: 'R. Example, PE' })])
      expect(carriedFor(s, p, early, tpl('f-bod'))).toEqual({})
    }
  })

  it('tables carry the matching columns only, and blank rows are dropped', () => {
    const { p, a, b } = setup('f-permits', 'f-permitclose')
    const later = deliverable(p, b, 'dl-close')
    const s = withOnly(p, [deliverable(p, a, 'dl-permits', { permits: [{ permit: 'Encroachment', agency: 'City', need: '2026-12-01', status: 'Issued', number: 'E-1' }, { permit: '', agency: '' }] }), later])
    expect(formValuesFor(s, p, later, tpl('f-permitclose')).permits).toEqual([{ permit: 'Encroachment', agency: 'City' }])
  })

  it('a choice is carried only when the later form offers it', () => {
    const { p, a, b } = setup('f-charter', 'f-recovery')
    const later = deliverable(p, b, 'dl-rec')
    const ok = withOnly(p, [deliverable(p, a, 'dl-charter', { mechanism: 'Balancing account' }), later])
    expect(formValuesFor(ok, p, later, tpl('f-recovery')).mechanism).toBe('Balancing account')
    const odd = withOnly(p, [deliverable(p, a, 'dl-charter', { mechanism: 'Something the later form does not list' }), later])
    expect(formValuesFor(odd, p, later, tpl('f-recovery')).mechanism).toBe('')
  })

  it('knows what counts as no answer', () => {
    for (const v of [undefined, '', [], [{ a: '' }], {}] as (FormValue | undefined)[]) expect(isBlank(v)).toBe(true)
    for (const v of ['x', 0, false, [{ a: 'x' }], { item: { v: 'Yes' } }] as FormValue[]) expect(isBlank(v)).toBe(false)
  })
})
