// Small helpers shared by the configuration, planning, audit, permits and records views (builder F).
import { prefs } from '@/core/data'
import React, { useEffect, useRef, useState } from 'react'
import type { AssetType, Condition, ConditionOp, Driver, Project, RoleId, StagePermission, WorkMethod } from '@/core/types'
import { useStore } from '@/core/store'
import { cx, describeCondition, evalCondition } from '@/core/util'
import { Button, Field, Input, Select } from '@/ui/kit'

/** Local editable copy of a value; `dirty` when it differs from the source. Resets when the source changes. */
export function useDraft<T>(source: T): [T, React.Dispatch<React.SetStateAction<T>>, boolean, () => void] {
  const key = JSON.stringify(source) ?? 'null'
  const [d, setD] = useState<T>(() => JSON.parse(key))
  useEffect(() => { setD(JSON.parse(key)) }, [key])
  return [d, setD, JSON.stringify(d) !== key, () => setD(JSON.parse(key))]
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Chip-style multi-select for short option lists. */
export function MultiCheck<T extends string>({ options, value, onChange, className }: { options: { id: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-1', className)}>
      {options.map((o) => {
        const on = value.includes(o.id)
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={cx('rounded border px-2 py-0.5 text-[12px] font-semibold', on ? 'border-link bg-link text-surface' : 'border-line bg-surface text-muted hover:border-ink/40 hover:text-ink')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function RoleSelect({ value, onChange, id, includeEmpty }: { value?: string; onChange: (r: RoleId) => void; id?: string; includeEmpty?: boolean }) {
  const roles = useStore((s) => s.roles)
  return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value as RoleId)} options={[...(includeEmpty ? [{ value: '', label: '— None —' }] : []), ...roles.map((r) => ({ value: r.id, label: r.name }))]} />
}

export const roleName = (roles: { id: string; name: string }[], id: string) => roles.find((r) => r.id === id)?.name ?? id

/** Button that opens a file picker and hands back the chosen file. */
export function FileButton({ label, onFile, accept, size = 'sm', variant = 'secondary', disabled }: { label: React.ReactNode; onFile: (f: File) => void; accept?: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'primary' | 'ghost'; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <Button size={size} variant={variant} disabled={disabled} onClick={() => ref.current?.click()}>{label}</Button>
    </>
  )
}

export const lsGet = <T,>(key: string, fallback: T): T => prefs.get(key, fallback)
export const lsSet = (key: string, v: unknown) => prefs.set(key, v)

// ───────────────────────────── Option lists
export const ASSET_TYPES: AssetType[] = ['transmission-pipeline', 'distribution-main', 'compressor-station', 'valve-site', 'storage-field', 'regulator-station']
export const WORK_METHODS: WorkMethod[] = ['replace-open-trench', 'replace-hdd', 'hydrotest', 'abandon', 'valve-automation', 'station-rebuild', 'compressor-replacement', 'inline-inspection']
export const DRIVERS: Driver[] = ['Safety / compliance', 'Reliability', 'Capacity', 'Customer / new business', 'Relocation', 'Environmental']
export const PERMISSIONS: { id: StagePermission; label: string }[] = [
  { id: 'long-lead-release', label: 'Long-lead release' },
  { id: 'po-over-threshold', label: 'POs over threshold' },
  { id: 'contract-award', label: 'Contract award' },
  { id: 'construction-ntp', label: 'Construction NTP' },
  { id: 'place-in-service', label: 'Place in service' },
]
export const humanizeId = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// ───────────────────────────── Condition editor (SG-03)
type FieldKind = 'bool' | 'enum' | 'number'
export const CONDITION_FIELDS: { path: string; label: string; kind: FieldKind; values?: string[] }[] = [
  { path: 'permitsNeeded.ceqa', label: 'CEQA review needed', kind: 'bool' },
  { path: 'permitsNeeded.encroachment', label: 'Encroachment permit needed', kind: 'bool' },
  { path: 'permitsNeeded.hydrotestDischarge', label: 'Hydrotest discharge needed', kind: 'bool' },
  { path: 'location.hca', label: 'In high-consequence area', kind: 'bool' },
  { path: 'location.dac', label: 'Disadvantaged community', kind: 'bool' },
  { path: 'asset.type', label: 'Asset type', kind: 'enum', values: ASSET_TYPES },
  { path: 'workMethod', label: 'Work method', kind: 'enum', values: WORK_METHODS },
  { path: 'sizeTier', label: 'Size tier', kind: 'enum', values: ['S', 'M', 'L'] },
  { path: 'location.terrain', label: 'Terrain', kind: 'enum', values: ['urban', 'suburban', 'rural'] },
  { path: 'asset.recordsStatus', label: 'Records status', kind: 'enum', values: ['complete', 'gaps', 'unknown'] },
  { path: 'driver', label: 'Driver', kind: 'enum', values: DRIVERS },
  { path: 'location.classLocation', label: 'Class location', kind: 'number' },
  { path: 'asset.diameterIn', label: 'Diameter (in)', kind: 'number' },
  { path: 'asset.maopPsig', label: 'MAOP (psig)', kind: 'number' },
]
const OPS: Record<FieldKind, { id: ConditionOp; label: string }[]> = {
  bool: [{ id: 'truthy', label: 'is yes' }, { id: 'falsy', label: 'is no' }],
  enum: [{ id: 'eq', label: 'is' }, { id: 'ne', label: 'is not' }, { id: 'in', label: 'is one of' }],
  number: [{ id: 'gte', label: '≥' }, { id: 'gt', label: '>' }, { id: 'lte', label: '≤' }, { id: 'lt', label: '<' }, { id: 'eq', label: '=' }],
}

export function ConditionEditor({ value, onChange, projects }: { value?: Condition; onChange: (c: Condition | undefined) => void; projects: Project[] }) {
  const on = !!value
  const f = CONDITION_FIELDS.find((x) => x.path === value?.field) ?? CONDITION_FIELDS[0]
  const setField = (path: string) => {
    const nf = CONDITION_FIELDS.find((x) => x.path === path)!
    onChange(nf.kind === 'bool' ? { field: path, op: 'truthy' } : nf.kind === 'enum' ? { field: path, op: 'eq', value: nf.values![0] } : { field: path, op: 'gte', value: 0 })
  }
  const hits = value ? projects.filter((p) => evalCondition(value, p)) : projects
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken/40 p-3">
      <label className="flex items-center gap-2 text-[13px] font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={on} onChange={(e) => (e.target.checked ? setField(CONDITION_FIELDS[0].path) : onChange(undefined))} />
        Required only when a project attribute matches
      </label>
      {on && value && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Project field"><Select value={value.field} onChange={(e) => setField(e.target.value)} options={CONDITION_FIELDS.map((x) => ({ value: x.path, label: `${x.label} (${x.path})` }))} /></Field>
          <Field label="Operator"><Select value={value.op} onChange={(e) => {
            const op = e.target.value as ConditionOp
            onChange({ ...value, op, value: op === 'in' ? (Array.isArray(value.value) ? value.value : [value.value].filter(Boolean)) : Array.isArray(value.value) ? value.value[0] : value.value })
          }} options={OPS[f.kind].map((o) => ({ value: o.id, label: o.label }))} /></Field>
          {f.kind === 'enum' && value.op !== 'in' && <Field label="Value"><Select value={String(value.value ?? '')} onChange={(e) => onChange({ ...value, value: e.target.value })} options={f.values!} /></Field>}
          {f.kind === 'number' && <Field label="Value"><Input type="number" value={String(value.value ?? 0)} onChange={(e) => onChange({ ...value, value: Number(e.target.value) })} /></Field>}
          {f.kind === 'enum' && value.op === 'in' && (
            <div className="sm:col-span-3"><MultiCheck options={f.values!.map((v) => ({ id: v, label: v }))} value={(value.value as string[]) ?? []} onChange={(v) => onChange({ ...value, value: v })} /></div>
          )}
        </div>
      )}
      <div className="text-[12px] text-muted">
        <span className="font-mono text-ink">{describeCondition(value)}</span>
        <span className="mx-1.5">·</span>
        Applies to <b className="text-ink">{hits.length}</b> of {projects.length} projects on this template
        {value && hits.length > 0 && <span className="text-faint"> ({hits.slice(0, 8).map((p) => p.code).join(', ')}{hits.length > 8 ? '…' : ''})</span>}
      </div>
    </div>
  )
}

/** Construction window milestones (standard or condensed template). */
export function constructionStart(p: Project): string | undefined {
  const m = p.milestones.find((x) => x.name === 'Construction start') ?? p.milestones.find((x) => x.name === 'Construction authorized')
  return m?.actual ?? m?.forecast
}
export function inServiceDate(p: Project): string | undefined {
  const m = p.milestones.find((x) => x.name === 'In service') ?? p.milestones.find((x) => x.name === 'In service & closed')
  return m?.actual ?? m?.forecast
}
