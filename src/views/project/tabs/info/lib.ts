// Pure helpers for the Project Information record (PI-*): values, revision numbering and
// reconstruction, the formal data-sheet export, CSV / plain-text, configuration stats and AI drafting.
import type { AppState, InfoFieldDef, InfoRevision, Project } from '@/core/types'
import { infoValue } from '@/core/engine/info'
import { templateFor } from '@/core/engine/gates'
import { fmtDate, fmtDateTime } from '@/core/util'
import { toCSV } from '@/core/download'

/** Fields computed from other records (never stored on the info record). */
export const SYSTEM_KEYS = ['program', 'pm', 'sponsor', 'recovery']

/** Project paths a field may be bound to (value lives on the project itself). */
export const BIND_PATHS: { path: string; label: string; type: InfoFieldDef['type']; options?: string[] }[] = [
  { path: 'name', label: 'Project name', type: 'text' },
  { path: 'erpWbs', label: 'ERP WBS element', type: 'text' },
  { path: 'scheduleId', label: 'Schedule (P6) ID', type: 'text' },
  { path: 'driver', label: 'Primary driver', type: 'select', options: ['Safety / compliance', 'Reliability', 'Capacity', 'Customer / new business', 'Relocation', 'Environmental'] },
  { path: 'regulatoryCitation', label: 'Regulatory citation', type: 'text' },
  { path: 'fundingProceeding', label: 'Funding proceeding', type: 'text' },
  { path: 'contractor', label: 'Prime contractor', type: 'text' },
  { path: 'scope.summary', label: 'Scope summary', type: 'textarea' },
  { path: 'asset.lineId', label: 'Line / facility ID', type: 'text' },
  { path: 'asset.diameterIn', label: 'Diameter (in)', type: 'number' },
  { path: 'asset.lengthFt', label: 'Length (ft)', type: 'number' },
  { path: 'asset.maopPsig', label: 'MAOP (psig)', type: 'number' },
  { path: 'asset.material', label: 'Material / grade', type: 'text' },
  { path: 'asset.vintage', label: 'Vintage', type: 'number' },
  { path: 'asset.recordsStatus', label: 'Records status', type: 'select', options: ['complete', 'gaps', 'unknown'] },
  { path: 'location.city', label: 'City', type: 'text' },
  { path: 'location.county', label: 'County', type: 'text' },
  { path: 'location.district', label: 'Operating district', type: 'text' },
  { path: 'location.classLocation', label: 'Class location', type: 'select', options: ['1', '2', '3', '4'] },
  { path: 'location.hca', label: 'High consequence area', type: 'boolean' },
  { path: 'location.dac', label: 'Disadvantaged community', type: 'boolean' },
  { path: 'dates.initiated', label: 'Initiated date', type: 'date' },
  { path: 'dates.inService', label: 'In-service date', type: 'date' },
]

export const FIELD_TYPES: { id: InfoFieldDef['type']; label: string }[] = [
  { id: 'text', label: 'Text' }, { id: 'textarea', label: 'Long text' }, { id: 'select', label: 'Choice list' },
  { id: 'date', label: 'Date' }, { id: 'number', label: 'Number' }, { id: 'money', label: 'Money' }, { id: 'boolean', label: 'Yes / No' },
]

export const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** All current values keyed by field key. */
export function currentValues(s: AppState, p: Project): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of s.settings.infoFields) out[f.key] = infoValue(p, f, s)
  return out
}

/** Human display of a stored value. */
export function displayValue(def: InfoFieldDef, v: string): string {
  if (!v || !v.trim()) return ''
  if (def.type === 'money') { const n = Number(v.replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : v }
  if (def.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v.slice(0, 10))
  if (def.key === 'classLocation' || def.bind === 'location.classLocation') return `Class ${v}`
  if (def.bind === 'asset.recordsStatus') return v[0].toUpperCase() + v.slice(1)
  return v
}

export interface NumberedRevision extends InfoRevision { rev: number }

/** Revisions for a project, numbered 1..N in time order, returned newest first. */
export function revisionsFor(s: Pick<AppState, 'infoRevisions'>, pid: string): NumberedRevision[] {
  return s.infoRevisions
    .filter((r) => r.projectId === pid)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((r, i) => ({ ...r, rev: i + 1 }))
    .reverse()
}

/**
 * Values as they stood right after revision `rev` (0 = before the first recorded revision).
 * Reconstructed by undoing every later revision, newest first, from the current values.
 */
export function valuesAsOf(current: Record<string, string>, revs: NumberedRevision[], rev: number): Record<string, string> {
  const out = { ...current }
  const later = revs.filter((r) => r.rev > rev).sort((a, b) => b.rev - a.rev)
  for (const r of later) for (const c of r.changes) out[c.key] = c.from
  return out
}

/** Keys changed by a revision (for highlighting in the as-of view). */
export const changedKeys = (r?: InfoRevision) => new Set((r?.changes ?? []).map((c) => c.key))

export function stageLabel(s: AppState, p: Project, stageIndex: number): string {
  const st = templateFor(s, p).stages[stageIndex]
  return st ? `Stage ${stageIndex + 1} · ${st.name}` : `Stage ${stageIndex + 1}`
}

/** Required-for-current-stage state of one field: 'blocking' (empty, required now or earlier), 'later', 'met' or undefined. */
export function requirement(def: InfoFieldDef, value: string, stageIndex: number): 'blocking' | 'later' | 'met' | undefined {
  if (def.requiredAtStage === undefined || def.readOnly) return undefined
  if (value.trim()) return 'met'
  return def.requiredAtStage <= stageIndex ? 'blocking' : 'later'
}

/** Gate the current stage ends in (what an empty required field holds up). */
export function currentGateName(s: AppState, p: Project): string | undefined {
  return templateFor(s, p).stages[p.stageIndex]?.gate.name
}
export const gateShort = (name?: string) => (name ? name.split(' · ')[0] : 'the next gate')

/** Fields grouped by configured section order (unknown sections appended). */
export function sectionsOf(s: Pick<AppState, 'settings'>): { name: string; fields: InfoFieldDef[] }[] {
  const names = [...s.settings.infoSections]
  for (const f of s.settings.infoFields) if (!names.includes(f.section)) names.push(f.section)
  return names.map((name) => ({ name, fields: s.settings.infoFields.filter((f) => f.section === name) })).filter((x) => x.fields.length || s.settings.infoSections.includes(x.name))
}

// ───────────────────────────── Exports

export function infoCsv(s: AppState, p: Project, values = currentValues(s, p)): string {
  return toCSV(s.settings.infoFields.map((f) => ({ Section: f.section, Field: f.label, Value: displayValue(f, values[f.key] ?? '') })))
}

export function infoText(s: AppState, p: Project, values = currentValues(s, p)): string {
  const revs = revisionsFor(s, p.id)
  const lines = [`${p.code} ${p.name}`, `Project information · rev ${revs[0]?.rev ?? 0}${revs[0] ? ` (${fmtDate(revs[0].at.slice(0, 10))})` : ''}`, '']
  for (const sec of sectionsOf(s)) {
    if (!sec.fields.length) continue
    lines.push(sec.name.toUpperCase())
    for (const f of sec.fields) lines.push(`${f.label}: ${displayValue(f, values[f.key] ?? '') || 'Not provided'}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

/** Formal data sheet: one page per section with a controlled-document header, revision log at the end. */
export function infoSheetHtml(s: AppState, p: Project, opts: { values?: Record<string, string>; asOfRev?: number } = {}): string {
  const revs = revisionsFor(s, p.id)
  const rev = opts.asOfRev ?? revs[0]?.rev ?? 0
  const revRec = revs.find((r) => r.rev === rev)
  const values = opts.values ?? currentValues(s, p)
  const revDate = revRec ? fmtDate(revRec.at.slice(0, 10)) : fmtDate(s.settings.asOf)
  const prog = s.programs.find((x) => x.id === p.programId)
  const pname = (id?: string) => s.people.find((x) => x.id === id)?.name ?? '—'
  const head = (title: string) => `<div class="hdr"><div><div class="org">${esc(s.settings.orgName)}</div><div class="doc">Project Information Sheet</div></div>
    <table class="meta"><tr><th>Project</th><td>${esc(p.code)}</td></tr><tr><th>Revision</th><td>Rev ${rev}</td></tr><tr><th>Date</th><td>${esc(revDate)}</td></tr></table></div>
    <h1>${esc(p.name)}</h1><div class="sub">${esc(prog ? `${prog.code} · ${prog.name}` : '')} · ${esc(stageLabel(s, p, p.stageIndex))} · PM ${esc(pname(p.team.pm))}</div><h2>${esc(title)}</h2>`
  const pages = sectionsOf(s).filter((x) => x.fields.length).map((sec, i) => {
    const rows = sec.fields.map((f) => {
      const v = displayValue(f, values[f.key] ?? '')
      const req = f.requiredAtStage !== undefined && !f.readOnly ? `<span class="tag">Req. stage ${f.requiredAtStage + 1}</span>` : ''
      const src = f.readOnly ? '<span class="tag">System</span>' : f.bind ? '<span class="tag">Project data</span>' : ''
      return `<tr><th class="lbl">${esc(f.label)} ${req} ${src}</th><td class="${f.type === 'textarea' ? 'long' : ''}">${v ? esc(v).replace(/\n/g, '<br>') : '<span class="np">Not provided</span>'}</td></tr>`
    }).join('')
    return `<section class="page${i ? ' brk' : ''}">${head(sec.name)}<table class="sheet">${rows}</table>
      <div class="foot">${esc(p.code)} · Project Information Sheet · Rev ${rev} · Section ${i + 1}</div></section>`
  })
  const log = revs.filter((r) => r.rev <= rev).map((r) => `<tr><td>Rev ${r.rev}</td><td>${esc(fmtDateTime(r.at))}</td><td>${esc(pname(r.byId))}</td><td>${esc(r.note)}</td><td>${r.changes.map((c) => esc(c.label)).join('; ')}</td></tr>`).join('')
  const logPage = `<section class="page brk">${head('Revision log')}<table><thead><tr><th>Rev</th><th>Date</th><th>By</th><th>Reason for change</th><th>Fields changed</th></tr></thead><tbody>${log || '<tr><td colspan="5">No revisions recorded.</td></tr>'}</tbody></table>
    <p class="meta-note">Generated ${esc(fmtDate(s.settings.asOf))} from the Crosswalk project information record. Field-level history is held in the system of record.</p></section>`
  const css = `<style>.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #141b24;padding-bottom:8px;margin-bottom:14px}
  .org{font-weight:700;font-size:15px}.doc{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#4f5a69}
  table.meta{width:auto;margin:0}table.meta th,table.meta td{padding:2px 8px;font-size:11px}
  h1{font-size:20px}.sub{color:#4f5a69;margin-bottom:6px}
  table.sheet th.lbl{width:38%;background:#f4f6f8;text-transform:none;letter-spacing:0;font-size:12px;font-weight:600}
  td.long{white-space:normal}.np{color:#8a94a3;font-style:italic}.tag{font-weight:400;color:#4f5a69;margin-left:4px}
  .foot{margin-top:16px;border-top:1px solid #d6dce3;padding-top:4px;font-size:10px;color:#4f5a69}.meta-note{color:#4f5a69;font-size:11px}
  .brk{page-break-before:always;break-before:page;margin-top:48px}@media print{.brk{margin-top:0}}</style>`
  return css + pages.join('') + logPage
}

// ───────────────────────────── Configuration stats

/** Per field: active projects with it empty, and how many of those it blocks at their current stage. */
export function fieldStats(s: AppState, def: InfoFieldDef): { empty: number; blocked: number; blockedCodes: string[] } {
  const active = s.projects.filter((p) => p.status === 'active')
  let empty = 0
  const blockedCodes: string[] = []
  for (const p of active) {
    if (def.readOnly) continue
    if (infoValue(p, def, s).trim()) continue
    empty++
    if (def.requiredAtStage !== undefined && def.requiredAtStage <= p.stageIndex) blockedCodes.push(p.code)
  }
  return { empty, blocked: blockedCodes.length, blockedCodes }
}

/** A readable camelCase key from a label, unique among existing keys. */
export function keyFromLabel(label: string, taken: string[]): string {
  const words = label.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4)
  let base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'field'
  if (/^\d/.test(base)) base = 'f' + base
  let k = base, n = 2
  while (taken.includes(k)) k = `${base}${n++}`
  return k
}
export const validKey = (k: string) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(k)

// ───────────────────────────── AI drafting

export interface DraftProposal { key: string; value: string; basis: string }

export function draftPrompt(s: AppState, p: Project, defs: InfoFieldDef[]): string {
  const prog = s.programs.find((x) => x.id === p.programId)
  const risks = s.risks.filter((r) => r.projectId === p.id && r.status !== 'closed').map((r) => `- ${r.title}`).join('\n') || '- none recorded'
  const permits = s.permits.filter((x) => x.projectId === p.id).map((x) => `- ${x.agency}: ${x.type} (${x.status})`).join('\n') || '- none recorded'
  const known = s.settings.infoFields.filter((f) => !defs.includes(f)).map((f) => [f.label, infoValue(p, f, s)] as const).filter(([, v]) => v.trim()).map(([l, v]) => `- ${l}: ${v}`).join('\n')
  const wanted = defs.map((f) => `- key "${f.key}": ${f.label} (${f.type}${f.options ? `; one of: ${f.options.join(' | ')}` : ''}${f.type === 'boolean' ? '; "Yes" or "No"' : ''}${f.type === 'date' ? '; YYYY-MM-DD' : ''}${f.help ? `; ${f.help}` : ''})`).join('\n')
  return `You are helping a gas utility project manager complete a controlled Project Information record for a capital project. Propose values ONLY for the empty fields listed, using only the facts given. If the facts do not support a value, omit that field. Write in plain, specific utility-engineering language, 1–3 sentences for long-text fields. Do not invent permit numbers, work-order numbers, dates or customer counts.

Project: ${p.code} ${p.name}
Program: ${prog ? `${prog.code} ${prog.name}` : ''} · Stage ${p.stageIndex + 1} · Work method: ${p.workMethod}
Driver: ${p.driver} · Citation: ${p.regulatoryCitation}
Scope: ${p.scope.summary}
In scope: ${p.scope.inScope.join('; ')}
Out of scope: ${p.scope.outOfScope.join('; ')}
Quantities: ${p.scope.quantities.map((q) => `${q.qty} ${q.unit} ${q.label}`).join('; ')}
Assumptions: ${p.scope.assumptions.join('; ')}
Asset: ${p.asset.type}, line ${p.asset.lineId}, ${p.asset.diameterIn} in, ${p.asset.lengthFt} ft, MAOP ${p.asset.maopPsig} psig, ${p.asset.material}, ${p.asset.vintage}, records ${p.asset.recordsStatus}
Location: ${p.location.city}, ${p.location.county}, ${p.location.district} district, class ${p.location.classLocation}, ${p.location.terrain}${p.location.hca ? ', HCA' : ''}${p.location.dac ? ', disadvantaged community' : ''}
Open risks:
${risks}
Permits:
${permits}
Fields already on the record:
${known || '- none'}

Empty fields to propose:
${wanted}

Return JSON exactly: {"fields":[{"key":"<field key>","value":"<proposed value>","basis":"<one short sentence citing which facts support it>"}]}`
}

/** Keep only usable proposals for the requested fields; coerce to each field's type. */
export function cleanProposals(raw: unknown, defs: InfoFieldDef[]): DraftProposal[] {
  const list = Array.isArray((raw as any)?.fields) ? (raw as any).fields : Array.isArray(raw) ? raw : []
  const out: DraftProposal[] = []
  for (const r of list) {
    const def = defs.find((f) => f.key === r?.key)
    if (!def || out.some((o) => o.key === def.key)) continue
    let v = String(r?.value ?? '').trim()
    if (!v) continue
    if (def.type === 'select' && def.options) { const m = def.options.find((o) => o.toLowerCase() === v.toLowerCase()); if (!m) continue; v = m }
    if (def.type === 'boolean') { if (/^(yes|true)$/i.test(v)) v = 'Yes'; else if (/^(no|false)$/i.test(v)) v = 'No'; else continue }
    if (def.type === 'number' || def.type === 'money') { const n = Number(v.replace(/[^0-9.-]/g, '')); if (!Number.isFinite(n) || !/\d/.test(v)) continue; v = String(def.type === 'money' ? Math.round(n) : n) }
    if (def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue
    out.push({ key: def.key, value: v, basis: String(r?.basis ?? '').trim() })
  }
  return out
}
