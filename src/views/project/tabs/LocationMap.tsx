// Project location & map: coordinates, pipeline alignment, Esri pipe layers and proximity checks.
import { useMemo, useState } from 'react'
import { mutate, useStore } from '@/core/store'
import type { MapLayer } from '@/core/types'
import { distanceToLineFt, fmtLatLng, googleEarthUrl, googleMapsUrl, lengthFt, nearbyNetwork, parseCoordinates, parseGeoJSON, parseKML, projectPoint, projectsToGeoJSON, projectsToKML, type LatLng } from '@/core/engine/geo'
import { nowISO, num, uid, cx } from '@/core/util'
import { saveFile } from '@/core/download'
import { Badge, Button, Callout, Field, KV, Panel, SegButtons, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { BASEMAPS, GisMap, type Basemap, type LayerStatus } from '@/ui/map/GisMap'

type Mode = 'view' | 'point' | 'route'

export default function LocationMap({ projectId }: { projectId: string }) {
  const s = useStore()
  const p = s.projects.find((x) => x.id === projectId)!
  const gis = s.settings.gis
  const [basemap, setBasemap] = useState<Basemap>(gis.basemap)
  const [vis, setVis] = useState<Record<string, boolean>>(() => Object.fromEntries(gis.layers.map((l) => [l.id, l.visible])))
  const [status, setStatus] = useState<Record<string, LayerStatus>>({})
  const [blocked, setBlocked] = useState(false)
  const [mode, setMode] = useState<Mode>('view')
  const [draftRoute, setDraftRoute] = useState<LatLng[] | undefined>()
  const [draftPoint, setDraftPoint] = useState<LatLng | undefined>()
  const [paste, setPaste] = useState('')
  const [near, setNear] = useState<{ layer: string; rows: string[]; error?: string } | null>(null)
  const layers: MapLayer[] = gis.layers.map((l) => ({ ...l, visible: !!vis[l.id] }))
  const others = useMemo(() => s.projects.filter((x) => x.id !== p.id && projectPoint(x)), [s.projects, p.id])
  const pt = projectPoint(p)
  const route = p.location.route
  const routeLen = route?.length ? lengthFt(route) : 0
  const editing = mode !== 'view' || !!draftRoute || !!draftPoint
  const nearbyDemo = useMemo(() => nearbyNetwork(s, p, 1500), [s, p])

  const onMapClick = (ll: LatLng) => {
    if (mode === 'point') setDraftPoint(ll)
    if (mode === 'route') setDraftRoute((r) => [...(r ?? []), ll])
  }
  const start = (m: Mode) => {
    setMode(m)
    if (m === 'route') setDraftRoute([])
    if (m === 'point') setDraftPoint(pt)
  }
  const cancel = () => { setMode('view'); setDraftRoute(undefined); setDraftPoint(undefined) }

  const save = (next: { point?: LatLng; route?: LatLng[] | null; source: string }) => {
    const before = { pt: fmtLatLng(pt), route: route?.length ? `${route.length} vertices, ${num(routeLen)} ft` : 'none' }
    mutate((d) => {
      const q = d.projects.find((x) => x.id === p.id)!
      if (next.route !== undefined) q.location.route = next.route ?? undefined
      const r = next.route ?? (next.route === null ? undefined : q.location.route)
      const point = next.point ?? (next.route ? next.route[Math.floor(next.route.length / 2)] : undefined)
      if (point) { q.location.lat = point[0]; q.location.lng = point[1] }
      q.location.routeSource = next.source
      const after = { pt: fmtLatLng(point ?? (q.location.lat != null ? [q.location.lat, q.location.lng!] : undefined)), route: r?.length ? `${r.length} vertices, ${num(lengthFt(r))} ft` : 'none' }
      const changes = [
        ...(before.pt !== after.pt ? [{ key: 'coordinates', label: 'Coordinates (lat, lng)', from: before.pt, to: after.pt }] : []),
        ...(before.route !== after.route ? [{ key: 'route', label: 'Pipeline alignment', from: before.route, to: after.route }] : []),
      ]
      if (changes.length) d.infoRevisions.push({ id: uid('irev'), projectId: p.id, at: nowISO(), byId: d.currentUserId, note: `Location updated (${next.source})`, changes })
    }, { entity: 'project-location', entityId: p.id, projectId: p.id, action: 'update', summary: `Location updated (${next.source})` })
    toast('Location saved')
    cancel()
  }

  const applyPaste = () => {
    const c = parseCoordinates(paste)
    if (!c.length) { toast('No coordinates found. Use "lat, lng" per line or paste a Google Maps link.', 'bad'); return }
    if (c.length === 1) { setMode('point'); setDraftPoint(c[0]) } else { setMode('route'); setDraftRoute(c) }
    setPaste('')
  }
  const importFile = async (f: File) => {
    const text = await f.text()
    let g: { points: LatLng[]; lines: LatLng[][] }
    try { g = /\.kml$/i.test(f.name) ? parseKML(text) : parseGeoJSON(JSON.parse(text)) } catch { toast('Could not read that file. Use KML or GeoJSON.', 'bad'); return }
    if (g.lines.length) { setMode('route'); setDraftRoute(g.lines.sort((a, b) => b.length - a.length)[0]); toast(`Loaded alignment with ${g.lines[0].length} vertices — review and save`, 'info') }
    else if (g.points.length) { setMode('point'); setDraftPoint(g.points[0]); toast('Loaded point — review and save', 'info') }
    else toast('No points or lines in that file.', 'bad')
  }

  const queryUtility = async (l: MapLayer) => {
    if (!pt) return
    setNear({ layer: l.name, rows: [] })
    try {
      const L = (await import('leaflet')).default
      const esri = await import('esri-leaflet')
      const geom: LatLng[] = route?.length ? route : [pt]
      esri.query({ url: l.url, token: l.token || undefined }).nearby(L.latLng(geom[Math.floor(geom.length / 2)]), 300).run((err: any, fc: any) => {
        if (err) { setNear({ layer: l.name, rows: [], error: err.message || 'Query failed — the service may be unreachable from this view.' }); return }
        const rows = (fc?.features ?? []).slice(0, 25).map((f: any) => {
          const pr = f.properties ?? {}
          const name = pr.NAME ?? pr.Name ?? pr.LINE_NAME ?? pr.LineName ?? pr.Operator ?? pr.OPERATOR ?? pr.TYPEPIPE ?? `Feature ${pr.OBJECTID ?? pr.FID ?? ''}`
          let ft = ''
          if (f.geometry?.type === 'LineString') ft = ` — ${num(Math.round(distanceToLineFt(pt, f.geometry.coordinates.map((c: number[]) => [c[1], c[0]])).ft))} ft from site`
          return `${name}${ft}`
        })
        setNear({ layer: l.name, rows })
      })
    } catch (e: any) { setNear({ layer: l.name, rows: [], error: e?.message ?? 'Query failed' }) }
  }

  const exportGeo = async (kind: 'geojson' | 'kml') => {
    const r = kind === 'geojson'
      ? await saveFile(`${p.code}.geojson`, JSON.stringify(projectsToGeoJSON(s, [p]), null, 2), 'application/geo+json')
      : await saveFile(`${p.code}.kml`, projectsToKML([p], `${p.code} ${p.name}`), 'application/vnd.google-earth.kml+xml')
    if (r === 'saved') toast(`Exported ${p.code}.${kind}`)
  }

  const utilityLayers = gis.allowExternal ? gis.layers.filter((l) => l.kind === 'arcgis-feature' && l.url) : []

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {gis.allowExternal ? <SegButtons options={BASEMAPS.map((b) => ({ id: b.id, label: b.label }))} value={basemap} onChange={setBasemap} /> : <span className="text-[12px] text-muted">Outside map services are off (Configuration → GIS & maps). Project geometry and the demo network draw locally.</span>}
          <div className="flex flex-wrap gap-1.5">
            {gis.layers.map((l) => (
              <label key={l.id} className={cx('flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[12px]', vis[l.id] ? 'border-ink/40 bg-surface' : 'border-line text-muted')}>
                <input type="checkbox" checked={!!vis[l.id]} onChange={(e) => setVis({ ...vis, [l.id]: e.target.checked })} />
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: l.color }} />
                <span className="max-w-[220px] truncate">{l.name}</span>
                {status[l.id]?.state === 'error' && <Badge tone="bad">error</Badge>}
                {l.kind !== 'demo' && !l.url && <Badge>no URL</Badge>}
              </label>
            ))}
          </div>
        </div>
        {blocked && <Callout tone="warn" title="Basemap imagery is blocked in this view">This browser could not load the Esri tiles (offline, proxy or firewall blocking server.arcgisonline.com). Project geometry and the demo network still draw. Check network access to Esri, or switch the basemap to None.</Callout>}
        {Object.values(status).filter((x) => x.state === 'error').map((x) => <Callout key={x.id} tone="bad" title={`${gis.layers.find((l) => l.id === x.id)?.name}: layer did not load`}>{x.message} Check the URL and token in Configuration → GIS & maps.</Callout>)}
        <GisMap external={!!gis.allowExternal} projects={[p, ...others]} layers={layers} demoNetwork={gis.demoNetwork} basemap={basemap} center={pt ?? gis.center} zoom={gis.zoom} height={560} focusId={p.id} selectedId={p.id}
          mode={mode} draftRoute={draftRoute} draftPoint={draftPoint} onMapClick={onMapClick}
          onLayerStatus={(x) => setStatus((m) => ({ ...m, [x.id]: x }))} onBasemapBlocked={setBlocked}
          onProjectClick={(q) => { if (q.id !== p.id && mode === 'view') toast(`${q.code} ${q.name}`, 'info') }} />
        {mode !== 'view' && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-[13px]">
            <b>{mode === 'point' ? 'Click the map to place the project point.' : `Click the map to add alignment vertices (${draftRoute?.length ?? 0} so far${draftRoute && draftRoute.length > 1 ? `, ${num(lengthFt(draftRoute))} ft` : ''}).`}</b>
            <span className="ml-auto flex gap-2">
              {mode === 'route' && <Button size="sm" onClick={() => setDraftRoute((r) => (r ?? []).slice(0, -1))} disabled={!draftRoute?.length}>Undo vertex</Button>}
              {mode === 'route' && <Button size="sm" variant="primary" disabled={(draftRoute?.length ?? 0) < 2} onClick={() => save({ route: draftRoute!, source: 'Drawn on map' })}>Save alignment</Button>}
              {mode === 'point' && <Button size="sm" variant="primary" disabled={!draftPoint} onClick={() => save({ point: draftPoint!, source: 'Placed on map' })}>Save point</Button>}
              <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
            </span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Location" subtitle={p.location.routeSource ? `Source: ${p.location.routeSource}` : undefined}>
          <KV cols={1} items={[
            ['Coordinates (WGS84)', <span className="font-mono">{fmtLatLng(pt)}</span>],
            ['Alignment', route?.length ? `${route.length} vertices · ${num(routeLen)} ft (${(routeLen / 5280).toFixed(2)} mi)` : 'None — point only'],
            ...(route?.length && p.asset.lengthFt ? [['Versus asset length', `${num(p.asset.lengthFt)} ft in scope (${routeLen > p.asset.lengthFt ? '+' : ''}${Math.round(((routeLen - p.asset.lengthFt) / p.asset.lengthFt) * 100)}%)`] as [string, string]] : []),
            ['City / district', `${p.location.city} · ${p.location.district}`],
          ]} />
          {pt && (
            <div className="mt-3 flex flex-wrap gap-2">
              {gis.allowExternal && <a className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs font-semibold hover:bg-sunken" href={googleMapsUrl(pt)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>}
              {gis.allowExternal && <a className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs font-semibold hover:bg-sunken" href={googleEarthUrl(pt)} target="_blank" rel="noreferrer">Google Earth ↗</a>}
              <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(fmtLatLng(pt)); toast('Coordinates copied') } catch { toast(fmtLatLng(pt), 'info') } }}>Copy</Button>
            </div>
          )}
        </Panel>

        <Panel title="Edit geometry">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={mode === 'point' ? 'primary' : 'secondary'} onClick={() => start('point')}>Set point on map</Button>
              <Button size="sm" variant={mode === 'route' ? 'primary' : 'secondary'} onClick={() => start('route')}>Draw alignment</Button>
              {route?.length ? <Button size="sm" variant="ghost" className="text-bad" disabled={editing} onClick={() => save({ route: null, source: 'Alignment removed' })}>Remove alignment</Button> : null}
            </div>
            <Field label="Paste coordinates" hint='One "lat, lng" per line (2+ lines = alignment), or a Google Maps link'>
              <TextArea id="loc-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'35.42310, -119.87650\n35.42480, -119.86990'} className="min-h-[64px] font-mono text-[12px]" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={applyPaste} disabled={!paste.trim()}>Preview</Button>
              <label className="inline-flex h-7 cursor-pointer items-center rounded border border-line px-2.5 text-xs font-semibold hover:bg-sunken">
                Import KML / GeoJSON<input type="file" accept=".kml,.geojson,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" variant="ghost" onClick={() => exportGeo('geojson')}>Export GeoJSON</Button>
              <Button size="sm" variant="ghost" onClick={() => exportGeo('kml')}>Export KML</Button>
            </div>
          </div>
        </Panel>

        <Panel title="Pipe near this project" subtitle="Within 1,500 ft of the site or alignment">
          {vis['lyr-demo'] !== undefined && (
            nearbyDemo.length ? (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {nearbyDemo.map((n) => <li key={n.line.id} className="flex justify-between gap-2"><span><b>{n.line.name}</b> <span className="text-muted">{n.line.diameterIn}" · {n.line.maopPsig} psig</span></span><span className="tabular-nums text-muted">{n.ft === 0 ? 'on alignment' : `${num(n.ft)} ft`}</span></li>)}
              </ul>
            ) : <p className="text-[13px] text-muted">No demo-network pipe within 1,500 ft.</p>
          )}
          <p className="mt-1 text-[11px] text-faint">Demo network is fictional.</p>
          {utilityLayers.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              <div className="text-[12px] font-semibold text-muted">Query Esri layers within 300 m</div>
              <div className="flex flex-wrap gap-2">{utilityLayers.map((l) => <Button key={l.id} size="sm" onClick={() => queryUtility(l)}>{l.name}</Button>)}</div>
              {near && (
                <div className="text-[12.5px]">
                  <div className="font-semibold">{near.layer}</div>
                  {near.error ? <p className="text-bad">{near.error}</p> : near.rows.length ? <ul className="list-disc pl-4">{near.rows.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="text-muted">Searching… (or no features found)</p>}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
