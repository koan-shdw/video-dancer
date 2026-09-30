// list 13 (2026-09-30) — what was still open on Omni Flash 1.1: its video refs (three clips of 3 s
// each, fal) and extending a video to 40 s (Google's own door, on the Google key). The real
// request builder, form check and ref tagging; Google is a stand-in (its documented request and
// reply shapes, ai.google.dev/gemini-api/docs/omni read that day). Nothing is sent or spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-omni-extend-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: {}, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runGoogleOmniExtend, OMNI_EXTEND_MODEL } from '${main}/providers/google'; export { validateForm } from '${ui}/lib/validation'; export { applyVideoRefTags, applyRefTags } from '${ui}/shared/compile'; export { MODELS } from '${ui}/shared/models'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- the registry: video refs on 1.1, and the extend door as its own Google engine ----
  const o11 = m.MODELS.omniflash11, ext = m.MODELS.omniextend
  assert.deepEqual([o11.maxRefVideos, o11.refVideoEachMaxSec, o11.refVideoTagPrompt], [3, 3, 'VIDEO_REF'])
  assert.ok(o11.v2v && !o11.v2v.extend, 'Omni 1.1 on fal still edits')
  assert.deepEqual([ext.provider, ext.v2v.endpoint, ext.v2v.maxInSec, ext.v2v.extend], ['google', 'gemini-omni-1.1-flash', 10, { addsSec: 10, maxTotalSec: 40 }])
  assert.deepEqual(ext.modes, [], 'the extend door is the Video Editor’s alone: Clip Gen never lists it')
  assert.equal(m.MODELS.omniflash.maxRefVideos, 0)

  // ---- @video1 on Gemini's wire: <VIDEO_REF_0>, beside the image tags ----
  assert.equal(m.applyVideoRefTags('Move like @video1, then like @video3. @video10 stays. @videos is not a ref', 'VIDEO_REF'), 'Move like <VIDEO_REF_0>, then like <VIDEO_REF_2>. <VIDEO_REF_9> stays. @videos is not a ref')
  assert.equal(m.applyVideoRefTags(m.applyRefTags('@hero dances like @video1', ['@hero'], 'IMAGE_REF'), 'VIDEO_REF'), '<IMAGE_REF_0> dances like <VIDEO_REF_0>')

  // ---- the form: Omni caps EACH clip at 3 s; Seedance keeps its combined rule ----
  const form = (over) => ({ mode: 'ref2v', promptEmpty: false, refCount: 1, hasStart: false, hasEnd: false, duration: '8', resolution: '720p', aspect: '16:9', ...over })
  assert.deepEqual(m.validateForm(form({ videoRefCount: 3, videoRefSecs: [3, 2.5, 1], videoRefTotalSec: 6.5 }), o11).errors, [])
  assert.deepEqual(m.validateForm(form({ videoRefCount: 2, videoRefSecs: [2, 4.2], videoRefTotalSec: 6.2 }), o11).errors, ['@video2 is 4.2s — Gemini Omni Flash 1.1 takes 3s per video ref at most. Trim its ✂ window.'])
  assert.deepEqual(m.validateForm(form({ videoRefCount: 1, videoRefSecs: [1], videoRefTotalSec: 1 }), o11).errors, [], 'no 2 s minimum on Omni')
  assert.deepEqual(m.validateForm(form({ refCount: 10, videoRefCount: 3, videoRefSecs: [3, 3, 3], videoRefTotalSec: 9 }), o11).errors, [], 'ten images and three clips: Seedance’s 12-file cap is not Omni’s')
  assert.match(m.validateForm(form({ videoRefCount: 4, videoRefSecs: [1, 1, 1, 1], videoRefTotalSec: 4 }), o11).errors[0], /too many video refs .* \(4\/3\)/)
  assert.deepEqual(m.validateForm(form({ refCount: 0, videoRefCount: 1, videoRefSecs: [2] }), o11).errors, [], 'a video ref alone is a reference')
  const sd = m.MODELS.seedance2
  assert.match(m.validateForm(form({ duration: sd.durations[0], resolution: sd.resolutions[0], aspect: sd.aspectRatios[0], videoRefCount: 1, videoRefSecs: [16], videoRefTotalSec: 16 }), sd).errors[0], /16\.0s combined — fal caps them at 15s/)
  assert.deepEqual(m.validateForm(form({ videoRefCount: 1, videoRefSecs: [2] }), m.MODELS.omniflash).warnings, ['Gemini Omni Flash has no video refs — the @video slots are kept but will NOT be sent'])

  // ---- Google: extend a video ----
  const calls = []
  let reply = () => ({})
  let fileStates = ['ACTIVE']
  global.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method ?? 'GET'
    calls.push({ u, method, headers: init.headers ?? {}, body: init.body })
    if (u.includes('/upload/v1beta/files')) return new Response('', { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/session-1' } })
    if (u.endsWith('/upload/session-1')) return new Response(JSON.stringify({ file: { name: 'files/in-1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/in-1', state: 'ACTIVE' } }))
    if (u.endsWith('/v1beta/interactions')) return reply()
    if (u.endsWith('/v1beta/files/out-1')) return new Response(JSON.stringify({ state: fileStates.length > 1 ? fileStates.shift() : fileStates[0] }))
    if (u.includes('/v1beta/files/out-1:download')) return new Response('extended video bytes')
    if (method === 'DELETE') return new Response('{}')
    return new Response('{}', { status: 404 })
  }
  const realSetTimeout = global.setTimeout
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 5), ...a)
  const video = path.join(tmp, 'take.mp4')
  fs.writeFileSync(video, 'a ten second take')
  const okReply = (content) => () => new Response(JSON.stringify({ id: 'v1_abc', status: 'completed', model: 'gemini-omni-1.1-flash', steps: [{ type: 'user_input', content: [] }, { type: 'model_output', content }] }))
  const notes = []
  const run = (o) => m.runGoogleOmniExtend({ prompt: 'the camera keeps rising', googleKey: 'KEY', outDir: path.join(tmp, 'edits'), onProgress: (x) => notes.push(x), ...o })
  const post = () => calls.find((c) => c.u.endsWith('/v1beta/interactions'))

  // an uploaded video: sent through the Files door, extended, the result fetched from its address
  reply = okReply([{ type: 'video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/out-1:download?alt=media' }])
  fileStates = ['PROCESSING', 'ACTIVE']
  let r = await run({ video })
  assert.deepEqual(JSON.parse(post().body), { model: 'gemini-omni-1.1-flash', response_format: { type: 'video', delivery: 'uri' }, input: [{ type: 'video', uri: 'https://generativelanguage.googleapis.com/v1beta/files/in-1' }, { type: 'text', text: 'the camera keeps rising' }] }, 'their documented extend request: the video by its Files address, then his words')
  assert.equal(post().headers['x-goog-api-key'], 'KEY', 'the key rides in the header, never the address')
  assert.ok(!post().u.includes('KEY'))
  assert.equal(r.interactionId, 'v1_abc', 'the session it can continue from later')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'extended video bytes')
  assert.ok(r.file.endsWith('.mp4') && path.dirname(r.file) === path.join(tmp, 'edits'))
  assert.ok(calls.filter((c) => c.u.endsWith('/v1beta/files/out-1')).length >= 2, 'it waits for the file to be ready')
  assert.equal(calls.find((c) => c.u.includes(':download')).headers['x-goog-api-key'], 'KEY')
  await new Promise((res) => realSetTimeout(res, 20))
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.u.endsWith('/v1beta/files/in-1')), 'the upload is taken back down afterwards')

  // a video that an earlier extend made: continued from its session, nothing uploaded
  calls.length = 0
  reply = okReply([{ type: 'video', data: Buffer.from('inline bytes').toString('base64'), mime_type: 'video/mp4' }])
  r = await run({ previousInteractionId: 'v1_abc' })
  assert.deepEqual(JSON.parse(post().body), { model: 'gemini-omni-1.1-flash', response_format: { type: 'video', delivery: 'uri' }, previous_interaction_id: 'v1_abc', input: 'the camera keeps rising' })
  assert.ok(!calls.some((c) => c.u.includes('/upload/')), 'no upload when Google already holds the video')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'inline bytes', 'a small video that comes back inline is kept too')

  // refusals in plain words
  calls.length = 0
  reply = () => new Response(JSON.stringify({ error: { code: 403, message: 'Gemini Omni is not available on the free tier.' } }), { status: 403 })
  await assert.rejects(run({ video }), /^Error: error \(403\) @ google\/interactions: Gemini Omni is not available on the free tier\. — check the Google key in Settings, and that its project is on a paid plan \(Omni has no free tier\)$/)
  await new Promise((res) => realSetTimeout(res, 20))
  assert.ok(calls.some((c) => c.method === 'DELETE'), 'a refused call still takes its upload down')
  reply = okReply([{ type: 'text', text: 'I cannot extend videos with speaking characters.' }])
  await assert.rejects(run({ video }), /^Error: google returned no video \(completed\): I cannot extend videos with speaking characters\.$/)
  reply = () => new Response(JSON.stringify({ error: { message: 'Interaction v1_old not found.' } }), { status: 404 })
  await assert.rejects(run({ previousInteractionId: 'v1_old' }), /^Error: error \(404\) @ google\/interactions: Interaction v1_old not found\.$/)
  await assert.rejects(run({}), /^Error: nothing to extend$/)
  global.setTimeout = realSetTimeout

  console.log('PASS Omni Flash 1.1, the rest: three video refs of 3 s each (their own cap, @video1 → <VIDEO_REF_0>); extending on Google = the documented request (a Files upload, or the session of an earlier extend), the key in the header, the result fetched once ready, the upload taken down, refusals in plain words')
})().catch((e) => { console.error(e); process.exitCode = 1 })
