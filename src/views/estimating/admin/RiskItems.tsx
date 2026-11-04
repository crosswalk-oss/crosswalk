// Estimating administration → Risk items: the list a PM rates Low / Medium / High risk on a Class 5 request, with what
// each level means and its triangular cost impact (min / most likely / max % of rate-table direct cost).
import type { AppState, RiskItemDef, RiskLevel } from '@/core/types'
import { DEFAULT_RISK_ITEMS, RISK_LEVELS, RISK_LEVEL_LABEL, riskItemsOf, validateRiskItems } from '@/core/engine/parametric'
import { Badge, Button, Callout, Input, Panel } from '@/ui/kit'
import { NumInput } from '../parts'
import { SaveBar, cellInp, saveSection, useDraft } from './shared'

const describe = (a: RiskItemDef[], b: RiskItemDef[]) => {
  const out: string[] = []
  for (const x of b) {
    const y = a.find((i) => i.id === x.id)
    if (!y) { out.push(`added ${x.name}`); continue }
    if (y.name !== x.name) out.push(`${y.name} renamed ${x.name}`)
    for (const k of RISK_LEVELS) {
      const p = y.levels[k], q = x.levels[k]
      if (p.min !== q.min || p.mode !== q.mode || p.max !== q.max) out.push(`${x.name} ${k} ${p.min}/${p.mode}/${p.max}% → ${q.min}/${q.mode}/${q.max}%`)
      if (p.label !== q.label) out.push(`${x.name} ${k} description changed`)
    }
  }
  for (const y of a) if (!b.some((x) => x.id === y.id)) out.push(`removed ${y.name}`)
  return out
}

export function RiskItemsAdmin({ s, canEdit }: { s: AppState; canEdit: boolean }) {
  const current = riskItemsOf(s)
  const D = useDraft<RiskItemDef[]>(current)
  const problems = validateRiskItems(D.draft)
  const save = () => {
    if (problems.length) return
    saveSection('risk-items', `Class 5 risk items: ${describe(current, D.draft).join('; ') || 'no change'}`, (d) => { d.settings.estimating.riskItems = JSON.parse(JSON.stringify(D.draft)) }, 'Risk items saved')
    D.commit()
  }
  const setLevel = (i: number, k: RiskLevel, patch: Partial<RiskItemDef['levels'][RiskLevel]>) => D.set((d) => { d[i].levels[k] = { ...d[i].levels[k], ...patch }; return d })
  return (
    <Panel pad={false} title={<span className="inline-flex items-center gap-2">Class 5 risk items <Badge tone="info">{D.draft.length} items</Badge></span>}
      subtitle="PMs rate each item Low, Medium or High risk on a Class 5 request. Each level adds a triangular allowance (min / most likely / max % of rate-table direct cost); the most likely drives the point estimate and all three feed the Monte Carlo. Physical, legal and logistical conditions only."
      actions={canEdit && <div className="flex gap-2"><Button size="sm" onClick={() => D.set((d) => [...d, { id: `item${d.length + 1}`, name: 'New risk item', help: '', levels: { low: { label: 'Low', min: 0, mode: 0, max: 1 }, medium: { label: 'Medium', min: 1, mode: 3, max: 6 }, high: { label: 'High', min: 4, mode: 8, max: 15 } } }])}>+ Add item</Button><Button size="sm" variant="ghost" onClick={() => D.set(() => JSON.parse(JSON.stringify(DEFAULT_RISK_ITEMS)))}>Restore defaults</Button></div>}>
      <div className="scroll-x">
        <table className="tbl">
          <thead><tr><th style={{ minWidth: 200 }}>Item</th>{RISK_LEVELS.map((k) => <th key={k} style={{ minWidth: 230 }}>{RISK_LEVEL_LABEL[k]} <span className="font-normal text-faint">· min / likely / max %</span></th>)}{canEdit && <th style={{ width: 30 }} />}</tr></thead>
          <tbody>
            {D.draft.map((it, i) => (
              <tr key={i}>
                <td className="align-top">{canEdit ? <div className="flex flex-col gap-1"><Input aria-label="Item name" className={cellInp} value={it.name} onChange={(e) => D.set((d) => { d[i].name = e.target.value; return d })} /><Input aria-label="Help text" className={cellInp} placeholder="What the PM should consider" value={it.help} onChange={(e) => D.set((d) => { d[i].help = e.target.value; return d })} /></div> : <><b className="text-[12.5px]">{it.name}</b><div className="text-[11.5px] text-muted">{it.help}</div></>}</td>
                {RISK_LEVELS.map((k) => {
                  const l = it.levels[k]
                  return (
                    <td key={k} className="align-top">
                      {canEdit ? (
                        <div className="flex flex-col gap-1">
                          <Input aria-label={`${it.name} ${k} description`} className={cellInp} value={l.label} onChange={(e) => setLevel(i, k, { label: e.target.value })} />
                          <div className="grid grid-cols-3 gap-1">
                            <NumInput ariaLabel={`${it.name} ${k} min`} className={cellInp} value={l.min} step={0.5} onChange={(v) => setLevel(i, k, { min: v })} />
                            <NumInput ariaLabel={`${it.name} ${k} most likely`} className={cellInp} value={l.mode} step={0.5} onChange={(v) => setLevel(i, k, { mode: v })} />
                            <NumInput ariaLabel={`${it.name} ${k} max`} className={cellInp} value={l.max} step={0.5} onChange={(v) => setLevel(i, k, { max: v })} />
                          </div>
                        </div>
                      ) : <div className="text-[12px]"><div>{l.label}</div><div className="tabular-nums text-muted">{l.min} / <b className="text-ink">{l.mode}</b> / {l.max}%</div></div>}
                    </td>
                  )
                })}
                {canEdit && <td className="align-top"><button className="text-muted hover:text-bad" aria-label={`Remove ${it.name}`} onClick={() => D.set((d) => d.filter((_, k) => k !== i))}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problems.length > 0 && D.dirty && <div className="px-4 py-2"><Callout tone="bad" title="Fix before saving">{problems.join(' · ')}</Callout></div>}
      <SaveBar dirty={D.dirty} onSave={save} onDiscard={D.reset} disabled={problems.length > 0} note="New requests price with the saved table; requests already sent keep their ratings and are repriced only when an estimator reviews them." />
    </Panel>
  )
}
