// Project Information record (PI-*): the controlled project data sheet. Every edit is a numbered
// revision with a reason, field-level from → to, and an audit entry; the record can be viewed as it
// stood at any revision and exported as a formal data sheet. Overview stays the summary page.
import { useMemo, useState } from 'react'
import { getState, mutate, useMe, useStore } from '@/core/store'
import type { AppState, InfoFieldDef, Project } from '@/core/types'
import { infoCompleteness, missingInfo, reviseInfo } from '@/core/engine/info'
import { templateFor } from '@/core/engine/gates'
import { deliverableCompleteness } from '@/core/engine/finance'
import { projectHref } from '@/core/router'
import { htmlDoc, saveFile } from '@/core/download'
import { askJSON, aiMessage, useAiAvailable } from '@/core/ai'
import { cx, fmtDate, fmtDateTime } from '@/core/util'
import { AiTag, Avatar, Badge, Button, Callout, Modal, Panel, Progress, Select, TextArea } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { FieldInput } from './info/FieldInput'
import { RevisionHistory } from './info/RevisionHistory'
import { CostDrivers } from './info/CostDrivers'
import {
  changedKeys, cleanProposals, currentGateName, currentValues, displayValue, draftPrompt, gateShort, infoCsv, infoSheetHtml,
  infoText, requirement, revisionsFor, sectionsOf, valuesAsOf, type DraftProposal,
} from './info/lib'

export default function ProjectInfo({ projectId }: { projectId: string }) {
  return <ProjectInfoInner key={projectId} projectId={projectId} />
}

const fieldAnchor = (key: string) => `pi-field-${key}`
function jumpTo(key: string) {
  const el = document.getElementById(fieldAnchor(key))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-marker')
  setTimeout(() => el.classList.remove('ring-2', 'ring-marker'), 1600)
}

function ProjectInfoInner({ projectId }: { projectId: string }) {
  const s = useStore()
  const me = useMe()
  const p = s.projects.find((x) => x.id === projectId)!
  const tpl = templateFor(s, p)
  const revs = useMemo(() => revisionsFor(s, p.id), [s.infoRevisions, p.id])
  const current = useMemo(() => currentValues(s, p), [s, p])
  const sections = sectionsOf(s)
  const comp = infoCompleteness(s, p)
  const dc = deliverableCompleteness(s, p)
  const missing = missingInfo(s, p)
  const gate = currentGateName(s, p)
  const latest = revs[0]
  const frozen = p.status === 'closed' || p.status === 'cancelled'
  const canEdit = !frozen && (me.roles.includes('admin') || me.roles.includes('pmo') || Object.values(p.team).includes(me.id))

  const [asOfRev, setAsOfRev] = useState<number | null>(null)
  const [editing, setEditing] = useState<string[]>([]) // section names in edit mode
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [aiKeys, setAiKeys] = useState<string[]>([])
  const [textOpen, setTextOpen] = useState(false)

  const viewing = asOfRev !== null
  const values = viewing ? valuesAsOf(current, revs, asOfRev!) : current
  const highlight = viewing ? changedKeys(revs.find((r) => r.rev === asOfRev)) : new Set<string>()
  const editable = s.settings.infoFields.filter((f) => !f.readOnly)
  const edits = Object.fromEntries(editable.filter((f) => f.key in draft && (draft[f.key] ?? '') !== (current[f.key] ?? '')).map((f) => [f.key, draft[f.key]]))
  const changedCount = Object.keys(edits).length
  const isEditing = editing.length > 0

  const startEdit = (secs: string[]) => {
    setAsOfRev(null)
    if (!isEditing) { setDraft({ ...current }); setNote(''); setAiKeys([]) }
    setEditing(Array.from(new Set([...editing, ...secs])))
  }
  const cancel = () => { setEditing([]); setDraft({}); setNote(''); setAiKeys([]) }
  const save = () => {
    if (!note.trim()) { toast('Enter a reason for the change', 'bad'); return }
    if (!changedCount) { toast('No changes to save', 'info'); return }
    let ok = false
    mutate((d) => { ok = !!reviseInfo(d, p.id, edits, note.trim()) })
    if (!ok) { toast('No changes to save', 'info'); return }
    const n = revisionsFor(getState(), p.id)[0]?.rev ?? 0
    cancel()
    toast(`Project information revised (rev ${n})`)
  }

  const exportSheet = async () => {
    const rev = asOfRev ?? latest?.rev ?? 0
    const html = htmlDoc(`${p.code} Project Information Sheet Rev ${rev}`, infoSheetHtml(s, p, { values, asOfRev: rev }))
    const r = await saveFile(`${p.code}-project-information-rev${rev}.html`, html, 'text/html')
    toast(r === 'saved' ? `Project information sheet exported (rev ${rev})` : r === 'declined' ? 'Export cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }
  const exportCsv = async () => {
    const r = await saveFile(`${p.code}-project-information.csv`, infoCsv(s, p, values), 'text/csv')
    toast(r === 'saved' ? 'Project information CSV exported' : r === 'declined' ? 'Export cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }
  const copyText = async () => {
    try { await navigator.clipboard.writeText(infoText(s, p, values)); toast('Project information copied as text') }
    catch { setTextOpen(true) }
  }

  const acceptProposal = (pr: DraftProposal) => {
    const def = s.settings.infoFields.find((f) => f.key === pr.key)
    if (!def) return
    if (!isEditing) setDraft({ ...current, [pr.key]: pr.value })
    else setDraft((d) => ({ ...d, [pr.key]: pr.value }))
    setEditing((e) => Array.from(new Set([...e, def.section])))
    setAsOfRev(null)
    setAiKeys((k) => Array.from(new Set([...k, pr.key])))
  }

  return (
    <div className="flex flex-col gap-4">
      <Header s={s} p={p} comp={comp} dc={dc} missing={missing} gate={gate} latest={latest} revCount={revs.length}
        canEdit={canEdit && !viewing} frozen={frozen} isEditing={isEditing}
        onEdit={() => startEdit(sections.map((x) => x.name))} onSheet={exportSheet} onCsv={exportCsv} onCopy={copyText}
        asOfRev={asOfRev} setAsOfRev={(r) => { if (!isEditing) setAsOfRev(r) }} revs={revs.map((r) => ({ rev: r.rev, at: r.at }))} />

      <LinkedRecords s={s} p={p} />

      {viewing && (
        <Callout tone="marker" title={asOfRev === 0 ? 'Viewing the record before revision 1' : `Viewing revision ${asOfRev} of ${latest?.rev ?? 0}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>{asOfRev === 0 ? 'Values as first recorded, before any tracked revision.' : `The record as it stood after rev ${asOfRev} (${fmtDateTime(revs.find((r) => r.rev === asOfRev)?.at)}). Fields changed in that revision are outlined.`} System fields show current values. Editing is paused while viewing history.</span>
            <Button size="sm" onClick={() => setAsOfRev(null)}>Back to current</Button>
          </div>
        </Callout>
      )}

      {canEdit && !viewing && <AiDraft s={s} p={p} current={current} onAccept={acceptProposal} draft={isEditing ? draft : current} />}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {sections.filter((sec) => sec.fields.length).map((sec) => {
            const secEditing = editing.includes(sec.name)
            const secMissing = sec.fields.filter((f) => requirement(f, values[f.key] ?? '', p.stageIndex) === 'blocking').length
            const filled = sec.fields.filter((f) => !f.readOnly && (values[f.key] ?? '').trim()).length
            const total = sec.fields.filter((f) => !f.readOnly).length
            return (
              <Panel key={sec.name} title={sec.name}
                subtitle={<span className="tabular-nums">{filled}/{total} completed{secMissing ? <span className="ml-2 font-semibold text-bad">{secMissing} required empty</span> : null}</span>}
                actions={canEdit && !viewing && !secEditing && <Button size="sm" variant="ghost" onClick={() => startEdit([sec.name])}>Edit section</Button>}>
                <div className="grid grid-cols-1 gap-x-6 gap-y-3.5 md:grid-cols-2">
                  {sec.fields.map((f) => (
                    <FieldRow key={f.key} s={s} p={p} def={f} value={values[f.key] ?? ''} tplStages={tpl.stages.length}
                      editing={secEditing && !f.readOnly} draftValue={draft[f.key] ?? ''} changed={secEditing && (draft[f.key] ?? '') !== (current[f.key] ?? '')}
                      ai={aiKeys.includes(f.key)} highlight={highlight.has(f.key)}
                      onChange={(v) => { setDraft((d) => ({ ...d, [f.key]: v })) }} />
                  ))}
                </div>
              </Panel>
            )
          })}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CostDrivers p={p} canEdit={canEdit && !viewing} />
          <RevisionHistory s={s} revs={revs} asOfRev={asOfRev} onViewRev={(r) => { if (!isEditing) { setAsOfRev(r === latest?.rev ? null : r); document.getElementById('main')?.scrollTo?.({ top: 0, behavior: 'smooth' }) } }} />
        </div>
      </div>

      {isEditing && (
        <div className="sticky bottom-0 z-20 -mx-1 rounded-md border border-line bg-surface p-3 shadow-lg">
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[12px] font-semibold text-muted">Reason for change <span className="text-bad">*</span></span>
              <TextArea rows={1} value={note} placeholder="e.g. Updated after 60% design review" onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted tabular-nums">{changedCount} field{changedCount === 1 ? '' : 's'} changed · saves as rev {(latest?.rev ?? 0) + 1}</span>
              <Button variant="ghost" onClick={cancel}>Cancel</Button>
              <Button variant="primary" disabled={!changedCount || !note.trim()} onClick={save}>Save revision</Button>
            </div>
          </div>
        </div>
      )}

      <Modal open={textOpen} onClose={() => setTextOpen(false)} title="Project information as text" footer={<Button onClick={() => setTextOpen(false)}>Done</Button>}>
        <p className="mb-2 text-[12px] text-muted">The clipboard is blocked in this window. Select the text below and copy it.</p>
        <TextArea readOnly rows={18} className="font-mono text-[12px]" value={infoText(s, p, values)} onFocus={(e) => e.currentTarget.select()} />
      </Modal>
    </div>
  )
}

// ───────────────────────────── Header

function Header(props: {
  s: AppState; p: Project; comp: { filled: number; total: number; pct: number }; dc: ReturnType<typeof deliverableCompleteness>; missing: InfoFieldDef[]; gate?: string
  latest?: { rev: number; at: string; byId: string }; revCount: number; canEdit: boolean; frozen: boolean; isEditing: boolean
  onEdit: () => void; onSheet: () => void; onCsv: () => void; onCopy: () => void
  asOfRev: number | null; setAsOfRev: (r: number | null) => void; revs: { rev: number; at: string }[]
}) {
  const { s, p, comp, dc, missing, gate, latest } = props
  const who = latest ? s.people.find((x) => x.id === latest.byId)?.name ?? latest.byId : ''
  const cur = dc.current
  const tone = cur.pct >= 90 ? 'good' : cur.pct >= 60 ? 'ink' : 'warn'
  return (
    <Panel pad={false}>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <div className="min-w-0">
          <div className="eyebrow" title="Accepted or waived deliverables on the stage-gate checklist for the current stage">Deliverable completeness · {gateShort(cur.gate) || cur.gate} checklist</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[26px] font-bold leading-none tabular-nums">{cur.pct}%</span>
            <span className="text-[12px] text-muted tabular-nums">{cur.done} of {cur.total} deliverables accepted{cur.submitted ? ` · ${cur.submitted} in review` : ''}</span>
          </div>
          <Progress className="mt-2" value={cur.pct} tone={tone} />
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted tabular-nums">
            <a href={projectHref(p.id, 'lifecycle')} className="hover:text-link">Lifecycle to date {dc.toDate.done}/{dc.toDate.total} ({dc.toDate.pct}%)</a>
            <span title="Project information fields with a value (secondary measure)">Field completeness {comp.pct}% · {comp.filled}/{comp.total}</span>
          </div>
          <div className="mt-1.5 text-[12px] text-muted">
            {latest ? <span className="inline-flex flex-wrap items-center gap-1.5">Rev {latest.rev} · last revised by <Avatar name={who} size={16} /><b className="text-ink">{who}</b> {fmtDateTime(latest.at)}</span> : 'No revisions recorded yet'}
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow">Required for {templateFor(s, p).stages[p.stageIndex]?.name ?? 'current stage'}</div>
          {props.frozen ? (
            <div className="mt-1 text-[13px] text-muted">Project is {p.status}; the record is frozen as of rev {latest?.rev ?? 0}.</div>
          ) : missing.length ? (
            <>
              <div className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-bad">
                <span className="inline-block h-2 w-2 rounded-full bg-bad" />
                {missing.length} required field{missing.length === 1 ? '' : 's'} empty — blocks {gateShort(gate)}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {missing.map((f) => (
                  <button key={f.key} type="button" onClick={() => jumpTo(f.key)} className="rounded border border-bad/40 bg-bad/5 px-1.5 py-0.5 text-[12px] font-semibold text-bad hover:bg-bad/10">{f.label}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-good"><Icon name="check" className="h-4 w-4" />All fields required through this stage are complete{gate ? ` — ready for ${gateShort(gate)}` : ''}</div>
          )}
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {props.canEdit && !props.isEditing && <Button variant="primary" onClick={props.onEdit}>Edit</Button>}
            <Button icon={<Icon name="download" className="h-4 w-4" />} onClick={props.onSheet}>Export sheet</Button>
            <Button onClick={props.onCsv}>Export CSV</Button>
            <Button variant="ghost" onClick={props.onCopy}>Copy as text</Button>
          </div>
          {props.revs.length > 0 && (
            <label className="flex items-center gap-2 text-[12px] text-muted">
              View as of
              <Select aria-label="View as of revision" className="h-8 w-48 py-1 text-[12px]" disabled={props.isEditing} value={props.asOfRev === null ? '' : String(props.asOfRev)}
                onChange={(e) => props.setAsOfRev(e.target.value === '' ? null : Number(e.target.value))}
                options={[{ value: '', label: `Current (rev ${latest?.rev ?? 0})` }, ...props.revs.slice(1).map((r) => ({ value: String(r.rev), label: `Rev ${r.rev} · ${fmtDate(r.at.slice(0, 10))}` })), { value: '0', label: 'Before rev 1' }]} />
            </label>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ───────────────────────────── Linked records

function LinkedRecords({ s, p }: { s: AppState; p: Project }) {
  const permits = s.permits.filter((x) => x.projectId === p.id)
  const land = s.landRights.filter((x) => x.projectId === p.id)
  const contracts = s.contracts.filter((x) => x.projectId === p.id)
  const docs = s.documents.filter((x) => x.projectId === p.id)
  const decisions = s.decisions.filter((x) => x.projectId === p.id)
  const items: { label: string; value: string; sub: string; href: string }[] = [
    { label: 'Permits', value: String(permits.length), sub: `${permits.filter((x) => x.status === 'issued').length} issued`, href: projectHref(p.id, 'permits') },
    { label: 'Land rights', value: String(land.length), sub: `${land.filter((x) => x.status === 'acquired').length} acquired`, href: projectHref(p.id, 'permits') },
    { label: 'Contracts', value: String(contracts.length), sub: `${contracts.filter((x) => x.status === 'awarded' || x.status === 'active').length} awarded / active`, href: projectHref(p.id, 'permits') },
    { label: 'Documents', value: String(docs.length), sub: docs.length ? `latest ${fmtDate(docs.map((d) => d.updated).sort().pop())}` : 'none filed', href: projectHref(p.id, 'overview') },
    { label: 'Decisions', value: String(decisions.length), sub: decisions.length ? `latest ${fmtDate(decisions.map((d) => d.date).sort().pop())}` : 'none logged', href: projectHref(p.id, 'overview') },
  ]
  return (
    <nav aria-label="Linked records" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      {items.map((x) => (
        <a key={x.label} href={x.href} className="group flex min-w-0 items-baseline gap-2 bg-surface px-3 py-2 hover:bg-sunken">
          <span className="font-display text-[18px] font-bold tabular-nums">{x.value}</span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold group-hover:text-link">{x.label}</span>
            <span className="block truncate text-[11px] text-muted">{x.sub}</span>
          </span>
        </a>
      ))}
    </nav>
  )
}

// ───────────────────────────── One field

function FieldRow({ s, p, def, value, editing, draftValue, changed, ai, highlight, onChange, tplStages }: {
  s: AppState; p: Project; def: InfoFieldDef; value: string; editing: boolean; draftValue: string; changed: boolean; ai: boolean; highlight: boolean
  onChange: (v: string) => void; tplStages: number
}) {
  const v = editing ? draftValue : value
  const req = requirement(def, v, p.stageIndex)
  const stageName = def.requiredAtStage !== undefined ? templateFor(s, p).stages[def.requiredAtStage]?.name : undefined
  const reqLabel = def.requiredAtStage !== undefined && def.requiredAtStage < tplStages ? `Required at stage ${def.requiredAtStage + 1}` : undefined
  const shown = displayValue(def, value)
  const id = `pi-input-${def.key}`
  return (
    <div id={fieldAnchor(def.key)} className={cx('min-w-0 rounded transition-shadow', def.type === 'textarea' && 'md:col-span-2', highlight && 'outline outline-2 outline-offset-4 outline-marker/70', changed && 'border-l-2 border-link pl-2')}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <label htmlFor={editing ? id : undefined} className="text-[12px] font-semibold text-muted" title={!editing ? def.help : undefined}>
          {def.label}{def.help && !editing && <span className="ml-0.5 cursor-help text-faint">ⓘ</span>}
        </label>
        <SourceMark def={def} />
        {reqLabel && req === 'blocking' && <span className="text-[10.5px] font-bold uppercase tracking-wide text-bad" title={stageName}>{reqLabel}</span>}
        {reqLabel && req === 'later' && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-faint" title={stageName}>{reqLabel}</span>}
        {ai && <AiTag>AI proposed</AiTag>}
      </div>
      {editing && def.help && <div className="mb-1 text-[11px] text-faint">{def.help}</div>}
      {editing ? (
        <div className="mt-1"><FieldInput def={def} id={id} value={draftValue} onChange={onChange} /></div>
      ) : (
        <div className={cx('mt-0.5 min-w-0 break-words text-[13.5px]', def.type === 'textarea' && 'whitespace-pre-wrap leading-relaxed')}>
          {shown ? (def.key === 'erpWbs' || def.key === 'scheduleId' || def.key === 'lineId' || def.key === 'workOrder' ? <span className="font-mono text-[12.5px]">{shown}</span> : shown)
            : <span className={cx('italic', req === 'blocking' ? 'text-bad/80' : 'text-faint')}>Not provided</span>}
        </div>
      )}
    </div>
  )
}

function SourceMark({ def }: { def: InfoFieldDef }) {
  if (def.readOnly) return <span title="Computed from program and team assignments; change it there" className="rounded-sm border border-line px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">System</span>
  if (def.bind) return <span title={`Bound to project data (${def.bind}); also used by Overview, gate conditions and reports`} className="rounded-sm border border-info/40 px-1 text-[10px] font-semibold uppercase tracking-wide text-info">Project data</span>
  return null
}

// ───────────────────────────── AI assist

function AiDraft({ s, p, current, draft, onAccept }: { s: AppState; p: Project; current: Record<string, string>; draft: Record<string, string>; onAccept: (pr: DraftProposal) => void }) {
  const ai = useAiAvailable()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [props, setProps] = useState<DraftProposal[] | null>(null)
  const [done, setDone] = useState<Record<string, 'accepted' | 'rejected'>>({})
  const empty = s.settings.infoFields.filter((f) => !f.readOnly && !(current[f.key] ?? '').trim() && !(draft[f.key] ?? '').trim())
  if (ai === false) return null
  const run = async () => {
    setBusy(true); setErr(''); setProps(null); setDone({})
    try {
      const raw = await askJSON<unknown>(draftPrompt(s, p, empty))
      setProps(cleanProposals(raw, empty))
    } catch (e) { setErr(aiMessage(e)) } finally { setBusy(false) }
  }
  const label = (k: string) => s.settings.infoFields.find((f) => f.key === k)
  const open = (props ?? []).filter((x) => !done[x.key])
  if (!empty.length && !props) return null
  return (
    <Panel title={<span className="flex items-center gap-2">Draft missing fields <AiTag>AI assist</AiTag></span>}
      subtitle={`${empty.length} empty field${empty.length === 1 ? '' : 's'}. Proposals use only this project's scope, asset, location, risks and permits; nothing is saved until you accept it and save a revision with a reason.`}
      actions={<>
        {props && open.length > 1 && <Button size="sm" onClick={() => { open.forEach(onAccept); setDone((d) => ({ ...d, ...Object.fromEntries(open.map((x) => [x.key, 'accepted' as const])) })) }}>Accept all</Button>}
        <Button size="sm" disabled={busy || !empty.length} onClick={run}>{busy ? 'Thinking…' : props ? 'Draft again' : 'Draft missing fields'}</Button>
      </>}
      pad={!!(props || err)}>
      {err && <div className="text-[13px] text-bad">{err}</div>}
      {props && !props.length && <div className="text-[13px] text-muted">The project facts do not support a confident value for any empty field.</div>}
      {props && props.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {props.map((pr) => {
            const def = label(pr.key)
            const st = done[pr.key]
            return (
              <li key={pr.key} className={cx('flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3', st && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-muted">{def?.label}<span className="font-normal text-faint">· {def?.section}</span></div>
                  <div className="whitespace-pre-wrap text-[13px]">{def ? displayValue(def, pr.value) : pr.value}</div>
                  {pr.basis && <div className="text-[11.5px] text-faint">Basis: {pr.basis}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {st ? <Badge tone={st === 'accepted' ? 'good' : 'neutral'}>{st === 'accepted' ? 'Added to edit form' : 'Rejected'}</Badge> : <>
                    <Button size="sm" onClick={() => { onAccept(pr); setDone((d) => ({ ...d, [pr.key]: 'accepted' })) }}>Accept</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDone((d) => ({ ...d, [pr.key]: 'rejected' }))}>Reject</Button>
                  </>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
