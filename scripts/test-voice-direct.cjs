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
const { runVoiceRender, cancelVoiceJob, elevenVoices } = mod.exports

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
  await assert.rejects(waiting, /^Error: cancelled$/)
  assert.equal(cancelVoiceJob('job-1'), false, 'a finished job is no longer cancellable')

  console.log('PASS direct voices: Gemini designs or picks then speaks (style beside the text), Eleven v4 designs, clones or picks then speaks, plain errors, the account voice list, cancel')
})().catch((err) => { console.error(err); process.exitCode = 1 })
