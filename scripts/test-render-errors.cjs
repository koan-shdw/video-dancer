// list 47 (2026-09-30) — a failed render says what went wrong in one plain line. The supplier's
// full reply is never lost: it stays on the row's tooltip, in the log, and in the project's
// failure list, which the Co-Director can read (08-27 brief, item 2). The error lines below are
// built by the app's own error writers where they are exported, and copied from real replies
// otherwise (the first is the ModelArk failure that put this on the list).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-render-errors-'))
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

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { plainError } from '${ui}/shared/renderErrors'; export { falErrorText } from '${main}/fal'; export { runTool, setExchangeDir, recordRenderFailure, readRenderFailures, TOOLS } from '${main}/codir'; export { newProject, getProject } from '${main}/project'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const plain = m.plainError

  // ---- the failure that put this on the list ----
  const ARK = 'error (404) @ modelark/submit: {"error":{"code":"ModelNotOpen","message":"Your account 2100000000 has not activated the model dreamina-seedance-2-5-260628. Please activate the model service in the Ark Console. Request id: 021727"}} :: sent fields: model, content, resolution'
  assert.equal(plain(ARK), "Seedance 2.5 isn't switched on for this ModelArk account. Activate it in the Ark Console.")
  // the app keeps 300 characters of a reply: cut mid-JSON, it still reads
  assert.equal(plain('error (404) @ modelark/submit: {"error":{"code":"ModelNotOpen","message":"Your account 2100000000 has not activated the model dreamina-seedance-2-0-260128. Please activate the model serv'), "Seedance 2 isn't switched on for this ModelArk account. Activate it in the Ark Console.")
  // Image Edit's ModelArk lane says it as "<code> <message>"
  assert.equal(plain('error (404) @ modelark/images: ModelNotOpen Your account has not activated the model dola-seedream-5-0-pro-260628. :: sent fields: model, prompt'), "Seedream 5.0 Pro isn't switched on for this ModelArk account. Activate it in the Ark Console.")
  assert.equal(plain('error (404) @ modelark/submit: {"error":{"code":"ModelNotOpen","message":"Your account has not activated the model some-new-model-270101."}}'), "This model isn't switched on for this ModelArk account. Activate it in the Ark Console.", 'a model the app does not know is still said plainly')

  // ---- fal, through the app's own error writer ----
  assert.equal(plain(m.falErrorText({ status: 403, body: { detail: 'Forbidden' } }, 'bytedance/seedance-2.5/reference-to-video', ['prompt', 'image_urls'])), 'fal refused it: the key or the credit. Check Settings and your fal balance.')
  assert.equal(plain(m.falErrorText({ status: 401, body: { detail: 'Unauthorized' } }, 'fal-ai/nano-banana-2/edit')), 'fal refused the key. Check it in Settings.')
  assert.equal(plain(m.falErrorText({ status: 402, body: { detail: 'Exhausted balance. Top up your balance at fal.ai/dashboard/billing.' } }, 'bytedance/seedance-2.5/image-to-video')), 'Out of credit on fal. Top up, then run it again.')
  assert.equal(plain(m.falErrorText({ status: 422, body: { detail: [{ loc: ['body', 'duration'], msg: "Input should be '5' or '10'", type: 'enum' }] } }, 'bytedance/seedance-2.5/image-to-video', ['prompt', 'duration'])), "fal refused it: Input should be '5' or '10'.")
  assert.equal(plain(m.falErrorText({ status: 422, body: { detail: [{ loc: ['body', 'prompt'], msg: 'The content could not be processed because it was flagged by a content checker.', type: 'content_policy_violation' }] } }, 'bytedance/seedance-2.5/text-to-video')), 'fal refused the content: The content could not be processed because it was flagged by a content checker.')
  assert.equal(plain(m.falErrorText({ status: 429, message: 'Too Many Requests' }, 'bytedance/seedance-2.5/text-to-video')), 'fal is busy right now. Run it again in a moment.')
  assert.equal(plain(m.falErrorText({ status: 503, message: 'Service Unavailable' }, 'fal-ai/x')), 'fal had a problem on its side (503). Run it again.')

  // ---- the other suppliers' lines, as their writers shape them ----
  assert.equal(plain('error (402) @ venice/queue: Insufficient balance — out of Venice credit: top up on venice.ai'), 'Out of credit on Venice. Top up, then run it again.')
  assert.equal(plain('error (422) @ venice/queue: Unprocessable — Venice’s public Seedance API refuses media with people in it :: sent fields: model, prompt'), 'Venice refused the media: its public Seedance API takes no people in refs.')
  assert.equal(plain('error (401) @ astria/prompts — usually the Astria key (Settings)'), 'Astria refused the key. Check it in Settings.')
  assert.equal(plain('error (400) @ google/interactions: Image generation failed: the prompt was blocked by safety filters'), 'Google refused the content: Image generation failed: the prompt was blocked by safety filters.')
  assert.equal(plain('error (network) @ modelark/images: fetch failed'), "Couldn't reach ModelArk. Check the connection and run it again.")
  assert.equal(plain('error (-32000) @ bridge-mcp/tools/call: Not enough credits to run this generation'), 'Out of credit on the Bridge. Top up, then run it again.')
  assert.equal(plain('error (failed) @ modelark/render: {"code":"InternalError","message":"The task failed to generate. Please retry."}'), 'ModelArk refused it: The task failed to generate.')

  // ---- words that are already plain stay as they are ----
  assert.equal(plain('the open project changed mid-render — the files are under images/gen/'), 'the open project changed mid-render — the files are under images/gen/.')
  assert.equal(plain('No fal key saved — paste it in Settings first.'), 'No fal key saved — paste it in Settings first.', 'a missing key keeps its words: the key steps read them')
  assert.equal(plain(''), 'unknown error.')
  for (const line of [ARK, 'error (500) @ fal-ai/x: ' + 'x'.repeat(900)]) assert.ok(plain(line).length <= 200 && !plain(line).includes('{') && !plain(line).includes('\n'), 'one line, no code: ' + plain(line))

  // ---- the failure list: on disk, newest first for the Co-Director ----
  await m.newProject(tmp, 'Failures')
  const dir = m.getProject().dir
  m.setExchangeDir(dir)
  assert.equal(await m.runTool('read_render_failures', {}, () => {}), '(no failed renders on record for this project)')
  assert.equal(await m.recordRenderFailure(dir, { label: 'Rooftop', kind: 'gen', engine: 'Seedance 2.5 (ModelArk)', plain: plain(ARK), raw: ARK }), true)
  await Promise.all(Array.from({ length: 70 }, (_, i) => m.recordRenderFailure(dir, { label: `clip ${i}`, kind: 'gen', engine: 'fal', plain: 'fal is busy right now. Run it again in a moment.', raw: 'error (429) @ fal-ai/x' })))
  const rows = await m.readRenderFailures(dir)
  assert.equal(rows.length, 60, 'the list keeps the last 60, and writes that overlap never lose one another')
  assert.deepEqual(rows.slice(-3).map((r) => r.label), ['clip 67', 'clip 68', 'clip 69'])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'render-failures.json'), 'utf8')).length, 60)
  await m.recordRenderFailure(dir, { label: 'Rooftop', kind: 'gen', engine: 'Seedance 2.5 (ModelArk)', plain: plain(ARK), raw: ARK })
  const read = await m.runTool('read_render_failures', { limit: 2 }, () => {})
  assert.match(read, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] gen "Rooftop" · Seedance 2\.5 \(ModelArk\)\n  said on the row: Seedance 2\.5 isn't switched on for this ModelArk account\. Activate it in the Ark Console\.\n  the supplier's reply: error \(404\) @ modelark\/submit: \{"error":\{"code":"ModelNotOpen"/, read.slice(0, 300))
  assert.equal(read.split('\n\n').length, 2, 'as many as asked for')
  assert.ok(m.TOOLS.some((t) => t.name === 'read_render_failures' && /READ-ONLY/.test(t.description)))

  console.log('PASS failed renders: one plain line per failure (ModelArk not switched on, by model name; fal key, credit, busy, its own fault, refused content, bad input; Venice, Astria, Google, the Bridge, no connection); plain words stay as they are; every failure lands in the project’s list with the supplier’s full reply, read by the Co-Director')
})().catch((e) => { console.error(e); process.exitCode = 1 })
