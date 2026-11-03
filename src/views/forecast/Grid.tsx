// The time-phased forecast grid: WBS functions (roll-ups) expandable to forecast line items (editable).
// Actual months sit before the forecast months, read-only, and drill to the SAP rows behind them.
// Spreadsheet keys on line cells: arrows move (left/right at the edge of the text), Enter moves down, Esc reverts,
// a tab-separated block pasted from Excel fills right and down across the visible line rows.
import React, { useMemo, useRef, useState } from 'react'
import type { AppState, FnProfile, Money } from '@/core/types'
import { cx, sum } from '@/core/util'
import { toast } from '@/ui/toast'
import { ProfileChip } from './Profiles'
import { applyPaste, gridCols, isBlock, parseClipboard, parseMoney, rowTotal, setCell, setYearTotal, shortMonth, type FnGroup, type GridCol, type Spread } from './lib'

export type Unit = 1 | 1000

export function fmtUnit(v: number, unit: Unit): string {
  if (!v) return '–'
  const x = v / unit
  const neg = x < 0
  const a = Math.abs(x)
  const s = a.toLocaleString('en-US', { maximumFractionDigits: unit === 1 ? 0 : a < 100 ? 1 : 0 })
  return neg ? `(${s})` : s
}
const rawUnit = (v: number, unit: Unit) => (v ? String(Math.round((v / unit) * 1000) / 1000) : '')

export interface DrillTarget { lineId?: string; fnId?: string; months: string[]; amount: Money }

export interface LineGridProps {
  s: AppState
  groups: FnGroup[]
  lines: Spread // line × month ETC
  held: Money
  editable: boolean
  budget: Record<string, Money> // by line
  budgetContingency: Money
  actual: Record<string, Money> // by line, through the version's actuals month
  actualMonths: string[] // shown actual months (empty = hidden)
  actualGrid: Spread // line × month actuals
  futureMonths: string[]
  closedThrough: string
  collapsed: Set<string>
  onToggleYear: (y: string) => void
  pastCollapsed: Set<string>
  onTogglePastYear: (y: string) => void
  expanded: Set<string>
  onToggleFn: (fnId: string) => void
  profiles: Record<string, FnProfile>
  unit: Unit
  onChange: (next: Spread, what: string, fnIds: string[]) => void
  onHeld: (v: Money) => void
  onProfile?: (fnId: string) => void
  onLineTools?: (lineId: string) => void
  onDrill?: (t: DrillTarget) => void
}

export function LineGrid(props: LineGridProps) {
  const { s, groups, lines, held, editable, budget, budgetContingency, actual, actualMonths, actualGrid, futureMonths, closedThrough, collapsed, onToggleYear, pastCollapsed, onTogglePastYear, expanded, onToggleFn, profiles, unit, onChange, onHeld, onProfile, onLineTools, onDrill } = props
  const ref = useRef<HTMLDivElement>(null)
  const pastCols = useMemo(() => gridCols(actualMonths, pastCollapsed), [actualMonths, pastCollapsed])
  const cols = useMemo(() => gridCols(futureMonths, collapsed), [futureMonths, collapsed])
  const editRows = groups.filter((g) => expanded.has(g.fn.id)).flatMap((g) => g.lines.map((l) => l.id))
  const fnOfLine = (lid: string) => groups.find((g) => g.lines.some((l) => l.id === lid))?.fn.id
  const val = (ids: string[], c: GridCol) => sum(ids.flatMap((id) => c.months.map((m) => lines[id]?.[m] || 0)))
  const pastVal = (ids: string[], c: GridCol) => sum(ids.flatMap((id) => c.months.map((m) => actualGrid[id]?.[m] || 0)))
  const allIds = groups.flatMap((g) => g.lines.map((l) => l.id))

  const focusCell = (r: number, c: number) => {
    const el = ref.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) { el.focus(); el.select() }
  }
  const commit = (lid: string, ci: number, v: number, label: string) => {
    const col = cols[ci]
    if (!col) return
    if (v === val([lid], col)) return
    onChange(col.kind === 'year' ? setYearTotal(lines, lid, col.months, v) : setCell(lines, lid, col.key, v), `${label} ${col.kind === 'year' ? col.key + ' total' : shortMonth(col.key)}`, [fnOfLine(lid) ?? ''])
  }
  const paste = (r: number, c: number, text: string) => {
    const block = parseClipboard(text)
    const res = applyPaste(lines, editRows, cols.map((x) => x.key), r, c, block, unit, futureMonths)
    const touched = editRows.slice(r, r + block.length).map(fnOfLine).filter(Boolean) as string[]
    onChange(res.spread, `pasted ${res.filled} cells`, [...new Set(touched)])
    toast(res.rejected.length ? `Pasted ${res.filled} cells · ${res.rejected.length} not numbers skipped` : `Pasted ${res.filled} cells`, res.rejected.length ? 'bad' : 'good')
  }

  const colTotals = cols.map((c) => val(allIds, c))
  const pastTotals = pastCols.map((c) => pastVal(allIds, c))
  const budTotal = sum(allIds.map((id) => budget[id] || 0)) + budgetContingency
  const actTotal = sum(allIds.map((id) => actual[id] || 0))
  const etcTotal = sum(allIds.map((id) => rowTotal(lines, id))) + held
  const eacTotal = actTotal + etcTotal

  const yearGroups = (cs: GridCol[]) => {
    const g: { year: string; span: number; collapsed: boolean }[] = []
    for (const c of cs) {
      const y = c.key.slice(0, 4)
      const last = g[g.length - 1]
      if (last && last.year === y) last.span++
      else g.push({ year: y, span: 1, collapsed: c.kind === 'year' })
    }
    return g
  }
  const pastGroups = yearGroups(pastCols)
  const futGroups = yearGroups(cols)
  const stickyTh = 'sticky left-0 z-[3] bg-sunken'
  const numTd = 'whitespace-nowrap px-2 py-1 text-right tabular-nums'
  const sep = 'border-l border-line'
  const boundary = 'border-l-2 border-l-ink/25' // between actual and forecast months
  const pastSep = (c: GridCol, i: number) => (i === 0 ? boundary : c.key.endsWith('-01') || c.kind === 'year' ? sep : '')
  const futSep = (c: GridCol, i: number) => (i === 0 ? (pastCols.length ? boundary : sep) : c.key.endsWith('-01') || c.kind === 'year' ? sep : '')
  let r = -1

  return (
    <div ref={ref} className="scroll-x rounded-md border border-line" role="grid" aria-label="Forecast by WBS function and line item, by month">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">
          <tr>
            <th rowSpan={2} className={cx(stickyTh, 'min-w-[170px] max-w-[240px] border-b border-r border-line px-2 py-1.5 text-left align-bottom md:min-w-[270px]')}>WBS function · line item</th>
            <th rowSpan={2} className="border-b border-line bg-sunken px-2 py-1.5 text-right align-bottom">Budget</th>
            <th rowSpan={2} className="border-b border-line bg-sunken px-2 py-1.5 text-right align-bottom">Actual to date</th>
            {pastGroups.map((g, i) => (
              <th key={'p' + g.year} colSpan={g.span} className={cx('border-b border-line bg-ground px-1 py-1 text-center text-faint', i === 0 ? boundary : sep)}>
                <button className="hover:text-ink" onClick={() => onTogglePastYear(g.year)} title={g.collapsed ? 'Expand months' : 'Collapse to year'}>{g.collapsed ? '▸' : '▾'} {g.year} actual · SAP</button>
              </th>
            ))}
            {futGroups.map((g, i) => (
              <th key={'f' + g.year} colSpan={g.span} className={cx('border-b border-line bg-sunken px-1 py-1 text-center text-ink', i === 0 && pastGroups.length ? boundary : sep)}>
                <button className="hover:text-link" onClick={() => onToggleYear(g.year)} title={g.collapsed ? 'Expand months' : 'Collapse to year'}>{g.collapsed ? '▸' : '▾'} {g.year} forecast</button>
              </th>
            ))}
            <th rowSpan={2} className={cx('border-b border-line bg-sunken px-2 py-1.5 text-right align-bottom', sep)}>ETC</th>
            <th rowSpan={2} className="border-b border-line bg-sunken px-2 py-1.5 text-right align-bottom">EAC</th>
            <th rowSpan={2} className="border-b border-line bg-sunken px-2 py-1.5 text-right align-bottom" title="Variance at completion = budget − EAC">VAC</th>
          </tr>
          <tr>
            {pastCols.map((c, i) => <th key={'pm' + c.key} className={cx('border-b border-line bg-ground px-2 py-1 text-right font-medium normal-case italic text-faint', pastSep(c, i))}>{c.kind === 'year' ? `${c.key} total` : shortMonth(c.key)}</th>)}
            {cols.map((c, i) => {
              const closed = c.kind === 'month' && c.key <= closedThrough
              return <th key={'fm' + c.key} title={closed ? 'This month has closed in SAP — carry this ETC forward' : undefined} className={cx('border-b border-line px-2 py-1 text-right font-medium normal-case', closed ? 'bg-warn/15 text-warn' : 'bg-sunken text-muted', futSep(c, i))}>{c.kind === 'year' ? `${c.key} total` : shortMonth(c.key)}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const ids = g.lines.map((l) => l.id)
            const open = expanded.has(g.fn.id)
            const bud = sum(ids.map((id) => budget[id] || 0))
            const act = sum(ids.map((id) => actual[id] || 0))
            const etc = sum(ids.map((id) => rowTotal(lines, id)))
            const eac = act + etc
            const v = bud - eac
            const over = eac > bud && eac > 0
            const prof = profiles[g.fn.id]
            return (
              <React.Fragment key={g.fn.id}>
                <tr className="bg-sunken/40 font-semibold">
                  <td className="sticky left-0 z-[2] border-b border-r border-line bg-sunken px-1.5 py-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button onClick={() => onToggleFn(g.fn.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${g.fn.name}`} className="w-4 shrink-0 text-muted hover:text-ink">{open ? '▾' : '▸'}</button>
                      <span className="font-mono text-[11px] text-faint">{g.fn.code}</span>
                      <span className={cx('min-w-0 truncate', g.fn.retired && 'text-muted line-through')} title={g.fn.name}>{g.fn.name}</span>
                      {over && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" title="EAC exceeds budget" />}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <ProfileChip s={s} profile={prof} onClick={editable && onProfile && g.lines.length ? () => onProfile(g.fn.id) : undefined} />
                      </span>
                    </div>
                  </td>
                  <td className={cx(numTd, 'border-b border-line')}>{fmtUnit(bud, unit)}</td>
                  <td className={cx(numTd, 'border-b border-line')}>{fmtUnit(act, unit)}</td>
                  {pastCols.map((c, i) => { const x = pastVal(ids, c); return <td key={c.key} className={cx('border-b border-line bg-ground p-0', pastSep(c, i))}><ActCell v={x} unit={unit} onClick={onDrill && x ? () => onDrill({ fnId: g.fn.id, months: c.months, amount: x }) : undefined} label={`${g.fn.name} ${c.key}`} /></td> })}
                  {cols.map((c, ci) => { const x = val(ids, c); return <td key={c.key} className={cx(numTd, 'border-b border-line', futSep(c, ci), c.kind === 'year' && 'bg-sunken/40', x < 0 && 'text-bad')}>{fmtUnit(x, unit)}</td> })}
                  <td className={cx(numTd, 'border-b border-line', sep)}>{fmtUnit(etc, unit)}</td>
                  <td className={cx(numTd, 'border-b border-line', over && 'text-bad')}>{fmtUnit(eac, unit)}</td>
                  <td className={cx(numTd, 'border-b border-line', v < 0 ? 'text-bad' : v > 0 ? 'text-good' : 'text-muted')}>{v ? (v > 0 ? '+' : '') + fmtUnit(v, unit) : '–'}</td>
                </tr>
                {open && g.lines.map((l) => {
                  const ri = editable ? ++r : -1
                  const le = rowTotal(lines, l.id)
                  const la = actual[l.id] || 0
                  const lb = budget[l.id] || 0
                  const lv = lb - la - le
                  return (
                    <tr key={l.id} className="group">
                      <td className="sticky left-0 z-[2] border-b border-r border-line bg-surface py-1 pl-7 pr-1.5 group-hover:bg-sunken">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono text-[11px] text-faint">{l.code}</span>
                          <span className={cx('min-w-0 truncate', l.inactive && 'text-muted line-through')} title={l.name + (l.inactive ? ' (inactive line)' : '')}>{l.name}</span>
                          {editable && onLineTools && <button aria-label={`Line tools for ${l.name}`} title="Phase, set to remaining or clear this line" onClick={() => onLineTools(l.id)} className="ml-auto shrink-0 rounded border border-line bg-surface px-1.5 text-[10.5px] font-semibold text-muted opacity-70 hover:border-ink/40 hover:text-ink group-hover:opacity-100">Tools</button>}
                        </div>
                      </td>
                      <td className={cx(numTd, 'border-b border-line text-muted')}>{fmtUnit(lb, unit)}</td>
                      <td className={cx(numTd, 'border-b border-line text-muted')}>{fmtUnit(la, unit)}</td>
                      {pastCols.map((c, i) => { const x = pastVal([l.id], c); return <td key={c.key} className={cx('border-b border-line bg-ground p-0', pastSep(c, i))}><ActCell v={x} unit={unit} muted onClick={onDrill && x ? () => onDrill({ lineId: l.id, fnId: g.fn.id, months: c.months, amount: x }) : undefined} label={`${l.name} ${c.key}`} /></td> })}
                      {cols.map((c, ci) => {
                        const x = val([l.id], c)
                        const closed = c.kind === 'month' && c.key <= closedThrough
                        return (
                          <td key={c.key} className={cx('border-b border-line p-0', futSep(c, ci), c.kind === 'year' && 'bg-sunken/30')}>
                            {editable
                              ? <CellInput value={x} unit={unit} r={ri} c={ci} label={`${l.code} ${l.name} ${c.kind === 'year' ? c.key + ' total' : shortMonth(c.key)}`} warn={closed && x !== 0} onCommit={(nv) => commit(l.id, ci, nv, l.code)} onPaste={(t) => paste(ri, ci, t)} onNav={focusCell} maxR={editRows.length - 1} maxC={cols.length - 1} />
                              : <div className={cx(numTd, 'min-w-[76px]', x < 0 && 'bg-bad/10 text-bad', closed && x !== 0 && 'bg-warn/10')}>{fmtUnit(x, unit)}</div>}
                          </td>
                        )
                      })}
                      <td className={cx(numTd, 'border-b border-line', sep)}>{fmtUnit(le, unit)}</td>
                      <td className={cx(numTd, 'border-b border-line', la + le > lb && la + le > 0 && 'text-bad')}>{fmtUnit(la + le, unit)}</td>
                      <td className={cx(numTd, 'border-b border-line', lv < 0 ? 'text-bad' : 'text-muted')}>{lv ? (lv > 0 ? '+' : '') + fmtUnit(lv, unit) : '–'}</td>
                    </tr>
                  )
                })}
              </React.Fragment>
            )
          })}
          <tr>
            <td className="sticky left-0 z-[2] border-b border-r border-line bg-surface px-2 py-1">
              <div className="flex items-center gap-1.5 pl-5"><span className="font-mono text-[11px] text-faint">990</span><span className="font-semibold">Contingency held</span></div>
              <div className="pl-5 text-[10.5px] text-faint">In EAC, not spread to a line</div>
            </td>
            <td className={cx(numTd, 'border-b border-line text-muted')}>{fmtUnit(budgetContingency, unit)}</td>
            <td className={cx(numTd, 'border-b border-line text-faint')}>–</td>
            {pastCols.map((c, i) => <td key={c.key} className={cx('border-b border-line bg-ground', pastSep(c, i))} />)}
            {cols.map((c, ci) => <td key={c.key} className={cx('border-b border-line', futSep(c, ci))} />)}
            <td className={cx('border-b border-line p-0', sep)}>
              {editable
                ? <CellInput value={held} unit={unit} r={editRows.length} c={-1} label="Contingency held" onCommit={onHeld} onNav={() => undefined} maxR={editRows.length} maxC={0} />
                : <div className={cx(numTd, 'font-semibold')}>{fmtUnit(held, unit)}</div>}
            </td>
            <td className={cx(numTd, 'border-b border-line font-semibold')}>{fmtUnit(held, unit)}</td>
            <td className={cx(numTd, 'border-b border-line font-semibold', budgetContingency - held < 0 ? 'text-bad' : 'text-muted')}>{budgetContingency - held ? (budgetContingency - held > 0 ? '+' : '') + fmtUnit(budgetContingency - held, unit) : '–'}</td>
          </tr>
          <tr className="bg-sunken font-semibold">
            <td className="sticky left-0 z-[2] border-r border-line bg-sunken px-2 py-1.5 text-[11px] uppercase tracking-wide">Total</td>
            <td className={cx(numTd, 'bg-sunken')}>{fmtUnit(budTotal, unit)}</td>
            <td className={cx(numTd, 'bg-sunken')}>{fmtUnit(actTotal, unit)}</td>
            {pastCols.map((c, i) => <td key={c.key} className={cx('bg-sunken p-0 text-muted', pastSep(c, i))}><ActCell v={pastTotals[i]} unit={unit} label={`All lines ${c.key}`} onClick={onDrill && pastTotals[i] ? () => onDrill({ months: c.months, amount: pastTotals[i] }) : undefined} /></td>)}
            {cols.map((c, i) => <td key={c.key} title={colTotals[i] < 0 ? 'Negative month — check credits or reversals' : undefined} className={cx(numTd, colTotals[i] < 0 ? 'bg-bad/15 text-bad' : 'bg-sunken', futSep(c, i))}>{fmtUnit(colTotals[i], unit)}</td>)}
            <td className={cx(numTd, 'bg-sunken', sep)}>{fmtUnit(etcTotal, unit)}</td>
            <td className={cx(numTd, 'bg-sunken', eacTotal > budTotal && 'text-bad')}>{fmtUnit(eacTotal, unit)}</td>
            <td className={cx(numTd, 'bg-sunken', budTotal - eacTotal < 0 ? 'text-bad' : 'text-good')}>{budTotal - eacTotal ? (budTotal - eacTotal > 0 ? '+' : '') + fmtUnit(budTotal - eacTotal, unit) : '–'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** A read-only actual cell; clickable when there is something to drill into. */
function ActCell({ v, unit, onClick, muted, label }: { v: number; unit: Unit; onClick?: () => void; muted?: boolean; label: string }) {
  const cls = cx('block w-full min-w-[70px] whitespace-nowrap px-2 py-1 text-right italic tabular-nums', muted ? 'text-muted' : 'text-ink/80', v < 0 && 'text-bad')
  if (!onClick) return <span className={cls}>{fmtUnit(v, unit)}</span>
  return <button onClick={onClick} aria-label={`SAP transactions for ${label}`} title="Show the SAP transactions behind this actual" className={cx(cls, 'underline decoration-dotted decoration-faint underline-offset-2 hover:bg-link/10 hover:text-link')}>{fmtUnit(v, unit)}</button>
}

function CellInput({ value, unit, r, c, label, warn, onCommit, onPaste, onNav, maxR, maxC }: {
  value: number; unit: Unit; r: number; c: number; label: string; warn?: boolean
  onCommit: (v: number) => void; onPaste?: (text: string) => void; onNav: (r: number, c: number) => void; maxR: number; maxC: number
}) {
  const [txt, setTxt] = useState<string | null>(null)
  const done = () => {
    if (txt === null) return
    const v = parseMoney(txt, unit)
    setTxt(null)
    if (v === null) { toast(`"${txt}" is not an amount — try 125000, $1.2M or 450K`, 'bad'); return }
    if (v !== value) onCommit(v)
  }
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const len = el.value.length
    const all = el.selectionStart === 0 && el.selectionEnd === len
    const go = (dr: number, dc: number) => {
      e.preventDefault()
      const nr = Math.max(0, Math.min(maxR, r + dr)), nc = Math.max(0, Math.min(maxC, c + dc))
      if (nr === r && nc === c) return
      el.blur()
      onNav(nr, nc)
    }
    switch (e.key) {
      case 'Enter': return e.shiftKey ? go(-1, 0) : go(1, 0)
      case 'ArrowDown': return go(1, 0)
      case 'ArrowUp': return go(-1, 0)
      case 'ArrowLeft': if (all || (el.selectionStart === 0 && el.selectionEnd === 0)) go(0, -1); return
      case 'ArrowRight': if (all || (el.selectionStart === len && el.selectionEnd === len)) go(0, 1); return
      case 'Escape': e.preventDefault(); setTxt(rawUnit(value, unit)); setTimeout(() => el.select()); return
    }
  }
  const editing = txt !== null
  return (
    <input
      data-r={r} data-c={c} aria-label={label} inputMode="decimal" spellCheck={false}
      value={editing ? txt! : value ? fmtUnit(value, unit) : ''}
      placeholder="–"
      onFocus={(e) => { setTxt(rawUnit(value, unit)); const t = e.currentTarget; setTimeout(() => t.select()) }}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={done}
      onKeyDown={key}
      onPaste={(e) => { const t = e.clipboardData.getData('text'); if (onPaste && isBlock(t)) { e.preventDefault(); setTxt(null); onPaste(t) } }}
      className={cx('h-7 w-full min-w-[76px] rounded-none border border-transparent bg-transparent px-2 text-right text-[12px] tabular-nums outline-none placeholder:text-faint hover:border-line focus:border-link focus:bg-surface focus:ring-1 focus:ring-link/40',
        value < 0 && !editing && 'bg-bad/10 text-bad', warn && !editing && 'bg-warn/15')}
    />
  )
}
