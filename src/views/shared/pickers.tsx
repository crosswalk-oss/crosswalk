// Shared pickers and small project-aware helpers.
import { useStore } from '@/core/store'
import type { RoleId } from '@/core/types'
import { Select } from '@/ui/kit'

export function PersonSelect({ value, onChange, role, id, includeEmpty }: { value?: string; onChange: (id: string) => void; role?: RoleId; id?: string; includeEmpty?: boolean }) {
  const people = useStore((s) => s.people)
  const list = role ? people.filter((p) => p.roles.includes(role)) : people
  return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={[...(includeEmpty ? [{ value: '', label: '— Select —' }] : []), ...list.map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))]} />
}

export function ProjectSelect({ value, onChange, id, includeAll }: { value?: string; onChange: (id: string) => void; id?: string; includeAll?: boolean }) {
  const projects = useStore((s) => s.projects)
  return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={[...(includeAll ? [{ value: '', label: 'All projects' }] : []), ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
}

export function ProgramSelect({ value, onChange, id, includeAll = true }: { value?: string; onChange: (id: string) => void; id?: string; includeAll?: boolean }) {
  const programs = useStore((s) => s.programs)
  return <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} options={[...(includeAll ? [{ value: '', label: 'All programs' }] : []), ...programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
}

/** Program code chip, e.g. PSE. */
export function ProgramTag({ programId }: { programId: string }) {
  const p = useStore((s) => s.programs.find((x) => x.id === programId))
  return <span title={p?.name} className="rounded-sm bg-steel px-1.5 py-px font-mono text-[10.5px] font-semibold tracking-wide text-steelink">{p?.code ?? '—'}</span>
}
