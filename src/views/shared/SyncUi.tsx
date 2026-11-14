// Shared-data UI: the connection banner, the saved/saving indicator, the passcode prompt, and the
// public-demo guard that turns off file uploads (AGENT_RULES §8: no uploads of real files).
import { useEffect, useState } from 'react'
import { useSync } from '@/core/store'
import { appSync } from '@/core/syncClient'
import { cx } from '@/core/util'
import { BrandMark, Button, Input, Modal } from '@/ui/kit'
import { toast } from '@/ui/toast'

/** True when uploads and pasted files must be refused: the data is shared on a public server. */
export const useUploadsLocked = () => useSync().mode === 'shared'

export function Connecting() {
  return (
    <div className="flex h-full items-center justify-center bg-ground">
      <div className="text-center">
        <BrandMark size={40} className="mx-auto mb-3 text-ground" />
        <div className="text-[14px] font-semibold">Loading the shared data…</div>
        <div className="mt-1 text-[12px] text-muted">Crosswalk demo · fictional data</div>
      </div>
    </div>
  )
}

export function SyncBanner({ onUnlock }: { onUnlock: () => void }) {
  const s = useSync()
  if (s.mode === 'offline') {
    return (
      <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
        <b>Not connected to the shared database.</b> You can explore everything, but changes on this page are not saved anywhere.
      </div>
    )
  }
  if (s.mode !== 'shared' || s.canEdit) return null
  return (
    <div className={cx('mb-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]', s.unsaved ? 'border-warn/40 bg-warn/10' : 'border-line bg-surface')}>
      <span className="min-w-0 flex-1">
        <b>{s.unsaved ? 'Your changes on this page are not saved.' : 'View only.'}</b>{' '}
        {s.editable ? 'Everyone sees the same shared data. Enter the edit passcode to make changes that are saved for everyone.' : 'Editing is turned off on this server.'}
      </span>
      {s.unsaved && <Button size="sm" variant="ghost" onClick={() => { void appSync.current?.discardLocal(); toast('Showing the shared data again', 'info') }}>Discard my changes</Button>}
      {s.editable && <Button size="sm" variant="primary" onClick={onUnlock}>Enter passcode</Button>}
    </div>
  )
}

/** Top-bar status: Saved / Saving… / error, plus lock and unlock. */
export function SyncStatusChip({ onUnlock }: { onUnlock: () => void }) {
  const s = useSync()
  if (s.mode === 'offline') return <span className="hidden rounded border border-warn/50 px-1.5 py-0.5 text-[11px] font-semibold text-warn sm:inline" title="Changes are not saved">Not saved</span>
  if (s.mode !== 'shared') return null
  if (!s.canEdit) return s.editable ? <Button size="sm" variant="ghost" onClick={onUnlock} title="Enter the edit passcode">View only · Edit</Button> : null
  const label = s.error ? s.error : s.saving ? 'Saving…' : 'Saved'
  return (
    <span className="flex items-center gap-1">
      <span className={cx('hidden items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-semibold sm:inline-flex', s.error ? 'text-bad' : 'text-muted')} title={s.lastSavedAt ? `Last saved ${new Date(s.lastSavedAt).toLocaleTimeString()}` : 'All changes are saved to the shared database'}>
        <span className={cx('h-1.5 w-1.5 rounded-full', s.error ? 'bg-bad' : s.saving ? 'bg-warn' : 'bg-good')} />{label}
      </span>
      <button className="rounded px-1 text-[11px] text-faint hover:text-ink" title="Stop editing on this browser (forget the passcode)" onClick={() => { appSync.current?.lock(); toast('Editing locked on this browser', 'info') }}>Lock</button>
    </span>
  )
}

export function PasscodeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setCode(''); setErr(null) } }, [open])
  const submit = async () => {
    if (!code.trim() || !appSync.current) return
    setBusy(true); setErr(null)
    const ok = await appSync.current.unlock(code.trim())
    setBusy(false)
    if (ok) { toast('Editing on. Your changes are saved for everyone.'); onClose() } else setErr('That passcode is not right.')
  }
  return (
    <Modal open={open} onClose={onClose} title="Enter the edit passcode"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !code.trim()} onClick={() => void submit()}>{busy ? 'Checking…' : 'Start editing'}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">Edits are saved to the shared database and everyone with the link sees them. Any changes you made on this page in view-only mode are discarded.</p>
        <Input autoFocus type="password" autoComplete="current-password" aria-label="Edit passcode" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} />
        {err && <div className="text-[13px] font-semibold text-bad">{err}</div>}
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[12.5px]"><b>Fictional data only.</b> This is a public demo. Never enter real company project data, costs, people or files.</div>
      </form>
    </Modal>
  )
}

/** While the data is shared, refuse file pickers and dropped files anywhere in the app. */
export function useUploadGuard() {
  const locked = useUploadsLocked()
  useEffect(() => {
    if (!locked) return
    const msg = 'File uploads are off on the shared public demo (fictional data only).'
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const input = t?.closest?.('input[type="file"]') ?? (t instanceof HTMLLabelElement ? (t.control as HTMLElement | null) : t?.closest?.('label')?.querySelector?.('input[type="file"]'))
      if (input && (input as HTMLInputElement).type === 'file') { e.preventDefault(); e.stopPropagation(); toast(msg, 'info') }
    }
    const onDrop = (e: DragEvent) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); toast(msg, 'info') } }
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    document.addEventListener('click', onClick, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragover', onDragOver, true)
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('drop', onDrop, true); document.removeEventListener('dragover', onDragOver, true) }
  }, [locked])
}
