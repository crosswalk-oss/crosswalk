// Records hand-off: when a deliverable is approved (or, if configured, verified by records), freeze its form, build the
// records-system metadata and file it. The demo uses a simulated connector — it never calls out — and shows the exact
// requests a live OpenText Content Server connector would send (REST API v2: create the document, then set its category).
import type { AppState, Deliverable, DeliverableDef, ID, RecordsMapping, RecordsSettings, RecordsSubmission } from '../types'
import { nowISO, uid } from '../util'
import { deliverableDef, formFor, formValues } from './forms'

// VERIFY: records classes, retention periods and the folder pattern are placeholders for records management.
export const DEFAULT_RECORDS: RecordsSettings = {
  system: 'OpenText Content Server',
  baseUrl: 'https://records.arroyovalleygas.example/otcs/cs.exe/api/v2',
  rootFolder: 'Enterprise / Capital Projects / {program} / {project} / {stage}',
  trigger: 'approval',
  verifierRole: 'records',
  mode: 'simulated',
  mappings: {},
}

const KIND_DEFAULT: Record<DeliverableDef['kind'], RecordsMapping> = {
  document: { docType: 'Project document', recordsClass: 'CAP-100 Project management', retention: 'Project close + 10 years' },
  estimate: { docType: 'Estimate and basis of estimate', recordsClass: 'CAP-200 Cost and estimating', retention: 'Project close + 10 years' },
  'risk-register': { docType: 'Risk register', recordsClass: 'CAP-100 Project management', retention: 'Project close + 10 years' },
  'safety-plan': { docType: 'Safety plan', recordsClass: 'SAF-300 Construction safety', retention: 'Project close + 30 years' },
  schedule: { docType: 'Schedule', recordsClass: 'CAP-100 Project management', retention: 'Project close + 10 years' },
  checklist: { docType: 'Checklist', recordsClass: 'CAP-100 Project management', retention: 'Project close + 10 years' },
  permit: { docType: 'Permit and environmental record', recordsClass: 'ENV-400 Permits and compliance', retention: 'Permit close + 10 years' },
  records: { docType: 'Construction and test record', recordsClass: 'ENG-500 Pipeline integrity records', retention: 'Life of the facility' },
}
/** Deliverables whose records must be kept for the life of the facility (pressure tests, MAOP, as-builts). */
const LIFE_OF_FACILITY = new Set(['d-recrev', 'd-maop', 'd-commission', 'ds-records', 'd-asbuilt', 'd-design', 'ds-design', 'd-bod', 'd-hydro', 'd-itp'])

export function recordsOf(s: Pick<AppState, 'settings'>): RecordsSettings {
  const r = s.settings.records
  return { ...DEFAULT_RECORDS, ...r, mappings: { ...r?.mappings } }
}

export function mappingFor(s: Pick<AppState, 'settings'>, def: DeliverableDef): RecordsMapping {
  const set = recordsOf(s).mappings[def.id]
  if (set) return set
  const base = KIND_DEFAULT[def.kind]
  return LIFE_OF_FACILITY.has(def.id) ? { docType: def.kind === 'records' ? base.docType : 'Engineering record', recordsClass: 'ENG-500 Pipeline integrity records', retention: 'Life of the facility' } : base
}

const safeName = (x: string) => x.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

function stageName(s: AppState, d: Deliverable) {
  const p = s.projects.find((x) => x.id === d.projectId)
  for (const t of s.templates) for (const st of t.stages) if (st.gate.deliverables.some((x) => x.id === d.defId) && st.index === d.stageIndex) return { stage: st.name, gate: st.gate.name, p }
  return { stage: `Stage ${d.stageIndex + 1}`, gate: '', p }
}

export function folderFor(s: AppState, d: Deliverable): string {
  const { stage, p } = stageName(s, d)
  const prog = s.programs.find((x) => x.id === p?.programId)
  return recordsOf(s).rootFolder.replace('{program}', prog ? `${prog.code} ${prog.name}` : '').replace('{project}', p ? `${p.code} ${p.name}` : '').replace('{stage}', `${d.stageIndex + 1} ${stage}`)
}

const person = (s: AppState, id?: string) => s.people.find((x) => x.id === id)?.name ?? ''

export function recordMetadata(s: AppState, d: Deliverable, def: DeliverableDef, snap: RecordsSubmission['snapshot']): Record<string, string> {
  const { stage, gate, p } = stageName(s, d)
  const m = mappingFor(s, def)
  const prog = s.programs.find((x) => x.id === p?.programId)
  return {
    'Project Number': p?.code ?? '',
    'Project Name': p?.name ?? '',
    Program: prog ? `${prog.code} ${prog.name}` : '',
    'ERP WBS': p?.erpWbs ?? '',
    Stage: `${d.stageIndex + 1} · ${stage}`,
    Gate: gate,
    Deliverable: def.name,
    'Document Type': m.docType,
    Version: String(d.version || 1),
    Author: person(s, snap.ownerId),
    Approver: person(s, snap.reviewerId),
    'Approval Date': (snap.acceptedAt ?? '').slice(0, 10),
    'Verified By': person(s, snap.verifiedById),
    'Verification Date': (snap.verifiedAt ?? '').slice(0, 10),
    'Records Class': m.recordsClass,
    Retention: m.retention,
    'Source System': 'Crosswalk',
    'Crosswalk Record': d.id,
  }
}

/** The calls a live OpenText Content Server connector would make (REST API v2). Shown for IT review; never sent in the demo. */
export function requestPreview(s: AppState, sub: RecordsSubmission): { method: string; url: string; body: Record<string, unknown> }[] {
  const r = recordsOf(s)
  const prior = (s.recordsSubmissions ?? []).find((x) => x.deliverableId === sub.deliverableId && x.status === 'filed' && x.nodeId && x.id !== sub.id && x.createdAt < sub.createdAt)
  const file = `<${sub.fileName} — PDF bytes, multipart/form-data>`
  const upload = prior
    ? { method: 'POST', url: `${r.baseUrl}/nodes/${prior.nodeId}/versions`, body: { file, description: `Version ${sub.version} from Crosswalk` } }
    : { method: 'POST', url: `${r.baseUrl}/nodes`, body: { type: 144, parent_id: `<folder id for "${sub.folder}">`, name: sub.fileName, file } }
  return [
    { method: 'POST', url: `${r.baseUrl.replace(/\/v2$/, '/v1')}/auth`, body: { username: '<service account>', password: '<from the secrets vault>' } },
    upload,
    { method: 'PUT', url: `${r.baseUrl}/nodes/${prior?.nodeId ?? '{new node id}'}/categories/{Capital Project Record category id}`, body: Object.fromEntries(Object.entries(sub.metadata).map(([k, v]) => [`{category id}_${safeName(k)}`, v])) },
  ]
}

/** A stable fake node id for the simulated connector. */
function fakeNode(id: string) { let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return String(4_000_000 + (Math.abs(h) % 5_999_999)) }

function send(d: AppState, sub: RecordsSubmission) {
  const r = recordsOf(d)
  sub.sentAt = nowISO()
  if (r.mode === 'live') { sub.status = 'failed'; sub.error = 'No live connector is configured in this demo.'; return }
  const prior = (d.recordsSubmissions ?? []).find((x) => x.deliverableId === sub.deliverableId && x.status === 'filed' && x.nodeId && x.id !== sub.id)
  sub.nodeId = prior?.nodeId ?? fakeNode(sub.id)
  sub.status = 'filed'
  sub.error = undefined
}

/**
 * Freeze the deliverable's form and create its records submission. Files at once when the trigger is approval (or it is
 * already verified); otherwise waits for records verification.
 */
export function queueRecord(d: AppState, deliverableId: ID, byId: ID): RecordsSubmission | undefined {
  const dl = d.deliverables.find((x) => x.id === deliverableId)
  if (!dl) return undefined
  const def = deliverableDef(d, dl)
  const p = d.projects.find((x) => x.id === dl.projectId)
  const t = def && formFor(def.id)
  if (!def || !p || !t) return undefined
  const r = recordsOf(d)
  d.recordsSubmissions ??= []
  // one submission per deliverable version
  const existing = d.recordsSubmissions.find((x) => x.deliverableId === dl.id && x.version === (dl.version || 1))
  if (existing && existing.status === 'filed') return existing
  const snap: RecordsSubmission['snapshot'] = {
    templateId: t.id, templateVersion: t.version, data: formValues(d, p, t, dl.form?.data ?? {}), ownerId: dl.ownerId, reviewerId: dl.reviewerId,
    acceptedAt: dl.updatedAt, verifiedById: dl.verifiedById, verifiedAt: dl.verifiedAt,
  }
  const sub: RecordsSubmission = existing ?? {
    id: uid('rec'), projectId: p.id, deliverableId: dl.id, defId: def.id, version: dl.version || 1, status: 'queued', trigger: r.trigger,
    createdAt: nowISO(), createdById: byId, fileName: `${p.code}_${safeName(def.name)}_v${dl.version || 1}.pdf`, folder: folderFor(d, dl), metadata: {}, snapshot: snap,
  }
  sub.snapshot = snap
  sub.trigger = r.trigger
  sub.metadata = recordMetadata(d, dl, def, snap)
  if (!existing) d.recordsSubmissions.push(sub)
  if (r.trigger === 'verification' && !dl.verifiedAt) { sub.status = 'awaiting-verification'; return sub }
  send(d, sub)
  return sub
}

/** Called when the review workflow accepts a deliverable. */
export function onDeliverableAccepted(d: AppState, deliverableId: ID, byId: ID) {
  return queueRecord(d, deliverableId, byId)
}

/** Records confirms the approved deliverable is complete and correctly indexed; files it when filing waits for this. */
export function verifyDeliverable(d: AppState, deliverableId: ID, byId: ID): RecordsSubmission | undefined {
  const dl = d.deliverables.find((x) => x.id === deliverableId)
  if (!dl || dl.status !== 'accepted') return undefined
  dl.verifiedById = byId
  dl.verifiedAt = nowISO()
  return queueRecord(d, deliverableId, byId)
}

export function retryRecord(d: AppState, subId: ID): RecordsSubmission | undefined {
  const sub = (d.recordsSubmissions ?? []).find((x) => x.id === subId)
  if (!sub || sub.status === 'filed' || sub.status === 'awaiting-verification') return sub
  send(d, sub)
  return sub
}

export function submissionsFor(s: AppState, deliverableId: ID) {
  return (s.recordsSubmissions ?? []).filter((x) => x.deliverableId === deliverableId).sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt))
}

export const RECORD_STATUS_LABEL: Record<RecordsSubmission['status'], string> = { 'awaiting-verification': 'Awaiting verification', queued: 'Queued', filed: 'Filed', failed: 'Failed' }

/** A not-yet-filed record for previewing the PDF from the form (nothing is stored). */
export function previewSubmission(s: AppState, dl: Deliverable): RecordsSubmission | undefined {
  const def = deliverableDef(s, dl)
  const p = s.projects.find((x) => x.id === dl.projectId)
  const t = def && formFor(def.id)
  if (!def || !p || !t) return undefined
  const snap: RecordsSubmission['snapshot'] = { templateId: t.id, templateVersion: t.version, data: formValues(s, p, t, dl.form?.data ?? {}), ownerId: dl.ownerId, reviewerId: dl.reviewerId, acceptedAt: dl.status === 'accepted' ? dl.updatedAt : undefined, verifiedById: dl.verifiedById, verifiedAt: dl.verifiedAt }
  return {
    id: 'preview', projectId: p.id, deliverableId: dl.id, defId: def.id, version: dl.version || 1, status: 'queued', trigger: recordsOf(s).trigger, createdAt: nowISO(), createdById: s.currentUserId,
    fileName: `${p.code}_${safeName(def.name)}_v${dl.version || 1}_DRAFT.pdf`, folder: folderFor(s, dl), metadata: recordMetadata(s, dl, def, snap), snapshot: snap,
  }
}
