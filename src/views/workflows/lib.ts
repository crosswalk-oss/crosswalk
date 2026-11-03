// Workflow designer / catalog / inbox logic (builder E). Pure functions over AppState so they can be unit-tested.
import type { AppState, Assignee, Condition, DoaMatrix, FormField, Person, RecordType, RoleId, TeamPosition, WfEdge, WfNode, WfNodeType, WorkflowDef, WorkflowInstance } from '@/core/types'
import { doaRoleFor, laneOf, resolveAssignees, type Task } from '@/core/engine/workflow'
import { describeCondition, evalCondition, money, uid } from '@/core/util'

// ───────────────────────────── Labels
export const NODE_TYPES: { type: WfNodeType; label: string; hint: string }[] = [
  { type: 'form', label: 'Form', hint: 'Someone fills in and submits information' },
  { type: 'review', label: 'Review', hint: 'Someone checks the record and approves or returns it' },
  { type: 'approval', label: 'Approval', hint: 'An e-signed decision: approve, return or reject' },
  { type: 'condition', label: 'Decision', hint: 'Route by a rule on form data or project attributes' },
  { type: 'parallel-split', label: 'Parallel split', hint: 'Start several steps at the same time' },
  { type: 'parallel-join', label: 'Parallel join', hint: 'Wait until every parallel branch is done' },
  { type: 'notify', label: 'Notify', hint: 'Send a notification and continue' },
  { type: 'system', label: 'System action', hint: 'Crosswalk does something automatically' },
  { type: 'start', label: 'Start', hint: 'Where the process begins' },
  { type: 'end', label: 'End', hint: 'Where the process completes' },
]
export const nodeTypeLabel = (t: WfNodeType) => NODE_TYPES.find((x) => x.type === t)?.label ?? t
export const isHuman = (t: WfNodeType) => t === 'form' || t === 'review' || t === 'approval'

export const TEAM_POSITIONS: { id: TeamPosition; label: string }[] = [
  { id: 'pm', label: 'Project Manager' }, { id: 'sponsor', label: 'Project Sponsor' }, { id: 'engineer', label: 'Project Engineer' },
  { id: 'estimator', label: 'Estimator' }, { id: 'projectControls', label: 'Project Controls' }, { id: 'scheduler', label: 'Scheduler' },
  { id: 'constructionManager', label: 'Construction Manager' }, { id: 'safety', label: 'Safety Advisor' }, { id: 'environmental', label: 'Environmental' }, { id: 'land', label: 'Land' },
]
export const teamLabel = (p: TeamPosition) => TEAM_POSITIONS.find((x) => x.id === p)?.label ?? p

export const RECORD_TYPES: { id: RecordType; label: string }[] = [
  { id: 'change', label: 'Change request' }, { id: 'estimate', label: 'Estimate' }, { id: 'gate', label: 'Gate review' }, { id: 'safety-plan', label: 'Safety plan' },
  { id: 'contingency', label: 'Contingency drawdown' }, { id: 'variance', label: 'Variance explanation' }, { id: 'deliverable', label: 'Gate deliverable' },
  { id: 'initiation', label: 'Initiation request' }, { id: 'closeout', label: 'Closeout' }, { id: 'budget', label: 'Budget' }, { id: 'contract', label: 'Contract' }, { id: 'waiver', label: 'Waiver / exception' }, { id: 'factor-model', label: 'Factor model' },
]
export const recordTypeLabel = (r: RecordType) => RECORD_TYPES.find((x) => x.id === r)?.label ?? r

export const SYSTEM_ACTIONS: { id: NonNullable<WfNode['systemAction']>; label: string; does: string }[] = [
  { id: 'create-baseline', label: 'Create baseline snapshot', does: 'Creates a new Current baseline snapshot linked to the approved record.' },
  { id: 'post-budget', label: 'Post budget to ERP', does: 'Posts the approved budget version to the ERP project (WBS).' },
  { id: 'advance-stage', label: 'Snapshot & advance stage', does: 'Takes a gate snapshot and advances the project to the next lifecycle stage.' },
  { id: 'lock-estimate', label: 'Lock estimate version', does: 'Locks the estimate version so it can no longer be edited.' },
  { id: 'notify-erp', label: 'Notify ERP', does: 'Sends the approved values to the ERP interface.' },
  { id: 'release-ntp', label: 'Release NTP check', does: 'Re-checks notice-to-proceed blockers and releases NTP when clear.' },
  { id: 'none', label: 'No action (marker only)', does: 'Records a milestone in the workflow history.' },
]

/** Project attribute paths offered in the condition editor (evaluated against `project.*`). */
export const PROJECT_PATHS: { path: string; label: string; kind: 'number' | 'boolean' | 'text' }[] = [
  { path: 'project.location.hca', label: 'Project · in HCA', kind: 'boolean' },
  { path: 'project.location.dac', label: 'Project · disadvantaged community', kind: 'boolean' },
  { path: 'project.location.classLocation', label: 'Project · class location', kind: 'number' },
  { path: 'project.location.terrain', label: 'Project · terrain', kind: 'text' },
  { path: 'project.sizeTier', label: 'Project · size tier (S/M/L)', kind: 'text' },
  { path: 'project.programId', label: 'Project · program id', kind: 'text' },
  { path: 'project.workMethod', label: 'Project · work method', kind: 'text' },
  { path: 'project.asset.diameterIn', label: 'Project · diameter (in)', kind: 'number' },
  { path: 'project.asset.maopPsig', label: 'Project · MAOP (psig)', kind: 'number' },
  { path: 'project.stageIndex', label: 'Project · stage index', kind: 'number' },
  { path: 'project.permitsNeeded.ceqa', label: 'Project · CEQA needed', kind: 'boolean' },
]

export function describeAssignee(s: Pick<AppState, 'roles' | 'people'>, a: Assignee | undefined, fields: FormField[] = []): string {
  if (!a) return 'Unassigned'
  switch (a.kind) {
    case 'role': return s.roles.find((r) => r.id === a.roleId)?.name ?? a.roleId
    case 'person': return s.people.find((p) => p.id === a.personId)?.name ?? 'Named person'
    case 'team-position': return `Project's ${teamLabel(a.position)}`
    case 'requester': return 'Requester'
    case 'manager-of-requester': return "Requester's manager"
    case 'doa': return `Dollar authority on ${fields.find((f) => f.key === a.field)?.label ?? a.field}`
  }
}

/** Swimlane label with sensible placement for non-human nodes. */
export function laneFor(s: AppState, def: WorkflowDef, n: WfNode): string {
  if (n.lane) return n.lane
  if (n.assignee) return laneOf(s, n)
  if (n.type === 'start') {
    const first = def.edges.find((e) => e.from === n.id)
    const t = first && def.nodes.find((x) => x.id === first.to)
    if (t?.assignee) return laneOf(s, t)
  }
  if (n.type === 'condition' || n.type === 'parallel-split' || n.type === 'parallel-join') {
    const into = def.edges.find((e) => e.to === n.id && !e.outcome?.match(/return|reject/))
    const p = into && def.nodes.find((x) => x.id === into.from)
    if (p && p.id !== n.id) return laneFor(s, def, p)
  }
  return 'System'
}

export function lanesOf(s: AppState, def: WorkflowDef): string[] {
  const out: string[] = []
  for (const n of def.nodes.slice().sort((a, b) => a.x - b.x || a.y - b.y)) {
    const l = laneFor(s, def, n)
    if (l !== 'System' && !out.includes(l)) out.push(l)
  }
  if (def.nodes.some((n) => laneFor(s, def, n) === 'System')) out.push('System')
  return out
}

export function edgeOutcomeLabel(e: WfEdge): string {
  if (e.condition) return e.label || describeCondition(e.condition)
  if (e.label) return e.label
  switch (e.outcome) {
    case 'approve': return 'Approve'
    case 'return': return 'Return'
    case 'reject': return 'Reject'
    default: return ''
  }
}

export function outcomePaths(def: WorkflowDef, n: WfNode): string {
  const name = (id: string) => def.nodes.find((x) => x.id === id)?.label ?? '?'
  const out = def.edges.filter((e) => e.from === n.id)
  if (n.type === 'end') return 'Process completes; the requester is notified of the outcome.'
  if (!out.length) return '—'
  if (n.type === 'condition') {
    const conds = out.filter((e) => e.condition).map((e) => `If ${describeCondition(e.condition)} → ${name(e.to)}`)
    const def0 = out.find((e) => !e.condition)
    return [...conds, def0 ? `Otherwise → ${name(def0.to)}` : ''].filter(Boolean).join('; ')
  }
  if (n.type === 'parallel-split') return `In parallel → ${out.map((e) => name(e.to)).join(' + ')}`
  const parts = out.map((e) => `${e.outcome === 'return' ? 'Return' : e.outcome === 'reject' ? 'Reject' : n.type === 'form' ? 'Submit' : isHuman(n.type) ? 'Approve' : 'Then'} → ${name(e.to)}`)
  if (n.type === 'approval' && !out.some((e) => e.outcome === 'reject')) parts.push('Reject → process ends as rejected')
  if (isHuman(n.type) && n.type !== 'form' && !out.some((e) => e.outcome === 'return')) parts.push('Return → process ends as returned')
  return parts.join('; ')
}

export function stepDuty(def: WorkflowDef, n: WfNode): string {
  if (n.description) return n.description
  const rec = recordTypeLabel(def.recordType).toLowerCase()
  switch (n.type) {
    case 'start': return `A ${rec} is submitted into the process.`
    case 'form': return `Completes the ${def.fields.length ? def.fields.map((f) => f.label.toLowerCase()).join(', ') : 'request'} and submits.`
    case 'review': return `Reviews the ${rec} and either approves it forward or returns it with comments.`
    case 'approval': return `Decides on the ${rec} and e-signs: approve, return for revision, or reject.`
    case 'condition': return `Routes automatically: ${outcomePaths(def, n)}.`
    case 'parallel-split': return 'Starts the following steps at the same time.'
    case 'parallel-join': return 'Waits until every parallel branch is complete.'
    case 'notify': return 'Sends a notification and continues without waiting.'
    case 'system': return SYSTEM_ACTIONS.find((a) => a.id === n.systemAction)?.does ?? 'Crosswalk performs an automatic action.'
    case 'end': return 'The outcome is applied to the record and the requester is notified.'
  }
}

/** Nodes in reading order (breadth-first from start, forward edges only, then by x). */
export function orderedNodes(def: WorkflowDef): WfNode[] {
  const start = def.nodes.find((n) => n.type === 'start')
  const seen = new Set<string>()
  const out: WfNode[] = []
  if (start) {
    const q = [start.id]
    while (q.length) {
      const id = q.shift()!
      if (seen.has(id)) continue
      seen.add(id)
      const n = def.nodes.find((x) => x.id === id)
      if (!n) continue
      out.push(n)
      def.edges.filter((e) => e.from === id && e.outcome !== 'return' && e.outcome !== 'reject').map((e) => def.nodes.find((x) => x.id === e.to)).filter(Boolean).sort((a, b) => a!.x - b!.x || a!.y - b!.y).forEach((t) => q.push(t!.id))
    }
  }
  const rest = def.nodes.filter((n) => !seen.has(n.id)).sort((a, b) => a.x - b.x)
  const all = [...out, ...rest]
  // keep end nodes last
  return [...all.filter((n) => n.type !== 'end'), ...all.filter((n) => n.type === 'end')]
}

// ───────────────────────────── Validation (WF-08 publish checklist)
export interface Check { id: string; ok: boolean; level: 'error' | 'warn'; label: string; detail?: string; nodeIds?: string[]; edgeIds?: string[] }

export function reachable(def: WorkflowDef, fromId: string, dir: 'fwd' | 'back' = 'fwd'): Set<string> {
  const seen = new Set<string>()
  const q = [fromId]
  while (q.length) {
    const id = q.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of def.edges) {
      if (dir === 'fwd' && e.from === id) q.push(e.to)
      if (dir === 'back' && e.to === id) q.push(e.from)
    }
  }
  return seen
}

export function validate(def: WorkflowDef): Check[] {
  const out: Check[] = []
  const starts = def.nodes.filter((n) => n.type === 'start')
  const ends = def.nodes.filter((n) => n.type === 'end')
  out.push({ id: 'start', ok: starts.length === 1, level: 'error', label: 'Exactly one start', detail: starts.length === 0 ? 'Add a Start node.' : starts.length > 1 ? `${starts.length} start nodes — keep one.` : undefined, nodeIds: starts.length > 1 ? starts.map((n) => n.id) : undefined })
  out.push({ id: 'end', ok: ends.length >= 1, level: 'error', label: 'At least one end', detail: ends.length ? undefined : 'Add an End node so the process can complete.' })
  const ids = new Set(def.nodes.map((n) => n.id))
  const dangling = def.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))
  out.push({ id: 'edges', ok: !dangling.length, level: 'error', label: 'Every connection has both ends', detail: dangling.length ? `${dangling.length} broken connection(s).` : undefined, edgeIds: dangling.map((e) => e.id) })
  if (starts[0]) {
    const r = reachable(def, starts[0].id)
    const unreachable = def.nodes.filter((n) => !r.has(n.id))
    out.push({ id: 'reach', ok: !unreachable.length, level: 'error', label: 'Every step is reachable from start', detail: unreachable.length ? `Not reachable: ${unreachable.map((n) => n.label).join(', ')}` : undefined, nodeIds: unreachable.map((n) => n.id) })
    const deadEnds = def.nodes.filter((n) => n.type !== 'end' && r.has(n.id) && !ends.some((e) => reachable(def, n.id).has(e.id)))
    out.push({ id: 'finish', ok: !deadEnds.length, level: 'error', label: 'Every step can reach an end', detail: deadEnds.length ? `Dead ends: ${deadEnds.map((n) => n.label).join(', ')}` : undefined, nodeIds: deadEnds.map((n) => n.id) })
  }
  const noAssignee = def.nodes.filter((n) => isHuman(n.type) && !n.assignee)
  out.push({ id: 'assignee', ok: !noAssignee.length, level: 'error', label: 'Forms, reviews and approvals have assignees', detail: noAssignee.length ? `Missing: ${noAssignee.map((n) => n.label).join(', ')}` : undefined, nodeIds: noAssignee.map((n) => n.id) })
  const badDoa = def.nodes.filter((n) => n.assignee?.kind === 'doa' && !def.fields.some((f) => f.key === (n.assignee as { field: string }).field && (f.type === 'money' || f.type === 'number')))
  out.push({ id: 'doa', ok: !badDoa.length, level: 'error', label: 'Dollar-authority steps read a money field', detail: badDoa.length ? `Add the amount field or pick another: ${badDoa.map((n) => n.label).join(', ')}` : undefined, nodeIds: badDoa.map((n) => n.id) })
  const conds = def.nodes.filter((n) => n.type === 'condition')
  const badCond = conds.filter((n) => { const o = def.edges.filter((e) => e.from === n.id); return o.length < 2 || o.filter((e) => !e.condition).length !== 1 })
  out.push({ id: 'cond', ok: !badCond.length, level: 'error', label: 'Decisions have a rule and exactly one default path', detail: badCond.length ? `Fix: ${badCond.map((n) => n.label).join(', ')}` : undefined, nodeIds: badCond.map((n) => n.id) })
  const noForward = def.nodes.filter((n) => n.type !== 'end' && !def.edges.some((e) => e.from === n.id && e.outcome !== 'return' && e.outcome !== 'reject'))
  out.push({ id: 'forward', ok: !noForward.length, level: 'error', label: 'Every step has a way forward', detail: noForward.length ? `No forward path: ${noForward.map((n) => n.label).join(', ')}` : undefined, nodeIds: noForward.map((n) => n.id) })
  const badSplit = def.nodes.filter((n) => (n.type === 'parallel-split' && def.edges.filter((e) => e.from === n.id).length < 2) || (n.type === 'parallel-join' && def.edges.filter((e) => e.to === n.id).length < 2))
  out.push({ id: 'parallel', ok: !badSplit.length, level: 'error', label: 'Parallel splits and joins have two or more branches', detail: badSplit.length ? `Fix: ${badSplit.map((n) => n.label).join(', ')}` : undefined, nodeIds: badSplit.map((n) => n.id) })
  const noSla = def.nodes.filter((n) => isHuman(n.type) && !n.slaDays)
  out.push({ id: 'sla', ok: !noSla.length, level: 'warn', label: 'Human steps have an SLA', detail: noSla.length ? `No SLA: ${noSla.map((n) => n.label).join(', ')}` : undefined, nodeIds: noSla.map((n) => n.id) })
  const approvals = def.nodes.filter((n) => n.type === 'approval')
  out.push({ id: 'approval', ok: approvals.length > 0, level: 'warn', label: 'At least one e-signed approval', detail: approvals.length ? undefined : 'Without an approval step nobody signs the outcome.' })
  out.push({ id: 'purpose', ok: !!def.purpose.trim() && !!def.name.trim(), level: 'warn', label: 'Name and purpose filled in (used in the SOP)' })
  return out
}
export const blockingErrors = (c: Check[]) => c.filter((x) => !x.ok && x.level === 'error')

// ───────────────────────────── Versions
export const versionsOf = (s: AppState, key: string) => s.workflowDefs.filter((d) => d.key === key).sort((a, b) => b.version - a.version)
export const draftOf = (s: AppState, key: string) => versionsOf(s, key).find((d) => d.status === 'draft')

export function blankDef(key: string, name: string, recordType: RecordType, ownerRole: RoleId, effective: string): WorkflowDef {
  return {
    id: uid('wfd'), key, name, recordType, version: 1, status: 'draft', effective, ownerRole,
    description: '', purpose: '',
    fields: [{ key: 'amount', label: 'Amount', type: 'money', required: true }, { key: 'justification', label: 'Justification', type: 'textarea', required: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start', x: 60, y: 200 },
      { id: 'prep', type: 'form', label: 'Submit request', x: 220, y: 200, assignee: { kind: 'requester' }, slaDays: 3 },
      { id: 'mgr', type: 'review', label: 'Manager review', x: 410, y: 200, assignee: { kind: 'manager-of-requester' }, slaDays: 3 },
      { id: 'approve', type: 'approval', label: 'Approve by dollar authority', x: 600, y: 200, assignee: { kind: 'doa', field: 'amount' }, slaDays: 5 },
      { id: 'end', type: 'end', label: 'Complete', x: 760, y: 200 },
    ],
    edges: [
      { id: uid('e'), from: 'start', to: 'prep' }, { id: uid('e'), from: 'prep', to: 'mgr' },
      { id: uid('e'), from: 'mgr', to: 'approve', outcome: 'approve' }, { id: uid('e'), from: 'mgr', to: 'prep', outcome: 'return', label: 'Return' },
      { id: uid('e'), from: 'approve', to: 'end', outcome: 'approve' }, { id: uid('e'), from: 'approve', to: 'prep', outcome: 'return', label: 'Return' },
    ],
  }
}

export const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// ───────────────────────────── Test mode trace (WF-09)
export interface TraceStep { node: WfNode; kind: 'human' | 'auto'; via?: string; people: Person[]; delegatedFrom: { from: Person; to: Person }[]; note?: string }

/** Walk the route a request would take, resolving real people (with DOA tiers and out-of-office delegation). */
export function trace(s: AppState, def: WorkflowDef, data: Record<string, unknown>, projectId?: string, startedById?: string): TraceStep[] {
  const fake: WorkflowInstance = { id: 'sim', defId: def.id, defKey: def.key, defVersion: def.version, title: 'Simulation', recordType: def.recordType, recordId: 'sim', projectId, status: 'running', active: [], startedAt: '', startedById: startedById ?? s.currentUserId, data, history: [] }
  const noOoo: AppState = { ...s, people: s.people.map((p) => ({ ...p, outOfOffice: undefined })) }
  const project = projectId ? s.projects.find((p) => p.id === projectId) : undefined
  const ctx = { ...data, project }
  const out: TraceStep[] = []
  const seen = new Set<string>()
  const person = (id: string) => s.people.find((p) => p.id === id)
  const walk = (id: string, via: string | undefined, depth: number) => {
    if (depth > 60) return
    const n = def.nodes.find((x) => x.id === id)
    if (!n || seen.has(id)) return
    seen.add(id)
    const edges = def.edges.filter((e) => e.from === id)
    if (isHuman(n.type) || n.type === 'notify') {
      const ids = resolveAssignees(s, fake, n.assignee)
      const raw = resolveAssignees(noOoo, fake, n.assignee)
      const delegatedFrom = raw.filter((r) => !ids.includes(r)).map((r) => { const p = person(r)!; const to = person(p.outOfOffice?.delegateId ?? '')!; return { from: p, to } }).filter((x) => x.from && x.to)
      let note: string | undefined
      if (n.assignee?.kind === 'doa') {
        const field = (n.assignee as { field: string }).field
        const amt = Math.abs(Number(data[field] ?? 0))
        const role = doaRoleFor(s, fake, amt)
        const m = doaMatrixFor(s, projectId)
        const row = m?.rows.slice().sort((a, b) => a.upTo - b.upTo).find((r) => amt <= r.upTo)
        note = `${money(amt)} falls in the “${row?.label ?? role}” tier${row && row.upTo < 1e12 ? ` (up to ${money(row.upTo)})` : ''} of ${m?.name ?? 'the DOA matrix'} v${m?.version ?? '?'} → ${s.roles.find((r) => r.id === role)?.name ?? role}`
      }
      if (!ids.length) note = (note ? note + '. ' : '') + 'No one resolves — the engine would skip this step. Pick a project or fix the assignee.'
      out.push({ node: n, kind: 'human', via, people: ids.map(person).filter(Boolean) as Person[], delegatedFrom, note: note ?? (n.rule === 'all' && ids.length > 1 ? 'All must approve' : ids.length > 1 ? 'Any one may act' : undefined) })
    } else out.push({ node: n, kind: 'auto', via, people: [], delegatedFrom: [] })
    if (n.type === 'condition') {
      const hit = edges.find((e) => e.condition && evalCondition(e.condition, ctx)) ?? edges.find((e) => !e.condition)
      if (hit) { out[out.length - 1].note = `${hit.condition ? describeCondition(hit.condition) + ' → true' : 'No rule matched → default path'}: ${hit.label || 'continue'}`; walk(hit.to, hit.label, depth + 1) }
      else out[out.length - 1].note = 'No path matches and there is no default.'
    } else if (n.type === 'parallel-split') edges.forEach((e) => walk(e.to, 'parallel', depth + 1))
    else if (n.type === 'parallel-join') {
      const e = edges[0]
      if (e) { seen.delete(n.id); if (def.edges.filter((x) => x.to === n.id).every((x) => seen.has(x.from))) { seen.add(n.id); walk(e.to, undefined, depth + 1) } else { out.pop() } }
    } else {
      const e = edges.find((e) => !e.outcome || e.outcome === 'approve' || e.outcome === 'default')
      if (e) walk(e.to, e.label, depth + 1)
    }
  }
  const st = def.nodes.find((n) => n.type === 'start')
  if (st) walk(st.id, undefined, 0)
  return out
}

export function doaMatrixFor(s: AppState, projectId?: string): DoaMatrix | undefined {
  const p = projectId ? s.projects.find((x) => x.id === projectId) : undefined
  const prog = p ? s.programs.find((x) => x.id === p.programId) : undefined
  return s.doaMatrices.find((m) => m.id === prog?.doaMatrixId) ?? s.doaMatrices[0]
}

// ───────────────────────────── Analytics (WF-12)
const H = 36e5
export function nowMs(s: AppState): number { return Math.max(Date.now(), Date.parse(s.settings.asOf + 'T23:59:59Z')) }
export function fmtDur(hours: number | undefined): string {
  if (hours == null || !isFinite(hours)) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`
  return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)} d`
}

export interface StepStat { nodeId: string; label: string; type: WfNodeType; n: number; avgH: number; maxH: number; slaDays?: number; breaches: number; runningNow: number; returns: number; oldestRunningH: number }
export interface ProcessStat {
  key: string; name: string; total: number; completed: number; running: number; approved: number; rejected: number; returnedOut: number
  avgCycleH?: number; medianCycleH?: number; p90CycleH?: number; returnRate: number; slaBreaches: number; overdueNow: number
  steps: StepStat[]; bottleneck?: StepStat; cycles: number[]
}

const ACTIONS = new Set(['approve', 'reject', 'return', 'submit'])

/** Per-step elapsed hours for one instance: each actor decision measured from when its step was entered. */
export function stepDurations(def: WorkflowDef | undefined, inst: WorkflowInstance): { nodeId: string; hours: number; action: string }[] {
  const hist = inst.history.slice().sort((a, b) => a.at.localeCompare(b.at))
  const out: { nodeId: string; hours: number; action: string }[] = []
  const preds = (id: string, depth = 0): string[] => {
    if (!def || depth > 6) return []
    const direct = def.edges.filter((e) => e.to === id).map((e) => e.from)
    return direct.flatMap((p) => { const n = def.nodes.find((x) => x.id === p); return n && (n.type === 'parallel-split' || n.type === 'parallel-join') ? [p, ...preds(p, depth + 1)] : [p] })
  }
  const acted = new Set<string>()
  hist.forEach((h, i) => {
    if (!ACTIONS.has(h.action)) return
    const key = h.nodeId + '|' + h.actorId
    if (acted.has(key) && h.action === 'approve') return
    acted.add(key)
    const p = new Set(preds(h.nodeId))
    let enter: string | undefined
    for (let j = i - 1; j >= 0; j--) {
      const e = hist[j]
      if (p.has(e.nodeId) && (ACTIONS.has(e.action) || e.action === 'system' || e.action === 'start')) { enter = e.at; break }
    }
    enter ??= hist[i - 1]?.at ?? inst.startedAt
    out.push({ nodeId: h.nodeId, hours: Math.max(0, (Date.parse(h.at) - Date.parse(enter)) / H), action: h.action })
  })
  return out
}

function quantile(xs: number[], q: number) { if (!xs.length) return undefined; const a = xs.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1) + 0.5))] }

export function processStats(s: AppState, key: string): ProcessStat {
  const versions = versionsOf(s, key)
  const latest = versions.find((d) => d.status === 'published') ?? versions[0]
  const insts = s.workflows.filter((w) => w.defKey === key)
  const done = insts.filter((w) => w.status !== 'running' && w.completedAt)
  const cycles = done.map((w) => (Date.parse(w.completedAt!) - Date.parse(w.startedAt)) / H)
  const now = nowMs(s)
  const steps = new Map<string, StepStat>()
  const stat = (def: WorkflowDef | undefined, nodeId: string) => {
    let x = steps.get(nodeId)
    if (!x) {
      const n = latest?.nodes.find((y) => y.id === nodeId) ?? def?.nodes.find((y) => y.id === nodeId)
      x = { nodeId, label: n?.label ?? nodeId, type: n?.type ?? 'review', n: 0, avgH: 0, maxH: 0, slaDays: n?.slaDays, breaches: 0, runningNow: 0, returns: 0, oldestRunningH: 0 }
      steps.set(nodeId, x)
    }
    return x
  }
  let slaBreaches = 0
  for (const w of insts) {
    const def = s.workflowDefs.find((d) => d.id === w.defId)
    for (const d of stepDurations(def, w)) {
      const node = def?.nodes.find((n) => n.id === d.nodeId)
      if (!node || !isHuman(node.type)) continue
      const x = stat(def, d.nodeId)
      x.avgH = (x.avgH * x.n + d.hours) / (x.n + 1)
      x.n++
      x.maxH = Math.max(x.maxH, d.hours)
      if (d.action === 'return') x.returns++
      if (node.slaDays && d.hours > node.slaDays * 24) { x.breaches++; slaBreaches++ }
    }
    for (const a of w.status === 'running' ? w.active : []) {
      const x = stat(def, a.nodeId)
      x.runningNow++
      x.oldestRunningH = Math.max(x.oldestRunningH, (now - Date.parse(a.since)) / H)
    }
  }
  const overdueNow = insts.filter((w) => w.status === 'running').reduce((a, w) => a + w.active.filter((x) => x.due && x.due < s.settings.asOf).length, 0)
  const order = latest ? orderedNodes(latest).map((n) => n.id) : []
  const list = [...steps.values()].sort((a, b) => (order.indexOf(a.nodeId) + 1 || 99) - (order.indexOf(b.nodeId) + 1 || 99))
  const bottleneck = list.filter((x) => x.n).sort((a, b) => b.avgH - a.avgH)[0]
  return {
    key, name: latest?.name ?? key, total: insts.length, completed: done.length, running: insts.length - done.length,
    approved: done.filter((w) => w.status === 'approved').length, rejected: done.filter((w) => w.status === 'rejected').length, returnedOut: done.filter((w) => w.status === 'returned').length,
    avgCycleH: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : undefined, medianCycleH: quantile(cycles, 0.5), p90CycleH: quantile(cycles, 0.9),
    returnRate: insts.length ? insts.filter((w) => w.history.some((h) => h.action === 'return')).length / insts.length : 0,
    slaBreaches, overdueNow, steps: list, bottleneck, cycles,
  }
}

export function monthlyVolume(s: AppState, months = 12): { labels: string[]; started: number[]; completed: number[] } {
  const end = s.settings.asOf.slice(0, 7)
  const keys: string[] = []
  let [y, m] = end.split('-').map(Number)
  for (let i = 0; i < months; i++) { keys.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y-- } }
  return {
    labels: keys,
    started: keys.map((k) => s.workflows.filter((w) => w.startedAt.slice(0, 7) === k).length),
    completed: keys.map((k) => s.workflows.filter((w) => w.completedAt?.slice(0, 7) === k).length),
  }
}

// ───────────────────────────── Inbox helpers
export function taskAmount(t: Task): number | undefined {
  const v = t.inst.data.amount
  return typeof v === 'number' ? v : undefined
}
/** Low-risk items eligible for bulk approval: routine reviews and small-dollar decisions, never gates, estimates or exceptions. */
export function isLowRisk(t: Task): boolean {
  if (t.node.type === 'form') return false
  if (['gate', 'estimate', 'waiver', 'budget', 'contract', 'closeout'].includes(t.inst.recordType)) return false
  const amt = taskAmount(t)
  if (amt != null && Math.abs(amt) > 250_000) return false
  return t.node.type === 'review' || ['deliverable', 'variance', 'contingency', 'change', 'initiation', 'safety-plan'].includes(t.inst.recordType)
}

/** A short, deterministic e-signature fingerprint (the password itself is never stored). */
export function signatureHash(parts: string[]): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (const ch of parts.join('|')) { h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0; h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0 }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16)
}

export function isOutOfOffice(p: Person, asOf: string) { const o = p.outOfOffice; return !!o && asOf >= o.from && asOf <= o.to }

// ───────────────────────────── Condition helpers
export function parseConditionValue(raw: string, op: Condition['op']): unknown {
  if (op === 'truthy' || op === 'falsy') return undefined
  if (op === 'in') return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x !== '' && !isNaN(Number(x)) ? Number(x) : x))
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw
}
export const conditionValueText = (c?: Condition) => (c?.value == null ? '' : Array.isArray(c.value) ? c.value.join(', ') : String(c.value))

// ───────────────────────────── Version diff (feeds the publish note and revision history)
export function diffDefs(s: Pick<AppState, 'roles' | 'people'>, a: WorkflowDef | undefined, b: WorkflowDef): string {
  if (!a) return 'Initial release.'
  const out: string[] = []
  const an = new Map(a.nodes.map((n) => [n.id, n])), bn = new Map(b.nodes.map((n) => [n.id, n]))
  const added = b.nodes.filter((n) => !an.has(n.id)), removed = a.nodes.filter((n) => !bn.has(n.id))
  if (added.length) out.push(`Added ${added.map((n) => `“${n.label}”`).join(', ')}`)
  if (removed.length) out.push(`Removed ${removed.map((n) => `“${n.label}”`).join(', ')}`)
  for (const n of b.nodes) {
    const o = an.get(n.id)
    if (!o) continue
    const ch: string[] = []
    if (o.label !== n.label) ch.push(`renamed from “${o.label}”`)
    if (JSON.stringify(o.assignee) !== JSON.stringify(n.assignee)) ch.push(`assignee ${describeAssignee(s, o.assignee, a.fields)} → ${describeAssignee(s, n.assignee, b.fields)}`)
    if ((o.slaDays ?? 0) !== (n.slaDays ?? 0)) ch.push(`SLA ${o.slaDays ?? 0}→${n.slaDays ?? 0} days`)
    if ((o.rule ?? 'any') !== (n.rule ?? 'any')) ch.push(`rule ${o.rule ?? 'any'}→${n.rule ?? 'any'}`)
    if (o.type !== n.type) ch.push(`type ${o.type}→${n.type}`)
    if (ch.length) out.push(`“${n.label}”: ${ch.join(', ')}`)
  }
  const ek = (e: WfEdge) => `${e.from}>${e.to}:${e.outcome ?? ''}:${JSON.stringify(e.condition ?? null)}`
  const ae = new Set(a.edges.map(ek)), be = new Set(b.edges.map(ek))
  const eAdd = b.edges.filter((e) => !ae.has(ek(e))).length, eDel = a.edges.filter((e) => !be.has(ek(e))).length
  if (eAdd || eDel) out.push(`Routing: ${eAdd} path(s) added, ${eDel} removed`)
  const fa = new Set(a.fields.map((f) => f.key)), fb = new Set(b.fields.map((f) => f.key))
  const fAdd = b.fields.filter((f) => !fa.has(f.key)), fDel = a.fields.filter((f) => !fb.has(f.key))
  if (fAdd.length) out.push(`New field(s): ${fAdd.map((f) => f.label).join(', ')}`)
  if (fDel.length) out.push(`Removed field(s): ${fDel.map((f) => f.label).join(', ')}`)
  if (a.name !== b.name) out.push(`Renamed to “${b.name}”`)
  if (a.purpose !== b.purpose || a.description !== b.description) out.push('Updated description/purpose')
  return out.length ? out.join('; ') + '.' : 'No functional changes.'
}

export function defaultValues(def: WorkflowDef): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of def.fields) {
    out[f.key] = f.type === 'money' ? 420_000 : f.type === 'number' ? 0 : f.type === 'boolean' ? false : f.type === 'select' ? (f.options ?? []).find(Boolean) ?? '' : f.type === 'date' ? '' : ''
  }
  return out
}

export function previewInstance(def: WorkflowDef, projectId: string | undefined, startedById: string, data: Record<string, unknown>): WorkflowInstance {
  return { id: 'preview', defId: def.id, defKey: def.key, defVersion: def.version, title: 'Preview', recordType: def.recordType, recordId: 'preview', projectId, status: 'running', active: [], startedAt: '', startedById, data, history: [] }
}

export function defaultTestProject(s: AppState): string | undefined {
  return (s.projects.find((p) => p.status === 'active' && p.team.projectControls && p.team.sponsor && p.team.constructionManager && p.stageIndex >= 2) ?? s.projects[0])?.id
}

export function relTime(fromIso: string, nowMsV: number): string {
  const h = (nowMsV - Date.parse(fromIso)) / 36e5
  if (!isFinite(h)) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`
  if (h < 24) return `${Math.round(h)} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** Open-step load by person across every running instance (who is holding work). */
export function tasksForAll(s: AppState): { person: Person; count: number; overdue: number }[] {
  const m = new Map<string, { count: number; overdue: number }>()
  for (const w of s.workflows) {
    if (w.status !== 'running') continue
    for (const a of w.active) for (const id of a.assigneeIds) {
      if (a.actedIds.includes(id)) continue
      const x = m.get(id) ?? { count: 0, overdue: 0 }
      x.count++
      if (a.due && a.due < s.settings.asOf) x.overdue++
      m.set(id, x)
    }
  }
  return [...m.entries()].map(([id, v]) => ({ person: s.people.find((p) => p.id === id)!, ...v })).filter((x) => x.person).sort((a, b) => b.count - a.count || b.overdue - a.overdue)
}
