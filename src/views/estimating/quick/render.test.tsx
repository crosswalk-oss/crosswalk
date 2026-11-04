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
  test('PM request: length, location and Low / Medium / High risk ratings; live parametric result with Monte Carlo; no adjust controls', () => {
    as('u-pm1')
    const p = st().projects.find((x) => x.code === 'PRJ-1005')!
    const html = renderToString(<QuickRequest projectId={p.id} />)
    for (const t of ['Length of pipe (feet)', 'Location (region)', 'Pipe and work', 'Risks that drive the estimate', 'Traffic control &amp; lane closures', 'Soil &amp; rock conditions', 'Road, rail &amp; water crossings', 'Low risk', 'Medium risk', 'High risk', 'What is it for', 'Send to estimating team', 'Forward-looking estimate', 'Monte Carlo', 'P80', 'Tornado', 'How the number is built', 'Rate table', 'Risk-based contingency', 'AACE Class 5']) expect(html).toContain(t)
    for (const t of ['Adjustment %', 'Override reason', 'Site cost drivers', 'Diameter band']) expect(html).not.toContain(t)
    expect(html).not.toMatch(/disadvantaged/i)
    const nn = renderToString(<QuickRequest allowPicker />)
    expect(nn).toContain('New need — no project yet')
    expect(nn).toContain('start a new project')
  })

  test('estimator sees the review panel (re-rate risks, ±%, reason) on an in-review request; the requester does not', () => {
    const e = st().estimates.find((x) => x.method === 'quick' && x.status === 'in-review' && x.parametric)!
    const p = st().projects.find((x) => x.id === e.projectId)!
    as('u-est1')
    const html = renderToString(<QuickEstimateView estimate={e} project={p} />)
    for (const t of ['Review and adjust (estimating team)', 'Adjustment % of direct', 'Reason (required)', st().settings.factorModel.overrideReasons[0], 'Before → after (P80)', 'Soil &amp; rock conditions', 'Monte Carlo', 'Basis of estimate', 'Model check (estimating team)', 'Length of pipe']) expect(html).toContain(t)
    as(e.createdById)
    const pm = renderToString(<QuickEstimateView estimate={e} project={p} />)
    expect(pm).not.toContain('Review and adjust (estimating team)')
    expect(pm).toContain('The requester cannot change the number after sending it.')
  })

  test('adjusted and approved estimate shows its adjustment history', () => {
    as('u-me')
    const e = st().estimates.find((x) => x.method === 'quick' && x.quick?.adjustment)!
    const p = st().projects.find((x) => x.id === e.projectId)!
    const html = renderToString(<QuickEstimateView estimate={e} project={p} />)
    expect(html).toContain('Adjustment history')
    expect(html).toContain('Omar Siddiqui')
    expect(html).toContain('flood-control channel')
    expect(html).toMatch(/was (<!-- -->)?low risk/)
  })

  test('inbox record summary for a quick estimate task', () => {
    as('u-est2')
    const e = st().estimates.find((x) => x.method === 'quick' && x.status === 'in-review' && x.parametric)!
    const inst = st().workflows.find((w) => w.id === e.workflowInstanceId)!
    const html = renderToString(<RecordSummary s={st()} inst={inst} />)
    expect(html).toContain('Quick · Class 5')
    expect(html).toContain('Review and adjust (estimating team)')
    expect(html).toContain('What it is for')
    expect(html).toContain('Traffic control &amp; lane closures')
  })

  test('project estimates tab marks quick estimates and offers the request action', () => {
    as('u-me')
    const p = st().projects.find((x) => x.code === 'PRJ-1012')!
    const html = renderToString(<Estimates projectId={p.id} />)
    expect(html).toContain('Quick · Class 5')
    expect(html).toContain('Request Class 5 quick estimate')
    expect(html).toContain('Traffic control &amp; lane closures')
    expect(html).toContain('Monte Carlo')
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
