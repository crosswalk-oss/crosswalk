import { buildSeed } from '@/core/seed'
import { produce } from 'immer'
import { startWorkflow, actOnWorkflow } from '@/core/engine/workflow'
import { ensureDeliverables } from '@/core/engine/gates'
import { validateImport } from '../admin/Data'

test('contract award routes and awards', () => {
  let s = buildSeed()
  const c = s.contracts.find((x) => x.status === 'rfp')!
  s = produce(s, (d) => { startWorkflow(d, 'contract-award', { title: 't', recordType: 'contract', recordId: c.id, projectId: c.projectId, data: { amount: c.value, nonStandard: true, vendor: 'X' } }) })
  const inst = s.workflows.find((w) => w.recordId === c.id)!
  expect(inst.status).toBe('running')
  for (let i = 0; i < 6; i++) {
    const cur = s.workflows.find((w) => w.id === inst.id)!
    if (cur.status !== 'running') break
    const slot = cur.active[0]
    s = produce(s, (d) => actOnWorkflow(d, inst.id, slot.nodeId, slot.assigneeIds[0], slot.nodeId === 'prep' ? 'submit' : 'approve'))
  }
  const fin = s.workflows.find((w) => w.id === inst.id)!
  console.log('award path', fin.history.map((h) => h.nodeId + ':' + h.action).join(' > '))
  expect(fin.status).toBe('approved')
  expect(s.contracts.find((x) => x.id === c.id)!.status).toBe('awarded')
})

test('closeout workflow starts', () => {
  let s = buildSeed()
  s = produce(s, (d) => { startWorkflow(d, 'closeout', { title: 't', recordType: 'closeout', recordId: 'prj-1004', projectId: 'prj-1004', data: {} }) })
  const w = s.workflows.find((x) => x.defKey === 'closeout')!
  expect(w.active.length).toBe(1)
  console.log('closeout assignees', w.active[0].assigneeIds)
})

test('template edit adds deliverables to active projects', () => {
  let s = buildSeed()
  const before = s.deliverables.length
  s = produce(s, (d) => {
    const st = d.templates[0].stages[2]
    st.gate.deliverables.push({ id: 'd-new', name: 'Traffic plan', description: '', kind: 'document', ownerRole: 'pm', reviewerRole: 'pmo', acceptance: 'x', condition: { field: 'permitsNeeded.encroachment', op: 'truthy' } })
    for (const p of d.projects) if (p.status === 'active') ensureDeliverables(d, p)
  })
  console.log('new deliverables', s.deliverables.length - before)
  expect(s.deliverables.length).toBeGreaterThan(before)
})

test('import validation', () => {
  expect(validateImport({ schemaVersion: 1 }).ok).toBe(false)
  expect(validateImport(JSON.parse(JSON.stringify(buildSeed()))).ok).toBe(true)
})
