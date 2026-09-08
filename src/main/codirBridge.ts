// Co-Director BRIDGE engine (experimental, settings.codirEngine === 'bridge') — exchanges run
// through the user's OWN locally installed + logged-in Claude Code CLI in headless mode instead
// of the Anthropic API, so usage rides their Claude subscription (no API key, no per-token bill).
// The project write-tools reach back over a per-exchange localhost MCP server (codirMcp.ts) into
// the SAME runTool as the API engine. On top, the CLI gets read-only file tools (Read/Glob/Grep)
// so it can SEE any Library image or take on disk — no base64 attach, no image cap. Direct file
// writes stay impossible: Bash/Write/Edit are disallowed and the CLI's permission gate auto-denies
// anything not allowlisted in headless mode.
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
import { buildContext, buildCoreContext, liveTail, type CoDirSendResult, type CoDirUsage } from './codir'
import { startCodirMcp } from './codirMcp'
import type { ProjectDelta } from '@koan/vidancer-ui/shared/types'

// bridge model list — the user's SUBSCRIPTION models, so no per-token prices on the labels.
// Fable 5 (Mythos tier) is the default: it's the strongest model their plan carries, and the
// whole point of the bridge is getting it into the Co-Director without API billing.
export const CODIR_BRIDGE_DEFAULT_MODEL = 'claude-fable-5'
export const CODIR_BRIDGE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-fable-5', label: 'Fable 5 — the strongest (bridge default)' },
  { id: 'claude-opus-5', label: 'Opus 5 — strong writing' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
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
  detail: string // one human line for the Settings card
}

const run = (file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000, windowsHide: true, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
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
      cached = { found: true, version, runner: 'exe', exePath: exe, detail: `${version} — ${exe.includes('node_modules') ? 'npm install' : 'native install'}` }
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
      cached = {
        found: true,
        version,
        runner: 'node-cli',
        cliJs,
        nodePath,
        electronAsNode,
        detail: `${version} — npm install (legacy), run by ${electronAsNode ? "the app's own runtime" : 'system Node'}`
      }
      return cached
    }
  }

  cached = { found: false, detail: 'Claude Code CLI not found on this machine' }
  return cached
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
  const hay = `${stderrTail}\n${resultText}`.toLowerCase()
  if (/(log ?in|logged out|authenticat|credential|api key|oauth|billing|subscription required)/.test(hay))
    return 'Claude Code isn’t logged in — open a terminal, run `claude`, log in once with your Claude account, then retry.'
  if (/unknown option|unknown argument/.test(hay)) return `This Claude Code version doesn’t support the bridge flags — update it (npm update -g @anthropic-ai/claude-code). Detail: ${stderrTail.slice(-300)}`
  return `Claude Code exited (${code ?? '?'})${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`
}

export async function codirBridgeSend(
  opts: {
    text: string
    imageIds: string[]
    selectedClipId: string | null
    focus: { kind: string; ownerId: string; path: string } | null
    guideLoad?: Record<string, boolean>
    model?: string
    rlm?: boolean // RLM context mode — core index instead of the full snapshot (spec 2026-08-27)
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
  const cfgFile = join(app.getPath('userData'), 'codir-bridge-mcp.json')
  let mcp: Awaited<ReturnType<typeof startCodirMcp>> | null = null
  try {
    progress({ kind: 'status', text: 'bridge: starting Claude Code…' })
    const guide = await buildSystemGuides(opts.guideLoad)
    const context = (opts.rlm ? buildCoreContext : buildContext)(p, opts.selectedClipId, opts.focus)
    const model = opts.model || CODIR_BRIDGE_DEFAULT_MODEL
    const guideMark = markOf(guide)

    // attached refs ride as PATHS, not base64 — bridge Claude reads them itself, uncapped
    const sel = opts.selectedClipId ? p.clips.find((c) => c.id === opts.selectedClipId) : undefined
    const refIds = Array.from(new Set([...opts.imageIds, ...(sel?.promptData.imageIds ?? [])]))
    const refLines = refIds
      .map((id) => p.images.find((i) => i.id === id))
      .filter((im): im is NonNullable<typeof im> => !!im && existsSync(im.file))
      .map((im) => `${im.title} → ${im.file}`)

    // a session is only resumable for the same project + model + guide set, and only for
    // RESEED_EVERY exchanges — anything else re-seeds fresh
    const resumeId =
      session && session.dir === p.dir && session.model === model && session.guideMark === guideMark && session.exchanges < RESEED_EVERY ? session.id : null

    const refsBlock = [
      '\n## Attached ref images — call Read on these exact paths to SEE them',
      refLines.length ? refLines.join('\n') : '(none attached)',
      'Everything else in the project folder (other Library images, take videos) is readable too — Glob/Grep/Read from the working directory.'
    ]
    const buildPayload = (resuming: boolean): string => {
      if (resuming)
        // the session already carries the guides and the whole conversation — pipe only what moved
        return ['## Live project state (fresh — supersedes every earlier state block)', context, ...refsBlock, '\n## New user message — respond to this', opts.text].join('\n')
      const history = liveTail(p).slice(-BRIDGE_HISTORY_CAP).map((m) => `${m.role === 'user' ? 'User' : 'Co-Director'}: ${m.text}`)
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
        ...(resume ? ['--resume', resume] : []),
        '--output-format', 'stream-json',
        '--verbose', // -p + stream-json requires it
        '--append-system-prompt', SYSTEM_APPEND,
        '--mcp-config', cfgFile,
        '--strict-mcp-config', // the user's personal MCP servers must never leak into app exchanges
        '--setting-sources', 'project', // nor their user-level settings/hooks; the video project dir carries none
        '--allowedTools', 'mcp__vidancer', 'Read', 'Glob', 'Grep',
        '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
        '--max-turns', String(BRIDGE_MAX_TURNS)
      ]
      const a: Attempt = { code: null, resultEv: null, finalTexts: [], stderrTail: '', newSessionId: null, cancelled: false, timedOut: false }
      const child = spawnCli(info, args, p.dir)
      inflight = { child, cancelled: false }
      const timer = setTimeout(() => {
        a.timedOut = true
        killTree(child)
      }, BRIDGE_TIMEOUT_MS)

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
        let ev: { type?: string; subtype?: string; model?: string; session_id?: string; message?: { content?: { type: string; text?: string; name?: string }[] } } & Record<string, unknown>
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

    const ok = (x: Attempt): boolean => !!x.resultEv && (x.resultEv.subtype === 'success' || x.finalTexts.length > 0)

    let usedResume = !!resumeId
    let a = await attempt(resumeId)
    if (resumeId && !ok(a) && !a.cancelled && !a.timedOut) {
      // the saved session is gone (CLI updated, storage pruned, id expired) — re-seed fresh, once
      resetBridgeSession()
      usedResume = false
      progress({ kind: 'status', text: 'bridge: session expired — starting fresh…' })
      a = await attempt(null)
    }

    if (a.cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    if (a.timedOut) throw new Error('bridge timeout — Claude Code gave no result within 10 minutes')

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
      { role: 'assistant', text: reply, at: stamp }
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
      { role: 'assistant', text: `⚠ ${emsg}`, at: stamp }
    ]).catch(() => null)
    return { ok: false, error: emsg, usage, logDelta }
  } finally {
    mcp?.close()
    void unlink(cfgFile).catch(() => {})
    inflight = null
  }
}
