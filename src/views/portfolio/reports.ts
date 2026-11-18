// Generated documents for builder A's module: monthly status report (PI-04) and gate review packet (SG-05).
// Both compose only from records in the store so the printed figures tie to the screen.
import type { AppState, Project } from '@/core/types'
import { personName, categoryName } from '@/core/store'
import { position, nextMilestone } from '@/core/engine/position'
import { readiness, requiredDefs, templateFor, permissions } from '@/core/engine/gates'
import { CLASS_RANGES, estimateTotals } from '@/core/engine/estimates'
import { isActive, riskScore, expectedCost } from '@/core/engine/risk'
import { daysBetween, fmtDate, fmtMonth, money, sum, addDays } from '@/core/util'
import { latestApprovedEstimate, latestEstimate, defById } from './lib'

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rag = (r: string) => `<span class="tag" style="border-color:${r === 'red' ? '#c81e3c' : r === 'amber' ? '#b95400' : '#00823b'};color:${r === 'red' ? '#c81e3c' : r === 'amber' ? '#b95400' : '#00823b'}">${r.toUpperCase()}</span>`
const table = (head: string[], rows: (string | number)[][], numCols: number[] = []) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="num"' : ''}>${typeof c === 'string' && c.startsWith('<') ? c : esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="meta">None</td></tr>`}</tbody></table>`

/** Data the status report and its AI prompt share. */
export function statusFacts(s: AppState, p: Project) {
  const pos = position(s, p.id)
  const t = templateFor(s, p)
  const month = s.settings.asOf.slice(0, 7)
  const periods = s.costPeriods.filter((c) => c.projectId === p.id).sort((a, b) => a.period.localeCompare(b.period))
  const last = periods[periods.length - 1]
  const cumPV = sum(periods.map((c) => c.planned)), cumEV = sum(periods.map((c) => c.earned)), cumAC = sum(periods.map((c) => c.actual))
  const from = addDays(s.settings.asOf, -31)
  const changes = s.changes.filter((c) => c.projectId === p.id && (c.requestedAt >= from || (c.decidedAt ?? '') >= from))
  const risks = s.risks.filter((r) => r.projectId === p.id && isActive(r)).sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5)
  const r = readiness(s, p)
  const events = s.safetyEvents.filter((e) => e.projectId === p.id && e.date >= from)
  const tbs = s.tailboards.filter((x) => x.projectId === p.id && x.date >= from)
  const variances = s.variances.filter((v) => v.projectId === p.id && v.status !== 'accepted')
  const review = s.gateReviews.filter((g) => g.projectId === p.id && g.status === 'scheduled').sort((a, b) => a.scheduled.localeCompare(b.scheduled))[0]
  return { pos, t, month, last, cpi: cumAC ? cumEV / cumAC : undefined, spi: cumPV ? cumEV / cumPV : undefined, changes, risks, r, events, tbs, variances, review, next: nextMilestone(p) }
}

export function statusPrompt(s: AppState, p: Project): string {
  const f = statusFacts(s, p)
  const lines = [
    `Project ${p.code} "${p.name}" (${s.programs.find((x) => x.id === p.programId)?.name}). Stage ${p.stageIndex + 1} of ${f.t.stages.length}: ${f.t.stages[p.stageIndex]?.name}. Status ${p.status}.`,
    `Scope: ${p.scope.summary}`,
    `Health: scope ${p.health.scope}, schedule ${p.health.schedule}, cost ${p.health.cost}, risk ${p.health.risk}, safety ${p.health.safety}.`,
    `Budget (${f.pos.budgetKind ?? 'none'}) ${money(f.pos.currentBudget)}; EAC ${money(f.pos.eac)}; actual to date ${money(f.pos.actualToDate)}; contingency remaining ${money(f.pos.contingencyRemaining)} of ${money(f.pos.contingencyOriginal)}; open risk exposure ${money(f.pos.riskExposure)}.`,
    f.cpi ? `CPI ${f.cpi.toFixed(2)}, SPI ${f.spi?.toFixed(2)}. Latest month ${f.last?.period}: actual ${money(f.last?.actual)}, earned ${money(f.last?.earned)}.` : 'No cost periods yet.',
    `Milestones: ${p.milestones.map((m) => `${m.name} baseline ${m.baseline}, forecast ${m.forecast}${m.actual ? `, actual ${m.actual}` : ''}`).join('; ')}.`,
    `Changes in last 30 days: ${f.changes.map((c) => `${c.code} ${c.title} ${money(c.costImpact)} ${c.status}`).join('; ') || 'none'}.`,
    `Top risks: ${f.risks.map((r) => `${r.code} ${r.title} (score ${riskScore(r)}, ${r.status})`).join('; ') || 'none'}.`,
    `Gate readiness ${f.r.pct}%; blockers: ${f.r.blockers.join('; ') || 'none'}. Next gate review ${f.review ? f.review.scheduled : 'not scheduled'}.`,
    `Safety last 30 days: ${f.tbs.length} tailboards, ${f.events.length} events (${f.events.filter((e) => e.sifPotential).length} SIF-potential).`,
    `Open variances: ${f.variances.map((v) => `${v.description} (${v.status})`).join('; ') || 'none'}.`,
    p.lastStatusNote ? `Last month's PM note: ${p.lastStatusNote}` : '',
  ]
  return `You are drafting the project manager's narrative for a gas utility capital project's monthly status report. Use ONLY the facts below; do not invent numbers, names or dates.

${lines.filter(Boolean).join('\n')}

Write 3 short paragraphs of plain text (no headings, no markdown, no bullet characters), 120–180 words total:
1) Progress this period and where the project stands against plan.
2) Cost and schedule position, naming the drivers of any variance and the changes or risks behind them.
3) Look-ahead: next milestone, gate readiness actions, and any decisions needed from the sponsor.
Write in first person plural ("we"), factual and specific, as a PM would for a director audience.`
}

export function statusReportHtml(s: AppState, p: Project, narrative: string): string {
  const f = statusFacts(s, p)
  const prog = s.programs.find((x) => x.id === p.programId)
  const body = `
  <div class="meta">${esc(s.settings.orgName)} · Monthly project status report · ${esc(fmtMonth(f.month))}</div>
  <h1>${esc(p.code)} · ${esc(p.name)}</h1>
  <div class="meta">${esc(prog?.code)} ${esc(prog?.name)} · Stage ${p.stageIndex + 1} of ${f.t.stages.length}: ${esc(f.t.stages[p.stageIndex]?.name)} · PM ${esc(personName(s, p.team.pm))} · Sponsor ${esc(personName(s, p.team.sponsor))} · Prepared ${esc(fmtDate(s.settings.asOf))}</div>
  <h2>Health</h2>
  <p>Scope ${rag(p.health.scope)} &nbsp; Schedule ${rag(p.health.schedule)} &nbsp; Cost ${rag(p.health.cost)} &nbsp; Risk ${rag(p.health.risk)} &nbsp; Safety ${rag(p.health.safety)}</p>
  <h2>Project manager narrative</h2>
  ${narrative.trim() ? narrative.trim().split(/\n\s*\n/).map((x) => `<p>${esc(x)}</p>`).join('') : '<p class="meta">No narrative entered.</p>'}
  <h2>Financial position</h2>
  ${table(['Measure', 'Amount'], [
    [`Current budget (${f.pos.budgetKind ?? 'none'})`, money(f.pos.currentBudget, 'full')], ['Original budget', money(f.pos.originalBudget, 'full')], ['Forecast at completion (EAC)', money(f.pos.eac, 'full')],
    ['Variance (budget − EAC)', money(f.pos.variance, 'full')], ['Actual to date', money(f.pos.actualToDate, 'full')], ['Open commitments', money(f.pos.commitments, 'full')],
    ['Contingency remaining', `${money(f.pos.contingencyRemaining, 'full')} of ${money(f.pos.contingencyOriginal, 'full')}`], ['Open risk exposure (expected value)', money(f.pos.riskExposure, 'full')],
    ...(f.cpi ? [['CPI / SPI (cumulative)', `${f.cpi.toFixed(2)} / ${f.spi?.toFixed(2)}`] as [string, string]] : []),
  ], [1])}
  <h2>Milestones</h2>
  ${table(['Milestone', 'Baseline', 'Forecast', 'Actual', 'Slip (days)'], p.milestones.map((m) => [m.name, m.baseline, m.forecast, m.actual ?? '', daysBetween(m.baseline, m.actual ?? m.forecast)]), [4])}
  <h2>Changes (last 30 days)</h2>
  ${table(['Change', 'Title', 'Root cause', 'Cost', 'Days', 'Status'], f.changes.map((c) => [c.code, c.title, c.rootCause, money(c.costImpact, 'full'), c.scheduleImpactDays, c.status]), [3, 4])}
  <h2>Top risks</h2>
  ${table(['Risk', 'Title', 'Score', 'Expected cost', 'Owner', 'Status'], f.risks.map((r) => [r.code, r.title, riskScore(r), money(Math.round(expectedCost(r)), 'full'), personName(s, r.ownerId), r.status]), [2, 3])}
  <h2>Gate readiness</h2>
  <p>${f.r.pct}% of required deliverables accepted for ${esc(f.t.stages[p.stageIndex]?.gate.name)}. ${f.review ? `Gate review scheduled ${esc(fmtDate(f.review.scheduled))}.` : 'No gate review scheduled.'}</p>
  ${f.r.blockers.length ? `<ul>${f.r.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  <h2>Safety (last 30 days)</h2>
  <p>${f.tbs.length} tailboards recorded; ${f.events.length} safety events (${f.events.filter((e) => e.type === 'near-miss').length} near misses, ${f.events.filter((e) => e.sifPotential).length} with SIF potential).</p>
  ${f.variances.length ? `<h2>Open variance explanations</h2>${table(['Variance', 'Status', 'Narrative'], f.variances.map((v) => [v.description, v.status, v.narrative || '—']))}` : ''}
  <p class="meta" style="margin-top:32px">Generated by Crosswalk from project records as of ${esc(fmtDate(s.settings.asOf))}. Figures tie to the approved budget, the latest locked forecast and ERP cost periods.</p>`
  return body
}

/** Gate review packet (SG-05): charter facts, estimate & class, milestones, top 10 risks, changes, deliverable evidence. */
export function gatePacketHtml(s: AppState, p: Project): string {
  const t = templateFor(s, p)
  const st = t.stages[p.stageIndex]
  const r = readiness(s, p)
  const pos = position(s, p.id)
  const est = latestApprovedEstimate(s, p.id)
  const draftEst = latestEstimate(s, p.id)
  const e = est ?? draftEst
  const tot = e ? estimateTotals(e) : undefined
  const defs = requiredDefs(s, p)
  const dls = s.deliverables.filter((d) => d.projectId === p.id && d.stageIndex === p.stageIndex)
  const risks = s.risks.filter((x) => x.projectId === p.id && isActive(x)).sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 10)
  const changes = s.changes.filter((c) => c.projectId === p.id)
  const prior = s.gateDecisions.filter((g) => g.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date))
  const prog = s.programs.find((x) => x.id === p.programId)
  const perms = Array.from(permissions(s, p))
  return `
  <div class="meta">${esc(s.settings.orgName)} · Gate review packet · prepared ${esc(fmtDate(s.settings.asOf))}</div>
  <h1>${esc(st?.gate.name)}</h1>
  <h3 style="margin-top:2px">${esc(p.code)} · ${esc(p.name)}</h3>
  <p><b>Readiness ${r.pct}%</b> (${r.done} of ${r.total} deliverables accepted or waived) · Estimate requirement: ${st?.gate.requiredEstimateClass ? `Class ${st.gate.requiredEstimateClass} or better — ${r.estimateOk ? 'met' : 'NOT met'}` : 'none'} · Decision roles: ${esc(st?.gate.decisionRoles.map((x) => s.roles.find((y) => y.id === x)?.name ?? x).join(', '))}</p>
  ${r.blockers.length ? `<p><b>Open blockers:</b></p><ul>${r.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '<p>No blockers: the project meets all gate criteria.</p>'}
  <h2>1. Charter facts</h2>
  ${table(['Item', 'Value'], [
    ['Program', `${prog?.code} ${prog?.name}`], ['Driver', p.driver], ['Regulatory citation', p.regulatoryCitation], ['Funding proceeding / recovery', `${p.fundingProceeding} (${prog?.recovery})`],
    ['Sponsor', personName(s, p.team.sponsor)], ['Project manager', personName(s, p.team.pm)], ['Asset', `Line ${p.asset.lineId} · ${p.asset.diameterIn ? p.asset.diameterIn + '" · ' : ''}${p.asset.lengthFt ? p.asset.lengthFt.toLocaleString() + ' ft · ' : ''}MAOP ${p.asset.maopPsig} psig · ${p.asset.material} · ${p.asset.vintage}`],
    ['Location', `${p.location.city}, ${p.location.district} district · Class ${p.location.classLocation}${p.location.hca ? ' · HCA' : ''}${p.location.dac ? ' · DAC' : ''}`], ['Scope', p.scope.summary],
    ['In scope', p.scope.inScope.join('; ')], ['Out of scope', p.scope.outOfScope.join('; ')], ['Quantities', p.scope.quantities.map((q) => `${q.label}: ${q.qty.toLocaleString()} ${q.unit}`).join('; ')], ['Assumptions', p.scope.assumptions.join('; ')],
    ['Permissions in force', perms.join(', ') || 'none'],
  ])}
  <h2>2. Estimate & class</h2>
  ${e && tot ? `<p>${esc(e.title)} v${e.version} · <b>Class ${e.cls}</b> · status <b>${esc(e.status)}</b>${e.approvedAt ? ` (approved ${esc(fmtDate(e.approvedAt.slice(0, 10)))} by ${esc(personName(s, e.approvedById))})` : ''}</p>
  ${table(['Measure', 'Amount'], [['Point estimate', money(tot.total, 'full')], [`Expected range (${Math.round(CLASS_RANGES[e.cls].low * 100)}% / +${Math.round(CLASS_RANGES[e.cls].high * 100)}%)`, `${money(tot.low, 'full')} – ${money(tot.high, 'full')}`], ['Base (direct + loaders + escalation)', money(tot.base, 'full')], [`Contingency (${e.contingency.method}, ${e.contingency.pct}%)`, money(tot.contingency, 'full')], ['Current budget', money(pos.currentBudget, 'full')], ['Forecast (EAC)', money(pos.eac, 'full')]], [1])}
  ${table(['Cost category', 'Amount'], Object.entries(tot.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => [categoryName(s, k), money(v, 'full')]), [1])}
  <p><b>Basis:</b> ${esc(e.basis.classJustification)} <b>Contingency:</b> ${esc(e.basis.contingencyRationale)}</p>
  ${!est ? '<p><b>Note:</b> no approved estimate; the latest draft is shown.</p>' : ''}` : '<p class="meta">No estimate on file.</p>'}
  <h2>3. Schedule milestones</h2>
  ${table(['Milestone', 'Baseline', 'Forecast', 'Actual', 'Slip (days)'], p.milestones.map((m) => [m.name, m.baseline, m.forecast, m.actual ?? '', daysBetween(m.baseline, m.actual ?? m.forecast)]), [4])}
  <h2>4. Top 10 risks</h2>
  ${table(['Risk', 'Title', 'L×C', 'Prob.', 'Most likely', 'Expected', 'Response', 'Owner'], risks.map((x) => [x.code, x.title, `${x.likelihood}×${x.consequence}=${riskScore(x)}`, `${Math.round(x.probability * 100)}%`, money(x.cost.ml, 'full'), money(Math.round(expectedCost(x)), 'full'), x.responses.map((rr) => rr.action).join('; ') || 'NONE', personName(s, x.ownerId)]), [2, 3, 4, 5])}
  <h2>5. Changes</h2>
  ${table(['Change', 'Title', 'Type', 'Root cause', 'Cost', 'Days', 'Funded from', 'Status'], changes.map((c) => [c.code, c.title, c.type, c.rootCause, money(c.costImpact, 'full'), c.scheduleImpactDays, c.fundedFrom, c.status]), [4, 5])}
  <h2>6. Deliverables & evidence</h2>
  ${table(['Deliverable', 'Status', 'Version', 'Owner', 'Reviewer', 'Evidence', 'Acceptance criteria'], defs.map((def) => {
    const d = dls.find((x) => x.defId === def.id)
    return [def.name, d?.status ?? 'not-started', d?.version ?? 0, personName(s, d?.ownerId), personName(s, d?.reviewerId), d?.evidence.map((ev) => `${ev.name} (${ev.sizeKb} KB)`).join('; ') || '—', def.acceptance + (d?.waiverReason ? ` — WAIVED: ${d.waiverReason}` : '')]
  }), [2])}
  <h2>7. Prior gate decisions</h2>
  ${table(['Gate', 'Date', 'Outcome', 'Readiness', 'Decided by', 'Notes'], prior.map((g) => [g.gateName, g.date, g.outcome, `${g.readiness}%`, g.decidedBy.map((x) => personName(s, x)).join(', '), g.notes]), [3])}
  <p class="meta" style="margin-top:32px">Assembled by Crosswalk from live records. Deliverable versions listed here are recorded with the gate decision so the board's basis is reproducible.</p>`
}

export { defById }
