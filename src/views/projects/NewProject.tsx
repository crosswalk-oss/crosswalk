// Project initiation wizard (#new-project): Need & driver → Asset & location → Team → Review.
// Creates a stage-0 project on the program's lifecycle template, its gate deliverables, an optional
// draft Class 5 rate-table estimate, and starts the project-initiation workflow.
import { useMemo, useState } from 'react'
import { mutate, useMe, useStore } from '@/core/store'
import { go, projectHref } from '@/core/router'
import type { AssetType, Driver, Estimate, Milestone, Project, TeamPosition, Terrain, WorkMethod } from '@/core/types'
import { ensureDeliverables, ownerForRole, requiredDefs } from '@/core/engine/gates'
import { CLASS_RANGES, MATURITY_ITEMS, computeClass, estimateTotals, parametricLines } from '@/core/engine/estimates'
import { basisYearOf, contingencyForClass, currentLoaders, escalationPctFor, pricingFor, salesTaxFor, scopeQuantities, spendMidpoint } from '@/core/engine/estimatingAdmin'
import { actOnWorkflow, startWorkflow } from '@/core/engine/workflow'
import { addDays, cx, money, nowISO, uid } from '@/core/util'
import { Badge, Button, Callout, Checkbox, ClassBadge, Field, Input, KV, Mono, PageHeader, Panel, Select, TextArea } from '@/ui/kit'
import { RangeBar } from '@/ui/charts'
import { toast } from '@/ui/toast'
import { PersonSelect, ProgramTag } from '../shared/pickers'

const DRIVERS: Driver[] = ['Safety / compliance', 'Reliability', 'Capacity', 'Customer / new business', 'Relocation', 'Environmental']
const ASSETS: { id: AssetType; label: string; methods: WorkMethod[] }[] = [
  { id: 'transmission-pipeline', label: 'Transmission pipeline', methods: ['replace-open-trench', 'replace-hdd', 'hydrotest'] },
  { id: 'distribution-main', label: 'Distribution main', methods: ['replace-open-trench'] },
  { id: 'valve-site', label: 'Valve site', methods: ['valve-automation'] },
  { id: 'compressor-station', label: 'Compressor station', methods: ['compressor-replacement', 'station-rebuild'] },
]
const METHOD_LABEL: Record<WorkMethod, string> = {
  'replace-open-trench': 'Replace — open trench', 'replace-hdd': 'Replace — HDD', hydrotest: 'Hydrostatic test', abandon: 'Abandon', 'valve-automation': 'Valve automation',
  'station-rebuild': 'Station rebuild', 'compressor-replacement': 'Compressor replacement', 'inline-inspection': 'In-line inspection',
}
const DISTRICTS: Record<string, { box: [number, number, number, number]; county: string; cities: string[] }> = {
  West: { box: [90, 300, 330, 540], county: 'Coastline County', cities: ['Mesa Verde', 'Old Mission', 'Bellport', 'Cresthaven'] },
  East: { box: [360, 260, 620, 500], county: 'Arroyo County', cities: ['San Lucero', 'Rancho Alto', 'Las Piedras', 'Sycamore Flats', 'Westgate', 'Las Lomas'] },
  South: { box: [650, 220, 930, 520], county: 'Sierra Mesa County', cities: ['Palo Duro', 'Ironwood', 'Laguna Ciega', 'Del Arroyo'] },
  North: { box: [260, 50, 720, 210], county: 'Arroyo County', cities: ['Vista Linda', 'Cielo Grande', 'Juniper Ridge', 'Fairhollow'] },
}
const POSITIONS: { pos: TeamPosition; label: string; role: Parameters<typeof PersonSelect>[0]['role'] }[] = [
  { pos: 'sponsor', label: 'Sponsor (director)', role: 'sponsor' },
  { pos: 'pm', label: 'Project manager', role: 'pm' },
  { pos: 'engineer', label: 'Project engineer', role: 'engineer' },
  { pos: 'estimator', label: 'Estimator', role: 'estimator' },
  { pos: 'projectControls', label: 'Project controls', role: 'project-controls' },
  { pos: 'scheduler', label: 'Scheduler', role: 'scheduler' },
  { pos: 'constructionManager', label: 'Construction manager', role: 'construction-manager' },
  { pos: 'safety', label: 'Safety advisor', role: 'safety-advisor' },
  { pos: 'environmental', label: 'Environmental', role: 'environmental' },
  { pos: 'land', label: 'Land agent', role: 'land' },
]
const STEPS = ['Need & driver', 'Asset & location', 'Team', 'Review & create'] as const

interface Form {
  name: string; programId: string; driver: Driver; need: string; citation: string; proceeding: string; custom: Record<string, string>
  asset: AssetType; method: WorkMethod; lineId: string; diameterIn: number; lengthFt: number; sites: number; maopPsig: number; material: string; vintage: number; recordsStatus: Project['asset']['recordsStatus']
  district: string; city: string; terrain: Terrain; classLocation: 1 | 2 | 3 | 4; hca: boolean; dac: boolean; x: number; y: number
  team: Partial<Record<TeamPosition, string>>
  buildEstimate: boolean; startWorkflow: boolean
}

export default function NewProject(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const me = useMe()
  const [step, setStep] = useState(0)
  const [f, setF] = useState<Form>(() => {
    const prog = s.programs[0]
    return {
      name: '', programId: prog.id, driver: 'Safety / compliance', need: '', citation: prog.regulatoryDriver, proceeding: 'PSE balancing account (AV-PUC-2022-05 (fictional) review)', custom: {},
      asset: 'transmission-pipeline', method: 'replace-open-trench', lineId: '', diameterIn: 16, lengthFt: 8000, sites: 1, maopPsig: 720, material: 'Steel, Grade B', vintage: 1958, recordsStatus: 'gaps',
      district: 'East', city: 'San Lucero', terrain: 'suburban', classLocation: 2, hca: true, dac: false, x: 490, y: 380,
      team: { sponsor: 'u-dir1', pm: 'u-pm1', engineer: 'u-eng1', estimator: 'u-est1', projectControls: 'u-pc1', scheduler: 'u-sch', constructionManager: 'u-cm1', safety: 'u-saf1', environmental: 'u-env', land: 'u-land' },
      buildEstimate: true, startWorkflow: true,
    }
  })
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const program = s.programs.find((p) => p.id === f.programId)!
  const tpl = s.templates.find((t) => t.id === program.lifecycleTemplateId)!
  const fieldDefs = s.settings.fieldDefs.filter((d) => d.programIds.includes(f.programId))
  const nextNum = Math.max(...s.projects.map((p) => Number(p.code.replace(/\D/g, '')))) + 1
  const code = `PRJ-${nextNum}`

  const setProgram = (id: string) => {
    const pr = s.programs.find((p) => p.id === id)!
    setF((x) => {
      const asset: AssetType = pr.code === 'VAP' ? 'valve-site' : pr.code === 'CSM' ? 'compressor-station' : pr.code === 'DRP' ? 'distribution-main' : 'transmission-pipeline'
      const methods = ASSETS.find((a) => a.id === asset)!.methods
      const sponsor = pr.code === 'CSM' ? 'u-dir2' : 'u-dir1'
      return {
        ...x, programId: id, citation: pr.regulatoryDriver, asset, method: methods.includes(x.method) ? x.method : methods[0],
        driver: pr.code === 'CSM' ? 'Environmental' : pr.code === 'DRP' ? 'Reliability' : 'Safety / compliance',
        proceeding: pr.code === 'PSE' ? 'PSE balancing account (AV-PUC-2022-05 (fictional) review)' : pr.code === 'CSM' ? 'Tier 2 advice letter on in-service' : 'TY2028 GRC (AV-PUC-2026-06 (fictional))',
        diameterIn: asset === 'distribution-main' ? 6 : asset === 'compressor-station' ? 0 : x.diameterIn || 16,
        maopPsig: asset === 'distribution-main' ? 60 : asset === 'compressor-station' ? 1000 : x.maopPsig,
        material: asset === 'distribution-main' ? 'Pre-1940 cast iron / bare steel' : asset === 'compressor-station' ? 'Gas turbine-driven reciprocating units' : 'Steel, Grade B',
        team: { ...x.team, sponsor, engineer: asset === 'compressor-station' ? 'u-eng2' : 'u-eng1', constructionManager: asset === 'compressor-station' ? 'u-cm2' : 'u-cm1' },
      }
    })
  }

  // Draft project object (used for preview estimate and creation)
  const draft = useMemo<Project>(() => buildProject(f, code, s.settings.asOf, tpl.stages.length === 3), [f, code, s.settings.asOf, tpl.stages.length])
  const lines = useMemo(() => parametricLines(draft, s.rates, pricingFor(s, draft), scopeQuantities(s, draft)), [draft, s.rates, s.settings])
  const estPreview = useMemo(() => {
    const maturity = Object.fromEntries((s.settings.estimating.maturityItems ?? MATURITY_ITEMS).map((m) => [m.key, m.key === 'need-defined']))
    const year = Number(s.settings.asOf.slice(0, 4))
    void year
    const cls = computeClass(maturity, s.settings.estimating.maturityItems)
    const e = { lines, loaders: currentLoaders(s), escalationPct: escalationPctFor(s, basisYearOf(s, lines), spendMidpoint(s, draft)), contingency: { method: 'deterministic' as const, pct: contingencyForClass(s, cls) }, cls, salesTax: salesTaxFor(s, draft), region: draft.location.district, rateTableVersion: s.settings.estimating.rateTableVersion }
    return { ...e, maturity, totals: estimateTotals(e) }
  }, [lines, s.settings])
  const defs = requiredDefs(s, draft, 0)

  const problems: string[][] = [
    [!f.name.trim() && 'Give the project a name', f.need.trim().length < 20 && 'Describe the need in at least a sentence', !f.citation.trim() && 'Add the regulatory citation or driver reference', ...fieldDefs.filter((d) => d.requiredAtStage === 0 && !f.custom[d.key]?.trim()).map((d) => `${d.label} is required at initiation`)].filter(Boolean) as string[],
    [!f.lineId.trim() && f.asset !== 'compressor-station' && 'Enter the line or facility ID', f.asset !== 'compressor-station' && f.asset !== 'valve-site' && f.lengthFt <= 0 && 'Length must be greater than zero', !f.city.trim() && 'Enter the city'].filter(Boolean) as string[],
    [!f.team.sponsor && 'Name a sponsor', !f.team.pm && 'Name a project manager'].filter(Boolean) as string[],
    [],
  ]
  const canNext = problems[step].length === 0

  const create = () => {
    const pid = `prj-${nextNum}`
    let instTitle = ''
    mutate((d) => {
      const p: Project = JSON.parse(JSON.stringify(draft))
      const rom = f.buildEstimate ? estPreview.totals.total : 0
      p.sizeTier = rom > 50_000_000 ? 'L' : rom > 5_000_000 || !rom ? 'M' : 'S'
      d.projects.push(p)
      ensureDeliverables(d, p)
      // charter deliverable starts in progress with the wizard output as its first draft
      const charter = d.deliverables.find((x) => x.projectId === pid && /charter/.test(x.defId))
      if (charter) { charter.status = 'in-progress'; charter.version = 1; charter.evidence = [{ id: uid('evd'), name: `${code}_Charter_draft.pdf`, sizeKb: 184, uploadedAt: nowISO(), byId: d.currentUserId }]; charter.updatedAt = nowISO() }
      if (f.buildEstimate && estPreview.lines.length) {
        const e: Estimate = {
          id: uid('est'), projectId: pid, version: 1, title: 'Class 5 rate-table estimate', cls: estPreview.cls, status: 'draft', method: 'parametric', createdAt: nowISO(), createdById: d.currentUserId,
          lines: estPreview.lines.map((l) => ({ ...l, id: uid('ln') })), maturity: estPreview.maturity, loaders: estPreview.loaders, escalationPct: estPreview.escalationPct, contingency: estPreview.contingency, salesTax: estPreview.salesTax, region: estPreview.region, rateTableVersion: estPreview.rateTableVersion,
          basis: {
            scopeBasis: p.scope.summary,
            assumptions: ['Quantities from GIS centerline length', 'Library P50 rates for matching asset, method, diameter and terrain', 'No land acquisition beyond temporary rights'],
            exclusions: ['Customer-side work', 'Unknown contamination', 'Escalation beyond the planned in-service year'],
            contingencyRationale: 'Deterministic 30% for Class 5 per estimating standard.',
            classJustification: 'Definition 0–2%: need, asset and length known; no design.',
          },
        }
        d.estimates.push(e)
        d.audit.push({ id: uid('aud'), at: nowISO(), actorId: d.currentUserId, entity: 'estimate', entityId: e.id, projectId: pid, action: 'create', summary: `Draft Class ${e.cls} rate-table estimate ${money(estPreview.totals.total)} created from initiation` })
      }
      if (f.startWorkflow) {
        const inst = startWorkflow(d, 'project-initiation', { title: `${code} ${p.name}`, recordType: 'initiation', recordId: pid, projectId: pid, data: { need: f.need, amount: estPreview.totals.total, program: program.code, driver: f.driver } })
        if (inst) {
          instTitle = inst.title
          const slot = inst.active[0]
          if (slot && slot.assigneeIds.includes(d.currentUserId)) actOnWorkflow(d, inst.id, slot.nodeId, d.currentUserId, 'submit', 'Submitted from the initiation wizard')
        }
      }
    }, { entity: 'project', entityId: pid, projectId: pid, action: 'create', summary: `Initiated ${code} ${draft.name} (${program.code}, ${tpl.stages[0].name})` })
    toast(instTitle ? `${code} created and sent for program screening` : `${code} created`)
    go(projectHref(pid))
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow={<a href="#projects" className="hover:underline">Projects</a>} title="Initiate a project"
        subtitle="Capture the need, the asset and the team. Crosswalk creates the project at Stage 1 on the program's lifecycle template, opens its gate deliverables, drafts a Class 5 rate-table estimate from the unit-cost library, and routes the request for program screening." />
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button disabled={i > step && problems.slice(0, i).some((p) => p.length)} onClick={() => setStep(i)} className={cx('flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50', i === step ? 'border-ink bg-surface' : 'border-line bg-surface/60 text-muted hover:text-ink')}>
              <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]', i < step ? 'bg-good text-white' : i === step ? 'bg-marker text-markerink' : 'bg-sunken text-muted')}>{i < step ? '✓' : i + 1}</span>
              <span className="truncate">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={STEPS[step]}>
          {step === 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Project name" className="md:col-span-2" hint="Line or facility, work type and place, e.g. “Line AV-15 Replacement — Old Mission Blvd”"><Input id="np-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Line AV-27 Replacement — Arroyo Seco Crossing" /></Field>
              <Field label="Program"><Select id="np-program" value={f.programId} onChange={(e) => setProgram(e.target.value)} options={s.programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Field>
              <Field label="Driver"><Select id="np-driver" value={f.driver} onChange={(e) => set('driver', e.target.value as Driver)} options={DRIVERS} /></Field>
              <Field label="Need statement" className="md:col-span-2" hint="What condition or requirement makes this work necessary? This becomes the charter need and the initiation request."><TextArea id="np-need" className="min-h-[90px]" value={f.need} onChange={(e) => set('need', e.target.value)} placeholder="Records review found no pressure test record for 1.6 miles of Line AV-27 in a Class 3 location; PU Code §958 requires test or replacement." /></Field>
              <Field label="Regulatory citation"><Input id="np-cite" value={f.citation} onChange={(e) => set('citation', e.target.value)} /></Field>
              <Field label="Funding proceeding"><Input id="np-proc" value={f.proceeding} onChange={(e) => set('proceeding', e.target.value)} /></Field>
              <div className="md:col-span-2"><KV cols={3} items={[['Recovery mechanism', program.recovery], ['Lifecycle template', tpl.name], ['DOA matrix', s.doaMatrices.find((m) => m.id === program.doaMatrixId)?.name ?? '—']]} /></div>
              {fieldDefs.map((d) => (
                <Field key={d.key} label={<span className="flex items-center gap-1.5">{d.label}{d.requiredAtStage !== undefined && <Badge tone={d.requiredAtStage === 0 ? 'bad' : 'neutral'}>Required by stage {d.requiredAtStage + 1}</Badge>}</span>}>
                  <Input id={`np-cf-${d.key}`} value={f.custom[d.key] ?? ''} onChange={(e) => set('custom', { ...f.custom, [d.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Asset type"><Select id="np-asset" value={f.asset} onChange={(e) => { const a = e.target.value as AssetType; set('asset', a); set('method', ASSETS.find((x) => x.id === a)!.methods[0]) }} options={ASSETS.map((a) => ({ value: a.id, label: a.label }))} /></Field>
                <Field label="Work method"><Select id="np-method" value={f.method} onChange={(e) => set('method', e.target.value as WorkMethod)} options={ASSETS.find((a) => a.id === f.asset)!.methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} /></Field>
                <Field label={f.asset === 'compressor-station' ? 'Facility ID' : 'Line ID'}><Input id="np-line" value={f.lineId} onChange={(e) => set('lineId', e.target.value)} placeholder={f.asset === 'compressor-station' ? 'STA-LAS' : '7100'} /></Field>
                {f.asset !== 'compressor-station' && <Field label="Diameter (in)"><Input id="np-dia" type="number" value={f.diameterIn} onChange={(e) => set('diameterIn', Number(e.target.value))} /></Field>}
                {f.asset !== 'compressor-station' && f.asset !== 'valve-site' && <Field label="Length (ft)" hint={`${(f.lengthFt / 5280).toFixed(2)} miles`}><Input id="np-len" type="number" value={f.lengthFt} onChange={(e) => set('lengthFt', Number(e.target.value))} /></Field>}
                {f.asset === 'valve-site' && <Field label="Valve sites"><Input id="np-sites" type="number" min={1} value={f.sites} onChange={(e) => set('sites', Math.max(1, Number(e.target.value)))} /></Field>}
                <Field label="MAOP (psig)"><Input id="np-maop" type="number" value={f.maopPsig} onChange={(e) => set('maopPsig', Number(e.target.value))} /></Field>
                <Field label="Material"><Input id="np-mat" value={f.material} onChange={(e) => set('material', e.target.value)} /></Field>
                <Field label="Vintage"><Input id="np-vin" type="number" value={f.vintage} onChange={(e) => set('vintage', Number(e.target.value))} /></Field>
                <Field label="Records status"><Select id="np-rec" value={f.recordsStatus} onChange={(e) => set('recordsStatus', e.target.value as Form['recordsStatus'])} options={[{ value: 'complete', label: 'Complete (TVC)' }, { value: 'gaps', label: 'Gaps identified' }, { value: 'unknown', label: 'Unknown' }]} /></Field>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="District"><Select id="np-district" value={f.district} onChange={(e) => { const dn = e.target.value; const b = DISTRICTS[dn].box; setF((x) => ({ ...x, district: dn, city: DISTRICTS[dn].cities[0], x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2) })) }} options={Object.keys(DISTRICTS)} /></Field>
                  <Field label="City"><Input id="np-city" list="np-cities" value={f.city} onChange={(e) => set('city', e.target.value)} /><datalist id="np-cities">{DISTRICTS[f.district].cities.map((c) => <option key={c} value={c} />)}</datalist></Field>
                  <Field label="Terrain"><Select id="np-terrain" value={f.terrain} onChange={(e) => { const t = e.target.value as Terrain; setF((x) => ({ ...x, terrain: t, classLocation: t === 'urban' ? 3 : t === 'suburban' ? 2 : 1 })) }} options={['urban', 'suburban', 'rural']} /></Field>
                  <Field label="Class location"><Select id="np-class" value={String(f.classLocation)} onChange={(e) => set('classLocation', Number(e.target.value) as Form['classLocation'])} options={['1', '2', '3', '4'].map((c) => ({ value: c, label: `Class ${c}` }))} /></Field>
                  <div className="col-span-2 flex flex-col gap-2">
                    <Checkbox checked={f.hca} onChange={(v) => set('hca', v)} label="In a high consequence area (HCA)" />
                    <Checkbox checked={f.dac} onChange={(v) => set('dac', v)} label="Serves a disadvantaged community (DAC)" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-muted">Map location <span className="font-normal text-faint">— click to place the pin</span></div>
                  <PlacePin x={f.x} y={f.y} onPlace={(x, y) => { const dn = Object.entries(DISTRICTS).find(([, v]) => x >= v.box[0] - 20 && x <= v.box[2] + 20 && y >= v.box[1] - 20 && y <= v.box[3] + 20)?.[0]; setF((s0) => ({ ...s0, x, y, district: dn ?? s0.district })) }} />
                </div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted">Team positions drive workflow routing (for example, the controls review on a change request goes to the project's controls analyst) and deliverable ownership.</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {POSITIONS.map((x) => <Field key={x.pos} label={x.label}><PersonSelect id={`np-team-${x.pos}`} role={x.role} includeEmpty value={f.team[x.pos]} onChange={(v) => set('team', { ...f.team, [x.pos]: v || undefined })} /></Field>)}
              </div>
              <div>
                <div className="eyebrow mb-1.5">Stage 1 deliverables and owners</div>
                <div className="scroll-x"><table className="tbl"><thead><tr><th>Deliverable</th><th>Owner</th><th>Reviewer</th></tr></thead><tbody>
                  {defs.map((d) => <tr key={d.id}><td>{d.name}</td><td>{s.people.find((p) => p.id === ownerForRole(s, { ...draft }, d.ownerRole))?.name ?? '—'}</td><td className="text-muted">{s.people.find((p) => p.id === ownerForRole(s, { ...draft }, d.reviewerRole))?.name ?? '—'}</td></tr>)}
                </tbody></table></div>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><ProgramTag programId={f.programId} /><Mono className="font-semibold text-ink">{code}</Mono><span>{f.city}, {f.district} district</span></div>
                <h3 className="mt-1 font-display text-[19px] font-bold">{f.name || 'Untitled project'}</h3>
                <p className="mt-1 text-[13px]">{draft.scope.summary}</p>
              </div>
              <KV cols={3} items={[
                ['Driver', f.driver], ['Citation', f.citation], ['Proceeding', f.proceeding],
                ['Asset', `${ASSETS.find((a) => a.id === f.asset)!.label} · ${METHOD_LABEL[f.method]}`], ['Line / facility', f.lineId || '—'], ['MAOP', `${f.maopPsig} psig`],
                ['Location', `Class ${f.classLocation} · ${f.terrain}${f.hca ? ' · HCA' : ''}${f.dac ? ' · DAC' : ''}`], ['Sponsor', s.people.find((p) => p.id === f.team.sponsor)?.name], ['Project manager', s.people.find((p) => p.id === f.team.pm)?.name],
              ]} />
              <div className="rounded-md border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <Checkbox checked={f.buildEstimate} onChange={(v) => set('buildEstimate', v)} label={<span className="font-semibold">Build a draft Class 5 rate-table estimate</span>} />
                  <span className="flex items-center gap-2"><ClassBadge cls={estPreview.cls} /><span className="font-display text-[17px] font-bold tabular-nums">{money(estPreview.totals.total)}</span></span>
                </div>
                {f.buildEstimate && (
                  <div className="px-3 py-2">
                    {lines.length === 0 ? <Callout tone="warn">No library rates match this asset and work method. The estimator will build the estimate by hand.</Callout> : (
                      <>
                        <RangeBar low={estPreview.totals.low} point={estPreview.totals.total} high={estPreview.totals.high} />
                        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted"><span>Low {money(estPreview.totals.low)} ({Math.round(CLASS_RANGES[estPreview.cls].low * 100)}%)</span><span>High {money(estPreview.totals.high)} (+{Math.round(CLASS_RANGES[estPreview.cls].high * 100)}%)</span></div>
                        <div className="scroll-x mt-2"><table className="tbl"><thead><tr><th>Library line</th><th className="num">Qty</th><th className="num">Unit P50</th><th className="num">Total</th></tr></thead><tbody>
                          {lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="num">{l.qty.toLocaleString()} {l.unit}</td><td className="num">{money(l.unitCost, 'full')}</td><td className="num">{money(Math.round(l.qty * l.unitCost))}</td></tr>)}
                          <tr><td className="text-muted">Loaders {estPreview.loaders.map((x) => x.pct).reduce((a, b) => a + b, 0).toFixed(1)}% · escalation {estPreview.escalationPct}% · contingency 30%</td><td /><td /><td className="num">{money(estPreview.totals.loaders + estPreview.totals.escalation + estPreview.totals.contingency)}</td></tr>
                        </tbody></table></div>
                      </>
                    )}
                  </div>
                )}
              </div>
              <Checkbox checked={f.startWorkflow} onChange={(v) => set('startWorkflow', v)} label={<span><b>Submit for program screening</b> — starts the Project initiation request workflow (program screening → portfolio planning → sponsor approval).</span>} />
              <Callout tone="info">The project opens at <b>{tpl.stages[0].name}</b> with {defs.length} gate deliverables. Its charter is marked in progress with this record as the first draft. Created by {me.name}; every field is recorded in the audit log.</Callout>
            </div>
          )}
          {problems[step].length > 0 && <div className="mt-4"><Callout tone="warn" title="Before you continue">{problems[step].map((p) => <div key={p}>• {p}</div>)}</Callout></div>}
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => (step === 0 ? go('#projects') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</Button>
            {step < 3 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button> : <Button variant="primary" disabled={problems.some((p) => p.length)} onClick={create}>Create {code}</Button>}
          </div>
        </Panel>

        <aside className="flex flex-col gap-3">
          <Panel title="What happens next">
            <ol className="flex flex-col gap-2.5 text-[13px]">
              {tpl.stages.map((st, i) => (
                <li key={st.id} className="flex gap-2">
                  <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', i === 0 ? 'bg-marker text-markerink' : 'bg-sunken text-muted')}>{i + 1}</span>
                  <span className="min-w-0"><b>{st.name}</b><span className="block text-xs text-muted">{st.gate.name}{st.gate.requiredEstimateClass ? ` · needs Class ${st.gate.requiredEstimateClass}` : ''}{st.gate.budgetEvent ? ` · sets ${st.gate.budgetEvent} budget` : ''}</span></span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Planned milestones">
            <ul className="flex flex-col gap-1 text-[13px]">
              {draft.milestones.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{m.name}</span><span className="shrink-0 tabular-nums text-muted">{m.baseline}</span></li>)}
            </ul>
            <p className="mt-2 text-[11px] text-faint">Indicative dates from typical stage durations; the scheduler sets the baseline at option selection.</p>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function PlacePin({ x, y, onPlace }: { x: number; y: number; onPlace: (x: number, y: number) => void }) {
  return (
    <svg viewBox="0 0 1000 600" className="w-full cursor-crosshair rounded-md border border-line bg-sunken/40" onClick={(e) => {
      const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
      onPlace(Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 600))
    }}>
      {Object.entries(DISTRICTS).map(([n, v]) => (
        <g key={n}>
          <rect x={v.box[0] - 20} y={v.box[1] - 20} width={v.box[2] - v.box[0] + 40} height={v.box[3] - v.box[1] + 40} rx={40} fill="rgb(var(--surface))" stroke="rgb(var(--line))" strokeWidth={2} />
          <text x={(v.box[0] + v.box[2]) / 2} y={v.box[1] + 4} textAnchor="middle" fontSize={22} fontWeight={700} fill="rgb(var(--faint))" letterSpacing="0.12em">{n.toUpperCase()}</text>
        </g>
      ))}
      <path d="M30 420 C 140 410, 220 395, 300 375 S 470 352, 560 320 S 760 268, 980 250" fill="none" stroke="rgb(var(--steel))" strokeOpacity={0.3} strokeWidth={5} />
      <g transform={`translate(${x} ${y})`}><circle r={18} fill="rgb(var(--marker))" fillOpacity={0.35} stroke="rgb(var(--marker))" strokeWidth={3} /><circle r={5} fill="rgb(var(--ink))" /></g>
    </svg>
  )
}

function buildProject(f: Form, code: string, asOf: string, small: boolean): Project {
  const isStation = f.asset === 'compressor-station', isValve = f.asset === 'valve-site'
  const miles = +(f.lengthFt / 5280).toFixed(1)
  const lengthFt = isStation || isValve ? 0 : f.lengthFt
  const quantities = isValve
    ? [{ label: 'Valve sites automated', qty: f.sites, unit: 'ea' }]
    : isStation
      ? [{ label: 'Compressor units', qty: f.method === 'compressor-replacement' ? 4 : 2, unit: 'ea' }, { label: 'Station capacity', qty: f.method === 'compressor-replacement' ? 22000 : 9000, unit: 'hp' }]
      : f.method === 'hydrotest'
        ? [{ label: 'Pipe tested', qty: lengthFt, unit: 'ft' }, { label: 'Test sections', qty: Math.max(2, Math.round(lengthFt / 4200)), unit: 'ea' }]
        : [{ label: 'Pipe installed', qty: lengthFt, unit: 'ft' }, { label: 'Tie-ins', qty: 2, unit: 'ea' }]
  const summary = isValve
    ? `Install remote-control valves with SCADA at ${f.sites} mainline valve site(s) on Line ${f.lineId || '—'} to meet automatic shutoff requirements.`
    : isStation
      ? `${f.method === 'station-rebuild' ? 'Rebuild' : 'Replace compression at'} ${f.city} station with electric-drive units, new substation and controls; decommission legacy units.`
      : f.method === 'hydrotest'
        ? `Pressure test ${miles} miles of ${f.diameterIn}-inch Line ${f.lineId || '—'} to establish MAOP records; replace short sections that cannot be tested.`
        : `Replace ${miles} miles of ${f.diameterIn}-inch ${f.asset === 'distribution-main' ? 'distribution main' : `Line ${f.lineId || '—'}`} through ${f.city} by ${f.method === 'replace-hdd' ? 'horizontal directional drill' : 'open trench'}; abandon existing pipe in place.`
  const durs = small ? [150, 240, 300] : [160, 240, 320, isStation ? 720 : 300, 150]
  const names = small ? ['Plan approved', 'Construction authorized', 'In service & closed'] : ['Business case approved', 'Option selected', 'Construction authorized', 'In service', 'Closeout complete']
  let acc = asOf
  const milestones: Milestone[] = names.map((name, i) => { acc = addDays(acc, durs[i]); return { id: uid('ms'), name, baseline: acc, forecast: acc } })
  if (!small) { const auth = milestones[2].baseline; milestones.splice(3, 0, { id: uid('ms'), name: 'Construction start', baseline: addDays(auth, 30), forecast: addDays(auth, 30) }) }
  const n = code.slice(4)
  const progCode = f.programId.slice(4).toUpperCase()
  return {
    id: `prj-${n}`, code, info: { problemStatement: f.need ?? '' }, name: f.name.trim() || 'Untitled project', programId: f.programId, sizeTier: 'M', driver: f.driver, regulatoryCitation: f.citation, fundingProceeding: f.proceeding,
    location: { district: f.district, city: f.city, county: DISTRICTS[f.district].county, x: f.x, y: f.y, classLocation: f.classLocation, hca: f.hca, dac: f.dac, terrain: f.terrain },
    asset: { type: f.asset, lineId: f.lineId || (isStation ? 'STA-' + f.city.slice(0, 3).toUpperCase() : 'DIST'), diameterIn: isStation ? 0 : f.diameterIn, lengthFt, maopPsig: f.maopPsig, material: f.material, vintage: f.vintage, recordsStatus: f.recordsStatus },
    workMethod: f.method, team: { ...f.team }, stageIndex: 0, status: 'active',
    health: { scope: 'green', schedule: 'green', cost: 'green', risk: 'green', safety: 'green' },
    scope: {
      summary,
      inScope: isStation ? ['Compressor units and motors', 'Substation and interconnect', 'Station piping and controls', 'Demolition of legacy units', 'Air permit compliance']
        : isValve ? ['Valve and actuator installation', 'SCADA RTU and communications', 'Site civil work', 'Commissioning with gas control']
          : ['Engineering, survey and design', 'Land rights and permits', 'Construction and inspection', 'Tie-ins and gas handling', 'Restoration'],
      outOfScope: ['Customer meter work', 'Unrelated leak repairs'],
      quantities,
      assumptions: ['Outage windows available October–April', 'Work hours 7 AM–6 PM weekdays in residential areas'],
    },
    milestones, dates: { initiated: asOf }, erpWbs: `C.${progCode}.${n}`, scheduleId: `P6-${n}`, gisIds: isStation ? [`FAC-${n}`] : [`SEG-${f.lineId || 'NEW'}-001`],
    permitsNeeded: { ceqa: isStation || f.terrain === 'rural', encroachment: !isStation, hydrotestDischarge: f.method === 'hydrotest' },
    customFields: Object.fromEntries(Object.entries(f.custom).filter(([, v]) => v.trim())),
    lastStatusNote: 'Initiated; need submitted for program screening.',
  }
}
