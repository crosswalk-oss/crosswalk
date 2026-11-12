// Minimal stroke icon set (24×24, currentColor).
const P: Record<string, string> = {
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  gate: 'M4 20V8l8-4 8 4v12M4 12h16M9 20v-5h6v5',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18h6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  phone: 'M8 2h8a1 1 0 011 1v18a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 006 0zM19 7l-3 7a4 4 0 006 0zM8 21h8',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  flow: 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v4a2 2 0 002 2h5M14 7h3a2 2 0 012 2v6',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.4 19l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 13.4H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 3.1V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1.3z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  play: 'M7 4l13 8-13 8z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  pin: 'M12 21s-7-6-7-11a7 7 0 1114 0c0 5-7 11-7 11zM12 8a2 2 0 100 4 2 2 0 000-4z',
}
export type IconName = keyof typeof P | string
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[name] ?? P.doc} /></svg>
}
