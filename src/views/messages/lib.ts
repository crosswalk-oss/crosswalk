// Messaging helpers: channels (project team channels and direct conversations), unread tracking and deep links.
// Deep links use plain hashes the router passes through as the view name:
//   #messages            → the inbox of conversations
//   #messages-1042       → PRJ-1042's team channel (created on first open)
//   #messages-dm-u-pc1   → direct conversation with that person (created on first message)
import type { AppState, Channel, ID, Message } from '@/core/types'
import { nowISO, uid } from '@/core/util'

/** Link to a project's team channel. Accepts 'prj-1042' or 'PRJ-1042'. */
export const messagesHref = (projectIdOrCode?: string) => (projectIdOrCode ? `#messages-${projectIdOrCode.replace(/\D/g, '')}` : '#messages')
/** Link to a direct conversation with a person. */
export const dmHref = (personId: ID) => `#messages-dm-${personId}`

export type MessageTarget = { kind: 'project'; projectId: ID } | { kind: 'direct'; personId: ID } | { kind: 'none' }

/** Parse the router's view name ('messages', 'messages-1042', 'messages-dm-u-pc1'). */
export function parseMessagesView(view: string): MessageTarget {
  const dm = view.match(/^messages-dm-(.+)$/)
  if (dm) return { kind: 'direct', personId: dm[1] }
  const pj = view.match(/^messages-(\d+)$/)
  if (pj) return { kind: 'project', projectId: `prj-${pj[1]}` }
  return { kind: 'none' }
}
export const isMessagesView = (view: string) => view === 'messages' || view.startsWith('messages-')

export const isMember = (c: Channel, me: ID) => c.memberIds.includes(me)
export const channelsFor = (s: Pick<AppState, 'channels'>, me: ID) => s.channels.filter((c) => isMember(c, me))
export const messagesIn = (s: Pick<AppState, 'messages'>, channelId: ID) => s.messages.filter((m) => m.channelId === channelId)
export const isUnread = (m: Message, me: ID) => m.fromId !== me && !m.readBy.includes(me)

export function unreadIn(s: Pick<AppState, 'messages'>, channelId: ID, me: ID): number {
  let n = 0
  for (const m of s.messages) if (m.channelId === channelId && isUnread(m, me)) n++
  return n
}

/** Unread messages across every channel the person belongs to (nav badge). */
export function unreadCount(s: Pick<AppState, 'channels' | 'messages'>, me: ID): number {
  const mine = new Set(channelsFor(s, me).map((c) => c.id))
  let n = 0
  for (const m of s.messages) if (mine.has(m.channelId) && isUnread(m, me)) n++
  return n
}

export const otherMember = (c: Channel, me: ID) => c.memberIds.find((x) => x !== me) ?? me

export function channelTitle(s: Pick<AppState, 'people' | 'projects'>, c: Channel, me: ID): string {
  if (c.kind === 'direct') return s.people.find((p) => p.id === otherMember(c, me))?.name ?? 'Direct message'
  const p = s.projects.find((x) => x.id === c.projectId)
  return p ? `${p.code} · ${p.name}` : c.name
}

export const findProjectChannel = (s: Pick<AppState, 'channels'>, projectId: ID) => s.channels.find((c) => c.kind === 'project' && c.projectId === projectId)
export const findDirect = (s: Pick<AppState, 'channels'>, a: ID, b: ID) =>
  s.channels.find((c) => c.kind === 'direct' && c.memberIds.length === 2 && c.memberIds.includes(a) && c.memberIds.includes(b))

/** Project team channel; created with the project team when missing, and `me` joins it on open. */
export function ensureProjectChannel(d: AppState, projectId: ID, me: ID): Channel | undefined {
  const p = d.projects.find((x) => x.id === projectId)
  if (!p) return
  let c = findProjectChannel(d, projectId)
  if (!c) {
    const members = Array.from(new Set([...(Object.values(p.team).filter(Boolean) as string[]), me]))
    c = { id: uid('ch'), kind: 'project', projectId, memberIds: members, name: `${p.code} team` }
    d.channels.push(c)
  } else if (!c.memberIds.includes(me)) c.memberIds.push(me)
  return c
}

export function ensureDirect(d: AppState, me: ID, other: ID): Channel {
  let c = findDirect(d, me, other)
  if (!c) {
    c = { id: uid('ch'), kind: 'direct', memberIds: [me, other], name: '' }
    d.channels.push(c)
  }
  return c
}

/** Post a message. Direct messages also raise a notification for the recipient. */
export function sendMessage(d: AppState, channelId: ID, fromId: ID, text: string): Message | undefined {
  const c = d.channels.find((x) => x.id === channelId)
  const body = text.trim()
  if (!c || !body) return
  if (!c.memberIds.includes(fromId)) c.memberIds.push(fromId)
  const m: Message = { id: uid('msg'), channelId, fromId, at: nowISO(), text: body, readBy: [fromId] }
  d.messages.push(m)
  const from = d.people.find((p) => p.id === fromId)?.name ?? 'Someone'
  if (c.kind === 'direct') {
    for (const to of c.memberIds.filter((x) => x !== fromId)) d.notifications.push({ id: uid('ntf'), at: m.at, toId: to, text: `${from}: ${body.length > 80 ? body.slice(0, 77) + '…' : body}`, link: dmHref(fromId), read: false, kind: 'message' })
  }
  return m
}

/** Mark every message in a channel read for `me`. Returns how many changed. */
export function markRead(d: AppState, channelId: ID, me: ID): number {
  let n = 0
  for (const m of d.messages) if (m.channelId === channelId && isUnread(m, me)) { m.readBy.push(me); n++ }
  // message notifications for that conversation are read too
  const c = d.channels.find((x) => x.id === channelId)
  if (c?.kind === 'direct') for (const nt of d.notifications) if (nt.toId === me && nt.kind === 'message' && nt.link === dmHref(otherMember(c, me))) nt.read = true
  return n
}

export const lastMessage = (s: Pick<AppState, 'messages'>, channelId: ID): Message | undefined => {
  let last: Message | undefined
  for (const m of s.messages) if (m.channelId === channelId && (!last || m.at > last.at)) last = m
  return last
}
