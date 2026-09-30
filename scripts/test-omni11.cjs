// list 13 (2026-09-30) — Gemini Omni Flash 1.1 on fal: the v1.1 doors, a resolution on every mode, an
// end frame on image-to-video, a resolution on /edit; Omni 1.0's wire is unchanged (it takes neither).
// The real fal.ts with the fal client mocked: nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-omni11-'))
const sent = []
const fal = { config: () => {}, storage: { upload: async (file) => 'https://fixture.test/upload/' + file.name }, subscribe: async (endpoint, args) => { sent.push({ endpoint, input: args.input }); return { data: { video: { url: 'https://fixture.test/result' } } } } }
const code = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/main/fal.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', './runtime'], logLevel: 'silent' }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + code + '\n})')((n) => (n === '@fal-ai/client' ? { fal } : n === './runtime' ? { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } } : require(n)), mod, mod.exports)
const { runRender, runEdit } = mod.exports
global.fetch = async () => new Response('fixture video')
const img = (n) => { const f = path.join(tmp, n + '.png'); fs.writeFileSync(f, n); return f }
const vid = path.join(tmp, 'src.mp4'); fs.writeFileSync(vid, 'video')
const base = { prompt: 'a dancer turns', duration: '6', resolution: '1080p', aspectRatio: '9:16', generateAudio: true, falKey: 'fake', outDir: path.join(tmp, 'out'), images: [] }
const last = () => sent.at(-1)

;(async () => {
  await runRender({ ...base, engine: 'omniflash11', mode: 'ref2v' })
  assert.deepEqual(last(), { endpoint: 'google/gemini-omni-flash/v1.1/text-to-video', input: { prompt: 'a dancer turns', aspect_ratio: '9:16', duration: 6, resolution: '1080p' } }, 'no refs = text-to-video, with the resolution')

  await runRender({ ...base, engine: 'omniflash11', mode: 'ref2v', images: [img('a'), img('b')], resolution: '4k' })
  assert.equal(last().endpoint, 'google/gemini-omni-flash/v1.1/reference-to-video')
  assert.deepEqual(last().input.image_urls, ['https://fixture.test/upload/a.png', 'https://fixture.test/upload/b.png'])
  assert.equal(last().input.resolution, '4k')

  await runRender({ ...base, engine: 'omniflash11', mode: 'i2v', images: [img('start')], endImage: img('end'), resolution: '360p' })
  assert.deepEqual(last(), { endpoint: 'google/gemini-omni-flash/v1.1/image-to-video', input: { prompt: 'a dancer turns', aspect_ratio: '9:16', duration: 6, resolution: '360p', image_url: 'https://fixture.test/upload/start.png', end_image_url: 'https://fixture.test/upload/end.png' } }, 'image-to-video takes the end frame')

  await runRender({ ...base, engine: 'omniflash11', mode: 'ref2v', resolution: '480p' })
  assert.equal(last().input.resolution, '720p', 'a size 1.1 cannot make falls to 720p, never a 422')

  // video refs (fal's v1.1 reference-to-video schema, read 09-30): reference_video_urls, up to three
  const clip = (n) => { const f = path.join(tmp, n + '.mp4'); fs.writeFileSync(f, n); return f }
  await runRender({ ...base, engine: 'omniflash11', mode: 'ref2v', images: [img('a')], videos: [clip('v1'), clip('v2')] })
  assert.equal(last().endpoint, 'google/gemini-omni-flash/v1.1/reference-to-video')
  assert.deepEqual([last().input.image_urls, last().input.reference_video_urls], [['https://fixture.test/upload/a.png'], ['https://fixture.test/upload/v1.mp4', 'https://fixture.test/upload/v2.mp4']])
  await runRender({ ...base, engine: 'omniflash11', mode: 'ref2v', videos: [clip('v1'), clip('v2'), clip('v3'), clip('v4')] })
  assert.equal(last().endpoint, 'google/gemini-omni-flash/v1.1/reference-to-video', 'video refs alone still route to the reference door')
  assert.ok(!('image_urls' in last().input) && last().input.reference_video_urls.length === 3, 'three video refs at most, no empty image list')
  await runRender({ ...base, engine: 'omniflash', mode: 'ref2v', images: [img('a')], videos: [clip('v1')] })
  assert.ok(!('reference_video_urls' in last().input), 'Omni 1.0 has no video refs')

  // Omni 1.0 stays exactly as it was: no resolution, no end frame
  await runRender({ ...base, engine: 'omniflash', mode: 'i2v', images: [img('start')], endImage: img('end') })
  assert.deepEqual(last(), { endpoint: 'google/gemini-omni-flash/image-to-video', input: { prompt: 'a dancer turns', aspect_ratio: '9:16', duration: 6, image_url: 'https://fixture.test/upload/start.png' } })

  // edits: 1.1 sends the resolution, 1.0 and Kling never do
  await runEdit({ engine: 'omniflash11', prompt: 'make it night', video: vid, resolution: '1080p', falKey: 'fake', outDir: base.outDir })
  assert.deepEqual(last(), { endpoint: 'google/gemini-omni-flash/v1.1/edit', input: { prompt: 'make it night', video_url: 'https://fixture.test/upload/src.mp4', resolution: '1080p' } })
  await runEdit({ engine: 'omniflash11', prompt: 'make it night', video: vid, falKey: 'fake', outDir: base.outDir })
  assert.equal(last().input.resolution, '720p', 'no size picked = 720p')
  await runEdit({ engine: 'omniflash', prompt: 'make it night', video: vid, resolution: '1080p', falKey: 'fake', outDir: base.outDir })
  assert.deepEqual(last(), { endpoint: 'google/gemini-omni-flash/edit', input: { prompt: 'make it night', video_url: 'https://fixture.test/upload/src.mp4' } })

  console.log('PASS Omni Flash 1.1: the v1.1 doors, resolution on every mode, an end frame on i2v, up to three video refs, a resolution on edits; Omni 1.0 unchanged')
})().catch((e) => { console.error(e); process.exitCode = 1 })
