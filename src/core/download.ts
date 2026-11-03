// Offer a generated file to the viewer as a normal browser download.
export async function saveFile(filename: string, data: string | Blob, mime = 'text/plain'): Promise<'saved' | 'declined' | 'unavailable'> {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  return 'saved'
}

/** Rows → CSV text. */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

/** A standalone, printable HTML document (for SOPs, gate packets, evidence binders). */
export function htmlDoc(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  body{font-family:'Public Sans',system-ui,sans-serif;color:#141b24;max-width:900px;margin:40px auto;padding:0 24px;font-size:13px;line-height:1.5}
  h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;border-bottom:2px solid #141b24;padding-bottom:4px;margin-top:28px}h3{font-size:14px}
  table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d6dce3;padding:5px 8px;text-align:left;vertical-align:top}th{background:#e9ecf0;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  td.num{text-align:right;font-variant-numeric:tabular-nums}.meta{color:#4f5a69}.tag{display:inline-block;border:1px solid #999;border-radius:3px;padding:0 4px;font-size:11px}
  @media print{body{margin:0}}</style></head><body>${body}</body></html>`
}
