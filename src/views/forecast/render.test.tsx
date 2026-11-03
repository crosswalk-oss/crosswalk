// SSR smoke + store flows for the forecast spread module (builder G).
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mutate, useStore } from '@/core/store'
import { buildSeed } from '@/core/seed'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { eacOf, forecastMonths } from '@/core/engine/wbs'
import ForecastSpread from '../project/tabs/ForecastSpread'
import ForecastCycle from './ForecastCycle'
import WbsFunctions, { wbsIssues } from '../admin/WbsFunctions'
import { forecastReportHtml } from './report'
import { applySpread, copyVersion, cycleRows, setCell, startCycle, versionsOf } from './lib'

// SSR reads zustand's initial-state object; copy live state into it so renders reflect mutations and persona switches.
const render = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return renderToString(el) }

describe('forecast views render from seed', () => {
  beforeAll(() => { useStore.setState(buildSeed()) })
  it('renders the spread tab for every project', () => {
    for (const p of useStore.getState().projects) {
      let html = ''
      try { html = render(<ForecastSpread projectId={p.id} />) } catch (e) { throw new Error(`${p.code}: ${(e as Error).message}`) }
      expect(html.length).toBeGreaterThan(200)
    }
    const h = render(<ForecastSpread projectId="prj-1001" />)
    expect(h).toContain('Spread by function and line item')
    expect(h).toContain('ETC / EAC by WBS function')
    expect(h).toContain('Contingency held')
    expect(h).toContain('Compare versions')
  })
  it('renders cycle and configuration', () => {
    const c = render(<ForecastCycle />)
    expect(c).toContain('Forecast cycle')
    expect(c).toContain('Portfolio roll-up')
    expect(c).toContain('ETC / EAC by WBS function — portfolio')
    expect(c).toContain('Not started')
    const w = render(<WbsFunctions />)
    expect(w).toContain('Cost category mapping')
    expect(w).toContain('Construction')
  })
  it('builds the HTML report', () => {
    const s = useStore.getState()
    const p = s.projects.find((x) => x.code === 'PRJ-1001')!
    expect(forecastReportHtml(s, p, versionsOf(s, p.id)[0])).toContain('ETC / EAC by WBS function and line item')
  })
})

describe('forecast flows through the store', () => {
  beforeEach(() => { useStore.setState(buildSeed()) })
  it('new version → edit → save → submit → approve locks it', () => {
    const s0 = useStore.getState()
    const p = s0.projects.find((x) => x.code === 'PRJ-1011')!
    const { forecast } = copyVersion(s0, p, versionsOf(s0, p.id)[0], { byId: 'u-me', note: 'test' })
    mutate((d) => { d.forecasts.push(forecast) })
    const m = forecastMonths(useStore.getState(), p)[0]
    const sp = setCell(forecast.spread!, 'wbs-500', m, (forecast.spread!['wbs-500']?.[m] ?? 0) + 250_000)
    mutate((d) => { const f = d.forecasts.find((x) => x.id === forecast.id)!; applySpread(d, f, sp, forecast.contingencyHeld ?? 0, 'Rock') }, { entity: 'forecast', entityId: forecast.id, action: 'update', summary: 'x' })
    let f = useStore.getState().forecasts.find((x) => x.id === forecast.id)!
    expect(f.eac).toBe(forecast.eac + 250_000)
    expect(f.eac).toBe(eacOf(useStore.getState(), p.id, f.spread, f.contingencyHeld))
    expect(render(<ForecastSpread projectId={p.id} />)).toContain('Submit for review')
    mutate((d) => {
      const inst = startWorkflow(d, 'forecast-review', { title: `${p.code} test`, recordType: 'forecast', recordId: forecast.id, projectId: p.id, data: { amount: f.eac, period: '2026-11', note: 'Rock' } })!
      actOnWorkflow(d, inst.id, 'prep', 'u-me', 'submit')
      while (d.workflows.find((w) => w.id === inst.id)!.status === 'running') {
        const slot = d.workflows.find((w) => w.id === inst.id)!.active[0]
        actOnWorkflow(d, inst.id, slot.nodeId, 'u-me', 'approve')
      }
    })
    f = useStore.getState().forecasts.find((x) => x.id === forecast.id)!
    expect(f.status).toBe('approved')
    expect(f.locked).toBe(true)
    expect(render(<ForecastSpread projectId={p.id} />)).toContain('Create new version from this')
  })
  it('start cycle opens drafts that the cycle view reports', () => {
    mutate((d) => { startCycle(d, 'u-me') })
    expect(cycleRows(useStore.getState()).some((r) => r.status === 'not-started')).toBe(false)
    expect(render(<ForecastCycle />)).not.toContain('have no November 2026 forecast yet')
  })
  it('flags unmapped and double-mapped categories', () => {
    const s = useStore.getState()
    const fns = s.settings.wbsFunctions.map((f) => (f.code === '600' ? { ...f, categoryIds: [] } : f.code === '100' ? { ...f, categoryIds: [...f.categoryIds, 'cat-eng'] } : f))
    const i = wbsIssues(fns, s.categories)
    expect(i.unmapped.map((c) => c.id)).toEqual(['cat-commission'])
    expect(i.multi.map((c) => c.id)).toEqual(['cat-eng'])
    expect(wbsIssues(s.settings.wbsFunctions, s.categories).unmapped.length).toBe(0)
  })
})
