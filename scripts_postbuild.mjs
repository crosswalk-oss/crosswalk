// Turn Vite's single-file build into artifact page content (no doctype/html/head/body wrappers).
import fs from 'node:fs'
const src = fs.readFileSync('dist/index.html', 'utf8')
const bodyOpen = src.lastIndexOf('<body>')
const bodyClose = src.lastIndexOf('</body>')
const headOpen = src.indexOf('<head>')
const headClose = src.lastIndexOf('</head>', bodyOpen)
const head = src.slice(headOpen + 6, headClose)
const body = src.slice(bodyOpen + 6, bodyClose)
let keep = head.replace(/<meta charset[^>]*>/i, '').replace(/<meta name="viewport"[^>]*>/i, '')
const title = keep.match(/<title>[^<]*<\/title>/)[0]
keep = keep.replace(title, '')
const out = `${title}\n${keep.trim()}\n${body.trim()}\n`
fs.mkdirSync('artifact', { recursive: true })
fs.writeFileSync('artifact/crosswalk.html', out)
console.log('artifact/crosswalk.html', (out.length / 1024).toFixed(0) + ' KB', 'src', (src.length / 1024).toFixed(0) + ' KB')
