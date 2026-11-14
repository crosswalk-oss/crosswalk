// Risk editor drawer (RK-02, RK-04, RK-05, RK-10): cause → event → effect, scoring, 3-point estimates,
// responses, residual rating, and closing with a lesson learned.
import { useEffect, useState } from 'react'
import type { ConsequenceDim, Risk, RiskResponse } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { CONSEQUENCE_LABELS, LIKELIHOOD_LABELS, expectedCost, pert, riskScore } from '@/core/engine/risk'
import { addDays, money, uid, cx } from '@/core/util'
import { Badge, Button, Callout, Checkbox, Drawer, Field, Input, MoneyInput, Section, Select, SegButtons, TextArea, humanize } from '@/ui/kit'
import { PersonSelect } from '@/views/shared/pickers'
import { toast } from '@/ui/toast'
import { CONSEQUENCE_DIMS, PROB_BY_L, RISK_CATEGORIES, bandTone } from './lib'

type LC = 1 | 2 | 3 | 4 | 5
const lcOpts = (labels: string[]) => labels.map((l, i) => ({ value: String(i + 1), label: `${i + 1} · ${l}` }))

export function ScoreChip({ l, c, title }: { l: number; c: number; title?: string }) {
  const sc = l * c
  const t = bandTone(sc)
  return <span title={title ?? `L${l} × C${c}`} className={cx('inline-flex h-6 min-w-[30px] items-center justify-center rounded-sm px-1 font-mono text-[12px] font-bold tabular-nums', t === 'bad' ? 'bg-bad text-white' : t === 'warn' ? 'bg-warn/50 text-ink' : 'bg-good/25 text-ink')}>{sc}</span>
}

export function RiskEditor({ risk, open, onClose, onRequestDraw, isNew }: { risk: Risk | null; open: boolean; onClose: () => void; onRequestDraw?: (r: Risk) => void; isNew?: boolean }) {
  const [r, setR] = useState<Risk | null>(risk)
  const [closing, setClosing] = useState<null | 'closed' | 'realized'>(null)
  const asOf = useStore((s) => s.settings.asOf)
  const project = useStore((s) => s.projects.find((p) => p.id === risk?.projectId))
  useEffect(() => { setR(risk ? JSON.parse(JSON.stringify(risk)) : null); setClosing(null) }, [risk, open])
  if (!r) return null
  const set = <K extends keyof Risk>(k: K, v: Risk[K]) => setR({ ...r, [k]: v })
  const setResp = (id: string, patch: Partial<RiskResponse>) => set('responses', r.responses.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const closedState = r.status === 'closed' || r.status === 'realized'
  const valid = r.title.trim() && r.event.trim() && r.cost.min <= r.cost.ml && r.cost.ml <= r.cost.max && r.scheduleDays.min <= r.scheduleDays.ml && r.scheduleDays.ml <= r.scheduleDays.max

  const save = (next: Risk = r, msg = isNew ? 'Risk added to register' : 'Risk updated') => {
    if (!next.title.trim() || !next.event.trim()) { toast('Give the risk a title and an event statement.', 'bad'); return }
    if (!(next.cost.min <= next.cost.ml && next.cost.ml <= next.cost.max)) { toast('Cost range must be min ≤ most likely ≤ max.', 'bad'); return }
    if (!(next.scheduleDays.min <= next.scheduleDays.ml && next.scheduleDays.ml <= next.scheduleDays.max)) { toast('Schedule range must be min ≤ most likely ≤ max.', 'bad'); return }
    mutate((d) => {
      const i = d.risks.findIndex((x) => x.id === next.id)
      if (i >= 0) d.risks[i] = next
      else d.risks.push(next)
    }, { entity: 'risk', entityId: next.id, projectId: next.projectId, action: isNew ? 'create' : next.status === 'closed' || next.status === 'realized' ? next.status : 'update', summary: `${next.code} ${next.title}${isNew ? ' added' : ` — ${next.status}`} (L${next.likelihood}×C${next.consequence}, ML ${money(next.cost.ml)})` })
    toast(msg)
    onClose()
  }
  const finish = () => {
    if (!closing) return
    if (!r.lesson?.trim()) { toast('Write the lesson learned before closing.', 'bad'); return }
    save({ ...r, status: closing, closedAt: asOf }, closing === 'closed' ? 'Risk closed; lesson added to the library' : 'Risk marked realized; lesson added to the library')
  }

  return (
    <Drawer open={open} onClose={onClose} width={720}
      title={<span className="flex items-center gap-2"><span className="font-mono text-[14px]">{r.code}</span>{isNew ? 'New risk' : 'Risk'}</span>}
      footer={closing ? (
        <><Button variant="ghost" onClick={() => setClosing(null)}>Back</Button><Button variant="primary" onClick={finish}>{closing === 'closed' ? 'Close risk' : 'Mark realized'}</Button></>
      ) : (
        <>
          {!isNew && !closedState && onRequestDraw && r.kind === 'threat' && project && <Button onClick={() => { onClose(); onRequestDraw(r) }}>Request contingency</Button>}
          {!isNew && !closedState && <Button onClick={() => { setClosing('realized'); set('lesson', r.lesson ?? '') }}>Mark realized…</Button>}
          {!isNew && !closedState && <Button onClick={() => setClosing('closed')}>Close with lesson…</Button>}
          {closedState && <Button onClick={() => save({ ...r, status: 'open', closedAt: undefined }, 'Risk reopened')}>Reopen</Button>}
          <Button variant="primary" disabled={!valid} onClick={() => save()}>{isNew ? 'Add to register' : 'Save changes'}</Button>
        </>
      )}>
      {closing ? (
        <div className="flex flex-col gap-3">
          <Callout tone="info" title={closing === 'closed' ? 'Close this risk' : 'This risk happened'}>
            {closing === 'closed' ? 'Closed risks leave active exposure and the Monte Carlo. ' : 'A realized risk leaves active exposure; request a contingency draw if it costs money. '}
            The lesson goes to the lessons library and is shown when similar work is planned.
          </Callout>
          <Field label="Lesson learned" hint="What should the next project doing this work method do differently?">
            <TextArea id="risk-lesson" className="min-h-[120px]" value={r.lesson ?? ''} onChange={(e) => set('lesson', e.target.value)} placeholder="e.g. Pothole every foreign crossing before the Class 3 estimate; two of five crossings were off-record by more than 3 ft." />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {closedState && <Callout tone={r.status === 'realized' ? 'bad' : 'good'} title={`${humanize(r.status)} ${r.closedAt ? 'on ' + r.closedAt : ''}`}>{r.lesson ? <>Lesson: {r.lesson}</> : 'No lesson recorded.'}</Callout>}
          <Section title="Statement">
            <Field label="Title"><Input id="risk-title" value={r.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Cause (because of…)"><TextArea value={r.cause} onChange={(e) => set('cause', e.target.value)} /></Field>
              <Field label="Event (…this may happen)"><TextArea value={r.event} onChange={(e) => set('event', e.target.value)} /></Field>
              <Field label="Effect (…resulting in)"><TextArea value={r.effect} onChange={(e) => set('effect', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Field label="Kind"><SegButtons options={[{ id: 'threat', label: 'Threat' }, { id: 'opportunity', label: 'Opportunity' }]} value={r.kind} onChange={(v) => set('kind', v)} /></Field>
              <Field label="Category"><Select value={r.category} onChange={(e) => set('category', e.target.value)} options={Array.from(new Set([r.category, ...RISK_CATEGORIES])).filter(Boolean)} /></Field>
              <Field label="Owner"><PersonSelect value={r.ownerId} onChange={(v) => set('ownerId', v)} /></Field>
              <Field label="Status"><Select value={r.status} onChange={(e) => set('status', e.target.value as Risk['status'])} options={closedState ? [r.status] : ['open', 'mitigating']} disabled={closedState} /></Field>
            </div>
          </Section>

          <Section title="Inherent rating">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Field label="Likelihood"><Select value={String(r.likelihood)} onChange={(e) => { const l = Number(e.target.value) as LC; setR({ ...r, likelihood: l, probability: PROB_BY_L[l - 1] }) }} options={lcOpts(LIKELIHOOD_LABELS)} /></Field>
              <Field label="Consequence"><Select value={String(r.consequence)} onChange={(e) => set('consequence', Number(e.target.value) as LC)} options={lcOpts(CONSEQUENCE_LABELS)} /></Field>
              <Field label="Consequence dimension"><Select value={r.consequenceDim} onChange={(e) => set('consequenceDim', e.target.value as ConsequenceDim)} options={[...CONSEQUENCE_DIMS]} /></Field>
              <Field label="Probability (quantitative)" hint="Defaults from likelihood"><div className="relative"><Input type="number" min={0} max={100} className="pr-7 text-right tabular-nums" value={Math.round(r.probability * 100)} onChange={(e) => set('probability', Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-faint">%</span></div></Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[13px]"><span className="text-muted">Score</span><ScoreChip l={r.likelihood} c={r.consequence} /><span className="text-muted">PERT cost</span><b className="tabular-nums">{money(pert(r.cost))}</b><span className="text-muted">Expected value</span><b className={cx('tabular-nums', r.kind === 'opportunity' && 'text-good')}>{money(expectedCost(r))}</b></div>
          </Section>

          <Section title="Three-point estimate">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Cost min"><MoneyInput value={r.cost.min} onChange={(v) => set('cost', { ...r.cost, min: v })} /></Field>
              <Field label="Most likely"><MoneyInput value={r.cost.ml} onChange={(v) => set('cost', { ...r.cost, ml: v })} /></Field>
              <Field label="Cost max"><MoneyInput value={r.cost.max} onChange={(v) => set('cost', { ...r.cost, max: v })} /></Field>
              <Field label="Days min"><Input type="number" className="text-right tabular-nums" value={r.scheduleDays.min} onChange={(e) => set('scheduleDays', { ...r.scheduleDays, min: Number(e.target.value) || 0 })} /></Field>
              <Field label="Days most likely"><Input type="number" className="text-right tabular-nums" value={r.scheduleDays.ml} onChange={(e) => set('scheduleDays', { ...r.scheduleDays, ml: Number(e.target.value) || 0 })} /></Field>
              <Field label="Days max"><Input type="number" className="text-right tabular-nums" value={r.scheduleDays.max} onChange={(e) => set('scheduleDays', { ...r.scheduleDays, max: Number(e.target.value) || 0 })} /></Field>
            </div>
            {!valid && <p className="text-xs text-bad">Ranges must run min ≤ most likely ≤ max, and the risk needs a title and event.</p>}
          </Section>

          <Section title={`Responses (${r.responses.length})`} actions={<Button size="sm" onClick={() => set('responses', [...r.responses, { id: uid('rr'), action: '', ownerId: r.ownerId, due: addDays(asOf, 30), status: 'open', cost: 0 }])}>Add response</Button>}>
            {r.responses.length === 0 && <p className="text-[13px] text-muted">No response plan yet.{riskScore(r) >= 15 && <b className="text-bad"> High risks without a response block the next gate.</b>}</p>}
            {r.responses.map((x) => (
              <div key={x.id} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2.5 md:grid-cols-[1fr_170px]">
                <Field label="Action"><Input value={x.action} onChange={(e) => setResp(x.id, { action: e.target.value })} placeholder="Avoid / mitigate / transfer / accept: what will be done" /></Field>
                <Field label="Owner"><PersonSelect value={x.ownerId} onChange={(v) => setResp(x.id, { ownerId: v })} /></Field>
                <div className="grid grid-cols-3 gap-2 md:col-span-2">
                  <Field label="Due"><Input type="date" value={x.due} onChange={(e) => setResp(x.id, { due: e.target.value })} className={x.status === 'open' && x.due < asOf ? 'border-bad' : ''} /></Field>
                  <Field label="Cost"><MoneyInput value={x.cost} onChange={(v) => setResp(x.id, { cost: v })} /></Field>
                  <Field label="Status"><div className="flex h-[32px] items-center gap-2"><Checkbox checked={x.status === 'done'} onChange={(v) => setResp(x.id, { status: v ? 'done' : 'open' })} label="Done" />{x.status === 'open' && x.due < asOf && <Badge tone="bad">Overdue</Badge>}<button className="ml-auto text-xs text-muted hover:text-bad" onClick={() => set('responses', r.responses.filter((y) => y.id !== x.id))}>Remove</button></div></Field>
                </div>
              </div>
            ))}
          </Section>

          <Section title="Residual rating (after responses)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Residual likelihood"><Select value={String(r.residual.likelihood)} onChange={(e) => set('residual', { ...r.residual, likelihood: Number(e.target.value) as LC })} options={lcOpts(LIKELIHOOD_LABELS)} /></Field>
              <Field label="Residual consequence"><Select value={String(r.residual.consequence)} onChange={(e) => set('residual', { ...r.residual, consequence: Number(e.target.value) as LC })} options={lcOpts(CONSEQUENCE_LABELS)} /></Field>
              <div className="flex h-[32px] items-center gap-2 text-[13px]"><ScoreChip l={r.likelihood} c={r.consequence} title="Inherent" /><span className="text-faint">→</span><ScoreChip l={r.residual.likelihood} c={r.residual.consequence} title="Residual" /></div>
            </div>
          </Section>
        </div>
      )}
    </Drawer>
  )
}
