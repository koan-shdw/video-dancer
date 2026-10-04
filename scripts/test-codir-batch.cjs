// CODIR-BATCH-SPEC-2026-10-03 — main's half: read_object shows every image gen take with the prompt
// it ran and its file (B); fire_render takes a prompts list on one image gen, each a render toward
// the go's 20 (C); read_lora_examples reads a lora's Civitai examples with their prompts and
// pictures, match narrows them (D); ~ tags ride every exchange with what made them (F). Civitai is a
// stand-in (fetch); nothing renders, nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-batch-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const put = (file, content = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content) }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

// ---- Civitai, stand-in: two examples posted for lora version 777, their generation data, the tiles ----
const calls = []
const GEN = { 501: 'a lone samurai in red armour, rain, neon', 502: 'a cat asleep on a windowsill' }
globalThis.fetch = async (u) => {
  const url = String(u)
  calls.push(url)
  const json = (body) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => body })
  if (url.startsWith('https://civitai.com/api/v1/images')) {
    assert.match(url, /modelVersionId=777/)
    return json({ items: [501, 502].map((id) => ({ id, url: `https://image.civitai.com/x/${id}/original=true/${id}.jpeg`, width: 832, height: 1216, username: 'poster', type: 'image', meta: null })), metadata: { nextCursor: '40|9' } })
  }
  if (url.includes('/api/trpc/image.getGenerationData')) {
    const id = JSON.parse(decodeURIComponent(url.split('input=')[1])).json.id
    return json({ result: { data: { json: { meta: { prompt: GEN[id], negativePrompt: 'blurry', seed: id * 10, width: 832, height: 1216 }, resources: [{ modelName: 'Ink Wash', modelType: 'LORA', strength: 0.8 }] } } } })
  }
  if (url.includes('/width=450/')) return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]), arrayBuffer: async () => png }
  if (url.includes('/a-page/')) return { ok: true, status: 200, headers: new Map([['content-type', 'text/html; charset=utf-8']]), arrayBuffer: async () => Buffer.from('<html>busy</html>') }
  throw new Error('unexpected fetch ' + url)
}

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, setExchangeKeys, setFireDoor, setCodirTags, openImageGenPics, codirPicDirs, TOOLS } from '${main}/codir'; export { newProject, getProject, addImageGenTakes, deleteImageGenTake } from '${main}/project'; export { takeMarks } from '${main}/codirReach'; export { setExtraLoraDirs } from '${main}/imagePaths'; export { buildSystemGuides } from '${main}/guides'; export { thumbFile } from '${main}/civitai'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports,fetch){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports, globalThis.fetch)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, () => {})

  // his lora folder: one lora Civitai knows (version 777), one it doesn't
  const folder = path.join(tmp, 'his loras')
  const lora = (rel, side) => { put(path.join(folder, rel)); put(path.join(folder, rel.replace(/\.safetensors$/, '.vd.json')), JSON.stringify({ looked: true, ...side })) }
  lora('KREA 2/Samurai.safetensors', { name: 'Samurai Style', civitKey: 'civitai:777' })
  lora('KREA 2/Homemade.safetensors', { name: 'Homemade' })
  m.setExtraLoraDirs([folder])

  await m.newProject(tmp, 'Batch')
  const p = () => m.getProject()
  m.setExchangeDir(p().dir)
  m.setExchangeKeys({ loraFolders: [{ path: folder, family: 'krea2' }] })

  // ---- B: read_object lists every take with the prompt it ran and its file ----
  const id = (await run('create_image_gen', { name: 'Fractal Fantasy', prompt: 'a crowned cyclops' })).match(/image_gen_id=(\S+)/)[1]
  const job = () => p().imageGens.find((g) => g.id === id)
  const files = [1, 2, 3].map((n) => { const f = path.join(p().dir, 'images', 'gen', id, `t${n}.png`); put(f, png); return f })
  await m.addImageGenTakes(id, [
    { file: files[0], seed: 1, width: 1, height: 1, promptSent: 'an oni samurai on a koi', snapshot: job().recipe },
    { file: files[1], seed: 2, width: 1, height: 1, promptSent: 'an oni samurai on a koi', snapshot: job().recipe },
    { file: files[2], seed: 3, width: 1, height: 1, promptSent: 'a goddess on a sea of milk', snapshot: job().recipe }
  ])
  const dump = await run('read_object', { id })
  assert.match(dump, new RegExp(`T1 · seed 1 · 1×1 · file images/gen/${id}/t1\\.png\\n     prompt: an oni samurai on a koi`), dump)
  assert.match(dump, /T2 · seed 2 · 1×1 · file \S+t2\.png\n     prompt: same as T1/, 'a repeat says so instead of the whole prompt again')
  assert.match(dump, /T3 ★ · plays · seed 3 · 1×1 · file \S+t3\.png\n     prompt: a goddess on a sea of milk/, dump)

  // ---- his 10-03 ask: every take's marks by its CURRENT number; a delete renumbers and the marks follow ----
  const mk = (await run('create_image_gen', { name: 'Marks', prompt: 'x' })).match(/image_gen_id=(\S+)/)[1]
  const mkJob = () => p().imageGens.find((g) => g.id === mk)
  const five = [1, 2, 3, 4, 5].map((n) => { const f = path.join(p().dir, 'images', 'gen', mk, `m${n}.png`); put(f, png); return f })
  await m.addImageGenTakes(mk, five.map((file, i) => ({ file, seed: i + 1, width: 1, height: 1, promptSent: 'p' + i, snapshot: mkJob().recipe })))
  await run('set_keeper_take', { image_gen_id: mk, take: 2 })
  await run('set_keeper_take', { image_gen_id: mk, take: 5 })
  await run('set_take_flags', { kind: 'image_gen', id: mk, take: 5, color: '#d9534f' })
  await run('set_take_flags', { kind: 'image_gen', id: mk, take: 3, disabled: true })
  let marks = await run('read_object', { id: mk })
  assert.match(marks, /\n  T2 ★ · seed 2 /, marks)
  assert.match(marks, /\n  T3 disabled · seed 3 /, marks)
  assert.match(marks, /\n  T5 ★ · plays · colour red · seed 5 /, marks)
  await m.deleteImageGenTake(mk, mkJob().takes[2].id) // T3 goes: the old T5 is T4 now
  marks = await run('read_object', { id: mk })
  assert.match(marks, /\n  T2 ★ · seed 2 /, marks)
  assert.match(marks, /\n  T4 ★ · plays · colour red · seed 5 /, 'the old T5 keeps its ★ and colour as T4: ' + marks)
  assert.ok(!/disabled/.test(marks), 'the deleted take took its mark with it')
  // ---- list 4 (10-03): each take's settings as they were sent — lora ×1.3 without unleashed, then ×1 with it ----
  const st = (await run('create_image_gen', { name: 'Settings', prompt: 'x' })).match(/image_gen_id=(\S+)/)[1]
  const stJob = () => p().imageGens.find((g) => g.id === st)
  const three = [1, 2, 3].map((n) => { const f = path.join(p().dir, 'images', 'gen', st, `s${n}.png`); put(f, png); return f })
  const base = { ...stJob().recipe, model: 'krea-2-quality', aspect: '3:4', megapixels: 2, refOn: false }
  const at13 = { ...base, loraOn: true, loras: [{ name: 'KREA 2/Samurai.safetensors', weight: 1.3 }], unleashedOn: false }
  const at1 = { ...base, loraOn: true, loras: [{ name: 'KREA 2/Samurai.safetensors', weight: 1 }], unleashedOn: true, unleashedWeight: 1 }
  await m.addImageGenTakes(st, [at13, at1, at1].map((snapshot, i) => ({ file: three[i], seed: 9, width: 1, height: 1, promptSent: 'p', snapshot })))
  const sent = await run('read_object', { id: st })
  assert.match(sent, /T1 [^\n]*\n     prompt: p\n     sent: model krea-2-quality · 3:4 · 2 MP · loras Samurai ×1\.3 · unleashed off · refs off\n/, sent)
  assert.match(sent, /T2 [^\n]*\n     prompt: same as T1\n     sent: model krea-2-quality · 3:4 · 2 MP · loras Samurai ×1 · unleashed ×1 · refs off\n/, sent)
  assert.match(sent, /T3 [^\n]*\n     prompt: same as T2\n     sent: same as T2$/, sent)
  const guide = JSON.stringify(await m.buildSystemGuides({}))
  assert.ok(/keeps every setting the job had when it was fired/.test(guide), 'the guide says queued runs keep their settings')
  assert.equal(m.takeMarks({ takes: [{ id: 'a' }, { id: 'b', color: '#5b9bd5', disabled: true }, { id: 'c' }], keeperIds: ['a', 'c'], keeperTakeId: 'c' }), 'T1 ★ | T2 colour blue · disabled | T3 ★ · plays', 'clips, scores and voices read the same marks')

  // ---- C: one call, many prompts, on the same gen ----
  const pressed = []
  m.setFireDoor(async (req) => (pressed.push(req), { ok: true, line: `queued in Image Gen · ${req.prompts ? req.prompts.length + ' runs × ' : ''}1 image on this GPU` }))
  m.setExchangeKeys({ fire: true, userText: 'go', loraFolders: [{ path: folder, family: 'krea2' }] })
  const eight = ['Obsidian', 'Reef', 'Orchid', 'Insect queen', 'Clockwork saint', 'Frost', 'Blood moon', 'Two eyes']
  assert.equal(await run('fire_render', { kind: 'image_gen', id, prompts: eight }), 'fired image gen "Fractal Fantasy": queued in Image Gen · 8 runs × 1 image on this GPU')
  assert.deepEqual(pressed, [{ kind: 'image_gen', id, prompts: eight }], 'the window gets the whole list, in order, for that one gen')
  assert.equal(job().recipe.prompt, 'a crowned cyclops', 'the gen’s own prompt is left as it was')
  assert.match(await run('fire_render', { kind: 'image_gen', id, prompts: Array(13).fill('x') }), /^ERROR: that is 13 renders and only 12 are left on this go/, 'each prompt counts toward the 20')
  assert.match(await run('fire_render', { kind: 'image_gen', id, prompts: ['ok', ' '] }), /^ERROR: prompts must be a list of non-empty prompts/)
  assert.match(await run('fire_render', { kind: 'image_gen', id, prompts: [] }), /^ERROR: prompts must be a list of non-empty prompts/)
  assert.equal(pressed.length, 1, 'a refused list never reaches the window')
  assert.match(await run('fire_render', { kind: 'image_gen', id, prompts: Array(12).fill('y') }), /^fired image gen/, 'up to the cap is fine')
  assert.match(await run('fire_render', { kind: 'image_gen', id }), /^ERROR: 20 renders were already fired on this go/)
  m.setExchangeKeys({ fire: true, userText: 'make 8 more', loraFolders: [{ path: folder, family: 'krea2' }] })
  assert.match(await run('fire_render', { kind: 'image_gen', id, prompts: ['a'] }), /^ERROR: no go\./, 'the go still gates a list')
  const tool = m.TOOLS.find((t) => t.name === 'fire_render')
  assert.ok(tool.input_schema.properties.prompts && /one run per prompt/.test(tool.description))

  // ---- D: a lora's Civitai examples, with what made them and a picture to look at ----
  m.setExchangeKeys({ civitaiKey: 'k', loraFolders: [{ path: folder, family: 'krea2' }] })
  const ex = await run('read_lora_examples', { lora: 'Samurai Style' })
  assert.match(ex, /^EXAMPLES for lora "Samurai Style" \(Civitai version 777\) — 2 of the 2 on this page/, ex)
  assert.match(ex, /#1 · civitai image 501 · 832×1216 · by poster\n   prompt: a lone samurai in red armour, rain, neon · negative: blurry · seed 5010 · 832×1216 · loras: Ink Wash ×0\.8\n   picture: (\S.*)/)
  const pic = ex.match(/picture: (.+)/)[1]
  assert.ok(fs.existsSync(pic) && pic.startsWith(path.join(tmp, 'civit-cache')) && /t-[0-9a-f]{16}\.jpeg$/.test(pic), 'the 450-wide tile is on disk in the Civitai cache: ' + pic)
  assert.match(ex, /more: cursor=40\|9$/)
  const sam = await run('read_lora_examples', { lora: 'KREA 2/Samurai.safetensors', match: 'samurai' })
  assert.match(sam, /— 1 of the 2 on this page match "samurai"/)
  assert.ok(sam.includes('civitai image 501') && !sam.includes('civitai image 502'), 'match keeps only the samurai')
  assert.ok(calls.filter((u) => u.includes('getGenerationData')).length === 2, 'each example’s generation data is read once, then remembered')
  assert.match(await run('read_lora_examples', { lora: 'Homemade' }), /^ERROR: Civitai does not know "Homemade"/)
  assert.match(await run('read_lora_examples', { lora: 'Nope' }), /^ERROR: no installed lora called "Nope"/)
  m.setExchangeKeys({ loraFolders: [{ path: folder, family: 'krea2' }] })
  assert.match(await run('read_lora_examples', { lora: 'Samurai' }), /No Civitai key in Settings: prompts can not be read, pictures only\./, 'no key: said, pictures still come')

  // ---- F: ~ tags ride the exchange, after the open gen's own pictures, with what made them ----
  m.setExchangeKeys({ civitaiKey: 'k' })
  const watched = path.join(tmp, 'forge out', 'cat.png')
  put(watched, png)
  await m.setCodirTags([{ name: 'cat.png (Watched)', file: watched }, { name: 'civitai image 501 by poster', civit: { id: 501, thumbUrl: 'https://image.civitai.com/x/501/width=450/501.jpeg' } }, { name: 'gone', file: path.join(tmp, 'gone.png') }])
  const pics = m.openImageGenPics(p())
  assert.deepEqual(pics.map((x) => x.label), ['tagged by the director (~): cat.png (Watched) — no prompt saved with it', 'tagged by the director (~): civitai image 501 by poster — prompt: a lone samurai in red armour, rain, neon · negative: blurry · seed 5010 · 832×1216 · loras: Ink Wash ×0.8'], 'a missing file is skipped')
  assert.ok(m.codirPicDirs().includes(path.dirname(watched)) && m.codirPicDirs().includes(path.join(tmp, 'civit-cache')), 'the bridge is let into both folders')
  await m.setCodirTags([])
  assert.deepEqual(m.openImageGenPics(p()), [], 'untagged = gone from the next message')

  // ---- THE LIST 7 (10-04): a tile downloads once; after that civit-cache serves it (a restart included: the file IS the cache) ----
  assert.equal(calls.filter((u) => u.includes('/width=450/')).length, 2, 'two examples read three times + one tag = two downloads')
  assert.equal(await m.thumbFile('https://image.civitai.com/x/501/width=450/501.jpeg'), pic, 'the window asks for the same tile: same file, no download')
  assert.equal(calls.filter((u) => u.includes('/width=450/')).length, 2)
  await assert.rejects(m.thumbFile('https://image.civitai.com/a-page/1.jpeg'), /a page, not the image/)
  assert.ok(!fs.readdirSync(path.join(tmp, 'civit-cache')).some((f) => f.startsWith('t-') && fs.readFileSync(path.join(tmp, 'civit-cache', f)).includes('<html>')), 'an error page is never kept as a picture')

  const guides = JSON.stringify(await m.buildSystemGuides({}))
  assert.ok(/ONE fire_render with prompts/.test(guides) && /read_lora_examples/.test(guides) && /tagged with ~/.test(guides), 'the guide teaches all three')

  console.log('PASS batch: read_object lists each take’s prompt, file and marks (every ★, plays, colour, disabled), and the marks follow their take through a delete; each take’s sent settings (model, loras ×weight, unleashed, size, refs); one fire_render queues many prompts on one gen (each counts toward the go’s 20, the gen’s prompt untouched, the go still gates it); read_lora_examples gives prompts + pictures and match narrows them; ~ tags ride each exchange with what made them; a Civitai tile downloads once and civit-cache serves it after, an error page is never kept; the guide teaches it')
})().catch((e) => { console.error(e); process.exitCode = 1 })
