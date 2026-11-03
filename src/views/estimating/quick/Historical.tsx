// Estimating → Historical costs: the table Class 5 quick estimates price from, maintained by the estimating team.
// Filter, edit (including the category mix), add / deactivate, CSV export & import, and derive from closed projects.
import { prefs } from '@/core/data'
import { useMemo, useState } from 'react'
import type { AppState, AssetType, DiameterBand, HistoricalCost, Terrain, WorkMethod } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { DIAMETER_BANDS, QUICK_CATALOG } from '@/core/engine/quick'
import { saveFile, toCSV } from '@/core/download'
import { go } from '@/core/router'
import { cx, fmtDate } from '@/core/util'
import { Badge, Button, Callout, Checkbox, ConfirmButton, Drawer, Empty, Field, Input, Modal, Panel, SegButtons, Select, TextArea, Table, type Column } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { NumInput, SpreadBar } from '../parts'
import { catName, directCategories } from '../lib'
import {
  ASSET_LABEL, METHOD_LABEL, TERRAIN_LABEL, applyImport, bandLabel, catalogOf, deriveSuggestions, fmtRate, histKey, historicalCsvRows, mixTotal,
  parseHistoricalCsv, planImport, rowUsage, validateHistorical, type ImportPlan,
} from './lib'
import { rowTitle } from './parts'

const EDIT_ROLES = ['estimator', 'estimating-lead', 'admin']
export const useCanEditHistory = () => { const me = useMe(); return me.roles.some((r) => EDIT_ROLES.includes(r)) }

export function HistoricalCosts() {
  const s = useStore()
  const canEdit = useCanEditHistory()
  const [asset, setAsset] = useState('')
  const [method, setMethod] = useState('')
  const [band, setBand] = useState('')
  const [terrain, setTerrain] = useState('')
  const [active, setActive] = useState<'active' | 'inactive' | 'all'>('active')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<HistoricalCost | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [deriving, setDeriving] = useState(false)
  const methods = asset ? catalogOf(asset as AssetType)?.methods ?? [] : Array.from(new Set(QUICK_CATALOG.flatMap((c) => c.methods)))
  const rows = s.historicalCosts.filter((h) => (!asset || h.assetType === asset) && (!method || h.workMethod === method) && (!band || h.diameterBand === band) && (!terrain || h.terrain === terrain) && (active === 'all' || (active === 'active' ? h.active : !h.active)) && (!q || `${h.sources.join(' ')} ${h.note ?? ''} ${h.id}`.toLowerCase().includes(q.toLowerCase())))
  const usage = useMemo(() => Object.fromEntries(s.historicalCosts.map((h) => [h.id, rowUsage(s, h.id)])), [s])
  const suggestions = useMemo(() => deriveSuggestions(s), [s])
  const thin = s.historicalCosts.filter((h) => h.active && h.n < 5).length
  const cols: Column<HistoricalCost>[] = [
    { key: 'a', header: 'Asset · method', sort: (h) => `${h.assetType}${h.workMethod}`, render: (h) => <div className="min-w-[180px]"><div className="text-[12.5px] font-semibold">{ASSET_LABEL[h.assetType]}</div><div className="text-[11px] text-muted">{METHOD_LABEL[h.workMethod]} · <span className="font-mono text-faint">{h.id}</span></div></div> },
    { key: 'b', header: 'Diameter band', sort: (h) => DIAMETER_BANDS.findIndex((b) => b.id === h.diameterBand), render: (h) => <span className="whitespace-nowrap text-[12px]">{catalogOf(h.assetType)?.banded ? bandLabel(h.diameterBand) : <span className="text-faint">Not banded</span>}</span> },
    { key: 't', header: 'Setting', sort: (h) => h.terrain, render: (h) => <span className="text-[12px]">{TERRAIN_LABEL[h.terrain]}</span> },
    { key: 'u', header: 'Unit', render: (h) => <span className="text-[12px]">{h.unit}</span> },
    { key: 'p10', header: 'P10', num: true, sort: (h) => h.p10, render: (h) => <span className="text-muted">{fmtRate(h.p10, h.unit)}</span> },
    { key: 'p50', header: 'P50', num: true, sort: (h) => h.p50, render: (h) => <b>{fmtRate(h.p50, h.unit)}</b> },
    { key: 'p90', header: 'P90', num: true, sort: (h) => h.p90, render: (h) => <span className="text-muted">{fmtRate(h.p90, h.unit)}</span> },
    { key: 'sp', header: 'Spread', render: (h) => <SpreadBar p10={h.p10} p50={h.p50} p90={h.p90} /> },
    { key: 'n', header: 'n', num: true, sort: (h) => h.n, render: (h) => <span className={cx(h.n < 5 && 'font-semibold text-warn')} title={h.n < 5 ? 'Small sample: fewer than 5 closed projects' : undefined}>{h.n}</span> },
    { key: 'y', header: 'Base yr', num: true, sort: (h) => h.baseYear, render: (h) => `${h.baseYear}$` },
    { key: 'src', header: 'Sources', render: (h) => <span className="block max-w-[180px] truncate text-[11.5px] text-muted" title={h.sources.join(', ')}>{h.sources.join(', ') || '—'}</span> },
    { key: 'upd', header: 'Updated', sort: (h) => h.updatedAt, render: (h) => <span className="whitespace-nowrap text-[11.5px]">{fmtDate(h.updatedAt)}<div className="text-faint">{personName(s, h.updatedById)}</div></span> },
    { key: 'use', header: 'Used', num: true, sort: (h) => usage[h.id]?.total ?? 0, render: (h) => <span className="text-muted" title={`${usage[h.id]?.inReview ?? 0} in review`}>{usage[h.id]?.total ?? 0}</span> },
    { key: 'act', header: 'Status', render: (h) => h.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge> },
  ]
  const exportCsv = async () => {
    const r = await saveFile(`historical-costs-${s.settings.asOf}.csv`, toCSV(historicalCsvRows(rows)), 'text/csv')
    if (r === 'saved') { mutate(() => {}, { entity: 'historical-cost', entityId: 'table', action: 'export', summary: `Exported ${rows.length} historical cost rows to CSV` }); toast('Historical costs downloaded') } else toast(r === 'declined' ? 'Download cancelled' : 'Downloads are not available here', 'info')
  }
  const cleared = !asset && !method && !band && !terrain && active === 'active' && !q
  return (
    <div className="flex flex-col gap-3">
      <Panel pad={false} title="Historical cost table" subtitle={`${rows.length} of ${s.historicalCosts.length} rows · direct cost per unit from closed projects, in base-year dollars (no loaders, escalation or contingency) · Class 5 quick estimates price from the active rows`}
        actions={<>
          <Button size="sm" onClick={exportCsv}>Export CSV</Button>
          {canEdit && <Button size="sm" onClick={() => setImporting(true)}>Import CSV</Button>}
          {canEdit && <Button size="sm" onClick={() => setDeriving(true)}>Derive from closed projects{suggestions.length ? ` (${suggestions.length})` : ''}</Button>}
          {canEdit && <Button size="sm" variant="primary" onClick={() => setEditing('new')}>Add row</Button>}
        </>}>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <Input id="hc-q" aria-label="Search sources and notes" className="h-8 w-44" placeholder="Search sources, notes" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="hc-asset" aria-label="Asset type" className="h-8 w-44" value={asset} onChange={(e) => { setAsset(e.target.value); setMethod('') }} options={[{ value: '', label: 'All asset types' }, ...QUICK_CATALOG.map((c) => ({ value: c.asset, label: c.label }))]} />
          <Select id="hc-method" aria-label="Work method" className="h-8 w-44" value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'All work methods' }, ...methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))]} />
          <Select id="hc-band" aria-label="Diameter band" className="h-8 w-36" value={band} onChange={(e) => setBand(e.target.value)} options={[{ value: '', label: 'All bands' }, ...DIAMETER_BANDS.map((b) => ({ value: b.id, label: bandLabel(b.id) }))]} />
          <Select id="hc-terrain" aria-label="Setting" className="h-8 w-36" value={terrain} onChange={(e) => setTerrain(e.target.value)} options={[{ value: '', label: 'All settings' }, ...(['urban', 'suburban', 'rural', 'any'] as const).map((t) => ({ value: t, label: TERRAIN_LABEL[t] }))]} />
          <SegButtons value={active} onChange={setActive} options={[{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }, { id: 'all', label: 'All' }]} />
          {!cleared && <Button size="sm" variant="ghost" onClick={() => { setAsset(''); setMethod(''); setBand(''); setTerrain(''); setActive('active'); setQ('') }}>Clear filters</Button>}
        </div>
        <Table rows={rows} columns={cols} rowKey={(h) => h.id} dense maxHeight={620} onRowClick={(h) => setEditing(h)} empty={<div className="p-4"><Empty title="No rows match">Change or clear the filters.</Empty></div>} />
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
          {thin > 0 && <span className="text-warn">{thin} active row{thin > 1 ? 's' : ''} rest on fewer than 5 projects — requests priced from them are flagged to the reviewer.</span>}
          <span>Region factors and the Class 5 contingency are set in <button className="font-semibold text-link" onClick={() => { try { prefs.setRaw('crosswalk:admin-tab', JSON.stringify('quick')) } catch { /* blocked */ } go('#admin') }}>Configuration → Class 5 quick estimate</button>.</span>
          {!canEdit && <span>Only the estimating team can change this table.</span>}
        </div>
      </Panel>
      {editing && <HistDrawer s={s} row={editing === 'new' ? undefined : editing} canEdit={canEdit} onClose={() => setEditing(null)} />}
      {importing && <ImportModal s={s} onClose={() => setImporting(false)} />}
      {deriving && <DeriveModal s={s} onClose={() => setDeriving(false)} />}
    </div>
  )
}

function blankRow(s: AppState): HistoricalCost {
  return { id: '', assetType: 'transmission-pipeline', workMethod: 'replace-open-trench', diameterBand: '20-24', terrain: 'suburban', unit: 'ft', p10: 0, p50: 0, p90: 0, n: 1, baseYear: Number(s.settings.asOf.slice(0, 4)), mix: {}, sources: [], updatedAt: s.settings.asOf, updatedById: s.currentUserId, active: true }
}

function changesOf(a: HistoricalCost, b: HistoricalCost): string[] {
  const out: string[] = []
  for (const k of ['assetType', 'workMethod', 'diameterBand', 'terrain', 'unit', 'p10', 'p50', 'p90', 'n', 'baseYear', 'active', 'note'] as const) if (a[k] !== b[k]) out.push(`${k} ${a[k] ?? '—'} → ${b[k] ?? '—'}`)
  if (a.sources.join(',') !== b.sources.join(',')) out.push(`sources ${a.sources.length} → ${b.sources.length}`)
  if (JSON.stringify(a.mix) !== JSON.stringify(b.mix)) out.push('category mix')
  return out
}

export function HistDrawer({ s, row, canEdit, onClose }: { s: AppState; row?: HistoricalCost; canEdit: boolean; onClose: () => void }) {
  const [h, setH] = useState<HistoricalCost>(() => (row ? JSON.parse(JSON.stringify(row)) : blankRow(s)))
  const [src, setSrc] = useState((row?.sources ?? []).join(', '))
  const c = catalogOf(h.assetType)!
  const cats = directCategories(s)
  const full: HistoricalCost = { ...h, sources: src.split(/[,;]/).map((x) => x.trim()).filter(Boolean) }
  const errs = validateHistorical(full, s.historicalCosts)
  const total = mixTotal(h.mix)
  const use = row ? rowUsage(s, row.id) : { total: 0, inReview: 0 }
  const setAsset = (a: AssetType) => { const k = catalogOf(a)!; setH({ ...h, assetType: a, workMethod: k.methods.includes(h.workMethod) ? h.workMethod : k.methods[0], unit: k.unit, diameterBand: k.banded ? (h.diameterBand === 'n/a' ? '20-24' : h.diameterBand) : 'n/a' }) }
  const setMix = (cat: string, v: number) => { const m = { ...h.mix }; if (v > 0) m[cat] = Math.round(v * 100) / 10000; else delete m[cat]; setH({ ...h, mix: m }) }
  const normalize = () => { const t = total / 100; if (!t) return; setH({ ...h, mix: Object.fromEntries(Object.entries(h.mix).map(([k, v]) => [k, Math.round((v / t) * 10000) / 10000])) }) }
  const save = () => {
    if (errs.length || !canEdit) return
    if (row) {
      const ch = changesOf(row, full)
      mutate((d) => { const x = d.historicalCosts.find((y) => y.id === row.id); if (x) Object.assign(x, full, { updatedAt: d.settings.asOf, updatedById: d.currentUserId }) }, { entity: 'historical-cost', entityId: row.id, action: 'update', summary: `Edited historical cost ${row.id} (${rowTitle(full)}): ${ch.join('; ') || 'no change'}` })
      toast('Historical row saved')
    } else {
      let id = ''
      mutate((d) => { let k = d.historicalCosts.length; do id = `hc-${++k}`; while (d.historicalCosts.some((x) => x.id === id)); d.historicalCosts.push({ ...full, id, updatedAt: d.settings.asOf, updatedById: d.currentUserId }) }, { entity: 'historical-cost', entityId: 'new', action: 'create', summary: `Added historical cost row ${rowTitle(full)}: P50 ${fmtRate(full.p50, full.unit)} (n=${full.n}, ${full.baseYear}$)` })
      toast('Historical row added')
    }
    onClose()
  }
  const toggleActive = () => {
    if (!row) return
    mutate((d) => { const x = d.historicalCosts.find((y) => y.id === row.id); if (x) { x.active = !x.active; x.updatedAt = d.settings.asOf; x.updatedById = d.currentUserId } }, { entity: 'historical-cost', entityId: row.id, action: row.active ? 'deactivate' : 'reactivate', summary: `${row.active ? 'Deactivated' : 'Reactivated'} historical cost ${row.id} (${rowTitle(row)})` })
    toast(row.active ? 'Row deactivated — new requests will not price from it' : 'Row reactivated')
    onClose()
  }
  const dis = !canEdit
  return (
    <Drawer open onClose={onClose} width={620} title={row ? `Historical cost ${row.id}` : 'Add historical cost row'}
      footer={<>
        {row && canEdit && <ConfirmButton variant="ghost" onConfirm={toggleActive} confirmLabel={row.active ? 'Deactivate' : 'Reactivate'}>{row.active ? 'Deactivate row' : 'Reactivate row'}</ConfirmButton>}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
        {canEdit && <Button variant="primary" disabled={errs.length > 0} onClick={save}>{row ? 'Save row' : 'Add row'}</Button>}
      </>}>
      <div className="flex flex-col gap-4">
        {row && use.total > 0 && <Callout tone="info">{use.total} quick estimate{use.total > 1 ? 's' : ''} priced from this row{use.inReview ? `, ${use.inReview} still in review` : ''}. Approved estimates keep the figures they were signed with; an estimator adjusting one in review reprices from the saved row.</Callout>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Asset type"><Select id="hc-e-asset" disabled={dis} value={h.assetType} onChange={(e) => setAsset(e.target.value as AssetType)} options={QUICK_CATALOG.map((x) => ({ value: x.asset, label: x.label }))} /></Field>
          <Field label="Work method"><Select id="hc-e-method" disabled={dis} value={h.workMethod} onChange={(e) => setH({ ...h, workMethod: e.target.value as WorkMethod })} options={c.methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} /></Field>
          <Field label="Diameter band" hint={c.banded ? '"All diameters" covers every band' : 'Not banded for this asset type'}><Select id="hc-e-band" disabled={dis || !c.banded} value={h.diameterBand} onChange={(e) => setH({ ...h, diameterBand: e.target.value as DiameterBand })} options={DIAMETER_BANDS.map((b) => ({ value: b.id, label: bandLabel(b.id) }))} /></Field>
          <Field label="Setting"><Select id="hc-e-terrain" disabled={dis} value={h.terrain} onChange={(e) => setH({ ...h, terrain: e.target.value as Terrain | 'any' })} options={(['urban', 'suburban', 'rural', 'any'] as const).map((t) => ({ value: t, label: TERRAIN_LABEL[t] }))} /></Field>
          <Field label="Unit"><Input id="hc-e-unit" disabled value={`${h.unit} (from the catalog)`} /></Field>
          <Field label="Base year (dollars)"><NumInput id="hc-e-year" disabled={dis} value={h.baseYear} min={2000} onChange={(v) => setH({ ...h, baseYear: Math.round(v) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={`P10 $/${h.unit}`}><NumInput id="hc-e-p10" disabled={dis} value={h.p10} min={0} onChange={(v) => setH({ ...h, p10: Math.round(v) })} /></Field>
          <Field label={`P50 $/${h.unit}`}><NumInput id="hc-e-p50" disabled={dis} value={h.p50} min={0} onChange={(v) => setH({ ...h, p50: Math.round(v) })} /></Field>
          <Field label={`P90 $/${h.unit}`}><NumInput id="hc-e-p90" disabled={dis} value={h.p90} min={0} onChange={(v) => setH({ ...h, p90: Math.round(v) })} /></Field>
          <Field label="n (projects)"><NumInput id="hc-e-n" disabled={dis} value={h.n} min={1} onChange={(v) => setH({ ...h, n: Math.max(1, Math.round(v)) })} /></Field>
        </div>
        {h.p50 > 0 && <div className="flex items-center gap-3 text-[12px] text-muted"><SpreadBar p10={h.p10} p50={h.p50} p90={h.p90} /> P10 {h.p50 ? `${Math.round((h.p10 / h.p50 - 1) * 100)}%` : '—'} · P90 +{h.p50 ? Math.round((h.p90 / h.p50 - 1) * 100) : 0}% around the median</div>}
        <Field label="Sources" hint="Closed project codes or benchmark notes, comma-separated"><Input id="hc-e-src" disabled={dis} value={src} onChange={(e) => setSrc(e.target.value)} /></Field>
        <Field label="Note"><TextArea id="hc-e-note" disabled={dis} className="min-h-[48px]" value={h.note ?? ''} onChange={(e) => setH({ ...h, note: e.target.value || undefined })} /></Field>
        <div className="rounded-md border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div><div className="text-[13px] font-semibold">Category mix</div><div className="text-[11.5px] text-muted">Share of direct cost by CBS category. Becomes the estimate's lines.</div></div>
            <div className="flex items-center gap-2"><Badge tone={Math.abs(total - 100) <= 0.5 ? 'good' : 'bad'}>{total.toFixed(1)}%</Badge>{canEdit && Math.abs(total - 100) > 0.5 && total > 0 && <Button size="sm" onClick={normalize}>Scale to 100%</Button>}</div>
          </div>
          <table className="tbl [&_td]:py-1">
            <tbody>
              {cats.map((ct) => (
                <tr key={ct.id}>
                  <td className="text-[12px]"><span className="font-mono text-faint">{ct.code}</span> {catName(s, ct.id)}</td>
                  <td className="w-28"><NumInput ariaLabel={`${ct.name} share %`} className="h-7 px-1.5 py-0.5 text-[12px]" disabled={dis} value={Math.round((h.mix[ct.id] ?? 0) * 10000) / 100} min={0} onChange={(v) => setMix(ct.id, v)} /></td>
                  <td className="num w-20 text-[11.5px] text-muted">{h.p50 ? fmtRate((h.mix[ct.id] ?? 0) * h.p50, h.unit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errs.length > 0 && canEdit && <Callout tone="bad" title="Fix before saving">{errs.map((e) => <div key={e}>{e}</div>)}</Callout>}
        {row && <p className="text-[11.5px] text-muted">Last updated {fmtDate(row.updatedAt)} by {personName(s, row.updatedById)}. Every change is written to the audit log.</p>}
      </div>
    </Drawer>
  )
}

export function ImportModal({ s, onClose }: { s: AppState; onClose: () => void }) {
  const [text, setText] = useState('')
  const [file, setFile] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const parsed = useMemo(() => (text.trim() ? parseHistoricalCsv(text, s) : null), [text, s])
  const plan: ImportPlan | null = parsed && parsed.rows.length ? planImport(s.historicalCosts, parsed.rows, mode) : null
  const loadSample = () => { setText(toCSV(historicalCsvRows(s.historicalCosts.filter((h) => h.active)))); setFile('current table (as exported)') }
  const apply = () => {
    if (!plan || parsed?.errors.length) return
    mutate((d) => applyImport(d, plan), { entity: 'historical-cost', entityId: 'table', action: 'import', summary: `Imported historical costs from ${file || 'pasted CSV'} (${mode}): ${plan.add.length} added, ${plan.update.length} updated, ${plan.deactivate.length} deactivated, ${plan.unchanged} unchanged` })
    toast(`Import applied: ${plan.add.length} added, ${plan.update.length} updated${plan.deactivate.length ? `, ${plan.deactivate.length} deactivated` : ''}`)
    onClose()
  }
  return (
    <Modal open wide onClose={onClose} title="Import historical costs (CSV)"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!plan || !!parsed?.errors.length || (!plan.add.length && !plan.update.length && !plan.deactivate.length)} onClick={apply}>Apply import</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted">Use the columns from Export CSV. <span className="font-mono text-[12px]">mix</span> is <span className="font-mono text-[12px]">category:share</span> pairs separated by semicolons (shares as fractions or percents); <span className="font-mono text-[12px]">sources</span> is semicolon-separated. Rows match on id, else on asset · method · band · setting.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-line px-3 py-1.5 text-[12.5px] font-semibold hover:bg-sunken">
            Choose file…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setText(await f.text()); setFile(f.name) }} />
          </label>
          <Button size="sm" variant="ghost" onClick={loadSample}>Start from the current table</Button>
          {file && <span className="text-[12px] text-muted">{file}</span>}
          <span className="ml-auto"><SegButtons value={mode} onChange={setMode} options={[{ id: 'merge', label: 'Merge' }, { id: 'replace', label: 'Replace' }]} /></span>
        </div>
        <p className="text-[12px] text-muted">{mode === 'merge' ? 'Merge: matching rows are updated, new rows added, rows not in the file are left alone.' : 'Replace: the file becomes the active table. Matching rows are updated, new rows added, and active rows not in the file are deactivated (kept for the record, never deleted).'}</p>
        <TextArea id="hc-import" aria-label="CSV text" className="min-h-[140px] font-mono text-[11.5px]" placeholder="Paste CSV here, or choose a file" value={text} onChange={(e) => { setText(e.target.value); if (!file) setFile('pasted CSV') }} />
        {parsed?.errors.length ? <Callout tone="bad" title={`${parsed.errors.length} problem${parsed.errors.length > 1 ? 's' : ''} — nothing will be imported until fixed`}><ul className="max-h-40 overflow-y-auto">{parsed.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul></Callout> : null}
        {plan && !parsed?.errors.length && (
          <div className="rounded-md border border-line">
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-3 py-2 text-[12.5px]"><span><b>{plan.add.length}</b> to add</span><span><b>{plan.update.length}</b> to update</span><span className={cx(plan.deactivate.length > 0 && 'text-warn')}><b>{plan.deactivate.length}</b> to deactivate</span><span className="text-muted">{plan.unchanged} unchanged</span></div>
            <ul className="max-h-48 overflow-y-auto text-[12px]">
              {plan.add.map((r) => <li key={'a' + histKey(r)} className="border-b border-line/60 px-3 py-1"><Badge tone="good">Add</Badge> {rowTitle(r)} · P50 {fmtRate(r.p50, r.unit)} · n={r.n}</li>)}
              {plan.update.map((u) => <li key={'u' + u.from.id} className="border-b border-line/60 px-3 py-1"><Badge tone="info">Update</Badge> {u.from.id} {rowTitle(u.from)}: {changesOf(u.from, u.to).join('; ')}</li>)}
              {plan.deactivate.map((r) => <li key={'d' + r.id} className="border-b border-line/60 px-3 py-1"><Badge tone="warn">Deactivate</Badge> {r.id} {rowTitle(r)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function DeriveModal({ s, onClose }: { s: AppState; onClose: () => void }) {
  const sug = useMemo(() => deriveSuggestions(s), [s])
  const [pick, setPick] = useState<Set<string>>(() => new Set(sug.filter((x) => x.row).map((x) => x.key)))
  const closed = s.projects.filter((p) => p.status === 'closed')
  const apply = () => {
    const chosen = sug.filter((x) => pick.has(x.key))
    for (const x of chosen) {
      const codes = x.points.map((p) => p.code).join(', ')
      if (x.row) {
        const r = x.row
        mutate((d) => { const h = d.historicalCosts.find((y) => y.id === r.id); if (h) Object.assign(h, { p10: x.suggested.p10, p50: x.suggested.p50, p90: x.suggested.p90, n: x.suggested.n, sources: x.suggested.sources, updatedAt: d.settings.asOf, updatedById: d.currentUserId }) },
          { entity: 'historical-cost', entityId: r.id, action: 'derive', summary: `Updated ${r.id} (${rowTitle(r)}) from closed ${codes}: P50 ${fmtRate(r.p50, r.unit)} → ${fmtRate(x.suggested.p50, r.unit)}, n ${r.n} → ${x.suggested.n}` })
      } else {
        mutate((d) => { let k = d.historicalCosts.length, id = ''; do id = `hc-${++k}`; while (d.historicalCosts.some((y) => y.id === id)); d.historicalCosts.push({ ...x.suggested, id, updatedAt: d.settings.asOf, updatedById: d.currentUserId }) },
          { entity: 'historical-cost', entityId: 'new', action: 'derive', summary: `Added historical cost row ${rowTitle(x.suggested)} from closed ${codes}: P50 ${fmtRate(x.suggested.p50, x.suggested.unit)}` })
      }
    }
    toast(`${chosen.length} row${chosen.length === 1 ? '' : 's'} updated from closed projects`)
    onClose()
  }
  return (
    <Modal open wide onClose={onClose} title="Derive from closed projects"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick.size} onClick={apply}>Apply {pick.size} selected</Button></>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted">Final actuals of {closed.length} closed project{closed.length === 1 ? '' : 's'} ({closed.map((p) => p.code).join(', ') || 'none'}), less loaders, divided by quantity and de-escalated to each row's base year. The suggested P50 blends the new points into the row weighted by n; P10 and P90 move with it and widen to cover any new point outside the band. Projects already listed as a row's source are skipped.</p>
        {!sug.length ? <Empty title="Nothing new to add">Every closed project with final actuals is already in the table.</Empty> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th style={{ width: 28 }} /><th>Row</th><th>Closed projects ($/unit, base-year $)</th><th className="num">P10</th><th className="num">P50</th><th className="num">P90</th><th className="num">n</th></tr></thead>
              <tbody>
                {sug.map((x) => {
                  const u = x.suggested.unit
                  const cell = (k: 'p10' | 'p50' | 'p90' | 'n') => {
                    const cur = x.current?.[k], nxt = x.suggested[k]
                    const f = (v: number) => (k === 'n' ? String(v) : fmtRate(v, u))
                    return <td className="num whitespace-nowrap text-[12px]">{cur != null ? <><span className="text-muted">{f(cur)}</span> → </> : null}<b className={cx(cur != null && nxt !== cur && (nxt > cur ? 'text-bad' : 'text-good'))}>{f(nxt)}</b></td>
                  }
                  return (
                    <tr key={x.key}>
                      <td><Checkbox checked={pick.has(x.key)} onChange={(v) => setPick((p) => { const n = new Set(p); v ? n.add(x.key) : n.delete(x.key); return n })} label="" /></td>
                      <td className="min-w-[200px] text-[12.5px]">{x.row ? <><span className="font-mono text-[11px] text-faint">{x.row.id}</span> {rowTitle(x.row)}</> : <><Badge tone="warn">New row</Badge> {rowTitle(x.suggested)}</>}{!x.row && <div className="text-[11px] text-warn">{x.suggested.note}</div>}</td>
                      <td className="text-[12px]">{x.points.map((p) => <div key={p.projectId}><span className="font-mono font-semibold">{p.code}</span> {fmtRate(p.perUnitBase, u)} <span className="text-faint">({fmtRate(p.perUnitNominal, u)} in {p.year}$, {p.qty.toLocaleString('en-US')} {u})</span></div>)}</td>
                      {cell('p10')}{cell('p50')}{cell('p90')}{cell('n')}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11.5px] text-muted">Final actuals come from each project's cost periods. Review a new row's P10/P90 and category mix after applying.</p>
      </div>
    </Modal>
  )
}
