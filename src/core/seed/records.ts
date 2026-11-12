// Demo forms and records history: completed forms on a sample of accepted deliverables (filed to the simulated records
// system), forms in review, and drafts in progress. Own random stream so the rest of the seed is unchanged. Fictional.
import type { AppState, FormValue, Project } from '../types'
import { rng, addDays } from '../util'
import { allFields, formFor, prefillValue, type DocFormTemplate } from '../engine/forms'
import { DEFAULT_RECORDS, queueRecord } from '../engine/records'

type R = ReturnType<typeof rng>

/** Written answers for the most-shown forms; everything else gets sensible generic values. */
function curated(p: Project, t: DocFormTemplate, asOf: string): Record<string, FormValue> | undefined {
  const line = p.asset.lineId
  switch (t.id) {
    case 'f-charter': return {
      problem: `${line} has ${p.asset.recordsStatus === 'complete' ? 'aging' : 'incomplete-record'} segments installed in ${p.asset.vintage}. Without this work the line keeps a pressure restriction and higher leak and rupture exposure.`,
      objectives: 'Remove the integrity threat, restore full operating pressure, and keep customers in service during the work.',
      stakeholders: [{ name: 'Gas control', role: 'Outage windows and pressure limits' }, { name: 'City public works', role: 'Encroachment permit and paving' }, { name: 'Integrity management', role: 'Threat assessment and MAOP' }],
      mechanism: 'General rate case',
    }
    case 'f-pep': return {
      org: 'PM leads; project engineer owns design and MAOP basis; construction manager owns field execution; project controls owns cost, schedule and the monthly forecast.',
      contracting: 'Unit-price master agreement', controls: 'Monthly forecast by line item against SAP actuals; changes through the change workflow; variances over threshold explained before the forecast is accepted.',
      quality: 'Inspection and test plan with hold points on welding, NDE and pressure testing.', safety: 'Job-specific safety plan per work package; daily tailboards; stop-work authority.',
      outage: 'Two planned isolation windows coordinated with gas control, outside winter peak.', comms: 'Monthly sponsor update; weekly field coordination; customer notices 10 days ahead.',
    }
    case 'f-permits': return { permits: [
      { permit: 'Encroachment permit', agency: `${p.location.city} public works`, need: addDays(asOf, 30), status: 'Issued', number: 'ENC-26-0412' },
      { permit: 'Hydrotest discharge', agency: 'Regional water board', need: addDays(asOf, 60), status: 'Applied', number: '' },
      { permit: 'Traffic control plan', agency: `${p.location.city} traffic engineering`, need: addDays(asOf, 25), status: 'Issued', number: 'TCP-26-118' },
    ] }
    case 'f-precon': return { ready: Object.fromEntries(['Permits on hand', 'Materials received', 'Crews operator-qualified for covered tasks', 'Outage or clearance approved', 'Customer and agency notices sent', 'Job-specific safety plan approved', 'Traffic control plan approved', 'Emergency contacts posted', 'Inspector assigned'].map((k) => [k, { v: 'Yes' }])), mob: addDays(asOf, 14) }
    case 'f-itp': return {
      points: [{ activity: 'Welding procedure qualification', type: 'Hold', criteria: 'Procedure qualified to the welding standard', who: 'Weld inspector' }, { activity: 'Production welds', type: 'Witness', criteria: '100% visual; NDE per plan', who: 'NDE contractor' }, { activity: 'Coating before lowering in', type: 'Hold', criteria: 'Holiday test passed', who: 'Coating inspector' }, { activity: 'Strength test', type: 'Hold', criteria: 'Held at test pressure for the full duration, no unexplained drop', who: 'Project engineer' }],
      nde: 100, medium: 'Water', testPsig: Math.round(p.asset.maopPsig * 1.5), hours: 8,
    }
    case 'f-bod': return { designPsig: Math.round(p.asset.maopPsig * 1.1), maopPsig: p.asset.maopPsig, grade: 'X52', wall: p.asset.diameterIn >= 20 ? 0.375 : 0.25, coating: 'FBE + abrasion-resistant overcoat', tieins: 'Two cold tie-ins at existing valves; isolate with line stoppers to keep downstream customers in service.', route: 'Follows the existing alignment within the current right of way.', eor: 'Project engineer of record' }
    case 'f-land': return { parcels: [
      { parcel: 'Parcel 1', owner: 'Public agency', right: 'Permit', status: 'Executed', need: addDays(asOf, 20) },
      { parcel: 'Parcel 2', owner: 'Private', right: 'Temporary right of entry', status: 'Executed', need: addDays(asOf, 35) },
      { parcel: 'Parcel 3', owner: 'Railroad', right: 'License', status: 'In negotiation', need: addDays(asOf, 70) },
    ] }
    case 'f-lessons': return { lessons: [
      { what: 'Potholing found an unmapped duct bank in the tie-in area', impact: 'Schedule', rec: 'Pothole all tie-ins before 60% design' },
      { what: 'Outage window moved for a gas-control constraint', impact: 'Cost', rec: 'Confirm windows with gas control at Gate 2' },
      { what: 'Early customer notices cut complaints', impact: 'Stakeholders', rec: 'Keep the 10-day notice standard' },
    ] }
  }
  return undefined
}

/** Plausible values for any field not curated. */
function generic(s: AppState, p: Project, t: DocFormTemplate, R: R): Record<string, FormValue> {
  const out: Record<string, FormValue> = {}
  for (const f of allFields(t)) {
    if (f.readOnly) continue
    if (f.prefill) { const v = prefillValue(s, p, f.prefill); if (v !== undefined && v !== '') { out[f.key] = v; continue } }
    switch (f.type) {
      case 'text': out[f.key] = /eor|engineer|lead|signer|signoff|custodian|inspector/i.test(f.key) ? 'Named on the signed original' : 'Documented in the attached package'; break
      case 'textarea': out[f.key] = 'Reviewed with the project team; details in the attached package.'; break
      case 'number': out[f.key] = R.int(2, 40); break
      case 'money': out[f.key] = 0; break
      case 'date': out[f.key] = addDays(s.settings.asOf, -R.int(3, 40)); break
      case 'select': out[f.key] = f.options?.[0] ?? ''; break
      case 'boolean': out[f.key] = true; break
      case 'checklist': out[f.key] = Object.fromEntries((f.items ?? []).map((i) => [i, { v: (f.choices ?? ['Yes'])[0] }])); break
      case 'table': out[f.key] = [Object.fromEntries((f.columns ?? []).map((c) => [c.key, c.type === 'number' || c.type === 'money' ? R.int(1, 20) : c.type === 'date' ? addDays(s.settings.asOf, R.int(-30, 60)) : c.type === 'select' ? c.options?.[0] ?? '' : 'See attached']))]; break
    }
  }
  return out
}

export function seedRecords(s: AppState) {
  const R = rng(7711)
  s.settings.records = { ...DEFAULT_RECORDS, paused: false }
  s.recordsSubmissions = []
  const asOf = s.settings.asOf
  const fill = (dl: (typeof s.deliverables)[number], p: Project) => {
    const t = formFor(dl.defId)
    if (!t) return false
    dl.form = { templateId: t.id, templateVersion: t.version, data: { ...generic(s, p, t, R), ...curated(p, t, asOf) }, savedAt: `${addDays(asOf, -R.int(2, 20))}T16:00:00.000Z`, savedById: dl.ownerId ?? p.team.pm ?? 'u-me' }
    return true
  }
  const active = s.projects.filter((p) => p.status === 'active')
  // accepted deliverables in the current stage: completed forms, filed to the records system
  let filed = 0
  for (const p of active) for (const dl of s.deliverables.filter((x) => x.projectId === p.id && x.stageIndex === p.stageIndex && x.status === 'accepted').slice(0, 2)) {
    if (filed >= 14 || !fill(dl, p)) continue
    dl.updatedAt = `${addDays(asOf, -R.int(1, 12))}T18:00:00.000Z`
    const sub = queueRecord(s, dl.id, dl.reviewerId ?? 'u-pmo2')
    if (sub) { sub.createdAt = dl.updatedAt; sub.sentAt = dl.updatedAt; filed++ }
  }
  // in review: completed forms waiting on the reviewer (accepting one files it)
  for (const dl of s.deliverables.filter((x) => x.status === 'submitted' && active.some((p) => p.id === x.projectId))) fill(dl, active.find((p) => p.id === dl.projectId)!)
  // drafts: half-done forms in progress
  let drafts = 0
  for (const dl of s.deliverables.filter((x) => x.status === 'in-progress' && active.some((p) => p.id === x.projectId))) {
    if (drafts >= 10) break
    const p = active.find((x) => x.id === dl.projectId)!
    if (!fill(dl, p)) continue
    const keys = Object.keys(dl.form!.data)
    for (const k of keys.slice(Math.ceil(keys.length / 2))) delete dl.form!.data[k]
    drafts++
  }
}
