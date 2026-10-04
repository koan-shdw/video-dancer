// Real score handlers, provider wire builder, project persistence and ffmpeg; no paid calls.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), { buildSync, transformSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-score-'))
const app = path.resolve(__dirname, '..'), shared = path.resolve(app, '../koan-shared/vidancer-ui/src/shared')
function load(file, mocks = {}) {
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', './runtime', 'electron', ...Object.keys(mocks)] }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(n => mocks[n] ?? (n === 'electron' ? {} : require(n)), mod, mod.exports)
  return mod.exports
}
const p = load(path.join(app, 'src/main/project.ts'))
const request = load(path.join(shared, 'scoreRequest.ts')), emit = load(path.join(shared, 'emitScore.ts'))
const pending = load(path.join(app, 'src/main/pending.ts'))
const exporter = load(path.join(app, 'src/main/export.ts'))
let inputs = [], uploads = [], watched = [], subcalls = [], settings = { falKey: 'fake-fal', elevenKey: 'fake-eleven', anthropicKey: 'fake-claude', googleKey: 'fake-google' }
let subscribeHook, composeHook, watchOk = true
const fal = { config: () => {}, storage: { upload: async f => { uploads.push(Buffer.from(await f.arrayBuffer())); return 'https://fixture.test/upload' } }, subscribe: async (endpoint, opts) => {
  inputs.push({ endpoint, input: structuredClone(opts.input) }); opts.onEnqueue?.('request-' + inputs.length)
  await subscribeHook?.()
  return { data: { audio: { url: 'https://fixture.test/score.mp3' }, duration: 11, seed: 12 } }
} }
const renderer = load(path.join(app, 'src/main/scoreRender.ts'), { '@fal-ai/client': { fal }, './export': { probeFile: async () => ({ duration: 11 }) }, './runtime': {
  streamBodyToFile: async (body, file) => { const bytes = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, bytes); return bytes.length }
} })
// the beats writer: Gemini when it watched the cut (his 09-23 law), Claude otherwise. Both record
// into `subcalls` as the 'synth' task, so every compose assertion below holds for either road.
const writeBeats = async prompt => { const t = { id: 'synth', prompt }; subcalls.push(t); await composeHook?.([t]); return { ok: true, text: '[{"at":0,"text":"Quiet strings"},{"at":4,"text":"Brass lift"}]' } }
const composer = load(path.join(app, 'src/main/scoreCompose.ts'), { './project': p, './watch': { geminiAsk: async (_key, _model, prompt) => writeBeats(prompt), watchVideo: async file => { watched.push(file); return watchOk ? { ok: true, text: 'At 0 blue; at 1 red; then silence.', via: 'gemini' } : { ok: false, error: 'fixture watch failure' } } }, './subcall': {
  runSubCalls: async tasks => { subcalls.push(...tasks); await composeHook?.(tasks); return { results: tasks.map(t => ({ id: t.id, ok: true, text: t.id === 'synth' ? '[{"at":0,"text":"Quiet strings"},{"at":4,"text":"Brass lift"}]' : 'Recipe mood' })) } }
} })
const handlers = {}, locals = []
const source = fs.readFileSync(path.join(app, 'src/main/index.ts'), 'utf8').replace(/registerJobIpc\(/g, 'ipcMain.handle(') // job wrapper is exercised by test-job-notifications
// the handlers resolve the Co-Director's lane through the app's own claudeLane (list 14; it lives in
// codirLane.ts since list 35) — the real one rides along
const laneFile = fs.readFileSync(path.join(app, 'src/main/codirLane.ts'), 'utf8')
const lane = laneFile.slice(laneFile.indexOf('export interface CodirLane')).replace(/^export /gm, '') + '\n'
const section = lane + source.slice(source.indexOf("  ipcMain.handle('score:render'"), source.indexOf("  ipcMain.handle('score:new'"))
// list 20: the handler shrinks the pictures with Electron's nativeImage — a stand-in that says what it was asked
const nativeImage = { createFromPath: f => ({ isEmpty: () => !fs.existsSync(f), getSize: () => ({ width: 4000, height: 2000 }), toJPEG: () => Buffer.from('full ' + path.basename(f)), resize: o => ({ toJPEG: q => Buffer.from(`jpeg${q} ${o.width}x${o.height}`) }) }) }
const ctx = { ...p, ...request, ...emit, ...composer, ...pending, ...renderer, ...load(path.join(shared, 'imageSources.ts')), nativeImage, basename: path.basename, existsSync: fs.existsSync, probeVideo: exporter.probeVideo, toMp3: exporter.toMp3, createHash: require('node:crypto').createHash, app: { getPath: () => tmp }, structuredClone, join: path.join, unlink: require('node:fs/promises').unlink,
  ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, loadSettings: async () => settings,
  safeSend: () => {}, observePendingWrite: (_dir, promise) => promise,
  resolveBridgeModel: () => 'bridge-model', resolveCodirModel: () => 'api-model', resolveVeniceModel: () => 'venice-model', VENICE_TAG: 'venice:', bridgeOneShot: () => {},
  resolveDeepseekModel: () => 'deepseek-model', DEEPSEEK_TAG: 'deepseek:', resolveCodexModel: () => 'codex-model', resolveGeminiModel: () => 'gemini-model',
  exportTimeline: exporter.exportTimeline,
  audioLocal: { ACE_ID: 'ace-step-1.5', renderAceScore: async args => { locals.push(args.input); return { file: path.join(tmp, 'local.wav'), durationSec: 10 } }, renderMinimaxScore: async args => { locals.push(args.input); return { file: path.join(tmp, 'local.wav'), durationSec: 10 } } }
}
vm.runInNewContext(transformSync(section, { loader: 'ts', target: 'es2022' }).code, ctx)
const call = (name, args) => handlers['score:' + name]({ sender: {} }, args)
const originalFetch = global.fetch
let fetches = []
global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(Buffer.alloc(1200, 7)) }
const ffmpeg = require('ffmpeg-static')
const ff = args => { const r = spawnSync(ffmpeg, args, { maxBuffer: 8e6 }); assert.equal(r.status, 0, String(r.stderr)); return r }
async function check(label, fn) { await fn(); console.log('PASS ' + label) }
;(async () => {
  await p.newProject(tmp, 'Score'); const project = p.getProject()
  const { scoreClipId } = await p.newScoreClip('Fixture score')
  const score = () => p.getProject().scoreClips.find(s => s.id === scoreClipId)
  const music = 'minimax-music-3'
  await check('queued recipes stay frozen through edits, render, take restore and recovery metadata', async () => {
    await p.setScoreClipData(scoreClipId, { recipe: { engine: music, options: { styleText: 'FIRST STYLE', durationSec: 11 } }, beats: [{ id: 'a', at: 0, text: 'FIRST BEAT' }] })
    const req = request.scoreRenderRequest(score(), project)
    await p.setScoreClipData(scoreClipId, { recipe: { engine: 'beatoven', options: { styleText: 'CHANGED', durationSec: 50 } }, beats: [] })
    subscribeHook = async () => { await new Promise(r => setTimeout(r, 30)); const records = await pending.listPendingScores(project.dir); assert.equal(records.at(-1).snapshot.recipe.options.styleText, 'FIRST STYLE') }
    const r = await call('render', req); assert.equal(r.ok, true, r.error); subscribeHook = undefined
    assert.equal(inputs.at(-1).endpoint, 'minimax/music-3'); assert.match(inputs.at(-1).input.prompt, /FIRST STYLE.*FIRST BEAT/)
    assert.equal(inputs.at(-1).input.duration, 11); assert.equal(score().takes.at(-1).snapshot.recipe.engine, music)
    assert.equal((await pending.listPendingScores(project.dir)).length, 0)
  })
  await check('unknown and voice engines fail before any provider call; local routes never use fal', async () => {
    const before = inputs.length
    for (const engine of ['missing-model', 'seed-audio-1']) assert.equal((await call('render', { scoreClipId, engine })).ok, false)
    for (const engine of ['ace-step-1.5', 'minimax-music-3-local']) assert.equal((await call('render', { scoreClipId, engine })).ok, true)
    assert.equal(inputs.length, before); assert.equal(locals.length, 2)
    assert.ok(locals[0].audio_duration); assert.ok(locals[1].duration)
    await assert.rejects(() => renderer.runScoreRender({ engine: 'ace-step-1.5', beats: [], options: {}, falKey: 'fake', outDir: tmp }), /local runtime/)
  })
  await check('ElevenLabs uses its own key and sends output format as a query parameter', async () => {
    const before = inputs.length
    const r = await call('render', { scoreClipId, engine: 'eleven-music-v2' }); assert.equal(r.ok, true, r.error)
    const sent = fetches.findLast(f => f.url.includes('api.elevenlabs.io'))
    assert.match(sent.url, /\?output_format=mp3_44100_128$/); assert.equal(sent.opts.headers['xi-api-key'], 'fake-eleven')
    const body = JSON.parse(sent.opts.body); assert.equal(body.output_format, undefined); assert.equal(body.model_id, 'music_v2'); assert.equal(inputs.length, before)
    settings.elevenKey = ''; assert.match((await call('render', { scoreClipId, engine: 'eleven-music-v2' })).error, /ElevenLabs key/); settings.elevenKey = 'fake-eleven'
  })
  await check('ElevenLabs stop aborts the HTTP wait and clears its job', async () => {
    global.fetch = async (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }))
    const job = renderer.runScoreRender({ jobId: 'stop-me', engine: 'eleven-music-v2', beats: [], options: {}, elevenKey: 'fake', falKey: '', outDir: tmp })
    assert.equal(renderer.cancelScoreJob('stop-me'), true); await assert.rejects(() => job, /aborted/); assert.equal(renderer.cancelScoreJob('stop-me'), false)
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(Buffer.alloc(1200, 7)) }
  })
  await check('ElevenLabs chunks preserve exact total, first-beat lead-in and long-section remainders', async () => {
    for (const duration of [5, 60, 121, 122, 300, 600]) for (const first of [0, 1, 2, 3, 4]) {
      const beats = [{ id: 'a', at: first, text: 'strings' }, { id: 'b', at: duration + 30, text: 'outside' }]
      const chunks = emit.emitScoreInput('eleven-music-v2', beats, { durationSec: duration }).input.composition_plan.chunks
      assert.equal(chunks.reduce((n, c) => n + c.duration_ms, 0), duration * 1000)
      assert.ok(chunks.every(c => c.duration_ms >= 3000 && c.duration_ms <= 120000)); assert.ok(!JSON.stringify(chunks).includes('outside'))
    }
    const beats = Array.from({ length: 35 }, (_, i) => ({ id: String(i), at: i * 10, text: 'beat' }))
    assert.throws(() => emit.emitScoreInput('eleven-music-v2', beats, { durationSec: 400 }), /at most 30/)
    const vocal = emit.emitScoreInput('eleven-music-v2', [], { durationSec: 10, isInstrumental: false, lyricsText: 'Exact words to sing' }).input
    assert.match(vocal.composition_plan.chunks[0].text, /Exact words to sing/)
  })
  await check('list 21: ElevenLabs Music v2.5 is the same door with the newer model id', async () => {
    assert.equal(emit.emitScoreInput('eleven-music-v25', [], { durationSec: 10 }).input.model_id, 'music_v2_5')
    assert.equal(emit.emitScoreInput('eleven-music-v25', [{ id: 'a', at: 0, text: 'strings' }], { durationSec: 10 }).input.model_id, 'music_v2_5')
    assert.equal(emit.emitScoreInput('eleven-music-v2', [{ id: 'a', at: 0, text: 'strings' }], { durationSec: 10 }).input.model_id, 'music_v2')
    const r = await call('render', { scoreClipId, engine: 'eleven-music-v25' }); assert.equal(r.ok, true, r.error)
    assert.equal(JSON.parse(fetches.findLast(f => f.url.includes('api.elevenlabs.io')).opts.body).model_id, 'music_v2_5')
  })
  await check('list 20: Lyria 3.5 composes on the Google key, in its own grammar', async () => {
    const e = emit.emitScoreInput('lyria-35', [{ id: 'a', at: 0, text: 'quiet strings' }, { id: 'b', at: 20, text: 'brass lift' }], { durationSec: 45, styleText: 'sparse analog synth score', isInstrumental: true }).input
    assert.deepEqual(e, { model: 'lyria-3.5', input: 'sparse analog synth score\nCreate a 0:45 piece (45 seconds), scored to a film edit.\nInstrumental only, no vocals.\n[0:00 - 0:20] quiet strings\n[0:20 - 0:45] brass lift', response_format: { type: 'audio', mime_type: 'audio/wav' } })
    assert.match(emit.emitScoreInput('lyria-35', [], { durationSec: 30, isInstrumental: false, lyricsText: '[Verse]\nExact words' }).input.input, /Use the following lyrics:\n\[Verse\]\nExact words$/)
    const song = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'lyrics' }, { type: 'audio', mime_type: 'audio/wav', data: Buffer.alloc(1200, 7).toString('base64') }] }] }
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(JSON.stringify(song)) }
    const before = inputs.length
    const r = await call('render', { scoreClipId, engine: 'lyria-35' }); assert.equal(r.ok, true, r.error)
    const sent = fetches.findLast(f => String(f.url).includes('generativelanguage'))
    assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions'); assert.equal(sent.opts.headers['x-goog-api-key'], 'fake-google')
    assert.equal(JSON.parse(sent.opts.body).model, 'lyria-3.5'); assert.equal(inputs.length, before, 'nothing went to fal')
    assert.match(r.file, /\.wav$/)
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I can’t make that song.' }] }] })) }
    assert.match((await call('render', { scoreClipId, engine: 'lyria-35' })).error, /Lyria returned no song \(completed\): I can’t make that song\./)
    settings.googleKey = ''; assert.match((await call('render', { scoreClipId, engine: 'lyria-35' })).error, /Google key/); settings.googleKey = 'fake-google'
    // pictures the music follows (list 20): the text first, then each picture as a shrunk JPEG; a picture
    // deleted from the Library since is skipped; ten at most; no other engine is sent them
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(JSON.stringify(song)) }
    const pic = n => { const f = path.join(tmp, n + '.png'); fs.writeFileSync(f, n); return f }
    const ids = []
    for (let i = 0; i < 12; i++) ids.push((await p.importImage(pic('pic' + i))).id)
    const before2 = score().recipe
    await p.setScoreClipData(scoreClipId, { recipe: { engine: 'lyria-35', options: { durationSec: 30, styleText: 'warm strings' }, imageIds: [ids[0], 'deleted-since', ...ids.slice(1)] } })
    const rp = await call('render', { scoreClipId, engine: 'lyria-35' }); assert.equal(rp.ok, true, rp.error)
    const body = JSON.parse(fetches.findLast(f => String(f.url).includes('generativelanguage')).opts.body)
    assert.equal(body.input.length, 11, 'the prompt and ten pictures')
    assert.deepEqual(body.input[0], { type: 'text', text: 'warm strings\nCreate a 0:30 piece (30 seconds), scored to a film edit.\nInstrumental only, no vocals.' })
    assert.deepEqual(body.input[1], { type: 'image', mime_type: 'image/jpeg', data: Buffer.from('jpeg90 1280x640').toString('base64') }, 'a big picture goes up as a 1280-wide JPEG')
    assert.ok(body.input.slice(1).every(b => b.type === 'image'))
    assert.deepEqual(score().takes.at(-1).snapshot.recipe.imageIds.length, 13, 'the take remembers the pictures it was asked with')
    const falBefore = inputs.length
    const re = await call('render', { scoreClipId, engine: 'minimax-music-3' }); assert.equal(re.ok, true, re.error)
    assert.ok(inputs.length === falBefore + 1 && !JSON.stringify(inputs.at(-1)).includes('image'), 'an engine that takes no pictures is sent none')
    await p.setScoreClipData(scoreClipId, { recipe: before2 })
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(Buffer.alloc(1200, 7)) }
  })
  const src = path.join(project.dir, 'source.mp4')
  ff(['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=24:d=1','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-y',src])
  project.clips = [{ id: 'clip', name: 'Visible', promptData: { duration: '2', beats: [], freeform: 'RECIPE' }, takes: [{ id: 'take', file: src, durationSec: 2 }] }]
  const tl = { id: 'tl', name: 'Cut', aspectRatio: '1:1', exportRes: '64', exportFps: '24', items: [{ id: 'blue', clipId: 'clip', startSec: 0, inSec: 1, outSec: 2 }, { id: 'red', clipId: 'clip', startSec: 1, inSec: 0, outSec: 1 }], scoreItems: [{ id: 'span-a', scoreClipId, startSec: 0, spanSec: 5 }, { id: 'span-b', scoreClipId, startSec: 1, spanSec: 7 }] }
  project.timelines = [tl]; project.activeTimelineId = tl.id
  await check('span routing rejects ambiguity and another score’s span', async () => {
    assert.throws(() => request.scoreSpan(project, { scoreClipId }), /several spans/)
    assert.throws(() => request.scoreSpan(project, { scoreClipId: 'other', scoreItemId: 'span-a' }), /belonging/)
    assert.equal(request.scoreSpan(project, { scoreClipId, scoreItemId: 'span-b' }).span.startSec, 1)
  })
  await check('Sonilo receives the selected trimmed span with its full duration, including the black tail', async () => {
    const r = await call('render', { scoreClipId, engine: 'sonilo', timelineId: 'tl', scoreItemId: 'span-b' }); assert.equal(r.ok, true, r.error)
    const file = path.join(tmp, 'uploaded.mp4'); fs.writeFileSync(file, uploads.at(-1))
    assert.ok(Math.abs((await exporter.probeFile(file)).duration - 7) < .1)
    const pixel = t => [...ff(['-v','error','-ss',String(t),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']).stdout]
    assert.ok(pixel(.25)[0] > 220); assert.ok(pixel(6).every(n => n < 15)); assert.equal(score().takes.at(-1).snapshot.recipe.options.durationSec, 7)
  })
  await check('list 22: sound effects — a sound-fx clip is a score clip of its own kind; Sonilo makes it from the span’s footage, ElevenLabs from words', async () => {
    // the two doors, as their pages document them
    assert.deepEqual(emit.emitScoreInput('sonilo-sfx', [], { durationSec: 7 }).input, { video_url: '(the rendered span video uploads here)', audio_format: 'wav' }, 'no words, no moments: the model listens to the footage by itself')
    assert.deepEqual(emit.emitScoreInput('sonilo-sfx', [{ id: 'a', at: 2, text: 'a door slams' }, { id: 'b', at: 4.5, text: '' }, { id: 'c', at: 6.99, text: 'too late to matter' }], { durationSec: 7, styleText: 'dry, close' }).input, {
      video_url: '(the rendered span video uploads here)', audio_format: 'wav', prompt: 'dry, close',
      segments: [{ start: 0, end: 2, prompt: 'dry, close' }, { start: 2, end: 4.5, prompt: 'a door slams' }, { start: 4.5, end: 6.95, prompt: 'dry, close' }]
    }, 'moments become segments: the first starts at 0, each ends where the next begins, the last ends inside the video')
    assert.equal(emit.emitScoreInput('sonilo-sfx', [], {}).endpoint, 'sonilo/v1.1/video-to-sound-effects')
    assert.deepEqual(emit.emitScoreInput('eleven-sfx', [{ id: 'a', at: 0, text: 'not sent' }], { styleText: ' a heavy door slams ', sfxSec: 99, promptInfluence: 0.7, loop: true }), { endpoint: 'elevenlabs:/v1/sound-generation', input: { text: 'a heavy door slams', model_id: 'eleven_text_to_sound_v2', duration_seconds: 30, prompt_influence: 0.7, loop: true } })
    assert.deepEqual(emit.emitScoreInput('eleven-sfx', [], { styleText: 'rain', sfxSec: 0 }).input, { text: 'rain', model_id: 'eleven_text_to_sound_v2' }, 'no length set = the model picks; their defaults are left alone')
    assert.throws(() => emit.emitScoreInput('eleven-sfx', [], {}), /write what the sound is/)
    // a sound-fx clip: its own kind, Sonilo by default, and the kind survives a duplicate and a take pulled out
    const { scoreClipId: fx } = await p.newScoreClip(undefined, 'sfx')
    const sfx = () => p.getProject().scoreClips.find(x => x.id === fx)
    assert.deepEqual([sfx().kind, sfx().recipe.engine, sfx().name], ['sfx', 'sonilo-sfx', 'sound 1'])
    assert.equal(score().kind, undefined, 'a score stays a score')
    const dupFx = await p.duplicateScoreClip(fx)
    assert.equal(p.getProject().scoreClips.find(x => x.id === dupFx.newScoreClipId).kind, 'sfx', 'a duplicate is a sound fx too')
    // from the footage: the span under the clip is rendered, uploaded, and its moments ride as segments
    const tlx = project.timelines.find(t => t.id === 'tl')
    ;(tlx.audioItems ??= []).push({ id: 'fx-span', lane: 1, source: { sfxId: fx }, startSec: 1, inSec: 0, outSec: 7 }) // v24: a sound fx is an A block
    await p.setScoreClipData(fx, { recipe: { engine: 'sonilo-sfx', options: { styleText: 'dry, close' } }, beats: [{ id: 'm', at: 3, text: 'a door slams' }] })
    const before = inputs.length, ups = uploads.length
    const r = await call('render', { scoreClipId: fx, engine: 'sonilo-sfx', timelineId: 'tl', scoreItemId: 'fx-span' }); assert.equal(r.ok, true, r.error)
    assert.equal(uploads.length, ups + 1, 'the span’s footage went up')
    assert.deepEqual(inputs.at(-1), { endpoint: 'sonilo/v1.1/video-to-sound-effects', input: { video_url: 'https://fixture.test/upload', audio_format: 'wav', prompt: 'dry, close', segments: [{ start: 0, end: 3, prompt: 'dry, close' }, { start: 3, end: 6.95, prompt: 'a door slams' }] } })
    assert.equal(inputs.length, before + 1); assert.equal(sfx().takes.length, 1); assert.equal(sfx().takes[0].engine, 'sonilo-sfx')
    assert.match((await call('render', { scoreClipId: fx, engine: 'sonilo-sfx', timelineId: 'tl', scoreItemId: 'span-b' })).error, /Select a span belonging to this score/, 'another clip’s span is never used')
    // from words: ElevenLabs' sound door, nothing to fal, no span needed
    await p.setScoreClipData(fx, { recipe: { engine: 'eleven-sfx', options: { styleText: 'a heavy door slams', sfxSec: 3 } } })
    const falBefore = inputs.length
    const rw = await call('render', { scoreClipId: fx, engine: 'eleven-sfx' }); assert.equal(rw.ok, true, rw.error)
    const sent = fetches.findLast(f => String(f.url).includes('api.elevenlabs.io'))
    assert.equal(sent.url, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'); assert.equal(sent.opts.headers['xi-api-key'], 'fake-eleven')
    assert.deepEqual(JSON.parse(sent.opts.body), { text: 'a heavy door slams', model_id: 'eleven_text_to_sound_v2', duration_seconds: 3 })
    assert.equal(inputs.length, falBefore, 'nothing went to fal'); assert.equal(sfx().takes.length, 2); assert.match(rw.file, /\.mp3$/)
    const rm = await call('render', { scoreClipId, engine: 'eleven-music-v25' }); assert.equal(rm.ok, true, rm.error)
    assert.ok(fetches.findLast(f => String(f.url).includes('api.elevenlabs.io')).url.startsWith('https://api.elevenlabs.io/v1/music?'), 'music still goes through the music door')
  })
  await check('list 24: a music ref — ACE-Step re-makes the track (cover), ElevenLabs leans every section on it; one strength dial', async () => {
    const REF = '(the reference track)'
    // no ref = nothing changes
    assert.ok(!('task_type' in emit.emitScoreInput('ace-step-1.5', [], { durationSec: 30 }).input))
    assert.ok(!JSON.stringify(emit.emitScoreInput('eleven-music-v25', [{ id: 'a', at: 0, text: 'strings' }], { durationSec: 10 }).input).includes('conditioning_ref'))
    // ACE-Step: their cover task, the track by its path, the dial = audio_cover_strength
    const ace = emit.emitScoreInput('ace-step-1.5', [], { durationSec: 30, styleText: 'jazz piano version' }, { musicRef: { sec: 200 } }).input
    assert.deepEqual([ace.task_type, ace.src_audio_path, ace.audio_cover_strength, ace.prompt, 'audio_duration' in ace], ['cover', REF, 0.8, 'jazz piano version', false], 'a ref with no dial touched keeps the tune (0.8); no length is sent — the track is the length')
    assert.equal(emit.emitScoreInput('ace-step-1.5', [], { musicRefStrength: 0 }, { musicRef: {} }).input.audio_cover_strength, 0.05, 'only the style = their loose end, never zero')
    assert.equal(emit.emitScoreInput('ace-step-1.5', [], { musicRefStrength: 1 }, { musicRef: {} }).input.audio_cover_strength, 1)
    // ElevenLabs: each section points at its own stretch of the track, from where he set the start
    const plan = o => emit.emitScoreInput('eleven-music-v25', [{ id: 'a', at: 0, text: 'soft' }, { id: 'b', at: 10, text: 'rise' }, { id: 'c', at: 25, text: 'peak' }], { durationSec: 40, musicRefFrom: 5, ...o }, { musicRef: { sec: 38 } }).input.composition_plan.chunks
    assert.deepEqual(plan({}).map(c => [c.duration_ms, c.conditioning_ref, c.condition_strength]), [
      [10000, { song_id: REF, range: { start_ms: 5000, end_ms: 15000 } }, 'xhigh'],
      [15000, { song_id: REF, range: { start_ms: 15000, end_ms: 30000 } }, 'xhigh'],
      [15000, { song_id: REF, range: { start_ms: 30000, end_ms: 38000 } }, 'xhigh']
    ], 'the last section stops where the track ends')
    assert.deepEqual([0, 0.3, 0.5, 0.74, 1].map(v => plan({ musicRefStrength: v })[0].condition_strength), ['low', 'medium', 'high', 'high', 'xhigh'], 'the dial maps onto their four strengths')
    const short = emit.emitScoreInput('eleven-music-v2', [{ id: 'a', at: 0, text: 'soft' }, { id: 'b', at: 20, text: 'rise' }], { durationSec: 40 }, { musicRef: { sec: 21 } }).input.composition_plan.chunks
    assert.deepEqual(short.map(c => !!c.conditioning_ref), [true, false], 'a section past the end of the track gets no ref')
    const bare = emit.emitScoreInput('eleven-music-v25', [], { durationSec: 12, styleText: 'strings' }, { musicRef: { sec: 60 } }).input
    assert.deepEqual([bare.composition_plan.chunks.length, bare.composition_plan.chunks[0].conditioning_ref.range, 'prompt' in bare], [1, { start_ms: 0, end_ms: 12000 }, false], 'no beats: one section carries the ref (their prompt form has no place for one)')
    assert.ok(!('task_type' in emit.emitScoreInput('minimax-music-3', [], {}, { musicRef: {} }).input), 'an engine that takes no track is never sent one')
    // the real handler: a Library track of 9 s
    const tone = path.join(tmp, 'theme.mp3'); ff(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=9', '-y', tone])
    const { importedIds: [trackId] } = await p.importAudioFiles([tone])
    const keep = score().recipe
    await p.setScoreClipData(scoreClipId, { recipe: { engine: 'ace-step-1.5', options: { durationSec: 10, styleText: 'jazz piano version', musicRefFrom: 2, musicRefStrength: 0.4 }, musicRefId: trackId } })
    const ra = await call('render', { scoreClipId, engine: 'ace-step-1.5' }); assert.equal(ra.ok, true, ra.error)
    const sentAce = locals.at(-1)
    assert.deepEqual([sentAce.task_type, sentAce.audio_cover_strength], ['cover', 0.4])
    assert.ok(path.isAbsolute(sentAce.src_audio_path) && fs.existsSync(sentAce.src_audio_path), 'ACE-Step gets a real file on this computer: ' + sentAce.src_audio_path)
    assert.ok(Math.abs((await exporter.probeFile(sentAce.src_audio_path)).duration - 7) < 0.3, 'cut from where he set the start to the end of the track (9 s − 2 s)')
    await p.setScoreClipData(scoreClipId, { recipe: { ...score().recipe, options: { ...score().recipe.options, musicRefFrom: 9 } } })
    assert.match((await call('render', { scoreClipId, engine: 'ace-step-1.5' })).error, /the reference track is 9s long — it cannot start at 9s/)
    // ElevenLabs: the track goes up once, its id rides every section
    const form = []
    global.fetch = async (url, opts) => {
      fetches.push({ url, opts })
      if (String(url).endsWith('/v1/music/upload')) { form.push(opts.body.get('file')); return new Response(JSON.stringify({ song_id: 'song_77' })) }
      return new Response(Buffer.alloc(1200, 7))
    }
    await p.setScoreClipData(scoreClipId, { recipe: { engine: 'eleven-music-v25', options: { durationSec: 8, styleText: 'strings' }, musicRefId: trackId }, beats: [] })
    const re = await call('render', { scoreClipId, engine: 'eleven-music-v25' }); assert.equal(re.ok, true, re.error)
    assert.deepEqual([form.length, form[0].name.endsWith('.mp3'), form[0].type], [1, true, 'audio/mpeg'], 'the track is uploaded as a file')
    const up = fetches.findLast(f => String(f.url).endsWith('/v1/music/upload')); assert.equal(up.opts.headers['xi-api-key'], 'fake-eleven')
    const sentPlan = JSON.parse(fetches.findLast(f => String(f.url).includes('/v1/music?')).opts.body).composition_plan.chunks
    assert.deepEqual(sentPlan.map(c => [c.conditioning_ref, c.condition_strength]), [[{ song_id: 'song_77', range: { start_ms: 0, end_ms: 8000 } }, 'xhigh']], 'its id replaces the placeholder')
    await call('render', { scoreClipId, engine: 'eleven-music-v25' })
    assert.equal(form.length, 1, 'the same track is not uploaded twice')
    // a refusal of the upload is said in their words, and nothing is composed
    const tone2 = path.join(tmp, 'other.mp3'); ff(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', '-y', tone2])
    const { importedIds: [track2] } = await p.importAudioFiles([tone2])
    await p.setScoreClipData(scoreClipId, { recipe: { ...score().recipe, musicRefId: track2 } })
    const composed = fetches.filter(f => String(f.url).includes('/v1/music?')).length
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return String(url).endsWith('/v1/music/upload') ? new Response(JSON.stringify({ detail: { message: 'Copyrighted content detected.' } }), { status: 422 }) : new Response(Buffer.alloc(1200, 7)) }
    assert.match((await call('render', { scoreClipId, engine: 'eleven-music-v25' })).error, /ElevenLabs 422 \(reference track\): Copyrighted content detected\./)
    assert.equal(fetches.filter(f => String(f.url).includes('/v1/music?')).length, composed, 'a refused track composes nothing')
    await p.setScoreClipData(scoreClipId, { recipe: { ...score().recipe, musicRefId: 'gone' } })
    assert.match((await call('render', { scoreClipId, engine: 'eleven-music-v25' })).error, /the reference track is gone from the Library/)
    await p.setScoreClipData(scoreClipId, { recipe: keep, beats: [{ id: 'a', at: 0, text: 'FIRST BEAT' }] })
    global.fetch = async (url, opts) => { fetches.push({ url, opts }); return new Response(Buffer.alloc(1200, 7)) }
  })
  await check('compose watches only one cut, honors selected span, updates duration and preserves existing beats', async () => {
    await p.setScoreClipData(scoreClipId, { beats: [], recipe: { engine: music, options: { styleText: 'STYLE GOVERNS', durationSec: 60 } } })
    const r = await call('compose', { scoreClipId, timelineId: 'tl', scoreItemId: 'span-b' }); assert.equal(r.ok, true, r.error)
    assert.equal(watched.length, 1); assert.equal(fs.existsSync(watched[0]), false); assert.equal(subcalls.length, 1)
    assert.match(subcalls[0].prompt, /STYLE GOVERNS/); assert.equal(score().recipe.options.durationSec, 7)
    const original = structuredClone(score().beats)
    const dup = await call('compose', { scoreClipId, timelineId: 'tl', scoreItemId: 'span-a' }); assert.equal(dup.ok, true, dup.error); assert.equal(dup.created, true)
    assert.deepEqual(score().beats, original); assert.equal(project.scoreClips.find(s => s.id === dup.scoreClipId).recipe.options.durationSec, 5)
  })
  await check('concurrent edits and project switches cannot receive stale composed beats', async () => {
    composeHook = async tasks => { if (tasks.some(t => t.id === 'synth')) await p.setScoreClipData(scoreClipId, { recipe: { engine: music, options: { styleText: 'NEW INTENT' } } }) }
    const r = await call('compose', { scoreClipId, scoreItemId: 'span-a' }); assert.equal(r.ok, false); assert.match(r.error, /score changed/)
    composeHook = async tasks => { if (tasks.some(t => t.id === 'synth')) await p.newProject(tmp, 'Other') }
    const r2 = await call('compose', { scoreClipId, scoreItemId: 'span-a' }); assert.equal(r2.ok, false); assert.equal(p.getProject().scoreClips.length, 0)
    composeHook = undefined
  })
  console.log('Score fixtures: ' + tmp)
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { global.fetch = originalFetch })
