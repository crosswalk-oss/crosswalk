// Bundle the repo into plain-text files an AI assistant (e.g. Copilot) can read: one full file plus
// smaller parts by area. Run from the repo root:  node scripts/copilot-txt.mjs   → writes ./copilot/*.txt
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const MAX = 340_000 // characters per part (~85k tokens)
const all = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/^(Crosswalk\.html|package-lock\.json|copilot\/)/.test(f) && !/\.(png|jpe?g|ico|woff2?|mp4)$/.test(f))
const isTest = (f) => /\.test\./.test(f)
const area = (f) => (/\.md$/.test(f) || !f.includes('/') ? '0-docs-config' : f.startsWith('src/core') ? '1-core' : f.startsWith('src/ui') || f.startsWith('src/App') || f.startsWith('src/main') || f.startsWith('src/index') || f.startsWith('src/types') ? '2-shell-ui' : f.startsWith('src/views/') ? '3-' + f.split('/')[2] : '4-other')
const block = (f) => `===== FILE: ${f} =====\n${fs.readFileSync(f, 'utf8').trimEnd()}\n`
const header = (title, files, note = '') => [`CROSSWALK — ${title}`, 'Capital project delivery for gas utilities (prototype, fictional demo data).', "Each file starts with a line '===== FILE: <path> ====='." + (note ? ' ' + note : ''), '', 'FILES IN THIS PART:', ...files.map((f) => '  ' + f), '', ''].join('\n')

fs.rmSync('copilot', { recursive: true, force: true })
fs.mkdirSync('copilot')
const corePri = (f) => ['src/core/types.ts', 'src/core/store.ts', 'src/core/util.ts', 'src/core/router.ts'].indexOf(f) + 1 || (f.startsWith('src/core/engine/') ? 10 : f.startsWith('src/core/seed/') ? 30 : 20)
const src = all.filter((f) => !isTest(f)).sort((a, b) => area(a).localeCompare(area(b)) || corePri(a) - corePri(b) || a.localeCompare(b))

// 1) everything in one file (source only; tests in their own file)
fs.writeFileSync('copilot/crosswalk-full.txt', header('FULL SOURCE (tests excluded)', src) + src.map(block).join('\n'))
fs.writeFileSync('copilot/crosswalk-tests.txt', header('TESTS', all.filter(isTest)) + all.filter(isTest).map(block).join('\n'))

// 2) parts small enough to paste or attach one at a time, grouped by area; part 1 is the orientation part
const groups = []
let cur = { name: '', files: [], size: 0 }
for (const f of src) {
  const a = area(f).replace(/^\d-/, '')
  const size = fs.statSync(f).size + 40
  if (cur.files.length && (cur.size + size > MAX || (cur.name !== a && cur.size > MAX * 0.6))) { groups.push(cur); cur = { name: '', files: [], size: 0 } }
  if (!cur.name) cur.name = a
  else if (!cur.name.split(' + ').includes(a)) cur.name += ' + ' + a
  cur.files.push(f); cur.size += size
}
if (cur.files.length) groups.push(cur)
const index = ['CROSSWALK — HOW TO USE THESE FILES', '', 'crosswalk-full.txt is the whole source in one file. If your assistant cannot take a file that large,', 'give it part 01 first (docs, data model and engine), then only the part for the screen you are working on.', '', ...groups.map((g, i) => `part ${String(i + 1).padStart(2, '0')}  ${g.name.padEnd(48)} ${Math.round(g.size / 1024)} KB  (${g.files.length} files)`), '']
groups.forEach((g, i) => fs.writeFileSync(`copilot/crosswalk-part-${String(i + 1).padStart(2, '0')}.txt`, header(`PART ${i + 1} OF ${groups.length}: ${g.name}`, g.files, 'Part 01 has the docs, data model (src/core/types.ts) and engine the other parts rely on.') + g.files.map(block).join('\n')))
fs.writeFileSync('copilot/README.txt', index.join('\n'))
console.log(index.join('\n'))
