// list 10 (2026-09-30) — Seedream 5.0 on ModelArk's image API (providers/modelark.ts runArkImage):
// the request is what BytePlus documents (one image per call, data-URL inputs, no watermark, png,
// the size table), several variants = several calls, a failed call keeps the images that landed,
// an error says ModelArk's own code + message. Network mocked: nothing is spent.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), vm = require('node:vm')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main/providers/modelark.ts')], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['electron', 'ffmpeg-static', '@fal-ai/client'], logLevel: 'silent' }).outputFiles[0].text
const electron = { nativeImage: { createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 1920, height: 1080 }) }) } }
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((id) => (id === 'electron' ? electron : require(id)), mod, mod.exports)
const { runArkImage, arkImageSize } = mod.exports

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ark-image-'))
const base = path.join(tmp, 'base.png'), ref = path.join(tmp, 'ref.jpg')
fs.writeFileSync(base, Buffer.from('BASE'))
fs.writeFileSync(ref, Buffer.from('REF'))
const calls = []
let answer = () => ({ status: 200, body: { data: [{ url: 'https://ark.example/out.png', size: '2736x1536' }] } })
global.fetch = async (url, init) => {
  if (url === 'https://ark.example/out.png') return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-length': '4' } })
  calls.push({ url, init, body: JSON.parse(init.body) })
  const a = answer(calls.length)
  return new Response(JSON.stringify(a.body), { status: a.status })
}
const opts = (o) => ({ prompt: 'make it night', baseImage: base, refImages: [ref], numImages: 1, aspectRatio: 'auto', resolution: '2K', arkKey: 'ark-test', arkModel: 'dola-seedream-5-0-pro-260628', outDir: path.join(tmp, 'edits'), ...o })

;(async () => {
  // the doc's size table, and 'auto' = the base's own shape
  assert.equal(arkImageSize('16:9', '1.5K'), '2048x1152')
  assert.equal(arkImageSize('21:9', '2K'), '3136x1344')
  assert.equal(arkImageSize('3:4', '1K'), '864x1152')
  assert.equal(arkImageSize('auto', '2K', { width: 1920, height: 1080 }), '2736x1536', 'auto keeps the base shape at 2K')
  assert.equal(arkImageSize('auto', '1K'), '1K', 'no base = the tier word (the model picks the shape)')
  assert.equal(arkImageSize('1:1', 'bogus'), '2048x2048', 'an unknown size = 2K')

  // one edit: the documented request
  const r = await runArkImage(opts())
  assert.equal(calls.length, 1)
  const c = calls[0]
  assert.equal(c.url, 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations')
  assert.equal(c.init.method, 'POST')
  assert.equal(c.init.headers.Authorization, 'Bearer ark-test')
  assert.equal(c.body.model, 'dola-seedream-5-0-pro-260628')
  assert.equal(c.body.prompt, 'make it night', 'no selection = his prompt as written')
  assert.equal(c.body.size, '2736x1536', 'auto on an edit = the base shape')
  assert.deepEqual(c.body.image, ['data:image/png;base64,' + Buffer.from('BASE').toString('base64'), 'data:image/jpeg;base64,' + Buffer.from('REF').toString('base64')], 'base first, then refs, as data URLs')
  assert.equal(c.body.watermark, false)
  assert.equal(c.body.output_format, 'png')
  assert.equal(c.body.response_format, 'url')
  assert.ok(!('n' in c.body) && !('sequential_image_generation' in c.body), 'one image per call')
  assert.equal(r.files.length, 1)
  assert.deepEqual([...fs.readFileSync(r.files[0])], [137, 80, 78, 71], 'the image is downloaded into the project')

  // a selection: the outline line rides after the prompt, and the frame keeps the base shape
  calls.length = 0
  await runArkImage(opts({ maskImage: path.join(tmp, 'mask.png'), aspectRatio: '1:1' }))
  assert.match(calls[0].body.prompt, /^make it night\n\nEdit only inside the red outline\./)
  assert.equal(calls[0].body.size, '2736x1536', 'a selection pins the frame to the base shape')

  // three variants = three calls; one failing keeps the two that landed and says so
  calls.length = 0
  const msgs = []
  answer = (i) => (i === 2 ? { status: 400, body: { error: { code: 'InputImageSensitiveContentDetected', message: 'The request failed because the input image may contain sensitive information.' } } } : { status: 200, body: { data: [{ url: 'https://ark.example/out.png' }] } })
  const three = await runArkImage(opts({ numImages: 3, aspectRatio: '16:9', onProgress: (m) => msgs.push(m) }))
  assert.equal(calls.length, 3)
  assert.equal(three.files.length, 2, 'the two paid images are kept')
  assert.ok(msgs.some((m) => /^2 of 3 made — .*InputImageSensitiveContentDetected/.test(m)), 'the failure is named: ' + msgs.join(' | '))
  assert.equal(calls[0].body.size, '2816x1584', '16:9 at 2K = the doc table')

  // text-to-image: no image field
  calls.length = 0
  answer = () => ({ status: 200, body: { data: [{ url: 'https://ark.example/out.png' }] } })
  await runArkImage(opts({ baseImage: undefined, refImages: [], aspectRatio: '9:16', resolution: '1K' }))
  assert.ok(!('image' in calls[0].body), 'text-to-image sends no image')
  assert.equal(calls[0].body.size, '800x1424')

  // every call failing = the error, ModelArk's code and message in it
  answer = () => ({ status: 404, body: { error: { code: 'ModelNotOpen', message: 'Your account has not activated the model dola-seedream-5-0-pro-260628.' } } })
  await assert.rejects(runArkImage(opts()), /error \(404\) @ modelark\/images: ModelNotOpen Your account has not activated/)

  console.log('PASS ModelArk images: the documented request, size table + base shape, one call per variant, paid images kept on a partial failure, errors in ModelArk\'s words')
})().catch((e) => { console.error(e); process.exitCode = 1 })
