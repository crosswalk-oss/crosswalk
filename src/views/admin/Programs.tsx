// Programs and funding envelopes by year.
import { useMemo, useState } from 'react'
import type { Program, RecoveryMechanism } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { activeBudget } from '@/core/engine/position'
import { money, sum, uid } from '@/core/util'
import { Badge, Button, Drawer, Field, Input, MoneyInput, Panel, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../shared/pickers'
import { useDraft } from './common'

const RECOVERY: RecoveryMechanism[] = ['GRC base', 'Balancing account', 'Memorandum account', 'Customer-funded', 'Advice letter']

export default function Programs() {
  const s = useStore()
  const [edit, setEdit] = useState<{ p: Program; isNew: boolean } | null>(null)
  const counts = useMemo(() => Object.fromEntries(s.programs.map((p) => [p.id, s.projects.filter((x) => x.programId === p.id).length])), [s.programs, s.projects])
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Programs" subtitle="Each program sets the regulatory driver, recovery path, lifecycle template and approval authority for its projects" pad={false}
        actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, p: { id: uid('prg'), code: '', name: '', description: '', regulatoryDriver: '', recovery: 'GRC base', lifecycleTemplateId: s.templates[0]?.id, doaMatrixId: s.doaMatrices[0]?.id } })}>Add program</Button>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Program</th><th>Regulatory driver</th><th>Recovery</th><th>Lifecycle template</th><th>DOA matrix</th><th className="num">Projects</th><th /></tr></thead>
            <tbody>
              {s.programs.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEdit({ p, isNew: false })}>
                  <td className="min-w-[220px]"><div className="flex items-center gap-2"><ProgramTag programId={p.id} /><b>{p.name}</b></div><div className="text-[12px] text-muted">{p.description}</div></td>
                  <td className="text-[12px]">{p.regulatoryDriver}</td>
                  <td><Badge>{p.recovery}</Badge></td>
                  <td className="text-[12px]">{s.templates.find((t) => t.id === p.lifecycleTemplateId)?.name ?? <span className="text-bad">Missing</span>}</td>
                  <td className="text-[12px]">{(() => { const m = s.doaMatrices.find((x) => x.id === p.doaMatrixId); return m ? `${m.name} v${m.version}` : '—' })()}</td>
                  <td className="num">{counts[p.id]}</td>
                  <td><Button size="sm" variant="ghost">Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <FundingGrid />
      <DoaPanel />
      <ProgramDrawer edit={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

function ProgramDrawer({ edit, onClose }: { edit: { p: Program; isNew: boolean } | null; onClose: () => void }) {
  const templates = useStore((s) => s.templates)
  const doas = useStore((s) => s.doaMatrices)
  const projects = useStore((s) => s.projects)
  const [p, setP] = useDraft<Program | null>(edit?.p ?? null)
  if (!edit || !p) return null
  const tplChanged = !edit.isNew && p.lifecycleTemplateId !== edit.p.lifecycleTemplateId
  const affected = projects.filter((x) => x.programId === p.id && x.status === 'active').length
  const save = () => {
    if (!p.code.trim() || !p.name.trim()) { toast('Code and name are required', 'bad'); return }
    mutate((d) => {
      const i = d.programs.findIndex((x) => x.id === p.id)
      if (i >= 0) d.programs[i] = p
      else d.programs.push(p)
    }, { entity: 'program', entityId: p.id, action: edit.isNew ? 'create' : 'update', summary: edit.isNew ? `Created program ${p.code} · ${p.name}` : `Updated program ${p.code}${tplChanged ? ` — lifecycle template changed to ${templates.find((t) => t.id === p.lifecycleTemplateId)?.name}` : ''}` })
    toast(edit.isNew ? 'Program created' : 'Program saved')
    onClose()
  }
  return (
    <Drawer open onClose={onClose} title={edit.isNew ? 'Add program' : `Edit ${edit.p.code}`} width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{edit.isNew ? 'Create program' : 'Save program'}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Code"><Input className="font-mono uppercase" maxLength={6} value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        </div>
        <Field label="Description"><TextArea rows={2} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <Field label="Regulatory driver" hint="Statute, rule or order that requires the work"><Input value={p.regulatoryDriver} onChange={(e) => setP({ ...p, regulatoryDriver: e.target.value })} /></Field>
        <Field label="Recovery mechanism"><Select value={p.recovery} onChange={(e) => setP({ ...p, recovery: e.target.value as RecoveryMechanism })} options={RECOVERY} /></Field>
        <Field label="Lifecycle template"><Select value={p.lifecycleTemplateId} onChange={(e) => setP({ ...p, lifecycleTemplateId: e.target.value })} options={templates.map((t) => ({ value: t.id, label: t.name }))} /></Field>
        {tplChanged && affected > 0 && <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[13px]">{affected} active project{affected > 1 ? 's' : ''} will be measured against the new template from their current stage index. Past gate decisions are not changed.</div>}
        <Field label="Delegation of authority matrix"><Select value={p.doaMatrixId} onChange={(e) => setP({ ...p, doaMatrixId: e.target.value })} options={doas.map((m) => ({ value: m.id, label: `${m.name} v${m.version}` }))} /></Field>
      </div>
    </Drawer>
  )
}

function FundingGrid() {
  const programs = useStore((s) => s.programs)
  const funding = useStore((s) => s.funding)
  const budgets = useStore((s) => s.budgets)
  const projects = useStore((s) => s.projects)
  const years = useMemo(() => { const ys = Array.from(new Set(funding.map((f) => f.year))).sort(); return ys.length ? ys : [2026, 2027, 2028] }, [funding])
  const [draft, setDraft, dirty, discard] = useDraft(funding)
  const planned = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of projects) {
      if (p.status === 'cancelled') continue
      const b = activeBudget({ budgets } as any, p.id)
      for (const [y, v] of Object.entries(b?.byYear ?? {})) out[`${p.programId}|${y}`] = (out[`${p.programId}|${y}`] || 0) + v
    }
    return out
  }, [projects, budgets])
  const cell = (pid: string, y: number) => draft.find((f) => f.programId === pid && f.year === y)
  const setCell = (pid: string, y: number, patch: Partial<{ authorized: number; proceeding: string }>) => setDraft((d) => {
    const i = d.findIndex((f) => f.programId === pid && f.year === y)
    if (i >= 0) return d.map((f, j) => (j === i ? { ...f, ...patch } : f))
    return [...d, { id: uid('fund'), programId: pid, year: y, authorized: 0, proceeding: '', ...patch }]
  })
  const addYear = () => { const y = (years[years.length - 1] ?? 2026) + 1; setDraft((d) => [...d, ...programs.map((p) => ({ id: uid('fund'), programId: p.id, year: y, authorized: 0, proceeding: 'AV-PUC-2026-06 (fictional) (TY2028 GRC, pending)' }))]) }
  const shownYears = Array.from(new Set([...years, ...draft.map((f) => f.year)])).sort()
  const save = () => {
    const changed = draft.filter((f) => { const o = funding.find((x) => x.id === f.id); return !o || o.authorized !== f.authorized || o.proceeding !== f.proceeding })
    mutate((d) => { d.funding = draft }, { entity: 'funding', entityId: 'funding', action: 'update', summary: `Updated ${changed.length} funding envelope${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 6).map((f) => `${programs.find((p) => p.id === f.programId)?.code} ${f.year} ${money(f.authorized)}`).join(', ')}${changed.length > 6 ? '…' : ''}` })
    toast('Funding envelopes saved')
  }
  const [proc, setProc] = useState<{ pid: string; y: number } | null>(null)
  return (
    <Panel title="Authorized funding by program and year" subtitle="Envelope authorized in the rate case or advice letter. Planned = active budgets spread by year; red means over authorization." pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={addYear}>Add year</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save funding</Button></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Program</th>{shownYears.map((y) => <th key={y} className="num">{y}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap"><ProgramTag programId={p.id} /> <span className="text-[12px] text-muted">{p.name}</span></td>
                {shownYears.map((y) => {
                  const c = cell(p.id, y)
                  const pl = planned[`${p.id}|${y}`] || 0
                  const over = c && pl > c.authorized
                  return (
                    <td key={y} className="min-w-[128px]">
                      <MoneyInput aria-label={`${p.code} ${y} authorized`} className="h-7 py-0.5 text-[12px]" value={c?.authorized ?? 0} onChange={(v) => setCell(p.id, y, { authorized: v })} />
                      <button className="mt-0.5 block w-full truncate text-right text-[11px] tabular-nums" title={`Planned ${money(pl, 'full')} · ${c?.proceeding || 'no proceeding'}`} onClick={() => setProc({ pid: p.id, y })}>
                        <span className={over ? 'font-semibold text-bad' : 'text-faint'}>plan {money(pl)}</span>
                      </button>
                    </td>
                  )
                })}
                <td className="num font-semibold">{money(sum(draft.filter((f) => f.programId === p.id).map((f) => f.authorized)))}</td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold">All programs</td>
              {shownYears.map((y) => {
                const a = sum(draft.filter((f) => f.year === y).map((f) => f.authorized))
                const pl = sum(programs.map((p) => planned[`${p.id}|${y}`] || 0))
                return <td key={y} className="num"><b>{money(a)}</b><div className={pl > a ? 'text-[11px] text-bad' : 'text-[11px] text-faint'}>plan {money(pl)}</div></td>
              })}
              <td className="num font-semibold">{money(sum(draft.map((f) => f.authorized)))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {proc && (() => {
        const c = cell(proc.pid, proc.y)
        return (
          <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
            <Field className="min-w-[280px] flex-1" label={`Proceeding for ${programs.find((p) => p.id === proc.pid)?.code} ${proc.y}`}>
              <Input value={c?.proceeding ?? ''} onChange={(e) => setCell(proc.pid, proc.y, { proceeding: e.target.value })} placeholder="e.g. AV-PUC-2026-06 (fictional) (TY2028 GRC)" />
            </Field>
            <Button size="sm" variant="ghost" onClick={() => setProc(null)}>Done</Button>
          </div>
        )
      })()}
      <div className="border-t border-line px-4 py-2 text-[12px] text-muted">Click a planned figure to edit the proceeding that authorizes that envelope. Portfolio planning uses these envelopes for its fit-to-funding scenarios.</div>
    </Panel>
  )
}

function DoaPanel() {
  const doas = useStore((s) => s.doaMatrices)
  const roles = useStore((s) => s.roles)
  const m = doas[0]
  const [rows, setRows, dirty, discard] = useDraft(m?.rows ?? [])
  if (!m) return null
  const save = () => {
    const nv = m.version + 1
    mutate((d) => { const x = d.doaMatrices.find((y) => y.id === m.id)!; x.rows = rows; x.version = nv; x.effective = d.settings.asOf }, { entity: 'doa', entityId: m.id, action: 'update', summary: `Published ${m.name} v${nv}: ${rows.map((r) => `≤${money(r.upTo)} ${r.label}`).join(', ')}` })
    toast(`Delegation of authority v${nv} published`)
  }
  return (
    <Panel title="Delegation of authority" subtitle={`${m.name} · v${m.version} effective ${m.effective}. Workflows with a dollar-authority step route to the first row the amount fits under.`} pad={false}
      actions={<>{dirty && <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>}<Button size="sm" onClick={() => setRows([...rows, { upTo: (rows[rows.length - 1]?.upTo ?? 0) * 2 || 1_000_000, roleId: 'exec', label: 'New tier' }])}>Add tier</Button><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Publish new version</Button></>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th>Up to</th><th>Approver role</th><th>Label</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="w-[180px]">{r.upTo >= 1e12 ? <span className="text-[13px] text-muted">No limit</span> : <MoneyInput className="h-7 py-0.5" value={r.upTo} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, upTo: v } : x)))} />}</td>
                <td><Select className="h-7 py-0.5" value={r.roleId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, roleId: e.target.value as typeof r.roleId } : x)))} options={roles.map((x) => ({ value: x.id, label: x.name }))} /></td>
                <td><Input className="h-7 py-0.5" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                <td className="w-[80px]"><Button size="sm" variant="ghost" className="text-bad" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
