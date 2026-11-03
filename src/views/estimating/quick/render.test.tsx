import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import { mutate, useStore } from '@/core/store'
import { estimateTotals } from '@/core/engine/estimates'
import { actOnWorkflow, tasksFor } from '@/core/engine/workflow'
import { inputsFromProject } from '@/core/engine/quick'
import { applyAdjustment, submitQuickRequest } from './lib'
import Estimating from '../Estimating'
import Estimates from '@/views/project/tabs/Estimates'
import QuickEstimateSettings from '@/views/admin/QuickEstimateSettings'
import { RecordSummary } from '@/views/inbox/records'
import { QuickRequest } from './QuickForm'
import { QuickEstimateView } from './QuickView'
import { DeriveModal, HistDrawer, HistoricalCosts, ImportModal } from './Historical'

// Server rendering reads the store's initial snapshot, so switch persona there too.
const st = () => useStore.getState()
const as = (id: string) => { useStore.setState({ currentUserId: id }); (useStore.getInitialState() as any).currentUserId = id }

describe('Class 5 quick estimate views', () => {
  test('request form renders dropdowns and a live result for a project and for a new need', () => {
    as('u-pm1')
    const p = st().projects.find((x) => x.code === 'PRJ-1005')!
    const html = renderToString(<QuickRequest projectId={p.id} />)
    for (const t of ['Asset type', 'Work method', 'Diameter band', 'Setting', 'Region (district)', 'Quantity (feet)', 'Spend midpoint year', 'Site cost drivers', 'Soil / rock', 'Permit complexity', 'Work-hour restrictions', 'What is it for', 'Send to estimating team', 'Forward-looking estimate', 'Factor model', 'Cost drivers', 'Base rate × quantity', '= Direct cost', 'Rate-table check', 'Generated basis of estimate', 'Draft wording — verify', 'Run Monte Carlo', 'AACE Class 5']) expect(html).toContain(t)
    expect(html).not.toMatch(/disadvantaged/i)
    const nn = renderToString(<QuickRequest allowPicker />)
    expect(nn).toContain('New need — no project yet')
    expect(nn).toContain('start a new project')
    // unbanded asset hides the band
    const c = st().projects.find((x) => x.code === 'PRJ-1023')!
    expect(renderToString(<QuickRequest projectId={c.id} />)).not.toContain('Diameter band')
  })

  test('estimator sees the Adjust panel on an in-review quick estimate; others do not', () => {
    const e = st().estimates.find((x) => x.method === 'quick' && x.status === 'in-review')!
    const p = st().projects.find((x) => x.id === e.projectId)!
    as('u-est1')
    const html = renderToString(<QuickEstimateView estimate={e} project={p} />)
    expect(html).toContain('Adjust (estimating team)')
    expect(html).toContain('Override reason (required)')
    expect(html).toContain(st().settings.factorModel.overrideReasons[0])
    expect(html).toContain('Before → after')
    for (const t of ['Rate-table check', 'Basis of estimate', 'Draft wording — verify', 'Run Monte Carlo', 'Site drivers']) expect(html).toContain(t)
    expect(html).toMatch(/Cost drivers · factor model v(<!-- -->)?2/)
    expect(html).toContain('Quick · Class 5')
    as('u-pm1')
    expect(renderToString(<QuickEstimateView estimate={e} project={p} />)).not.toContain('Adjust (estimating team)')
  })

  test('adjusted and approved estimate shows its adjustment history', () => {
    as('u-me')
    const e = st().estimates.find((x) => x.method === 'quick' && x.quick?.adjustment)!
    const p = st().projects.find((x) => x.id === e.projectId)!
    const html = renderToString(<QuickEstimateView estimate={e} project={p} />)
    expect(html).toContain('Adjustment history')
    expect(html).toContain('Omar Siddiqui')
    expect(html).toContain('+12%')
    expect(html).toContain('flood-control channel')
  })

  test('inbox record summary for a quick estimate task', () => {
    as('u-est2')
    const e = st().estimates.find((x) => x.method === 'quick' && x.status === 'in-review')!
    const inst = st().workflows.find((w) => w.id === e.workflowInstanceId)!
    const html = renderToString(<RecordSummary s={st()} inst={inst} />)
    expect(html).toContain('Quick · Class 5')
    expect(html).toContain('Adjust (estimating team)')
    expect(html).toContain('What it is for')
  })

  test('project estimates tab marks quick estimates and offers the request action', () => {
    as('u-me')
    const p = st().projects.find((x) => x.code === 'PRJ-1012')!
    const html = renderToString(<Estimates projectId={p.id} />)
    expect(html).toContain('Quick · Class 5')
    expect(html).toContain('Request Class 5 quick estimate')
    expect(html).toContain('Cost drivers')
    expect(html).toContain('Rate-table check')
  })

  test('historical cost table, drawer, import and derive render', () => {
    as('u-est1')
    const html = renderToString(<HistoricalCosts />)
    for (const t of ['Historical cost table', 'Export CSV', 'Import CSV', 'Derive from closed projects', 'Add row', 'P50', 'Base yr', 'Sources']) expect(html).toContain(t)
    const s = st()
    const d = renderToString(<HistDrawer s={s} row={s.historicalCosts[0]} canEdit onClose={() => {}} />)
    expect(d).toContain('Category mix')
    expect(d).toMatch(/100\.0(<!-- -->)?%/)
    expect(d).toContain('Deactivate row')
    expect(renderToString(<ImportModal s={s} onClose={() => {}} />)).toContain('Replace')
    const dv = renderToString(<DeriveModal s={s} onClose={() => {}} />)
    expect(dv).toContain('PRJ-1009')
    as('u-pm1')
    expect(renderToString(<HistoricalCosts />)).not.toContain('Add row')
  })

  test('estimating module quick and historical tabs, and the settings page', () => {
    as('u-est1')
    mem['crosswalk:estimating:tab'] = 'quick'
    const q = renderToString(<Estimating />)
    expect(q).toContain('Request a Class 5 quick estimate')
    expect(q).toContain('waiting on you')
    mem['crosswalk:estimating:tab'] = 'historical'
    expect(renderToString(<Estimating />)).toContain('Historical cost table')
    as('u-me')
    const set = renderToString(<QuickEstimateSettings />)
    for (const t of ['Region factors', 'West', 'Class 5 contingency', 'How the quick estimate works', 'Open historical costs']) expect(set).toContain(t)
  })

  test('store walk: PM requests → estimator adjusts → approves; estimate approved with the adjustment recorded', () => {
    as('u-pm2')
    const p = st().projects.find((x) => x.code === 'PRJ-1014')!
    let res: ReturnType<typeof submitQuickRequest> = { ok: false, message: '' }
    mutate((d) => { res = submitQuickRequest(d, p.id, { inputs: inputsFromProject(d, p), note: 'Planning budget for the Gate 1 business case' }) })
    expect(res.ok).toBe(true)
    const task = tasksFor(st(), 'u-est1').find((t) => t.inst.id === res.instId)!
    expect(task.node.id).toBe('est')
    const before = estimateTotals(st().estimates.find((e) => e.id === res.estimateId)!).total
    as('u-est1')
    mutate((d) => applyAdjustment(d, res.estimateId!, { pct: -6, basis: 'p50', reason: 'Rural ROW already secured under an existing easement' }, 'u-est1'))
    mutate((d) => actOnWorkflow(d, res.instId!, 'est', 'u-est1', 'approve', 'Adjusted −6%'))
    const e = st().estimates.find((x) => x.id === res.estimateId)!
    expect(e.status).toBe('approved')
    expect(e.approvedById).toBe('u-est1')
    expect(e.quick?.adjustment).toMatchObject({ pct: -6, byId: 'u-est1', fromTotal: before, toTotal: estimateTotals(e).total })
    expect(st().audit.some((a) => a.entityId === e.id && a.action === 'adjust')).toBe(true)
    expect(st().workflows.find((w) => w.id === res.instId)!.status).toBe('approved')
  })
})
