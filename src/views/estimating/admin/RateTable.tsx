// Rate table by WBS line item and region. Edits are staged in a working copy and published together as a
// new rate table version with a note (audited per change). Estimates stamp the version they were priced on.
import { useMemo, useState } from 'react'
import type { AppState, AssetType, Terrain, UnitCostRate, WorkMethod } from '@/core/types'
import { getState, mutate, personName } from '@/core/store'
import { diffRates, effectiveByRegion, publishRateTable, regionRowsOf, repriceCandidates } from '@/core/engine/estimatingAdmin'
import { cx, fmtDate, money } from '@/core/util'
import { Badge, Button, Callout, Drawer, Field, Input, Modal, Panel, Select, Table, TextArea, type Column } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { NumInput, SpreadBar } from '../parts'
import { catName, directCategories } from '../lib'
import { useDraft } from './shared'

export const ASSET_LABEL: Record<AssetType, string> = { 'transmission-pipeline': 'Transmission pipeline', 'distribution-main': 'Distribution main', 'compressor-station': 'Compressor station', 'valve-site': 'Valve site', 'storage-field': 'Storage field', 'regulator-station': 'Regulator station' }
export const METHOD_LABEL: Record<WorkMethod, string> = { 'replace-open-trench': 'Replace, open trench', 'replace-hdd': 'Replace, HDD', hydrotest: 'Hydrotest', abandon: 'Abandon', 'valve-automation': 'Valve automation', 'station-rebuild': 'Station rebuild', 'compressor-replacement': 'Compressor replacement', 'inline-inspection': 'In-line inspection' }

/** WBS line item (forecast line) a CBS category rolls up to. */
export function wbsLineOf(s: Pick<AppState, 'settings'>, categoryId: string) {
  return s.settings.forecastLines.find((l) => l.categoryIds.includes(categoryId))
}

const m = (v: number) => money(v, v < 1e4 ? 'full' : 'compact')

export function RateTableAdmin({ s, canEdit, onReprice }: { s: AppState; canEdit: boolean; onReprice: () => void }) {
  const { draft, set, dirty, reset, commit } = useDraft(s.rates)
  const cfg = s.settings.estimating
  const [asset, setAsset] = useState('')
  const [method, setMethod] = useState('')
  const [line, setLine] = useState('')
  const [q, setQ] = useState('')
  const [onlyRegional, setOnlyRegional] = useState(false)
  const [editing, setEditing] = useState<UnitCostRate | 'new' | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<number | null>(null)
  const changes = useMemo(() => (dirty ? diffRates(s.rates, draft) : []), [dirty, s.rates, draft])
  const changedIds = useMemo(() => new Set(draft.filter((r) => { const o = s.rates.find((x) => x.id === r.id); return !o || JSON.stringify(o) !== JSON.stringify(r) }).map((r) => r.id)), [draft, s.rates])
  const usage = useMemo(() => { const u: Record<string, number> = {}; for (const e of s.estimates) for (const l of e.lines) if (l.rateId) u[l.rateId] = (u[l.rateId] || 0) + 1; return u }, [s.estimates])
  const base = draft.filter((r) => !r.region)
  const assets = Array.from(new Set(base.map((r) => r.assetType)))
  const methods = Array.from(new Set(base.filter((r) => !asset || r.assetType === asset).map((r) => r.workMethod)))
  const lines = s.settings.forecastLines.filter((l) => base.some((r) => l.categoryIds.includes(r.categoryId)))
  const rows = base.filter((r) => (!asset || r.assetType === asset) && (!method || r.workMethod === method) && (!line || wbsLineOf(s, r.categoryId)?.id === line) && (!q || r.description.toLowerCase().includes(q.toLowerCase())) && (!onlyRegional || regionRowsOf(draft, r).length > 0))
  const sView = { ...s, rates: draft }
  const regional = draft.filter((r) => r.region).length
  const cols: Column<UnitCostRate>[] = [
    { key: 'wbs', header: 'WBS line', sort: (r) => wbsLineOf(s, r.categoryId)?.code ?? '', render: (r) => { const l = wbsLineOf(s, r.categoryId); return <div className="min-w-[120px]"><span className="font-mono text-[12px] font-semibold">{l?.code ?? '—'}</span><div className="text-[11px] text-faint">{l?.name ?? catName(s, r.categoryId)}</div></div> } },
    { key: 'd', header: 'Item', sort: (r) => r.description, render: (r) => <div className="min-w-[220px]"><div className="flex items-center gap-1.5 text-[12.5px] font-semibold">{changedIds.has(r.id) || regionRowsOf(draft, r).some((x) => changedIds.has(x.id)) ? <span className="h-2 w-2 shrink-0 rounded-full bg-marker" title="Changed — not yet published" /> : null}{r.description}</div><div className="text-[11px] text-faint">{ASSET_LABEL[r.assetType]} · {METHOD_LABEL[r.workMethod]}{r.diameterIn ? ` · ${r.diameterIn}"` : ''}{r.terrain ? ` · ${r.terrain}` : ''}</div></div> },
    { key: 'u', header: 'Unit', sort: (r) => r.unit, render: (r) => <span className={cx('font-mono text-[12px]', !cfg.units.some((u) => u.id === r.unit) && 'font-semibold text-bad')} title={cfg.units.find((u) => u.id === r.unit)?.label ?? 'Not on the allowed-units list'}>{r.unit}</span> },
    { key: 'p50', header: 'Base P50', num: true, sort: (r) => r.p50, render: (r) => <div><b>{m(r.p50)}</b><div className="text-[10.5px] text-faint">{m(r.p10)}–{m(r.p90)}</div></div> },
    ...cfg.regions.map((g): Column<UnitCostRate> => ({
      key: `r-${g}`, header: <span title={`${g}: regional row, else base × ${(cfg.regionFactors[g] ?? 1).toFixed(2)}`}>{g}</span>, num: true,
      render: (r) => { const v = effectiveByRegion(sView, r)[g]; return <span className={cx('tabular-nums', v.regional ? 'font-semibold text-ink' : 'text-muted')} title={v.regional ? `${g} regional rate` : `Base × ${(cfg.regionFactors[g] ?? 1).toFixed(2)}`}>{m(v.value)}{v.regional && <sup className="ml-0.5 text-[9px] font-bold text-link">R</sup>}</span> },
    })),
    { key: 'sp', header: 'Spread', render: (r) => <SpreadBar p10={r.p10} p50={r.p50} p90={r.p90} /> },
    { key: 'n', header: 'n', num: true, sort: (r) => r.sampleSize, render: (r) => <span className={cx(r.sampleSize < 5 && 'font-semibold text-warn')}>{r.sampleSize}</span> },
    { key: 'use', header: 'Used', num: true, sort: (r) => usage[r.id] ?? 0, render: (r) => <span className="text-muted">{(usage[r.id] ?? 0) + regionRowsOf(draft, r).reduce((a, x) => a + (usage[x.id] ?? 0), 0)}</span> },
    { key: 'e', header: '', render: (r) => <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); setEditing(r) }}>{canEdit ? 'Edit' : 'View'}</Button> },
  ]
  const publish = (note: string) => {
    let v = 0
    const n = changes.length
    mutate((d) => { v = publishRateTable(d, draft, note).version }, { entity: 'estimating-config', entityId: 'rate-table', action: 'publish', summary: `Published rate table v${cfg.rateTableVersion + 1} (${n} change${n === 1 ? '' : 's'}): ${note}` })
    commit(); setPublishing(false); setPublished(v)
    toast(`Rate table v${v} published`)
  }
  const stale = published ? repriceCandidates(getState()).length : 0
  const last = cfg.rateTableHistory[cfg.rateTableHistory.length - 1]
  return (
    <div className="flex flex-col gap-3">
      {published && <Callout tone="marker" title={`Rate table v${published} is in force`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{stale} project{stale === 1 ? '' : 's'} have a current estimate priced on an older rate table. Review them and choose which to reprice.</span><Button size="sm" variant="primary" onClick={onReprice}>Review bulk update</Button></div>
      </Callout>}
      <Panel pad={false} title={<span className="inline-flex items-center gap-2">Rate table <Badge tone="ink">v{cfg.rateTableVersion}</Badge></span>}
        subtitle={`${base.length} items by WBS line and region · ${regional} regional rows · published ${last ? `${fmtDate(last.at.slice(0, 10))} by ${personName(s, last.byId)}` : '—'}. Regions without their own row price at base × region factor.`}
        actions={canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}>Add rate</Button>}>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <Input id="rt-q" className="h-8 w-44" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="rt-asset" className="h-8 w-44" value={asset} onChange={(e) => { setAsset(e.target.value); setMethod('') }} options={[{ value: '', label: 'All asset types' }, ...assets.map((a) => ({ value: a, label: ASSET_LABEL[a] }))]} />
          <Select id="rt-method" className="h-8 w-44" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'All work methods' }, ...methods.map((a) => ({ value: a, label: METHOD_LABEL[a] }))]} />
          <Select id="rt-line" className="h-8 w-52" value={line} onChange={(e) => setLine(e.target.value)} options={[{ value: '', label: 'All WBS lines' }, ...lines.map((l) => ({ value: l.id, label: `${l.code} ${l.name}` }))]} />
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-3.5 w-3.5" checked={onlyRegional} onChange={(e) => setOnlyRegional(e.target.checked)} />With regional rows</label>
          <span className="ml-auto self-center text-[11.5px] text-muted">{rows.length} shown · <sup className="text-[9px] font-bold text-link">R</sup> regional rate</span>
        </div>
        <Table rows={rows} columns={cols} rowKey={(r) => r.id} maxHeight={560} dense onRowClick={(r) => setEditing(r)} empty={<p className="p-6 text-center text-[13px] text-muted">No items match the filters.</p>} />
        {dirty && changes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-marker/10 px-4 py-2">
            <Badge tone="marker">{changes.length} unpublished change{changes.length === 1 ? '' : 's'}</Badge>
            <span className="min-w-0 truncate text-xs text-muted">{changes.slice(0, 2).join(' · ')}{changes.length > 2 ? ` · +${changes.length - 2} more` : ''}</span>
            <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => { reset(); toast('Changes discarded', 'info') }}>Discard</Button><Button size="sm" variant="primary" onClick={() => setPublishing(true)}>Publish rate table v{cfg.rateTableVersion + 1}</Button></span>
          </div>
        )}
      </Panel>
      <Callout tone="info" title="How estimates use the rate table">
        Line-item (Class 3) and rate-table (Class 5) estimates take each unit cost from this table for the project's region and lock it; only an estimator or the estimating lead can override one, with a reason that prints in the basis of estimate. Units are limited to the allowed-units list (pipe in feet, never inches). Publishing a new version leaves existing estimates as priced; use <button className="font-semibold text-link" onClick={onReprice}>Bulk update</button> to reprice the ones you choose.
      </Callout>
      {editing && <RateDrawer s={s} rates={draft} rate={editing === 'new' ? undefined : editing} canEdit={canEdit} usage={usage} onClose={() => setEditing(null)}
        onApply={(rowsIn, removeIds) => { set((d) => [...d.filter((x) => !removeIds.includes(x.id) && !rowsIn.some((y) => y.id === x.id)), ...rowsIn]); setEditing(null); toast('Staged — publish the rate table to put it in force', 'info') }} />}
      {publishing && <PublishModal s={s} changes={changes} onClose={() => setPublishing(false)} onPublish={publish} />}
    </div>
  )
}

function PublishModal({ s, changes, onClose, onPublish }: { s: AppState; changes: string[]; onClose: () => void; onPublish: (note: string) => void }) {
  const [note, setNote] = useState('')
  const v = s.settings.estimating.rateTableVersion + 1
  return (
    <Modal open onClose={onClose} wide title={`Publish rate table v${v}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={note.trim().length < 5} onClick={() => onPublish(note.trim())}>Publish v{v}</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted">Every estimate created or repriced after this stamps <b className="text-ink">rate table v{v}</b>. Existing estimates keep the unit costs they were priced with until the estimating team reprices them.</p>
        <div className="max-h-[260px] overflow-y-auto rounded border border-line">
          <ul className="divide-y divide-line text-[12.5px]">{changes.map((c) => <li key={c} className="px-3 py-1.5">{c}</li>)}</ul>
        </div>
        <Field label="Change note (required)" hint="Shown in the rate table history and the audit trail."><TextArea id="rt-note" className="min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q4 refresh: West contract construction from the 2026 bid tabs; pipe +5% per mill notice" /></Field>
      </div>
    </Modal>
  )
}

/** Edit one rate-table item and its regional rows. */
function RateDrawer({ s, rates, rate, canEdit, usage, onClose, onApply }: { s: AppState; rates: UnitCostRate[]; rate?: UnitCostRate; canEdit: boolean; usage: Record<string, number>; onClose: () => void; onApply: (rows: UnitCostRate[], removeIds: string[]) => void }) {
  const cfg = s.settings.estimating
  const year = Number(s.settings.asOf.slice(0, 4))
  const [r, setR] = useState<UnitCostRate>(() => rate ? { ...rate } : { id: `rate-${Date.now().toString(36)}`, assetType: 'transmission-pipeline', workMethod: 'replace-open-trench', categoryId: 'cat-contract', description: '', unit: 'ft', p10: 0, p50: 0, p90: 0, sampleSize: 1, basisYear: year })
  const [regional, setRegional] = useState<UnitCostRate[]>(() => rate ? regionRowsOf(rates, rate).map((x) => ({ ...x })) : [])
  const removed = rate ? regionRowsOf(rates, rate).filter((x) => !regional.some((y) => y.id === x.id)).map((x) => x.id) : []
  const unitOk = cfg.units.some((u) => u.id === r.unit)
  const order = (x: UnitCostRate) => x.p10 <= x.p50 && x.p50 <= x.p90 && x.p50 > 0
  const valid = r.description.trim() && unitOk && order(r) && regional.every(order)
  const ro = !canEdit
  const used = rate ? (usage[rate.id] ?? 0) : 0
  const addRegion = (g: string) => {
    const f = cfg.regionFactors[g] ?? 1
    setRegional([...regional, { ...r, id: `${r.id}-${g.toLowerCase()}-${Date.now().toString(36).slice(-4)}`, region: g, p10: Math.round(r.p10 * f), p50: Math.round(r.p50 * f), p90: Math.round(r.p90 * f) }])
  }
  const setReg = (id: string, k: 'p10' | 'p50' | 'p90' | 'sampleSize', v: number) => setRegional(regional.map((x) => x.id === id ? { ...x, [k]: Math.round(v) } : x))
  // regional rows follow the item's identity and unit
  const sync = (x: UnitCostRate): UnitCostRate => ({ ...x, assetType: r.assetType, workMethod: r.workMethod, categoryId: r.categoryId, description: r.description, unit: r.unit, diameterIn: r.diameterIn, terrain: r.terrain, basisYear: r.basisYear })
  const line = wbsLineOf(s, r.categoryId)
  return (
    <Drawer open onClose={onClose} width={560} title={rate ? (ro ? 'Rate-table item' : 'Edit rate-table item') : 'Add rate-table item'}
      footer={ro ? <Button onClick={onClose}>Close</Button> : <>
        {rate && !used && <Button variant="ghost" onClick={() => onApply([], [rate.id, ...regionRowsOf(rates, rate).map((x) => x.id)])}>Remove item</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => onApply([{ ...r, diameterIn: r.diameterIn || undefined, terrain: r.terrain || undefined }, ...regional.map(sync)], removed)}>Stage changes</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Description" className="sm:col-span-2"><Input id="rd-desc" disabled={ro} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} /></Field>
          <Field label="Asset type"><Select id="rd-asset" disabled={ro || !!rate} value={r.assetType} onChange={(e) => setR({ ...r, assetType: e.target.value as AssetType })} options={Object.entries(ASSET_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Work method"><Select id="rd-method" disabled={ro || !!rate} value={r.workMethod} onChange={(e) => setR({ ...r, workMethod: e.target.value as WorkMethod })} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Category" hint={line ? `WBS line ${line.code} ${line.name}` : undefined}><Select id="rd-cat" disabled={ro || !!rate} value={r.categoryId} onChange={(e) => setR({ ...r, categoryId: e.target.value })} options={directCategories(s).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} /></Field>
          <Field label="Unit" hint={unitOk ? undefined : <span className="text-bad">Not on the allowed-units list</span>}><Select id="rd-unit" disabled={ro} value={r.unit} onChange={(e) => setR({ ...r, unit: e.target.value })} options={[...(unitOk ? [] : [{ value: r.unit, label: `${r.unit} (not allowed)` }]), ...cfg.units.map((u) => ({ value: u.id, label: `${u.id} · ${u.label}` }))]} /></Field>
          <Field label="Diameter (in, optional)"><NumInput id="rd-dia" disabled={ro || !!rate} value={r.diameterIn ?? 0} min={0} onChange={(v) => setR({ ...r, diameterIn: v || undefined })} /></Field>
          <Field label="Terrain (optional)"><Select id="rd-terrain" disabled={ro || !!rate} value={r.terrain ?? ''} onChange={(e) => setR({ ...r, terrain: (e.target.value || undefined) as Terrain | undefined })} options={[{ value: '', label: 'Any' }, 'urban', 'suburban', 'rural']} /></Field>
          <Field label="P10"><NumInput id="rd-p10" disabled={ro} value={r.p10} min={0} onChange={(v) => setR({ ...r, p10: Math.round(v) })} /></Field>
          <Field label="P50 (median) — base"><NumInput id="rd-p50" disabled={ro} value={r.p50} min={0} onChange={(v) => setR({ ...r, p50: Math.round(v) })} /></Field>
          <Field label="P90"><NumInput id="rd-p90" disabled={ro} value={r.p90} min={0} onChange={(v) => setR({ ...r, p90: Math.round(v) })} /></Field>
          <Field label="Sample size"><NumInput id="rd-n" disabled={ro} value={r.sampleSize} min={1} onChange={(v) => setR({ ...r, sampleSize: Math.max(1, Math.round(v)) })} /></Field>
          <Field label="Basis year ($)"><NumInput id="rd-year" disabled={ro} value={r.basisYear} min={2000} onChange={(v) => setR({ ...r, basisYear: Math.round(v) })} /></Field>
        </div>
        {!order(r) && r.p50 > 0 && <p className="text-xs text-bad">P10 must not exceed P50, and P50 must not exceed P90.</p>}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between"><h3 className="font-display text-[14px] font-bold">Rates by region</h3><span className="text-xs text-muted">Without a regional row: base × region factor</span></div>
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>Region</th><th className="num">Factor</th><th className="num">P10</th><th className="num">P50</th><th className="num">P90</th><th /></tr></thead>
            <tbody>
              {cfg.regions.map((g) => {
                const x = regional.find((y) => y.region === g)
                const f = cfg.regionFactors[g] ?? 1
                return (
                  <tr key={g}>
                    <td className="font-semibold">{g}{x && <Badge tone="info" className="ml-1.5">Regional</Badge>}</td>
                    <td className="num text-muted">×{f.toFixed(2)}</td>
                    {x ? <>
                      <td className="num"><NumInput ariaLabel={`${g} P10`} className="h-7 w-24 text-[12px]" disabled={ro} value={x.p10} min={0} onChange={(v) => setReg(x.id, 'p10', v)} /></td>
                      <td className="num"><NumInput ariaLabel={`${g} P50`} className="h-7 w-24 text-[12px]" disabled={ro} value={x.p50} min={0} onChange={(v) => setReg(x.id, 'p50', v)} /></td>
                      <td className="num"><NumInput ariaLabel={`${g} P90`} className="h-7 w-24 text-[12px]" disabled={ro} value={x.p90} min={0} onChange={(v) => setReg(x.id, 'p90', v)} /></td>
                      <td>{!ro && !(usage[x.id] ?? 0) && <button className="text-muted hover:text-bad" aria-label={`Remove ${g} rate`} onClick={() => setRegional(regional.filter((y) => y.id !== x.id))}>✕</button>}</td>
                    </> : <>
                      <td className="num text-faint">{m(r.p10 * f)}</td><td className="num text-muted">{m(r.p50 * f)}</td><td className="num text-faint">{m(r.p90 * f)}</td>
                      <td>{!ro && <Button size="sm" variant="ghost" onClick={() => addRegion(g)}>Set {g} rate</Button>}</td>
                    </>}
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        </div>
        {rate && used > 0 && <Callout tone="info">{used} estimate line{used > 1 ? 's' : ''} reference this item. They keep their unit costs until the estimating team reprices them after the next rate table is published.</Callout>}
      </div>
    </Drawer>
  )
}
