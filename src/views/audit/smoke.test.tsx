import { renderToString } from 'react-dom/server'
import { useStore } from '@/core/store'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }

import Admin from '../admin/Admin'
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
test('audit renders', () => { expect(renderToString(<Audit />)).toContain('Audit log') })
test('permits + records render for every project', () => {
  for (const p of useStore.getState().projects) {
    renderToString(<Permits projectId={p.id} />)
    renderToString(<Records projectId={p.id} />)
  }
})
