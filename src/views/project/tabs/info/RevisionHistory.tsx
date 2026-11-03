// Revision history of the Project Information record: who, when, why, and field-level from → to.
import { useState } from 'react'
import type { AppState } from '@/core/types'
import { personName } from '@/core/store'
import { fmtDateTime, cx } from '@/core/util'
import { Avatar, Badge, Button, Empty, Panel, Select } from '@/ui/kit'
import type { NumberedRevision } from './lib'

const LIMIT = 140

function Clip({ text, muted }: { text: string; muted?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!text) return <span className="italic text-faint">empty</span>
  const long = text.length > LIMIT
  return (
    <span className={cx('whitespace-pre-wrap break-words', muted && 'text-muted line-through decoration-faint/60')}>
      {long && !open ? text.slice(0, LIMIT).trimEnd() + '…' : text}
      {long && <button type="button" className="ml-1 text-[11px] font-semibold text-link no-underline hover:underline" onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>}
    </span>
  )
}

export function RevisionHistory({ s, revs, asOfRev, onViewRev }: { s: AppState; revs: NumberedRevision[]; asOfRev: number | null; onViewRev: (rev: number | null) => void }) {
  const [field, setField] = useState('')
  const keys = Array.from(new Map(revs.flatMap((r) => r.changes.map((c) => [c.key, c.label] as const))).entries()).sort((a, b) => a[1].localeCompare(b[1]))
  const shown = field ? revs.filter((r) => r.changes.some((c) => c.key === field)) : revs
  return (
    <Panel title="Revision history" subtitle={`${revs.length} revision${revs.length === 1 ? '' : 's'} · every change records who, when, why and the prior value`} pad={false}
      actions={keys.length > 0 && <Select aria-label="Filter by field" className="h-8 w-56 py-1 text-[12px]" value={field} onChange={(e) => setField(e.target.value)} options={[{ value: '', label: 'All fields' }, ...keys.map(([k, l]) => ({ value: k, label: l }))]} />}>
      {!shown.length ? (
        <div className="p-4"><Empty title={revs.length ? 'No revisions touch this field' : 'No revisions yet'}>{revs.length ? 'Choose another field or show all fields.' : 'The first saved edit becomes revision 1.'}</Empty></div>
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((r) => {
            const who = personName(s, r.byId)
            const changes = field ? r.changes.filter((c) => c.key === field) : r.changes
            return (
              <li key={r.id} className={cx('px-4 py-3', asOfRev === r.rev && 'bg-marker/10')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge tone="ink">Rev {r.rev}</Badge>
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold"><Avatar name={who} size={20} />{who}</span>
                  <span className="text-[12px] text-muted">{fmtDateTime(r.at)}</span>
                  <span className="ml-auto">
                    {asOfRev === r.rev
                      ? <Button size="sm" variant="ghost" onClick={() => onViewRev(null)}>Back to current</Button>
                      : <Button size="sm" variant="ghost" onClick={() => onViewRev(r.rev)}>View as of rev {r.rev}</Button>}
                  </span>
                </div>
                {r.note && <div className="mt-1 text-[13px]"><span className="text-muted">Reason: </span>{r.note}</div>}
                <dl className="mt-2 flex flex-col gap-1.5">
                  {changes.map((c, i) => (
                    <div key={i} className="grid grid-cols-1 gap-x-3 rounded border border-line/70 bg-sunken/40 px-2.5 py-1.5 text-[12.5px] sm:grid-cols-[180px_minmax(0,1fr)]">
                      <dt className="font-semibold">{c.label}</dt>
                      <dd className="flex min-w-0 flex-col gap-0.5">
                        <span><span className="mr-1 text-[11px] font-bold uppercase text-faint">From</span><Clip text={c.from} muted /></span>
                        <span><span className="mr-1 text-[11px] font-bold uppercase text-faint">To</span><Clip text={c.to} /></span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
