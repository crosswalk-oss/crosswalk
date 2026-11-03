// Pure helpers for the SAP actuals pages: import review roll-ups, exception reasons, rule labels and the
// coverage checks the mapping-table admin runs. No React; everything takes AppState so it can be unit-tested.
import type { ActualsImport, ActualTxn, AppState, Money, Project, SapMapping, TxnStatus } from '@/core/types'
import { forecastLines, functionOfLine, lineById } from '@/core/engine/lines'
import { matchRule, projectForWbs } from '@/core/engine/sap'
import { sum } from '@/core/util'

export const TXN_STATUS: Record<TxnStatus, { label: string; tone: 'good' | 'info' | 'neutral' | 'bad' | 'warn'; hint: string }> = {
  mapped: { label: 'Mapped', tone: 'good', hint: 'A mapping rule (or a person) sent it to one forecast line' },
  allocated: { label: 'Allocated', tone: 'info', hint: 'Loader / overhead settlement spread over the period’s direct lines pro-rata' },
  excluded: { label: 'Excluded', tone: 'neutral', hint: 'Kept out of project actuals (balance-sheet or non-project cost)' },
  unmapped: { label: 'Unmapped', tone: 'bad', hint: 'No active rule covers the cost element — blocks posting' },
  'no-project': { label: 'No project', tone: 'bad', hint: 'The SAP WBS element matches no project — blocks posting' },
}

export const importTxns = (s: AppState, importId: string) => s.actualTxns.filter((t) => t.importId === importId)

export interface ImportFigures { rows: number; total: Money; mapped: Money; allocated: Money; excluded: Money; unmapped: Money; noProject: Money; exceptions: number; resolved: number; credits: number; projects: number; periods: string[] }
export function importFigures(txns: ActualTxn[]): ImportFigures {
  const t = (st: TxnStatus) => Math.round(sum(txns.filter((x) => x.status === st).map((x) => x.amount)))
  return {
    rows: txns.length,
    total: Math.round(sum(txns.map((x) => x.amount))),
    mapped: t('mapped'), allocated: t('allocated'), excluded: t('excluded'), unmapped: t('unmapped'), noProject: t('no-project'),
    exceptions: txns.filter(isException).length,
    resolved: txns.filter((x) => x.manual).length,
    credits: txns.filter((x) => x.amount < 0 && x.status !== 'excluded').length,
    projects: new Set(txns.map((x) => x.projectId).filter(Boolean)).size,
    periods: [...new Set(txns.map((x) => x.period))].sort(),
  }
}

export const isException = (t: ActualTxn) => t.status === 'unmapped' || t.status === 'no-project'

/** Plain-language reason a row needs a person. */
export function exceptionReason(s: AppState, t: ActualTxn): string {
  if (t.status === 'no-project') return `WBS element ${t.sapWbs} does not belong to any project (no project has that ERP WBS or a parent of it)`
  if (t.status === 'unmapped') {
    const r = s.settings.sapMappings.find((x) => x.id === t.ruleId)
    if (r?.target === 'line') return `Rule P${r.priority} matches but targets a line that is missing or inactive`
    return `No active mapping rule covers cost element ${t.costElement}${t.costElementName ? ` (${t.costElementName})` : ''}`
  }
  return ''
}

/** "P30 · 5200000–5200999 → 06.10 Contract construction" */
export function ruleLabel(s: AppState, r?: SapMapping): string {
  if (!r) return ''
  return `P${r.priority} · ${r.costElementFrom}–${r.costElementTo}${r.wbsSuffix ? ` on *${r.wbsSuffix}` : ''}${r.textContains ? ` text “${r.textContains}”` : ''} → ${targetLabel(s, r)}`
}
export function targetLabel(s: AppState, r: Pick<SapMapping, 'target' | 'lineId'>): string {
  if (r.target === 'allocate') return 'Allocate pro-rata'
  if (r.target === 'exclude') return 'Exclude'
  const l = lineById(s, r.lineId)
  return l ? `${l.code} ${l.name}` : 'Missing line'
}
export const ruleOf = (s: AppState, t: ActualTxn) => s.settings.sapMappings.find((x) => x.id === t.ruleId)

/** How a transaction landed: rule, manual resolution or status. */
export function howMapped(s: AppState, t: ActualTxn): string {
  if (t.manual) return `Resolved by hand${t.manual.note ? ` — ${t.manual.note}` : ''}`
  const r = ruleOf(s, t)
  return r ? ruleLabel(s, r) : TXN_STATUS[t.status].hint
}

export interface ProjectRoll {
  p?: Project
  projectId: string
  byLine: Record<string, { direct: Money; allocated: Money }>
  direct: Money; allocated: Money; excluded: Money; exceptions: Money
  rows: number
}
/**
 * Roll an import up by project and forecast line. Allocated rows use their posted allocation; on a staged import
 * they are previewed the same way posting will do it (pro-rata to the project-period's mapped lines).
 */
export function projectLineRollup(s: AppState, txns: ActualTxn[]): ProjectRoll[] {
  const out = new Map<string, ProjectRoll>()
  const get = (pid: string) => {
    let r = out.get(pid)
    if (!r) { r = { p: s.projects.find((x) => x.id === pid), projectId: pid, byLine: {}, direct: 0, allocated: 0, excluded: 0, exceptions: 0, rows: 0 }; out.set(pid, r) }
    return r
  }
  const cell = (r: ProjectRoll, lid: string) => (r.byLine[lid] ??= { direct: 0, allocated: 0 })
  for (const t of txns) {
    const r = get(t.projectId ?? '—')
    r.rows++
    if (t.status === 'mapped' && t.lineId) { cell(r, t.lineId).direct += t.amount; r.direct += t.amount }
    else if (t.status === 'excluded') r.excluded += t.amount
    else if (isException(t)) r.exceptions += t.amount
  }
  for (const t of txns.filter((x) => x.status === 'allocated')) {
    const r = get(t.projectId ?? '—')
    const share = t.allocation ?? previewAllocation(txns, t)
    for (const [lid, v] of Object.entries(share)) cell(r, lid).allocated += v
    r.allocated += t.amount
  }
  return [...out.values()].sort((a, b) => (a.p?.code ?? 'ZZZ').localeCompare(b.p?.code ?? 'ZZZ'))
}

/** Pro-rata split of an allocated row over its project-period's mapped lines (mirrors postImport). */
export function previewAllocation(txns: ActualTxn[], t: ActualTxn): Record<string, Money> {
  const direct: Record<string, Money> = {}
  for (const x of txns) if (x.status === 'mapped' && x.lineId && x.projectId === t.projectId && x.period === t.period) direct[x.lineId] = (direct[x.lineId] || 0) + x.amount
  const ids = Object.keys(direct)
  if (!ids.length) return {}
  const base = sum(Object.values(direct))
  const out: Record<string, Money> = {}
  let acc = 0
  ids.forEach((k, i) => { const v = i === ids.length - 1 ? Math.round((t.amount - acc) * 100) / 100 : Math.round(t.amount * (base ? direct[k] / base : 1 / ids.length) * 100) / 100; out[k] = v; acc += v })
  return out
}

export const importLabel = (imp: ActualsImport) => `${imp.fileName} · ${imp.period}`

// ───────────────────────────── Mapping-table coverage

export interface Overlap { a: SapMapping; b: SapMapping; kind: 'refines' | 'shadowed' | 'conflict'; text: string }
const n = (x: string) => Number(x)
const covers = (a: SapMapping, b: SapMapping) => n(a.costElementFrom) <= n(b.costElementFrom) && n(a.costElementTo) >= n(b.costElementTo)
const intersects = (a: SapMapping, b: SapMapping) => n(a.costElementFrom) <= n(b.costElementTo) && n(b.costElementFrom) <= n(a.costElementTo)
const hasFilter = (r: SapMapping) => !!(r.wbsSuffix || r.textContains)

/** Overlapping cost-element ranges among active rules, classified: a narrower rule first (fine), a rule that can never match, or a real conflict. */
export function ruleOverlaps(rules: SapMapping[]): Overlap[] {
  const act = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority)
  const out: Overlap[] = []
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const a = act[i], b = act[j] // a runs first
    if (!intersects(a, b)) continue
    const sameTarget = a.target === b.target && a.lineId === b.lineId
    if (covers(a, b) && !hasFilter(a)) out.push({ a, b, kind: 'shadowed', text: `P${b.priority} never matches: P${a.priority} runs first and covers its whole range with no WBS or text filter` })
    else if (hasFilter(a) || covers(b, a)) out.push({ a, b, kind: 'refines', text: `P${a.priority} is narrower and runs first; P${b.priority} catches the rest` })
    else out.push({ a, b, kind: sameTarget ? 'refines' : 'conflict', text: sameTarget ? `Ranges overlap but both send cost to the same place` : `Ranges partly overlap with different targets — rows in ${a.costElementFrom > b.costElementFrom ? a.costElementFrom : b.costElementFrom}–${a.costElementTo < b.costElementTo ? a.costElementTo : b.costElementTo} follow P${a.priority}` })
  }
  return out
}

/** Active forecast lines no active rule sends cost to. */
export const linesWithoutRule = (s: AppState) => forecastLines(s).filter((l) => !s.settings.sapMappings.some((r) => r.active && r.target === 'line' && r.lineId === l.id))

/** Rules pointing at a missing or inactive line. */
export const brokenRules = (s: AppState) => s.settings.sapMappings.filter((r) => r.active && r.target === 'line' && !forecastLines(s).some((l) => l.id === r.lineId))

/** Cost elements in staged imports that no rule covers (what to add next), with row count and amount. */
export function unmappedElements(s: AppState): { costElement: string; name: string; rows: number; amount: Money }[] {
  const staged = new Set(s.actualsImports.filter((x) => x.status === 'staged').map((x) => x.id))
  const m = new Map<string, { costElement: string; name: string; rows: number; amount: Money }>()
  for (const t of s.actualTxns) if (staged.has(t.importId) && t.status === 'unmapped' && !t.manual) {
    const e = m.get(t.costElement) ?? { costElement: t.costElement, name: t.costElementName, rows: 0, amount: 0 }
    e.rows++; e.amount += t.amount
    m.set(t.costElement, e)
  }
  return [...m.values()]
}

/** Test one row against the mapping table: the winning rule, every rule that would match, and the project. */
export function testRow(s: AppState, row: { costElement: string; sapWbs: string; text: string }, rules = s.settings.sapMappings) {
  const r = { ...row, vendor: '' }
  const winner = matchRule(rules, r)
  const all = [...rules].filter((x) => x.active).sort((a, b) => a.priority - b.priority).filter((x) => matchRule([x], r))
  const p = row.sapWbs.trim() ? projectForWbs(s, row.sapWbs) : undefined
  const line = winner?.target === 'line' ? lineById(s, winner.lineId) : undefined
  return { winner, all, project: p, line, fnId: line ? functionOfLine(s, line.id) : undefined }
}
