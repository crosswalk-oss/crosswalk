import { renderToString } from 'react-dom/server'
import { useStore } from '@/core/store'
import { candidates, newScenario, suggestFit } from '../planning/model'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }

import Admin from '../admin/Admin'
import Planning from '../planning/Planning'
import Audit from './Audit'
import Permits from '../project/tabs/Permits'
import Records from '../project/tabs/Records'

const tabs = ['templates', 'programs', 'cbs', 'libraries', 'fields', 'people', 'data']
test('admin tabs render', () => {
  for (const t of tabs) {
    mem['crosswalk:admin-tab'] = JSON.stringify(t)
    const html = renderToString(<Admin />)
    expect(html.length).toBeGreaterThan(500)
  }
})
test('planning renders with scenarios', () => {
  const s = useStore.getState()
  const base = newScenario('Base', s.settings.asOf)
  const sug = suggestFit(s as any, candidates(s as any), newScenario('Fit', s.settings.asOf, base), [2026, 2027, 2028, 2029, 2030])
  mem['crosswalk:planning:scenarios:v1'] = JSON.stringify([base, sug.scenario])
  const html = renderToString(<Planning />)
  expect(html).toContain('Benefit-cost ranking')
})
test('audit renders', () => { expect(renderToString(<Audit />)).toContain('Audit log') })
test('permits + records render for every project', () => {
  for (const p of useStore.getState().projects) {
    renderToString(<Permits projectId={p.id} />)
    renderToString(<Records projectId={p.id} />)
  }
})
