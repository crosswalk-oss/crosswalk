// Redaction: fields on a deliverable form can carry a tag saying why they would be withheld from a copy produced
// for discovery or a data request. A redacted copy is generated from the same record: every tagged value is
// replaced by a mark, and a log at the end lists what was withheld and under which category.
//
// The tags here are defaults. An administrator changes them field by field in Configuration → Redaction fields;
// those choices are stored as overrides in settings.redaction and audited like any other configuration change.
//
// What this does not do: it does not read free text looking for sensitive words, and it cannot see inside attached
// files. A free-text field is either tagged as a whole or produced as a whole. People still review a redacted copy
// before it leaves, and counsel decides which categories are withheld in a given proceeding.
//
// Pure: tags are data; helpers read state and return values.
import type { AppState, FormValue, RedactionTag } from '../types'
import { FORM_TEMPLATES, type ChecklistValue, type DocField, type DocFormTemplate, type TableValue } from './forms'

export const REDACTION_TAGS: Record<RedactionTag, { label: string; short: string; covers: string }> = {
  personal: { label: 'Personal information', short: 'Personal', covers: 'Names of individual employees, contractors, inspectors and reviewers.' },
  commercial: { label: 'Commercially sensitive', short: 'Commercial', covers: 'Estimates, bid prices, scores, award amounts and contingency that would weaken a future bid or negotiation.' },
  security: { label: 'Security-sensitive infrastructure', short: 'Security', covers: 'Pressures, pipe specifications, stationing, tie-in and outage details of operating gas facilities.' },
  'third-party': { label: 'Third-party information', short: 'Third party', covers: 'Bidders, landowner parcels and named outside stakeholders.' },
}
export const TAG_ORDER: RedactionTag[] = ['personal', 'commercial', 'security', 'third-party']

/**
 * Default tags, by "form id.field key" or "form id.field key.column key". A form id of * applies to that field key on
 * every form (the project block and the people fields are the same on all of them).
 */
// VERIFY: a deliberately generous starting list drafted for the demo, so the obvious ones can be removed rather than
// hunted for. Counsel and the regulatory team confirm the categories and the fields before any real use.
export const DEFAULT_REDACTION: Record<string, RedactionTag> = {
  // On every form
  '*.asset': 'security',
  '*.sponsor': 'personal', '*.pm': 'personal', '*.engineer': 'personal', '*.cm': 'personal', '*.eor': 'personal',
  '*.maop': 'security',
  '*.estimate': 'commercial',
  '*.approvals': 'personal', // the names in the approvals block of the PDF (prepared, approved, verified)
  // Need and concept
  'f-charter.stakeholders.name': 'third-party',
  'f-feas.alts.cost': 'commercial',
  'f-estimate.total': 'commercial', 'f-estimate.range': 'commercial',
  'f-risk.cont': 'commercial',
  'f-recrev.segments.stations': 'security', 'f-recrev.segments.basis': 'security',
  // Options and planning
  'f-options.options.cost': 'commercial',
  'f-pep.outage': 'security',
  'f-longlead.items.spec': 'security',
  // Design
  'f-bod.designPsig': 'security', 'f-bod.maopPsig': 'security', 'f-bod.grade': 'security', 'f-bod.wall': 'security', 'f-bod.tieins': 'security', 'f-bod.route': 'security',
  'f-constr.findings.owner': 'personal',
  'f-outreach.plan.who': 'third-party', 'f-outreach.plan.owner': 'personal',
  'f-dreview.reviews.reviewer': 'personal',
  'f-itp.points.who': 'personal', 'f-itp.testPsig': 'security',
  'f-land.parcels.parcel': 'third-party',
  // Award and readiness
  'f-award.bids.bidder': 'third-party', 'f-award.bids.price': 'commercial', 'f-award.bids.tech': 'commercial', 'f-award.bids.safety': 'commercial',
  'f-award.award': 'third-party', 'f-award.amount': 'commercial', 'f-award.variance': 'commercial',
  'f-hydro.sections.from': 'security', 'f-hydro.sections.to': 'security', 'f-hydro.sections.psig': 'security', 'f-hydro.source': 'security', 'f-hydro.discharge': 'security',
  // Construction and commissioning
  'f-commission.testPsig': 'security', 'f-commission.custodian': 'personal',
  'f-notice.segments': 'security', 'f-notice.signer': 'personal',
  'f-training.opsSignoff': 'personal',
  'f-demob.inspector': 'personal',
  'f-mc.punch.owner': 'personal',
  'f-pssr.lead': 'personal',
  'f-maop.segments.testPsig': 'security', 'f-maop.segments.maop': 'security',
}

export const redactionRef = (templateId: string, fieldKey: string, column?: string) => `${templateId}.${fieldKey}${column ? `.${column}` : ''}`

/**
 * Fields that mean the same thing on every form they appear on: the project block and the people on the team.
 * They are tagged once, for every form, so removing an obvious one is a single choice and not one per form.
 */
export const EVERY_FORM_FIELDS: { key: string; label: string }[] = [
  { key: 'location', label: 'Location (city, county, district)' },
  { key: 'asset', label: 'Asset (line, diameter, length)' },
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'pm', label: 'Project manager' },
  { key: 'engineer', label: 'Project engineer' },
  { key: 'cm', label: 'Construction manager' },
  { key: 'eor', label: 'Engineer of record' },
  { key: 'maop', label: 'MAOP' },
  { key: 'estimate', label: 'Current estimate' },
]
const EVERY_FORM_KEYS = new Set(EVERY_FORM_FIELDS.map((f) => f.key))

/**
 * The tag on a field (or one column of a table field): an administrator's choice first, then the default. A choice or
 * default for the one form beats the one for every form.
 */
export function tagFor(s: Pick<AppState, 'settings'>, templateId: string, fieldKey: string, column?: string): RedactionTag | undefined {
  const ref = redactionRef(templateId, fieldKey, column), every = redactionRef('*', fieldKey, column)
  const chosen = s.settings.redaction?.overrides[ref] ?? s.settings.redaction?.overrides[every]
  if (chosen) return chosen === 'none' ? undefined : chosen
  return DEFAULT_REDACTION[ref] ?? DEFAULT_REDACTION[every]
}

/** The approvals block of every record names the people who prepared, approved and verified it. */
export const APPROVALS_REF = '*.approvals'
export function approvalsTag(s: Pick<AppState, 'settings'>): RedactionTag | undefined {
  const chosen = s.settings.redaction?.overrides[APPROVALS_REF]
  return chosen ? (chosen === 'none' ? undefined : chosen) : DEFAULT_REDACTION[APPROVALS_REF]
}

/** Everything the PDF builder needs for a redacted copy of one record. */
export function redactedCopy(s: Pick<AppState, 'settings'>, t: DocFormTemplate, data: Record<string, FormValue>) {
  return { ...redactForm(s, t, data), hideNames: !!approvalsTag(s) }
}

export interface FieldTags { field?: RedactionTag; columns: Record<string, RedactionTag> }
export function fieldTags(s: Pick<AppState, 'settings'>, t: DocFormTemplate, f: DocField): FieldTags {
  const columns: Record<string, RedactionTag> = {}
  for (const c of f.columns ?? []) { const tag = tagFor(s, t.id, f.key, c.key); if (tag) columns[c.key] = tag }
  return { field: tagFor(s, t.id, f.key), columns }
}

/** Short notes for the form ("Redacted · Personal", "Redacted columns: Bidder, Price"), by field key. */
export function redactionNotes(s: Pick<AppState, 'settings'>, t: DocFormTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const sec of t.sections) for (const f of sec.fields) {
    const tags = fieldTags(s, t, f)
    if (tags.field) out[f.key] = `Redacted · ${REDACTION_TAGS[tags.field].short}`
    else if (Object.keys(tags.columns).length) out[f.key] = `Redacted columns: ${(f.columns ?? []).filter((c) => tags.columns[c.key]).map((c) => c.label).join(', ')}`
  }
  return out
}

export const redactionMark = (tag: RedactionTag) => `[Redacted: ${REDACTION_TAGS[tag].short}]`

export interface RedactionEntry { section: string; field: string; part?: string; tag: RedactionTag; count: number }

/**
 * A redacted copy of a form's values. Tagged values that hold something are replaced by a mark; empty ones are left
 * empty (there is nothing to withhold, and a mark would suggest otherwise). The log lists each thing withheld.
 */
export function redactForm(s: Pick<AppState, 'settings'>, t: DocFormTemplate, data: Record<string, FormValue>): { data: Record<string, FormValue>; log: RedactionEntry[] } {
  const out: Record<string, FormValue> = { ...data }
  const log: RedactionEntry[] = []
  const has = (x: unknown) => x !== undefined && x !== null && x !== ''
  for (const sec of t.sections) for (const f of sec.fields) {
    const tags = fieldTags(s, t, f)
    const v = data[f.key]
    if (f.type === 'table') {
      const rows = (Array.isArray(v) ? v : []) as TableValue
      const cols = tags.field ? Object.fromEntries((f.columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key }))).map((c) => [c.key, tags.field!])) : tags.columns
      if (!Object.keys(cols).length || !rows.length) continue
      const counts: Record<string, number> = {}
      out[f.key] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => {
        if (!cols[k] || !has(x)) return [k, x]
        counts[k] = (counts[k] ?? 0) + 1
        return [k, redactionMark(cols[k])]
      })))
      for (const [k, count] of Object.entries(counts)) log.push({ section: sec.title, field: f.label, part: (f.columns ?? []).find((c) => c.key === k)?.label ?? k, tag: cols[k], count })
      continue
    }
    if (!tags.field) continue
    if (f.type === 'checklist') {
      const c = (v ?? {}) as ChecklistValue
      const answered = Object.keys(c).filter((k) => has(c[k]?.v) || has(c[k]?.note))
      if (!answered.length) continue
      out[f.key] = Object.fromEntries(answered.map((k) => [k, { v: redactionMark(tags.field!) }]))
      log.push({ section: sec.title, field: f.label, tag: tags.field, count: answered.length })
      continue
    }
    if (!has(v)) continue
    out[f.key] = redactionMark(tags.field)
    log.push({ section: sec.title, field: f.label, tag: tags.field, count: 1 })
  }
  return { data: out, log }
}

/** Every taggable place, for the configuration screen. */
export interface RedactionRow { ref: string; templateId: string; section: string; label: string; current?: RedactionTag; isDefault: boolean }
/** One form's own fields. The fields shared by every form are listed once, by everyFormRows. */
export function redactionRows(s: Pick<AppState, 'settings'>, t: DocFormTemplate): RedactionRow[] {
  const rows: RedactionRow[] = []
  const row = (section: string, label: string, fieldKey: string, column?: string): RedactionRow => {
    const ref = redactionRef(t.id, fieldKey, column)
    return { ref, templateId: t.id, section, label, current: tagFor(s, t.id, fieldKey, column), isDefault: !s.settings.redaction?.overrides[ref] }
  }
  for (const sec of t.sections) for (const f of sec.fields) {
    if (EVERY_FORM_KEYS.has(f.key)) continue
    rows.push(row(sec.title, f.label, f.key))
    for (const c of f.columns ?? []) rows.push(row(sec.title, `${f.label} → ${c.label}`, f.key, c.key))
  }
  return rows
}
/** The fields shared by every form, plus the approvals block. One choice applies to all forms. */
export function everyFormRows(s: Pick<AppState, 'settings'>): RedactionRow[] {
  const o = s.settings.redaction?.overrides ?? {}
  const pick = (ref: string): RedactionTag | undefined => { const c = o[ref]; return c ? (c === 'none' ? undefined : c) : DEFAULT_REDACTION[ref] }
  return [
    { ref: APPROVALS_REF, templateId: '*', section: 'Approvals', label: 'Names of the people who prepared, approved and verified', current: pick(APPROVALS_REF), isDefault: !o[APPROVALS_REF] },
    ...EVERY_FORM_FIELDS.map((f) => ({ ref: redactionRef('*', f.key), templateId: '*', section: 'Project and team', label: f.label, current: pick(redactionRef('*', f.key)), isDefault: !o[redactionRef('*', f.key)] })),
  ]
}

/** How many places are tagged (for the configuration tab's count): each shared field once, plus each form's own fields. */
export const taggedCount = (s: Pick<AppState, 'settings'>) => FORM_TEMPLATES.reduce((n, t) => n + redactionRows(s, t).filter((r) => r.current).length, everyFormRows(s).filter((r) => r.current).length)
