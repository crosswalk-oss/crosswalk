import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import { useStore } from '@/core/store'
import Estimates from '@/views/project/tabs/Estimates'
import Estimating from './Estimating'

test('every project estimates tab renders', () => {
  for (const p of useStore.getState().projects) {
    const html = renderToString(<Estimates projectId={p.id} />)
    expect(html.length).toBeGreaterThan(1000)
  }
})
test('estimating home renders each tab', () => {
  for (const t of ['register', 'library', 'accuracy', 'analogs']) {
    mem['crosswalk:estimating:tab'] = t
    const html = renderToString(<Estimating />)
    expect(html).toContain('Estimating')
  }
})
test('estimating administration renders every section', () => {
  mem['crosswalk:estimating:tab'] = 'admin'
  for (const sub of ['rates', 'reprice', 'regions', 'markups', 'units', 'scope', 'maturity', 'log']) {
    mem['crosswalk:estimating:admin'] = sub
    const html = renderToString(<Estimating />)
    expect(html).toContain('Rate table')
    if (sub === 'reprice') expect(html).toContain('Projects priced on an older rate table')
    if (sub === 'markups') expect(html).toContain('contingency drawdown policy')
  }
})
