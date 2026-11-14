// Picklists maintained by the estimating team: allowed units, scope quantity types, the scope library
// (in-scope, out-of-scope, assumptions) and the maturity / class checklist.
import { useEffect, useRef, useState } from 'react'
import type { AaceClass, AppState, EstimatingConfig } from '@/core/types'
import { CLASS_RANGES } from '@/core/engine/estimates'
import { cx } from '@/core/util'
import { Badge, Button, Callout, ClassBadge, Input, Panel, Select, TextArea } from '@/ui/kit'
import { SaveBar, cellInp, saveSection, useDraft } from './shared'

type QT = EstimatingConfig['quantityTypes'][number]
const FEEDS: { value: string; label: string }[] = [
  { value: '', label: 'Not used by the estimate' }, { value: 'lengthFt', label: 'Length (ft)' }, { value: 'sites', label: 'Valve sites' },
  { value: 'hp', label: 'Station capacity (hp)' }, { value: 'tieIns', label: 'Tie-ins' }, { value: 'services', label: 'Services' },
]

// ───────────────────────────── Units and quantity types
export function UnitsQuantities({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const cfg = s.settings.estimating
  const U = useDraft(cfg.units)
  const Q = useDraft(cfg.quantityTypes)
  const [nu, setNu] = useState({ id: '', label: '' })
  const unitUse = (id: string) => s.rates.filter((r) => r.unit === id).length + s.estimates.filter((e) => e.status === 'draft').reduce((a, e) => a + e.lines.filter((l) => l.unit === id).length, 0) + Q.draft.filter((q) => q.unit === id).length
  const qtUse = (id: string) => s.projects.filter((p) => p.scope.quantities.some((q) => q.typeId === id)).length
  const saveUnits = () => {
    const added = U.draft.filter((u) => !cfg.units.some((x) => x.id === u.id)).map((u) => u.id), removed = cfg.units.filter((u) => !U.draft.some((x) => x.id === u.id)).map((u) => u.id)
    const renamed = U.draft.filter((u) => cfg.units.some((x) => x.id === u.id && x.label !== u.label)).map((u) => `${u.id} "${u.label}"`)
    saveSection('units', `Allowed units: ${[added.length && `added ${added.join(', ')}`, removed.length && `removed ${removed.join(', ')}`, renamed.length && `renamed ${renamed.join(', ')}`].filter(Boolean).join('; ') || 'no change'}`, (d) => { d.settings.estimating.units = U.draft.map((x) => ({ ...x })) }, 'Allowed units saved')
    U.commit()
  }
  const saveQt = () => {
    const ch: string[] = []
    for (const q of Q.draft) { const o = cfg.quantityTypes.find((x) => x.id === q.id); if (!o) ch.push(`added ${q.label} (${q.unit})`); else if (JSON.stringify(o) !== JSON.stringify(q)) ch.push(`${q.label}: ${o.unit !== q.unit ? `unit ${o.unit} → ${q.unit} ` : ''}${o.feeds !== q.feeds ? `feeds ${o.feeds ?? 'none'} → ${q.feeds ?? 'none'}` : ''}${o.label !== q.label ? `renamed from ${o.label}` : ''}`.trim()) }
    for (const o of cfg.quantityTypes) if (!Q.draft.some((x) => x.id === o.id)) ch.push(`removed ${o.label}`)
    saveSection('quantity-types', `Scope quantity types: ${ch.join('; ') || 'no change'}`, (d) => { d.settings.estimating.quantityTypes = Q.draft.map((x) => ({ ...x })) }, 'Quantity types saved')
    Q.commit()
  }
  const unitOpts = U.draft.map((u) => ({ value: u.id, label: `${u.id} · ${u.label}` }))
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Panel pad={false} title="Allowed units" subtitle="The only units an estimate line, rate-table row or scope quantity may use (pipe in feet, not inches).">
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>Unit</th><th>Label</th><th className="num">In use</th>{canEdit && <th style={{ width: 30 }} />}</tr></thead>
          <tbody>
            {U.draft.map((u, i) => (
              <tr key={u.id}>
                <td className="font-mono font-semibold">{u.id}</td>
                <td>{canEdit ? <Input aria-label={`${u.id} label`} className={cellInp} value={u.label} onChange={(e) => U.set((d) => { d[i].label = e.target.value; return d })} /> : u.label}</td>
                <td className="num text-muted">{unitUse(u.id)}</td>
                {canEdit && <td>{!unitUse(u.id) && <button className="text-muted hover:text-bad" aria-label={`Remove ${u.id}`} onClick={() => U.set((d) => d.filter((_, k) => k !== i))}>✕</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && <form className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2" onSubmit={(e) => { e.preventDefault(); const id = nu.id.trim(); if (!id || U.draft.some((u) => u.id === id)) return; U.set((d) => [...d, { id, label: nu.label.trim() || id }]); setNu({ id: '', label: '' }) }}>
          <Input id="unit-id" className="h-8 w-24 font-mono" placeholder="Code" value={nu.id} onChange={(e) => setNu({ ...nu, id: e.target.value })} />
          <Input id="unit-label" className="h-8 w-40" placeholder="Label" value={nu.label} onChange={(e) => setNu({ ...nu, label: e.target.value })} />
          <Button size="sm" type="submit" disabled={!nu.id.trim() || U.draft.some((u) => u.id === nu.id.trim())}>Add unit</Button>
        </form>}
        <SaveBar dirty={U.dirty} onSave={saveUnits} onDiscard={U.reset} disabled={U.draft.some((u) => !u.label.trim())} />
      </Panel>

      <Panel pad={false} title="Scope quantity types" subtitle="What a scope statement may count, its unit, and which rate-table estimate input it drives."
        actions={canEdit && <Button size="sm" onClick={() => Q.set((d) => [...d, { id: `qt-${Date.now().toString(36)}`, label: 'New quantity', unit: U.draft[0]?.id ?? 'ea' }])}>Add type</Button>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Quantity</th><th style={{ width: 150 }}>Unit</th><th style={{ width: 190 }}>Feeds the estimate</th><th className="num">Projects</th>{canEdit && <th style={{ width: 30 }} />}</tr></thead>
            <tbody>
              {Q.draft.map((q: QT, i) => (
                <tr key={q.id}>
                  <td>{canEdit ? <Input aria-label="Quantity label" className={cellInp} value={q.label} onChange={(e) => Q.set((d) => { d[i].label = e.target.value; return d })} /> : q.label}</td>
                  <td>{canEdit ? <Select aria-label="Unit" className={cellInp} value={q.unit} onChange={(e) => Q.set((d) => { d[i].unit = e.target.value; return d })} options={unitOpts} /> : <span className="font-mono">{q.unit}</span>}</td>
                  <td>{canEdit ? <Select aria-label="Feeds" className={cellInp} value={q.feeds ?? ''} onChange={(e) => Q.set((d) => { d[i].feeds = (e.target.value || undefined) as QT['feeds']; return d })} options={FEEDS} /> : <span className="text-[12px]">{FEEDS.find((f) => f.value === (q.feeds ?? ''))?.label}</span>}</td>
                  <td className="num text-muted">{qtUse(q.id)}</td>
                  {canEdit && <td>{!qtUse(q.id) && <button className="text-muted hover:text-bad" aria-label={`Remove ${q.label}`} onClick={() => Q.set((d) => d.filter((_, k) => k !== i))}>✕</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SaveBar dirty={Q.dirty} onSave={saveQt} onDiscard={Q.reset} disabled={Q.draft.some((q) => !q.label.trim() || !U.draft.some((u) => u.id === q.unit))} note="The Class 5 rate-table estimate reads length, sites, capacity, tie-ins and services through these." />
      </Panel>
    </div>
  )
}

// ───────────────────────────── Scope library
function Lines({ id, label, value, onChange, disabled }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const [txt, setTxt] = useState(value.join('\n'))
  const joined = value.join('\n')
  const last = useRef(joined)
  useEffect(() => { if (joined !== last.current) { setTxt(joined); last.current = joined } }, [joined])
  return <TextArea id={id} aria-label={label} disabled={disabled} className="min-h-[260px] text-[12.5px] leading-relaxed" value={txt} onChange={(e) => { setTxt(e.target.value); const v = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); last.current = v.join('\n'); onChange(v) }} />
}

export function ScopeLibrary({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const L = useDraft(s.settings.estimating.scopeLibrary)
  const cols: { k: keyof EstimatingConfig['scopeLibrary']; title: string; hint: string }[] = [
    { k: 'inScope', title: 'In scope', hint: 'Picklist for scope statements' },
    { k: 'outOfScope', title: 'Out of scope', hint: 'Exclusions offered to PMs' },
    { k: 'assumptions', title: 'Assumptions', hint: 'Standard assumptions' },
  ]
  const save = () => {
    const o = s.settings.estimating.scopeLibrary
    const ch = cols.map((c) => { const a = L.draft[c.k].filter((x) => !o[c.k].includes(x)).length, r = o[c.k].filter((x) => !L.draft[c.k].includes(x)).length; return a || r ? `${c.title.toLowerCase()} +${a}/−${r}` : '' }).filter(Boolean)
    saveSection('scope-library', `Scope library: ${ch.join('; ') || 'reordered'}`, (d) => { d.settings.estimating.scopeLibrary = { inScope: [...L.draft.inScope], outOfScope: [...L.draft.outOfScope], assumptions: [...L.draft.assumptions] } }, 'Scope library saved')
    L.commit()
  }
  return (
    <Panel pad={false} title="Scope library" subtitle="Standard in-scope items, exclusions and assumptions offered when a scope statement is written. One item per line.">
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
        {cols.map((c) => (
          <div key={c.k} className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between"><span className="font-display text-[14px] font-bold">{c.title}</span><span className="text-xs text-muted">{L.draft[c.k].length} · {c.hint}</span></div>
            <Lines id={`lib-${c.k}`} label={`${c.title}, one item per line`} disabled={!canEdit} value={L.draft[c.k]} onChange={(v) => L.set((d) => ({ ...d, [c.k]: v }))} />
          </div>
        ))}
      </div>
      <SaveBar dirty={L.dirty} onSave={save} onDiscard={L.reset} />
    </Panel>
  )
}

// ───────────────────────────── Maturity / class checklist
export function MaturityAdmin({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const M = useDraft(s.settings.estimating.maturityItems)
  const drafts = s.estimates.filter((e) => e.status === 'draft').length
  const keyOk = (k: string, i: number) => /^[a-z0-9-]+$/.test(k) && M.draft.findIndex((x) => x.key === k) === i
  const valid = M.draft.every((m, i) => m.label.trim() && keyOk(m.key, i)) && [5, 4, 3, 2, 1].every((c) => M.draft.some((m) => m.forClass === c) || c === 2 || c === 1)
  const save = () => {
    const o = s.settings.estimating.maturityItems
    const ch: string[] = []
    for (const m of M.draft) { const x = o.find((y) => y.key === m.key); if (!x) ch.push(`added "${m.label}" (Class ${m.forClass})`); else if (x.forClass !== m.forClass) ch.push(`"${m.label}" Class ${x.forClass} → ${m.forClass}`); else if (x.label !== m.label || x.hint !== m.hint) ch.push(`edited "${m.label}"`) }
    for (const x of o) if (!M.draft.some((m) => m.key === x.key)) ch.push(`removed "${x.label}"`)
    if (!ch.length && JSON.stringify(o.map((x) => x.key)) !== JSON.stringify(M.draft.map((x) => x.key))) ch.push('reordered')
    saveSection('maturity', `Maturity checklist: ${ch.join('; ') || 'no change'}`, (d) => { d.settings.estimating.maturityItems = M.draft.map((x) => ({ ...x })) }, 'Maturity checklist saved')
    M.commit()
  }
  const move = (i: number, dir: -1 | 1) => M.set((d) => { const j = i + dir; if (j < 0 || j >= d.length) return d; [d[i], d[j]] = [d[j], d[i]]; return d })
  return (
    <Panel pad={false} title="Maturity and class checklist" subtitle="An estimate's AACE class is computed from these items: it reaches a class when every item for that class and every coarser class is complete."
      actions={canEdit && <Button size="sm" onClick={() => M.set((d) => [...d, { key: `item-${Date.now().toString(36).slice(-5)}`, label: 'New maturity item', forClass: 3, hint: '' }])}>Add item</Button>}>
      <div className="scroll-x">
        <table className="tbl min-w-[760px]">
          <thead><tr><th style={{ width: 150 }}>Key</th><th>Item</th><th>Hint</th><th style={{ width: 120 }}>Needed for</th>{canEdit && <th style={{ width: 90 }} />}</tr></thead>
          <tbody>
            {M.draft.map((m, i) => {
              const isNew = !s.settings.estimating.maturityItems.some((x) => x.key === m.key)
              return (
                <tr key={i}>
                  <td>{canEdit && isNew ? <Input aria-label="Key" className={cx(cellInp, 'font-mono', !keyOk(m.key, i) && 'border-bad/60')} value={m.key} onChange={(e) => M.set((d) => { d[i].key = e.target.value.toLowerCase().replace(/\s+/g, '-'); return d })} /> : <span className="font-mono text-[12px] text-muted">{m.key}</span>}</td>
                  <td>{canEdit ? <Input aria-label="Item" className={cellInp} value={m.label} onChange={(e) => M.set((d) => { d[i].label = e.target.value; return d })} /> : <b className="font-semibold">{m.label}</b>}</td>
                  <td>{canEdit ? <Input aria-label="Hint" className={cellInp} value={m.hint} onChange={(e) => M.set((d) => { d[i].hint = e.target.value; return d })} /> : <span className="text-[12px] text-muted">{m.hint}</span>}</td>
                  <td>{canEdit ? <Select aria-label="Class" className={cellInp} value={String(m.forClass)} onChange={(e) => M.set((d) => { d[i].forClass = Number(e.target.value) as AaceClass; return d })} options={[5, 4, 3, 2, 1].map((c) => ({ value: String(c), label: `Class ${c}` }))} /> : <ClassBadge cls={m.forClass} />}</td>
                  {canEdit && <td className="whitespace-nowrap text-right">
                    <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                    <button className="px-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === M.draft.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                    <button className="px-1 text-muted hover:text-bad" aria-label="Remove item" onClick={() => M.set((d) => d.filter((_, k) => k !== i))}>✕</button>
                  </td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted">
        {([5, 4, 3, 2, 1] as AaceClass[]).map((c) => <span key={c} className="inline-flex items-center gap-1"><ClassBadge cls={c} /> {M.draft.filter((m) => m.forClass === c).length} item{M.draft.filter((m) => m.forClass === c).length === 1 ? '' : 's'} · {CLASS_RANGES[c].definition}</span>)}
      </div>
      {M.dirty && <div className="px-4 pb-2"><Callout tone="info">Saving recomputes the class of the {drafts} open draft{drafts === 1 ? '' : 's'} as they are edited. Approved and in-review estimates keep the class they were submitted at.</Callout></div>}
      {!valid && M.dirty && <p className="px-4 pb-2 text-xs text-bad">Each item needs a label and a unique lowercase key, and Classes 5, 4 and 3 each need at least one item.</p>}
      <SaveBar dirty={M.dirty} onSave={save} onDiscard={M.reset} disabled={!valid} />
    </Panel>
  )
}

/** Change log for the estimating tables: rate table versions plus every audited change. */
export function ChangeLog({ s }: { s: AppState }) {
  const hist = s.settings.estimating.rateTableHistory.slice().reverse()
  const log = s.audit.filter((a) => a.entity === 'estimating-config' || (a.entity === 'rate') || (a.entity === 'estimate' && (a.action === 'reprice' || a.action === 'keep-rates'))).slice().reverse().slice(0, 200)
  const person = (id: string) => s.people.find((p) => p.id === id)?.name ?? id
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel pad={false} title="Rate table versions">
        <ul className="divide-y divide-line">
          {hist.map((h, i) => (
            <li key={h.version} className="px-4 py-2.5 text-[13px]">
              <div className="flex items-center gap-2"><Badge tone={i === 0 ? 'good' : 'neutral'}>v{h.version}</Badge>{i === 0 && <span className="text-xs font-semibold text-good">In force</span>}<span className="ml-auto text-xs text-muted">{h.at.slice(0, 10)}</span></div>
              <div className="mt-1">{h.note}</div>
              <div className="text-xs text-faint">{person(h.byId)}</div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel pad={false} title="Change log" subtitle="Every change to the estimating tables and every bulk repricing decision">
        {log.length ? (
          <div className="max-h-[560px] overflow-y-auto">
            <table className="tbl">
              <thead><tr><th style={{ width: 140 }}>When</th><th style={{ width: 150 }}>Who</th><th>Change</th></tr></thead>
              <tbody>{log.map((a) => <tr key={a.id}><td className="text-[12px] tabular-nums">{a.at.slice(0, 16).replace('T', ' ')}</td><td className="text-[12px]">{person(a.actorId)}</td><td className="text-[12.5px]">{a.summary}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="px-4 py-6 text-center text-[13px] text-muted">No changes since the demo began. Edits on any tab here are recorded with who, when and what changed.</p>}
      </Panel>
    </div>
  )
}

