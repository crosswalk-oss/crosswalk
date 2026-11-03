// Configuration → AI assist: optional, off by default. Points Crosswalk at the organization's approved LLM gateway.
import { useState } from 'react'
import { mutate, useStore } from '@/core/store'
import type { AiSettings as Ai } from '@/core/types'
import { ask, aiMessage } from '@/core/ai'
import { Button, Callout, Checkbox, Field, Input, Panel } from '@/ui/kit'
import { toast } from '@/ui/toast'

export default function AiSettings() {
  const ai = useStore((s) => s.settings.ai)
  const [d, setD] = useState<Ai>(() => ({ ...ai }))
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = JSON.stringify(d) !== JSON.stringify(ai)
  const save = () => {
    if (d.enabled && !/^https:\/\//i.test(d.endpoint.trim())) { toast('Endpoint must be an https:// URL', 'bad'); return }
    mutate((x) => { x.settings.ai = { ...d, endpoint: d.endpoint.trim() } }, { entity: 'settings', entityId: 'ai', action: 'update', summary: `AI assist ${d.enabled ? `enabled (${d.model || 'default model'})` : 'disabled'}` })
    toast('AI assist settings saved')
  }
  const run = async () => {
    setTest({ ok: true, text: 'Testing…' })
    try { const t = await ask('Reply with the single word: ready'); setTest({ ok: true, text: `Connected — model replied "${t.trim().slice(0, 40)}"` }) }
    catch (e) { setTest({ ok: false, text: aiMessage(e) }) }
  }
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="Optional — off by default">
        AI assist drafts text people then review: monthly status narratives, variance explanations, basis-of-estimate wording, risk and safety-control suggestions, permit conditions and portfolio Q&amp;A. Nothing is accepted without a person.
        When it is off, every AI control is hidden and no project data leaves Crosswalk. Point it at your organization's approved LLM gateway (any OpenAI-compatible chat-completions endpoint, such as Azure OpenAI behind your API gateway).
      </Callout>
      <Panel title="Connection" actions={<><Button size="sm" variant="primary" disabled={!dirty} onClick={save}>Save</Button>{dirty && <Button size="sm" variant="ghost" onClick={() => setD({ ...ai })}>Discard</Button>}</>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Checkbox checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} label="Enable AI assist for all users" /></div>
          <Field label="Chat-completions endpoint" className="md:col-span-2" hint="e.g. https://api.yourutility.com/llm/v1/chat/completions"><Input className="font-mono text-[12px]" value={d.endpoint} onChange={(e) => setD({ ...d, endpoint: e.target.value })} /></Field>
          <Field label="Model / deployment name"><Input value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} /></Field>
          <Field label="API key (pilot only)" hint="Stored in this browser only. Production authenticates through the gateway with the user's SSO token — leave blank."><Input type="password" value={d.apiKey ?? ''} onChange={(e) => setD({ ...d, apiKey: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!ai.enabled || !ai.endpoint || dirty} onClick={run}>Test connection</Button>
          {dirty && <span className="text-[12px] text-faint">Save before testing.</span>}
          {test && <span className={test.ok ? 'text-[12.5px] text-good' : 'text-[12.5px] text-bad'}>{test.text}</span>}
        </div>
      </Panel>
    </div>
  )
}
