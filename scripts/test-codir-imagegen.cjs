// list 27 (2026-09-30) — the Co-Director reaches Image Gen in full: it makes a new job, sets every
// dial in the panel (model, aspect, size, renders, seed, the refs switch and boosts, loras and
// weights, unleashed), duplicates and renames a job, flags a take and sends one to the Library.
// None of these tools renders: firing is fire_render's alone, behind his switch and his go
// (test-codir-fire.cjs). The real runTool against a real project on disk; the
// "installed" models and loras are empty files in a temp folder.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-imagegen-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const put = (file, content = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content) }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runTool, setExchangeDir, setExchangeKeys, liveDetail, TOOLS } from '${main}/codir'; export { newProject, getProject, addImageGenTakes } from '${main}/project'; export { setExtraLoraDirs } from '${main}/imagePaths'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const run = (name, input) => m.runTool(name, input, () => {})

  // ---- what is "installed": two Krea 2 builds, a civit checkpoint, his lora folder ----
  const models = path.join(tmp, 'models')
  put(path.join(models, 'image', 'krea-2', 'krea2_turbo_fp8_scaled.safetensors'))
  put(path.join(models, 'image', 'krea-2', 'krea2_turbo_nvfp4.safetensors'))
  put(path.join(models, 'image', 'civit', '4242', 'dreamy.safetensors'))
  put(path.join(models, 'image', 'civit', '4242', 'civit.json'), JSON.stringify({ versionId: 4242, name: 'Dreamy Krea', versionName: 'v3', file: 'dreamy.safetensors' }))
  const folder = path.join(tmp, 'his loras')
  const lora = (rel, side) => { put(path.join(folder, rel)); if (side) put(path.join(folder, rel.replace(/\.safetensors$/, '.vd.json')), JSON.stringify({ looked: true, ...side })) }
  lora('KREA 2/ink/InkWash.safetensors', { name: 'Ink Wash', triggerWords: ['inkwash style'], baseModel: 'ZImageTurbo' }) // his folder outranks Civitai's base tag
  lora('KREA 2/film/Grain35.safetensors', { name: 'Grain 35', triggerWords: [] })
  lora('KREA 2/dupes/a/Glow.safetensors', { name: 'Glow' })
  lora('KREA 2/dupes/b/Glow.safetensors', { name: 'Glow' })
  lora('KREA 2/motion/PanLeft.safetensors', { name: 'Pan Left', tag: 'ltx' }) // he tagged it for LTX: not Image Gen's
  lora('KREA 2/krea2filterbypass3.safetensors', { name: 'unleashed' })
  m.setExtraLoraDirs([folder])

  await m.newProject(tmp, 'Gens')
  const p = () => m.getProject()
  m.setExchangeDir(p().dir)
  m.setExchangeKeys({ loraFolders: [{ path: folder, family: 'krea2' }] })

  for (const n of ['list_image_gen_options', 'create_image_gen', 'set_image_gen_settings', 'image_gen_take_to_library']) assert.ok(m.TOOLS.some((t) => t.name === n), n)
  assert.ok(!m.TOOLS.some((t) => /render|generate/.test(t.name) && /image_gen/.test(t.name)), 'none of the image gen tools renders: firing is fire_render alone, behind his switch and his go')

  // ---- the pickers, read from main ----
  const opts = await run('list_image_gen_options', {})
  assert.match(opts, /^IMAGE GEN options on this machine/)
  assert.match(opts, /models: Krea 2 \(.+\) \[krea-2-quality\] · Krea 2 \(.+\) \[krea-2-compact\] · Dreamy Krea · v3 \[civit:4242\]/, opts.split('\n')[1])
  const src = fs.readFileSync(path.join(ui, 'panels/ImageGen.tsx'), 'utf8')
  const panelAspects = JSON.parse(src.match(/const ASPECTS = (\[[^\]]+\])/)[1].replaceAll("'", '"'))
  const panelSizes = [...src.match(/const SIZES = \[([\s\S]*?)\]/)[1].matchAll(/value: '([\d.]+)'/g)].map((x) => x[1])
  assert.equal(opts.split('\n')[2], `aspect: ${panelAspects.join(' · ')}`, 'the same aspects the panel offers')
  assert.ok(opts.split('\n')[3].startsWith(`megapixels: ${panelSizes.join(' · ')} ·`), 'the same sizes the panel offers')
  assert.match(opts, /unleashed \(its own switch\): installed/)
  assert.match(opts, /- Ink Wash \[KREA 2\/ink\/InkWash\.safetensors\] — triggers: inkwash style · ZImageTurbo/)
  assert.match(opts, /loras: 4 installed/)
  assert.ok(!opts.includes('Pan Left') && !opts.includes('- unleashed'), 'another family’s lora and the unleashed file are not lora picks')

  // ---- a new job, then every dial ----
  const made = await run('create_image_gen', { name: 'Rooftop plate', prompt: 'a wet rooftop at dusk' })
  const id = made.match(/^created image_gen_id=(\S+)/)[1]
  const job = () => p().imageGens.find((g) => g.id === id)
  assert.deepEqual([job().name, job().recipe.prompt, job().takes.length], ['Rooftop plate', 'a wet rooftop at dusk', 0])
  const set = await run('set_image_gen_settings', { image_gen_id: id, model: 'civit:4242', aspect: '16:9', megapixels: 2, renders: 4, seed: 777, refs_on: false, ref_boost_a: 1.4, ref_boost_b: 0.8, loras_on: true, loras: [{ name: 'Ink Wash', weight: 0.7 }, { name: 'KREA 2/film/Grain35.safetensors' }], unleashed_on: false, unleashed_weight: 0.5 })
  assert.match(set, /^image gen "Rooftop plate": aspect 16:9 · 2 MP · 4 renders per run · seed 777 · boost A 1\.4 · boost B 0\.8 · unleashed ×0\.5 · refs OFF · loras ON · unleashed OFF · model Dreamy Krea · v3 · loras InkWash ×0\.7 \+ Grain35 ×1 \(the user can undo\)$/)
  const r = job().recipe
  assert.deepEqual({ model: r.model, aspect: r.aspect, megapixels: r.megapixels, batch: r.batch, seed: r.seed, refOn: r.refOn, refBoost: r.refBoost, refBoostB: r.refBoostB, loraOn: r.loraOn, loras: r.loras, unleashedOn: r.unleashedOn, unleashedWeight: r.unleashedWeight, prompt: r.prompt },
    { model: 'civit:4242', aspect: '16:9', megapixels: 2, batch: 4, seed: 777, refOn: false, refBoost: 1.4, refBoostB: 0.8, loraOn: true, loras: [{ name: 'KREA 2/ink/InkWash.safetensors', weight: 0.7 }, { name: 'KREA 2/film/Grain35.safetensors', weight: 1 }], unleashedOn: false, unleashedWeight: 0.5, prompt: 'a wet rooftop at dusk' },
    'the recipe holds exactly what the render reads (a lora by the path Comfy resolves)')
  await run('set_image_gen_settings', { image_gen_id: 'Rooftop plate', model: 'Krea 2 (' + opts.match(/Krea 2 \((.+?)\) \[krea-2-quality\]/)[1] + ')', seed: 0, loras: [] })
  assert.deepEqual([job().recipe.model, job().recipe.seed, job().recipe.loras, job().recipe.aspect], ['krea-2-quality', 0, [], '16:9'], 'a label resolves too; only what was sent changes')

  // ---- what it refuses, in plain words ----
  const bad = (input) => run('set_image_gen_settings', { image_gen_id: id, ...input })
  assert.match(await bad({ aspect: '5:4' }), /^ERROR: aspect is one of 1:1, 3:2/)
  assert.match(await bad({ megapixels: 4 }), /^ERROR: megapixels is one of 1, 1\.5, 2/)
  assert.match(await bad({ renders: 9 }), /^ERROR: renders is 1 to 4/)
  assert.match(await bad({ seed: -3 }), /^ERROR: seed is a whole number/)
  assert.match(await bad({ model: 'krea-2-full' }), /^ERROR: no installed model "krea-2-full" — installed: Krea 2/, 'a build that is not downloaded is not offered')
  assert.match(await bad({ loras: [{ name: 'Glow' }] }), /^ERROR: "Glow" matches 2 loras — use the \[path\]/, 'two files of one name: never a guess')
  assert.match(await bad({ loras: [{ name: 'Pan Left' }] }), /^ERROR: no installed Krea 2 lora "Pan Left"/, 'a lora of another family')
  assert.match(await bad({ loras: [{ name: 'Ink Wash' }, { name: 'Grain 35' }, { name: 'Glow' }] }), /^ERROR: loras is a list of up to 2/)
  assert.match(await bad({ loras: [{ name: 'Ink Wash', weight: 3 }] }), /^ERROR: a lora weight is 0 to 2/)
  assert.match(await bad({ loras: [{ name: 'Ink Wash' }, { name: 'KREA 2/ink/InkWash' }] }), /^ERROR: Ink Wash is in the list twice/)
  assert.match(await bad({ refs_on: 'yes' }), /^ERROR: refs_on is true or false/)
  assert.match(await bad({}), /^nothing to do/)
  assert.match(await run('set_image_gen_settings', { image_gen_id: 'nope', seed: 1 }), /^ERROR: no image gen with id or name nope/)
  assert.deepEqual([job().recipe.aspect, job().recipe.loras], ['16:9', []], 'a refused call changes nothing')

  // ---- duplicate and rename reach image gens (list 27: "check that its duplicate works on image gens") ----
  const dup = await run('duplicate_item', { kind: 'image_gen', id })
  const dupId = dup.match(/→ image_gen_id=(\S+)/)[1]
  const copy = p().imageGens.find((g) => g.id === dupId)
  assert.deepEqual([copy.name, copy.recipe.aspect, copy.takes.length], ['Rooftop plate copy', '16:9', 0])
  assert.match(await run('rename_item', { kind: 'image_gen', id: dupId, name: 'Rooftop plate B' }), /^renamed image gen to "Rooftop plate B"/)
  assert.equal(p().imageGens.find((g) => g.id === dupId).name, 'Rooftop plate B')

  // ---- takes: the ★, and a take into the Library ----
  assert.match(await run('image_gen_take_to_library', { image_gen_id: id }), /^ERROR: "Rooftop plate" has 0 takes — render it first/)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const files = [1, 2, 3].map((n) => { const f = path.join(p().dir, 'images', 'gen', id, `t${n}.png`); put(f, png); return f })
  await m.addImageGenTakes(id, files.map((file, i) => ({ file, seed: 100 + i, width: 1, height: 1, promptSent: 'a wet rooftop at dusk', snapshot: job().recipe })))
  assert.match(await run('set_keeper_take', { image_gen_id: id, take: 2 }), /^★ on image gen "Rooftop plate" is now take 2$/)
  assert.equal(job().keeperTakeId, job().takes[1].id)
  assert.match(await run('set_keeper_take', { image_gen_id: id, take: 9 }), /^ERROR: "Rooftop plate" has 3 takes — no take 9/)
  const lib = await run('image_gen_take_to_library', { image_gen_id: id })
  assert.match(lib, /^take 2 of image gen "Rooftop plate" is in the Library as @Rooftop_plate\S* — attach it with set_clip_refs or set_image_gen_refs$/, lib)
  const title = lib.match(/as (@\S+)/)[1]
  const im = p().images.find((i) => i.title === title)
  assert.ok(im && fs.existsSync(im.file) && job().takes[1].keptImageId === im.id, 'the ★ take was copied in; the take stays a take')
  assert.match(await run('image_gen_take_to_library', { image_gen_id: id, take: 3 }), /^take 3 of image gen/)
  assert.match(await run('set_image_gen_refs', { image_gen_id: dupId, a: title }), /refs: A = @Rooftop_plate/, 'a gen take becomes another gen’s ref')
  assert.deepEqual(m.liveDetail('set_image_gen_settings', { image_gen_id: id, aspect: '1:1', loras: [{ name: 'Ink Wash', weight: 0.7 }] }), { tool: 'set_image_gen_settings', target: 'image gen "Rooftop plate"', fields: [{ path: 'aspect', snippet: '1:1' }, { path: 'loras', snippet: 'Ink Wash ×0.7' }] })

  console.log('PASS Co-Director in Image Gen: options read from this machine (models, the panel’s aspects and sizes, the Krea 2 loras), a new job, every dial set and checked, plain refusals, duplicate, rename, ★, take to Library; none of them renders')
})().catch((e) => { console.error(e); process.exitCode = 1 })
