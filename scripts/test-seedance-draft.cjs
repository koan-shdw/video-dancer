// list 17 (2026-09-30) — Seedance 2.5's Draft mode on fal and on ModelArk, and 1080p as a normal
// size on both rows. The real request builders and the real finish logic; both suppliers are
// stand-ins (their documented request and reply shapes, read that day). Nothing is sent or spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-draft-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const sent = [], uploads = []
let falReply = () => ({ video: { url: 'https://fixture.test/result.mp4' }, seed: 7 })
const fal = {
  config: () => {},
  storage: { upload: async (file) => (uploads.push(file.name), 'https://fixture.test/upload/' + file.name) },
  subscribe: async (endpoint, args) => {
    sent.push({ endpoint, input: args.input })
    args.onEnqueue?.('fal-req-1')
    return { data: falReply() }
  }
}
const runtime = { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } }

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { runRender, FAL_DRAFT_COMPLETE } from '${main}/fal'; export { runArkRender } from '${main}/providers/modelark'; export { draftOf, draftFinishRequest } from '${main}/draft'; export { MODELS } from '${ui}/shared/models'; export { draftLeftMs, DRAFT_DAYS } from '${ui}/shared/types'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent' })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { nativeImage: {}, app: { getPath: () => tmp } } : n === '@fal-ai/client' ? { fal } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
  const m = mod.exports
  const img = (n) => { const f = path.join(tmp, n + '.png'); fs.writeFileSync(f, n); return f }
  const DAY = 86_400_000

  // ---- the registry: 1080p on both Seedance 2.5 rows, Draft mode on those two and nowhere else ----
  for (const id of ['seedance25', 'seedance25ark']) {
    const row = m.MODELS[id]
    assert.deepEqual(row.resolutions, ['480p', '720p', '1080p'], id + ' lists 1080p')
    assert.ok(row.pricePerSec['1080p'] > row.pricePerSec['720p'], id + ' prices 1080p')
    assert.deepEqual(row.draft, { final: '1080p', finalPerSec: row.pricePerSec['1080p'] }, id + ': the finish costs what a 1080p second costs')
  }
  assert.deepEqual(Object.values(m.MODELS).filter((x) => x.draft).map((x) => x.id).sort(), ['seedance25', 'seedance25ark'])
  assert.equal(m.DRAFT_DAYS, 7)
  assert.equal(m.draftLeftMs({ draft: { id: 'd', via: 'fal', at: 1000 } }, 1000 + 6 * DAY), DAY)
  assert.ok(m.draftLeftMs({ draft: { id: 'd', via: 'fal', at: 1000 } }, 1000 + 7 * DAY) <= 0)
  assert.equal(m.draftLeftMs({}), 0, 'a take that is no draft has nothing left')

  // ---- fal: the Draft flag, the id that comes back, the door that finishes it ----
  global.fetch = async () => new Response('fixture video')
  const base = { prompt: 'a dancer turns', duration: '6', resolution: '720p', aspectRatio: '9:16', generateAudio: true, falKey: 'fake', outDir: path.join(tmp, 'out'), images: [] }
  const ids = []
  falReply = () => ({ video: { url: 'https://fixture.test/result.mp4' }, seed: 7, draft_id: 'draft_abc' })
  let r = await m.runRender({ ...base, engine: 'seedance25', mode: 'ref2v', images: [img('a')], draft: true, onRequestId: (id, ep) => ids.push([id, ep]) })
  assert.equal(sent.at(-1).endpoint, 'bytedance/seedance-2.5/reference-to-video')
  assert.equal(sent.at(-1).input.draft, true, 'the Draft flag rides the normal door')
  assert.equal(r.draftId, 'draft_abc', 'fal’s draft_id comes back with the video')
  await m.runRender({ ...base, engine: 'seedance25', mode: 'i2v', images: [img('start')], draft: true })
  assert.deepEqual([sent.at(-1).endpoint, sent.at(-1).input.draft], ['bytedance/seedance-2.5/image-to-video', true], 'every Seedance 2.5 door takes it')
  falReply = () => ({ video: { url: 'https://fixture.test/result.mp4' } })
  r = await m.runRender({ ...base, engine: 'seedance25', mode: 'ref2v', resolution: '1080p' })
  assert.ok(!('draft' in sent.at(-1).input) && r.draftId === undefined, 'a normal render says nothing about drafts')
  assert.equal(sent.at(-1).input.resolution, '1080p', '1080p is a normal size now')
  await m.runRender({ ...base, engine: 'seedance2', mode: 'ref2v', draft: true })
  assert.ok(!('draft' in sent.at(-1).input), 'no other engine is sent the flag')

  // the finish: the Draft's id and nothing else — no prompt, no refs, no uploads
  uploads.length = 0
  ids.length = 0
  r = await m.runRender({ ...base, engine: 'seedance25', mode: 'ref2v', prompt: '', images: [img('a')], videos: [img('v')], resolution: '1080p', draftId: 'draft_abc', onRequestId: (id, ep) => ids.push([id, ep]) })
  assert.deepEqual(sent.at(-1), { endpoint: 'bytedance/seedance-2.5/draft/complete', input: { draft_id: 'draft_abc', resolution: '1080p', codec: 'H264' } }, 'fal’s documented finish: the id, 1080p, a file that plays everywhere')
  assert.equal(m.FAL_DRAFT_COMPLETE, 'bytedance/seedance-2.5/draft/complete')
  assert.deepEqual(uploads, [], 'the finish uploads nothing')
  assert.deepEqual(ids, [['fal-req-1', 'bytedance/seedance-2.5/draft/complete']], 'crash recovery asks the finish door, not the render door')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'fixture video')
  assert.equal(r.draftId, undefined, 'the final is no draft')

  // ---- ModelArk: the same two steps on their task API ----
  const calls = []
  global.fetch = async (url, init = {}) => {
    const u = String(url)
    if (u === 'https://ark.example/out.mp4') return new Response('ark video')
    calls.push({ u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    if ((init.method ?? 'GET') === 'POST') return new Response(JSON.stringify({ id: 'cgt-task-9' }))
    return new Response(JSON.stringify({ id: 'cgt-task-9', status: 'succeeded', content: { video_url: 'https://ark.example/out.mp4' }, duration: 6 }))
  }
  const ark = { ...base, arkKey: 'ark-test', arkModel: 'dreamina-seedance-2-5-260901', engine: 'seedance25ark', mode: 'ref2v', images: [img('ref')] }
  r = await m.runArkRender({ ...ark, resolution: '1080p', draft: true })
  let body = calls.find((c) => c.method === 'POST').body
  assert.deepEqual([body.draft, body.resolution], [true, '480p'], 'a Draft is a normal task with the flag on, always 480p')
  assert.ok(body.content.some((c) => c.type === 'text') && body.content.some((c) => c.type === 'image_url'), 'the Draft carries the prompt and the refs')
  assert.equal(r.draftId, 'cgt-task-9', 'on ModelArk the Draft’s id is its task id')
  calls.length = 0
  r = await m.runArkRender({ ...ark, resolution: '1080p' })
  body = calls.find((c) => c.method === 'POST').body
  assert.ok(!('draft' in body) && body.resolution === '1080p' && r.draftId === undefined, 'a normal 1080p render')
  calls.length = 0
  r = await m.runArkRender({ ...ark, prompt: '', images: [], mode: 'i2v', resolution: '1080p', draftId: 'cgt-task-9' })
  body = calls.find((c) => c.method === 'POST').body
  assert.deepEqual(body, { model: 'dreamina-seedance-2-5-260901', content: [{ type: 'draft_task', draft_task: { id: 'cgt-task-9' } }], resolution: '1080p', watermark: false }, 'the finish names the Draft task and resends nothing: no prompt, refs, duration, ratio, seed or sound')
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'ark video')
  assert.equal(r.draftId, undefined)

  // ---- what a landed take remembers ----
  assert.deepEqual(m.draftOf({ draft: true }, 'draft_abc', 'fal', 5), { id: 'draft_abc', via: 'fal', at: 5 })
  assert.deepEqual(m.draftOf({ draft: true }, 'cgt-task-9', 'modelark', 5), { id: 'cgt-task-9', via: 'modelark', at: 5 })
  assert.equal(m.draftOf({ draft: true }, undefined, 'fal'), undefined, 'no id back = not a finishable draft')
  assert.equal(m.draftOf({}, 'x', 'fal'), undefined, 'a normal render')
  assert.equal(m.draftOf({ draft: true, draftId: 'x' }, 'y', 'fal'), undefined, 'the final is not a draft')
  assert.equal(m.draftOf({ draft: true }, 'x', 'venice'), undefined)

  // ---- the finish request is rebuilt from the take's own frozen recipe ----
  const snap = { engine: 'seedance25', mode: 'ref2v', freeform: 'a dancer turns', scene: { title: 's', referenceHandling: '', style: '', visualFeel: '' }, characters: [], beats: [{ text: 'b' }], production: { audioDesign: '', lighting: '', subtext: '', criticalConstraint: '', avoid: '' }, imageIds: ['i1', 'gone', 'i2'], videoRefs: [{ videoId: 'v1' }], duration: '6', resolution: '480p', draft: true, aspectRatio: '9:16', generateAudio: false, seed: 42 }
  const now = 100 * DAY
  const proj = { images: [{ id: 'i1', file: 'C:/p/images/i1.png' }, { id: 'i2', file: 'C:/p/images/i2.png' }], clips: [{ id: 'c1', name: 'the turn', takes: [
    { id: 't1', file: 't1.mp4', snapshot: snap, draft: { id: 'draft_abc', via: 'fal', at: now - 2 * DAY } },
    { id: 't2', file: 't2.mp4', snapshot: { ...snap, draft: undefined, resolution: '720p' } },
    { id: 't3', file: 't3.mp4', snapshot: snap, draft: { id: 'old', via: 'fal', at: now - 8 * DAY } },
    { id: 't4', file: 't4.mp4', snapshot: snap, draft: { id: 'cgt-1', via: 'modelark', at: now - DAY } }
  ] }] }
  const fin = m.draftFinishRequest(proj, { clipId: 'c1', takeId: 't1' }, now)
  assert.deepEqual(fin.req, { clipId: 'c1', name: 'the turn', engine: 'seedance25', mode: 'ref2v', prompt: '', freeform: 'a dancer turns', scene: snap.scene, characters: [], beats: snap.beats, production: snap.production, images: ['C:/p/images/i1.png', 'C:/p/images/i2.png'], endImage: undefined, videoRefs: snap.videoRefs, audioRefs: undefined, duration: '6', resolution: '1080p', aspectRatio: '9:16', generateAudio: false, seed: 42, promptLink: undefined, fieldLinks: undefined, fieldOverrides: undefined, characterLinks: undefined, draftId: 'draft_abc' }, 'the take’s recipe at 1080p, its refs as the Library’s own files, the Draft’s id')
  assert.match(m.draftFinishRequest(proj, { clipId: 'c1', takeId: 't2' }, now).error, /not a draft/)
  assert.match(m.draftFinishRequest(proj, { clipId: 'c1', takeId: 't3' }, now).error, /more than 7 days old — .* can no longer finish it\. Render it again\./)
  assert.match(m.draftFinishRequest(proj, { clipId: 'c1', takeId: 't4' }, now).error, /made on another account \(modelark\)/, 'a Draft finishes only where it was made')
  assert.match(m.draftFinishRequest(proj, { clipId: 'c1', takeId: 'nope' }, now).error, /that take is gone/)
  assert.match(m.draftFinishRequest(null, { clipId: 'c1', takeId: 't1' }, now).error, /that take is gone/)

  console.log('PASS Seedance 2.5 draft mode: 1080p on both rows; fal = the draft flag, draft_id back, the finish door sent only the id (1080p, H264, no uploads); ModelArk = draft at 480p, the finish names the task and resends nothing; a take keeps its draft id for 7 days, finishes only on its own account, from its own frozen recipe')
})().catch((e) => { console.error(e); process.exitCode = 1 })
