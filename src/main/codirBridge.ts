// Co-Director BRIDGE engine (experimental, settings.codirEngine === 'bridge') — exchanges run
// through the user's OWN locally installed + logged-in Claude Code CLI in headless mode instead
// of the Anthropic API, so usage rides their Claude subscription (no API key, no per-token bill).
// The project write-tools reach back over a per-exchange localhost MCP server (codirMcp.ts) into
// the SAME runTool as the API engine. On top, the CLI gets read-only file tools (Read/Glob/Grep)
// so it can SEE any Library image or take on disk — no base64 attach, no image cap. Direct file
// writes stay impossible: Bash/Write/Edit are disallowed and the CLI's permission gate auto-denies
// anything not allowlisted in headless mode. Its own WebSearch / WebFetch stay shut too, and open
// only for an exchange where the director asked for research (list 29).
//
// Sessions: the FIRST exchange seeds one CLI conversation with guides + transcript; every
// exchange after --resumes it and pipes only fresh project state + the new message, so the
// prefix returns as cache reads (~1/10 window weight vs fresh input). Sessions deliberately
// re-seed every RESEED_EVERY exchanges — each resume appends a superseded state block, and an
// unbounded stack swells the cache reads until the CLI auto-compacts mid-conversation at full
// price; a scheduled re-seed pays the small seed cost at a boundary WE pick instead.
import { spawn, execFile, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { getProject, codirAppend } from './project'
import { buildSystemGuides } from './guides'
import { moodBlock } from './moods'
import { buildContext, buildCoreContext, liveTail, openImageGenPics, logText, toolLine, toolListBlock, LAST_PROMPT_FILE, type CoDirSendResult, type CoDirUsage, type FocusIn } from './codir'
import { startCodirMcp } from './codirMcp'
import type { ProjectDelta } from '@koan/vidancer-ui/shared/types'
import { CLI_TOO_OLD_RE, cliTooOldText, type CodirEffort } from '@koan/vidancer-ui/shared/models'

// bridge model list — the user's SUBSCRIPTION models, so no per-token prices on the labels.
// The newest Fable is the default: it's the strongest model their plan carries, and the whole
// point of the bridge is getting it into the Co-Director without API billing. The newest of each
// line first, the first row = the default (list 25).
export const CODIR_BRIDGE_DEFAULT_MODEL = 'claude-fable-5-1'
// minCli = the oldest Claude Code that serves the model: Opus 5.5 read off the CLI's own 400
// (2026-09-29), Fable 5.1 and Sonnet 5.5 off Claude Code's changelog ("Added Claude …", 2026-09-30).
// The label up to " — " is the model's name: the Director's Room chip shows it.
export const CODIR_BRIDGE_MODELS: { id: string; label: string; minCli?: string }[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1 — the strongest (bridge default)', minCli: '2.1.257' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — strongest writing', minCli: '2.1.280' }, // his order 2026-09-28 (list 51)
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — balanced, easy on the 5-hour window', minCli: '2.1.284' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest' }
]

// settings.codirBridgeModel outlives the list: a model we drop (or Anthropic
// retires) stays saved on disk and would otherwise keep being handed to --model
// while the Settings dropdown shows nothing. Anything off the list = the default.
export const resolveBridgeModel = (id?: string): string =>
  CODIR_BRIDGE_MODELS.some((m) => m.id === id) ? (id as string) : CODIR_BRIDGE_DEFAULT_MODEL

const BRIDGE_HISTORY_CAP = 40 // transcript messages re-sent per exchange (parity with the API engine)
const BRIDGE_MAX_TURNS = 30 // CLI-side agentic round cap (the CLI counts tool round-trips as turns)
const BRIDGE_TIMEOUT_MS = 10 * 60_000 // hard wall for one exchange — a hung CLI must never wedge the panel
// a harder thinker gets a longer wall (list 26): the wall is for a hung CLI, not for deep work
const bridgeWallMs = (effort?: CodirEffort): number => BRIDGE_TIMEOUT_MS * (effort === 'max' ? 3 : effort === 'xhigh' ? 2 : effort === 'high' ? 1.5 : 1)

type Progress = (e: { kind: 'status' | 'text' | 'wrote' | 'live' | 'screen'; text?: string; live?: import('@koan/vidancer-ui/shared/types').CoDirLiveWrite; screen?: import('@koan/vidancer-ui/shared/types').CoDirScreenEvent }) => void

// ---- CLI detection ----
export interface BridgeCliInfo {
  found: boolean
  version?: string
  runner?: 'node-cli' | 'exe'
  cliJs?: string
  nodePath?: string // absent on runner 'exe'; equals process.execPath when Electron doubles as Node
  exePath?: string
  electronAsNode?: boolean
  loggedIn?: boolean // `claude auth status` — undefined on a CLI too old to answer
  detail: string // one human line for the Settings card
}
// 2026-09-23: an expired Claude login came back as the CLI's chat reply ("Failed to authenticate:
// OAuth session expired…") and three Score composes died on "no JSON beats" with nothing to read
const AUTH_RE = /failed to authenticate|oauth session expired|not logged in|please log in|invalid api key|authentication_error/i
export const LOGIN_EXPIRED = 'Your Claude login has expired — sign in to Claude Code again, then retry.'
// 2026-09-29: an installed Claude Code older than the model answered as a chat reply — our line
// instead, which the panel reads to offer the update
const tooOldOf = (hay: string): string | null => {
  const m = CLI_TOO_OLD_RE.exec(hay)
  return m ? cliTooOldText(m[1], m[2]) : null
}

const run = (file: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 10_000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    })
  })

async function findOnPath(name: string): Promise<string[]> {
  const r = process.platform === 'win32' ? await run('where.exe', [name]) : await run('which', ['-a', name])
  return r.ok ? r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
}

let cached: BridgeCliInfo | null = null

export async function detectClaudeCli(refresh = false): Promise<BridgeCliInfo> {
  if (cached && !refresh) return cached

  const pathHits = await findOnPath('claude')

  // npm-global roots: the default prefix plus wherever a claude.cmd/.ps1 shim on PATH lives.
  // We NEVER spawn the shims themselves (Node refuses .cmd without a shell, rightly) — we go
  // for what they point at inside node_modules.
  const npmRoots: string[] = []
  if (process.env.APPDATA) npmRoots.push(join(process.env.APPDATA, 'npm'))
  for (const hit of pathHits) if (/\.(cmd|ps1)$/i.test(hit)) npmRoots.push(dirname(hit))

  // modern layout first: Claude Code 2.x ships a NATIVE binary at bin/claude(.exe) inside the npm
  // package (verified 2.1.220 — package.json bin → "bin/claude.exe"; there is no cli.js anymore).
  // Then the no-Node native installer locations, then bare .exe hits from PATH.
  const exeCandidates: string[] = []
  for (const root of npmRoots) exeCandidates.push(join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'))
  exeCandidates.push(
    ...(process.platform === 'win32'
      ? [join(homedir(), '.local', 'bin', 'claude.exe')]
      : [join(homedir(), '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'])
  )
  for (const hit of pathHits) if (/\.exe$/i.test(hit) || (process.platform !== 'win32' && !/\./.test(hit.split(/[\\/]/).pop() ?? '.'))) exeCandidates.push(hit)
  for (const exe of exeCandidates) {
    if (!existsSync(exe)) continue
    const probe = await run(exe, ['--version'])
    if (probe.ok) {
      const version = probe.out.split(/\r?\n/)[0]
      cached = await withLogin({ found: true, version, runner: 'exe', exePath: exe, detail: `${version} — ${exe.includes('node_modules') ? 'npm install' : 'native install'}` })
      return cached
    }
  }

  // legacy npm layout (pre-2.x): cli.js run under a real Node (or Electron-as-Node)
  const cliJs = npmRoots.map((r) => join(r, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')).find((f) => existsSync(f))
  if (cliJs) {
    const nodes = await findOnPath(process.platform === 'win32' ? 'node.exe' : 'node')
    const systemNode = nodes.find((n) => existsSync(n))
    const nodePath = systemNode ?? process.execPath
    const electronAsNode = !systemNode
    const probe = await run(nodePath, [cliJs, '--version'], electronAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : undefined)
    if (probe.ok) {
      const version = probe.out.split(/\r?\n/)[0]
      cached = await withLogin({
        found: true,
        version,
        runner: 'node-cli',
        cliJs,
        nodePath,
        electronAsNode,
        detail: `${version} — npm install (legacy), run by ${electronAsNode ? "the app's own runtime" : 'system Node'}`
      })
      return cached
    }
  }

  cached = { found: false, detail: 'Claude Code CLI not found on this machine' }
  return cached
}

// the login probe: `claude auth status --json` → { loggedIn } (Claude Code 2.1.220)
async function withLogin(info: BridgeCliInfo): Promise<BridgeCliInfo> {
  const args = ['auth', 'status', '--json']
  const r = info.runner === 'node-cli' ? await run(info.nodePath!, [info.cliJs!, ...args], cliEnv(info)) : await run(info.exePath!, args, cliEnv(info))
  let loggedIn: boolean | undefined
  try {
    loggedIn = !!(JSON.parse(r.out.slice(r.out.indexOf('{'))) as { loggedIn?: boolean }).loggedIn
  } catch {
    /* a CLI without `auth status` — unknown, not false */
  }
  return { ...info, loggedIn, detail: loggedIn === false ? `${info.detail} — NOT LOGGED IN` : info.detail }
}
// the "update claude code" button (2026-09-29): `claude update` through the same runner the
// bridge uses, then a fresh probe; the CLI session is dropped so the next exchange re-seeds
export async function updateClaudeCli(): Promise<BridgeCliInfo & { updated: boolean; out: string }> {
  const info = await detectClaudeCli(true)
  if (!info.found) return { ...info, updated: false, out: 'Claude Code not found' }
  const r = info.runner === 'node-cli' ? await run(info.nodePath!, [info.cliJs!, 'update'], cliEnv(info), 5 * 60_000) : await run(info.exePath!, ['update'], cliEnv(info), 5 * 60_000)
  resetBridgeSession()
  const after = await detectClaudeCli(true)
  return { ...after, updated: after.version !== info.version, out: r.out.slice(-600) }
}
// a lane just saw the login fail — Settings shows it without a re-check
function markLoggedOut(): void {
  if (cached?.found && cached.loggedIn !== false) cached = { ...cached, loggedIn: false, detail: `${cached.detail} — NOT LOGGED IN` }
}

// ---- spawning ----
function cliEnv(info: BridgeCliInfo): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // the bridge's whole point is the user's subscription login — an API key in the environment
  // would silently reroute billing, and a custom base URL could reroute the traffic itself
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  if (info.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  // load the app's 35 tools up front. Left on, Claude Code hides them behind a ToolSearch tool and
  // the model spends a full round (a full prompt re-read) finding them — 21 such rounds in one day
  // (director 2026-09-10). Docs: code.claude.com/docs/en/agent-sdk/tool-search
  env.ENABLE_TOOL_SEARCH = 'false'
  return env
}

function spawnCli(info: BridgeCliInfo, args: string[], cwd: string): ChildProcess {
  if (info.runner === 'node-cli') return spawn(info.nodePath!, [info.cliJs!, ...args], { cwd, env: cliEnv(info), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  return spawn(info.exePath!, args, { cwd, env: cliEnv(info), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGTERM')
}

// ---- one-shot sub-calls (the RLM plumbing, CODIRECTOR-RLM-PLAN phase 0) ----
// A clean-context single exchange with NO tools and NO session: the prompt carries everything,
// the reply text is the whole result. cwd is userData on purpose — sub-calls never need project
// files, and a foreign <project>/.claude can't inject hooks into a dir we control.
export async function bridgeOneShot(opts: { prompt: string; system?: string; model: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ ok: boolean; text?: string; error?: string; inputTokens: number; outputTokens: number }> {
  const info = await detectClaudeCli()
  if (!info.found) return { ok: false, error: 'Claude Code not found (bridge engine)', inputTokens: 0, outputTokens: 0 }
  const args = [
    '-p',
    '--model', opts.model,
    '--output-format', 'stream-json',
    '--verbose',
    ...(opts.system ? ['--append-system-prompt', opts.system] : []),
    '--strict-mcp-config', // no MCP servers at all — sub-calls are text in, text out
    '--setting-sources', 'project', // userData carries no .claude — nothing loads
    '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'Read', 'Glob', 'Grep',
    '--max-turns', '1'
  ]
  const child = spawnCli(info, args, app.getPath('userData'))
  let text = ''
  let resultText = ''
  let stderrTail = ''
  let inputTokens = 0
  let outputTokens = 0
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(child)
  }, opts.timeoutMs ?? 3 * 60_000)
  const onAbort = (): void => killTree(child)
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  child.stdin?.on('error', () => {})
  child.stdin?.write(opts.prompt)
  child.stdin?.end()
  child.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString('utf-8')).slice(-2000)
  })
  const rl = createInterface({ input: child.stdout! })
  rl.on('line', (line) => {
    const s = line.trim()
    if (!s.startsWith('{')) return
    let ev: { type?: string; subtype?: string; result?: string; usage?: Record<string, number>; message?: { content?: { type: string; text?: string }[] } }
    try {
      ev = JSON.parse(s)
    } catch {
      return
    }
    if (ev.type === 'assistant') for (const b of ev.message?.content ?? []) if (b.type === 'text' && b.text) text += (text ? '\n' : '') + b.text
    if (ev.type === 'result') {
      resultText = ev.result ?? ''
      inputTokens = ev.usage?.input_tokens ?? 0
      outputTokens = ev.usage?.output_tokens ?? 0
    }
  })
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
  rl.close()
  clearTimeout(timer)
  opts.signal?.removeEventListener('abort', onAbort)
  if (opts.signal?.aborted) return { ok: false, error: 'cancelled', inputTokens, outputTokens }
  if (timedOut) return { ok: false, error: 'sub-call timeout', inputTokens, outputTokens }
  const out = (text || resultText).trim()
  const old = tooOldOf(`${out}\n${stderrTail}`)
  if (old) return { ok: false, error: old, inputTokens, outputTokens }
  if (AUTH_RE.test(out) || AUTH_RE.test(stderrTail)) {
    markLoggedOut()
    return { ok: false, error: LOGIN_EXPIRED, inputTokens, outputTokens }
  }
  if (!out) return { ok: false, error: friendlyFailure(stderrTail, resultText, code), inputTokens, outputTokens }
  return { ok: true, text: out, inputTokens, outputTokens }
}

// ---- the exchange ----
let inflight: { child: ChildProcess; cancelled: boolean } | null = null

export function cancelCoDirBridge(): void {
  if (!inflight) return
  inflight.cancelled = true
  killTree(inflight.child)
}

// one live CLI conversation per (project, model, guide set): the first exchange seeds it with the
// guides + transcript, every exchange after --resumes it and pipes ONLY fresh project state + the
// new message. The session's prefix comes back as cache reads, which count a fraction of fresh
// input against the subscription window — without this the bridge re-ingested ~25k tokens of
// guides/history per message ("free in money terms", but the 5-hour window metered every one).
let session: { id: string; dir: string; model: string; guideMark: string; exchanges: number } | null = null

// resumes per session before a deliberate fresh re-seed (see header) — at ~5k of state per
// exchange this keeps the resumed prefix comfortably under the CLI's auto-compact ceiling
const RESEED_EVERY = 12

// forget the CLI session (next exchange starts fresh and re-seeds everything). Called on log
// clear; internally on cancel/timeout/failure, project switch, model or guide change.
export function resetBridgeSession(): void {
  session = null
}

// cheap guide-change detector — length + head catches a load-toggle flip or a guide edit
const markOf = (s: string): string => `${s.length}:${s.slice(0, 64)}`

const SYSTEM_APPEND =
  'You are the Co-Director, the in-app copilot of Video Dancer (an AI video timeline editor). ' +
  'This headless run is ONE chat exchange: the piped user message carries your real instructions, guides, ' +
  'live project state, ref image paths and the conversation so far — follow those instructions as primary. ' +
  'In resumed conversations the NEWEST "Live project state" block supersedes every earlier one. ' +
  'Write into the project EXCLUSIVELY through the mcp__vidancer__* tools (they land in-app and are undoable); ' +
  'never modify project files directly. Use Read/Glob/Grep freely to look at ref images and project media. ' +
  'Every text you print becomes a chat bubble in the Co-Director panel: speak in that voice, stay concise, no markdown headings.'

function friendlyFailure(stderrTail: string, resultText: string, code: number | null): string {
  const old = tooOldOf(`${stderrTail}\n${resultText}`)
  if (old) return old
  const hay = `${stderrTail}\n${resultText}`.toLowerCase()
  if (/(log ?in|logged out|authenticat|credential|api key|oauth|billing|subscription required)/.test(hay)) {
    markLoggedOut()
    return LOGIN_EXPIRED
  }
  if (/unknown option|unknown argument/.test(hay)) return `This Claude Code version doesn’t support the bridge flags — update it (npm update -g @anthropic-ai/claude-code). Detail: ${stderrTail.slice(-300)}`
  return `Claude Code exited (${code ?? '?'})${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`
}

export async function codirBridgeSend(
  opts: {
    text: string
    imageIds: string[]
    selectedClipId: string | null
    focus: FocusIn
    guideLoad?: Record<string, boolean>
    model?: string
    rlm?: boolean // RLM context mode — core index instead of the full snapshot (spec 2026-08-27)
    heat?: number // HEAT 1–5 (tether spec §6)
    moods?: string[] // MOOD slugs riding this exchange — MOODS-VMD-SPEC §6
    effort?: CodirEffort // how hard it thinks (list 26) — Claude Code's own --effort; absent = the model's own level
    web?: boolean // list 29: he asked for research — Claude Code's WebSearch and WebFetch open for this exchange
  },
  progress: Progress,
  pushDelta: (d: ProjectDelta) => void
): Promise<CoDirSendResult> {
  const p = getProject()
  if (!p) return { ok: false, error: 'No project open.' }
  if (inflight) return { ok: false, error: 'The Co-Director is already working — wait or cancel first.' }
  const info = await detectClaudeCli()
  if (!info.found) return { ok: false, error: 'Bridge mode is on but Claude Code was not found — see Settings → experimental.' }

  const usage: CoDirUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, rounds: 0 }
  const ran: string[] = [] // the tools this reply ran — kept on its log entry (list 28)
  const cfgFile = join(app.getPath('userData'), 'codir-bridge-mcp.json')
  let mcp: Awaited<ReturnType<typeof startCodirMcp>> | null = null
  try {
    progress({ kind: 'status', text: 'bridge: starting Claude Code…' })
    const guide = [await buildSystemGuides(opts.guideLoad), toolListBlock('mcp__vidancer__'), await moodBlock(opts.moods ?? [])].filter(Boolean).join('\n\n\n')
    const context = (opts.rlm ? buildCoreContext : buildContext)(p, opts.selectedClipId, opts.focus, opts.heat)
    const model = opts.model || CODIR_BRIDGE_DEFAULT_MODEL
    const guideMark = markOf(guide)

    // attached refs ride as PATHS, not base64 — bridge Claude reads them itself, uncapped
    const sel = opts.selectedClipId ? p.clips.find((c) => c.id === opts.selectedClipId) : undefined
    const refIds = Array.from(new Set([...opts.imageIds, ...(sel?.promptData.imageIds ?? [])]))
    const refLines = refIds
      .map((id) => p.images.find((i) => i.id === id))
      .filter((im): im is NonNullable<typeof im> => !!im && existsSync(im.file))
      .map((im) => `${im.title} → ${im.file}`)
    // the open image gen's refs + ★ take (his order 2026-09-09) ride as paths too
    for (const pic of openImageGenPics(p)) if (existsSync(pic.file)) refLines.push(`${pic.label} → ${pic.file}`)

    // a session is only resumable for the same project + model + guide set, and only for
    // RESEED_EVERY exchanges — anything else re-seeds fresh
    const resumeId =
      session && session.dir === p.dir && session.model === model && session.guideMark === guideMark && session.exchanges < RESEED_EVERY ? session.id : null

    const refsBlock = [
      '\n## Attached ref images — call Read on these exact paths to SEE them',
      refLines.length ? refLines.join('\n') : '(none attached)',
      // 08-27 brief, item 7 (no ghosts): a deleted image's file stays on disk for undo, so a
      // folder listing shows images the director threw away — the Library list is the only truth
      'Any other Library image: read_object its @title for its file, then Read that file. A file under images/ that no @title opens is one the director deleted, or an internal one: never open, use or describe it. Take videos are readable from the working directory.'
    ]
    const buildPayload = (resuming: boolean): string => {
      const history = liveTail(p).slice(-BRIDGE_HISTORY_CAP).map((m) => `${m.role === 'user' ? 'User' : 'Co-Director'}: ${logText(m)}`)
      // what this exchange put in front of the model (a resume carries guides + history from the
      // session — counted as 0 here because they ride as cache reads, not as this payload)
      usage.sections = { guides: resuming ? 0 : guide.length, context: context.length, history: resuming ? 0 : history.join('\n\n').length, message: opts.text.length, images: refLines.length }
      if (resuming)
        // the session already carries the guides and the whole conversation — pipe only what moved
        return ['## Live project state (fresh — supersedes every earlier state block)', context, ...refsBlock, '\n## New user message — respond to this', opts.text].join('\n')
      return [
        '## Instructions & guides',
        guide,
        '\n## Live project state',
        context,
        ...refsBlock,
        '\n## Conversation so far',
        history.length ? history.join('\n\n') : '(new conversation)',
        '\n## New user message — respond to this',
        opts.text
      ].join('\n')
    }

    mcp = await startCodirMcp({
      onStatus: (text) => progress({ kind: 'status', text }),
      onWrote: (text) => progress({ kind: 'wrote', text }),
      onLive: (live) => progress({ kind: 'live', live }),
      onScreen: (screen) => progress({ kind: 'screen', screen }),
      onTool: (name, out) => ran.push(toolLine(name, out)),
      pushDelta
    })
    await writeFile(
      cfgFile,
      JSON.stringify({ mcpServers: { vidancer: { type: 'http', url: `http://127.0.0.1:${mcp.port}/mcp`, headers: { Authorization: `Bearer ${mcp.token}` } } } }),
      'utf-8'
    )

    type Attempt = {
      code: number | null
      resultEv: { subtype?: string; result?: string; num_turns?: number; usage?: Record<string, number>; session_id?: string } | null
      finalTexts: string[]
      stderrTail: string
      newSessionId: string | null
      cancelled: boolean
      timedOut: boolean
    }
    // a shared/downloaded project could carry <project>/.claude/settings.json — with
    // --setting-sources project those settings LOAD from the cwd, and HOOKS execute commands
    // regardless of --disallowedTools. A video project has no business carrying Claude
    // settings; refuse instead of trusting the comment that "the project dir carries none".
    if (existsSync(join(p.dir, '.claude'))) {
      return {
        ok: false,
        error: 'this project folder contains a .claude directory — the bridge refuses to run with foreign Claude settings inside a video project (remove that folder to use the bridge here)'
      }
    }
    const attempt = async (resume: string | null): Promise<Attempt> => {
      const args = [
        '-p',
        '--model', model, // explicit ALWAYS: --setting-sources isolation also blanks any CLI-wide model choice
        ...(opts.effort ? ['--effort', opts.effort] : []),
        ...(resume ? ['--resume', resume] : []),
        '--output-format', 'stream-json',
        '--verbose', // -p + stream-json requires it
        '--append-system-prompt', SYSTEM_APPEND,
        '--mcp-config', cfgFile,
        '--strict-mcp-config', // the user's personal MCP servers must never leak into app exchanges
        '--setting-sources', 'project', // nor their user-level settings/hooks; the video project dir carries none
        '--allowedTools', 'mcp__vidancer', 'Read', 'Glob', 'Grep', ...(opts.web ? ['WebSearch', 'WebFetch'] : []),
        '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', ...(opts.web ? [] : ['WebFetch', 'WebSearch']), 'Task', 'TodoWrite',
        '--max-turns', String(BRIDGE_MAX_TURNS)
      ]
      const a: Attempt = { code: null, resultEv: null, finalTexts: [], stderrTail: '', newSessionId: null, cancelled: false, timedOut: false }
      const child = spawnCli(info, args, p.dir)
      inflight = { child, cancelled: false }
      const timer = setTimeout(() => {
        a.timedOut = true
        killTree(child)
      }, bridgeWallMs(opts.effort))

      child.stdin?.on('error', () => {}) // EPIPE when the CLI dies instantly — surfaced via exit code, not a crash
      child.stdin?.write(buildPayload(!!resume))
      child.stdin?.end()

      child.stderr?.on('data', (c: Buffer) => {
        a.stderrTail = (a.stderrTail + c.toString('utf-8')).slice(-4000)
      })

      const rl = createInterface({ input: child.stdout! })
      rl.on('line', (line) => {
        const s = line.trim()
        if (!s.startsWith('{')) return
        let ev: { type?: string; subtype?: string; model?: string; session_id?: string; message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] } } & Record<string, unknown>
        try {
          ev = JSON.parse(s)
        } catch {
          return
        }
        // every resumed run mints a fresh session id — the LATEST one is what the next exchange resumes
        if (typeof ev.session_id === 'string' && ev.session_id) a.newSessionId = ev.session_id
        if (ev.type === 'system' && ev.subtype === 'init') {
          progress({ kind: 'status', text: `bridge: ${ev.model ?? 'claude'} thinking…${resume ? ' (resumed session)' : ''}` })
        } else if (ev.type === 'assistant') {
          for (const block of ev.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              a.finalTexts.push(block.text)
              progress({ kind: 'text', text: block.text })
            } else if (block.type === 'tool_use' && (block.name === 'WebSearch' || block.name === 'WebFetch')) {
              // list 29: a search or a page read goes on this reply's list like any tool (list 28)
              const what = String(block.input?.query ?? block.input?.url ?? '')
              ran.push(toolLine(block.name === 'WebSearch' ? 'web_search' : 'web_fetch', what))
              progress({ kind: 'status', text: block.name === 'WebFetch' ? `reading ${what || 'a page'}…` : `searching: ${what}…` })
            } else if (block.type === 'tool_use' && block.name && !block.name.startsWith('mcp__vidancer')) {
              progress({ kind: 'status', text: 'looking at project files…' }) // vidancer tools report themselves via the MCP server
            }
          }
        } else if (ev.type === 'result') {
          a.resultEv = ev as Attempt['resultEv'] & object
        }
      })

      a.code = await new Promise<number | null>((resolve) => child.on('close', resolve))
      rl.close()
      clearTimeout(timer)
      a.cancelled = !!inflight?.cancelled
      return a
    }

    const authFailed = (x: Attempt): boolean => AUTH_RE.test(`${x.resultEv?.result ?? ''}\n${x.finalTexts.join('\n')}\n${x.stderrTail}`)
    const tooOld = (x: Attempt): string | null => tooOldOf(`${x.resultEv?.result ?? ''}\n${x.finalTexts.join('\n')}\n${x.stderrTail}`)
    const ok = (x: Attempt): boolean => !!x.resultEv && (x.resultEv.subtype === 'success' || x.finalTexts.length > 0) && !authFailed(x) && !tooOld(x)

    let usedResume = !!resumeId
    void writeFile(LAST_PROMPT_FILE(), `## BRIDGE ${resumeId ? 'RESUMED session ' + resumeId + ' (guides + earlier conversation live in the session, not below)' : 'FRESH session'}\n\n` + buildPayload(!!resumeId), 'utf-8').catch(() => {})
    let a = await attempt(resumeId)
    if (resumeId && !ok(a) && !a.cancelled && !a.timedOut && !authFailed(a) && !tooOld(a)) {
      // the saved session is gone (CLI updated, storage pruned, id expired) — re-seed fresh, once
      resetBridgeSession()
      usedResume = false
      progress({ kind: 'status', text: 'bridge: session expired — starting fresh…' })
      a = await attempt(null)
    }

    if (a.cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    if (a.timedOut) throw new Error(`bridge timeout — Claude Code gave no result within ${Math.round(bridgeWallMs(opts.effort) / 60_000)} minutes`)
    const old = tooOld(a)
    if (old) throw new Error(old)

    const r = a.resultEv
    if (r?.usage) {
      usage.inputTokens = r.usage.input_tokens ?? 0
      usage.outputTokens = r.usage.output_tokens ?? 0
      usage.cacheReadTokens = r.usage.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens = r.usage.cache_creation_input_tokens ?? 0
    }
    usage.rounds = r?.num_turns ?? 0
    if (!ok(a)) throw new Error(friendlyFailure(a.stderrTail, r?.result ?? '', a.code))
    if (r?.subtype === 'error_max_turns') a.finalTexts.push('(bridge hit the round cap — say "continue" to keep going)')

    // remember the conversation for the next exchange (newest id wins — resume re-mints ids);
    // the exchange counter drives the scheduled re-seed
    const keepId = a.newSessionId ?? r?.session_id ?? null
    session = keepId ? { id: keepId, dir: p.dir, model, guideMark, exchanges: usedResume ? (session?.exchanges ?? 0) + 1 : 1 } : null

    const reply = a.finalTexts.join('\n\n').trim() || (r?.result ?? '').trim() || '(done)'
    const stamp = Date.now()
    const logDelta = await codirAppend([
      { role: 'user', text: opts.text, at: stamp, ...(opts.imageIds.length ? { imageIds: opts.imageIds } : {}) },
      { role: 'assistant', text: reply, at: stamp, ...(ran.length ? { tools: ran } : {}) }
    ])
    return { ok: true, reply, usage, logDelta }
  } catch (err) {
    // a cancelled / timed-out / failed run leaves the CLI session in an unknown state — drop it
    // so the next exchange re-seeds clean instead of resuming a half-written conversation
    resetBridgeSession()
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
    void unlink(cfgFile).catch(() => {})
    inflight = null
  }
}
