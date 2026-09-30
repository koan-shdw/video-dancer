// Real score handlers, provider wire builder, project persistence and ffmpeg; no paid calls.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), { buildSync, transformSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-score-'))
const app = path.resolve(__dirname, '..'), shared = path.resolve(app, '../koan-shared/vidancer-ui/src/shared')
function load(file, mocks = {}) {
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', './runtime', ...Object.keys(mocks)] }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(n => mocks[n] ?? require(n), mod, mod.exports)
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
const source = fs.readFileSync(path.join(app, 'src/main/index.ts'), 'utf8')
// the handlers resolve the Co-Director's lane through index.ts's own claudeLane (list 14) — the real one rides along
const lane = source.slice(source.indexOf('function claudeLane('), source.indexOf('// when THIS engine core booted'))
const section = lane + source.slice(source.indexOf("  ipcMain.handle('score:render'"), source.indexOf("  ipcMain.handle('score:new'"))
const ctx = { ...p, ...request, ...emit, ...composer, ...pending, ...renderer, structuredClone, join: path.join, unlink: require('node:fs/promises').unlink,
  ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, loadSettings: async () => settings,
  safeSend: () => {}, observePendingWrite: (_dir, promise) => promise,
  resolveBridgeModel: () => 'bridge-model', resolveCodirModel: () => 'api-model', resolveVeniceModel: () => 'venice-model', VENICE_TAG: 'venice:', bridgeOneShot: () => {},
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
