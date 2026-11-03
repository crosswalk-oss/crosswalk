// "Ask the portfolio" (AI-01): the organization's AI assist answers from project records through read-only page tools.
import { useRef, useState } from 'react'
import { getState, personName } from '@/core/store'
import { ask, aiMessage, useAiAvailable } from '@/core/ai'
import { position } from '@/core/engine/position'
import { readiness, stageName } from '@/core/engine/gates'
import { isActive, riskScore } from '@/core/engine/risk'
import { money } from '@/core/util'
import { AiTag, Button, Drawer, TextArea, Callout } from '@/ui/kit'
import { projectHref } from '@/core/router'

const RULES = `You are the portfolio assistant inside Crosswalk, a capital-project platform for a gas utility (Arroyo Valley Gas; all data is a fictional demo).
Answer ONLY from the tool results. Call tools as needed. Cite project codes like PRJ-1042. Use $M with one decimal for money. Keep answers short: a direct answer first, then up to 6 bullets. If the data cannot answer, say what is missing.`

function tools() {
  const s = getState()
  const row = (p: (typeof s.projects)[number]) => {
    const pos = position(s, p.id)
    return { code: p.code, name: p.name, program: s.programs.find((x) => x.id === p.programId)?.code, stage: stageName(s, p), status: p.status, pm: personName(s, p.team.pm), budget: money(pos.currentBudget), eac: money(pos.eac), actual: money(pos.actualToDate), contingencyLeft: money(pos.contingencyRemaining), riskExposure: money(pos.riskExposure), health: p.health }
  }
  return [
    {
      name: 'list_projects', description: 'List projects with stage, budget, forecast (EAC), actuals, contingency, risk exposure and RAG health. Optional filters: program code (PSE, TIM, DRP, CSM, VAP), status, health dimension "cost"|"schedule"|"risk" equal to "red"|"amber".',
      inputSchema: { type: 'object', properties: { program: { type: 'string' }, status: { type: 'string' }, healthDim: { type: 'string' }, healthIs: { type: 'string' } } },
      execute: (i: Record<string, unknown>) => s.projects.filter((p) => (!i.program || s.programs.find((x) => x.id === p.programId)?.code === String(i.program).toUpperCase()) && (!i.status || p.status === i.status) && (!i.healthDim || (p.health as any)[String(i.healthDim)] === i.healthIs)).map(row),
    },
    {
      name: 'get_project', description: 'Full detail for one project by code (e.g. PRJ-1042): scope, milestones, gate readiness, top risks, changes, variances, safety summary.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      execute: (i: Record<string, unknown>) => {
        const p = s.projects.find((x) => x.code.toLowerCase() === String(i.code).toLowerCase())
        if (!p) throw new Error('No project with that code')
        const r = readiness(s, p)
        return {
          ...row(p), scope: p.scope.summary, milestones: p.milestones.map((m) => ({ name: m.name, baseline: m.baseline, forecast: m.forecast, actual: m.actual })),
          gateReadiness: { pct: r.pct, blockers: r.blockers },
          topRisks: s.risks.filter((x) => x.projectId === p.id && isActive(x)).sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 6).map((x) => ({ code: x.code, title: x.title, score: riskScore(x), ml: money(x.cost.ml), status: x.status })),
          changes: s.changes.filter((c) => c.projectId === p.id).map((c) => ({ code: c.code, title: c.title, cost: money(c.costImpact), status: c.status, rootCause: c.rootCause })),
          variances: s.variances.filter((v) => v.projectId === p.id).map((v) => ({ description: v.description, status: v.status, narrative: v.narrative })),
          safety: { plans: s.safetyPlans.filter((x) => x.projectId === p.id).map((x) => `${x.workPackage} v${x.version} ${x.status}`), openEvents: s.safetyEvents.filter((e) => e.projectId === p.id && e.status === 'open').length },
        }
      },
    },
    {
      name: 'portfolio_totals', description: 'Totals by program: count of projects, budget, EAC, actual to date, and authorized funding for the current year.',
      execute: () => s.programs.map((pr) => {
        const ps = s.projects.filter((p) => p.programId === pr.id)
        const pos = ps.map((p) => position(s, p.id))
        return { program: pr.code, name: pr.name, projects: ps.length, budget: money(pos.reduce((a, x) => a + x.currentBudget, 0)), eac: money(pos.reduce((a, x) => a + x.eac, 0)), actual: money(pos.reduce((a, x) => a + x.actualToDate, 0)), authorized2026: money(s.funding.find((f) => f.programId === pr.id && f.year === 2026)?.authorized ?? 0) }
      }),
    },
  ]
}

const SUGGESTIONS = ['Which projects are forecast over budget, and why?', 'What is blocking gate readiness on the PSE program?', 'Summarize contingency remaining by program.', 'Which construction projects have open safety items?']

export function AskPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ok = useAiAvailable()
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const ctl = useRef<AbortController | null>(null)
  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const next = [...turns, { role: 'user' as const, content: text }]
    setTurns(next); setQ(''); setBusy(true); setDraft('Thinking…')
    ctl.current = new AbortController()
    try {
      const answer = await ask([{ role: 'user', content: RULES }, { role: 'assistant', content: 'Understood.' }, ...next], { onText: setDraft, signal: ctl.current.signal, tools: tools(), cache: false })
      setTurns([...next, { role: 'assistant', content: answer }])
    } catch (e) {
      setTurns([...next, { role: 'assistant', content: aiMessage(e) }])
    } finally { setBusy(false); setDraft('') }
  }
  const linkify = (t: string) => t.split(/(PRJ-\d{4})/g).map((part, i) => (/^PRJ-\d{4}$/.test(part) ? <a key={i} className="font-mono font-semibold text-link underline-offset-2 hover:underline" href={projectHref(part)} onClick={onClose}>{part}</a> : <span key={i}>{part}</span>))
  return (
    <Drawer open={open} onClose={onClose} title={<span className="flex items-center gap-2">Ask the portfolio <AiTag>AI assist</AiTag></span>} width={560}
      footer={<form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); send(q) }}><TextArea id="ask-q" className="min-h-[40px] flex-1" placeholder="Ask about budgets, gates, risks, safety…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q) } }} />{busy ? <Button onClick={() => ctl.current?.abort()}>Stop</Button> : <Button variant="primary" type="submit">Ask</Button>}</form>}>
      {!turns.length && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">The assistant reads the live project records through read-only tools and answers with project codes you can click.</p>
          {SUGGESTIONS.map((x) => <button key={x} onClick={() => send(x)} className="rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-ink/40 hover:bg-sunken">{x}</button>)}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'self-end rounded-md bg-ink px-3 py-2 text-[13px] text-surface' : 'whitespace-pre-wrap rounded-md border border-line bg-sunken/50 px-3 py-2 text-[13px]'}>{t.role === 'assistant' ? linkify(t.content) : t.content}</div>
        ))}
        {busy && <div className="whitespace-pre-wrap rounded-md border border-line bg-sunken/50 px-3 py-2 text-[13px] text-muted">{linkify(draft)}</div>}
      </div>
    </Drawer>
  )
}
