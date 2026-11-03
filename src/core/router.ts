// Hash routing. Artifact viewers pass only plain #name hashes (letters, digits, hyphens).
//   #portfolio · #projects · #inbox · #p-1042 · #p-1042-estimates · #wf-change-request
import { useEffect, useState } from 'react'

export type ProjectTab = 'overview' | 'info' | 'map' | 'forecast' | 'finance' | 'lifecycle' | 'estimates' | 'baselines' | 'cost' | 'changes' | 'risk' | 'safety' | 'permits' | 'records' | 'evidence' | 'activity'
export interface Route { view: string; id?: string; tab?: string }

export function parseHash(h: string): Route {
  const s = h.replace(/^#/, '')
  if (!s) return { view: 'portfolio' }
  const pm = s.match(/^p-(\d+)(?:-([a-z]+))?$/)
  if (pm) return { view: 'project', id: `prj-${pm[1]}`, tab: pm[2] ?? 'overview' }
  const wm = s.match(/^wf-([a-z0-9-]+)$/)
  if (wm) return { view: 'workflow', id: wm[1] }
  return { view: s }
}

/** Link to a project by id ('prj-1042') or code ('PRJ-1042'). */
export function projectHref(idOrCode: string, tab?: ProjectTab | string): string {
  const n = idOrCode.replace(/\D/g, '')
  return `#p-${n}${tab && tab !== 'overview' ? '-' + tab : ''}`
}
export const workflowHref = (key: string) => `#wf-${key}`

// The route lives in this module, so navigation works even where the host frame blocks or ignores
// hash changes. The URL hash is kept in sync when the host allows it (deep links, back button).
let current = (() => { try { return location.hash } catch { return '' } })()
const subs = new Set<(h: string) => void>()
function set(h: string) {
  if (h === current) { subs.forEach((f) => f(h)); return }
  current = h
  subs.forEach((f) => f(h))
}

export function go(hash: string) {
  const h = hash.startsWith('#') ? hash : '#' + hash
  set(h)
  try { if (location.hash !== h) history.pushState(null, '', h) } catch { /* host frame may refuse; in-app route still updates */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { try { set(location.hash) } catch { /* ignore */ } })
  window.addEventListener('popstate', () => { try { set(location.hash) } catch { /* ignore */ } })
  // Every in-app link (<a href="#…">) routes through go() instead of relying on the browser.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null
    if (!a || a.target === '_blank') return
    e.preventDefault()
    go(a.getAttribute('href') || '#')
  }, true)
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(current))
  useEffect(() => {
    const f = (h: string) => { setR(parseHash(h)); document.getElementById('main')?.scrollTo?.({ top: 0 }) }
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return r
}
