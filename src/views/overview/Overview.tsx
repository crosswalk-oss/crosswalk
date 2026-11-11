// Overview video: a narrated walk-through of the estimate → budget → changes → actuals → forecast trail.
// The video is a separate file served next to the app (public/crosswalk-overview.mp4). It is requested from the
// app's own origin, and only when the viewer presses play, so the single-file build still works without it.
import { useRef, useState } from 'react'
import { cx } from '@/core/util'
import { Button, Callout, PageHeader, Panel } from '@/ui/kit'
import { Icon } from '@/ui/icons'

const VIDEO_SRC = 'crosswalk-overview.mp4'

const CHAPTERS: { at: number; title: string }[] = [
  { at: 0, title: 'Two sides of the street' },
  { at: 10, title: 'The question' },
  { at: 28, title: 'One trail' },
  { at: 44, title: 'The lifecycle' },
  { at: 63, title: 'A Class 5 in minutes, with its range' },
  { at: 84, title: 'Estimate to budget, actuals to forecast' },
  { at: 130, title: 'Putting capital where it does the most good' },
  { at: 168, title: 'Fewer systems, not another silo' },
  { at: 203, title: 'What it means' },
]

const NEXT: { href: string; label: string; note: string }[] = [
  { href: '#p-1001', label: 'Line AV-11 Replacement', note: 'One project, with its estimate, budget, changes, actuals and forecast' },
  { href: '#estimating', label: 'Estimating', note: 'Run a Class 5 estimate and see its range' },
  { href: '#actuals', label: 'SAP actuals', note: 'Load the fictional sample file and reconcile it' },
  { href: '#portfolio', label: 'Portfolio', note: 'Every project and program on one page' },
]

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function Overview() {
  const ref = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [startAt, setStartAt] = useState(0)

  const playFrom = (at: number) => {
    setFailed(false)
    const v = ref.current
    if (!started || !v) { setStartAt(at); setStarted(true); return }
    v.currentTime = at
    void v.play().catch(() => { /* the viewer can press play */ })
  }

  return (
    <div>
      <PageHeader eyebrow="Start here" title="Crosswalk in under four minutes" subtitle="One trail from estimate to forecast. A narrated overview with captions, using demo data from the fictional Arroyo Valley Gas." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel pad={false} className="overflow-hidden">
          <div className="relative aspect-video w-full bg-steel">
            {started && !failed ? (
              <video
                ref={ref}
                className="absolute inset-0 h-full w-full"
                src={VIDEO_SRC}
                controls
                autoPlay
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => { if (startAt > 0) e.currentTarget.currentTime = startAt }}
                onError={() => setFailed(true)}
              />
            ) : (
              <button type="button" onClick={() => playFrom(0)} className="group absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-4 text-steelink" aria-label="Play the overview video">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-marker text-markerink transition-transform group-hover:scale-105"><Icon name="play" className="ml-1 h-7 w-7" /></span>
                <span className="px-4 text-center font-display text-[22px] font-bold leading-tight text-white sm:text-[28px]">Crosswalk: one trail from estimate to forecast</span>
                <span className="text-[13px] text-steelink/70">3 min 39 s · narrated · captions on screen</span>
              </button>
            )}
          </div>
          {failed && (
            <div className="p-4">
              <Callout tone="info" title="The video is not available in this copy">
                The overview video is a separate file that sits next to the app on the hosted demo. This copy of Crosswalk does not have it, and everything else works as usual.
                <div className="mt-2"><Button size="sm" onClick={() => playFrom(0)}>Try again</Button></div>
              </Callout>
            </div>
          )}
        </Panel>
        <Panel title="Chapters" pad={false}>
          <ol>
            {CHAPTERS.map((c, i) => (
              <li key={c.at} className={cx(i > 0 && 'border-t border-line')}>
                <button type="button" onClick={() => playFrom(c.at)} className="flex w-full items-baseline gap-3 px-4 py-2 text-left text-[13px] hover:bg-sunken">
                  <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-muted">{clock(c.at)}</span>
                  <span className="font-medium">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      <Panel title="Then try it yourself" className="mt-4" pad={false}>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {NEXT.map((n) => (
            <a key={n.href} href={n.href} className="flex flex-col gap-1 border-line px-4 py-3 hover:bg-sunken sm:border-r">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-link">{n.label}<Icon name="arrow" className="h-3.5 w-3.5" /></span>
              <span className="text-xs text-muted">{n.note}</span>
            </a>
          ))}
        </div>
      </Panel>
    </div>
  )
}
