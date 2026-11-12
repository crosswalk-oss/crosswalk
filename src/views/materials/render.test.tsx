import { renderToString } from 'react-dom/server'
const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] } }
import Materials, { Locked, arrange, fileNameOf } from './Materials'
import type { MaterialInfo } from '@/core/data'

const m = (id: number, name: string, contentType: string, sort: number, title = ''): MaterialInfo => ({ id, name, title, contentType, bytes: 10, chunks: 1, sort, meta: '{}', uploadedAt: '' })

describe('Private materials page', () => {
  test('with no hosted demo behind it (the offline copy), the page shows a note and nothing else', () => {
    const html = renderToString(<Materials onUnlock={() => {}} />)
    expect(html).toContain('Private materials')
    expect(html).toContain('not part of this copy')
    expect(html).not.toMatch(/Enter passcode|<video|<img/)
  })
  test('on the hosted demo without the passcode, it shows only the prompt', () => {
    const html = renderToString(<Locked shared editable onUnlock={() => {}} />)
    expect(html).toContain('Enter passcode')
    expect(html).toContain('Nothing on it is loaded until then')
    expect(html).not.toMatch(/<video|<img/)
  })
  test('videos stand alone; images sharing a name prefix form one deck in slide order', () => {
    const { videos, decks } = arrange([m(1, 'overview-video', 'video/mp4', 0, 'Overview'), m(4, 'deck/02', 'image/png', 12, 'Deck'), m(3, 'deck/01', 'image/png', 11, 'Deck'), m(5, 'other/01', 'image/jpeg', 20, 'Other')])
    expect(videos.map((v) => v.id)).toEqual([1])
    expect(decks.map((d) => [d.key, d.title, d.slides.map((s) => s.id)])).toEqual([['deck', 'Deck', [3, 4]], ['other', 'Other', [5]]])
  })
  test('a PowerPoint file with a deck\'s prefix is that deck\'s download, not a slide', () => {
    const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    const { decks, videos } = arrange([m(3, 'deck/01', 'image/png', 11, 'Deck'), m(9, 'deck/powerpoint', PPTX, 199, 'Deck'), m(8, 'other/powerpoint', PPTX, 300, 'No slides')])
    expect(videos).toEqual([])
    expect(decks).toHaveLength(1)
    expect(decks[0].slides.map((s) => s.id)).toEqual([3])
    expect(decks[0].file?.id).toBe(9)
  })
  test('a download is named as given at upload, or from the title', () => {
    expect(fileNameOf({ ...m(1, 'v', 'video/mp4', 0, 'Crosswalk: one trail from estimate to forecast') })).toBe('Crosswalk_one_trail_from_estimate_to_forecast.mp4')
    expect(fileNameOf({ ...m(2, 'deck/powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 0, 'Deck'), meta: '{"fileName":"Business_case.pptx"}' })).toBe('Business_case.pptx')
  })
})
