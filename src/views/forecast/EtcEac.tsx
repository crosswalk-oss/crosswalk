// ETC / EAC by WBS function (lines nested): the headline of the forecast tab and of the portfolio cycle page.
import React, { useState } from 'react'
import type { AppState, FnProfile, Money } from '@/core/types'
import { cx, money, moneyDelta } from '@/core/util'
import { ProfileChip } from './Profiles'

export interface EtcRow {
  fnId: string; code: string; name: string
  budget: Money; actual: Money; etc: Money; eac: Money; vac: Money
  profile?: FnProfile
  lines: { id: string; code: string; name: string; budget: Money; actual: Money; etc: Money; eac: Money; vac: Money }[]
  note?: React.ReactNode // extra cell content (portfolio: projects over budget)
}

const pctOf = (a: number, b: number) => (b ? (a / b) * 100 : 0)

export function EtcEacTable({ s, rows, contingencyBudget, contingencyHeld, totals, showProfile = true, extraHeader, onProfile, onActual, initiallyOpen }: {
  s: AppState; rows: EtcRow[]; contingencyBudget: Money; contingencyHeld: Money
  totals: { budget: Money; actual: Money; etc: Money; eac: Money; vac: Money }
  showProfile?: boolean; extraHeader?: string
  onProfile?: (fnId: string) => void
  onActual?: (t: { fnId?: string; lineId?: string }) => void
  initiallyOpen?: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen ?? []))
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const all = rows.every((r) => open.has(r.fnId) || r.lines.length < 2)
  const fnBud = rows.reduce((a, r) => a + r.budget, 0)
  const fnEac = rows.reduce((a, r) => a + r.eac, 0)
  const fnAct = rows.reduce((a, r) => a + r.actual, 0)
  const fnEtc = rows.reduce((a, r) => a + r.etc, 0)
  const spent = (a: number, e: number) => {
    const p = pctOf(a, e)
    return (
      <div className="flex items-center justify-end gap-2">
        <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-sunken sm:block"><div className={cx('h-full rounded-full', p > 100 ? 'bg-bad' : 'bg-ink/60')} style={{ width: `${Math.min(100, Math.max(0, p))}%` }} /></div>
        <span className="w-10 text-right tabular-nums">{e ? `${Math.round(p)}%` : '—'}</span>
      </div>
    )
  }
  const vacCell = (v: number, b: number) => (
    <span className={cx('tabular-nums', v < 0 ? 'text-bad' : v > 0 ? 'text-good' : 'text-faint')}>{v ? moneyDelta(v) : '–'}{b && v ? <span className="ml-1 text-[10.5px] font-normal text-faint">{pctOf(v, b) > 0 ? '+' : ''}{pctOf(v, b).toFixed(1)}%</span> : null}</span>
  )
  const act = (v: number, t: { fnId?: string; lineId?: string }) => onActual && v
    ? <button className="tabular-nums underline decoration-dotted decoration-faint underline-offset-2 hover:text-link" title="Show the SAP transactions behind this actual" onClick={() => onActual(t)}>{money(v)}</button>
    : <span className="tabular-nums">{v ? money(v) : '–'}</span>
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th className="sticky left-0 z-[2] bg-sunken">
              <button className="mr-1.5 text-muted hover:text-ink" onClick={() => setOpen(all ? new Set() : new Set(rows.map((r) => r.fnId)))} title={all ? 'Collapse all' : 'Expand all functions to lines'}>{all ? '▾' : '▸'}</button>
              WBS function · line
            </th>
            {showProfile && <th>Profile</th>}
            <th className="num">Budget</th><th className="num">Actual to date</th><th className="num">ETC</th><th className="num">EAC</th>
            <th className="num" title="Variance at completion = budget − EAC">VAC</th><th className="num" title="Actual to date ÷ EAC">% spent</th>
            {extraHeader && <th>{extraHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.fnId)
            return (
              <React.Fragment key={r.fnId}>
                <tr className="font-semibold">
                  <td className="sticky left-0 z-[1] whitespace-nowrap bg-surface">
                    <button className={cx('mr-1.5 w-3 text-muted hover:text-ink', !r.lines.length && 'invisible')} onClick={() => toggle(r.fnId)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.name}`}>{isOpen ? '▾' : '▸'}</button>
                    <span className="font-mono text-[11px] font-normal text-faint">{r.code}</span> {r.name}
                    {r.eac > r.budget && r.eac > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-bad align-middle" title="EAC exceeds budget" />}
                  </td>
                  {showProfile && <td className="whitespace-nowrap font-normal"><ProfileChip s={s} profile={r.profile} onClick={onProfile && r.lines.length ? () => onProfile(r.fnId) : undefined} /></td>}
                  <td className="num">{r.budget ? money(r.budget) : '–'}</td>
                  <td className="num">{act(r.actual, { fnId: r.fnId })}</td>
                  <td className="num">{r.etc ? money(r.etc) : '–'}</td>
                  <td className={cx('num', r.eac > r.budget && r.eac > 0 && 'text-bad')}>{r.eac ? money(r.eac) : '–'}</td>
                  <td className="num">{vacCell(r.vac, r.budget)}</td>
                  <td className="num font-normal">{spent(r.actual, r.eac)}</td>
                  {extraHeader && <td className="font-normal">{r.note}</td>}
                </tr>
                {isOpen && r.lines.map((l) => (
                  <tr key={l.id} className="text-[12.5px]">
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-surface pl-9 text-muted"><span className="font-mono text-[11px] text-faint">{l.code}</span> {l.name}</td>
                    {showProfile && <td />}
                    <td className="num text-muted">{l.budget ? money(l.budget) : '–'}</td>
                    <td className="num text-muted">{act(l.actual, { lineId: l.id, fnId: r.fnId })}</td>
                    <td className="num text-muted">{l.etc ? money(l.etc) : '–'}</td>
                    <td className={cx('num', l.eac > l.budget && l.eac > 0 ? 'text-bad' : 'text-muted')}>{l.eac ? money(l.eac) : '–'}</td>
                    <td className="num">{vacCell(l.vac, l.budget)}</td>
                    <td className="num text-muted">{spent(l.actual, l.eac)}</td>
                    {extraHeader && <td />}
                  </tr>
                ))}
              </React.Fragment>
            )
          })}
          <tr className="border-t border-line bg-sunken/50 font-semibold">
            <td className="sticky left-0 z-[1] whitespace-nowrap bg-sunken/50">Functions subtotal</td>
            {showProfile && <td />}
            <td className="num">{money(fnBud)}</td><td className="num">{money(fnAct)}</td><td className="num">{money(fnEtc)}</td><td className="num">{money(fnEac)}</td>
            <td className="num">{vacCell(fnBud - fnEac, fnBud)}</td><td className="num font-normal">{spent(fnAct, fnEac)}</td>
            {extraHeader && <td />}
          </tr>
          <tr>
            <td className="sticky left-0 z-[1] whitespace-nowrap bg-surface"><span className="font-mono text-[11px] text-faint">990</span> Contingency held<div className="text-[10.5px] text-faint">In EAC, not spread to a function</div></td>
            {showProfile && <td />}
            <td className="num text-muted">{contingencyBudget ? money(contingencyBudget) : '–'}</td><td className="num text-faint">–</td>
            <td className="num">{contingencyHeld ? money(contingencyHeld) : '–'}</td><td className="num">{contingencyHeld ? money(contingencyHeld) : '–'}</td>
            <td className="num">{vacCell(contingencyBudget - contingencyHeld, 0)}</td><td className="num text-faint">{contingencyBudget ? `${Math.round(pctOf(contingencyHeld, contingencyBudget))}% held` : ''}</td>
            {extraHeader && <td />}
          </tr>
          <tr className="bg-sunken font-bold">
            <td className="sticky left-0 z-[1] bg-sunken uppercase tracking-wide text-[11.5px]">Total</td>
            {showProfile && <td />}
            <td className="num">{money(totals.budget)}</td><td className="num">{money(totals.actual)}</td><td className="num">{money(totals.etc)}</td>
            <td className={cx('num', totals.eac > totals.budget && 'text-bad')}>{money(totals.eac)}</td>
            <td className="num">{vacCell(totals.vac, totals.budget)}</td><td className="num font-normal">{spent(totals.actual, totals.eac)}</td>
            {extraHeader && <td />}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
