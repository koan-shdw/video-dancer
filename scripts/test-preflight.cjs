// list 31 (2026-09-30) — the PREFLIGHT before spend (the 08-27 brief, item 3): what the app checks
// in a clip's assembled prompt before money leaves, and where the flags land: above the render
// button in Clip Gen, in the Co-Director's read of the prompt, and in what comes back when it
// fires the clip. The real shared check and the real runTool against a project on disk.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-preflight-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { preflightClip, lintFields } from '${ui}/shared/compile'; export { runTool, setExchangeDir, setExchangeKeys, setFireDoor } from '${main}/codir'; export { newProject, getProject, importImage, setClipPromptData } from '${main}/project'; export { buildSystemGuides } from '${main}/guides'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, () => {})
  const P = () => m.getProject()

  await m.newProject(tmp, 'Preflight')
  m.setExchangeDir(P().dir)
  const png = (n) => { const f = path.join(tmp, n + '.png'); fs.writeFileSync(f, n); return f }
  const monk = await m.importImage(png('monk')), cave = await m.importImage(png('cave')), spare = await m.importImage(png('spare'))
  await run('rename_image', { image_id: monk.id, new_title: 'monk' }); await run('rename_image', { image_id: cave.id, new_title: 'cave' }); await run('rename_image', { image_id: spare.id, new_title: 'spare' })
  const clipId = (await run('create_clip', { name: 'The walk' })).match(/clip_id=([\w-]+)/)[1]
  const clip = () => P().clips.find((c) => c.id === clipId)
  const flags = () => m.preflightClip(P(), clip().promptData)

  // ---- a clip that checks out says nothing ----
  await run('set_clip_fields', { clip_id: clipId, engine: 'seedance2', duration: '8', freeform: '@monk walks the ridge path at dawn.', production: { audioDesign: 'wind, sandals on gravel' } })
  await run('set_clip_refs', { clip_id: clipId, image_titles: ['@monk'] })
  await run('set_beats', { clip_id: clipId, beats: [{ name: 'a', length: 5, camera: 'slow push in', action: 'he walks', lighting: 'dawn' }, { name: 'b', length: 3, camera: 'hold', action: 'he stops', lighting: 'dawn' }] })
  assert.deepEqual(flags(), [], 'nothing to flag')

  // ---- 1. the sound switch against the sound text (the $6.24 silent take) ----
  await m.setClipPromptData(clipId, { generateAudio: false })
  assert.deepEqual(flags(), ['sound is OFF, but the clip describes sound (audio_design) — it will render silent'])
  await m.setClipPromptData(clipId, { beats: clip().promptData.beats.map((b, i) => (i ? { ...b, dialogue: 'He says: enough.' } : b)) })
  assert.match(flags()[0], /\(audio_design, dialogue\)/)
  await m.setClipPromptData(clipId, { engine: 'omniflash11' })
  assert.ok(!flags().some((f) => f.startsWith('sound is OFF')), 'an engine with no sound switch always renders sound: no flag')
  await m.setClipPromptData(clipId, { engine: 'seedance2', generateAudio: true })
  assert.deepEqual(flags(), [])

  // ---- 2. @titles that name nothing attached ----
  await run('set_clip_fields', { clip_id: clipId, scene: { referenceHandling: 'Match @cave for the rock. Ignore @ghost. Move like @video1.' } })
  assert.deepEqual(flags(), [
    '@cave is named in reference_handling, but it is not attached to this clip',
    '@ghost is named in reference_handling, but no Library image has that title (deleted or renamed?)',
    '@video1 is named in reference_handling, but the clip has no video refs'
  ])
  await run('set_clip_refs', { clip_id: clipId, image_titles: ['@cave'] })
  assert.ok(!flags().some((f) => f.startsWith('@cave')), 'attached = no flag')
  await m.setClipPromptData(clipId, { mode: 't2v' })
  assert.ok(flags().some((f) => f === '@monk is named in freeform, but the mode is words only (t2v): no reference is sent'), 'words-only sends no refs, and says so')
  await m.setClipPromptData(clipId, { mode: 'ref2v' })
  await run('set_clip_fields', { clip_id: clipId, scene: { referenceHandling: '' } })

  // ---- 3. a linked sheet brings its scene lines along (the fight line riding into a walking clip) ----
  const sheetId = (await run('create_char_sheet', { name: 'Monk' })).match(/sheet_id=([\w-]+)/)[1]
  await run('set_char_sheet_fields', { sheet_id: sheetId, char_name: 'monk', base: 'an old monk', movement: 'Shaolin fight stance, strikes with open palms', image: '@spare' })
  await run('set_clip_fields', { clip_id: clipId, character_links: [{ sheet_id: sheetId }] })
  assert.deepEqual(flags(), ['the linked sheet "Monk" brings its movement into this clip: “Shaolin fight stance, strikes with open palms” — check it fits this scene'])
  await run('set_clip_fields', { clip_id: clipId, freeform: '@monk walks the ridge path at dawn, like @spare.' })
  assert.ok(!flags().some((f) => f.startsWith('@spare')), 'a linked sheet’s own image counts as attached')
  await run('set_char_sheet_fields', { sheet_id: sheetId, movement: '' })
  assert.deepEqual(flags(), [])

  // ---- 4. the beats against the clip's length ----
  await run('set_clip_fields', { clip_id: clipId, duration: '10' })
  assert.deepEqual(flags(), ['the beats add up to 8s, but the clip is 10s'])
  assert.deepEqual(m.preflightClip(P(), clip().promptData, { autoTime: true }), [], 'auto-time keeps them equal by itself: no flag')
  assert.ok(!m.lintFields({ ...clip().promptData }, { imageTitles: [], combined: '' }).some((l) => /beats sum/.test(l)), 'the old lint line is gone: one home for it')
  await run('set_clip_fields', { clip_id: clipId, duration: '8' })

  // ---- 5. a sentence said twice ----
  await run('set_clip_fields', { clip_id: clipId, freeform: '@monk walks the ridge path at dawn. The camera goes into his eye.', production: { criticalConstraint: 'the camera goes into his eye!' } })
  assert.deepEqual(flags(), ['said twice (freeform and critical_constraint): “the camera goes into his eye”'])
  await run('set_clip_fields', { clip_id: clipId, production: { criticalConstraint: '' } })
  assert.deepEqual(flags(), [])

  // ---- where the flags land for the Co-Director: in its read of the prompt, and back from a fired clip ----
  assert.match(await run('read_compiled_prompt', { clip_id: clipId }), /\nPREFLIGHT — no flags: the sound switch, the @titles, the linked sheets, the beats and doubles all check out\n--- the prompt exactly as the render assembles it ---/)
  await m.setClipPromptData(clipId, { generateAudio: false })
  assert.match(await run('read_compiled_prompt', { clip_id: clipId }), /\nPREFLIGHT — 1 flag to name before this clip renders:\n  ⚑ sound is OFF, but the clip describes sound \(audio_design, dialogue\) — it will render silent\n---/)
  m.setFireDoor(async () => ({ ok: true, line: 'queued → watch the Queue panel' }))
  m.setExchangeKeys({ fire: true, userText: 'go' })
  assert.equal(await run('fire_render', { kind: 'clip', id: clipId }), 'fired clip "The walk": queued → watch the Queue panel\nIt rendered WITH 1 preflight flag — if you did not name it before the go, say so now:\n  ⚑ sound is OFF, but the clip describes sound (audio_design, dialogue) — it will render silent')
  await m.setClipPromptData(clipId, { generateAudio: true })
  assert.equal(await run('fire_render', { kind: 'clip', id: clipId }), 'fired clip "The walk": queued → watch the Queue panel', 'a clean clip fires with nothing added')
  assert.ok(JSON.stringify(await m.buildSystemGuides({})).includes('PREFLIGHT: read_compiled_prompt ends its header'), 'the guide tells it the flags are found for it, and still its to name')

  console.log('PASS preflight before spend: the sound switch against the sound text, @titles that name nothing attached (dead, detached, a missing @video slot, words-only mode), a linked sheet’s scene line riding in, the beats against the length, a sentence said twice; a clean clip says nothing; the Co-Director reads the flags with the prompt and gets them back from a fired clip')
})().catch((e) => { console.error(e); process.exitCode = 1 })
