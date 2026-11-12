// Private materials: a video and slide decks that are kept in the database, not in the app's code, and are
// returned by the API only to requests that carry the edit passcode. Without the passcode this page shows
// nothing and asks for none of it. Files are fetched in chunks and shown from memory. Each can also be downloaded:
// the video as it is, a deck as its PowerPoint file when one was uploaded with it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { data, prefs, type MaterialInfo } from '@/core/data'
import { useSync } from '@/core/store'
import { PASSCODE_KEY } from '@/core/sync'
import { cx } from '@/core/util'
import { saveFile } from '@/core/download'
import { Button, Callout, Empty, PageHeader, Panel } from '@/ui/kit'
import { Icon } from '@/ui/icons'

interface Chapter { at: number; title: string }
interface Meta { chapters?: Chapter[]; duration?: number; note?: string; fileName?: string }
export interface Deck { key: string; title: string; slides: MaterialInfo[]; file?: MaterialInfo }

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg', [PPTX]: 'pptx' }
/** The name a downloaded material is saved under: the one given at upload, or its title. */
export function fileNameOf(m: MaterialInfo): string {
  const given = parseMeta(m).fileName
  if (given) return given
  const base = (m.title || m.name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'download'
  return `${base}.${EXT[m.contentType] ?? 'bin'}`
}

const parseMeta = (m: MaterialInfo): Meta => { try { return JSON.parse(m.meta) as Meta } catch { return {} } }
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`

/** Videos stand alone; images that share the part of their name before "/" form one deck, in order. A PowerPoint file with the same prefix is that deck's download. */
export function arrange(list: MaterialInfo[]): { videos: MaterialInfo[]; decks: Deck[] } {
  const videos = list.filter((m) => m.contentType.startsWith('video/'))
  const decks: Deck[] = []
  for (const m of list.filter((x) => x.contentType.startsWith('image/'))) {
    const key = m.name.includes('/') ? m.name.slice(0, m.name.indexOf('/')) : m.name
    const d = decks.find((x) => x.key === key)
    if (d) d.slides.push(m); else decks.push({ key, title: m.title || key, slides: [m] })
  }
  for (const d of decks) d.slides.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  for (const f of list.filter((x) => x.contentType === PPTX)) {
    const d = decks.find((x) => x.key === (f.name.includes('/') ? f.name.slice(0, f.name.indexOf('/')) : f.name))
    if (d) d.file = f
  }
  return { videos, decks }
}

// Files already fetched in this tab, by material id, so going back to a slide or replaying costs nothing.
const cache = new Map<number, string>()
const blobs = new Map<number, Blob>()
const pending = new Map<number, Promise<string | null>>()
function forget() {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear(); blobs.clear(); pending.clear()
}

function fetchFile(m: MaterialInfo, onProgress?: (fraction: number) => void): Promise<string | null> {
  const have = cache.get(m.id)
  if (have) return Promise.resolve(have)
  const running = pending.get(m.id)
  if (running) return running
  const p = (async () => {
    const passcode = prefs.getRaw(PASSCODE_KEY) ?? ''
    const parts: ArrayBuffer[] = []
    for (let i = 0; i < m.chunks; i++) {
      const part = await data.materialChunk(passcode, m.id, i)
      if (!part) return null
      parts.push(part)
      onProgress?.((i + 1) / m.chunks)
    }
    const blob = new Blob(parts, { type: m.contentType })
    const url = URL.createObjectURL(blob)
    cache.set(m.id, url); blobs.set(m.id, blob)
    return url
  })().finally(() => pending.delete(m.id))
  pending.set(m.id, p)
  return p
}

export default function Materials({ onUnlock }: { onUnlock: () => void }) {
  const sync = useSync()
  const unlocked = sync.mode === 'shared' && sync.canEdit
  const [list, setList] = useState<MaterialInfo[] | null | 'failed'>(null)

  const load = useCallback(async () => {
    setList(null)
    setList((await data.listMaterials(prefs.getRaw(PASSCODE_KEY) ?? '')) ?? 'failed')
  }, [])
  useEffect(() => {
    if (unlocked) void load()
    else { forget(); setList(null) }
  }, [unlocked, load])

  const { videos, decks } = useMemo(() => arrange(Array.isArray(list) ? list : []), [list])

  if (!unlocked) return <Locked shared={sync.mode === 'shared'} editable={sync.editable} onUnlock={onUnlock} />

  return (
    <div>
      <PageHeader eyebrow="Passcode only" title="Private materials" subtitle="Shown only with the passcode. These files are kept in the database, not in the app's code, and are not part of the offline copy." />
      {list === null && <div className="py-10 text-center text-[13px] text-muted">Loading…</div>}
      {list === 'failed' && <Callout tone="warn" title="Couldn't load the materials">The server did not return them. <button type="button" className="font-semibold text-link" onClick={() => void load()}>Try again</button></Callout>}
      {Array.isArray(list) && !list.length && <Empty title="Nothing here yet">No materials have been uploaded.</Empty>}
      <div className="flex flex-col gap-4">
        {videos.map((v) => <VideoPanel key={v.id} m={v} />)}
        {decks.map((d) => <DeckPanel key={d.key + ':' + d.slides.map((s) => s.id).join(',') + ':' + (d.file?.id ?? '')} deck={d} />)}
      </div>
    </div>
  )
}

/** What the page shows without the passcode: a prompt on the hosted demo, a plain note anywhere else. */
export function Locked({ shared, editable, onUnlock }: { shared: boolean; editable: boolean; onUnlock: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Empty title="Private materials" action={shared && editable ? <Button variant="primary" onClick={onUnlock}>Enter passcode</Button> : undefined}>
        {shared ? 'This page is shown only after the passcode is entered. Nothing on it is loaded until then.' : 'This page needs the hosted demo and its passcode. It is not part of this copy.'}
      </Empty>
    </div>
  )
}

/** Fetches the file (or reuses what is already in memory) and hands it to the browser as a download. */
function DownloadButton({ m, label }: { m: MaterialInfo; label: string }) {
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const go = async () => {
    if (progress !== null) return
    setFailed(false); setProgress(blobs.has(m.id) ? 1 : 0)
    const url = await fetchFile(m, setProgress)
    setProgress(null)
    const blob = blobs.get(m.id)
    if (!url || !blob) { setFailed(true); return }
    await saveFile(fileNameOf(m), blob, m.contentType)
  }
  return (
    <Button size="sm" variant="secondary" onClick={() => void go()} disabled={progress !== null} title={`${fileNameOf(m)} · ${mb(m.bytes)}`}>
      {progress !== null ? `Preparing… ${Math.round(progress * 100)}%` : failed ? `${label} (try again)` : label}
    </Button>
  )
}

function VideoPanel({ m }: { m: MaterialInfo }) {
  const meta = useMemo(() => parseMeta(m), [m])
  const ref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(cache.get(m.id) ?? null)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [startAt, setStartAt] = useState(0)

  const playFrom = async (at: number) => {
    const v = ref.current
    if (src && v) { v.currentTime = at; void v.play().catch(() => { /* the viewer can press play */ }); return }
    if (progress !== null) return
    setFailed(false); setStartAt(at); setProgress(0)
    const url = await fetchFile(m, setProgress)
    setProgress(null)
    if (url) setSrc(url); else setFailed(true)
  }

  return (
    <div className={cx('grid gap-4', !!meta.chapters?.length && 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
      <Panel pad={false} className="overflow-hidden">
        <div className="relative aspect-video w-full bg-steel">
          {src ? (
            <video ref={ref} className="absolute inset-0 h-full w-full" src={src} controls autoPlay playsInline
              onLoadedMetadata={(e) => { if (startAt > 0) e.currentTarget.currentTime = startAt }} onError={() => { setSrc(null); setFailed(true) }} />
          ) : (
            <button type="button" onClick={() => void playFrom(0)} disabled={progress !== null} className="group absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-4 text-steelink" aria-label={`Play ${m.title}`}>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-marker text-markerink transition-transform group-hover:scale-105"><Icon name="play" className="ml-1 h-7 w-7" /></span>
              <span className="px-4 text-center font-display text-[22px] font-bold leading-tight text-white sm:text-[28px]">{m.title}</span>
              <span className="text-[13px] text-steelink/70">
                {progress !== null ? `Loading… ${Math.round(progress * 100)}%` : [meta.duration ? `${Math.floor(meta.duration / 60)} min ${Math.round(meta.duration % 60)} s` : null, meta.note, mb(m.bytes)].filter(Boolean).join(' · ')}
              </span>
              {progress !== null && <span className="h-1 w-56 overflow-hidden rounded-full bg-white/15"><span className="block h-full bg-marker" style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-[12.5px] text-muted">{m.title}</span>
          <DownloadButton m={m} label="Download video" />
        </div>
        {failed && <div className="p-4"><Callout tone="warn" title="The video didn't load">Check the connection and try again. <button type="button" className="font-semibold text-link" onClick={() => void playFrom(startAt)}>Try again</button></Callout></div>}
      </Panel>
      {!!meta.chapters?.length && (
        <Panel title="Chapters" pad={false}>
          <ol>
            {meta.chapters.map((c, i) => (
              <li key={c.at} className={cx(i > 0 && 'border-t border-line')}>
                <button type="button" onClick={() => void playFrom(c.at)} className="flex w-full items-baseline gap-3 px-4 py-2 text-left text-[13px] hover:bg-sunken">
                  <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-muted">{clock(c.at)}</span>
                  <span className="font-medium">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  )
}

function DeckPanel({ deck }: { deck: Deck }) {
  const [i, setI] = useState(0)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const n = deck.slides.length
  const slide = deck.slides[Math.min(i, n - 1)]
  const go = (to: number) => setI(Math.max(0, Math.min(n - 1, to)))

  useEffect(() => {
    let live = true
    setFailed(false); setSrc(cache.get(slide.id) ?? null)
    void fetchFile(slide).then((url) => {
      if (!live) return
      if (url) setSrc(url); else setFailed(true)
      const next = deck.slides[i + 1]
      if (url && next) void fetchFile(next) // have the next slide ready
    })
    return () => { live = false }
  }, [slide, deck, i])

  return (
    <Panel title={deck.title} subtitle={`${n} slide${n === 1 ? '' : 's'}`} pad={false} className="overflow-hidden"
      actions={<div className="flex flex-wrap items-center justify-end gap-3">
        {src && <a href={src} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-link">Open slide full size</a>}
        {deck.file && <DownloadButton m={deck.file} label="Download PowerPoint" />}
      </div>}>
      <div className="relative aspect-video w-full bg-steel" tabIndex={0} role="group" aria-label={`${deck.title}, slide ${i + 1} of ${n}`}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1) }}>
        {src && <img src={src} alt={`${deck.title}, slide ${i + 1}`} className="absolute inset-0 h-full w-full object-contain" />}
        {!src && !failed && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-steelink/70">Loading slide {i + 1}…</div>}
        {failed && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-steelink">This slide didn't load. <button type="button" className="ml-1 font-semibold underline" onClick={() => go(i)}>Try again</button></div>}
        {i > 0 && <button type="button" onClick={() => go(i - 1)} aria-label="Previous slide" className="absolute inset-y-0 left-0 w-1/5" />}
        {i < n - 1 && <button type="button" onClick={() => go(i + 1)} aria-label="Next slide" className="absolute inset-y-0 right-0 w-1/5" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button size="sm" disabled={i === 0} onClick={() => go(i - 1)}>Back</Button>
        <Button size="sm" variant="primary" disabled={i >= n - 1} onClick={() => go(i + 1)}>Next</Button>
        <span className="mx-1 text-[12.5px] tabular-nums text-muted">{i + 1} of {n}</span>
        <span className="flex flex-1 flex-wrap justify-end gap-1">
          {deck.slides.map((s, k) => (
            <button key={s.id} type="button" onClick={() => go(k)} aria-label={`Slide ${k + 1}`} aria-current={k === i}
              className={cx('h-7 min-w-7 rounded px-1.5 text-[12px] font-semibold tabular-nums', k === i ? 'bg-ink text-white' : 'text-muted hover:bg-sunken')}>{k + 1}</button>
          ))}
        </span>
      </div>
    </Panel>
  )
}
