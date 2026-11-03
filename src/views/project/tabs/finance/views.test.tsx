// SSR smoke tests: the Finance tab, commitment detail, RFI / CCO form, the Overview scope statement and key facts,
// the Changes tab and the inbox record summary render for seed projects and several personas.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useStore, mutate } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { notifyScheduler } from '@/core/engine/finance'
import Finance from '../Finance'
import Overview from '../Overview'
import Changes from '../Changes'
import ProjectInfo from '../ProjectInfo'
import { CommitmentDetail } from './CommitmentDetail'
import { CcoModal } from './CcoModal'
import { RecordSummary, recordTab } from '../../../inbox/records'

const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el).replace(/<!-- -->/g, '') }

describe('finance views render from seed', () => {
  beforeAll(() => { useStore.setState(buildSeed()) })
  it('renders the Finance tab for every project as PMO, a PM and the scheduler', () => {
    for (const user of ['u-me', 'u-pm1', 'u-sch']) {
      useStore.setState({ currentUserId: user })
      for (const p of useStore.getState().projects) {
        const html = render(<Finance projectId={p.id} />)
        expect(html).toContain('Financial accounts')
        expect(html).toContain('IO coverage by WBS function')
        expect(html).toContain('Estimate line coverage')
        expect(html).toContain('Commitments')
      }
    }
  })
  it('shows commitments with PO share and the CCO log for a construction-stage project', () => {
    useStore.setState({ currentUserId: 'u-me' })
    const s = useStore.getState()
    const html = render(<Finance projectId="prj-1001" />)
    const k = s.contracts.find((c) => c.projectId === 'prj-1001' && c.type === 'Construction')!
    expect(html).toContain(k.poNumber!)
    expect(html).toContain('RFI / change order log')
    expect(html).toContain(s.projects.find((p) => p.id === 'prj-1001')!.finance!.woa!)
  })
  it('renders a commitment with its RFI / CCOs and the new CCO form', () => {
    const s = useStore.getState()
    const k = s.contracts.find((c) => s.commitmentChanges.some((x) => x.contractId === c.id && x.status === 'in-review'))!
    const cc = s.commitmentChanges.find((x) => x.contractId === k.id && x.status === 'in-review')!
    const html = render(<CommitmentDetail contractId={k.id} focusCco={cc.id} onClose={() => {}} onEdit={() => {}} onNewCco={() => {}} />)
    expect(html).toContain(cc.code)
    expect(html).toContain('Approved changes')
    const form = render(<CcoModal projectId={k.projectId} seed={{ contractId: k.id }} onClose={() => {}} />)
    expect(form).toContain('RFI / field condition')
    expect(form).toContain('Routing (live from the workflow)')
  })
  it('renders the commitment-change record in the inbox', () => {
    const s = useStore.getState()
    const inst = s.workflows.find((w) => w.recordType === 'commitment-change' && w.status === 'running')!
    expect(recordTab(inst)).toBe('finance')
    const html = render(<RecordSummary s={s} inst={inst} />)
    const cc = s.commitmentChanges.find((x) => x.id === inst.recordId)!
    expect(html).toContain(cc.code)
    expect(html).toContain('RFI / field condition')
  })
  it('Overview shows WOA, IOs and the capital / O&M split; Project info shows deliverable completeness', () => {
    const s = useStore.getState()
    const p = s.projects.find((x) => x.id === 'prj-1002')!
    const html = render(<Overview projectId={p.id} />)
    expect(html).toContain('Internal orders')
    expect(html).toContain(p.finance!.ios[0].number)
    expect(html).toContain('Capital / O&amp;M')
    const info = render(<ProjectInfo projectId={p.id} />)
    expect(info).toContain('Deliverable completeness')
  })
  it('Changes shows the commitments and scheduler columns and the design note', () => {
    const s = useStore.getState()
    const ch = s.changes.find((c) => c.scheduleImpactDays > 0 && c.contractIds?.length)!
    mutate((d) => { notifyScheduler(d, ch.id) })
    const html = render(<Changes projectId={ch.projectId} />)
    expect(html).toContain('How a change reaches vendors and the schedule')
    expect(html).toContain('Task sent')
  })
})
