// list 14 (2026-09-30) — the Venice adapter (providers/venice.ts), built from Venice's docs: quote
// first (their number rides to the ledger), the queue body per mode (i2v sends no aspect; refs go as
// data URLs; the app's @image1 / @video1 / @audio1 become <Image 1> …), retrieve polled until the
// BODY is the mp4, their errors said plainly, crash recovery, the key test. Network mocked: nothing
// is spent. A real tiny mp4 rides as the video ref so its length is really probed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-venice-'))
const code = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/main/providers/venice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent' }).outputFiles[0].text
const mod = { exports: {} }
const runtime = { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } }
vm.runInThisContext('(function(require,module,exports){' + code + '\n})')((n) => (n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
const { runVeniceRender, fetchVeniceResult, validateVeniceKey, veniceBalance, veniceTags } = mod.exports

const file = (n, s) => { const f = path.join(tmp, n); fs.writeFileSync(f, s); return f }
const clip = path.join(tmp, 'ref.mp4')
const ff = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clip])
if (ff.status !== 0) throw Error(String(ff.stderr))
const realTimeout = global.setTimeout
global.setTimeout = (fn) => realTimeout(fn, 0) // the adapter's 3 s poll waits collapse

const calls = []
let script = {}
global.fetch = async (url, init = {}) => {
  const where = url.replace('https://api.venice.ai/api/v1', '')
  const body = init.body ? JSON.parse(init.body) : undefined
  calls.push({ where, method: init.method ?? 'GET', headers: init.headers, body })
  const a = (script[where] ?? (() => ({ status: 404, json: { error: 'no script' } })))(calls.filter((c) => c.where === where).length)
  if (a.video) return new Response(Buffer.from(a.video), { status: 200, headers: { 'content-type': 'video/mp4' } })
  if (a.image) return new Response(Buffer.from(a.image), { status: 200, headers: { 'content-type': 'image/png', ...(a.headers ?? {}) } })
  return new Response(JSON.stringify(a.json), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } })
}
const ok = { '/video/quote': () => ({ json: { quote: 0.8 } }), '/video/queue': () => ({ json: { model: 'm', queue_id: 'q-1' } }), '/video/retrieve': (n) => (n < 3 ? { json: { status: 'PROCESSING', average_execution_time: 1, execution_duration: 1 } } : { video: 'MP4BYTES' }) }
const base = { mode: 'ref2v', prompt: 'a dancer turns', images: [], duration: '6', resolution: '1080p', aspectRatio: '9:16', generateAudio: true, veniceKey: 'vk', veniceModel: 'seedance-2-0-text-to-video-basic', maxSec: 15, outDir: path.join(tmp, 'out') }
const of = (where) => calls.filter((c) => c.where === where)

;(async () => {
  assert.equal(veniceTags('@image1 with @image10, as in @video2, voiced like @audio1. mail@image.com'), '<Image 1> with <Image 10>, as in <Video 2>, voiced like <Audio 1>. mail@image.com')

  // text-to-video: quote, then queue, then retrieve until the body is the video
  script = ok
  const msgs = [], ids = []
  const r = await runVeniceRender({ ...base, onProgress: (m) => msgs.push(m), onRequestId: (id, ep) => ids.push([id, ep]) })
  assert.deepEqual(of('/video/quote')[0].body, { model: 'seedance-2-0-text-to-video-basic', duration: '6s', resolution: '1080p', audio: true, aspect_ratio: '9:16' })
  assert.deepEqual(of('/video/queue')[0].body, { model: 'seedance-2-0-text-to-video-basic', duration: '6s', resolution: '1080p', audio: true, aspect_ratio: '9:16', prompt: 'a dancer turns', bitrate_mode: 'high' }, 'bitrate high always; the quote never carries it')
  assert.equal(of('/video/queue')[0].headers.Authorization, 'Bearer vk')
  assert.deepEqual(of('/video/retrieve')[0].body, { model: 'seedance-2-0-text-to-video-basic', queue_id: 'q-1' })
  assert.equal(of('/video/retrieve').length, 3, 'polled until the mp4 arrives')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'MP4BYTES')
  assert.equal(r.costUsd, 0.8, 'the quote rides to the ledger')
  assert.deepEqual(ids, [['q-1', 'seedance-2-0-text-to-video-basic']], 'the queue id + model are kept for crash recovery')
  assert.ok(msgs.some((m) => m.startsWith('$0.80 quoted')), msgs.join(' | '))

  // image-to-video: the frames ride as data URLs and NO aspect is sent
  calls.length = 0
  await runVeniceRender({ ...base, mode: 'i2v', images: [file('start.png', 'S')], endImage: file('end.jpg', 'E'), veniceModel: 'seedance-2-0-image-to-video-basic' })
  const q = of('/video/queue')[0].body
  assert.ok(!('aspect_ratio' in q) && !('aspect_ratio' in of('/video/quote')[0].body), 'i2v takes no aspect')
  assert.equal(q.image_url, 'data:image/png;base64,' + Buffer.from('S').toString('base64'))
  assert.equal(q.end_image_url, 'data:image/jpeg;base64,' + Buffer.from('E').toString('base64'))

  // references: three kinds as data URLs, the tags in Venice's grammar, 'auto' follows the source video
  calls.length = 0
  await runVeniceRender({ ...base, prompt: 'Strictly edit @video1 to match @image1, voiced like @audio1', images: [file('a.png', 'A')], videos: [clip], audios: [file('v.mp3', 'V')], duration: 'auto', aspectRatio: 'auto', veniceModel: 'seedance-2-0-reference-to-video-basic' })
  const rq = of('/video/queue')[0].body, rquote = of('/video/quote')[0].body
  assert.equal(rq.prompt, 'Strictly edit <Video 1> to match <Image 1>, voiced like <Audio 1>')
  assert.equal(rq.reference_image_urls.length, 1)
  assert.ok(rq.reference_video_urls[0].startsWith('data:video/mp4;base64,'))
  assert.equal(rq.reference_audio_urls[0], 'data:audio/mpeg;base64,' + Buffer.from('V').toString('base64'))
  assert.equal(rq.aspect_ratio, 'adaptive', 'auto = the source video’s shape')
  assert.equal(rq.duration, '6s', 'auto = the source video’s length (6 s)')
  assert.equal(rquote.reference_video_total_duration, 6, 'the quote is told how much video rides')
  assert.ok(!('reference_video_total_duration' in rq))

  // the longest output is the family's: 40 asked on 2.0 = 15 s
  calls.length = 0
  await runVeniceRender({ ...base, duration: '40' })
  assert.equal(of('/video/queue')[0].body.duration, '15s')

  // no quote = it still submits, and says so
  calls.length = 0
  script = { ...ok, '/video/quote': () => ({ status: 500, json: { error: 'down' } }) }
  const msgs2 = []
  const nq = await runVeniceRender({ ...base, onProgress: (m) => msgs2.push(m) })
  assert.equal(nq.costUsd, undefined)
  assert.ok(msgs2.some((m) => m.startsWith('no quote')))

  // their refusals, in their words + ours
  script = { ...ok, '/video/queue': () => ({ status: 422, json: { error: 'The input image may contain a real person.' } }) }
  await assert.rejects(runVeniceRender(base), /error \(422\) @ venice\/queue: The input image may contain a real person\. — Venice’s public Seedance API refuses media with people/)
  script = { ...ok, '/video/queue': () => ({ status: 402, json: { error: 'Insufficient balance' } }) }
  await assert.rejects(runVeniceRender(base), /error \(402\) @ venice\/queue: Insufficient balance — out of Venice credit/)
  // a job that fails upstream answers non-200 on retrieve: final at once (no retry storm on a 4xx)
  calls.length = 0
  script = { ...ok, '/video/retrieve': () => ({ status: 422, json: { error: 'content policy' } }) }
  await assert.rejects(runVeniceRender(base), /error \(422\) @ venice\/retrieve: content policy/)
  assert.equal(of('/video/retrieve').length, 1)
  // a 5xx burst is ridden out: the paid render still lands
  calls.length = 0
  script = { ...ok, '/video/retrieve': (n) => (n < 4 ? { status: 503, json: { error: 'at capacity' } } : { video: 'LATE' }) }
  assert.equal(fs.readFileSync((await runVeniceRender(base)).file, 'utf8'), 'LATE')
  // a file over their 25 MB line is refused before anything is sent
  calls.length = 0
  const big = path.join(tmp, 'big.png'); fs.writeFileSync(big, Buffer.alloc(26 * 1024 * 1024))
  await assert.rejects(runVeniceRender({ ...base, mode: 'i2v', images: [big] }), /error \(413\) @ venice\/encode: 26 MB file/)
  assert.equal(of('/video/queue').length, 0, 'nothing was submitted')

  // crash recovery
  script = { '/video/retrieve': () => ({ json: { status: 'PROCESSING' } }) }
  assert.deepEqual(await fetchVeniceResult('q-1', 'm', 'vk', base.outDir), { state: 'running' })
  script = { '/video/retrieve': () => ({ video: 'RECOVERED' }) }
  const rec = await fetchVeniceResult('q-1', 'm', 'vk', base.outDir)
  assert.equal(rec.state, 'done')
  assert.equal(fs.readFileSync(rec.file, 'utf8'), 'RECOVERED')
  script = { '/video/retrieve': () => ({ status: 404, json: { error: 'Media could not be found' } }) }
  assert.deepEqual(await fetchVeniceResult('q-1', 'm', 'vk', base.outDir), { state: 'gone' })
  script = { '/video/retrieve': () => ({ status: 401, json: { error: 'bad key' } }) }
  assert.deepEqual(await fetchVeniceResult('q-1', 'm', 'vk', base.outDir), { state: 'running' }, 'a key problem keeps the entry for later')

  // the key test reads the balance and spends nothing
  script = { '/api_keys/rate_limits': () => ({ json: { data: { accessPermitted: true, balances: { USD: 12.4, DIEM: 3 } } } }) }
  assert.deepEqual(await veniceBalance('vk'), { ok: true, usd: 12.4, diem: 3 })
  assert.deepEqual(await validateVeniceKey('vk'), { ok: true })
  script = { '/api_keys/rate_limits': () => ({ status: 401, json: { error: 'nope' } }) }
  assert.equal((await validateVeniceKey('bad')).ok, false)

  // ---- Image Edit on the Venice key (list 9 / 50) ----
  const { runVeniceImage } = mod.exports
  const img = { prompt: 'make it night', baseImage: file('base.png', 'B'), refImages: [file('r.jpg', 'R')], numImages: 1, aspectRatio: '16:9', resolution: '2K', veniceKey: 'vk', veniceModel: 'nano-banana-pro', outDir: path.join(tmp, 'edits') }
  calls.length = 0
  script = { '/image/multi-edit': () => ({ image: 'PNGBYTES' }) }
  const ed = await runVeniceImage(img)
  assert.deepEqual(of('/image/multi-edit')[0].body, { modelId: 'nano-banana-pro-edit', prompt: 'make it night', images: ['data:image/png;base64,' + Buffer.from('B').toString('base64'), 'data:image/jpeg;base64,' + Buffer.from('R').toString('base64')], output_format: 'png', safe_mode: false, aspect_ratio: '16:9', resolution: '2K' }, 'an edit: the edit door of the model, base first, nothing blurred')
  assert.equal(fs.readFileSync(ed.files[0], 'utf8'), 'PNGBYTES')
  // a selection: the outline line after the prompt and no aspect (the base's own shape); 5:4 is not theirs either
  calls.length = 0
  await runVeniceImage({ ...img, maskImage: file('mask.png', 'M') })
  assert.match(of('/image/multi-edit')[0].body.prompt, /^make it night\n\nEdit only inside the red outline\./)
  assert.ok(!('aspect_ratio' in of('/image/multi-edit')[0].body))
  calls.length = 0
  await runVeniceImage({ ...img, aspectRatio: '5:4' })
  assert.ok(!('aspect_ratio' in of('/image/multi-edit')[0].body), 'a shape Venice does not list is left to the base')
  // text-to-image: the generate door, a seed stepping per variant
  calls.length = 0
  script = { '/image/generate': () => ({ image: 'GEN' }) }
  const gen = await runVeniceImage({ ...img, baseImage: undefined, refImages: [], numImages: 2, seed: 5, veniceModel: 'nano-banana-2', resolution: '1K' })
  assert.equal(gen.files.length, 2)
  assert.deepEqual(of('/image/generate').map((c) => c.body.seed).sort(), [5, 6])
  assert.deepEqual({ ...of('/image/generate')[0].body, seed: 0 }, { model: 'nano-banana-2', prompt: 'make it night', aspect_ratio: '16:9', format: 'png', return_binary: true, safe_mode: false, hide_watermark: true, resolution: '1K', seed: 0 })
  // their refusals
  script = { '/image/multi-edit': () => ({ image: 'X', headers: { 'x-venice-is-content-violation': 'true' } }) }
  await assert.rejects(runVeniceImage(img), /Venice flagged this as a content violation/)
  script = { '/image/multi-edit': () => ({ status: 402, json: { error: 'Insufficient balance' } }) }
  await assert.rejects(runVeniceImage(img), /error \(402\) @ venice\/image\/multi-edit: Insufficient balance — out of Venice credit/)

  console.log('PASS Venice: quote first, the documented queue body per mode, <Image 1> tags, retrieve until the mp4, refusals in plain words, 5xx ridden out, recovery, key test')
})().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => { global.setTimeout = realTimeout })
