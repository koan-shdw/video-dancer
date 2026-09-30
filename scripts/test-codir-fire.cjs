// list 27 (2026-09-30) — the Co-Director fires a render only through two gates, both in code:
// his switch (Settings.codirFire, off by default) and his go (his whole message this exchange is
// the single word). "yes but needs go command and there needs to be a button in the UI for
// codirector which enables it." The window is a stand-in here: nothing renders, nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-fire-'))
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
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, setExchangeKeys, setFireDoor, isGoWord, TOOLS } from '${main}/codir'; export { newProject, getProject } from '${main}/project'; export { buildSystemGuides } from '${main}/guides'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- what counts as his go: the single word, nothing else ----
  for (const yes of ['go', 'GO', ' Go ', 'go!', 'GO.', 'go\n']) assert.equal(m.isGoWord(yes), true, JSON.stringify(yes))
  for (const no of ['go ahead', 'lets go', 'ok', 'yes', '', undefined, 'gone', 'go render it', 'ok go', 'go go', 'render the rooftop\n\ngo']) assert.equal(m.isGoWord(no), false, JSON.stringify(no))

  await m.newProject(tmp, 'Fire')
  const dir = m.getProject().dir
  m.setExchangeDir(dir)
  const push = () => {}
  const clipId = (await m.runTool('create_clip', { name: 'Rooftop' }, push)).match(/clip_id=([\w-]+)/)[1]
  const genId = (await m.runTool('create_image_gen', { name: 'Poster', prompt: 'a neon poster' }, push)).match(/image_gen_id=([\w-]+)/)[1]

  const pressed = []
  let answer = { ok: true, line: 'queued → watch the Queue panel · Seedance 2.5 · ~$3.20' }
  m.setFireDoor(async (req) => (pressed.push(req), answer))
  const exchange = (fire, userText) => m.setExchangeKeys({ fire, userText })
  const fireClip = () => m.runTool('fire_render', { kind: 'clip', id: clipId }, push)

  // ---- gate 1: the switch. Off is the default, and a go does not open it ----
  exchange(undefined, 'go')
  assert.match(await fireClip(), /^ERROR: rendering for the director is switched off/)
  exchange(false, 'go')
  assert.match(await fireClip(), /^ERROR: rendering for the director is switched off/)
  // ---- gate 2: his go. The switch alone is not enough, and nothing but the word counts ----
  for (const said of ['render the rooftop clip', 'yes do it', 'go ahead and render', 'ok', '']) {
    exchange(true, said)
    assert.match(await fireClip(), /^ERROR: no go\./, said)
  }
  assert.deepEqual(pressed, [], 'a refused call never reaches the window')

  // ---- both gates open: the button is pressed, once per call, for exactly that thing ----
  exchange(true, 'GO')
  assert.equal(await fireClip(), 'fired clip "Rooftop": queued → watch the Queue panel · Seedance 2.5 · ~$3.20')
  assert.equal(await m.runTool('fire_render', { kind: 'clip', id: 'Rooftop' }, push), 'fired clip "Rooftop": queued → watch the Queue panel · Seedance 2.5 · ~$3.20', 'an exact name resolves')
  answer = { ok: true, line: 'queued in Image Gen · 1 image on this GPU' }
  assert.equal(await m.runTool('fire_render', { kind: 'image_gen', id: genId }, push), 'fired image gen "Poster": queued in Image Gen · 1 image on this GPU')
  assert.deepEqual(pressed, [{ kind: 'clip', id: clipId }, { kind: 'clip', id: clipId }, { kind: 'image_gen', id: genId }])
  assert.match(await m.runTool('fire_render', { kind: 'clip', id: 'nope' }, push), /^ERROR: no clip with id or name nope/)
  assert.match(await m.runTool('fire_render', { kind: 'score', id: clipId }, push), /^ERROR: kind must be clip or image_gen/)
  assert.match(await m.runTool('fire_render', { kind: 'image_gen', id: clipId }, push), /^ERROR: no image gen with id or name/, 'a clip id is not an image gen')

  // ---- a button that refuses says so in the panel's own words, and nothing counts as fired ----
  answer = { ok: false, line: 'fix first: no reference image' }
  assert.equal(await fireClip(), 'ERROR: clip "Rooftop" was NOT fired: fix first: no reference image')

  // ---- one go can't start a runaway: 20 renders, then it has to ask again ----
  answer = { ok: true, line: 'queued' }
  exchange(true, 'go')
  pressed.length = 0
  for (let i = 0; i < 20; i++) assert.match(await fireClip(), /^fired clip/)
  assert.match(await fireClip(), /^ERROR: 20 renders were already fired on this go/)
  assert.equal(pressed.length, 20)
  exchange(true, 'go') // his next go
  assert.match(await fireClip(), /^fired clip/)

  // ---- no window to press in: refused, plainly ----
  m.setFireDoor(null)
  exchange(true, 'go')
  assert.match(await fireClip(), /^ERROR: the app window is not there/)

  // ---- it is on its tool list, and the guide tells it the same two gates ----
  const tool = m.TOOLS.find((t) => t.name === 'fire_render')
  assert.ok(tool && /SPENDS/.test(tool.description) && /single word go/.test(tool.description))
  assert.deepEqual(tool.input_schema.properties.kind.enum, ['clip', 'image_gen'])
  const guides = JSON.stringify(await m.buildSystemGuides({}))
  assert.ok(/## Firing renders/.test(guides) && /the single word go/.test(guides), 'the guide has the firing rules')
  assert.ok(!/propose, the user fires, with your statute-16 flag alongside\), anything needing/.test(guides), 'the old "always the user" line is gone')

  console.log('PASS fire_render: refused with the switch off (the default) and refused without his go (only the single word counts); with both it presses the panel’s button once per call, by id or exact name, for clips and image gens; a panel’s refusal comes back in its own words; 20 per go; the guide carries the rules')
})().catch((e) => { console.error(e); process.exitCode = 1 })
