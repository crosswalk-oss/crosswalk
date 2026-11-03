// Configuration → GIS & maps: basemap defaults and the utility's Esri layers (pipe network, facilities).
import { useState } from 'react'
import { mutate, useStore } from '@/core/store'
import type { GisSettings as Gis, MapLayer } from '@/core/types'
import { uid } from '@/core/util'
import { Badge, Button, Callout, ConfirmButton, Field, Input, Panel, Select, Table, TextArea, Checkbox } from '@/ui/kit'
import { BASEMAPS } from '@/ui/map/GisMap'
import { toast } from '@/ui/toast'

const KINDS: { value: MapLayer['kind']; label: string }[] = [
  { value: 'arcgis-feature', label: 'Esri feature layer (…/FeatureServer/0 or …/MapServer/0)' },
  { value: 'arcgis-mapimage', label: 'Esri map image service (…/MapServer)' },
  { value: 'arcgis-tile', label: 'Esri tiled map service (cached …/MapServer)' },
  { value: 'demo', label: 'Demo network (built in)' },
]

export default function GisSettings() {
  const gis = useStore((s) => s.settings.gis)
  const [draft, setDraft] = useState<Gis>(() => JSON.parse(JSON.stringify(gis)))
  const [editing, setEditing] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string }>>({})
  const dirty = JSON.stringify(draft) !== JSON.stringify(gis)
  const setLayer = (id: string, patch: Partial<MapLayer>) => setDraft((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const save = () => {
    const bad = draft.layers.find((l) => l.kind !== 'demo' && l.url && !/^https:\/\/.+\/(FeatureServer|MapServer)(\/\d+)?\/?$/i.test(l.url.trim()))
    if (bad) { toast(`"${bad.name}" URL should end in /FeatureServer/0 or /MapServer`, 'bad'); return }
    mutate((d) => { d.settings.gis = JSON.parse(JSON.stringify(draft)) }, { entity: 'gis', entityId: 'gis', action: 'update', summary: `GIS settings saved (${draft.layers.length} layers, basemap ${draft.basemap})` })
    toast('GIS settings saved')
  }
  const test = async (l: MapLayer) => {
    setTests((t) => ({ ...t, [l.id]: { ok: true, text: 'Testing…' } }))
    try {
      const u = `${l.url.replace(/\/$/, '')}?f=json${l.token ? `&token=${encodeURIComponent(l.token)}` : ''}`
      const r = await fetch(u)
      const j = await r.json()
      if (j.error) throw new Error(`${j.error.code ?? ''} ${j.error.message ?? 'Service error'}${j.error.code === 499 || j.error.code === 498 ? ' — a token is required or has expired' : ''}`)
      const what = j.geometryType ? `${j.name ?? 'Layer'} · ${String(j.geometryType).replace('esriGeometry', '')} · max ${j.maxRecordCount ?? '?'} per request` : j.layers ? `${j.mapName ?? j.serviceDescription ?? 'Service'} · ${j.layers.length} layers: ${j.layers.slice(0, 6).map((x: any) => `${x.id} ${x.name}`).join(', ')}` : 'Reachable'
      setTests((t) => ({ ...t, [l.id]: { ok: true, text: `Connected — ${what}` } }))
    } catch (e: any) {
      setTests((t) => ({ ...t, [l.id]: { ok: false, text: `${e?.message ?? 'Failed'}. Check the URL, network access from this browser, and CORS on your ArcGIS Server.` } }))
    }
  }
  const add = () => {
    const id = uid('lyr')
    setDraft((d) => ({ ...d, layers: [...d.layers, { id, name: 'New Esri layer', kind: 'arcgis-feature', url: '', color: '#2a7de1', visible: true }] }))
    setEditing(id)
  }
  const ed = draft.layers.find((l) => l.id === editing)
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="Connect your Esri GIS">
        Paste the REST URL of each layer you want under the projects — typically gas transmission and high-pressure distribution mains, valves and stations from ArcGIS Server or ArcGIS Online. Layers draw on the project map and the portfolio map, and project maps can query pipe within 300 m.
        Secured services need a token (kept in this browser only). A production deployment signs in with ArcGIS OAuth instead.
      </Callout>
 <Panel title="Outside map services">
        <Checkbox checked={!!draft.allowExternal} onChange={(v) => setDraft({ ...draft, allowExternal: v })} label="Allow calls to outside map services (Esri basemaps and layers, Google Maps links)" />
        <p className="mt-2 text-[12px] text-muted">Off for the public demo: the app then makes no network calls except to its own API. Turn on only for internal hosting with approved GIS services.</p>
      </Panel>
      <Panel title="Map defaults" actions={<><Button variant="primary" size="sm" disabled={!dirty} onClick={save}>Save GIS settings</Button>{dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(gis)))}>Discard</Button>}</>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Default basemap"><Select value={draft.basemap} onChange={(e) => setDraft({ ...draft, basemap: e.target.value as Gis['basemap'] })} options={BASEMAPS.map((b) => ({ value: b.id, label: b.label }))} /></Field>
          <Field label="Center latitude"><Input type="number" step="0.0001" value={draft.center[0]} onChange={(e) => setDraft({ ...draft, center: [Number(e.target.value), draft.center[1]] })} /></Field>
          <Field label="Center longitude"><Input type="number" step="0.0001" value={draft.center[1]} onChange={(e) => setDraft({ ...draft, center: [draft.center[0], Number(e.target.value)] })} /></Field>
          <Field label="Zoom (1–19)"><Input type="number" min={1} max={19} value={draft.zoom} onChange={(e) => setDraft({ ...draft, zoom: Number(e.target.value) })} /></Field>
        </div>
      </Panel>
      <Panel title="Map layers" subtitle="Drawn in this order; checked layers are on by default" pad={false} actions={<Button size="sm" onClick={add}>Add Esri layer</Button>}>
        <Table rowKey={(l) => l.id} rows={draft.layers} onRowClick={(l) => setEditing(l.id)} columns={[
          { key: 'c', header: '', width: 28, render: (l) => <span className="inline-block h-3 w-4 rounded-sm" style={{ background: l.color }} /> },
          { key: 'n', header: 'Layer', render: (l) => <div><div className="font-semibold">{l.name}</div>{l.note && <div className="text-[12px] text-muted">{l.note}</div>}</div> },
          { key: 'k', header: 'Type', render: (l) => <span className="text-[12px]">{KINDS.find((k) => k.value === l.kind)?.label.split(' (')[0]}</span> },
          { key: 'u', header: 'Service URL', render: (l) => l.kind === 'demo' ? <span className="text-muted">built in</span> : l.url ? <span className="break-all font-mono text-[11.5px]">{l.url}</span> : <Badge tone="warn">Not set</Badge> },
          { key: 'v', header: 'On by default', render: (l) => (l.visible ? 'Yes' : 'No') },
          { key: 't', header: 'Connection', render: (l) => tests[l.id] ? <span className={tests[l.id].ok ? 'text-good' : 'text-bad'}>{tests[l.id].text.slice(0, 90)}</span> : l.token ? <Badge>token set</Badge> : '—' },
        ]} />
      </Panel>
      {ed && (
        <Panel title={`Edit layer — ${ed.name}`} actions={<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Done</Button>}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name"><Input value={ed.name} onChange={(e) => setLayer(ed.id, { name: e.target.value })} /></Field>
            <Field label="Type"><Select value={ed.kind} onChange={(e) => setLayer(ed.id, { kind: e.target.value as MapLayer['kind'] })} options={KINDS} /></Field>
            {ed.kind !== 'demo' && <Field label="Service URL" className="md:col-span-2" hint="e.g. https://gis.yourutility.com/arcgis/rest/services/Gas/Transmission/FeatureServer/0"><Input className="font-mono text-[12px]" value={ed.url} onChange={(e) => setLayer(ed.id, { url: e.target.value.trim() })} /></Field>}
            <Field label="Line color"><div className="flex items-center gap-2"><input type="color" value={ed.color} onChange={(e) => setLayer(ed.id, { color: e.target.value })} className="h-8 w-12 rounded border border-line" /><Input value={ed.color} onChange={(e) => setLayer(ed.id, { color: e.target.value })} /></div></Field>
            {ed.kind === 'arcgis-feature' && <Field label="Filter (where clause)" hint='Optional, e.g. MAOP_PSIG > 60 AND STATUS = &apos;In Service&apos;'><Input className="font-mono text-[12px]" value={ed.where ?? ''} onChange={(e) => setLayer(ed.id, { where: e.target.value })} /></Field>}
            {ed.kind !== 'demo' && <Field label="Token (secured services)" hint="Stored only in this browser"><Input type="password" value={ed.token ?? ''} onChange={(e) => setLayer(ed.id, { token: e.target.value })} /></Field>}
            {ed.kind === 'arcgis-feature' && <Field label="Show from zoom level" hint="Hide dense layers when zoomed out (e.g. 12)"><Input type="number" min={1} max={19} value={ed.minZoom ?? ''} onChange={(e) => setLayer(ed.id, { minZoom: e.target.value ? Number(e.target.value) : undefined })} /></Field>}
            <Field label="Note" className="md:col-span-2"><TextArea className="min-h-[48px]" value={ed.note ?? ''} onChange={(e) => setLayer(ed.id, { note: e.target.value })} /></Field>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <Checkbox checked={ed.visible} onChange={(v) => setLayer(ed.id, { visible: v })} label="On by default" />
              {ed.kind !== 'demo' && <Button size="sm" disabled={!ed.url || !gis.allowExternal} onClick={() => test(ed)}>Test connection</Button>}
              {tests[ed.id] && <span className={tests[ed.id].ok ? 'text-[12.5px] text-good' : 'text-[12.5px] text-bad'}>{tests[ed.id].text}</span>}
              <span className="ml-auto"><ConfirmButton size="sm" variant="ghost" confirmLabel="Remove layer" onConfirm={() => { setDraft((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== ed.id) })); setEditing(null) }}>Remove</ConfirmButton></span>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-faint">Changes apply when you click Save GIS settings.</p>
        </Panel>
      )}
    </div>
  )
}
