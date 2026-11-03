// Project geometry: coordinates, alignments, distances, and KML/GeoJSON import/export. No map library here.
import type { AppState, Project } from '../types'

export type LatLng = [number, number]

/** Demo utility footprint: the schematic map (x 0–1000, y 0–600) is laid over this box. */
export const DEMO_BOUNDS = { north: 36.25, south: 34.95, west: -121.0, east: -118.95 }
export function xyToLatLng(x: number, y: number): LatLng {
  const b = DEMO_BOUNDS
  return [+(b.north - (y / 600) * (b.north - b.south)).toFixed(6), +(b.west + (x / 1000) * (b.east - b.west)).toFixed(6)]
}

const R_FT = 20902231 // earth radius in feet
const rad = (d: number) => (d * Math.PI) / 180
export function distanceFt(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R_FT * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function lengthFt(route: LatLng[]): number {
  let t = 0
  for (let i = 1; i < route.length; i++) t += distanceFt(route[i - 1], route[i])
  return Math.round(t)
}
/** Move from a point by a distance (ft) on a bearing (degrees from north). */
export function offset(p: LatLng, distFt: number, bearingDeg: number): LatLng {
  const d = distFt / R_FT, br = rad(bearingDeg), la = rad(p[0]), lo = rad(p[1])
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br))
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2))
  return [+((la2 * 180) / Math.PI).toFixed(6), +((lo2 * 180) / Math.PI).toFixed(6)]
}

/** Shortest distance (ft) from a point to a polyline, with the nearest point. */
export function distanceToLineFt(p: LatLng, line: LatLng[]): { ft: number; at: LatLng } {
  let best = { ft: Infinity, at: line[0] ?? p }
  const k = Math.cos(rad(p[0]))
  const xy = (q: LatLng) => [q[1] * k, q[0]] as const
  const P = xy(p)
  for (let i = 1; i < line.length; i++) {
    const A = xy(line[i - 1]), B = xy(line[i])
    const dx = B[0] - A[0], dy = B[1] - A[1]
    const t = dx || dy ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy))) : 0
    const at: LatLng = [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])]
    const ft = distanceFt(p, at)
    if (ft < best.ft) best = { ft, at }
  }
  if (line.length === 1) best = { ft: distanceFt(p, line[0]), at: line[0] }
  return best
}

/** Minimum distance between two polylines (vertex-to-segment both ways; good enough at project scale). */
export function lineToLineFt(a: LatLng[], b: LatLng[]): number {
  let m = Infinity
  for (const p of a) m = Math.min(m, distanceToLineFt(p, b).ft)
  for (const p of b) m = Math.min(m, distanceToLineFt(p, a).ft)
  return m
}

export function projectPoint(p: Project): LatLng | undefined {
  if (p.location.lat != null && p.location.lng != null) return [p.location.lat, p.location.lng]
  const r = p.location.route
  if (r && r.length) return r[Math.floor(r.length / 2)]
  return undefined
}
export function projectBounds(projects: Project[]): [LatLng, LatLng] | undefined {
  const pts = projects.flatMap((p) => [...(p.location.route ?? []), ...(projectPoint(p) ? [projectPoint(p)!] : [])])
  if (!pts.length) return undefined
  return [[Math.min(...pts.map((x) => x[0])), Math.min(...pts.map((x) => x[1]))], [Math.max(...pts.map((x) => x[0])), Math.max(...pts.map((x) => x[1]))]]
}

export const googleMapsUrl = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p[0]},${p[1]}`
export const googleEarthUrl = (p: LatLng) => `https://earth.google.com/web/@${p[0]},${p[1]},300a,1500d,35y,0h,0t,0r`
export const fmtLatLng = (p?: LatLng) => (p ? `${p[0].toFixed(5)}, ${p[1].toFixed(5)}` : '—')

/**
 * Parse coordinates typed or pasted by a person. Accepts "lat, lng" per line, "lat lng", a Google Maps
 * URL (…/@34.05,-118.24,… or ?q=34.05,-118.24), or lng,lat pairs (detected when the first value is
 * outside ±90). Returns [] when nothing valid is found.
 */
export function parseCoordinates(text: string): LatLng[] {
  const out: LatLng[] = []
  const url = text.match(/[@=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)
  if (url && !text.includes('\n')) return [[+url[1], +url[2]]]
  for (const raw of text.split(/[\n;]+/)) {
    const nums = raw.match(/-?\d+(?:\.\d+)?/g)
    if (!nums || nums.length < 2) continue
    let a = +nums[0], b = +nums[1]
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a]
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) out.push([a, b])
  }
  return out
}

/** Read Points and LineStrings from a KML document (Google Earth export). */
export function parseKML(text: string): { points: LatLng[]; lines: LatLng[][] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const read = (el: Element) => (el.textContent ?? '').trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])).map((c) => [c[1], c[0]] as LatLng)
  const lines = Array.from(doc.getElementsByTagName('LineString')).map((ls) => read(ls.getElementsByTagName('coordinates')[0])).filter((l) => l.length > 1)
  const points = Array.from(doc.getElementsByTagName('Point')).map((pt) => read(pt.getElementsByTagName('coordinates')[0])[0]).filter(Boolean)
  return { points, lines }
}

/** Read Points and (Multi)LineStrings from GeoJSON (Esri / QGIS export). */
export function parseGeoJSON(obj: any): { points: LatLng[]; lines: LatLng[][] } {
  const points: LatLng[] = [], lines: LatLng[][] = []
  const geom = (g: any) => {
    if (!g) return
    if (g.type === 'Point') points.push([g.coordinates[1], g.coordinates[0]])
    if (g.type === 'LineString') lines.push(g.coordinates.map((c: number[]) => [c[1], c[0]]))
    if (g.type === 'MultiLineString') g.coordinates.forEach((l: number[][]) => lines.push(l.map((c) => [c[1], c[0]])))
    if (g.type === 'GeometryCollection') g.geometries.forEach(geom)
  }
  if (obj?.type === 'FeatureCollection') obj.features.forEach((f: any) => geom(f.geometry))
  else if (obj?.type === 'Feature') geom(obj.geometry)
  else geom(obj)
  return { points, lines }
}

export function projectsToGeoJSON(s: AppState, projects: Project[]) {
  return {
    type: 'FeatureCollection',
    features: projects.flatMap((p) => {
      const props = { code: p.code, name: p.name, program: s.programs.find((x) => x.id === p.programId)?.code, stage: p.stageIndex + 1, status: p.status, lineId: p.asset.lineId, diameterIn: p.asset.diameterIn, maopPsig: p.asset.maopPsig }
      const out: any[] = []
      const pt = projectPoint(p)
      if (pt) out.push({ type: 'Feature', properties: { ...props, geometry: 'site' }, geometry: { type: 'Point', coordinates: [pt[1], pt[0]] } })
      if (p.location.route?.length) out.push({ type: 'Feature', properties: { ...props, geometry: 'alignment', lengthFt: lengthFt(p.location.route) }, geometry: { type: 'LineString', coordinates: p.location.route.map((c) => [c[1], c[0]]) } })
      return out
    }),
  }
}

export function projectsToKML(projects: Project[], title: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const pm = projects.flatMap((p) => {
    const pt = projectPoint(p)
    const parts: string[] = []
    if (pt) parts.push(`<Placemark><name>${esc(p.code)}</name><description>${esc(p.name)}</description><Point><coordinates>${pt[1]},${pt[0]},0</coordinates></Point></Placemark>`)
    if (p.location.route?.length) parts.push(`<Placemark><name>${esc(p.code)} alignment</name><Style><LineStyle><color>ff00b0f0</color><width>4</width></LineStyle></Style><LineString><coordinates>${p.location.route.map((c) => `${c[1]},${c[0]},0`).join(' ')}</coordinates></LineString></Placemark>`)
    return parts
  })
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>${pm.join('')}</Document></kml>`
}

/** Demo network lines within `ft` of a project's geometry (proximity check for the demo layer). */
export function nearbyNetwork(s: AppState, p: Project, ft = 1500) {
  const geom: LatLng[] = p.location.route?.length ? p.location.route : projectPoint(p) ? [projectPoint(p)!] : []
  if (!geom.length) return []
  return s.settings.gis.demoNetwork
    .map((n) => ({ line: n, ft: Math.round(geom.length > 1 ? lineToLineFt(geom, n.coords) : distanceToLineFt(geom[0], n.coords).ft) }))
    .filter((x) => x.ft <= ft)
    .sort((a, b) => a.ft - b.ft)
}
