// Basis of estimate downloads: PDF (jsPDF, bundled) and CSV (opens in Excel). Both read the same facts
// as the on-screen BOE, so the three formats agree line for line.
import { jsPDF } from 'jspdf'
import type { AppState, Estimate, MonteCarloResult } from '@/core/types'
import { CLASS_RANGES, CONT_CAT, estimateTotals, lineTotal, maturityItems } from '@/core/engine/estimates'
import { pricedOnVersion } from '@/core/engine/estimatingAdmin'
import { fmtDate, pct, sum } from '@/core/util'
import { SOURCE_LABEL, benchmarkExceptions, catCode, catName, displayTitle, methodLabel, sourceSummary, workPackages } from './lib'

const usd = (n: number | undefined) => n == null ? '' : '$' + Math.round(n).toLocaleString('en-US')
const usd2 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1000 && n % 1 ? 2 : 0, maximumFractionDigits: 2 })

// VERIFY: BOE section wording, class range statements and contingency rationale text are AI-drafted; the estimating lead signs off.
/** Everything a BOE shows, as plain values. */
export function boeFacts(s: AppState, e: Estimate, opts: { mc?: MonteCarloResult } = {}) {
  const p = s.projects.find((x) => x.id === e.projectId)!
  const t = estimateTotals(e)
  const person = (id?: string) => s.people.find((x) => x.id === id)?.name ?? '-'
  const prog = s.programs.find((x) => x.id === p.programId)
  const r = CLASS_RANGES[e.cls]
  const wf = s.workflows.find((w) => w.id === e.workflowInstanceId)
  const def = wf ? s.workflowDefs.find((d) => d.id === wf.defId) : undefined
  const cats = Object.entries(t.direct).sort((a, b) => catCode(s, a[0]).localeCompare(catCode(s, b[0])))
  return {
    p, t, r, prog, wf, def, cats, person,
    title: `${p.code} Basis of Estimate - v${e.version} Class ${e.cls}`,
    rateVersion: e.method === 'quick' ? undefined : pricedOnVersion(s, e),
    srcs: sourceSummary(e),
    ex: benchmarkExceptions(e, s.rates, s.settings.estimating.regionFactors),
    overrides: e.lines.filter((l) => l.override),
    wps: workPackages(e),
    maturity: maturityItems(s),
    mc: opts.mc && e.contingency.method === 'risk-based' ? opts.mc : undefined,
    history: wf ? wf.history.filter((h) => h.action !== 'system').map((h) => ({ at: h.at.slice(0, 16).replace('T', ' '), who: h.actorId === 'system' ? 'System' : person(h.actorId), action: h.action + (h.signature ? ' (e-signed)' : ''), step: def?.nodes.find((n) => n.id === h.nodeId)?.label ?? '', comment: h.comment ?? '' })) : [],
  }
}

// ───────────────────────────── CSV
const cell = (v: unknown) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x }

/** BOE as one CSV sheet: header facts, summary, categories, markups and every line item. UTF-8 with BOM for Excel. */
export function boeCsv(s: AppState, e: Estimate, opts: { mc?: MonteCarloResult } = {}): string {
  const f = boeFacts(s, e, opts)
  const { p, t } = f
  const rows: unknown[][] = []
  const add = (...r: unknown[]) => rows.push(r)
  add('Basis of Estimate'); add('Organization', s.settings.orgName); add('Project', p.code, p.name); add('Program', f.prog?.code, f.prog?.name)
  add('Estimate', `v${e.version}`, displayTitle(e)); add('AACE class', e.cls); add('Status', e.status); add('Method', methodLabel(e.method))
  if (f.rateVersion) add('Rate table version', f.rateVersion)
  add('Region', e.region ?? p.location.district)
  add('Prepared by', f.person(e.createdById), e.createdAt.slice(0, 10))
  if (e.approvedAt) add('Approved by', f.person(e.approvedById), e.approvedAt.slice(0, 10))
  add('Generated', s.settings.asOf)
  add()
  add('Summary', 'Amount', '% / note')
  add('Direct cost (before tax)', t.lines)
  if (t.tax) add('Sales tax on material', t.tax, `${e.salesTax?.pct}% (${e.salesTax?.counties.map((c) => `${c.county} ${Math.round(c.share * 100)}% at ${c.rate}%`).join('; ')})`)
  add('Loaders', t.loaders, `${sum(e.loaders.map((l) => l.pct)).toFixed(1)}%`)
  add('Escalation', t.escalation, `${e.escalationPct}%`)
  add('Base estimate', t.base)
  add('Contingency', t.contingency, `${e.contingency.pct}% ${e.contingency.method}${e.contingency.method === 'risk-based' ? ' ' + (e.contingency.confidence ?? 'P80') : ''}`)
  add('Total estimate', t.total)
  add('Expected range low', t.low, pct(f.r.low)); add('Expected range high', t.high, '+' + pct(f.r.high))
  add()
  add('Code', 'Category', 'ERP cost element', 'Direct', 'Incl. sales tax', '% of base')
  for (const [c, v] of f.cats) add(catCode(s, c), catName(s, c), s.categories.find((x) => x.id === c)?.erpCostElement, v, t.byCategory[c], t.base ? (t.byCategory[c] / t.base * 100).toFixed(1) + '%' : '')
  add('900', 'Loaders', s.categories.find((x) => x.id === 'cat-loaders')?.erpCostElement, t.loaders, t.loaders)
  add('950', 'Escalation', s.categories.find((x) => x.id === 'cat-escalation')?.erpCostElement, t.escalation, t.escalation)
  add('990', 'Contingency', s.categories.find((x) => x.id === CONT_CAT)?.erpCostElement, t.contingency, t.contingency)
  add()
  add('Loader', 'Rate %', 'Amount')
  for (const l of e.loaders) add(l.name, l.pct, Math.round(t.lines * l.pct / 100))
  add()
  add('Work package', 'Code', 'Category', 'Description', 'Qty', 'Unit', 'Unit cost', 'Line total', 'Source', 'Confidence', 'Rate id', 'Override reason', 'Overridden from')
  for (const l of e.lines) add(l.workPackage, catCode(s, l.categoryId), catName(s, l.categoryId), l.description, l.qty, l.unit, l.unitCost, lineTotal(l), SOURCE_LABEL[l.source], l.confidence, l.rateId ?? '', l.override?.reason ?? '', l.override?.fromUnitCost ?? '')
  add()
  add('Scope basis', e.basis.scopeBasis)
  for (const q of p.scope.quantities) add('Scope quantity', q.label, q.qty, q.unit)
  for (const a of e.basis.assumptions) add('Assumption', a)
  for (const a of e.basis.exclusions) add('Exclusion', a)
  add('Contingency rationale', e.basis.contingencyRationale)
  add('Class justification', e.basis.classJustification)
  for (const m of f.maturity) add('Maturity item', m.label, `Class ${m.forClass}`, e.maturity[m.key] ? 'Complete' : 'Not complete')
  for (const h of f.history) add('Approval history', h.at, h.who, h.action, h.step, h.comment)
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

// ───────────────────────────── PDF
/** Characters the standard PDF fonts cannot draw are replaced with plain equivalents. */
const clean = (x: unknown) => String(x ?? '')
  .replace(/[→⇒]/g, '->').replace(/[←]/g, '<-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/×/g, 'x')
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[•·]/g, '-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')

type Align = 'left' | 'right'
interface Col { label: string; w: number; align?: Align }

/** A small page-flow writer over jsPDF: headings, wrapped paragraphs and tables with repeating headers. */
class Writer {
  doc = new jsPDF({ unit: 'pt', format: 'letter' })
  x = 48
  y = 56
  W = 612 - 96
  bottom = 792 - 54
  constructor(private footer: string) {}
  ensure(h: number) { if (this.y + h > this.bottom) { this.doc.addPage(); this.y = 56 } }
  h1(t: string) { this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(20); this.doc.setTextColor(20, 27, 36); this.doc.text(clean(t), this.x, this.y); this.y += 18 }
  h2(t: string) {
    this.ensure(40); this.y += 10
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(12.5); this.doc.setTextColor(20, 27, 36); this.doc.text(clean(t), this.x, this.y)
    this.y += 5; this.doc.setDrawColor(20, 27, 36); this.doc.setLineWidth(1.2); this.doc.line(this.x, this.y, this.x + this.W, this.y); this.y += 13
  }
  h3(t: string) { this.ensure(26); this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(10.5); this.doc.setTextColor(20, 27, 36); this.doc.text(clean(t), this.x, this.y); this.y += 13 }
  p(t: string, o: { size?: number; muted?: boolean; bold?: boolean } = {}) {
    const size = o.size ?? 9.5
    this.doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); this.doc.setFontSize(size)
    if (o.muted) this.doc.setTextColor(79, 90, 105); else this.doc.setTextColor(20, 27, 36)
    const lines: string[] = this.doc.splitTextToSize(clean(t), this.W)
    for (const l of lines) { this.ensure(size * 1.35); this.doc.text(l, this.x, this.y); this.y += size * 1.35 }
    this.y += 3
  }
  bullets(items: string[]) {
    if (!items.length) { this.p('None recorded', { muted: true }); return }
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(9.5); this.doc.setTextColor(20, 27, 36)
    for (const it of items) {
      const lines: string[] = this.doc.splitTextToSize(clean(it), this.W - 14)
      lines.forEach((l, i) => { this.ensure(13); if (i === 0) this.doc.text('-', this.x + 3, this.y); this.doc.text(l, this.x + 14, this.y); this.y += 12.8 })
    }
    this.y += 3
  }
  table(cols: Col[], rows: string[][], o: { boldLast?: boolean; boldRows?: number[] } = {}) {
    const total = sum(cols.map((c) => c.w))
    const ws = cols.map((c) => (c.w / total) * this.W)
    const pad = 4, size = 8.5, lh = size * 1.25
    const header = () => {
      this.doc.setFillColor(233, 236, 240); this.doc.setDrawColor(214, 220, 227); this.doc.setLineWidth(0.5)
      this.doc.rect(this.x, this.y, this.W, lh + pad * 2, 'FD')
      this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(7.5); this.doc.setTextColor(79, 90, 105)
      let cx = this.x
      cols.forEach((c, i) => { const tx = clean(c.label).toUpperCase(); this.doc.text(tx, c.align === 'right' ? cx + ws[i] - pad : cx + pad, this.y + pad + 7.5, { align: c.align === 'right' ? 'right' : 'left' }); cx += ws[i] })
      this.y += lh + pad * 2
    }
    this.ensure(lh * 3 + pad * 4); header()
    rows.forEach((r, ri) => {
      const bold = (o.boldLast && ri === rows.length - 1) || o.boldRows?.includes(ri)
      this.doc.setFont('helvetica', bold ? 'bold' : 'normal'); this.doc.setFontSize(size)
      const wrapped = r.map((v, i) => this.doc.splitTextToSize(clean(v), ws[i] - pad * 2) as string[])
      const h = Math.max(...wrapped.map((w) => w.length)) * lh + pad * 2
      if (this.y + h > this.bottom) { this.doc.addPage(); this.y = 56; header(); this.doc.setFont('helvetica', bold ? 'bold' : 'normal'); this.doc.setFontSize(size) }
      this.doc.setDrawColor(214, 220, 227); this.doc.setLineWidth(0.5); this.doc.line(this.x, this.y + h, this.x + this.W, this.y + h)
      this.doc.setTextColor(20, 27, 36)
      let cx = this.x
      wrapped.forEach((w, i) => { w.forEach((l, k) => this.doc.text(l, cols[i].align === 'right' ? cx + ws[i] - pad : cx + pad, this.y + pad + 7 + k * lh, { align: cols[i].align === 'right' ? 'right' : 'left' })); cx += ws[i] })
      this.y += h
    })
    this.y += 8
  }
  finish(): Blob {
    const n = this.doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i); this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(7.5); this.doc.setTextColor(120, 128, 140)
      this.doc.text(clean(this.footer), this.x, 792 - 28)
      this.doc.text(`Page ${i} of ${n}`, this.x + this.W, 792 - 28, { align: 'right' })
    }
    return this.doc.output('blob')
  }
}

/** BOE as a paginated PDF. */
export function boePdf(s: AppState, e: Estimate, opts: { mc?: MonteCarloResult } = {}): Blob {
  const f = boeFacts(s, e, opts)
  const { p, t, r } = f
  const w = new Writer(`${s.settings.orgName} - ${p.code} Basis of Estimate v${e.version} - generated ${fmtDate(s.settings.asOf)} by Crosswalk`)
  w.h1('Basis of Estimate')
  w.p(`${s.settings.orgName} - ${p.code} ${p.name} - ${f.prog?.code ?? ''} ${f.prog?.name ?? ''}`, { muted: true })
  w.p(`Estimate v${e.version} - ${displayTitle(e)} - AACE Class ${e.cls} - Status: ${e.status} - Method: ${methodLabel(e.method)}${f.rateVersion ? ` - Rate table v${f.rateVersion}` : ''} - ${e.region ?? p.location.district} region`, { muted: true })
  w.p(`Prepared by ${f.person(e.createdById)} on ${fmtDate(e.createdAt.slice(0, 10))}${e.approvedAt ? ` - Approved by ${f.person(e.approvedById)} on ${fmtDate(e.approvedAt.slice(0, 10))}` : ''}`, { muted: true })

  w.h2('1. Estimate summary')
  w.table([{ label: 'Point estimate', w: 1, align: 'right' }, { label: `Expected range (Class ${e.cls})`, w: 1.8, align: 'right' }, { label: 'Base (excl. contingency)', w: 1.2, align: 'right' }, { label: 'Contingency', w: 1.2, align: 'right' }],
    [[usd(t.total), `${usd(t.low)} to ${usd(t.high)} (${pct(r.low)} / +${pct(r.high)})`, usd(t.base), `${usd(t.contingency)} (${e.contingency.pct}%)`]])

  w.h2('2. Scope basis')
  w.p(e.basis.scopeBasis || '-')
  if (p.scope.quantities.length) w.table([{ label: 'Quantity', w: 3 }, { label: 'Amount', w: 1, align: 'right' }, { label: 'Unit', w: 1 }], p.scope.quantities.map((q) => [q.label, q.qty.toLocaleString('en-US'), q.unit]))
  w.p(`Asset: ${p.asset.lineId} - ${p.asset.diameterIn ? p.asset.diameterIn + '" ' : ''}${p.asset.material} - ${p.asset.lengthFt ? p.asset.lengthFt.toLocaleString('en-US') + ' ft - ' : ''}MAOP ${p.asset.maopPsig} psig - ${p.location.district} region - class location ${p.location.classLocation}${p.location.hca ? ' - HCA' : ''}`, { muted: true, size: 8.5 })

  w.h2('3. Cost by category')
  const catRows = f.cats.map(([c, v]) => [catCode(s, c), catName(s, c), s.categories.find((x) => x.id === c)?.erpCostElement ?? '', usd(v), t.byCategory[c] !== v ? usd(t.byCategory[c]) : '', t.base ? pct(t.byCategory[c] / t.base, 1) : '-'])
  w.table([{ label: 'Code', w: 0.6 }, { label: 'Category', w: 2.6 }, { label: 'ERP element', w: 1 }, { label: 'Direct', w: 1.1, align: 'right' }, { label: 'Incl. tax', w: 1.1, align: 'right' }, { label: '% of base', w: 0.8, align: 'right' }],
    [...catRows,
      ['900', 'Loaders', '', usd(t.loaders), '', t.base ? pct(t.loaders / t.base, 1) : ''],
      ['950', 'Escalation', '', usd(t.escalation), '', t.base ? pct(t.escalation / t.base, 1) : ''],
      ['', 'Base estimate', '', usd(t.base), '', '100%'],
      ['990', `Contingency (${e.contingency.method}${e.contingency.method === 'risk-based' ? ', ' + (e.contingency.confidence ?? 'P80') : ''})`, '', usd(t.contingency), '', `${e.contingency.pct}%`],
      ['', 'Total estimate', '', usd(t.total), '', '']], { boldRows: [catRows.length + 2, catRows.length + 4] })

  w.h2('4. Markups')
  w.p('Loaders and escalation come from the portfolio tables maintained by the estimating team and are not editable on a project estimate.', { muted: true, size: 8.5 })
  w.table([{ label: 'Markup', w: 4 }, { label: 'Rate', w: 1, align: 'right' }, { label: 'Amount', w: 1.3, align: 'right' }], [
    ...e.loaders.map((l) => [`${l.name} (on direct cost)`, `${l.pct}%`, usd(Math.round(t.lines * l.pct / 100))]),
    ...(e.salesTax && t.tax ? [[`Sales tax on material (${e.salesTax.counties.map((c) => `${c.county} ${Math.round(c.share * 100)}% at ${c.rate}%`).join('; ')})`, `${e.salesTax.pct}%`, usd(t.tax)]] : []),
    [`Escalation (on direct + tax + loaders)`, `${e.escalationPct}%`, usd(t.escalation)],
  ])

  w.h2('5. Line items by work package')
  for (const wp of f.wps) {
    const ls = e.lines.filter((l) => l.workPackage === wp)
    w.h3(`${wp} - ${usd(sum(ls.map(lineTotal)))}`)
    w.table([{ label: 'Category', w: 1.3 }, { label: 'Description', w: 3 }, { label: 'Qty', w: 0.9, align: 'right' }, { label: 'Unit', w: 0.5 }, { label: 'Unit cost', w: 1, align: 'right' }, { label: 'Total', w: 1.1, align: 'right' }, { label: 'Source', w: 1 }],
      ls.map((l) => [`${catCode(s, l.categoryId)} ${catName(s, l.categoryId)}`, l.description + (l.override ? ` [override: ${l.override.reason}]` : ''), l.qty.toLocaleString('en-US'), l.unit, usd2(l.unitCost), usd(lineTotal(l)), SOURCE_LABEL[l.source]]))
  }

  w.h2('6. Sources of pricing')
  w.table([{ label: 'Source', w: 3 }, { label: 'Lines', w: 1, align: 'right' }, { label: 'Amount', w: 1.4, align: 'right' }, { label: '% of direct', w: 1, align: 'right' }], f.srcs.map((x) => [SOURCE_LABEL[x.source], String(x.n), usd(x.amount), t.lines ? pct(x.amount / t.lines, 1) : '-']))
  if (f.overrides.length) {
    w.p('Unit-cost overrides by the estimating team:', { bold: true })
    w.table([{ label: 'Line', w: 3 }, { label: 'Rate table', w: 1, align: 'right' }, { label: 'Override', w: 1, align: 'right' }, { label: 'By', w: 1.2 }, { label: 'Reason', w: 3 }], f.overrides.map((l) => [`${l.workPackage} - ${l.description}`, usd2(l.override!.fromUnitCost), usd2(l.unitCost), f.person(l.override!.byId), l.override!.reason]))
  }
  if (f.ex.length) {
    w.p('Benchmark exceptions (unit cost more than 25% from the rate-table median for the region):', { bold: true })
    w.table([{ label: 'Line', w: 4 }, { label: 'Unit cost', w: 1, align: 'right' }, { label: 'Rate-table P50', w: 1.1, align: 'right' }, { label: 'Difference', w: 0.9, align: 'right' }], f.ex.map((x) => [`${x.line.workPackage} - ${x.line.description}`, usd2(x.line.unitCost), usd2(x.b.ref), `${x.b.pct > 0 ? '+' : ''}${pct(x.b.pct)}`]))
  } else w.p('No line is more than 25% from its rate-table median.', { muted: true })

  w.h2('7. Assumptions'); w.bullets(e.basis.assumptions)
  w.h2('8. Exclusions'); w.bullets(e.basis.exclusions)
  w.h2('9. Contingency rationale'); w.p(e.basis.contingencyRationale || '-')
  if (f.mc) w.table([{ label: 'P10', w: 1, align: 'right' }, { label: 'P50', w: 1, align: 'right' }, { label: 'P80', w: 1, align: 'right' }, { label: 'P90', w: 1, align: 'right' }, { label: 'Iterations', w: 1, align: 'right' }], [[usd(f.mc.costP.P10), usd(f.mc.costP.P50), usd(f.mc.costP.P80), usd(f.mc.costP.P90), String(f.mc.iterations)]])
  w.h2('10. Class justification'); w.p(e.basis.classJustification || '-')
  w.table([{ label: 'Maturity item', w: 4 }, { label: 'Needed for', w: 1 }, { label: 'Status', w: 1.2 }], f.maturity.map((m) => [m.label, `Class ${m.forClass}`, e.maturity[m.key] ? 'Complete' : 'Not complete']))
  w.h2('11. Review and approval')
  if (f.wf) {
    w.p(`${f.def?.name ?? 'Workflow'} v${f.wf.defVersion} - ${f.wf.status}`, { muted: true })
    w.table([{ label: 'When', w: 1.2 }, { label: 'Who', w: 1.3 }, { label: 'Action', w: 1 }, { label: 'Step', w: 1.5 }, { label: 'Comment', w: 3 }], f.history.map((h) => [h.at, h.who, h.action, h.step, h.comment]))
  } else w.p('Not yet submitted for approval.', { muted: true })
  return w.finish()
}
