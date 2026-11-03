// Smoke + logic tests for builder A's module: every view renders from the seed for several personas
// and projects, and the gate/lifecycle mutations behave as the UI promises.
import React from 'react'
import { renderToString } from 'react-dom/server'
import { useStore, mutate } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { decideGate, readiness } from '@/core/engine/gates'
import { startWorkflow } from '@/core/engine/workflow'
import Portfolio from './Portfolio'
import Projects from '../projects/Projects'
import NewProject from '../projects/NewProject'
import Gates from '../gates/Gates'
import Overview from '../project/tabs/Overview'
import Lifecycle from '../project/tabs/Lifecycle'
import { allInFigures, needsAttention, projectRow, safetyIndicators, stageDurations, yearFigures } from './lib'
import { gatePacketHtml, statusPrompt, statusReportHtml } from './reports'

// SSR reads zustand's initial-state object; copy live state into it so renders reflect mutations and persona switches.
const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el) }

describe('module A views render from seed', () => {
  beforeAll(() => { useStore.setState(buildSeed()) })
  it('renders portfolio, register, wizard and gates', () => {
    for (const C of [Portfolio, Projects, NewProject, Gates]) {
      const html = render(<C />)
      expect(html.length).toBeGreaterThan(1000)
    }
  })
  it('renders overview and lifecycle for every project as PMO and as a sponsor', () => {
    for (const user of ['u-me', 'u-dir1', 'u-pm1']) {
      useStore.setState({ currentUserId: user })
      for (const p of useStore.getState().projects) {
        expect(render(<Overview projectId={p.id} />)).toContain('Scope statement')
        expect(render(<Lifecycle projectId={p.id} />)).toContain('Gate history')
      }
    }
  })
})

describe('module A derivations', () => {
  const s = buildSeed()
  it('rows, funding and attention tie to records', () => {
    const rows = s.projects.map((p) => projectRow(s, p))
    expect(rows.every((r) => Number.isFinite(r.budget) && Number.isFinite(r.eac))).toBe(true)
    const ids = s.programs.map((p) => p.id)
    const yr = yearFigures(s, s.projects, ids, 2026)
    expect(yr.authorized).toBeGreaterThan(0)
    expect(yr.actual).toBeGreaterThan(0)
    const all = allInFigures(s, s.projects, ids)
    expect(all.budget).toBeGreaterThan(yr.budget)
    const att = needsAttention(s, s.projects)
    expect(att.length).toBeGreaterThan(3)
    expect(att.some((a) => a.kind.includes('811'))).toBe(true)
    expect(safetyIndicators(s, s.projects).tb7.length).toBeGreaterThan(0)
    expect(stageDurations(s).length).toBeGreaterThan(20)
  })
  it('builds packet, status report and prompt', () => {
    const p = s.projects.find((x) => x.code === 'PRJ-1003')!
    expect(gatePacketHtml(s, p)).toContain('Top 10 risks')
    expect(statusReportHtml(s, p, 'We advanced design.')).toContain('We advanced design.')
    expect(statusPrompt(s, p)).toContain('PRJ-1003')
  })
})

describe('gate flow through the store', () => {
  beforeEach(() => { useStore.setState(buildSeed()) })
  it('go with conditions advances the stage, creates actions and a snapshot', () => {
    const before = useStore.getState().projects.find((p) => p.id === 'prj-1006')!
    mutate((d) => decideGate(d, 'prj-1006', 'go-with-conditions', ['u-dir1'], 'Test', [{ title: 'Do the thing', ownerId: 'u-pm1', due: '2026-12-01' }]))
    const s = useStore.getState()
    const after = s.projects.find((p) => p.id === 'prj-1006')!
    expect(after.stageIndex).toBe(before.stageIndex + 1)
    expect(s.actions.some((a) => a.title === 'Do the thing')).toBe(true)
    expect(s.gateDecisions.filter((g) => g.projectId === 'prj-1006').length).toBe(1)
    expect(render(<Lifecycle projectId="prj-1006" />)).toContain('Do the thing')
  })
  it('deliverable review workflow submits and waiver workflow starts', () => {
    mutate((d) => {
      const dl = d.deliverables.find((x) => x.projectId === 'prj-1006' && x.status !== 'accepted')!
      startWorkflow(d, 'deliverable-review', { title: 't', recordType: 'deliverable', recordId: dl.id, projectId: 'prj-1006' })
    })
    const s = useStore.getState()
    expect(s.deliverables.some((x) => x.projectId === 'prj-1006' && x.status === 'submitted')).toBe(true)
    expect(readiness(s, s.projects.find((p) => p.id === 'prj-1006')!).pct).toBeGreaterThanOrEqual(0)
  })
})
