// Configuration → Class 5 quick estimate: region factors per district, the default Class 5 contingency,
// how the factor-model method works, and the way to the factor model and historical cost table the estimating team maintains.
import { prefs } from '@/core/data'
import { useEffect, useState } from 'react'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { escalationFactor, loaderPct } from '@/core/engine/quick'
import { publishedModel } from '@/core/engine/factorModel'
import { go, workflowHref } from '@/core/router'
import { cx, fmtDateTime, money, sum } from '@/core/util'
import { Badge, Button, Callout, Field, Input, Panel } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { NumInput } from '@/views/estimating/parts'

const openFactorModel = () => { try { prefs.setRaw('crosswalk:estimating:admin', 'factor'); prefs.setRaw('crosswalk:estimating:tab', 'admin') } catch { /* storage blocked */ } go('#estimating') }
const openHistorical = () => { try { prefs.setRaw('crosswalk:estimating:tab', 'historical') } catch { /* storage blocked */ } go('#estimating') }

export default function QuickEstimateSettings() {
  const s = useStore()
  const me = useMe()
  const qe = s.settings.quickEstimate
  const pub = publishedModel(s)
  const canEdit = me.roles.some((r) => r === 'admin' || r === 'estimating-lead')
  const [factors, setFactors] = useState<Record<string, number>>(() => ({ ...qe.regionFactors }))
  const [cont, setCont] = useState(qe.contingencyPct)
  const [newName, setNewName] = useState('')
  useEffect(() => { setFactors({ ...qe.regionFactors }); setCont(qe.contingencyPct) }, [qe])
  const districts = Array.from(new Set([...Object.keys(factors), ...s.projects.map((p) => p.location.district)])).sort()
  const dirty = JSON.stringify(factors) !== JSON.stringify(qe.regionFactors) || cont !== qe.contingencyPct
  const bad = Object.values(factors).some((v) => !(v > 0.5 && v < 2)) || !(cont >= 0 && cont <= 100)
  const lp = sum(loaderPct(s).map((x) => x.pct))
  const y = Number(s.settings.asOf.slice(0, 4))
  const reviewers = s.people.filter((p) => p.roles.includes('estimator'))
  const last = [...s.audit].reverse().find((a) => a.entity === 'quick-estimate')
  const save = () => {
    if (!dirty || bad) return
    const ch = [
      ...districts.filter((d) => (factors[d] ?? 1) !== (qe.regionFactors[d] ?? 1)).map((d) => `${d} ×${(qe.regionFactors[d] ?? 1).toFixed(2)} → ×${(factors[d] ?? 1).toFixed(2)}`),
      ...(cont !== qe.contingencyPct ? [`contingency ${qe.contingencyPct}% → ${cont}%`] : []),
    ]
    mutate((d) => { d.settings.quickEstimate.regionFactors = { ...factors }; d.settings.quickEstimate.contingencyPct = cont }, { entity: 'quick-estimate', entityId: 'settings', action: 'update', summary: `Class 5 quick estimate settings: ${ch.join('; ')}` })
    toast('Quick estimate settings saved')
  }
  const addDistrict = () => {
    const n = newName.trim()
    if (!n || factors[n] != null) return
    setFactors({ ...factors, [n]: 1 }); setNewName('')
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel pad={false} title="Region factors" subtitle="Multiplier on the historical direct rate for where the work is. 1.00 = system average."
          actions={canEdit && <><Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setFactors({ ...qe.regionFactors }); setCont(qe.contingencyPct) }}>Discard</Button><Button size="sm" variant="primary" disabled={!dirty || bad} onClick={save}>Save settings</Button></>}>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>District</th><th className="num" style={{ width: 120 }}>Factor</th><th className="num">Projects</th><th className="num">$1M of history becomes</th></tr></thead>
              <tbody>
                {districts.map((d) => {
                  const v = factors[d]
                  const n = s.projects.filter((p) => p.location.district === d).length
                  return (
                    <tr key={d}>
                      <td className="font-semibold">{d}{v == null && <Badge className="ml-2" tone="warn">Not set · ×1.00</Badge>}</td>
                      <td className="num">{canEdit ? <NumInput id={`rf-${d}`} ariaLabel={`${d} factor`} className="h-7 px-1.5 py-0.5 text-[12px]" value={v ?? 1} onChange={(x) => setFactors({ ...factors, [d]: Math.round(x * 100) / 100 })} /> : `×${(v ?? 1).toFixed(2)}`}</td>
                      <td className="num text-muted">{n}</td>
                      <td className={cx('num', (v ?? 1) > 1 ? 'text-bad' : (v ?? 1) < 1 ? 'text-good' : 'text-muted')}>{money(1e6 * (v ?? 1))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <form className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); addDistrict() }}>
              <Field label="Add a district" className="w-48"><Input id="rf-new" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="District name" /></Field>
              <Button size="sm" type="submit" disabled={!newName.trim() || factors[newName.trim()] != null}>Add</Button>
            </form>
          )}
          {bad && <div className="px-4 pb-3"><Callout tone="bad">Factors must be between 0.5 and 2.0 and contingency between 0% and 100%.</Callout></div>}
        </Panel>
        <Panel title="Class 5 contingency" subtitle="Applied to direct cost plus loaders on every quick estimate">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Default contingency %" className="w-36">{canEdit ? <NumInput id="qe-cont" value={cont} min={0} onChange={(v) => setCont(Math.round(v * 10) / 10)} /> : <div className="font-display text-[22px] font-bold tabular-nums">{cont}%</div>}</Field>
            <p className="min-w-0 flex-1 text-[12.5px] text-muted">The estimating standard for Class 5 is 30%. The historical P10–P90 range is shown beside the AACE Class 5 range (−50% / +100%) on every request so reviewers can see when history is thin.</p>
          </div>
          <div className="mt-3 text-[12px] text-muted">Loaders come from the current loader rates ({loaderPct(s).map((x) => `${x.name} ${x.pct}%`).join(' · ')} = {lp.toFixed(1)}%). Escalation from each row's base year to the spend midpoint uses the escalation table ({Object.entries(s.settings.escalationByYear).map(([k, v]) => `${k} ${v}%`).join(' · ')}).</div>
          {last && <div className="mt-2 text-[11.5px] text-faint">Last changed {fmtDateTime(last.at)} by {personName(s, last.actorId)}</div>}
          {!canEdit && <div className="mt-2 text-[11.5px] text-faint">Only administrators and the estimating lead change these settings.</div>}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="How the quick estimate works">
          <ol className="ml-5 flex list-decimal flex-col gap-2 text-[13px]">
            <li><b>Pick a few values.</b> Asset type, work method, diameter, quantity, region and midpoint year, plus the site drivers: soil, crossings, setting, permit complexity, HCA, class location, traffic, work hours and remoteness. Requests from a project start pre-filled from its record.</li>
            <li><b>Price it on the published factor model{pub ? ` (v${pub.version})` : ''}.</b> Direct = base rate × quantity × size scale × each driver's multiplier × region × escalation (×{escalationFactor(s, 2025, y + 1).toFixed(3)} from 2025 to {y + 1}). Then + loaders ({lp.toFixed(1)}%) and + contingency ({qe.contingencyPct}%). Every driver's dollar effect is itemized, and the drivers' uncertainty gives the P10–P90 range. Drivers are physical, legal or logistical only, never demographic or wealth attributes.</li>
            <li><b>Check it.</b> The rate-table Class 5 and the matching historical row are shown beside it, so reviewers can see when the model and history disagree.</li>
            <li><b>Send to the estimating team.</b> The <a className="font-semibold text-link" href={workflowHref('class5-review')}>Class 5 quick estimate review</a> routes it to any estimator ({reviewers.map((p) => p.name).join(', ') || 'none configured'}). They can adjust it by a percentage and/or price it at P10/P90, with a mandatory reason, then approve or return it.</li>
            <li><b>Approved = estimate of record.</b> It locks, carries its adjustment history, and becomes the planning budget at Gate 1. Maturing to Class 3 starts a new line-item version from it.</li>
          </ol>
        </Panel>
        <Panel title="Factor model" subtitle="Weights, multipliers, backtest and versions live in Estimating → Administration">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span>Published <b className="tabular-nums">{pub ? `v${pub.version}` : 'none'}</b></span>
            <span><b className="tabular-nums">{s.backtestProjects.length}</b> closed projects in the backtest</span>
            <span><b className="tabular-nums">{s.factorModels.filter((m) => m.status === 'draft' || m.status === 'in-review').length}</b> draft or in review</span>
            <Button size="sm" variant="primary" className="ml-auto" onClick={openFactorModel}>Open factor model</Button>
          </div>
        </Panel>
        <Panel title="Historical cost table" subtitle="Maintained by the estimating team in the Estimating module">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span><b className="tabular-nums">{s.historicalCosts.filter((h) => h.active).length}</b> active rows</span>
            <span><b className="tabular-nums">{s.historicalCosts.filter((h) => h.active && h.n < 5).length}</b> with fewer than 5 projects</span>
            <span><b className="tabular-nums">{s.estimates.filter((e) => e.method === 'quick').length}</b> quick estimates</span>
            <Button size="sm" variant="primary" className="ml-auto" onClick={openHistorical}>Open historical costs</Button>
          </div>
        </Panel>
      </div>
    </div>
  )
}
