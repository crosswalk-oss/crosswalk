// License check (AGENT_RULES rule 8): every installed package must carry a permissive license
// (MIT, Apache-2.0, BSD, ISC and close relatives). Exits non-zero and lists offenders otherwise.
// Usage: npm run licenses            (all installed packages, dev tools included)
import fs from 'node:fs'
import path from 'node:path'

const ALLOWED = ['MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC']
// Reviewed exceptions: build-time data, never shipped in the app bundle.
const EXCEPTIONS = { 'caniuse-lite': 'CC-BY-4.0 browser-support data read by autoprefixer at build time only' }
const ok = (expr) => {
  if (!expr) return false
  const e = String(expr).replace(/[()]/g, ' ')
  if (/\bOR\b/.test(e)) return e.split(/\bOR\b/).some((x) => ok(x.trim()))
  if (/\bAND\b/.test(e)) return e.split(/\bAND\b/).every((x) => ok(x.trim()))
  return ALLOWED.includes(e.trim())
}
const seen = new Map()
function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (name.startsWith('@')) { walk(p); continue }
    const pj = path.join(p, 'package.json')
    if (fs.existsSync(pj)) {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
      const lic = typeof j.license === 'object' ? j.license?.type : j.license ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type).join(' OR ') : undefined)
      seen.set(`${j.name}@${j.version}`, lic)
    }
    walk(path.join(p, 'node_modules'))
  }
}
walk('node_modules')
const bad = [...seen].filter(([n, l]) => !ok(l) && !EXCEPTIONS[n.slice(0, n.lastIndexOf('@'))])
for (const [n, why] of Object.entries(EXCEPTIONS)) console.log(`exception: ${n} — ${why}`)
const counts = {}
for (const [, l] of seen) counts[l ?? 'UNKNOWN'] = (counts[l ?? 'UNKNOWN'] || 0) + 1
console.log(`${seen.size} packages checked`)
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`).join('\n'))
if (bad.length) { console.error('\nNot allowed (rule 8):\n' + bad.map(([n, l]) => `  ${n}: ${l ?? 'no license field'}`).join('\n')); process.exit(1) }
console.log('\nAll licenses are permissive.')
