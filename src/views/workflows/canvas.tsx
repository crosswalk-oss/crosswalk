// SVG process canvas: typed node shapes, routed edges with arrowheads, drag-to-move and drag-to-connect.
// All colors are theme tokens so the diagram follows light/dark mode.
import React, { useRef, useState } from 'react'
import type { AppState, WfEdge, WfNode, WfNodeType, WorkflowDef } from '@/core/types'
import { describeCondition } from '@/core/util'
import { describeAssignee, edgeOutcomeLabel, laneFor, nodeTypeLabel } from './lib'

export const tok = (n: string, a?: number) => (a == null ? `rgb(var(--${n}))` : `rgb(var(--${n}) / ${a})`)

export const TYPE_COLOR: Record<WfNodeType, string> = {
  start: 'good', end: 'ink', form: 'link', review: 'info', approval: 'marker', condition: 'warn',
  'parallel-split': 'ink', 'parallel-join': 'ink', notify: 'info', system: 'muted',
}

export function nodeSize(t: WfNodeType): { w: number; h: number } {
  switch (t) {
    case 'start': case 'end': return { w: 36, h: 36 }
    case 'condition': return { w: 70, h: 70 }
    case 'parallel-split': case 'parallel-join': return { w: 12, h: 72 }
    case 'notify': case 'system': return { w: 140, h: 48 }
    default: return { w: 150, h: 66 }
  }
}

export function wrap(text: string, max: number, lines = 2): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) out.push(cur)
  if (out.length > lines) { const keep = out.slice(0, lines); keep[lines - 1] = keep[lines - 1].slice(0, max - 1) + '…'; return keep }
  return out.map((l) => (l.length > max + 2 ? l.slice(0, max) + '…' : l))
}
const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

export interface EdgeGeom { d: string; mid: { x: number; y: number }; back: boolean }
export function edgeGeom(def: WorkflowDef, e: WfEdge): EdgeGeom | null {
  const S = def.nodes.find((n) => n.id === e.from), T = def.nodes.find((n) => n.id === e.to)
  if (!S || !T) return null
  return geomBetween(S, T, e.outcome === 'return' || e.outcome === 'reject')
}
export function geomBetween(S: Pick<WfNode, 'x' | 'y' | 'type'>, T: Pick<WfNode, 'x' | 'y' | 'type'>, isReturn: boolean): EdgeGeom {
  const s = nodeSize(S.type), t = nodeSize(T.type)
  const dx = T.x - S.x, dy = T.y - S.y
  let p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]
  const back = isReturn || dx < -10
  if (back) {
    const depth = 46 + Math.abs(dx) * 0.12 + Math.max(0, Math.abs(dy) * 0.2)
    const base = Math.max(S.y + s.h / 2, T.y + t.h / 2)
    p0 = [S.x - 8, S.y + s.h / 2]
    p3 = [T.x + 8, T.y + t.h / 2]
    p1 = [p0[0], base + depth]
    p2 = [p3[0], base + depth]
  } else if (dx > (s.w + t.w) / 2 * 0.7) {
    p0 = [S.x + s.w / 2, S.y]
    p3 = [T.x - t.w / 2, T.y]
    const c = Math.max(28, (p3[0] - p0[0]) * 0.45)
    p1 = [p0[0] + c, p0[1]]
    p2 = [p3[0] - c, p3[1]]
  } else {
    const down = dy >= 0
    p0 = [S.x, S.y + (down ? s.h / 2 : -s.h / 2)]
    p3 = [T.x, T.y + (down ? -t.h / 2 : t.h / 2)]
    const c = Math.max(24, Math.abs(p3[1] - p0[1]) * 0.45) * (down ? 1 : -1)
    p1 = [p0[0], p0[1] + c]
    p2 = [p3[0], p3[1] - c]
  }
  const mid = { x: 0.125 * p0[0] + 0.375 * p1[0] + 0.375 * p2[0] + 0.125 * p3[0], y: 0.125 * p0[1] + 0.375 * p1[1] + 0.375 * p2[1] + 0.125 * p3[1] }
  const f = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`
  return { d: `M${f(p0)} C${f(p1)} ${f(p2)} ${f(p3)}`, mid, back }
}

export function canvasExtent(def: WorkflowDef, pad = 140) {
  let w = 860, h = 400
  for (const n of def.nodes) { const z = nodeSize(n.type); w = Math.max(w, n.x + z.w / 2 + pad); h = Math.max(h, n.y + z.h / 2 + pad) }
  return { w, h }
}

const edgeColor = (e: WfEdge) => (e.outcome === 'return' ? 'warn' : e.outcome === 'reject' ? 'bad' : 'faint')

export function ArrowDefs({ prefix = 'wf' }: { prefix?: string }) {
  return (
    <defs>
      {['faint', 'warn', 'bad', 'link', 'ink'].map((c) => (
        <marker key={c} id={`${prefix}-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0 L10 5 L0 10 z" fill={tok(c)} />
        </marker>
      ))}
      <pattern id={`${prefix}-grid`} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill={tok('line')} /></pattern>
    </defs>
  )
}

export type Sel = { kind: 'node' | 'edge'; id: string } | null

export interface CanvasProps {
  s: AppState
  def: WorkflowDef
  selected?: Sel
  onSelect?: (sel: Sel) => void
  onMoveNode?: (id: string, x: number, y: number) => void
  onMoveEnd?: () => void
  onConnect?: (from: string, to: string) => void
  readOnly?: boolean
  highlight?: Set<string> // node ids on a traced path
  issues?: Set<string> // node ids with validation errors
  active?: Set<string> // node ids where an instance sits now
  done?: Set<string> // node ids already completed in an instance
  connectMode?: boolean
  zoom?: number
}

export function Canvas({ s, def, selected, onSelect, onMoveNode, onMoveEnd, onConnect, readOnly, highlight, issues, active, done, connectMode, zoom = 1 }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; ox: number; oy: number; moved: boolean; sx: number; sy: number } | null>(null)
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const { w, h } = canvasExtent(def)

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX; pt.y = clientY
    const m = svg.getScreenCTM()
    return m ? pt.matrixTransform(m.inverse()) : { x: clientX, y: clientY }
  }
  const nodeAt = (x: number, y: number) => def.nodes.find((n) => { const z = nodeSize(n.type); const pw = Math.max(z.w, 40) / 2 + 6, ph = Math.max(z.h, 40) / 2 + 6; return Math.abs(n.x - x) <= pw && Math.abs(n.y - y) <= ph })

  const onNodeDown = (e: React.PointerEvent, n: WfNode) => {
    e.stopPropagation()
    if (connectMode && !readOnly) {
      if (!pending) { setPending(n.id); onSelect?.({ kind: 'node', id: n.id }) } else if (pending !== n.id) { onConnect?.(pending, n.id); setPending(null) }
      return
    }
    onSelect?.({ kind: 'node', id: n.id })
    if (readOnly) return
    const p = toSvg(e.clientX, e.clientY)
    drag.current = { id: n.id, ox: p.x - n.x, oy: p.y - n.y, moved: false, sx: e.clientX, sy: e.clientY }
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onHandleDown = (e: React.PointerEvent, n: WfNode) => {
    e.stopPropagation()
    if (readOnly) return
    const p = toSvg(e.clientX, e.clientY)
    setLink({ from: n.id, x: p.x, y: p.y })
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const d = drag.current
      if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return
      d.moved = true
      const p = toSvg(e.clientX, e.clientY)
      const snap = (v: number) => Math.round(v / 10) * 10
      onMoveNode?.(d.id, Math.max(40, snap(p.x - d.ox)), Math.max(50, snap(p.y - d.oy)))
    } else if (link) {
      const p = toSvg(e.clientX, e.clientY)
      setLink({ ...link, x: p.x, y: p.y })
      setHoverNode(nodeAt(p.x, p.y)?.id ?? null)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.moved) onMoveEnd?.()
    drag.current = null
    if (link) {
      const p = toSvg(e.clientX, e.clientY)
      const t = nodeAt(p.x, p.y)
      if (t && t.id !== link.from) onConnect?.(link.from, t.id)
      setLink(null)
      setHoverNode(null)
    }
    try { svgRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
  }

  const dim = (id: string) => (highlight && !highlight.has(id) ? 0.28 : 1)
  const edgeOn = (e: WfEdge) => !highlight || (highlight.has(e.from) && highlight.has(e.to) && e.outcome !== 'return' && e.outcome !== 'reject')
  const linkFrom = link && def.nodes.find((n) => n.id === link.from)

  return (
    <svg ref={svgRef} width={w * zoom} height={h * zoom} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Process diagram: ${def.name}`}
      className={readOnly ? '' : connectMode ? 'cursor-crosshair' : ''} style={{ touchAction: 'none', userSelect: 'none', display: 'block' }}
      onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => { if (!readOnly) { onSelect?.(null); setPending(null) } }}>
      <ArrowDefs />
      <rect x={0} y={0} width={w} height={h} fill={`url(#wf-grid)`} />
      {/* edges */}
      {def.edges.map((e) => {
        const g = edgeGeom(def, e)
        if (!g) return null
        const sel = selected?.kind === 'edge' && selected.id === e.id
        const c = sel ? 'link' : highlight && edgeOn(e) ? 'ink' : edgeColor(e)
        const label = e.label || e.condition || e.outcome === 'return' || e.outcome === 'reject' ? edgeOutcomeLabel(e) : ''
        const on = edgeOn(e)
        return (
          <g key={e.id} opacity={on ? 1 : 0.22} onPointerDown={(ev) => { ev.stopPropagation(); onSelect?.({ kind: 'edge', id: e.id }) }} style={{ cursor: readOnly ? 'default' : 'pointer' }}>
            <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={g.d} fill="none" stroke={tok(c)} strokeWidth={sel ? 2.5 : highlight && on ? 2.2 : 1.6} strokeDasharray={g.back || e.outcome === 'return' || e.outcome === 'reject' ? '6 4' : undefined} markerEnd={`url(#wf-arrow-${c})`} />
            {label && (
              <g transform={`translate(${g.mid.x},${g.mid.y})`}>
                <rect x={-(Math.min(label.length, 26) * 3.1 + 7)} y={-9} width={Math.min(label.length, 26) * 6.2 + 14} height={18} rx={9} fill={tok('surface')} stroke={tok(sel ? 'link' : e.outcome === 'return' ? 'warn' : e.outcome === 'reject' ? 'bad' : 'line')} />
                <text textAnchor="middle" y={3.5} fontSize={10.5} fontWeight={600} fill={tok(e.outcome === 'return' ? 'warn' : e.outcome === 'reject' ? 'bad' : 'muted')}>{trunc(label, 26)}</text>
              </g>
            )}
          </g>
        )
      })}
      {/* in-progress connection */}
      {link && linkFrom && <path d={`M${linkFrom.x + nodeSize(linkFrom.type).w / 2} ${linkFrom.y} L${link.x} ${link.y}`} stroke={tok('link')} strokeWidth={2} strokeDasharray="4 3" markerEnd="url(#wf-arrow-link)" fill="none" />}
      {/* nodes */}
      {def.nodes.map((n) => (
        <g key={n.id} opacity={dim(n.id)} transform={`translate(${n.x},${n.y})`} onPointerDown={(e) => onNodeDown(e, n)} style={{ cursor: readOnly ? 'pointer' : connectMode ? 'crosshair' : 'grab' }}>
          <NodeShape s={s} def={def} n={n} selected={selected?.kind === 'node' && selected.id === n.id} issue={issues?.has(n.id)} pending={pending === n.id} target={hoverNode === n.id} active={active?.has(n.id)} done={done?.has(n.id)} />
          {!readOnly && selected?.kind === 'node' && selected.id === n.id && n.type !== 'end' && (
            <g transform={`translate(${nodeSize(n.type).w / 2 + 12},0)`} onPointerDown={(e) => onHandleDown(e, n)} style={{ cursor: 'crosshair' }}>
              <title>Drag to another step to connect</title>
              <circle r={8} fill={tok('link')} stroke={tok('surface')} strokeWidth={2} />
              <path d="M-3 0 H3 M0 -3 V3" stroke={tok('surface')} strokeWidth={1.6} />
            </g>
          )}
        </g>
      ))}
    </svg>
  )
}

export function NodeShape({ s, def, n, selected, issue, pending, target, active, done }: { s: AppState; def: WorkflowDef; n: WfNode; selected?: boolean; issue?: boolean; pending?: boolean; target?: boolean; active?: boolean; done?: boolean }) {
  const z = nodeSize(n.type)
  const col = TYPE_COLOR[n.type]
  const ring = selected || pending || target ? tok('link') : issue ? tok('bad') : active ? tok('marker') : tok('line')
  const rw = selected || pending || target || issue || active ? 2.2 : 1.2
  const label = (y: number, max: number, lines = 2) => wrap(n.label, max, lines).map((l, i) => <text key={i} x={0} y={y + i * 13} textAnchor="middle" fontSize={11} fontWeight={600} fill={tok('ink')}>{l}</text>)
  const status = active ? <circle cx={z.w / 2 - 2} cy={-z.h / 2 + 2} r={6} fill={tok('marker')} stroke={tok('surface')} strokeWidth={2} /> : done ? <g transform={`translate(${z.w / 2 - 2},${-z.h / 2 + 2})`}><circle r={7} fill={tok('good')} stroke={tok('surface')} strokeWidth={2} /><path d="M-3 0 L-1 2.5 L3 -2.5" stroke={tok('surface')} strokeWidth={1.6} fill="none" /></g> : null
  const issueDot = issue ? <g transform={`translate(${-z.w / 2 + 2},${-z.h / 2 + 2})`}><circle r={7} fill={tok('bad')} /><text y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={tok('surface')}>!</text></g> : null
  switch (n.type) {
    case 'start':
    case 'end':
      return (
        <g>
          <circle r={18} fill={n.type === 'start' ? tok('good', 0.14) : tok('surface')} stroke={selected ? ring : n.type === 'start' ? tok('good') : tok('ink')} strokeWidth={n.type === 'end' ? 3 : rw + 0.6} />
          {n.type === 'end' && <circle r={11} fill={tok('ink')} />}
          {n.type === 'start' && <path d="M-4 -6 L6 0 L-4 6 z" fill={tok('good')} />}
          {label(34, 16, 1)}
          {issueDot}
        </g>
      )
    case 'condition':
      return (
        <g>
          <polygon points={`0,${-z.h / 2} ${z.w / 2},0 0,${z.h / 2} ${-z.w / 2},0`} fill={tok('warn', 0.1)} stroke={selected || pending || target ? ring : issue ? tok('bad') : tok('warn')} strokeWidth={rw + 0.3} />
          <text y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill={tok('warn')}>?</text>
          {label(z.h / 2 + 14, 24)}
          {issueDot}
        </g>
      )
    case 'parallel-split':
    case 'parallel-join':
      return (
        <g>
          <rect x={-z.w / 2} y={-z.h / 2} width={z.w} height={z.h} rx={2} fill={tok('ink')} stroke={selected || pending || target ? ring : 'none'} strokeWidth={3} />
          {label(z.h / 2 + 14, 18)}
          {issueDot}
        </g>
      )
    case 'notify':
    case 'system': {
      const sub = n.type === 'system' ? 'SYSTEM' : `NOTIFY · ${describeAssignee(s, n.assignee, def.fields)}`
      return (
        <g>
          <rect x={-z.w / 2} y={-z.h / 2} width={z.w} height={z.h} rx={z.h / 2} fill={n.type === 'system' ? tok('sunken') : tok('info', 0.08)} stroke={ring} strokeWidth={rw} strokeDasharray={n.type === 'system' ? '4 3' : undefined} />
          <text x={0} y={-8} textAnchor="middle" fontSize={8.5} fontWeight={700} letterSpacing={0.6} fill={tok('faint')}>{trunc(sub, 26)}</text>
          {wrap(n.label, 22, 2).map((l, i, arr) => <text key={i} x={0} y={arr.length > 1 ? 6 + i * 12 : 10} textAnchor="middle" fontSize={arr.length > 1 ? 10.5 : 11} fontWeight={600} fill={tok('ink')}>{l}</text>)}
          {status}{issueDot}
        </g>
      )
    }
    default: {
      const lane = laneFor(s, def, n)
      const lines = wrap(n.label, 22)
      return (
        <g>
          <rect x={-z.w / 2} y={-z.h / 2} width={z.w} height={z.h} rx={5} fill={tok('surface')} stroke={ring} strokeWidth={rw} />
          <rect x={-z.w / 2} y={-z.h / 2} width={4} height={z.h} rx={2} fill={tok(col)} />
          <text x={-z.w / 2 + 11} y={-z.h / 2 + 13} fontSize={8.5} fontWeight={700} letterSpacing={0.6} fill={tok(n.type === 'approval' ? 'warn' : col)}>{nodeTypeLabel(n.type).toUpperCase()}{n.rule === 'all' ? ' · ALL' : ''}</text>
          {n.slaDays ? <text x={z.w / 2 - 8} y={-z.h / 2 + 13} textAnchor="end" fontSize={9} fontWeight={600} fill={tok('muted')}>{n.slaDays}d SLA</text> : null}
          {lines.map((l, i) => <text key={i} x={-z.w / 2 + 11} y={-z.h / 2 + 29 + i * 13} fontSize={11.5} fontWeight={600} fill={tok('ink')}>{l}</text>)}
          <text x={-z.w / 2 + 11} y={z.h / 2 - 7} fontSize={10} fill={tok(n.assignee ? 'muted' : 'bad')}>{trunc(n.assignee ? lane : 'No assignee', 25)}</text>
          {n.type === 'approval' && <path d={`M${z.w / 2 - 16} ${z.h / 2 - 16} l3 3 l6 -6`} stroke={tok('warn')} strokeWidth={1.6} fill="none" />}
          {status}{issueDot}
        </g>
      )
    }
  }
}

export const conditionText = (e: WfEdge) => (e.condition ? describeCondition(e.condition) : 'Default (no rule matched)')
