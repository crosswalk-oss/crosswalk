// Auto-generated standard operating procedure (WF-11): swimlane diagram, step table, RACI, DOA table, revision history.
// The same generator draws the diagram in-app (theme tokens) and in the downloadable SOP (fixed print colors).
import type { AppState, WfEdge, WfNode, WorkflowDef } from '@/core/types'
import { htmlDoc } from '@/core/download'
import { fmtDate, fmtDateTime, money } from '@/core/util'
import { describeAssignee, edgeOutcomeLabel, isHuman, laneFor, lanesOf, nodeTypeLabel, orderedNodes, outcomePaths, recordTypeLabel, stepDuty, versionsOf, doaMatrixFor, SYSTEM_ACTIONS } from './lib'

export type Palette = Record<'ink' | 'muted' | 'faint' | 'line' | 'surface' | 'sunken' | 'good' | 'warn' | 'bad' | 'info' | 'link' | 'marker', string>
export const TOKEN_PALETTE: Palette = Object.fromEntries(['ink', 'muted', 'faint', 'line', 'surface', 'sunken', 'good', 'warn', 'bad', 'info', 'link', 'marker'].map((k) => [k, `rgb(var(--${k}))`])) as Palette
export const PRINT_PALETTE: Palette = { ink: '#141b24', muted: '#4f5a69', faint: '#7e8896', line: '#d6dce3', surface: '#ffffff', sunken: '#eef1f4', good: '#00823b', warn: '#b95400', bad: '#c81e3c', info: '#2c6ab2', link: '#145caa', marker: '#a8327f' }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function wrapText(t: string, max: number, lines = 2): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of t.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) out.push(cur)
  if (out.length > lines) { const k = out.slice(0, lines); k[lines - 1] = k[lines - 1].slice(0, max - 1) + '…'; return k }
  return out
}

export interface SwimlaneLayout { lanes: string[]; cols: number; pos: Record<string, { col: number; lane: number; x: number; y: number }>; width: number; height: number }

const LANE_H = 92, HEAD_W = 132, COL_W = 158, TOP = 8

export function swimlaneLayout(s: AppState, def: WorkflowDef): SwimlaneLayout {
  const lanes = lanesOf(s, def)
  const sorted = def.nodes.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  // cluster x positions into columns
  const colOf: Record<string, number> = {}
  let col = -1, lastX = -Infinity
  for (const n of sorted) { if (n.x - lastX > 45) { col++; lastX = n.x } colOf[n.id] = col }
  // avoid two nodes in the same cell: push later ones right
  const taken = new Set<string>()
  const pos: SwimlaneLayout['pos'] = {}
  let shift = 0
  const colShift: Record<number, number> = {}
  for (const n of sorted) {
    const lane = Math.max(0, lanes.indexOf(laneFor(s, def, n)))
    let c = colOf[n.id] + (colShift[colOf[n.id]] ?? shift)
    while (taken.has(`${c}:${lane}`)) { c++; shift++; colShift[colOf[n.id]] = shift }
    taken.add(`${c}:${lane}`)
    pos[n.id] = { col: c, lane, x: HEAD_W + c * COL_W + COL_W / 2, y: TOP + lane * LANE_H + LANE_H / 2 }
  }
  const cols = Math.max(1, ...Object.values(pos).map((p) => p.col + 1))
  return { lanes, cols, pos, width: HEAD_W + cols * COL_W + 20, height: TOP + lanes.length * LANE_H + 40 }
}

const BOX = { w: 128, h: 50 }
function half(n: WfNode) {
  if (n.type === 'start' || n.type === 'end') return { w: 15, h: 15 }
  if (n.type === 'condition') return { w: 30, h: 30 }
  if (n.type === 'parallel-split' || n.type === 'parallel-join') return { w: 5, h: 30 }
  return { w: BOX.w / 2, h: BOX.h / 2 }
}

function edgePath(L: SwimlaneLayout, def: WorkflowDef, e: WfEdge): { d: string; mx: number; my: number; back: boolean } | null {
  const S = def.nodes.find((n) => n.id === e.from), T = def.nodes.find((n) => n.id === e.to)
  if (!S || !T) return null
  const a = L.pos[S.id], b = L.pos[T.id]
  const hs = half(S), ht = half(T)
  const back = e.outcome === 'return' || e.outcome === 'reject' || b.col < a.col
  if (back) {
    const yb = Math.max(a.y, b.y) + LANE_H / 2 - 6
    const x0 = a.x - 10, y0 = a.y + hs.h, x1 = b.x + 10, y1 = b.y + ht.h
    return { d: `M${x0} ${y0} C${x0} ${yb} ${x1} ${yb} ${x1} ${y1}`, mx: (x0 + x1) / 2, my: yb - 6, back: true }
  }
  if (b.col === a.col) {
    const down = b.y > a.y
    const x0 = a.x, y0 = a.y + (down ? hs.h : -hs.h), x1 = b.x, y1 = b.y + (down ? -ht.h : ht.h)
    return { d: `M${x0} ${y0} L${x1} ${y1}`, mx: x0, my: (y0 + y1) / 2, back: false }
  }
  const x0 = a.x + hs.w, y0 = a.y, x1 = b.x - ht.w, y1 = b.y
  const c = Math.max(30, (x1 - x0) * 0.5)
  // labels from decisions sit near the diamond so they never hide behind a later box
  const f = S.type === 'condition' ? 0.18 : 0.5
  const bez = (p0: number, p1: number, p2: number, p3: number) => (1 - f) ** 3 * p0 + 3 * (1 - f) ** 2 * f * p1 + 3 * (1 - f) * f * f * p2 + f ** 3 * p3
  return { d: `M${x0} ${y0} C${x0 + c} ${y0} ${x1 - c} ${y1} ${x1} ${y1}`, mx: bez(x0, x0 + c, x1 - c, x1), my: bez(y0, y0, y1, y1), back: false }
}

/** Swimlane diagram as an SVG string (lanes from laneOf, nodes ordered by x). */
export function swimlaneSvg(s: AppState, def: WorkflowDef, P: Palette, opts: { idPrefix?: string } = {}): string {
  const L = swimlaneLayout(s, def)
  const id = opts.idPrefix ?? 'sl'
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" font-family="Public Sans, system-ui, sans-serif" role="img" aria-label="Swimlane diagram: ${esc(def.name)}">`)
  parts.push(`<defs>${(['faint', 'warn', 'bad'] as const).map((c) => `<marker id="${id}-a-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 z" fill="${P[c]}"/></marker>`).join('')}</defs>`)
  L.lanes.forEach((lane, i) => {
    const y = TOP + i * LANE_H
    parts.push(`<rect x="0" y="${y}" width="${L.width - 10}" height="${LANE_H}" fill="${i % 2 ? P.surface : P.sunken}" stroke="${P.line}"/>`)
    parts.push(`<rect x="0" y="${y}" width="${HEAD_W - 8}" height="${LANE_H}" fill="${P.sunken}" stroke="${P.line}"/>`)
    wrapText(lane, 16, 3).forEach((l, j, arr) => parts.push(`<text x="10" y="${y + LANE_H / 2 - (arr.length - 1) * 7 + j * 14 + 4}" font-size="11.5" font-weight="700" fill="${P.ink}">${esc(l)}</text>`))
  })
  for (const e of def.edges) {
    const g = edgePath(L, def, e)
    if (!g) continue
    const c = e.outcome === 'return' ? 'warn' : e.outcome === 'reject' ? 'bad' : 'faint'
    parts.push(`<path d="${g.d}" fill="none" stroke="${P[c]}" stroke-width="1.5" ${g.back ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#${id}-a-${c})"/>`)
    const label = edgeOutcomeLabel(e)
    if (label && (e.condition || g.back || e.label)) {
      const t = label.length > 24 ? label.slice(0, 23) + '…' : label
      parts.push(`<rect x="${g.mx - t.length * 2.9 - 5}" y="${g.my - 8}" width="${t.length * 5.8 + 10}" height="15" rx="7" fill="${P.surface}" stroke="${P[c === 'faint' ? 'line' : c]}"/><text x="${g.mx}" y="${g.my + 3}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${P[c === 'faint' ? 'muted' : c]}">${esc(t)}</text>`)
    }
  }
  const order = orderedNodes(def)
  for (const n of def.nodes) {
    const p = L.pos[n.id]
    const num = order.filter((x) => isHuman(x.type) || x.type === 'system' || x.type === 'notify').indexOf(n) + 1
    if (n.type === 'start' || n.type === 'end') {
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="15" fill="${n.type === 'start' ? P.surface : P.ink}" stroke="${n.type === 'start' ? P.good : P.ink}" stroke-width="2.5"/>`)
      parts.push(`<text x="${p.x}" y="${p.y + 30}" text-anchor="middle" font-size="10" font-weight="600" fill="${P.muted}">${esc(n.label)}</text>`)
    } else if (n.type === 'condition') {
      parts.push(`<polygon points="${p.x},${p.y - 30} ${p.x + 30},${p.y} ${p.x},${p.y + 30} ${p.x - 30},${p.y}" fill="${P.surface}" stroke="${P.warn}" stroke-width="1.8"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="${P.warn}">?</text>`)
      wrapText(n.label, 22).forEach((l, j) => parts.push(`<text x="${p.x}" y="${p.y + 42 + j * 11}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${P.ink}">${esc(l)}</text>`))
    } else if (n.type === 'parallel-split' || n.type === 'parallel-join') {
      parts.push(`<rect x="${p.x - 5}" y="${p.y - 30}" width="10" height="60" rx="2" fill="${P.ink}"/>`)
    } else {
      const sys = n.type === 'system' || n.type === 'notify'
      const color = n.type === 'approval' ? P.marker : n.type === 'form' ? P.link : n.type === 'review' ? P.info : P.faint
      parts.push(`<rect x="${p.x - BOX.w / 2}" y="${p.y - BOX.h / 2}" width="${BOX.w}" height="${BOX.h}" rx="${sys ? 25 : 5}" fill="${P.surface}" stroke="${n.type === 'approval' ? P.warn : P.line}" stroke-width="${n.type === 'approval' ? 1.6 : 1.2}" ${sys ? 'stroke-dasharray="4 3"' : ''}/>`)
      if (!sys) parts.push(`<rect x="${p.x - BOX.w / 2}" y="${p.y - BOX.h / 2}" width="4" height="${BOX.h}" rx="2" fill="${color}"/>`)
      parts.push(`<text x="${p.x - BOX.w / 2 + (sys ? 14 : 10)}" y="${p.y - BOX.h / 2 + 12}" font-size="8" font-weight="700" letter-spacing="0.5" fill="${P.faint}">${num ? num + ' · ' : ''}${esc(nodeTypeLabel(n.type).toUpperCase())}${n.slaDays ? ' · ' + n.slaDays + 'D' : ''}</text>`)
      wrapText(n.label, 21).forEach((l, j) => parts.push(`<text x="${p.x - BOX.w / 2 + (sys ? 14 : 10)}" y="${p.y - BOX.h / 2 + 26 + j * 12}" font-size="10.5" font-weight="600" fill="${P.ink}">${esc(l)}</text>`))
    }
  }
  parts.push('</svg>')
  return parts.join('')
}

// ───────────────────────────── Tables
export interface StepRow { num: number; node: WfNode; who: string; sla: string; duty: string; outcomes: string }
export function stepRows(s: AppState, def: WorkflowDef): StepRow[] {
  let i = 0
  return orderedNodes(def).filter((n) => n.type !== 'parallel-join').map((n) => ({
    num: n.type === 'start' || n.type === 'end' ? 0 : ++i,
    node: n,
    who: isHuman(n.type) || n.type === 'notify' ? `${describeAssignee(s, n.assignee, def.fields)}${n.rule === 'all' ? ' (all must act)' : n.rule === 'any' ? ' (any one)' : ''}` : n.type === 'start' ? 'Requester' : 'Mainline (automatic)',
    sla: n.slaDays ? `${n.slaDays} business day${n.slaDays > 1 ? 's' : ''}` : '—',
    duty: stepDuty(def, n),
    outcomes: outcomePaths(def, n),
  }))
}

export type RaciCode = 'R' | 'A' | 'C' | 'I' | 'A/R'
export function raci(s: AppState, def: WorkflowDef): { cols: string[]; rows: { label: string; cells: Record<string, RaciCode | ''> }[] } {
  const lanes = lanesOf(s, def).filter((l) => l !== 'System')
  const owner = s.roles.find((r) => r.id === def.ownerRole)?.name ?? def.ownerRole
  const cols = [...lanes]
  if (!cols.includes(owner)) cols.push(owner)
  if (!cols.includes('Requester')) cols.push('Requester')
  const rows = orderedNodes(def).filter((n) => isHuman(n.type) || n.type === 'system' || n.type === 'notify').map((n) => {
    const cells: Record<string, RaciCode | ''> = Object.fromEntries(cols.map((c) => [c, ''])) as Record<string, RaciCode | ''>
    const lane = laneFor(s, def, n)
    if (n.type === 'approval') cells[lane] = 'A/R'
    else if (n.type === 'notify') cells[lane] = 'I'
    else if (lane !== 'System') cells[lane] = 'R'
    if (n.type !== 'approval' && !cells[owner]) cells[owner] = 'A'
    if (n.type === 'approval') {
      for (const e of def.edges.filter((x) => x.to === n.id)) {
        const p = def.nodes.find((x) => x.id === e.from)
        if (p && p.type === 'review') { const l = laneFor(s, def, p); if (!cells[l]) cells[l] = 'C' }
      }
      if (!cells.Requester) cells.Requester = 'I'
    }
    if (n.type === 'system' && !cells.Requester) cells.Requester = 'I'
    return { label: n.label, cells }
  })
  return { cols, rows }
}

export interface Revision { version: number; status: string; effective: string; summary: string; at?: string; by?: string }
export function revisions(s: AppState, def: WorkflowDef): Revision[] {
  const vs = versionsOf(s, def.key)
  const log = s.audit.filter((a) => a.entity === 'workflow-def' && a.entityId === def.key)
  return vs.map((v) => {
    const hit = log.filter((a) => a.summary.includes(`v${v.version}`) && a.action === 'publish').pop()
    return { version: v.version, status: v.status, effective: v.effective, summary: hit?.summary.replace(/^Published [^:]+: ?/, '') || (v.version === vs[vs.length - 1].version ? (v.version === 1 ? 'Initial release.' : 'Current release migrated into Crosswalk; earlier versions archived in the legacy procedure library.') : 'Revision.'), at: hit?.at, by: hit?.actorId }
  })
}

export function rolesInvolved(s: AppState, def: WorkflowDef): { lane: string; duties: string[] }[] {
  return lanesOf(s, def).map((lane) => ({ lane, duties: orderedNodes(def).filter((n) => laneFor(s, def, n) === lane && n.type !== 'start' && n.type !== 'end' && n.type !== 'parallel-split' && n.type !== 'parallel-join').map((n) => n.label) })).filter((x) => x.duties.length)
}

// ───────────────────────────── Downloadable SOP
export function sopBody(s: AppState, def: WorkflowDef, narrative?: string, idPrefix = 'sop'): string {
  const owner = s.roles.find((r) => r.id === def.ownerRole)?.name ?? def.ownerRole
  const steps = stepRows(s, def)
  const R = raci(s, def)
  const m = doaMatrixFor(s)
  const usesDoa = def.nodes.some((n) => n.assignee?.kind === 'doa')
  const revs = revisions(s, def)
  const name = (id?: string) => s.people.find((p) => p.id === id)?.name ?? (id === 'system' ? 'System' : '—')
  const conditionEdges = def.edges.filter((e) => e.condition)
  const sys = def.nodes.filter((n) => n.type === 'system')
  const body = `
  <div class="meta">${esc(s.settings.orgName)} · Standard operating procedure · Generated by Crosswalk ${esc(fmtDate(s.settings.asOf))}</div>
  <h1>${esc(def.name)}</h1>
  <div class="meta">Process key <code>${esc(def.key)}</code> · Version ${def.version} (${esc(def.status)}) · Effective ${esc(fmtDate(def.effective))} · Process owner: ${esc(owner)}</div>
  <h2>1. Purpose</h2><p>${esc(def.purpose || '—')}</p>
  ${narrative ? `<h3>Narrative</h3>${narrative.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}` : ''}
  <h2>2. Scope</h2>
  <p>${esc(def.description || '')}</p>
  <table><tbody>
    <tr><th>Applies to</th><td>Every ${esc(recordTypeLabel(def.recordType).toLowerCase())} record routed in Crosswalk under process key <code>${esc(def.key)}</code>.</td></tr>
    <tr><th>Trigger</th><td>The process starts when a ${esc(recordTypeLabel(def.recordType).toLowerCase())} is submitted for approval. In-flight requests finish on the version they started on.</td></tr>
    <tr><th>Records</th><td>Every action is time-stamped in the workflow history and the audit log; approvals are e-signed after password re-authentication.</td></tr>
  </tbody></table>
  <h2>3. Roles and responsibilities</h2>
  <table><thead><tr><th>Role / lane</th><th>Responsible for</th></tr></thead><tbody>
  ${rolesInvolved(s, def).map((r) => `<tr><td><b>${esc(r.lane)}</b></td><td>${esc(r.duties.join('; '))}</td></tr>`).join('')}
  </tbody></table>
  <h2>4. Process map</h2>
  <div style="overflow-x:auto">${swimlaneSvg(s, def, PRINT_PALETTE, { idPrefix })}</div>
  <p class="meta">Solid arrows: forward path. Dashed amber arrows: return for revision. Diamonds: automatic routing rules. Black bars: parallel split / join.</p>
  <h2>5. Procedure</h2>
  <table><thead><tr><th>#</th><th>Step</th><th>Who</th><th>SLA</th><th>What they do</th><th>Outcome paths</th></tr></thead><tbody>
  ${steps.map((r) => `<tr><td class="num">${r.num || ''}</td><td><b>${esc(r.node.label)}</b><br><span class="tag">${esc(nodeTypeLabel(r.node.type))}</span></td><td>${esc(r.who)}</td><td>${esc(r.sla)}</td><td>${esc(r.duty)}</td><td>${esc(r.outcomes)}</td></tr>`).join('')}
  </tbody></table>
  ${conditionEdges.length ? `<h3>Routing rules</h3><table><thead><tr><th>At</th><th>Rule</th><th>Goes to</th></tr></thead><tbody>${conditionEdges.map((e) => `<tr><td>${esc(def.nodes.find((n) => n.id === e.from)?.label ?? '')}</td><td>${esc(edgeOutcomeLabel(e))} (${esc(e.condition!.field)} ${esc(e.condition!.op)} ${esc(String(e.condition!.value ?? ''))})</td><td>${esc(def.nodes.find((n) => n.id === e.to)?.label ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}
  ${sys.length ? `<h3>Automatic actions</h3><ul>${sys.map((n) => `<li><b>${esc(n.label)}</b> — ${esc(SYSTEM_ACTIONS.find((a) => a.id === n.systemAction)?.does ?? '')}</li>`).join('')}</ul>` : ''}
  <h2>6. RACI matrix</h2>
  <table><thead><tr><th>Step</th>${R.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
  ${R.rows.map((r) => `<tr><td>${esc(r.label)}</td>${R.cols.map((c) => `<td style="text-align:center;font-weight:700">${r.cells[c] ?? ''}</td>`).join('')}</tr>`).join('')}
  </tbody></table>
  <p class="meta">R responsible · A accountable · C consulted · I informed</p>
  <h2>7. Form fields</h2>
  <table><thead><tr><th>Field</th><th>Key</th><th>Type</th><th>Required</th><th>Options</th></tr></thead><tbody>
  ${def.fields.map((f) => `<tr><td>${esc(f.label)}</td><td><code>${esc(f.key)}</code></td><td>${esc(f.type)}</td><td>${f.required ? 'Yes' : 'No'}</td><td>${esc((f.options ?? []).filter(Boolean).join(', '))}</td></tr>`).join('') || '<tr><td colspan="5">No form fields.</td></tr>'}
  </tbody></table>
  <h2>8. Approval authority</h2>
  ${usesDoa && m ? `<p>Steps marked “dollar authority” route to the approver whose limit first covers the amount, from <b>${esc(m.name)}</b> v${m.version}, effective ${esc(fmtDate(m.effective))}. Out-of-office approvers are replaced by their named delegate for the dates set.</p>
  <table><thead><tr><th>Amount up to</th><th>Approver</th><th>Role</th><th>People holding the role</th></tr></thead><tbody>
  ${m.rows.slice().sort((a, b) => a.upTo - b.upTo).map((r, i, arr) => `<tr><td class="num">${r.upTo >= 1e12 ? `Above ${money(arr[i - 1]?.upTo ?? 0, 'full')}` : money(r.upTo, 'full')}</td><td>${esc(r.label)}</td><td>${esc(s.roles.find((x) => x.id === r.roleId)?.name ?? r.roleId)}</td><td>${esc(s.people.filter((p) => p.roles.includes(r.roleId) && !p.company).map((p) => p.name).join(', '))}</td></tr>`).join('')}
  </tbody></table>` : '<p>This process does not route by dollar amount; approvers are named by role or project team position in the procedure above.</p>'}
  <h2>9. Revision history</h2>
  <table><thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Change</th><th>Published</th></tr></thead><tbody>
  ${revs.map((r) => `<tr><td>v${r.version}</td><td>${esc(r.status)}</td><td>${esc(fmtDate(r.effective))}</td><td>${esc(r.summary)}</td><td>${r.at ? esc(fmtDateTime(r.at) + ' · ' + name(r.by)) : '—'}</td></tr>`).join('')}
  </tbody></table>
  <p class="meta">This SOP is generated from the live process definition, so the document and the system cannot drift apart.</p>`
  return body
}

export const sopHtml = (s: AppState, def: WorkflowDef, narrative?: string) => htmlDoc(`${def.name} — SOP v${def.version}`, sopBody(s, def, narrative))

/** Every published process in one printable manual with a table of contents. */
export function manualHtml(s: AppState, defs: WorkflowDef[]): string {
  const toc = `<div class="meta">${esc(s.settings.orgName)} · Generated by Crosswalk ${esc(fmtDate(s.settings.asOf))}</div><h1>Capital delivery process manual</h1>
  <p>${defs.length} published business processes with defined approvers, routing rules and approval authority. Each section is generated from the live process definition.</p>
  <table><thead><tr><th>#</th><th>Process</th><th>Key</th><th>Version</th><th>Effective</th><th>Owner</th></tr></thead><tbody>${defs.map((d, i) => `<tr><td class="num">${i + 1}</td><td>${esc(d.name)}</td><td><code>${esc(d.key)}</code></td><td>v${d.version}</td><td>${esc(fmtDate(d.effective))}</td><td>${esc(s.roles.find((r) => r.id === d.ownerRole)?.name ?? d.ownerRole)}</td></tr>`).join('')}</tbody></table>`
  return htmlDoc('Capital delivery process manual', toc + defs.map((d, i) => `<div style="page-break-before:always;margin-top:56px;border-top:3px solid #141b24;padding-top:8px">${sopBody(s, d, undefined, 'm' + i)}</div>`).join(''))
}

/** Plain-text brief of the process, for the AI narrative prompt. */
export function processBrief(s: AppState, def: WorkflowDef): string {
  const steps = stepRows(s, def)
  return [
    `Process: ${def.name} (key ${def.key}, version ${def.version}, record type ${recordTypeLabel(def.recordType)})`,
    `Owner: ${s.roles.find((r) => r.id === def.ownerRole)?.name ?? def.ownerRole}`,
    `Description: ${def.description}`,
    `Purpose: ${def.purpose}`,
    `Form fields: ${def.fields.map((f) => `${f.label} (${f.type})`).join(', ') || 'none'}`,
    'Steps:',
    ...steps.map((r) => `- ${r.num ? r.num + '. ' : ''}${r.node.label} [${nodeTypeLabel(r.node.type)}] — who: ${r.who}; SLA: ${r.sla}; does: ${r.duty}; outcomes: ${r.outcomes}`),
  ].join('\n')
}
