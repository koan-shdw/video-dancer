// SUB-CALLS — the RLM plumbing (CODIRECTOR-RLM-PLAN phase 0, the pre-step). A batch of
// independent questions, each answered in its OWN clean context window: no project snapshot, no
// tools, no history — the prompt carries everything, the reply text is the whole result.
// First consumer: score compose (SCORE-PLAN phase 5 — per-clip digests in parallel, one
// synthesis pass). The co-director rework proper (read tools, digest folding) rides this same
// service at its slot in the build order.
//
// Engine parity: 'api' runs raw Messages calls (same transport hardening as codir.ts — retries,
// watchdog, abort); 'bridge' runs one-shot headless Claude Code CLI exchanges (codirBridge.ts
// bridgeOneShot) so usage rides the user's subscription exactly like Co-Director exchanges.
import { bridgeOneShot } from './codirBridge'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

// mechanical sub-tasks (digests, per-clip reads) default to the cheap tier; callers pass a
// stronger model for synthesis passes. Bridge tasks default to Haiku too — same reasoning,
// subscription-window weight instead of dollars.
export const SUBCALL_DEFAULT_MODEL = 'claude-haiku-4-5'

const API_CONCURRENCY = 4 // parallel Messages requests per batch
const BRIDGE_CONCURRENCY = 2 // CLI spawns are heavy — keep the fan-out modest

export interface SubCallTask {
  id: string // caller's handle — results come back keyed by it
  prompt: string
  system?: string
  model?: string // absent = SUBCALL_DEFAULT_MODEL
  maxTokens?: number // API engine only (the CLI manages its own); default 2000
}

export interface SubCallResult {
  id: string
  ok: boolean
  text?: string
  error?: string
}

export interface SubCallBatchResult {
  ok: boolean // true when every task succeeded
  results: SubCallResult[]
  inputTokens: number
  outputTokens: number
}

export interface SubCallOpts {
  engine: 'api' | 'bridge'
  apiKey?: string // required for 'api'
  bridgeModel?: string // 'bridge': model for tasks that don't name one (default SUBCALL_DEFAULT_MODEL)
  signal?: AbortSignal
}

// one raw Messages call — the transport shape of codir.ts codirSend, minus tools and history
async function apiOne(task: SubCallTask, apiKey: string, signal: AbortSignal | undefined): Promise<SubCallResult & { inputTokens: number; outputTokens: number }> {
  for (let attempt = 0; ; attempt++) {
    const watchdog = AbortSignal.timeout(90_000)
    let res: Response
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        signal: signal ? AbortSignal.any([signal, watchdog]) : watchdog,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
        body: JSON.stringify({
          model: task.model ?? SUBCALL_DEFAULT_MODEL,
          max_tokens: task.maxTokens ?? 2000,
          ...(task.system ? { system: task.system } : {}),
          messages: [{ role: 'user', content: task.prompt }]
        })
      })
    } catch (e) {
      if (signal?.aborted) return { id: task.id, ok: false, error: 'cancelled', inputTokens: 0, outputTokens: 0 }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      return { id: task.id, ok: false, error: watchdog.aborted ? 'sub-call timed out (90s)' : e instanceof Error ? e.message : String(e), inputTokens: 0, outputTokens: 0 }
    }
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) {
      const ra = Number(res.headers.get('retry-after') ?? 0)
      await new Promise((r) => setTimeout(r, Math.min(15000, ra > 0 ? ra * 1000 : 1500 * (attempt + 1))))
      continue
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      return { id: task.id, ok: false, error: body?.error?.message ?? `API error ${res.status}`, inputTokens: 0, outputTokens: 0 }
    }
    const msg = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    const text = msg.content
      .filter((b) => b.type === 'text' && b.text?.trim())
      .map((b) => b.text)
      .join('\n')
      .trim()
    return { id: task.id, ok: !!text, ...(text ? { text } : { error: 'empty reply' }), inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 }
  }
}

// run every task through `run`, at most `limit` in flight — order of results matches tasks
async function pool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await run(items[i])
    }
  })
  await Promise.all(lanes)
  return out
}

export async function runSubCalls(tasks: SubCallTask[], opts: SubCallOpts): Promise<SubCallBatchResult> {
  if (!tasks.length) return { ok: true, results: [], inputTokens: 0, outputTokens: 0 }
  let inputTokens = 0
  let outputTokens = 0
  let results: SubCallResult[]
  if (opts.engine === 'bridge') {
    results = await pool(tasks, BRIDGE_CONCURRENCY, async (t) => {
      const r = await bridgeOneShot({ prompt: t.prompt, system: t.system, model: t.model ?? opts.bridgeModel ?? SUBCALL_DEFAULT_MODEL, signal: opts.signal })
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      return { id: t.id, ok: r.ok, ...(r.text ? { text: r.text } : {}), ...(r.error ? { error: r.error } : {}) }
    })
  } else {
    if (!opts.apiKey) return { ok: false, results: tasks.map((t) => ({ id: t.id, ok: false, error: 'No Anthropic key saved — paste it in Settings first.' })), inputTokens: 0, outputTokens: 0 }
    const apiKey = opts.apiKey
    results = await pool(tasks, API_CONCURRENCY, async (t) => {
      const r = await apiOne(t, apiKey, opts.signal)
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      return { id: r.id, ok: r.ok, ...(r.text ? { text: r.text } : {}), ...(r.error ? { error: r.error } : {}) }
    })
  }
  return { ok: results.every((r) => r.ok), results, inputTokens, outputTokens }
}
