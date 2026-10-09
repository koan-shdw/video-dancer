// BRIDGE manager — owns the six MCP logins (BRIDGE-SPEC-2026-09-01). One McpClient per
// logged-in service, tokens persisted through the settings secret lane (encrypted at rest),
// tools/list captured verbatim on every connect (the "their language" artifact the probes and
// adapters are built from), balance read where a documented tool exists.
//
// Stage 1 scope (spec §7): login/logout/status + capture + balance. Render adapters and the
// BRIDGE router arrive with the probes — nothing here renders or spends.

import { app, clipboard } from 'electron'
import { AsyncLocalStorage } from 'async_hooks'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { BRIDGE_SERVICES, bridgeService, type BridgeService, type BridgeServiceId } from './services'
import { McpClient, BridgeAuthError, type McpTool } from './mcpClient'
import { bridgeLogin, bridgeRefresh, type BridgeAuth } from './oauth'
import type { BridgeRow } from '@koan/vidancer-ui/shared/types'
import { veniceBalance } from '../providers/venice'

// injected by main/index.ts — settings live there; the JSON string rides the SECRET_KEYS lane
interface AuthStore {
  load: () => Promise<string | undefined>
  save: (json: string) => Promise<void>
  key?: (id: BridgeServiceId) => Promise<string | undefined> // a KEY service's API key, from Settings
}

// one LOGIN of a supplier. List 33 (2026-09-30): a supplier can hold several ("several of same
// bridge, ability ot hit a plus and add a new one for each bridge"), each its own row and credit
// bar, all in one pool. n = 1 is the first login, saved under the bare supplier name exactly as
// before there were several (the old file reads unchanged, and an older build reads this one);
// the ＋ adds n = 2, 3, … saved as `higgsfield#2`.
interface LoginState {
  id: BridgeServiceId
  n: number
  name?: string // his own name for the row (unset = "Higgsfield 2")
  auth?: BridgeAuth
  key?: string // a KEY service's API key (Venice) — present = "logged in"
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
const keyOf = (id: BridgeServiceId, n = 1): string => (n > 1 ? `${id}#${n}` : id)
const state = new Map<string, LoginState>()
for (const s of BRIDGE_SERVICES) state.set(s.id, { id: s.id, n: 1, busy: false })
const login = (id: BridgeServiceId, n = 1): LoginState | undefined => state.get(keyOf(id, n))
const loginsOf = (id: BridgeServiceId): LoginState[] => [...state.values()].filter((st) => st.id === id).sort((a, b) => a.n - b.n)
// the logins that can pay, the most credits left first (his answer 09-30: the login with the most
// credits left pays); an unknown balance goes last and still gets a turn (unknown ≠ empty)
const ranked = (id: BridgeServiceId): LoginState[] => loginsOf(id).filter((st) => st.auth).sort((a, b) => (b.balance ?? -1) - (a.balance ?? -1))
const rowName = (st: LoginState): string => st.name ?? `${bridgeService(st.id)?.label ?? st.id} ${st.n}`

// WHICH login a call goes to. A render is many calls (upload, submit, poll) and every one has to
// land on the account that took the job, so a render runs inside onLogin / onBestLogin and each
// bridge call in it reads its login here. Outside one: the login with the most credits left.
const pins = new AsyncLocalStorage<Map<BridgeServiceId, number>>()
function pick(id: BridgeServiceId): LoginState {
  const pin = pins.getStore()?.get(id)
  // a pinned login that was logged out mid-render answers "not logged in": never another account
  if (pin !== undefined) return login(id, pin) ?? { id, n: pin, busy: false }
  return ranked(id)[0] ?? login(id)!
}

const notify = (): void => onChanged?.()
// the login a bridge call made here goes to (an upload cache keys by it: what one account uploaded,
// another can't see) (audit 2026-10-09 M13)
export const currentLogin = (id: BridgeServiceId): number => pick(id)?.n ?? 0 // no login at all: the call itself says so

export async function initBridge(authStore: AuthStore, changed: () => void): Promise<void> {
  store = authStore
  onChanged = changed
  try {
    const raw = await authStore.load()
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, (BridgeAuth & { name?: string }) | undefined>
      for (const [k, v] of Object.entries(saved)) {
        const [id, num] = k.split('#') as [BridgeServiceId, string | undefined]
        const n = num ? Number(num) : 1
        if (!bridgeService(id) || !v?.accessToken || !Number.isInteger(n) || n < 1) continue
        const { name, ...auth } = v
        state.set(keyOf(id, n), { ...(login(id, n) ?? { id, n, busy: false }), auth, name })
      }
    }
  } catch (e) {
    console.error('[bridge] stored logins unreadable — starting logged out:', e instanceof Error ? e.message : e)
  }
  // high-water marks survive restarts (a small sidecar next to the tool captures), one per login
  try {
    const raw = JSON.parse(await readFile(highWaterFile(), 'utf-8')) as Record<string, number>
    for (const [k, st] of state) if (typeof raw[k] === 'number') st.highWater = raw[k]
  } catch {
    // first run — no marks yet
  }
  // stored logins reconnect lazily in the background — balance + tool capture refresh on their own
  for (const st of [...state.values()]) if (bridgeService(st.id)?.auth === 'key' || st.auth) void refreshLogin(st)
}

// a KEY service (Venice): "logged in" = its key is saved in Settings; the balance is one
// authenticated read that spends nothing. Called on start, on the panel's refresh, and the moment
// the key is saved or cleared in Settings (the row flips without a restart).
// Runs are chained, never skipped: a save that lands while a read is in flight still gets its own read.
const keyRuns = new Map<BridgeServiceId, Promise<void>>()
export function refreshKeyService(id: BridgeServiceId): Promise<void> {
  const run = (keyRuns.get(id) ?? Promise.resolve()).then(() => readKeyService(id))
  keyRuns.set(id, run)
  return run
}
async function readKeyService(id: BridgeServiceId): Promise<void> {
  const st = login(id)!
  st.busy = true
  st.error = undefined
  notify()
  try {
    st.key = (await store?.key?.(id)) || undefined
    st.balance = undefined
    if (st.key) {
      const b = await veniceBalance(st.key)
      if (!b.ok) st.error = b.error
      else setBalance(st, { credits: Math.round(b.usd * 100) }) // 1 USD = 100 credits — the peg the panel's pool math already uses
    }
  } finally {
    st.busy = false
    notify()
  }
}

const highWaterFile = (): string => join(app.getPath('userData'), 'bridge-tools', 'highwater.json')
async function persistHighWater(): Promise<void> {
  const out: Record<string, number> = {}
  for (const [k, st] of state) if (st.highWater !== undefined) out[k] = st.highWater
  try {
    await mkdir(join(app.getPath('userData'), 'bridge-tools'), { recursive: true })
    await writeFile(highWaterFile(), JSON.stringify(out), 'utf-8')
  } catch (e) {
    console.error('[bridge] high-water save failed:', e instanceof Error ? e.message : e)
  }
}
function setBalance(st: LoginState, b: { credits?: number; total?: number }): void {
  st.balance = b.credits
  st.balanceTotal = b.total
  if (b.credits !== undefined && b.credits > (st.highWater ?? 0)) {
    st.highWater = b.credits
    void persistHighWater()
  }
}

async function persist(): Promise<void> {
  if (!store) return
  const out: Record<string, BridgeAuth & { name?: string }> = {}
  for (const [k, st] of state) if (st.auth) out[k] = st.name ? { ...st.auth, name: st.name } : st.auth
  await store.save(JSON.stringify(out))
}

// current-token thunk keeps the client valid across silent refreshes
function clientFor(st: LoginState): McpClient {
  if (!st.client) st.client = new McpClient(bridgeService(st.id)!.mcpUrl, () => st.auth?.accessToken ?? '')
  return st.client
}

// a new access token on the refresh token. Their login server REFUSING it (400 / 401 / 403) is the
// session being over; a network failure is not, and leaves the login alone.
async function renew(st: LoginState): Promise<void> {
  try {
    st.auth = await bridgeRefresh(st.auth!)
  } catch (e) {
    if (e instanceof Error && /^token request failed \((400|401|403)\)/.test(e.message)) throw new BridgeAuthError(e.message)
    throw e
  }
  await persist()
}
// the supplier ended this login and it can't be renewed: drop to logged-out so the row says
// LOGIN, not lies. With several logins this matters twice: an ended login that still looked alive
// would keep being picked to pay (list 33).
function endSession(st: LoginState): void {
  st.auth = undefined
  st.client = undefined
  st.tools = undefined
  st.balance = undefined
  st.error = 'session expired — log in again'
  void persist().catch(() => undefined)
  notify()
}

// one auth-retry wrapper: expired-but-refreshable sessions recover silently; real rejections log out
async function withAuth<T>(st: LoginState, fn: () => Promise<T>): Promise<T> {
  if (!st.auth) throw new Error('not logged in')
  const renewOrEnd = async (): Promise<void> => {
    try {
      await renew(st)
    } catch (e) {
      if (e instanceof BridgeAuthError) endSession(st)
      throw e
    }
  }
  if (st.auth.expiresAt && st.auth.expiresAt - Date.now() < 60_000 && st.auth.refreshToken) await renewOrEnd()
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof BridgeAuthError)) throw e
    if (!st.auth?.refreshToken) {
      endSession(st)
      throw e
    }
    await renewOrEnd()
    clientFor(st).reset()
    return await fn() // refused again on a fresh token = this call is not allowed; the login itself stands
  }
}

// balance only where a known tool exists AND the live listing confirms it
async function readBalance(st: LoginState): Promise<{ credits?: number; total?: number } | undefined> {
  const svc = bridgeService(st.id)!
  if (!svc.balanceTool || !st.tools?.some((t) => t.name === svc.balanceTool)) return undefined
  const r = await clientFor(st).callTool(svc.balanceTool, {})
  // the reply goes to main.log — an unreadable balance shape must be diagnosable
  console.log(`[bridge] balance@${keyOf(st.id, st.n)}: ${[JSON.stringify(r.structuredContent ?? ''), ...(r.content ?? []).map((c) => c.text ?? '')].filter(Boolean).join(' ').slice(0, 1500)}`)
  return extractBalance(r)
}

// connect + capture tools/list + balance — the whole "is this account alive" read, reused by
// login, startup reconnect and the panel's manual refresh
async function refreshLogin(st: LoginState): Promise<void> {
  const svc = bridgeService(st.id)!
  if (svc.auth === 'key') return refreshKeyService(st.id)
  if (st.busy || !st.auth) return
  const who = keyOf(st.id, st.n)
  st.busy = true
  st.error = undefined
  notify()
  try {
    await withAuth(st, async () => {
      const client = clientFor(st)
      client.reset()
      st.tools = await client.listTools()
      // capture their language verbatim, dated — the probe/adapter source artifact (spec §6.2)
      const dir = join(app.getPath('userData'), 'bridge-tools')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${st.id}.json`), JSON.stringify({ captured: new Date().toISOString(), tools: st.tools }, null, 2), 'utf-8')
      // A refused balance call (e.g. Magnific's paid-plan gate) must NOT paint the login itself as
      // broken — the row stays logged in and carries the balance reason alongside.
      st.balance = undefined
      st.balanceTotal = undefined
      try {
        const b = await readBalance(st)
        if (b) setBalance(st, b)
      } catch (e) {
        if (e instanceof BridgeAuthError) throw e
        st.error = `balance: ${e instanceof Error ? e.message : String(e)}`
        console.warn(`[bridge] balance@${who} failed: ${st.error}`)
      }
    })
  } catch (e) {
    if (st.auth) st.error = e instanceof Error ? e.message : String(e) // an ended session carries its own line (endSession)
    console.error(`[bridge] ${who} refresh failed:`, e instanceof Error ? e.message : e)
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

// the browser half of a login, shared by a row's own button and the ＋
async function browserLogin(svc: BridgeService, copy?: boolean): Promise<BridgeAuth> {
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
  // copy = the ＋'s "copy the link": a supplier's page signs in whichever account the browser
  // already has open, so a second account goes through a private window, and the link is how the
  // login gets there
  return bridgeLogin(svc.mcpUrl, svc.label, hint, copy ? (url) => clipboard.writeText(url) : undefined)
}

export async function loginService(id: BridgeServiceId, n = 1): Promise<void> {
  const svc = bridgeService(id)
  if (!svc) throw new Error(`unknown bridge service: ${id}`)
  if (svc.blocked || svc.auth === 'key') return // inert by design — the row carries the reason (a key row's door is Settings)
  const st = login(id, n)
  if (!st || st.busy) return
  st.busy = true
  st.error = undefined
  notify()
  try {
    st.auth = await browserLogin(svc)
    await persist()
  } catch (e) {
    st.error = e instanceof Error ? e.message : String(e)
    st.busy = false
    notify()
    return
  }
  st.busy = false
  notify()
  await refreshLogin(st) // capture tools + balance right away — the row lights with proof, not hope
}

// the ＋ (list 33): one more login of the same supplier, in its lowest free number. The row exists
// only once the login worked; a refusal comes back as words for the ＋ to show where he clicked.
export async function addLogin(id: BridgeServiceId, copy?: boolean): Promise<string | undefined> {
  const svc = bridgeService(id)
  if (!svc || svc.blocked || svc.auth === 'key') return `${svc?.label ?? id} takes one login`
  let auth: BridgeAuth
  try {
    auth = await browserLogin(svc, copy)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  let n = 1
  while (login(id, n)?.auth) n++
  const st: LoginState = { ...(login(id, n) ?? { id, n, busy: false }), auth, error: undefined }
  state.set(keyOf(id, n), st)
  await persist()
  notify()
  await refreshLogin(st)
  return undefined
}

export async function logoutService(id: BridgeServiceId, n = 1): Promise<void> {
  if (bridgeService(id)?.auth === 'key') return // the key lives in Settings — cleared there
  const st = login(id, n)
  if (!st) return
  if (n > 1) state.delete(keyOf(id, n)) // an added login leaves with its row
  else state.set(id, { id, n: 1, busy: false, highWater: st.highWater })
  await persist()
  notify()
}

export async function renameLogin(id: BridgeServiceId, n: number, name: string): Promise<void> {
  const st = login(id, n)
  if (!st) return
  st.name = name.trim().slice(0, 40) || undefined // empty = back to "Higgsfield 2"
  await persist()
  notify()
}

export function bridgeRows(): BridgeRow[] {
  return BRIDGE_SERVICES.flatMap((svc) => {
    // a row per login that is there, or that says why it is not; none = the supplier's one empty row
    const all = loginsOf(svc.id)
    const shown = all.filter((st) => st.auth || st.key || st.busy || st.error)
    const list = shown.length ? shown : [all[0]]
    return list.map((st) => ({
      id: svc.id,
      slot: st.n,
      key: keyOf(svc.id, st.n),
      service: svc.label,
      label: st.name ?? (list.length > 1 ? `${svc.label} ${st.n}` : svc.label),
      name: st.name,
      site: svc.site,
      kind: svc.kind,
      creditUnit: svc.creditUnit,
      loggedIn: svc.auth === 'key' ? !!st.key : !!st.auth,
      auth: svc.auth,
      busy: st.busy,
      balance: st.balance,
      // fill denominator: the provider's reported plan total, else the highest balance this
      // account has ever shown here — "of what you had", never a made-up plan size
      balanceTotal: st.balanceTotal ?? (st.highWater && st.balance !== undefined ? st.highWater : undefined),
      toolCount: st.tools?.length,
      error: st.error,
      blocked: svc.blocked
    }))
  })
}

// ----- adapter surface (providers/mcp/*) -----
// n given = that login; none = the login this render is pinned to, else any login at all
export function bridgeReady(id: BridgeServiceId, n?: number): boolean {
  if (bridgeService(id)?.auth === 'key') return !!login(id)?.key
  return !!(n !== undefined ? login(id, n) : pick(id))?.auth
}
// a KEY service's key — the auto router's Venice lane renders on it
export function bridgeKey(id: BridgeServiceId): string | undefined {
  return login(id)?.key
}

// captured tool names — the interpreter's allowed list (never call a tool the server didn't declare)
export function bridgeToolNames(id: BridgeServiceId): string[] {
  return (pick(id).tools ?? []).map((t) => t.name)
}

// last-known balance of the login that would pay — the Bridge auto-router's drain order (most
// credits first, unknown last)
export function bridgeBalance(id: BridgeServiceId): number | undefined {
  return pick(id).balance
}

// every bridge call to this supplier inside fn goes to ONE login
export function onLogin<T>(id: BridgeServiceId, n: number, fn: () => Promise<T>): Promise<T> {
  return pins.run(new Map(pins.getStore() ?? []).set(id, n), fn)
}

export const CREDIT_SMELL = /credit|balance|insufficient|paid.plan|plan_required|payment|quota|top.up/i

// one render on ONE login: the one with the most credits left. A refusal that smells like "out of
// credit / wrong plan" moves on to the supplier's next login (they are one pool); any other
// failure stops honestly. The job is recorded with its login (`#2` on the endpoint string) so a
// recovery after a crash asks the account that took it.
export async function onBestLogin<O extends { onProgress?: (m: string) => void; onRequestId?: (requestId: string, endpoint: string) => void }, T>(id: BridgeServiceId, opts: O, run: (opts: O) => Promise<T>): Promise<T> {
  const order = ranked(id)
  if (!order.length) return run(opts) // nobody logged in: the adapter says so in its own words
  for (let i = 0; ; i++) {
    const st = order[i]
    if (order.length > 1) opts.onProgress?.(`${rowName(st)} pays (the most credits left)…`)
    let took = false // their server took a job on this login
    try {
      return await onLogin(id, st.n, () =>
        run({
          ...opts,
          onRequestId: (requestId: string, endpoint: string) => {
            took = true
            opts.onRequestId?.(requestId, st.n > 1 ? `${endpoint}#${st.n}` : endpoint)
          }
        })
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // a login that turned out to be over before it took the job is no reason to fail the render
      const over = !st.auth && !took
      // once a login took the job it is never sent to another: it may still run and bill (audit 2026-10-09 H6)
      if (took || i >= order.length - 1 || !(over || CREDIT_SMELL.test(msg))) throw e
      opts.onProgress?.(`${rowName(st)} ${over ? 'is logged out' : `declined (${msg.slice(0, 80)})`} — trying ${rowName(order[i + 1])}…`)
    } finally {
      // what it has left now, so the next render's pick is true (one read, spends nothing)
      void withAuth(st, () => readBalance(st))
        .then((b) => {
          if (!b) return
          setBalance(st, b)
          notify()
        })
        .catch(() => undefined)
    }
  }
}
// which login took a recorded job: the number after '#' on its endpoint string, else the first
export const loginOfEndpoint = (endpoint: string): number => Number(endpoint.split('#')[1]) || 1

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
  if (tool === 'generate_image' || tool === 'generate_image_edit') {
    // list 9 / 50: Higgsfield nests under params, Runway and Pika are flat
    const p = (a.params ?? args) as { model?: string; provider?: string; prompt?: string; promptText?: string; get_cost?: boolean }
    const prompt = p.prompt ?? p.promptText ?? ''
    return `${p.get_cost ? 'what would this picture cost' : 'make this picture'} on ${p.model ?? p.provider ?? 'your model'}: "${prompt.slice(0, 110)}${prompt.length > 110 ? '…' : ''}"`
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
  const st = pick(id)
  if (!st.auth) throw new Error(`not logged in to ${bridgeService(id)?.label ?? id} — Bridge panel`)
  emitBridgeDialog('app', id, speakApp(tool, args), `${tool} ${JSON.stringify(args)}`)
  try {
    const r = await withAuth(st, () => clientFor(st).callTool(tool, args))
    const raw = [JSON.stringify(r.structuredContent ?? ''), ...(r.content ?? []).map((c) => c.text ?? '')].filter(Boolean).join(' ')
    emitBridgeDialog('provider', id, speakProvider(raw), raw)
    return r
  } catch (e) {
    emitBridgeDialog('provider', id, `something broke: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    throw e
  }
}

export async function refreshAll(): Promise<void> {
  await Promise.all([...state.values()].filter((st) => bridgeService(st.id)?.auth === 'key' || st.auth).map((st) => refreshLogin(st)))
}
