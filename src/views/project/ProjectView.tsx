// Project workspace frame: header with position + health, then one tab per module.
import { useMemo } from 'react'
import { useStore, personName } from '@/core/store'
import { projectHref, type ProjectTab } from '@/core/router'
import { templateFor } from '@/core/engine/gates'
import { position } from '@/core/engine/position'
import { money, cx } from '@/core/util'
import { Badge, HealthDot, StageTrack, StatusBadge, Empty } from '@/ui/kit'
import { ProgramTag } from '../shared/pickers'
import { messagesHref } from '../messages/lib'
import Overview from './tabs/Overview'
import Lifecycle from './tabs/Lifecycle'
import Estimates from './tabs/Estimates'
import Baselines from './tabs/Baselines'
import Cost from './tabs/Cost'
import Changes from './tabs/Changes'
import Risk from './tabs/Risk'
import Safety from './tabs/Safety'
import Permits from './tabs/Permits'
import Records from './tabs/Records'
import Evidence from './tabs/Evidence'
import Activity from './tabs/Activity'
import ProjectInfo from './tabs/ProjectInfo'
import LocationMap from './tabs/LocationMap'
import ForecastSpread from './tabs/ForecastSpread'
import Finance from './tabs/Finance'

const TABS: { id: ProjectTab; label: string; C: (p: { projectId: string }) => JSX.Element }[] = [
  { id: 'overview', label: 'Overview', C: Overview },
  { id: 'info', label: 'Project info', C: ProjectInfo },
  { id: 'map', label: 'Map', C: LocationMap },
  { id: 'lifecycle', label: 'Lifecycle & gates', C: Lifecycle },
  { id: 'estimates', label: 'Estimates', C: Estimates },
  { id: 'baselines', label: 'Baselines', C: Baselines },
  { id: 'cost', label: 'Cost & EVM', C: Cost },
  { id: 'forecast', label: 'Forecast spread', C: ForecastSpread },
  { id: 'finance', label: 'Finance & commitments', C: Finance },
  { id: 'changes', label: 'Changes', C: Changes },
  { id: 'risk', label: 'Risk', C: Risk },
  { id: 'safety', label: 'Safety', C: Safety },
  { id: 'permits', label: 'Permits & contracts', C: Permits },
  { id: 'records', label: 'Records & closeout', C: Records },
  { id: 'evidence', label: 'Evidence', C: Evidence },
  { id: 'activity', label: 'Activity', C: Activity },
]

export default function ProjectView({ id, tab }: { id: string; tab?: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === id)
  const pos = useMemo(() => (p ? position(s, p.id) : undefined), [s, p])
  if (!p || !pos) return <Empty title="Project not found">Check the project number in the link.</Empty>
  const tpl = templateFor(s, p)
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]
  const openTasks = s.workflows.filter((w) => w.projectId === p.id && w.status === 'running').length
  const counts: Partial<Record<ProjectTab, number>> = {
    changes: s.changes.filter((c) => c.projectId === p.id && c.status === 'in-review').length || undefined,
    finance: s.commitmentChanges.filter((c) => c.projectId === p.id && c.status === 'in-review').length || undefined,
    risk: s.risks.filter((r) => r.projectId === p.id && (r.status === 'open' || r.status === 'mitigating')).length,
    activity: openTasks || undefined,
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <ProgramTag programId={p.programId} />
              <span className="font-mono font-semibold text-ink">{p.code}</span>
              <span>·</span><span>{p.location.city}, {p.location.district} district</span>
              <span>·</span><span>Tier {p.sizeTier}</span>
              {p.status !== 'active' && <StatusBadge status={p.status} />}
            </div>
            <h1 className="mt-1 font-display text-[24px] font-bold leading-tight">{p.name}</h1>
            <div className="mt-3 max-w-xl">
              <StageTrack stages={tpl.stages.map((x) => x.name)} current={p.stageIndex} status={p.status} />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                <span>Stage {p.stageIndex + 1} of {tpl.stages.length}: <b className="text-ink">{tpl.stages[p.stageIndex]?.name}</b></span>
                <span>PM {personName(s, p.team.pm)}</span>
                <span>Sponsor {personName(s, p.team.sponsor)}</span>
                <a href={messagesHref(p.code)} className="font-semibold text-link hover:underline">Message the team</a>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Fig label={pos.budgetKind === 'control' ? 'Control budget' : pos.budgetKind === 'planning' ? 'Planning budget' : 'Budget'} value={money(pos.currentBudget)} />
            <Fig label="Forecast (EAC)" value={money(pos.eac)} tone={pos.currentBudget && pos.eac > pos.currentBudget ? 'bad' : undefined} />
            <Fig label="Actual to date" value={money(pos.actualToDate)} />
            <Fig label="Contingency left" value={money(pos.contingencyRemaining)} tone={pos.contingencyOriginal && pos.contingencyRemaining < pos.contingencyOriginal * 0.25 ? 'warn' : undefined} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-2">
          <HealthDot rag={p.health.scope} label="Scope" /><HealthDot rag={p.health.schedule} label="Schedule" /><HealthDot rag={p.health.cost} label="Cost" /><HealthDot rag={p.health.risk} label="Risk" /><HealthDot rag={p.health.safety} label="Safety" />
          {openTasks > 0 && <Badge tone="marker">{openTasks} workflow{openTasks > 1 ? 's' : ''} in progress</Badge>}
        </div>
        <nav className="scroll-x flex gap-0.5 border-t border-line px-3" role="tablist">
          {TABS.map((t) => (
            <a key={t.id} href={projectHref(p.id, t.id)} role="tab" aria-selected={active.id === t.id}
              className={cx('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-semibold', active.id === t.id ? 'border-marker text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {t.label}{counts[t.id] ? <span className="rounded-full bg-sunken px-1.5 text-[11px] tabular-nums text-muted">{counts[t.id]}</span> : null}
            </a>
          ))}
        </nav>
      </header>
      <div className="min-w-0"><active.C projectId={p.id} /></div>
    </div>
  )
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className={cx('font-display text-[19px] font-bold tabular-nums', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : '')}>{value}</div>
    </div>
  )
}
