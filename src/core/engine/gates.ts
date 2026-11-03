// Stage-gate lifecycle (Module 1).
import type { AppState, DeliverableDef, GateOutcome, LifecycleTemplate, Project, StagePermission } from '../types'
import { addDays, evalCondition, nowISO, uid } from '../util'
import { createBudgetFromEstimate } from './estimates'
import { latestOf, takeSnapshot } from './position'
import { isActive, riskScore } from './risk'
import { missingInfo } from './info'

export function templateFor(s: AppState, p: Project): LifecycleTemplate {
  const prog = s.programs.find((x) => x.id === p.programId)
  return s.templates.find((t) => t.id === prog?.lifecycleTemplateId) ?? s.templates[0]
}
export const stageName = (s: AppState, p: Project) => templateFor(s, p).stages[p.stageIndex]?.name ?? '—'

/** Deliverable definitions that apply to this project at a stage (conditions evaluated, SG-03). */
export function requiredDefs(s: AppState, p: Project, stageIndex = p.stageIndex): DeliverableDef[] {
  const st = templateFor(s, p).stages[stageIndex]
  return st ? st.gate.deliverables.filter((d) => evalCondition(d.condition, p)) : []
}

/** Create missing deliverable records for the project's current stage. */
export function ensureDeliverables(d: AppState, p: Project, stageIndex = p.stageIndex) {
  const defs = requiredDefs(d, p, stageIndex)
  const team = p.team
  for (const def of defs) {
    if (d.deliverables.some((x) => x.projectId === p.id && x.defId === def.id && x.stageIndex === stageIndex)) continue
    d.deliverables.push({
      id: uid('dlv'),
      projectId: p.id,
      stageIndex,
      defId: def.id,
      status: 'not-started',
      ownerId: ownerForRole(d, p, def.ownerRole),
      reviewerId: ownerForRole(d, p, def.reviewerRole),
      due: addDays(d.settings.asOf, 45),
      version: 0,
      evidence: [],
      updatedAt: nowISO(),
    })
  }
  void team
}

/** Map a role to a person: project team first, else first person with that role. */
export function ownerForRole(s: AppState, p: Project, role: string): string | undefined {
  const map: Record<string, keyof Project['team']> = {
    pm: 'pm', sponsor: 'sponsor', engineer: 'engineer', estimator: 'estimator', 'project-controls': 'projectControls',
    scheduler: 'scheduler', 'construction-manager': 'constructionManager', 'safety-advisor': 'safety', environmental: 'environmental', land: 'land',
  }
  const pos = map[role]
  if (pos && p.team[pos]) return p.team[pos]
  return s.people.find((x) => x.roles.includes(role as any))?.id
}

export interface Readiness {
  pct: number
  total: number
  done: number
  missing: DeliverableDef[]
  estimateRequired?: number
  estimateClass?: number
  estimateOk: boolean
  highRisks: number
  ready: boolean
  blockers: string[]
  missingInfo: string[]
}

/** Gate readiness score (SG-04). */
export function readiness(s: AppState, p: Project): Readiness {
  const defs = requiredDefs(s, p)
  const dl = s.deliverables.filter((x) => x.projectId === p.id && x.stageIndex === p.stageIndex)
  const doneDefs = defs.filter((def) => dl.some((x) => x.defId === def.id && (x.status === 'accepted' || x.status === 'waived')))
  const gate = templateFor(s, p).stages[p.stageIndex]?.gate
  const est = s.estimates.filter((e) => e.projectId === p.id && e.status === 'approved').sort((a, b) => a.version - b.version).pop()
  const estimateOk = !gate?.requiredEstimateClass || (!!est && est.cls <= gate.requiredEstimateClass)
  const highRisks = s.risks.filter((r) => r.projectId === p.id && isActive(r) && riskScore(r) >= 15 && r.responses.length === 0).length
  const pct = defs.length ? Math.round((doneDefs.length / defs.length) * 100) : 100
  const blockers: string[] = []
  if (doneDefs.length < defs.length) blockers.push(`${defs.length - doneDefs.length} deliverable(s) not accepted`)
  if (!estimateOk) blockers.push(`Approved estimate must reach Class ${gate?.requiredEstimateClass}${est ? ` (now Class ${est.cls})` : ' (none approved)'}`)
  if (highRisks) blockers.push(`${highRisks} high risk(s) without a response plan`)
  const info = s.settings.infoFields ? missingInfo(s, p) : []
  if (info.length) blockers.push(`${info.length} required project information field(s) empty`)
  return {
    pct, total: defs.length, done: doneDefs.length,
    missing: defs.filter((x) => !doneDefs.includes(x)),
    estimateRequired: gate?.requiredEstimateClass, estimateClass: est?.cls, estimateOk, highRisks,
    ready: blockers.length === 0, blockers, missingInfo: info.map((f) => f.label),
  }
}

/** Permissions unlocked by gates already passed (SG-07). */
export function permissions(s: AppState, p: Project): Set<StagePermission> {
  const t = templateFor(s, p)
  const out = new Set<StagePermission>()
  for (const st of t.stages.slice(0, p.stageIndex)) st.gate.unlocks.forEach((u) => out.add(u))
  // approved early-start waivers
  for (const w of s.workflows.filter((w) => w.projectId === p.id && w.recordType === 'waiver' && w.status === 'approved')) {
    const perm = w.data.permission as StagePermission | undefined
    if (perm) out.add(perm)
  }
  return out
}

/** Construction NTP also needs an approved safety plan and issued permits (SG-07 + SF). */
export function ntpBlockers(s: AppState, p: Project): string[] {
  const out: string[] = []
  if (!permissions(s, p).has('construction-ntp')) out.push('Authorization gate not passed')
  if (!s.safetyPlans.some((x) => x.projectId === p.id && x.status === 'approved')) out.push('No approved job-specific safety plan')
  const open = s.permits.filter((x) => x.projectId === p.id && x.status !== 'issued')
  if (open.length) out.push(`${open.length} permit(s) not issued`)
  return out
}

/**
 * Record a gate decision (SG-06, SG-09). On Go: converts the approved estimate into the gate's
 * budget, creates Original/Current baselines at the control-budget gate, snapshots, and advances.
 */
export function decideGate(
  d: AppState,
  pid: string,
  outcome: GateOutcome,
  deciderIds: string[],
  notes: string,
  conditions: { title: string; ownerId: string; due: string }[] = [],
) {
  const p = d.projects.find((x) => x.id === pid)!
  const t = templateFor(d, p)
  const st = t.stages[p.stageIndex]
  const r = readiness(d, p)
  const est = d.estimates.filter((e) => e.projectId === pid && e.status === 'approved').sort((a, b) => a.version - b.version).pop()
  const dl = d.deliverables.filter((x) => x.projectId === pid && x.stageIndex === p.stageIndex)
  const actionIds = conditions.map((c) => {
    const id = uid('act')
    d.actions.push({ id, projectId: pid, title: c.title, ownerId: c.ownerId, due: c.due, status: 'open', source: 'gate' })
    return id
  })
  const go = outcome === 'go' || outcome === 'go-with-conditions'
  if (go && st.gate.budgetEvent && est) {
    createBudgetFromEstimate(d, est, st.gate.budgetEvent)
    if (st.gate.budgetEvent === 'control') {
      if (!latestOf(d, pid, 'original')) takeSnapshot(d, pid, 'original', 'Original baseline (authorization)')
      takeSnapshot(d, pid, 'current', 'Current baseline (authorization)')
    }
  }
  const snap = takeSnapshot(d, pid, 'gate', `${st.gate.name} — ${outcome}`)
  d.gateDecisions.push({
    id: uid('gd'),
    projectId: pid,
    stageIndex: p.stageIndex,
    gateName: st.gate.name,
    date: d.settings.asOf,
    outcome,
    decidedBy: deciderIds,
    readiness: r.pct,
    deliverableVersions: Object.fromEntries(dl.map((x) => [x.id, x.version])),
    estimateId: est?.id,
    snapshotId: snap.id,
    conditions: actionIds,
    notes,
  })
  const review = d.gateReviews.find((g) => g.projectId === pid && g.stageIndex === p.stageIndex && g.status === 'scheduled')
  if (review) review.status = 'held'
  if (go) {
    if (p.stageIndex < t.stages.length - 1) {
      p.stageIndex += 1
      ensureDeliverables(d, p)
    } else {
      p.status = 'closed'
      p.dates.closed = d.settings.asOf
    }
  } else if (outcome === 'hold') p.status = 'on-hold'
  else if (outcome === 'cancel') p.status = 'cancelled'
  d.audit.push({ id: uid('aud'), at: nowISO(), actorId: d.currentUserId, entity: 'gate', entityId: pid, projectId: pid, action: outcome, summary: `${st.gate.name}: ${outcome}` })
}
