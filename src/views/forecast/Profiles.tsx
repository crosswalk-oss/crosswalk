// Curve profiles on the forecast tab: the mini shape preview, the per-function profile chooser and the per-line tools.
import { useEffect, useMemo, useState } from 'react'
import type { AppState, FnProfile, Money, Project } from '@/core/types'
import { cx, fmtMonth, money, monthRange, sum } from '@/core/util'
import { Badge, Button, ConfirmButton, Field, Modal, MoneyInput, SegButtons, Select } from '@/ui/kit'
import { allProfiles, previewSpread, profileName, rowTotal, shapeOf, shortMonth, type LineRef, type Spread } from './lib'
import { budgetByLine } from '@/core/engine/lines'
import { lsSet } from '../admin/common'

/** Small bar sketch of a weight shape. Zero bars (black-out months) show as a tick on the baseline. */
export function Shape({ weights, w = 64, h = 18, className, labels }: { weights: number[]; w?: number; h?: number; className?: string; labels?: string[] }) {
  const n = weights.length
  const mx = Math.max(1e-9, ...weights)
  const bw = n ? w / n : w
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={cx('shrink-0', className)} aria-hidden>
      <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} className="stroke-line" strokeWidth={1} />
      {weights.map((x, i) => {
        const bh = x > 0 ? Math.max(1.5, ((h - 2) * x) / mx) : 0
        return x > 0
          ? <rect key={i} x={i * bw + (bw > 3 ? 0.5 : 0)} y={h - 1 - bh} width={Math.max(0.8, bw - (bw > 3 ? 1 : 0.2))} height={bh} rx={bw > 4 ? 1 : 0} className="fill-link/70">{labels && <title>{labels[i]}</title>}</rect>
          : <rect key={i} x={i * bw + bw / 2 - 0.75} y={h - 3} width={1.5} height={2} className="fill-bad/70">{labels && <title>{`${labels[i]} — no spend`}</title>}</rect>
      })}
    </svg>
  )
}

/** Profile chip shown on a function row: name, and an "adjusted" marker once cells were edited after applying. */
export function ProfileChip({ s, profile, onClick, title }: { s: AppState; profile?: FnProfile; onClick?: () => void; title?: string }) {
  const Tag = onClick ? 'button' : 'span'
  if (!profile) return <Tag onClick={onClick} title={title ?? 'No profile applied'} className={cx('inline-flex max-w-[150px] items-center rounded border border-dashed border-line px-1.5 text-[10.5px] font-semibold leading-[18px] text-faint', onClick && 'hover:border-ink/40 hover:text-ink')}>No profile</Tag>
  const name = profileName(s, profile.profileId)
  return (
    <Tag onClick={onClick} title={title ?? `${name} · ${fmtMonth(profile.start)} – ${fmtMonth(profile.end)}${profile.adjusted ? ' · cells edited by hand after applying' : ''}`}
      className={cx('inline-flex min-w-0 max-w-[190px] items-center gap-1 rounded border px-1.5 text-[10.5px] font-semibold leading-[18px]', profile.adjusted ? 'border-warn/50 bg-warn/10 text-ink' : 'border-link/40 bg-link/10 text-ink', onClick && 'hover:border-ink/50')}>
      <span className="truncate">{name}</span>
      {profile.adjusted && <span className="shrink-0 rounded-sm bg-warn/15 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-ink">adjusted</span>}
    </Tag>
  )
}

type AmountMode = 'current' | 'remaining' | 'custom'

/** Choose a curve profile for one WBS function: profile, window, amount → applyProfile over the function's lines. */
export function ProfileModal({ s, p, fn, lines, grid, months, profile, actual, onApply, onReset, onClose }: {
  s: AppState; p: Project; fn: { id: string; code: string; name: string }; lines: LineRef[]; grid: Spread; months: string[]
  profile?: FnProfile; actual: Record<string, Money>
  onApply: (prof: Pick<FnProfile, 'profileId' | 'start' | 'end'>, total: Money) => void; onReset?: () => void; onClose: () => void
}) {
  const ids = lines.map((l) => l.id)
  const current = sum(ids.map((id) => rowTotal(grid, id)))
  const bud = useMemo(() => budgetByLine(s, p.id).byLine, [s, p.id])
  const remaining = sum(ids.map((id) => Math.max(0, (bud[id] || 0) - (actual[id] || 0))))
  const used = months.filter((m) => ids.some((id) => grid[id]?.[m]))
  const profiles = allProfiles(s)
  const [pid, setPid] = useState(profile?.profileId ?? 'scurve')
  const [start, setStart] = useState(profile && months.includes(profile.start) ? profile.start : used[0] ?? months[0])
  const [end, setEnd] = useState(profile && months.includes(profile.end) ? profile.end : used[used.length - 1] ?? months[months.length - 1])
  const [mode, setMode] = useState<AmountMode>(current ? 'current' : 'remaining')
  const [custom, setCustom] = useState(current || remaining)
  useEffect(() => { if (end < start) setEnd(start) }, [start, end])
  const total = mode === 'current' ? current : mode === 'remaining' ? remaining : custom
  const window = start && end && end >= start ? monthRange(start, end) : []
  const prev = previewSpread(s, pid, window, total)
  const mx = Math.max(1, ...window.map((m) => prev[m] || 0))
  const shares = ids.map((id) => ({ id, v: current ? rowTotal(grid, id) : Math.max(0, (bud[id] || 0) - (actual[id] || 0)) }))
  const sh = sum(shares.map((x) => x.v))
  const sel = profiles.find((x) => x.id === pid)
  const sample = monthRange(months[0], months[Math.min(months.length - 1, 11)])
  return (
    <Modal open wide onClose={onClose} title={`Curve profile · ${fn.code} ${fn.name}`}
      footer={<>
        {onReset && profile && <ConfirmButton size="sm" confirmLabel="Re-apply profile" onConfirm={onReset}>Reset to {profileName(s, profile.profileId)}</ConfirmButton>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!window.length} onClick={() => onApply({ profileId: pid, start, end }, total)}>Apply to {lines.length} line{lines.length === 1 ? '' : 's'}</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="eyebrow">Profile</div>
          <div role="radiogroup" className="flex max-h-[360px] flex-col gap-1 overflow-y-auto pr-1">
            {profiles.map((x) => (
              <button key={x.id} role="radio" aria-checked={pid === x.id} onClick={() => setPid(x.id)}
                className={cx('flex items-center gap-2.5 rounded border px-2.5 py-1.5 text-left', pid === x.id ? 'border-ink bg-sunken' : 'border-line hover:border-ink/40')}>
                <Shape weights={shapeOf(s, x.id, sample)} w={56} h={20} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">{x.name}{x.custom && <Badge>Custom</Badge>}{profile?.profileId === x.id && <Badge tone="info">Applied</Badge>}</span>
                  <span className="block truncate text-[11.5px] text-muted" title={x.description}>{x.description}</span>
                </span>
              </button>
            ))}
          </div>
          <a href="#admin" onClick={() => lsSet('crosswalk:admin-tab', 'profiles')} className="text-[11.5px] text-link hover:underline">Manage custom profiles in Configuration</a>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start month"><Select value={start} onChange={(e) => setStart(e.target.value)} options={months.map((m) => ({ value: m, label: fmtMonth(m) }))} /></Field>
            <Field label="End month"><Select value={end} onChange={(e) => setEnd(e.target.value)} options={months.filter((m) => m >= start).map((m) => ({ value: m, label: fmtMonth(m) }))} /></Field>
          </div>
          <Field label="Amount to phase (function ETC)">
            <div className="flex flex-col gap-1.5">
              <SegButtons value={mode} onChange={setMode} options={[{ id: 'current', label: `Current ETC ${money(current)}` }, { id: 'remaining', label: `Remaining budget ${money(remaining)}` }, { id: 'custom', label: 'Other' }]} />
              {mode === 'custom' && <MoneyInput value={custom} onChange={setCustom} aria-label="Amount to phase" />}
            </div>
          </Field>
          <div>
            <div className="eyebrow mb-1">Preview · {sel?.name} · {window.length} months · peak {money(mx)}</div>
            <div className="flex h-20 items-end gap-px rounded border border-line bg-sunken/50 p-1" aria-hidden>
              {window.map((m) => <div key={m} title={`${fmtMonth(m)}: ${money(prev[m] || 0, 'full')}`} className={cx('flex-1 rounded-sm', prev[m] ? 'bg-link/70' : 'h-[2px] bg-bad/60')} style={prev[m] ? { height: `${((prev[m] || 0) / mx) * 100}%` } : undefined} />)}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-faint"><span>{start && shortMonth(start)}</span><span>{end && shortMonth(end)}</span></div>
          </div>
          <div>
            <div className="eyebrow mb-1">Split to lines {current ? 'by current ETC share' : 'by remaining budget'}</div>
            <table className="tbl [&_td]:py-1">
              <tbody>
                {lines.map((l) => { const x = shares.find((y) => y.id === l.id)!; const f = sh ? x.v / sh : 1 / lines.length; return <tr key={l.id}><td><span className="font-mono text-[11px] text-faint">{l.code}</span> {l.name}</td><td className="num text-muted">{(f * 100).toFixed(1)}%</td><td className="num">{money(total * f)}</td></tr> })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted">Applying replaces this function’s ETC in every month: the window gets the curve, months outside it are cleared. Cells stay editable — editing any of them afterwards marks the profile <b>adjusted</b>.</p>
        </div>
      </div>
    </Modal>
  )
}

/** Per-line tools: set ETC to remaining budget, phase an amount by a profile, or clear the line. */
export function LineTools({ s, line, row, months, budget, actual, onApply, onClose }: {
  s: AppState; line: LineRef; row: Record<string, Money>; months: string[]; budget: Money; actual: Money
  onApply: (next: Record<string, Money>, what: string) => void; onClose: () => void
}) {
  const etc = sum(Object.values(row))
  const remaining = Math.max(0, budget - actual)
  const used = months.filter((m) => row[m])
  const [amount, setAmount] = useState(etc || remaining)
  const [pid, setPid] = useState('even')
  const [from, setFrom] = useState(used[0] ?? months[0])
  const [to, setTo] = useState(used[used.length - 1] ?? months[months.length - 1])
  useEffect(() => { if (to < from) setTo(from) }, [from, to])
  const win = months.filter((m) => m >= from && m <= to)
  const prev = previewSpread(s, pid, win, amount)
  const mx = Math.max(1, ...win.map((m) => prev[m] || 0))
  const scale = () => {
    if (etc > 0) {
      const keys = Object.keys(row).filter((k) => row[k]).sort()
      const vals = keys.map((k) => row[k])
      const W = sum(vals)
      let acc = 0
      const out: Record<string, Money> = {}
      keys.forEach((k, i) => { const v = i === keys.length - 1 ? remaining - acc : Math.round((remaining * vals[i]) / W); out[k] = v; acc += v })
      return out
    }
    return previewSpread(s, 'even', months, remaining)
  }
  return (
    <Modal open onClose={onClose} title={`Line tools · ${line.code} ${line.name}`}
      footer={<>
        <ConfirmButton size="sm" confirmLabel="Clear line" onConfirm={() => onApply({}, 'cleared')}>Clear line</ConfirmButton>
        <Button size="sm" onClick={() => onApply(scale(), `ETC set to remaining budget ${money(remaining)}`)}>Set ETC to remaining ({money(remaining)})</Button>
        <Button size="sm" variant="primary" disabled={!win.length} onClick={() => onApply(prev, `phased ${money(amount)} ${profileName(s, pid)} ${shortMonth(from)}–${shortMonth(to)}`)}>Apply</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-[12px]">
          <div><div className="eyebrow">Budget</div><div className="tabular-nums">{money(budget, 'full')}</div></div>
          <div><div className="eyebrow">Actual</div><div className="tabular-nums">{money(actual, 'full')}</div></div>
          <div><div className="eyebrow">Current ETC</div><div className="tabular-nums">{money(etc, 'full')}</div></div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount to phase"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Profile"><Select value={pid} onChange={(e) => setPid(e.target.value)} options={allProfiles(s).map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label="Start month"><Select value={from} onChange={(e) => setFrom(e.target.value)} options={months.map((m) => ({ value: m, label: fmtMonth(m) }))} /></Field>
          <Field label="End month"><Select value={to} onChange={(e) => setTo(e.target.value)} options={months.filter((m) => m >= from).map((m) => ({ value: m, label: fmtMonth(m) }))} /></Field>
        </div>
        <div className="flex h-14 items-end gap-px rounded border border-line bg-sunken/50 p-1" aria-hidden>
          {win.map((m) => <div key={m} title={`${fmtMonth(m)}: ${money(prev[m] || 0, 'full')}`} className={cx('flex-1 rounded-sm', prev[m] ? 'bg-link/70' : 'h-[2px] bg-bad/60')} style={prev[m] ? { height: `${((prev[m] || 0) / mx) * 100}%` } : undefined} />)}
        </div>
        <p className="text-[12px] text-muted">Line tools change only this line and mark its function’s profile adjusted. To re-shape the whole function use its profile.</p>
      </div>
    </Modal>
  )
}
