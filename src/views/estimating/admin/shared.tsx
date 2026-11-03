// Shared pieces for Estimating administration: a working copy with save/discard, the read-only notice,
// and the audited save into settings.estimating.
import { useEffect, useRef, useState } from 'react'
import type { AppState } from '@/core/types'
import { mutate } from '@/core/store'
import { Badge, Button } from '@/ui/kit'
import { toast } from '@/ui/toast'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Working copy of a slice of the store. Follows the store while nothing is pending. */
export function useDraft<T>(source: T): { draft: T; set: (fn: (d: T) => T) => void; dirty: boolean; reset: () => void; commit: () => void } {
  const [draft, setDraft] = useState<T>(() => clone(source))
  const [dirty, setDirty] = useState(false)
  const key = JSON.stringify(source)
  const last = useRef(key)
  useEffect(() => { if (key !== last.current) { last.current = key; if (!dirty) setDraft(clone(source)) } }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    draft,
    set: (fn) => { setDraft((d) => fn(clone(d))); setDirty(true) },
    dirty,
    reset: () => { setDraft(clone(source)); setDirty(false) },
    commit: () => setDirty(false),
  }
}

/** Save a section of the estimating tables with one audit entry. */
export function saveSection(section: string, summary: string, fn: (d: AppState) => void, msg = 'Saved') {
  mutate(fn, { entity: 'estimating-config', entityId: section, action: 'update', summary })
  toast(msg)
}

/** Footer bar for a section with pending changes. */
export function SaveBar({ dirty, onSave, onDiscard, disabled, note }: { dirty: boolean; onSave: () => void; onDiscard: () => void; disabled?: boolean; note?: React.ReactNode }) {
  if (!dirty) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-marker/10 px-4 py-2">
      <Badge tone="marker">Unsaved changes</Badge>
      {note && <span className="text-xs text-muted">{note}</span>}
      <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button><Button size="sm" variant="primary" disabled={disabled} onClick={onSave}>Save changes</Button></span>
    </div>
  )
}

/** Compact list of what changed between two flat records, for audit summaries. */
export function diffRecord(a: Record<string, unknown>, b: Record<string, unknown>, fmt: (v: unknown) => string = String): string[] {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))
  return keys.filter((k) => a[k] !== b[k]).map((k) => a[k] == null ? `added ${k} ${fmt(b[k])}` : b[k] == null ? `removed ${k}` : `${k} ${fmt(a[k])} → ${fmt(b[k])}`)
}

export const cellInp = 'h-7 px-1.5 py-0.5 text-[12px]'
