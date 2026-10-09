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
import { markProviderAccepted } from '../jobNotifications'

// the Co-Director's lane, resolved by index.ts's claudeLane — the engine (API, bridge or Venice),
// its key and the model he picked. One resolver: no model id lives here (list 25).
type Lane = { engine: 'api' | 'bridge'; apiKey?: string; model: string }
let laneSource: (() => Promise<Lane>) | null = null
export function setInterpreterLane(fn: () => Promise<Lane>): void {
  laneSource = fn
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

// A reply with no job id the adapter knows that still READS like a job was made (a job status, or
// "your video was queued / created") is never answered: every adapter sends the same generate call
// again after the interpreter, and the supplier may already have this job, so that would pay twice.
// It fails with their words, marked taken so nothing retries it (audit 2026-10-09 H11).
const JOB_STATUS = /"(?:status|state)"\s*:\s*"(?:queued|pending|processing|in[_ ]?progress|running|submitted|started|generating|created|accepted|throttled|waiting)"/i
const JOB_WORDS = /\b(?:job|task|generation|video|image|render|request)\b[^.]{0,40}\b(?:created|submitted|queued|started|accepted|in progress)\b/i
export function replyMayBeAccepted(reply: string): boolean {
  return JOB_STATUS.test(reply) || JOB_WORDS.test(reply)
}

export async function interpretBridgeReply(opts: {
  service: string
  toolCalled: string
  sentArgs: Record<string, unknown>
  reply: string
  allowedTools: string[]
  onNote?: (msg: string) => void
}): Promise<InterpreterVerdict> {
  if (replyMayBeAccepted(opts.reply)) {
    markProviderAccepted()
    return { action: 'fail', reason: `the reply reads like ${opts.service} took the job, but it carries no job id the app knows, so it is not sent again. Check ${opts.service} before you run it again. Their reply: ${opts.reply.slice(0, 300)}` }
  }
  if (!laneSource) return { action: 'fail', reason: 'the provider asked a question the app could not answer' }
  const lane = await laneSource()
  const engine = lane.engine
  if (engine === 'api' && !lane.apiKey)
    return { action: 'fail', reason: 'the provider asked a question and no Claude is configured to answer it (Settings → CO-DIRECTOR)' }
  // Co-Director's model pick — never the cheap sub-call default (spec: never a cheap tier)
  const model = lane.model

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
    apiKey: lane.apiKey,
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
