// list 18 + 19 (2026-09-30) — the Voice card's direct suppliers (voiceRender.ts): Gemini 3.8 TTS on
// the Google key and Eleven v4 on the ElevenLabs key. A voice designed from the description (or
// cloned from the sample on ElevenLabs), a ready voice picked instead, the requests each supplier
// documents, their errors said plainly, the Queue's cancel. Network mocked: nothing is spent and no
// voice is created in any account.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-voice-direct-'))
const code = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/main/voiceRender.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', './runtime', 'ffmpeg-static', 'electron'], logLevel: 'silent' }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + code + '\n})')((n) => (n === '@fal-ai/client' ? { fal: { config: () => { throw Error('fal must not be touched on a direct supplier') } } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
const { runVoiceRender, cancelVoiceJob, elevenVoices, googleVoices } = mod.exports

const AUDIO = Buffer.alloc(4000, 1)
const calls = []
let script = {}
global.fetch = async (url, init = {}) => {
  const u = String(url).replace('https://generativelanguage.googleapis.com/v1beta', 'G').replace('https://api.elevenlabs.io', 'E')
  const where = u.split('?')[0]
  const form = init.body instanceof FormData
  calls.push({ where, url: u, headers: init.headers, form, body: form ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size }])) : init.body ? JSON.parse(init.body) : undefined })
  const key = Object.keys(script).find((k) => where === k || (k.endsWith('*') && where.startsWith(k.slice(0, -1))))
  const a = key ? script[key](calls.at(-1), init) : { status: 404, json: { error: { message: 'no script for ' + where } } }
  if (a instanceof Promise) return a
  if (a.bytes) return new Response(a.bytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  return new Response(JSON.stringify(a.json), { status: a.status ?? 200 })
}
const of = (where) => calls.filter((c) => c.where === where || (where.endsWith('*') && c.where.startsWith(where.slice(0, -1))))
const spoken = { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: AUDIO.toString('base64') }] }] } }
const g = { engine: 'gemini-38-tts', mode: 'design', text: 'You came here <short pause> looking for a warrior.', desc: 'A low, gravelled elder', options: { style: 'slow and dry' }, googleKey: 'gk', name: 'Elder', outDir: tmp }
const e = { engine: 'eleven-v4', mode: 'design', text: 'You came here looking for a warrior.', desc: 'A low, gravelled elder with a dry wit', options: {}, elevenKey: 'ek', name: 'Elder', outDir: tmp }

;(async () => {
  // ---- Gemini: a voice designed from the description, then the line spoken in it ----
  script = { 'G/voices': () => ({ json: { id: 'voice_abc', sample_audio: { mime_type: 'audio/wav', data: '' } } }), 'G/interactions': () => spoken }
  const r = await runVoiceRender(g)
  assert.deepEqual(of('G/voices')[0].body, { store: true, voice: { model: 'gemini-3.8-flash-tts', type: 'prompted', display_name: 'Elder', prompted: { input: 'A low, gravelled elder' } } })
  assert.equal(of('G/voices')[0].headers['x-goog-api-key'], 'gk')
  assert.deepEqual(of('G/interactions')[0].body, {
    model: 'gemini-3.8-flash-tts',
    input: [{ type: 'user_input', content: [{ type: 'text', text: 'You came here <short pause> looking for a warrior.', annotations: [{ type: 'speech_metadata', style: 'slow and dry' }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: 'voice_abc' }] }
  }, 'the text is the verbatim transcript; the style rides beside it, never in it')
  assert.equal(r.voiceId, 'voice_abc')
  assert.match(r.file, /\.wav$/)
  assert.ok(fs.readFileSync(r.file).equals(AUDIO))
  // a ready voice (or the kept one): no design call; no style = no annotation
  calls.length = 0
  await runVoiceRender({ ...g, engine: 'gemini-38-lite-tts', voice: 'Kore', desc: undefined, options: {} })
  assert.equal(of('G/voices').length, 0, 'a picked voice designs nothing')
  assert.deepEqual(of('G/interactions')[0].body.input[0].content[0], { type: 'text', text: g.text })
  assert.equal(of('G/interactions')[0].body.model, 'gemini-3.8-flash-lite-tts')
  assert.deepEqual(of('G/interactions')[0].body.generation_config, { speech_config: [{ voice: 'Kore' }] })
  await assert.rejects(runVoiceRender({ ...g, desc: '  ' }), /describe the voice first, or pick one of Gemini 3\.8 Flash TTS’s voices/)
  script = { 'G/voices': () => ({ status: 403, json: { error: { message: 'API key not valid.' } } }) }
  await assert.rejects(runVoiceRender(g), /error \(403\) @ google\/voices: API key not valid\. — check the Google key in Settings/)
  await assert.rejects(runVoiceRender({ ...g, googleKey: undefined }), /No Google key saved/)

  // ---- Gemini, the rest (list 18): two speakers, a copied sample, the library ----
  script = { 'G/voices': () => ({ json: { id: 'voice_copy' } }), 'G/interactions': () => spoken }
  calls.length = 0
  const talk = 'Elder: You came here <short pause> looking for a warrior.\nand found me.\nMIRA (dryly): I found an old man.\nelder : Older than you think.'
  const duo = await runVoiceRender({ ...g, voice: 'voice_abc', text: talk, speaker2: { name: 'Mira', voice: 'Kore', style: 'bright and quick' } })
  assert.deepEqual(of('G/interactions')[0].body, {
    model: 'gemini-3.8-flash-tts',
    input: [{ type: 'user_input', content: [
      { type: 'text', text: 'You came here <short pause> looking for a warrior.\nand found me.', annotations: [{ type: 'speech_metadata', speaker: 'Elder', style: 'slow and dry' }] },
      { type: 'text', text: 'I found an old man.', annotations: [{ type: 'speech_metadata', speaker: 'Mira', style: 'dryly' }] },
      { type: 'text', text: 'Older than you think.', annotations: [{ type: 'speech_metadata', speaker: 'Elder', style: 'slow and dry' }] }
    ] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: { mode: 'conversational', speakers: [{ speaker: 'Elder', voice: 'voice_abc' }, { speaker: 'Mira', voice: 'Kore' }] } }
  }, 'Google’s documented two-speaker request: one item a turn, each naming its speaker; a turn’s own (how) beats the voice’s style line')
  assert.equal(duo.voiceId, 'voice_abc', 'the take still belongs to the first voice')
  calls.length = 0
  await runVoiceRender({ ...g, voice: 'voice_abc', options: {}, text: 'Elder: One.\nMira: Two.', speaker2: { name: 'Mira', voice: 'Kore', style: 'bright and quick' } })
  assert.deepEqual(of('G/interactions')[0].body.input[0].content.map((c) => c.annotations[0]), [{ type: 'speech_metadata', speaker: 'Elder' }, { type: 'speech_metadata', speaker: 'Mira', style: 'bright and quick' }], 'each voice brings its own style line')
  await assert.rejects(runVoiceRender({ ...g, voice: 'voice_abc', text: 'Just one voice here.', speaker2: { name: 'Mira', voice: 'Kore' } }), /no line for Mira — start its lines with “Mira:”/)
  await assert.rejects(runVoiceRender({ ...g, voice: 'voice_abc', text: 'Elder: hi', speaker2: { name: 'elder', voice: 'Kore' } }), /the two speakers are both called “Elder”/)
  // a copied sample: the sample and the speaker's consent clip, both as WAV
  calls.length = 0
  const src = path.join(tmp, 'sample.wav'), consent = path.join(tmp, 'consent.wav')
  fs.writeFileSync(src, 'SAMPLE'); fs.writeFileSync(consent, 'CONSENT')
  const copy = await runVoiceRender({ ...g, desc: undefined, refAudioPath: src, consentAudioPath: consent })
  assert.deepEqual(of('G/voices')[0].body, { store: true, voice: { model: 'gemini-3.8-flash-tts', type: 'replicated', display_name: 'Elder', replicated: { source_audio: { mime_type: 'audio/wav', data: Buffer.from('SAMPLE').toString('base64') }, consent_audio: { mime_type: 'audio/wav', data: Buffer.from('CONSENT').toString('base64') } } } }, 'Google’s documented voice copy: the sample and the consent clip')
  assert.equal(copy.voiceId, 'voice_copy')
  assert.deepEqual(of('G/interactions')[0].body.generation_config, { speech_config: [{ voice: 'voice_copy' }] })
  calls.length = 0
  await runVoiceRender({ ...g, refAudioPath: src })
  assert.equal(of('G/voices')[0].body.voice.type, 'prompted', 'a sample with no consent clip is never sent: the voice is designed from the words')
  calls.length = 0
  await runVoiceRender({ ...g, voice: 'Kore', refAudioPath: src, consentAudioPath: consent })
  assert.equal(of('G/voices').length, 0, 'a picked voice copies nothing')
  script = { 'G/voices': () => ({ status: 400, json: { error: { message: 'The consent audio does not match the required statement.' } } }) }
  await assert.rejects(runVoiceRender({ ...g, refAudioPath: src, consentAudioPath: consent }), /error \(400\) @ google\/voices: The consent audio does not match the required statement\./)
  // the library: his stored voices first, then the catalog, narrowed by his words
  calls.length = 0
  script = { 'G/voices': () => ({ json: { voices: [{ id: 'voice_mine', display_name: 'Elder', gender: 'Male' }, { id: 'Kore', display_name: 'Kore', gender: 'Female', language_code: 'en-US', description: 'Firm' }, { id: 'lib_9', display_name: 'Warm Brit', gender: 'Male', accent: 'British', pitch: 'low', description: 'A warm British narrator' }, { display_name: 'no id' }], next_page_token: 'x' } }) }
  assert.deepEqual(await googleVoices('gk', ' warm brit '), { ok: true, voices: [{ id: 'voice_mine', label: 'Elder — male' }, { id: 'Kore', label: 'Kore — female · en-us', title: 'Firm' }, { id: 'lib_9', label: 'Warm Brit — male · british', title: 'A warm British narrator' }] })
  assert.equal(calls[0].url, 'G/voices?page_size=100&search=warm+brit')
  assert.equal(calls[0].headers['x-goog-api-key'], 'gk')
  await googleVoices('gk')
  assert.equal(calls[1].url, 'G/voices?page_size=100', 'no words = the whole first page')
  script = { 'G/voices': () => ({ status: 403, json: {} }) }
  assert.deepEqual(await googleVoices('bad'), { ok: false, error: 'key rejected — check the Google key in Settings' })

  // ---- Eleven v4: designed from the description (design → save → speak) ----
  calls.length = 0
  script = {
    'E/v1/text-to-voice/design': () => ({ json: { previews: [{ generated_voice_id: 'gen1' }, { generated_voice_id: 'gen2' }] } }),
    'E/v1/text-to-voice': () => ({ json: { voice_id: 'v-new' } }),
    'E/v1/voices/add': () => ({ json: { voice_id: 'v-clone' } }),
    'E/v1/text-to-speech/*': () => ({ bytes: AUDIO })
  }
  const d = await runVoiceRender({ ...e, options: { seed: 7 } })
  assert.deepEqual(of('E/v1/text-to-voice/design')[0].body, { voice_description: e.desc, model_id: 'eleven_ttv_v3', auto_generate_text: true })
  assert.deepEqual(of('E/v1/text-to-voice')[0].body, { voice_name: 'Elder', voice_description: e.desc, generated_voice_id: 'gen1' })
  const tts = of('E/v1/text-to-speech/*')[0]
  assert.equal(tts.url, 'E/v1/text-to-speech/v-new?output_format=mp3_44100_128')
  assert.equal(tts.headers['xi-api-key'], 'ek')
  assert.deepEqual(tts.body, { text: e.text, model_id: 'eleven_v4', seed: 7 })
  assert.deepEqual({ voiceId: d.voiceId, seed: d.seed, ext: path.extname(d.file) }, { voiceId: 'v-new', seed: 7, ext: '.mp3' })
  // cloned from the sample: one instant-clone upload, then the line
  calls.length = 0
  const sample = path.join(tmp, 'keeper.wav'); fs.writeFileSync(sample, 'sample')
  const c = await runVoiceRender({ ...e, engine: 'eleven-v4-turbo', mode: 'clone', refAudioPath: sample })
  assert.ok(of('E/v1/voices/add')[0].form)
  assert.deepEqual(of('E/v1/voices/add')[0].body, { name: 'Elder', files: { name: 'keeper.wav', type: 'audio/wav', size: 6 } })
  assert.equal(of('E/v1/text-to-voice/design').length, 0)
  assert.equal(of('E/v1/text-to-speech/*')[0].body.model_id, 'eleven_v4_turbo')
  assert.equal(c.voiceId, 'v-clone')
  // a voice picked from his account: only the line is spoken
  calls.length = 0
  await runVoiceRender({ ...e, voice: 'his-voice', refAudioPath: sample, mode: 'clone' })
  assert.deepEqual(calls.map((x) => x.where), ['E/v1/text-to-speech/his-voice'], 'a picked voice makes nothing in his account')
  // their refusals
  script = { ...script, 'E/v1/text-to-speech/*': () => ({ status: 401, json: { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } } }) }
  await assert.rejects(runVoiceRender({ ...e, voice: 'his-voice' }), /ElevenLabs 401 @ \/v1\/text-to-speech\/his-voice: This request exceeds your quota\./)
  await assert.rejects(runVoiceRender({ ...e, text: 'x'.repeat(10001), voice: 'v' }), /Eleven v4 takes 10000 characters/)
  // his account's voices, for the card's pick
  script = { 'E/v2/voices': () => ({ json: { voices: [{ voice_id: 'a1', name: 'Rachel', category: 'premade' }, { voice_id: 'b2', name: 'Elder', category: 'generated' }] } }) }
  assert.deepEqual(await elevenVoices('ek'), { ok: true, voices: [{ id: 'a1', label: 'Rachel · premade' }, { id: 'b2', label: 'Elder · generated' }] })

  // ---- the Queue's ✕ stops the wait ----
  script = { 'G/interactions': (_c, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) }
  const waiting = runVoiceRender({ ...g, voice: 'Kore', jobId: 'job-1' })
  await new Promise((res) => setTimeout(res, 20))
  assert.equal(cancelVoiceJob('job-1'), true)
  await assert.rejects(waiting, /^Error: cancelled after Google got it$/) // L10: the row says the supplier had it
  assert.equal(cancelVoiceJob('job-1'), false, 'a finished job is no longer cancellable')

  // the dialogue grammar on its own
  const { dialogueTurns, GOOGLE_CONSENT } = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../koan-shared/vidancer-ui/src/shared/audioModels.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles.map((f) => { const m2 = { exports: {} }; new Function('module', 'exports', f.text)(m2, m2.exports); return m2.exports })[0]
  assert.deepEqual(dialogueTurns('an opening line\n\nKai 2: hello\nKai: hi (there): friend\n  Note: not a speaker\nKAI 2 ( softly ) :  bye', ['Kai', 'Kai 2']), [
    { speaker: 'Kai', text: 'an opening line' },
    { speaker: 'Kai 2', text: 'hello' },
    { speaker: 'Kai', text: 'hi (there): friend\nNote: not a speaker' },
    { speaker: 'Kai 2', text: 'bye', style: 'softly' }
  ], 'words before a name are the first speaker’s; a name inside another is told apart; an unknown “Name:” is just words')
  assert.deepEqual(dialogueTurns('A.B (x): one', ['A.B', 'C+D']), [{ speaker: 'A.B', text: 'one', style: 'x' }], 'a name is matched as written, never as a pattern')
  assert.equal(GOOGLE_CONSENT.length, 30)
  assert.equal(new Set(GOOGLE_CONSENT.map((c) => c.code)).size, 30)
  assert.ok(GOOGLE_CONSENT.every((c) => c.text.length > 20 && c.lang))

  // the file Google gets for a voice copy: any Library track → 24 kHz mono 16-bit WAV, cut to length
  {
    const ex = { exports: {} }
    const exCode = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/main/export.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static', 'electron'], logLevel: 'silent' }).outputFiles[0].text
    vm.runInThisContext('(function(require,module,exports){' + exCode + '\n})')((n) => (n === 'electron' ? {} : require(n)), ex, ex.exports)
    const tone = path.join(tmp, 'tone.mp3'), wav = path.join(tmp, 'tone.wav')
    const made = require('node:child_process').spawnSync(ex.exports.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=12', '-ac', '2', '-y', tone])
    assert.equal(made.status, 0, String(made.stderr))
    await ex.exports.toWav24k(tone, wav, 5)
    const h = fs.readFileSync(wav)
    assert.deepEqual([h.toString('ascii', 0, 4), h.toString('ascii', 8, 12), h.readUInt16LE(20), h.readUInt16LE(22), h.readUInt32LE(24), h.readUInt16LE(34)], ['RIFF', 'WAVE', 1, 1, 24000, 16], 'PCM, mono, 24 kHz, 16-bit')
    const secs = (h.length - 44) / (24000 * 2)
    assert.ok(Math.abs(secs - 5) < 0.2, 'cut to the seconds asked for: ' + secs)
  }

  console.log('PASS direct voices: Gemini designs, copies (sample + consent clip) or picks then speaks (style beside the text), two speakers = one item a turn with each voice’s style, its library list; Eleven v4 designs, clones or picks then speaks; plain errors, the account voice list, cancel')
})().catch((err) => { console.error(err); process.exitCode = 1 })
