// Configuration: spread profiles — reusable time-phasing shapes a forecaster can apply to a WBS function.
// Built-in curves (even, S-curve, front, back, bell) plus custom ones: a weight shape resampled to any window,
// with optional black-out calendar months (e.g. a holiday paving moratorium).
import React, { useMemo, useRef, useState } from 'react'
import type { AppState, SpreadProfile } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { BUILT_IN_PROFILES, profileWeights } from '@/core/engine/lines'
import { addMonths, cx, monthKey, monthRange, sum, uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Modal, Panel, SegButtons, Select } from '@/ui/kit'
import { BarChart } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { Shape } from '../forecast/Profiles'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse "3, 8, 12" into weights (non-negative numbers). Returns null when any entry is not a number. */
export function parseWeights(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return null
  const out = parts.map(Number)
  return out.every((x) => Number.isFinite(x) && x >= 0) ? out : null
}

/** Weights a profile produces over `months`, as shares (sum 1), using a draft profile that may not be saved yet. */
export function previewShares(s: AppState, prof: SpreadProfile | string, months: string[]): number[] {
  const st = typeof prof === 'string' ? s : { ...s, settings: { ...s.settings, spreadProfiles: [...s.settings.spreadProfiles.filter((x) => x.id !== prof.id), prof] } }
  const w = profileWeights(st, typeof prof === 'string' ? prof : prof.id, months)
  const W = sum(w) || 1
  return w.map((x) => x / W)
}

export default function SpreadProfiles(_props: { projectId?: string }) {
  const s = useStore()
  const [edit, setEdit] = useState<SpreadProfile | null>(null)
  const start = monthKey(addMonths(s.settings.asOf, 1))
  const sample = monthRange(start, monthKey(addMonths(start + '-01', 11)))
  const usage = useMemo(() => {
    const out: Record<string, { versions: number; projects: Set<string>; adjusted: number }> = {}
    for (const f of s.forecasts) for (const pr of Object.values(f.profiles ?? {})) {
      const u = (out[pr.profileId] ||= { versions: 0, projects: new Set(), adjusted: 0 })
      u.versions++; u.projects.add(f.projectId); if (pr.adjusted) u.adjusted++
    }
    return out
  }, [s.forecasts])
  const save = (p: SpreadProfile, isNew: boolean) => {
    mutate((d) => {
      const i = d.settings.spreadProfiles.findIndex((x) => x.id === p.id)
      if (i >= 0) d.settings.spreadProfiles[i] = p
      else d.settings.spreadProfiles.push(p)
    }, { entity: 'spread-profile', entityId: p.id, action: isNew ? 'create' : 'update', summary: `${isNew ? 'Added' : 'Updated'} spread profile “${p.name}”: weights ${p.weights.join(', ')}${p.zeroMonths?.length ? `; no spend in ${p.zeroMonths.map((m) => MONTHS[m - 1]).join(', ')}` : ''}` })
    toast(isNew ? `Profile “${p.name}” added` : `Profile “${p.name}” saved`)
    setEdit(null)
  }
  const remove = (p: SpreadProfile) => {
    mutate((d) => { d.settings.spreadProfiles = d.settings.spreadProfiles.filter((x) => x.id !== p.id) }, { entity: 'spread-profile', entityId: p.id, action: 'delete', summary: `Deleted unused spread profile “${p.name}”` })
    toast(`Profile “${p.name}” deleted`)
  }
  const useText = (id: string) => { const u = usage[id]; return u ? `${u.versions} function${u.versions === 1 ? '' : 's'} on ${u.projects.size} project${u.projects.size === 1 ? '' : 's'}${u.adjusted ? ` · ${u.adjusted} adjusted` : ''}` : 'not used yet' }

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="How profiles work">
        On the forecast tab each WBS function gets a profile and a start/end month. Applying it phases the function’s ETC over its line items in that shape; every cell stays editable and a hand edit marks the profile <b>adjusted</b>. Custom weights are stretched or squeezed to the window’s length, and black-out months get no spend (their share moves to the other months).
      </Callout>
      <Panel title="Custom profiles" subtitle={`${s.settings.spreadProfiles.length} defined · shapes shown over a 12-month window from ${MONTHS[Number(start.slice(5)) - 1]} ${start.slice(0, 4)}`} pad={false}
        actions={<Button size="sm" variant="primary" icon={<Icon name="plus" className="h-3.5 w-3.5" />} onClick={() => setEdit({ id: uid('prof'), name: '', description: '', weights: [1, 2, 4, 6, 6, 6, 4, 2, 1] })}>New profile</Button>}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Shape</th><th>Profile</th><th>Weights</th><th>Black-out months</th><th>Used by</th><th /></tr></thead>
            <tbody>
              {s.settings.spreadProfiles.map((p) => (
                <tr key={p.id}>
                  <td><Shape weights={previewShares(s, p, sample)} w={96} h={28} labels={sample} /></td>
                  <td className="min-w-[200px]"><div className="font-semibold">{p.name}</div><div className="text-[12px] text-muted">{p.description}</div></td>
                  <td className="max-w-[220px] font-mono text-[11.5px] text-muted"><div className="truncate" title={p.weights.join(', ')}>{p.weights.join(', ')}</div><div className="text-faint">{p.weights.length} points</div></td>
                  <td className="whitespace-nowrap text-[12px]">{p.zeroMonths?.length ? p.zeroMonths.map((m) => MONTHS[m - 1]).join(', ') : <span className="text-faint">none</span>}</td>
                  <td className="whitespace-nowrap text-[12px] text-muted">{useText(p.id)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, id: uid('prof'), name: `${p.name} (copy)` })}>Copy</Button>
                    {usage[p.id] ? <span className="px-2 text-[11.5px] text-faint" title="Forecast versions reference this profile; edit it instead">in use</span> : <ConfirmButton size="sm" variant="ghost" confirmLabel="Delete profile" onConfirm={() => remove(p)}>Delete</ConfirmButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Built-in curves" subtitle="Always available; not editable. Copy one to start a custom profile." pad={false}>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr><th>Shape</th><th>Curve</th><th>Used by</th><th /></tr></thead>
            <tbody>
              {BUILT_IN_PROFILES.map((b) => (
                <tr key={b.id}>
                  <td><Shape weights={previewShares(s, b.id, sample)} w={96} h={28} labels={sample} /></td>
                  <td><div className="font-semibold">{b.name} <Badge>Built-in</Badge></div><div className="text-[12px] text-muted">{b.description}</div></td>
                  <td className="whitespace-nowrap text-[12px] text-muted">{useText(b.id)}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: uid('prof'), name: `${b.name} (custom)`, description: b.description, weights: previewShares(s, b.id, sample).map((x) => Math.round(x * 1000) / 10) })}>Copy to custom</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {edit && <ProfileEditor profile={edit} isNew={!s.settings.spreadProfiles.some((x) => x.id === edit.id)} used={!!usage[edit.id]} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  )
}

function ProfileEditor({ profile, isNew, used, onClose, onSave }: { profile: SpreadProfile; isNew: boolean; used: boolean; onClose: () => void; onSave: (p: SpreadProfile, isNew: boolean) => void }) {
  const s = useStore()
  const [p, setP] = useState<SpreadProfile>(profile)
  const [txt, setTxt] = useState(profile.weights.join(', '))
  const [n, setN] = useState('12')
  const [startM, setStartM] = useState(monthKey(addMonths(s.settings.asOf, 1)))
  const setWeights = (w: number[]) => { setP({ ...p, weights: w }); setTxt(w.join(', ')) }
  const onTxt = (t: string) => { setTxt(t); const w = parseWeights(t); if (w) setP({ ...p, weights: w }) }
  const valid = !!parseWeights(txt) && sum(p.weights) > 0
  const months = monthRange(startM, monthKey(addMonths(startM + '-01', Number(n) - 1)))
  const shares = valid ? previewShares(s, p, months) : months.map(() => 0)
  const starts = monthRange(monthKey(addMonths(s.settings.asOf, -2)), monthKey(addMonths(s.settings.asOf, 14)))
  const submit = () => {
    if (!p.name.trim()) { toast('Name the profile', 'bad'); return }
    if (!valid) { toast('Weights must be numbers ≥ 0 with at least one above zero', 'bad'); return }
    if (p.zeroMonths?.length === 12) { toast('At least one month must allow spend', 'bad'); return }
    onSave({ ...p, name: p.name.trim(), description: p.description.trim(), zeroMonths: p.zeroMonths?.length ? [...p.zeroMonths].sort((a, b) => a - b) : undefined }, isNew)
  }
  const toggleMonth = (m: number) => { const z = p.zeroMonths ?? []; setP({ ...p, zeroMonths: z.includes(m) ? z.filter((x) => x !== m) : [...z, m] }) }
  return (
    <Modal open wide onClose={onClose} title={isNew ? 'New spread profile' : `Edit “${profile.name}”`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={submit}>{isNew ? 'Add profile' : 'Save profile'}</Button></>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Pipe delivery in two lots" /></Field>
          <Field label="Description"><Input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} placeholder="When to use it" /></Field>
          <Field label="Weights" hint="Comma-separated relative amounts, first month to last. Any number of points; they are stretched to the window.">
            <Input className={cx('font-mono', !parseWeights(txt) && 'border-bad')} value={txt} onChange={(e) => onTxt(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="text-[12px] font-semibold text-muted">Shape — click or drag a bar to set it</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setWeights([...p.weights, p.weights[p.weights.length - 1] ?? 1])}>+ point</Button>
                <Button size="sm" variant="ghost" disabled={p.weights.length <= 1} onClick={() => setWeights(p.weights.slice(0, -1))}>− point</Button>
                <Button size="sm" variant="ghost" disabled={!valid} onClick={() => { const W = sum(p.weights); setWeights(p.weights.map((x) => Math.round((x / W) * 1000) / 10)) }} title="Scale the weights to add up to 100">To 100</Button>
              </span>
            </div>
            <BarEditor weights={p.weights} onChange={setWeights} />
          </div>
          <Field label="Black-out months" hint={p.zeroMonths?.length ? `No spend in ${p.zeroMonths.map((m) => MONTHS[m - 1]).join(', ')}; their share goes to the other months` : 'Calendar months with no spend, e.g. a holiday paving moratorium'}>
            <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
              {MONTHS.map((m, i) => { const on = p.zeroMonths?.includes(i + 1); return <button key={m} type="button" aria-pressed={!!on} onClick={() => toggleMonth(i + 1)} className={cx('rounded border py-1 text-[11.5px] font-semibold', on ? 'border-bad/50 bg-bad/10 text-bad' : 'border-line text-muted hover:border-ink/40 hover:text-ink')}>{m}</button> })}
            </div>
          </Field>
          {used && <Callout tone="info">Forecast versions already use this profile. Saving changes how it phases the next time someone applies it; spreads already applied are not changed.</Callout>}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow">Live preview</span>
            <span className="flex flex-wrap items-center gap-2">
              <Select aria-label="Preview start" className="h-8 w-auto py-1" value={startM} onChange={(e) => setStartM(e.target.value)} options={starts.map((m) => ({ value: m, label: `from ${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` }))} />
              <SegButtons value={n} onChange={setN} options={['6', '12', '18', '24'].map((x) => ({ id: x, label: `${x} mo` }))} />
            </span>
          </div>
          <div className="rounded-md border border-line p-2">
            <BarChart labels={months.map((m) => `${MONTHS[Number(m.slice(5)) - 1]} ’${m.slice(2, 4)}`)} series={[{ name: 'Share of the function’s ETC', values: shares.map((x) => Math.round(x * 1000) / 10) }]} height={220} format={(v) => `${v.toFixed(1)}%`} />
          </div>
          <div className="scroll-x">
            <table className="tbl [&_td]:py-0.5 [&_th]:py-1">
              <thead><tr><th>Month</th><th className="num">Share</th><th className="num">Of $1,000,000</th><th className="num">Cumulative</th></tr></thead>
              <tbody>{(() => { let acc = 0; return months.map((m, i) => { acc += shares[i]; return <tr key={m} className={cx(!shares[i] && 'text-faint')}><td>{MONTHS[Number(m.slice(5)) - 1]} {m.slice(0, 4)}{!shares[i] && p.zeroMonths?.includes(Number(m.slice(5))) ? ' · black-out' : ''}</td><td className="num">{(shares[i] * 100).toFixed(1)}%</td><td className="num">${Math.round(shares[i] * 1_000_000).toLocaleString('en-US')}</td><td className="num text-muted">{(acc * 100).toFixed(0)}%</td></tr> }) })()}</tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Drag-to-set bar editor for a weight shape. */
function BarEditor({ weights, onChange }: { weights: number[]; onChange: (w: number[]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const top = Math.max(1, ...weights) * 1.25
  const set = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const i = Math.max(0, Math.min(weights.length - 1, Math.floor(((e.clientX - r.left) / r.width) * weights.length)))
    const v = Math.max(0, Math.round((1 - (e.clientY - r.top) / r.height) * top * 10) / 10)
    if (weights[i] === v) return
    onChange(weights.map((x, j) => (j === i ? v : x)))
  }
  return (
    <div ref={ref} role="group" aria-label="Weight bars" className="flex h-28 cursor-crosshair touch-none select-none items-end gap-px rounded border border-line bg-sunken/50 p-1"
      onPointerDown={(e) => { setDrag(true); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); set(e) }} onPointerMove={(e) => drag && set(e)} onPointerUp={() => setDrag(false)} onPointerLeave={() => setDrag(false)}>
      {weights.map((w, i) => <div key={i} title={`Point ${i + 1}: ${w}`} className={cx('flex-1 rounded-sm', w > 0 ? 'bg-link/70' : 'h-[2px] bg-bad/60')} style={w > 0 ? { height: `${(w / top) * 100}%` } : undefined} />)}
    </div>
  )
}
