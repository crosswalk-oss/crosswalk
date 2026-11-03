import { renderToString } from 'react-dom/server'
import { useStore } from '@/core/store'
import Baselines from '../project/tabs/Baselines'
import Cost from '../project/tabs/Cost'
import Changes from '../project/tabs/Changes'
import Evidence from '../project/tabs/Evidence'
import Regulatory from './Regulatory'
import { snapshotHtml } from '../project/tabs/Baselines'

test('renders all views for all projects', () => {
  const s = useStore.getState()
  for (const p of s.projects) {
    for (const C of [Baselines, Cost, Changes, Evidence]) {
      try { renderToString(<C projectId={p.id} />) } catch (e) { throw new Error(`${p.code} ${C.name}: ${(e as Error).message}`) }
    }
  }
  const h = renderToString(<Regulatory />)
  expect(h).toContain('Rate case')
  expect(snapshotHtml(s, s.snapshots[0])).toContain('Authority')
})
