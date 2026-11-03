// Bulk estimate update: after the rate table changes, list projects whose current estimate was priced on an
// older version, let the estimating team pick which to reprice (or keep on historical rates), and create the
// repriced draft versions. Before → after shown per project, with line-level detail.
import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '@/core/types'
import { mutate, personName } from '@/core/store'
import { applyReprice, keepHistorical, repriceCandidates, type RepricePlan } from '@/core/engine/estimatingAdmin'
import { stageName } from '@/core/engine/gates'
import { go, projectHref } from '@/core/router'
import { cx, fmtDate, money, moneyDelta, pct, sum } from '@/core/util'
import { Badge, Button, Callout, ClassBadge, Drawer, Empty, Field, Modal, Panel, Stat, StatusBadge, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { ProgramTag } from '../../shared/pickers'
import { displayTitle } from '../lib'

export function BulkReprice({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const plans = useMemo(() => repriceCandidates(s), [s])
  const v = s.settings.estimating.rateTableVersion
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const key = plans.map((p) => p.estimate.id + (p.kept ? 'k' : '')).join()
  useEffect(() => { setSel(Object.fromEntries(plans.map((p) => [p.estimate.id, p.eligible && !p.kept]))) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const [detail, setDetail] = useState<RepricePlan | null>(null)
  const [confirm, setConfirm] = useState<'reprice' | 'keep' | null>(null)
  const chosen = plans.filter((p) => p.eligible && sel[p.estimate.id])
  const eligible = plans.filter((p) => p.eligible)
  const before = sum(chosen.map((p) => p.before.total)), after = sum(chosen.map((p) => p.after.total))
  const allOn = eligible.length > 0 && eligible.every((p) => sel[p.estimate.id])
  const toggleAll = () => setSel(Object.fromEntries(plans.map((p) => [p.estimate.id, p.eligible && !allOn])))

  const doReprice = (note: string) => {
    let r = { created: 0, updated: 0 }
    const ids = chosen.map((p) => p.estimate.id)
    mutate((d) => { const x = applyReprice(d, ids, note); r = { created: x.created.length, updated: x.updated.length } }, { entity: 'estimating-config', entityId: 'bulk-reprice', action: 'reprice', summary: `Bulk update to rate table v${v}: ${ids.length} estimate${ids.length === 1 ? '' : 's'} repriced (${money(before)} → ${money(after)})${note ? ` — ${note}` : ''}` })
    setConfirm(null)
    toast(`${r.created} new draft version${r.created === 1 ? '' : 's'} created${r.updated ? `, ${r.updated} draft${r.updated === 1 ? '' : 's'} updated` : ''} on rate table v${v}`)
  }
  const doKeep = (note: string) => {
    const ids = chosen.map((p) => p.estimate.id)
    let n = 0
    mutate((d) => { n = keepHistorical(d, ids, note) }, { entity: 'estimating-config', entityId: 'bulk-reprice', action: 'keep-rates', summary: `Kept ${ids.length} estimate${ids.length === 1 ? '' : 's'} on historical rates for rate table v${v} — ${note}` })
    setConfirm(null)
    toast(`${n} estimate${n === 1 ? '' : 's'} kept on historical rates`)
  }

  if (!plans.length) return (
    <Panel title="Bulk estimate update"><Empty title={`Every current estimate is on rate table v${v}`}>When the estimating team publishes a new rate table, projects whose current estimate was priced on an older version appear here to reprice or keep on historical rates. Historical quick estimates price from the historical cost table and are not listed.</Empty></Panel>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rate table in force" value={`v${v}`} sub={s.settings.estimating.rateTableHistory.slice(-1)[0]?.note} />
        <Stat label="On an older version" value={plans.length} sub={`${eligible.length} can be repriced now`} />
        <Stat label="Selected" value={chosen.length} sub={chosen.length ? `${money(before)} → ${money(after)}` : 'Pick projects below'} />
        <Stat label="Net change" value={chosen.length ? moneyDelta(after - before) : '—'} sub={chosen.length && before ? `${after >= before ? '+' : ''}${pct(after / before - 1, 1)} on the selected estimates` : undefined} tone={chosen.length ? (after > before ? 'bad' : 'good') : undefined} />
      </div>
      <Panel pad={false} title="Projects priced on an older rate table" subtitle="Repricing replaces rate-table unit costs with today's table for the project's region and applies the current loaders, escalation, contingency default and county sales tax. Vendor quotes, analogs, estimator judgment and overrides keep their prices. Approved estimates stay as signed: a new draft version is created."
        actions={canEdit && <>
          <Button size="sm" disabled={!chosen.length} onClick={() => setConfirm('keep')}>Keep historical rates ({chosen.length})</Button>
          <Button size="sm" variant="primary" disabled={!chosen.length} onClick={() => setConfirm('reprice')}>Reprice selected ({chosen.length})</Button>
        </>}>
        <div className="scroll-x">
          <table className="tbl min-w-[980px]">
            <thead>
              <tr>
                <th style={{ width: 34 }}>{canEdit && <input type="checkbox" aria-label="Select all" className="h-4 w-4" checked={allOn} onChange={toggleAll} />}</th>
                <th>Project</th><th>Current estimate</th><th>Priced on</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th><th>Lines</th><th>Result</th><th />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const d = p.after.total - p.before.total
                const n = p.lines.filter((x) => x.status === 'repriced').length
                const kept = p.lines.filter((x) => x.status === 'quote' || x.status === 'override' || x.status === 'manual').length
                return (
                  <tr key={p.estimate.id} className={cx(!p.eligible && 'opacity-70')}>
                    <td>{canEdit && <input type="checkbox" aria-label={`Select ${p.project.code}`} className="h-4 w-4" disabled={!p.eligible} checked={!!sel[p.estimate.id] && p.eligible} onChange={(e) => setSel({ ...sel, [p.estimate.id]: e.target.checked })} />}</td>
                    <td><div className="flex items-center gap-1.5"><ProgramTag programId={p.project.programId} /><a className="font-mono text-[12px] font-semibold text-link hover:underline" href={projectHref(p.project.id, 'estimates')}>{p.project.code}</a></div><div className="max-w-[240px] truncate text-[12px] text-muted">{p.project.name}</div><div className="text-[11px] text-faint">{stageName(s, p.project)} · {p.project.location.district}</div></td>
                    <td><div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[12px]">v{p.estimate.version}</span><ClassBadge cls={p.estimate.cls} /><StatusBadge status={p.estimate.status} /></div><div className="max-w-[200px] truncate text-[11px] text-faint">{displayTitle(p.estimate)}</div></td>
                    <td><Badge tone="warn">v{p.fromVersion}</Badge></td>
                    <td className="num">{money(p.before.total)}</td>
                    <td className="num font-semibold">{money(p.after.total)}</td>
                    <td className={cx('num font-semibold', d > 0 ? 'text-bad' : d < 0 ? 'text-good' : 'text-faint')}>{d === 0 ? '—' : <>{moneyDelta(d)}<div className="text-[11px] font-normal">{p.before.total ? `${d > 0 ? '+' : ''}${pct(d / p.before.total, 1)}` : ''}</div></>}</td>
                    <td className="text-[12px]">{n} repriced{kept ? <div className="text-faint">{kept} kept as priced</div> : null}</td>
                    <td className="text-[12px]">
                      {!p.eligible ? <span className="text-warn">{p.reason}</span>
                        : p.kept ? <span><Badge tone="neutral">Kept on historical rates</Badge><div className="mt-0.5 text-[11px] text-faint">{personName(s, p.kept.byId)} · {fmtDate(p.kept.at.slice(0, 10))}</div></span>
                          : p.mode === 'update-draft' ? <>Update draft v{p.estimate.version}</> : <>New draft v{p.preview.version}</>}
                    </td>
                    <td><Button size="sm" variant="ghost" onClick={() => setDetail(p)}>Details</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {!canEdit && <Callout tone="info">Read-only: the estimating team (estimators, estimating lead, administrators) reprices estimates.</Callout>}
      {detail && <PlanDrawer s={s} plan={detail} onClose={() => setDetail(null)} />}
      {confirm && <ConfirmModal kind={confirm} plans={chosen} v={v} before={before} after={after} onClose={() => setConfirm(null)} onConfirm={(note) => confirm === 'reprice' ? doReprice(note) : doKeep(note)} />}
    </div>
  )
}

function ConfirmModal({ kind, plans, v, before, after, onClose, onConfirm }: { kind: 'reprice' | 'keep'; plans: RepricePlan[]; v: number; before: number; after: number; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('')
  const needNote = kind === 'keep'
  const newVersions = plans.filter((p) => p.mode === 'new-version').length
  return (
    <Modal open onClose={onClose} title={kind === 'reprice' ? `Reprice ${plans.length} estimate${plans.length === 1 ? '' : 's'} to rate table v${v}` : `Keep ${plans.length} estimate${plans.length === 1 ? '' : 's'} on historical rates`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={needNote && note.trim().length < 5} onClick={() => onConfirm(note.trim())}>{kind === 'reprice' ? 'Create repriced drafts' : 'Keep historical rates'}</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        {kind === 'reprice' ? <>
          <p>Creates <b>{newVersions}</b> new draft version{newVersions === 1 ? '' : 's'}{plans.length - newVersions ? <> and updates <b>{plans.length - newVersions}</b> open draft{plans.length - newVersions === 1 ? '' : 's'}</> : null}. Totals move from <b>{money(before)}</b> to <b>{money(after)}</b> ({moneyDelta(after - before)}). Each draft routes for approval as usual; nothing changes in a budget until it is approved.</p>
          <ul className="max-h-[180px] overflow-y-auto rounded border border-line text-[12.5px]">{plans.map((p) => <li key={p.estimate.id} className="flex justify-between gap-2 border-b border-line px-3 py-1 last:border-0"><span className="font-mono">{p.project.code} v{p.estimate.version}</span><span className="tabular-nums">{money(p.before.total)} → <b>{money(p.after.total)}</b></span></li>)}</ul>
        </> : <p>Records the decision to leave these estimates on the rate table they were priced with. They stay listed with the decision until the next rate table is published.</p>}
        <Field label={needNote ? 'Reason (required)' : 'Note (optional)'} hint="Recorded in each estimate's audit trail."><TextArea id="rp-note" className="min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={needNote ? 'e.g. Construction is under way on bid prices; the control budget is set' : 'e.g. Q4 rate refresh'} /></Field>
      </div>
    </Modal>
  )
}

function PlanDrawer({ s, plan, onClose }: { s: AppState; plan: RepricePlan; onClose: () => void }) {
  const p = plan
  const rows = p.lines.filter((x) => x.status !== 'unchanged')
  const label = { repriced: 'Repriced', override: 'Override kept', quote: 'Quote / analog / judgment kept', manual: 'Not from the rate table', missing: 'Rate removed — kept', unchanged: 'Unchanged' } as const
  const mk = (t: RepricePlan['before']) => [
    ['Direct cost', t.lines], ['Sales tax', t.tax], ['Loaders', t.loaders], ['Escalation', t.escalation], ['Contingency', t.contingency], ['Total', t.total],
  ] as const
  const b = mk(p.before), a = mk(p.after)
  return (
    <Drawer open onClose={onClose} width={640} title={`${p.project.code} · v${p.estimate.version} → rate table v${s.settings.estimating.rateTableVersion}`}
      footer={<><Button variant="ghost" onClick={() => { onClose(); go(projectHref(p.project.id, 'estimates')) }}>Open project estimates</Button><Button onClick={onClose}>Close</Button></>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="text-muted">{p.project.name} · {p.project.location.district} region · priced on rate table v{p.fromVersion}</div>
        <table className="tbl">
          <thead><tr><th /><th className="num">Before (v{p.estimate.version})</th><th className="num">After</th><th className="num">Change</th></tr></thead>
          <tbody>{b.map(([k, x], i) => { const y = a[i][1]; return <tr key={k}><td className={cx(k === 'Total' && 'font-bold')}>{k}</td><td className="num">{money(x)}</td><td className={cx('num', k === 'Total' && 'font-bold')}>{money(y)}</td><td className={cx('num', y > x ? 'text-bad' : y < x ? 'text-good' : 'text-faint')}>{y === x ? '—' : moneyDelta(y - x)}</td></tr> })}</tbody>
        </table>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div className="rounded border border-line px-3 py-2"><div className="eyebrow">Markups before</div>Loaders {sum(p.estimate.loaders.map((l) => l.pct)).toFixed(1)}% · escalation {p.estimate.escalationPct}% · contingency {p.estimate.contingency.pct}% · tax {p.estimate.salesTax ? `${p.estimate.salesTax.pct}%` : 'not applied'}</div>
          <div className="rounded border border-line px-3 py-2"><div className="eyebrow">Markups after</div>Loaders {sum(p.preview.loaders.map((l) => l.pct)).toFixed(1)}% · escalation {p.preview.escalationPct}% · contingency {p.preview.contingency.pct}%{p.preview.contingency.method === 'risk-based' ? ' (risk-based, kept)' : ''} · tax {p.preview.salesTax?.pct ?? 0}%</div>
        </div>
        <div>
          <h3 className="mb-1 font-display text-[14px] font-bold">Lines that change or are kept ({rows.length} of {p.lines.length})</h3>
          {rows.length ? (
            <div className="scroll-x max-h-[380px] overflow-y-auto rounded border border-line">
              <table className="tbl">
                <thead><tr><th>Line</th><th className="num">Unit cost</th><th className="num">New</th><th>Treatment</th></tr></thead>
                <tbody>{rows.map((x) => <tr key={x.line.id}><td className="text-[12px]"><span className="text-faint">{x.line.workPackage}</span> · {x.line.description}<div className="text-[11px] text-faint">{x.line.qty.toLocaleString('en-US')} {x.line.unit}</div></td><td className="num">{money(x.from, x.from < 1e4 ? 'full' : 'compact')}</td><td className={cx('num', x.to > x.from ? 'text-bad' : x.to < x.from ? 'text-good' : '')}>{money(x.to, x.to < 1e4 ? 'full' : 'compact')}</td><td className="text-[11.5px]">{label[x.status]}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="text-muted">Every line already matches today's table; only markups change.</p>}
        </div>
        {!p.eligible && <Callout tone="warn">{p.reason}</Callout>}
      </div>
    </Drawer>
  )
}

/** Count used for the tab badge. */
export const staleCount = (s: AppState) => repriceCandidates(s).filter((p) => p.eligible && !p.kept).length
