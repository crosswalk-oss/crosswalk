// Upload private materials (a video, slide images) to a running Crosswalk server. They go into its database
// and are returned only with the passcode. Keep the files themselves OUT of this repository.
//
//   EDIT_PASSCODE=... node scripts/upload-materials.mjs <server url> <manifest.json>
//   EDIT_PASSCODE=... node scripts/upload-materials.mjs <server url> --remove <name> [<name> ...]
//   EDIT_PASSCODE=... node scripts/upload-materials.mjs <server url> --list
//
// manifest.json is a list; `file` is relative to the manifest:
//   [{ "file": "overview.mp4", "name": "overview-video", "title": "Overview", "contentType": "video/mp4", "sort": 0,
//      "meta": { "duration": 230, "chapters": [{ "at": 0, "title": "Start" }] } },
//    { "file": "slide-01.png", "name": "deck/01", "title": "Deck title", "contentType": "image/png", "sort": 101 }]
// Images whose names share the part before "/" are shown as one deck, in `sort` order.
import fs from 'node:fs'
import path from 'node:path'

const [base, ...rest] = process.argv.slice(2)
const passcode = process.env.EDIT_PASSCODE
if (!base || !rest.length || !passcode) { console.error('usage: EDIT_PASSCODE=... node scripts/upload-materials.mjs <server url> <manifest.json> | --remove <name>... | --list'); process.exit(2) }
const CHUNK = 720_000 // bytes per chunk; base64 makes it about 960 KB on the wire
const api = async (method, p, body) => {
  const r = await fetch(new URL('api/' + p, base.endsWith('/') ? base : base + '/'), { method, headers: { 'content-type': 'application/json', 'x-crosswalk-passcode': passcode }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.json()
}

if (rest[0] === '--list') {
  for (const m of (await api('GET', 'materials')).materials) console.log(`${m.name}\t${m.contentType}\t${m.bytes} bytes\t${m.title}`)
} else if (rest[0] === '--remove') {
  for (const name of rest.slice(1)) console.log(`${name}: removed ${(await api('DELETE', 'materials?name=' + encodeURIComponent(name))).removed}`)
} else {
  const manifest = path.resolve(rest[0])
  for (const item of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
    const bytes = fs.readFileSync(path.resolve(path.dirname(manifest), item.file))
    const chunks = Math.ceil(bytes.length / CHUNK)
    const { id } = await api('POST', 'materials', { name: item.name, title: item.title ?? '', contentType: item.contentType, bytes: bytes.length, chunks, sort: item.sort ?? 0, meta: item.meta ?? {}, actor: 'upload-materials' })
    let complete = false
    for (let i = 0; i < chunks; i++) complete = (await api('POST', 'materials/chunk', { id, idx: i, data: bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64') })).complete
    console.log(`${item.name}: ${bytes.length} bytes in ${chunks} chunk(s)${complete ? '' : '  (NOT complete)'}`)
  }
}
