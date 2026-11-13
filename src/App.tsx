import { useEffect, useMemo, useState } from 'react'
import { useStore, useMe, mutate, getState, personName, useSync } from './core/store'
import { startAppSync } from './core/syncClient'
import { Connecting, PasscodeModal, SyncBanner, SyncStatusChip, useUploadGuard } from './views/shared/SyncUi'
import { go, projectHref, useRoute } from './core/router'
import { tasksFor } from './core/engine/workflow'
import { planReminders, runReminders } from './core/engine/notify'
import { addDays, cx, fmtDate, fmtDateTime, nowISO, uid } from './core/util'
import { Avatar, Badge, BrandMark, Button, Callout, ConfirmButton, Empty, Field, Input, Modal, Select } from './ui/kit'
import { Toaster, toast } from './ui/toast'
import { Icon, type IconName } from './ui/icons'
import { AskPanel } from './views/shared/AskPanel'
import { useAiAvailable } from './core/ai'
import ProjectView from './views/project/ProjectView'
import Portfolio from './views/portfolio/Portfolio'
import Allocation from './views/allocation/Allocation'
import RecordsFiling from './views/records/RecordsFiling'
import Projects from './views/projects/Projects'
import NewProject from './views/projects/NewProject'
import Gates from './views/gates/Gates'
import Estimating from './views/estimating/Estimating'
import Regulatory from './views/regulatory/Regulatory'
import RiskPortfolio from './views/risk/RiskPortfolio'
import SafetyHome from './views/safety/SafetyHome'
import FieldMode from './views/safety/FieldMode'
import Inbox from './views/inbox/Inbox'
import Catalog from './views/workflows/Catalog'
import Designer from './views/workflows/Designer'
import Admin from './views/admin/Admin'
import Planning from './views/planning/Planning'
import Audit from './views/audit/Audit'
import ForecastCycle from './views/forecast/ForecastCycle'
import MapPage from './views/map/MapPage'
import Actuals from './views/actuals/Actuals'
import Messages from './views/messages/Messages'
import { isMessagesView, unreadCount } from './views/messages/lib'
import type { AppState, Person } from './core/types'

const NAV: { group: string; items: { id: string; label: string; icon: IconName }[] }[] = [
  { group: 'Work', items: [
    { id: 'inbox', label: 'My work', icon: 'inbox' },
    { id: 'messages', label: 'Messages', icon: 'chat' },
    { id: 'portfolio', label: 'Portfolio', icon: 'grid' },
    { id: 'allocation', label: 'Capital allocation', icon: 'scale' },
    { id: 'projects', label: 'Projects', icon: 'list' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'gates', label: 'Gate reviews', icon: 'gate' },
  ] },
  { group: 'Controls', items: [
    { id: 'estimating', label: 'Estimating', icon: 'calc' },
    { id: 'forecast', label: 'Forecast cycle', icon: 'chart' },
    { id: 'actuals', label: 'SAP actuals', icon: 'layers' },
    { id: 'filing', label: 'Records filing', icon: 'doc' },
    { id: 'risk', label: 'Risk', icon: 'alert' },
    { id: 'safety', label: 'Safety', icon: 'shield' },
    { id: 'field', label: 'Field tailboard', icon: 'phone' },
    { id: 'regulatory', label: 'Rate case & evidence', icon: 'scale' },
    { id: 'planning', label: 'Portfolio planning', icon: 'layers' },
  ] },
  { group: 'Configure', items: [
    { id: 'workflows', label: 'Workflows', icon: 'flow' },
    { id: 'admin', label: 'Configuration', icon: 'gear' },
    { id: 'audit', label: 'Audit log', icon: 'clock' },
  ] },
]

/** Phase-2 modules hidden for the pilot (settings.features). */
const NAV_FEATURE: Record<string, keyof AppState['settings']['features']> = { field: 'fieldTailboard', planning: 'portfolioPlanning' }
const CHAT_PATH = 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5'

/** Send workflow reminders and escalations that are due (idempotent). */
function remindIfDue() {
  if (planReminders(getState()).length) mutate((d) => { runReminders(d) }, undefined, { background: true })
}

function PhaseTwo({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Empty title={`${name} is a phase 2 module`} action={<a href="#admin-modules"><Button>Configuration → Modules</Button></a>}>It is turned off for the pilot. An administrator can turn it on in Configuration → Modules.</Empty>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const features = useStore((s) => s.settings.features)
  const sync = useSync()
  const [unlockOpen, setUnlockOpen] = useState(false)
  useEffect(() => {
    const s = startAppSync((m) => toast(m, 'info'))
    void s.start().then(remindIfDue)
    return () => s.stop()
  }, [])
  useUploadGuard()
  const [askOpen, setAskOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [route.view, route.id, route.tab])
  const view = (() => {
    switch (route.view) {
      case 'project': return <ProjectView id={route.id!} tab={route.tab} />
      case 'workflow': return <Designer id={route.id} />
      case 'projects': return <Projects />
      case 'new-project': return <NewProject />
      case 'gates': return <Gates />
      case 'estimating': return <Estimating />
      case 'regulatory': return <Regulatory />
      case 'risk': return <RiskPortfolio />
      case 'safety': return <SafetyHome />
      case 'field': return features?.fieldTailboard ? <FieldMode /> : <PhaseTwo name="Field tailboard" />
      case 'inbox': return <Inbox />
      case 'workflows': return <Catalog />
      case 'admin': return <Admin />
      case 'planning': return features?.portfolioPlanning ? <Planning /> : <PhaseTwo name="Portfolio planning" />
      case 'audit': return <Audit />
      case 'forecast': return <ForecastCycle />
      case 'map': return <MapPage />
      case 'actuals': return <Actuals />
      case 'allocation': return <Allocation />
      case 'filing': return <RecordsFiling />
      default:
        if (isMessagesView(route.view)) return <Messages view={route.view} />
        if (route.view.startsWith('admin-')) return <Admin id={route.view.slice(6)} />
        return <Portfolio />
    }
  })()
  if (sync.mode === 'connecting') return <Connecting />
  const activeNav = route.view === 'project' ? 'projects' : route.view === 'workflow' ? 'workflows' : route.view === 'new-project' ? 'projects' : isMessagesView(route.view) ? 'messages' : route.view.startsWith('admin-') ? 'admin' : route.view
  return (
    <div className="flex h-full">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-rail text-railink transition-transform lg:static lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')} style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)' }}>
        <Sidebar active={activeNav} />
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={() => setNavOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setNavOpen(true)} onAsk={() => setAskOpen(true)} onUnlock={() => setUnlockOpen(true)} />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
          <div className="mx-auto max-w-[1440px] py-5 sm:px-2" style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom))' }}><SyncBanner onUnlock={() => setUnlockOpen(true)} />{view}</div>
        </main>
      </div>
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      <PasscodeModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
      <Toaster />
    </div>
  )
}

function Sidebar({ active }: { active: string }) {
  const me = useStore((s) => s.currentUserId)
  const taskCount = useStore((s) => tasksFor(s, me).length)
  const unreadMsgs = useStore((s) => unreadCount(s, me))
  const features = useStore((s) => s.settings.features)
  const org = useStore((s) => s.settings.orgName)
  const asOf = useStore((s) => s.settings.asOf)
  const reset = useStore((s) => s.reset)
  const sync = useSync()
  const sharedView = sync.mode === 'shared' && !sync.canEdit
  return (
    <>
      <a href="#portfolio" className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <BrandMark className="text-surface" />
        <span className="flex flex-col leading-tight"><span className="font-display text-[17px] font-bold tracking-tight text-white">Crosswalk</span><span className="text-[11px] text-railink/70">Capital project delivery</span></span>
      </a>
      <div className="mark-stripe mx-4 mb-3 h-1 rounded-full opacity-80" />
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-railink/60">{g.group}</div>
            {g.items.filter((it) => (!NAV_FEATURE[it.id] || features?.[NAV_FEATURE[it.id]])).map((it) => (
              <a key={it.id} href={`#${it.id}`} className={cx('flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] font-medium', active === it.id ? 'bg-surface text-ink shadow-[inset_3px_0_0_rgb(var(--brand))]' : 'text-railink/90 hover:bg-white/10 hover:text-white')}>
                {it.icon === 'chat'
                  ? <svg viewBox="0 0 24 24" className={cx('h-4 w-4', active === it.id ? 'text-link' : 'text-railink/70')} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={CHAT_PATH} /></svg>
                  : <Icon name={it.icon} className={cx('h-4 w-4', active === it.id ? 'text-link' : 'text-railink/70')} />}
                <span className="flex-1">{it.label}</span>
                {it.id === 'inbox' && taskCount > 0 && <span className="rounded-full bg-marker px-1.5 text-[11px] font-bold tabular-nums text-markerink">{taskCount}</span>}
                {it.id === 'messages' && unreadMsgs > 0 && <span className={cx('rounded-full px-1.5 text-[11px] font-bold tabular-nums', active === it.id ? 'bg-ink/10 text-ink' : 'bg-white/15 text-white')} title={`${unreadMsgs} unread`}>{unreadMsgs}</span>}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="on-rail border-t border-white/10 px-4 py-3 text-[11px] text-railink/70" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="font-semibold text-railink/90">{org}</div>
        <div>{sync.mode === 'shared' ? 'Shared demo data' : 'Demo data'} · as of {fmtDate(asOf)}</div>
        {!sharedView && <div className="mt-2"><ConfirmButton size="sm" variant="ghost" confirmLabel={sync.mode === 'shared' ? 'Reset for everyone' : 'Reset all data'} onConfirm={() => { reset(); toast(sync.mode === 'shared' ? 'Demo data reset for everyone' : 'Demo data reset'); go('#portfolio') }}>Reset demo data</ConfirmButton></div>}
      </div>
    </>
  )
}

function TopBar({ onMenu, onAsk, onUnlock }: { onMenu: () => void; onAsk: () => void; onUnlock: () => void }) {
  const me = useMe()
  const people = useStore((s) => s.people)
  const setUser = useStore((s) => s.setUser)
  const projects = useStore((s) => s.projects)
  const notes = useStore((s) => s.notifications.filter((n) => n.toId === s.currentUserId))
  const update = useStore((s) => s.update)
  const [q, setQ] = useState('')
  const [bell, setBell] = useState(false)
  const hits = useMemo(() => (q.length < 2 ? [] : projects.filter((p) => (p.code + ' ' + p.name + ' ' + p.location.city).toLowerCase().includes(q.toLowerCase())).slice(0, 8)), [q, projects])
  const unread = notes.filter((n) => !n.read).length
  const ai = useAiAvailable()
  return (
    <div className="sticky z-20 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface" style={{ top: 'env(safe-area-inset-top, 0px)', paddingLeft: 'max(12px, env(safe-area-inset-left))', paddingRight: 'max(12px, env(safe-area-inset-right))' }}>
      <button className="rounded p-1.5 text-muted hover:bg-sunken lg:hidden" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" className="h-5 w-5" /></button>
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input id="global-search" className="inp pl-8" placeholder="Find a project by number, name or city" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { go(projectHref(hits[0].id)); setQ('') } }} />
        {hits.length > 0 && (
          <div className="absolute left-0 right-0 top-9 z-30 rounded-md border border-line bg-surface py-1 shadow-xl">
            {hits.map((p) => <a key={p.id} href={projectHref(p.id)} onClick={() => setQ('')} className="flex gap-2 px-3 py-1.5 text-[13px] hover:bg-sunken"><span className="font-mono text-xs font-semibold">{p.code}</span><span className="truncate">{p.name}</span></a>)}
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <SyncStatusChip onUnlock={onUnlock} />
        {ai && <Button variant="marker" size="sm" onClick={onAsk} icon={<span aria-hidden>✦</span>}>Ask</Button>}
        <div className="relative">
          <button onClick={() => setBell(!bell)} className="relative rounded p-1.5 text-muted hover:bg-sunken" aria-label="Notifications"><Icon name="bell" className="h-5 w-5" />{unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread}</span>}</button>
          {bell && (
            <div className="absolute right-0 top-10 z-30 w-80 rounded-md border border-line bg-surface shadow-xl">
              <div className="flex items-center justify-between border-b border-line px-3 py-2"><b className="text-[13px]">Notifications</b><button className="text-xs text-link" onClick={() => update((d) => d.notifications.forEach((n) => { if (n.toId === d.currentUserId) n.read = true }))}>Mark all read</button></div>
              <div className="max-h-80 overflow-y-auto">
                {notes.length === 0 && <div className="px-3 py-4 text-[13px] text-muted">Nothing new.</div>}
                {notes.slice().reverse().slice(0, 30).map((n) => <a key={n.id} href={n.link.startsWith('#') ? n.link : '#inbox'} onClick={() => setBell(false)} className={cx('block border-b border-line/60 px-3 py-2 text-[13px] hover:bg-sunken', !n.read && 'font-semibold')}>{n.text}<div className="text-[11px] font-normal text-faint">{fmtDateTime(n.at)}</div></a>)}
              </div>
            </div>
          )}
        </div>
        <UserMenu me={me} />
        <label className="flex items-center gap-2 rounded border border-line px-1.5 py-1" title="Act as another person to demo routing and approvals">
          <select id="persona" className="max-w-[96px] bg-transparent text-[12px] font-semibold outline-none sm:max-w-[220px]" value={me.id} onChange={(e) => { setUser(e.target.value); toast(`Now acting as ${people.find((p) => p.id === e.target.value)?.name}`, 'info') }}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}{p.company ? ` (${p.company})` : ''}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

const isAway = (p: Person | undefined, asOf: string) => !!p?.outOfOffice && asOf >= p.outOfOffice.from && asOf <= p.outOfOffice.to

/** Avatar menu: who you are, your out-of-office status and who you are covering for. */
function UserMenu({ me }: { me: Person }) {
  const [open, setOpen] = useState(false)
  const [ooo, setOoo] = useState(false)
  const asOf = useStore((s) => s.settings.asOf)
  const people = useStore((s) => s.people)
  const away = isAway(me, asOf)
  const oo = me.outOfOffice
  const scheduled = !!oo && oo.to >= asOf && !away
  const covering = people.filter((p) => p.outOfOffice?.delegateId === me.id && isAway(p, asOf))
  useEffect(() => setOpen(false), [me.id])
  const end = () => {
    mutate((d) => { const p = d.people.find((x) => x.id === me.id); if (p) delete p.outOfOffice }, { entity: 'person', entityId: me.id, action: 'delegate-end', summary: 'Ended out-of-office delegation' })
    toast('Out of office ended — steps route to you again')
    setOpen(false)
  }
  return (
    <div className="relative">
      <button id="user-menu" onClick={() => setOpen(!open)} className="relative flex items-center gap-1.5 rounded p-1 hover:bg-sunken" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${me.name}${away ? ' (out of office)' : ''}`}>
        <Avatar name={me.name} size={24} />
        {away && <span className="hidden rounded-sm bg-warn/15 px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-warn sm:inline">Out of office</span>}
        {(away || covering.length > 0) && <span className={cx('absolute left-5 top-0.5 h-2 w-2 rounded-full border border-surface', away ? 'bg-warn' : 'bg-info')} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-10 z-30 w-[300px] max-w-[calc(100vw-24px)] rounded-md border border-line bg-surface shadow-xl">
            <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
              <Avatar name={me.name} size={32} />
              <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{me.name}</div><div className="truncate text-[11.5px] text-muted">{me.title}{me.company ? ` · ${me.company}` : ''}</div><div className="truncate text-[11px] text-faint">{me.email}</div></div>
            </div>
            <div className="border-b border-line px-3 py-2.5 text-[12.5px]">
              <div className="eyebrow mb-1">Status</div>
              {away ? <div><Badge tone="warn">Out of office</Badge> <span className="text-muted">until {fmtDate(oo!.to)}</span><div className="mt-1 text-muted">{personName(getState(), oo!.delegateId)} is acting for you on workflow steps.</div></div>
                : scheduled ? <div><Badge tone="info">Scheduled</Badge> <span className="text-muted">away {fmtDate(oo!.from)} – {fmtDate(oo!.to)} · {personName(getState(), oo!.delegateId)} covering</span></div>
                  : <div className="text-muted"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-good" />Available — steps route to you</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant={away || scheduled ? 'secondary' : 'primary'} onClick={() => { setOoo(true); setOpen(false) }}>{away || scheduled ? 'Edit out of office' : 'Set out of office…'}</Button>
                {(away || scheduled) && <Button size="sm" variant="ghost" onClick={end}>End</Button>}
              </div>
            </div>
            {covering.length > 0 && (
              <div className="border-b border-line px-3 py-2.5 text-[12.5px]">
                <div className="eyebrow mb-1">Acting for</div>
                {covering.map((p) => <div key={p.id} className="flex items-center gap-2 py-0.5"><Avatar name={p.name} size={18} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="text-[11px] text-faint">to {fmtDate(p.outOfOffice!.to)}</span></div>)}
              </div>
            )}
            <div className="flex flex-col py-1 text-[13px]">
              <a href="#inbox" onClick={() => setOpen(false)} className="px-3 py-1.5 hover:bg-sunken">My work</a>
              <a href="#messages" onClick={() => setOpen(false)} className="px-3 py-1.5 hover:bg-sunken">Messages</a>
            </div>
          </div>
        </>
      )}
      <OutOfOfficeModal open={ooo} onClose={() => setOoo(false)} me={me} />
    </div>
  )
}

function OutOfOfficeModal({ open, onClose, me }: { open: boolean; onClose: () => void; me: Person }) {
  const asOf = useStore((s) => s.settings.asOf)
  const people = useStore((s) => s.people)
  const openSteps = useStore((s) => tasksFor(s, me.id).filter((t) => !t.actingFor).length)
  const [from, setFrom] = useState(asOf)
  const [to, setTo] = useState(addDays(asOf, 7))
  const [delegate, setDelegate] = useState('')
  useEffect(() => {
    if (!open) return
    setFrom(me.outOfOffice?.from ?? asOf); setTo(me.outOfOffice?.to ?? addDays(asOf, 7)); setDelegate(me.outOfOffice?.delegateId ?? '')
  }, [open, me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = people.filter((p) => p.id !== me.id && (!!me.company === !!p.company))
  const sameRole = candidates.filter((p) => p.roles.some((r) => me.roles.includes(r) && r !== 'admin'))
  const dp = people.find((p) => p.id === delegate)
  const loop = dp?.outOfOffice && dp.outOfOffice.delegateId === me.id && dp.outOfOffice.from <= to && dp.outOfOffice.to >= from
  const dpAway = dp?.outOfOffice && dp.outOfOffice.from <= to && dp.outOfOffice.to >= from
  const bad = !delegate || !from || !to || to < from || !!loop
  const save = () => {
    if (bad) return
    mutate((d) => {
      const p = d.people.find((x) => x.id === me.id)!
      p.outOfOffice = { from, to, delegateId: delegate }
      d.notifications.push({ id: uid('ntf'), at: nowISO(), toId: delegate, text: `${me.name} is out of office ${fmtDate(from)} – ${fmtDate(to)} and named you as delegate. Their workflow steps appear in your My work.`, link: '#inbox', read: false, kind: 'info' })
    }, { entity: 'person', entityId: me.id, action: 'delegate', summary: `Out of office ${from} to ${to}; delegate ${dp?.name}` })
    toast(from <= asOf && to >= asOf ? `Out of office — ${dp?.name} is now acting for you` : `Out of office scheduled from ${fmtDate(from)}`)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Out of office"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={bad} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">While you are away, new workflow steps route to your delegate, and the <b className="text-ink">{openSteps}</b> step{openSteps === 1 ? '' : 's'} already waiting on you show in their My work as “acting for {me.name}”. Every action they take is signed by them and recorded as on your behalf.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="From"><Input id="ooo-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input id="ooo-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="Delegate" hint={sameRole.length ? 'People who share one of your roles are listed first.' : undefined}>
          <Select id="ooo-delegate" value={delegate} onChange={(e) => setDelegate(e.target.value)} options={[{ value: '', label: '— Select —' }, ...sameRole.map((p) => ({ value: p.id, label: `${p.name} · ${p.title} (same role)` })), ...candidates.filter((p) => !sameRole.includes(p)).map((p) => ({ value: p.id, label: `${p.name} · ${p.title}` }))]} />
        </Field>
        {to < from && <Callout tone="bad">The end date is before the start date.</Callout>}
        {loop && <Callout tone="bad">{dp!.name} has named you as their delegate for overlapping dates. Pick someone else.</Callout>}
        {!loop && dpAway && <Callout tone="warn">{dp!.name} is also out of office for part of this time ({fmtDate(dp!.outOfOffice!.from)} – {fmtDate(dp!.outOfOffice!.to)}).</Callout>}
        {dp && dp.dollarAuthority < me.dollarAuthority && <Callout tone="warn">{dp.name}'s dollar authority is lower than yours. Steps routed by the DOA matrix still go to someone with enough authority.</Callout>}
        <p className="text-[11.5px] text-faint">Email auto-reply in Outlook is set separately until the mail integration is connected.</p>
      </div>
    </Modal>
  )
}
