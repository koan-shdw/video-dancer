// list 23 (2026-09-30) — lip-sync. Re-timing a take's mouths to a voice (sync-3, VEED Lipsync v2:
// video + audio → video, no words) and a talking video from one picture and one voice (H3 Max Lip
// Sync). The real fal.ts and form check with the fal client mocked (each door's schema read that
// day): nothing is sent or spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-lipsync-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const sent = [], uploads = []
let reply = () => ({ video: { url: 'https://fixture.test/result.mp4' } })
const fal = { config: () => {}, storage: { upload: async (file) => (uploads.push(file.name), 'https://fixture.test/upload/' + file.name) }, subscribe: async (endpoint, args) => (sent.push({ endpoint, input: args.input }), { data: reply() }) }
const runtime = { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runRender, runEdit } from '${main}/fal'; export { MODELS } from '${ui}/shared/models'; export { validateForm } from '${ui}/lib/validation'; export { modelOptions, familyOf } from '${ui}/lib/engineOptions'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent' })
  const mod = { exports: {} }
  global.localStorage = { getItem: () => null, setItem: () => {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? {} : n === '@fal-ai/client' ? { fal } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
  const m = mod.exports
  global.fetch = async () => new Response('fixture video')
  const file = (n) => { const f = path.join(tmp, n); fs.writeFileSync(f, n); return f }
  const last = () => sent.at(-1)

  // ---- the registry: two doors that re-time mouths (Video Editor only), one that makes a still talk (Clip Gen) ----
  const { sync3, veedlipsync, h3maxlipsync } = m.MODELS
  assert.deepEqual([sync3.v2v.endpoint, sync3.v2v.lipsync, sync3.modes], ['fal-ai/sync-lipsync/v3', { modes: ['cut_off', 'loop', 'bounce', 'silence', 'remap'] }, []])
  assert.deepEqual([veedlipsync.v2v.endpoint, veedlipsync.v2v.lipsync, veedlipsync.modes], ['veed/lipsync/v2', {}, []])
  assert.ok(Math.abs(sync3.v2v.pricePerSecOut * 60 - 8) < 1e-9 && veedlipsync.v2v.pricePerSecOut === 0.07, 'their page prices: $8 a minute, $0.07 a second')
  assert.deepEqual(Object.values(m.MODELS).filter((x) => x.v2v?.lipsync).map((x) => x.id).sort(), ['sync3', 'veedlipsync'])
  assert.deepEqual([h3maxlipsync.endpoints.ref2v, h3maxlipsync.talkingStill, h3maxlipsync.pricePerSec], ['minimax/h3-max/lip-sync/image-to-video', { minAudioSec: 5, maxAudioSec: 900, over: { sec: 15, mult: 1.2 } }, { '480p': 0.05, '768p': 0.08, '1080p': 0.16, '2k': 0.32 }])
  assert.equal(m.familyOf('h3maxlipsync'), 'h3maxlipsync', 'the talking still is a Clip Gen model')
  assert.ok(m.modelOptions().some((o) => o.value === 'h3maxlipsync') && !m.modelOptions().some((o) => /sync3|veed/.test(o.value)), 'the two re-timing doors never list in Clip Gen')

  // ---- sync-3: the video, the voice, the mismatch rule. No words ----
  const edit = { prompt: 'lip-sync to Kai', video: file('take.mp4'), audio: file('line.mp3'), falKey: 'fake', outDir: path.join(tmp, 'edits') }
  let r = await m.runEdit({ ...edit, engine: 'sync3', syncMode: 'bounce' })
  assert.deepEqual(last(), { endpoint: 'fal-ai/sync-lipsync/v3', input: { video_url: 'https://fixture.test/upload/take.mp4', audio_url: 'https://fixture.test/upload/line.mp3', sync_mode: 'bounce' } }, 'sync-3’s documented input: no prompt is sent')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'fixture video')
  await m.runEdit({ ...edit, engine: 'sync3', syncMode: 'sideways' })
  assert.equal(last().input.sync_mode, 'cut_off', 'a rule the door does not list becomes its default')
  await m.runEdit({ ...edit, engine: 'sync3' })
  assert.equal(last().input.sync_mode, 'cut_off')
  // VEED: the two files and nothing else
  await m.runEdit({ ...edit, engine: 'veedlipsync', syncMode: 'loop' })
  assert.deepEqual(last(), { endpoint: 'veed/lipsync/v2', input: { video_url: 'https://fixture.test/upload/take.mp4', audio_url: 'https://fixture.test/upload/line.mp3' } }, 'VEED has no mismatch rule in its schema: none is sent')
  const before = sent.length
  await assert.rejects(m.runEdit({ ...edit, engine: 'sync3', audio: undefined }), /sync-3 needs the voice the mouths follow/)
  assert.equal(sent.length, before, 'no voice = nothing is sent')
  // a true edit is untouched by all this
  await m.runEdit({ ...edit, engine: 'omniflash11', prompt: 'make it night', resolution: '1080p' })
  assert.deepEqual(last().input, { prompt: 'make it night', video_url: 'https://fixture.test/upload/take.mp4', resolution: '1080p' })

  // ---- H3 Max Lip Sync: one picture, one voice, a size ----
  reply = () => ({ video: { url: 'https://fixture.test/result.mp4' }, seed: 3, duration: 42.5 })
  const big = path.join(tmp, 'long-voice.mp3'); fs.writeFileSync(big, Buffer.alloc(16 * 1024 * 1024, 1))
  const gen = { prompt: 'never sent', duration: 'auto', resolution: '1080p', aspectRatio: 'auto', generateAudio: true, falKey: 'fake', outDir: path.join(tmp, 'out'), engine: 'h3maxlipsync', mode: 'ref2v' }
  r = await m.runRender({ ...gen, images: [file('face.png')], audios: [big] })
  assert.deepEqual(last(), { endpoint: 'minimax/h3-max/lip-sync/image-to-video', input: { image_url: 'https://fixture.test/upload/face.png', audio_url: 'https://fixture.test/upload/long-voice.mp3', resolution: '1080P' } }, 'its documented input: the picture, the voice, the size in ITS spelling; a 16 MB voice is not stopped by Seedance’s cap')
  assert.equal(r.durationSec, 42.5, 'the take is as long as the voice')
  await m.runRender({ ...gen, resolution: '2k', images: [file('face.png')], audios: [file('v.mp3')] })
  assert.equal(last().input.resolution, '2K')
  await m.runRender({ ...gen, resolution: '720p', images: [file('face.png')], audios: [file('v.mp3')] })
  assert.equal(last().input.resolution, '768P', 'a size it does not make falls to its default')
  await assert.rejects(m.runRender({ ...gen, images: [file('face.png')], audios: [] }), /needs one picture and one voice/)

  // ---- the form: what a talking still needs, said before the click ----
  const form = (over) => ({ mode: 'ref2v', promptEmpty: true, refCount: 1, hasStart: false, hasEnd: false, duration: 'auto', resolution: '768p', aspect: 'auto', audioRefCount: 1, audioRefSecs: [12], ...over })
  assert.deepEqual(m.validateForm(form(), h3maxlipsync), { errors: [], warnings: [] }, 'one picture, one voice, no words: ready')
  assert.deepEqual(m.validateForm(form({ promptEmpty: false }), h3maxlipsync).warnings, ['H3 Max Lip Sync takes no words — the prompt and fields are kept but will NOT be sent'])
  assert.deepEqual(m.validateForm(form({ refCount: 0 }), h3maxlipsync).errors, ['add the picture that talks (one reference image)'])
  assert.deepEqual(m.validateForm(form({ refCount: 2 }), h3maxlipsync).errors, ['H3 Max Lip Sync takes one picture (2 are attached)'])
  assert.deepEqual(m.validateForm(form({ audioRefCount: 0, audioRefSecs: [] }), h3maxlipsync).errors, ['add the voice it speaks with (one audio ref: a Library track or a Bin voice)'])
  assert.deepEqual(m.validateForm(form({ audioRefSecs: [3.2] }), h3maxlipsync).errors, ['the voice is 3.2s — H3 Max Lip Sync needs at least 5s'])
  assert.deepEqual(m.validateForm(form({ audioRefSecs: [1200] }), h3maxlipsync).errors, ['the voice is 20 min — H3 Max Lip Sync takes 15 min at most'])
  assert.deepEqual(m.validateForm(form({ audioRefSecs: [120] }), h3maxlipsync).errors, [], 'two minutes of voice is fine here (Seedance’s 15 s rule is not its rule)')
  assert.match(m.validateForm(form({ mode: 'i2v', hasStart: true }), h3maxlipsync).errors[0], /switch the mode to ref2v/)
  assert.match(m.validateForm(form({ resolution: '720p' }), h3maxlipsync).errors[0], /resolution 720p isn't valid/)
  // Seedance keeps its own rules
  const sd = m.MODELS.seedance2
  assert.match(m.validateForm({ mode: 'ref2v', promptEmpty: false, refCount: 1, hasStart: false, hasEnd: false, duration: sd.durations[0], resolution: sd.resolutions[0], aspect: sd.aspectRatios[0], audioRefCount: 1, audioRefTotalSec: 20, audioRefSecs: [20] }, sd).errors[0], /20\.0s combined — fal caps them at 15s/)

  console.log('PASS lip-sync: sync-3 = video + voice + its mismatch rule, VEED = video + voice, no words to either, no voice = nothing sent; H3 Max Lip Sync = one picture + one voice at its own size spelling, as long as the voice; the form names what a talking still needs; the re-timing doors list in the Video Editor only')
})().catch((e) => { console.error(e); process.exitCode = 1 })
