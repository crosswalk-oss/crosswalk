import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildSeed } from '../seed'
import type { AppState, FormValue } from '../types'
import { FORM_TEMPLATES, allFields } from './forms'
import { APPROVALS_REF, DEFAULT_REDACTION, REDACTION_TAGS, approvalsTag, everyFormRows, fieldTags, redactForm, redactedCopy, redactionMark, redactionNotes, redactionRows, tagFor, taggedCount } from './redaction'
import { previewSubmission } from './records'
import { recordPdf } from '@/views/records/pdf'

const S = buildSeed()
const tpl = (id: string) => FORM_TEMPLATES.find((t) => t.id === id)!
const override = (o: Record<string, 'personal' | 'commercial' | 'security' | 'third-party' | 'none'>): AppState => produce(S, (d) => { d.settings.redaction = { overrides: o } })

describe('redaction tags', () => {
  it('no form has two fields with the same key (they would share one answer)', () => {
    for (const t of FORM_TEMPLATES) { const keys = allFields(t).map((f) => f.key); expect(new Set(keys).size, t.id).toBe(keys.length) }
  })

  it('every default tag points at a real field or column', () => {
    for (const ref of Object.keys(DEFAULT_REDACTION)) {
      if (ref === APPROVALS_REF) continue
      const [form, key, col] = ref.split('.')
      const forms = form === '*' ? FORM_TEMPLATES : [tpl(form)]
      expect(forms[0], ref).toBeTruthy()
      const hits = forms.flatMap((t) => allFields(t).filter((f) => f.key === key && (!col || (f.columns ?? []).some((c) => c.key === col))))
      expect(hits.length, ref).toBeGreaterThan(0)
    }
  })

  it('every form has something tagged, so every gate has a redacted copy that differs from the record', () => {
    for (const t of FORM_TEMPLATES) expect(allFields(t).some((f) => { const tags = fieldTags(S, t, f); return tags.field || Object.keys(tags.columns).length }), t.id).toBe(true)
    expect(taggedCount(S)).toBeGreaterThan(40)
  })

  it('a field tag replaces the value; a column tag replaces that column; the rest is untouched', () => {
    const t = tpl('f-award')
    const data: Record<string, FormValue> = { bids: [{ bidder: 'Bidder A', price: 4_100_000, tech: 88, safety: 91 }, { bidder: 'Bidder B', price: 4_350_000, tech: '', safety: 90 }], award: 'Bidder A', amount: 4_100_000, variance: '', doa: 'Director' }
    const { data: out, log } = redactForm(S, t, data)
    expect(out.award).toBe(redactionMark('third-party'))
    expect(out.amount).toBe(redactionMark('commercial'))
    expect(out.variance).toBe('') // nothing there, nothing withheld
    expect(out.doa).toBe('Director')
    expect(out.bids).toEqual([
      { bidder: redactionMark('third-party'), price: redactionMark('commercial'), tech: redactionMark('commercial'), safety: redactionMark('commercial') },
      { bidder: redactionMark('third-party'), price: redactionMark('commercial'), tech: '', safety: redactionMark('commercial') },
    ])
    expect(data.award).toBe('Bidder A') // the record itself is not changed
    expect(log.find((e) => e.field === 'Bids received' && e.part === 'Technical score')).toMatchObject({ tag: 'commercial', count: 1 })
    expect(log.find((e) => e.field === 'Recommended bidder')).toMatchObject({ tag: 'third-party', count: 1 })
    expect(log.some((e) => e.field === 'Explanation if outside the estimate range')).toBe(false)
  })

  it('the project block is treated the same on every form', () => {
    for (const t of FORM_TEMPLATES) expect(tagFor(S, t.id, 'asset'), t.id).toBe('security')
    expect(tagFor(S, 'f-charter', 'pm')).toBe('personal')
    expect(tagFor(S, 'f-charter', 'name')).toBeUndefined()
  })

  it("an administrator's choice beats the default, field by field", () => {
    const s = override({ 'f-award.award': 'none', 'f-charter.problem': 'security', 'f-award.bids.bidder': 'commercial', [APPROVALS_REF]: 'none' })
    expect(tagFor(s, 'f-award', 'award')).toBeUndefined()
    expect(tagFor(s, 'f-charter', 'problem')).toBe('security')
    expect(fieldTags(s, tpl('f-award'), allFields(tpl('f-award')).find((f) => f.key === 'bids')!).columns.bidder).toBe('commercial')
    expect(tagFor(s, 'f-award', 'amount')).toBe('commercial') // untouched default
    expect(redactForm(s, tpl('f-award'), { award: 'Bidder A' }).data.award).toBe('Bidder A')
    expect(redactionRows(s, tpl('f-award')).find((r) => r.ref === 'f-award.award')).toMatchObject({ current: undefined, isDefault: false })
    expect(approvalsTag(S)).toBe('personal'); expect(approvalsTag(s)).toBeUndefined()
    // a field shared by every form is chosen once; one form can still differ
    const every = override({ '*.asset': 'none', 'f-bod.asset': 'security', '*.location': 'security' })
    expect(tagFor(every, 'f-charter', 'asset')).toBeUndefined(); expect(tagFor(every, 'f-bod', 'asset')).toBe('security'); expect(tagFor(every, 'f-lessons', 'location')).toBe('security')
    expect(everyFormRows(every).find((r) => r.ref === '*.asset')).toMatchObject({ current: undefined, isDefault: false })
    expect(redactionRows(S, tpl('f-charter')).some((r) => /\.(asset|pm|sponsor)$/.test(r.ref))).toBe(false) // listed once, not per form
    expect(redactedCopy(S, tpl('f-award'), {}).hideNames).toBe(true); expect(redactedCopy(s, tpl('f-award'), {}).hideNames).toBe(false)
  })

  it('checklists and whole tables can be withheld too', () => {
    const s = override({ 'f-precon.ready': 'security', 'f-lessons.lessons': 'commercial' })
    const c = redactForm(s, tpl('f-precon'), { ready: { 'Permits on hand': { v: 'Yes', note: 'all three' } } })
    expect(c.data.ready).toEqual({ 'Permits on hand': { v: redactionMark('security') } })
    const l = redactForm(s, tpl('f-lessons'), { lessons: [{ what: 'x', impact: 'Cost', rec: 'y' }] })
    expect(l.data.lessons).toEqual([{ what: redactionMark('commercial'), impact: redactionMark('commercial'), rec: redactionMark('commercial') }])
    expect(l.log).toHaveLength(3)
  })

  it('the form shows what a redacted copy withholds', () => {
    const notes = redactionNotes(S, tpl('f-award'))
    expect(notes.award).toBe(`Redacted · ${REDACTION_TAGS['third-party'].short}`)
    expect(notes.bids).toBe('Redacted columns: Bidder, Price, Technical score, Safety score')
    expect(notes.doa).toBeUndefined()
  })

  it('builds the redacted PDF for a real record, and it is a different file from the full one', () => {
    const sub = S.recordsSubmissions![0]
    const t = tpl(sub.snapshot.templateId)
    const full = recordPdf(S, sub), red = recordPdf(S, sub, redactedCopy(S, t, sub.snapshot.data))
    expect(red.size).toBeGreaterThan(3000)
    expect(red.size).not.toBe(full.size)
    const draft = previewSubmission(S, S.deliverables.find((x) => x.form && x.status === 'in-progress')!)!
    expect(recordPdf(S, draft, redactedCopy(S, tpl(draft.snapshot.templateId), draft.snapshot.data)).size).toBeGreaterThan(3000)
  })
})
