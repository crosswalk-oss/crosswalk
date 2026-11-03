// Project information record (PI-*): scope statement, key facts, team, milestones, custom fields,
// decision and outreach logs, documents, lessons, and the generated monthly status report (PI-04).
import { useRef, useState } from 'react'
import { mutate, personName, useMe, useStore } from '@/core/store'
import type { DecisionLogEntry, OutreachEntry, Project, ScopeStatement, TeamPosition } from '@/core/types'
import { templateFor } from '@/core/engine/gates'
import { projectHref } from '@/core/router'
import { daysBetween, fmtDate, fmtDateTime, money, uid, cx } from '@/core/util'
import { ask, aiMessage, useAiAvailable } from '@/core/ai'
import { htmlDoc, saveFile } from '@/core/download'
import { AiTag, Avatar, Badge, Button, Callout, Empty, Field, Input, KV, Mono, Panel, Select, StatusBadge, Tabs, TextArea, Table } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { PersonSelect } from '../../shared/pickers'
import { CapitalSplitEditor, QuantityEditor, ScopeListEditor, scopeProblems } from './finance/ScopeEditor'
import { statusFacts, statusPrompt, statusReportHtml } from '../../portfolio/reports'

const POS_LABEL: Record<TeamPosition, string> = {
  sponsor: 'Sponsor', pm: 'Project manager', engineer: 'Project engineer', estimator: 'Estimator', projectControls: 'Project controls', scheduler: 'Scheduler',
  constructionManager: 'Construction manager', safety: 'Safety advisor', environmental: 'Environmental', land: 'Land agent',
}
const ASSET_LABEL: Record<string, string> = { 'transmission-pipeline': 'Transmission pipeline', 'distribution-main': 'Distribution main', 'compressor-station': 'Compressor station', 'valve-site': 'Valve site', 'storage-field': 'Storage field', 'regulator-station': 'Regulator station' }

export default function Overview({ projectId }: { projectId: string }) {
  return <OverviewInner key={projectId} projectId={projectId} />
}

function OverviewInner({ projectId }: { projectId: string }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === projectId)!
  const prog = s.programs.find((x) => x.id === p.programId)!
  const canEdit = me.id === p.team.pm || me.roles.includes('admin') || me.roles.includes('pmo')
  const [logTab, setLogTab] = useState<'decisions' | 'outreach' | 'documents' | 'lessons'>('decisions')
  const decisions = s.decisions.filter((d) => d.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date))
  const outreach = s.outreach.filter((d) => d.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date))
  const docs = s.documents.filter((d) => d.projectId === p.id).sort((a, b) => b.updated.localeCompare(a.updated))
  const lessons = s.lessons.filter((d) => d.projectId === p.id)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ScopePanel p={p} canEdit={canEdit} />
        <Panel title="Key facts" subtitle={<span>Project information record · <Mono>PI-{p.code.slice(4)}</Mono></span>} actions={<a href={projectHref(p.id, 'finance')} className="text-[12px] font-semibold text-link hover:underline">Financial accounts →</a>}>
          <KV cols={2} items={[
            ['Driver', p.driver], ['Regulatory citation', p.regulatoryCitation],
            ['Recovery mechanism', prog.recovery], ['Funding proceeding', p.fundingProceeding],
            ['Asset', ASSET_LABEL[p.asset.type] ?? p.asset.type], ['Line / facility', <Mono key="l">{p.asset.lineId}</Mono>],
            ['Diameter', p.asset.diameterIn ? `${p.asset.diameterIn} in` : '—'], ['Length', p.asset.lengthFt ? `${p.asset.lengthFt.toLocaleString()} ft (${(p.asset.lengthFt / 5280).toFixed(2)} mi)` : '—'],
            ['MAOP', `${p.asset.maopPsig.toLocaleString()} psig`], ['Material · vintage', `${p.asset.material} · ${p.asset.vintage}`],
            ['Records status', <RecordsBadge key="r" v={p.asset.recordsStatus} />], ['Class location', `Class ${p.location.classLocation}`],
            ['HCA', p.location.hca ? <Badge key="h" tone="warn">In HCA</Badge> : 'No'], ['Disadvantaged community', p.location.dac ? <Badge key="d" tone="info">DAC</Badge> : 'No'],
            ['Terrain', p.location.terrain[0].toUpperCase() + p.location.terrain.slice(1)], ['Location', `${p.location.city}, ${p.location.county}`],
            ['ERP WBS', <Mono key="w">{p.erpWbs}</Mono>], ['Schedule ID', <Mono key="sc">{p.scheduleId}</Mono>],
            ['WOA', (p.finance?.woa || p.info?.workOrder) ? <Mono key="woa">{p.finance?.woa || p.info?.workOrder}</Mono> : <span key="woa" className="text-faint">Not issued</span>],
            ['Internal orders', p.finance?.ios.length ? <span key="io" className="flex flex-col gap-0.5">{p.finance.ios.map((io) => <span key={io.id} className="flex flex-wrap items-center gap-1.5"><Mono>{io.number}</Mono><span className="text-[12px] text-muted">{io.type === 'capital' ? 'Capital' : 'O&M'}</span>{io.status !== 'open' && <StatusBadge status={io.status} />}</span>)}</span> : <span key="io" className="text-faint">None yet</span>],
            ['GIS segments', <span key="g" className="flex flex-wrap gap-1">{p.gisIds.map((g) => <Mono key={g} className="rounded bg-sunken px-1">{g}</Mono>)}</span>], ['Contractor', p.contractor ?? 'Not yet awarded'],
          ]} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <MilestonePanel p={p} />
        <div className="flex flex-col gap-4">
          <TeamPanel p={p} canEdit={canEdit} />
          <CustomFieldsPanel p={p} canEdit={canEdit} />
        </div>
      </div>

      <StatusReportPanel p={p} canEdit={canEdit} />

      <Panel pad={false}>
        <Tabs className="px-2" value={logTab} onChange={setLogTab} tabs={[
          { id: 'decisions', label: 'Decision log', count: decisions.length },
          { id: 'outreach', label: 'Outreach log', count: outreach.length },
          { id: 'documents', label: 'Documents', count: docs.length },
          { id: 'lessons', label: 'Lessons', count: lessons.length },
        ]} />
        <div className="p-4">
          {logTab === 'decisions' && <DecisionLog p={p} rows={decisions} canEdit={canEdit} />}
          {logTab === 'outreach' && <OutreachLog p={p} rows={outreach} canEdit={canEdit} />}
          {logTab === 'documents' && <Documents p={p} rows={docs} />}
          {logTab === 'lessons' && <Lessons p={p} />}
        </div>
      </Panel>
    </div>
  )
}

function RecordsBadge({ v }: { v: Project['asset']['recordsStatus'] }) {
  return v === 'complete' ? <Badge tone="good">Traceable, verifiable, complete</Badge> : v === 'gaps' ? <Badge tone="warn">Gaps identified</Badge> : <Badge tone="bad">Unknown</Badge>
}

// ───────────────────────────── Scope
function ScopePanel({ p, canEdit }: { p: Project; canEdit: boolean }) {
  const [edit, setEdit] = useState<ScopeStatement | null>(null)
  const lastEdit = useStore((s) => s.audit.filter((a) => a.projectId === p.id && a.entity === 'scope').pop())
  const people = useStore((s) => s.people)
  const qTypes = useStore((s) => s.settings.estimating.quantityTypes)
  const lib = useStore((s) => s.settings.estimating.scopeLibrary)
  const save = () => {
    if (!edit) return
    const clean: ScopeStatement = {
      summary: edit.summary.trim(),
      inScope: edit.inScope.map((x) => x.trim()).filter(Boolean),
      outOfScope: edit.outOfScope.map((x) => x.trim()).filter(Boolean),
      assumptions: edit.assumptions.map((x) => x.trim()).filter(Boolean),
      quantities: edit.quantities.map((q) => { const t = qTypes.find((x) => x.id === q.typeId); return t ? { ...q, label: t.label, unit: t.unit } : q }),
      capitalPct: edit.capitalPct,
    }
    const problems = scopeProblems(clean, qTypes.map((t) => t.id))
    if (problems.length) { toast(problems[0], 'bad'); return }
    const diffs: string[] = []
    if (clean.summary !== p.scope.summary) diffs.push('summary')
    const added = clean.inScope.filter((x) => !p.scope.inScope.includes(x)), removed = p.scope.inScope.filter((x) => !clean.inScope.includes(x))
    if (added.length) diffs.push(`added in-scope "${added.join('", "')}"`)
    if (removed.length) diffs.push(`removed in-scope "${removed.join('", "')}"`)
    for (const q of clean.quantities) { const o = p.scope.quantities.find((x) => x.label === q.label); if (!o) diffs.push(`added quantity ${q.label}`); else if (o.qty !== q.qty) diffs.push(`${q.label} ${o.qty.toLocaleString()} → ${q.qty.toLocaleString()} ${q.unit}`) }
    if (JSON.stringify(clean.outOfScope) !== JSON.stringify(p.scope.outOfScope)) diffs.push('out-of-scope list')
    if (JSON.stringify(clean.assumptions) !== JSON.stringify(p.scope.assumptions)) diffs.push('assumptions')
    for (const q of p.scope.quantities) if (!clean.quantities.some((x) => x.label === q.label)) diffs.push(`removed quantity ${q.label}`)
    if (clean.capitalPct !== p.scope.capitalPct) diffs.push(`capital ${p.scope.capitalPct ?? '—'}% → ${clean.capitalPct ?? '—'}% (O&M ${clean.capitalPct === undefined ? '—' : Math.round((100 - clean.capitalPct) * 10) / 10}%)`)
    if (!diffs.length) { setEdit(null); return }
    mutate((d) => { d.projects.find((x) => x.id === p.id)!.scope = clean }, { entity: 'scope', entityId: p.id, projectId: p.id, action: 'edit', summary: `Scope statement edited: ${diffs.join('; ')}` })
    toast('Scope statement saved')
    setEdit(null)
  }
  const hasControl = useStore((s) => s.budgets.some((b) => b.projectId === p.id && b.kind === 'control'))
  if (edit) {
    return (
      <Panel title="Edit scope statement" actions={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save scope</Button></>}>
        <div className="flex flex-col gap-3">
          {hasControl && <Callout tone="warn" title="This project has a control budget">Scope changes that affect cost or schedule must go through a change request so the Current baseline moves with an approved decision. Use this edit for clarifications.</Callout>}
          <Field label="Summary"><TextArea id="scope-summary" className="min-h-[70px]" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} /></Field>
          <p className="text-[12px] text-muted">Pick items from the estimating team's scope library so estimates read them consistently; your own wording is allowed and is outlined for the estimator.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ScopeListEditor k="inScope" label="In scope" items={edit.inScope} onChange={(v) => setEdit({ ...edit, inScope: v })} />
            <ScopeListEditor k="outOfScope" label="Out of scope" items={edit.outOfScope} onChange={(v) => setEdit({ ...edit, outOfScope: v })} />
            <ScopeListEditor k="assumptions" label="Assumptions" items={edit.assumptions} onChange={(v) => setEdit({ ...edit, assumptions: v })} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <QuantityEditor quantities={edit.quantities} onChange={(q) => setEdit({ ...edit, quantities: q })} />
            <div>
              <div className="mb-1 text-[12px] font-semibold text-muted">Capital / O&M split</div>
              <CapitalSplitEditor value={edit.capitalPct} onChange={(v) => setEdit({ ...edit, capitalPct: v })} />
              <p className="mt-1 text-[11px] text-faint">Placeholder until internal orders exist; the Finance tab compares it with what the IOs carry.</p>
            </div>
          </div>
        </div>
      </Panel>
    )
  }
  return (
    <Panel title="Scope statement" subtitle={lastEdit ? `Last edited ${fmtDateTime(lastEdit.at)} by ${personName({ people }, lastEdit.actorId)}` : 'As chartered'}
      actions={canEdit ? <Button size="sm" onClick={() => setEdit(JSON.parse(JSON.stringify(p.scope)))}>Edit scope</Button> : <span className="text-xs text-faint">Editable by the PM</span>}>
      <p className="text-[14px] leading-relaxed">{p.scope.summary}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <ScopeList title="In scope" items={p.scope.inScope} lib={lib.inScope} mark="✓" tone="text-good" />
        <ScopeList title="Out of scope" items={p.scope.outOfScope} lib={lib.outOfScope} mark="✕" tone="text-faint" />
        <ScopeList title="Assumptions" items={p.scope.assumptions} lib={lib.assumptions} mark="•" tone="text-muted" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {p.scope.quantities.map((q) => (
          <div key={q.label} className="rounded border border-line bg-sunken/50 px-3 py-1.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{q.label}</div>
            <div className="font-display text-[17px] font-bold tabular-nums">{q.qty.toLocaleString()} <span className="text-[12px] font-semibold text-muted">{q.unit}</span></div>
          </div>
        ))}
        {p.scope.capitalPct !== undefined && (
          <div className="min-w-[150px] rounded border border-line bg-sunken/50 px-3 py-1.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Capital / O&M</div>
            <div className="font-display text-[17px] font-bold tabular-nums">{p.scope.capitalPct}% <span className="text-[12px] font-semibold text-muted">/ {Math.round((100 - p.scope.capitalPct) * 10) / 10}%</span></div>
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-line"><span className="bg-ink" style={{ width: `${p.scope.capitalPct}%` }} /></div>
          </div>
        )}
      </div>
    </Panel>
  )
}
function ScopeList({ title, items, lib, mark, tone }: { title: string; items: string[]; lib: string[]; mark: string; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1">{title}</div>
      {items.length ? <ul className="flex flex-col gap-1 text-[13px]">{items.map((x) => <li key={x} className="flex gap-1.5"><span className={cx('shrink-0 font-bold', tone)}>{mark}</span><span>{x}{!lib.includes(x) && <span className="ml-1.5 rounded-sm border border-info/40 px-1 align-middle text-[9.5px] font-semibold uppercase tracking-wide text-info" title="Free text, not from the scope library">custom</span>}</span></li>)}</ul> : <span className="text-[13px] text-faint">None stated</span>}
    </div>
  )
}

// ───────────────────────────── Milestones
function MilestonePanel({ p }: { p: Project }) {
  const asOf = useStore((s) => s.settings.asOf)
  const span = p.milestones.flatMap((m) => [m.baseline, m.forecast, m.actual].filter(Boolean) as string[]).sort()
  const lo = span[0], hi = span[span.length - 1]
  const total = Math.max(1, daysBetween(lo, hi))
  const X = (d: string) => `${(daysBetween(lo, d) / total) * 100}%`
  return (
    <Panel title="Milestones" subtitle="Baseline vs forecast vs actual. Forecast moves only through approved changes or the monthly forecast.">
      <div className="relative mb-4 h-9 rounded bg-sunken/60">
        {asOf >= lo && asOf <= hi && <div className="absolute inset-y-0 w-px bg-marker" style={{ left: X(asOf) }}><span className="absolute -top-0.5 left-1 text-[10px] font-semibold text-ink">Today</span></div>}
        {p.milestones.map((m) => {
          const slip = daysBetween(m.baseline, m.actual ?? m.forecast)
          return (
            <div key={m.id} title={`${m.name}: baseline ${m.baseline}, ${m.actual ? 'actual ' + m.actual : 'forecast ' + m.forecast}`}>
              <span className="absolute top-2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-faint bg-surface" style={{ left: X(m.baseline) }} />
              {slip !== 0 && <span className={cx('absolute top-[13px] h-0.5', slip > 0 ? 'bg-bad/50' : 'bg-good/50')} style={{ left: slip > 0 ? X(m.baseline) : X(m.actual ?? m.forecast), width: `${(Math.abs(slip) / total) * 100}%` }} />}
              <span className={cx('absolute top-2 h-2.5 w-2.5 -translate-x-1/2 rotate-45', m.actual ? 'bg-good' : slip > 30 ? 'bg-bad' : slip > 0 ? 'bg-warn' : 'bg-ink')} style={{ left: X(m.actual ?? m.forecast) }} />
            </div>
          )
        })}
        <span className="absolute bottom-0.5 left-1 text-[10px] text-faint">{fmtDate(lo)}</span>
        <span className="absolute bottom-0.5 right-1 text-[10px] text-faint">{fmtDate(hi)}</span>
      </div>
      <Table rows={p.milestones} rowKey={(m) => m.id} columns={[
        { key: 'n', header: 'Milestone', render: (m) => <span className="font-semibold">{m.name}</span> },
        { key: 'b', header: 'Baseline', render: (m) => <span className="tabular-nums">{fmtDate(m.baseline)}</span> },
        { key: 'f', header: 'Forecast', render: (m) => <span className="tabular-nums">{m.actual ? <span className="text-faint">—</span> : fmtDate(m.forecast)}</span> },
        { key: 'a', header: 'Actual', render: (m) => <span className="tabular-nums">{m.actual ? fmtDate(m.actual) : '—'}</span> },
        { key: 's', header: 'Slip', num: true, render: (m) => { const d = daysBetween(m.baseline, m.actual ?? m.forecast); return <span className={cx('font-semibold', d > 30 ? 'text-bad' : d > 0 ? 'text-warn' : d < 0 ? 'text-good' : 'text-faint')}>{d > 0 ? `+${d}` : d}d</span> } },
        { key: 'st', header: 'Status', render: (m) => {
          if (m.actual) return <Badge tone="good">Complete</Badge>
          const d = daysBetween(m.baseline, m.forecast)
          if (m.forecast < asOf) return <Badge tone="bad">Overdue</Badge>
          if (d > 30) return <Badge tone="bad">Late</Badge>
          if (d > 0) return <Badge tone="warn">At risk</Badge>
          return <Badge tone="neutral">On plan</Badge>
        } },
      ]} />
    </Panel>
  )
}

// ───────────────────────────── Team
function TeamPanel({ p, canEdit }: { p: Project; canEdit: boolean }) {
  const s = useStore()
  const [editing, setEditing] = useState<TeamPosition | null>(null)
  const [val, setVal] = useState('')
  const roleFor: Record<TeamPosition, Parameters<typeof PersonSelect>[0]['role']> = { sponsor: 'sponsor', pm: 'pm', engineer: 'engineer', estimator: 'estimator', projectControls: 'project-controls', scheduler: 'scheduler', constructionManager: 'construction-manager', safety: 'safety-advisor', environmental: 'environmental', land: 'land' }
  const save = (pos: TeamPosition) => {
    const from = personName(s, p.team[pos])
    mutate((d) => { d.projects.find((x) => x.id === p.id)!.team[pos] = val || undefined }, { entity: 'project', entityId: p.id, projectId: p.id, action: 'team', summary: `${POS_LABEL[pos]}: ${from} → ${personName(s, val)}` })
    toast(`${POS_LABEL[pos]} updated`)
    setEditing(null)
  }
  return (
    <Panel title="Team" subtitle="Positions route workflow steps and own deliverables" pad={false}>
      <ul className="divide-y divide-line">
        {(Object.keys(POS_LABEL) as TeamPosition[]).map((pos) => {
          const person = s.people.find((x) => x.id === p.team[pos])
          return (
            <li key={pos} className="flex items-center gap-2.5 px-4 py-1.5">
              {editing === pos ? (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <span className="w-28 shrink-0 text-[12px] text-muted">{POS_LABEL[pos]}</span>
                  <div className="min-w-[160px] flex-1"><PersonSelect id={`team-${pos}`} role={roleFor[pos]} includeEmpty value={val} onChange={setVal} /></div>
                  <Button size="sm" variant="primary" onClick={() => save(pos)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              ) : (
                <>
                  {person ? <Avatar name={person.name} size={26} /> : <span className="h-[26px] w-[26px] shrink-0 rounded-full border border-dashed border-line" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{person?.name ?? <span className="font-normal text-faint">Unassigned</span>}</div>
                    <div className="truncate text-[11px] text-muted">{POS_LABEL[pos]}{person ? ` · ${person.title}` : ''}{person?.outOfOffice && s.settings.asOf >= person.outOfOffice.from && s.settings.asOf <= person.outOfOffice.to ? ' · out of office' : ''}</div>
                  </div>
                  {person && person.dollarAuthority > 0 && <span className="hidden text-[11px] tabular-nums text-faint sm:inline" title="Dollar authority under the DOA matrix">DOA {money(person.dollarAuthority)}</span>}
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => { setEditing(pos); setVal(p.team[pos] ?? '') }}>Change</Button>}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// ───────────────────────────── Custom fields
function CustomFieldsPanel({ p, canEdit }: { p: Project; canEdit: boolean }) {
  const defs = useStore((s) => s.settings.fieldDefs.filter((d) => d.programIds.includes(p.programId)))
  const tpl = useStore((s) => templateFor(s, p))
  const [vals, setVals] = useState<Record<string, string> | null>(null)
  if (!defs.length) return null
  const save = () => {
    const changed = defs.filter((d) => (vals![d.key] ?? '') !== (p.customFields[d.key] ?? ''))
    if (changed.length) {
      mutate((d) => { const x = d.projects.find((y) => y.id === p.id)!; for (const c of changed) x.customFields[c.key] = vals![c.key] ?? '' }, { entity: 'project', entityId: p.id, projectId: p.id, action: 'fields', summary: `Updated ${changed.map((c) => `${c.label} → "${vals![c.key]}"`).join(', ')}` })
      toast('Fields saved')
    }
    setVals(null)
  }
  return (
    <Panel title="Program fields" subtitle="Configured in settings for this program" actions={canEdit && !vals ? <Button size="sm" variant="ghost" onClick={() => setVals({ ...p.customFields })}>Edit</Button> : vals ? <><Button size="sm" variant="ghost" onClick={() => setVals(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save</Button></> : undefined}>
      <div className="flex flex-col gap-2.5">
        {defs.map((d) => {
          const v = (vals ?? p.customFields)[d.key]
          const required = d.requiredAtStage !== undefined
          const due = required && p.stageIndex >= d.requiredAtStage!
          const missing = due && !v?.trim()
          return (
            <div key={d.key} className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
                {d.label}
                {required && <Badge tone={missing ? 'bad' : due ? 'good' : 'neutral'}>{missing ? 'Required now' : `Required at ${tpl.stages[d.requiredAtStage!]?.name ?? 'stage ' + (d.requiredAtStage! + 1)}`}</Badge>}
              </div>
              {vals ? <Input id={`cf-${d.key}`} className="mt-1" value={vals[d.key] ?? ''} onChange={(e) => setVals({ ...vals, [d.key]: e.target.value })} /> : <div className={cx('mt-0.5 text-[13px]', !v && 'text-faint')}>{v ? <Mono>{v}</Mono> : 'Not entered'}</div>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ───────────────────────────── Monthly status report (PI-04)
function StatusReportPanel({ p, canEdit }: { p: Project; canEdit: boolean }) {
  const s = useStore()
  const ai = useAiAvailable()
  const [text, setText] = useState(p.lastStatusNote ?? '')
  const [aiDraft, setAiDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const ctl = useRef<AbortController | null>(null)
  const f = statusFacts(s, p)
  const dirty = text !== (p.lastStatusNote ?? '')
  const draft = async () => {
    setBusy(true); setText('Thinking…')
    ctl.current = new AbortController()
    try {
      const out = await ask(statusPrompt(s, p), { onText: setText, signal: ctl.current.signal })
      setText(out.trim()); setAiDraft(true)
    } catch (e) { setText(p.lastStatusNote ?? ''); toast(aiMessage(e), 'bad') } finally { setBusy(false) }
  }
  const save = () => {
    mutate((d) => { d.projects.find((x) => x.id === p.id)!.lastStatusNote = text.trim() }, { entity: 'status-report', entityId: p.id, projectId: p.id, action: 'narrative', summary: `PM narrative saved for ${f.month}${aiDraft ? ' (AI draft accepted and edited by author)' : ''}` })
    setAiDraft(false)
    toast('Narrative saved to the status report')
  }
  const download = async () => {
    const r = await saveFile(`${p.code}-status-${f.month}.html`, htmlDoc(`${p.code} status report ${f.month}`, statusReportHtml(s, p, text === 'Thinking…' ? '' : text)), 'text/html')
    if (r === 'saved') { toast('Status report downloaded'); mutate(() => {}, { entity: 'status-report', entityId: p.id, projectId: p.id, action: 'export', summary: `Monthly status report ${f.month} exported` }) }
  }
  const tiles: [string, string, string?][] = [
    ['Budget', money(f.pos.currentBudget)], ['EAC', money(f.pos.eac), f.pos.eac > f.pos.currentBudget && f.pos.currentBudget ? 'text-bad' : undefined], ['Actual to date', money(f.pos.actualToDate)],
    ['CPI', f.cpi ? f.cpi.toFixed(2) : '—', f.cpi && f.cpi < 0.95 ? 'text-bad' : undefined], ['SPI', f.spi ? f.spi.toFixed(2) : '—', f.spi && f.spi < 0.95 ? 'text-warn' : undefined], ['Gate readiness', `${f.r.pct}%`],
  ]
  return (
    <Panel title={<span className="flex items-center gap-2">Monthly status report <Badge>{f.month}</Badge>{aiDraft && <AiTag />}</span>}
      subtitle="Composed from the project's records plus the PM narrative. Download it to send or file with the period close."
      actions={<>
        {ai !== false && canEdit && <Button size="sm" disabled={busy || ai === null} onClick={draft} icon={<span aria-hidden>✦</span>}>{busy ? 'Thinking…' : 'AI draft'}</Button>}
        {busy && <Button size="sm" variant="ghost" onClick={() => ctl.current?.abort()}>Stop</Button>}
        <Button size="sm" icon={<Icon name="download" className="h-3.5 w-3.5" />} onClick={download}>Download HTML</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {tiles.map(([k, v, t]) => <div key={k} className="rounded border border-line px-2.5 py-1.5"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className={cx('font-display text-[17px] font-bold tabular-nums', t)}>{v}</div></div>)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            <span>Next: <b className="text-ink">{f.next ? `${f.next.name} · ${fmtDate(f.next.forecast)}` : '—'}</b></span>
            <span>Changes this period: <b className="text-ink">{f.changes.length}</b></span>
            <span>Tailboards 30d: <b className="text-ink">{f.tbs.length}</b></span>
            <span>Open variances: <b className={f.variances.length ? 'text-warn' : 'text-ink'}>{f.variances.length}</b></span>
          </div>
          {f.r.blockers.length > 0 && <Callout tone="warn" title="Gate blockers that will appear in the report">{f.r.blockers.map((b) => <div key={b}>• {b}</div>)}</Callout>}
        </div>
        <div className="flex flex-col gap-2">
          <Field label="PM narrative" hint={aiDraft ? 'AI draft — review every sentence against the records before saving. Saving records you as the author.' : 'Progress, cost and schedule drivers, look-ahead and decisions needed.'}>
            <TextArea id="status-narrative" className={cx('min-h-[170px] leading-relaxed', aiDraft && 'border-info/60')} value={text} disabled={!canEdit || busy} onChange={(e) => setText(e.target.value)} placeholder="We completed…" />
          </Field>
          {canEdit && <div className="flex flex-wrap justify-end gap-2">
            {dirty && <Button size="sm" variant="ghost" onClick={() => { setText(p.lastStatusNote ?? ''); setAiDraft(false) }}>Discard</Button>}
            <Button size="sm" variant="primary" disabled={!dirty || busy || !text.trim()} onClick={save}>{aiDraft ? 'Accept & save narrative' : 'Save narrative'}</Button>
          </div>}
        </div>
      </div>
    </Panel>
  )
}

// ───────────────────────────── Logs
function DecisionLog({ p, rows, canEdit }: { p: Project; rows: DecisionLogEntry[]; canEdit: boolean }) {
  const s = useStore()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ decision: '', alternatives: '', evidence: '', byId: p.team.sponsor ?? s.currentUserId, date: s.settings.asOf })
  const add = () => {
    if (!f.decision.trim()) { toast('Describe the decision', 'bad'); return }
    const id = uid('dec')
    mutate((d) => { d.decisions.push({ id, projectId: p.id, ...f, decision: f.decision.trim() }) }, { entity: 'decision', entityId: id, projectId: p.id, action: 'create', summary: `Decision logged: ${f.decision.trim()}` })
    toast('Decision logged')
    setOpen(false); setF({ ...f, decision: '', alternatives: '', evidence: '' })
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Decisions that shaped scope, method or route, with the alternatives considered and the evidence relied on.</p>
        {canEdit && !open && <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Log decision</Button>}
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-sunken/40 p-3 md:grid-cols-2">
          <Field label="Decision" className="md:col-span-2"><TextArea id="dec-text" value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} placeholder="Drill under the wash instead of open-cut crossing" /></Field>
          <Field label="Alternatives considered"><TextArea id="dec-alt" value={f.alternatives} onChange={(e) => setF({ ...f, alternatives: e.target.value })} /></Field>
          <Field label="Evidence"><TextArea id="dec-ev" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="Option analysis memo rev B" /></Field>
          <Field label="Decided by"><PersonSelect id="dec-by" value={f.byId} onChange={(v) => setF({ ...f, byId: v })} /></Field>
          <Field label="Date"><Input id="dec-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 md:col-span-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={add}>Add to log</Button></div>
        </div>
      )}
      <Table rows={rows} rowKey={(r) => r.id} empty={<Empty title="No decisions logged" />} columns={[
        { key: 'd', header: 'Date', sort: (r) => r.date, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</span> },
        { key: 'x', header: 'Decision', render: (r) => <span className="font-semibold">{r.decision}</span> },
        { key: 'a', header: 'Alternatives', render: (r) => <span className="text-muted">{r.alternatives || '—'}</span> },
        { key: 'e', header: 'Evidence', render: (r) => r.evidence ? <span className="inline-flex items-center gap-1"><Icon name="doc" className="h-3.5 w-3.5 text-faint" />{r.evidence}</span> : '—' },
        { key: 'b', header: 'By', render: (r) => <span className="whitespace-nowrap">{personName(s, r.byId)}</span> },
      ]} />
    </div>
  )
}

function OutreachLog({ p, rows, canEdit }: { p: Project; rows: OutreachEntry[]; canEdit: boolean }) {
  const s = useStore()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<Omit<OutreachEntry, 'id' | 'projectId'>>({ date: s.settings.asOf, type: 'Notification', stakeholder: '', summary: '', status: 'open' })
  const add = () => {
    if (!f.stakeholder.trim() || !f.summary.trim()) { toast('Add the stakeholder and a summary', 'bad'); return }
    const id = uid('out')
    mutate((d) => { d.outreach.push({ id, projectId: p.id, ...f }) }, { entity: 'outreach', entityId: id, projectId: p.id, action: 'create', summary: `${f.type} logged with ${f.stakeholder}: ${f.summary}` })
    toast('Outreach entry added'); setOpen(false); setF({ ...f, stakeholder: '', summary: '' })
  }
  const toggle = (r: OutreachEntry) => {
    const next = r.status === 'open' ? 'closed' : 'open'
    mutate((d) => { d.outreach.find((x) => x.id === r.id)!.status = next }, { entity: 'outreach', entityId: r.id, projectId: p.id, action: next, summary: `${r.type} with ${r.stakeholder} marked ${next}` })
    toast(next === 'closed' ? 'Marked closed' : 'Reopened')
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Notifications, meetings, complaints and commitments to the public and agencies. Open commitments carry into closeout.</p>
        {canEdit && !open && <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Add entry</Button>}
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-sunken/40 p-3 md:grid-cols-3">
          <Field label="Type"><Select id="out-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as OutreachEntry['type'] })} options={['Notification', 'Meeting', 'Complaint', 'Commitment']} /></Field>
          <Field label="Stakeholder"><Input id="out-st" value={f.stakeholder} onChange={(e) => setF({ ...f, stakeholder: e.target.value })} placeholder={`${p.location.city} Public Works`} /></Field>
          <Field label="Date"><Input id="out-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Summary" className="md:col-span-3"><TextArea id="out-sum" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 md:col-span-3"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={add}>Add to log</Button></div>
        </div>
      )}
      <Table rows={rows} rowKey={(r) => r.id} empty={<Empty title="No outreach logged" />} columns={[
        { key: 'd', header: 'Date', sort: (r) => r.date, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</span> },
        { key: 't', header: 'Type', render: (r) => <Badge tone={r.type === 'Complaint' ? 'bad' : r.type === 'Commitment' ? 'marker' : 'neutral'}>{r.type}</Badge> },
        { key: 's', header: 'Stakeholder', render: (r) => <span className="font-semibold">{r.stakeholder}</span> },
        { key: 'x', header: 'Summary', render: (r) => r.summary },
        { key: 'st', header: 'Status', render: (r) => <span className="flex items-center gap-2"><StatusBadge status={r.status} />{canEdit && <button className="text-[11px] font-semibold text-link hover:underline" onClick={() => toggle(r)}>{r.status === 'open' ? 'Close' : 'Reopen'}</button>}</span> },
      ]} />
    </div>
  )
}

function Documents({ p, rows }: { p: Project; rows: ReturnType<typeof useStore.getState>['documents'] }) {
  const s = useStore()
  const input = useRef<HTMLInputElement>(null)
  const onFile = (files: FileList | null) => {
    if (!files?.length) return
    const names: string[] = []
    mutate((d) => {
      for (const file of Array.from(files)) {
        const existing = d.documents.find((x) => x.projectId === p.id && x.name === file.name)
        if (existing) { existing.version += 1; existing.updated = d.settings.asOf; existing.byId = d.currentUserId; existing.sizeKb = Math.max(1, Math.round(file.size / 1024)); names.push(`${file.name} v${existing.version}`) }
        else { d.documents.push({ id: uid('doc'), projectId: p.id, name: file.name, type: (file.name.split('.').pop() ?? 'file').toUpperCase(), version: 1, updated: d.settings.asOf, byId: d.currentUserId, sizeKb: Math.max(1, Math.round(file.size / 1024)) }); names.push(file.name) }
      }
    }, { entity: 'document', entityId: p.id, projectId: p.id, action: 'upload', summary: `Uploaded ${files.length} document(s)` })
    toast(files.length === 1 ? `Added ${names[0]}` : `Added ${files.length} documents`)
    if (input.current) input.current.value = ''
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Controlled project documents. Uploading a file with the same name creates a new version; the register keeps who and when.</p>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => onFile(e.target.files)} />
        <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>Upload document</Button>
      </div>
      <Table rows={rows} rowKey={(r) => r.id} empty={<Empty title="No documents" />} columns={[
        { key: 'n', header: 'Document', sort: (r) => r.name, render: (r) => <span className="inline-flex items-center gap-1.5 font-semibold"><Icon name="doc" className="h-4 w-4 text-faint" />{r.name}</span> },
        { key: 't', header: 'Type', render: (r) => <Mono className="text-muted">{r.type}</Mono> },
        { key: 'v', header: 'Version', num: true, sort: (r) => r.version, render: (r) => `v${r.version}` },
        { key: 'u', header: 'Updated', sort: (r) => r.updated, render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.updated)}</span> },
        { key: 'b', header: 'By', render: (r) => personName(s, r.byId) },
        { key: 'sz', header: 'Size', num: true, sort: (r) => r.sizeKb, render: (r) => r.sizeKb >= 1024 ? `${(r.sizeKb / 1024).toFixed(1)} MB` : `${r.sizeKb} KB` },
      ]} />
    </div>
  )
}

function Lessons({ p }: { p: Project }) {
  const s = useStore()
  const mine = s.lessons.filter((l) => l.projectId === p.id)
  const related = s.lessons.filter((l) => l.projectId !== p.id && l.workMethods.includes(p.workMethod)).slice(0, 6)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', category: 'Construction', text: '' })
  const add = () => {
    if (!f.title.trim()) { toast('Give the lesson a title', 'bad'); return }
    const id = uid('les')
    mutate((d) => { d.lessons.push({ id, projectId: p.id, date: d.settings.asOf, title: f.title.trim(), category: f.category, text: f.text.trim(), workMethods: [p.workMethod] }) }, { entity: 'lesson', entityId: id, projectId: p.id, action: 'create', summary: `Lesson captured: ${f.title.trim()}` })
    toast('Lesson captured'); setOpen(false); setF({ title: '', category: 'Construction', text: '' })
  }
  const Card = ({ l, other }: { l: (typeof s.lessons)[number]; other?: boolean }) => (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted"><Badge>{l.category}</Badge><span>{fmtDate(l.date)}</span>{other && <a className="font-mono font-semibold text-link hover:underline" href={`#p-${l.projectId.replace(/\D/g, '')}`}>{s.projects.find((x) => x.id === l.projectId)?.code}</a>}</div>
      <div className="mt-1 text-[13px] font-semibold">{l.title}</div>
      {l.text && <p className="text-[12px] text-muted">{l.text}</p>}
    </div>
  )
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><h3 className="eyebrow">This project</h3>{!open && <Button size="sm" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Capture lesson</Button>}</div>
        {open && (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken/40 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
              <Field label="Lesson"><Input id="les-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Pothole every foreign crossing before Class 3" /></Field>
              <Field label="Category"><Select id="les-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={['Estimating', 'Permitting', 'Scheduling', 'Procurement', 'Construction', 'Safety', 'Records']} /></Field>
            </div>
            <Field label="What happened and what to do next time"><TextArea id="les-text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={add}>Save lesson</Button></div>
          </div>
        )}
        {mine.length ? mine.map((l) => <Card key={l.id} l={l} />) : !open && <Empty title="No lessons yet">Lessons captured here are tagged by work method and offered to similar projects.</Empty>}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="eyebrow">From similar work</h3>
        {related.length ? related.map((l) => <Card key={l.id} l={l} other />) : <span className="text-[13px] text-faint">No lessons from projects with the same work method yet.</span>}
      </div>
    </div>
  )
}
