// His log 10-02: three failed Seedance renders (09-27/28) asked again every 30 s, "Unprocessable Entity"
// for good. fal reports a failed request COMPLETED, then refuses its result with 422; that refusal threw
// past the mapping. Every recovery fetch (renders, scores, voices) now reads it as final ('gone') and still
// retries a network failure. A stand-in fal client: nothing is sent anywhere.
const path = require('node:path'), vm = require('node:vm'), os = require('node:os'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
let status = { status: 'COMPLETED' }, statusErr = null, resultErr = null
const falStub = { fal: { config() {}, queue: { status: async () => { if (statusErr) throw statusErr; return status }, result: async () => { if (resultErr) throw resultErr; return { data: {} } } } } }
const electron = { app: { getPath: () => os.tmpdir(), isPackaged: false }, net: {}, shell: {} }
function load(file) {
  const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main', file)], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['electron', 'ffmpeg-static', 'ffprobe-static', '@fal-ai/client'], logLevel: 'silent' }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((id) => (id === '@fal-ai/client' ? falStub : id === 'electron' ? electron : require(id)), mod, mod.exports)
  return mod.exports
}
;(async () => {
  const fetchers = { render: load('fal.ts').fetchRenderResult, score: load('scoreRender.ts').fetchScoreResult, voice: load('voiceRender.ts').fetchVoiceResult }
  const err = (s, m) => Object.assign(new Error(m), s ? { status: s } : {})
  for (const [name, fetch] of Object.entries(fetchers)) {
    const ask = () => fetch('bytedance/seedance-2.5/reference-to-video', 'req', 'key', os.tmpdir())
    status = { status: 'COMPLETED' }; statusErr = null
    resultErr = err(422, 'Unprocessable Entity')
    assert.deepEqual(await ask(), { state: 'gone' }, `${name}: COMPLETED, then a 422 on the result = gone (was retried forever)`)
    resultErr = err(404, 'Not Found')
    assert.deepEqual(await ask(), { state: 'gone' }, `${name}: a 404 on the result = gone`)
    resultErr = err(0, 'fetch failed')
    await assert.rejects(ask, /fetch failed/, `${name}: a network failure on the result still throws (kept for the next pass)`)
    resultErr = null; statusErr = err(422, 'Unprocessable Entity')
    assert.deepEqual(await ask(), { state: 'gone' }, `${name}: a 422 on the status = gone, as before`)
    statusErr = err(503, 'Service Unavailable')
    assert.deepEqual(await ask(), { state: 'running' }, `${name}: a 5xx on the status = ask again, as before`)
    statusErr = null; status = { status: 'IN_PROGRESS' }
    assert.deepEqual(await ask(), { state: 'running' }, `${name}: still cooking = running`)
  }
  console.log('FAL RECOVERY OK: renders, scores and voices read a refused result (400/404/422) as final, a network failure as "ask again", the status as before')
})().catch((e) => { console.error(e); process.exit(1) })
