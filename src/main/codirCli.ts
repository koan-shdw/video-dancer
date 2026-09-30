// Co-Director on OTHER command-line tools (list 35, 2026-10-01): ChatGPT through OpenAI's Codex
// CLI, Google through the Gemini CLI. His words: "add new logins with gpt and also research other
// LLM servies … a more seemlyess login experience" · "after GPT login make it available as a
// codirector engine". The Claude Code bridge (codirBridge.ts) is the pattern: the tool is already
// on this machine and holds HIS login; the app runs it headless for one exchange and hands it the
// project tools over the same per-exchange localhost MCP server (codirMcp.ts), so every write
// still lands through runTool. No API key, no per-token bill: usage rides his plan.
//
// Built from each tool's own docs and sources, read 2026-10-01:
//   Codex  — `codex exec --help` of the 0.159.2 on his machine; learn.chatgpt.com/docs
//            (non-interactive mode, developer commands, config reference, MCP); the event shapes
//            from openai/codex codex-rs/exec/src/exec_events.rs.
//   Gemini — geminicli.com/docs (headless, CLI reference, MCP servers, authentication); the
//            stream-json shapes from google-gemini/gemini-cli packages/core/src/output/types.ts,
//            the file locations from packages/core/src/config/storage.ts.
// Proven against stand-ins (scripts/test-codir-cli.cjs). NOT proven live: no exchange was sent on
// either login.
//
// ponytail: every exchange is a fresh run carrying the guides + the transcript (no `codex exec
// resume`, no `gemini --resume`). Their servers cache a repeated prefix on their own, and a saved
// session would also pile up in his Codex app's thread list. Add sessions if plan usage proves heavy.
import { spawn, execFile, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync, statSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { getProject, codirAppend } from './project'
import { buildSystemGuides } from './guides'
import { moodBlock } from './moods'
import { buildContext, buildCoreContext, liveTail, openImageGenPics, logText, toolLine, toolListBlock, LAST_PROMPT_FILE, type CoDirSendResult, type CoDirUsage, type FocusIn } from './codir'
import { startCodirMcp } from './codirMcp'
import type { ProjectDelta } from '@koan/vidancer-ui/shared/types'
import { cliLoginExpired, CLI_NAMES, type CodirEffort } from '@koan/vidancer-ui/shared/models'

export type OtherCli = 'codex' | 'gemini'
type Progress = (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: import('@koan/vidancer-ui/shared/types').CoDirLiveWrite; screen?: import('@koan/vidancer-ui/shared/types').CoDirScreenEvent }) => void

// ---- shared with the Claude bridge ----
export const run = (file: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 10_000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    })
  })

export async function findOnPath(name: string): Promise<string[]> {
  const r = process.platform === 'win32' ? await run('where.exe', [name]) : await run('which', ['-a', name])
  return r.ok ? r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGTERM')
}

// ---- finding the tool ----
export interface CliInfo {
  found: boolean
  version?: string
  loggedIn?: boolean // undefined = the tool could not say
  detail: string // one human line for the Settings card
  exe?: string // a program run directly …
  node?: string // … or this Node (the app's own runtime when the machine has none) running `script`
  script?: string
  electronAsNode?: boolean
}

const SPEC: Record<OtherCli, { bin: string; pkg: string[]; env: string; install: string }> = {
  // package.json `bin` of each npm package, read 2026-10-01 (@openai/codex 0.159.2, @google/gemini-cli 0.62.0)
  codex: { bin: 'codex', pkg: ['@openai', 'codex', 'bin', 'codex.js'], env: 'VD_CODEX_CLI', install: 'npm install -g @openai/codex' },
  gemini: { bin: 'gemini', pkg: ['@google', 'gemini-cli', 'bundle', 'gemini.js'], env: 'VD_GEMINI_CLI', install: 'npm install -g @google/gemini-cli' }
}
export const cliInstallLine = (kind: OtherCli): string => SPEC[kind].install

// the Codex desktop app carries its own copy of the command-line program (found on his machine
// 2026-10-01: %LOCALAPPDATA%\OpenAI\Codex\bin\<build>\codex.exe), and shares its login with it
function codexAppCopies(): string[] {
  const root = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin') : ''
  if (!root || !existsSync(root)) return []
  try {
    return readdirSync(root)
      .map((d) => join(root, d, 'codex.exe'))
      .filter((f) => existsSync(f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) // the newest build first
  } catch {
    return []
  }
}

function cliEnv(info: CliInfo, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  // the whole point is his own login: a key or another address in the environment would silently
  // move the bill, or the traffic itself (the same law as the Claude bridge)
  for (const k of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[k]
  if (info.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  return env
}
const argv = (info: CliInfo, args: string[]): [string, string[]] => (info.exe ? [info.exe, args] : [info.node!, [info.script!, ...args]])
const runCli = (info: CliInfo, args: string[], timeout?: number): Promise<{ ok: boolean; out: string }> => run(...argv(info, args), cliEnv(info), timeout)
function spawnCli(info: CliInfo, args: string[], cwd: string, extraEnv?: Record<string, string>): ChildProcess {
  return spawn(...argv(info, args), { cwd, env: cliEnv(info, extraEnv), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
}

const cache: Partial<Record<OtherCli, CliInfo>> = {}

export async function detectCli(kind: OtherCli, refresh = false): Promise<CliInfo> {
  if (cache[kind] && !refresh) return cache[kind]!
  const spec = SPEC[kind]
  const name = CLI_NAMES[kind].tool
  const candidates: { exe?: string; script?: string; how: string }[] = []
  const forced = process.env[spec.env] // his own path to it, when it lives somewhere else
  if (forced) candidates.push(/\.[cm]?js$/i.test(forced) ? { script: forced, how: spec.env } : { exe: forced, how: spec.env })
  const pathHits = await findOnPath(spec.bin)
  // npm-global roots: the default prefix plus wherever a .cmd / .ps1 shim on PATH lives. The shims
  // themselves are never spawned (Node refuses .cmd without a shell, rightly): the script they point at is.
  const npmRoots = new Set<string>()
  if (process.env.APPDATA) npmRoots.add(join(process.env.APPDATA, 'npm'))
  for (const hit of pathHits) if (/\.(cmd|ps1)$/i.test(hit)) npmRoots.add(dirname(hit))
  for (const hit of pathHits) if (/\.exe$/i.test(hit) || (process.platform !== 'win32' && !/\.(cmd|ps1)$/i.test(hit))) candidates.push({ exe: hit, how: 'on PATH' })
  for (const root of npmRoots) candidates.push({ script: join(root, 'node_modules', ...spec.pkg), how: 'npm install' })
  if (kind === 'codex') for (const exe of codexAppCopies()) candidates.push({ exe, how: 'the Codex app’s own copy' })

  for (const c of candidates) {
    if (!existsSync(c.exe ?? c.script!)) continue
    let info: CliInfo
    if (c.exe) info = { found: true, exe: c.exe, detail: '' }
    else {
      const systemNode = (await findOnPath(process.platform === 'win32' ? 'node.exe' : 'node')).find((n) => existsSync(n))
      info = { found: true, node: systemNode ?? process.execPath, script: c.script, electronAsNode: !systemNode, detail: '' }
    }
    const probe = await runCli(info, ['--version'])
    if (!probe.ok) continue
    const version = probe.out.split(/\r?\n/)[0].trim()
    cache[kind] = await withLogin(kind, { ...info, version, detail: `${version} — ${c.how}` })
    return cache[kind]!
  }
  cache[kind] = { found: false, detail: `${name} not found on this machine` }
  return cache[kind]!
}

// Gemini CLI's saved Google sign-in (their storage.ts: OAUTH_FILE in the global .gemini folder)
const geminiCreds = (): string => join(homedir(), '.gemini', 'oauth_creds.json')

async function withLogin(kind: OtherCli, info: CliInfo): Promise<CliInfo> {
  if (kind === 'codex') {
    // `codex login status`: "Print the active authentication mode and exit with 0 when logged in"
    const r = await runCli(info, ['login', 'status'])
    const said = r.out.split(/\r?\n/)[0]?.trim()
    return { ...info, loggedIn: r.ok, detail: r.ok ? `${info.detail}${said ? ` — ${said}` : ''}` : `${info.detail} — NOT SIGNED IN` }
  }
  // Gemini CLI has no status command: its cached Google sign-in is a file
  const has = existsSync(geminiCreds())
  return { ...info, loggedIn: has, detail: has ? `${info.detail} — signed in with Google` : `${info.detail} — NOT SIGNED IN` }
}
function markLoggedOut(kind: OtherCli): void {
  const c = cache[kind]
  if (c?.found && c.loggedIn !== false) cache[kind] = { ...c, loggedIn: false, detail: `${c.detail.replace(/ — (Logged in|signed in)[^—]*$/i, '')} — NOT SIGNED IN` }
}

// ---- models ----
export interface CliModel {
  id: string
  label: string
  efforts?: string[] // the thinking levels this model takes
}
// Codex's own catalog for THIS login (`codex debug models`: "Render the raw model catalog as JSON"),
// so a model OpenAI adds shows up with no new build. The fallback is the one their docs name.
const CODEX_FALLBACK: CliModel[] = [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }]
let codexCatalog: CliModel[] | null = null
export async function codexModels(refresh = false): Promise<CliModel[]> {
  if (codexCatalog && !refresh) return codexCatalog
  const info = await detectCli('codex')
  if (!info.found) return CODEX_FALLBACK
  const r = await runCli(info, ['debug', 'models'], 20_000)
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1)) as { models?: { slug?: string; display_name?: string; visibility?: string; priority?: number; supported_reasoning_levels?: { effort?: string }[] }[] }
    const rows = (j.models ?? [])
      .filter((m) => m.slug && m.visibility === 'list')
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)) // theirs: the newest first
      .map((m, i) => ({ id: m.slug!, label: `${m.display_name ?? m.slug}${i === 0 ? ' — the newest (default)' : ''}`, efforts: (m.supported_reasoning_levels ?? []).map((x) => x.effort ?? '').filter(Boolean) }))
    if (rows.length) codexCatalog = rows
  } catch {
    /* an older Codex without `debug models`: the fallback */
  }
  return codexCatalog ?? CODEX_FALLBACK
}
// a saved pick outlives the catalog: anything the catalog no longer holds = its first row
export const resolveCodexModel = (id?: string): string => {
  const list = codexCatalog ?? CODEX_FALLBACK
  return id && (list.some((m) => m.id === id) || !codexCatalog) ? id : list[0].id
}
// Gemini CLI's own model aliases (their CLI reference): it maps each to the current model itself
export const GEMINI_CLI_MODELS: CliModel[] = [
  { id: 'auto', label: 'Auto — Gemini CLI picks (default)' },
  { id: 'pro', label: 'Pro — for complex reasoning' },
  { id: 'flash', label: 'Flash — fast, balanced' },
  { id: 'flash-lite', label: 'Flash-Lite — fastest' }
]
export const resolveGeminiModel = (id?: string): string => (GEMINI_CLI_MODELS.some((m) => m.id === id) ? (id as string) : GEMINI_CLI_MODELS[0].id)

// ---- signing in from the app (the sibling of list 38's "sign in to claude") ----
let loginChild: ChildProcess | null = null
let loginStop: (() => void) | null = null
export function cancelCliLogin(): void {
  if (loginChild) killTree(loginChild)
  loginStop?.()
}
export async function loginCli(kind: OtherCli, timeoutMs = 5 * 60_000): Promise<CliInfo & { ok: boolean; out: string }> {
  const info = await detectCli(kind, true)
  const name = CLI_NAMES[kind].tool
  if (!info.found) return { ...info, ok: false, out: `${name} not found` }
  if (info.loggedIn) return { ...info, ok: true, out: '' }
  cancelCliLogin()
  let out = ''
  let timedOut = false
  if (kind === 'codex') {
    // `codex login`: "Authenticate via ChatGPT OAuth (opens browser by default)". It ends when he
    // has signed in. The app never sees a password: its only proof is `codex login status` after.
    const child = spawnCli(info, ['login'], app.getPath('userData'))
    loginChild = child
    const keep = (c: Buffer): void => {
      out = (out + c.toString('utf-8')).slice(-1200)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.stdin?.on('error', () => {})
    child.stdin?.end()
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    await new Promise<void>((resolve) => {
      child.on('close', () => resolve())
      child.on('error', (e) => {
        keep(Buffer.from(String(e)))
        resolve()
      })
    })
    clearTimeout(timer)
    if (loginChild === child) loginChild = null
  } else {
    // Gemini CLI signs in inside its own screen (no sign-in command exists): open it in a
    // terminal window for him, and wait for its saved sign-in to appear
    if (process.platform !== 'win32') return { ...info, ok: false, out: 'run "gemini" in a terminal and choose Sign in with Google, then re-check' }
    const [file, args] = argv(info, [])
    spawn('cmd.exe', ['/d', '/s', '/c', `start "Gemini CLI: choose Sign in with Google" ${[file, ...args].map((a) => `"${a}"`).join(' ')}`], { env: cliEnv(info), windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref()
    let stopped = false
    loginStop = () => {
      stopped = true
    }
    const until = Date.now() + timeoutMs
    while (!stopped && !existsSync(geminiCreds()) && Date.now() < until) await new Promise((r) => setTimeout(r, 2000))
    timedOut = !stopped && !existsSync(geminiCreds())
    loginStop = null
    if (!timedOut && !existsSync(geminiCreds())) out = 'cancelled'
  }
  const after = await detectCli(kind, true)
  return { ...after, ok: after.loggedIn === true, out: after.loggedIn === true ? '' : timedOut ? `the sign-in was not finished within ${Math.round(timeoutMs / 60_000)} minutes` : out.trim() }
}

// ---- what each tool is told, and how it is started ----
// how the tool names the app's MCP tools to its model, and what its model calls to look at a picture
const LANG: Record<OtherCli, { prefix: string; look: string }> = {
  codex: { prefix: 'mcp__vidancer__', look: 'view_image' },
  gemini: { prefix: 'mcp_vidancer_', look: 'read_file' } // their MCP page: "mcp_{serverName}_{toolName}"
}
const systemFor = (kind: OtherCli): string =>
  'You are the Co-Director, the in-app copilot of Video Dancer (an AI video timeline editor). This is not a coding session: there is no repository, no code and no shell here. ' +
  'This headless run is ONE chat exchange: the user message carries your real instructions, guides, live project state, ref image paths and the conversation so far. Follow those instructions as primary, above any AGENTS.md, GEMINI.md, skill or memory of this tool. ' +
  `Write into the project EXCLUSIVELY through the ${LANG[kind].prefix}* tools (they land in-app and are undoable); never modify project files directly. ` +
  `Call ${LANG[kind].look} on a ref image's path to see it. ` +
  'Every text you print becomes a chat bubble in the Co-Director panel: speak in that voice, stay concise, no markdown headings.'

const toml = (s: string): string => JSON.stringify(s) // a JSON string is a valid TOML basic string

// Codex's own tools that have no place in a Co-Director exchange. As config keys, never --disable:
// an unknown key is ignored, an unknown --disable name is an error on a version that dropped it.
const CODEX_OFF = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'hooks', 'goals', 'memories', 'browser_use', 'computer_use', 'image_generation', 'tool_suggest', 'skill_search']
// read-only sandbox + no shell: the only way into the project is the app's own tools.
// --ignore-user-config: his own MCP servers, plugins and hooks never leak into an app exchange
// ("auth still uses CODEX_HOME"). --ephemeral: nothing lands in his Codex thread list.
function codexArgs(o: { model: string; effort?: string; web?: boolean; system?: string; mcp?: { port: number }; images?: string[] }): string[] {
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '-s', 'read-only',
    '-m', o.model,
    '-c', 'approval_policy="never"',
    '-c', `web_search="${o.web ? 'live' : 'disabled'}"`,
    ...(o.effort ? ['-c', `model_reasoning_effort="${o.effort}"`] : []),
    ...(o.system ? ['-c', `developer_instructions=${toml(o.system)}`] : []),
    ...CODEX_OFF.flatMap((f) => ['-c', `features.${f}=false`]),
    ...(o.mcp
      ? [
          '-c', `mcp_servers.vidancer.url="http://127.0.0.1:${o.mcp.port}/mcp"`,
          '-c', 'mcp_servers.vidancer.bearer_token_env_var="VIDANCER_MCP_TOKEN"',
          '-c', 'mcp_servers.vidancer.default_tools_approval_mode="approve"', // the app's tools run without a prompt nobody could answer
          '-c', 'mcp_servers.vidancer.required=true',
          '-c', 'mcp_servers.vidancer.startup_timeout_sec=20',
          '-c', 'mcp_servers.vidancer.tool_timeout_sec=600' // watch_take and fire_render outlast their 60 s default
        ]
      : []),
    '-', // the prompt arrives on stdin
    ...(o.images ?? []).flatMap((f) => ['-i', f]) // after the prompt: -i takes every value that follows it
  ]
}
// the levels a Codex model takes (its catalog says); one it lacks steps down to its highest
function codexEffort(model: string, effort?: CodirEffort): string | undefined {
  if (!effort) return undefined
  const has = (codexCatalog ?? CODEX_FALLBACK).find((m) => m.id === model)?.efforts
  if (!has?.length || has.includes(effort)) return effort
  const order = ['low', 'medium', 'high', 'xhigh', 'max']
  return [...order.slice(0, order.indexOf(effort))].reverse().find((e) => has.includes(e)) ?? has[has.length - 1]
}

// Gemini CLI reads its MCP servers and tool limits from settings files. The app's go in a file of
// their own, named by GEMINI_CLI_SYSTEM_SETTINGS_PATH (the highest of their settings files), so
// his own settings are neither touched nor needed. trust = "all tool call confirmations for this
// server" are bypassed: headless, nobody could answer one.
const GEMINI_READ = ['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory']
function geminiSettings(o: { web?: boolean; mcp?: { port: number; token: string } }): Record<string, unknown> {
  return {
    ...(o.mcp ? { mcpServers: { vidancer: { httpUrl: `http://127.0.0.1:${o.mcp.port}/mcp`, headers: { Authorization: `Bearer ${o.mcp.token}` }, trust: true, timeout: 600_000 } } } : {}),
    mcp: { allowed: ['vidancer'] },
    tools: { core: [...GEMINI_READ, ...(o.web ? ['google_web_search', 'web_fetch'] : [])] } // no shell, no write_file, no replace
  }
}
const geminiArgs = (o: { model: string; format: 'json' | 'stream-json'; dirs?: string[] }): string[] => [
  '-m', o.model,
  '--output-format', o.format,
  '--approval-mode', 'default',
  '--allowed-mcp-server-names', 'vidancer', // his own MCP servers stay out
  '-e', 'none', // and his extensions
  ...(o.dirs?.length ? ['--include-directories', o.dirs.join(',')] : [])
]

const workDir = async (): Promise<string> => {
  const dir = join(app.getPath('userData'), 'codir-cli') // an empty folder of the app's own: no foreign AGENTS.md / .codex can ride in
  await mkdir(dir, { recursive: true })
  return dir
}

const CODEX_AUTH_RE = /not logged in|log ?in again|sign in again|401 unauthorized|refresh token|authentication (failed|required|error)|\bunauthorized\b/i
const GEMINI_AUTH_RE = /set an auth method|re-?authenticate|login required|failed to (login|authenticate)|invalid_grant|unauthenticated|GEMINI_API_KEY/i
const authFailed = (kind: OtherCli, hay: string, code: number | null): boolean => (kind === 'codex' ? CODEX_AUTH_RE.test(hay) : code === 41 || GEMINI_AUTH_RE.test(hay)) // 41 = Gemini CLI's exit code for an authentication error

// one JSONL line of either tool, read into the same few facts
interface Run {
  texts: string[] // what it said (each = one chat bubble)
  cur: string // Gemini: the message being streamed
  errors: string[]
  done: boolean
  input: number
  cached: number
  cacheWrite: number
  output: number
  rounds: number
}
const newRun = (): Run => ({ texts: [], cur: '', errors: [], done: false, input: 0, cached: 0, cacheWrite: 0, output: 0, rounds: 0 })

function readLine(kind: OtherCli, line: string, r: Run, on: { text?: (t: string) => void; status?: (t: string) => void; ran?: (name: string, what: string) => void }): void {
  const s = line.trim()
  if (!s.startsWith('{')) return
  let ev: Record<string, any>
  try {
    ev = JSON.parse(s)
  } catch {
    return
  }
  const say = (t: string): void => {
    if (!t.trim()) return
    r.texts.push(t)
    on.text?.(t)
  }
  if (kind === 'codex') {
    // exec_events.rs: thread.started · turn.started · turn.completed{usage} · turn.failed{error} ·
    // item.started / item.updated / item.completed{item} · error{message}
    const it = ev.item as { type?: string; text?: string; query?: string; message?: string } | undefined
    if (ev.type === 'thread.started') on.status?.('thinking…')
    else if (ev.type === 'item.started' && it?.type === 'web_search') on.status?.(`searching: ${it.query ?? ''}…`)
    else if (ev.type === 'item.completed' && it?.type === 'agent_message') say(it.text ?? '')
    else if (ev.type === 'item.completed' && it?.type === 'web_search') on.ran?.('web_search', it.query ?? '') // list 29: a search goes on the reply's list like any tool
    else if (ev.type === 'item.completed' && it?.type === 'error' && it.message) r.errors.push(it.message)
    else if (ev.type === 'turn.completed') {
      const u = (ev.usage ?? {}) as Record<string, number>
      r.cached += u.cached_input_tokens ?? 0
      r.cacheWrite += u.cache_write_input_tokens ?? 0
      r.input += Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)) // theirs counts the cached part in; ours keeps it apart
      r.output += u.output_tokens ?? 0
      r.rounds++
      r.done = true
    } else if (ev.type === 'turn.failed') r.errors.push(String(ev.error?.message ?? 'the turn failed'))
    else if (ev.type === 'error' && ev.message) r.errors.push(String(ev.message))
    return
  }
  // Gemini CLI (output/types.ts): init · message{role, content, delta} · tool_use{tool_name, parameters} ·
  // tool_result · error{severity, message} · result{status, error, stats}
  const flush = (): void => {
    say(r.cur)
    r.cur = ''
  }
  if (ev.type === 'init') on.status?.('thinking…')
  else if (ev.type === 'message' && ev.role === 'assistant') r.cur += String(ev.content ?? '')
  else if (ev.type === 'tool_use') {
    flush()
    r.rounds++
    const name = String(ev.tool_name ?? '')
    const p = (ev.parameters ?? {}) as Record<string, unknown>
    if (name === 'google_web_search' || name === 'web_fetch') {
      const what = String(p.query ?? p.prompt ?? p.url ?? '')
      on.ran?.(name === 'google_web_search' ? 'web_search' : 'web_fetch', what)
      on.status?.(name === 'web_fetch' ? `reading ${what || 'a page'}…` : `searching: ${what}…`)
    } else if (!name.startsWith(LANG.gemini.prefix)) on.status?.('looking at project files…') // the app's own tools report themselves through the MCP server
  } else if (ev.type === 'error' && ev.severity === 'error' && ev.message) r.errors.push(String(ev.message))
  else if (ev.type === 'result') {
    flush()
    const st = (ev.stats ?? {}) as Record<string, number>
    r.cached += st.cached ?? 0
    r.input += st.input ?? Math.max(0, (st.input_tokens ?? 0) - (st.cached ?? 0))
    r.output += st.output_tokens ?? 0
    if (ev.status === 'success') r.done = true
    else r.errors.push(String(ev.error?.message ?? 'the run failed'))
  }
}

function failureText(kind: OtherCli, r: Run, stderrTail: string, code: number | null): string {
  const name = CLI_NAMES[kind].tool
  if (authFailed(kind, `${r.errors.join('\n')}\n${stderrTail}`, code)) {
    markLoggedOut(kind)
    return cliLoginExpired(kind)
  }
  if (r.errors.length) return `${name}: ${r.errors[r.errors.length - 1].slice(0, 500)}`
  if (/unknown option|unexpected argument|unknown argument|unrecognized/i.test(stderrTail)) return `This ${name} is too old for the app — update it (${SPEC[kind].install}). Detail: ${stderrTail.slice(-300)}`
  return `${name} exited (${code ?? '?'})${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`
}

// ---- one-shot sub-calls: text in, text out, no tools (the same job as bridgeOneShot on Claude Code).
// images = files the model has to SEE (the watch lane's still frames). ----
export async function cliOneShot(kind: OtherCli, opts: { prompt: string; system?: string; model: string; timeoutMs?: number; signal?: AbortSignal; images?: string[] }): Promise<{ ok: boolean; text?: string; error?: string; inputTokens: number; outputTokens: number }> {
  const info = await detectCli(kind)
  if (!info.found) return { ok: false, error: `${CLI_NAMES[kind].tool} not found`, inputTokens: 0, outputTokens: 0 }
  const cwd = await workDir()
  const prompt = opts.system ? `## Instructions\n${opts.system}\n\n## Input\n${opts.prompt}` : opts.prompt
  let child: ChildProcess
  let settingsFile: string | undefined
  if (kind === 'codex') child = spawnCli(info, codexArgs({ model: opts.model, images: opts.images }), cwd)
  else {
    settingsFile = join(app.getPath('userData'), `codir-gemini-${process.pid}-${Date.now()}.json`)
    await writeFile(settingsFile, JSON.stringify(geminiSettings({})), 'utf-8')
    const dirs = Array.from(new Set((opts.images ?? []).map((f) => dirname(f)))) // its file tools only read inside its workspace
    child = spawnCli(info, geminiArgs({ model: opts.model, format: 'stream-json', dirs }), cwd, { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile })
  }
  const r = newRun()
  let stderrTail = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child)
  }, opts.timeoutMs ?? 3 * 60_000)
  const onAbort = (): void => killTree(child)
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  child.stdin?.on('error', () => {})
  child.stdin?.write(prompt)
  child.stdin?.end()
  child.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString('utf-8')).slice(-2000)
  })
  const rl = createInterface({ input: child.stdout! })
  rl.on('line', (line) => readLine(kind, line, r, {}))
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve)
    child.on('error', (e) => {
      stderrTail += String(e)
      resolve(null)
    })
  })
  rl.close()
  clearTimeout(timer)
  opts.signal?.removeEventListener('abort', onAbort)
  if (settingsFile) void unlink(settingsFile).catch(() => {})
  if (r.cur.trim()) r.texts.push(r.cur) // a Gemini run cut before its `result` line
  const use = { inputTokens: r.input + r.cached, outputTokens: r.output }
  if (opts.signal?.aborted) return { ok: false, error: 'cancelled', ...use }
  if (timedOut) return { ok: false, error: 'sub-call timeout', ...use }
  const out = r.texts.join('\n').trim()
  if (!out || !r.done) return { ok: false, error: failureText(kind, r, stderrTail, code), ...use }
  return { ok: true, text: out, ...use }
}

// ---- the exchange ----
let inflight: { child: ChildProcess; cancelled: boolean } | null = null
export function cancelCli(): void {
  if (inflight) {
    inflight.cancelled = true
    killTree(inflight.child)
  }
  cancelCliLogin()
}

const HISTORY_CAP = 40 // transcript messages re-sent per exchange (parity with the other engines)
const WALL_MS = 10 * 60_000 // a hung tool must never wedge the panel
const wallMs = (effort?: CodirEffort): number => WALL_MS * (effort === 'max' ? 3 : effort === 'xhigh' ? 2 : effort === 'high' ? 1.5 : 1)

export async function cliSend(
  kind: OtherCli,
  opts: { text: string; imageIds: string[]; selectedClipId: string | null; focus: FocusIn; guideLoad?: Record<string, boolean>; model: string; rlm?: boolean; heat?: number; moods?: string[]; effort?: CodirEffort; web?: boolean },
  progress: Progress,
  pushDelta: (d: ProjectDelta) => void
): Promise<CoDirSendResult> {
  const p = getProject()
  if (!p) return { ok: false, error: 'No project open.' }
  if (inflight) return { ok: false, error: 'The Co-Director is already working — wait or cancel first.' }
  const name = CLI_NAMES[kind].tool
  const info = await detectCli(kind)
  if (!info.found) return { ok: false, error: `The Co-Director is set to ${name}, but it was not found on this machine — see Settings → co-director.` }
  // Gemini CLI reads <folder>/.gemini/settings.json from where it runs, and it runs in the project
  // folder (its file tools only read inside it). A video project has no business carrying one.
  if (kind === 'gemini' && existsSync(join(p.dir, '.gemini')))
    return { ok: false, error: 'this project folder contains a .gemini directory — the Co-Director refuses to run Gemini CLI with foreign settings inside a video project (remove that folder to use it here)' }

  const usage: CoDirUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, rounds: 0 }
  const ran: string[] = [] // the tools this reply ran — kept on its log entry (list 28)
  let mcp: Awaited<ReturnType<typeof startCodirMcp>> | null = null
  let settingsFile: string | undefined
  try {
    progress({ kind: 'status', text: `${name}: starting…` })
    const lang = LANG[kind]
    const guide = [await buildSystemGuides(opts.guideLoad), toolListBlock(lang.prefix), await moodBlock(opts.moods ?? [])].filter(Boolean).join('\n\n\n')
    const context = (opts.rlm ? buildCoreContext : buildContext)(p, opts.selectedClipId, opts.focus, opts.heat)

    // attached refs ride as PATHS: the tool looks at them itself (the Claude bridge's way)
    const sel = opts.selectedClipId ? p.clips.find((c) => c.id === opts.selectedClipId) : undefined
    const refIds = Array.from(new Set([...opts.imageIds, ...(sel?.promptData.imageIds ?? [])]))
    const refLines = refIds
      .map((id) => p.images.find((i) => i.id === id))
      .filter((im): im is NonNullable<typeof im> => !!im && existsSync(im.file))
      .map((im) => `${im.title} → ${im.file}`)
    for (const pic of openImageGenPics(p)) if (existsSync(pic.file)) refLines.push(`${pic.label} → ${pic.file}`)
    const history = liveTail(p).slice(-HISTORY_CAP).map((m) => `${m.role === 'user' ? 'User' : 'Co-Director'}: ${logText(m)}`)
    usage.sections = { guides: guide.length, context: context.length, history: history.join('\n\n').length, message: opts.text.length, images: refLines.length }
    const system = systemFor(kind)
    const payload = [
      ...(kind === 'gemini' ? ['## Who you are here', system, ''] : []), // Codex takes it as developer instructions; Gemini CLI has no such door
      '## Instructions & guides',
      guide,
      '\n## Live project state',
      context,
      `\n## Attached ref images — call ${lang.look} on these exact paths to SEE them`,
      refLines.length ? refLines.join('\n') : '(none attached)',
      `Any other Library image: read_object its @title for its file, then ${lang.look} that file. A file under images/ that no @title opens is one the director deleted, or an internal one: never open, use or describe it.`,
      '\n## Conversation so far',
      history.length ? history.join('\n\n') : '(new conversation)',
      '\n## New user message — respond to this',
      opts.text
    ].join('\n')
    void writeFile(LAST_PROMPT_FILE(), `## ${name.toUpperCase()} (a fresh run)\n\n${payload}`, 'utf-8').catch(() => {})

    mcp = await startCodirMcp({
      onStatus: (text) => progress({ kind: 'status', text }),
      onWrote: (text) => progress({ kind: 'wrote', text }),
      onLive: (live) => progress({ kind: 'live', live }),
      onScreen: (screen) => progress({ kind: 'screen', screen }),
      onTool: (tool, out) => ran.push(toolLine(tool, out)),
      pushDelta
    })

    let child: ChildProcess
    if (kind === 'codex') {
      child = spawnCli(info, codexArgs({ model: opts.model, effort: codexEffort(opts.model, opts.effort), web: opts.web, system, mcp }), await workDir(), { VIDANCER_MCP_TOKEN: mcp.token })
    } else {
      settingsFile = join(app.getPath('userData'), 'codir-gemini-settings.json')
      await writeFile(settingsFile, JSON.stringify(geminiSettings({ web: opts.web, mcp })), 'utf-8')
      child = spawnCli(info, geminiArgs({ model: opts.model, format: 'stream-json' }), p.dir, { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile })
    }
    inflight = { child, cancelled: false }
    const r = newRun()
    let stderrTail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, wallMs(opts.effort))
    child.stdin?.on('error', () => {}) // EPIPE when the tool dies at once — surfaced through its exit, not a crash
    child.stdin?.write(payload)
    child.stdin?.end()
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString('utf-8')).slice(-4000)
    })
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) =>
      readLine(kind, line, r, {
        text: (t) => progress({ kind: 'text', text: t }),
        status: (t) => progress({ kind: 'status', text: `${name}: ${t}` }),
        ran: (tool, what) => ran.push(toolLine(tool, what))
      })
    )
    const code = await new Promise<number | null>((resolve) => {
      child.on('close', resolve)
      child.on('error', (e) => {
        stderrTail += String(e)
        resolve(null)
      })
    })
    rl.close()
    clearTimeout(timer)
    if (r.cur.trim()) {
      r.texts.push(r.cur)
      progress({ kind: 'text', text: r.cur })
    }
    usage.inputTokens = r.input
    usage.outputTokens = r.output
    usage.cacheReadTokens = r.cached
    usage.cacheWriteTokens = r.cacheWrite
    usage.rounds = r.rounds

    if (inflight?.cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    if (timedOut) throw new Error(`${name} gave no result within ${Math.round(wallMs(opts.effort) / 60_000)} minutes`)
    if (!r.done) throw new Error(failureText(kind, r, stderrTail, code))

    const reply = r.texts.join('\n\n').trim() || '(done)'
    const stamp = Date.now()
    const logDelta = await codirAppend([
      { role: 'user', text: opts.text, at: stamp, ...(opts.imageIds.length ? { imageIds: opts.imageIds } : {}) },
      { role: 'assistant', text: reply, at: stamp, ...(ran.length ? { tools: ran } : {}) }
    ])
    return { ok: true, reply, usage, logDelta }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    const emsg = aborted ? 'cancelled' : err instanceof Error ? err.message : String(err)
    // keep the transcript honest — the user's message happened even if the exchange failed
    const stamp = Date.now()
    const logDelta = await codirAppend([
      { role: 'user', text: opts.text, at: stamp },
      { role: 'assistant', text: `⚠ ${emsg}`, at: stamp, ...(ran.length ? { tools: ran } : {}) }
    ]).catch(() => null)
    return { ok: false, error: emsg, usage, logDelta }
  } finally {
    mcp?.close()
    if (settingsFile) void unlink(settingsFile).catch(() => {})
    inflight = null
  }
}
