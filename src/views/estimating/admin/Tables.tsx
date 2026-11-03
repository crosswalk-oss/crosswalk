// Portfolio tables maintained by the estimating team: regions and factors, county sales tax and taxable
// categories, loaders (locked on projects), escalation by year and contingency by AACE class.
import { useState } from 'react'
import type { AaceClass, AppState } from '@/core/types'
import { CLASS_RANGES } from '@/core/engine/estimates'
import { cx, pct, sum } from '@/core/util'
import { Badge, Button, Callout, Checkbox, ClassBadge, Input, Panel } from '@/ui/kit'
import { NumInput } from '../parts'
import { directCategories } from '../lib'
import { SaveBar, cellInp, diffRecord, saveSection, useDraft } from './shared'

// ───────────────────────────── Regions, factors and sales tax
export function RegionsTax({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const cfg = s.settings.estimating
  const f = useDraft(cfg.regionFactors)
  const t = useDraft({ taxRates: cfg.taxRates, taxable: cfg.taxableCategoryIds })
  const [county, setCounty] = useState('')
  const projectsIn = (g: string) => s.projects.filter((p) => p.location.district === g && p.status !== 'closed').length
  const countyUse = (c: string) => s.projects.filter((p) => (p.counties ?? [{ county: p.location.county, pct: 100 }]).some((x) => x.county === c)).length
  const split = s.projects.filter((p) => (p.counties?.length ?? 0) > 1)
  const unknown = Array.from(new Set(s.projects.flatMap((p) => (p.counties ?? []).map((c) => c.county)))).filter((c) => !t.draft.taxRates.some((x) => x.county === c))
  const saveFactors = () => {
    const ch = diffRecord(cfg.regionFactors, f.draft, (v) => `×${Number(v).toFixed(2)}`)
    saveSection('region-factors', `Region factors: ${ch.join('; ') || 'no change'}`, (d) => { d.settings.estimating.regionFactors = { ...f.draft }; d.settings.quickEstimate.regionFactors = { ...f.draft } }, 'Region factors saved')
    f.commit()
  }
  const saveTax = () => {
    const ch = diffRecord(Object.fromEntries(cfg.taxRates.map((x) => [x.county, x.rate])), Object.fromEntries(t.draft.taxRates.map((x) => [x.county, x.rate])), (v) => `${v}%`)
    const added = t.draft.taxable.filter((c) => !cfg.taxableCategoryIds.includes(c)), removed = cfg.taxableCategoryIds.filter((c) => !t.draft.taxable.includes(c))
    if (added.length) ch.push(`taxable + ${added.join(', ')}`)
    if (removed.length) ch.push(`taxable − ${removed.join(', ')}`)
    saveSection('sales-tax', `Sales tax table: ${ch.join('; ') || 'no change'}`, (d) => { d.settings.estimating.taxRates = t.draft.taxRates.map((x) => ({ ...x })); d.settings.estimating.taxableCategoryIds = [...t.draft.taxable] }, 'Sales tax table saved')
    t.commit()
  }
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel pad={false} title="Regions and region factors" subtitle="Region (not terrain) selects regional rates. Without a regional row, the base rate × the factor applies.">
        <table className="tbl">
          <thead><tr><th>Region</th><th className="num" style={{ width: 120 }}>Factor</th><th className="num">vs base</th><th className="num">Active projects</th></tr></thead>
          <tbody>
            {cfg.regions.map((g) => (
              <tr key={g}>
                <td className="font-semibold">{g}</td>
                <td className="num">{canEdit ? <NumInput ariaLabel={`${g} factor`} className={cellInp} value={f.draft[g] ?? 1} min={0.5} step={0.01} onChange={(v) => f.set((d) => ({ ...d, [g]: Math.round(v * 1000) / 1000 }))} /> : `×${(cfg.regionFactors[g] ?? 1).toFixed(2)}`}</td>
                <td className={cx('num', (f.draft[g] ?? 1) > 1 ? 'text-bad' : (f.draft[g] ?? 1) < 1 ? 'text-good' : 'text-faint')}>{(f.draft[g] ?? 1) === 1 ? '—' : `${(f.draft[g] ?? 1) > 1 ? '+' : ''}${pct((f.draft[g] ?? 1) - 1)}`}</td>
                <td className="num">{projectsIn(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <SaveBar dirty={f.dirty} onSave={saveFactors} onDiscard={f.reset} note="Also used by historical quick estimates." />
      </Panel>

      <Panel pad={false} title="County sales tax" subtitle={`Applied to taxable categories. Projects that cross a county line split the tax by their county shares (${split.length} project${split.length === 1 ? '' : 's'} do today).`}>
        <table className="tbl">
          <thead><tr><th>County</th><th className="num" style={{ width: 120 }}>Rate %</th><th className="num">Projects</th>{canEdit && <th style={{ width: 30 }} />}</tr></thead>
          <tbody>
            {t.draft.taxRates.map((x, i) => (
              <tr key={x.county}>
                <td>{x.county}</td>
                <td className="num">{canEdit ? <NumInput ariaLabel={`${x.county} rate`} className={cellInp} value={x.rate} min={0} step={0.05} onChange={(v) => t.set((d) => { d.taxRates[i].rate = Math.round(v * 1000) / 1000; return d })} /> : `${x.rate}%`}</td>
                <td className="num">{countyUse(x.county)}</td>
                {canEdit && <td>{!countyUse(x.county) && <button className="text-muted hover:text-bad" aria-label={`Remove ${x.county}`} onClick={() => t.set((d) => { d.taxRates.splice(i, 1); return d })}>✕</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && <form className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2" onSubmit={(e) => { e.preventDefault(); const c = county.trim(); if (!c || t.draft.taxRates.some((x) => x.county === c)) return; t.set((d) => { d.taxRates.push({ county: c, rate: 0 }); return d }); setCounty('') }}>
          <Input id="tax-county" className="h-8 w-56" placeholder="Add county" value={county} onChange={(e) => setCounty(e.target.value)} />
          <Button size="sm" type="submit" disabled={!county.trim()}>Add</Button>
        </form>}
        {unknown.length > 0 && <div className="border-t border-line px-4 py-2 text-xs text-warn">No rate for {unknown.join(', ')} — projects there price with 0% tax.</div>}
        <div className="border-t border-line px-4 py-3">
          <div className="eyebrow mb-1.5">Taxable categories</div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {directCategories(s).map((c) => <Checkbox key={c.id} id={`tax-${c.id}`} disabled={!canEdit} checked={t.draft.taxable.includes(c.id)} onChange={(v) => t.set((d) => ({ ...d, taxable: v ? [...d.taxable, c.id] : d.taxable.filter((x) => x !== c.id) }))} label={<span className="text-[12.5px]"><span className="font-mono text-faint">{c.code}</span> {c.name}</span>} />)}
          </div>
        </div>
        <SaveBar dirty={t.dirty} onSave={saveTax} onDiscard={t.reset} />
      </Panel>
    </div>
  )
}

// ───────────────────────────── Loaders, escalation, contingency
export function Markups({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const cfg = s.settings.estimating
  const L = useDraft(s.settings.loaderRates)
  const E = useDraft(s.settings.escalationByYear)
  const C = useDraft(cfg.contingencyByClass)
  const years = Array.from(new Set(L.draft.map((r) => r.year))).sort((a, b) => b - a)
  const latest = years[0] ?? Number(s.settings.asOf.slice(0, 4))
  const escYears = Object.keys(E.draft).sort()
  const saveLoaders = () => {
    const a = Object.fromEntries(s.settings.loaderRates.map((r) => [`${r.year} ${r.name}`, r.pct])), b = Object.fromEntries(L.draft.map((r) => [`${r.year} ${r.name}`, r.pct]))
    saveSection('loaders', `Portfolio loaders: ${diffRecord(a, b, (v) => `${v}%`).join('; ') || 'no change'}`, (d) => { d.settings.loaderRates = L.draft.map((x) => ({ ...x })) }, 'Loaders saved')
    L.commit()
  }
  const saveEsc = () => {
    saveSection('escalation', `Escalation by year: ${diffRecord(s.settings.escalationByYear, E.draft, (v) => `${v}%`).join('; ') || 'no change'}`, (d) => { d.settings.escalationByYear = { ...E.draft } }, 'Escalation table saved')
    E.commit()
  }
  const saveCont = () => {
    saveSection('contingency', `Contingency by class: ${diffRecord(cfg.contingencyByClass, C.draft, (v) => `${v}%`).map((x) => `Class ${x}`).join('; ') || 'no change'}`, (d) => { d.settings.estimating.contingencyByClass = { ...C.draft }; if (C.draft['5'] != null) d.settings.quickEstimate.contingencyPct = C.draft['5'] }, 'Contingency table saved')
    C.commit()
  }
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel pad={false} title={<span className="inline-flex items-center gap-2">Loaders <Badge tone="ink">Portfolio-wide · locked on projects</Badge></span>} subtitle="Payroll taxes, AFUDC and overheads applied to direct cost. Project estimates read the latest year and cannot change it."
        actions={canEdit && <Button size="sm" onClick={() => L.set((d) => [...d, ...d.filter((r) => r.year === latest).map((r) => ({ ...r, year: latest + 1 }))])} disabled={years.includes(latest + 1)}>Start {latest + 1} table</Button>}>
        <table className="tbl">
          <thead><tr><th className="num" style={{ width: 70 }}>Year</th><th>Loader</th><th className="num" style={{ width: 110 }}>Rate %</th>{canEdit && <th style={{ width: 30 }} />}</tr></thead>
          <tbody>
            {years.map((y) => {
              const rows = L.draft.map((r, i) => ({ r, i })).filter((x) => x.r.year === y)
              return [
                ...rows.map(({ r, i }) => (
                  <tr key={`${y}-${i}`} className={cx(y !== latest && 'text-muted')}>
                    <td className="num">{y}{y === latest && <div><Badge tone="good">In force</Badge></div>}</td>
                    <td>{canEdit ? <Input aria-label="Loader name" className={cellInp} value={r.name} onChange={(e) => L.set((d) => { d[i].name = e.target.value; return d })} /> : r.name}</td>
                    <td className="num">{canEdit ? <NumInput ariaLabel="Loader rate" className={cellInp} value={r.pct} min={0} step={0.1} onChange={(v) => L.set((d) => { d[i].pct = Math.round(v * 100) / 100; return d })} /> : `${r.pct}%`}</td>
                    {canEdit && <td><button className="text-muted hover:text-bad" aria-label="Remove loader" onClick={() => L.set((d) => d.filter((_, k) => k !== i))}>✕</button></td>}
                  </tr>
                )),
                <tr key={`${y}-tot`} className="bg-sunken/40"><td /><td className="text-[12px] font-semibold">Total {y}{canEdit && <button className="ml-2 text-[11px] font-semibold text-link" onClick={() => L.set((d) => [...d, { year: y, name: 'New loader', pct: 0 }])}>+ Add loader</button>}</td><td className="num font-semibold">{sum(rows.map((x) => x.r.pct)).toFixed(1)}%</td>{canEdit && <td />}</tr>,
              ]
            })}
          </tbody>
        </table>
        <SaveBar dirty={L.dirty} onSave={saveLoaders} onDiscard={L.reset} disabled={L.draft.some((r) => !r.name.trim())} note="Open drafts are asked to apply the new table; approved estimates keep theirs." />
      </Panel>

      <Panel pad={false} title={<span className="inline-flex items-center gap-2">Escalation by year <Badge tone="ink">Portfolio-wide · locked on projects</Badge></span>} subtitle="Compounded from the rate basis year to each project's spend midpoint."
        actions={canEdit && <Button size="sm" onClick={() => { const y = Math.max(...escYears.map(Number)) + 1; E.set((d) => ({ ...d, [y]: d[String(y - 1)] ?? 3 })) }}>Add year</Button>}>
        <table className="tbl">
          <thead><tr><th>Year</th><th className="num" style={{ width: 120 }}>Escalation %</th><th className="num">Cumulative from {escYears[0] ?? '—'}</th>{canEdit && <th style={{ width: 30 }} />}</tr></thead>
          <tbody>
            {escYears.map((y, i) => {
              const cum = escYears.slice(1, i + 1).reduce((f, k) => f * (1 + (E.draft[k] ?? 0) / 100), 1) - 1
              return (
                <tr key={y}>
                  <td className="font-mono">{y}</td>
                  <td className="num">{canEdit ? <NumInput ariaLabel={`${y} escalation`} className={cellInp} value={E.draft[y]} min={-10} step={0.1} onChange={(v) => E.set((d) => ({ ...d, [y]: Math.round(v * 100) / 100 }))} /> : `${E.draft[y]}%`}</td>
                  <td className="num text-muted">{i === 0 ? 'base' : `+${pct(cum, 1)}`}</td>
                  {canEdit && <td>{i === escYears.length - 1 && escYears.length > 1 && <button className="text-muted hover:text-bad" aria-label={`Remove ${y}`} onClick={() => E.set((d) => { const x = { ...d }; delete x[y]; return x })}>✕</button>}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
        <SaveBar dirty={E.dirty} onSave={saveEsc} onDiscard={E.reset} />
      </Panel>

      <Panel pad={false} className="xl:col-span-2" title="Contingency by AACE class" subtitle="Default deterministic contingency for new and repriced estimates. Risk-based contingency (Monte Carlo on the risk register) can replace it on an estimate.">
        <div className="px-4 pt-3">
          <Callout tone="marker" title="Contingency policy — pending">
            Contingency percentages and their use will follow the forthcoming <b>contingency drawdown policy</b> (how contingency is held, who may release it and how drawdowns are evidenced). Until it is issued these defaults apply; this note will be replaced with the policy reference and its effective date.
          </Callout>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Class</th><th>Use</th><th className="num">AACE range</th><th className="num" style={{ width: 130 }}>Contingency %</th></tr></thead>
            <tbody>
              {([5, 4, 3, 2, 1] as AaceClass[]).map((c) => (
                <tr key={c}>
                  <td><ClassBadge cls={c} /></td>
                  <td className="text-[12px]">{CLASS_RANGES[c].use}</td>
                  <td className="num text-[12px]">{pct(CLASS_RANGES[c].low)} / +{pct(CLASS_RANGES[c].high)}</td>
                  <td className="num">{canEdit ? <NumInput ariaLabel={`Class ${c} contingency`} className={cellInp} value={C.draft[String(c)] ?? 0} min={0} step={0.5} onChange={(v) => C.set((d) => ({ ...d, [String(c)]: Math.round(v * 10) / 10 }))} /> : `${cfg.contingencyByClass[String(c)] ?? '—'}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SaveBar dirty={C.dirty} onSave={saveCont} onDiscard={C.reset} note="Class 5 also sets the historical quick estimate contingency." />
      </Panel>
    </div>
  )
}
