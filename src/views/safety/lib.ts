// Safety helpers (SF-*): ticket expiry, OQ coverage, leading indicators, printable JSSP.
import type { AppState, HazardItem, SafetyPlan } from '@/core/types'
import { addDays, daysBetween, fmtDate, uid } from '@/core/util'
import { htmlDoc } from '@/core/download'

export type Level = 'ok' | 'warn' | 'bad'
export const levelTone = (l: Level) => (l === 'bad' ? 'bad' : l === 'warn' ? 'warn' : 'good') as 'bad' | 'warn' | 'good'

/** Ticket status (SF-04): expired = bad, expiring within 3 days = warn. */
export function ticketLevel(expires: string, asOf: string): { level: Level; days: number; label: string } {
  const days = daysBetween(asOf, expires)
  if (days < 0) return { level: 'bad', days, label: `Expired ${-days} day${days === -1 ? '' : 's'} ago` }
  if (days === 0) return { level: 'warn', days, label: 'Expires today' }
  if (days <= 3) return { level: 'warn', days, label: `Expires in ${days} day${days === 1 ? '' : 's'}` }
  return { level: 'ok', days, label: `${days} days left` }
}

/** Crew member OQ status (SF-06). */
export function oqLevel(expires: string, asOf: string): { level: Level; label: string } {
  const d = daysBetween(asOf, expires)
  if (d < 0) return { level: 'bad', label: `OQ expired ${fmtDate(expires)}` }
  if (d <= 30) return { level: 'warn', label: `OQ expires ${fmtDate(expires)}` }
  return { level: 'ok', label: `OQ valid to ${fmtDate(expires)}` }
}

/** Operator-qualification records (an operator-qualification provider feed) are a phase-2 module, off for the pilot. */
export const opQualOn = (s: Pick<AppState, 'settings'>) => !!s.settings.features?.opQual

export const planHazards = (s: Pick<AppState, 'hazards'>, plan: Pick<SafetyPlan, 'hazardIds'>): HazardItem[] => plan.hazardIds.map((id) => s.hazards.find((h) => h.id === id)).filter((h): h is HazardItem => !!h)

/**
 * Operator-qualification coverage (SF-06): for each hazard that involves covered tasks, at least one crew
 * member must hold a current OQ for one of those tasks (e.g. Hot tapping OR Tapping & stopping).
 */
export function oqCoverage(s: Pick<AppState, 'hazards'>, plan: SafetyPlan, asOf: string) {
  const groups = new Map<string, string[]>()
  for (const h of planHazards(s, plan)) if (h.oqTasks.length) groups.set(h.oqTasks.join(' / '), h.oqTasks)
  return Array.from(groups.entries()).map(([task, tasks]) => {
    const holders = plan.crew.filter((c) => c.oqTasks.some((t) => tasks.includes(t)))
    const valid = holders.filter((c) => c.oqExpires >= asOf)
    return { task, tasks, holders, valid, level: (valid.length ? 'ok' : 'bad') as Level }
  })
}

export const requiredPermits = (s: Pick<AppState, 'hazards'>, plan: Pick<SafetyPlan, 'hazardIds'>) => Array.from(new Set(planHazards(s, plan).flatMap((h) => h.permits)))

/** Pre-mobilization checks a reviewer looks at before approving the plan. */
export function planIssues(s: AppState, plan: SafetyPlan): { level: Level; text: string }[] {
  const out: { level: Level; text: string }[] = []
  const asOf = s.settings.asOf
  for (const t of plan.tickets) {
    const st = ticketLevel(t.expires, asOf)
    if (st.level !== 'ok') out.push({ level: st.level, text: `${t.type} ${t.number}: ${st.label.toLowerCase()}` })
  }
  const have = new Set(plan.tickets.map((t) => t.type as string))
  for (const p of requiredPermits(s, plan)) {
    const covered = have.has(p) || (p === 'Excavation permit' && have.has('Encroachment permit')) || (p === 'Discharge permit' && s.permits.some((x) => x.projectId === plan.projectId && /discharge/i.test(x.type) && x.status === 'issued'))
    if (!covered) out.push({ level: p === '811 locate' ? 'bad' : 'warn', text: `${p} required by the hazards but not listed in tickets & permits` })
  }
  const oqOn = opQualOn(s)
  if (oqOn) for (const c of oqCoverage(s, plan, asOf)) if (!c.valid.length) out.push({ level: 'bad', text: `No crew member with a current OQ for “${c.task}”` })
  for (const c of plan.crew) {
    const oq = oqLevel(c.oqExpires, asOf)
    if (oqOn && oq.level === 'bad' && c.oqTasks.length) out.push({ level: 'bad', text: `${c.name}: ${oq.label} — may not perform ${c.oqTasks.join(', ')}` })
    if (c.prequal === 'Non-compliant') out.push({ level: 'bad', text: `${c.company} prequalification non-compliant (${c.name})` })
  }
  const prequal = Array.from(new Set(plan.crew.filter((c) => c.prequal === 'Conditional').map((c) => c.company)))
  for (const co of prequal) out.push({ level: 'warn', text: `${co}: ISNetworld-style prequalification is Conditional` })
  if (!plan.site.hospital || !plan.site.musterPoint) out.push({ level: 'bad', text: 'Emergency information incomplete (hospital or muster point)' })
  if (planHazards(s, plan).some((h) => h.activity === 'Traffic control') && !plan.trafficPlan) out.push({ level: 'warn', text: 'Traffic control activity without a traffic plan flag' })
  return out
}

export function workingDays(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) out.push(d) }
  return out
}

/** Leading indicators (SF-10) for a set of projects over the last `days` calendar days. */
export function indicators(s: AppState, projectIds: string[], days = 30, contractor?: string) {
  const asOf = s.settings.asOf
  const from = addDays(asOf, -days)
  const ids = new Set(projectIds)
  const plans = s.safetyPlans.filter((p) => ids.has(p.projectId) && p.status === 'approved' && (!contractor || p.contractor === contractor))
  // a project is "working" from its first tailboard in the window (or plan approval) until yesterday
  const recent = workingDays(addDays(asOf, -14), addDays(asOf, -1))
  let expected = 0, held = 0
  for (const pl of plans) {
    const tbs = s.tailboards.filter((t) => t.planId === pl.id || (t.projectId === pl.projectId && !plans.some((x) => x.id === t.planId)))
    const days0 = recent.filter((d) => !pl.approvedAt || d >= pl.approvedAt)
    expected += days0.length
    held += days0.filter((d) => tbs.some((t) => t.date === d)).length
  }
  const events = s.safetyEvents.filter((e) => ids.has(e.projectId) && (!contractor || e.contractor === contractor))
  const win = events.filter((e) => e.date >= from)
  const tickets = plans.flatMap((p) => p.tickets)
  const lapsed = tickets.filter((t) => t.expires < asOf).length
  const expiring = tickets.filter((t) => t.expires >= asOf && daysBetween(asOf, t.expires) <= 3).length
  const wd = Math.max(1, workingDays(from, addDays(asOf, -1)).length)
  return {
    plans: plans.length,
    tailboardRate: expected ? held / expected : null,
    tailboardsHeld: held, tailboardsExpected: expected,
    observations: win.filter((e) => e.type === 'observation').length,
    nearMisses: win.filter((e) => e.type === 'near-miss').length,
    incidents: win.filter((e) => e.type === 'incident').length,
    obsPerWeek: (win.filter((e) => e.type !== 'incident').length / wd) * 5 / Math.max(1, plans.length),
    lapsed, expiring,
    openEvents: events.filter((e) => e.status === 'open').length,
    sif: events.filter((e) => e.sifPotential && e.status === 'open').length,
    sifAll: win.filter((e) => e.sifPotential).length,
  }
}

export function blankPlan(s: AppState, projectId: string, workPackage: string): SafetyPlan {
  const p = s.projects.find((x) => x.id === projectId)!
  const cm = s.people.find((x) => x.id === p.team.constructionManager)
  const contractor = p.contractor ?? 'Contractor to be awarded'
  const cs = s.people.find((x) => x.company === contractor)
  return {
    id: uid('jssp'), projectId, workPackage, version: 1, status: 'draft', contractor, activities: [], hazardIds: [], extraControls: [],
    site: { address: '', hospital: `${p.location.city} Regional Medical Center`, hospitalRoute: '', musterPoint: '', contacts: [cm ? { name: cm.name, role: 'Construction Manager', phone: '(555) 201-4410' } : null, cs ? { name: cs.name, role: 'Contractor Safety', phone: '(555) 388-1902' } : null, { name: 'Gas Control', role: '24-hour', phone: '(555) 600-0100' }].filter((x): x is { name: string; role: string; phone: string } => !!x) },
    tickets: [], crew: [], heatPlan: true, trafficPlan: p.permitsNeeded.encroachment, createdAt: s.settings.asOf, libraryVersion: '2026.1',
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Printable job-specific safety plan (SF-*). */
export function jsspHtml(s: AppState, plan: SafetyPlan): string {
  const p = s.projects.find((x) => x.id === plan.projectId)!
  const asOf = s.settings.asOf
  const hz = planHazards(s, plan)
  const byAct: Record<string, HazardItem[]> = {}
  for (const h of hz) (byAct[h.activity] ||= []).push(h)
  const wf = s.workflows.find((w) => w.id === plan.workflowInstanceId)
  const sigs = wf ? wf.history.filter((h) => h.action === 'approve' || h.action === 'submit') : []
  const name = (id: string) => s.people.find((x) => x.id === id)?.name ?? id
  const cov = oqCoverage(s, plan, asOf)
  const oqOn = opQualOn(s)
  const body = `
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #141b24;padding-bottom:8px">
    <div><div class="meta">${esc(s.settings.orgName)} · Construction Safety</div><h1>Job-Specific Safety Plan</h1><div class="meta">${esc(p.code)} ${esc(p.name)} · ${esc(plan.workPackage)}</div></div>
    <div style="text-align:right"><div><b>Version ${plan.version}</b> · <span class="tag">${plan.status.toUpperCase()}</span></div><div class="meta">Hazard library ${esc(plan.libraryVersion)}<br/>Prepared ${fmtDate(plan.createdAt)}${plan.approvedAt ? `<br/>Approved ${fmtDate(plan.approvedAt)}` : ''}</div></div>
  </div>
  <h2>1. Project and contractor</h2>
  <table><tr><th>Project</th><td>${esc(p.code)} — ${esc(p.name)}</td><th>Work package</th><td>${esc(plan.workPackage)}</td></tr>
  <tr><th>Contractor</th><td>${esc(plan.contractor)}</td><th>Location</th><td>${esc(plan.site.address || p.location.city)}</td></tr>
  <tr><th>Scope</th><td colspan="3">${esc(p.scope.summary)}</td></tr>
  <tr><th>Asset</th><td>${p.asset.diameterIn}" ${esc(p.asset.material)}, MAOP ${p.asset.maopPsig} psig</td><th>Special plans</th><td>${plan.heatPlan ? 'Heat illness prevention plan' : ''}${plan.heatPlan && plan.trafficPlan ? '; ' : ''}${plan.trafficPlan ? 'Traffic control plan' : ''}${!plan.heatPlan && !plan.trafficPlan ? 'None' : ''}</td></tr></table>
  <h2>2. Emergency information</h2>
  <table><tr><th style="width:22%">Nearest hospital</th><td>${esc(plan.site.hospital)}</td></tr><tr><th>Route</th><td>${esc(plan.site.hospitalRoute)}</td></tr><tr><th>Muster point</th><td>${esc(plan.site.musterPoint)}</td></tr><tr><th>Emergency</th><td><b>Call 911</b>, then Gas Control. Any person may stop work.</td></tr></table>
  <table><tr><th>Contact</th><th>Role</th><th>Phone</th></tr>${plan.site.contacts.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.role)}</td><td>${esc(c.phone)}</td></tr>`).join('')}</table>
  <h2>3. Activities, hazards and controls</h2>
  <p class="meta">Controls are listed in hierarchy order: engineering, administrative, then PPE. Site-specific controls are added below each hazard.</p>
  ${Object.entries(byAct).map(([act, hs]) => `<h3>${esc(act)}</h3><table><tr><th style="width:26%">Hazard</th><th>Controls</th><th style="width:18%">${oqOn ? 'Permits / OQ' : 'Permits'}</th></tr>${hs.map((h) => {
    const extra = plan.extraControls.filter((x) => x.hazardId === h.id)
    const order = { engineering: 0, administrative: 1, ppe: 2 } as Record<string, number>
    return `<tr><td><b>${esc(h.hazard)}</b></td><td>${h.controls.slice().sort((a, b) => order[a.type] - order[b.type]).map((c) => `<div><span class="tag">${c.type === 'ppe' ? 'PPE' : c.type.toUpperCase()}</span> ${esc(c.text)}</div>`).join('')}${extra.map((x) => `<div><span class="tag">SITE-SPECIFIC</span> ${esc(x.text)}</div>`).join('')}</td><td>${[...h.permits, ...(oqOn ? h.oqTasks.map((o) => 'OQ: ' + o) : [])].map(esc).join('<br/>') || '—'}</td></tr>`
  }).join('')}</table>`).join('')}
  <h2>4. Tickets and permits</h2>
  <table><tr><th>Type</th><th>Number</th><th>Expires</th><th>Status as of ${fmtDate(asOf)}</th></tr>${plan.tickets.map((t) => `<tr><td>${esc(t.type)}</td><td>${esc(t.number)}</td><td>${fmtDate(t.expires)}</td><td>${ticketLevel(t.expires, asOf).label}</td></tr>`).join('') || '<tr><td colspan="4">None listed</td></tr>'}</table>
  ${oqOn ? `<h2>5. Crew, operator qualification and prequalification</h2>
  <table><tr><th>Name</th><th>Company</th><th>Role</th><th>OQ tasks</th><th>OQ expires</th><th>Prequal</th></tr>${plan.crew.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.company)}</td><td>${esc(c.role)}</td><td>${c.oqTasks.map(esc).join(', ') || '—'}</td><td>${fmtDate(c.oqExpires)}${c.oqExpires < asOf ? ' (EXPIRED)' : ''}</td><td>${c.prequal}</td></tr>`).join('')}</table>
  <table><tr><th>Covered task required by hazards</th><th>Qualified crew</th></tr>${cov.map((c) => `<tr><td>${esc(c.task)}</td><td>${c.valid.map((x) => esc(x.name)).join(', ') || '<b>NONE — task may not be performed</b>'}</td></tr>`).join('') || '<tr><td colspan="2">No covered tasks</td></tr>'}</table>` : `<h2>5. Crew and prequalification</h2>
  <table><tr><th>Name</th><th>Company</th><th>Role</th><th>Prequal</th></tr>${plan.crew.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.company)}</td><td>${esc(c.role)}</td><td>${c.prequal}</td></tr>`).join('') || '<tr><td colspan="4">No crew listed</td></tr>'}</table>`}
  <h2>6. Stop-work authority</h2>
  <p>Every person on this job has the authority and the obligation to stop work when conditions change or a hazard is not controlled. No one will be disciplined for stopping work in good faith. Work resumes only after the hazard is controlled and the crew is re-briefed at a tailboard.</p>
  <h2>7. Review and approval</h2>
  <table><tr><th>Step</th><th>Name</th><th>Action</th><th>Date</th></tr>${sigs.map((h) => `<tr><td>${esc(s.workflowDefs.find((d) => d.id === wf!.defId)?.nodes.find((n) => n.id === h.nodeId)?.label ?? '')}</td><td>${esc(name(h.actorId))}</td><td>${h.action === 'approve' ? 'Approved (e-signed)' : 'Submitted'}</td><td>${h.at.slice(0, 10)}</td></tr>`).join('') || '<tr><td colspan="4">Not yet routed for approval</td></tr>'}</table>
  <p class="meta" style="margin-top:24px">Generated by Crosswalk on ${fmtDate(asOf)}. Keep a copy at the job site. Fictional demo data.</p>`
  return htmlDoc(`JSSP ${p.code} ${plan.workPackage} v${plan.version}`, body)
}
