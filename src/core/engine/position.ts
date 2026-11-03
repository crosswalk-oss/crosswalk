// Project financial position and snapshots (Module 3).
import type { AppState, BudgetVersion, Milestone, Money, Project, Snapshot, SnapshotType } from '../types'
import { daysBetween, sum, uid } from '../util'
import { exposure } from './risk'

export const projectBudgets = (s: AppState, pid: string) => s.budgets.filter((b) => b.projectId === pid).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

/** The budget in force: latest control budget, else latest planning budget. */
export function activeBudget(s: AppState, pid: string): BudgetVersion | undefined {
  const bs = projectBudgets(s, pid)
  return [...bs].reverse().find((b) => b.kind === 'control') ?? [...bs].reverse().find((b) => b.kind === 'planning')
}

export interface Position {
  budgetKind?: 'planning' | 'control'
  originalBudget: Money // first control budget total (or planning if none)
  currentBudget: Money // incl. contingency and approved new funding
  baseBudget: Money // currentBudget excluding contingency remaining
  contingencyOriginal: Money
  contingencyUsed: Money
  contingencyRemaining: Money
  approvedChanges: Money
  pendingChanges: Money
  actualToDate: Money
  commitments: Money
  eac: Money
  variance: Money // currentBudget - eac (negative = overrun)
  riskExposure: Money
}

export function position(s: AppState, pid: string): Position {
  const b = activeBudget(s, pid)
  const firstControl = projectBudgets(s, pid).find((x) => x.kind === 'control')
  const after = (d: string) => !b || d >= b.createdAt
  const changes = s.changes.filter((c) => c.projectId === pid)
  const approved = changes.filter((c) => c.status === 'approved' && after(c.decidedAt ?? c.requestedAt))
  const newFunding = sum(approved.filter((c) => c.fundedFrom === 'new-funding').map((c) => c.costImpact))
  const fromCont = sum(approved.filter((c) => c.fundedFrom === 'contingency').map((c) => c.costImpact))
  const draws = sum(s.contingencyDraws.filter((x) => x.projectId === pid && x.status === 'approved' && !x.changeId && after(x.date)).map((x) => x.amount))
  const contingencyOriginal = b?.contingency ?? 0
  const contingencyUsed = fromCont + draws
  const currentBudget = (b?.total ?? 0) + newFunding
  const periods = s.costPeriods.filter((c) => c.projectId === pid)
  const actualToDate = sum(periods.map((p) => p.actual))
  const lastPeriod = periods.slice().sort((a, b) => a.period.localeCompare(b.period)).pop()
  const fc = s.forecasts.filter((f) => f.projectId === pid).sort((a, b) => a.date.localeCompare(b.date)).pop()
  const eac = fc?.eac ?? currentBudget - Math.max(0, contingencyOriginal - contingencyUsed)
  const risks = s.risks.filter((r) => r.projectId === pid)
  return {
    budgetKind: b?.kind,
    originalBudget: (firstControl ?? b)?.total ?? 0,
    currentBudget,
    baseBudget: currentBudget - Math.max(0, contingencyOriginal - contingencyUsed),
    contingencyOriginal,
    contingencyUsed,
    contingencyRemaining: contingencyOriginal - contingencyUsed,
    approvedChanges: sum(approved.map((c) => c.costImpact)),
    pendingChanges: sum(changes.filter((c) => c.status === 'in-review' || c.status === 'draft').map((c) => c.costImpact)),
    actualToDate,
    commitments: lastPeriod?.commitments ?? 0,
    eac,
    variance: currentBudget - eac,
    riskExposure: exposure(risks),
  }
}

/** Freeze scope, schedule and budget into an immutable snapshot (BL-*). Mutates the draft. */
export function takeSnapshot(d: AppState, pid: string, type: SnapshotType, label: string, opts: { changeId?: string; proceeding?: string; byId?: string; date?: string } = {}): Snapshot {
  const p = d.projects.find((x) => x.id === pid)!
  const pos = position(d, pid)
  const b = activeBudget(d, pid)
  const byCategory: Record<string, Money> = { ...(b?.byCategory ?? {}) }
  // fold approved changes into their categories
  for (const c of d.changes.filter((c) => c.projectId === pid && c.status === 'approved' && (!b || (c.decidedAt ?? c.requestedAt) >= b.createdAt))) {
    byCategory[c.categoryId] = (byCategory[c.categoryId] || 0) + c.costImpact
  }
  const snap: Snapshot = {
    id: uid('snap'),
    projectId: pid,
    type,
    label,
    date: opts.date ?? d.settings.asOf,
    createdById: opts.byId ?? d.currentUserId,
    proceeding: opts.proceeding,
    changeId: opts.changeId,
    stageIndex: p.stageIndex,
    scope: JSON.parse(JSON.stringify(p.scope)),
    milestones: JSON.parse(JSON.stringify(p.milestones)),
    budget: { byCategory, contingencyRemaining: pos.contingencyRemaining, total: pos.currentBudget, eac: pos.eac, actualToDate: pos.actualToDate },
    riskExposure: pos.riskExposure,
  }
  d.snapshots.push(snap)
  return snap
}

export const snapshotsFor = (s: AppState, pid: string) => s.snapshots.filter((x) => x.projectId === pid).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type))
export const latestOf = (s: AppState, pid: string, type: SnapshotType) => snapshotsFor(s, pid).filter((x) => x.type === type).pop()

export interface SnapshotDiff {
  totalDelta: Money
  eacDelta: Money
  contingencyDelta: Money
  costBridge: { categoryId: string; delta: Money }[]
  milestoneMoves: { name: string; from: string; to: string; days: number }[]
  scopeAdded: string[]
  scopeRemoved: string[]
  quantityChanges: { label: string; from: number; to: number; unit: string }[]
}

/** Compare any two snapshots (BL-04). */
export function compareSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  const cats = Array.from(new Set([...Object.keys(a.budget.byCategory), ...Object.keys(b.budget.byCategory)]))
  const costBridge = cats.map((c) => ({ categoryId: c, delta: (b.budget.byCategory[c] || 0) - (a.budget.byCategory[c] || 0) })).filter((x) => x.delta !== 0)
  const milestoneMoves = b.milestones
    .map((m) => {
      const prev = a.milestones.find((x) => x.name === m.name)
      return prev ? { name: m.name, from: prev.forecast, to: m.forecast, days: daysBetween(prev.forecast, m.forecast) } : null
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.days !== 0)
  const qa = new Map(a.scope.quantities.map((q) => [q.label, q]))
  return {
    totalDelta: b.budget.total - a.budget.total,
    eacDelta: b.budget.eac - a.budget.eac,
    contingencyDelta: b.budget.contingencyRemaining - a.budget.contingencyRemaining,
    costBridge,
    milestoneMoves,
    scopeAdded: b.scope.inScope.filter((x) => !a.scope.inScope.includes(x)),
    scopeRemoved: a.scope.inScope.filter((x) => !b.scope.inScope.includes(x)),
    quantityChanges: b.scope.quantities.filter((q) => qa.has(q.label) && qa.get(q.label)!.qty !== q.qty).map((q) => ({ label: q.label, from: qa.get(q.label)!.qty, to: q.qty, unit: q.unit })),
  }
}

/** Threshold check (BL-05): returns breaches needing a variance explanation. */
export function thresholdBreaches(s: AppState, p: Project): { metric: 'eac' | 'milestone'; description: string; amount: number }[] {
  const out: { metric: 'eac' | 'milestone'; description: string; amount: number }[] = []
  const pos = position(s, p.id)
  const cur = latestOf(s, p.id, 'current') ?? latestOf(s, p.id, 'original')
  const t = s.settings.varianceThresholds
  if (cur) {
    const over = pos.eac - cur.budget.total
    if (over > 0 && (over / Math.max(1, cur.budget.total) > t.eacPct / 100 || over > t.eacAbs)) out.push({ metric: 'eac', description: `EAC exceeds Current baseline by ${Math.round((over / cur.budget.total) * 100)}%`, amount: over })
    for (const m of p.milestones) {
      const bm = cur.milestones.find((x) => x.name === m.name)
      if (bm && !m.actual) {
        const slip = daysBetween(bm.forecast, m.forecast)
        if (slip > t.milestoneDays) out.push({ metric: 'milestone', description: `${m.name} slipped ${slip} days vs Current baseline`, amount: slip })
      }
    }
  }
  return out
}

export function nextMilestone(p: Project): Milestone | undefined {
  return p.milestones.filter((m) => !m.actual).sort((a, b) => a.forecast.localeCompare(b.forecast))[0]
}
