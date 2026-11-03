// Configuration → Workflow notifications: reminder and escalation timing, delivery channels, open escalations.
// The reminder engine (core/engine/notify.ts) runs when Crosswalk opens and from "Send reminders now".
import { useMemo, useState } from 'react'
import type { AppState } from '@/core/types'
import { mutate, personName, useStore } from '@/core/store'
import { openEscalations, planReminders, runReminders, workflowNotifySettings } from '@/core/engine/notify'
import { daysBetween, fmtDate, fmtDateTime } from '@/core/util'
import { Badge, Button, Callout, Checkbox, Field, Input, Panel, Stat, Table } from '@/ui/kit'
import { toast } from '@/ui/toast'

/** Send every reminder that is due now; shared by this tab and the Workflows page. */
export function sendRemindersNow() {
  let r: ReturnType<typeof runReminders> | undefined
  mutate((d) => { r = runReminders(d) })
  const n = r!.reminders + r!.overdue + r!.escalations
  toast(n ? `Sent ${r!.reminders + r!.overdue} reminder${r!.reminders + r!.overdue === 1 ? '' : 's'} and ${r!.escalations} escalation${r!.escalations === 1 ? '' : 's'}` : 'Nothing due — every reminder has already been sent', n ? 'good' : 'info')
}

export default function WorkflowSettings() {
  const s = useStore()
  const cur = workflowNotifySettings(s)
  const [rem, setRem] = useState(String(cur.reminderDays))
  const [esc, setEsc] = useState(String(cur.escalateAfterDays))
  const draft = { reminderDays: Math.max(0, Math.round(Number(rem) || 0)), escalateAfterDays: Math.max(0, Math.round(Number(esc) || 0)) }
  const dirty = draft.reminderDays !== cur.reminderDays || draft.escalateAfterDays !== cur.escalateAfterDays
  const preview = useMemo(() => planReminders({ ...s, settings: { ...s.settings, workflow: draft } } as AppState), [s.workflows, s.people, draft.reminderDays, draft.escalateAfterDays]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: string) => preview.filter((x) => x.kind === k).length
  const escalations = openEscalations(s)
  const log = s.notifications.filter((n) => n.kind === 'reminder' || n.kind === 'escalation').slice().reverse()
  const save = () => {
    mutate((d) => { d.settings.workflow = { ...draft } }, { entity: 'settings', entityId: 'workflow', action: 'update', summary: `Workflow reminders ${draft.reminderDays} day(s) before due; escalate to manager ${draft.escalateAfterDays ? `${draft.escalateAfterDays} day(s) overdue` : 'off'}` })
    toast('Reminder settings saved')
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Reminders and escalation" subtitle="Applies to every workflow step that has an SLA. Each step is reminded and escalated once."
          actions={<>{dirty && <Button size="sm" variant="ghost" onClick={() => { setRem(String(cur.reminderDays)); setEsc(String(cur.escalateAfterDays)) }}>Discard</Button>}<Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save</Button></>}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Remind the assignee" hint="Days before the step is due (0 = on the due date). An overdue notice follows the day after it lapses.">
                <div className="flex items-center gap-2"><Input id="wf-reminder-days" type="number" min={0} max={30} className="w-24 tabular-nums" value={rem} onChange={(e) => setRem(e.target.value)} /><span className="text-[12.5px] text-muted">days before due</span></div>
              </Field>
              <Field label="Escalate to the assignee's manager" hint="Days overdue before the manager is told (0 = never). Recorded in the workflow history.">
                <div className="flex items-center gap-2"><Input id="wf-escalate-days" type="number" min={0} max={60} className="w-24 tabular-nums" value={esc} onChange={(e) => setEsc(e.target.value)} /><span className="text-[12.5px] text-muted">days overdue</span></div>
              </Field>
            </div>
            <div className="rounded-md border border-line bg-sunken/40 px-3 py-2.5 text-[12.5px]">
              <div className="mb-1 font-semibold">{dirty ? 'With these settings, a run today would send' : `Next run as of ${fmtDate(s.settings.asOf)} will send`}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted"><span><b className="tabular-nums text-ink">{count('reminder')}</b> due-soon reminders</span><span><b className="tabular-nums text-ink">{count('overdue')}</b> overdue notices</span><span><b className="tabular-nums text-ink">{count('escalation')}</b> escalations</span></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={dirty} onClick={sendRemindersNow}>Send reminders now</Button>
              <span className="text-[12px] text-faint">{dirty ? 'Save first.' : 'Also runs automatically each time Crosswalk opens.'}</span>
            </div>
          </div>
        </Panel>
        <Panel title="Delivery" subtitle="Where reminders, escalations and messages reach people">
          <div className="flex flex-col gap-3">
            <Checkbox checked disabled onChange={() => undefined} label={<span><b>In Crosswalk</b> — My work, the notification bell and Messages</span>} />
            <div>
              <Checkbox checked={false} disabled onChange={() => undefined} label={<span><b>Email via Outlook</b> <Badge>Needs backend integration</Badge></span>} />
              <p className="ml-6 mt-1 text-[12px] text-muted">Email delivery goes through the organization's Exchange Online tenant (Microsoft Graph sendMail from a service mailbox). It is switched on when the backend integration is connected; until then everything is delivered in Crosswalk only.</p>
            </div>
            <Field label="Sender mailbox (set at integration)"><Input disabled placeholder="crosswalk-notifications@arroyovalleygas.com" /></Field>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open escalations" value={escalations.length} tone={escalations.length ? 'bad' : 'good'} sub="steps escalated and still waiting" />
        <Stat label="Reminders sent" value={log.filter((n) => n.kind === 'reminder').length} sub="all time, all people" />
        <Stat label="Escalations sent" value={log.filter((n) => n.kind === 'escalation').length} />
        <Stat label="Steps with an SLA" value={s.workflows.filter((w) => w.status === 'running').reduce((a, w) => a + w.active.filter((x) => x.due).length, 0)} sub="running now" />
      </div>

      <Panel title="Open escalations" subtitle="Escalated steps that are still waiting on the original assignee" pad={false}>
        <Table rows={escalations} rowKey={(e) => `${e.inst.id}:${e.slot.nodeId}:${e.to}`} maxHeight={360}
          empty={<div className="px-4 py-3 text-[13px] text-muted">No open escalations.</div>}
          columns={[
            { key: 'step', header: 'Step', render: (e) => <span className="whitespace-nowrap font-semibold">{e.stepLabel}</span> },
            { key: 'req', header: 'Request', render: (e) => <span className="block min-w-[220px] text-[12.5px]">{e.inst.title}</span> },
            { key: 'with', header: 'Waiting on', render: (e) => <span className="whitespace-nowrap text-[12.5px]">{e.slot.assigneeIds.filter((x) => !e.slot.actedIds.includes(x)).map((x) => personName(s, x)).join(', ')}</span> },
            { key: 'late', header: 'Overdue', num: true, sort: (e) => daysBetween(e.slot.due ?? s.settings.asOf, s.settings.asOf), render: (e) => <span className="font-semibold text-bad">{daysBetween(e.slot.due ?? s.settings.asOf, s.settings.asOf)} d</span> },
            { key: 'to', header: 'Escalated to', render: (e) => <span className="whitespace-nowrap">{personName(s, e.to)}</span> },
            { key: 'at', header: 'On', sort: (e) => e.at, render: (e) => <span className="whitespace-nowrap">{fmtDate(e.at)}</span> },
          ]} />
      </Panel>

      <Panel title="Reminder log" subtitle="Most recent first" pad={false}>
        <Table rows={log.slice(0, 200)} rowKey={(n) => n.id} maxHeight={360} dense
          empty={<div className="px-4 py-3 text-[13px] text-muted">No reminders sent yet.</div>}
          columns={[
            { key: 'at', header: 'Sent', render: (n) => <span className="whitespace-nowrap text-[12px]">{fmtDateTime(n.at)}</span> },
            { key: 'k', header: 'Type', render: (n) => <Badge tone={n.kind === 'escalation' ? 'bad' : n.text.startsWith('Overdue') ? 'warn' : 'info'}>{n.kind === 'escalation' ? 'Escalation' : n.text.startsWith('Overdue') ? 'Overdue' : 'Reminder'}</Badge> },
            { key: 'to', header: 'To', render: (n) => <span className="whitespace-nowrap">{personName(s, n.toId)}</span> },
            { key: 't', header: 'Notice', render: (n) => <span className="block min-w-[280px] text-[12.5px]">{n.text}</span> },
            { key: 'r', header: 'Read', render: (n) => (n.read ? <span className="text-faint">read</span> : <Badge tone="marker">unread</Badge>) },
          ]} />
      </Panel>
      <Callout tone="info">There is no server in this pilot build, so reminders are evaluated against the demo clock ({fmtDate(s.settings.asOf)}) when Crosswalk opens. In production the same rules run on a schedule in the backend.</Callout>
    </div>
  )
}
