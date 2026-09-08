// The Bridge INTERPRETER (BRIDGE-SPEC-2026-09-01 §3.5, his ruling) — MCP servers talk like
// chatbots: they answer render requests with questions (preset offers, choices, free-text
// notices) that vary per provider and change over time. When the deterministic adapter does not
// understand a reply, ONE Claude sub-call reads it and answers — the happy path never involves
// an LLM. Rides the existing sub-call service on the Co-Director's lanes (api key or the Claude
// Code bridge), never the cheap tier.
//
// LAWS (enforced in CODE by the calling adapter, not trusted to the model): the interpreter can
// never change the prompt, model, duration/resolution, or spend lane; never call a tool absent
// from the captured tools/list; at most 2 rounds per render, then fail with the server's words.
import { runSubCalls } from '../subcall'
import { emitBridgeDialog } from './index'
import type { Settings } from '@koan/vidancer-ui/shared/types'

let settingsSource: (() => Promise<Settings>) | null = null
export function setInterpreterSettings(fn: () => Promise<Settings>): void {
  settingsSource = fn
}

export interface InterpreterVerdict {
  action: 'call' | 'fail'
  tool?: string
  args?: Record<string, unknown>
  reason?: string // fail: plain words for the queue row
}

const SYSTEM = `You un-block a video render pipeline talking to a creative platform's MCP server.
The server answered a tool call with something the pipeline does not understand — usually an
interactive question meant for a chat user (a preset/style offer, a billing choice, a notice).
Decide the ONE follow-up tool call that continues the render EXACTLY as originally requested,
or declare failure.

Hard rules:
- The render must stay literal: the original prompt, model, duration and settings are law. Never
  accept a preset, style template, rewrite, or upsell. Never opt into spending options; the
  pipeline pays with plan credits only.
- You may only name a tool from the allowed list.
- Reply with STRICT JSON only, no prose: {"action":"call","tool":"<name>","args":{...}} or
  {"action":"fail","reason":"<one plain sentence a user can read>"}.`

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function interpretBridgeReply(opts: {
  service: string
  toolCalled: string
  sentArgs: Record<string, unknown>
  reply: string
  allowedTools: string[]
  onNote?: (msg: string) => void
}): Promise<InterpreterVerdict> {
  if (!settingsSource) return { action: 'fail', reason: 'the provider asked a question the app could not answer' }
  const s = await settingsSource()
  const engine: 'api' | 'bridge' = s.codirEngine === 'bridge' ? 'bridge' : 'api'
  if (engine === 'api' && !s.anthropicKey)
    return { action: 'fail', reason: 'the provider asked a question and no Claude is configured to answer it (Settings → CO-DIRECTOR)' }
  // Co-Director's model picks — never the cheap sub-call default (spec: never a cheap tier)
  const model = engine === 'bridge' ? ((s.codirBridgeModel as string) || 'claude-fable-5') : ((s.codirModel as string) || 'claude-sonnet-5')

  const prompt = [
    `Provider: ${opts.service}`,
    `Tool called: ${opts.toolCalled}`,
    `Arguments sent:\n${JSON.stringify(opts.sentArgs).slice(0, 4000)}`,
    `The server's reply:\n${opts.reply.slice(0, 6000)}`,
    `Allowed tools: ${opts.allowedTools.join(', ')}`
  ].join('\n\n')

  opts.onNote?.(`Claude is answering a ${opts.service} question…`)
  const batch = await runSubCalls([{ id: 'interpret', prompt, system: SYSTEM, model, maxTokens: 1200 }], {
    engine,
    apiKey: s.anthropicKey as string | undefined,
    bridgeModel: model
  })
  const r = batch.results[0]
  console.log(`[bridge-interpreter] ${opts.service}/${opts.toolCalled} → ${r.ok ? r.text?.slice(0, 300) : r.error}`)
  if (!r.ok || !r.text) return { action: 'fail', reason: `the provider asked a question and the answer call failed (${r.error ?? 'empty reply'})` }

  const v = extractJson(r.text)
  if (!v || (v.action !== 'call' && v.action !== 'fail')) return { action: 'fail', reason: 'the provider asked a question and the answer was unreadable' }
  if (v.action === 'fail') {
    const reason = typeof v.reason === 'string' ? v.reason : 'the provider refused this render'
    emitBridgeDialog('claude', opts.service, `we can't continue: ${reason}`, r.text)
    return { action: 'fail', reason }
  }
  const tool = typeof v.tool === 'string' ? v.tool : ''
  if (!opts.allowedTools.includes(tool)) return { action: 'fail', reason: `the answer named a tool the provider does not have (${tool || 'none'})` }
  emitBridgeDialog('claude', opts.service, `I'll handle that — one moment`, r.text)
  return { action: 'call', tool, args: (v.args as Record<string, unknown>) ?? {} }
}
