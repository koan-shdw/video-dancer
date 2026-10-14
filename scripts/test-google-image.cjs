// list 9 (2026-09-30) — Nano Banana 2 and Pro straight from Google (providers/google.ts): the
// Interactions request Google documents, the image taken from the model's output (never a thought
// step's draft), a set seed stepping per variant, paid images kept on a partial failure, a refusal
// or a key error said plainly. Network mocked: nothing is spent.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), vm = require('node:vm')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main/providers/google.ts')], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['electron', 'ffmpeg-static', '@fal-ai/client'], logLevel: 'silent' }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports)
const { runGoogleImage } = mod.exports

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-google-image-'))
const base = path.join(tmp, 'base.png'), ref = path.join(tmp, 'ref.jpg')
fs.writeFileSync(base, Buffer.from('BASE'))
fs.writeFileSync(ref, Buffer.from('REF'))
const b64 = (s) => Buffer.from(s).toString('base64')
const calls = []
const done = (mime = 'image/png', data = 'FINAL') => ({ status: 200, body: { status: 'completed', steps: [{ type: 'thought', content: [{ type: 'image', mime_type: 'image/png', data: b64('DRAFT') }] }, { type: 'model_output', content: [{ type: 'text', text: 'here it is' }, { type: 'image', mime_type: mime, data: b64(data) }] }] } })
let answer = () => done()
global.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) })
  const a = answer(calls.length)
  return new Response(JSON.stringify(a.body), { status: a.status })
}
const opts = (o) => ({ prompt: 'make it night', baseImage: base, refImages: [ref], numImages: 1, aspectRatio: '16:9', resolution: '2K', googleKey: 'g-test', googleModel: 'gemini-3-pro-image', outDir: path.join(tmp, 'edits'), ...o })

;(async () => {
  const r = await runGoogleImage(opts())
  const c = calls[0]
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(c.init.headers['x-goog-api-key'], 'g-test', 'the key rides in the header, never the URL')
  assert.ok(!c.url.includes('g-test'))
  assert.equal(c.body.model, 'gemini-3-pro-image')
  assert.deepEqual(c.body.input, [{ type: 'text', text: 'make it night' }, { type: 'image', mime_type: 'image/png', data: b64('BASE') }, { type: 'image', mime_type: 'image/jpeg', data: b64('REF') }], 'text, then the base, then the refs')
  assert.deepEqual(c.body.response_format, { type: 'image', aspect_ratio: '16:9', image_size: '2K' })
  assert.ok(!('generation_config' in c.body), 'no seed set = none sent')
  assert.equal(r.files.length, 1)
  assert.equal(fs.readFileSync(r.files[0], 'utf8'), 'FINAL', 'the model output image, not the thought draft')
  assert.match(r.files[0], /\.png$/)

  // a selection: the outline line after the prompt, no aspect (the base's own shape); 0.5K = '512'
  calls.length = 0
  await runGoogleImage(opts({ maskImage: path.join(tmp, 'mask.png'), resolution: '0.5K' }))
  assert.match(calls[0].body.input[0].text, /^make it night\n\nEdit only inside the red outline\./)
  assert.deepEqual(calls[0].body.response_format, { type: 'image', image_size: '512' })

  // three variants with a seed: three calls, seeds 7, 8, 9; a JPEG comes back as .jpg; one failing keeps the rest
  calls.length = 0
  const msgs = []
  answer = (i) => (i === 3 ? { status: 429, body: { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } } } : done('image/jpeg'))
  const three = await runGoogleImage(opts({ numImages: 3, seed: 7, onProgress: (m) => msgs.push(m) }))
  assert.deepEqual(calls.map((x) => x.body.generation_config.seed).sort(), [7, 8, 9])
  assert.equal(three.files.length, 2)
  assert.ok(three.files.every((f) => f.endsWith('.jpg')))
  assert.equal(three.seed, 7)
  assert.ok(msgs.some((m) => /^2 of 3 made — error \(429\) @ google\/interactions: Resource has been exhausted/.test(m)), msgs.join(' | '))

  // a refusal: no image, the model's own words
  answer = () => ({ status: 200, body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I can’t make that image.' }] }] } })
  await assert.rejects(runGoogleImage(opts()), /google returned no image \(completed\): I can’t make that image\./)
  // a bad key: Google's message + where to look
  answer = () => ({ status: 403, body: { error: { code: 403, message: 'Method doesn\'t allow unregistered callers.', status: 'PERMISSION_DENIED' } } })
  await assert.rejects(runGoogleImage(opts()), /error \(403\) @ google\/interactions: Method doesn't allow unregistered callers\. — check the Google key in Settings/)
  // text-to-image: only the text block
  answer = () => done()
  calls.length = 0
  await runGoogleImage(opts({ baseImage: undefined, refImages: [], aspectRatio: '1:1' }))
  assert.deepEqual(calls[0].body.input, [{ type: 'text', text: 'make it night' }])

  // Nano Banana 2.1 (2026-10-14): thinking_level rides in generation_config, beside a set seed
  calls.length = 0
  await runGoogleImage(opts({ googleModel: 'gemini-nano-banana-2.1', thinking: 'high', resolution: '4K' }))
  assert.equal(calls[0].body.model, 'gemini-nano-banana-2.1')
  assert.deepEqual(calls[0].body.generation_config, { thinking_level: 'high' })
  assert.equal(calls[0].body.response_format.image_size, '4K')
  calls.length = 0
  await runGoogleImage(opts({ googleModel: 'gemini-nano-banana-2.1', thinking: 'minimal', seed: 3 }))
  assert.deepEqual(calls[0].body.generation_config, { seed: 3, thinking_level: 'minimal' })

  console.log('PASS Google images: the documented request (key in the header), the output image not the draft, seeds step per variant, paid images kept, refusals and key errors said plainly; Nano Banana 2.1’s thinking_level beside the seed')
})().catch((e) => { console.error(e); process.exitCode = 1 })
