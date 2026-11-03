import { buildSeed } from '@/core/seed'
import { boeCsv, boePdf } from './boe'
import { latestEstimate } from './lib'

const s = buildSeed()
test('BOE downloads as PDF and CSV', async () => {
  for (const code of ['PRJ-1001', 'PRJ-1003', 'PRJ-1006', 'PRJ-1020']) {
    const p = s.projects.find((x) => x.code === code)!
    const e = latestEstimate(s, p.id)!
    const csv = boeCsv(s, e)
    expect(csv.startsWith('﻿Basis of Estimate')).toBe(true)
    expect(csv).toContain(p.code)
    const pdf = boePdf(s, e)
    const head = new Uint8Array(await pdf.arrayBuffer()).slice(0, 5)
    expect(String.fromCharCode(...head)).toBe('%PDF-')
    expect(pdf.size).toBeGreaterThan(4000)
  }
})
