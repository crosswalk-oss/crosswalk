// Optional AI assist. Off by default; an administrator points it at the organization's approved LLM
// gateway (any OpenAI-compatible /chat/completions endpoint, e.g. Azure OpenAI behind the API gateway)
// in Configuration → AI assist. When it is off, every AI control is hidden and nothing leaves the page.
// AI only drafts; people review and accept. Every call must come from a user click.
//   const text = await ask(prompt, { onText: t => setDraft(t) })
//   const data = await askJSON<{ risks: … }>(prompt)
import { getState, useStore } from './store'

export class AiError extends Error { constructor(public code: string, message: string, public partial?: string) { super(message) } }

export const AI_MESSAGES: Record<string, string> = {
  unavailable: 'AI assist is turned off. An administrator can connect it in Configuration → AI assist.',
  http: 'The AI service returned an error. Check the endpoint in Configuration → AI assist.',
  rate_limited: 'Too many AI requests at once. Wait a moment and try again.',
  cancelled: 'Stopped.',
}
export const aiMessage = (e: unknown) => (e instanceof AiError ? (e.code === 'http' ? `${AI_MESSAGES.http} (${e.message})` : AI_MESSAGES[e.code] ?? e.message) : 'Something went wrong drafting this. Try again.')

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string }
export interface AiTool { name: string; description: string; inputSchema?: Record<string, unknown>; execute: (input: Record<string, unknown>) => unknown }
export interface AskOptions {
  onText?: (text: string) => void
  signal?: AbortSignal
  tier?: 'quick' | 'default' | 'complex'
  tools?: AiTool[]
  cache?: boolean
}

function config() {
  const a = getState().settings.ai
  if (!a?.enabled || !a.endpoint) throw new AiError('unavailable', AI_MESSAGES.unavailable)
  return a
}

async function complete(messages: Msg[], o: AskOptions, json = false): Promise<Msg> {
  const a = config()
  const body: Record<string, unknown> = { model: a.model || undefined, messages, temperature: 0.2 }
  if (o.tools?.length) body.tools = o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema ?? { type: 'object', properties: {} } } }))
  if (json) body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (a.apiKey) { headers.Authorization = `Bearer ${a.apiKey}`; headers['api-key'] = a.apiKey }
  let r: Response
  try { r = await fetch(a.endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: o.signal }) }
  catch (e: any) { throw new AiError(e?.name === 'AbortError' ? 'cancelled' : 'http', e?.message ?? 'Network error') }
  if (r.status === 429) throw new AiError('rate_limited', AI_MESSAGES.rate_limited)
  if (!r.ok) throw new AiError('http', `${r.status} ${r.statusText}`)
  const j = await r.json()
  const m = j?.choices?.[0]?.message
  if (!m) throw new AiError('http', 'Empty response')
  return m as Msg
}

export async function ask(input: string | { role: 'user' | 'assistant'; content: string }[], o: AskOptions = {}): Promise<string> {
  const messages: Msg[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map((m) => ({ ...m }))
  for (let turn = 0; turn < 6; turn++) {
    const m = await complete(messages, o)
    if (m.tool_calls?.length && o.tools?.length) {
      messages.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })
      for (const c of m.tool_calls) {
        const tool = o.tools.find((t) => t.name === c.function?.name)
        let out: unknown
        try { out = tool ? await tool.execute(JSON.parse(c.function?.arguments || '{}')) : { error: 'unknown tool' } } catch (e: any) { out = { error: e?.message ?? 'tool failed' } }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 60_000) })
      }
      continue
    }
    const text = m.content ?? ''
    o.onText?.(text)
    return text
  }
  throw new AiError('http', 'Too many tool steps')
}

export async function askJSON<T>(prompt: string, o: Omit<AskOptions, 'onText'> = {}): Promise<T> {
  const m = await complete([{ role: 'system', content: 'Reply with a single JSON object only, no prose.' }, { role: 'user', content: prompt }], o, true)
  const raw = (m.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '')
  try { return JSON.parse(raw) as T } catch { throw new AiError('http', 'The AI reply was not valid JSON') }
}

/** true when an administrator has turned AI assist on and configured an endpoint. */
export function useAiAvailable(): boolean {
  return useStore((s) => !!(s.settings.ai?.enabled && s.settings.ai.endpoint))
}
