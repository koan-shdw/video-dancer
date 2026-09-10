// Provider contracts are mocked: these checks never send footage or spend API credit.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), { buildSync } = require('esbuild')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-watch-test-'))
const file = path.join(tmp, 'take.mp4'); fs.writeFileSync(file, 'synthetic video')
let large = false, spent = [], calls = [], frames = 0, handler
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main/watch.ts')], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['./project', './export'] }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name => {
  if (name === './project') return { captureProjectSession: () => ({}), assertProjectSession: () => {}, addSpend: async x => spent.push(x) }
  if (name === './export') return { probeFile: async () => ({ duration: 2 }), extractFrame: async (_file, _at, png) => { frames++; fs.writeFileSync(png, 'png'); return true } }
  if (name === 'fs/promises') return { ...require(name), stat: async () => ({ size: large ? 16e6 : 100 }) }
  return require(name)
}, mod, mod.exports)
const { watchVideo, WATCH_MODEL, describeWatch } = mod.exports
const originalFetch = global.fetch
global.fetch = async (url, options = {}) => { calls.push({ url: String(url), ...options }); return handler(String(url), options) }
const json = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers })
const good = () => json({ candidates: [{ content: { parts: [{ text: 'A knight falls.' }] } }], usageMetadata: { totalTokenCount: 130, promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10 } })
async function check(name, run) { calls = []; frames = 0; large = false; await run(); console.log('PASS ' + name) }
;(async () => {
  await check('configured default and usage estimate', async () => {
    handler = good
    const r = await watchVideo(file, 'Describe motion', { googleKey: 'fake', label: 'test' })
    assert.equal(r.ok, true); assert.equal(r.model, WATCH_MODEL); assert.equal(WATCH_MODEL, 'gemini-3.6-flash')
    assert.equal(r.via, 'gemini'); assert.equal(r.tokens, 130); assert.ok(r.costUsd > 0); assert.equal(spent.length, 1)
    assert.ok(calls[0].url.includes('/gemini-3.6-flash:generateContent'))
    assert.equal(JSON.parse(calls[0].body).contents[0].parts[1].text, 'Describe motion')
  })
  await check('custom model is used without invented pricing', async () => {
    handler = good
    const r = await watchVideo(file, '', { googleKey: 'fake', googleModel: 'models/custom-video-model' })
    assert.equal(r.model, 'custom-video-model'); assert.equal(r.costUsd, undefined)
    assert.ok(calls[0].url.includes('/custom-video-model:generateContent'))
  })
  await check('retired model falls back to Claude and reports lost capabilities', async () => {
    handler = url => url.includes('googleapis') ? json({ error: { message: 'Model retired' } }, 404) : json({ content: [{ text: 'Still images show a knight.' }] })
    const r = await watchVideo(file, '', { googleKey: 'fake', anthropicKey: 'fake' })
    assert.equal(r.ok, true); assert.equal(r.via, 'frames'); assert.match(r.warning, /Model retired/)
    assert.match(describeWatch(r), /no motion or sound/); assert.equal(frames, 4)
    assert.ok(JSON.parse(calls[1].body).messages[0].content.some(x => x.text?.includes('do not invent either')))
  })
  await check('empty Gemini response also falls back to Bridge', async () => {
    handler = () => json({ candidates: [] })
    const r = await watchVideo(file, '', { googleKey: 'fake', bridge: async prompt => { assert.match(prompt, /Read these image files/); return { ok: true, text: 'stills' } } })
    assert.equal(r.via, 'frames'); assert.match(r.warning, /no text/)
  })
  await check('missing Google key uses existing frame route', async () => {
    const r = await watchVideo(file, '', { bridge: async () => ({ ok: true, text: 'stills' }) })
    assert.equal(r.via, 'frames'); assert.equal(calls.length, 0)
  })
  await check('both failures retain actionable errors', async () => {
    handler = () => json({ error: { message: 'Unavailable' } }, 404)
    const r = await watchVideo(file, '', { googleKey: 'fake', bridge: async () => ({ ok: false, error: 'Bridge offline' }) })
    assert.equal(r.ok, false); assert.match(r.error, /Unavailable.*Bridge offline/)
  })
  await check('cancellation never triggers another provider', async () => {
    const c = new AbortController()
    handler = () => { c.abort(); throw Error('cancelled') }
    const r = await watchVideo(file, '', { googleKey: 'fake', signal: c.signal, bridge: async () => { throw Error('must not run') } })
    assert.equal(r.ok, false); assert.match(r.error, /cancelled/i); assert.equal(frames, 0)
  })
  await check('uploaded files are deleted after success', async () => {
    large = true
    handler = (url, opts) => opts.method === 'DELETE' ? json({}) : url.includes('/upload/') ? json({}, 200, { 'x-goog-upload-url': 'https://upload.test/finalize' }) : url.includes('upload.test') ? json({ file: { name: 'files/test', uri: 'https://files.test/video', state: 'ACTIVE' } }) : good()
    const r = await watchVideo(file, '', { googleKey: 'fake' })
    assert.equal(r.ok, true); assert.equal(calls.at(-1).method, 'DELETE')
    assert.ok(JSON.parse(calls[2].body).contents[0].parts[0].file_data)
  })
  await check('failed upload processing also deletes the remote file', async () => {
    large = true
    handler = (url, opts) => opts.method === 'DELETE' ? json({}) : url.includes('/upload/') ? json({}, 200, { 'x-goog-upload-url': 'https://upload.test/finalize' }) : json({ file: { name: 'files/failed', uri: 'https://files.test/video', state: 'FAILED' } })
    const r = await watchVideo(file, '', { googleKey: 'fake' })
    assert.equal(r.ok, false); assert.match(r.error, /could not process/); assert.equal(calls.at(-1).method, 'DELETE')
  })
  await check('invalid model is rejected before sending data', async () => {
    const r = await watchVideo(file, '', { googleKey: 'fake', googleModel: '../bad' })
    assert.equal(r.ok, false); assert.equal(calls.length, 0)
  })
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { global.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }) })
