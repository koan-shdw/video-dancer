// The key lane's wire — every Messages-shaped request the app makes on an API key goes through
// postMessages. An Anthropic key posts to api.anthropic.com exactly as before.
//
// list 14 (VENICE-SPEC-2026-09-08 §6b): the Co-Director's third engine is Claude through VENICE,
// for people who'd rather not pay Anthropic direct. index.ts hands that lane a key tagged
// `venice:<key>` (the tag is ours — it marks which supplier the key belongs to). A tagged request
// is translated to Venice's OpenAI-shaped chat API (docs.venice.ai Chat Completions, read
// 2026-09-30) and the reply is translated back into Messages shape, so the tool loop, RLM,
// COMPACT, the sub-calls and the watch fallback above this line never know the difference.
//   system blocks → one `system` message · image blocks → image_url data URLs · tool_use ↔
//   tool_calls · tool_result ↔ role `tool` messages · max_tokens → max_completion_tokens ·
//   output_config.effort → reasoning_effort (their enum holds the same five names, list 26) ·
//   venice_parameters.include_venice_system_prompt: false (theirs is ON by default).
// Cache marks (cache_control) don't exist on their wire and are dropped; the cached-token counts
// Venice reports ride back in the usual usage fields.
//
// list 35 (2026-10-01): DEEPSEEK on a key is an engine too. DeepSeek serves the Messages shape
// itself (api-docs.deepseek.com/guides/anthropic_api, read that day: base
// https://api.deepseek.com/anthropic, x-api-key, tools + tool_use / tool_result + images
// supported, cache_control ignored), so a key tagged `deepseek:<key>` posts the same body there
// with three fixes: a model name of ours becomes one of theirs, the five effort levels become
// their three (thinking-mode page: low / high / max), and pictures are taken out for the model
// that cannot see them (models & pricing page: V4 Pro has no vision).

import { OPENAI_TAG, postOpenai } from './openaiWire'
export const VENICE_TAG = 'venice:'
export const DEEPSEEK_TAG = 'deepseek:'
const DEEPSEEK_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const DEEPSEEK_BLIND = ['deepseek-v4-pro'] // no vision (their models & pricing page)
const DEEPSEEK_EFFORT: Record<string, string> = { low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' }
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const VENICE_URL = 'https://api.venice.ai/api/v1/chat/completions'

// Venice serves no Haiku (their model list, read 2026-09-30): the sub-calls' cheap-tier default
// rides the cheapest Claude they carry instead of failing on an unknown model
const VENICE_MODEL: Record<string, string> = { 'claude-haiku-4-5': 'claude-sonnet-5' }

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  source?: { media_type?: string; data?: string }
  tool_use_id?: string
  content?: unknown
}
type Body = Record<string, any>

export function toChatCompletions(body: Body): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []
  const system = typeof body.system === 'string' ? body.system : ((body.system ?? []) as Block[]).map((b) => b.text ?? '').join('\n\n')
  if (system) messages.push({ role: 'system', content: system })
  for (const m of (body.messages ?? []) as { role: string; content: string | Block[] }[]) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n\n')
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    // a user turn: every tool result becomes its own `tool` message (in order); the rest is one user message
    const toolImages: Block[] = []
    for (const b of m.content.filter((x) => x.type === 'tool_result')) {
      const blocks = Array.isArray(b.content) ? b.content as Block[] : []
      toolImages.push(...blocks.filter(b => b.type === 'image'))
      messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: blocks.length ? blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n') : typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '') })
    }
    const parts = [...m.content, ...toolImages]
      .filter((b) => b.type === 'text' || b.type === 'image')
      .map((b) => (b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.source?.media_type ?? 'image/png'};base64,${b.source?.data ?? ''}` } } : { type: 'text', text: b.text ?? '' }))
    if (parts.length) messages.push({ role: 'user', content: parts })
  }
  const tools = (body.tools ?? []) as { name: string; description?: string; input_schema?: unknown }[]
  return {
    model: VENICE_MODEL[body.model] ?? body.model,
    messages,
    max_completion_tokens: body.max_tokens,
    ...(body.output_config?.effort ? { reasoning_effort: body.output_config.effort } : {}),
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
    venice_parameters: { include_venice_system_prompt: false }
  }
}

export function fromChatCompletions(out: Body): Record<string, unknown> {
  const choice = out.choices?.[0] ?? {}
  const msg = choice.message ?? {}
  const text: string = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: { text?: string }) => p?.text ?? '').join('') : ''
  const content: Block[] = []
  if (text.trim()) content.push({ type: 'text', text })
  for (const c of (msg.tool_calls ?? []) as { id?: string; function?: { name?: string; arguments?: string } }[]) {
    let input: unknown = {}
    try {
      input = JSON.parse(c.function?.arguments || '{}')
    } catch {
      // arguments that aren't JSON: the tool runs on nothing and answers with its own ERROR, which the model reads
    }
    content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input })
  }
  const cached = Number(out.usage?.prompt_tokens_details?.cached_tokens) || 0
  const fr = choice.finish_reason
  return {
    content,
    stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : fr === 'length' ? 'max_tokens' : fr === 'content_filter' ? 'refusal' : 'end_turn',
    usage: {
      input_tokens: Math.max(0, (Number(out.usage?.prompt_tokens) || 0) - cached), // theirs counts the cached part in; ours keeps it apart
      output_tokens: Number(out.usage?.completion_tokens) || 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: Number(out.usage?.prompt_tokens_details?.cache_creation_input_tokens) || 0
    }
  }
}

export function toDeepseek(body: Body): Body {
  // a name that is not theirs (the sub-calls' cheap-tier default) rides their fast model; they would map it the same way
  const model = typeof body.model === 'string' && body.model.startsWith('deepseek-') ? body.model : 'deepseek-flash'
  const blind = DEEPSEEK_BLIND.includes(model)
  const stripPicture = (b: Block): Block => b.type === 'image' ? { type: 'text', text: '(a picture was attached here — this model cannot see pictures; say so if it matters. DeepSeek Flash can.)' } : b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map(stripPicture) } : b
  const messages = ((body.messages ?? []) as { role: string; content: string | Block[] }[]).map((m) =>
    !blind || typeof m.content === 'string'
      ? m
      : { ...m, content: m.content.map(stripPicture) }
  )
  const { output_config, ...rest } = body
  const effort = DEEPSEEK_EFFORT[output_config?.effort as string]
  return {
    ...rest,
    model,
    messages,
    ...(effort ? { output_config: { effort } } : {}),
    // their side runs none of Anthropic's server tools (web search): only the app's own go
    ...(body.tools ? { tools: (body.tools as { type?: string }[]).filter((t) => !t.type || t.type === 'custom') } : {})
  }
}

// a DeepSeek key is good when their balance read answers (GET /user/balance, free)
export async function validateDeepseekKey(key: string): Promise<{ ok: boolean; error?: string }> {
  if (!key.trim()) return { ok: false, error: 'paste a key first' }
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (res.ok) return { ok: true }
    const out = (await res.json().catch(() => null)) as Body | null
    return { ok: false, error: res.status === 401 ? 'DeepSeek refused this key' : `DeepSeek: ${out?.error?.message ?? `error ${res.status}`}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// One Messages request on a key. The Response is ALWAYS Messages-shaped (status, retry-after and an
// { error: { message } } body on failure included), whichever supplier answered.
export async function postMessages(apiKey: string, body: Body, signal?: AbortSignal): Promise<Response> {
  if (apiKey.startsWith(OPENAI_TAG)) return postOpenai(apiKey.slice(OPENAI_TAG.length), body, signal)
  if (apiKey.startsWith(DEEPSEEK_TAG)) {
    const res = await fetch(DEEPSEEK_URL, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': apiKey.slice(DEEPSEEK_TAG.length), 'anthropic-version': ANTHROPIC_VERSION }, body: JSON.stringify(toDeepseek(body)) })
    if (res.ok) return res
    // their words, named as theirs, with the two fixes that are his to make (their error codes: 401 key, 402 balance)
    const out = (await res.json().catch(() => null)) as Body | null
    const e = out?.error
    const message = `DeepSeek: ${typeof e === 'string' ? e : (e?.message ?? out?.message ?? `error ${res.status}`)}${res.status === 402 ? ' — out of DeepSeek credit: top up on platform.deepseek.com' : res.status === 401 ? ' — check the DeepSeek key in Settings' : ''}`
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const ra = res.headers.get('retry-after')
    if (ra) headers['retry-after'] = ra
    return new Response(JSON.stringify({ error: { message } }), { status: res.status, headers })
  }
  if (!apiKey.startsWith(VENICE_TAG))
    return fetch(ANTHROPIC_URL, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body: JSON.stringify(body) })
  const res = await fetch(VENICE_URL, { method: 'POST', signal, headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey.slice(VENICE_TAG.length)}` }, body: JSON.stringify(toChatCompletions(body)) })
  const out = (await res.json().catch(() => null)) as Body | null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const ra = res.headers.get('retry-after')
  if (ra) headers['retry-after'] = ra
  if (!res.ok || !out) {
    const e = out?.error
    const message = `Venice: ${typeof e === 'string' ? e : (e?.message ?? out?.message ?? `error ${res.status}`)}${res.status === 402 ? ' — out of Venice credit: top up on venice.ai' : res.status === 401 ? ' — check the Venice key in Settings' : ''}`
    return new Response(JSON.stringify({ error: { message } }), { status: res.ok ? 502 : res.status, headers })
  }
  return new Response(JSON.stringify(fromChatCompletions(out)), { status: 200, headers })
}
