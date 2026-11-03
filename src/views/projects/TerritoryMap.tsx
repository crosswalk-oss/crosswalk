// Schematic territory map: districts as soft regions, fictional transmission lines, project pins
// colored by overall health and sized by budget. Hover shows a card; click opens the project.
import { useMemo, useState } from 'react'
import { projectHref, go } from '@/core/router'
import { money, cx } from '@/core/util'
import { Badge, HealthDot, Mono, StageTrack } from '@/ui/kit'
import type { ProjectRow } from '../portfolio/lib'

const W = 1000, H = 600

const DISTRICTS: { name: string; d: string; label: [number, number] }[] = [
  { name: 'North', d: 'M240 40 C 340 18, 520 22, 640 34 C 720 42, 760 90, 742 150 C 728 205, 650 228, 540 222 C 430 218, 320 230, 262 200 C 214 174, 196 70, 240 40 Z', label: [490, 62] },
  { name: 'West', d: 'M70 300 C 120 262, 250 270, 330 292 C 372 304, 358 400, 350 470 C 342 540, 290 572, 190 566 C 110 560, 60 520, 52 450 C 46 390, 40 330, 70 300 Z', label: [150, 290] },
  { name: 'East', d: 'M350 262 C 430 240, 560 244, 628 262 C 660 272, 652 380, 640 450 C 630 510, 560 522, 470 516 C 400 512, 360 494, 356 440 C 352 380, 320 280, 350 262 Z', label: [490, 538] },
  { name: 'South', d: 'M648 222 C 720 200, 880 196, 940 226 C 970 244, 962 380, 950 460 C 940 520, 880 540, 790 536 C 712 532, 660 516, 652 450 C 646 380, 620 236, 648 222 Z', label: [800, 214] },
]

// Fictional transmission backbone (schematic): main trunks with line ids.
const LINES: { id: string; d: string; major?: boolean }[] = [
  { id: 'L-1185', d: 'M30 420 C 140 410, 220 395, 300 375 S 470 352, 560 320 S 760 268, 980 250', major: true },
  { id: 'L-2003', d: 'M560 320 C 650 300, 760 300, 905 262', major: true },
  { id: 'L-4000', d: 'M300 375 C 360 420, 430 440, 520 446 S 700 470, 820 452' },
  { id: 'L-85', d: 'M330 70 C 360 120, 420 150, 470 200 S 520 280, 560 320' },
  { id: 'L-5000', d: 'M820 452 C 860 480, 900 500, 975 512' },
  { id: 'L-1004', d: 'M60 520 C 110 500, 160 470, 220 420' },
  { id: 'L-2000', d: 'M560 60 C 580 120, 590 170, 575 220' },
]

const healthFill = { green: 'rgb(var(--good))', amber: 'rgb(var(--warn))', red: 'rgb(var(--bad))' } as const

export function TerritoryMap({ rows }: { rows: ProjectRow[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const maxB = Math.max(...rows.map((r) => r.budget), 1)
  const radius = (b: number) => 6 + Math.sqrt(Math.max(b, 0) / maxB) * 22
  const sel = rows.find((r) => r.p.id === (pinned ?? hover))
  // a few stations along the lines for context
  const stations = useMemo(() => rows.filter((r) => r.p.asset.type === 'compressor-station'), [rows])
  const ordered = rows.slice().sort((a, b) => b.budget - a.budget)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md border border-line bg-sunken/40" role="img" aria-label="Service territory map" onClick={() => setPinned(null)}>
        <defs>
          <pattern id="tm-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="rgb(var(--line))" strokeWidth="0.6" opacity="0.6" /></pattern>
        </defs>
        <rect width={W} height={H} fill="url(#tm-grid)" />
        {/* coastline */}
        <path d="M0 330 C 30 360, 20 420, 40 470 S 30 560, 60 600 L0 600 Z" fill="rgb(var(--info))" opacity="0.12" />
        <text x={14} y={590} fontSize={11} fill="rgb(var(--faint))" fontStyle="italic">Pacific</text>
        {DISTRICTS.map((d) => (
          <g key={d.name}>
            <path d={d.d} fill="rgb(var(--surface))" stroke="rgb(var(--line))" strokeWidth={1.5} opacity={0.9} />
            <text x={d.label[0]} y={d.label[1]} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing="0.14em" fill="rgb(var(--faint))">{d.name.toUpperCase()}</text>
          </g>
        ))}
        {LINES.map((l) => (
          <g key={l.id}>
            <path d={l.d} fill="none" stroke="rgb(var(--steel))" strokeOpacity={0.35} strokeWidth={l.major ? 3.5 : 2} strokeLinecap="round" />
            <path d={l.d} fill="none" stroke="rgb(var(--marker))" strokeOpacity={0.55} strokeWidth={l.major ? 1.2 : 0.8} strokeDasharray="6 6" />
          </g>
        ))}
        {[['L-1185', 36, 412], ['L-2003', 880, 256], ['L-4000', 430, 450], ['L-85', 336, 92], ['L-5000', 930, 500]].map(([id, x, y]) => (
          <text key={id as string} x={x as number} y={(y as number) - 6} fontSize={10} fontFamily="IBM Plex Mono, monospace" fill="rgb(var(--muted))">{id}</text>
        ))}
        {stations.map((r) => <rect key={'st' + r.p.id} x={r.p.location.x - 4} y={r.p.location.y - 4} width={8} height={8} fill="rgb(var(--steel))" opacity={0.25} transform={`rotate(45 ${r.p.location.x} ${r.p.location.y})`} />)}
        {ordered.map((r) => {
          const rr = radius(r.budget)
          const active = r.p.id === (pinned ?? hover)
          const closed = r.p.status === 'closed'
          return (
            <g key={r.p.id} transform={`translate(${r.p.location.x} ${r.p.location.y})`} className="cursor-pointer"
              onMouseEnter={() => setHover(r.p.id)} onMouseLeave={() => setHover(null)}
              onClick={(e) => { e.stopPropagation(); if (pinned === r.p.id) go(projectHref(r.p.id)); else setPinned(r.p.id) }}>
              <circle r={rr} fill={closed ? 'rgb(var(--faint))' : healthFill[r.overall]} fillOpacity={closed ? 0.25 : 0.32} stroke={closed ? 'rgb(var(--faint))' : healthFill[r.overall]} strokeWidth={active ? 3 : 1.5} strokeDasharray={r.p.status === 'on-hold' ? '3 2' : undefined} />
              <circle r={2.5} fill={closed ? 'rgb(var(--faint))' : healthFill[r.overall]} />
              {(rr > 14 || active) && <text y={-rr - 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fontFamily="IBM Plex Mono, monospace" fill="rgb(var(--ink))">{r.p.code.slice(4)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><HealthDot rag="green" /> On track</span>
        <span className="inline-flex items-center gap-1.5"><HealthDot rag="amber" /> Watch</span>
        <span className="inline-flex items-center gap-1.5"><HealthDot rag="red" /> Act</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-faint" /> On hold</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-faint/40" /> Closed</span>
        <span>Pin size = current budget · Tap a pin to pin its card, tap again to open</span>
      </div>
      {sel && (
        <div className={cx('fadein absolute right-2 top-2 w-[min(320px,calc(100%-16px))] rounded-md border border-line bg-surface p-3 shadow-xl')}>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Mono className="font-semibold text-ink">{sel.p.code}</Mono>
            <span>{sel.programCode}</span><span>·</span><span>{sel.p.location.city}</span>
            {sel.p.status !== 'active' && <Badge tone={sel.p.status === 'closed' ? 'neutral' : 'warn'}>{sel.p.status}</Badge>}
          </div>
          <div className="mt-0.5 font-display text-[15px] font-semibold leading-snug">{sel.p.name}</div>
          <div className="mt-2"><StageTrack stages={sel.stages} current={sel.p.stageIndex} status={sel.p.status} /><div className="mt-1 text-[11px] text-muted">{sel.stageName}</div></div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
            <div><div className="text-faint">Budget</div><div className="font-semibold tabular-nums">{money(sel.budget)}</div></div>
            <div><div className="text-faint">EAC</div><div className={cx('font-semibold tabular-nums', sel.variance > 0 && 'text-bad')}>{money(sel.eac)}</div></div>
            <div><div className="text-faint">Readiness</div><div className="font-semibold tabular-nums">{sel.readiness}%</div></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['scope', 'schedule', 'cost', 'risk', 'safety'] as const).map((k) => <HealthDot key={k} rag={sel.p.health[k]} label={k[0].toUpperCase() + k.slice(1)} />)}
          </div>
          <a href={projectHref(sel.p.id)} className="mt-2 inline-block text-[13px] font-semibold text-link hover:underline">Open project →</a>
        </div>
      )}
    </div>
  )
}
