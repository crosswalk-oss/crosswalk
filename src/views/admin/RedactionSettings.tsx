// Configuration → Redaction fields: which fields on each deliverable form are withheld from a redacted copy, and
// under which category. Starts from the defaults in engine/redaction.ts; every change here is one audited save.
import { useMemo, useState } from 'react'
import type { RedactionSettings, RedactionTag } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { FORM_FOR_DEF, FORM_TEMPLATES } from '@/core/engine/forms'
import { DEFAULT_REDACTION, REDACTION_TAGS, TAG_ORDER, everyFormRows, redactionRows } from '@/core/engine/redaction'
import { Badge, Button, Callout, Input, Panel, Select } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { SaveBar, useDraft } from '../estimating/admin/shared'

const OPTIONS = [{ value: 'none', label: 'Not redacted' }, ...TAG_ORDER.map((t) => ({ value: t, label: REDACTION_TAGS[t].label }))]
const fieldKeyOf = (ref: string) => ref.split('.').slice(1).join('.')
const defaultFor = (ref: string): RedactionTag | undefined => DEFAULT_REDACTION[ref] ?? DEFAULT_REDACTION[`*.${fieldKeyOf(ref)}`]

export default function RedactionSettingsTab() {
  const s = useStore()
  const saved: RedactionSettings = s.settings.redaction ?? { overrides: {} }
  const D = useDraft<RedactionSettings>(saved)
  const draftState = useMemo(() => ({ settings: { ...s.settings, redaction: D.draft } }), [s.settings, D.draft])
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<'all' | 'tagged'>('tagged')

  // The gate(s) each form is used at, so the list reads in lifecycle order
  const usedAt = useMemo(() => {
    const m: Record<string, { order: number; gates: string[] }> = {}
    for (const lt of s.templates) for (const st of lt.stages) for (const def of st.gate.deliverables) {
      const f = FORM_FOR_DEF[def.id]
      if (!f) continue
      m[f] ??= { order: st.index, gates: [] }
      m[f].order = Math.min(m[f].order, st.index)
      if (!m[f].gates.includes(st.gate.name)) m[f].gates.push(st.gate.name)
    }
    return m
  }, [s.templates])
  const forms = useMemo(() => [...FORM_TEMPLATES].sort((a, b) => (usedAt[a.id]?.order ?? 99) - (usedAt[b.id]?.order ?? 99)), [usedAt])

  const choose = (ref: string, value: string) => D.set((x) => {
    const def = defaultFor(ref)
    const overrides = { ...x.overrides }
    if ((value === 'none' && !def) || value === def) delete overrides[ref] // back to the default: no override to keep
    else overrides[ref] = value as RedactionTag | 'none'
    return { overrides }
  })
  const save = () => {
    const changed = new Set([...Object.keys(saved.overrides), ...Object.keys(D.draft.overrides)].filter((k) => saved.overrides[k] !== D.draft.overrides[k]))
    mutate((x) => { x.settings.redaction = D.draft }, { entity: 'redaction-settings', entityId: 'redaction', action: 'update', summary: `Redaction fields: ${changed.size} field${changed.size === 1 ? '' : 's'} changed` })
    D.commit()
    toast('Redaction fields saved')
  }

  const counts = Object.fromEntries(TAG_ORDER.map((t) => [t, 0])) as Record<RedactionTag, number>
  const perForm = forms.map((t) => {
    const rows = redactionRows(draftState, t)
    for (const r of rows) if (r.current) counts[r.current]++
    return { t, rows }
  })
  const q = query.trim().toLowerCase()
  const shared = everyFormRows(draftState)
  for (const r of shared) if (r.current) counts[r.current]++

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="One record, two copies">
        A field tagged here is withheld from the redacted copy of a deliverable and listed in that copy's redaction log. The full record is unchanged. The tags start generous so the obvious ones can be removed. Free-text fields are withheld whole or not at all, and attached files are not read, so a person still reviews a redacted copy before it leaves.
      </Callout>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TAG_ORDER.map((t) => (
          <div key={t} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold">{REDACTION_TAGS[t].label}</span><Badge tone="info">{counts[t]}</Badge></div>
            <p className="mt-1 text-[12px] text-muted">{REDACTION_TAGS[t].covers}</p>
          </div>
        ))}
      </div>
      <Panel pad={false} title="Fields by deliverable form" subtitle="In lifecycle order. Choose a category, or Not redacted."
        actions={<div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Find a field" placeholder="Find a field" className="w-44" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" variant={only === 'tagged' ? 'primary' : 'secondary'} onClick={() => setOnly(only === 'tagged' ? 'all' : 'tagged')}>{only === 'tagged' ? 'Showing redacted only' : 'Showing every field'}</Button>
        </div>}>
        <div className="divide-y divide-line">
          <details open>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px] hover:bg-sunken/50">
              <span className="font-semibold">Every record</span>
              <span className="text-[12px] text-muted">The project block and the team appear on every form. One choice here applies to all of them.</span>
              <span className="ml-auto text-[12px] text-muted">{shared.filter((r) => r.current).length} redacted of {shared.length}</span>
            </summary>
            <div className="overflow-x-auto px-4 pb-3">
              <table className="tbl w-full">
                <thead><tr><th>Section</th><th>Field</th><th className="w-64">In a redacted copy</th></tr></thead>
                <tbody>
                  {shared.map((r) => (
                    <tr key={r.ref}>
                      <td className="text-[12.5px] text-muted">{r.section}</td>
                      <td className="text-[12.5px]">{r.label}{!r.isDefault && <span className="ml-2 rounded bg-marker/20 px-1 text-[10px] font-semibold uppercase tracking-wide text-markerink">Changed</span>}</td>
                      <td><Select aria-label={`Every record: ${r.label}`} value={r.current ?? 'none'} onChange={(e) => choose(r.ref, e.target.value)} options={OPTIONS} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {perForm.map(({ t, rows }) => {
            const tagged = rows.filter((r) => r.current).length
            const shown = rows.filter((r) => (only === 'all' || r.current || !r.isDefault) && (!q || `${t.name} ${r.section} ${r.label}`.toLowerCase().includes(q)))
            if (!shown.length) return null
            return (
              <details key={t.id} open={!!q || tagged > 0}>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[13px] hover:bg-sunken/50">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-[12px] text-muted">{(usedAt[t.id]?.gates ?? []).join(' · ')}</span>
                  <span className="ml-auto text-[12px] text-muted">{tagged} redacted of {rows.length}</span>
                </summary>
                <div className="overflow-x-auto px-4 pb-3">
                  <table className="tbl w-full">
                    <thead><tr><th>Section</th><th>Field</th><th className="w-64">In a redacted copy</th></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.ref}>
                          <td className="text-[12.5px] text-muted">{r.section}</td>
                          <td className="text-[12.5px]">{r.label}{!r.isDefault && <span className="ml-2 rounded bg-marker/20 px-1 text-[10px] font-semibold uppercase tracking-wide text-markerink">Changed</span>}</td>
                          <td><Select aria-label={`${t.name}: ${r.label}`} value={r.current ?? 'none'} onChange={(e) => choose(r.ref, e.target.value)} options={OPTIONS} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
        </div>
        <SaveBar dirty={D.dirty} onSave={save} onDiscard={D.reset} note="Applies to redacted copies generated from now on. Full records are never changed." />
      </Panel>
    </div>
  )
}
