import { create } from 'zustand'
import { cx } from '@/core/util'

interface T { id: number; text: string; tone: 'good' | 'bad' | 'info' }
const useToasts = create<{ items: T[] }>(() => ({ items: [] }))
let n = 0
/** toast('Change request submitted') — short confirmation of what just happened. */
export function toast(text: string, tone: T['tone'] = 'good') {
  const id = ++n
  useToasts.setState((s) => ({ items: [...s.items, { id, text, tone }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== id) })), 3800)
}
export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col gap-2" style={{ bottom: 'max(16px, env(safe-area-inset-bottom))', right: 'max(16px, env(safe-area-inset-right))' }} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('fadein pointer-events-auto rounded-md border px-3 py-2 text-[13px] font-semibold shadow-lg', t.tone === 'good' ? 'border-good/40 bg-surface text-ink' : t.tone === 'bad' ? 'border-bad/50 bg-surface text-bad' : 'border-info/40 bg-surface text-ink')}>
          <span className={cx('mr-2 inline-block h-2 w-2 rounded-full', t.tone === 'good' ? 'bg-good' : t.tone === 'bad' ? 'bg-bad' : 'bg-info')} />{t.text}
        </div>
      ))}
    </div>
  )
}
