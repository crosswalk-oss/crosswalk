// Download the basis of estimate: PDF by default, CSV (opens in Excel) or HTML from the menu.
import { useState } from 'react'
import type { Estimate, MonteCarloResult, Project } from '@/core/types'
import { getState, mutate } from '@/core/store'
import { htmlDoc, saveFile } from '@/core/download'
import { cx } from '@/core/util'
import { Button } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { boeCsv, boePdf } from './boe'
import { boeHtml } from './lib'

export type BoeFormat = 'pdf' | 'csv' | 'html'
const FORMATS: { id: BoeFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Paginated document for the record' },
  { id: 'csv', label: 'CSV for Excel', hint: 'Every line, markup and category in one sheet' },
  { id: 'html', label: 'Web page (HTML)', hint: 'Opens in a browser' },
]

/** Generate and offer the BOE file. `est` is the version to export (a draft's unsaved working copy is allowed). */
export async function downloadBoe(fmt: BoeFormat, est: Estimate, project: Project, mc?: MonteCarloResult) {
  const s = getState()
  const base = `${project.code}-BOE-v${est.version}-Class${est.cls}`
  let r: Awaited<ReturnType<typeof saveFile>>
  try {
    if (fmt === 'pdf') r = await saveFile(`${base}.pdf`, boePdf(s, est, { mc }), 'application/pdf')
    else if (fmt === 'csv') r = await saveFile(`${base}.csv`, boeCsv(s, est, { mc }), 'text/csv')
    else { const doc = boeHtml(s, est, { mc }); r = await saveFile(`${base}.html`, htmlDoc(doc.title, doc.body), 'text/html') }
  } catch {
    toast('Could not build the file', 'bad')
    return
  }
  if (r === 'saved') {
    mutate(() => {}, { entity: 'estimate', entityId: est.id, projectId: project.id, action: 'export', summary: `Exported basis of estimate for v${est.version} as ${fmt.toUpperCase()}` })
    toast(`Basis of estimate downloaded (${fmt.toUpperCase()})`)
  } else toast(r === 'declined' ? 'Download cancelled' : 'Downloads are not available here', 'info')
}

/** Split button: the main action downloads the PDF; the arrow offers CSV and HTML. */
export function BoeDownload({ get, project, mc, size = 'md', variant = 'secondary' }: { get: () => Estimate; project: Project; mc?: MonteCarloResult; size?: 'sm' | 'md'; variant?: 'secondary' | 'primary' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (f: BoeFormat) => { setOpen(false); setBusy(true); try { await downloadBoe(f, get(), project, mc) } finally { setBusy(false) } }
  return (
    <div className="relative inline-flex">
      <Button size={size} variant={variant} className="rounded-r-none" disabled={busy} onClick={() => run('pdf')}>{busy ? 'Preparing…' : 'Download BOE (PDF)'}</Button>
      <Button size={size} variant={variant} className="-ml-px rounded-l-none px-2" aria-label="More download formats" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span aria-hidden className="text-[10px]">▾</span>
      </Button>
      {open && <>
        <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {FORMATS.map((f) => (
            <button key={f.id} role="menuitem" className={cx('flex w-full flex-col items-start px-3 py-2 text-left hover:bg-sunken', f.id === 'pdf' && 'border-b border-line')} onClick={() => run(f.id)}>
              <span className="text-[13px] font-semibold">{f.label}{f.id === 'pdf' && <span className="ml-1.5 text-[11px] font-normal text-faint">default</span>}</span>
              <span className="text-[11.5px] text-muted">{f.hint}</span>
            </button>
          ))}
        </div>
      </>}
    </div>
  )
}
