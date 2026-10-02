// list 27 (2026-09-30) — the Co-Director's reach beyond clips and Image Gen: Clip Gen's dials, takes,
// Score and sound fx, Voice, the audio and score tracks of a timeline, Library housekeeping, and
// the renders whose recipe rides the fire_render call (a score, a voice, an image edit, a video
// edit). The real runTool against a real project on disk; the window that queues a fired render
// is a stand-in, so nothing renders and nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-reach-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, setExchangeKeys, setFireDoor, liveDetail, buildCoreContext, buildContext, TOOLS } from '${main}/codir'; export { newProject, getProject, importImage, importAudioFiles, importVideoFiles, addTake, addScoreTake, addVoiceTake, appendEditNodes, emptyPromptData } from '${main}/project'; export { buildSystemGuides } from '${main}/guides'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const ff = (args) => { const r = spawnSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', ...args]); assert.equal(r.status, 0, String(r.stderr)) }
  const run = (name, input) => m.runTool(name, input, () => {})
  const id = (s, key) => { const hit = s.match(new RegExp(key + '=([\\w-]+)')); assert.ok(hit, s); return hit[1] }
  const P = () => m.getProject()

  // ---- a project with a bit of everything ----
  await m.newProject(tmp, 'Reach')
  m.setExchangeDir(P().dir)
  const png = (n) => { const f = path.join(tmp, n + '.png'); fs.writeFileSync(f, n); return f }
  const hero = await m.importImage(png('hero')), city = await m.importImage(png('city'))
  await run('rename_image', { image_id: hero.id, new_title: 'hero' })
  await run('rename_image', { image_id: city.id, new_title: 'city' })
  const tone = path.join(tmp, 'line.mp3'); ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-y', tone])
  const vidf = path.join(tmp, 'plate.mp4'); ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=6', '-pix_fmt', 'yuv420p', '-y', vidf])
  const [audioId] = (await m.importAudioFiles([tone])).importedIds
  const [videoId] = (await m.importVideoFiles([vidf])).importedIds
  const audioTitle = P().audio.find((a) => a.id === audioId).title, videoTitle = P().videos.find((v) => v.id === videoId).title
  const clipId = id(await run('create_clip', { name: 'Rooftop' }), 'clip_id')
  await run('set_clip_fields', { clip_id: clipId, engine: 'seedance25', duration: '6' })
  await run('set_beats', { clip_id: clipId, beats: [{ name: 'a', length: 3, camera: 'c', action: 'a', lighting: 'l' }, { name: 'b', length: 3, camera: 'c', action: 'a', lighting: 'l' }] })
  const clip = () => P().clips.find((c) => c.id === clipId)
  for (const n of [1, 2]) await m.addTake({ clipId, name: 'Rooftop', promptData: clip().promptData, takeFile: vidf, durationSec: 6 })

  // ---- the tools are on its list, each with a description it can act on ----
  const names = m.TOOLS.map((t) => t.name)
  for (const t of ['set_clip_settings', 'set_take_flags', 'delete_take', 'clip_from_take', 'clips_from_images', 'create_score', 'set_score', 'create_voice', 'set_voice', 'delete_item', 'set_timeline_audio', 'set_timeline_scores', 'set_timeline_output', 'set_image_primary', 'set_assembly_outline']) assert.ok(names.includes(t), t)
  assert.equal(new Set(names).size, names.length, 'no tool is listed twice')
  assert.ok(m.TOOLS.every((t) => t.description.length > 40 && t.input_schema.type === 'object'))

  // ---- Clip Gen's dials ----
  assert.match(await run('set_clip_settings', { clip_id: clipId, resolution: '4k' }), /^ERROR: Seedance 2\.5 makes 480p \/ 720p \/ 1080p — not 4k/)
  assert.match(await run('set_clip_settings', { clip_id: clipId, aspect_ratio: '2:1' }), /^ERROR: Seedance 2\.5 takes aspect .* — not 2:1/)
  assert.equal(await run('set_clip_settings', { clip_id: 'Rooftop', resolution: '1080p', aspect_ratio: '9:16', sound: false, negative: ' blur ', draft: true }), '"Rooftop" dials: resolution 1080p, aspect 9:16, sound off, negative, draft on')
  assert.deepEqual([clip().promptData.resolution, clip().promptData.aspectRatio, clip().promptData.generateAudio, clip().promptData.negative, clip().promptData.draft], ['1080p', '9:16', false, 'blur', true])
  assert.match(await run('set_clip_settings', { clip_id: clipId, start_frame: '@hero' }), /^ERROR: a start frame belongs to i2v/)
  assert.match(await run('set_clip_settings', { clip_id: clipId, mode: 'i2v', start_frame: 'hero', end_frame: '@city' }), /mode i2v, start frame hero, end frame @city/)
  assert.deepEqual([clip().promptData.mode, clip().promptData.imageIds, clip().promptData.endImageId], ['i2v', [hero.id], city.id])
  await run('set_clip_settings', { clip_id: clipId, mode: 'ref2v', end_frame: null })
  assert.equal(clip().promptData.endImageId, undefined)
  const refs = await run('set_clip_settings', { clip_id: clipId, video_refs: [{ video: videoTitle, in_sec: 1, out_sec: 3 }, { clip: 'Rooftop', take: 2 }], audio_refs: [{ audio: audioTitle, in_sec: 0, out_sec: 5 }] })
  assert.match(refs, /2 video refs, 1 audio ref$/)
  assert.deepEqual(clip().promptData.videoRefs, [{ videoId, inSec: 1, outSec: 3 }, { takeRef: { clipId, takeId: clip().takes[1].id } }])
  assert.deepEqual(clip().promptData.audioRefs, [{ audioId, inSec: 0, outSec: 5 }])
  assert.match(await run('set_clip_settings', { clip_id: clipId, video_refs: [{ video: 'nope' }] }), /^ERROR: no Library video nope/)
  assert.match(await run('set_clip_settings', { clip_id: clipId, loras: [{ name: 'Pan', weight: 5 }], loras_on: true }), /NOTE: Seedance 2\.5 takes no loras \(the local video engines do\) — kept, not sent/)
  assert.deepEqual(clip().promptData.loras, [{ name: 'Pan', weight: 2 }], 'a weight past the dial is held at its end')
  const other = id(await run('create_clip', { name: 'Street' }), 'clip_id')
  await run('set_clip_settings', { clip_id: clipId, prompt_link: { clip: 'Street', pos: 'after' }, beat_pictures: [{ beat: 2, image: '@city' }] })
  assert.deepEqual([clip().promptData.promptLink, clip().promptData.beats[1].refImageId, clip().promptData.beats[0].refImageId], [{ clipId: other, pos: 'after' }, city.id, undefined])
  assert.match(await run('set_clip_settings', { clip_id: clipId, beat_pictures: [{ beat: 9, image: '@city' }] }), /has 2 beats — no beat 9/)
  assert.match(await run('set_clip_settings', { clip_id: clipId, prompt_link: { clip: 'Rooftop' } }), /needs another clip/)
  await run('set_clip_fields', { clip_id: other, engine: 'seedance2' })
  assert.match(await run('set_clip_settings', { clip_id: other, draft: true }), /NOTE: Seedance 2 has no draft mode/)
  assert.equal(await run('set_clip_settings', { clip_id: clipId }), 'nothing to change')

  // ---- takes ----
  assert.equal(await run('set_take_flags', { kind: 'clip', id: clipId, take: 2, color: '#e05656', disabled: true }), '"Rooftop" take 2: colour #e05656, disabled')
  assert.deepEqual([clip().takes[1].color, clip().takes[1].disabled], ['#e05656', true])
  assert.match(await run('set_take_flags', { kind: 'clip', id: clipId, take: 7, disabled: true }), /has 2 takes — no take 7/)
  const branched = id(await run('clip_from_take', { clip_id: clipId, take: 1 }), 'clip_id')
  assert.equal(P().clips.find((c) => c.id === branched).takes.length, 1)
  assert.match(await run('delete_take', { clip_id: clipId, take: 2 }), /removed take 2 of "Rooftop"/)
  assert.equal(clip().takes.length, 1)
  assert.ok(fs.existsSync(vidf), 'the file stays on disk')
  const made = await run('clips_from_images', { image_titles: ['@hero', 'city'] })
  assert.match(made, /^created 2 clips/)
  assert.match(await run('clips_from_images', { image_titles: ['@ghost'] }), /^ERROR: no Library image @ghost/)

  // ---- score and sound fx ----
  const scoreId = id(await run('create_score', { name: 'Theme' }), 'score_id')
  const fxId = id(await run('create_score', { name: 'Door', kind: 'sound_fx' }), 'score_id')
  const score = (i = scoreId) => P().scoreClips.find((s) => s.id === i)
  assert.deepEqual([score().kind, score(fxId).kind, score(fxId).recipe.engine], [undefined, 'sfx', 'sonilo-sfx'])
  assert.match(await run('set_score', { score_id: scoreId, model: 'eleven-sfx' }), /^ERROR: ElevenLabs Sound Effects \(from words\) is a sound fx model — "Theme" is a score/)
  assert.match(await run('set_score', { score_id: fxId, model: 'lyria-35' }), /is a music model — "Door" is a sound fx/)
  const wrote = await run('set_score', { score_id: 'Theme', model: 'eleven-music-v25', style: 'slow strings', instrumental: false, lyrics: '[verse]\nhold on', length_sec: 40, beats: [{ at: 10, text: 'rise' }, { at: 0, text: 'soft' }], music_ref: audioTitle, music_ref_strength: 0.3, pictures: ['@hero'] })
  assert.match(wrote, /^"Theme": model ElevenLabs Music v2\.5, style, lyrics, sings, length 40s, music ref strength, music ref .*, 1 picture, 2 beats\nNOTE: ElevenLabs Music v2\.5 takes no pictures — kept, not sent$/)
  assert.deepEqual([score().recipe.engine, score().recipe.options.styleText, score().recipe.options.isInstrumental, score().recipe.options.durationSec, score().recipe.musicRefId, score().recipe.imageIds, score().beats.map((b) => [b.at, b.text])], ['eleven-music-v25', 'slow strings', false, 40, audioId, [hero.id], [[0, 'soft'], [10, 'rise']]])
  await run('set_score', { score_id: fxId, model: 'eleven-sfx', style: 'a heavy door slams', sound_length_sec: 3, loop: true, follow_words: 0.9 })
  assert.deepEqual(score(fxId).recipe, { engine: 'eleven-sfx', options: { styleText: 'a heavy door slams', sfxSec: 3, loop: true, promptInfluence: 0.9 } })
  const readScore = await run('read_object', { id: 'Theme' })
  assert.match(readScore, /^SCORE "Theme" \(score_id=/)
  assert.ok(readScore.includes('style: slow strings') && readScore.includes('at 10s: rise') && readScore.includes(`music ref: "${audioTitle}" from 0s · strength 0.3`) && readScore.includes('SINGS'), readScore)
  assert.match(await run('read_object', { id: fxId }), /^SOUND FX "Door"[\s\S]*sound length: 3s · loop on · follow the words 0\.9/)
  for (const n of [1, 2]) await m.addScoreTake(scoreId, { file: tone, engine: 'eleven-music-v25', durationSec: 12 })
  assert.equal(await run('set_keeper_take', { score_id: scoreId, take: 1 }), 'keeper on "Theme" is now take 1')
  assert.equal(score().keeperTakeId, score().takes[0].id)
  assert.equal(await run('set_take_flags', { kind: 'score', id: 'Theme', take: 2, disabled: true }), '"Theme" take 2: disabled')
  assert.equal(await run('rename_item', { kind: 'score', id: scoreId, name: 'Main theme' }), 'renamed score "Theme" → "Main theme"')
  const dupScore = id(await run('duplicate_item', { kind: 'score', id: scoreId }), 'score_id')
  assert.equal(score(dupScore).recipe.engine, 'eleven-music-v25')

  // ---- voice ----
  const kai = id(await run('create_voice', { name: 'Kai' }), 'voice_id'), mira = id(await run('create_voice', { name: 'Mira' }), 'voice_id')
  const voice = (i = kai) => P().voiceClips.find((v) => v.id === i)
  const vw = await run('set_voice', { voice_id: kai, model: 'gemini-38-tts', description: 'low and dry', test_line: 'Kai: Take this away.\nMira: No.', image: '@hero', sample: audioTitle, consent: audioTitle, ready_voice: 'Kore', style: 'slow', second_speaker: 'Mira' })
  assert.equal(vw, 'voice "Kai": model Gemini 3.8 Flash TTS, description, test line, image, sample, consent clip, ready voice Kore, style, second speaker Mira')
  assert.deepEqual(voice().recipe, { engine: 'gemini-38-tts', desc: 'low and dry', testLine: 'Kai: Take this away.\nMira: No.', imageId: hero.id, refAudioId: audioId, consentAudioId: audioId, options: { voice: 'Kore', style: 'slow', voice2: `clip:${mira}`, voice2Name: '' } })
  assert.match(await run('set_voice', { voice_id: kai, second_speaker: 'Kai' }), /the second speaker has to be another voice/)
  await run('set_voice', { voice_id: kai, second_speaker: null, sample: null, consent: null })
  assert.deepEqual([voice().recipe.options.voice2, voice().recipe.refAudioId, voice().recipe.consentAudioId], [undefined, undefined, undefined])
  assert.match(await run('read_object', { id: 'Kai' }), /^VOICE "Kai"[\s\S]*description: low and dry[\s\S]*ready voice: Kore · style: slow/)
  await m.addVoiceTake(kai, { file: tone, engine: 'gemini-38-tts', durationSec: 5 })
  assert.equal(await run('set_keeper_take', { voice_id: 'Kai', take: 1 }), 'keeper on "Kai" is now take 1 — that take IS the voice now')
  assert.equal(await run('rename_item', { kind: 'voice', id: mira, name: 'Mira V2' }), 'renamed voice "Mira" → "Mira V2"')

  // ---- the timeline's sound ----
  const tl = () => P().timelines.find((t) => t.id === P().activeTimelineId)
  await run('set_timeline_clips', { timeline_id: tl().id, items: [{ clip: clipId }] })
  const a1 = await run('set_timeline_audio', { timeline_id: tl().name, items: [{ audio: audioTitle, start_sec: 2, track: 1, in_sec: 1, out_sec: 6, gain: 0.5, fade_out_sec: 1 }, { audio: audioTitle, start_sec: 0, track: 5 }] })
  assert.equal(a1, `timeline "${tl().name}": 2 Library audio blocks (A1 @2.0s, A5 @0.0s)`)
  const blocks = () => tl().audioItems.filter((x) => 'audioId' in x.source)
  assert.deepEqual(blocks().map((x) => [x.lane, x.startSec, x.inSec, Math.round(x.outSec), x.gain, x.fadeOutSec]), [[0, 2, 1, 6, 0.5, 1], [4, 0, 0, 12, undefined, undefined]])
  assert.equal(tl().audioTracks, 5, 'a fifth track is made for it')
  const keptId = blocks()[0].id
  await run('set_timeline_audio', { timeline_id: tl().id, items: [{ audio: audioTitle, start_sec: 2, track: 1, in_sec: 1, out_sec: 4 }] })
  assert.deepEqual([blocks().length, blocks()[0].id, blocks()[0].outSec, blocks()[0].gain], [1, keptId, 4, 0.5], 'the same block sent again is the same block; the rest are gone')
  assert.match(await run('set_timeline_audio', { timeline_id: tl().id, items: [{ audio: 'ghost', start_sec: 0 }] }), /^ERROR: no Library audio ghost/)
  // v24 (his 10-02: "of course theyre clip effect not score"): music on the S tracks, sound fx on the A tracks
  assert.match(await run('set_timeline_scores', { timeline_id: tl().id, items: [{ score: 'Door', start_sec: 1, span_sec: 3 }] }), /^ERROR: "Door" is a sound fx: it goes on the audio tracks \(set_timeline_audio with sound_fx\)/)
  const s1 = await run('set_timeline_scores', { timeline_id: tl().id, items: [{ score: 'Main theme', start_sec: 0, span_sec: 6 }] })
  assert.equal(s1, `timeline "${tl().name}": 1 score block (S1 0.0–6.0s)`)
  assert.deepEqual(tl().scoreItems.map((x) => [x.scoreClipId, x.lane ?? 0, x.startSec, x.spanSec, x.gain]), [[scoreId, 0, 0, 6, undefined]])
  const fx1 = await run('set_timeline_audio', { timeline_id: tl().id, items: [{ audio: audioTitle, start_sec: 2, track: 1, in_sec: 1, out_sec: 4 }, { sound_fx: 'Door', start_sec: 1, span_sec: 3, track: 2, gain: 1.5 }] })
  assert.equal(fx1, `timeline "${tl().name}": 1 Library audio block, 1 sound fx block (A1 @2.0s, A2 @1.0s)`)
  const fxBlock = () => tl().audioItems.filter((x) => 'sfxId' in x.source)
  assert.deepEqual(fxBlock().map((x) => [x.source.sfxId, x.lane, x.startSec, x.outSec - x.inSec, x.gain]), [[fxId, 1, 1, 3, 1.5]])
  assert.equal(blocks()[0].id, keptId, 'the Library block sent again beside it is still the same block')
  assert.match(await run('set_timeline_audio', { timeline_id: tl().id, items: [{ sound_fx: 'Main theme', start_sec: 0, span_sec: 2 }] }), /^ERROR: no sound fx Main theme/)
  assert.match(await run('set_timeline_scores', { timeline_id: tl().id, items: [{ score: 'Main theme', start_sec: 0, span_sec: 6 }, { score: 'Main theme', start_sec: 4, span_sec: 3 }] }), /^ERROR: two blocks overlap on S1/)
  assert.equal(tl().scoreItems.length, 1, 'a refused write changes nothing')
  assert.equal(await run('set_timeline_output', { timeline_id: tl().id, export_res: '1080', export_quality: 'high', music_muted: true }), `timeline "${tl().name}": exportRes 1080, exportQuality high, musicMuted true`)
  assert.deepEqual([tl().exportRes, tl().exportQuality, tl().musicMuted], ['1080', 'high', true])

  // ---- the index carries all of it, one line each ----
  const index = m.buildCoreContext(P(), null, null)
  for (const line of ['## Scores and sound fx', '- score "Main theme" id=', '- sound fx "Door" id=', '## Voices', '- voice "Kai" id=', '## Library audio', '## Library videos', '## Timeline sound', 'S1 "Main theme" 0.0–6.0s', 'A2 sound fx "Door" 1.0–4.0s']) assert.ok(index.includes(line), line + '\n' + index)
  assert.ok(m.buildContext(P(), null, null).includes('## Timeline sound'))

  // ---- Library housekeeping ----
  assert.equal(await run('rename_item', { kind: 'audio', id: audioTitle, name: 'line 04' }), `renamed audio "${audioTitle}" → "line 04"`)
  assert.equal(await run('rename_item', { kind: 'video', id: videoId, name: 'plate A' }), `renamed video "${videoTitle}" → "plate A"`)
  assert.match(await run('duplicate_item', { kind: 'image', id: '@hero' }), /^duplicated @hero → image_id=/)
  const folder = id(await run('create_folder', { kind: 'score', name: 'Cues' }), 'folder_id')
  assert.equal(P().folders.find((f) => f.id === folder).kind, 'score')
  assert.equal(await run('move_to_folder', { kind: 'score', item_ids: [scoreId], folder_id: folder }), 'moved 1 score item')
  assert.equal(score().folder, folder)
  assert.match(await run('read_object', { id: 'line 04' }), /^LIBRARY AUDIO "line 04"/)

  // ---- Image Edit's tree: which edit is the image's face ----
  assert.match(await run('set_image_primary', { image: '@city', edit: 1 }), /@city has no edits yet/)
  await m.appendEditNodes({ rootImageId: city.id, parentId: null, files: [png('night'), png('rain')], prompt: 'make it night', refIds: [], model: 'nano-banana-pro' })
  assert.match(await run('read_object', { id: '@city' }), /edits \(2 — set_image_primary picks the face; 0 = the original, which is the face now\):\n  1\. Nano Banana Pro · "make it night"/)
  assert.equal(await run('set_image_primary', { image: '@city', edit: 2 }), '@city now shows edit 2 everywhere it is used')
  assert.match(await run('read_object', { id: '@city' }), /2\. ◉ PRIMARY · /)
  assert.equal(await run('set_image_primary', { image: '@city', edit: 0 }), '@city now shows the original everywhere it is used')
  assert.match(await run('set_image_primary', { image: '@city', edit: 9 }), /has 2 edits — no edit 9/)

  // ---- FIRING what has no panel form: gated like every render, and the job is the panel's own ----
  const queued = []
  m.setFireDoor(async (req) => (queued.push(req), { ok: true, line: 'queued → watch the Queue panel' }))
  const go = () => m.setExchangeKeys({ fire: true, userText: 'go' })
  m.setExchangeKeys({ fire: true, userText: 'render the theme' })
  assert.match(await run('fire_render', { kind: 'score', id: scoreId }), /^ERROR: no go\./)
  m.setExchangeKeys({ fire: false, userText: 'go' })
  assert.match(await run('fire_render', { kind: 'image_edit', image: '@hero', prompt: 'x' }), /^ERROR: rendering for the director is switched off/)
  assert.deepEqual(queued, [])
  go()
  // a score: the saved recipe and beats, and its one span
  assert.equal(await run('fire_render', { kind: 'score', id: 'Main theme' }), 'fired the score "Main theme": queued → watch the Queue panel')
  let job = queued.at(-1).job
  assert.deepEqual([queued.at(-1).kind, job.kind, job.label, job.engineLabel, job.payload.scoreClipId, job.payload.engine, job.payload.scoreItemId, job.payload.snapshot.recipe.options.styleText], ['job', 'score', 'Main theme', 'ElevenLabs Music v2.5 · via ElevenLabs', scoreId, 'eleven-music-v25', tl().scoreItems[0].id, 'slow strings'])
  // a sound fx made from footage needs its span; from words it needs the words
  await run('set_score', { score_id: fxId, model: 'sonilo-sfx' })
  await run('set_timeline_scores', { timeline_id: tl().id, items: [{ score: 'Main theme', start_sec: 0, span_sec: 6 }] })
  await run('set_timeline_audio', { timeline_id: tl().id, items: [{ audio: 'line 04', start_sec: 2, track: 1, in_sec: 1, out_sec: 4 }] }) // the Door blocks off the A tracks
  assert.match(await run('fire_render', { kind: 'score', id: fxId }), /^ERROR: "Door" is made from footage: put it on the timeline on screen first \(set_timeline_audio, sound_fx\)/)
  await run('set_timeline_audio', { timeline_id: tl().id, items: [{ sound_fx: 'Door', start_sec: 0, span_sec: 2, track: 2 }, { sound_fx: 'Door', start_sec: 3, span_sec: 2, track: 2 }] })
  assert.match(await run('fire_render', { kind: 'score', id: fxId }), /^ERROR: "Door" has 2 spans on the timeline on screen — say which/)
  assert.match(await run('fire_render', { kind: 'score', id: fxId, span: 2 }), /^fired the sound fx "Door"/)
  assert.equal(queued.at(-1).job.payload.scoreItemId, fxBlock()[1].id, 'its render aims at the second A block')
  await run('set_score', { score_id: fxId, model: 'eleven-sfx', style: '' })
  assert.match(await run('fire_render', { kind: 'score', id: fxId }), /^ERROR: "Door" has no words yet/)
  // a voice
  assert.equal(await run('fire_render', { kind: 'voice', id: 'Kai' }), 'fired the voice "Kai": queued → watch the Queue panel')
  assert.deepEqual(queued.at(-1).job, { kind: 'voice', label: 'Kai', engineLabel: 'Gemini 3.8 Flash TTS · via Google', payload: { voiceClipId: kai, engine: 'gemini-38-tts' } })
  assert.match(await run('fire_render', { kind: 'voice', id: mira }), /^ERROR: voice "Mira V2" has no test line/)
  // an image edit: the recipe rides the call
  assert.match(await run('fire_render', { kind: 'image_edit', image: '@hero', prompt: 'make it night', refs: ['@city'], model: 'nano-banana-pro', variants: 2 }), /^fired the image edit of @hero/)
  job = queued.at(-1).job
  assert.deepEqual([job.kind, job.label, job.engineLabel, job.payload.rootImageId, job.payload.parentNodeId, job.payload.prompt, job.payload.refIds, job.payload.numImages, job.payload.model, job.payload.via], ['image', '@hero · image edit', 'Nano Banana Pro', hero.id, null, 'make it night', [city.id], 2, 'nano-banana-pro', 'fal'])
  assert.ok(job.estCost > 0, 'two images are priced')
  assert.match(await run('fire_render', { kind: 'image_edit', prompt: 'a red door in fog' }), /^fired the image edit of a new image/)
  assert.equal(queued.at(-1).job.payload.rootImageId, '')
  assert.match(await run('fire_render', { kind: 'image_edit', image: '@hero' }), /^ERROR: an image edit needs a prompt/)
  assert.match(await run('fire_render', { kind: 'image_edit', image: '@ghost', prompt: 'x' }), /^ERROR: no Library image @ghost/)
  assert.match(await run('fire_render', { kind: 'image_edit', image: '@hero', prompt: 'x', model: 'nano-banana-pro', aspect: '7:3' }), /^ERROR: Nano Banana Pro takes aspect .* — not 7:3/)
  // a video edit: a true edit takes words, a lip-sync takes the voice
  const before = queued.length
  assert.match(await run('fire_render', { kind: 'video_edit', id: clipId, engine: 'omniflash11' }), /^ERROR: a video edit needs a prompt/)
  assert.match(await run('fire_render', { kind: 'video_edit', id: clipId, engine: 'sync3' }), /^ERROR: sync-3 matches the mouths to a sound/)
  assert.match(await run('fire_render', { kind: 'video_edit', video: 'plate A', engine: 'omniflash11', prompt: 'x', in_sec: 0, out_sec: 0 }), /^fired the edit of plate A/, 'a window that is no window = the whole video (6 s fits)')
  assert.equal(queued.length, before + 1)
  assert.match(await run('fire_render', { kind: 'video_edit', id: clipId, engine: 'sync3', voice: 'Kai', sync_mode: 'loop', in_sec: 1, out_sec: 4 }), /^fired the lip-sync of Rooftop · T1/)
  job = queued.at(-1).job
  assert.deepEqual([job.kind, job.label, job.engineLabel, job.payload], ['vedit', 'Rooftop · T1 · lip-sync', 'sync-3', { engine: 'sync3', prompt: 'lip-sync to Kai', root: { takeRef: { clipId, takeId: clip().takes[0].id } }, parentId: null, inSec: 1, outSec: 4, lipAudio: { voiceId: kai }, syncMode: 'loop' }])
  assert.ok(Math.abs(job.estCost - 3 * 8 / 60) < 1e-9, '3 s at $8 a minute')
  assert.match(await run('fire_render', { kind: 'video_edit', id: clipId, engine: 'nope', prompt: 'x' }), /^ERROR: no such video edit engine nope/)

  // ---- deletes that can be undone are its to make when asked; the rest are not on its list ----
  assert.equal(await run('delete_item', { kind: 'score', id: dupScore }), 'deleted score "Main theme ·copy" (its timeline blocks went with it; the director can undo)')
  assert.equal(await run('delete_item', { kind: 'voice', id: mira }), 'deleted voice "Mira V2" (the director can undo)')
  assert.match(await run('delete_item', { kind: 'image', id: '@hero' }), /^ERROR: kind must be score or voice/)
  assert.ok(!names.some((n) => /^(undo|redo|delete_image|delete_image_gen|import_(image|audio|video|file)|export_)/.test(n)), 'no undo, no file deletes, no file pickers')

  // ---- the live card, and the assembly outline ----
  assert.deepEqual(m.liveDetail('set_score', { score_id: scoreId, style: 'slow strings', beats: [{ at: 0, text: 'x' }] }), { tool: 'set_score', target: 'score "Main theme"', fields: [{ path: 'style', snippet: 'slow strings' }, { path: 'beats', snippet: '1 item' }] })
  assert.equal(m.liveDetail('set_clip_settings', { clip_id: clipId, resolution: '720p' }).target, 'clip "Rooftop"')
  assert.match(await run('set_assembly_outline', { outline: '1. rooftop\n2. street', locked: true }), /^assembly outline: written, locked/)
  assert.deepEqual([P().assembly.outline, P().assembly.locked], ['1. rooftop\n2. street', true])
  const guides = JSON.stringify(await m.buildSystemGuides({}))
  for (const word of ['CLIP GEN', 'SCORE and SOUND FX', 'TIMELINE SOUND', 'IMAGE EDIT and the VIDEO EDITOR']) assert.ok(guides.includes(word), word)

  console.log('PASS the Co-Director’s reach: Clip Gen’s dials (refused when the engine can’t, told when kept but not sent), takes, scores and sound fx, voices, Library audio and scores on a timeline’s tracks, housekeeping; a score, a voice, an image edit and a video edit fire through the same two gates with the job their panel would queue; undo, file deletes and file pickers are not on its list')
})().catch((e) => { console.error(e); process.exitCode = 1 })
