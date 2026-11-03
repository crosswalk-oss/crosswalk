// Estimating administration (#estimating → Administration): the backend tables every estimate uses,
// maintained by the estimating team (estimators, estimating lead, administrators); read-only for everyone else.
import { prefs } from '@/core/data'
import { useMemo, useState } from 'react'
import type { AppState } from '@/core/types'
import { personName, useMe } from '@/core/store'
import { canAdministerEstimating, currentLoaders, loaderYear, repriceCandidates } from '@/core/engine/estimatingAdmin'
import { fmtDate, sum } from '@/core/util'
import { Badge, Callout, Tabs } from '@/ui/kit'
import { RateTableAdmin } from './RateTable'
import { BulkReprice } from './Reprice'
import { Markups, RegionsTax } from './Tables'
import { ChangeLog, MaturityAdmin, ScopeLibrary, UnitsQuantities } from './Lists'
import { FactorModelAdmin } from './FactorModel'

type Sub = 'rates' | 'factor' | 'reprice' | 'regions' | 'markups' | 'units' | 'scope' | 'maturity' | 'log'
const SUB_KEY = 'crosswalk:estimating:admin'

export function EstimatingAdmin({ s }: { s: AppState }) {
  const me = useMe()
  const canEdit = canAdministerEstimating(me)
  const [sub, setSub] = useState<Sub>(() => { try { return (prefs.getRaw(SUB_KEY) as Sub) || 'rates' } catch { return 'rates' } })
  const pick = (v: Sub) => { setSub(v); try { prefs.setRaw(SUB_KEY, v) } catch { /* storage blocked */ } }
  const stale = useMemo(() => repriceCandidates(s).filter((p) => p.eligible && !p.kept).length, [s])
  const cfg = s.settings.estimating
  const last = cfg.rateTableHistory[cfg.rateTableHistory.length - 1]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-md border border-line bg-surface px-4 py-2.5 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5">Rate table <Badge tone="ink">v{cfg.rateTableVersion}</Badge>{last && <span className="text-muted">{fmtDate(last.at.slice(0, 10))} · {personName(s, last.byId)}</span>}</span>
        <span>Loaders <b>{sum(currentLoaders(s).map((l) => l.pct)).toFixed(1)}%</b> <span className="text-muted">({loaderYear(s)})</span></span>
        <span>Regions <b>{cfg.regions.map((g) => `${g} ×${(cfg.regionFactors[g] ?? 1).toFixed(2)}`).join(' · ')}</b></span>
        <span>Contingency <b>{[5, 3].map((c) => `C${c} ${cfg.contingencyByClass[String(c)]}%`).join(' · ')}</b></span>
        <span className="ml-auto">{canEdit ? <Badge tone="good">You can edit</Badge> : <Badge>Read-only</Badge>}</span>
      </div>
      {!canEdit && <Callout tone="info" title="Maintained by the estimating team">These tables drive every estimate. Estimators, the estimating lead and administrators edit them; everyone else can see them. Every change is recorded in the change log.</Callout>}
      <Tabs<Sub> value={sub} onChange={pick} tabs={[
        { id: 'rates', label: 'Rate table' },
        { id: 'factor', label: 'Factor model', count: s.factorModels.some((m) => m.status === 'draft' || m.status === 'in-review') ? 1 : undefined },
        { id: 'reprice', label: 'Bulk update', count: stale || undefined },
        { id: 'regions', label: 'Regions & sales tax' },
        { id: 'markups', label: 'Loaders, escalation & contingency' },
        { id: 'units', label: 'Units & quantities' },
        { id: 'scope', label: 'Scope library' },
        { id: 'maturity', label: 'Class checklist', count: cfg.maturityItems.length },
        { id: 'log', label: 'Change log' },
      ]} />
      {sub === 'rates' && <RateTableAdmin s={s} canEdit={canEdit} onReprice={() => pick('reprice')} />}
      {sub === 'factor' && <FactorModelAdmin s={s} canEdit={canEdit} />}
      {sub === 'reprice' && <BulkReprice s={s} canEdit={canEdit} />}
      {sub === 'regions' && <RegionsTax s={s} canEdit={canEdit} />}
      {sub === 'markups' && <Markups s={s} canEdit={canEdit} />}
      {sub === 'units' && <UnitsQuantities s={s} canEdit={canEdit} />}
      {sub === 'scope' && <ScopeLibrary s={s} canEdit={canEdit} />}
      {sub === 'maturity' && <MaturityAdmin s={s} canEdit={canEdit} />}
      {sub === 'log' && <ChangeLog s={s} />}
    </div>
  )
}
