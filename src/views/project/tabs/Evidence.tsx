// Reasonableness-review package (RC-01): assembled live from the records, with a completeness score
// and the gaps a reviewer would find. Downloads as a numbered HTML binder and a CSV extract.
import { useMemo, useState } from 'react'
import { mutate, useStore, personName, categoryName } from '@/core/store'
import { estimateTotals } from '@/core/engine/estimates'
import { saveFile, toCSV } from '@/core/download'
import { go, projectHref } from '@/core/router'
import { fmtDate, fmtDateTime, money, moneyDelta, sum, cx } from '@/core/util'
import { Avatar, Badge, Button, Callout, ClassBadge, KV, Panel, Progress, StatusBadge, Table, Mono, Section } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { binderData, evidenceRows, projectBinderHtml } from './controls/binder'
import { approvalChain, setFocusChange, setFocusSnapshot, SNAP_META, snapshotAuthority, stageLabel, type Check } from './controls/trace'

export default function Evidence({ projectId }: { projectId: string }) {
  const s = useStore()
  const d = useMemo(() => binderData(s, projectId), [s, projectId])
  const { p, prog, pos, assess } = d
  const [showAll, setShowAll] = useState(false)
  const lastExport = [...s.audit].reverse().find((a) => a.entity === 'evidence' && a.entityId === projectId)

  const dl = async (kind: 'html' | 'csv') => {
    const r = kind === 'html' ? await saveFile(`${p.code}-reasonableness-package-${s.settings.asOf}.html`, projectBinderHtml(s, projectId), 'text/html') : await saveFile(`${p.code}-evidence-extract-${s.settings.asOf}.csv`, toCSV(evidenceRows(s, projectId)), 'text/csv')
    if (r === 'saved') {
      mutate(() => {}, { entity: 'evidence', entityId: projectId, projectId, action: 'export', summary: `Downloaded ${kind === 'html' ? 'reasonableness binder' : 'evidence CSV'} (${assess.score}% complete, ${assess.gaps.length} gaps)` })
      toast(kind === 'html' ? 'Binder saved' : 'CSV extract saved')
    } else if (r === 'unavailable') toast('Download is not available here', 'bad')
  }

  const byArea = Object.entries(assess.checks.reduce<Record<string, Check[]>>((a, c) => { (a[c.area] ||= []).push(c); return a }, {}))
  const drawnChanges = d.changes.filter((c) => c.status === 'approved' && c.fundedFrom === 'contingency')
  const realized = d.risks.filter((r) => r.status === 'realized')
  const tone = assess.score >= 90 ? 'good' : assess.score >= 75 ? 'warn' : 'bad'
  let n = 0
  const H = (t: string) => `${++n}. ${t}`

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Reasonableness review package" subtitle={`Assembled live from ${p.code}'s records as of ${fmtDate(s.settings.asOf)}. Nothing here is typed in — every line links to its source.`}
        actions={<><Button onClick={() => dl('csv')} icon={<Icon name="download" className="h-4 w-4" />}>CSV extract</Button><Button variant="primary" onClick={() => dl('html')} icon={<Icon name="download" className="h-4 w-4" />}>Download binder</Button></>}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-2">
            <div className="eyebrow">Completeness</div>
            <div className={cx('font-display text-[44px] font-bold leading-none tabular-nums', tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : 'text-bad')}>{assess.score}%</div>
            <Progress value={assess.score} tone={tone} />
            <div className="text-xs text-muted">{assess.passed} of {assess.checks.length} checks pass · {assess.gaps.filter((g) => g.severity === 'major').length} major gaps · {assess.gaps.filter((g) => g.severity === 'minor').length} minor</div>
            {lastExport && <div className="text-xs text-faint">Last downloaded {fmtDateTime(lastExport.at)} by {personName(s, lastExport.actorId)}</div>}
            <div className="mt-2 flex flex-col gap-1">
              {byArea.map(([area, cs]) => { const ok = cs.filter((c) => c.ok).length; return <div key={area} className="flex items-center justify-between gap-2 text-[12px]"><span>{area}</span><span className={cx('tabular-nums', ok === cs.length ? 'text-good' : 'text-warn')}>{ok}/{cs.length}</span></div> })}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between"><h3 className="eyebrow">{assess.gaps.length ? `Gaps a reviewer would find (${assess.gaps.length})` : 'No gaps found'}</h3><Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show gaps only' : `Show all ${assess.checks.length} checks`}</Button></div>
            {assess.gaps.length === 0 && !showAll && <Callout tone="good">Every change, baseline, estimate and variance on {p.code} traces to an approved decision with its evidence.</Callout>}
            <ul className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
              {(showAll ? assess.checks : assess.gaps).map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-3 py-1.5 text-[13px]">
                  <span className={cx('mt-0.5 shrink-0', c.ok ? 'text-good' : c.severity === 'major' ? 'text-bad' : 'text-warn')}><Icon name={c.ok ? 'check' : 'alert'} className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">{c.ok ? c.label : c.gap}<span className="ml-1.5 text-xs text-faint">{c.area}{!c.ok && ` · ${c.severity}`}</span></span>
                  {!c.ok && c.tab && <a href={projectHref(projectId, c.tab)} className="shrink-0 text-xs font-semibold text-link hover:underline">Fix</a>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title={H('Cover')}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_2fr]">
          <KV cols={2} items={[
            ['Project', <span><Mono className="font-semibold">{p.code}</Mono> {p.name}</span>], ['Program', `${prog.code} — ${prog.name}`],
            ['Regulatory driver', p.regulatoryCitation], ['Proceeding', p.fundingProceeding],
            ['Recovery mechanism', prog.recovery], ['Stage / status', `${stageLabel(s, p, p.stageIndex)} · ${p.status}`],
            ['Sponsor', personName(s, p.team.sponsor)], ['Project manager', personName(s, p.team.pm)],
          ]} />
          <div className="flex flex-col gap-1.5 rounded-md border border-line p-3 text-[13px]">
            <Row k="Original authorized" v={money(pos.originalBudget, 'full')} />
            <Row k="Approved changes" v={moneyDelta(pos.approvedChanges)} />
            <Row k="Current authorized" v={money(pos.currentBudget, 'full')} strong />
            <Row k="Recorded to date (ERP)" v={money(pos.actualToDate, 'full')} />
            <Row k="Forecast at completion" v={money(pos.eac, 'full')} strong />
            <Row k="Recorded vs authorized" v={pos.currentBudget ? `${((pos.actualToDate / pos.currentBudget) * 100).toFixed(1)}%` : '—'} />
            <Row k="Forecast vs authorized" v={moneyDelta(pos.eac - pos.currentBudget)} tone={pos.eac > pos.currentBudget ? 'bad' : 'good'} />
          </div>
        </div>
      </Panel>

      <Panel title={H('Estimate history')} subtitle="Each estimate version, its AACE class, and who approved it" pad={false}>
        <Table rows={d.ests} rowKey={(e) => e.id} empty={<p className="p-4 text-[13px] text-muted">No estimates yet.</p>} columns={[
          { key: 'v', header: 'Version', render: (e) => <span className="flex items-center gap-2"><Mono>v{e.version}</Mono><ClassBadge cls={e.cls} /></span> },
          { key: 't', header: 'Title', render: (e) => <span className="block min-w-[180px]">{e.title}<span className="block text-xs text-muted">{e.method} · {e.lines.length} lines · contingency {e.contingency.pct}% {e.contingency.method}</span></span> },
          { key: 'tot', header: 'Total', num: true, render: (e) => money(estimateTotals(e).total) },
          { key: 'st', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
          { key: 'ap', header: 'Approved by', render: (e) => (e.approvedById ? <span className="text-[12px]">{personName(s, e.approvedById)}<span className="block text-faint">{fmtDateTime(e.approvedAt)}</span></span> : <span className="text-faint">—</span>) },
          { key: 'boe', header: 'Basis of estimate', render: (e) => <span className="text-xs text-muted">{e.basis.assumptions.length} assumptions · {e.basis.exclusions.length} exclusions</span> },
          { key: 'sig', header: 'Chain', render: (e) => <span className="text-xs">{approvalChain(s, e.workflowInstanceId).filter((x) => x.sig).length} e-signatures</span> },
        ]} />
      </Panel>

      <Panel title={H('Baselines and approving decisions')} subtitle="Original, Current, gate and regulatory snapshots — monthly period closes omitted here, included in the binder count" pad={false}>
        <Table rows={d.snaps.filter((x) => x.type !== 'period-close')} rowKey={(x) => x.id} dense onRowClick={(x) => { setFocusSnapshot(x.id); go(projectHref(projectId, 'baselines')) }} empty={<p className="p-4 text-[13px] text-muted">No baselines yet.</p>} columns={[
          { key: 'd', header: 'Date', render: (x) => fmtDate(x.date), width: 110 },
          { key: 't', header: 'Type', render: (x) => <Badge tone={SNAP_META[x.type].tone === 'ink' ? 'ink' : SNAP_META[x.type].tone}>{SNAP_META[x.type].label}</Badge> },
          { key: 'l', header: 'Snapshot', render: (x) => <span className="block min-w-[180px]">{x.label}</span> },
          { key: 'b', header: 'Budget', num: true, render: (x) => money(x.budget.total) },
          { key: 'a', header: 'Approving decision', render: (x) => { const a = snapshotAuthority(s, x); return <span className="block min-w-[240px] text-[12px]"><b className={a.kind === 'Gate decision' || a.kind === 'Approved change' ? 'text-good' : 'text-ink'}>{a.kind}</b> · {a.text}{a.signers.length > 0 && <span className="block text-faint">{a.signers.map((g) => g.name + (g.sig ? ` · sig ${g.sig.slice(0, 8)}` : '')).join('; ')}</span>}</span> } },
        ]} />
      </Panel>

      <Panel title={H('Changes and approval chains')} subtitle="Every signature on every change, in order" >
        {d.changes.length ? (
          <div className="flex flex-col gap-3">
            {d.changes.map((c) => {
              const chain = approvalChain(s, c.workflowInstanceId)
              return (
                <div key={c.id} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken/50 px-3 py-2 text-[13px]">
                    <a href={projectHref(projectId, 'changes')} onClick={() => setFocusChange(c.id)} className="font-mono text-[12px] font-semibold text-link hover:underline">{c.code}</a>
                    <span className="min-w-0 flex-1 font-semibold">{c.title}</span>
                    <span className="text-xs text-muted">{c.rootCause} · {categoryName(s, c.categoryId)} · {c.fundedFrom.replace('-', ' ')}</span>
                    <b className={cx('tabular-nums', c.costImpact > 0 ? 'text-bad' : 'text-good')}>{moneyDelta(c.costImpact)}</b>
                    <StatusBadge status={c.status} />
                  </div>
                  <ol className="flex flex-col px-3 py-1.5">
                    {chain.map((x, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-x-2 py-1 text-[12.5px]">
                        {x.actorId !== 'system' ? <Avatar name={x.actor} size={18} /> : <span className="inline-block h-[18px] w-[18px]" />}
                        <b>{x.actor}</b><span className="text-muted">{x.title}</span><span className="text-muted">· {x.step} · {x.action}</span>
                        {x.sig && <Badge tone="good">e-signed <Mono className="text-[10.5px]">{x.sig}</Mono></Badge>}
                        <span className="ml-auto text-xs text-faint">{fmtDateTime(x.at)}</span>
                      </li>
                    ))}
                    {!chain.length && <li className="py-1 text-[12.5px] text-bad">No workflow history on record.</li>}
                  </ol>
                </div>
              )
            })}
          </div>
        ) : <p className="text-[13px] text-muted">No changes on record.</p>}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={H('Variance explanations')} pad={false}>
          <Table rows={d.variances} rowKey={(v) => v.id} dense empty={<p className="p-4 text-[13px] text-muted">No threshold breaches have required an explanation.</p>} columns={[
            { key: 'd', header: 'Variance', render: (v) => <span className="block min-w-[200px]">{v.description}<span className="block text-xs text-muted">{v.narrative || 'Narrative not yet written'}</span></span> },
            { key: 'r', header: 'Root cause', render: (v) => v.rootCause ?? '—' },
            { key: 'c', header: 'Changes', render: (v) => <span className="font-mono text-[11.5px]">{v.changeIds.map((id) => s.changes.find((c) => c.id === id)?.code).join(', ') || '—'}</span> },
            { key: 's', header: 'Status', render: (v) => <StatusBadge status={v.status} /> },
          ]} />
        </Panel>
        <Panel title={H('Risks realized vs contingency drawn')}>
          <div className="mb-3 grid grid-cols-3 gap-2 text-[13px]">
            <Fig k="Contingency at authorization" v={money(pos.contingencyOriginal)} />
            <Fig k="Drawn" v={money(pos.contingencyUsed)} sub={`${drawnChanges.length} changes · ${d.draws.filter((x) => x.status === 'approved' && !x.changeId).length} draws`} />
            <Fig k="Remaining" v={money(pos.contingencyRemaining)} tone={pos.contingencyRemaining < 0 ? 'bad' : undefined} />
          </div>
          <Table rows={[...realized.map((r) => ({ id: r.id, kind: 'Realized risk', ref: r.code, text: r.title, amt: sum(d.draws.filter((x) => x.riskId === r.id && x.status === 'approved').map((x) => x.amount)) + sum(d.changes.filter((c) => c.riskId === r.id && c.status === 'approved').map((c) => c.costImpact)), ml: r.cost.ml })), ...drawnChanges.filter((c) => !c.riskId).map((c) => ({ id: c.id, kind: 'Change (no risk link)', ref: c.code, text: c.title, amt: c.costImpact, ml: 0 }))]} rowKey={(x) => x.id} dense empty={<p className="text-[13px] text-muted">No contingency drawn.</p>} columns={[
            { key: 'k', header: 'Source', render: (x) => <span className="text-[12px]">{x.kind}<span className="block font-mono text-faint">{x.ref}</span></span> },
            { key: 't', header: 'Description', render: (x) => <span className="text-[12.5px]">{x.text}</span> },
            { key: 'ml', header: 'Risk ML', num: true, render: (x) => (x.ml ? money(x.ml) : '—') },
            { key: 'a', header: 'Drawn', num: true, render: (x) => money(x.amt) },
          ]} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={H('Safety record')}>
          <KV cols={1} items={[
            ['Safety plans', d.plans.length ? d.plans.map((x) => <div key={x.id}>{x.workPackage} v{x.version} <StatusBadge status={x.status} />{x.approvedAt && <span className="text-xs text-muted"> · approved {fmtDate(x.approvedAt)}</span>}</div>) : 'None required yet'],
            ['Tailboards', `${d.tailboards.length} recorded${d.tailboards.length ? `, last ${fmtDate(d.tailboards.map((t) => t.date).sort().pop())}` : ''}`],
            ['Events', `${d.events.filter((e) => e.type === 'observation').length} observations · ${d.events.filter((e) => e.type === 'near-miss').length} near misses · ${d.events.filter((e) => e.type === 'incident').length} incidents`],
            ['SIF potential', `${d.events.filter((e) => e.sifPotential).length} (${d.events.filter((e) => e.sifPotential && e.status === 'open').length} open)`],
          ]} />
        </Panel>
        <Panel title={H('Records completeness')}>
          {d.recs.length ? (() => {
            const v = d.recs.filter((r) => r.status === 'verified').length, a = d.recs.filter((r) => r.status === 'attached').length, m = d.recs.length - v - a
            return (
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex h-3 overflow-hidden rounded-sm bg-sunken"><span className="bg-good" style={{ width: `${(v / d.recs.length) * 100}%` }} /><span className="bg-info/60" style={{ width: `${(a / d.recs.length) * 100}%` }} /><span className="bg-bad/70" style={{ width: `${(m / d.recs.length) * 100}%` }} /></div>
                <div className="flex flex-wrap gap-x-4 text-xs text-muted"><span><b className="text-good">{v}</b> verified</span><span><b className="text-info">{a}</b> attached</span><span><b className="text-bad">{m}</b> missing</span></div>
                <ul className="text-[12.5px] text-muted">{d.recs.filter((r) => r.status === 'missing').slice(0, 5).map((r) => <li key={r.id}>Missing: {r.type} — {r.segment}</li>)}</ul>
                <a href={projectHref(projectId, 'records')} className="text-xs font-semibold text-link hover:underline">Open records</a>
              </div>
            )
          })() : <p className="text-[13px] text-muted">Construction records are required from the construction stage.</p>}
        </Panel>
        <Panel title={H('Gate decisions')} pad={false}>
          <Table rows={d.gates} rowKey={(g) => g.id} dense empty={<p className="p-4 text-[13px] text-muted">No gates passed yet.</p>} columns={[
            { key: 'g', header: 'Gate', render: (g) => <span className="text-[12.5px]">{g.gateName}<span className="block text-faint">{fmtDate(g.date)} · {g.decidedBy.map((id) => personName(s, id)).join(', ')}</span></span> },
            { key: 'o', header: 'Outcome', render: (g) => <StatusBadge status={g.outcome} /> },
            { key: 'r', header: 'Ready', num: true, render: (g) => `${g.readiness}%` },
          ]} />
        </Panel>
      </div>
    </div>
  )
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className={cx('tabular-nums', strong && 'font-bold', tone === 'bad' && 'text-bad', tone === 'good' && 'text-good')}>{v}</span></div>
}
function Fig({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'bad' }) {
  return <div className="min-w-0 rounded-md border border-line px-2.5 py-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{k}</div><div className={cx('font-display text-[17px] font-bold tabular-nums', tone === 'bad' && 'text-bad')}>{v}</div>{sub && <div className="text-[11px] text-muted">{sub}</div>}</div>
}

