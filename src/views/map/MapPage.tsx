// Portfolio map (#map): every project on Esri basemaps with the utility's pipe layers.
import { useMemo, useState } from 'react'
import { useStore, personName } from '@/core/store'
import type { MapLayer, Project } from '@/core/types'
import { position } from '@/core/engine/position'
import { stageName } from '@/core/engine/gates'
import { fmtLatLng, googleMapsUrl, lengthFt, projectPoint, projectsToGeoJSON, projectsToKML } from '@/core/engine/geo'
import { projectHref } from '@/core/router'
import { money, num, cx } from '@/core/util'
import { saveFile } from '@/core/download'
import { Badge, Button, Callout, HealthDot, Input, PageHeader, Panel, SegButtons } from '@/ui/kit'
import { ProgramSelect, ProgramTag } from '../shared/pickers'
import { BASEMAPS, GisMap, type Basemap, type LayerStatus } from '@/ui/map/GisMap'
import { toast } from '@/ui/toast'

export default function MapPage() {
  const s = useStore()
  const gis = s.settings.gis
  const [basemap, setBasemap] = useState<Basemap>(gis.basemap)
  const [vis, setVis] = useState<Record<string, boolean>>(() => Object.fromEntries(gis.layers.map((l) => [l.id, l.visible])))
  const [status, setStatus] = useState<Record<string, LayerStatus>>({})
  const [blocked, setBlocked] = useState(false)
  const [program, setProgram] = useState('')
  const [phase, setPhase] = useState<'all' | 'active' | 'construction' | 'closed'>('active')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | undefined>()
  const [fitKey, setFitKey] = useState('0')
  const projects = useMemo(() => s.projects.filter((p) => projectPoint(p)).filter((p) => !program || p.programId === program)
    .filter((p) => phase === 'all' || (phase === 'closed' ? p.status === 'closed' : phase === 'construction' ? p.status === 'active' && /construct/i.test(stageName(s, p)) : p.status === 'active' || p.status === 'on-hold'))
    .filter((p) => !q || (p.code + ' ' + p.name + ' ' + p.location.city).toLowerCase().includes(q.toLowerCase())), [s, program, phase, q])
  const budgets = useMemo(() => Object.fromEntries(s.projects.map((p) => [p.id, position(s, p.id).currentBudget || position(s, p.id).eac])), [s])
  const maxB = Math.max(1, ...Object.values(budgets))
  const layers: MapLayer[] = gis.layers.map((l) => ({ ...l, visible: !!vis[l.id] }))
  const selected = s.projects.find((p) => p.id === sel)
  const exportAll = async (kind: 'geojson' | 'kml') => {
    const r = kind === 'geojson' ? await saveFile('crosswalk-projects.geojson', JSON.stringify(projectsToGeoJSON(s, projects), null, 2), 'application/geo+json') : await saveFile('mainline-projects.kml', projectsToKML(projects, `${s.settings.orgName} capital projects`), 'application/vnd.google-earth.kml+xml')
    if (r === 'saved') toast(`Exported ${projects.length} projects`)
  }
  return (
    <div>
      <PageHeader eyebrow="Portfolio" title="Map" subtitle="Project sites and pipeline alignments over Esri basemaps, with the utility's pipe network from GIS. Click a project for details."
        actions={<><Button size="sm" onClick={() => exportAll('geojson')}>Export GeoJSON</Button><Button size="sm" onClick={() => exportAll('kml')}>Export KML</Button><a href="#admin" className="text-[12px] text-link">GIS settings</a></>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-56"><ProgramSelect value={program} onChange={setProgram} /></div>
        <SegButtons options={[{ id: 'active', label: 'Active' }, { id: 'construction', label: 'In construction' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }]} value={phase} onChange={(v) => { setPhase(v); setFitKey(String(Math.random())) }} />
        <div className="w-60"><Input placeholder="Find project or city" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && projects[0]) setSel(projects[0].id) }} /></div>
        <span className="text-[12px] text-muted">{projects.length} projects</span>
      </div>
      {blocked && <div className="mb-3"><Callout tone="warn" title="Basemap imagery is blocked in this view">This browser could not load the Esri tiles (offline, proxy or firewall blocking server.arcgisonline.com). Projects and the demo network still draw. Check network access to Esri and your GIS server, or switch the basemap to None.</Callout></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-2">
          {gis.allowExternal ? <SegButtons options={BASEMAPS.map((b) => ({ id: b.id, label: b.label }))} value={basemap} onChange={setBasemap} /> : <span className="text-[12px] text-muted">Outside map services are off (Configuration → GIS & maps). Project geometry and the demo network draw locally.</span>}
          <GisMap external={!!gis.allowExternal} projects={projects} layers={layers} demoNetwork={gis.demoNetwork} basemap={basemap} center={gis.center} zoom={gis.zoom} height="min(72vh, 720px)"
            selectedId={sel} focusId={sel} fitAllKey={fitKey + program} sizeBy={(p) => Math.sqrt((budgets[p.id] || 0) / maxB)} onProjectClick={(p) => setSel(p.id)}
            onLayerStatus={(x) => setStatus((m) => ({ ...m, [x.id]: x }))} onBasemapBlocked={setBlocked} />
          <div className="flex flex-wrap gap-4 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-good" />On track</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-warn" />Watch</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-bad" />At risk</span>
            <span>Marker size = budget · thick lines = project alignments</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Layers" pad={false}>
            <ul className="divide-y divide-line">
              {gis.layers.map((l) => (
                <li key={l.id} className="flex items-start gap-2 px-4 py-2.5">
                  <input id={`lyr-${l.id}`} type="checkbox" className="mt-1" checked={!!vis[l.id]} onChange={(e) => setVis({ ...vis, [l.id]: e.target.checked })} />
                  <label htmlFor={`lyr-${l.id}`} className="min-w-0 flex-1 cursor-pointer">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="inline-block h-2 w-3 shrink-0 rounded-sm" style={{ background: l.color }} /><span className="truncate">{l.name}</span></div>
                    <div className="text-[11.5px] text-muted">{l.kind === 'demo' ? `${gis.demoNetwork.length} fictional lines` : l.url ? l.kind.replace('arcgis-', 'Esri ') : 'No URL set — add one in GIS settings'}</div>
                    {status[l.id]?.state === 'error' && vis[l.id] && <div className="mt-0.5 text-[11.5px] text-bad">{status[l.id].message}</div>}
                    {status[l.id]?.state === 'loading' && vis[l.id] && <div className="mt-0.5 text-[11.5px] text-faint">Loading…</div>}
                  </label>
                </li>
              ))}
            </ul>
          </Panel>
          {selected ? <SelectedCard p={selected} /> : (
            <Panel title="Projects on the map" pad={false}>
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {projects.map((p) => (
                  <li key={p.id}><button onClick={() => setSel(p.id)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-sunken"><HealthDot rag={Object.values(p.health).includes('red') ? 'red' : Object.values(p.health).includes('amber') ? 'amber' : 'green'} /><span className="shrink-0 whitespace-nowrap font-mono text-[11.5px] font-semibold">{p.code}</span><span className="min-w-0 truncate text-[12.5px]">{p.name}</span></button></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )

  function SelectedCard({ p }: { p: Project }) {
    const pos = position(s, p.id)
    const pt = projectPoint(p)
    return (
      <Panel title={<span className="flex items-center gap-2"><ProgramTag programId={p.programId} /><span className="font-mono text-[13px]">{p.code}</span></span>} actions={<button className="text-xs text-muted hover:text-ink" onClick={() => { setSel(undefined); setFitKey(String(Math.random())) }}>Close</button>}>
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="font-display text-[16px] font-semibold leading-snug">{p.name}</div>
          <div className="text-muted">{stageName(s, p)} · PM {personName(s, p.team.pm)}</div>
          <div className="flex flex-wrap gap-1.5">{(['scope', 'schedule', 'cost', 'risk', 'safety'] as const).map((k) => <HealthDot key={k} rag={p.health[k]} label={k[0].toUpperCase() + k.slice(1)} />)}</div>
          <div className="grid grid-cols-2 gap-2 tabular-nums">
            <div><div className="text-[11px] uppercase text-faint">Budget</div><b>{money(pos.currentBudget)}</b></div>
            <div><div className="text-[11px] uppercase text-faint">EAC</div><b className={cx(pos.eac > pos.currentBudget && pos.currentBudget ? 'text-bad' : '')}>{money(pos.eac)}</b></div>
          </div>
          <div className="text-[12px] text-muted"><span className="font-mono">{fmtLatLng(pt)}</span>{p.location.route?.length ? ` · ${num(lengthFt(p.location.route))} ft alignment` : ''}</div>
          <div className="text-[12px] text-muted">Line {p.asset.lineId}{p.asset.diameterIn ? ` · ${p.asset.diameterIn}"` : ''} · MAOP {p.asset.maopPsig} psig {p.location.hca && <Badge tone="warn">HCA</Badge>}</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <a href={projectHref(p.id, 'map')} className="inline-flex h-7 items-center rounded bg-link px-2.5 text-xs font-semibold text-surface">Open project map</a>
            <a href={projectHref(p.id)} className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs font-semibold">Project</a>
            {pt && gis.allowExternal && <a href={googleMapsUrl(pt)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs font-semibold">Google Maps ↗</a>}
          </div>
        </div>
      </Panel>
    )
  }
}
