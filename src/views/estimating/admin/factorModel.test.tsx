import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import { mutate, useStore } from '@/core/store'
import { actOnWorkflow, tasksFor } from '@/core/engine/workflow'
import { openDraft, publishedModel, saveDraft } from '@/core/engine/factorModel'
import { submitFactorModel } from '@/core/engine/factorWorkflow'
import { RecordSummary } from '@/views/inbox/records'
import { FactorModelAdmin } from './FactorModel'
import { EstimatingAdmin } from './Admin'

const st = () => useStore.getState()
const as = (id: string) => { useStore.setState({ currentUserId: id }); (useStore.getInitialState() as any).currentUserId = id }

describe('Factor model administration', () => {
  test('estimator sees the editable draft with weights, multipliers, submit gate and tabs', () => {
    as('u-est2')
    const html = renderToString(<FactorModelAdmin s={st()} canEdit />)
    expect(html).toMatch(/factor model/i)
    for (const t of ['Published', 'Draft v3', 'Driver factors', 'Soil / rock', 'Crossings', 'Permit complexity', 'Work-hour restrictions', 'Remoteness / access', 'Run backtest', 'Save draft', 'Submit for approval', 'Discard draft', 'Base rates &amp; uncertainty', 'Draft vs published', 'Version history', 'Override reasons &amp; gate', 'You can edit this draft']) expect(html).toContain(t)
    expect(html).toContain('type="range"')
    expect(html).not.toMatch(/disadvantaged/i)
  })

  test('read-only for people outside the estimating team; the admin shell lists the sub-tab', () => {
    as('u-pm1')
    const html = renderToString(<FactorModelAdmin s={st()} canEdit={false} />)
    expect(html).toContain('Read-only')
    expect(html).not.toContain('Save draft')
    expect(html).not.toContain('Submit for approval')
    mem['crosswalk:estimating:admin'] = 'factor'
    expect(renderToString(<EstimatingAdmin s={st()} />)).toContain('Driver factors')
  })

  test('gate failure blocks submission with reasons shown', () => {
    as('u-est2')
    mutate((d) => { d.settings.factorModel.gate.maxMape = 5 })
    const html = renderToString(<FactorModelAdmin s={st()} canEdit />)
    expect(html).toContain('Blocked by the publish gate')
    expect(html).toMatch(/Mean absolute % error [\d.]+% \(needs ≤ 5%\)/)
    mutate((d) => { d.settings.factorModel.gate.maxMape = 25 })
  })

  test('store walk: estimator edits and submits → lead approves in the inbox → published, prior retired', () => {
    as('u-est2')
    const draft = openDraft(st())!
    const prior = publishedModel(st())!
    mutate((d) => { saveDraft(d, { ...draft, factors: draft.factors.map((f) => (f.id === 'f-hours' ? { ...f, weight: 0.9 } : f)) }, 'u-est2') })
    expect(st().audit.at(-1)!.summary).toMatch(/Work-hour restrictions: weight 1\.00 → 0\.90/)
    let res: ReturnType<typeof submitFactorModel> = { ok: false, reasons: [] }
    mutate((d) => { res = submitFactorModel(d, draft.id, 'u-est2', 'Hours weight trimmed') })
    expect(res.reasons).toEqual([])
    const task = tasksFor(st(), 'u-estl').find((t) => t.inst.id === res.instId)!
    expect(task.node.label).toBe('Estimating lead approval')
    as('u-estl')
    const summary = renderToString(<RecordSummary s={st()} inst={task.inst} />)
    expect(summary).toMatch(/Factor model v(<!-- -->)?3/)
    expect(summary).toContain('weight 1.00 → 0.90')
    mutate((d) => actOnWorkflow(d, res.instId!, 'lead', 'u-estl', 'approve', 'Approved'))
    expect(publishedModel(st())!.id).toBe(draft.id)
    expect(st().factorModels.find((m) => m.id === prior.id)!.status).toBe('retired')
    const html = renderToString(<FactorModelAdmin s={st()} canEdit />)
    expect(html).toMatch(/Start a new draft from v(<!-- -->)?3/)
  })
})
