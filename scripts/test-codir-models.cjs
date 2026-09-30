// list 25 (2026-09-30) — the newest Claude models everywhere. The Co-Director's two lists (API,
// bridge) carry Fable 5.1, Opus 5.5 and Sonnet 5.5, the newest of each line first, the first row
// the default; older models stay listed. The Director's Room chip and its flip read the bridge
// list. The supplier interpreter rides the Co-Director's lane. Ids, prices and the oldest Claude
// Code per model were read off Anthropic's pages and Claude Code's changelog that day.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-models-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { CODIR_MODELS, CODIR_DEFAULT_MODEL, resolveCodirModel } from '${main}/codir'; export { CODIR_BRIDGE_MODELS, CODIR_BRIDGE_DEFAULT_MODEL, resolveBridgeModel } from '${main}/codirBridge'; export { interpretBridgeReply, setInterpreterLane } from '${main}/bridge/interpreter'; export { modelShortName, flipOpusSonnet, cliVersionLess } from '${ui}/shared/models'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- the API list: Anthropic's ids and prices, the newest of each line first ----
  assert.deepEqual(m.CODIR_MODELS.map((x) => x.id), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-haiku-4-5'])
  assert.equal(m.CODIR_MODELS[0].id, m.CODIR_DEFAULT_MODEL, 'the first row is the default: the newest Sonnet')
  const price = Object.fromEntries(m.CODIR_MODELS.map((x) => [x.id, x.label.match(/\$[\d.]+ \/ \$[\d.]+/)?.[0]]))
  assert.deepEqual(price, { 'claude-sonnet-5-5': '$2 / $10', 'claude-opus-5-5': '$4 / $20', 'claude-fable-5-1': '$10 / $50', 'claude-sonnet-5': '$2 / $10', 'claude-opus-5': '$5 / $25', 'claude-fable-5': '$10 / $50', 'claude-haiku-4-5': '$1 / $5' }, 'per MTok in / out, off the pricing page')
  assert.ok(!m.CODIR_MODELS.some((x) => /\$3 \/ \$15|intro/.test(x.label)), 'the called-off Sonnet 5 price rise is gone')
  assert.equal(m.resolveCodirModel('claude-sonnet-5'), 'claude-sonnet-5', 'an older pick he saved stays his')
  assert.equal(m.resolveCodirModel('claude-3-opus-20240229'), 'claude-sonnet-5-5', 'a retired id falls to the default')
  assert.equal(m.resolveCodirModel(undefined), 'claude-sonnet-5-5')

  // ---- the bridge list: subscription models, no prices; the newest Fable first ----
  assert.deepEqual(m.CODIR_BRIDGE_MODELS.map((x) => [x.id, x.minCli]), [['claude-fable-5-1', '2.1.257'], ['claude-opus-5-5', '2.1.280'], ['claude-sonnet-5-5', '2.1.284'], ['claude-fable-5', undefined], ['claude-opus-5', undefined], ['claude-sonnet-5', undefined], ['claude-haiku-4-5', undefined]])
  assert.equal(m.CODIR_BRIDGE_MODELS[0].id, m.CODIR_BRIDGE_DEFAULT_MODEL)
  assert.ok(!m.CODIR_BRIDGE_MODELS.some((x) => x.label.includes('$')), 'a subscription has no per-token price')
  assert.equal(m.resolveBridgeModel('claude-fable-5'), 'claude-fable-5')
  assert.equal(m.resolveBridgeModel(undefined), 'claude-fable-5-1')
  assert.ok(m.cliVersionLess('2.1.283', m.CODIR_BRIDGE_MODELS[2].minCli) && !m.cliVersionLess('2.1.283', m.CODIR_BRIDGE_MODELS[1].minCli), 'Claude Code 2.1.283 runs Opus 5.5 and is one short for Sonnet 5.5')

  // ---- the Director's Room chip reads that list ----
  const L = m.CODIR_BRIDGE_MODELS
  assert.deepEqual(L.map((x) => m.modelShortName(L, x.id)), ['FABLE 5.1', 'OPUS 5.5', 'SONNET 5.5', 'FABLE 5', 'OPUS 5', 'SONNET 5', 'HAIKU 4.5'])
  assert.equal(m.modelShortName(L, 'claude-next'), 'CLAUDE-NEXT', 'an unknown id shows as it is')
  assert.equal(m.flipOpusSonnet(L, 'claude-fable-5-1'), 'claude-sonnet-5-5', 'from anything but a Sonnet: the newest Sonnet')
  assert.equal(m.flipOpusSonnet(L, 'claude-opus-5'), 'claude-sonnet-5-5')
  assert.equal(m.flipOpusSonnet(L, 'claude-sonnet-5-5'), 'claude-opus-5-5', 'from a Sonnet: the newest Opus')
  assert.equal(m.flipOpusSonnet(L, 'claude-sonnet-5'), 'claude-opus-5-5')
  assert.equal(m.flipOpusSonnet([], 'claude-opus-5-5'), undefined, 'no list yet: the click does nothing')

  // ---- the supplier interpreter rides the Co-Director's lane, whatever the engine ----
  const calls = []
  global.fetch = async (url, init = {}) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"action":"call","tool":"generate","args":{"ok":true}}' }], stop_reason: 'end_turn' })) }
  const ask = () => m.interpretBridgeReply({ service: 'higgsfield', toolCalled: 'generate', sentArgs: {}, reply: 'Want a preset?', allowedTools: ['generate'] })
  assert.match((await ask()).reason, /could not answer/, 'no lane wired: a plain failure')
  m.setInterpreterLane(async () => ({ engine: 'api', apiKey: undefined, model: 'claude-sonnet-5-5' }))
  assert.match((await ask()).reason, /no Claude is configured/, 'no key on the lane: said plainly, nothing sent')
  assert.equal(calls.length, 0)
  m.setInterpreterLane(async () => ({ engine: 'api', apiKey: 'sk-ant-x', model: 'claude-opus-5-5' }))
  assert.deepEqual(await ask(), { action: 'call', tool: 'generate', args: { ok: true } })
  assert.equal(calls.at(-1).body.model, 'claude-opus-5-5', 'the model is the Co-Director’s pick, never a hard-coded one')

  console.log('PASS Co-Director models: API list (7, newest first, Sonnet 5.5 default, today’s prices), bridge list (Fable 5.1 default, oldest Claude Code per model), the Room chip and flip read the list, the supplier interpreter rides the lane')
})().catch((e) => { console.error(e); process.exitCode = 1 })
