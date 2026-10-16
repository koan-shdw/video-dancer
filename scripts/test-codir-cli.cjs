// list 35 (2026-10-01) — GPT and other chat logins: the Co-Director on ChatGPT through OpenAI's
// Codex CLI, on Google through the Gemini CLI, and on DeepSeek with a key. His answers: Codex
// first, then Gemini CLI, DeepSeek on a key is an engine too; the install and the sign-in are
// his; "the build is made from their docs and proven against a stand-in". So: the real engine
// code runs here, each command-line tool is a stand-in that speaks the way its own docs and
// sources say (and calls the app's real tool server over localhost), DeepSeek's API is a fake.
// Nothing is sent to anyone and no login is touched.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-cli-'))
const home = path.join(tmp, 'home')
fs.mkdirSync(home)
process.env.APPDATA = path.join(tmp, 'appdata')
process.env.LOCALAPPDATA = path.join(tmp, 'localappdata')
delete process.env.VD_CODEX_CLI
delete process.env.VD_GEMINI_CLI
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

// ---- the stand-in tools ----
const CODEX = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', 'b1', 'codex.exe') // where the Codex app keeps its own copy
const GEMINI = path.join(process.env.APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js') // the npm package's own bin
const CLAUDE = path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude') // where the app looks on each system
for (const f of [CODEX, GEMINI, CLAUDE]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '') }
const world = { codexIn: true, models: true }
const CATALOG = { models: [
  { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 13, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }] },
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }, { effort: 'ultra' }] },
  { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 }
] }
const execs = [], authEnvs = []
const execFile = (file, args, _o, cb) => setImmediate(() => {
  execs.push([path.basename(file), ...args].join(' '))
  const a = args.join(' ')
  if (/where|which/.test(file)) return args[0].startsWith('node') ? cb(null, process.execPath, '') : cb(new Error('not found'), '', '')
  if (file === CODEX) {
    authEnvs.push(_o.env)
    if (a === '--version') return cb(null, 'codex-cli 0.159.2', '')
    if (a === 'logout') { world.codexIn = false; return cb(null, 'Successfully logged out', '') }
    if (a === 'login status') return world.codexIn ? cb(null, 'Logged in using ChatGPT', '') : cb(new Error('exit 1'), '', 'Not logged in')
    if (a === 'debug models') return world.models ? cb(null, JSON.stringify(CATALOG), 'WARN something on stderr') : cb(new Error('exit 2'), '', "error: unrecognized subcommand 'debug'")
  }
  if (args[0] === GEMINI && args[1] === '--version') return cb(null, '0.62.0', '')
  if (file === CLAUDE) return cb(null, a === '--version' ? '2.1.300 (Claude Code)' : a.startsWith('auth') ? '{"loggedIn":true}' : '', '')
  cb(new Error('unexpected: ' + file + ' ' + a), '', '')
})
const realFetch = global.fetch
const rpc = async (url, token, method, params) => (await (await realFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result
const spawned = []
let script = {} // what the stand-in does on its next run
const spawn = (file, args, opts = {}) => {
  const child = new EventEmitter()
  let stdin = ''
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.unref = () => {}
  const rec = { file, args, env: opts.env ?? {}, cwd: opts.cwd, stdin: '' }
  spawned.push(rec)
  const say = (ev) => child.stdout.write(JSON.stringify(ev) + '\n')
  const end = (code = 0) => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code)) }
  const play = async () => {
    rec.stdin = stdin
    const s = script
    if (file === 'cmd.exe') return void (s.signIn && setTimeout(() => { fs.mkdirSync(path.join(home, '.gemini'), { recursive: true }); fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}') }, 30)) // he signs in in the window that opened
    if (file === CODEX && args[0] === 'login') { world.codexIn = !!s.signIn; return end(s.signIn ? 0 : 1) }
    if (file === CODEX) {
      // Codex, the way `codex exec --json` speaks (exec_events.rs)
      if (s.auth) { say({ type: 'error', message: 'Your access token could not be refreshed. Please log out and sign in again.' }); say({ type: 'turn.failed', error: { message: 'unauthorized' } }); return end(1) }
      say({ type: 'thread.started', thread_id: 't-1' })
      say({ type: 'turn.started' })
      const url = args.find((x) => x.startsWith('mcp_servers.vidancer.url='))?.match(/"(.+)"/)[1]
      if (url && s.tool) {
        const token = rec.env.VIDANCER_MCP_TOKEN
        rec.tools = (await rpc(url, token, 'tools/list', {})).tools
        rec.listed = rec.tools.length
        say({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'vidancer', tool: s.tool.name, arguments: s.tool.args, status: 'in_progress' } })
        rec.toolOut = (await rpc(url, token, 'tools/call', { name: s.tool.name, arguments: s.tool.args })).content[0].text
        say({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'vidancer', tool: s.tool.name, arguments: s.tool.args, status: 'completed' } })
      }
      if (s.search) { say({ type: 'item.started', item: { id: 'i2', type: 'web_search', query: s.search } }); say({ type: 'item.completed', item: { id: 'i2', type: 'web_search', query: s.search } }) }
      say({ type: 'item.completed', item: { id: 'i3', type: 'reasoning', text: 'thinking out loud' } })
      for (const t of s.says ?? ['ok']) say({ type: 'item.completed', item: { id: 'i4', type: 'agent_message', text: t } })
      say({ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 10 } })
      return end(0)
    }
    if (args[0] === GEMINI) {
      // Gemini CLI, the way `--output-format stream-json` speaks (output/types.ts)
      if (s.auth) { child.stderr.write('Please set an Auth method in your settings.json or specify one of the environment variables'); return end(41) }
      const settings = JSON.parse(fs.readFileSync(rec.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'))
      rec.settings = settings
      const at = new Date().toISOString()
      say({ type: 'init', timestamp: at, session_id: 's-1', model: 'auto' })
      say({ type: 'message', timestamp: at, role: 'user', content: stdin.slice(0, 20) })
      if (!s.quota) {
        say({ type: 'message', timestamp: at, role: 'assistant', content: 'Let me ', delta: true })
        say({ type: 'message', timestamp: at, role: 'assistant', content: 'set that up.', delta: true })
      }
      const srv = settings.mcpServers?.vidancer
      if (srv && s.tool) {
        say({ type: 'tool_use', timestamp: at, tool_name: 'mcp_vidancer_' + s.tool.name, tool_id: 'x1', parameters: s.tool.args })
        rec.toolOut = (await rpc(srv.httpUrl, srv.headers.Authorization.replace('Bearer ', ''), 'tools/call', { name: s.tool.name, arguments: s.tool.args })).content[0].text
        say({ type: 'tool_result', timestamp: at, tool_id: 'x1', status: 'success', output: rec.toolOut })
      }
      if (s.search) say({ type: 'tool_use', timestamp: at, tool_name: 'google_web_search', tool_id: 'x2', parameters: { query: s.search } })
      say({ type: 'message', timestamp: at, role: 'assistant', content: (s.says ?? ['ok'])[0], delta: true })
      say({ type: 'result', timestamp: at, status: 'success', stats: { total_tokens: 1500, input_tokens: 1400, output_tokens: 100, cached: 900, input: 500, duration_ms: 1, tool_calls: 1, models: {} } })
      return end(0)
    }
    // Claude Code (the bridge that was already there)
    say({ type: 'system', subtype: 'init', model: 'm', session_id: 's1' })
    say({ type: 'assistant', message: { content: [{ type: 'text', text: s.claudeText ?? 'claude says ok' }] } })
    say({ type: 'result', subtype: s.claudeError ? 'error_during_execution' : 'success', is_error: !!s.claudeError, result: s.claudeText ?? 'ok', num_turns: 1, usage: { input_tokens: 5, output_tokens: 2 } })
    end(0)
  }
  child.stdin = { on() {}, write(x) { stdin += x }, end() { setImmediate(() => void play().catch((e) => { child.stderr.write(String(e)); end(1) })) } }
  if (file === 'cmd.exe') setImmediate(() => void play())
  return child
}
const childProcess = { ...require('node:child_process'), execFile, spawn }
const fakeOs = { ...os, homedir: () => home }

// ---- DeepSeek's API, a fake ----
const posts = []
let answer = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
global.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init)
  posts.push({ url: u, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined })
  if (u === 'https://api.deepseek.com/user/balance') return init.headers.Authorization === 'Bearer good' ? new Response(JSON.stringify({ is_available: true, balance_infos: [] }), { status: 200 }) : new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })
  return answer()
}

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `
    export { codirBridgeSend, bridgeOneShot, cancelCoDirBridge } from '${main}/codirBridge'
    export { detectCli, loginCli, logoutCodex, codexModels, GEMINI_CLI_MODELS, resolveCodexModel } from '${main}/codirCli'
    export { claudeLane, oneShotOf, laneHasWeb, seeingModel } from '${main}/codirLane'
    export { postMessages, toDeepseek, validateDeepseekKey } from '${main}/claudeWire'
    export { setExchangeDir, CODIR_DEEPSEEK_MODELS, codirSend } from '${main}/codir'
    export { newProject, getProject, importImage } from '${main}/project'
    export { cliOfModel, codirLaneSet, loginExpiredCli, cliLoginExpired, effortFor, takesEffort, CODIR_ENGINES } from '${ui}/shared/models'
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'os' ? fakeOs : require(n)), mod, mod.exports)
  const m = mod.exports
  const P = () => m.getProject()
  const flag = (rec, key) => { const i = rec.args.indexOf(key); return i < 0 ? undefined : rec.args[i + 1] }
  const cfg = (rec) => Object.fromEntries(rec.args.map((a, i) => (rec.args[i - 1] === '-c' ? a : null)).filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))

  // ---- six engines, one table; which tool serves which model ----
  assert.deepEqual(m.CODIR_ENGINES.map((e) => [e.id, e.cli ?? e.key]), [['api', 'anthropicKey'], ['bridge', 'claude'], ['venice', 'veniceKey'], ['codex', 'codex'], ['gemini', 'gemini'], ['deepseek', 'deepseekKey'], ['openai', 'openaiKey']])
  assert.deepEqual(['gpt-6.1-sol', 'gpt-5.5', 'auto', 'pro', 'flash-lite', 'gemini-3-pro-preview', 'claude-fable-5-1', 'claude-haiku-4-5'].map(m.cliOfModel), ['codex', 'codex', 'gemini', 'gemini', 'gemini', 'gemini', 'claude', 'claude'])
  assert.deepEqual([m.codirLaneSet({ codirEngine: 'codex' }), m.codirLaneSet({ codirEngine: 'deepseek' }), m.codirLaneSet({ codirEngine: 'deepseek', deepseekKey: 'k' }), m.codirLaneSet({}), m.codirLaneSet({ anthropicKey: 'k' })], [true, false, true, false, true])
  assert.deepEqual([m.effortFor('gpt-6.1-sol', 'max'), m.effortFor('deepseek-v4-pro', 'xhigh'), m.effortFor('auto', 'high'), m.takesEffort('flash')], ['max', 'xhigh', undefined, false], 'Gemini CLI has no thinking levels')

  // ---- finding the tools: the Codex app's own copy, Gemini CLI's npm script run by Node ----
  const cx = await m.detectCli('codex')
  assert.deepEqual([cx.found, cx.version, cx.loggedIn, cx.exe, cx.detail], [true, 'codex-cli 0.159.2', true, CODEX, 'codex-cli 0.159.2 — the Codex app’s own copy — Logged in using ChatGPT'])
  const gm = await m.detectCli('gemini')
  assert.deepEqual([gm.found, gm.version, gm.loggedIn, gm.node, gm.script, gm.detail], [true, '0.62.0', false, process.execPath, GEMINI, '0.62.0 — npm install — NOT SIGNED IN'], 'no saved Google sign-in yet')

  // ---- the lane: which engine an exchange runs on ----
  const models = await m.codexModels()
  assert.deepEqual(models.map((x) => [x.id, x.label]), [['gpt-6.1-sol', 'GPT-6.1-Sol — the newest (default)'], ['gpt-5.5', 'GPT-5.5']], 'Codex’s own catalog for this login, the newest first, hidden ones left out')
  assert.ok(execs.includes('codex.exe debug models'))
  assert.deepEqual(m.claudeLane({ codirEngine: 'codex' }), { engine: 'bridge', model: 'gpt-6.1-sol', noKey: '' }, 'no pick yet = the newest')
  assert.equal(m.claudeLane({ codirEngine: 'codex', codirCodexModel: 'gpt-5.5' }).model, 'gpt-5.5')
  assert.equal(m.claudeLane({ codirEngine: 'codex', codirCodexModel: 'gpt-4-retired' }).model, 'gpt-6.1-sol', 'a pick the catalog no longer holds = the newest')
  assert.deepEqual(m.claudeLane({ codirEngine: 'gemini' }), { engine: 'bridge', model: 'auto', noKey: '' })
  assert.equal(m.claudeLane({ codirEngine: 'gemini', codirGeminiModel: 'pro' }).model, 'pro')
  assert.deepEqual(m.GEMINI_CLI_MODELS.map((x) => x.id), ['auto', 'pro', 'flash', 'flash-lite'])
  const ds = m.claudeLane({ codirEngine: 'deepseek', deepseekKey: 'sk-d' })
  assert.deepEqual([ds.engine, ds.apiKey, ds.model], ['api', 'deepseek:sk-d', 'deepseek-v4-pro'])
  assert.deepEqual([m.claudeLane({ codirEngine: 'deepseek' }).apiKey, m.claudeLane({ codirEngine: 'deepseek' }).noKey], [undefined, 'No DeepSeek key saved — the Co-Director is set to DeepSeek: paste the key in Settings (or pick another engine).'], 'the missing-key steps read this line')
  assert.deepEqual(m.claudeLane({ codirEngine: 'venice', veniceKey: 'v' }).apiKey, 'venice:v', 'the lanes that were there are untouched')
  assert.deepEqual([m.claudeLane({ anthropicKey: 'a' }).apiKey, m.claudeLane({ codirEngine: 'bridge' }).model], ['a', 'claude-fable-5-1'])
  assert.deepEqual(['api', 'bridge', 'codex', 'gemini', 'venice', 'deepseek'].map((e) => m.laneHasWeb({ codirEngine: e })), [true, true, true, true, false, false], 'web research: not on Venice’s or DeepSeek’s wire')
  assert.match(fs.readFileSync(path.join(main, 'index.ts'), 'utf8'), /const web = laneHasWeb\(s\) && asksForWeb\(req\.text, getProject\(\)\?\.codir\.log\)/)

  // ---- a project, and one picture in its Library ----
  await m.newProject(tmp, 'Engines')
  m.setExchangeDir(P().dir)
  const png = path.join(tmp, 'monk.png'); fs.writeFileSync(png, 'png')
  const img = await m.importImage(png)
  const base = { imageIds: [img.id], selectedClipId: null, focus: null, rlm: true }
  const events = []
  const send = (o) => { events.length = 0; spawned.length = 0; return m.codirBridgeSend({ ...base, ...o }, (e) => events.push(e), () => {}) }

  // ================= ChatGPT, through Codex =================
  script = { tool: { name: 'create_clip', args: { name: 'The gate' } }, says: ['I made the clip.', 'It is called The gate.'] }
  let r = await send({ text: 'make a clip called The gate', model: 'gpt-6.1-sol', effort: 'max' })
  assert.equal(r.ok, true, r.error)
  let run = spawned[0]
  assert.equal(run.file, CODEX)
  assert.deepEqual(run.args.slice(0, 6), ['exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check'], 'one fresh run, nothing saved, none of his own Codex settings')
  assert.deepEqual([flag(run, '-s'), flag(run, '-m'), run.args.at(-1)], ['read-only', 'gpt-6.1-sol', '-'], 'read-only sandbox, his model, the prompt on stdin')
  let c = cfg(run)
  assert.deepEqual([c.approval_policy, c.web_search, c.model_reasoning_effort], ['"never"', '"disabled"', '"max"'])
  assert.match(c['mcp_servers.vidancer.url'], /^"http:\/\/127\.0\.0\.1:\d+\/mcp"$/)
  assert.deepEqual([c['mcp_servers.vidancer.bearer_token_env_var'], c['mcp_servers.vidancer.default_tools_approval_mode'], c['mcp_servers.vidancer.required'], c['mcp_servers.vidancer.tool_timeout_sec']], ['"VIDANCER_MCP_TOKEN"', '"approve"', 'true', '600'])
  assert.ok(/^[0-9a-f]{48}$/.test(run.env.VIDANCER_MCP_TOKEN) && !run.args.join(' ').includes(run.env.VIDANCER_MCP_TOKEN), 'the token rides the environment, never the command line')
  for (const off of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'hooks', 'image_generation', 'computer_use']) assert.equal(c[`features.${off}`], 'false', off + ' is off')
  const dev = JSON.parse(c.developer_instructions)
  assert.ok(dev.startsWith('You are the Co-Director') && dev.includes('EXCLUSIVELY through the mcp__vidancer__* tools') && dev.includes('Call view_image on a ref image’s path') === false && dev.includes("Call view_image on a ref image's path"), 'who it is here, as Codex’s developer instructions')
  assert.ok(!('OPENAI_API_KEY' in run.env) && !('CODEX_API_KEY' in run.env), 'no key in the environment can move the bill off his login')
  assert.equal(run.cwd, path.join(tmp, 'codir-cli'), 'it runs in a folder of the app’s own, never the project')
  assert.ok(run.stdin.startsWith('## Instructions & guides\n') && run.stdin.endsWith('## New user message — respond to this\nmake a clip called The gate'))
  assert.ok(run.stdin.includes('(here each is named mcp__vidancer__<name>)'), 'the tool list names the tools the way Codex does')
  assert.ok(run.stdin.includes(`## Attached ref images — call view_image on these exact paths to SEE them\n${img.title} → ${P().images[0].file}`), 'the picture rides as a path it can look at')
  // the stand-in reached the app's real tool server and the clip exists
  assert.ok(run.listed > 50, 'the whole tool list is served: ' + run.listed)
  assert.ok(!run.tools.some(t => t.name === 'plan_progress' || t.name === 'wait_for_jobs'), 'ordinary MCP requests omit continuation controls')
  assert.ok(run.tools.some(t => t.name === 'enhance_take'), 'planning still discovers every render operation before approval')
  assert.ok(!run.tools.find(t => t.name === 'set_clip_fields').inputSchema.properties.settings, 'ordinary MCP requests omit the duplicated settings schema')
  assert.ok(!run.stdin.includes('# Approved plan execution'), 'ordinary requests omit the execution guide')
  assert.ok(P().clips.some((x) => x.name === 'The gate'), 'the write landed in the project')
  assert.equal(r.reply, 'I made the clip.\n\nIt is called The gate.')
  assert.deepEqual(events.filter((e) => e.kind === 'text').map((e) => e.text), ['I made the clip.', 'It is called The gate.'], 'each message is its own bubble, as it arrives')
  assert.ok(events.some((e) => e.kind === 'wrote') && events.some((e) => e.kind === 'status' && e.text === 'Codex: thinking…'))
  assert.deepEqual([r.usage.inputTokens, r.usage.cacheReadTokens, r.usage.outputTokens, r.usage.rounds], [200, 1000, 50, 1], 'their input count holds the cached part; ours keeps it apart')
  let last = P().codir.log.at(-1)
  assert.deepEqual([last.role, last.text, last.tools.length, /^create_clip/.test(last.tools[0])], ['assistant', r.reply, 1, true], 'the reply is logged with the tools it ran')
  assert.ok(!fs.existsSync(path.join(P().dir, '.codex')), 'nothing of Codex’s lands in the project')

  // web research only when he asked; a level the model lacks steps down to its highest
  script = { search: 'kaiju suit makers', says: ['Found three.'] }
  r = await send({ text: 'look it up', model: 'gpt-5.5', effort: 'max', web: true })
  c = cfg(spawned[0])
  assert.deepEqual([c.web_search, c.model_reasoning_effort, flag(spawned[0], '-m')], ['"live"', '"xhigh"', 'gpt-5.5'], 'GPT-5.5 stops at xhigh')
  assert.deepEqual(P().codir.log.at(-1).tools, ['web_search → kaiju suit makers'].map((t) => P().codir.log.at(-1).tools[0]), 'a search goes on the reply’s list')
  assert.match(P().codir.log.at(-1).tools[0], /^web_search/)
  assert.ok(events.some((e) => e.text === 'Codex: searching: kaiju suit makers…'))

  // his ChatGPT login ran out: the line the panel reads to offer the sign-in
  script = { auth: true }
  r = await send({ text: 'again', model: 'gpt-6.1-sol' })
  assert.deepEqual([r.ok, r.error], [false, 'Your ChatGPT login has expired — sign in to Codex again, then retry.'])
  assert.equal(m.loginExpiredCli(r.error), 'codex')
  assert.equal(P().codir.log.at(-1).text, '⚠ ' + r.error, 'the failed exchange is in the transcript, his message kept')
  assert.equal((await m.detectCli('codex')).loggedIn, false, 'and Settings shows it without a re-check')
  // "sign in to chatgpt": Codex's own sign-in, then the proof is its own status
  world.codexIn = false
  script = { signIn: true }
  spawned.length = 0
  const li = await m.loginCli('codex')
  assert.deepEqual([li.ok, li.loggedIn, spawned[0].args.join(' ')], [true, true, 'login'], '`codex login` runs, and `codex login status` says he is in')
  script = { signIn: false }; world.codexIn = false
  assert.equal((await m.loginCli('codex')).ok, false, 'a sign-in he did not finish is not called done')
  script = { signIn: true }
  assert.equal((await m.loginCli('codex')).ok, true)
  assert.equal(spawned.at(-1).env.CODEX_HOME, path.join(tmp, 'llm-accounts', 'codex'))
  assert.equal((await m.logoutCodex()).ok, true, 'native logout is verified by a fresh status')
  assert.ok(authEnvs.every(env => env.CODEX_HOME === path.join(tmp, 'llm-accounts', 'codex')), 'status, models and logout use the app profile')
  assert.equal((await m.detectCli('codex')).loggedIn, false)
  const stopped = await m.bridgeOneShot({ prompt: 'must not run', model: 'gpt-6.1-sol' })
  assert.equal(stopped.ok, false, 'logged-out account cannot fall through to a global login')
  world.codexIn = true
  await m.detectCli('codex', true)
  await m.codexModels(true)

  // ================= Google, through Gemini CLI =================
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true }); fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}')
  await m.detectCli('gemini', true)
  script = { tool: { name: 'create_clip', args: { name: 'The bridge' } }, says: ['Done: the clip is in.'] }
  r = await send({ text: 'make a clip called The bridge', model: 'pro', effort: undefined })
  assert.equal(r.ok, true, r.error)
  run = spawned[0]
  assert.deepEqual([run.file, run.args[0]], [process.execPath, GEMINI], 'Node runs the npm package’s script (a .cmd shim is never spawned)')
  assert.deepEqual(run.args.slice(1), ['-m', 'pro', '--output-format', 'stream-json', '--approval-mode', 'default', '--allowed-mcp-server-names', 'vidancer', '-e', 'none'])
  assert.equal(run.cwd, P().dir, 'its file tools only read inside where it runs: the project folder')
  assert.match(run.settings.mcpServers.vidancer.httpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  assert.deepEqual([run.settings.mcpServers.vidancer.trust, run.settings.mcpServers.vidancer.timeout, /^Bearer [0-9a-f]{48}$/.test(run.settings.mcpServers.vidancer.headers.Authorization)], [true, 600000, true])
  assert.deepEqual([run.settings.mcp, run.settings.tools], [{ allowed: ['vidancer'] }, { core: ['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory'] }], 'his own servers stay out; no shell, no file writing, no web')
  assert.ok(!fs.existsSync(run.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH), 'the settings file (it held the token) is gone after the exchange')
  assert.ok(!('GEMINI_API_KEY' in run.env))
  assert.ok(run.stdin.startsWith('## Who you are here\nYou are the Co-Director') && run.stdin.includes('EXCLUSIVELY through the mcp_vidancer_* tools') && run.stdin.includes('(here each is named mcp_vidancer_<name>)') && run.stdin.includes('call read_file on these exact paths to SEE them'), 'Gemini CLI has no door for instructions: they open the message, in its own tool names')
  assert.ok(P().clips.some((x) => x.name === 'The bridge'))
  assert.equal(r.reply, 'Let me set that up.\n\nDone: the clip is in.', 'streamed pieces are joined; a tool call ends a bubble')
  assert.deepEqual([r.usage.inputTokens, r.usage.cacheReadTokens, r.usage.outputTokens], [500, 900, 100])
  script = { search: 'kaiju suit makers', says: ['Found three.'] }
  r = await send({ text: 'look it up', model: 'auto', web: true })
  assert.deepEqual(spawned[0].settings.tools.core.slice(-2), ['google_web_search', 'web_fetch'], 'its own search opens only for that exchange')
  assert.match(P().codir.log.at(-1).tools[0], /^web_search/)
  script = { auth: true }
  r = await send({ text: 'again', model: 'auto' })
  assert.deepEqual([r.ok, r.error, m.loginExpiredCli(r.error)], [false, 'Your Google login has expired — sign in to Gemini CLI again, then retry.', 'gemini'])
  // a project that carries Gemini settings of its own is refused
  await m.detectCli('gemini', true)
  fs.mkdirSync(path.join(P().dir, '.gemini'))
  spawned.length = 0
  r = await send({ text: 'x', model: 'auto' })
  assert.ok(!r.ok && /contains a \.gemini directory/.test(r.error) && spawned.length === 0)
  fs.rmdirSync(path.join(P().dir, '.gemini'))
  // "sign in to google": Gemini CLI opens in a window of its own; the app waits for its saved sign-in
  if (process.platform === 'win32') {
    fs.unlinkSync(path.join(home, '.gemini', 'oauth_creds.json'))
    script = { signIn: true }
    spawned.length = 0
    const gi = await m.loginCli('gemini', 5000)
    assert.deepEqual([gi.ok, gi.loggedIn, spawned[0].file], [true, true, 'cmd.exe'])
    assert.ok(spawned[0].args.at(-1).startsWith('start "Gemini CLI: choose Sign in with Google" ') && spawned[0].args.at(-1).includes(GEMINI))
    assert.equal(gi.detail, '0.62.0 — npm install — signed in with Google')
  }

  // ================= the sub-calls (compose, compact, the watch lane) ride the same tool =================
  script = { says: ['a digest'] }
  spawned.length = 0
  let one = await m.bridgeOneShot({ prompt: 'fold this', system: 'You fold.', model: 'gpt-6.1-sol' })
  assert.deepEqual([one.ok, one.text, one.inputTokens, one.outputTokens], [true, 'a digest', 1200, 50])
  assert.ok(!spawned[0].args.join(' ').includes('mcp_servers') && cfg(spawned[0]).web_search === '"disabled"' && spawned[0].args.at(-1) === '-', 'text in, text out: no tools')
  assert.equal(spawned[0].stdin, '## Instructions\nYou fold.\n\n## Input\nfold this')
  // the watch lane's still frames: handed over as pictures
  const f1 = path.join(tmp, 'fr', 'f0.png'), f2 = path.join(tmp, 'fr', 'f1.png')
  spawned.length = 0
  await m.oneShotOf({ engine: 'bridge', model: 'gpt-6.1-sol' })('what happens?', undefined, [f1, f2])
  assert.deepEqual(spawned[0].args.slice(-5), ['-', '-i', f1, '-i', f2], 'Codex: attached to the prompt')
  spawned.length = 0
  script = { says: [' A monk walks.'] }
  one = await m.oneShotOf({ engine: 'bridge', model: 'flash' })('what happens?', undefined, [f1, f2])
  assert.deepEqual([one.ok, one.text, flag(spawned[0], '--include-directories'), flag(spawned[0], '-m')], [true, 'Let me set that up. A monk walks.', path.join(tmp, 'fr'), 'flash'], 'Gemini CLI: their folder joins what it may read')
  assert.deepEqual([spawned[0].settings.mcpServers, spawned[0].settings.tools.core.includes('read_file')], [undefined, true], 'no app tools in a sub-call; it may read the frames')
  spawned.length = 0
  one = await m.oneShotOf({ engine: 'bridge', model: 'claude-fable-5-1' })('what happens?', undefined, [f1, f2])
  assert.equal(one.text, 'claude says ok')
  let a = spawned[0].args
  assert.deepEqual([a[a.indexOf('--add-dir') + 1], a[a.indexOf('--allowedTools') + 1], flag(spawned[0], '--max-turns'), a.slice(a.indexOf('--disallowedTools')).includes('Read')], [path.join(tmp, 'fr'), 'Read', '8', false], 'Claude Code: Read opens for the frames’ folder (it was shut, so the frames road never saw a frame)')
  spawned.length = 0
  await m.bridgeOneShot({ prompt: 'x', model: 'claude-fable-5-1' })
  a = spawned[0].args
  assert.deepEqual([a.includes('--add-dir'), flag(spawned[0], '--max-turns'), a.slice(a.indexOf('--disallowedTools')).includes('Read')], [false, '1', true], 'a text sub-call on Claude Code is as it was')
  assert.equal(m.oneShotOf({ engine: 'api', model: 'x' }), undefined, 'a key lane has no command-line one-shot')

  // ================= DeepSeek, on a key =================
  assert.deepEqual(m.CODIR_DEEPSEEK_MODELS.map((x) => x.id), ['deepseek-v4-pro', 'deepseek-flash'])
  const body = { model: 'deepseek-v4-pro', max_tokens: 64000, output_config: { effort: 'xhigh' }, system: [{ type: 'text', text: 'guide', cache_control: { type: 'ephemeral' } }], tools: [{ name: 'create_clip', description: 'd', input_schema: { type: 'object' } }, { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'look' }] }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'tool_use', id: 't1', name: 'create_clip', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }] }
  posts.length = 0
  let res = await m.postMessages('deepseek:sk-d', body)
  assert.equal(res.status, 200)
  const sent = posts[0]
  assert.deepEqual([sent.url, sent.headers['x-api-key'], sent.headers.Authorization], ['https://api.deepseek.com/anthropic/v1/messages', 'sk-d', undefined], 'their Messages-shaped door, their key header, the tag taken off')
  assert.deepEqual([sent.body.model, sent.body.max_tokens, sent.body.output_config], ['deepseek-v4-pro', 64000, { effort: 'max' }], 'five thinking levels become their three')
  assert.deepEqual(sent.body.tools.map((t) => t.name), ['create_clip'], 'Anthropic’s own web tool is not sent to DeepSeek')
  assert.deepEqual(sent.body.messages[0].content[0], { type: 'text', text: '(a picture was attached here — this model cannot see pictures; say so if it matters. DeepSeek Flash can.)' }, 'V4 Pro cannot see: the picture is taken out and it is told')
  assert.deepEqual([sent.body.messages[1], sent.body.messages[2], sent.body.system], [body.messages[1], body.messages[2], body.system], 'its thinking and the tool results go back untouched (their tool-loop rule)')
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max', undefined].map((e) => m.toDeepseek({ model: 'deepseek-flash', ...(e ? { output_config: { effort: e } } : {}) }).output_config?.effort), ['low', 'high', 'high', 'max', 'max', undefined])
  assert.deepEqual(m.toDeepseek({ ...body, model: 'deepseek-flash' }).messages[0].content[0].type, 'image', 'Flash sees pictures: they stay')
  assert.equal(m.toDeepseek({ model: 'claude-haiku-4-5', messages: [] }).model, 'deepseek-flash', 'the sub-calls’ cheap-tier name rides their fast model')
  answer = () => new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 })
  res = await m.postMessages('deepseek:sk-d', body)
  assert.deepEqual([res.status, (await res.json()).error.message], [402, 'DeepSeek: Insufficient Balance — out of DeepSeek credit: top up on platform.deepseek.com'])
  answer = () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })
  assert.equal((await (await m.postMessages('deepseek:bad', body)).json()).error.message, 'DeepSeek: Authentication Fails — check the DeepSeek key in Settings')
  // an Anthropic key still goes to Anthropic, untouched
  posts.length = 0
  answer = () => new Response('{}', { status: 200 })
  await m.postMessages('sk-ant', body)
  assert.deepEqual([posts[0].url, posts[0].headers['x-api-key'], posts[0].body], ['https://api.anthropic.com/v1/messages', 'sk-ant', body])
  // the watch lane's still frames need a model that sees: on a DeepSeek key that is Flash, whatever he picked
  assert.deepEqual([m.seeingModel(ds), m.seeingModel(m.claudeLane({ anthropicKey: 'a', codirModel: 'claude-opus-5-5' }))], ['deepseek-flash', 'claude-opus-5-5'])
  // the free key check
  assert.deepEqual([await m.validateDeepseekKey('good'), await m.validateDeepseekKey('bad'), await m.validateDeepseekKey(' ')], [{ ok: true }, { ok: false, error: 'DeepSeek refused this key' }, { ok: false, error: 'paste a key first' }])

  // ---- an older Codex with no `debug models`: the one their docs name ----
  P().codir.brief = 'STALE_BRIEF_CANARY'
  P().codir.log.push({ role: 'user', text: 'STALE_CONVERSATION_CANARY', at: Date.now() })
  for (const model of ['gpt-6.1-sol', 'gemini-3-pro-preview', 'claude-fable-5-1']) {
    script = { says: ['Saved this task.'], tool: { name: 'read_object', args: { id: P().clips[0].id } } }
    const result = await send({ text: 'Continue the next saved task.', planContext: 'CURRENT_BRIEF_CANARY', jobOrigin: true, model })
    assert.equal(result.ok, true, result.error)
    assert.ok(spawned[0].stdin.includes('CURRENT_BRIEF_CANARY'))
    assert.ok(!spawned[0].stdin.includes('STALE_BRIEF_CANARY') && !spawned[0].stdin.includes('STALE_CONVERSATION_CANARY'), model + ' starts from the current plan, not old conversation')
    assert.ok(!spawned[0].args.includes('--resume'))
    assert.ok(spawned[0].stdin.includes('# Approved plan execution'), 'active plan gets its execution guide')
    if (model.startsWith('gpt-')) {
      assert.ok(spawned[0].tools.some(t => t.name === 'plan_progress'))
      assert.ok(spawned[0].tools.find(t => t.name === 'set_clip_fields').inputSchema.properties.settings)
    }
    script = model.startsWith('claude') ? { claudeText: "You've hit your weekly limit · resets tomorrow" } : { quota: true, says: ["You've hit your weekly limit · resets tomorrow"] }
    const limited = await send({ text: 'Continue.', planContext: 'CURRENT_BRIEF_CANARY', jobOrigin: true, model })
    assert.equal(limited.ok, false, model + ' must not count a quota notice as completed work')
    assert.match(limited.error, /weekly limit/)
    assert.equal(spawned.length, 1, 'a provider limit must not retry')
    const subcall = await m.bridgeOneShot({ prompt: 'Inspect this take.', model })
    assert.equal(subcall.ok, false, 'a quota notice is not a video inspection or a digest')
    assert.match(subcall.error, /weekly limit/)
  }
  script = { claudeText: 'Provider refused this request', claudeError: true }
  assert.equal((await send({ text: 'Continue.', model: 'claude-fable-5-1' })).ok, false, 'assistant text cannot override an explicit provider error')
  posts.length = 0
  answer = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Saved this task.' }], stop_reason: 'end_turn', usage: {} }), { status: 200 })
  const api = await m.codirSend({ ...base, imageIds: [], text: 'Continue.', planContext: 'CURRENT_BRIEF_CANARY', jobOrigin: true, apiKey: 'fake', model: 'claude-fable-5-1' }, () => {}, () => {})
  assert.equal(api.ok, true, api.error)
  const payload = JSON.stringify(posts.at(-1).body.messages)
  assert.ok(payload.includes('CURRENT_BRIEF_CANARY') && !payload.includes('STALE_BRIEF_CANARY') && !payload.includes('STALE_CONVERSATION_CANARY'))
  assert.ok(posts.at(-1).body.tools.some(t => t.name === 'plan_progress'))
  assert.ok(posts.at(-1).body.tools.find(t => t.name === 'set_clip_fields').input_schema.properties.settings)
  await m.codirSend({ ...base, imageIds: [], text: 'Read this clip.', apiKey: 'fake', model: 'claude-fable-5-1' }, () => {}, () => {})
  assert.ok(!posts.at(-1).body.tools.some(t => t.name === 'plan_progress'))
  assert.ok(!posts.at(-1).body.tools.find(t => t.name === 'set_clip_fields').input_schema.properties.settings)
  assert.ok(!JSON.stringify(posts.at(-1).body.system).includes('# Approved plan execution'))
  console.log('PASS current-plan context on API, Claude, Codex and Gemini; quota notices and explicit provider errors fail without retry')

  world.models = false
  assert.deepEqual((await m.codexModels(true)).map((x) => x.id), ['gpt-6.1-sol', 'gpt-5.5'], 'a catalog once read is kept')
  console.log('PASS chat logins as Co-Director engines: six engines from one table; ChatGPT through Codex (found in the Codex app, one fresh read-only run with none of his own settings, the app’s tools over the local server on a token in the environment, his model and thinking level, web only when asked, the reply in bubbles with its tools and usage); Google through Gemini CLI (its npm script under Node, its settings in a file of the app’s own, no shell, streamed text joined); an expired login on either gives the line the panel offers a sign-in for, and the sign-in is the tool’s own; sub-calls and the watch lane’s frames ride the same tool (and Claude Code can now see the frames); DeepSeek on a key through its Messages-shaped door (levels mapped, no pictures to the model that cannot see, their errors in plain words); the old lanes untouched')
})().catch((e) => { console.error(e); process.exitCode = 1 })
