// Translate the existing Messages tool loop to Responses; all project writes still use runTool.
// https://developers.openai.com/api/docs/guides/function-calling (2026-10-06)
export const OPENAI_TAG = 'openai:'
export const OPENAI_MODELS = [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }]
type Json = Record<string, any>
export const resolveOpenaiModel = (id?: string): string => OPENAI_MODELS.find(m => m.id === id)?.id ?? OPENAI_MODELS[0].id

const parts = (blocks: Json[]): Json[] => blocks.flatMap<Json>(b => b.type === 'image'
  ? [{ type: 'input_image', image_url: `data:${b.source.media_type};base64,${b.source.data}` }]
  : b.type === 'text' ? [{ type: 'input_text', text: b.text ?? '' }] : [])

export function toResponses(body: Json): Json {
  const input: Json[] = []
  for (const message of body.messages ?? []) {
    if (typeof message.content === 'string') { input.push({ role: message.role, content: message.content }); continue }
    // Keep complete provider output (including reasoning and phase) in the next tool round.
    const replay = message.content.find((b: Json) => b.type === 'openai_output')
    if (replay) { input.push(...replay.items); continue }
    for (const b of message.content) {
      if (b.type === 'tool_use') input.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })
      else if (b.type === 'tool_result') input.push({ type: 'function_call_output', call_id: b.tool_use_id, output: Array.isArray(b.content) ? parts(b.content) : String(b.content ?? '') })
      else if (b.type === 'text') input.push({ role: message.role, content: b.text ?? '' })
      else if (b.type === 'image') input.push({ role: 'user', content: parts([b]) })
    }
  }
  const tools = (body.tools ?? []).filter((t: Json) => !t.type || t.type === 'custom').map((t: Json) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }))
  return {
    model: resolveOpenaiModel(body.model), store: false, include: ['reasoning.encrypted_content'], input,
    instructions: typeof body.system === 'string' ? body.system : (body.system ?? []).map((b: Json) => b.text ?? '').join('\n\n'),
    max_output_tokens: body.max_tokens,
    ...(body.output_config?.effort ? { reasoning: { effort: body.output_config.effort } } : {}),
    ...(tools.length ? { tools } : {})
  }
}

export function fromResponses(out: Json): Json {
  const output = out.output ?? []
  const content: Json[] = [{ type: 'openai_output', items: output }]
  let refusal = false
  for (const item of output) {
    if (item.type === 'message') for (const b of item.content ?? []) {
      if (b.type === 'output_text') content.push({ type: 'text', text: b.text })
      if (b.type === 'refusal') { refusal = true; content.push({ type: 'text', text: b.refusal }) }
    }
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name) throw Error('OpenAI returned an invalid tool call. No tool was run.')
      let args: unknown
      try { args = JSON.parse(item.arguments) } catch { throw Error('OpenAI returned invalid tool arguments. No tool was run.') }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('OpenAI returned invalid tool arguments. No tool was run.')
      content.push({ type: 'tool_use', id: item.call_id, name: item.name, input: args })
    }
  }
  if (out.status === 'failed' || out.error) throw Error(`OpenAI: ${out.error?.message ?? 'response failed'}`)
  const cached = out.usage?.input_tokens_details?.cached_tokens ?? 0
  return { content, stop_reason: out.status === 'incomplete' ? (out.incomplete_details?.reason === 'content_filter' ? 'refusal' : 'max_tokens') : refusal ? 'refusal' : content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: Math.max(0, (out.usage?.input_tokens ?? 0) - cached), output_tokens: out.usage?.output_tokens ?? 0, cache_read_input_tokens: cached } }
}

export async function postOpenai(key: string, body: Json, signal?: AbortSignal): Promise<Response> {
  const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(toResponses(body)) })
  if (!res.ok) return res
  const out = await res.json() as Json
  return new Response(JSON.stringify(fromResponses(out)), { status: 200, headers: { 'content-type': 'application/json' } })
}

export async function validateLlmKey(provider: 'openai' | 'anthropic', key: string): Promise<{ ok: boolean; error?: string }> {
  if (!key.trim()) return { ok: false, error: 'Enter an API key.' }
  try {
    const headers: Record<string, string> = provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    const res = await fetch(provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models?limit=1', { headers, signal: AbortSignal.timeout(15000) })
    return res.ok ? { ok: true } : { ok: false, error: res.status === 401 ? 'The provider refused this API key.' : `Key check returned HTTP ${res.status}. Check this key’s permissions.` }
  } catch { return { ok: false, error: 'Could not reach the provider. Try checking again.' } }
}
