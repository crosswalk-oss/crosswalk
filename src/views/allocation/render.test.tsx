import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import Allocation from './Allocation'

describe('Capital allocation view', () => {
  test('weights, capital available, frontier, delivered benefit and the project table render', () => {
    const html = renderToString(<Allocation />)
    for (const t of ['Capital allocation', 'Weighting', 'Safety', 'Added capacity', 'Redundancy', 'Capital available', 'Use authorized funding', 'Benefit for each level of capital', 'What the funded plan delivers', 'Cost to complete', 'Pts per $M', 'PRJ-1021', 'Committed', 'Not funded', 'Must fund', 'Weights and scale — verify']) expect(html).toContain(t)
    expect(html).not.toMatch(/disadvantaged community/i)
  })
})
