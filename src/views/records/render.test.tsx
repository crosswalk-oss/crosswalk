import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import RecordsFiling from './RecordsFiling'
import RecordsSettingsTab from '@/views/admin/RecordsSettings'
import { FormBody } from './DeliverableForm'
import { buildSeed } from '@/core/seed'
import { formFor, formValues } from '@/core/engine/forms'

describe('records views', () => {
  test('Records filing lists filed records with status and records class', () => {
    const html = renderToString(<RecordsFiling />)
    for (const t of ['Records filing', 'Demo connector', 'Filed', 'Awaiting verification', 'Forms in review', 'Filed records', 'PRJ-10', 'ENG-500 Pipeline integrity records', 'PDF']) expect(html).toContain(t)
  })
  test('Configuration: when to file, records system, deliverable-to-records mapping', () => {
    const html = renderToString(<RecordsSettingsTab />)
    for (const t of ['When to file', 'On approval', 'After records verification', 'Records system', 'OpenText Content Server', 'Folder pattern', 'Standard capital project (5 stages)', 'Pipeline records review (MAOP basis)', 'Pre-start-up safety review', 'Records classes and retention — verify', 'Life of the facility']) expect(html).toContain(t)
  })
  test('a form renders pre-filled fields, checklists and tables', () => {
    const s = buildSeed(); const p = s.projects[0]; const t = formFor('d-precon')!
    const html = renderToString(<FormBody t={t} data={formValues(s, p, t, {})} editable onChange={() => {}} />)
    for (const x of ['Readiness', 'From Crosswalk', p.code, 'Permits on hand', 'Inspector assigned', 'Mobilization date']) expect(html).toContain(x)
  })
})
