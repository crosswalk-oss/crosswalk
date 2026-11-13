// Field tailboard (SF-05): phone-first pre-job briefing for the crew, with an offline queue,
// plus a quick observation / near-miss report. Built for gloves and sunlight: big targets, high contrast.
import { prefs } from '@/core/data'
import { useEffect, useMemo, useState } from 'react'
import type { SafetyEvent, Tailboard } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { projectHref } from '@/core/router'
import { fmtDate, uid, cx } from '@/core/util'
import { toast } from '@/ui/toast'
import { logEvent } from './Events'
import { opQualOn, oqLevel, planHazards, ticketLevel } from './lib'

const QKEY = 'crosswalk:field-queue:v1'
const PKEY = 'crosswalk:field-plan:v1'
interface Queued { tailboards: Tailboard[]; events: Omit<SafetyEvent, 'id'>[] }
const readQueue = (): Queued => { try { const r = prefs.getRaw(QKEY); if (r) return JSON.parse(r) } catch { /* storage blocked */ } return { tailboards: [], events: [] } }
const writeQueue = (q: Queued) => { try { prefs.setRaw(QKEY, JSON.stringify(q)) } catch { /* in-memory only */ } }
const readPlan = () => { try { return prefs.getRaw(PKEY) ?? '' } catch { return '' } }
const writePlan = (id: string) => { try { prefs.setRaw(PKEY, id) } catch { /* ignore */ } }

const CTRL = { engineering: 'ENG', administrative: 'ADMIN', ppe: 'PPE' } as const

export default function FieldMode(_props: { projectId?: string; id?: string }) {
  const s = useStore()
  const asOf = s.settings.asOf
  const me = s.people.find((p) => p.id === s.currentUserId)
  const plans = s.safetyPlans.filter((x) => x.status === 'approved' && s.projects.find((p) => p.id === x.projectId)?.status === 'active')
    .sort((a, b) => (s.projects.find((p) => p.id === a.projectId)!.code).localeCompare(s.projects.find((p) => p.id === b.projectId)!.code))
  const defaultPlan = () => {
    const saved = readPlan()
    if (plans.some((x) => x.id === saved)) return saved
    const mine = me?.company ? plans.find((x) => x.contractor === me.company) : undefined
    return (mine ?? plans[0])?.id ?? ''
  }
  const [planId, setPlanId] = useState(defaultPlan)
  const [mode, setMode] = useState<'tailboard' | 'report'>('tailboard')
  const [offline, setOffline] = useState(false)
  const [queue, setQueue] = useState<Queued>(readQueue)
  const plan = plans.find((x) => x.id === planId)
  const p = plan ? s.projects.find((x) => x.id === plan.projectId) : undefined
  useEffect(() => { if (planId) writePlan(planId) }, [planId])
  const pushQueue = (q: Queued) => { setQueue(q); writeQueue(q) }
  const queued = queue.tailboards.length + queue.events.length

  const sync = () => {
    if (offline) { toast('Go back online to sync.', 'bad'); return }
    if (!queued) { toast('Nothing to sync', 'info'); return }
    const q = queue
    mutate((d) => { for (const t of q.tailboards) if (!d.tailboards.some((x) => x.id === t.id)) d.tailboards.push(t) }, { entity: 'tailboard', entityId: q.tailboards[0]?.id ?? 'sync', projectId: q.tailboards[0]?.projectId, action: 'sync', summary: `Synced ${q.tailboards.length} tailboard(s) captured offline` })
    for (const e of q.events) logEvent(e)
    pushQueue({ tailboards: [], events: [] })
    toast(`Synced ${q.tailboards.length} tailboard${q.tailboards.length === 1 ? '' : 's'}${q.events.length ? ` and ${q.events.length} report${q.events.length === 1 ? '' : 's'}` : ''}`)
  }

  return (
    <div className="-mx-4 -my-5 min-h-full bg-ground sm:mx-0 sm:my-0">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-3 pb-10 sm:rounded-lg sm:border-2 sm:border-ink/20">
        {/* Status bar */}
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-steel px-4 py-3 text-steelink sm:rounded-t-lg">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-marker">Field · {fmtDate(asOf)}</div>
            <div className="truncate font-display text-[18px] font-bold text-ink">{p ? `${p.code} · ${plan!.workPackage}` : 'Tailboard'}</div>
          </div>
          <button onClick={() => { setOffline(!offline); toast(offline ? 'Back online' : 'Offline: tailboards will queue on this device', 'info') }}
            className={cx('flex h-11 items-center gap-2 rounded-md border-2 px-3 text-[13px] font-bold', offline ? 'border-warn bg-warn text-white' : 'border-good/70 text-ink')} aria-pressed={offline}>
            <span className={cx('h-2.5 w-2.5 rounded-full', offline ? 'bg-link' : 'bg-good')} />{offline ? 'Offline' : 'Online'}
          </button>
        </div>

        {queued > 0 && (
          <div className="mx-3 flex items-center gap-3 rounded-md border-2 border-warn bg-warn/10 px-3 py-2.5">
            <div className="min-w-0 flex-1 text-[14px] font-semibold">{queue.tailboards.length} tailboard{queue.tailboards.length === 1 ? '' : 's'}{queue.events.length ? ` · ${queue.events.length} report${queue.events.length === 1 ? '' : 's'}` : ''} waiting to sync</div>
            <button onClick={sync} disabled={offline} className="h-11 rounded-md bg-link px-4 text-[14px] font-bold text-surface disabled:opacity-40">Sync now</button>
          </div>
        )}

        <div className="px-3">
          <label className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-muted" htmlFor="field-plan">Job & safety plan</label>
          <select id="field-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className="h-12 w-full rounded-md border-2 border-ink/30 bg-surface px-3 text-[15px] font-semibold text-ink">
            {plans.map((x) => { const pp = s.projects.find((y) => y.id === x.projectId)!; return <option key={x.id} value={x.id}>{pp.code} · {x.workPackage} v{x.version} — {pp.location.city}</option> })}
          </select>
        </div>

        <div className="mx-3 grid grid-cols-2 gap-1 rounded-md bg-sunken p-1">
          {(['tailboard', 'report'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('h-12 rounded text-[15px] font-bold', mode === m ? 'bg-link text-surface' : 'text-muted')}>{m === 'tailboard' ? 'Tailboard' : 'Report observation'}</button>
          ))}
        </div>

        {!plan || !p ? (
          <div className="mx-3 rounded-md border-2 border-dashed border-line p-6 text-center text-[14px] text-muted">No approved safety plans for active jobs. Work cannot start without one.</div>
        ) : mode === 'tailboard' ? (
          <TailboardForm key={plan.id} planId={plan.id} offline={offline} onQueue={(t) => pushQueue({ ...queue, tailboards: [...queue.tailboards, t] })} queuedToday={queue.tailboards.filter((t) => t.planId === plan.id && t.date === asOf).length} />
        ) : (
          <ReportForm key={plan.id + 'r'} planId={plan.id} offline={offline} onQueue={(e) => pushQueue({ ...queue, events: [...queue.events, e] })} onDone={() => setMode('tailboard')} />
        )}

        {p && <a href={projectHref(p.id, 'safety')} className="mx-3 mt-2 text-center text-[13px] font-semibold text-link">Open full project safety record</a>}
      </div>
    </div>
  )
}

function TailboardForm({ planId, offline, onQueue, queuedToday }: { planId: string; offline: boolean; onQueue: (t: Tailboard) => void; queuedToday: number }) {
  const s = useStore()
  const asOf = s.settings.asOf
  const plan = s.safetyPlans.find((x) => x.id === planId)!
  const p = s.projects.find((x) => x.id === plan.projectId)!
  const hazards = planHazards(s, plan)
  const foreman = plan.crew.find((c) => /foreman/i.test(c.role)) ?? plan.crew[0]
  const [leader, setLeader] = useState(foreman?.name ?? '')
  const [covered, setCovered] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(hazards[0]?.id ?? null)
  const [present, setPresent] = useState<Set<string>>(new Set(foreman ? [foreman.name] : []))
  const [visitors, setVisitors] = useState<string[]>([])
  const [visitor, setVisitor] = useState('')
  const [swa, setSwa] = useState(false)
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const today = s.tailboards.filter((t) => t.planId === planId && t.date === asOf)
  const tickets = plan.tickets.map((t) => ({ t, st: ticketLevel(t.expires, asOf) })).filter((x) => x.st.level !== 'ok')
  const expired = tickets.filter((x) => x.st.level === 'bad')
  const extraFor = (id: string) => plan.extraControls.filter((x) => x.hazardId === id)
  const toggle = (set: Set<string>, v: string, f: (x: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); f(n) }
  const attendees = [...plan.crew.map((c) => c.name).filter((n) => present.has(n)), ...visitors.map((v) => `${v} (visitor)`)]
  const missing = [!leader && 'leader', covered.size === 0 && 'hazards', attendees.length === 0 && 'crew sign-in', !swa && 'stop-work reminder'].filter(Boolean) as string[]
  const oqIssues = useMemo(() => !opQualOn(s) ? [] : plan.crew.filter((c) => present.has(c.name) && c.oqTasks.length && oqLevel(c.oqExpires, asOf).level === 'bad'), [plan, present, asOf])

  const submit = () => {
    if (missing.length) { toast(`Still needed: ${missing.join(', ')}`, 'bad'); return }
    const t: Tailboard = {
      id: uid('tb'), planId, projectId: plan.projectId, date: asOf, leader, attendees, hazardsDiscussed: Array.from(covered),
      notes: [notes.trim(), photos.length ? `Photos: ${photos.join(', ')}` : ''].filter(Boolean).join('\n'), stopWorkReminder: swa, offlineCaptured: offline || undefined,
    }
    if (offline) { onQueue(t); toast('Saved on this device. Sync when you have signal.', 'info') }
    else {
      mutate((d) => { d.tailboards.push(t) }, { entity: 'tailboard', entityId: t.id, projectId: t.projectId, action: 'create', summary: `Tailboard ${p.code} ${plan.workPackage}: ${attendees.length} signed in, ${covered.size} hazards, led by ${leader}` })
      toast('Tailboard submitted')
    }
    setCovered(new Set()); setPresent(new Set(foreman ? [foreman.name] : [])); setVisitors([]); setSwa(false); setNotes(''); setPhotos([])
  }

  return (
    <div className="flex flex-col gap-3 px-3">
      {(today.length > 0 || queuedToday > 0) && <div className="rounded-md border-2 border-good bg-good/10 px-3 py-2.5 text-[14px] font-semibold">Today: {today.length + queuedToday} tailboard{today.length + queuedToday > 1 ? 's' : ''} recorded{today[0] ? `, led by ${today[0].leader}` : ''}. Add another for a new crew or a change in conditions.</div>}

      {expired.length > 0 && (
        <div className="rounded-md border-2 border-bad bg-bad px-3 py-3 text-white">
          <div className="text-[16px] font-black uppercase tracking-wide">Do not dig</div>
          {expired.map(({ t, st }) => <div key={t.id} className="text-[14px] font-semibold">{t.type} {t.number}: {st.label.toLowerCase()}</div>)}
        </div>
      )}
      {tickets.filter((x) => x.st.level === 'warn').map(({ t, st }) => <div key={t.id} className="rounded-md border-2 border-warn bg-warn/10 px-3 py-2 text-[14px] font-semibold">{t.type} {t.number}: {st.label.toLowerCase()} — renew now</div>)}

      <Card title="Emergency">
        <div className="grid grid-cols-1 gap-2 text-[15px]">
          <div><span className="text-[12px] font-bold uppercase text-muted">Hospital</span><div className="font-bold">{plan.site.hospital}</div><div className="text-[13px] text-muted">{plan.site.hospitalRoute}</div></div>
          <div><span className="text-[12px] font-bold uppercase text-muted">Muster point</span><div className="font-bold">{plan.site.musterPoint}</div></div>
          <div className="flex flex-wrap gap-2">{plan.site.contacts.map((c) => <a key={c.name + c.role} href={`tel:${c.phone.replace(/\D/g, '')}`} className="flex h-11 items-center rounded-md border-2 border-ink/30 px-3 text-[13px] font-bold">{c.role}: {c.phone}</a>)}</div>
          <div className="flex flex-wrap gap-2">{plan.heatPlan && <span className="rounded bg-warn/20 px-2 py-1 text-[12px] font-bold text-warn">HEAT PLAN IN EFFECT</span>}{plan.trafficPlan && <span className="rounded bg-info/15 px-2 py-1 text-[12px] font-bold text-info">TRAFFIC PLAN</span>}</div>
        </div>
      </Card>

      <Card title="Led by">
        <select value={leader} onChange={(e) => setLeader(e.target.value)} className="h-12 w-full rounded-md border-2 border-ink/30 bg-surface px-3 text-[15px] font-semibold">
          {plan.crew.map((c) => <option key={c.id} value={c.name}>{c.name} — {c.role}</option>)}
        </select>
      </Card>

      <Card title={`Today's hazards · ${covered.size}/${hazards.length} covered`} action={<button onClick={() => setCovered(covered.size === hazards.length ? new Set() : new Set(hazards.map((h) => h.id)))} className="h-9 rounded border-2 border-ink/30 px-3 text-[12px] font-bold">{covered.size === hazards.length ? 'Clear' : 'All covered'}</button>}>
        <div className="flex flex-col gap-2">
          {hazards.map((h) => {
            const on = covered.has(h.id)
            const expanded = open === h.id
            return (
              <div key={h.id} className={cx('overflow-hidden rounded-md border-2', on ? 'border-good' : 'border-line')}>
                <div className="flex items-stretch">
                  <button className="min-w-0 flex-1 px-3 py-2.5 text-left" onClick={() => setOpen(expanded ? null : h.id)} aria-expanded={expanded}>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{h.activity}</div>
                    <div className="text-[16px] font-bold leading-tight">{h.hazard}</div>
                  </button>
                  <button onClick={() => { toggle(covered, h.id, setCovered); if (!on) { const next = hazards.find((x) => x.id !== h.id && !covered.has(x.id)); setOpen(next?.id ?? null) } }}
                    className={cx('flex w-[84px] shrink-0 flex-col items-center justify-center text-[12px] font-black uppercase', on ? 'bg-good text-white' : 'bg-sunken text-muted')} aria-pressed={on}>
                    <span className="text-[22px] leading-none">{on ? '✓' : '○'}</span>{on ? 'Covered' : 'Tap'}
                  </button>
                </div>
                {expanded && (
                  <ul className="flex flex-col gap-1.5 border-t border-line bg-surface px-3 py-2.5 text-[14px]">
                    {h.controls.map((c, i) => <li key={i} className="flex gap-2"><span className="w-[52px] shrink-0 pt-0.5 text-[10px] font-black text-faint">{CTRL[c.type]}</span><span>{c.text}</span></li>)}
                    {extraFor(h.id).map((x, i) => <li key={'x' + i} className="flex gap-2"><span className="w-[52px] shrink-0 pt-0.5 text-[10px] font-black text-ink">SITE</span><span className="font-semibold">{x.text}</span></li>)}
                    {h.permits.length > 0 && <li className="text-[12px] text-muted">Permit: {h.permits.join(', ')}</li>}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title={`Crew sign-in · ${attendees.length}`}>
        <div className="grid grid-cols-2 gap-2">
          {plan.crew.map((c) => {
            const on = present.has(c.name)
            const oq = oqLevel(c.oqExpires, asOf)
            return (
              <button key={c.id} onClick={() => toggle(present, c.name, setPresent)} aria-pressed={on}
                className={cx('flex min-h-[60px] flex-col items-start justify-center rounded-md border-2 px-3 py-2 text-left', on ? 'border-link bg-link text-surface' : 'border-line bg-surface')}>
                <span className="text-[15px] font-bold leading-tight">{on ? '✓ ' : ''}{c.name}</span>
                <span className={cx('text-[11px] font-semibold', on ? 'text-surface/75' : 'text-muted')}>{c.role}{opQualOn(s) && c.oqTasks.length && oq.level === 'bad' ? ' · OQ EXPIRED' : ''}</span>
              </button>
            )
          })}
          {visitors.map((v) => <button key={v} onClick={() => setVisitors(visitors.filter((x) => x !== v))} className="flex min-h-[60px] flex-col items-start justify-center rounded-md border-2 border-info bg-info/10 px-3 py-2 text-left"><span className="text-[15px] font-bold">✓ {v}</span><span className="text-[11px] font-semibold text-muted">Visitor · tap to remove</span></button>)}
        </div>
        {oqIssues.length > 0 && <div className="mt-2 rounded-md border-2 border-bad bg-bad/10 px-3 py-2 text-[13px] font-semibold text-bad">{oqIssues.map((c) => c.name).join(', ')}: operator qualification expired — may not perform covered tasks ({oqIssues.flatMap((c) => c.oqTasks).join(', ')}).</div>}
        <div className="mt-2 flex gap-2">
          <input value={visitor} onChange={(e) => setVisitor(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && visitor.trim()) { setVisitors([...visitors, visitor.trim()]); setVisitor('') } }} placeholder="Visitor name & company" className="h-12 min-w-0 flex-1 rounded-md border-2 border-ink/30 bg-surface px-3 text-[15px]" />
          <button onClick={() => { if (visitor.trim()) { setVisitors([...visitors, visitor.trim()]); setVisitor('') } }} className="h-12 shrink-0 rounded-md border-2 border-ink px-4 text-[14px] font-bold">Add</button>
        </div>
      </Card>

      <button onClick={() => setSwa(!swa)} aria-pressed={swa} className={cx('flex items-center gap-3 rounded-md border-[3px] px-4 py-4 text-left', swa ? 'border-good bg-good/10' : 'border-bad bg-bad/5')}>
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[22px] font-black', swa ? 'bg-good text-white' : 'border-2 border-bad text-bad')}>{swa ? '✓' : '!'}</span>
        <span><span className="block text-[16px] font-black uppercase tracking-wide">Stop-work authority</span><span className="block text-[13px] text-muted">Everyone can stop the job when something changes or a hazard isn't controlled. No blame. Tap when the crew has heard it.</span></span>
      </button>

      <Card title="Notes & photos">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Conditions, changes from yesterday, weather, who is new on site" className="min-h-[90px] w-full rounded-md border-2 border-ink/30 bg-surface px-3 py-2 text-[15px]" />
        <label className="mt-2 flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-ink/40 text-[14px] font-bold">
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { const names = Array.from(e.target.files ?? []).map((f) => f.name); if (names.length) { setPhotos([...photos, ...names]); toast(`${names.length} photo${names.length > 1 ? 's' : ''} attached`, 'info') } e.target.value = '' }} />
          Take or attach photo
        </label>
        {photos.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{photos.map((n, i) => <button key={i} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="rounded border border-line bg-sunken px-2 py-1 font-mono text-[11px]">{n} ✕</button>)}</div>}
      </Card>

      <button onClick={submit} className={cx('h-16 rounded-md text-[18px] font-black uppercase tracking-wide shadow-sm', missing.length ? 'bg-sunken text-muted' : 'bg-marker text-markerink')}>
        {offline ? 'Save tailboard offline' : 'Submit tailboard'}
      </button>
      {missing.length > 0 && <p className="-mt-1 text-center text-[13px] text-muted">Still needed: {missing.join(' · ')}</p>}
    </div>
  )
}

function ReportForm({ planId, offline, onQueue, onDone }: { planId: string; offline: boolean; onQueue: (e: Omit<SafetyEvent, 'id'>) => void; onDone: () => void }) {
  const s = useStore()
  const plan = s.safetyPlans.find((x) => x.id === planId)!
  const [type, setType] = useState<SafetyEvent['type']>('observation')
  const [desc, setDesc] = useState('')
  const [sif, setSif] = useState<boolean | null>(null)
  const [fixed, setFixed] = useState(false)
  const [ca, setCa] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const submit = () => {
    if (!desc.trim()) { toast('Say what you saw.', 'bad'); return }
    if (sif === null) { toast('Answer the SIF question.', 'bad'); return }
    const e: Omit<SafetyEvent, 'id'> = {
      projectId: plan.projectId, planId, date: s.settings.asOf, type, description: desc.trim() + (photos.length ? ` [photos: ${photos.join(', ')}]` : ''), sifPotential: sif,
      correctiveAction: ca.trim() || (fixed ? 'Corrected on site' : 'Reported from field; corrective action to be assigned'), status: fixed ? 'closed' : 'open', contractor: plan.contractor,
    }
    if (offline) { onQueue(e); toast('Report saved on this device', 'info') }
    else { logEvent(e); toast(sif ? 'Reported. Safety advisor notified.' : 'Report submitted') }
    setDesc(''); setSif(null); setFixed(false); setCa(''); setPhotos([])
    onDone()
  }
  const T: { id: SafetyEvent['type']; label: string; cls: string }[] = [
    { id: 'observation', label: 'Observation', cls: 'border-link bg-link text-surface' },
    { id: 'near-miss', label: 'Near miss', cls: 'border-warn bg-warn text-white' },
    { id: 'incident', label: 'Incident', cls: 'border-bad bg-bad text-white' },
  ]
  return (
    <div className="flex flex-col gap-3 px-3">
      <Card title="What kind?">
        <div className="grid grid-cols-3 gap-2">{T.map((t) => <button key={t.id} onClick={() => setType(t.id)} aria-pressed={type === t.id} className={cx('h-14 rounded-md border-2 text-[14px] font-bold', type === t.id ? t.cls : 'border-line bg-surface')}>{t.label}</button>)}</div>
        {type === 'incident' && <p className="mt-2 text-[13px] font-semibold text-bad">Injury or damage: call 911 first if anyone is hurt, then your supervisor and Gas Control.</p>}
      </Card>
      <Card title="What did you see?">
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Spoil pile right at trench edge on the east side" className="min-h-[100px] w-full rounded-md border-2 border-ink/30 bg-surface px-3 py-2 text-[15px]" />
        <label className="mt-2 flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-ink/40 text-[14px] font-bold">
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { const names = Array.from(e.target.files ?? []).map((f) => f.name); if (names.length) setPhotos([...photos, ...names]); e.target.value = '' }} />
          {photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} attached — add more` : 'Take or attach photo'}
        </label>
      </Card>
      <Card title="Could this have killed or seriously hurt someone?">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSif(true)} aria-pressed={sif === true} className={cx('h-14 rounded-md border-2 text-[16px] font-black', sif === true ? 'border-bad bg-bad text-white' : 'border-line bg-surface')}>Yes</button>
          <button onClick={() => setSif(false)} aria-pressed={sif === false} className={cx('h-14 rounded-md border-2 text-[16px] font-black', sif === false ? 'border-link bg-link text-surface' : 'border-line bg-surface')}>No</button>
        </div>
      </Card>
      <Card title="Fixed?">
        <button onClick={() => setFixed(!fixed)} aria-pressed={fixed} className={cx('flex h-14 w-full items-center gap-3 rounded-md border-2 px-3 text-left text-[15px] font-bold', fixed ? 'border-good bg-good/10' : 'border-line bg-surface')}><span className={cx('flex h-8 w-8 items-center justify-center rounded text-[18px]', fixed ? 'bg-good text-white' : 'border-2 border-line')}>{fixed ? '✓' : ''}</span>Corrected on site</button>
        <textarea value={ca} onChange={(e) => setCa(e.target.value)} placeholder="What was done (or needs to be done)" className="mt-2 min-h-[64px] w-full rounded-md border-2 border-ink/30 bg-surface px-3 py-2 text-[15px]" />
      </Card>
      <button onClick={submit} className="h-16 rounded-md bg-marker text-[18px] font-black uppercase tracking-wide text-markerink shadow-sm">{offline ? 'Save report offline' : 'Send report'}</button>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border-2 border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-[13px] font-black uppercase tracking-wide text-ink">{title}</h2>{action}</div>
      {children}
    </section>
  )
}
