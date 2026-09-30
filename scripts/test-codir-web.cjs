// list 29 (2026-09-30) — the Co-Director researches online when the director asks. "Asks" = his
// own words (research, look it up, search online, a link) or a follow-up right after a reply that
// searched. On those exchanges the API engine carries Anthropic's web search and web fetch tools
// (their documented shapes, read that day) and the bridge opens Claude Code's own; every other
// exchange has neither. A research reply names its sources. The network and the CLI are fakes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-web-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const FAKE_EXE = path.join(tmp, 'claude.exe')
fs.writeFileSync(FAKE_EXE, '')
const spawned = []
let cliBlocks = []
const childProcess = {
  ...require('node:child_process'),
  execFile: (file, args, _o, cb) => setImmediate(() => cb(null, /where|which/.test(file) ? FAKE_EXE : args[0] === '--version' ? '2.1.300 (Claude Code)' : args[0] === 'auth' ? '{"loggedIn":true}' : '', '')),
  spawn: (file, args) => {
    const child = new EventEmitter()
    child.stdin = { on() {}, write() {}, end() {} }
    child.stdout = new PassThrough()
    child.stderr = new EventEmitter()
    spawned.push(args)
    setImmediate(() => {
      for (const ev of [{ type: 'system', subtype: 'init', model: 'm', session_id: 's1' }, { type: 'assistant', message: { content: [...cliBlocks, { type: 'text', text: 'Here is what I found.' }] } }, { type: 'result', subtype: 'success', result: 'ok', num_turns: 2, usage: {} }]) child.stdout.write(JSON.stringify(ev) + '\n')
      child.stdout.end()
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
}
const fakeFs = { ...require('node:fs'), existsSync: (p) => (/claude(\.exe)?$/i.test(String(p)) || /cli\.js$/.test(String(p)) ? String(p) === FAKE_EXE : fs.existsSync(p)) }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { codirSend, setExchangeDir, asksForWeb, TOOLS } from '${main}/codir'; export { codirBridgeSend } from '${main}/codirBridge'; export { newProject, getProject } from '${main}/project'; export { buildSystemGuides } from '${main}/guides'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'fs' ? fakeFs : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- when he asks ----
  for (const yes of ['research 80s dark fantasy posters for me', 'can you look it up?', 'look up the BFI list', 'looking this up would help', 'search the web for kaiju suit makers', 'search online', 'look online for the real poster', 'what is on the internet about it', 'google it', 'what does https://example.com/page say', 'check it Online'])
    assert.equal(m.asksForWeb(yes), true, yes)
  for (const no of ['make the clip longer', 'find out why the render failed', 'the researcher walks in', 'use the lookup sheet', 'she looks up at the tower', 'search the Library for the plate', 'web of cables across the ceiling'])
    assert.equal(m.asksForWeb(no), false, no)
  const after = [{ role: 'user', text: 'research it', at: 1 }, { role: 'assistant', text: 'Found it.', at: 1, tools: ['web_search → kaiju suit makers'] }]
  assert.equal(m.asksForWeb('dig deeper', after), true, 'a follow-up to a reply that searched keeps the web')
  assert.equal(m.asksForWeb('dig deeper', [...after, { role: 'user', text: 'ok now the clip', at: 2 }, { role: 'assistant', text: 'Done.', at: 2, tools: ['set_clip_fields → wrote'] }]), false, 'once the talk moves on, it shuts again')
  assert.match(fs.readFileSync(path.join(main, 'index.ts'), 'utf8'), /const web = s\.codirEngine !== 'venice' && asksForWeb\(req\.text, getProject\(\)\?\.codir\.log\)/, 'the gate rides every exchange; Venice has no web tools')
  assert.match(await m.buildSystemGuides(), /## Looking things up online\n\n- Only when the director asks: research, look it up, search online, or he gives a link\./)

  // ---- the API engine ----
  const calls = []
  let answers = []
  global.fetch = async (url, init = {}) => {
    calls.push(JSON.parse(init.body))
    const a = answers.shift() ?? { body: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} } }
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 })
  }
  await m.newProject(tmp, 'Web')
  m.setExchangeDir(m.getProject().dir)
  const events = []
  const say = (text, extra = {}) => m.codirSend({ text, imageIds: [], selectedClipId: null, focus: null, apiKey: 'sk-ant-x', model: 'claude-sonnet-5-5', ...extra }, (e) => events.push(e), () => {})
  await say('make the clip longer')
  assert.equal(calls.at(-1).tools.length, m.TOOLS.length, 'no ask: only the app’s own tools')
  assert.ok(!calls.at(-1).tools.some((t) => /^web_/.test(t.type ?? '')))

  const search = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'kaiju suit makers 1966' } }
  const results = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://example.org/suits', title: 'Suit makers', encrypted_content: 'ENC' }] }
  const fetchUse = { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_fetch', input: { url: 'https://example.org/suits' } }
  const fetched = { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_fetch_result', url: 'https://example.org/suits', content: { type: 'document', title: 'Suit makers', source: { type: 'text', media_type: 'text/plain', data: '…' } } } }
  const paused = [{ type: 'text', text: 'Let me look.' }, search, results, fetchUse]
  answers = [
    { body: { content: paused, stop_reason: 'pause_turn', usage: {} } },
    { body: { content: [fetched, { type: 'text', text: 'The suits were built ' }, { type: 'text', text: 'by a team of seven', citations: [{ type: 'web_search_result_location', url: 'https://example.org/suits', title: 'Suit makers', cited_text: '…', encrypted_index: 'X' }] }, { type: 'text', text: ', over three weeks.' }], stop_reason: 'end_turn', usage: {} } }
  ]
  events.length = 0
  const r = await say('research kaiju suit makers', { web: true })
  assert.equal(r.ok, true, r.error)
  const sent = calls.at(-2)
  assert.deepEqual(sent.tools.slice(-2), [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5, max_content_tokens: 12000, citations: { enabled: true } }], 'Anthropic’s two web tools, as documented, after the app’s own')
  assert.equal(sent.tools.length, m.TOOLS.length + 2)
  assert.deepEqual(calls.at(-1).messages.at(-1), { role: 'assistant', content: paused }, 'a paused search turn goes back unchanged, encrypted results and all')
  assert.equal(r.reply, 'Let me look.\n\nThe suits were built by a team of seven, over three weeks.\n\nSources:\nSuit makers · https://example.org/suits', 'cited pieces read as one sentence, and the sources are named under it')
  assert.deepEqual(m.getProject().codir.log.at(-1).tools, ['web_search → kaiju suit makers 1966', 'web_fetch → https://example.org/suits'], 'what it searched and read stays on its log entry')
  assert.ok(events.some((e) => e.kind === 'status' && e.text === 'searching: kaiju suit makers 1966…') && events.some((e) => e.kind === 'status' && e.text === 'reading https://example.org/suits…'), 'the panel says what it is doing')
  assert.equal(m.asksForWeb('dig deeper', m.getProject().codir.log), true)

  // the key's organization has web search switched off: said plainly, the exchange still answers
  answers = [
    { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'Web search is not enabled for this organization.' } } },
    { body: { content: [{ type: 'text', text: 'I can’t look online on this key: web search is switched off for it.' }], stop_reason: 'end_turn', usage: {} } }
  ]
  const off = await say('research it again', { web: true })
  assert.equal(off.ok, true, off.error)
  assert.equal(calls.at(-1).tools.length, m.TOOLS.length, 'the retry carries no web tools')
  assert.match(calls.at(-1).messages.at(-1).content, /^\(app: web research is not available on this key or model — the API said: Web search is not enabled for this organization\.\. Say so plainly; never pretend to have searched\.\)$/)
  assert.equal(off.reply, 'I can’t look online on this key: web search is switched off for it.')
  // any other 400 is still an error
  answers = [{ status: 400, body: { error: { message: 'max_tokens: too large' } } }]
  assert.equal((await say('research more', { web: true })).error, 'max_tokens: too large')

  // ---- the bridge engine ----
  const bridge = (text, extra = {}) => m.codirBridgeSend({ text, imageIds: [], selectedClipId: null, focus: null, model: 'claude-fable-5-1', ...extra }, () => {}, () => {})
  const flag = (args, f) => args.slice(args.indexOf(f) + 1, args.findIndex((a, i) => i > args.indexOf(f) && a.startsWith('--')))
  assert.equal((await bridge('make the clip longer')).ok, true)
  assert.deepEqual(flag(spawned.at(-1), '--allowedTools'), ['mcp__vidancer', 'Read', 'Glob', 'Grep'])
  assert.ok(['WebFetch', 'WebSearch'].every((t) => flag(spawned.at(-1), '--disallowedTools').includes(t)), 'no ask: Claude Code’s web tools stay shut')
  cliBlocks = [{ type: 'tool_use', name: 'WebSearch', input: { query: 'ero guro poster artists' } }, { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.org/artists', prompt: 'who' } }]
  const b = await bridge('research ero guro poster artists', { web: true })
  assert.equal(b.ok, true, b.error)
  assert.deepEqual(flag(spawned.at(-1), '--allowedTools'), ['mcp__vidancer', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])
  assert.deepEqual(flag(spawned.at(-1), '--disallowedTools'), ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'TodoWrite'], 'asked: they open, and only they')
  assert.deepEqual(m.getProject().codir.log.at(-1).tools, ['web_search → ero guro poster artists', 'web_fetch → https://example.org/artists'])

  console.log('PASS web research: opens on his words, a link or a follow-up and on nothing else; API = Anthropic’s documented web search + fetch, a paused turn resumed unchanged, cited text kept whole, sources named, a switched-off key said plainly; bridge = Claude Code’s WebSearch + WebFetch for that exchange only')
})().catch((e) => { console.error(e); process.exitCode = 1 })
