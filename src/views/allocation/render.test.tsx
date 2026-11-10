import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import Allocation from './Allocation'
import AllocationSettingsTab from '@/views/admin/AllocationSettings'

describe('Capital allocation views', () => {
  test('page: weights for every measure, presets, capital available, frontier, delivered benefit and the project table', () => {
    const html = renderToString(<Allocation />)
    for (const t of ['Capital allocation', 'Weighting', 'Safety', 'Outages avoided', 'Added capacity', 'Redundancy', 'Emissions reduced', 'O&amp;M savings', 'Safety first', 'Emissions', 'Capital available', 'Use authorized funding', 'Risk-adjust benefit by delivery confidence', 'Benefit for each level of capital', 'What the funded plan delivers', 'Cost to complete', 'Confidence', 'Pts per $M', 'PRJ-1021', 'Committed', 'Not funded', 'Must fund', 'Measures and scale — verify', 'Configure measures']) expect(html).toContain(t)
    expect(html).not.toMatch(/disadvantaged community/i)
  })
  test('Configuration tab: measures table, presets, funding rules and a live preview', () => {
    const html = renderToString(<AllocationSettingsTab />)
    for (const t of ['Benefit measures', '+ Add measure', 'Restore defaults', '100 points =', 'Weight', 'Share', 'Group', 'Reliability', 'Financial', 'Environmental', 'Weighting presets', '+ Add preset from current weights', 'Funding rules', 'Fund committed projects first', 'Risk-adjust benefit by delivery confidence', 'Preview with these settings', 'Projects funded']) expect(html).toContain(t)
  })
})
