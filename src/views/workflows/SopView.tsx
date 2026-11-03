// In-app SOP (WF-11): the same content as the downloadable document, rendered with theme tokens.
import { useMemo, useState } from 'react'
import type { AppState, WorkflowDef } from '@/core/types'
import { ask, aiMessage, useAiAvailable } from '@/core/ai'
import { saveFile } from '@/core/download'
import { fmtDate, fmtDateTime, money } from '@/core/util'
import { AiTag, Badge, Button, Callout, KV, Panel, Section } from '@/ui/kit'
import { toast } from '@/ui/toast'
import { doaMatrixFor, nodeTypeLabel, recordTypeLabel } from './lib'
import { TOKEN_PALETTE, processBrief, raci, revisions, rolesInvolved, sopHtml, stepRows, swimlaneSvg } from './sop'

export function SopView({ s, def, onDownload }: { s: AppState; def: WorkflowDef; onDownload: () => void }) {
  const steps = useMemo(() => stepRows(s, def), [s, def])
  const R = useMemo(() => raci(s, def), [s, def])
  const svg = useMemo(() => swimlaneSvg(s, def, TOKEN_PALETTE, { idPrefix: 'app' }), [s, def])
  const revs = useMemo(() => revisions(s, def), [s, def])
  const m = doaMatrixFor(s)
  const usesDoa = def.nodes.some((n) => n.assignee?.kind === 'doa')
  const owner = s.roles.find((r) => r.id === def.ownerRole)?.name ?? def.ownerRole
  const aiOk = useAiAvailable()
  const [narr, setNarr] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const draft = async () => {
    setBusy(true); setAccepted(false); setNarr('')
    try {
      const prompt = `You write standard operating procedures for a gas utility's capital project delivery organization (${s.settings.orgName}, fictional demo).
Write a plain-language narrative for the SOP of the process below, for project managers and approvers. 3 short paragraphs, no headings, no bullet lists, no markdown:
1) why the control exists and what it protects (tie to regulatory reasonableness review where relevant);
2) how a request moves through the steps, naming who acts and the SLAs, including how returns and any routing rules work;
3) what good looks like for approvers (what to check before e-signing) and what happens to the record on completion.
Use only the facts below. Do not invent steps, people or dollar limits.

${processBrief(s, def)}
${usesDoa && m ? `Dollar authority (${m.name} v${m.version}): ${m.rows.slice().sort((a, b) => a.upTo - b.upTo).map((r) => `${r.upTo >= 1e12 ? 'above' : 'up to ' + money(r.upTo)} → ${r.label}`).join('; ')}` : ''}`
      const t = await ask(prompt, { onText: setNarr })
      setNarr(t.trim())
    } catch (e) { toast(aiMessage(e), 'bad') } finally { setBusy(false) }
  }
  const downloadWithNarrative = async () => {
    const r = await saveFile(`${def.key}-sop-v${def.version}.html`, sopHtml(s, def, accepted ? narr : undefined), 'text/html')
    toast(r === 'saved' ? 'SOP downloaded' : r === 'declined' ? 'Download cancelled' : 'Downloads are not available here', r === 'saved' ? 'good' : 'info')
  }
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Standard operating procedure" subtitle="Generated from the live definition — what you edit in the designer is what this document says."
        actions={<>
          {aiOk && <Button size="sm" disabled={busy} onClick={draft}>{busy ? 'Thinking…' : narr ? 'Redraft narrative' : '✦ Draft SOP narrative'}</Button>}
          <Button size="sm" variant="primary" onClick={accepted && narr ? downloadWithNarrative : onDownload}>Download SOP (HTML)</Button>
        </>}>
        <div className="flex flex-col gap-5">
          <KV cols={4} items={[['Process', <span key="n"><b>{def.name}</b> <span className="font-mono text-[11.5px] text-faint">{def.key}</span></span>], ['Version', <span key="v">v{def.version} <Badge tone={def.status === 'published' ? 'good' : def.status === 'draft' ? 'info' : 'neutral'}>{def.status}</Badge></span>], ['Effective', fmtDate(def.effective)], ['Process owner', owner]]} />
          <Section title="1 · Purpose"><p className="max-w-3xl text-[13.5px]">{def.purpose || <span className="text-muted">No purpose written yet — add it in the designer's Process tab.</span>}</p></Section>
          {narr && (
            <div className="rounded-md border border-info/40 bg-info/5 p-3">
              <div className="mb-1.5 flex items-center gap-2">{!accepted && <AiTag />}<span className="text-[12px] font-semibold">{accepted ? 'Narrative accepted — included in the download' : 'Review before accepting'}</span>
                {!busy && !accepted && <span className="ml-auto flex gap-1"><Button size="sm" variant="primary" onClick={() => { setAccepted(true); toast('Narrative accepted') }}>Accept</Button><Button size="sm" variant="ghost" onClick={() => setNarr('')}>Discard</Button></span>}
              </div>
              {narr.split(/\n{2,}/).map((p, i) => <p key={i} className="mb-2 max-w-3xl text-[13.5px] last:mb-0">{p}</p>)}
            </div>
          )}
          <Section title="2 · Scope">
            <p className="max-w-3xl text-[13.5px]">{def.description}</p>
            <p className="max-w-3xl text-[13px] text-muted">Applies to every {recordTypeLabel(def.recordType).toLowerCase()} routed under <span className="font-mono">{def.key}</span>. Requests finish on the version they started on. Every action is time-stamped; approvals are e-signed after password re-authentication.</p>
          </Section>
          <Section title="3 · Roles">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rolesInvolved(s, def).map((r) => <div key={r.lane} className="rounded border border-line px-3 py-2"><div className="text-[13px] font-semibold">{r.lane}</div><div className="text-[12px] text-muted">{r.duties.join(' · ')}</div></div>)}
            </div>
          </Section>
          <Section title="4 · Swimlane process map">
            <div className="scroll-x rounded border border-line bg-surface p-2" dangerouslySetInnerHTML={{ __html: svg }} />
          </Section>
          <Section title="5 · Procedure">
            <div className="scroll-x">
              <table className="tbl">
                <thead><tr><th>#</th><th>Step</th><th>Who</th><th>SLA</th><th>What they do</th><th>Outcome paths</th></tr></thead>
                <tbody>
                  {steps.map((r) => (
                    <tr key={r.node.id}>
                      <td className="num text-faint">{r.num || ''}</td>
                      <td className="min-w-[160px]"><b>{r.node.label}</b><div><Badge tone={r.node.type === 'approval' ? 'marker' : 'neutral'}>{nodeTypeLabel(r.node.type)}</Badge></div></td>
                      <td className="min-w-[140px]">{r.who}</td>
                      <td className="whitespace-nowrap">{r.sla}</td>
                      <td className="min-w-[220px] text-muted">{r.duty}</td>
                      <td className="min-w-[220px] text-[12px]">{r.outcomes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="6 · RACI matrix">
            <div className="scroll-x">
              <table className="tbl">
                <thead><tr><th>Step</th>{R.cols.map((c) => <th key={c} className="text-center">{c}</th>)}</tr></thead>
                <tbody>{R.rows.map((r) => <tr key={r.label}><td>{r.label}</td>{R.cols.map((c) => <td key={c} className="text-center font-mono font-bold">{r.cells[c] ? <span className={r.cells[c]!.includes('A') ? 'text-ink' : 'text-muted'}>{r.cells[c]}</span> : ''}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-faint">R responsible · A accountable · C consulted · I informed</p>
          </Section>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Section title="7 · Form fields">
              <div className="scroll-x"><table className="tbl"><thead><tr><th>Field</th><th>Key</th><th>Type</th><th>Required</th></tr></thead><tbody>{def.fields.map((f) => <tr key={f.key}><td>{f.label}{f.options?.filter(Boolean).length ? <div className="text-[11.5px] text-faint">{f.options.filter(Boolean).join(', ')}</div> : null}</td><td className="font-mono text-[12px]">{f.key}</td><td>{f.type}</td><td>{f.required ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
            </Section>
            <Section title="8 · Approval authority">
              {usesDoa && m ? (
                <>
                  <p className="text-[12.5px] text-muted">Dollar-authority steps route to the first tier that covers the amount — {m.name} v{m.version}, effective {fmtDate(m.effective)}.</p>
                  <div className="scroll-x"><table className="tbl"><thead><tr><th className="num">Up to</th><th>Approver</th><th>Holders</th></tr></thead><tbody>{m.rows.slice().sort((a, b) => a.upTo - b.upTo).map((r, i, arr) => <tr key={i}><td className="num">{r.upTo >= 1e12 ? `> ${money(arr[i - 1]?.upTo ?? 0)}` : money(r.upTo)}</td><td>{r.label}</td><td className="text-[12px] text-muted">{s.people.filter((p) => p.roles.includes(r.roleId) && !p.company).map((p) => p.name).join(', ')}</td></tr>)}</tbody></table></div>
                </>
              ) : <Callout>This process does not route by dollar amount; approvers are named by role or team position.</Callout>}
            </Section>
          </div>
          <Section title="9 · Revision history">
            <div className="scroll-x"><table className="tbl"><thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Change</th><th>Published</th></tr></thead><tbody>{revs.map((r) => <tr key={r.version}><td className="font-semibold">v{r.version}</td><td><Badge tone={r.status === 'published' ? 'good' : r.status === 'draft' ? 'info' : 'neutral'}>{r.status}</Badge></td><td className="whitespace-nowrap">{fmtDate(r.effective)}</td><td className="text-muted">{r.summary}</td><td className="whitespace-nowrap text-[12px]">{r.at ? `${fmtDateTime(r.at)} · ${s.people.find((p) => p.id === r.by)?.name ?? ''}` : '—'}</td></tr>)}</tbody></table></div>
          </Section>
        </div>
      </Panel>
    </div>
  )
}
