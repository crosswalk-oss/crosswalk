import { useEffect, useState } from 'react'

/** True when the viewport is narrower than `px` (phones / small tablets). */
export function useNarrow(px = 768): boolean {
  const q = `(max-width: ${px - 1}px)`
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)
  const [v, setV] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(q)
    const f = () => setV(m.matches)
    f()
    m.addEventListener?.('change', f)
    return () => m.removeEventListener?.('change', f)
  }, [q])
  return v
}
