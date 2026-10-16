// list 26 (2026-09-30) — pick how hard the Co-Director thinks. One level (low · medium · high ·
// xhigh · max, or none = the model's own) rides every exchange on whichever engine: Anthropic's
// output_config.effort on the API, reasoning_effort on Venice's wire, --effort on Claude Code.
// Haiku takes no level. The real codirSend and codirBridgeSend; the network and the CLI are fakes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-effort-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

// a Claude Code that is always there, logged in, and answers one line
const FAKE_EXE = path.join(tmp, 'claude.exe')
fs.writeFileSync(FAKE_EXE, '')
const spawned = []
const childProcess = {
  ...require('node:child_process'),
  execFile: (file, args, _opts, cb) => {
    const out = /where|which/.test(file) ? FAKE_EXE : args[0] === '--version' ? '2.1.300 (Claude Code)' : args[0] === 'auth' ? '{"loggedIn":true}' : ''
    setImmediate(() => cb(null, out, ''))
  },
  spawn: (file, args) => {
    const child = new EventEmitter()
    child.stdin = { on() {}, write() {}, end() {} }
    child.stdout = new PassThrough()
    child.stderr = new EventEmitter()
    spawned.push({ file, args })
    setImmediate(() => {
      for (const ev of [{ type: 'system', subtype: 'init', model: 'm', session_id: 's1' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }] } }, { type: 'result', subtype: 'success', result: 'On it.', num_turns: 1, usage: {} }]) child.stdout.write(JSON.stringify(ev) + '\n')
      child.stdout.end()
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
}
// only the fake is "installed": a real Claude Code on this machine must not be the one probed
const fakeFs = { ...require('node:fs'), existsSync: (p) => (/claude(\.exe)?$/i.test(String(p)) || /cli\.js$/.test(String(p)) ? String(p) === FAKE_EXE : fs.existsSync(p)) }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { codirSend, setExchangeDir } from '${main}/codir'; export { codirBridgeSend } from '${main}/codirBridge'; export { toChatCompletions, VENICE_TAG } from '${main}/claudeWire'; export { newProject, getProject } from '${main}/project'; export { effortFor, CODIR_EFFORTS } from '${ui}/shared/models'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'fs' ? fakeFs : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- which model takes which level ----
  assert.deepEqual([...m.CODIR_EFFORTS], ['low', 'medium', 'high', 'xhigh', 'max'])
  for (const id of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5']) assert.equal(m.effortFor(id, 'max'), 'max', id)
  assert.equal(m.effortFor('claude-haiku-4-5', 'high'), undefined, 'Haiku takes no level')
  assert.equal(m.effortFor('claude-opus-5-5', ''), undefined, 'nothing picked = the model’s own level')
  assert.equal(m.effortFor('claude-opus-5-5', undefined), undefined)
  assert.equal(m.effortFor('claude-opus-5-5', 'ultra'), undefined, 'only Anthropic’s five names are ever sent')

  // ---- the API engine: output_config.effort, and room to think ----
  const calls = []
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const venice = String(url).includes('venice')
    return new Response(JSON.stringify(venice ? { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} } : { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }))
  }
  await m.newProject(tmp, 'Effort')
  m.setExchangeDir(m.getProject().dir)
  const send = (extra) => m.codirSend({ text: 'hello', imageIds: [], selectedClipId: null, focus: null, apiKey: 'sk-ant-x', model: 'claude-opus-5-5', ...extra }, () => {}, () => {})
  assert.equal((await send({})).ok, true)
  assert.ok(!('output_config' in calls.at(-1).body), 'no level picked: nothing sent, the model runs at its own')
  assert.equal(calls.at(-1).body.max_tokens, 16000)
  const rooms = {}
  for (const effort of m.CODIR_EFFORTS) {
    assert.equal((await send({ effort })).ok, true)
    assert.deepEqual(calls.at(-1).body.output_config, { effort }, 'the documented shape: output_config.effort, top level')
    rooms[effort] = calls.at(-1).body.max_tokens
  }
  assert.deepEqual(rooms, { low: 16000, medium: 16000, high: 32000, xhigh: 48000, max: 64000 }, 'thinking counts against max_tokens: a harder level gets more room')
  assert.ok(!('thinking' in calls.at(-1).body) && !('temperature' in calls.at(-1).body) && !('tool_choice' in calls.at(-1).body), 'nothing the 5.5 models refuse')

  // ---- the Venice engine: their wire calls it reasoning_effort ----
  assert.equal((await send({ apiKey: m.VENICE_TAG + 'vk', effort: 'xhigh' })).ok, true)
  assert.equal(calls.at(-1).url, 'https://api.venice.ai/api/v1/chat/completions')
  assert.equal(calls.at(-1).body.reasoning_effort, 'xhigh')
  assert.ok(!('output_config' in calls.at(-1).body), 'Anthropic’s field never reaches Venice')
  assert.ok(!('reasoning_effort' in m.toChatCompletions({ model: 'claude-opus-5-5', messages: [] })), 'no level: no field')

  // ---- the bridge engine: Claude Code's own --effort ----
  const bridge = (extra) => m.codirBridgeSend({ text: 'hello', imageIds: [], selectedClipId: null, focus: null, model: 'claude-fable-5-1', ...extra }, () => {}, () => {})
  let r = await bridge({ effort: 'max' })
  assert.equal(r.ok, true, r.error)
  let args = spawned.at(-1).args
  assert.equal(spawned.at(-1).file, FAKE_EXE)
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'claude-fable-5-1', '--effort', 'max'])
  r = await bridge({})
  assert.equal(r.ok, true, r.error)
  assert.ok(!spawned.at(-1).args.includes('--effort'), 'no level picked: Claude Code runs the model at its own')

  console.log('PASS thinking level: five levels on every Claude but Haiku; API = output_config.effort with room to think; Venice = reasoning_effort; bridge = --effort; nothing picked = nothing sent')
})().catch((e) => { console.error(e); process.exitCode = 1 })
