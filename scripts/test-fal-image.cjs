// list 8 (2026-09-30) — GPT Image 2.5's background dial: 'transparent' gives a see-through PNG.
// fal's own field (`background`: auto | transparent | opaque, read that day on the edit and the
// text-to-image doors). The real request builder; fal is a stand-in, nothing is sent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-fal-image-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const sent = []
const fal = { config: () => {}, storage: { upload: async (f) => `https://fal.media/${f.name}` }, subscribe: async (endpoint, o) => (sent.push({ endpoint, input: o.input }), { data: { images: [{ url: 'https://fal.media/out.png' }] } }) }
global.fetch = async () => new Response(Buffer.from('89504e47', 'hex'))

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runImageGen } from '${main}/falImage'; export { IMAGE_MODELS, pixelSize } from '${ui}/shared/imageModels'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent' })
  const mod = { exports: {} }
  // the base's pixel size, for Krea 3's 'auto' (a 1200 × 800 stand-in)
  const nativeImage = { createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 1200, height: 800 }) }) }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { app: { getPath: () => tmp }, nativeImage } : n === '@fal-ai/client' ? { fal } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const base = path.join(tmp, 'base.png')
  fs.writeFileSync(base, 'x')
  const run = (o) => m.runImageGen({ prompt: 'a cat', refImages: [], numImages: 1, aspectRatio: '1:1', falKey: 'k', outDir: path.join(tmp, 'out'), ...o })

  // the dial exists on both GPT Image 2.5 variants and nowhere else
  for (const mdl of m.IMAGE_MODELS) assert.deepEqual(mdl.backgrounds, mdl.id.startsWith('gpt-image-2.5') ? ['auto', 'transparent', 'opaque'] : undefined, mdl.id)

  await run({ model: 'gpt-image-2.5-flare', background: 'transparent' })
  assert.equal(sent.at(-1).endpoint, 'openai/gpt-image-2.5/flare/text-to-image')
  assert.deepEqual([sent.at(-1).input.background, sent.at(-1).input.output_format], ['transparent', 'png'], 'a see-through picture is asked for as a PNG')
  await run({ model: 'gpt-image-2.5-sunburst', baseImage: base, background: 'opaque', aspectRatio: 'auto' })
  assert.equal(sent.at(-1).endpoint, 'openai/gpt-image-2.5/sunburst/edit')
  assert.equal(sent.at(-1).input.background, 'opaque')
  await run({ model: 'gpt-image-2.5-flare' })
  assert.equal(sent.at(-1).input.background, 'auto', 'nothing picked = fal’s own default')
  await run({ model: 'gpt-image-2.5-flare', background: 'plaid' })
  assert.equal(sent.at(-1).input.background, 'auto', 'a value fal does not list never reaches it')
  for (const model of ['gpt-image-2', 'nano-banana-pro', 'seedream-5-pro']) {
    await run({ model, background: 'transparent' })
    assert.ok(!('background' in sent.at(-1).input), `${model} has no such field`)
  }
  console.log('PASS GPT Image 2.5: the background dial (auto · transparent · opaque) rides both doors as fal’s own field, PNG out; no other model is sent it')

  // Nano Banana 2.1 (2026-10-14): Google's own fal doors, thinking_level high unless picked, 1K default
  for (const mdl of m.IMAGE_MODELS) assert.deepEqual(mdl.thinking, mdl.id === 'nano-banana-2.1' ? ['high', 'medium', 'minimal'] : undefined, mdl.id)
  await run({ model: 'nano-banana-2.1', baseImage: base, refImages: [base], aspectRatio: '4:1', seed: 9 })
  let x = sent.at(-1)
  assert.equal(x.endpoint, 'google/nano-banana-2.1/edit')
  assert.deepEqual([x.input.thinking_level, x.input.resolution, x.input.aspect_ratio, x.input.seed, x.input.image_urls.length], ['high', '1K', '4:1', 9, 2], JSON.stringify(x.input))
  await run({ model: 'nano-banana-2.1', baseImage: base, thinking: 'minimal', resolution: '4K', maskImage: base })
  x = sent.at(-1)
  assert.deepEqual([x.input.thinking_level, x.input.resolution, x.input.aspect_ratio], ['minimal', '4K', 'auto'], 'a selection keeps the base’s own shape')
  assert.match(x.input.prompt, /^a cat\n\nEdit only inside the red outline\./, 'no mask input: the outline line rides after the prompt')
  assert.ok(!('mask_url' in x.input))
  await run({ model: 'nano-banana-2.1', thinking: 'plaid', resolution: '0.5K', aspectRatio: 'auto' })
  x = sent.at(-1)
  assert.equal(x.endpoint, 'google/nano-banana-2.1')
  assert.deepEqual([x.input.thinking_level, x.input.resolution, x.input.aspect_ratio], ['high', '1K', '1:1'], 'values fal does not list never reach it')
  for (const model of ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2']) {
    await run({ model, thinking: 'high' })
    assert.ok(!('thinking_level' in sent.at(-1).input), `${model} has no such field`)
  }
  console.log('PASS Nano Banana 2.1 on fal: its own doors, thinking_level (high by default), 1K / 2K / 4K, the wide ratios, the drawn outline for a selection; no other model is sent thinking')

  // Krea 3 (2026-10-16, fal only): no num_images = one call per variant (a set seed steps by one),
  // exact width × height, the rewrite switch as enable_prompt_expansion (on unless turned off)
  const krea = m.IMAGE_MODELS.find((x) => x.id === 'krea-3')
  for (const res of krea.resolutions) for (const a of krea.aspectRatiosEdit) {
    const s = m.pixelSize(a, res, { width: 1200, height: 800 })
    assert.ok(s.width % 16 === 0 && s.height % 16 === 0 && s.width * s.height <= 4220160 && s.width * s.height > (res === '1K' ? 0.9 : 3.6) * 2 ** 20, `${a} ${res}: ${JSON.stringify(s)}`)
  }
  let before = sent.length
  let r = await run({ model: 'krea-3', baseImage: base, refImages: [base, base], numImages: 3, seed: 7, aspectRatio: 'auto' })
  let calls = sent.slice(before)
  assert.equal(calls.length, 3, 'three variants = three calls')
  assert.equal(r.files.length, 3)
  for (const c of calls) {
    assert.equal(c.endpoint, 'krea/krea-3/edit')
    assert.ok(!('num_images' in c.input), 'Krea 3 takes no num_images')
    assert.deepEqual([c.input.image_urls.length, c.input.enable_prompt_expansion, c.input.image_size], [3, true, { width: 2496, height: 1664 }], JSON.stringify(c.input))
  }
  assert.deepEqual(calls.map((c) => c.input.seed), [7, 8, 9], 'a set seed steps by one per call')
  await run({ model: 'krea-3', baseImage: base, rewrite: false, resolution: '1K', aspectRatio: '16:9' })
  x = sent.at(-1)
  assert.deepEqual([x.input.enable_prompt_expansion, x.input.image_size], [false, { width: 1360, height: 768 }], 'switch off · 1K at 16:9')
  await run({ model: 'krea-3', aspectRatio: 'auto' })
  x = sent.at(-1)
  assert.equal(x.endpoint, 'krea/krea-3/text-to-image')
  assert.deepEqual([x.input.image_size, 'image_urls' in x.input], [{ width: 2048, height: 2048 }, false], 'no base: square, no images')
  await run({ model: 'krea-3', baseImage: base, maskImage: base, aspectRatio: '9:16' })
  x = sent.at(-1)
  assert.match(x.input.prompt, /^a cat\n\nEdit only inside the red outline\./, 'no mask input: the outline line rides after the prompt')
  assert.deepEqual([x.input.image_size, 'mask_url' in x.input], [{ width: 2496, height: 1664 }, false], 'a selection keeps the base’s own shape')
  // one of three calls failing: the two that landed are kept (paid)
  const realSubscribe = fal.subscribe
  let k = 0
  fal.subscribe = async (endpoint, o) => (++k === 2 ? Promise.reject(new Error('boom')) : realSubscribe(endpoint, o))
  r = await run({ model: 'krea-3', baseImage: base, numImages: 3 })
  fal.subscribe = realSubscribe
  assert.equal(r.files.length, 2, 'the calls that landed are kept')
  for (const model of ['nano-banana-pro', 'gpt-image-2', 'seedream-5-pro']) {
    before = sent.length
    await run({ model, baseImage: base, numImages: 3, rewrite: false })
    assert.equal(sent.length - before, 1, `${model}: one call`)
    assert.deepEqual(['num_images' in sent.at(-1).input, 'enable_prompt_expansion' in sent.at(-1).input], [true, false], model)
  }
  console.log('PASS Krea 3 on fal: edit + text-to-image doors, one call per variant (seed steps by one, landed ones kept), exact width × height (the base’s shape for auto), the rewrite switch; no other model is sent it')
})().catch((e) => { console.error(e); process.exitCode = 1 })
