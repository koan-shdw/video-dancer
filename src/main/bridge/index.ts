// BRIDGE manager — owns the six MCP logins (BRIDGE-SPEC-2026-09-01). One McpClient per
// logged-in service, tokens persisted through the settings secret lane (encrypted at rest),
// tools/list captured verbatim on every connect (the "their language" artifact the probes and
// adapters are built from), balance read where a documented tool exists.
//
// Stage 1 scope (spec §7): login/logout/status + capture + balance. Render adapters and the
// BRIDGE router arrive with the probes — nothing here renders or spends.

import { app } from 'electron'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { BRIDGE_SERVICES, bridgeService, type BridgeServiceId } from './services'
import { McpClient, BridgeAuthError, type McpTool } from './mcpClient'
import { bridgeLogin, bridgeRefresh, type BridgeAuth } from './oauth'
import type { BridgeRow } from '@koan/vidancer-ui/shared/types'

// injected by main/index.ts — settings live there; the JSON string rides the SECRET_KEYS lane
interface AuthStore {
  load: () => Promise<string | undefined>
  save: (json: string) => Promise<void>
}

interface ServiceState {
  auth?: BridgeAuth
  client?: McpClient
  tools?: McpTool[]
  balance?: number
  balanceTotal?: number // plan allowance when reported (Magnific credits.totalPlan) — meter fill
  highWater?: number // highest balance ever seen — the honest fill denominator when no plan total exists
  busy: boolean
  error?: string
}

let store: AuthStore | null = null
let onChanged: (() => void) | null = null
const state = new Map<BridgeServiceId, ServiceState>()
for (const s of BRIDGE_SERVICES) state.set(s.id, { busy: false })

const notify = (): void => onChanged?.()

export async function initBridge(authStore: AuthStore, changed: () => void): Promise<void> {
  store = authStore
  onChanged = changed
  try {
    const raw = await authStore.load()
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<BridgeServiceId, BridgeAuth>>
      for (const s of BRIDGE_SERVICES) {
        const a = saved[s.id]
        if (a?.accessToken) state.get(s.id)!.auth = a
      }
    }
  } catch (e) {
    console.error('[bridge] stored logins unreadable — starting logged out:', e instanceof Error ? e.message : e)
  }
  // high-water marks survive restarts (a small sidecar next to the tool captures)
  try {
    const raw = JSON.parse(await readFile(highWaterFile(), 'utf-8')) as Partial<Record<BridgeServiceId, number>>
    for (const s of BRIDGE_SERVICES) if (typeof raw[s.id] === 'number') state.get(s.id)!.highWater = raw[s.id]
  } catch {
    // first run — no marks yet
  }
  // stored logins reconnect lazily in the background — balance + tool capture refresh on their own
  for (const s of BRIDGE_SERVICES) if (state.get(s.id)!.auth) void refreshService(s.id)
}

const highWaterFile = (): string => join(app.getPath('userData'), 'bridge-tools', 'highwater.json')
async function persistHighWater(): Promise<void> {
  const out: Partial<Record<BridgeServiceId, number>> = {}
  for (const [id, st] of state) if (st.highWater !== undefined) out[id] = st.highWater
  try {
    await mkdir(join(app.getPath('userData'), 'bridge-tools'), { recursive: true })
    await writeFile(highWaterFile(), JSON.stringify(out), 'utf-8')
  } catch (e) {
    console.error('[bridge] high-water save failed:', e instanceof Error ? e.message : e)
  }
}

async function persist(): Promise<void> {
  if (!store) return
  const out: Partial<Record<BridgeServiceId, BridgeAuth>> = {}
  for (const [id, st] of state) if (st.auth) out[id] = st.auth
  await store.save(JSON.stringify(out))
}

// current-token thunk keeps the client valid across silent refreshes
function clientFor(id: BridgeServiceId): McpClient {
  const st = state.get(id)!
  if (!st.client) st.client = new McpClient(bridgeService(id)!.mcpUrl, () => st.auth?.accessToken ?? '')
  return st.client
}

async function ensureFreshToken(id: BridgeServiceId): Promise<void> {
  const st = state.get(id)!
  if (!st.auth) throw new Error('not logged in')
  if (st.auth.expiresAt && st.auth.expiresAt - Date.now() < 60_000 && st.auth.refreshToken) {
    st.auth = await bridgeRefresh(st.auth)
    await persist()
  }
}

// one auth-retry wrapper: expired-but-refreshable sessions recover silently; real rejections log out
async function withAuth<T>(id: BridgeServiceId, fn: () => Promise<T>): Promise<T> {
  const st = state.get(id)!
  await ensureFreshToken(id)
  try {
    return await fn()
  } catch (e) {
    if (e instanceof BridgeAuthError && st.auth?.refreshToken) {
      st.auth = await bridgeRefresh(st.auth) // throws → outer catch below in callers
      await persist()
      clientFor(id).reset()
      return await fn()
    }
    throw e
  }
}

// connect + capture tools/list + balance — the whole "is this account alive" read, reused by
// login, startup reconnect and the panel's manual refresh
async function refreshService(id: BridgeServiceId): Promise<void> {
  const st = state.get(id)!
  const svc = bridgeService(id)!
  if (st.busy || !st.auth) return
  st.busy = true
  st.error = undefined
  notify()
  try {
    await withAuth(id, async () => {
      const client = clientFor(id)
      client.reset()
      st.tools = await client.listTools()
      // capture their language verbatim, dated — the probe/adapter source artifact (spec §6.2)
      const dir = join(app.getPath('userData'), 'bridge-tools')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${id}.json`), JSON.stringify({ captured: new Date().toISOString(), tools: st.tools }, null, 2), 'utf-8')
      // balance only where a known tool exists AND the live listing confirms it. A refused
      // balance call (e.g. Magnific's paid-plan gate) must NOT paint the login itself as broken —
      // the row stays logged in and carries the balance reason alongside.
      st.balance = undefined
      st.balanceTotal = undefined
      if (svc.balanceTool && st.tools.some((t) => t.name === svc.balanceTool)) {
        try {
          const r = await client.callTool(svc.balanceTool, {})
          // the reply goes to main.log — an unreadable balance shape must be diagnosable
          console.log(`[bridge] balance@${id}: ${[JSON.stringify(r.structuredContent ?? ''), ...(r.content ?? []).map((c) => c.text ?? '')].filter(Boolean).join(' ').slice(0, 1500)}`)
          const b = extractBalance(r)
          st.balance = b.credits
          st.balanceTotal = b.total
          if (b.credits !== undefined && b.credits > (st.highWater ?? 0)) {
            st.highWater = b.credits
            void persistHighWater()
          }
        } catch (e) {
          if (e instanceof BridgeAuthError) throw e
          st.error = `balance: ${e instanceof Error ? e.message : String(e)}`
        }
      }
    })
  } catch (e) {
    st.error = e instanceof Error ? e.message : String(e)
    if (e instanceof BridgeAuthError) {
      // refresh also failed — the session is dead; drop to logged-out so the row says LOGIN, not lies
      st.auth = undefined
      st.tools = undefined
      st.balance = undefined
      await persist().catch(() => undefined)
      st.error = 'session expired — log in again'
    }
    console.error(`[bridge] ${id} refresh failed:`, st.error)
  } finally {
    st.busy = false
    notify()
  }
}

// balance shapes vary per provider — read structuredContent first, else the first JSON object in
// text content, else the first bare number in the text. `total` = plan allowance when reported
// (Magnific: credits.{available,totalPlan}; Pika: balance_credits, no total).
function extractBalance(r: { structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[] }): { credits?: number; total?: number } {
  const findNum = (o: Record<string, unknown>, keys: string[], depth = 0): number | undefined => {
    if (depth > 5) return undefined
    for (const k of keys) {
      const v = o[k]
      if (typeof v === 'number' && isFinite(v)) return v
    }
    for (const v of Object.values(o)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const n = findNum(v as Record<string, unknown>, keys, depth + 1)
        if (n !== undefined) return n
      }
    }
    return undefined
  }
  const fromObj = (o: Record<string, unknown>): { credits?: number; total?: number } => {
    // Runway's shape (field-read 2026-09-01): credits is an OBJECT {plan, purchased, total},
    // the plan ceiling sits beside it as `allowance`
    const c = o.credits
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const co = c as Record<string, unknown>
      const total = typeof co.total === 'number' ? co.total : (typeof co.plan === 'number' ? co.plan : 0) + (typeof co.purchased === 'number' ? co.purchased : 0)
      if (total > 0 || typeof co.total === 'number')
        return { credits: total, total: findNum(o, ['allowance', 'totalPlan', 'total_plan']) ?? findNum(co, ['totalPlan']) }
    }
    return {
      credits: findNum(o, ['available', 'balance_credits', 'balance', 'credits', 'credit', 'amount', 'remaining', 'remainingCredits', 'remaining_credits', 'creditBalance', 'credit_balance', 'creditsLeft', 'credits_left']),
      total: findNum(o, ['totalPlan', 'total_plan', 'total', 'plan_credits', 'allowance', 'limit'])
    }
  }
  const objs: Record<string, unknown>[] = []
  if (r.structuredContent) objs.push(r.structuredContent)
  for (const c of r.content ?? []) {
    if (c.type !== 'text' || !c.text) continue
    try {
      objs.push(JSON.parse(c.text) as Record<string, unknown>)
    } catch {
      const m = c.text.match(/-?\d[\d,]*(?:\.\d+)?/)
      if (m && !objs.length) return { credits: Number(m[0].replace(/,/g, '')) }
    }
  }
  for (const o of objs) {
    const b = fromObj(o)
    if (b.credits !== undefined) return b
  }
  // prose cards ("You have 1,290 credits remaining"): take the number that stands next to the
  // word credits — the last honest read when no field name matches
  const prose = [...(r.content ?? [])]
    .map((c) => c.text ?? '')
    .join('\n')
    .match(/([\d,]+(?:\.\d+)?)\s*credits/i)
  if (prose) return { credits: Number(prose[1].replace(/,/g, '')) }
  return {}
}

export async function loginService(id: BridgeServiceId): Promise<void> {
  const st = state.get(id)!
  const svc = bridgeService(id)
  if (!svc) throw new Error(`unknown bridge service: ${id}`)
  if (svc.blocked) return // inert by design — the row carries the reason
  if (st.busy) return
  st.busy = true
  st.error = undefined
  notify()
  try {
    // a bare unauthenticated poke first — a 401's WWW-Authenticate header is the spec-blessed
    // pointer to the right auth server (falls back to well-known paths without it)
    let hint: string | undefined
    try {
      const poke = await fetch(svc.mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'video-dancer', version: '1' } } })
      })
      if (poke.status === 401) hint = poke.headers.get('www-authenticate') ?? undefined
    } catch {
      // unreachable now ≠ unloginable — discovery gets its own try below
    }
    st.auth = await bridgeLogin(svc.mcpUrl, svc.label, hint)
    await persist()
  } catch (e) {
    st.error = e instanceof Error ? e.message : String(e)
    st.busy = false
    notify()
    return
  }
  st.busy = false
  notify()
  await refreshService(id) // capture tools + balance right away — the row lights with proof, not hope
}

export async function logoutService(id: BridgeServiceId): Promise<void> {
  const st = state.get(id)!
  st.auth = undefined
  st.client = undefined
  st.tools = undefined
  st.balance = undefined
  st.error = undefined
  await persist()
  notify()
}

export function bridgeRows(): BridgeRow[] {
  return BRIDGE_SERVICES.map((svc) => {
    const st = state.get(svc.id)!
    return {
      id: svc.id,
      label: svc.label,
      site: svc.site,
      kind: svc.kind,
      creditUnit: svc.creditUnit,
      loggedIn: !!st.auth,
      busy: st.busy,
      balance: st.balance,
      // fill denominator: the provider's reported plan total, else the highest balance this
      // account has ever shown here — "of what you had", never a made-up plan size
      balanceTotal: st.balanceTotal ?? (st.highWater && st.balance !== undefined ? st.highWater : undefined),
      toolCount: st.tools?.length,
      error: st.error,
      blocked: svc.blocked
    }
  })
}

// ----- adapter surface (providers/mcp/*) -----
export function bridgeReady(id: BridgeServiceId): boolean {
  return !!state.get(id)!.auth
}

// captured tool names — the interpreter's allowed list (never call a tool the server didn't declare)
export function bridgeToolNames(id: BridgeServiceId): string[] {
  return (state.get(id)!.tools ?? []).map((t) => t.name)
}

// last-known balances — the Bridge auto-router's drain order (most credits first, unknown last)
export function bridgeBalance(id: BridgeServiceId): number | undefined {
  return state.get(id)!.balance
}

// ----- the dialog — every Bridge exchange, logged to main.log and streamed to the Queue's
// watermark layer (his call 2026-09-01: "claude and the website talking", super subtle) -----
export interface BridgeDialogLine {
  who: 'app' | 'provider' | 'claude'
  service: string
  text: string
}
let onDialog: ((line: BridgeDialogLine) => void) | null = null
export function setBridgeDialog(fn: (line: BridgeDialogLine) => void): void {
  onDialog = fn
}
// text = plain speech for the watermark; raw (when given) = the full message for main.log.
// Consecutive identical lines (poll loops) collapse — the log keeps every one, the bubbles don't.
let lastLine = ''
export function emitBridgeDialog(who: BridgeDialogLine['who'], service: string, text: string, raw?: string): void {
  console.log(`[bridge] ${who}@${service}: ${raw ?? text}`) // FULL reply in main.log (a failure reason after a 2.5k prompt was getting cut); the bubbles stay short below
  const key = `${who}|${service}|${text.slice(0, 300)}`
  if (key === lastLine) return
  lastLine = key
  onDialog?.({ who, service, text: text.slice(0, 300) })
}

// ----- plain speech, extracted from the REAL messages in code (no AI, his ruling) -----
function speakApp(tool: string, args: Record<string, unknown>): string {
  const a = args as { filename?: string; url?: string; params?: { model?: string; prompt?: string; duration?: number; declined_preset_id?: string } }
  if (tool === 'media_upload' || tool === 'init_upload') return `sending you a file: ${a.filename ?? 'media'}`
  if (tool === 'media_confirm' || tool === 'complete_upload') return `the upload's done — take it`
  if (tool === 'media_import_url') return `grab this file for me`
  if (tool === 'generate_video') {
    // Higgsfield nests under params; Runway's args are flat — read whichever shape arrived
    const p = (a.params ?? args) as { model?: string; prompt?: string; promptText?: string; duration?: number; declined_preset_id?: string }
    if (p.declined_preset_id) return `no thanks — render my prompt exactly as written`
    const prompt = p.prompt ?? p.promptText ?? ''
    return `render this on ${p.model ?? 'your model'}${p.duration ? `, ${p.duration}s` : ''}: "${prompt.slice(0, 110)}${prompt.length > 110 ? '…' : ''}"`
  }
  if (tool === 'get_task' || tool === 'task_status' || tool === 'creations_wait' || tool === 'creation_status') return `how's the render going?`
  if (tool === 'video_generate') {
    const p = args as { slug?: string; prompt?: string; duration?: number }
    return `render this on ${p.slug ?? 'your model'}${p.duration ? `, ${p.duration}s` : ''}: "${(p.prompt ?? '').slice(0, 110)}${(p.prompt ?? '').length > 110 ? '…' : ''}"`
  }
  if (tool === 'creations_request_upload' || tool === 'upload_asset') return `sending you a file`
  if (tool === 'creations_finalize_upload' || tool === 'complete_upload_asset') return `the upload's done — take it`
  if (tool === 'video_models_list') return `which models do you carry?`
  if (tool === 'job_status' || tool === 'jobs_wait') return `how's the render going?`
  if (tool === 'models_explore') return `what refs does this model take?`
  if (/balance|plans_and_credits/.test(tool)) return `how much credit do I have left?`
  if (tool === 'tools/list') return `what can you do?`
  return `${tool}`
}

function speakProvider(text: string): string {
  // provider-agnostic status words first (Runway's get_task speaks prose + uppercase statuses)
  if (text.includes('paid_plan_required')) return `that model needs a paid plan on my side`
  if (/SUCCEEDED/.test(text)) return `done — here's your video`
  if (/\b(RUNNING|PENDING|IN_PROGRESS|QUEUED)\b/.test(text)) return `still rendering…`
  if (/\b(FAILED|CANCELED|CANCELLED)\b/.test(text)) return `that one failed on my side`
  if (/uploadId|upload_url/i.test(text)) return `here's where to send the file`
  if (/assetUrl|\/datasets\//.test(text)) return `got the file — it's hosted now`
  if (/task[^0-9a-f]{0,8}[0-9a-f-]{20,}/i.test(text)) return `job accepted — rendering now`
  // hunt the real payload for the few shapes we know; fall back to their own message text
  let msg: string | undefined
  try {
    const o = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '') as Record<string, unknown>
    const notice = o.notice as { type?: string; message?: string } | undefined
    if (notice?.type === 'preset_recommendation') return notice.message ? notice.message.slice(0, 200) : `this looks like one of my presets — want it?`
    if (notice?.message) return notice.message.slice(0, 200)
    const results = o.results as { id?: string; status?: string; media_id?: string }[] | undefined
    if (Array.isArray(results) && results[0]?.media_id) return `got the file`
    if (Array.isArray(results) && results[0]?.id) return `job accepted — ${String(results[0].id).slice(0, 8)}, rendering now`
    const gen = (o.generation ?? o) as { status?: string; state?: string }
    const status = (gen.status ?? gen.state ?? '').toLowerCase()
    if (/completed|done|succeed/.test(status)) return `done — here's your video`
    if (/pending|progress|queue|running/.test(status)) return `still rendering…`
    if (typeof o.message === 'string') return o.message.slice(0, 200)
  } catch {
    msg = undefined
  }
  void msg
  return text.slice(0, 160)
}

// one tool call with the full auth wrapper — the render adapters' only door into the pipe
export async function bridgeToolCall(id: BridgeServiceId, tool: string, args: Record<string, unknown>): Promise<import('./mcpClient').McpToolResult> {
  if (!state.get(id)!.auth) throw new Error(`not logged in to ${bridgeService(id)?.label ?? id} — Bridge panel`)
  emitBridgeDialog('app', id, speakApp(tool, args), `${tool} ${JSON.stringify(args)}`)
  try {
    const r = await withAuth(id, () => clientFor(id).callTool(tool, args))
    const raw = [JSON.stringify(r.structuredContent ?? ''), ...(r.content ?? []).map((c) => c.text ?? '')].filter(Boolean).join(' ')
    emitBridgeDialog('provider', id, speakProvider(raw), raw)
    return r
  } catch (e) {
    emitBridgeDialog('provider', id, `something broke: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    throw e
  }
}

export async function refreshAll(): Promise<void> {
  await Promise.all(BRIDGE_SERVICES.filter((s) => state.get(s.id)!.auth).map((s) => refreshService(s.id)))
}
