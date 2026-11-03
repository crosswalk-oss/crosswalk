// Reasonableness-review binder (RC-01): one project's evidence assembled live from the store,
// rendered to standalone HTML (numbered sections) and a flat CSV extract. Used by Evidence and Regulatory.
import type { AppState } from '@/core/types'
import { categoryName, personName } from '@/core/store'
import { position, snapshotsFor } from '@/core/engine/position'
import { estimateTotals } from '@/core/engine/estimates'
import { fmtDate, fmtDateTime, money, sum } from '@/core/util'
import { approvalChain, assessEvidence, esc, fingerprint, SNAP_META, snapshotAuthority, stageLabel } from './trace'

const td = (x: unknown, num = false) => `<td${num ? ' class="num"' : ''}>${esc(x)}</td>`
const th = (...h: string[]) => `<tr>${h.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`
const table = (head: string[], rows: string[][], numCols: number[] = []) =>
  rows.length ? `<table>${th(...head)}${rows.map((r) => `<tr>${r.map((c, i) => td(c, numCols.includes(i))).join('')}</tr>`).join('')}</table>` : '<p class="meta">None on record.</p>'

export function binderData(s: AppState, pid: string) {
  const p = s.projects.find((x) => x.id === pid)!
  const prog = s.programs.find((x) => x.id === p.programId)!
  const pos = position(s, pid)
  const ests = s.estimates.filter((e) => e.projectId === pid).sort((a, b) => a.version - b.version)
  const snaps = snapshotsFor(s, pid)
  const changes = s.changes.filter((c) => c.projectId === pid).sort((a, b) => a.code.localeCompare(b.code))
  const variances = s.variances.filter((v) => v.projectId === pid)
  const risks = s.risks.filter((r) => r.projectId === pid)
  const draws = s.contingencyDraws.filter((d) => d.projectId === pid)
  const gates = s.gateDecisions.filter((g) => g.projectId === pid).sort((a, b) => a.date.localeCompare(b.date))
  const recs = s.records.filter((r) => r.projectId === pid)
  const plans = s.safetyPlans.filter((x) => x.projectId === pid)
  const events = s.safetyEvents.filter((x) => x.projectId === pid)
  const tailboards = s.tailboards.filter((x) => x.projectId === pid)
  const assess = assessEvidence(s, pid)
  return { p, prog, pos, ests, snaps, changes, variances, risks, draws, gates, recs, plans, events, tailboards, assess }
}

/** HTML body for one project's binder. `n` prefixes section numbers (program binders nest projects). */
export function projectBinderBody(s: AppState, pid: string, prefix = ''): string {
  const d = binderData(s, pid)
  const { p, prog, pos } = d
  const N = (i: number) => `${prefix}${i}`
  const out: string[] = []
  const realized = d.risks.filter((r) => r.status === 'realized')
  const drawn = pos.contingencyUsed

  out.push(`<h2>${N(1)}. Cover &amp; financial position</h2>`)
  out.push(table(['Item', 'Value'], [
    ['Project', `${p.code} ${p.name}`], ['Program', `${prog.code} — ${prog.name}`], ['Regulatory driver', p.regulatoryCitation],
    ['Proceeding', p.fundingProceeding], ['Recovery mechanism', prog.recovery], ['Stage / status', `${stageLabel(s, p, p.stageIndex)} · ${p.status}`],
    ['Original authorized budget', money(pos.originalBudget, 'full')], ['Current authorized budget', money(pos.currentBudget, 'full')],
    ['Recorded cost to date (ERP actuals)', money(pos.actualToDate, 'full')], ['Open commitments', money(pos.commitments, 'full')],
    ['Forecast at completion (EAC)', money(pos.eac, 'full')], ['Variance to current budget', money(pos.variance, 'full')],
    ['Contingency original / drawn / remaining', `${money(pos.contingencyOriginal, 'full')} / ${money(drawn, 'full')} / ${money(pos.contingencyRemaining, 'full')}`],
    ['Evidence completeness', `${d.assess.score}% (${d.assess.passed} of ${d.assess.checks.length} checks pass)`],
  ]))

  out.push(`<h2>${N(2)}. Estimate history</h2>`)
  out.push(table(['Ver', 'Class', 'Title', 'Status', 'Total', 'Contingency', 'Approved by', 'Approved'], d.ests.map((e) => { const t = estimateTotals(e); return [`v${e.version}`, `Class ${e.cls}`, e.title, e.status, money(t.total, 'full'), `${e.contingency.pct}% (${money(t.contingency)})`, personName(s, e.approvedById), fmtDateTime(e.approvedAt)] }), [4]))
  for (const e of d.ests.filter((e) => e.status !== 'draft')) {
    out.push(`<h3>${N(2)}.${e.version} Basis of estimate — v${e.version}</h3><p><b>Scope basis.</b> ${esc(e.basis.scopeBasis)}</p><p><b>Class justification.</b> ${esc(e.basis.classJustification)}</p><p><b>Contingency rationale.</b> ${esc(e.basis.contingencyRationale)}</p><p><b>Assumptions.</b> ${esc(e.basis.assumptions.join('; ') || 'None recorded')}</p><p><b>Exclusions.</b> ${esc(e.basis.exclusions.join('; ') || 'None recorded')}</p>`)
    const chain = approvalChain(s, e.workflowInstanceId)
    if (chain.length) out.push(table(['When', 'Who', 'Step', 'Action', 'E-signature'], chain.map((c) => [fmtDateTime(c.at), c.actor, c.step, c.action, c.sig ?? ''])))
  }

  out.push(`<h2>${N(3)}. Baselines and their approving decisions</h2>`)
  const bl = d.snaps.filter((x) => x.type !== 'period-close')
  out.push(table(['Date', 'Type', 'Label', 'Budget', 'EAC', 'Contingency left', 'Authority'], bl.map((x) => { const a = snapshotAuthority(s, x); return [fmtDate(x.date), SNAP_META[x.type].label + (x.proceeding ? ` (${x.proceeding})` : ''), x.label, money(x.budget.total, 'full'), money(x.budget.eac, 'full'), money(x.budget.contingencyRemaining, 'full'), `${a.kind}: ${a.text}${a.signers.length ? ' — ' + a.signers.map((g) => g.name + (g.sig ? ` [sig ${g.sig}]` : '')).join('; ') : ''}`] }), [3, 4, 5]))
  out.push(`<p class="meta">${d.snaps.filter((x) => x.type === 'period-close').length} monthly period-close snapshots are also on file.</p>`)

  out.push(`<h2>${N(4)}. Changes and approval chains</h2>`)
  out.push(table(['Code', 'Title', 'Root cause', 'Category', 'Cost', 'Days', 'Funded from', 'Status', 'Decided'], d.changes.map((c) => [c.code, c.title, c.rootCause, categoryName(s, c.categoryId), money(c.costImpact, 'full'), String(c.scheduleImpactDays), c.fundedFrom, c.status, fmtDate(c.decidedAt)]), [4, 5]))
  for (const c of d.changes) {
    const chain = approvalChain(s, c.workflowInstanceId)
    const res = s.snapshots.find((x) => x.id === c.resultingSnapshotId)
    out.push(`<h3>${esc(c.code)} — ${esc(c.title)}</h3><p>${esc(c.description)}${c.scopeImpact && c.scopeImpact !== 'None' ? ` Scope impact: ${esc(c.scopeImpact)}.` : ''}${res ? ` Resulting baseline: <b>${esc(res.label)}</b> (${fmtDate(res.date)}, ${money(res.budget.total, 'full')}).` : ''}${c.riskId ? ` Linked risk: ${esc(s.risks.find((r) => r.id === c.riskId)?.code)}.` : ''}</p>`)
    out.push(table(['When', 'Who', 'Step', 'Action', 'Comment', 'E-signature'], chain.map((x) => [fmtDateTime(x.at), `${x.actor}${x.title ? ', ' + x.title : ''}`, x.step, x.action, x.comment ?? '', x.sig ?? ''])))
  }

  out.push(`<h2>${N(5)}. Variance explanations</h2>`)
  out.push(table(['Date', 'Metric', 'What crossed the threshold', 'Amount', 'Root cause', 'Narrative', 'Linked changes', 'Status'], d.variances.map((v) => [fmtDate(v.date), v.metric.toUpperCase(), v.description, v.metric === 'eac' ? money(v.amount, 'full') : `${v.amount} days`, v.rootCause ?? '', v.narrative || '(not written)', v.changeIds.map((id) => s.changes.find((c) => c.id === id)?.code).join(', '), v.status])))

  out.push(`<h2>${N(6)}. Risks realized vs contingency drawn</h2>`)
  out.push(`<p>Contingency at authorization ${money(pos.contingencyOriginal, 'full')}; drawn ${money(drawn, 'full')} through ${d.changes.filter((c) => c.status === 'approved' && c.fundedFrom === 'contingency').length} approved changes and ${d.draws.filter((x) => x.status === 'approved' && !x.changeId).length} direct draws; remaining ${money(pos.contingencyRemaining, 'full')}. Open risk exposure ${money(pos.riskExposure, 'full')}.</p>`)
  out.push(table(['Risk', 'Title', 'Status', 'Most-likely cost', 'Drawn against it'], realized.map((r) => [r.code, r.title, r.status, money(r.cost.ml, 'full'), money(sum(d.draws.filter((x) => x.riskId === r.id && x.status === 'approved').map((x) => x.amount)) + sum(d.changes.filter((c) => c.riskId === r.id && c.status === 'approved').map((c) => c.costImpact)), 'full')]), [3, 4]))
  out.push(table(['Draw date', 'Amount', 'Reason', 'Risk', 'Status'], d.draws.map((x) => [fmtDate(x.date), money(x.amount, 'full'), x.reason, s.risks.find((r) => r.id === x.riskId)?.code ?? '', x.status]), [1]))

  out.push(`<h2>${N(7)}. Safety record summary</h2>`)
  out.push(table(['Measure', 'Value'], [
    ['Job-specific safety plans', d.plans.map((x) => `${x.workPackage} v${x.version} (${x.status}${x.approvedAt ? ', approved ' + fmtDate(x.approvedAt) : ''})`).join('; ') || 'None'],
    ['Tailboards recorded', String(d.tailboards.length)],
    ['Observations / near misses / incidents', `${d.events.filter((e) => e.type === 'observation').length} / ${d.events.filter((e) => e.type === 'near-miss').length} / ${d.events.filter((e) => e.type === 'incident').length}`],
    ['SIF-potential events', `${d.events.filter((e) => e.sifPotential).length} (${d.events.filter((e) => e.sifPotential && e.status === 'open').length} open)`],
  ]))

  out.push(`<h2>${N(8)}. Records completeness</h2>`)
  const rc = { verified: d.recs.filter((r) => r.status === 'verified').length, attached: d.recs.filter((r) => r.status === 'attached').length, missing: d.recs.filter((r) => r.status === 'missing').length }
  out.push(d.recs.length ? `<p>${d.recs.length} records: ${rc.verified} verified, ${rc.attached} attached awaiting verification, ${rc.missing} missing.</p>` + table(['Type', 'Segment', 'Status', 'File', 'Verified by'], d.recs.filter((r) => r.status !== 'verified').map((r) => [r.type, r.segment, r.status, r.fileName ?? '', personName(s, r.verifiedById)])) : '<p class="meta">No construction records required at this stage.</p>')

  out.push(`<h2>${N(9)}. Gate decisions</h2>`)
  out.push(table(['Date', 'Gate', 'Outcome', 'Readiness', 'Decided by', 'Estimate', 'Notes'], d.gates.map((g) => [fmtDate(g.date), g.gateName, g.outcome, `${g.readiness}%`, g.decidedBy.map((id) => personName(s, id)).join(', '), (() => { const e = s.estimates.find((x) => x.id === g.estimateId); return e ? `v${e.version} Class ${e.cls}` : '' })(), g.notes])))

  out.push(`<h2>${N(10)}. Completeness assessment</h2>`)
  out.push(`<p><b>${d.assess.score}%</b> — ${d.assess.passed} of ${d.assess.checks.length} checks pass. Major checks weigh three times minor checks.</p>`)
  out.push(table(['Area', 'Severity', 'Gap'], d.assess.gaps.map((g) => [g.area, g.severity, g.gap ?? g.label])))
  return out.join('\n')
}

export function projectBinderHtml(s: AppState, pid: string): string {
  const p = s.projects.find((x) => x.id === pid)!
  const body = projectBinderBody(s, pid)
  const me = s.people.find((x) => x.id === s.currentUserId)
  const fp = fingerprint(body)
  return htmlWrap(`Reasonableness review package — ${p.code}`, `<h1>Reasonableness review package</h1><div class="meta">${esc(s.settings.orgName)} · ${esc(p.code)} ${esc(p.name)} · as of ${fmtDate(s.settings.asOf)} · assembled by ${esc(me?.name)} (${esc(me?.title)}) · content fingerprint ${fp}</div><p class="meta">Every figure in this package is generated from the system of record. Section 4 reproduces each change's workflow history, including e-signature references, unaltered.</p>${body}`)
}

function htmlWrap(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font-family:'Public Sans',system-ui,sans-serif;color:#141b24;max-width:980px;margin:40px auto;padding:0 24px;font-size:12.5px;line-height:1.5}
  h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;border-bottom:2px solid #141b24;padding-bottom:4px;margin-top:30px;page-break-after:avoid}h3{font-size:13.5px;margin:18px 0 4px}
  table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d6dce3;padding:4px 7px;text-align:left;vertical-align:top}th{background:#e9ecf0;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.meta{color:#4f5a69}.toc a{color:#14457a}.proj{page-break-before:always}
  @media print{body{margin:0}}</style></head><body>${body}</body></html>`
}

export function programBinderHtml(s: AppState, programId: string, pids: string[]): string {
  const prog = s.programs.find((x) => x.id === programId)!
  const me = s.people.find((x) => x.id === s.currentUserId)
  const rows = pids.map((pid) => { const d = binderData(s, pid); return { pid, d } })
  const toc = rows.map(({ pid, d }, i) => `<tr><td>${i + 1}</td><td><a href="#${esc(pid)}">${esc(d.p.code)}</a></td><td>${esc(d.p.name)}</td><td class="num">${money(d.pos.currentBudget)}</td><td class="num">${money(d.pos.actualToDate)}</td><td class="num">${money(d.pos.eac)}</td><td class="num">${d.assess.score}%</td><td class="num">${d.assess.gaps.length}</td></tr>`).join('')
  const bodies = rows.map(({ pid, d }, i) => `<section class="proj" id="${esc(pid)}"><h1>${i + 1}. ${esc(d.p.code)} ${esc(d.p.name)}</h1>${projectBinderBody(s, pid, `${i + 1}.`)}</section>`).join('\n')
  const fp = fingerprint(bodies)
  return htmlWrap(`Program evidence package — ${prog.code}`, `<h1>Program evidence package — ${esc(prog.code)} ${esc(prog.name)}</h1><div class="meta">${esc(s.settings.orgName)} · ${esc(prog.regulatoryDriver)} · recovery: ${esc(prog.recovery)} · as of ${fmtDate(s.settings.asOf)} · assembled by ${esc(me?.name)} · fingerprint ${fp}</div><h2>Contents</h2><table class="toc"><tr><th>#</th><th>Project</th><th>Name</th><th>Budget</th><th>Recorded</th><th>EAC</th><th>Complete</th><th>Gaps</th></tr>${toc}</table>${bodies}`)
}

/** Flat CSV ledger: one row per evidence record. */
export function evidenceRows(s: AppState, pid: string): Record<string, unknown>[] {
  const d = binderData(s, pid)
  const code = d.p.code
  const rows: Record<string, unknown>[] = []
  const r = (section: string, record: string, date: string | undefined, description: string, amount: number | '', status: string, approver = '', signature = '') => rows.push({ project: code, program: d.prog.code, section, record, date: date ?? '', description, amount, status, approver, signature })
  r('Position', 'Current budget', d.p.dates.initiated, 'Current authorized budget incl. contingency', d.pos.currentBudget, d.p.status)
  r('Position', 'Recorded cost', undefined, 'ERP actuals to date', d.pos.actualToDate, '')
  r('Position', 'EAC', undefined, 'Forecast at completion', d.pos.eac, '')
  for (const e of d.ests) r('Estimate', `v${e.version}`, e.approvedAt?.slice(0, 10), `${e.title} (Class ${e.cls})`, estimateTotals(e).total, e.status, personName(s, e.approvedById))
  for (const x of d.snaps) { const a = snapshotAuthority(s, x); r('Baseline', SNAP_META[x.type].label, x.date, x.label, x.budget.total, a.kind, a.signers.map((g) => g.name).join('; '), a.signers.map((g) => g.sig).filter(Boolean).join(' ')) }
  for (const c of d.changes) {
    const chain = approvalChain(s, c.workflowInstanceId).filter((x) => x.action === 'approve')
    r('Change', c.code, c.decidedAt ?? c.requestedAt, `${c.title} [${c.rootCause}; ${c.fundedFrom}; ${c.scheduleImpactDays} days]`, c.costImpact, c.status, chain.map((x) => `${x.actor} (${x.step})`).join(' > '), chain.map((x) => x.sig).filter(Boolean).join(' '))
  }
  for (const v of d.variances) r('Variance', v.metric, v.date, `${v.description} — ${v.narrative}`, v.metric === 'eac' ? v.amount : '', v.status, personName(s, v.authorId))
  for (const x of d.draws) r('Contingency draw', s.risks.find((k) => k.id === x.riskId)?.code ?? '', x.date, x.reason, x.amount, x.status)
  for (const g of d.gates) r('Gate', g.gateName, g.date, g.notes, '', g.outcome, g.decidedBy.map((id) => personName(s, id)).join('; '))
  for (const k of d.recs) r('Record', k.type, undefined, k.segment, '', k.status, personName(s, k.verifiedById))
  for (const g of d.assess.gaps) r('Gap', g.area, s.settings.asOf, g.gap ?? g.label, '', g.severity)
  return rows
}
