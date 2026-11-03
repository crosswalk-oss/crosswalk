// Interactive GIS map: Esri basemaps, the utility's Esri pipe layers, and project sites/alignments.
// Leaflet + Esri Leaflet are loaded on mount (browser only), so server-rendered tests never touch them.
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { GisSettings, MapLayer, Project, RAG } from '@/core/types'
import { projectPoint, type LatLng } from '@/core/engine/geo'

export type Basemap = GisSettings['basemap']
export const BASEMAPS: { id: Basemap; label: string; url?: string; attribution: string }[] = [
  { id: 'imagery', label: 'Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, Maxar, Earthstar Geographics' },
  { id: 'streets', label: 'Streets', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, HERE, Garmin' },
  { id: 'topo', label: 'Topographic', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri, USGS' },
  { id: 'gray', label: 'Light gray', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: 'Esri' },
  { id: 'none', label: 'None', attribution: '' },
]

const HEALTH: Record<RAG, string> = { green: '#1b8048', amber: '#d18a00', red: '#c62828' }
const worst = (p: Project): RAG => (Object.values(p.health).includes('red') ? 'red' : Object.values(p.health).includes('amber') ? 'amber' : 'green')

export interface LayerStatus { id: string; state: 'loading' | 'ok' | 'error'; message?: string; count?: number }

export interface GisMapProps {
  projects: Project[]
  layers: MapLayer[]
  demoNetwork: GisSettings['demoNetwork']
  basemap: Basemap
  center: LatLng
  zoom: number
  height?: number | string
  focusId?: string // fit to this project
  selectedId?: string
  sizeBy?: (p: Project) => number // 0–1 for marker radius
  onProjectClick?: (p: Project) => void
  mode?: 'view' | 'point' | 'route'
  draftRoute?: LatLng[] // route being drawn
  draftPoint?: LatLng
  onMapClick?: (ll: LatLng) => void
  onLayerStatus?: (st: LayerStatus) => void
  onBasemapBlocked?: (blocked: boolean) => void
  fitAllKey?: string // change to re-fit to all projects
  /** When false (default) no outside tiles or Esri layers are requested — only project geometry and the built-in demo network draw. */
  external?: boolean
}

export function GisMap(props: GisMapProps) {
  const el = useRef<HTMLDivElement>(null)
  const st = useRef<{ L?: any; esri?: any; map?: any; base?: any; ext: Map<string, any>; demo?: any; projects?: any; draft?: any; tileErrors: number; tileLoads: number }>({ ext: new Map(), tileErrors: 0, tileLoads: 0 })
  const [ready, setReady] = useState(false)
  const latest = useRef(props)
  latest.current = props

  // create map once
  useEffect(() => {
    let alive = true
    ;(async () => {
      const L = (await import('leaflet')).default
      const esri = await import('esri-leaflet')
      if (!alive || !el.current) return
      const map = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: false, doubleClickZoom: false }).setView(props.center, props.zoom)
      map.on('click', (e: any) => latest.current.onMapClick?.([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]))
      Object.assign(st.current, { L, esri, map })
      setReady(true)
    })()
    return () => { alive = false; st.current.map?.remove(); st.current.map = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // basemap
  useEffect(() => {
    const { L, map } = st.current
    if (!ready || !L || !map) return
    st.current.base?.remove()
    const bm = props.external ? BASEMAPS.find((b) => b.id === props.basemap) : undefined
    st.current.tileErrors = 0; st.current.tileLoads = 0
    if (bm?.url) {
      const t = L.tileLayer(bm.url, { maxZoom: 19, attribution: bm.attribution })
      t.on('tileerror', () => { st.current.tileErrors++; if (st.current.tileErrors === 3 && st.current.tileLoads === 0) latest.current.onBasemapBlocked?.(true) })
      t.on('tileload', () => { st.current.tileLoads++; if (st.current.tileLoads === 1) latest.current.onBasemapBlocked?.(false) })
      t.addTo(map)
      t.bringToBack()
      st.current.base = t
    } else { st.current.base = undefined; latest.current.onBasemapBlocked?.(false) }
  }, [ready, props.basemap, props.external])

  // external (Esri) layers + demo network
  const layerKey = JSON.stringify(props.layers.map((l) => [l.id, l.kind, l.url, l.visible, l.where, l.token, l.color]))
  useEffect(() => {
    const { L, esri, map } = st.current
    if (!ready || !L || !map) return
    for (const lyr of st.current.ext.values()) lyr.remove()
    st.current.ext.clear()
    st.current.demo?.remove(); st.current.demo = undefined
    for (const l of props.layers.filter((x) => x.visible && (props.external || x.kind === 'demo'))) {
      if (l.kind === 'demo') {
        const g = L.layerGroup()
        for (const n of props.demoNetwork) {
          L.polyline(n.coords, { color: '#1b1b1b', weight: 6, opacity: 0.35, interactive: false }).addTo(g)
          L.polyline(n.coords, { color: l.color, weight: 3, opacity: 0.95, dashArray: n.maopPsig >= 900 ? undefined : '8 5' })
            .bindTooltip(`<b>${n.name}</b><br>${n.diameterIn}" · MAOP ${n.maopPsig} psig<br><i>Fictional demo network</i>`, { sticky: true })
            .addTo(g)
        }
        g.addTo(map)
        st.current.demo = g
        latest.current.onLayerStatus?.({ id: l.id, state: 'ok', count: props.demoNetwork.length })
        continue
      }
      if (!l.url) continue
      latest.current.onLayerStatus?.({ id: l.id, state: 'loading' })
      try {
        let lyr: any
        const common = { url: l.url, token: l.token || undefined }
        if (l.kind === 'arcgis-feature') {
          lyr = esri.featureLayer({ ...common, where: l.where || '1=1', minZoom: l.minZoom, style: () => ({ color: l.color, weight: 2, opacity: 0.85 }), pointToLayer: (_g: any, ll: any) => L.circleMarker(ll, { radius: 5, color: l.color, weight: 2, fillOpacity: 0.6 }) })
          lyr.bindPopup((f: any) => {
            const props = f.feature?.properties ?? {}
            const rows = Object.entries(props).filter(([k, v]) => v !== null && v !== '' && !/^(shape|objectid|globalid|fid)/i.test(k)).slice(0, 12)
            return `<div style="font:12px/1.4 system-ui"><b>${l.name}</b><table>${rows.map(([k, v]) => `<tr><td style="color:#666;padding-right:8px">${k}</td><td>${String(v)}</td></tr>`).join('')}</table></div>`
          })
          lyr.on('load', () => { latest.current.onLayerStatus?.({ id: l.id, state: 'ok' }); st.current.projects?.bringToFront() })
        } else if (l.kind === 'arcgis-mapimage') {
          lyr = esri.dynamicMapLayer({ ...common, opacity: 0.85 })
          lyr.on('load', () => latest.current.onLayerStatus?.({ id: l.id, state: 'ok' }))
        } else {
          lyr = esri.tiledMapLayer({ ...common })
          lyr.on('load', () => latest.current.onLayerStatus?.({ id: l.id, state: 'ok' }))
        }
        lyr.on('requesterror', (e: any) => latest.current.onLayerStatus?.({ id: l.id, state: 'error', message: e?.message || 'Request failed — the service may be unreachable from this view, need a token, or block cross-origin requests.' }))
        lyr.addTo(map)
        st.current.ext.set(l.id, lyr)
      } catch (e: any) {
        latest.current.onLayerStatus?.({ id: l.id, state: 'error', message: e?.message ?? 'Could not add layer' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layerKey, props.demoNetwork, props.external])

  // projects
  const projKey = props.projects.map((p) => `${p.id}:${p.location.lat},${p.location.lng},${p.location.route?.length ?? 0}:${worst(p)}`).join('|') + '|' + props.selectedId
  useEffect(() => {
    const { L, map } = st.current
    if (!ready || !L || !map) return
    st.current.projects?.remove()
    const g = L.featureGroup()
    for (const p of props.projects) {
      const color = HEALTH[worst(p)]
      const sel = p.id === props.selectedId
      if (p.location.route?.length) {
        L.polyline(p.location.route, { color: '#ffffff', weight: sel ? 11 : 8, opacity: 0.9 }).addTo(g)
        L.polyline(p.location.route, { color, weight: sel ? 7 : 5, opacity: 1 })
          .bindTooltip(`<b>${p.code}</b> ${p.name}`, { sticky: true })
          .on('click', (e: any) => { L.DomEvent.stopPropagation(e); latest.current.onProjectClick?.(p) })
          .addTo(g)
      }
      const pt = projectPoint(p)
      if (pt) {
        const r = 6 + Math.round((props.sizeBy?.(p) ?? 0.3) * 10)
        L.circleMarker(pt, { radius: sel ? r + 3 : r, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 0.95 })
          .bindTooltip(`<b>${p.code}</b> ${p.name}`, { direction: 'top' })
          .on('click', (e: any) => { L.DomEvent.stopPropagation(e); latest.current.onProjectClick?.(p) })
          .addTo(g)
      }
    }
    g.addTo(map)
    st.current.projects = g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projKey])

  // fit
  useEffect(() => {
    const { L, map } = st.current
    if (!ready || !L || !map) return
    const focus = props.projects.find((p) => p.id === props.focusId)
    const pts: LatLng[] = focus ? [...(focus.location.route ?? []), ...(projectPoint(focus) ? [projectPoint(focus)!] : [])] : props.projects.flatMap((p) => (projectPoint(p) ? [projectPoint(p)!] : []))
    if (pts.length === 1) map.setView(pts[0], 15)
    else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.focusId, props.fitAllKey])

  // draft geometry while editing
  useEffect(() => {
    const { L, map } = st.current
    if (!ready || !L || !map) return
    st.current.draft?.remove()
    const g = L.layerGroup()
    if (props.draftRoute?.length) {
      L.polyline(props.draftRoute, { color: '#2a7de1', weight: 4, dashArray: '6 6' }).addTo(g)
      props.draftRoute.forEach((v, i) => L.circleMarker(v, { radius: 4, color: '#2a7de1', fillColor: '#fff', fillOpacity: 1, weight: 2 }).bindTooltip(`Vertex ${i + 1}`).addTo(g))
    }
    if (props.draftPoint) L.circleMarker(props.draftPoint, { radius: 9, color: '#2a7de1', fillColor: '#2a7de1', fillOpacity: 0.4, weight: 3 }).addTo(g)
    g.addTo(map)
    st.current.draft = g
    map.getContainer().style.cursor = props.mode && props.mode !== 'view' ? 'crosshair' : ''
  }, [ready, props.draftRoute, props.draftPoint, props.mode])

  return (
    <div className="relative isolate overflow-hidden rounded-md border border-line bg-sunken" style={{ height: props.height ?? 520 }}>
      <div ref={el} className="h-full w-full" style={{ background: 'rgb(var(--sunken))' }} />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">Loading map…</div>}
    </div>
  )
}
