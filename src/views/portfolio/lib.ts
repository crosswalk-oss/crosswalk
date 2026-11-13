// Portfolio-level derivations shared by builder A's views (portfolio, projects, gates, overview, lifecycle).
// Pure functions over AppState — every figure traces to records via the engine.
import type { AppState, Estimate, GateReview, Milestone, Project, RAG } from '@/core/types'
import { activeBudget, nextMilestone, position, type Position } from '@/core/engine/position'
import { readiness, templateFor } from '@/core/engine/gates'
import { estimateTotals } from '@/core/engine/estimates'
import { addDays, daysBetween, sum } from '@/core/util'
import { personName } from '@/core/store'

/** Normalized phases so the 5-stage and 3-stage templates can be compared on one axis. */
export const PHASES = ['Initiation', 'Option selection', 'Design & procurement', 'Construction', 'Closeout'] as const
// Initiation stays neutral; the four working stages take the four accents so each reads at a glance.
export const PHASE_CLS = ['bg-ink/15', 'bg-marker', 'bg-warn', 'bg-link', 'bg-good']
export const PHASE_FILL = ['rgb(var(--ink) / 0.15)', 'rgb(var(--marker))', 'rgb(var(--warn))', 'rgb(var(--link))', 'rgb(var(--good))']

export function phaseOf(s: AppState, p: Project): number {
  const t = templateFor(s, p)
  if (t.stages.length === 3) return [0, 2, 3][p.stageIndex] ?? 3
  return Math.min(p.stageIndex, 4)
}

/** Latest estimate version for a project (any status except rejected). */
export function latestEstimate(s: AppState, pid: string): Estimate | undefined {
  return s.estimates.filter((e) => e.projectId === pid && e.status !== 'rejected').sort((a, b) => a.version - b.version).pop()
}
export function latestApprovedEstimate(s: AppState, pid: string): Estimate | undefined {
  return s.estimates.filter((e) => e.projectId === pid && e.status === 'approved').sort((a, b) => a.version - b.version).pop()
}

/** Overall health roll-up: red if cost is red or two dimensions are red; amber if any red or two ambers. */
export function overallHealth(h: Project['health']): RAG {
  const v = Object.values(h)
  const reds = v.filter((x) => x === 'red').length
  const ambers = v.filter((x) => x === 'amber').length
  if (h.cost === 'red' || reds >= 2) return 'red'
  if (reds >= 1 || ambers >= 2) return 'amber'
  return 'green'
}

export interface ProjectRow {
  p: Project
  programCode: string
  stages: string[]
  stageName: string
  phase: number
  pos: Position
  budget: number
  budgetBasis: 'control' | 'planning' | 'estimate' | 'none'
  eac: number
  variance: number // eac - budget (positive = overrun)
  variancePct: number
  next?: Milestone
  nextSlip: number
  readiness: number
  blockers: string[]
  pmName: string
  overall: RAG
  nextReview?: GateReview
}

export function projectRow(s: AppState, p: Project): ProjectRow {
  const t = templateFor(s, p)
  const pos = position(s, p.id)
  let budget = pos.currentBudget
  let eac = pos.eac
  let basis: ProjectRow['budgetBasis'] = pos.budgetKind ?? 'none'
  if (!budget) {
    const e = latestEstimate(s, p.id)
    if (e) { budget = estimateTotals(e).total; eac = budget; basis = 'estimate' }
  }
  const next = nextMilestone(p)
  const r = p.status === 'active' ? readiness(s, p) : { pct: 100, blockers: [] as string[] }
  const variance = basis === 'estimate' || basis === 'none' ? 0 : eac - budget
  return {
    p,
    programCode: s.programs.find((x) => x.id === p.programId)?.code ?? '—',
    stages: t.stages.map((x) => x.name),
    stageName: t.stages[p.stageIndex]?.name ?? '—',
    phase: phaseOf(s, p),
    pos,
    budget,
    budgetBasis: basis,
    eac,
    variance,
    variancePct: budget ? variance / budget : 0,
    next,
    nextSlip: next ? daysBetween(next.baseline, next.forecast) : 0,
    readiness: r.pct,
    blockers: r.blockers,
    pmName: personName(s, p.team.pm),
    overall: overallHealth(p.health),
    nextReview: s.gateReviews.filter((g) => g.projectId === p.id && g.status === 'scheduled').sort((a, b) => a.scheduled.localeCompare(b.scheduled))[0],
  }
}

/** Find a deliverable definition by id across templates. */
export function defById(s: AppState, defId: string) {
  for (const t of s.templates) for (const st of t.stages) { const d = st.gate.deliverables.find((x) => x.id === defId); if (d) return d }
  return undefined
}

// ───────────────────────────── Funding position (authorized vs budget vs EAC vs actual)
export interface FundingFigures { authorized: number; budget: number; eac: number; actual: number }

/**
 * Year figures: authorized = funding envelopes for the year; budget = active budget's spread for the year;
 * forecast = actuals to date in the year + remaining year budget scaled by the project's EAC/budget ratio;
 * actual = ERP cost periods in the year.
 */
export function yearFigures(s: AppState, projects: Project[], programIds: string[], year: number): FundingFigures {
  const y = String(year)
  const authorized = sum(s.funding.filter((f) => f.year === year && programIds.includes(f.programId)).map((f) => f.authorized))
  let budget = 0, eac = 0, actual = 0
  for (const p of projects) {
    const b = activeBudget(s, p.id)
    const pos = position(s, p.id)
    const by = b?.byYear[y] ?? 0
    const act = sum(s.costPeriods.filter((c) => c.projectId === p.id && c.period.startsWith(y)).map((c) => c.actual))
    const ratio = pos.currentBudget ? pos.eac / pos.currentBudget : 1
    budget += by
    actual += act
    eac += p.status === 'closed' ? act : act + Math.max(0, by - act) * ratio
  }
  return { authorized, budget: Math.round(budget), eac: Math.round(eac), actual: Math.round(actual) }
}

export function allInFigures(s: AppState, projects: Project[], programIds: string[]): FundingFigures {
  const pos = projects.map((p) => position(s, p.id))
  return {
    authorized: sum(s.funding.filter((f) => programIds.includes(f.programId)).map((f) => f.authorized)),
    budget: sum(pos.map((x) => x.currentBudget)),
    eac: sum(pos.map((x) => x.eac)),
    actual: sum(pos.map((x) => x.actualToDate)),
  }
}

// ───────────────────────────── Needs attention
export interface AttentionItem { id: string; projectId: string; code: string; kind: string; label: string; detail: string; severity: 'bad' | 'warn'; href: string; date?: string }

export function needsAttention(s: AppState, projects: Project[]): AttentionItem[] {
  const out: AttentionItem[] = []
  const asOf = s.settings.asOf
  const ids = new Set(projects.map((p) => p.id))
  const code = (pid: string) => s.projects.find((p) => p.id === pid)?.code ?? pid
  const num = (pid: string) => pid.replace(/\D/g, '')
  for (const p of projects) {
    if (p.status !== 'active') continue
    const reds = (Object.keys(p.health) as (keyof Project['health'])[]).filter((k) => p.health[k] === 'red')
    if (reds.length) out.push({ id: 'h-' + p.id, projectId: p.id, code: p.code, kind: 'Red health', label: p.name, detail: `Red on ${reds.join(', ')}`, severity: 'bad', href: `#p-${num(p.id)}` })
    const late = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex && d.due && d.due < asOf && !['accepted', 'waived', 'submitted'].includes(d.status))
    if (late.length) out.push({ id: 'dl-' + p.id, projectId: p.id, code: p.code, kind: 'Overdue deliverables', label: p.name, detail: `${late.length} gate deliverable${late.length > 1 ? 's' : ''} past due (oldest ${daysBetween(late.map((d) => d.due!).sort()[0], asOf)} days)`, severity: 'warn', href: `#p-${num(p.id)}-lifecycle`, date: late.map((d) => d.due!).sort()[0] })
  }
  for (const w of s.workflows) {
    if (w.status !== 'running' || !w.projectId || !ids.has(w.projectId)) continue
    for (const a of w.active) {
      if (!a.due) continue
      const days = daysBetween(asOf, a.due)
      if (days > 3) continue
      const def = s.workflowDefs.find((d) => d.id === w.defId)
      const step = def?.nodes.find((n) => n.id === a.nodeId)?.label ?? 'Step'
      out.push({ id: 'wf-' + w.id + a.nodeId, projectId: w.projectId, code: code(w.projectId), kind: days < 0 ? 'Overdue workflow step' : 'Workflow step due', label: w.title, detail: `${step} · ${a.assigneeIds.map((x) => personName(s, x)).join(', ')} · ${days < 0 ? `${-days} days overdue` : days === 0 ? 'due today' : `due in ${days} day${days > 1 ? 's' : ''}`}`, severity: days < 0 ? 'bad' : 'warn', href: '#inbox', date: a.due })
    }
  }
  for (const pm of s.permits) {
    if (!ids.has(pm.projectId) || pm.status !== 'issued' || !pm.expires) continue
    const days = daysBetween(asOf, pm.expires)
    if (days > 30) continue
    out.push({ id: 'pm-' + pm.id, projectId: pm.projectId, code: code(pm.projectId), kind: days < 0 ? 'Permit expired' : 'Permit expiring', label: `${pm.type} ${pm.number}`, detail: `${pm.agency} · ${days < 0 ? `expired ${-days} days ago` : `expires in ${days} days`}`, severity: days < 7 ? 'bad' : 'warn', href: `#p-${num(pm.projectId)}-permits`, date: pm.expires })
  }
  for (const sp of s.safetyPlans) {
    if (!ids.has(sp.projectId) || sp.status === 'superseded') continue
    const proj = s.projects.find((p) => p.id === sp.projectId)
    if (!proj || proj.status !== 'active') continue
    for (const t of sp.tickets) {
      const days = daysBetween(asOf, t.expires)
      if (days > 7) continue
      out.push({ id: 'tk-' + t.id, projectId: sp.projectId, code: code(sp.projectId), kind: t.type === '811 locate' ? (days < 0 ? '811 ticket expired' : '811 ticket expiring') : days < 0 ? 'Ticket expired' : 'Ticket expiring', label: `${t.type} ${t.number}`, detail: `${sp.workPackage} · ${days < 0 ? `expired ${-days} day${-days > 1 ? 's' : ''} ago — stop excavation until renewed` : days === 0 ? 'expires today' : `expires in ${days} day${days > 1 ? 's' : ''}`}`, severity: days <= 2 ? 'bad' : 'warn', href: `#p-${num(sp.projectId)}-safety`, date: t.expires })
    }
  }
  for (const a of s.actions) {
    if (!ids.has(a.projectId) || a.status !== 'open' || a.due >= asOf) continue
    out.push({ id: 'act-' + a.id, projectId: a.projectId, code: code(a.projectId), kind: 'Overdue gate condition', label: a.title, detail: `${personName(s, a.ownerId)} · due ${a.due}`, severity: 'warn', href: `#p-${num(a.projectId)}-lifecycle`, date: a.due })
  }
  for (const v of s.variances) {
    if (!ids.has(v.projectId) || v.status !== 'required') continue
    out.push({ id: 'var-' + v.id, projectId: v.projectId, code: code(v.projectId), kind: 'Variance explanation due', label: v.description, detail: 'Threshold breached; narrative and root cause required before period close', severity: 'warn', href: `#p-${num(v.projectId)}-baselines` })
  }
  const rank = (x: AttentionItem) => (x.severity === 'bad' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || (a.date ?? '9').localeCompare(b.date ?? '9'))
}

// ───────────────────────────── Safety leading indicators
export function safetyIndicators(s: AppState, projects: Project[]) {
  const ids = new Set(projects.map((p) => p.id))
  const asOf = s.settings.asOf
  const from7 = addDays(asOf, -7), from30 = addDays(asOf, -30)
  const tb7 = s.tailboards.filter((t) => ids.has(t.projectId) && t.date > from7 && t.date <= asOf)
  const tbPrior = s.tailboards.filter((t) => ids.has(t.projectId) && t.date > addDays(asOf, -14) && t.date <= from7)
  const sifOpen = s.safetyEvents.filter((e) => ids.has(e.projectId) && e.sifPotential && e.status === 'open')
  const nearMiss30 = s.safetyEvents.filter((e) => ids.has(e.projectId) && e.type === 'near-miss' && e.date > from30)
  const obs30 = s.safetyEvents.filter((e) => ids.has(e.projectId) && e.type === 'observation' && e.date > from30)
  const incidents30 = s.safetyEvents.filter((e) => ids.has(e.projectId) && e.type === 'incident' && e.date > from30)
  const plansInReview = s.safetyPlans.filter((x) => ids.has(x.projectId) && x.status === 'in-review')
  const byProject = projects
    .map((p) => ({ p, tb: tb7.filter((t) => t.projectId === p.id).length, attendees: sum(tb7.filter((t) => t.projectId === p.id).map((t) => t.attendees.length)), sif: sifOpen.filter((e) => e.projectId === p.id).length }))
    .filter((x) => x.tb || x.sif)
  return { tb7, tbPrior, sifOpen, nearMiss30, obs30, incidents30, plansInReview, byProject }
}

/** Days from one go decision to the next, per program and stage (SG-12). */
export function stageDurations(s: AppState) {
  const out: { programId: string; stageIndex: number; days: number; projectId: string }[] = []
  for (const p of s.projects) {
    const ds = s.gateDecisions.filter((g) => g.projectId === p.id && (g.outcome === 'go' || g.outcome === 'go-with-conditions')).sort((a, b) => a.date.localeCompare(b.date))
    let prev = p.dates.initiated
    for (const g of ds) {
      out.push({ programId: p.programId, stageIndex: g.stageIndex, days: daysBetween(prev, g.date), projectId: p.id })
      prev = g.date
    }
  }
  return out
}
