// list 9 / 50 (2026-09-30) — Image Edit through a Bridge login (Higgsfield, Runway, Pika), on that
// plan's credits. The real bridge manager, MCP client and image lane run here; each supplier's
// server is a stand-in that answers with the reply shapes captured from the two real test pictures
// of that day (Higgsfield and Runway; Pika's are from its own tool notes — its login had no
// credits to test with). Nothing leaves this machine.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bridge-image-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
let baseSize = { width: 1024, height: 1024 }
const electron = {
  app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, getSize: () => baseSize }) }
}
const runtime = { streamBodyToFile: async (body, file) => { const buf = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, buf); return buf.length } }
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export { initBridge } from '${main}/bridge'; export { runBridgeImage, bridgeRatio, imageUrlIn } from '${main}/providers/mcp/bridgeImage'; export { IMAGE_MODELS } from '${ui}/shared/imageModels'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  const quiet = console.log
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
  const m = mod.exports

  // ---- the ratio a supplier is sent ----
  const R = (aspectRatio, aspects, extra = {}, size) => m.bridgeRatio({ service: 'runway', label: 'Nano Banana Pro', aspects, aspectRatio, baseImage: 'b.png', ...extra }, size)
  assert.equal(R('16:9', ['auto', '16:9', '1:1']), '16:9', 'his pick goes as picked')
  assert.throws(() => R('3:2', ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']), /^Error: Nano Banana Pro on Runway takes 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 — pick one of those \(nothing was spent\)$/)
  assert.equal(R('auto', ['auto', '16:9']), 'auto', 'a supplier with its own auto matches the base itself')
  assert.equal(R('auto', undefined), 'auto')
  assert.equal(R('auto', ['1:1', '16:9', '9:16', '4:3', '3:4'], {}, { width: 1920, height: 1080 }), '16:9', 'no auto there: the nearest ratio to the base image')
  assert.equal(R('auto', ['1:1', '16:9', '9:16', '4:3', '3:4'], {}, { width: 1000, height: 1300 }), '3:4')
  assert.equal(R('16:9', ['auto', '16:9'], { maskImage: 'm.png' }), 'auto', 'a selection keeps the base image’s own shape')
  assert.equal(m.bridgeRatio({ service: 'pika', label: 'x', aspectRatio: 'auto' }), undefined, 'nothing to match on a picture made from words')

  // ---- the stand-in suppliers (MCP over HTTP), uploads and downloads ----
  const URLS = { 'https://mcp.higgsfield.ai/mcp': 'higgsfield', 'https://mcp.runwayml.com/mcp': 'runway', 'https://mcp.pika.me/api/mcp': 'pika' }
  const calls = [], puts = [], gets = []
  let answer = () => ({})
  const rpc = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'Content-Type': 'application/json' } })
  const said = (o, text = '') => ({ structuredContent: o, content: [{ type: 'text', text: JSON.stringify(o) }, ...(text ? [{ type: 'text', text }] : [])] })
  global.fetch = async (url, init = {}) => {
    const u = String(url), svc = URLS[u]
    if (svc) {
      const msg = JSON.parse(init.body)
      if (msg.method === 'initialize') return rpc(msg.id, { serverInfo: { name: svc } })
      if (!('id' in msg)) return new Response(null, { status: 202 })
      if (msg.method === 'tools/list') return rpc(msg.id, { tools: [{ name: 'generate_image' }, { name: 'generate_image_edit' }] })
      const { name, arguments: args } = msg.params
      if (/balance|plans_and_credits/.test(name)) return rpc(msg.id, said({ credits: 100 }))
      calls.push([svc, name, args])
      return rpc(msg.id, answer(svc, name, args))
    }
    if (init.method === 'PUT') { puts.push(u); return new Response('', { status: 200, headers: { etag: '"etag-1"' } }) }
    gets.push(u)
    return new Response(PNG, { status: 200, headers: { 'content-length': String(PNG.length) } })
  }
  console.log = () => {} // the manager logs every line of the conversation
  const login = { accessToken: 'T', authorizationEndpoint: 'x', tokenEndpoint: 'x', clientId: 'c', resource: 'r' }
  await m.initBridge({ load: async () => JSON.stringify({ higgsfield: login, runway: login }), save: async () => {} }, () => {})
  await new Promise((r) => setTimeout(r, 50))
  const base = path.join(tmp, 'base.png'), ref = path.join(tmp, 'ref.jpg')
  fs.writeFileSync(base, PNG); fs.writeFileSync(ref, PNG)
  const outDir = path.join(tmp, 'edits')
  const reset = () => { calls.length = 0; puts.length = 0; gets.length = 0 }
  const notes = []
  const run = (o) => m.runBridgeImage({ label: 'Nano Banana 2', prompt: 'make the sky red', refImages: [], numImages: 1, aspectRatio: 'auto', resolution: '1K', outDir, onProgress: (x) => notes.push(x), ...o })

  // ---- Higgsfield: its real replies from the test picture of 09-30 ----
  const HF_RESULT = 'https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260930_121058_00dc8efd.png'
  answer = (svc, name, args) => {
    if (name === 'media_upload') return said({ uploads: [{ upload_url: `https://upload.higgsfield.ai/user_x/${args.filename}?X-Amz-Signature=s`, media_id: `media-${args.filename}` }] })
    if (name === 'media_confirm') return said({ results: [{ media_id: args.media_id, status: 'uploaded' }] })
    if (name === 'generate_image') return said({ results: [{ id: '00dc8efd-b636-41e6-b33f-07818b36328a', type: 'image', status: 'pending', model: 'nano_banana_flash', params: { prompt: args.params.prompt } }] }, 'Submitted 1 job.')
    if (name === 'job_status') return said({ generation: { id: args.jobId, type: 'image', status: 'completed', params: { medias: [{ role: 'image', data: { id: 'media-base.png', type: 'media_input', url: 'https://d2ol7oe51mr4n9.cloudfront.net/user_x/input-base.png' } }], width: 1024, height: 1024 }, results: { rawUrl: HF_RESULT, minUrl: HF_RESULT.replace('.png', '_min.webp') } } }, `Job ${args.jobId} — completed\n${HF_RESULT}`)
  }
  reset()
  let r = await run({ service: 'higgsfield', slug: 'nano_banana_2', baseImage: base, refImages: [ref] })
  assert.deepEqual(calls.map((c) => c[1]), ['media_upload', 'media_confirm', 'media_upload', 'media_confirm', 'generate_image', 'job_status'])
  assert.deepEqual(calls[4][2], { params: { model: 'nano_banana_2', prompt: 'make the sky red', count: 1, use_unlim: false, aspect_ratio: 'auto', resolution: '1k', medias: [{ value: 'media-base.png', role: 'image_references' }, { value: 'media-ref.jpg', role: 'image_references' }] } }, 'Higgsfield: their model id, credits never unlimited, their lowercase size, the base first then the refs')
  assert.deepEqual(calls[5][2], { jobId: '00dc8efd-b636-41e6-b33f-07818b36328a', sync: true })
  assert.deepEqual(gets, [HF_RESULT], 'the RESULT is downloaded — never the input image its reply also names, never the thumbnail')
  assert.ok(r.files.length === 1 && r.files[0].endsWith('.png') && fs.readFileSync(r.files[0]).equals(PNG))
  assert.equal(puts.length, 2)

  // Higgsfield's Pro has no auto ratio: the nearest one to the base image goes instead
  reset(); baseSize = { width: 1920, height: 1080 }
  await run({ service: 'higgsfield', slug: 'nano_banana_pro', label: 'Nano Banana Pro', baseImage: base, resolution: '2K', aspects: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] })
  assert.equal(calls.find((c) => c[1] === 'generate_image')[2].params.aspect_ratio, '16:9')
  assert.equal(calls.find((c) => c[1] === 'generate_image')[2].params.resolution, '2k')
  assert.ok(!calls.some((c) => c[1] === 'media_upload'), 'an image already sent this session is not sent twice')
  baseSize = { width: 1024, height: 1024 }

  // ---- Runway: its real replies from the test picture of 09-30 (a finished task has no status field) ----
  const RW_RESULT = 'https://dnznrvs05pmza.cloudfront.net/gemini/images/8c7950ca/Change_the_background.png?_jwt=abc.def'
  let polls = 0
  answer = (svc, name, args) => {
    if (name === 'init_upload') return said({ kind: 'upload_initialized', uploadId: 'up-1', numberOfParts: 1, uploadUrls: ['https://runway-datasets.s3.us-east-1.amazonaws.com/datasets/x.png?X-Amz-Signature=s'] })
    if (name === 'complete_upload') return said({ kind: 'upload_complete', assetUrl: 'https://d2jqrm6oza8nb6.cloudfront.net/datasets/x.png?_jwt=tok' })
    if (name === 'generate_image') return said({ kind: 'task_pending', taskId: '8c7950ca-16ea-4779-b583-95dd8c17dcf6', outputKind: 'image', creditsRemaining: 216 }, 'Task accepted')
    if (name === 'get_task') return ++polls < 2 ? said({ kind: 'task_pending', taskId: args.id, status: 'RUNNING', progressPercent: 10 }, 'status: RUNNING (10%)') : said({ kind: 'image', url: RW_RESULT, taskId: args.id, prompt: 'x', meta: { resolution: '1K' } }, `Task ${args.id} succeeded.`)
  }
  reset()
  const realSetTimeout = global.setTimeout
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 5), ...a) // the poll waits, shortened
  r = await run({ service: 'runway', slug: 'nano-banana-2', baseImage: base, refImages: [ref], aspects: ['auto', '16:9', '1:1'] })
  assert.deepEqual(calls.map((c) => c[1]), ['init_upload', 'complete_upload', 'init_upload', 'complete_upload', 'generate_image', 'get_task', 'get_task'])
  assert.deepEqual(calls[1][2], { uploadId: 'up-1', parts: [{ partNumber: 1, etag: 'etag-1' }] })
  assert.deepEqual(calls[4][2], { rationale: 'Image Edit in Video Dancer: the user pressed render on this exact prompt', model: 'nano-banana-2', promptText: 'make the sky red', count: 1, ratio: 'auto', imageSize: '1K', referenceImages: [{ url: 'https://d2jqrm6oza8nb6.cloudfront.net/datasets/x.png?_jwt=tok', tag: 'input' }, { url: 'https://d2jqrm6oza8nb6.cloudfront.net/datasets/x.png?_jwt=tok', tag: 'ref1' }] }, 'Runway: the image being edited first, tagged input')
  assert.deepEqual(gets, [RW_RESULT], 'the whole signed link is fetched')
  assert.ok(notes.includes('Runway: running…'))
  // a selection: the region line rides after his prompt, and the base keeps its shape
  reset(); polls = 5
  await run({ service: 'runway', slug: 'nano-banana-2', baseImage: base, maskImage: base, aspectRatio: '16:9', aspects: ['auto', '16:9'] })
  const sel = calls.find((c) => c[1] === 'generate_image')[2]
  assert.ok(sel.promptText.startsWith('make the sky red\n\nEdit only inside the red outline.') && sel.ratio === 'auto')
  // several variants = several calls, one upload
  reset(); polls = 5
  r = await run({ service: 'runway', slug: 'nano-banana-2', numImages: 3, aspectRatio: '1:1', aspects: ['auto', '1:1'] })
  assert.equal(calls.filter((c) => c[1] === 'generate_image').length, 3)
  assert.equal(r.files.length, 3)
  assert.ok(!('referenceImages' in calls.find((c) => c[1] === 'generate_image')[2]), 'words only: no images sent')
  // a ratio the supplier can't take is refused BEFORE anything is sent
  reset()
  await assert.rejects(run({ service: 'runway', slug: 'nano-banana-pro', label: 'Nano Banana Pro', baseImage: base, aspectRatio: '3:2', aspects: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }), /pick one of those \(nothing was spent\)/)
  assert.equal(calls.length + puts.length, 0)
  // a failed task and a plan gate come back in plain words
  reset(); answer = (svc, name) => (name === 'generate_image' ? said({ error: 'paid_plan_required' }) : said({}))
  await assert.rejects(run({ service: 'runway', slug: 'gpt-image-2', label: 'GPT Image 2' }), /^Error: error @ runway\/generate_image: Runway says GPT Image 2 needs a paid plan on that account$/)
  answer = (svc, name, args) => (name === 'generate_image' ? said({ taskId: '8c7950ca-16ea-4779-b583-95dd8c17dcf6' }) : said({ taskId: args.id, status: 'FAILED', message: 'Content moderation rejected the prompt' }))
  await assert.rejects(run({ service: 'runway', slug: 'nano-banana-2' }), /^Error: error @ runway\/job: failed: Content moderation rejected the prompt/)
  // audit 2026-10-09 H5: THROTTLED = Runway took it and waits for a slot: polled on, never a failure
  reset(); polls = 0
  answer = (svc, name, args) => (name === 'generate_image' ? said({ taskId: 't-throttled' }) : ++polls < 3 ? said({ taskId: args.id, status: 'THROTTLED' }) : said({ kind: 'image', url: RW_RESULT, taskId: args.id }))
  r = await run({ service: 'runway', slug: 'nano-banana-2' })
  assert.equal(r.files.length, 1, 'a throttled task is waited for and lands')
  assert.equal(calls.filter((c) => c[1] === 'generate_image').length, 1, 'and is never sent twice')
  // audit 2026-10-09 H11: a reply that reads like a job was made, in a shape the hunter does not know,
  // is never answered by sending the same generate call again
  reset()
  answer = (svc, name) => (name === 'generate_image' ? said({ kind: 'task_pending', ref: 'r-77', status: 'PENDING' }, 'Task accepted') : said({}))
  await assert.rejects(run({ service: 'runway', slug: 'nano-banana-2' }), /reads like runway took the job, but it carries no job id the app knows, so it is not sent again/)
  assert.equal(calls.filter((c) => c[1] === 'generate_image').length, 1, 'one generate call, no resend')

  // ---- not logged in: said before anything is sent ----
  reset()
  await assert.rejects(run({ service: 'pika', slug: 'nano-banana-2', baseImage: base }), /^Error: not logged in to Pika — Bridge panel$/)
  assert.equal(calls.length, 0)

  // ---- Pika (its own tool notes; unproven live): the edit tool with images, the plain one without, its cost gate ----
  await m.initBridge({ load: async () => JSON.stringify({ pika: login }), save: async () => {} }, () => {})
  await new Promise((r) => realSetTimeout(r, 50))
  const PK_RESULT = 'https://cdn.pika.art/out/abc.webp'
  let gated = true
  answer = (svc, name, args) => {
    if (name === 'upload_asset') return said({ presigned_url: 'https://pika-uploads.s3.amazonaws.com/a?sig=s', public_url: `https://cdn.pika.art/in/${args.filename}`, already_uploaded: false })
    if (name === 'generate_image_edit' || name === 'generate_image') {
      if (gated && !args.confirm_token) return said({ status: 'cost_confirmation_required', estimated_credits: 4, confirm_token: 'tok-9' })
      return said({ task_id: 'task-1', status: 'running' })
    }
    if (name === 'task_status') return said({ task_id: args.task_id, status: 'completed', url: PK_RESULT, urls: [PK_RESULT] })
  }
  reset()
  r = await run({ service: 'pika', slug: 'nano-banana-2', baseImage: base, resolution: '2K' })
  assert.deepEqual(calls.map((c) => c[1]), ['upload_asset', 'generate_image_edit', 'generate_image_edit', 'task_status'])
  assert.deepEqual(calls[1][2], { provider: 'nano-banana-2', prompt: 'make the sky red', background: true, aspect_ratio: 'auto', resolution: '2K', images: ['https://cdn.pika.art/in/base.png'] })
  assert.deepEqual(calls[2][2], { ...calls[1][2], confirm_token: 'tok-9' }, 'their cost gate: the same request again with their token, once (his press was the ok)')
  assert.deepEqual(gets, [PK_RESULT])
  assert.ok(r.files[0].endsWith('.webp'))
  reset(); gated = false
  await run({ service: 'pika', slug: 'nano-banana-pro', aspectRatio: '1:1' })
  assert.deepEqual(calls.map((c) => c[1]), ['generate_image', 'task_status'], 'no image = their plain generate tool')
  assert.deepEqual(calls[0][2], { provider: 'nano-banana-pro', prompt: 'make the sky red', background: true, aspect_ratio: '1:1', resolution: '1K' })
  global.setTimeout = realSetTimeout
  console.log = quiet

  // ---- the rows Image Edit offers ----
  const rows = (id) => m.IMAGE_MODELS.find((x) => x.id === id).vias.filter((v) => v.bridge)
  assert.deepEqual(rows('nano-banana-2').map((v) => [v.label, v.bridge, v.slug]), [['Higgsfield Bridge', 'higgsfield', 'nano_banana_2'], ['Runway Bridge', 'runway', 'nano-banana-2'], ['Pika Bridge', 'pika', 'nano-banana-2']])
  assert.deepEqual(rows('nano-banana-pro').map((v) => v.slug), ['nano_banana_pro', 'nano-banana-pro', 'nano-banana-pro'])
  assert.deepEqual(rows('seedream-5-pro').map((v) => v.slug), ['seedream_v5_pro', 'seedream-5-pro', 'seedream-pro'])
  assert.deepEqual(rows('seedream-5-flash').map((v) => v.slug), ['seedream_5_0_flash'])
  for (const id of ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) assert.equal(rows(id).length, 0, 'a model that needs a real mask stays off the bridges')
  for (const mdl of m.IMAGE_MODELS) for (const v of mdl.vias.filter((x) => x.bridge)) {
    assert.equal(v.price({ refs: 3 }), 0, 'a bridge row never counts dollars')
    assert.ok(v.ready && v.resolutions.length)
  }
  const hf = rows('nano-banana-2')[0], rw = rows('nano-banana-2')[1]
  assert.deepEqual(['1K', '2K', '4K'].map((resolution) => hf.credits({ resolution })), [1.5, 2, 3], 'Higgsfield’s own cost check, read 09-30')
  assert.equal(rw.credits({ resolution: '1K' }), 7, 'what Runway took for the test picture')
  assert.equal(rw.credits({ resolution: '4K' }), undefined, 'a cost nobody stated is not guessed')

  console.log('PASS bridge image lane: Higgsfield, Runway and Pika each get their own request shape (model id, size, ratio, the base first), uploads ride their own upload tools once, the RESULT link is the one fetched (never the input image), a finished Runway task reads with no status field, Pika’s cost gate is confirmed once, a ratio a supplier can’t take is refused before anything is sent, a selection adds the region line; rows on Nano Banana 2 / Pro and Seedream 5.0, never on a mask model; credits where the supplier states them')
})().catch((e) => { console.error(e); process.exitCode = 1 })
