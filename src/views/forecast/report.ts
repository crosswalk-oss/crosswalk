// Standalone HTML report for one forecast version: ETC/EAC by function and line item with profiles, monthly spread,
// change from the prior approved version and the review history.
import type { AppState, Forecast, Project } from '@/core/types'
import { budgetByFunction, spreadByMonth } from '@/core/engine/wbs'
import { personName } from '@/core/store'
import { fmtDate, fmtMonth, money, sum } from '@/core/util'
import { htmlDoc } from '@/core/download'
import { lineGridOf } from '@/core/engine/lines'
import { compareVersions, etcEacAt, fnRefs, priorApproved, profileName, statusOf, versionCutoff, type Spread } from './lib'

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const $ = (n: number) => money(n, 'full')
const td = (n: number, bold = false) => `<td class="num">${bold ? '<b>' : ''}${n ? $(n) : '–'}${bold ? '</b>' : ''}</td>`

export function forecastReportHtml(s: AppState, p: Project, f: Forecast): string {
  const spread: Spread = f.spread ?? {}
  const held = f.contingencyHeld ?? 0
  const fns = fnRefs(s, spread)
  const bud = budgetByFunction(s, p.id)
  const cut = versionCutoff(s, f)
  const ee = etcEacAt(s, p, { ...f, lineSpread: f.lineSpread ?? lineGridOf(s, p, f) }, cut)
  const actT = ee.totals.actual
  const etcT = ee.totals.etc + held
  const eac = ee.totals.eac
  const months = Object.keys(spreadByMonth(spread)).sort()
  const years = Array.from(new Set(months.map((m) => m.slice(0, 4)))).sort()
  const yr = (fn: string, y: string) => sum(Object.entries(spread[fn] ?? {}).filter(([m]) => m.startsWith(y)).map(([, v]) => v))
  const prior = priorApproved(s, p.id, f.id)
  const cmp = prior ? compareVersions(s, prior, { ...f, spread, contingencyHeld: held, eac }) : undefined
  const inst = s.workflows.find((w) => w.id === f.workflowInstanceId)

  const grid = lineGridOf(s, p, f)
  const lyr = (lid: string, y: string) => sum(Object.entries(grid[lid] ?? {}).filter(([m]) => m.startsWith(y)).map(([, v]) => v))
  const prof = (fnId: string) => { const x = f.profiles?.[fnId]; return x ? `${esc(profileName(s, x.profileId))}<br><span class="meta">${fmtMonth(x.start)} – ${fmtMonth(x.end)}${x.adjusted ? ' · adjusted' : ''}</span>` : '<span class="meta">—</span>' }
  const pctS = (a: number, e: number) => (e ? `${Math.round((a / e) * 100)}%` : '—')
  const fnTable = `<table><thead><tr><th>Code</th><th>WBS function · line item</th><th>Profile</th><th>Budget</th><th>Actual to date</th>${years.map((y) => `<th>${y} ETC</th>`).join('')}<th>ETC</th><th>EAC</th><th>VAC</th><th>% spent</th></tr></thead><tbody>
${ee.rows.map((r) => `<tr><td><b>${r.code}</b></td><td><b>${esc(r.name)}</b></td><td>${prof(r.fnId)}</td>${td(r.budget, true)}${td(r.actual, true)}${years.map((y) => td(yr(r.fnId, y), true)).join('')}${td(r.etc, true)}${td(r.eac, true)}<td class="num"${r.vac < 0 ? ' style="color:#c02828"' : ''}><b>${$(r.vac)}</b></td><td class="num">${pctS(r.actual, r.eac)}</td></tr>
${r.lines.map((l) => `<tr><td>${l.line.code}</td><td>&nbsp;&nbsp;${esc(l.line.name)}</td><td></td>${td(l.budget)}${td(l.actual)}${years.map((y) => td(lyr(l.line.id, y))).join('')}${td(l.etc)}${td(l.eac)}<td class="num"${l.vac < 0 ? ' style="color:#c02828"' : ''}>${$(l.vac)}</td><td class="num">${pctS(l.actual, l.eac)}</td></tr>`).join('\n')}`).join('\n')}
<tr><td>990</td><td>Contingency held</td><td></td>${td(bud.contingency)}<td class="num">–</td>${years.map(() => '<td></td>').join('')}${td(held)}${td(held)}${td(bud.contingency - held)}<td></td></tr>
<tr><td></td><td><b>Total</b></td><td></td>${td(ee.totals.budget, true)}${td(ee.totals.actual, true)}${years.map((y) => td(sum(fns.map((x) => yr(x.id, y))), true)).join('')}${td(ee.totals.etc + held, true)}${td(ee.totals.eac, true)}<td class="num"><b>${$(ee.totals.vac)}</b></td><td class="num">${pctS(ee.totals.actual, ee.totals.eac)}</td></tr></tbody></table>`

  const chunks: string[][] = []
  for (let i = 0; i < months.length; i += 12) chunks.push(months.slice(i, i + 12))
  const monthTables = chunks.map((ms) => `<table><thead><tr><th>Function</th>${ms.map((m) => `<th>${fmtMonth(m)}</th>`).join('')}</tr></thead><tbody>
${fns.filter((x) => ms.some((m) => spread[x.id]?.[m])).map((x) => `<tr><td>${x.code} ${esc(x.name)}</td>${ms.map((m) => td(spread[x.id]?.[m] || 0)).join('')}</tr>`).join('\n')}
<tr><td><b>Total</b></td>${ms.map((m) => td(sum(fns.map((x) => spread[x.id]?.[m] || 0)), true)).join('')}</tr></tbody></table>`).join('')

  const compare = cmp && prior ? `<h2>Change from prior approved (${fmtDate(prior.date)})</h2>
<p class="meta">EAC ${$(prior.eac)} → ${$(eac)} (${eac - prior.eac >= 0 ? '+' : ''}${$(eac - prior.eac)}).${prior.note ? ' Prior basis: ' + esc(prior.note) : ''}</p>
<table><thead><tr><th>Function</th><th>Prior EAC</th><th>This EAC</th><th>Change</th></tr></thead><tbody>
${cmp.rows.filter((r) => r.eacA || r.eacB).map((r) => `<tr><td>${r.code} ${esc(r.name)}</td>${td(r.eacA)}${td(r.eacB)}<td class="num">${r.delta >= 0 ? '+' : ''}${$(r.delta)}</td></tr>`).join('\n')}</tbody></table>` : ''

  const hist = inst ? `<h2>Review</h2><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Comment</th></tr></thead><tbody>${inst.history.filter((h) => h.action !== 'system').map((h) => `<tr><td>${h.at.slice(0, 10)}</td><td>${esc(personName(s, h.actorId))}</td><td>${h.action}</td><td>${esc(h.comment ?? '')}</td></tr>`).join('')}</tbody></table>` : ''

  return htmlDoc(`${p.code} forecast ${f.date}`, `<h1>${esc(p.code)} ${esc(p.name)} — forecast spread</h1>
<p class="meta">${esc(s.settings.orgName)} · Version dated ${fmtDate(f.date)} · ${statusOf(f)} · prepared by ${esc(personName(s, f.byId))} · actuals through ${fmtMonth(cut)}</p>
<table><tbody><tr><th>Budget</th><td class="num">${$(bud.total)}</td><th>Actual to date</th><td class="num">${$(actT)}</td></tr>
<tr><th>ETC (incl. contingency held)</th><td class="num">${$(etcT)}</td><th>EAC</th><td class="num"><b>${$(eac)}</b></td></tr>
<tr><th>Variance (budget − EAC)</th><td class="num">${$(bud.total - eac)}</td><th>Contingency held</th><td class="num">${$(held)}</td></tr></tbody></table>
${f.note ? `<h2>Forecast basis</h2><p>${esc(f.note)}</p>` : ''}
<h2>ETC / EAC by WBS function and line item</h2>${fnTable}
<h2>Monthly spread (ETC)</h2>${monthTables || '<p class="meta">No ETC spread — the project is fully actualized.</p>'}
${compare}${hist}
<p class="meta">EAC = SAP actuals to date (mapped to forecast line items through the SAP mapping table) + time-phased ETC by line item + contingency held. Overhead (AFUDC, allocations) is reported under 900 Project Overhead; escalation is allocated to lines pro-rata to direct cost. Each function is phased by the curve profile shown; “adjusted” means cells were edited by hand after the profile was applied.</p>`)
}
