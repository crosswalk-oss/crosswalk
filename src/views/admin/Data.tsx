// Export / import / reset of the full dataset, plus the demo note.
import { useState } from 'react'
import type { AppState } from '@/core/types'
import { mutate, strip, useStore, useSync } from '@/core/store'
import { SCHEMA_VERSION } from '@/core/seed'
import { saveFile } from '@/core/download'
import { fmtDate, num } from '@/core/util'
import { go } from '@/core/router'
import { Button, Callout, ConfirmButton, KV, Panel } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { FileButton } from './common'

const REQUIRED: (keyof AppState)[] = ['settings', 'people', 'programs', 'templates', 'projects', 'estimates', 'budgets', 'snapshots', 'workflows', 'workflowDefs', 'audit']

export function validateImport(raw: unknown): { ok: true; state: AppState } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The file is not a JSON object.' }
  const s = raw as Partial<AppState>
  if (s.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: `Schema version ${s.schemaVersion ?? 'missing'} does not match this release (v${SCHEMA_VERSION}). Export again from the same release.` }
  const missing = REQUIRED.filter((k) => !(k in s))
  if (missing.length) return { ok: false, error: `Missing sections: ${missing.join(', ')}.` }
  if (!Array.isArray(s.projects) || !Array.isArray(s.audit)) return { ok: false, error: 'Projects and audit must be lists.' }
  return { ok: true, state: s as AppState }
}

export default function DataTab() {
  const s = useStore()
  const reset = useStore((x) => x.reset)
  const sync = useSync()
  const shared = sync.mode === 'shared'
  const [err, setErr] = useState<string | null>(null)
  const counts: [string, number][] = [
    ['Projects', s.projects.length], ['Estimates', s.estimates.length], ['Budget versions', s.budgets.length], ['Snapshots', s.snapshots.length],
    ['Changes', s.changes.length], ['Risks', s.risks.length], ['Safety plans', s.safetyPlans.length], ['Workflow instances', s.workflows.length],
    ['Permits', s.permits.length], ['Records', s.records.length], ['Lessons', s.lessons.length], ['Audit entries', s.audit.length],
  ]
  const exportAll = async () => {
    const state = strip(useStore.getState())
    const r = await saveFile(`crosswalk-${s.settings.orgName.toLowerCase().replace(/\s+/g, '-')}-${s.settings.asOf}.json`, JSON.stringify(state, null, 1), 'application/json')
    if (r === 'saved') {
      mutate(() => {}, { entity: 'data', entityId: 'export', action: 'export', summary: `Exported full dataset (${num(s.projects.length)} projects, ${num(s.audit.length)} audit entries)` })
      toast('Export saved')
    } else toast(r === 'declined' ? 'Export cancelled' : 'Download is not available here', 'info')
  }
  const importFile = async (f: File) => {
    setErr(null)
    try {
      const parsed = JSON.parse(await f.text())
      const v = validateImport(parsed)
      if (!v.ok) { setErr(v.error); toast('Import rejected', 'bad'); return }
      const keys = Object.keys(v.state) as (keyof AppState)[]
      mutate((d) => { for (const k of keys) (d as any)[k] = (v.state as any)[k] }, { entity: 'data', entityId: 'import', action: 'import', summary: `Imported dataset from ${f.name} (${v.state.projects.length} projects)` })
      toast(`Imported ${v.state.projects.length} projects`)
    } catch {
      setErr('The file could not be read as JSON.')
      toast('Import failed', 'bad')
    }
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-4">
        <Panel title="Dataset" subtitle={`${s.settings.orgName} · schema v${s.schemaVersion} · demo clock ${fmtDate(s.settings.asOf)}`}>
          <KV cols={4} items={counts.map(([k, v]) => [k, <span className="font-display text-[17px] font-bold tabular-nums">{num(v)}</span>])} />
        </Panel>
        <Panel title="Export and import" subtitle="Move a configured tenant between environments, or keep a copy before a demo">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={exportAll}>Export full dataset (JSON)</Button>
              <span className="text-[12px] text-muted">Everything: configuration, projects, history, workflows and the audit log.</span>
            </div>
            {shared
              ? <div className="text-[12px] text-muted">Import is off on the shared public demo: it would replace everyone's data with an uploaded file.</div>
              : <div className="flex flex-wrap items-center gap-3">
                  <FileButton size="md" label="Import dataset…" accept="application/json,.json" onFile={importFile} />
                  <span className="text-[12px] text-muted">Replaces all data. The file must come from schema v{SCHEMA_VERSION}.</span>
                </div>}
            {err && <Callout tone="bad" title="Import rejected">{err}</Callout>}
          </div>
        </Panel>
        <Panel title="Reset demo" subtitle="Restore the original Arroyo Valley Gas dataset and history">
          <div className="flex flex-wrap items-center gap-3">
            {shared && !sync.canEdit ? <span className="text-[12px] font-semibold text-muted">Enter the edit passcode to reset the shared data.</span> : <ConfirmButton variant="danger" confirmLabel={shared ? 'Yes, reset for everyone' : 'Yes, reset all data'} onConfirm={() => { reset(); toast(shared ? 'Demo data reset for everyone' : 'Demo data reset'); go('#portfolio') }}>Reset demo data</ConfirmButton>}
            <span className="text-[12px] text-muted">{shared ? 'Starts the shared data over for everyone. Earlier edits stay in the database history.' : 'Discards every change made on this page, including configuration edits.'}</span>
          </div>
        </Panel>
      </div>
      <Panel title="About this demo">
        <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
          <p><b>Arroyo Valley Gas is fictional.</b> Every project, person, dollar figure, proceeding number, permit and record in Crosswalk is illustrative and generated for demonstration. No real utility, regulator filing or individual is represented.</p>
          <p>The dataset is replayed through the same engine the screens use: estimates were approved through workflows, gates decided, baselines snapshotted and changes routed, so every figure traces to a record and an audit entry.</p>
          <p>{shared ? 'Data is kept in a shared database: everyone with the link sees the same projects, and edits (with the passcode) are saved for everyone. The database keeps every change; nothing is overwritten or deleted.' : 'This copy is not connected to the shared database, so changes are not saved.'} Use the persona switcher in the top bar to act as a project manager, sponsor, estimator or contractor and see the same records from their side.</p>
          <p className="text-muted">AI features draft content for a person to accept. They never approve, sign or change a record on their own.</p>
        </div>
      </Panel>
    </div>
  )
}
