// list 28 (2026-09-30) — the commuters fixes, the code side. Learned rules can be edited and
// deleted (by number or exact text), are saved in the director's own words by save_rule, and are
// listed numbered with their file named. Every reply's tool calls stay on its log entry and are
// read back to it, so it can never deny one. The whole tool list is spelled out in its
// instructions. COMPACT keeps his corrections word for word. Both engines; nothing is sent anywhere.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-rules-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {}, openPath: async () => '' }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const realFetch = global.fetch

// a Claude Code that calls one of the app's tools over the bridge's own back-channel, then answers
const FAKE_EXE = path.join(tmp, 'claude.exe')
fs.writeFileSync(FAKE_EXE, '')
let cliTool = null // { name, arguments } the fake CLI calls this exchange
const piped = []
const childProcess = {
  ...require('node:child_process'),
  execFile: (file, args, _o, cb) => setImmediate(() => cb(null, /where|which/.test(file) ? FAKE_EXE : args[0] === '--version' ? '2.1.300 (Claude Code)' : args[0] === 'auth' ? '{"loggedIn":true}' : '', '')),
  spawn: () => {
    const child = new EventEmitter()
    let sent = ''
    child.stdin = { on() {}, write(t) { sent += t }, end() { piped.push(sent) } }
    child.stdout = new PassThrough()
    child.stderr = new EventEmitter()
    ;(async () => {
      if (cliTool) {
        const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'codir-bridge-mcp.json'), 'utf8')).mcpServers.vidancer
        await realFetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: cliTool }) })
      }
      for (const ev of [{ type: 'system', subtype: 'init', model: 'm', session_id: 's1' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }, { type: 'result', subtype: 'success', result: 'Done.', num_turns: 2, usage: {} }]) child.stdout.write(JSON.stringify(ev) + '\n')
      child.stdout.end()
      setImmediate(() => child.emit('close', 0))
    })()
    return child
  }
}
const fakeFs = { ...require('node:fs'), existsSync: (p) => (/claude(\.exe)?$/i.test(String(p)) || /cli\.js$/.test(String(p)) ? String(p) === FAKE_EXE : fs.existsSync(p)) }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, codirSend, codirCompact, toolListBlock, logText, TOOLS } from '${main}/codir'; export { codirBridgeSend } from '${main}/codirBridge'; export { buildSystemGuides, appendLearned, changeLearned } from '${main}/guides'; export { newProject, getProject, codirAppend } from '${main}/project'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'fs' ? fakeFs : require(n)), mod, mod.exports)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, () => {})
  const learned = () => fs.readFileSync(path.join(tmp, 'guides', 'learned.md'), 'utf8')
  await m.newProject(tmp, 'Rules')
  m.setExchangeDir(m.getProject().dir)

  // ---- the save tool: a new name, his words ----
  const names = m.TOOLS.map((t) => t.name)
  assert.ok(!names.includes('remember_instruction') && ['save_rule', 'edit_rule', 'delete_rule'].every((n) => names.includes(n)))
  const save = m.TOOLS.find((t) => t.name === 'save_rule').description
  assert.match(save, /ONLY when the user says the word save/)
  assert.match(save, /"Remember" or "keep it in mind" is not save/)
  assert.match(save, /in THEIR words, exactly as they said them — never reworded/)
  const HIS = 'no feel words in clip prompts, ever.  the 25 word thing is dead'
  assert.equal(await run('save_rule', { rule: HIS }), 'saved to your instructions (Learned section): ' + HIS)
  assert.equal(learned(), '- no feel words in clip prompts, ever. the 25 word thing is dead\n', 'his words, as said (only doubled spaces close up)')
  await run('save_rule', { rule: 'short replies' })
  await run('save_rule', { rule: 'Keep prompts under 25 words.' })
  assert.equal(await run('save_rule', { rule: 'SHORT REPLIES' }), 'already in your instructions')

  // ---- he reads them numbered, with the file named ----
  let sys = await m.buildSystemGuides()
  assert.ok(sys.includes(`Rules the director asked you to keep, in his words. Follow them as if written above. They live in ${path.join(tmp, 'guides', 'learned.md')}: save_rule adds one, edit_rule changes one, delete_rule removes one.\n1. no feel words in clip prompts, ever. the 25 word thing is dead\n2. short replies\n3. Keep prompts under 25 words.`), 'numbered, in order, the file named')
  assert.match(sys, /## Saving rules\r?\n\r?\n- A rule is saved only when the director says the word save/) // a Windows checkout reads the guide with CRLF
  assert.ok(!sys.includes('remember_instruction') && !sys.includes('distill it'), 'the guide no longer says "distill" or names the old tool')

  // ---- edit and delete one: by number, or by its exact text ----
  assert.equal(await run('delete_rule', { rule: '3' }), 'deleted rule 3: Keep prompts under 25 words.', 'the poison rule is gone, not cancelled by a new line')
  assert.equal(await run('edit_rule', { rule: 'short replies', new_text: 'one or two lines per reply' }), 'rule 2 now reads: one or two lines per reply (it read: short replies)')
  assert.equal(learned(), '- no feel words in clip prompts, ever. the 25 word thing is dead\n- one or two lines per reply\n')
  assert.match(await run('delete_rule', { rule: '9' }), /^ERROR: no such rule — the rules are:\n1\. no feel words.*\n2\. one or two lines per reply$/)
  assert.match(await run('edit_rule', { rule: 'a rule that is not there', new_text: 'x' }), /^ERROR: no such rule/)
  assert.match(await run('edit_rule', { rule: '1', new_text: '   ' }), /^ERROR: empty text — delete_rule removes a rule/)
  assert.equal(learned().split('\n').length, 3, 'a refused call changes nothing')

  // ---- its real tool list is spelled out ----
  const list = m.toolListBlock('', true)
  assert.match(list, new RegExp(`^===== YOUR TOOLS: the whole list =====\\nThese ${m.TOOLS.length} tools are everything you can do in the app\\. A thing that is not on this list you cannot do: say so\\.`))
  for (const n of names) assert.ok(list.includes(`\n- ${n}: `), n)
  assert.equal(list.split('\n').length, m.TOOLS.length + 2, 'one line per tool, nothing else')
  assert.match(m.toolListBlock('mcp__vidancer__'), /\(here each is named mcp__vidancer__<name>\)/)

  // ---- the API engine: a reply's tools stay on its log entry, and are read back to it ----
  const calls = []
  let answers = []
  global.fetch = async (url, init = {}) => {
    calls.push(JSON.parse(init.body))
    return new Response(JSON.stringify(answers.shift() ?? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }))
  }
  const say = (text) => m.codirSend({ text, imageIds: [], selectedClipId: null, focus: null, apiKey: 'sk-ant-x', model: 'claude-sonnet-5-5' }, () => {}, () => {})
  answers = [
    { content: [{ type: 'text', text: 'Saving it.' }, { type: 'tool_use', id: 't1', name: 'save_rule', input: { rule: 'never call it a mask' } }, { type: 'tool_use', id: 't2', name: 'update_brief', input: { brief: 'The cast: four commuters.' } }], stop_reason: 'tool_use', usage: {} },
    { content: [{ type: 'text', text: 'Saved: never call it a mask.' }], stop_reason: 'end_turn', usage: {} }
  ]
  assert.equal((await say('save that')).ok, true)
  const log = () => m.getProject().codir.log
  assert.deepEqual(log().at(-1).tools, ['save_rule → saved to your instructions (Learned section): never call it a mask', 'update_brief → brief updated'])
  assert.equal(log().at(-2).tools, undefined, 'his own message carries none')
  assert.equal((await say('did you save it?')).ok, true)
  const req = calls.at(-1)
  assert.equal([req.messages.at(-2).content].flat().map((b) => b.text ?? b).join(''), 'Saving it.\n\nSaved: never call it a mask.\n(tools you ran in this reply: save_rule → saved to your instructions (Learned section): never call it a mask · update_brief → brief updated)', 'its earlier reply comes back with the calls it made')
  const sysText = req.system.map((b) => b.text).join('\n')
  assert.ok(sysText.includes('===== YOUR TOOLS: the whole list =====') && sysText.includes('3. never call it a mask'), 'the tool list and the numbered rules ride the instructions')
  assert.match(req.messages.at(-1).content.map((b) => b.text ?? '').join('\n'), /## Your brief\nThe cast: four commuters\./, 'the brief is in front of it every turn (it rides the fresh message)')
  assert.equal(log().at(-1).tools, undefined, 'a reply that ran nothing carries nothing')
  // a reply that fails after a write still owns that write
  answers = [{ content: [{ type: 'tool_use', id: 't3', name: 'delete_rule', input: { rule: '3' } }], stop_reason: 'tool_use', usage: {} }]
  global.fetch = async (url, init = {}) => { calls.push(JSON.parse(init.body)); const a = answers.shift(); if (!a) throw Object.assign(new Error('network down'), {}); return new Response(JSON.stringify(a)) }
  const failed = await say('delete rule 3')
  assert.equal(failed.ok, false)
  assert.deepEqual(log().at(-1).tools, ['delete_rule → deleted rule 3: never call it a mask'], 'the failed reply still lists what it ran')
  assert.match(m.logText(log().at(-1)), /^⚠ .*\n\(tools you ran in this reply: delete_rule → deleted rule 3: never call it a mask\)$/)

  // ---- the bridge engine: the same, through its back-channel ----
  global.fetch = realFetch
  cliTool = { name: 'edit_rule', arguments: { rule: '2', new_text: 'two lines, no more' } }
  const b = await m.codirBridgeSend({ text: 'make rule 2 say two lines, no more', imageIds: [], selectedClipId: null, focus: null, model: 'claude-fable-5-1' }, () => {}, () => {})
  assert.equal(b.ok, true, b.error)
  assert.deepEqual(log().at(-1).tools, ['edit_rule → rule 2 now reads: two lines, no more (it read: one or two lines per reply)'])
  assert.match(piped.at(-1), /===== YOUR TOOLS: the whole list =====\nThese \d+ tools are everything you can do in the app \(here each is named mcp__vidancer__<name>\)/, 'the list is piped to Claude Code with the names it sees')
  assert.match(piped.at(-1), /Co-Director: ⚠ .*\n\(tools you ran in this reply: delete_rule → deleted rule 3: never call it a mask\)/, 'the bridge reads its earlier calls back too')
  assert.equal(learned(), '- no feel words in clip prompts, ever. the 25 word thing is dead\n- two lines, no more\n')

  // ---- COMPACT keeps his corrections word for word ----
  const t0 = Date.now()
  await m.codirAppend(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: i === 4 ? 'stop calling her a featureless mask. look at the render first' : `line ${i}`, at: t0 + i })))
  global.fetch = async (url, init = {}) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'BRIEF ADDITIONS:\nNONE\nDIGEST:\nThe cast was set and one rule edited.\nCORRECTIONS:\nstop calling her a featureless mask. look at the render first' }], stop_reason: 'end_turn', usage: {} })) }
  assert.deepEqual(await m.codirCompact({ engine: 'api', apiKey: 'sk-ant-x', model: 'claude-sonnet-5-5' }, () => {}), { ok: true, folded: m.getProject().codir.log.length - 20 })
  const asked = calls.at(-1).messages[0].content
  assert.match(asked, /## Return EXACTLY these three sections/)
  assert.match(asked, /CORRECTIONS:\n\(every correction the director gave about HOW THE AI WORKS in the span .* in HIS exact words, never reworded or merged; or the single word NONE\)/)
  assert.match(asked, /\(tools you ran in this reply: save_rule → /, 'the fold sees what was written, not only what was said')
  assert.equal(m.getProject().codir.digests.at(-1).text, 'The cast was set and one rule edited.\nHis corrections, in his words:\nstop calling her a featureless mask. look at the render first')
  // an answer in the old two-section shape still folds; NONE adds nothing
  await m.codirAppend(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `later ${i}`, at: Date.now() + 1000 + i })))
  global.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'BRIEF ADDITIONS:\nNONE\nDIGEST:\nMore talk.' }], stop_reason: 'end_turn', usage: {} }))
  assert.equal((await m.codirCompact({ engine: 'api', apiKey: 'sk-ant-x', model: 'claude-sonnet-5-5' }, () => {})).ok, true)
  assert.equal(m.getProject().codir.digests.at(-1).text, 'More talk.')

  console.log('PASS commuters fixes: save_rule keeps his words and saves only on "save"; rules are numbered with their file named, edited and deleted by number or text; a reply’s tool calls stay on its log entry and are read back (API and bridge, a failed reply too); the whole tool list rides the instructions; COMPACT keeps his corrections word for word')
})().catch((e) => { console.error(e); process.exitCode = 1 })
