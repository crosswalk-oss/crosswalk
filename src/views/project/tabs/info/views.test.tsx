// SSR smoke tests: the Project Information record and its configuration tab render for every seed
// project and several personas, and a revision saved through the store shows up in both.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useStore, mutate } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { missingInfo, reviseInfo } from '@/core/engine/info'
import ProjectInfo from '../ProjectInfo'
import { CostDrivers } from './CostDrivers'
import InfoFields from '../../../admin/InfoFields'

const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el) }

describe('project information views render from seed', () => {
  beforeAll(() => { useStore.setState(buildSeed()) })
  it('renders the record for every project as PMO, a PM and a sponsor', () => {
    for (const user of ['u-me', 'u-pm1', 'u-dir1']) {
      useStore.setState({ currentUserId: user })
      for (const p of useStore.getState().projects) {
        const html = render(<ProjectInfo projectId={p.id} />)
        expect(html).toContain('Deliverable completeness')
        expect(html).toContain('Field completeness')
        expect(html).toContain('Revision history')
        expect(html).toContain('Linked records')
        for (const sec of useStore.getState().settings.infoSections) expect(html).toContain(sec.replace(/&/g, '&amp;'))
      }
    }
  })
  it('shows the project cost drivers the factor model prices with, with no community attributes', () => {
    useStore.setState({ currentUserId: 'u-me' })
    const p = useStore.getState().projects[0]
    expect(render(<ProjectInfo projectId={p.id} />)).toContain('Cost drivers')
    const html = render(<CostDrivers p={p} canEdit />)
    for (const t of ['Cost drivers', 'Soil / rock', 'Permit complexity', 'Work-hour restrictions', 'From the location record']) expect(html).toContain(t)
    expect(html).not.toMatch(/disadvantaged|\bDAC\b/i)
  })
  it('shows the gate blocker for a project missing required fields', () => {
    useStore.setState({ currentUserId: 'u-me' })
    const s = useStore.getState()
    const blocked = s.projects.find((p) => p.status === 'active' && missingInfo(s, p).length)
    expect(blocked).toBeTruthy()
    const html = render(<ProjectInfo projectId={blocked!.id} />).replace(/<!-- -->/g, '')
    expect(html).toMatch(/required fields? empty — blocks Gate/)
    for (const f of missingInfo(s, blocked!)) expect(html).toContain(f.label.replace(/&/g, '&amp;'))
  })
  it('renders the configuration tab', () => {
    const html = render(<InfoFields />)
    expect(html).toContain('Project information fields')
    expect(html).toContain('Active projects blocked')
    expect(html).toContain('problemStatement')
  })
})

describe('revision through the store', () => {
  beforeEach(() => { useStore.setState({ ...buildSeed(), currentUserId: 'u-me' }) })
  it('a saved revision appears in the history with its reason and diff', () => {
    mutate((d) => { reviseInfo(d, 'prj-1003', { constraints: 'Night work prohibited near hospital' }, 'Hospital district comments') })
    const html = render(<ProjectInfo projectId="prj-1003" />)
    expect(html).toContain('Hospital district comments')
    expect(html).toContain('Night work prohibited near hospital')
    expect(useStore.getState().audit.some((a) => a.entity === 'project-info' && a.entityId === 'prj-1003')).toBe(true)
  })
})
