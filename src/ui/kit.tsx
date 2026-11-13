// Shared UI kit. Every view builds from these so the product reads as one system.
// Colors come only from tokens (bg-surface, text-muted, border-line, text-good …). Never hard-code hex.
import React, { useEffect, useRef, useState } from 'react'
import type { AaceClass, RAG } from '@/core/types'
import { cx, initials } from '@/core/util'

// ───────────────────────────── Buttons
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'marker'
export function Button({ variant = 'secondary', size = 'md', icon, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: React.ReactNode }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
  const sz = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'
  const v: Record<BtnVariant, string> = {
    primary: 'bg-link text-surface hover:bg-link/85',
    secondary: 'bg-surface text-ink border border-line hover:bg-sunken',
    ghost: 'text-muted hover:text-ink hover:bg-sunken',
    danger: 'bg-bad text-white hover:bg-bad/90',
    marker: 'bg-marker text-markerink hover:bg-marker/90',
  }
  return <button type="button" className={cx(base, sz, v[variant], className)} {...rest}>{icon}{rest.children}</button>
}

// ───────────────────────────── Badges & status
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'marker' | 'ink'
const toneCls: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  good: 'bg-good/10 text-good border-good/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  bad: 'bg-bad/10 text-bad border-bad/30',
  info: 'bg-info/10 text-info border-info/30',
  marker: 'bg-marker/20 text-ink border-marker/60',
  ink: 'bg-link text-surface border-link',
}
export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-semibold leading-4 whitespace-nowrap', toneCls[tone], className)}>{children}</span>
}

/** Map common statuses to tones so every module colors them the same way. */
export function statusTone(status: string): Tone {
  const s = status.toLowerCase()
  if (['approved', 'accepted', 'done', 'closed', 'issued', 'acquired', 'verified', 'complete', 'go', 'met', 'received', 'published', 'green', 'compliant', 'awarded', 'active-ok'].includes(s)) return 'good'
  if (['in-review', 'submitted', 'running', 'mitigating', 'applied', 'negotiating', 'ordered', 'shipped', 'go-with-conditions', 'attached', 'scheduled', 'amber', 'conditional', 'in-progress', 'draft-review'].includes(s)) return 'info'
  if (['required', 'returned', 'recycle', 'hold', 'on-hold', 'expired', 'missing', 'realized', 'overdue', 'red', 'rejected', 'cancelled', 'cancel', 'non-compliant', 'open-high'].includes(s)) return 'bad'
  if (['open', 'pending', 'identified', 'not-applied', 'not-started', 'draft', 'rfp', 'requested'].includes(s)) return 'neutral'
  return 'neutral'
}
export const humanize = (s: string) => s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? humanize(status)}</Badge>
}

export function HealthDot({ rag, label }: { rag: RAG; label?: string }) {
  const c = rag === 'green' ? 'bg-good' : rag === 'amber' ? 'bg-warn' : 'bg-bad'
  return <span className="inline-flex items-center gap-1.5" title={label ? `${label}: ${rag}` : rag}><span className={cx('inline-block h-2.5 w-2.5 rounded-full', c, rag === 'red' && 'ring-2 ring-bad/25')} />{label && <span className="text-xs text-muted">{label}</span>}</span>
}

/** The Crosswalk mark: a crossing seen head-on, three stripes receding inside a marker-amber circle. The stripes take
 *  the current text colour, so set it to the colour that sits behind the mark. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Crosswalk" className={cx('shrink-0', className)}>
      <circle cx="32" cy="32" r="30" fill="rgb(var(--brand))" />
      <g fill="currentColor">
        <polygon points="24,15 40,15 42,22 22,22" />
        <polygon points="19.5,27 44.5,27 47,35 17,35" />
        <polygon points="14.5,40 49.5,40 53,49 11,49" />
      </g>
    </svg>
  )
}

/** AACE estimate class chip: Class 5 is the widest range, Class 1 the tightest. */
export function ClassBadge({ cls, size = 'sm' }: { cls: AaceClass; size?: 'sm' | 'lg' }) {
  const tone = cls >= 5 ? 'border-faint text-muted' : cls === 4 ? 'border-info/60 text-info' : 'border-ink text-ink'
  return <span title={`AACE Class ${cls}`} className={cx('inline-flex items-center rounded-sm border-2 font-mono font-semibold tabular-nums', tone, size === 'lg' ? 'px-2 py-0.5 text-sm' : 'px-1 text-[11px] leading-4')}>C{cls}</span>
}

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 32% 42%)` }}>{initials(name)}</span>
}

export function Progress({ value, tone = 'ink', className }: { value: number; tone?: 'ink' | 'good' | 'warn' | 'bad' | 'marker'; className?: string }) {
  const c = { ink: 'bg-link', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', marker: 'bg-marker' }[tone]
  return <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><div className={cx('h-full rounded-full', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

/** Stage track: one segment per lifecycle stage, current stage marked. */
export function StageTrack({ stages, current, status }: { stages: string[]; current: number; status?: string }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Stage ${current + 1} of ${stages.length}: ${stages[current]}`}>
      {stages.map((s, i) => (
        <span key={s} title={s} className={cx('h-2 flex-1 min-w-[10px] first:rounded-l-sm last:rounded-r-sm', status === 'closed' || i < current ? 'bg-link/70' : i === current ? (status === 'on-hold' ? 'bg-warn' : 'bg-marker') : 'bg-line')} />
      ))}
    </div>
  )
}

// ───────────────────────────── Layout
export function PageHeader({ eyebrow, title, subtitle, actions, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
          <h1 className="font-display text-[26px] font-bold leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function Panel({ title, actions, children, className, pad = true, subtitle }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('min-w-0 rounded-md border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[15px] font-semibold">{title}</h2>}
            {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx(pad && 'p-4')}>{children}</div>
    </section>
  )
}

/** Big figure tile: use only where the number is the point. */
export function Stat({ label, value, sub, tone, onClick }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void }) {
  const t = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={cx('min-w-0 rounded-md border border-line bg-surface px-4 py-3 text-left', onClick && 'hover:border-ink/40')}>
      <div className="eyebrow truncate">{label}</div>
      <div className={cx('mt-1 font-display text-[24px] font-bold leading-none tabular-nums', t)}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </Tag>
  )
}

export function KV({ items, cols = 2 }: { items: [React.ReactNode, React.ReactNode][]; cols?: 1 | 2 | 3 | 4 }) {
  const g = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[cols]
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-2.5', g)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">{k}</dt>
          <dd className="mt-0.5 break-words text-[13px]">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-6 py-10 text-center">
      <div className="font-display text-[15px] font-semibold">{title}</div>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
      {action}
    </div>
  )
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good' | 'marker'; title?: React.ReactNode; children: React.ReactNode }) {
  const c = { info: 'border-info/40 bg-info/5', warn: 'border-warn/40 bg-warn/5', bad: 'border-bad/40 bg-bad/5', good: 'border-good/40 bg-good/5', marker: 'border-marker bg-marker/10' }[tone]
  return <div className={cx('rounded-md border px-3 py-2.5 text-[13px]', c)}>{title && <div className="mb-0.5 font-semibold">{title}</div>}{children}</div>
}

// ───────────────────────────── Tabs
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (t: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('scroll-x flex gap-1 border-b border-line', className)}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold', value === t.id ? 'border-marker text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-sunken px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ───────────────────────────── Table
export interface Column<T> { key: string; header: React.ReactNode; render: (row: T) => React.ReactNode; num?: boolean; width?: string | number; sort?: (row: T) => number | string; className?: string }
export function Table<T>({ rows, columns, onRowClick, rowKey, empty, maxHeight, dense }: { rows: T[]; columns: Column<T>[]; onRowClick?: (r: T) => void; rowKey: (r: T) => string; empty?: React.ReactNode; maxHeight?: number; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const col = sort && columns.find((c) => c.key === sort.key)
  const sorted = col?.sort ? rows.slice().sort((a, b) => { const x = col.sort!(a), y = col.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir }) : rows
  if (!rows.length && empty) return <>{empty}</>
  return (
    <div className="scroll-x" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className={cx('tbl', dense && '[&_td]:py-1')}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx(c.num && 'num', c.sort && 'cursor-pointer select-none hover:text-ink')} style={{ width: c.width }} onClick={() => c.sort && setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                {c.header}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={cx(onRowClick && 'clickable')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={cx(c.num && 'num', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────────── Form fields
export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  )
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx('inp', p.className)} />
export const TextArea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx('inp', p.className)} />
export function Select({ options, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[] }) {
  return (
    <select {...p} className={cx('inp', p.className)}>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}
export function Checkbox({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2 text-[13px]', disabled && 'cursor-not-allowed opacity-60')}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--ink))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
/** Money input that stores whole dollars but shows separators. */
export function MoneyInput({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [txt, setTxt] = useState(value ? value.toLocaleString('en-US') : '')
  useEffect(() => { setTxt(value ? value.toLocaleString('en-US') : '') }, [value])
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-faint">$</span>
      <input {...rest} inputMode="numeric" className={cx('inp pl-5 text-right tabular-nums', rest.className)} value={txt}
        onChange={(e) => setTxt(e.target.value)} onBlur={() => { const n = Number(txt.replace(/[^0-9.-]/g, '')) || 0; onChange(Math.round(n)); setTxt(n ? Math.round(n).toLocaleString('en-US') : '') }} />
    </div>
  )
}

// ───────────────────────────── Overlays
export function Modal({ open, onClose, title, children, footer, wide, xl }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; /** Near full-screen, for data-heavy forms. */ xl?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={cx('fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40', xl ? 'p-2 pt-[max(2vh,env(safe-area-inset-top))] sm:p-4 sm:pt-[max(2vh,env(safe-area-inset-top))]' : 'p-4 pt-[max(5vh,env(safe-area-inset-top))]')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('fadein w-full rounded-md border border-line bg-surface shadow-xl', xl ? 'max-w-[1440px]' : wide ? 'max-w-4xl' : 'max-w-xl')}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className={cx('overflow-y-auto px-4 py-4', xl ? (footer ? 'max-h-[calc(96vh-120px)]' : 'max-h-[calc(96vh-60px)]') : 'max-h-[70vh]')}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="fadein flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl" style={{ maxWidth: width, paddingTop: 'env(safe-area-inset-top)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>{footer}</div>}
      </aside>
    </div>
  )
}

/** Inline confirm (the artifact viewer blocks window.confirm). */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Confirm', variant = 'secondary', size = 'md' }: { onConfirm: () => void; children: React.ReactNode; confirmLabel?: string; variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const [ask, setAsk] = useState(false)
  if (!ask) return <Button variant={variant} size={size} onClick={() => setAsk(true)}>{children}</Button>
  return <span className="inline-flex gap-1"><Button variant="danger" size={size} onClick={() => { setAsk(false); onConfirm() }}>{confirmLabel}</Button><Button size={size} variant="ghost" onClick={() => setAsk(false)}>Cancel</Button></span>
}

export function SegButtons<T extends string>({ options, value, onChange }: { options: { id: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-sm px-2.5 py-1 text-xs font-semibold', value === o.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  )
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[12px]', className)}>{children}</span>
}

/** Labeled section inside a panel or page. */
export function Section({ title, children, actions }: { title: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><h3 className="eyebrow">{title}</h3>{actions}</div>
      {children}
    </div>
  )
}

/** AI-drafted content marker: suggested items stay labeled until a person accepts them. */
export function AiTag({ children = 'AI draft' }: { children?: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-sm border border-info/40 bg-info/10 px-1 text-[10px] font-bold uppercase tracking-wide text-info">✦ {children}</span>
}
