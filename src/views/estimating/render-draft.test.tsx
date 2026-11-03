// SSR snapshots use the store's initial state, so seed the drafts through a mocked buildSeed.
import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: () => {} }
vi.mock('@/core/seed', async (orig) => {
  const m: any = await orig()
  const lib = await import('./lib')
  return { ...m, buildSeed: () => {
    const s = m.buildSeed()
    const p1 = s.projects.find((x: any) => x.code === 'PRJ-1001')
    s.estimates.push(lib.buildFromExisting(s, lib.latestEstimate(s, p1.id)!, 'u-me', { split: ['A', 'B'], toClass3: true }))
    const p2 = s.projects.find((x: any) => x.code === 'PRJ-1023')
    s.estimates.push(lib.buildParametric(s, p2, lib.defaultInputs(p2, s), 'u-me'))
    const p3 = s.projects.find((x: any) => x.code === 'PRJ-1026')
    s.estimates.push(lib.buildParametric(s, p3, lib.defaultInputs(p3, s), 'u-me'))
    return s
  } }
})
import Estimates from '@/views/project/tabs/Estimates'

test('draft editor renders for line-item, station and valve drafts', () => {
  for (const id of ['prj-1001', 'prj-1023', 'prj-1026']) {
    const html = renderToString(<Estimates projectId={id} />)
    expect(html).toContain('Submit for approval')
    expect(html).toContain('+ From library')
    expect(html).toContain('Locked pricing')
  }
})
