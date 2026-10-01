// list 44 (VOICE-EXTRAS-SPEC-2026-10-01) — voice slots: a sheet bound to a voice brings that voice as
// an @audio slot (the Co-Director's sheet links keep UI parity), the voice's description rides the
// character's voice line, each sent voice slot says its role in the prompt, a dialogue slot locks the
// clip's length (another length is a preflight flag), "render dialogue" speaks the beats' lines for
// that character and lands them in the Library with the slot flipped to them. The real shared
// compile, the real Co-Director tools and project on disk, the real voice:render handler with a
// stand-in engine (nothing is sent anywhere).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { transformSync } = require('esbuild')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-voice-extras-'))
const app = path.resolve(__dirname, '..')
const main = path.join(app, 'src/main').replaceAll('\\', '/')
const ui = path.resolve(app, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

;(async () => {
  const out = await require('esbuild').build({
    stdin: {
      contents: `export { preflightClip, compileClip, resolveEffective, dialogueText, dialogueLock } from '${ui}/shared/compile'
        export { audioModelFor } from '${ui}/shared/audioModels'
        export { primaryImageFile } from '${ui}/shared/imageSources'
        export { runTool, setExchangeDir } from '${main}/codir'
        export { newProject, getProject, setClipPromptData, newVoiceClip, setVoiceClipData, addVoiceTake, setCharSheet, addDialogueAudio, captureProjectSession, assertProjectSession, beginMediaWrite, endMediaWrite } from '${main}/project'
        export { addPendingVoice, removePendingVoice } from '${main}/pending'
        export { probeVideo, toWav24k } from '${main}/export'`,
      resolveDir: app,
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw]
  })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, () => {})
  const P = () => m.getProject()

  await m.newProject(tmp, 'Voices')
  m.setExchangeDir(P().dir)
  const clipId = (await run('create_clip', { name: 'The door' })).match(/clip_id=([\w-]+)/)[1]
  const clip = () => P().clips.find((c) => c.id === clipId)
  const beats = [
    { id: 'b1', name: 'a', length: 3, camera: 'close', action: 'Kai turns to the door', lighting: '', dialogue: '"Who is there?"' },
    { id: 'b2', name: 'b', length: 2, camera: 'wide', action: 'Mira steps in', lighting: '', dialogue: 'It is me' }
  ]
  await m.setClipPromptData(clipId, { engine: 'seedance2', mode: 'ref2v', duration: '5', beats, characters: [{ name: 'Mira', referenceLabel: '', base: 'a girl in a red coat', features: '', physics: '' }] })
  const sheetId = (await run('create_char_sheet', { name: 'Kai' })).match(/sheet_id=([\w-]+)/)[1]
  await run('set_char_sheet_fields', { sheet_id: sheetId, char_name: 'Kai', base: 'a tall man' })
  const voiceId = (await m.newVoiceClip('Kai voice')).voiceClipId
  await m.setVoiceClipData(voiceId, { recipe: { engine: 'chatterbox-api', desc: 'a low warm voice, slow', testLine: 'the test line' } })
  const sample = path.join(tmp, 'k.mp3'); fs.writeFileSync(sample, 'mp3')
  await m.addVoiceTake(voiceId, { file: sample, durationSec: 6.2 })
  await m.setCharSheet(sheetId, { voiceId })
  const flags = () => m.preflightClip(P(), clip().promptData).filter((f) => f.startsWith('@audio'))
  const text = () => m.compileClip(P(), clip()).text

  // ---- 1. the sheet brings its voice as a slot (the Co-Director's link keeps UI parity) ----
  await run('set_clip_fields', { clip_id: clipId, character_links: [{ sheet_id: sheetId }] })
  assert.deepEqual(clip().promptData.audioRefs, [{ voiceId, fromSheetId: sheetId }], 'linking the sheet adds its voice, tagged with the sheet')
  await run('set_clip_fields', { clip_id: clipId, character_links: [{ sheet_id: sheetId }] })
  assert.equal(clip().promptData.audioRefs.length, 1, 'a second write adds no second slot')

  // ---- 2. the voice's description is the character's voice line; typed text on the sheet wins ----
  assert.ok(text().includes('voice: "a low warm voice, slow"'), 'the voice description rides character_modeling: ' + text())
  await run('set_char_sheet_fields', { sheet_id: sheetId, voice: 'raspy, fast' })
  assert.ok(text().includes('voice: "raspy, fast"') && !text().includes('a low warm voice'), 'the sheet’s own voice line wins')
  await m.setCharSheet(sheetId, { character: { ...P().charSheets.find((s) => s.id === sheetId).character, voice: '' } })

  // ---- 3. each sent voice slot says what it is ----
  assert.ok(text().includes("@audio1 is Kai's voice: Kai speaks in it (its sound, accent and pace); the words are the dialogue lines."), 'timbre: the role line, the sheet’s character speaking')
  await m.setClipPromptData(clipId, { mode: 't2v' })
  assert.ok(!text().includes('@audio1 is'), 'words only sends no refs: no role line')
  await m.setClipPromptData(clipId, { mode: 'ref2v', engine: 'ltx25' })
  assert.ok(!text().includes('@audio1 is'), 'an engine without audio refs: no role line')
  await m.setClipPromptData(clipId, { engine: 'seedance2' })

  // ---- 4. dialogue locks the length: another one is a flag ----
  assert.deepEqual(flags(), [], 'timbre: no length rule')
  await m.setClipPromptData(clipId, { audioRefs: [{ voiceId, fromSheetId: sheetId, role: 'dialogue' }] })
  assert.ok(text().includes("@audio1 is Kai's dialogue, word for word: Kai says exactly this audio, lips in sync with it."), 'dialogue: its role line')
  assert.deepEqual(flags(), ['@audio1 is dialogue (6.2s), but the clip is 5s: the words run past the end (7s holds them)'])
  await m.setClipPromptData(clipId, { duration: '7' })
  assert.deepEqual(flags(), [], 'the locked length: no flag')
  await m.setClipPromptData(clipId, { duration: '10' })
  assert.deepEqual(flags(), ['@audio1 is dialogue (6.2s): the clip is 10s, so it runs on 3.8s past the words (7s fits them)'])
  await m.setClipPromptData(clipId, { duration: 'auto' })
  assert.deepEqual(flags(), ["@audio1 is dialogue (6.2s): the clip's length is auto, its dialogue needs 7s"])
  assert.equal(m.dialogueLock('seedance2', 8.3), '10', 'rounded up to the engine’s next length')
  assert.equal(m.dialogueLock('seedance2', 5.02), '5')
  assert.equal(m.dialogueLock('seedance2', 16), undefined, 'longer than its longest clip')
  await m.setClipPromptData(clipId, { audioRefs: [{ voiceId, fromSheetId: sheetId, role: 'dialogue', inSec: 0, outSec: 16 }] })
  assert.match(flags()[0], /^@audio1 is dialogue \(16s\), longer than Seedance 2's longest clip$/)
  await m.setClipPromptData(clipId, { audioRefs: [{ voiceId, fromSheetId: sheetId }], duration: '5' })

  // ---- 5. the words a render dialogue speaks ----
  const eff = () => m.resolveEffective(P(), { ...clip().promptData }).effectiveStructured
  assert.equal(m.dialogueText(eff(), 'Kai', true), 'Who is there?', 'Kai’s line only: Mira claims hers')
  await m.setClipPromptData(clipId, { beats: [...beats, { id: 'b3', name: 'c', length: 1, camera: 'hold', action: 'silence', lighting: '', dialogue: 'go' }] })
  assert.equal(m.dialogueText(eff(), 'Kai', true), 'Who is there? go.', 'one voice slot: a line no character claims is its too, closed as a sentence')
  assert.equal(m.dialogueText(eff(), 'Kai', false), 'Who is there?', 'two voice slots: only the lines that name it')
  await m.setClipPromptData(clipId, { beats })

  // ---- 6. the voice:render handler: dialogue lands in the Library and the slot flips ----
  const handlers = {}, renders = []
  const source = fs.readFileSync(path.join(app, 'src/main/index.ts'), 'utf8')
  const section = source.slice(source.indexOf("  ipcMain.handle('voice:render'"), source.indexOf('  // list 19: the voices of his ElevenLabs account'))
  const ctx = {
    ...m, existsSync: fs.existsSync, createHash: require('node:crypto').createHash, join: path.join, app: { getPath: () => tmp },
    ipcMain: { handle: (n, f) => { handlers[n] = f } }, loadSettings: async () => ({ falKey: 'fake-fal' }), safeSend: () => {}, observePendingWrite: () => {},
    runVoiceRender: async (o) => {
      renders.push(o)
      fs.mkdirSync(o.outDir, { recursive: true })
      const file = path.join(o.outDir, `voice_${renders.length}.mp3`)
      fs.writeFileSync(file, 'audio')
      o.onRequestId?.('req-' + renders.length, 'fal-ai/fixture')
      return { file, durationSec: 6.2 }
    }
  }
  vm.runInNewContext(transformSync(section, { loader: 'ts', target: 'es2022' }).code, ctx)
  const render = (args) => handlers['voice:render']({ sender: {} }, args)
  const r1 = await render({ voiceClipId: voiceId, engine: 'chatterbox-api', text: 'Who is there?', dialogueFor: { clipId, voiceId, fromSheetId: sheetId } })
  assert.ok(r1.ok, 'the dialogue render lands: ' + r1.error)
  assert.equal(renders[0].text, 'Who is there?', 'it speaks the dialogue, not the test line')
  assert.equal(path.basename(renders[0].outDir), 'audio', 'into the Library’s folder')
  const track = P().audio.find((a) => a.title === 'Kai voice · dialogue · The door')
  assert.ok(track && track.durationSec === 6.2 && track.file === r1.file, 'a Library track named for the voice and the clip')
  assert.deepEqual(clip().promptData.audioRefs, [{ audioId: track.id, role: 'dialogue', fromSheetId: sheetId }], 'the slot flipped to it in dialogue mode, the sheet tag kept')
  assert.equal(clip().promptData.duration, '7', 'the clip’s length locked to it')
  assert.equal(P().voiceClips.find((v) => v.id === voiceId).takes.length, 1, 'no take was added to the voice')
  assert.deepEqual(r1.delta.audio.map((a) => a.id), [track.id], 'the delta carries the track')
  assert.equal(r1.delta.clips[0].id, clipId, '… and the clip')
  assert.ok(text().includes("@audio1 is Kai's dialogue, word for word"), 'the prompt says it is Kai’s dialogue')
  assert.deepEqual(flags(), [], 'locked: no flag')
  const r2 = await render({ voiceClipId: voiceId, engine: 'chatterbox-api', text: '  ', dialogueFor: { clipId, voiceId } })
  assert.equal(r2.error, 'no dialogue lines for this voice in the clip’s beats')
  // a slot gone meanwhile: the track still lands, as a new slot
  await m.setClipPromptData(clipId, { audioRefs: [] })
  const r3 = await render({ voiceClipId: voiceId, engine: 'chatterbox-api', text: 'It is me.', dialogueFor: { clipId, voiceId } })
  assert.ok(r3.ok && clip().promptData.audioRefs.length === 1 && clip().promptData.audioRefs[0].role === 'dialogue', 'the slot it was made for is gone: a new dialogue slot')
  // a Voice card render is unchanged: the test line, a take on the voice
  const r4 = await render({ voiceClipId: voiceId, engine: 'chatterbox-api' })
  assert.ok(r4.ok && r4.takeId, 'a plain voice render still makes a take')
  assert.equal(renders.at(-1).text, 'the test line')
  assert.equal(path.basename(renders.at(-1).outDir), 'voices')

  // ---- 7. unlinking the sheet takes its slot away ----
  await m.setClipPromptData(clipId, { audioRefs: [{ audioId: track.id, role: 'dialogue', fromSheetId: sheetId }, { voiceId }] })
  await run('set_clip_fields', { clip_id: clipId, character_links: [] })
  assert.deepEqual(clip().promptData.audioRefs, [{ voiceId }], 'the sheet’s slot goes, a slot added by hand stays')

  console.log('PASS voice slots: a sheet’s voice comes with its link and goes with it, its description is the voice line (the sheet’s own text wins), each sent slot says timbre or dialogue in the prompt, dialogue locks the length (rounded up, another length flagged), render dialogue speaks the beats’ lines for that character into a Library track and flips the slot; a Voice card render is unchanged')
})().catch((e) => { console.error(e); process.exitCode = 1 })
