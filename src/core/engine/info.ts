// Project Information record: values live on the project (bound fields) or in project.info.
import type { AppState, InfoFieldDef, Project } from '../types'
import { get, nowISO, uid } from '../util'

export function infoValue(p: Project, def: InfoFieldDef, s?: AppState): string {
  if (def.key === 'recovery' && s) return s.programs.find((x) => x.id === p.programId)?.recovery ?? ''
  if (def.key === 'program' && s) { const pr = s.programs.find((x) => x.id === p.programId); return pr ? `${pr.code} · ${pr.name}` : '' }
  if (def.key === 'pm' && s) return s.people.find((x) => x.id === p.team.pm)?.name ?? ''
  if (def.key === 'sponsor' && s) return s.people.find((x) => x.id === p.team.sponsor)?.name ?? ''
  const v = def.bind ? get(p, def.bind) : p.info?.[def.key]
  if (v === undefined || v === null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** Write one field back to the project draft (coerces to the bound field's type). */
export function setInfoValue(p: Project, def: InfoFieldDef, value: string) {
  if (!def.bind) { p.info = { ...(p.info ?? {}), [def.key]: value }; return }
  const parts = def.bind.split('.')
  let o: any = p
  for (const k of parts.slice(0, -1)) o = o[k]
  const last = parts[parts.length - 1]
  const cur = o[last]
  o[last] = def.type === 'number' || def.type === 'money' ? (value.trim() === '' ? undefined : Number(value.replace(/[^0-9.-]/g, '')) || 0) : typeof cur === 'number' ? Number(value.replace(/[^0-9.-]/g, '')) || 0 : typeof cur === 'boolean' ? value === 'Yes' || value === 'true' : value
}

export const infoFieldsFor = (s: AppState) => s.settings.infoFields

/** Required fields still empty for the project's current stage (counted as a gate blocker). */
export function missingInfo(s: AppState, p: Project, stageIndex = p.stageIndex): InfoFieldDef[] {
  return s.settings.infoFields.filter((f) => f.requiredAtStage !== undefined && f.requiredAtStage <= stageIndex && !f.readOnly && !infoValue(p, f, s).trim())
}

export function infoCompleteness(s: AppState, p: Project): { filled: number; total: number; pct: number } {
  const fields = s.settings.infoFields.filter((f) => !f.readOnly)
  const filled = fields.filter((f) => infoValue(p, f, s).trim()).length
  return { filled, total: fields.length, pct: fields.length ? Math.round((filled / fields.length) * 100) : 100 }
}

/** Apply edits and write a revision (who, when, field-level from → to). Returns the revision or null if nothing changed. */
export function reviseInfo(d: AppState, pid: string, edits: Record<string, string>, note: string, byId = d.currentUserId) {
  const p = d.projects.find((x) => x.id === pid)
  if (!p) return null
  const changes: { key: string; label: string; from: string; to: string }[] = []
  for (const [key, to] of Object.entries(edits)) {
    const def = d.settings.infoFields.find((f) => f.key === key)
    if (!def || def.readOnly) continue
    const from = infoValue(p, def, d)
    if (from === to) continue
    setInfoValue(p, def, to)
    changes.push({ key, label: def.label, from, to })
  }
  if (!changes.length) return null
  const rev = { id: uid('irev'), projectId: pid, at: nowISO(), byId, note, changes }
  d.infoRevisions.push(rev)
  d.audit.push({ id: uid('aud'), at: rev.at, actorId: byId, entity: 'project-info', entityId: pid, projectId: pid, action: 'revise', summary: `Project information: ${changes.map((c) => c.label).join(', ')}${note ? ` — ${note}` : ''}` })
  return rev
}
