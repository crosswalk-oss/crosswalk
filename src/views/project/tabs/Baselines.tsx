// Baselines & snapshots (BL-01…BL-10): timeline of every frozen position, compare any two, take
// regulatory/forecast snapshots, request a re-baseline through change control, export signed records.
import { useEffect, useMemo, useState } from 'react'
import { mutate, useStore, personName, categoryName } from '@/core/store'
import type { AppState, Change, RootCause, Snapshot, SnapshotType } from '@/core/types'
import { ROOT_CAUSES } from '@/core/types'
import { compareSnapshots, latestOf, position, snapshotsFor, takeSnapshot } from '@/core/engine/position'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { daysBetween, fmtDate, fmtDateTime, money, moneyDelta, num, uid, cx } from '@/core/util'
import { saveFile, htmlDoc } from '@/core/download'
import { go, projectHref } from '@/core/router'
import { Badge, Button, Callout, Drawer, Empty, Field, Input, KV, Modal, MoneyInput, Panel, SegButtons, Select, Stat, Table, TextArea, Mono, Section, type Column } from '@/ui/kit'
import { Waterfall } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { changesBetween, doaLabel, esc, fingerprint, nextChangeCode, setFocusChange, SNAP_META, snapshotAuthority, stageLabel, takeFocusSnapshot } from './controls/trace'

export default function Baselines({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const snaps = useMemo(() => snapshotsFor(s, projectId), [s, projectId])
  const pos = useMemo(() => position(s, projectId), [s, projectId])
  const original = latestOf(s, projectId, 'original')
  const current = latestOf(s, projectId, 'current')
  const defA = original ?? snaps[0]
  const defB = current ?? snaps[snaps.length - 1]
  const [aId, setA] = useState<string | undefined>(defA?.id)
  const [bId, setB] = useState<string | undefined>(defB?.id)
  const [slot, setSlot] = useState<'A' | 'B'>('B')
  const [showClose, setShowClose] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [take, setTake] = useState(false)
  const [rebase, setRebase] = useState(false)
  useEffect(() => { const f = takeFocusSnapshot(); if (f && snaps.some((x) => x.id === f)) setOpen(f) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!snaps.some((x) => x.id === aId)) setA(defA?.id); if (!snaps.some((x) => x.id === bId)) setB(defB?.id) }, [snaps.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const A = snaps.find((x) => x.id === aId)
  const B = snaps.find((x) => x.id === bId)
  const approved = s.changes.filter((c) => c.projectId === projectId && c.status === 'approved')
  const pendingRebase = s.changes.find((c) => c.projectId === projectId && c.type === 'scope' && c.title.startsWith('Re-baseline') && (c.status === 'in-review' || c.status === 'draft'))

  if (!snaps.length) {
    return (
      <div className="flex flex-col gap-4">
        <Empty title="No baselines yet" action={<Button onClick={() => setTake(true)} icon={<Icon name="plus" className="h-4 w-4" />}>Take snapshot</Button>}>
          {p.code} is in {stageLabel(s, p, p.stageIndex)}. The first snapshot is frozen automatically at Gate 1; the Original baseline is frozen when the control budget is authorized.
        </Empty>
        <TakeSnapshotModal open={take} onClose={() => setTake(false)} projectId={projectId} />
      </div>
    )
  }

  const pick = (id: string) => { if (slot === 'A') { setA(id); setSlot('B') } else setB(id) }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Original baseline" value={money(original?.budget.total)} sub={original ? fmtDate(original.date) : 'Not yet authorized'} />
        <Stat label="Current baseline" value={money(current?.budget.total)} sub={current ? `${fmtDate(current.date)} · ${moneyDelta((current?.budget.total ?? 0) - (original?.budget.total ?? 0))} vs Original` : '—'} />
        <Stat label="Forecast (EAC)" value={money(pos.eac)} tone={current && pos.eac > current.budget.total ? 'bad' : undefined} sub={current ? `${moneyDelta(pos.eac - current.budget.total)} vs Current` : undefined} />
        <Stat label="Approved changes" value={approved.length} sub={`${moneyDelta(approved.reduce((a, c) => a + c.costImpact, 0))} · each one a new Current`} />
        <Stat label="Snapshots on file" value={snaps.length} sub={`${snaps.filter((x) => x.type === 'period-close').length} period closes · ${snaps.filter((x) => x.type === 'regulatory').length} regulatory`} />
      </div>

      {pendingRebase && (
        <Callout tone="marker" title={`Re-baseline request ${pendingRebase.code} is in review`}>
          {pendingRebase.description} <a className="font-semibold text-link hover:underline" href={projectHref(projectId, 'changes')} onClick={() => setFocusChange(pendingRebase.id)}>Open change</a>
        </Callout>
      )}

      <Panel title="Baseline timeline" subtitle="Every frozen position by date. Click a marker to load it into the comparison."
        actions={<>
          <span className="text-xs text-muted">Clicking sets</span>
          <SegButtons options={[{ id: 'A', label: 'A (from)' }, { id: 'B', label: 'B (to)' }]} value={slot} onChange={setSlot} />
          <Button size="sm" variant="ghost" onClick={() => setShowClose(!showClose)}>{showClose ? 'Hide' : 'Show'} period closes</Button>
          <Button size="sm" onClick={() => setTake(true)} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Take snapshot</Button>
          <Button size="sm" onClick={() => setRebase(true)} disabled={!current || !!pendingRebase}>Request re-baseline</Button>
        </>}>
        <Timeline s={s} snaps={snaps} changes={approved} aId={aId} bId={bId} onPick={pick} showClose={showClose} asOf={s.settings.asOf} />
      </Panel>

      {A && B && <Compare s={s} a={A} b={B} projectId={projectId} onSwap={() => { setA(B.id); setB(A.id) }} onPickA={setA} onPickB={setB} snaps={snaps} />}

      <Panel title="Snapshot register" subtitle="Immutable records. Open one to see its approving decision and export a signed copy." pad={false}>
        <Table rows={[...snaps].reverse()} rowKey={(x) => x.id} onRowClick={(x) => setOpen(x.id)} maxHeight={460} dense columns={snapColumns(s)} />
      </Panel>

      <SnapshotDrawer s={s} id={open} onClose={() => setOpen(null)} onCompare={(id) => { setB(id); setOpen(null); toast('Loaded into comparison as B', 'info') }} />
      <TakeSnapshotModal open={take} onClose={() => setTake(false)} projectId={projectId} />
      {current && <RebaselineModal open={rebase} onClose={() => setRebase(false)} projectId={projectId} current={current} />}
    </div>
  )
}

function TypeBadge({ type }: { type: SnapshotType }) {
  const m = SNAP_META[type]
  return <Badge tone={m.tone === 'ink' ? 'ink' : m.tone}><Glyph type={type} size={9} />{m.label}</Badge>
}

function Glyph({ type, size = 10 }: { type: SnapshotType; size?: number }) {
  const m = SNAP_META[type]
  const h = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <g transform={`translate(${h} ${h})`}><Shape shape={m.shape} r={h - 0.5} color={type === 'original' ? 'currentColor' : m.color} /></g>
    </svg>
  )
}

function Shape({ shape, r, color, stroke }: { shape: (typeof SNAP_META)[SnapshotType]['shape']; r: number; color: string; stroke?: string }) {
  const sw = stroke ? 2 : 0
  switch (shape) {
    case 'diamond': return <path d={`M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`} fill={color} stroke={stroke} strokeWidth={sw} />
    case 'square': return <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} fill={color} stroke={stroke} strokeWidth={sw} />
    case 'triangle': return <path d={`M0 ${-r}L${r} ${r * 0.8}L${-r} ${r * 0.8}Z`} fill={color} stroke={stroke} strokeWidth={sw} />
    case 'ring': return <circle r={r * 0.8} fill="rgb(var(--surface))" stroke={color} strokeWidth={2.2} />
    case 'tick': return <rect x={-1} y={-r} width={2} height={r * 2} fill={color} />
    default: return <circle r={r * 0.9} fill={color} stroke={stroke} strokeWidth={sw} />
  }
}

function Timeline({ s, snaps, changes, aId, bId, onPick, showClose, asOf }: { s: AppState; snaps: Snapshot[]; changes: Change[]; aId?: string; bId?: string; onPick: (id: string) => void; showClose: boolean; asOf: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const shown = snaps.filter((x) => showClose || x.type !== 'period-close' || x.id === aId || x.id === bId)
  const dates = [...snaps.map((x) => x.date), ...changes.map((c) => c.decidedAt!), asOf]
  const lo = dates.reduce((a, b) => (a < b ? a : b))
  const hi = asOf
  const span = Math.max(30, daysBetween(lo, hi))
  const W = 760, L = 24, R = 24, AX = 92
  const X = (d: string) => L + (daysBetween(lo, d) / span) * (W - L - R)
  // stack colliding markers upward
  const levels: number[] = []
  const placed = shown.map((x) => {
    const xx = X(x.date)
    let lv = 0
    while (levels[lv] !== undefined && xx - levels[lv] < 15) lv++
    levels[lv] = xx
    return { snap: x, x: xx, y: AX - 12 - lv * 17 }
  })
  const cLevels: number[] = []
  const cPlaced = changes.map((c) => {
    const xx = X(c.decidedAt!)
    let lv = 0
    while (cLevels[lv] !== undefined && xx - cLevels[lv] < 58) lv++
    cLevels[lv] = xx
    return { c, x: xx, lv }
  })
  const H = AX + 34 + Math.max(0, ...cPlaced.map((c) => c.lv)) * 16 + 10
  const y0 = Number(lo.slice(0, 4)), y1 = Number(hi.slice(0, 4))
  const yearTicks = Array.from({ length: y1 - y0 + 1 }, (_, i) => `${y0 + i}-01-01`).filter((d) => d > lo)
  const hv = hover ? snaps.find((x) => x.id === hover) : undefined
  return (
    <div>
      <div className="scroll-x">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Snapshot timeline">
          {yearTicks.map((d) => <g key={d}><line x1={X(d)} x2={X(d)} y1={14} y2={AX + 6} stroke="rgb(var(--line))" strokeDasharray="2 3" /><text x={X(d) + 3} y={12} fontSize={10.5} fill="rgb(var(--faint))">{d.slice(0, 4)}</text></g>)}
          <line x1={L} x2={W - R} y1={AX} y2={AX} stroke="rgb(var(--ink))" strokeWidth={2} />
          <g><line x1={X(asOf)} x2={X(asOf)} y1={AX - 6} y2={AX + 6} stroke="rgb(var(--marker))" strokeWidth={3} /><text x={X(asOf)} y={AX + 18} fontSize={10} textAnchor="end" fill="rgb(var(--muted))">Today</text></g>
          {placed.map(({ snap, x, y }) => {
            const m = SNAP_META[snap.type]
            const sel = snap.id === aId ? 'A' : snap.id === bId ? 'B' : null
            return (
              <g key={snap.id} className="cursor-pointer" onClick={() => onPick(snap.id)} onMouseEnter={() => setHover(snap.id)} onMouseLeave={() => setHover(null)}>
                <title>{`${m.label} · ${fmtDate(snap.date)} · ${snap.label} · ${money(snap.budget.total)}`}</title>
                <line x1={x} x2={x} y1={y} y2={AX} stroke={m.color} strokeWidth={1} opacity={0.6} />
                {sel && <circle cx={x} cy={y} r={10} fill="none" stroke="rgb(var(--ink))" strokeWidth={1.5} />}
                <g transform={`translate(${x} ${y})`}><Shape shape={m.shape} r={snap.type === 'period-close' ? 5 : 6.5} color={m.color} /></g>
                {sel && <text x={x} y={y - 13} fontSize={11} fontWeight={700} textAnchor="middle" fill="rgb(var(--ink))">{sel}</text>}
                <rect x={x - 8} y={y - 9} width={16} height={AX - y + 9} fill="transparent" />
              </g>
            )
          })}
          {cPlaced.map(({ c, x, lv }) => (
            <g key={c.id} className="cursor-pointer" onClick={() => { setFocusChange(c.id); go(projectHref(c.projectId, 'changes')) }}>
              <title>{`${c.code} ${c.title} · approved ${fmtDate(c.decidedAt)} · ${moneyDelta(c.costImpact)}${c.scheduleImpactDays ? ` · ${c.scheduleImpactDays} days` : ''}`}</title>
              <line x1={x} x2={x} y1={AX} y2={AX + 22 + lv * 16} stroke={c.costImpact >= 0 ? 'rgb(var(--bad))' : 'rgb(var(--good))'} strokeWidth={1.5} />
              <circle cx={x} cy={AX} r={3} fill={c.costImpact >= 0 ? 'rgb(var(--bad))' : 'rgb(var(--good))'} />
              <text x={x + 3} y={AX + 30 + lv * 16} fontSize={10.5} fontFamily="IBM Plex Mono, monospace" fill="rgb(var(--ink))">{c.code.replace(/^CR-\d+-/, 'CR-')} {moneyDelta(c.costImpact)}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {(Object.keys(SNAP_META) as SnapshotType[]).map((t) => <span key={t} className="inline-flex items-center gap-1.5"><Glyph type={t} size={10} />{SNAP_META[t].label} ({snaps.filter((x) => x.type === t).length})</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-bad" />Approved change</span>
        {hv && <span className="ml-auto text-ink"><b>{SNAP_META[hv.type].label}</b> {fmtDate(hv.date)} · {hv.label} · <span className="tabular-nums">{money(hv.budget.total)}</span></span>}
      </div>
    </div>
  )
}

function snapColumns(s: AppState): Column<Snapshot>[] {
  return [
    { key: 'date', header: 'Date', render: (x) => fmtDate(x.date), sort: (x) => x.date, width: 110 },
    { key: 'type', header: 'Type', render: (x) => <TypeBadge type={x.type} />, sort: (x) => x.type },
    { key: 'label', header: 'Label', render: (x) => <span className="block min-w-[180px]">{x.label}{x.proceeding && <span className="block text-xs text-muted">{x.proceeding}</span>}</span> },
    { key: 'stage', header: 'Stage', render: (x) => <span className="text-xs text-muted">{stageLabel(s, s.projects.find((p) => p.id === x.projectId)!, x.stageIndex)}</span> },
    { key: 'total', header: 'Budget', num: true, render: (x) => money(x.budget.total), sort: (x) => x.budget.total },
    { key: 'eac', header: 'EAC', num: true, render: (x) => money(x.budget.eac), sort: (x) => x.budget.eac },
    { key: 'cont', header: 'Contingency', num: true, render: (x) => money(x.budget.contingencyRemaining) },
    { key: 'act', header: 'Actual', num: true, render: (x) => money(x.budget.actualToDate) },
    { key: 'auth', header: 'Authority', render: (x) => { const a = snapshotAuthority(s, x); return <span className="block min-w-[200px] text-xs"><b className="text-ink">{a.kind}</b> <span className="text-muted">{a.text}</span></span> } },
  ]
}

function Compare({ s, a, b, projectId, onSwap, onPickA, onPickB, snaps }: { s: AppState; a: Snapshot; b: Snapshot; projectId: string; onSwap: () => void; onPickA: (id: string) => void; onPickB: (id: string) => void; snaps: Snapshot[] }) {
  const diff = useMemo(() => compareSnapshots(a, b), [a, b])
  const between = changesBetween(s, projectId, a, b)
  const opt = snaps.map((x) => ({ value: x.id, label: `${fmtDate(x.date)} · ${SNAP_META[x.type].label} · ${x.label}` }))
  const steps = diff.costBridge.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).map((c) => ({ label: categoryName(s, c.categoryId), delta: c.delta }))
  const contStep = (b.budget.total - a.budget.total) - steps.reduce((x, y) => x + y.delta, 0)
  const bridge = Math.abs(contStep) >= 1 ? [...steps, { label: 'Contingency', delta: contStep }] : steps
  return (
    <Panel title="Compare snapshots" subtitle="Bridge from A to B by cost category, with every approved change that explains the movement."
      actions={<Button size="sm" variant="ghost" onClick={onSwap}>Swap A ↔ B</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
        <Field label="A — from"><Select value={a.id} onChange={(e) => onPickA(e.target.value)} options={opt} /></Field>
        <span className="hidden pb-2 text-muted md:block">→</span>
        <Field label="B — to"><Select value={b.id} onChange={(e) => onPickB(e.target.value)} options={opt} /></Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DeltaFig label="Budget (incl. contingency)" a={a.budget.total} b={b.budget.total} />
        <DeltaFig label="Forecast (EAC)" a={a.budget.eac} b={b.budget.eac} />
        <DeltaFig label="Contingency remaining" a={a.budget.contingencyRemaining} b={b.budget.contingencyRemaining} goodUp />
        <DeltaFig label="Actual to date" a={a.budget.actualToDate} b={b.budget.actualToDate} neutral />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <Section title="Cost bridge by category">
          {bridge.length ? <Waterfall start={a.budget.total} end={b.budget.total} steps={bridge} startLabel="A budget" endLabel="B budget" /> : <p className="text-[13px] text-muted">No category movement between these snapshots.</p>}
          {bridge.length > 0 && <p className="text-xs text-faint">Red raises the budget, green lowers it. Contingency is the budget-total change not carried by a category.</p>}
        </Section>
        <Section title={`Approved changes between A and B (${between.length})`}>
          {between.length ? (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {between.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <a href={projectHref(c.projectId, 'changes')} onClick={() => setFocusChange(c.id)} className="font-mono text-[12px] font-semibold text-link hover:underline">{c.code}</a> <span>{c.title}</span>
                    <div className="text-xs text-muted">{c.rootCause} · {categoryName(s, c.categoryId)} · funded from {c.fundedFrom.replace('-', ' ')} · approved {fmtDate(c.decidedAt)}</div>
                  </div>
                  <span className={cx('tabular-nums font-semibold', c.costImpact > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(c.costImpact)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-muted">No approved changes were decided in this window.</p>}
        </Section>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={`Milestone movement (${diff.milestoneMoves.length})`}>
          {diff.milestoneMoves.length ? (
            <Table rowKey={(m) => m.name} rows={diff.milestoneMoves} dense columns={[
              { key: 'n', header: 'Milestone', render: (m) => m.name },
              { key: 'f', header: 'A forecast', render: (m) => fmtDate(m.from) },
              { key: 't', header: 'B forecast', render: (m) => fmtDate(m.to) },
              { key: 'd', header: 'Days', num: true, render: (m) => <span className={m.days > 0 ? 'font-semibold text-bad' : 'font-semibold text-good'}>{m.days > 0 ? '+' : ''}{m.days}</span> },
            ]} />
          ) : <p className="text-[13px] text-muted">No milestone moved.</p>}
        </Section>
        <Section title="Scope">
          <div className="flex flex-col gap-2 text-[13px]">
            {diff.scopeAdded.map((x) => <div key={x} className="flex gap-2"><Badge tone="bad">Added</Badge><span>{x}</span></div>)}
            {diff.scopeRemoved.map((x) => <div key={x} className="flex gap-2"><Badge tone="good">Removed</Badge><span>{x}</span></div>)}
            {diff.quantityChanges.map((q) => <div key={q.label} className="flex gap-2"><Badge tone="info">Quantity</Badge><span>{q.label}: {num(q.from)} → {num(q.to)} {q.unit}</span></div>)}
            {!diff.scopeAdded.length && !diff.scopeRemoved.length && !diff.quantityChanges.length && <p className="text-muted">Scope statement and quantities unchanged between A and B.</p>}
            <p className="mt-1 text-xs text-faint">Contingency {money(a.budget.contingencyRemaining)} → {money(b.budget.contingencyRemaining)} ({moneyDelta(diff.contingencyDelta)}). Risk exposure {money(a.riskExposure)} → {money(b.riskExposure)}.</p>
          </div>
        </Section>
      </div>
    </Panel>
  )
}

function DeltaFig({ label, a, b, goodUp, neutral }: { label: string; a: number; b: number; goodUp?: boolean; neutral?: boolean }) {
  const d = b - a
  const tone = neutral || !d ? 'text-muted' : (d > 0) === !!goodUp ? 'text-good' : 'text-bad'
  return (
    <div className="min-w-0 rounded-md border border-line px-3 py-2">
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums"><span className="text-[13px] text-muted">{money(a)} →</span><span className="font-display text-[19px] font-bold">{money(b)}</span></div>
      <div className={cx('text-xs font-semibold tabular-nums', tone)}>{d ? moneyDelta(d) : 'No change'}</div>
    </div>
  )
}

function SnapshotDrawer({ s, id, onClose, onCompare }: { s: AppState; id: string | null; onClose: () => void; onCompare: (id: string) => void }) {
  const snap = s.snapshots.find((x) => x.id === id)
  if (!snap) return null
  const p = s.projects.find((x) => x.id === snap.projectId)!
  const a = snapshotAuthority(s, snap)
  const cats = Object.entries(snap.budget.byCategory).sort((x, y) => y[1] - x[1])
  const exportHtml = async () => {
    const r = await saveFile(`${p.code}-${snap.type}-${snap.date}.html`, snapshotHtml(s, snap), 'text/html')
    if (r === 'saved') { mutate(() => {}, { entity: 'snapshot', entityId: snap.id, projectId: p.id, action: 'export', summary: `Exported signed record of ${snap.label}` }); toast('Signed record saved') } else if (r === 'unavailable') toast('Download is not available here', 'bad')
  }
  const exportJson = async () => {
    const payload = { schema: 'crosswalk.snapshot/1', exportedAt: s.settings.asOf, exportedBy: personName(s, s.currentUserId), project: { id: p.id, code: p.code, name: p.name }, authority: a, snapshot: snap }
    const r = await saveFile(`${p.code}-${snap.type}-${snap.date}.json`, JSON.stringify({ ...payload, fingerprint: fingerprint(JSON.stringify(snap)) }, null, 2), 'application/json')
    if (r === 'saved') toast('Snapshot JSON saved')
  }
  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2"><TypeBadge type={snap.type} />{snap.label}</span>} width={640}
      footer={<><Button onClick={() => onCompare(snap.id)}>Compare as B</Button><Button onClick={exportJson} icon={<Icon name="download" className="h-4 w-4" />}>JSON</Button><Button variant="primary" onClick={exportHtml} icon={<Icon name="download" className="h-4 w-4" />}>Signed record (HTML)</Button></>}>
      <div className="flex flex-col gap-5">
        <Callout tone={a.kind === 'Gate decision' || a.kind === 'Approved change' ? 'good' : 'info'} title={a.kind}>
          {a.text}
          {a.signers.length > 0 && <ul className="mt-1.5 text-xs">{a.signers.map((g, i) => <li key={i}>{g.name}{g.at && <> · {fmtDateTime(g.at)}</>}{g.sig && <> · <Mono>sig {g.sig}</Mono></>}</li>)}</ul>}
          {a.changeId && <a className="mt-1 block text-xs font-semibold text-link hover:underline" href={projectHref(p.id, 'changes')} onClick={() => setFocusChange(a.changeId!)}>Open the change record</a>}
        </Callout>
        <KV cols={3} items={[
          ['Date', fmtDate(snap.date)], ['Stage', stageLabel(s, p, snap.stageIndex)], ['Taken by', personName(s, snap.createdById)],
          ['Budget incl. contingency', money(snap.budget.total, 'full')], ['Forecast (EAC)', money(snap.budget.eac, 'full')], ['Contingency remaining', money(snap.budget.contingencyRemaining, 'full')],
          ['Actual to date', money(snap.budget.actualToDate, 'full')], ['Risk exposure', money(snap.riskExposure, 'full')], ['Proceeding', snap.proceeding ?? '—'],
        ]} />
        <Section title="Budget by category (excl. contingency)">
          <Table rowKey={(r) => r[0]} rows={cats} dense columns={[
            { key: 'c', header: 'Category', render: (r) => categoryName(s, r[0]) },
            { key: 'e', header: 'ERP element', render: (r) => <Mono>{s.categories.find((c) => c.id === r[0])?.erpCostElement}</Mono> },
            { key: 'v', header: 'Amount', num: true, render: (r) => money(r[1], 'full') },
          ]} />
        </Section>
        <Section title="Milestones">
          <Table rowKey={(m) => m.id} rows={snap.milestones} dense columns={[
            { key: 'n', header: 'Milestone', render: (m) => m.name },
            { key: 'b', header: 'Baseline', render: (m) => fmtDate(m.baseline) },
            { key: 'f', header: 'Forecast', render: (m) => fmtDate(m.forecast) },
            { key: 'a', header: 'Actual', render: (m) => fmtDate(m.actual) },
          ]} />
        </Section>
        <Section title="Scope">
          <p className="text-[13px]">{snap.scope.summary}</p>
          <ul className="list-disc pl-5 text-[13px] text-muted">{snap.scope.inScope.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="flex flex-wrap gap-2">{snap.scope.quantities.map((q) => <Badge key={q.label}>{q.label}: {num(q.qty)} {q.unit}</Badge>)}</div>
        </Section>
        <p className="text-xs text-faint">Snapshot id <Mono>{snap.id}</Mono> · content fingerprint <Mono>{fingerprint(JSON.stringify(snap))}</Mono>. Snapshots are immutable; a new baseline is created by an approved change.</p>
      </div>
    </Drawer>
  )
}

export function snapshotHtml(s: AppState, snap: Snapshot): string {
  const p = s.projects.find((x) => x.id === snap.projectId)!
  const a = snapshotAuthority(s, snap)
  const fp = fingerprint(JSON.stringify(snap))
  const rows = (xs: string[][]) => xs.map((r) => `<tr>${r.map((c, i) => `<td${i === r.length - 1 && /^[−$\d]/.test(c) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
  const body = `<h1>${esc(SNAP_META[snap.type].label)} snapshot — ${esc(p.code)}</h1>
<div class="meta">${esc(s.settings.orgName)} · ${esc(p.name)} · ${esc(snap.label)} · frozen ${fmtDate(snap.date)} · exported ${fmtDate(s.settings.asOf)} by ${esc(personName(s, s.currentUserId))}</div>
<h2>1. Authority</h2><p><b>${esc(a.kind)}.</b> ${esc(a.text)}</p>
<table><tr><th>Signer</th><th>Signed</th><th>E-signature</th></tr>${a.signers.map((g) => `<tr><td>${esc(g.name)}</td><td>${esc(g.at ? fmtDateTime(g.at) : fmtDate(snap.date))}</td><td>${esc(g.sig ?? 'Recorded decision')}</td></tr>`).join('')}</table>
<h2>2. Financial position</h2><table><tr><th>Measure</th><th>Amount</th></tr>${rows([['Budget incl. contingency', money(snap.budget.total, 'full')], ['Forecast at completion', money(snap.budget.eac, 'full')], ['Contingency remaining', money(snap.budget.contingencyRemaining, 'full')], ['Actual to date', money(snap.budget.actualToDate, 'full')], ['Risk exposure', money(snap.riskExposure, 'full')]])}</table>
<h2>3. Budget by cost category</h2><table><tr><th>Category</th><th>ERP element</th><th>Amount</th></tr>${rows(Object.entries(snap.budget.byCategory).map(([k, v]) => [categoryName(s, k), s.categories.find((c) => c.id === k)?.erpCostElement ?? '', money(v, 'full')]))}</table>
<h2>4. Schedule</h2><table><tr><th>Milestone</th><th>Baseline</th><th>Forecast</th><th>Actual</th></tr>${rows(snap.milestones.map((m) => [m.name, fmtDate(m.baseline), fmtDate(m.forecast), fmtDate(m.actual)]))}</table>
<h2>5. Scope</h2><p>${esc(snap.scope.summary)}</p><p><b>In scope:</b> ${esc(snap.scope.inScope.join('; '))}</p><p><b>Out of scope:</b> ${esc(snap.scope.outOfScope.join('; '))}</p><p><b>Quantities:</b> ${esc(snap.scope.quantities.map((q) => `${q.label} ${num(q.qty)} ${q.unit}`).join('; '))}</p><p><b>Assumptions:</b> ${esc(snap.scope.assumptions.join('; '))}</p>
<h2>6. Record integrity</h2><p>Snapshot id ${esc(snap.id)} · content fingerprint <b>${fp}</b> · stage ${esc(stageLabel(s, p, snap.stageIndex))}${snap.proceeding ? ` · proceeding ${esc(snap.proceeding)}` : ''}. This record is generated from the immutable snapshot in Crosswalk; any edit changes the fingerprint.</p>`
  return htmlDoc(`${p.code} ${SNAP_META[snap.type].label} snapshot ${snap.date}`, body)
}

function TakeSnapshotModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const proceedings = Array.from(new Set([p.fundingProceeding, ...s.funding.filter((f) => f.programId === p.programId).map((f) => f.proceeding)]))
  const [type, setType] = useState<'regulatory' | 'forecast'>('regulatory')
  const [proceeding, setProceeding] = useState(proceedings[0] ?? '')
  const [label, setLabel] = useState('')
  const submit = () => {
    if (type === 'regulatory' && !proceeding.trim()) { toast('Name the proceeding this snapshot supports.', 'bad'); return }
    const lab = label.trim() || (type === 'regulatory' ? `Regulatory snapshot — ${proceeding}` : `Forecast snapshot ${fmtDate(s.settings.asOf)}`)
    mutate((d) => { takeSnapshot(d, projectId, type, lab, { proceeding: type === 'regulatory' ? proceeding.trim() : undefined }) }, { entity: 'snapshot', entityId: projectId, projectId, action: 'create', summary: `Took ${type} snapshot: ${lab}` })
    toast('Snapshot frozen')
    setLabel(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Take snapshot" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Freeze snapshot</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">Freezes today's scope, milestones, budget by category, EAC, actuals and contingency for {p.code}. Original and Current baselines are created only by gate decisions and approved changes.</p>
        <Field label="Type"><SegButtons options={[{ id: 'regulatory', label: 'Regulatory' }, { id: 'forecast', label: 'Forecast' }]} value={type} onChange={setType} /></Field>
        {type === 'regulatory' && (
          <Field label="Proceeding" hint="The filing or data request this position supports.">
            <Input list="snap-proceedings" value={proceeding} onChange={(e) => setProceeding(e.target.value)} />
            <datalist id="snap-proceedings">{proceedings.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        )}
        <Field label="Label (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={type === 'regulatory' ? `Regulatory snapshot — ${proceeding}` : `Forecast snapshot ${fmtDate(s.settings.asOf)}`} /></Field>
      </div>
    </Modal>
  )
}

function RebaselineModal({ open, onClose, projectId, current }: { open: boolean; onClose: () => void; projectId: string; current: Snapshot }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const pos = position(s, projectId)
  const [newTotal, setNewTotal] = useState(Math.max(pos.eac, current.budget.total))
  const [days, setDays] = useState(0)
  const [rootCause, setRootCause] = useState<RootCause>('Scope growth')
  const [categoryId, setCategoryId] = useState('cat-contract')
  const [note, setNote] = useState('')
  const delta = newTotal - current.budget.total
  const doa = doaLabel(s, projectId, delta)
  const submit = () => {
    if (!note.trim()) { toast('Explain why the baseline no longer represents the work.', 'bad'); return }
    const code = nextChangeCode(s, p)
    mutate((d) => {
      const ch: Change = {
        id: uid('chg'), projectId, code, title: `Re-baseline to ${money(newTotal)}`, type: 'scope', rootCause, description: `Re-baseline request against ${current.label} (${fmtDate(current.date)}, ${money(current.budget.total)}). ${note.trim()}`,
        costImpact: delta, scheduleImpactDays: days, scopeImpact: 'Re-baseline of scope, schedule and budget', categoryId, fundedFrom: delta > 0 ? 'new-funding' : 'none', status: 'draft', requestedById: d.currentUserId, requestedAt: d.settings.asOf, baselineSnapshotId: current.id,
      }
      d.changes.push(ch)
      const inst = startWorkflow(d, 'change-request', { title: `${code} Re-baseline ${p.code}`, recordType: 'change', recordId: ch.id, projectId, data: { amount: delta, scheduleImpactDays: days, rootCause, justification: note.trim(), rebaseline: true } })
      const slot = inst?.active.find((a) => a.nodeId === 'prep' && a.assigneeIds.includes(d.currentUserId))
      if (inst && slot) actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', 'Re-baseline request prepared')
    }, { entity: 'change', entityId: code, projectId, action: 'create', summary: `Requested re-baseline ${code}: ${moneyDelta(delta)}, ${days} days` })
    toast('Re-baseline submitted for approval')
    setNote(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Request re-baseline" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit for approval</Button></>}>
      <div className="flex flex-col gap-4">
        <Callout tone="info">A re-baseline is a scope change routed through change control. When approved, the workflow freezes a new Current baseline; the Original baseline is never altered.</Callout>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Current baseline"><Input disabled value={`${current.label} · ${money(current.budget.total, 'full')}`} /></Field>
          <Field label="Proposed baseline total" hint={`Today's EAC is ${money(pos.eac, 'full')}`}><MoneyInput value={newTotal} onChange={setNewTotal} /></Field>
          <Field label="Schedule impact (days)"><Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} /></Field>
          <Field label="Root cause"><Select value={rootCause} onChange={(e) => setRootCause(e.target.value as RootCause)} options={[...ROOT_CAUSES]} /></Field>
          <Field label="Primary cost category"><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={s.categories.filter((c) => c.group !== 'contingency').map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} /></Field>
          <Field label="Routes to"><Input disabled value={`${doa.label} (${doa.people.join(', ') || 'no one assigned'}) · ${moneyDelta(delta)}`} /></Field>
        </div>
        <Field label="Why the current baseline no longer represents the work"><TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. City added 2,400 ft of paving restoration as a permit condition; the remaining scope cannot be delivered within the Current baseline." /></Field>
      </div>
    </Modal>
  )
}
