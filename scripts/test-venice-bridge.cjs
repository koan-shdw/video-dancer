// list 14 stage 3 (2026-09-30) — Venice on the Bridge: a KEY row ("logged in" = the key is saved in
// Settings, the balance is one read of /api_keys/rate_limits in credits), and a lane under Bridge
// (auto) that renders through the Venice adapter on that key. Network mocked: nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-venice-bridge-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
// the router's import chain reaches the Co-Director's guides (Vite ?raw imports) — read them as text
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const runtime = { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } }
let bridge
const load = async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/bridge/index'; export { runBridgeAutoRender } from '${main}/providers/mcp/bridgeAuto'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
  bridge = mod.exports
}

let key = 'vk', usd = 12.4
const calls = []
global.fetch = async (url, init = {}) => {
  const where = String(url).replace('https://api.venice.ai/api/v1', '')
  calls.push({ where, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined })
  if (where === '/api_keys/rate_limits') return new Response(JSON.stringify({ data: { balances: { USD: usd, DIEM: 0 } } }), { status: 200 })
  if (where === '/video/quote') return new Response(JSON.stringify({ quote: 0.5 }), { status: 200 })
  if (where === '/video/queue') return new Response(JSON.stringify({ queue_id: 'q-9' }), { status: 200 })
  if (where === '/video/retrieve') return new Response(Buffer.from('MP4'), { status: 200, headers: { 'content-type': 'video/mp4' } })
  return new Response('{}', { status: 404 })
}
const row = () => bridge.bridgeRows().find((r) => r.id === 'venice')

;(async () => {
  await load()
  let changed = 0
  await bridge.initBridge({ load: async () => undefined, save: async () => {}, key: async (id) => (id === 'venice' ? key : undefined) }, () => changed++)
  await bridge.refreshKeyService('venice')
  assert.deepEqual({ loggedIn: row().loggedIn, auth: row().auth, balance: row().balance, unit: row().creditUnit, kind: row().kind }, { loggedIn: true, auth: 'key', balance: 1240, unit: 'credits', kind: 'video' }, 'a saved key = a live row, $12.40 = 1,240 credits')
  assert.ok(bridge.bridgeReady('venice'))
  assert.equal(bridge.bridgeBalance('venice'), 1240)
  assert.ok(changed > 0, 'the panel is told')
  // login / logout are inert on a key row — its door is Settings
  await bridge.loginService('venice')
  await bridge.logoutService('venice')
  assert.ok(row().loggedIn, 'logout never forgets a key')

  // Bridge (auto) with Venice the only account: the render goes out on the Venice key, quality engine
  const msgs = []
  const out = await bridge.runBridgeAutoRender({ engine: 'seedance25bridge', mode: 'ref2v', prompt: 'a dancer turns', images: [], duration: '8', resolution: '720p', aspectRatio: '16:9', generateAudio: true, outDir: path.join(tmp, 'out'), onProgress: (m) => msgs.push(m) })
  assert.equal(fs.readFileSync(out.file, 'utf8'), 'MP4')
  const q = calls.find((c) => c.where === '/video/queue')
  assert.equal(q.auth, 'Bearer vk')
  assert.equal(q.body.model, 'seedance-2-5-text-to-video-basic', 'no refs = the text-to-video model of the 2.5 quality engine')
  assert.ok(msgs.includes('Bridge → Venice…'), msgs.join(' | '))

  // the key is cleared in Settings: the row drops, the lane closes
  key = ''
  await bridge.refreshKeyService('venice')
  assert.equal(row().loggedIn, false)
  assert.equal(bridge.bridgeReady('venice'), false)
  await assert.rejects(bridge.runBridgeAutoRender({ engine: 'seedance2bridge', mode: 'ref2v', prompt: 'x', images: [], duration: '5', resolution: '720p', aspectRatio: '16:9', generateAudio: true, outDir: tmp }), /no logged-in account serves this model/)

  console.log('PASS Venice on the Bridge: a key row with its balance in credits, inert login/logout, a lane under Bridge (auto) on the quality engine, gone when the key goes')
})().catch((e) => { console.error(e); process.exitCode = 1 })
