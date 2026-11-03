import { renderToString as rts } from 'react-dom/server'
import { getState, mutate, useStore } from '@/core/store'
import { addDays } from '@/core/util'
import { runReminders } from '@/core/engine/notify'
import Messages from './Messages'
import Inbox from '../inbox/Inbox'
import WorkflowSettings from '../admin/WorkflowSettings'
import Modules from '../admin/Modules'
import SafetyHome from '../safety/SafetyHome'
import App from '@/App'
import { channelsFor, ensureDirect, ensureProjectChannel, markRead, parseMessagesView, sendMessage, unreadCount, unreadIn } from './lib'

// zustand renders the initial state on the server; sync it with the live state first
const renderToString = (el: React.ReactElement) => { Object.assign((useStore as any).getInitialState(), useStore.getState()); return rts(el) }

beforeEach(() => { useStore.getState().reset(); useStore.getState().setUser('u-me') })

test('messages helpers: deep links, unread, send and read', () => {
  expect(parseMessagesView('messages-1042')).toEqual({ kind: 'project', projectId: 'prj-1042' })
  expect(parseMessagesView('messages-dm-u-pc1')).toEqual({ kind: 'direct', personId: 'u-pc1' })
  expect(parseMessagesView('messages')).toEqual({ kind: 'none' })
  const s0 = getState()
  expect(channelsFor(s0, 'u-me').length).toBeGreaterThan(1)
  const before = unreadCount(s0, 'u-me')
  expect(before).toBeGreaterThan(0)
  const dm = s0.channels.find((c) => c.kind === 'direct')!
  expect(unreadIn(s0, dm.id, 'u-me')).toBe(1)
  mutate((d) => { markRead(d, dm.id, 'u-me') })
  expect(unreadCount(getState(), 'u-me')).toBe(before - 1)
  // reply goes to Rachel as unread + a notification
  mutate((d) => { sendMessage(d, dm.id, 'u-me', 'Looking at it now.') })
  expect(unreadIn(getState(), dm.id, 'u-pc1')).toBe(1)
  expect(getState().notifications.some((n) => n.toId === 'u-pc1' && n.kind === 'message' && n.link === '#messages-dm-u-me')).toBe(true)
  // a new DM and a new project channel
  mutate((d) => { const c = ensureDirect(d, 'u-me', 'u-est1'); sendMessage(d, c.id, 'u-me', 'Class 5 for 1012?') })
  expect(getState().channels.filter((c) => c.kind === 'direct' && c.memberIds.includes('u-est1'))).toHaveLength(1)
  mutate((d) => { ensureProjectChannel(d, 'prj-1012', 'u-me'); ensureProjectChannel(d, 'prj-1012', 'u-me') })
  const pc = getState().channels.filter((c) => c.projectId === 'prj-1012')
  expect(pc).toHaveLength(1)
  expect(pc[0].memberIds).toContain('u-me')
})

test('messages, my work, configuration and safety render from seed', () => {
  const ch = getState().channels.find((c) => c.kind === 'project')!
  const html = [
    renderToString(<Messages view="messages" />),
    renderToString(<Messages view={`messages-${ch.projectId!.replace(/\D/g, '')}`} />),
    renderToString(<Messages view="messages-dm-u-pc1" />),
    renderToString(<Messages view="messages-dm-u-vp" />),
    renderToString(<WorkflowSettings />),
    renderToString(<Modules />),
    renderToString(<SafetyHome />),
    renderToString(<App />),
  ]
  expect(html[1]).toContain('Project team')
  expect(html[2]).toContain('Rachel Stein')
  expect(html[5]).toContain('Phase 2')
  expect(html[6]).not.toContain('Operator qualifications expiring')
  expect(html[7]).toContain('Messages')
  expect(html[7]).not.toContain('Field tailboard')
  mutate((d) => { d.settings.features.opQual = true; d.settings.features.fieldTailboard = true })
  expect(renderToString(<App />)).toContain('Field tailboard')
})

test('my work shows acting-for and escalation state', () => {
  mutate((d) => { runReminders(d) })
  // Alex is out of office; Rachel (not on Alex's steps) covers
  mutate((d) => { d.people.find((p) => p.id === 'u-me')!.outOfOffice = { from: d.settings.asOf, to: addDays(d.settings.asOf, 5), delegateId: 'u-pc1' } })
  useStore.getState().setUser('u-pc1')
  const html = renderToString(<Inbox />)
  expect(html).toContain('Acting for Avery Morgan')
  // a manager with escalations sees the tab
  useStore.getState().setUser('u-dir3')
  expect(renderToString(<Inbox />)).toContain('Escalated to me')
})
