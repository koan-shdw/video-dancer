// list 31 (2026-09-30) — the rest of the 08-27 Co-Director brief, the parts that are code only:
// item 4 (its tools write the sheet's voice line), 5 (…and bind the sheet's image), 6 (a rename
// reaches sheets, styles, the brief, every clip field), 7 (no ghosts: a Library image opens by
// @title, a deleted one does not), 8 (the full snapshot shows sheet fields whole). Item 9, the
// write log he can read, is test-codir-ran-browser.cjs. The real runTool on a real project.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-brief31-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const FAKE_EXE = path.join(tmp, 'claude.exe')
fs.writeFileSync(FAKE_EXE, '')
const piped = []
const childProcess = {
  ...require('node:child_process'),
  execFile: (file, args, _o, cb) => setImmediate(() => cb(null, /where|which/.test(file) ? FAKE_EXE : args[0] === '--version' ? '2.1.300 (Claude Code)' : args[0] === 'auth' ? '{"loggedIn":true}' : '', '')),
  spawn: () => {
    const child = new EventEmitter()
    let sent = ''
    child.stdin = { on() {}, write(t) { sent += t }, end() { piped.push(sent) } }
    child.stdout = new PassThrough()
    child.stderr = new EventEmitter()
    setImmediate(() => {
      for (const ev of [{ type: 'system', subtype: 'init', model: 'm', session_id: 's1' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }, { type: 'result', subtype: 'success', result: 'ok', num_turns: 1, usage: {} }]) child.stdout.write(JSON.stringify(ev) + '\n')
      child.stdout.end()
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
}
const fakeFs = { ...require('node:fs'), existsSync: (p) => (/claude(\.exe)?$/i.test(String(p)) || /cli\.js$/.test(String(p)) ? String(p) === FAKE_EXE : fs.existsSync(p)) }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, buildContext, TOOLS } from '${main}/codir'; export { codirBridgeSend } from '${main}/codirBridge'; export { buildSystemGuides } from '${main}/guides'; export { newProject, getProject, newEmptyClip, setClipPromptData, newCharSheet, setCharSheet, newStyle, setStyle, newImageGen, codirSetBrief, codirSetOpenQuestions, deleteImage } from '${main}/project'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : n === 'child_process' ? childProcess : n === 'fs' ? fakeFs : require(n)), mod, mod.exports)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, (d) => deltas.push(d))
  const deltas = []
  await m.newProject(tmp, 'Brief31')
  const p = () => m.getProject()
  m.setExchangeDir(p().dir)

  // a Library with three images: @plate, @plate2 (a longer name that starts the same), @ghost
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const addImage = (id, title) => { const file = path.join(p().dir, 'images', id + '.png'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png); p().images.push({ id, title, file }) }
  addImage('img-plate', '@plate'); addImage('img-plate2', '@plate2'); addImage('img-ghost', '@ghost')

  // everything that can mention an image
  const clip = (await m.newEmptyClip('Rooftop')).clipId
  const pd = JSON.parse(JSON.stringify(p().clips[0].promptData))
  pd.freeform = 'she steps onto @plate at dusk; @plate2 is the far tower'
  pd.scene.style = 'the look of @plate'
  pd.production.lighting = 'match @plate'
  pd.characters = [{ name: 'Ian', base: 'as in @plate', features: '', physics: '', referenceLabel: '@plate' }]
  pd.imageIds = ['img-plate', 'img-plate2']
  await m.setClipPromptData(clip, pd)
  const sheet = (await m.newCharSheet('Ian sheet')).sheetId
  await m.setCharSheet(sheet, { character: { name: 'Ian', base: 'B'.repeat(520) + ' see @plate', features: 'scar over the left brow', physics: 'heavy, slow to start', voice: '', referenceLabel: '@plate' } })
  const style = (await m.newStyle('Dusk')).styleId
  await m.setStyle(style, { scene: { title: '', referenceHandling: 'keep @plate as the ground', style: 'dusk', visualFeel: '' }, production: { avoid: '', audioDesign: '', lighting: 'from @plate', criticalConstraint: '', subtext: '', animationStyle: '' } })
  const gen = (await m.newImageGen('Plate gen', { prompt: 'a wider @plate' })).imageGenId
  await m.codirSetBrief('BUILD STATE: blocking. bg = @plate for every clip; tower = @plate2')
  await m.codirSetOpenQuestions(['does @plate stay at dusk?'])

  // ---- item 6: a rename reaches every one of them ----
  deltas.length = 0
  assert.match(await run('rename_image', { image_id: 'img-plate', new_title: '@roof' }), /@roof/)
  const c = p().clips[0].promptData
  assert.equal(c.freeform, 'she steps onto @roof at dusk; @plate2 is the far tower', '@plate2 is another image: untouched')
  assert.deepEqual([c.scene.style, c.production.lighting, c.characters[0].base, c.characters[0].referenceLabel], ['the look of @roof', 'match @roof', 'as in @roof', '@roof'], 'every clip field, not four of them')
  assert.deepEqual(c.imageIds, ['img-plate', 'img-plate2'], 'ids are not prose')
  const sh = p().charSheets[0].character
  assert.ok(sh.base.endsWith(' see @roof') && sh.referenceLabel === '@roof', 'the char sheet')
  const st = p().styles[0]
  assert.deepEqual([st.scene.referenceHandling, st.production.lighting], ['keep @roof as the ground', 'from @roof'], 'the style')
  assert.equal(p().imageGens[0].recipe.prompt, 'a wider @roof', 'the image gen prompt')
  assert.equal(p().codir.brief, 'BUILD STATE: blocking. bg = @roof for every clip; tower = @plate2', 'the brief')
  assert.deepEqual(p().codir.openQuestions, ['does @roof stay at dusk?'])
  const d = deltas.at(-1)
  assert.deepEqual(['clips', 'charSheets', 'styles', 'imageGens', 'codir'].map((k) => !!d[k]), [true, true, true, true, true], 'the screen hears about every one: ' + Object.keys(d))

  // ---- items 4 + 5: the voice line and the image binding ----
  const tool = m.TOOLS.find((t) => t.name === 'set_char_sheet_fields')
  assert.ok(tool.input_schema.properties.voice && tool.input_schema.properties.image && !/user-only/.test(tool.description))
  assert.equal(await run('set_char_sheet_fields', { sheet_id: sheet, voice: 'low, dry, never raised', image: 'plate2' }), 'updated voice, image @plate2 on sheet "Ian sheet"')
  assert.deepEqual([p().charSheets[0].character.voice, p().charSheets[0].imageId], ['low, dry, never raised', 'img-plate2'])
  assert.match(await run('set_char_sheet_fields', { sheet_id: sheet, image: '@nope' }), /^ERROR: not in the Library: @nope — bind only an existing @title/)
  assert.equal(p().charSheets[0].imageId, 'img-plate2', 'a refused bind changes nothing')
  assert.equal(await run('set_char_sheet_fields', { sheet_id: sheet, image: null }), 'updated image unbound on sheet "Ian sheet"')
  assert.equal(p().charSheets[0].imageId, undefined)
  await run('set_char_sheet_fields', { sheet_id: sheet, image: '@roof' })
  const guide = await m.buildSystemGuides()
  assert.ok(!/char sheet's image binding/.test(guide), 'the guide no longer keeps the binding from it')

  // ---- item 8: the full snapshot shows sheet fields whole ----
  const ctx = m.buildContext(p(), null, null)
  assert.ok(ctx.includes(`  base: ${'B'.repeat(520)} see @roof`), 'a 530-char field, whole')
  assert.ok(ctx.includes('  voice: low, dry, never raised') && ctx.includes('image=@roof'), 'the voice line and the bound image show')
  assert.ok(!/image binding is user-only/.test(ctx))

  // ---- item 7: no ghosts ----
  const opened = await run('read_object', { id: '@roof' })
  assert.match(opened, /^LIBRARY IMAGE @roof \(image_id=img-plate\)\nfile: .*img-plate\.png\nused by: clip "Rooftop" · char sheet "Ian sheet"$/, opened)
  assert.match(await run('read_object', { id: 'ghost' }), /^LIBRARY IMAGE @ghost/)
  await m.deleteImage('img-ghost')
  assert.ok(fs.existsSync(path.join(p().dir, 'images', 'img-ghost.png')), 'the deleted image’s file stays on disk (undo needs it)')
  assert.match(await run('read_object', { id: '@ghost' }), /^ERROR: no clip, char sheet, style, timeline, image gen or Library image with id or name @ghost — an image that does not open here was deleted$/)
  assert.ok(!m.buildContext(p(), null, null).includes('@ghost'), 'it is gone from the Library list')
  const b = await m.codirBridgeSend({ text: 'hello', imageIds: [], selectedClipId: null, focus: null, model: 'claude-fable-5-1' }, () => {}, () => {})
  assert.equal(b.ok, true, b.error)
  assert.ok(piped.at(-1).includes('Any other Library image: read_object its @title for its file, then Read that file. A file under images/ that no @title opens is one the director deleted, or an internal one: never open, use or describe it.'), 'the bridge is told which files are images, not invited to list the folder')
  assert.ok(!piped.at(-1).includes('Glob/Grep/Read from the working directory'))

  console.log('PASS 08-27 brief, code side: a rename reaches clips (every field), sheets, styles, image gens, the brief and the open questions; the sheet’s voice line and image are his to write; full snapshots show fields whole; a Library image opens by @title and a deleted one does not')
})().catch((e) => { console.error(e); process.exitCode = 1 })
