// Messages (#messages): project team channels and direct conversations, kept inside Crosswalk next to the records
// they are about. Unread tracking per person (readBy). Deep links: #messages-1042 (project team), #messages-dm-<person>.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Channel, Message, Person } from '@/core/types'
import { mutate, personName, useMe, useStore } from '@/core/store'
import { go, projectHref } from '@/core/router'
import { cx, fmtDate } from '@/core/util'
import { Avatar, Badge, Button, Empty, Field, Input, Modal, PageHeader, SegButtons, Select, TextArea } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { Icon } from '@/ui/icons'
import { ProgramTag } from '@/views/shared/pickers'
import { channelTitle, channelsFor, dmHref, ensureDirect, ensureProjectChannel, findDirect, findProjectChannel, lastMessage, markRead, messagesHref, messagesIn, otherMember, parseMessagesView, sendMessage, unreadCount, unreadIn } from './lib'

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayOf = (iso: string) => iso.slice(0, 10)

function shortWhen(iso: string, asOf: string) {
  const d = dayOf(iso)
  return d === asOf ? timeOf(iso) : fmtDate(d).replace(/, \d{4}$/, '')
}

const hrefFor = (c: Channel, me: string) => (c.kind === 'project' ? messagesHref(c.projectId) : dmHref(otherMember(c, me)))

export default function Messages({ view = 'messages' }: { view?: string }) {
  const s = useStore()
  const me = useMe()
  const target = parseMessagesView(view)
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const mine = useMemo(() => channelsFor(s, me.id).map((c) => ({ c, last: lastMessage(s, c.id), unread: unreadIn(s, c.id, me.id) }))
    .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '')), [s.channels, s.messages, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the open conversation from the route.
  const projectChannel = target.kind === 'project' ? findProjectChannel(s, target.projectId) : undefined
  const directChannel = target.kind === 'direct' ? findDirect(s, me.id, target.personId) : undefined
  const selected: Channel | undefined = target.kind === 'project' ? projectChannel : target.kind === 'direct' ? directChannel : mine[0]?.c
  const dmPerson = target.kind === 'direct' ? s.people.find((p) => p.id === target.personId) : undefined
  const targetProject = target.kind === 'project' ? s.projects.find((p) => p.id === target.projectId) : undefined

  // Opening a project's team channel creates it (with the project team) or adds you to it.
  useEffect(() => {
    if (target.kind !== 'project' || !targetProject) return
    const c = findProjectChannel(s, target.projectId)
    if (c && c.memberIds.includes(me.id)) return
    mutate((d) => { ensureProjectChannel(d, target.projectId, me.id) }, c ? undefined : { entity: 'channel', entityId: target.projectId, projectId: target.projectId, action: 'create', summary: `Opened the ${targetProject.code} team channel` })
  }, [target.kind === 'project' ? target.projectId : '', me.id, !!targetProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reading a conversation marks it read for you.
  const unreadHere = selected ? unreadIn(s, selected.id, me.id) : 0
  useEffect(() => { if (selected && unreadHere > 0 && selected.memberIds.includes(me.id)) mutate((d) => { markRead(d, selected.id, me.id) }) }, [selected?.id, unreadHere, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = mine.filter(({ c }) => !q || channelTitle(s, c, me.id).toLowerCase().includes(q.toLowerCase()))
  const projects = list.filter((x) => x.c.kind === 'project')
  const directs = list.filter((x) => x.c.kind === 'direct')
  const total = unreadCount(s, me.id)
  const showThread = target.kind !== 'none'
  const threadOpen = !!(selected || dmPerson)

  const row = ({ c, last, unread }: (typeof mine)[number]) => {
    const active = selected?.id === c.id
    const p = c.kind === 'project' ? s.projects.find((x) => x.id === c.projectId) : undefined
    const other = c.kind === 'direct' ? s.people.find((x) => x.id === otherMember(c, me.id)) : undefined
    return (
      <li key={c.id}>
        <a href={hrefFor(c, me.id)} className={cx('flex items-start gap-2.5 border-l-2 px-3 py-2', active ? 'border-marker bg-marker/10' : 'border-transparent hover:bg-sunken/60')}>
          {other ? <Avatar name={other.name} size={28} /> : <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-sunken font-mono text-[10px] font-bold text-muted">#</span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {p && <ProgramTag programId={p.programId} />}
              <span className={cx('min-w-0 truncate text-[13px]', unread ? 'font-bold' : 'font-semibold')}>{p ? p.code : other?.name ?? c.name}</span>
              {last && <span className="ml-auto shrink-0 text-[11px] text-faint">{shortWhen(last.at, s.settings.asOf)}</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cx('min-w-0 flex-1 truncate text-[12px]', unread ? 'text-ink' : 'text-muted')}>{last ? `${last.fromId === me.id ? 'You' : personName(s, last.fromId).split(' ')[0]}: ${last.text}` : p ? p.name : 'No messages yet'}</span>
              {unread > 0 && <span className="shrink-0 rounded-full bg-marker px-1.5 text-[10.5px] font-bold tabular-nums text-markerink">{unread}</span>}
            </span>
          </span>
        </a>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Work" title="Messages"
        subtitle={<>Project team channels and direct conversations, kept with the project record. {total > 0 ? <b className="text-ink">{total} unread.</b> : 'All caught up.'}</>}
        actions={<Button variant="primary" icon={<Icon name="plus" className="h-4 w-4" />} onClick={() => setNewOpen(true)}>New message</Button>} />

      <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-md border border-line bg-surface lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={cx('min-w-0 flex-col border-line lg:flex lg:border-r', showThread ? 'hidden' : 'flex')}>
          <div className="border-b border-line p-2.5"><Input aria-label="Search conversations" placeholder="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" /></div>
          <div className="flex-1 overflow-y-auto lg:max-h-[640px]">
            <div className="eyebrow px-3 pb-1 pt-3">Project channels <span className="font-normal normal-case tracking-normal text-faint">{projects.length}</span></div>
            {projects.length ? <ul>{projects.map(row)}</ul> : <p className="px-3 pb-2 text-[12px] text-muted">Open a project and choose “Message the team”.</p>}
            <div className="eyebrow flex items-center px-3 pb-1 pt-3">Direct messages <span className="ml-1 font-normal normal-case tracking-normal text-faint">{directs.length}</span><button className="ml-auto text-[11.5px] font-semibold normal-case tracking-normal text-link" onClick={() => setNewOpen(true)}>+ New</button></div>
            {directs.length ? <ul>{directs.map(row)}</ul> : <p className="px-3 pb-2 text-[12px] text-muted">No direct conversations yet.</p>}
          </div>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint">Messages are delivered in Crosswalk. Email copies to Outlook need the backend mail integration (Configuration → Workflow notifications).</p>
        </aside>

        <section className={cx('min-w-0 flex-col', showThread ? 'flex' : 'hidden lg:flex')}>
          {threadOpen ? <Thread key={selected?.id ?? dmPerson?.id} s={s} me={me} channel={selected} dmPerson={dmPerson} />
            : target.kind === 'project' && !targetProject ? <div className="p-6"><Empty title="Project not found">That project number does not exist.</Empty></div>
              : <div className="flex flex-1 items-center justify-center p-6"><Empty title="No conversation selected" action={<Button onClick={() => setNewOpen(true)}>Start a conversation</Button>}>Pick a channel on the left, or message anyone in the organization.</Empty></div>}
        </section>
      </div>

      <NewMessage open={newOpen} onClose={() => setNewOpen(false)} s={s} me={me} />
    </div>
  )
}

function Thread({ s, me, channel, dmPerson }: { s: AppState; me: Person; channel?: Channel; dmPerson?: Person }) {
  const [text, setText] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [addId, setAddId] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const msgs = channel ? messagesIn(s, channel.id).slice().sort((a, b) => a.at.localeCompare(b.at)) : []
  const project = channel?.kind === 'project' ? s.projects.find((p) => p.id === channel.projectId) : undefined
  const other = channel?.kind === 'direct' ? s.people.find((p) => p.id === otherMember(channel, me.id)) : dmPerson
  const members = channel ? channel.memberIds.map((id) => s.people.find((p) => p.id === id)).filter((p): p is Person => !!p) : other ? [me, other] : [me]
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }) }, [msgs.length, channel?.id])

  const send = () => {
    const body = text.trim()
    if (!body) return
    mutate((d) => {
      const c = channel ? d.channels.find((x) => x.id === channel.id)! : ensureDirect(d, me.id, other!.id)
      sendMessage(d, c.id, me.id, body)
    }, { entity: 'message', entityId: channel?.id ?? `dm-${other?.id}`, projectId: project?.id, action: 'send', summary: `Message to ${project ? `${project.code} team` : other?.name}: ${body.length > 60 ? body.slice(0, 57) + '…' : body}` })
    setText('')
  }
  const addMember = () => {
    if (!channel || !addId) return
    mutate((d) => { const c = d.channels.find((x) => x.id === channel.id); if (c && !c.memberIds.includes(addId)) c.memberIds.push(addId) },
      { entity: 'channel', entityId: channel.id, projectId: project?.id, action: 'add-member', summary: `Added ${personName(s, addId)} to ${channel.name || 'conversation'}` })
    toast(`${personName(s, addId)} added to the channel`)
    setAddId('')
  }

  // group consecutive messages from the same person within 10 minutes; date dividers between days
  const blocks: { day?: string; head: boolean; m: Message }[] = msgs.map((m, i) => {
    const prev = msgs[i - 1]
    const newDay = !prev || dayOf(prev.at) !== dayOf(m.at)
    const head = newDay || prev.fromId !== m.fromId || Date.parse(m.at) - Date.parse(prev.at) > 10 * 60e3
    return { day: newDay ? dayOf(m.at) : undefined, head, m }
  })

  return (
    <div className="flex min-h-[560px] flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <a href="#messages" className="rounded p-1 text-muted hover:bg-sunken lg:hidden" aria-label="Back to conversations"><Icon name="arrow" className="h-4 w-4 rotate-180" /></a>
        {other && !project && <Avatar name={other.name} size={28} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[15px] font-semibold">{project ? <span className="flex items-center gap-2"><ProgramTag programId={project.programId} /><span className="font-mono">{project.code}</span><span className="truncate">{project.name}</span></span> : other?.name}</h2>
          <div className="truncate text-[11.5px] text-muted">{project ? `Project team · ${members.length} members` : other ? `${other.title}${other.company ? ` · ${other.company}` : ''} · ${other.email}` : ''}</div>
        </div>
        {project && <a href={projectHref(project.id)} className="text-[12px] font-semibold text-link">Open project →</a>}
        {channel && <Button size="sm" variant="ghost" onClick={() => setShowMembers(!showMembers)}>{showMembers ? 'Hide members' : `Members (${members.length})`}</Button>}
      </header>
      {showMembers && channel && (
        <div className="flex flex-col gap-2 border-b border-line bg-sunken/40 px-4 py-2.5">
          <div className="flex flex-wrap gap-1.5">{members.map((p) => <span key={p.id} className="flex items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[12px]"><Avatar name={p.name} size={18} />{p.name}<span className="text-faint">{p.title}</span></span>)}</div>
          {channel.kind === 'project' && (
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Add a member" className="inp h-8 w-auto max-w-full" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Add someone to this channel…</option>
                {s.people.filter((p) => !channel.memberIds.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.title}{p.company ? ` (${p.company})` : ''}</option>)}
              </select>
              <Button size="sm" disabled={!addId} onClick={addMember}>Add</Button>
            </div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 lg:max-h-[540px]">
        {msgs.length === 0 && <div className="py-10"><Empty title={project ? `Start the ${project.code} team conversation` : `Message ${other?.name ?? ''}`}>{project ? 'Everyone on the project team sees what you post here.' : 'Only the two of you see this conversation.'}</Empty></div>}
        {blocks.map(({ day, head, m }) => (
          <div key={m.id}>
            {day && <div className="my-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-faint"><span className="h-px flex-1 bg-line" />{day === s.settings.asOf ? 'Today' : fmtDate(day)}<span className="h-px flex-1 bg-line" /></div>}
            <div className={cx('group flex gap-2.5 rounded px-1 hover:bg-sunken/40', head ? 'mt-2 pt-1' : 'mt-0')}>
              <div className="w-8 shrink-0">{head && <Avatar name={personName(s, m.fromId)} size={30} />}</div>
              <div className="min-w-0 flex-1 pb-0.5">
                {head && <div className="flex flex-wrap items-baseline gap-x-2"><b className="text-[13px]">{m.fromId === me.id ? 'You' : personName(s, m.fromId)}</b><span className="text-[11px] text-faint">{s.people.find((p) => p.id === m.fromId)?.title}</span><span className="text-[11px] text-faint">{timeOf(m.at)}</span></div>}
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{m.text}</p>
              </div>
            </div>
          </div>
        ))}
        {msgs.length > 0 && (() => {
          const last = msgs[msgs.length - 1]
          const seen = last.readBy.filter((x) => x !== last.fromId).map((x) => (x === me.id ? 'you' : personName(s, x).split(' ')[0]))
          return last.fromId === me.id ? <div className="mt-1 pl-11 text-[11px] text-faint">{seen.length ? `Seen by ${seen.join(', ')}` : 'Delivered'}</div> : null
        })()}
        <div ref={bottom} />
      </div>
      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send() }}>
        <TextArea id="message-text" aria-label="Message" rows={2} className="min-h-[44px] flex-1 resize-none" placeholder={project ? `Message the ${project.code} team` : `Message ${other?.name ?? ''}`} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <Button type="submit" variant="primary" disabled={!text.trim()}>Send</Button>
      </form>
    </div>
  )
}

function NewMessage({ open, onClose, s, me }: { open: boolean; onClose: () => void; s: AppState; me: Person }) {
  const [mode, setMode] = useState<'direct' | 'project'>('direct')
  const [q, setQ] = useState('')
  const [projectId, setProjectId] = useState('')
  useEffect(() => { if (open) { setQ(''); setProjectId('') } }, [open])
  const people = s.people.filter((p) => p.id !== me.id && (!q || `${p.name} ${p.title} ${p.company ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const pick = (href: string) => { onClose(); go(href) }
  return (
    <Modal open={open} onClose={onClose} title="New message"
      footer={mode === 'project' ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!projectId} onClick={() => pick(messagesHref(projectId))}>Open team channel</Button></> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="flex flex-col gap-3">
        <SegButtons<'direct' | 'project'> value={mode} onChange={setMode} options={[{ id: 'direct', label: 'Direct message' }, { id: 'project', label: 'Project team' }]} />
        {mode === 'direct' ? (
          <>
            <Input autoFocus aria-label="Find a person" placeholder="Find a person by name, title or company" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-[320px] overflow-y-auto rounded border border-line">
              {people.map((p) => {
                const existing = findDirect(s, me.id, p.id)
                return (
                  <li key={p.id} className="border-b border-line/60 last:border-0">
                    <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken/60" onClick={() => pick(dmHref(p.id))}>
                      <Avatar name={p.name} size={26} />
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{p.name}</span><span className="block truncate text-[11.5px] text-muted">{p.title}{p.company ? ` · ${p.company}` : ''}</span></span>
                      {existing && <Badge>open</Badge>}
                    </button>
                  </li>
                )
              })}
              {!people.length && <li className="px-3 py-3 text-[13px] text-muted">No one matches.</li>}
            </ul>
          </>
        ) : (
          <Field label="Project" hint="Opens the project's team channel. You are added to it if you are not on the team."><Select value={projectId} onChange={(e) => setProjectId(e.target.value)} options={[{ value: '', label: '— Select a project —' }, ...s.projects.filter((p) => p.status !== 'closed').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}${findProjectChannel(s, p.id) ? '' : ' (new channel)'}` }))]} /></Field>
        )}
      </div>
    </Modal>
  )
}
