// Configuration: the SAP → forecast line mapping table. Rules run in priority order (lowest first) and the first
// match wins: cost-element range, optional WBS-element suffix, optional text/vendor match → a forecast line,
// allocate pro-rata (loader settlements) or exclude (non-project cost). Includes a row tester and coverage checks.
import { useMemo, useState } from 'react'
import type { SapMapping } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { forecastLines, lineById } from '@/core/engine/lines'
import { remap } from '@/core/engine/sap'
import { cx, money, uid } from '@/core/util'
import { Badge, Button, Callout, Checkbox, ConfirmButton, Field, Input, Modal, Panel, SegButtons, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { brokenRules, linesWithoutRule, ruleOverlaps, targetLabel, testRow, unmappedElements } from '../actuals/lib'

export default function SapMappings(_props: { projectId?: string }) {
  const s = useStore()
  const rules = useMemo(() => [...s.settings.sapMappings].sort((a, b) => a.priority - b.priority), [s.settings.sapMappings])
  const [edit, setEdit] = useState<SapMapping | null>(null)
  const overlaps = ruleOverlaps(rules)
  const noRule = linesWithoutRule(s)
  const broken = brokenRules(s)
  const missing = unmappedElements(s)
  const staged = s.actualsImports.filter((x) => x.status === 'staged')
  const hits = useMemo(() => { const out: Record<string, number> = {}; for (const t of s.actualTxns) if (t.ruleId && !t.manual) out[t.ruleId] = (out[t.ruleId] || 0) + 1; return out }, [s.actualTxns])

  const save = (r: SapMapping, isNew: boolean) => {
    mutate((d) => {
      const i = d.settings.sapMappings.findIndex((x) => x.id === r.id)
      if (i >= 0) d.settings.sapMappings[i] = r
      else d.settings.sapMappings.push(r)
    }, { entity: 'sap-mapping', entityId: r.id, action: isNew ? 'create' : 'update', summary: `${isNew ? 'Added' : 'Updated'} SAP mapping rule P${r.priority}: ${r.costElementFrom}–${r.costElementTo}${r.wbsSuffix ? ` WBS *${r.wbsSuffix}` : ''}${r.textContains ? ` text "${r.textContains}"` : ''} → ${targetLabel(s, r)}` })
    toast(isNew ? `Rule P${r.priority} added` : `Rule P${r.priority} saved`)
    setEdit(null)
  }
  const swap = (i: number, dir: -1 | 1) => {
    const a = rules[i], b = rules[i + dir]
    if (!a || !b) return
    mutate((d) => {
      const x = d.settings.sapMappings.find((y) => y.id === a.id)!, y = d.settings.sapMappings.find((z) => z.id === b.id)!
      const pa = x.priority
      if (pa === y.priority) x.priority = pa + dir
      else { x.priority = y.priority; y.priority = pa }
    }, { entity: 'sap-mapping', entityId: a.id, action: 'reorder', summary: `Moved SAP mapping rule ${a.costElementFrom}–${a.costElementTo} ${dir < 0 ? 'ahead of' : 'after'} ${b.costElementFrom}–${b.costElementTo}` })
  }
  const toggle = (r: SapMapping) => {
    mutate((d) => { const x = d.settings.sapMappings.find((y) => y.id === r.id); if (x) x.active = !x.active }, { entity: 'sap-mapping', entityId: r.id, action: r.active ? 'deactivate' : 'activate', summary: `${r.active ? 'Deactivated' : 'Activated'} SAP mapping rule P${r.priority} ${r.costElementFrom}–${r.costElementTo}` })
    toast(r.active ? `P${r.priority} deactivated` : `P${r.priority} activated`)
  }
  const remove = (r: SapMapping) => {
    mutate((d) => { d.settings.sapMappings = d.settings.sapMappings.filter((x) => x.id !== r.id) }, { entity: 'sap-mapping', entityId: r.id, action: 'delete', summary: `Deleted SAP mapping rule P${r.priority} ${r.costElementFrom}–${r.costElementTo} → ${targetLabel(s, r)}` })
    toast(`P${r.priority} deleted`)
  }
  const newRule = (patch: Partial<SapMapping> = {}) => {
    const maxBelowAlloc = Math.max(0, ...rules.filter((r) => r.target === 'line').map((r) => r.priority))
    setEdit({ id: uid('map'), priority: maxBelowAlloc + 1, costElementFrom: '', costElementTo: '', target: 'line', lineId: forecastLines(s)[0]?.id, note: '', active: true, ...patch })
  }
  const rerunAll = () => {
    mutate((d) => { for (const imp of d.actualsImports.filter((x) => x.status === 'staged')) remap(d, imp.id) }, { entity: 'sap-mapping', entityId: 'remap', action: 'remap', summary: `Re-ran the mapping table over ${staged.length} staged SAP extract(s)` })
    toast(`Mapping re-run on ${staged.length} staged extract${staged.length === 1 ? '' : 's'}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RowTester />
        <Panel title="Coverage checks" subtitle="What the table misses, and where rules overlap">
          <div className="flex flex-col gap-2 text-[12.5px]">
            {missing.length > 0 && (
              <Callout tone="bad" title={`${missing.length} cost element${missing.length === 1 ? '' : 's'} in staged extracts match no rule`}>
                <ul className="flex flex-col gap-1">{missing.map((m) => <li key={m.costElement} className="flex flex-wrap items-center gap-2"><span className="font-mono">{m.costElement}</span><span className="text-muted">{m.name} · {m.rows} row{m.rows === 1 ? '' : 's'} · {money(m.amount)}</span><Button size="sm" onClick={() => newRule({ costElementFrom: m.costElement, costElementTo: m.costElement, note: m.name })}>Add rule</Button></li>)}</ul>
              </Callout>
            )}
            {broken.map((r) => <Callout key={r.id} tone="bad">P{r.priority} targets a missing or inactive line — rows it matches stay unmapped.</Callout>)}
            {noRule.length > 0 ? <Callout tone="warn" title="Lines no rule sends cost to">{noRule.map((l) => `${l.code} ${l.name}`).join(', ')}. SAP actuals can still reach them by hand, but not automatically.</Callout> : <div className="flex items-center gap-1.5 text-good"><Icon name="check" className="h-3.5 w-3.5" />Every active forecast line has at least one rule.</div>}
            {overlaps.filter((o) => o.kind !== 'refines').map((o, i) => <Callout key={i} tone={o.kind === 'shadowed' ? 'bad' : 'warn'}>{o.text}.</Callout>)}
            {overlaps.filter((o) => o.kind === 'refines').length > 0 && (
              <div><div className="eyebrow mb-1">Intended overlaps</div><ul className="flex flex-col gap-0.5 text-muted">{overlaps.filter((o) => o.kind === 'refines').map((o, i) => <li key={i}><span className="font-mono text-[11.5px] text-ink">P{o.a.priority} / P{o.b.priority}</span> — {o.text}</li>)}</ul></div>
            )}
            {staged.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2"><span className="text-muted">{staged.length} staged extract{staged.length === 1 ? '' : 's'} waiting.</span><Button size="sm" onClick={rerunAll}>Re-run mapping on staged</Button><a href="#actuals" className="text-link hover:underline">Open SAP actuals</a></div>}
          </div>
        </Panel>
      </div>

      <Panel title="Mapping rules" subtitle={`${rules.filter((r) => r.active).length} active of ${rules.length} · lowest priority number runs first; the first matching rule wins`} pad={false}
        actions={<Button size="sm" variant="primary" onClick={() => newRule()} icon={<Icon name="plus" className="h-3.5 w-3.5" />}>Add rule</Button>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Order</th><th>Cost element</th><th>WBS suffix</th><th>Text contains</th><th>Target</th><th>Note</th><th className="num">Rows matched</th><th>Active</th><th /></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id} className={cx(!r.active && 'text-faint')}>
                  <td className="whitespace-nowrap">
                    <span className="mr-1 inline-block w-9 font-mono text-[12px] font-semibold">P{r.priority}</span>
                    <button className="rounded px-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => swap(i, -1)} aria-label="Run earlier">▲</button>
                    <button className="rounded px-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30" disabled={i === rules.length - 1} onClick={() => swap(i, 1)} aria-label="Run later">▼</button>
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12px]">{r.costElementFrom}{r.costElementTo !== r.costElementFrom && <>–{r.costElementTo}</>}</td>
                  <td className="font-mono text-[12px]">{r.wbsSuffix ? `*${r.wbsSuffix}` : <span className="text-faint">any</span>}</td>
                  <td className="text-[12px]">{r.textContains ? `“${r.textContains}”` : <span className="text-faint">any</span>}</td>
                  <td className="whitespace-nowrap"><Badge tone={r.target === 'line' ? (lineById(s, r.lineId)?.active ? 'neutral' : 'bad') : r.target === 'allocate' ? 'info' : 'warn'}>{targetLabel(s, r)}</Badge></td>
                  <td className="min-w-[200px] text-[12px] text-muted">{r.note}</td>
                  <td className="num text-muted">{hits[r.id] ?? 0}</td>
                  <td><input type="checkbox" className="h-4 w-4" checked={r.active} onChange={() => toggle(r)} aria-label={`Rule P${r.priority} active`} /></td>
                  <td className="whitespace-nowrap text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button><ConfirmButton size="sm" variant="ghost" confirmLabel="Delete rule" onConfirm={() => remove(r)}>Delete</ConfirmButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Changing rules does not touch posted actuals. Staged extracts pick up changes when mapping is re-run; rows resolved by hand are kept.</div>
      </Panel>
      {edit && <RuleModal rule={edit} isNew={!s.settings.sapMappings.some((x) => x.id === edit.id)} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  )
}

function RowTester() {
  const s = useStore()
  const sample = s.projects.find((p) => p.status === 'active' && p.stageIndex >= 2)
  const [ce, setCe] = useState('5100110')
  const [wbs, setWbs] = useState(sample ? `${sample.erpWbs}.02` : '')
  const [text, setText] = useState('')
  const r = testRow(s, { costElement: ce.trim(), sapWbs: wbs.trim(), text })
  const fn = s.settings.wbsFunctions.find((f) => f.id === r.fnId)
  return (
    <Panel title="Test a row" subtitle="Enter what an SAP line item carries to see which rule catches it">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Cost element"><Input className="font-mono" value={ce} onChange={(e) => setCe(e.target.value)} placeholder="5200110" /></Field>
        <Field label="WBS element"><Input className="font-mono" value={wbs} onChange={(e) => setWbs(e.target.value)} placeholder="C.PSE.1001.02" /></Field>
        <Field label="Text or vendor"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="optional" /></Field>
      </div>
      <div className="mt-3 rounded-md border border-line bg-sunken/40 p-3 text-[12.5px]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div><div className="eyebrow">Project</div>{wbs.trim() ? (r.project ? <span><span className="font-mono font-semibold">{r.project.code}</span> <span className="text-muted">{r.project.name}</span></span> : <span className="font-semibold text-bad">No project — row would be an exception</span>) : <span className="text-faint">enter a WBS element</span>}</div>
          <div><div className="eyebrow">Winning rule</div>{r.winner ? <span className="font-mono font-semibold">P{r.winner.priority} · {r.winner.costElementFrom}–{r.winner.costElementTo}{r.winner.wbsSuffix ? ` *${r.winner.wbsSuffix}` : ''}</span> : <span className="font-semibold text-bad">None — unmapped</span>}</div>
          <div><div className="eyebrow">Lands on</div>{r.winner ? <span className="font-semibold">{targetLabel(s, r.winner)}{fn && <span className="font-normal text-muted"> → WBS {fn.code} {fn.name}</span>}</span> : '—'}</div>
        </div>
        {r.all.length > 1 && <div className="mt-2 border-t border-line pt-2 text-[12px] text-muted">Also matches, but runs later: {r.all.slice(1).map((x) => `P${x.priority} (${targetLabel(s, x)})`).join(', ')}</div>}
        {r.winner?.note && <div className="mt-1 text-[12px] text-muted">{r.winner.note}</div>}
      </div>
    </Panel>
  )
}

function RuleModal({ rule, isNew, onClose, onSave }: { rule: SapMapping; isNew: boolean; onClose: () => void; onSave: (r: SapMapping, isNew: boolean) => void }) {
  const s = useStore()
  const [r, setR] = useState<SapMapping>(rule)
  const lines = forecastLines(s)
  const clash = s.settings.sapMappings.find((x) => x.id !== r.id && x.priority === r.priority)
  const submit = () => {
    const from = r.costElementFrom.trim(), to = (r.costElementTo.trim() || from)
    if (!/^\d{4,10}$/.test(from) || !/^\d{4,10}$/.test(to)) { toast('Cost elements are numbers, e.g. 5200000', 'bad'); return }
    if (Number(to) < Number(from)) { toast('The range ends before it starts', 'bad'); return }
    if (r.target === 'line' && !r.lineId) { toast('Choose the forecast line', 'bad'); return }
    if (!r.note.trim()) { toast('Add a note — what the rule is for', 'bad'); return }
    onSave({ ...r, costElementFrom: from, costElementTo: to, wbsSuffix: r.wbsSuffix?.trim() || undefined, textContains: r.textContains?.trim() || undefined, lineId: r.target === 'line' ? r.lineId : undefined, note: r.note.trim() }, isNew)
  }
  const affected = useMemo(() => {
    const t = s.actualTxns.filter((x) => s.actualsImports.find((i) => i.id === x.importId)?.status === 'staged' && !x.manual)
    const from = Number(r.costElementFrom), to = Number(r.costElementTo || r.costElementFrom)
    return t.filter((x) => Number(x.costElement) >= from && Number(x.costElement) <= to).length
  }, [s, r.costElementFrom, r.costElementTo])
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add mapping rule' : `Edit rule P${rule.priority}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{isNew ? 'Add rule' : 'Save rule'}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Priority" hint={clash ? `Same as P${clash.priority} (${clash.costElementFrom}–${clash.costElementTo})` : 'Lower runs first'}><Input type="number" value={r.priority} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} /></Field>
          <Field label="Cost element from"><Input className="font-mono" value={r.costElementFrom} onChange={(e) => setR({ ...r, costElementFrom: e.target.value })} placeholder="5200000" /></Field>
          <Field label="Cost element to" hint="Inclusive; blank = same as from"><Input className="font-mono" value={r.costElementTo} onChange={(e) => setR({ ...r, costElementTo: e.target.value })} placeholder="5209999" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="WBS element ends with" hint="e.g. .02 for the engineering sub-WBS; blank = any"><Input className="font-mono" value={r.wbsSuffix ?? ''} onChange={(e) => setR({ ...r, wbsSuffix: e.target.value })} /></Field>
          <Field label="Text or vendor contains" hint="Case-insensitive; blank = any"><Input value={r.textContains ?? ''} onChange={(e) => setR({ ...r, textContains: e.target.value })} /></Field>
        </div>
        <Field label="Target">
          <div className="flex flex-col gap-1.5">
            <SegButtons value={r.target} onChange={(v) => setR({ ...r, target: v })} options={[{ id: 'line', label: 'Forecast line' }, { id: 'allocate', label: 'Allocate pro-rata' }, { id: 'exclude', label: 'Exclude' }]} />
            {r.target === 'line' && <Select aria-label="Forecast line" value={r.lineId ?? ''} onChange={(e) => setR({ ...r, lineId: e.target.value })} options={lines.map((l) => ({ value: l.id, label: `${l.code} ${l.name} (WBS ${s.settings.wbsFunctions.find((f) => f.id === l.functionId)?.code})` }))} />}
            {r.target === 'allocate' && <span className="text-[12px] text-muted">For overhead, benefits and AFUDC settlements: spread over the project-period’s mapped lines in proportion to their direct cost.</span>}
            {r.target === 'exclude' && <span className="text-[12px] text-muted">Kept in the import record but never reaches project actuals (balance-sheet transfers, non-project postings).</span>}
          </div>
        </Field>
        <Field label="Note (why this rule exists)"><TextArea rows={2} value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} /></Field>
        <Checkbox checked={r.active} onChange={(v) => setR({ ...r, active: v })} label="Active" />
        {affected > 0 && <Callout tone="info">{affected} row{affected === 1 ? '' : 's'} in staged extracts fall in this range. Re-run mapping after saving to apply the rule to them.</Callout>}
      </div>
    </Modal>
  )
}
