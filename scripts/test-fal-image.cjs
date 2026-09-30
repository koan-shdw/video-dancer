// list 8 (2026-09-30) — GPT Image 2.5's background dial: 'transparent' gives a see-through PNG.
// fal's own field (`background`: auto | transparent | opaque, read that day on the edit and the
// text-to-image doors). The real request builder; fal is a stand-in, nothing is sent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-fal-image-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const sent = []
const fal = { config: () => {}, storage: { upload: async (f) => `https://fal.media/${f.name}` }, subscribe: async (endpoint, o) => (sent.push({ endpoint, input: o.input }), { data: { images: [{ url: 'https://fal.media/out.png' }] } }) }
global.fetch = async () => new Response(Buffer.from('89504e47', 'hex'))

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runImageGen } from '${main}/falImage'; export { IMAGE_MODELS } from '${ui}/shared/imageModels'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent' })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { app: { getPath: () => tmp } } : n === '@fal-ai/client' ? { fal } : n === './runtime' ? {} : require(n)), mod, mod.exports)
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
})().catch((e) => { console.error(e); process.exitCode = 1 })
