// Two small accessibility helpers that run whenever the page changes.
//
// Keyboard access for scrolling areas: a wide table inside `.scroll-x` can be scrolled with the arrow keys only if the
// area itself can take focus. This marks every such area that actually overflows as a focusable, named region,
// and unmarks it when it no longer overflows.
import { useEffect } from 'react'

const MARK = 'data-scroll-region'

function refresh() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.scroll-x'))) {
    const overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
    if (overflows && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0')
      el.setAttribute(MARK, '')
      if (!el.hasAttribute('role')) el.setAttribute('role', 'region')
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) el.setAttribute('aria-label', 'Scrollable table')
    } else if (!overflows && el.hasAttribute(MARK)) {
      for (const a of ['tabindex', MARK, 'role', 'aria-label']) el.removeAttribute(a)
    }
  }
}

/** A control inside a table cell with no label of its own is named from its column header and the row's first cell. */
function labelTableControls() {
  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('td input, td select, td textarea'))) {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.title || (el.labels && el.labels.length) || (el as HTMLInputElement).type === 'hidden') continue
    const td = el.closest('td'); const tr = td?.parentElement; const table = td?.closest('table')
    if (!td || !tr || !table) continue
    const col = Array.from(tr.children).indexOf(td)
    const head = table.querySelector('thead tr:last-child')?.children[col]?.textContent?.trim()
    const first = tr.children[0] !== td ? tr.children[0]?.textContent?.trim().slice(0, 60) : ''
    const name = [head, first].filter(Boolean).join(', ') || 'Value'
    el.setAttribute('aria-label', name)
  }
}

export function useScrollRegions() {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    let queued = false
    const run = () => { queued = false; refresh(); labelTableControls() }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(run) } }
    const mo = new MutationObserver(queue)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', queue)
    queue()
    return () => { mo.disconnect(); window.removeEventListener('resize', queue) }
  }, [])
}
