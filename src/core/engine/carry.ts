// Carry-forward between deliverables: when a later form asks for something an earlier deliverable on the same project
// already answered, the earlier answer is offered as the starting value and the form says where it came from.
// The owner can change it. Nothing is carried into a form that is locked (submitted, accepted or waived): a signed
// record stays exactly as it was signed.
//
// Project facts (number, name, project manager, asset…) are a different thing: those come straight from the project
// record through the form's read-only fields (engine/forms.ts). This file is only about answers people typed.
//
// Pure: the links are data, the helpers read state and return values.
import type { AppState, Deliverable, FormValue, Project } from '../types'
import { templateFor } from './gates'
import { FORM_FOR_DEF, FORM_TEMPLATES, allFields, deliverableDef, formValues, type DocField, type DocFormTemplate } from './forms'

/** `to` takes its starting value from `from` ("form id.field key"). For tables, `columns` maps target column ← source column. */
export interface CarryLink { to: string; from: string; columns?: Record<string, string> }

// VERIFY: a starting list drafted for the demo. The PMO confirms which answers should follow a project from one
// deliverable to the next; removing a line here removes that carry-forward and nothing else.
export const CARRY_LINKS: CarryLink[] = [
  // Funding
  { to: 'f-recovery.mechanism', from: 'f-charter.mechanism' },
  // Alternatives screened at feasibility become the options analysed
  { to: 'f-options.options', from: 'f-feas.alts', columns: { opt: 'alt', cost: 'cost', risk: 'risk' } },
  // Stakeholders named in the charter start the outreach plan
  { to: 'f-outreach.plan', from: 'f-charter.stakeholders', columns: { who: 'name' } },
  // Design
  { to: 'f-ifc.eor', from: 'f-bod.eor' },
  { to: 'f-maop.engineer', from: 'f-ifc.eor' },
  { to: 'f-maop.engineer', from: 'f-bod.eor' },
  { to: 'f-notice.maop', from: 'f-bod.maopPsig' },
  // Testing
  { to: 'f-commission.testPsig', from: 'f-itp.testPsig' },
  { to: 'f-maop.segments', from: 'f-hydro.sections', columns: { seg: 'sec', testPsig: 'psig' } },
  { to: 'f-maop.segments', from: 'f-recrev.segments', columns: { seg: 'seg' } },
  // Permits opened in the matrix are the permits to close out
  { to: 'f-permitclose.permits', from: 'f-permits.permits', columns: { permit: 'permit', agency: 'agency' } },
  // In service
  { to: 'f-unitize.inService', from: 'f-notice.date' },
]

export interface Carried {
  value: FormValue
  fromDeliverableId: string
  /** e.g. "Basis of design" */
  fromName: string
  /** e.g. "Stage 3 · Detailed design" */
  fromStage: string
}

const LOCKED: Deliverable['status'][] = ['submitted', 'accepted', 'waived']

/** Nothing a person would call an answer: empty text, an empty table, an untouched checklist. */
export function isBlank(v: FormValue | undefined): boolean {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return !v.some((r) => Object.values(r).some((x) => x !== '' && x != null))
  if (typeof v === 'object') return Object.keys(v).length === 0
  return false
}

const split = (ref: string): [string, string] => { const i = ref.indexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)] }

/** Shape the source answer for the target field; undefined when it doesn't fit (wrong type, not one of the choices). */
function fit(target: DocField, link: CarryLink, v: FormValue): FormValue | undefined {
  if (target.type === 'table') {
    if (!Array.isArray(v) || !link.columns) return undefined
    const rows = v.map((r) => Object.fromEntries(Object.entries(link.columns!).map(([to, from]) => [to, r[from] ?? '']))).filter((r) => Object.values(r).some((x) => x !== '' && x != null))
    return rows.length ? rows : undefined
  }
  if (target.type === 'number' || target.type === 'money') return typeof v === 'number' ? v : undefined
  if (typeof v !== 'string') return undefined
  if (target.type === 'select' && !(target.options ?? []).includes(v)) return undefined
  return v
}

/**
 * The answers earlier deliverables can supply to this form, by field key. "Earlier" is any other deliverable on the
 * project at this stage or before it that has a saved form; the latest stage wins, then the most recent save.
 */
export function carriedFor(s: AppState, p: Project, d: Pick<Deliverable, 'id' | 'stageIndex'>, t: DocFormTemplate): Record<string, Carried> {
  const out: Record<string, Carried> = {}
  const stages = templateFor(s, p).stages
  const earlier = s.deliverables
    .filter((x) => x.projectId === p.id && x.id !== d.id && x.stageIndex <= d.stageIndex && x.form)
    .sort((a, b) => b.stageIndex - a.stageIndex || (b.form!.savedAt > a.form!.savedAt ? 1 : -1))
  for (const f of allFields(t)) {
    if (f.readOnly) continue
    for (const link of CARRY_LINKS) {
      if (link.to !== `${t.id}.${f.key}`) continue
      const [fromTemplate, fromKey] = split(link.from)
      const src = earlier.find((x) => FORM_FOR_DEF[x.defId] === fromTemplate && !isBlank(x.form!.data[fromKey]))
      if (!src) continue
      const value = fit(f, link, src.form!.data[fromKey])
      if (value === undefined) continue
      const stage = stages[src.stageIndex]
      out[f.key] = { value, fromDeliverableId: src.id, fromName: deliverableDef(s, src)?.name ?? FORM_TEMPLATES.find((x) => x.id === fromTemplate)?.name ?? 'an earlier deliverable', fromStage: stage ? `Stage ${stage.index} · ${stage.name}` : '' }
      break // links are listed in order of preference
    }
  }
  return out
}

/** The form's values for a deliverable: saved answers, then answers carried from earlier deliverables, then project pre-fill. */
export function formValuesFor(s: AppState, p: Project, d: Pick<Deliverable, 'id' | 'stageIndex' | 'status' | 'form'>, t: DocFormTemplate): Record<string, FormValue> {
  const saved = d.form?.data ?? {}
  if (LOCKED.includes(d.status)) return formValues(s, p, t, saved)
  const merged: Record<string, FormValue> = { ...saved }
  for (const [key, c] of Object.entries(carriedFor(s, p, d, t))) if (isBlank(saved[key])) merged[key] = c.value
  return formValues(s, p, t, merged)
}

/** Which fields currently show a carried answer unchanged (for the "Carried from…" note on the form). */
export function carriedNotes(carried: Record<string, Carried>, data: Record<string, FormValue>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, c] of Object.entries(carried)) if (JSON.stringify(data[key]) === JSON.stringify(c.value)) out[key] = `Carried from ${c.fromName}${c.fromStage ? ` (${c.fromStage})` : ''}`
  return out
}
