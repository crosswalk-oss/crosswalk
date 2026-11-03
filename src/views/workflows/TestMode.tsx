// Test routing (WF-09): enter sample form values and a project; see who the request would reach, step by step.
import { useMemo } from 'react'
import type { AppState, WorkflowDef } from '@/core/types'
import { cx, money } from '@/core/util'
import { Avatar, Badge, Button, Callout, Checkbox, Field, Input, MoneyInput, Panel, Select, TextArea } from '@/ui/kit'
import { ProjectSelect, PersonSelect } from '../shared/pickers'
import { Canvas } from './canvas'
import { defaultValues, doaMatrixFor, isOutOfOffice, nodeTypeLabel, trace } from './lib'
import type { Preview } from './editors'

export function TestMode({ s, def, preview, setPreview }: { s: AppState; def: WorkflowDef; preview: Preview; setPreview: (p: Preview | ((p: Preview) => Preview)) => void }) {
  const steps = useMemo(() => trace(s, def, preview.data, preview.projectId, preview.requesterId), [s, def, preview])
  const onPath = useMemo(() => new Set(steps.map((x) => x.node.id)), [steps])
  const project = s.projects.find((p) => p.id === preview.projectId)
  const setVal = (k: string, v: unknown) => setPreview((p) => ({ ...p, data: { ...p.data, [k]: v } }))
  const m = doaMatrixFor(s, preview.projectId)
  const ooo = s.people.filter((p) => isOutOfOffice(p, s.settings.asOf))
  const humanCount = steps.filter((x) => x.kind === 'human' && x.node.type !== 'notify').length
  const slaTotal = steps.reduce((a, x) => a + (x.node.slaDays ?? 0), 0)
  const skipped = steps.filter((x) => x.kind === 'human' && !x.people.length)
  const amountField = def.fields.find((f) => f.type === 'money')
  const scenarios = amountField ? [100_000, 1_200_000, 12_000_000, 75_000_000] : []
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Panel title="Sample request" subtitle="Nothing is saved — this is a dry run against live people, teams and authority.">
        <div className="flex flex-col gap-3">
          <Field label="Project"><ProjectSelect id="wf-test-project" value={preview.projectId} onChange={(id) => setPreview((p) => ({ ...p, projectId: id }))} /></Field>
          <Field label="Requested by"><PersonSelect id="wf-test-requester" value={preview.requesterId} onChange={(id) => setPreview((p) => ({ ...p, requesterId: id }))} /></Field>
          {def.fields.map((f) => (
            <Field key={f.key} label={<>{f.label} <span className="font-mono text-[10.5px] font-normal text-faint">{f.key}</span></>}>
              {f.type === 'money' ? <MoneyInput value={Number(preview.data[f.key] ?? 0)} onChange={(v) => setVal(f.key, v)} />
                : f.type === 'number' ? <Input type="number" value={String(preview.data[f.key] ?? 0)} onChange={(e) => setVal(f.key, Number(e.target.value))} />
                : f.type === 'boolean' ? <Checkbox checked={!!preview.data[f.key]} onChange={(v) => setVal(f.key, v)} label="Yes" />
                : f.type === 'select' ? <Select value={String(preview.data[f.key] ?? '')} onChange={(e) => setVal(f.key, e.target.value)} options={(f.options ?? []).length ? (f.options ?? []).map((o) => ({ value: o, label: o || '—' })) : [{ value: '', label: '—' }]} />
                : f.type === 'date' ? <Input type="date" value={String(preview.data[f.key] ?? '')} onChange={(e) => setVal(f.key, e.target.value)} />
                : f.type === 'textarea' ? <TextArea className="min-h-[52px]" value={String(preview.data[f.key] ?? '')} onChange={(e) => setVal(f.key, e.target.value)} />
                : <Input value={String(preview.data[f.key] ?? '')} onChange={(e) => setVal(f.key, e.target.value)} />}
            </Field>
          ))}
          {scenarios.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-semibold text-muted">Try an amount</div>
              <div className="flex flex-wrap gap-1">{scenarios.map((a) => <Button key={a} size="sm" variant={preview.data[amountField!.key] === a ? 'primary' : 'secondary'} onClick={() => setVal(amountField!.key, a)}>{money(a)}</Button>)}</div>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPreview((p) => ({ ...p, data: defaultValues(def) }))}>Reset values</Button>
          {ooo.length > 0 && <Callout tone="info" title="Delegations in force">{ooo.map((p) => <div key={p.id}>{p.name} → {s.people.find((x) => x.id === p.outOfOffice!.delegateId)?.name} until {p.outOfOffice!.to}</div>)}</Callout>}
        </div>
      </Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="People steps" value={String(humanCount)} />
          <MiniStat label="SLA on this path" value={`${slaTotal} days`} />
          <MiniStat label="Approver tier" value={(() => { const st = steps.find((x) => x.node.assignee?.kind === 'doa'); if (!st || !m) return '—'; const amt = Math.abs(Number(preview.data[(st.node.assignee as { field: string }).field] ?? 0)); return m.rows.slice().sort((a, b) => a.upTo - b.upTo).find((r) => amt <= r.upTo)?.label ?? '—' })()} />
          <MiniStat label="Skipped (no one)" value={String(skipped.length)} tone={skipped.length ? 'bad' : undefined} />
        </div>
        <Panel title="Route" subtitle={`${def.name} v${def.version}${project ? ` on ${project.code} ${project.name}` : ''}`} pad={false}>
          <ol className="divide-y divide-line">
            {steps.map((st, i) => (
              <li key={st.node.id + i} className={cx('flex gap-3 px-4 py-2.5', st.kind === 'auto' && 'bg-sunken/40')}>
                <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', st.kind === 'human' ? (st.people.length ? 'bg-ink text-surface' : 'bg-bad text-white') : 'border border-line text-faint')}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[13px]">{st.node.label}</b>
                    <Badge tone={st.node.type === 'approval' ? 'marker' : st.kind === 'auto' ? 'neutral' : 'info'}>{nodeTypeLabel(st.node.type)}</Badge>
                    {st.via && st.via !== 'parallel' && <span className="text-[11.5px] text-faint">via “{st.via}”</span>}
                    {st.via === 'parallel' && <Badge>parallel branch</Badge>}
                    {st.node.slaDays ? <span className="ml-auto text-[12px] text-muted">{st.node.slaDays}-day SLA</span> : null}
                  </div>
                  {st.people.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {st.people.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5 text-[12.5px]"><Avatar name={p.name} size={18} /><b>{p.name}</b><span className="text-muted">{p.title}</span></span>)}
                    </div>
                  )}
                  {st.delegatedFrom.map((d) => <div key={d.from.id} className="mt-1 text-[12px] text-info">Delegated: {d.from.name} is out of office until {d.from.outOfOffice?.to}; {d.to.name} acts instead.</div>)}
                  {st.note && <div className={cx('mt-0.5 text-[12px]', st.kind === 'human' && !st.people.length ? 'text-bad' : 'text-muted')}>{st.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Path on the diagram" pad={false}>
          <div className="max-h-[380px] overflow-auto"><Canvas s={s} def={def} readOnly highlight={onPath} zoom={0.8} /></div>
        </Panel>
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return <div className="min-w-0 rounded-md border border-line bg-surface px-3 py-2"><div className="eyebrow truncate">{label}</div><div className={cx('mt-0.5 truncate font-display text-[18px] font-bold tabular-nums', tone === 'bad' && 'text-bad')}>{value}</div></div>
}
