import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import RecordsFiling from './RecordsFiling'
import RedactionSettingsTab from '@/views/admin/RedactionSettings'
import { FormBody } from './DeliverableForm'
import { buildSeed } from '@/core/seed'
import { formFor, formValues } from '@/core/engine/forms'
import { redactionNotes } from '@/core/engine/redaction'

describe('carry-forward and redaction on screen', () => {
  test('a form marks the fields a redacted copy withholds and says where a carried answer came from', () => {
    const s = buildSeed(); const p = s.projects[0]; const t = formFor('d-award')!
    const html = renderToString(<FormBody t={t} data={formValues(s, p, t, {})} editable onChange={() => {}} redacted={redactionNotes(s, t)} carried={{ award: 'Carried from Option analysis (Stage 2 · Planning)' }} />)
    for (const x of ['Redacted · Third party', 'Redacted · Commercial', 'Redacted columns: Bidder, Price, Technical score, Safety score', 'Redacted · Security', 'Carried from Option analysis (Stage 2 · Planning). Change it here if it no longer holds.']) expect(html).toContain(x)
  })
  test('Configuration lists every form with its redacted fields and the four categories', () => {
    const html = renderToString(<RedactionSettingsTab />)
    for (const x of ['One record, two copies', 'Personal information', 'Commercially sensitive', 'Security-sensitive infrastructure', 'Third-party information', 'Every record', 'Names of the people who prepared, approved and verified', 'Asset (line, diameter, length)', 'Project manager', 'Contract award recommendation', 'Bids received → Bidder', 'Basis of design', 'Not redacted', 'Showing redacted only']) expect(html).toContain(x)
  })
  test('Records filing offers a redacted copy of each record', () => {
    expect(renderToString(<RecordsFiling />)).toContain('Redacted')
  })
})
