// Workflow designer (WF-01..09, WF-11): visual process editor with versioning, test mode and generated SOP.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, WfEdge, WfNode, WfNodeType, WorkflowDef } from '@/core/types'
import { getState, mutate, useStore } from '@/core/store'
import { saveFile } from '@/core/download'
import { cx, fmtDate, uid } from '@/core/util'
import { Badge, Button, Callout, Empty, Field, Input, Modal, PageHeader, Panel, Select, Tabs, TextArea, Mono } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { Canvas, TYPE_COLOR, canvasExtent, tok, type Sel } from './canvas'
import { AssigneeEditor, Checklist, ConditionEditor, FieldsEditor, ProcessSettings, type Preview } from './editors'
import { NODE_TYPES, SYSTEM_ACTIONS, blockingErrors, defaultTestProject, defaultValues, diffDefs, draftOf, isHuman, nodeTypeLabel, recordTypeLabel, validate, versionsOf, type Check } from './lib'
import { sopHtml } from './sop'
import { TestMode } from './TestMode'
import { SopView } from './SopView'
import { VersionsPanel } from './Versions'
import { useNarrow } from './hooks'

type Mode = 'design' | 'test' | 'sop' | 'versions'
type SideTab = 'selection' | 'process' | 'fields' | 'checks'

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export default function Designer({ id }: { projectId?: string; id?: string }) {
  const key = id ?? ''
  const s = useStore()
  const narrow = useNarrow(900)
  const versions = useMemo(() => versionsOf(s, key), [s.workflowDefs, key])
  const published = versions.find((d) => d.status === 'published')
  const storedDraft = draftOf(s, key)
  const [viewId, setViewId] = useState<string | undefined>(undefined)
  const baseDef = (viewId && versions.find((v) => v.id === viewId)) || storedDraft || published || versions[0]
  const editable = !!baseDef && (baseDef.status === 'draft' || (baseDef.id === published?.id && !storedDraft))
  const [mode, setMode] = useState<Mode>('design')
  useEffect(() => { if (narrow && mode === 'design') setMode('sop') }, [narrow, mode])

  // local working copy + undo history
  const [work, setWork] = useState<WorkflowDef | undefined>(() => (baseDef ? clone(baseDef) : undefined))
  const [dirty, setDirty] = useState(false)
  const undo = useRef<WorkflowDef[]>([])
  const redo = useRef<WorkflowDef[]>([])
  const baseKey = baseDef ? baseDef.id + ':' + baseDef.version + ':' + baseDef.status : ''
  useEffect(() => { if (baseDef) { setWork(clone(baseDef)); setDirty(false); undo.current = []; redo.current = [] } }, [baseKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [sel, setSel] = useState<Sel>(null)
  const [side, setSide] = useState<SideTab>('process')
  const [connect, setConnect] = useState(false)
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const fit = useCallback(() => {
    const el = viewport.current
    if (!el || !work) return
    const { w } = canvasExtent(work)
    setZoom(Math.max(0.5, Math.min(1, +((el.clientWidth - 8) / w).toFixed(2))))
  }, [work])
  const fitted = useRef('')
  useEffect(() => { if (mode === 'design' && work && fitted.current !== work.key) { fitted.current = work.key; requestAnimationFrame(fit) } }, [mode, work, fit])
  const [publishOpen, setPublishOpen] = useState(false)
  const [preview, setPreview] = useState<Preview>(() => ({ projectId: defaultTestProject(s), requesterId: s.currentUserId, data: baseDef ? defaultValues(baseDef) : {} }))
  useEffect(() => { if (baseDef) setPreview((p) => ({ ...p, data: { ...defaultValues(baseDef), ...p.data } })) }, [baseDef?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((fn: (d: WorkflowDef) => void, opts: { record?: boolean } = {}) => {
    setWork((w) => {
      if (!w) return w
      if (opts.record !== false) { undo.current.push(clone(w)); if (undo.current.length > 80) undo.current.shift(); redo.current = [] }
      const n = clone(w)
      fn(n)
      return n
    })
    setDirty(true)
  }, [])
  const doUndo = () => { const prev = undo.current.pop(); if (prev && work) { redo.current.push(clone(work)); setWork(prev); setDirty(true) } }
  const doRedo = () => { const nx = redo.current.pop(); if (nx && work) { undo.current.push(clone(work)); setWork(nx); setDirty(true) } }

  const checks = useMemo(() => (work ? validate(work) : []), [work])
  const errors = blockingErrors(checks)
  const issueNodes = useMemo(() => new Set(checks.filter((c) => !c.ok && c.level === 'error').flatMap((c) => c.nodeIds ?? [])), [checks])

  const readOnly = !editable || narrow
  const liveAt = useMemo(() => new Set(s.workflows.filter((w) => w.defId === work?.id && w.status === 'running').flatMap((w) => w.active.map((a) => a.nodeId))), [s.workflows, work?.id])
  const selNode = sel?.kind === 'node' ? work?.nodes.find((n) => n.id === sel.id) : undefined
  const selEdge = sel?.kind === 'edge' ? work?.edges.find((e) => e.id === sel.id) : undefined
  useEffect(() => { if (sel) setSide('selection') }, [sel])

  // ── Mutations on the working copy
  const addNode = (type: WfNodeType) => {
    if (!work || readOnly) return
    const nid = uid('n').slice(0, 10)
    const label = { form: 'New form step', review: 'New review', approval: 'New approval', condition: 'New decision', 'parallel-split': 'Split', 'parallel-join': 'Join', notify: 'Notify', system: 'System action', start: 'Start', end: 'Complete' }[type]
    change((d) => {
      const from = selNode && selNode.type !== 'end' ? selNode : undefined
      let x = 120, y = 200
      if (from) { x = from.x + 170; y = from.y } else { const maxX = Math.max(0, ...d.nodes.map((n) => n.x)); x = maxX + 170; y = d.nodes.length ? d.nodes[d.nodes.length - 1].y : 200 }
      const node: WfNode = { id: nid, type, label, x, y, ...(isHuman(type) ? { slaDays: 3, assignee: type === 'form' ? { kind: 'requester' } : { kind: 'role', roleId: 'pmo' }, rule: 'any' } : {}), ...(type === 'system' ? { systemAction: 'none' } : {}), ...(type === 'notify' ? { assignee: { kind: 'requester' } } : {}) } as WfNode
      if (from) {
        const fwd = d.edges.filter((e) => e.from === from.id && e.outcome !== 'return' && e.outcome !== 'reject')
        if (fwd.length === 1 && from.type !== 'condition' && from.type !== 'parallel-split') {
          for (const n of d.nodes) if (n.x > from.x + 20) n.x += 170
          const oldTo = fwd[0].to
          fwd[0].to = nid
          d.edges.push({ id: uid('e'), from: nid, to: oldTo, ...(isHuman(type) && type !== 'form' ? { outcome: 'approve' } : {}) })
        } else {
          while (d.nodes.some((n) => Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 60)) y += 100
          d.edges.push({ id: uid('e'), from: from.id, to: nid, ...(isHuman(from.type) && from.type !== 'form' ? { outcome: 'approve' } : {}), ...(from.type === 'condition' ? { label: 'Yes', condition: { field: d.fields[0]?.key ?? 'amount', op: 'gt', value: 0 } } : {}) })
        }
      }
      d.nodes.push(node)
    })
    setSel({ kind: 'node', id: nid })
    toast(`${nodeTypeLabel(type)} added${selNode ? ` after “${selNode.label}”` : ''}`, 'info')
  }
  const moving = useRef(false)
  const moveNode = (nid: string, x: number, y: number) => {
    if (readOnly) return
    const first = !moving.current
    moving.current = true
    change((d) => { const n = d.nodes.find((q) => q.id === nid); if (n) { n.x = x; n.y = y } }, { record: first })
  }
  const connectNodes = (from: string, to: string) => {
    if (!work || readOnly) return
    if (work.edges.some((e) => e.from === from && e.to === to)) { toast('Those steps are already connected', 'info'); return }
    const a = work.nodes.find((n) => n.id === from)!, b = work.nodes.find((n) => n.id === to)!
    if (b.type === 'start') { toast('Nothing can flow into Start', 'bad'); return }
    const eid = uid('e')
    change((d) => {
      const back = b.x < a.x - 10
      const e: WfEdge = { id: eid, from, to }
      if (isHuman(a.type) && a.type !== 'form') { e.outcome = back ? 'return' : 'approve'; if (back) e.label = 'Return' }
      if (a.type === 'condition') { const hasDefault = d.edges.some((x) => x.from === from && !x.condition); if (hasDefault) { e.condition = { field: d.fields.find((f) => f.type === 'money' || f.type === 'number')?.key ?? d.fields[0]?.key ?? 'amount', op: 'gt', value: 0 }; e.label = 'Yes' } else e.label = 'No' }
      d.edges.push(e)
    })
    setSel({ kind: 'edge', id: eid })
    toast(`Connected “${a.label}” → “${b.label}”`, 'info')
  }
  const deleteSel = () => {
    if (!work || readOnly || !sel) return
    if (sel.kind === 'edge') { change((d) => { d.edges = d.edges.filter((e) => e.id !== sel.id) }); setSel(null); toast('Connection removed', 'info'); return }
    const n = work.nodes.find((x) => x.id === sel.id)
    if (!n) return
    change((d) => {
      const ins = d.edges.filter((e) => e.to === n.id && e.outcome !== 'return' && e.outcome !== 'reject')
      const outs = d.edges.filter((e) => e.from === n.id && e.outcome !== 'return' && e.outcome !== 'reject')
      d.edges = d.edges.filter((e) => e.from !== n.id && e.to !== n.id)
      if (ins.length === 1 && outs.length === 1 && ins[0].from !== outs[0].to) d.edges.push({ ...ins[0], id: uid('e'), to: outs[0].to })
      d.nodes = d.nodes.filter((x) => x.id !== n.id)
    })
    setSel(null)
    toast(`Removed “${n.label}”`, 'info')
  }
  const patchNode = (patch: Partial<WfNode>) => selNode && change((d) => { const n = d.nodes.find((x) => x.id === selNode.id); if (n) Object.assign(n, patch); for (const k of Object.keys(patch) as (keyof WfNode)[]) if (patch[k] === undefined && n) delete n[k] })
  const patchEdge = (patch: Partial<WfEdge>) => selEdge && change((d) => { const e = d.edges.find((x) => x.id === selEdge.id); if (e) Object.assign(e, patch); for (const k of Object.keys(patch) as (keyof WfEdge)[]) if (patch[k] === undefined && e) delete e[k] })

  // keyboard: delete, undo/redo, escape
  useEffect(() => {
    if (mode !== 'design') return
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo() }
      else if (e.key === 'Escape') { setSel(null); setConnect(false) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // ── Persistence (WF-08): published versions are immutable; edits save as a draft new version.
  const saveDraft = (quiet = false): WorkflowDef | undefined => {
    if (!work) return
    const st = getState()
    const existing = draftOf(st, key)
    const maxV = Math.max(0, ...versionsOf(st, key).map((v) => v.version))
    const saved: WorkflowDef = { ...clone(work), status: 'draft', id: existing?.id ?? (work.status === 'draft' ? work.id : uid('wfd')), version: existing?.version ?? (work.status === 'draft' ? work.version : maxV + 1) }
    mutate((d) => {
      const i = d.workflowDefs.findIndex((x) => x.id === saved.id)
      if (i >= 0) d.workflowDefs[i] = saved
      else d.workflowDefs.push(saved)
    }, { entity: 'workflow-def', entityId: key, action: 'save-draft', summary: `Saved draft ${saved.name} v${saved.version}` })
    setViewId(saved.id)
    setDirty(false)
    if (!quiet) toast(`Draft v${saved.version} saved`)
    return saved
  }
  const discardDraft = () => {
    const dr = draftOf(getState(), key)
    if (dr) mutate((d) => { d.workflowDefs = d.workflowDefs.filter((x) => x.id !== dr.id) }, { entity: 'workflow-def', entityId: key, action: 'discard-draft', summary: `Discarded draft ${dr.name} v${dr.version}` })
    setViewId(undefined)
    if (!dr && baseDef) { setWork(clone(baseDef)); setDirty(false) }
    toast(dr ? `Draft v${dr.version} discarded` : 'Changes discarded', 'info')
  }

  if (!baseDef || !work) return <Empty title="Process not found" action={<a className="text-link text-[13px] font-semibold" href="#workflows">Back to the process catalog</a>}>No process with key “{key}”.</Empty>

  const isDraftView = work.status === 'draft' || dirty
  const nextVersion = storedDraft?.version ?? (work.status === 'draft' ? work.version : Math.max(...versions.map((v) => v.version)) + 1)
  const running = s.workflows.filter((w) => w.defKey === key && w.status === 'running')
  const download = async (kind: 'sop' | 'json') => {
    const r = kind === 'sop' ? await saveFile(`${work.key}-sop-v${work.version}.html`, sopHtml(getState(), work), 'text/html') : await saveFile(`${work.key}-v${work.version}.json`, JSON.stringify(work, null, 2), 'application/json')
    toast(r === 'saved' ? (kind === 'sop' ? 'SOP downloaded' : 'Definition downloaded') : r === 'declined' ? 'Download cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={<span><a href="#workflows" className="hover:text-ink">Workflows</a> / <Mono>{key}</Mono></span>}
        title={work.name || 'Untitled process'}
        subtitle={work.description || 'Describe what this process controls.'}
        actions={<>
          <Button size="sm" icon={<Icon name="doc" className="h-3.5 w-3.5" />} onClick={() => download('sop')}>Download SOP</Button>
          <Button size="sm" icon={<Icon name="download" className="h-3.5 w-3.5" />} onClick={() => download('json')}>JSON</Button>
          {editable && !narrow && <>
            {(storedDraft || dirty) && <Button size="sm" variant="ghost" onClick={discardDraft}>Discard draft</Button>}
            <Button size="sm" disabled={!dirty} onClick={() => saveDraft()}>Save draft</Button>
            <Button size="sm" variant={isDraftView ? 'marker' : 'secondary'} disabled={!isDraftView} onClick={() => setPublishOpen(true)}>Publish v{nextVersion}</Button>
          </>}
        </>}
      >
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="ink">{recordTypeLabel(work.recordType)}</Badge>
          <span>Owner <b className="text-ink">{s.roles.find((r) => r.id === work.ownerRole)?.name}</b></span>
          <span>·</span>
          {published ? <span>Published <b className="text-ink">v{published.version}</b> effective {fmtDate(published.effective)}</span> : <span>Not yet published</span>}
          {storedDraft && <Badge tone="info">Draft v{storedDraft.version} saved</Badge>}
          {dirty && <Badge tone="marker">Unsaved changes</Badge>}
          <span>·</span><span>{running.length} running instance{running.length === 1 ? '' : 's'}</span>
          {versions.length > 1 && (
            <label className="ml-auto flex items-center gap-1.5">Version
              <Select aria-label="Version" className="h-7 w-auto py-0.5 text-[12px]" value={baseDef.id} onChange={(e) => setViewId(e.target.value)} options={versions.map((v) => ({ value: v.id, label: `v${v.version} · ${v.status}` }))} />
            </label>
          )}
        </div>
      </PageHeader>

      {!editable && <Callout tone="info" title={`Viewing v${baseDef.version} (${baseDef.status})`}>{baseDef.status === 'retired' ? 'Retired versions are read-only. Instances started on this version still finish on it.' : `Draft v${storedDraft?.version} holds the pending edits; published v${baseDef.version} is read-only.`} <button className="font-semibold text-link" onClick={() => setViewId(undefined)}>{storedDraft ? 'Open the draft' : 'Open the current version'}</button></Callout>}
      {editable && baseDef.status === 'published' && dirty && <Callout tone="marker" title={`Editing creates draft v${nextVersion}`}>v{baseDef.version} stays in force until you publish. The {running.length} request{running.length === 1 ? '' : 's'} in flight keep routing on v{baseDef.version}.</Callout>}

      <Tabs<Mode> value={mode} onChange={setMode} tabs={[
        ...(narrow ? [] : [{ id: 'design' as Mode, label: 'Design' }]),
        { id: 'test', label: 'Test routing' },
        { id: 'sop', label: 'Documentation (SOP)' },
        { id: 'versions', label: 'Versions & instances', count: running.length || undefined },
      ]} />
      {narrow && <p className="text-[12px] text-muted">The visual designer needs a larger screen. On a phone you can read the procedure, test routing and follow instances.</p>}

      {mode === 'design' && !narrow && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 rounded-md border border-line bg-surface">
              {/* palette */}
              {!readOnly && (
                <div className="flex w-[148px] shrink-0 flex-col gap-0.5 border-r border-line p-2">
                  <div className="eyebrow px-1 pb-1">Add step</div>
                  {NODE_TYPES.filter((t) => t.type !== 'start').map((t) => (
                    <button key={t.type} title={t.hint + (selNode ? ` — inserted after “${selNode.label}”` : '')} onClick={() => addNode(t.type)} className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] font-medium hover:bg-sunken">
                      <PaletteGlyph type={t.type} />{t.label}
                    </button>
                  ))}
                  <p className="mt-2 px-1 text-[11px] leading-snug text-faint">{selNode ? <>New steps go after <b className="text-muted">{selNode.label}</b> and are wired in.</> : 'Select a step first to insert after it.'}</p>
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
                  {!readOnly && <Button size="sm" variant={connect ? 'primary' : 'secondary'} onClick={() => setConnect(!connect)} title="Click a step, then another, to connect them">{connect ? 'Connecting — click two steps' : 'Connect'}</Button>}
                  {!readOnly && <Button size="sm" variant="ghost" disabled={!sel} onClick={deleteSel}>Delete</Button>}
                  {!readOnly && <Button size="sm" variant="ghost" disabled={!undo.current.length} onClick={doUndo} title="Undo (Ctrl+Z)">Undo</Button>}
                  {!readOnly && <Button size="sm" variant="ghost" disabled={!redo.current.length} onClick={doRedo} title="Redo (Ctrl+Shift+Z)">Redo</Button>}
                  <span className="ml-auto flex items-center gap-1 text-[12px] text-muted">
                    <button className="rounded px-1.5 hover:bg-sunken" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}>−</button>
                    <button className="w-11 rounded tabular-nums hover:bg-sunken" onClick={() => setZoom(1)} title="Actual size">{Math.round(zoom * 100)}%</button>
                    <button className="rounded px-1.5 hover:bg-sunken" onClick={fit} title="Fit to width">Fit</button>
                    <button className="rounded px-1.5 hover:bg-sunken" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))}>+</button>
                  </span>
                  <span className={cx('rounded px-1.5 py-0.5 text-[11.5px] font-semibold', errors.length ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good')}>{errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''} to fix` : 'Ready to publish'}</span>
                </div>
                <div ref={viewport} className="max-h-[600px] min-h-[420px] overflow-auto bg-ground/40">
                  <Canvas s={s} def={work} selected={sel} onSelect={(x) => { setSel(x) }} onMoveNode={moveNode} onMoveEnd={() => { moving.current = false }} onConnect={(a, b) => { connectNodes(a, b); setConnect(false) }} readOnly={readOnly} issues={issueNodes} connectMode={connect} zoom={zoom} active={liveAt} />
                </div>
                <Legend />
              </div>
            </div>
          </div>
          <Panel pad={false} className="self-start">
            <Tabs<SideTab> className="px-2" value={side} onChange={setSide} tabs={[
              { id: 'selection', label: 'Properties' }, { id: 'process', label: 'Process' }, { id: 'fields', label: 'Form', count: work.fields.length }, { id: 'checks', label: 'Checks', count: errors.length || undefined },
            ]} />
            <div className="max-h-[640px] overflow-y-auto p-3">
              {side === 'selection' && (selNode ? <NodeProps s={s} def={work} n={selNode} onPatch={patchNode} onDelete={deleteSel} readOnly={readOnly} preview={preview} />
                : selEdge ? <EdgeProps s={s} def={work} e={selEdge} onPatch={patchEdge} onDelete={deleteSel} readOnly={readOnly} preview={preview} />
                : <p className="text-[13px] text-muted">Select a step or a connection on the canvas to edit it. Drag steps to move them; drag the blue handle on a selected step to another step to connect them.</p>)}
              {side === 'process' && <ProcessSettings s={s} def={work} readOnly={readOnly} onChange={(p) => change((d) => Object.assign(d, p))} />}
              {side === 'fields' && <FieldsEditor fields={work.fields} readOnly={readOnly} onChange={(f) => change((d) => { d.fields = f })} usedKeys={new Set([...work.edges.map((e) => e.condition?.field ?? ''), ...work.nodes.map((n) => (n.assignee?.kind === 'doa' ? n.assignee.field : ''))])} />}
              {side === 'checks' && <Checklist checks={checks} onPick={(c: Check) => { const nid = c.nodeIds?.[0]; if (nid) setSel({ kind: 'node', id: nid }); else if (c.edgeIds?.[0]) setSel({ kind: 'edge', id: c.edgeIds[0] }) }} />}
            </div>
            {side !== 'checks' && side !== 'selection' && <div className="border-t border-line px-3 py-2 text-[11.5px] text-faint">Test values for previews: <button className="font-semibold text-link" onClick={() => setMode('test')}>edit in Test routing</button></div>}
          </Panel>
        </div>
      )}

      {mode === 'test' && <TestMode s={s} def={work} preview={preview} setPreview={setPreview} />}
      {mode === 'sop' && <SopView s={s} def={work} onDownload={() => download('sop')} />}
      {mode === 'versions' && <VersionsPanel s={s} defKey={key} current={work} onOpen={(vid) => { setViewId(vid); setMode(narrow ? 'sop' : 'design') }} />}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} s={s} work={work} published={published} checks={checks} nextVersion={nextVersion} running={running.length}
        onPublish={(effective, summary) => {
          const saved = saveDraft(true)
          if (!saved) return
          mutate((d) => {
            for (const x of d.workflowDefs) if (x.key === key && x.status === 'published') x.status = 'retired'
            const x = d.workflowDefs.find((y) => y.id === saved.id)!
            x.status = 'published'
            x.effective = effective
          }, { entity: 'workflow-def', entityId: key, action: 'publish', summary: `Published ${saved.name} v${saved.version}: ${summary}` })
          setViewId(undefined)
          setPublishOpen(false)
          toast(`${saved.name} v${saved.version} published — new requests route on it`)
        }} />
    </div>
  )
}

function PaletteGlyph({ type }: { type: WfNodeType }) {
  const c = tok(TYPE_COLOR[type])
  return (
    <svg width={18} height={14} viewBox="0 0 18 14" aria-hidden className="shrink-0">
      {type === 'condition' ? <polygon points="9,1 17,7 9,13 1,7" fill="none" stroke={c} strokeWidth={1.6} />
        : type === 'parallel-split' || type === 'parallel-join' ? <rect x={7} y={1} width={4} height={12} fill={c} />
        : type === 'end' ? <circle cx={9} cy={7} r={5.5} fill={c} />
        : type === 'notify' || type === 'system' ? <rect x={1} y={3} width={16} height={8} rx={4} fill="none" stroke={c} strokeWidth={1.6} strokeDasharray={type === 'system' ? '2 1.5' : undefined} />
        : <><rect x={1} y={2} width={16} height={10} rx={2} fill="none" stroke={tok('line')} strokeWidth={1.4} /><rect x={1} y={2} width={3} height={10} rx={1} fill={c} /></>}
    </svg>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={tok('faint')} strokeWidth="1.6" /></svg>Forward path</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={tok('warn')} strokeWidth="1.6" strokeDasharray="5 3" /></svg>Return for revision</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={tok('bad')} strokeWidth="1.6" strokeDasharray="5 3" /></svg>Reject</span>
      <span>Drag to move · select a step and drag its <b className="text-link">+</b> handle to connect · Delete removes · Ctrl+Z undoes</span>
    </div>
  )
}

function NodeProps({ s, def, n, onPatch, onDelete, readOnly, preview }: { s: AppState; def: WorkflowDef; n: WfNode; onPatch: (p: Partial<WfNode>) => void; onDelete: () => void; readOnly: boolean; preview: Preview }) {
  const human = isHuman(n.type)
  const inbound = def.edges.filter((e) => e.to === n.id).length, outbound = def.edges.filter((e) => e.from === n.id).length
  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2"><PaletteGlyph type={n.type} /><span className="eyebrow">{nodeTypeLabel(n.type)}</span><Mono className="ml-auto text-faint">{n.id}</Mono></div>
      <Field label="Step name"><Input id="wf-node-label" value={n.label} onChange={(e) => onPatch({ label: e.target.value })} /></Field>
      {human && (
        <Field label="Step type"><Select value={n.type} onChange={(e) => onPatch({ type: e.target.value as WfNodeType })} options={[{ value: 'form', label: 'Form — fill in and submit' }, { value: 'review', label: 'Review — approve forward or return' }, { value: 'approval', label: 'Approval — e-signed decision' }]} /></Field>
      )}
      {(human || n.type === 'notify') && <AssigneeEditor s={s} value={n.assignee} fields={def.fields} preview={preview} onChange={(a) => onPatch({ assignee: a })} />}
      {human && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="SLA (days)"><Input type="number" min={0} value={n.slaDays ?? ''} onChange={(e) => onPatch({ slaDays: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })} /></Field>
          {n.type !== 'form' && <Field label="When several people" hint={n.rule === 'all' ? 'Every assignee must approve' : 'First to act decides'}><Select value={n.rule ?? 'any'} onChange={(e) => onPatch({ rule: e.target.value as 'any' | 'all' })} options={[{ value: 'any', label: 'Any one' }, { value: 'all', label: 'All must act' }]} /></Field>}
        </div>
      )}
      {n.type === 'system' && (
        <Field label="System action" hint={SYSTEM_ACTIONS.find((a) => a.id === n.systemAction)?.does}><Select value={n.systemAction ?? 'none'} onChange={(e) => onPatch({ systemAction: e.target.value as WfNode['systemAction'] })} options={SYSTEM_ACTIONS.map((a) => ({ value: a.id, label: a.label }))} /></Field>
      )}
      {n.type !== 'parallel-split' && n.type !== 'parallel-join' && <Field label="Instructions" hint="Shown to the assignee in My work, and in the SOP step table."><TextArea value={n.description ?? ''} onChange={(e) => onPatch({ description: e.target.value || undefined })} className="min-h-[60px]" /></Field>}
      <Field label="Swimlane override" hint="Leave blank to use the assignee as the lane."><Input value={n.lane ?? ''} onChange={(e) => onPatch({ lane: e.target.value || undefined })} placeholder="e.g. Field operations" /></Field>
      <div className="flex items-center justify-between border-t border-line pt-2 text-[12px] text-muted">
        <span>{inbound} in · {outbound} out</span>
        {!readOnly && <Button size="sm" variant="ghost" className="text-bad" onClick={onDelete}>Delete step</Button>}
      </div>
    </fieldset>
  )
}

function EdgeProps({ s, def, e, onPatch, onDelete, readOnly, preview }: { s: AppState; def: WorkflowDef; e: WfEdge; onPatch: (p: Partial<WfEdge>) => void; onDelete: () => void; readOnly: boolean; preview: Preview }) {
  const a = def.nodes.find((n) => n.id === e.from), b = def.nodes.find((n) => n.id === e.to)
  const fromHuman = a && isHuman(a.type) && a.type !== 'form'
  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-2.5">
      <div className="eyebrow">Connection</div>
      <div className="rounded border border-line bg-sunken/60 px-2.5 py-2 text-[13px]"><b>{a?.label}</b> <span className="text-faint">→</span> <b>{b?.label}</b></div>
      {fromHuman && (
        <Field label="Followed when the assignee chooses" hint="Approve moves forward; Return sends back for revision; Reject ends the process.">
          <Select id="wf-edge-outcome" value={e.outcome ?? 'approve'} onChange={(ev) => onPatch({ outcome: ev.target.value as WfEdge['outcome'], label: ev.target.value === 'return' ? (e.label || 'Return') : ev.target.value === 'reject' ? (e.label || 'Reject') : e.label === 'Return' || e.label === 'Reject' ? undefined : e.label })} options={[{ value: 'approve', label: 'Approve / submit' }, { value: 'return', label: 'Return for revision' }, { value: 'reject', label: 'Reject' }]} />
        </Field>
      )}
      {a?.type === 'condition' && <ConditionEditor s={s} def={def} edge={e} preview={preview} onChange={(c) => onPatch({ condition: c })} />}
      <Field label="Label on the diagram"><Input value={e.label ?? ''} onChange={(ev) => onPatch({ label: ev.target.value || undefined })} placeholder={a?.type === 'condition' ? 'Yes / No / Over $5M' : 'Optional'} /></Field>
      {!readOnly && <div className="flex justify-end border-t border-line pt-2"><Button size="sm" variant="ghost" className="text-bad" onClick={onDelete}>Delete connection</Button></div>}
    </fieldset>
  )
}

function PublishModal({ open, onClose, s, work, published, checks, nextVersion, running, onPublish }: { open: boolean; onClose: () => void; s: AppState; work: WorkflowDef; published?: WorkflowDef; checks: Check[]; nextVersion: number; running: number; onPublish: (effective: string, summary: string) => void }) {
  const [effective, setEffective] = useState(s.settings.asOf)
  const auto = useMemo(() => diffDefs(s, published, work), [s, published, work])
  const [summary, setSummary] = useState(auto)
  useEffect(() => { if (open) { setSummary(auto); setEffective(s.settings.asOf) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const errs = blockingErrors(checks)
  return (
    <Modal open={open} onClose={onClose} title={`Publish ${work.name} v${nextVersion}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!errs.length || !summary.trim()} onClick={() => onPublish(effective, summary.trim())}>Publish v{nextVersion}</Button></>}>
      <div className="flex flex-col gap-3">
        <Checklist checks={checks} />
        {errs.length > 0 && <Callout tone="bad">Fix the {errs.length} item{errs.length > 1 ? 's' : ''} above before publishing.</Callout>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Effective date"><Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
          <div className="text-[12px] text-muted sm:pt-5">{published ? <>v{published.version} will be retired. {running ? `${running} in-flight request${running > 1 ? 's' : ''} keep routing on v${published.version}.` : 'No requests are in flight.'}</> : 'This is the first published version.'}</div>
        </div>
        <Field label="What changed (revision history)"><TextArea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

