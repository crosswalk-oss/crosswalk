import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AppState } from '../types'
import { actOnWorkflow } from './workflow'
import { FORM_TEMPLATES, allFields, deliverableDef, formFor, formValues, missingFields, prefillValue } from './forms'
import { mappingFor, previewSubmission, recordsOf, requestPreview, submissionsFor, verifyDeliverable } from './records'
import { recordPdf } from '@/views/records/pdf'

const S = buildSeed()
const approveAll = (d: AppState, instId: string) => {
  for (let i = 0; i < 20; i++) {
    const inst = d.workflows.find((w) => w.id === instId)
    if (!inst || inst.status !== 'running' || !inst.active.length) return
    const slot = inst.active[0]
    actOnWorkflow(d, inst.id, slot.nodeId, slot.assigneeIds.find((x) => !slot.actedIds.includes(x)) ?? slot.assigneeIds[0], 'approve', 'ok')
  }
}
/** A submitted deliverable with a completed form and a running review workflow. */
const inReview = (s: AppState) => {
  const d = s.deliverables.find((x) => x.status === 'submitted' && x.form && s.workflows.some((w) => w.recordType === 'deliverable' && w.recordId === x.id && w.status === 'running'))!
  const wf = s.workflows.find((w) => w.recordType === 'deliverable' && w.recordId === d.id && w.status === 'running')!
  return { d, wf }
}

describe('deliverable forms', () => {
  it('every gate deliverable in every lifecycle template has a form', () => {
    for (const t of S.templates) for (const st of t.stages) for (const def of st.gate.deliverables) expect(formFor(def.id), def.id).toBeTruthy()
    expect(new Set(FORM_TEMPLATES.map((t) => t.id)).size).toBe(FORM_TEMPLATES.length)
  })

  it('every pre-filled field resolves for every project, and read-only fields always come from Crosswalk', () => {
    for (const t of FORM_TEMPLATES) for (const f of allFields(t)) {
      if (f.readOnly) expect(f.prefill, `${t.id}.${f.key}`).toBeTruthy()
      if (!f.prefill) continue
      for (const p of S.projects) expect(prefillValue(S, p, f.prefill), `${t.id}.${f.key} on ${p.code}`).not.toBeUndefined()
    }
    const p = S.projects[0]
    const t = formFor('d-charter')!
    const v = formValues(S, p, t, { code: 'tampered', problem: 'Saved answer' })
    expect(v.code).toBe(p.code) // read-only ignores saved values
    expect(v.problem).toBe('Saved answer')
    expect(v.summary).toBe(p.scope.summary) // empty field pre-filled
  })

  it('lists required answers that are missing, including unanswered checklist items', () => {
    const p = S.projects[0]
    const t = formFor('d-precon')!
    const v = formValues(S, p, t, {})
    expect(missingFields(t, v)).toEqual(expect.arrayContaining(['Ready to mobilize', 'Mobilization date']))
    const items = allFields(t).find((f) => f.key === 'ready')!.items!
    const done = formValues(S, p, t, { ready: Object.fromEntries(items.map((i) => [i, { v: 'Yes' }])), mob: '2026-11-20' })
    expect(missingFields(t, done)).toEqual([])
  })
})

describe('records hand-off', () => {
  it('seeds filed records with frozen forms and metadata', () => {
    const subs = S.recordsSubmissions ?? []
    expect(subs.length).toBeGreaterThan(5)
    for (const x of subs) {
      expect(x.status).toBe('filed')
      expect(x.nodeId).toMatch(/^\d{7}$/)
      expect(x.metadata['Project Number']).toMatch(/^PRJ-/)
      expect(x.metadata['Records Class']).toBeTruthy()
      expect(x.folder).toContain(x.metadata['Project Number'])
    }
  })

  it('files to the records system when the reviewer approves, with the form frozen as approved', () => {
    const { d: before, wf } = inReview(S)
    const s = produce(S, (d) => { approveAll(d, wf.id) })
    const d = s.deliverables.find((x) => x.id === before.id)!
    expect(d.status).toBe('accepted')
    const sub = submissionsFor(s, d.id)[0]
    expect(sub.status).toBe('filed')
    expect(sub.trigger).toBe('approval')
    expect(sub.metadata.Deliverable).toBe(deliverableDef(s, d)!.name)
    expect(sub.snapshot.data).toMatchObject(Object.fromEntries(Object.entries(before.form!.data).filter(([, v]) => typeof v === 'string' && v)))
    // the filed record doesn't change when the project changes later
    const s2 = produce(s, (x) => { x.projects.find((p) => p.id === d.projectId)!.name = 'Renamed later' })
    expect(submissionsFor(s2, d.id)[0].metadata['Project Name']).not.toBe('Renamed later')
  })

  it('waits for records verification when configured, then files', () => {
    const { d: before, wf } = inReview(S)
    let s = produce(S, (d) => { d.settings.records = { ...recordsOf(d), trigger: 'verification' }; approveAll(d, wf.id) })
    expect(submissionsFor(s, before.id)[0].status).toBe('awaiting-verification')
    s = produce(s, (d) => { verifyDeliverable(d, before.id, 'u-me') })
    const sub = submissionsFor(s, before.id)[0]
    expect(sub.status).toBe('filed')
    expect(sub.metadata['Verified By']).toBeTruthy()
    expect(s.deliverables.find((x) => x.id === before.id)!.verifiedById).toBe('u-me')
  })

  it('a new version is added to the node already filed', () => {
    const first = S.recordsSubmissions![0]
    const s = produce(S, (d) => {
      const dl = d.deliverables.find((x) => x.id === first.deliverableId)!
      dl.version = 2
      verifyDeliverable(d, dl.id, 'u-me') // re-files the accepted deliverable as v2
    })
    const subs = submissionsFor(s, first.deliverableId)
    expect(subs[0].version).toBe(2)
    expect(subs[0].nodeId).toBe(first.nodeId)
    expect(requestPreview(s, subs[0])[1].url).toMatch(new RegExp(`/nodes/${first.nodeId}/versions$`))
    expect(requestPreview(S, first)[1].url).toMatch(/\/nodes$/)
  })

  it('maps deliverables to records classes, with overrides', () => {
    const def = (id: string) => S.templates.flatMap((t) => t.stages.flatMap((st) => st.gate.deliverables)).find((d) => d.id === id)!
    expect(mappingFor(S, def('d-maop')).retention).toBe('Life of the facility')
    expect(mappingFor(S, def('d-charter')).recordsClass).toMatch(/Project management/)
    const s = produce(S, (d) => { d.settings.records = { ...recordsOf(d), mappings: { 'd-charter': { docType: 'Charter', recordsClass: 'X-1', retention: '7 years' } } } })
    expect(mappingFor(s, def('d-charter')).recordsClass).toBe('X-1')
  })

  it('renders the record as a PDF (filed and draft preview)', () => {
    const blob = recordPdf(S, S.recordsSubmissions![0])
    expect(blob.size).toBeGreaterThan(3000)
    const draft = previewSubmission(S, S.deliverables.find((x) => x.form && x.status === 'in-progress')!)!
    expect(draft.fileName).toMatch(/_DRAFT\.pdf$/)
    expect(recordPdf(S, draft).size).toBeGreaterThan(3000)
  })
})
