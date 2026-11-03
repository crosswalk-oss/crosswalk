// SAP transaction table and the drill-down drawer behind every actual on the forecast grid.
import { useMemo, useState } from 'react'
import type { ActualTxn, AppState } from '@/core/types'
import { useStore } from '@/core/store'
import { txnsFor } from '@/core/engine/sap'
import { lineById } from '@/core/engine/lines'
import { cx, fmtDate, fmtMonth, money, sum } from '@/core/util'
import { Badge, Button, Callout, Drawer, Empty } from '@/ui/kit'
import { howMapped, TXN_STATUS } from './lib'
import { txnShare } from '../forecast/lib'

const $ = (n: number) => money(n, 'full')

/** Dense SAP line-item table. With `share`, an extra column shows what each row contributes to that line / function. */
export function TxnTable({ s, txns, share, showProject, showStatus, limit = 200, onRow }: {
  s: AppState; txns: ActualTxn[]; share?: { lineId?: string; fnId?: string }; showProject?: boolean; showStatus?: boolean; limit?: number; onRow?: (t: ActualTxn) => void
}) {
  const [n, setN] = useState(limit)
  const rows = txns.slice(0, n)
  return (
    <div className="scroll-x">
      <table className="tbl [&_td]:py-1">
        <thead>
          <tr>
            <th>Doc no.</th><th>Posted</th>{showProject && <th>Project / WBS</th>}<th>Cost element</th><th>Vendor · text</th>
            <th className="num">Amount</th>{share && <th className="num" title="Amount, or the allocated share when a mapping rule allocates the row">To this {share.lineId ? 'line' : 'function'}</th>}
            {showStatus && <th>Status</th>}<th>Mapping</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const sh = share ? txnShare(s, t, share) : 0
            const line = lineById(s, t.lineId)
            return (
              <tr key={t.id} className={cx(onRow && 'clickable')} onClick={onRow ? () => onRow(t) : undefined}>
                <td className="whitespace-nowrap font-mono text-[11.5px]">{t.docNo || '—'}</td>
                <td className="whitespace-nowrap text-muted">{fmtDate(t.postingDate)}</td>
                {showProject && <td className="whitespace-nowrap"><span className="font-mono text-[11.5px]">{s.projects.find((p) => p.id === t.projectId)?.code ?? <span className="text-bad">none</span>}</span> <span className="font-mono text-[11px] text-faint">{t.sapWbs}</span></td>}
                <td className="whitespace-nowrap"><span className="font-mono text-[11.5px]">{t.costElement}</span><div className="max-w-[180px] truncate text-[11px] text-faint" title={t.costElementName}>{t.costElementName}</div></td>
                <td className="min-w-[160px] max-w-[280px]"><div className="truncate" title={t.vendor}>{t.vendor || <span className="text-faint">Internal</span>}</div><div className="truncate text-[11px] text-muted" title={t.text}>{t.text}</div></td>
                <td className={cx('num whitespace-nowrap', t.amount < 0 && 'text-bad')}>{$(t.amount)}{t.amount < 0 && <div className="text-[10.5px] text-faint">credit</div>}</td>
                {share && <td className="num whitespace-nowrap font-semibold">{$(sh)}{t.status === 'allocated' && t.amount ? <div className="text-[10.5px] font-normal text-faint">{((sh / t.amount) * 100).toFixed(1)}% share</div> : null}</td>}
                {showStatus && <td><Badge tone={TXN_STATUS[t.status].tone}>{TXN_STATUS[t.status].label}</Badge>{t.manual && <Badge tone="info" className="ml-1">Manual</Badge>}</td>}
                <td className="min-w-[180px] max-w-[300px] text-[11.5px] text-muted">
                  {t.status === 'mapped' && line && <div className="font-semibold text-ink">{line.code} {line.name}</div>}
                  {t.status === 'allocated' && <div className="font-semibold text-ink">Allocated over {Object.keys(t.allocation ?? {}).length || 'the period’s'} lines</div>}
                  <div className="line-clamp-2" title={howMapped(s, t)}>{howMapped(s, t)}</div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {txns.length > n && <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-muted">Showing {n} of {txns.length} rows<Button size="sm" variant="ghost" onClick={() => setN(n + 200)}>Show 200 more</Button></div>}
    </div>
  )
}

/** The SAP transactions behind one actual cell (a line or a function, one month or a collapsed year). */
export function ActualDrill({ projectId, lineId, fnId, months, cellAmount, onClose }: { projectId: string; lineId?: string; fnId?: string; months: string[]; cellAmount: number; onClose: () => void }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)
  const txns = useMemo(() => months.flatMap((m) => txnsFor(s, projectId, { lineId, fnId, period: m })).sort((a, b) => a.postingDate.localeCompare(b.postingDate)), [s, projectId, lineId, fnId, months])
  const share = { lineId, fnId: lineId ? undefined : fnId }
  const total = sum(txns.map((t) => txnShare(s, t, share)))
  const cps = s.costPeriods.filter((c) => c.projectId === projectId && months.includes(c.period))
  const summaryMonths = cps.filter((c) => c.source !== 'sap').map((c) => c.period).sort()
  const line = lineById(s, lineId)
  const fn = s.settings.wbsFunctions.find((f) => f.id === (fnId ?? line?.functionId))
  const what = line ? `${line.code} ${line.name}` : fn ? `${fn.code} ${fn.name}` : 'All lines'
  const when = months.length === 1 ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`
  const diff = Math.round(cellAmount - total)
  return (
    <Drawer open onClose={onClose} width={860} title={<span>Actuals · {what}</span>}
      footer={<><a href="#actuals" className="mr-auto self-center text-[12.5px] font-semibold text-link hover:underline">Open SAP actuals</a><Button onClick={onClose}>Close</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
          <Cell label="Project" value={p?.code ?? '—'} sub={p?.erpWbs} />
          <Cell label="Period" value={when} sub={`${months.length} month${months.length === 1 ? '' : 's'}`} />
          <Cell label="Actual on the grid" value={$(cellAmount)} />
          <Cell label="From SAP rows" value={$(total)} sub={`${txns.length} transaction${txns.length === 1 ? '' : 's'}`} />
        </div>
        {summaryMonths.length > 0 && (
          <Callout tone="info" title={`${summaryMonths.length === months.length ? 'This period predates' : 'Part of this period predates'} the SAP line-item feed`}>
            {summaryMonths.map(fmtMonth).join(', ')} {summaryMonths.length === 1 ? 'was' : 'were'} loaded as monthly summary actuals from the legacy ERP and split to lines by the recorded function split and budget share. There are no line items to show for {summaryMonths.length === 1 ? 'it' : 'them'}.
          </Callout>
        )}
        {diff !== 0 && summaryMonths.length === 0 && txns.length > 0 && <Callout tone="warn">The grid and the SAP rows differ by {$(diff)} — whole-dollar rounding of allocated rows across lines.</Callout>}
        {txns.length ? <TxnTable s={s} txns={txns} share={share} /> : summaryMonths.length === 0 && <Empty title="No SAP rows">Nothing was posted to {what} in {when}.</Empty>}
        <p className="text-[11.5px] text-faint">Rows come from posted SAP extracts. Each row reached this line through the SAP mapping table (cost element range, WBS suffix, text) or a manual resolution by project controls; loader settlements are allocated over the period’s direct lines pro-rata.</p>
      </div>
    </Drawer>
  )
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="min-w-0 bg-surface px-3 py-2"><div className="eyebrow truncate">{label}</div><div className="truncate font-semibold tabular-nums">{value}</div>{sub && <div className="truncate font-mono text-[11px] text-faint">{sub}</div>}</div>
}
