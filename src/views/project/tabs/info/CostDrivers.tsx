// Project Information → Cost drivers: the site drivers the Class 5 factor model prices with. Physical, legal
// and logistical drivers only (AGENT_RULES §4); class location and HCA come from the location record.
import { useState } from 'react'
import { mutate } from '@/core/store'
import type { Project, ProjectDrivers } from '@/core/types'
import { DRIVER_INFO, siteOf } from '@/core/engine/factorModel'
import { Badge, Button, Input, Panel, Select } from '@/ui/kit'
import { toast } from '@/ui/toast'

type EnumKey = 'soil' | 'permitComplexity' | 'traffic' | 'workHours' | 'remoteness'
const ENUM_KEYS: EnumKey[] = ['soil', 'permitComplexity', 'traffic', 'workHours', 'remoteness']
const label = (k: keyof typeof DRIVER_INFO, v: string) => DRIVER_INFO[k].levels.find((l) => l.value === v)?.label ?? v

export function CostDrivers({ p, canEdit }: { p: Project; canEdit: boolean }) {
  const site = siteOf(p)
  const current: ProjectDrivers = { soil: site.soil, permitComplexity: site.permitComplexity, traffic: site.traffic, workHours: site.workHours, crossings: site.crossings, remoteness: site.remoteness }
  const [draft, setDraft] = useState<ProjectDrivers | null>(null)
  const [reason, setReason] = useState('')
  const d = draft ?? current
  const changed = (Object.keys(current) as (keyof ProjectDrivers)[]).filter((k) => draft && draft[k] !== current[k])

  const save = () => {
    if (!draft || !changed.length || !reason.trim()) return
    const summary = changed.map((k) => `${k === 'crossings' ? 'Crossings' : DRIVER_INFO[k].label}: ${k === 'crossings' ? current[k] : label(k, String(current[k]))} → ${k === 'crossings' ? draft[k] : label(k, String(draft[k]))}`).join('; ')
    mutate((s) => { const q = s.projects.find((x) => x.id === p.id); if (q) q.drivers = { ...draft } },
      { entity: 'project', entityId: p.id, projectId: p.id, action: 'update', summary: `Cost drivers: ${summary} — ${reason.trim()}` })
    toast('Cost drivers saved. New quick estimates use them.', 'good')
    setDraft(null); setReason('')
  }

  return (
    <Panel title="Cost drivers" subtitle="What the Class 5 factor model prices with"
      actions={canEdit && !draft && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...current })}>Edit</Button>}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
        {ENUM_KEYS.map((k) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11.5px] font-semibold text-muted" title={DRIVER_INFO[k].help}>{DRIVER_INFO[k].label}</dt>
            <dd>{draft
              ? <Select aria-label={DRIVER_INFO[k].label} value={String(d[k])} options={DRIVER_INFO[k].levels} onChange={(e) => setDraft({ ...d, [k]: e.target.value } as ProjectDrivers)} />
              : label(k, String(d[k]))}</dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="text-[11.5px] font-semibold text-muted" title={DRIVER_INFO.crossings.help}>Road, rail & water crossings</dt>
          <dd>{draft
            ? <Input aria-label="Crossings" type="number" min={0} step={1} value={d.crossings} onChange={(e) => setDraft({ ...d, crossings: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            : <span className="tabular-nums">{d.crossings}</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11.5px] font-semibold text-muted">From the location record</dt>
          <dd className="flex flex-wrap gap-1.5"><Badge>Class {site.classLocation}</Badge><Badge>{site.hca ? 'HCA' : 'Not HCA'}</Badge></dd>
        </div>
      </dl>
      {draft && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <Input aria-label="Reason for change" placeholder="Reason for change (required), e.g. geotech report found rock" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted tabular-nums">{changed.length} changed</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setDraft(null); setReason('') }}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={!changed.length || !reason.trim()} onClick={save}>Save</Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-faint">Drivers are physical, legal or logistical only. Community, income or other demographic attributes are never cost drivers.</p>
    </Panel>
  )
}
