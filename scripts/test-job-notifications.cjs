// Fake providers and an isolated project. No network, downloads, GPU, or live app state.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-jobs-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = { name: 'raw', setup(b) {
  b.onResolve({ filter: /\?raw$/ }, a => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
  b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
} }
const ipc = new Map(), electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: {}, safeStorage: {}, nativeImage: {}, BrowserWindow: class {}, ipcMain: { handle: (n, f) => ipc.set(n, f), on: () => {} } }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const summary = r => ({ result: r, outputs: r.file ? [{ file: r.file }] : [] })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/jobNotifications'; export * from '${main}/appJobs'; export { runTool, runToolContent, setExchangeDir, setExchangeKeys } from '${main}/codir'; export * from '${main}/codirContinuation'; export { newProject, getProject, addImageGenTakes } from '${main}/project'; export { topazFilters } from '${main}/enhance'; export { toChatCompletions, toDeepseek } from '${main}/claudeWire'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports,fetch){' + out.outputFiles[0].text + '\n})')(n => n === 'electron' ? electron : n === './runtime' ? {} : n === '@fal-ai/client' ? { fal: { config() {} } } : require(n), mod, mod.exports, () => { throw Error('Network forbidden in this test') })
  const m = mod.exports
  let dir, clock = 0, enabled = true, recovered = [], cancels = []
  const service = () => new m.JobNotifications({ projectDir: () => dir, enabled: async () => enabled, now: () => clock,
    recover: async () => recovered, cancel: async j => cancels.push(j.id),
    notify: (d, s) => assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'codir-jobs.json'))), s, 'notification follows durable save') })
  const fresh = async (max = 10, exchanges = 4) => {
    dir = fs.mkdtempSync(path.join(tmp, 'case-')); clock = 0; enabled = true; recovered = []; cancels = []
    const j = service(), p = await j.propose({ text: 'Inspect pictures then decide the next step.', renders: [{ kind: 'clip', engine: 'fake', maxJobs: max, settings: { duration: '5' }, cost: 'fake, free' }], tools: ['fire_render'], maxExchanges: exchanges, aiRoute: 'fake', aiCost: 'fake, free' })
    await assert.rejects(j.approve(p.id, 'stale', 'fake'), /changed/)
    await j.approve(p.id, p.revision, 'fake')
    return j
  }
  const input = async j => ({ projectDir: dir, kind: 'clip', targetId: 'clip', engine: 'fake', label: 'Test clip', deadlineMs: 100, planId: (await j.read()).plan.id, request: { channel: 'render:run', args: [{ duration: '5', prompt: 'saved words' }] } })
  let j = await fresh(25), req = await input(j)
  const jobs = await j.addMany(Array.from({ length: 21 }, () => req))
  await assert.rejects(j.addMany(Array.from({ length: 5 }, () => req)), /count/)
  assert.equal((await j.read()).jobs.length, 21, 'a refused batch queues nothing')
  await assert.rejects(j.add({ ...req, engine: 'outside' }), /outside/)
  await assert.rejects(j.add({ ...req, request: { channel: 'render:run', args: [{ duration: '10' }] } }), /setting/)
  await j.wait(jobs.map(x => x.id), 'Inspect all 21 first.')
  assert.equal(await j.nextPing('fake'), null)
  for (const job of jobs) await j.execute(job, async () => ({ ok: true, file: job.id + '.mp4' }), summary)
  const ping = await j.nextPing('fake')
  assert.equal(ping.jobs.length, 21); assert.equal(ping.plan.progress, 'Inspect all 21 first.')
  const version = await j.beginPing(ping.plan.id)
  await j.progress('Inspected results and selected a narrative.', false); await j.endPing(ping.plan.id, version)
  assert.equal((await j.read()).plan.noProgress, 0)
  await j.progress('Finished.', true); assert.equal(await j.nextPing('fake'), null)
  const savedOutputs = jobs[0].outputs
  await j.finish(jobs[0], { ok: true, file: 'duplicate' }, [{ file: 'duplicate' }]); assert.deepEqual(jobs[0].outputs, savedOutputs)
  console.log('PASS 21 jobs, atomic batch refusal, scopes, durable outputs and Co-Di progress')

  j = await fresh(); let job = await j.add(await input(j))
  await j.execute(job, async () => ({ ok: false, error: 'Supplier explicitly rejected the request' }), summary)
  await j.retryFailed(job); assert.equal(job.status, 'queued'); assert.equal(job.attempt, 2)
  await j.execute(job, async () => ({ ok: false, error: 'Supplier explicitly rejected the request again' }), summary)
  await j.retryFailed(job); assert.equal((await j.read()).plan.status, 'blocked'); assert.match((await j.read()).plan.reason, /failed twice/)
  assert.equal(job.request.args[0].prompt, 'saved words')
  j = await fresh(); job = await j.add(await input(j))
  await j.execute(job, async () => ({ ok: false, error: 'network timeout after submission' }), summary)
  await j.retryFailed(job); assert.equal(job.status, 'lost'); assert.equal(job.attempt, 1)
  console.log('PASS one frozen retry; second failure blocks; uncertain submissions never retry')

  j = await fresh(); job = await j.add(await input(j)); const pending = await j.add(await input(j))
  const hold = deferred(), entered = deferred()
  const execution = j.execute(job, async () => { entered.resolve(); return hold.promise }, summary)
  await entered.promise; clock = 101; await j.settleInterrupted()
  assert.equal(job.status, 'lost'); assert.equal(pending.status, 'cancelled'); assert.ok(await j.nextPing('fake'))
  assert.deepEqual(cancels, [job.id])
  hold.resolve({ ok: true, file: 'late.mp4' }); await execution
  assert.equal(job.status, 'lost'); assert.equal(job.late, true); assert.equal(job.outputs[0].file, 'late.mp4')
  console.log('PASS a never-returning provider expires, pings and cancels pending work; late output stays late')

  j = await fresh(); job = await j.add(await input(j)); job.attempt = 1; job.status = 'running'; await j.save(dir)
  recovered = [{ file: 'already-landed.mp4', id: 'take' }]
  let restarted = service(); await restarted.settleInterrupted()
  assert.equal((await restarted.read()).jobs[0].status, 'done', 'recover project provenance without resubmission')
  j = await fresh(); job = await j.add(await input(j)); job.status = 'running'; await j.save(dir)
  restarted = service(); await restarted.settleInterrupted(); assert.equal((await restarted.read()).jobs[0].status, 'lost')
  j = await fresh(); job = await j.add(await input(j)); const gpu = deferred(), waiting = deferred(); let fired = false
  const waitRun = j.execute(job, async () => { await m.jobGpuWaiting(); waiting.resolve(); await gpu.promise; await m.jobGpuStarting(); fired = true; return { ok: true } }, summary)
  await waiting.promise; await j.stop(); gpu.resolve(); await assert.rejects(waitRun, /cancelled/); assert.equal(fired, false)
  j = await fresh(); job = await j.add(await input(j)); dir = fs.mkdtempSync(path.join(tmp, 'other-'))
  await assert.rejects(j.execute(job, async () => { throw Error('must not dispatch') }, summary), /project changed/)
  console.log('PASS restart reconciliation, stop during GPU wait and project isolation')

  j = await fresh(); for (let i = 0; i < 2; i++) { const p = await j.nextPing('fake'); const v = await j.beginPing(p.plan.id); await j.endPing(p.plan.id, v) }
  assert.equal(await j.nextPing('fake'), null); assert.match((await j.read()).plan.reason, /No saved progress/)
  j = await fresh(10, 1); let p = await j.nextPing('fake'); await j.beginPing(p.plan.id); assert.equal(await j.nextPing('fake'), null)
  j = await fresh(); assert.equal(await j.nextPing('changed-model'), null); assert.equal((await j.read()).plan.status, 'blocked')
  const lane = new m.CodirExchanges(), order = [], gate = deferred()
  const a = lane.enqueue('user', async () => { order.push('user1'); await gate.promise })
  const b = lane.enqueue('job', async () => order.push('ping'))
  const c = lane.enqueue('user', async () => order.push('user2'))
  gate.resolve(); await Promise.all([a, b, c]); assert.deepEqual(order, ['user1', 'user2', 'ping'])
  console.log('PASS bounded continuations, route change and user-message priority')

  // Actual app job registry, Co-Di tools and project landing code, with fake render handlers.
  await m.newProject(tmp, 'integration'); const project = () => m.getProject()
  m.setExchangeDir(project().dir); m.setExchangeKeys({ fire: true, userText: 'app completion' }); m.setContinuationContext(null, 'fake', 'fake/free')
  const records = m.configureAppJobs({ enabled: async () => true, notify() {}, cancel: async () => true })
  const run = (name, input) => m.runTool(name, input, () => {})
  const genId = (await run('create_image_gen', { name: 'Pictures', prompt: 'original' })).match(/image_gen_id=(\S+)/)[1]
  project().imageGens[0].recipe.model = 'fake-image'; project().imageGens[0].recipe.batch = 1
  const saved = await run('save_work_plan', { plan: 'Make 21 pictures, inspect all, then write a narrative and make two related 5s clips at 480p.', renders: [{ kind: 'image_gen', engine: 'fake-image', max_jobs: 22, settings: { 'recipe.batch': 1 }, cost: 'fake/free' }, { kind: 'clip', engine: 'h3local', max_jobs: 2, settings: { duration: '5', resolution: '480p' }, cost: 'fake provider/free' }], tools: ['fire_render', 'set_image_gen_prompt', 'image_gen_take_to_library', 'create_clip', 'set_clip_fields', 'set_clip_refs', 'set_clip_settings'], max_exchanges: 4 })
  assert.match(saved, /^PLAN SAVED/)
  p = (await records.read()).plan; await records.approve(p.id, p.revision, 'fake'); m.setContinuationContext(p.id, 'fake', 'fake/free')
  m.registerJobIpc('imagegen:render', async (_e, r) => {
    const file = path.join(project().dir, 'images', r.jobId + '.png'); fs.writeFileSync(file, png)
    const out = await m.addImageGenTakes(r.imageGenId, [{ file, seed: r.recipe.seed, width: 1, height: 1, promptSent: r.recipe.prompt, snapshot: r.recipe }])
    return { ok: true, delta: out.delta, takeIds: out.takeIds }
  })
  assert.match(await run('fire_render', { kind: 'image_gen', id: genId, prompts: Array.from({ length: 21 }, (_, i) => 'Picture ' + i) }), /^queued 21/)
  const listed = (await records.read()).jobs
  await run('wait_for_jobs', { job_ids: listed.map(j => j.id), progress: 'Inspect pictures before writing the story.' })
  const sender = { isDestroyed: () => false, send() {} }
  for (let i = 0; i < 21; i++) await m.dispatchCodirJobs(sender)
  assert.equal((await records.nextPing('fake')).jobs.length, 21)
  let wakes = 0
  const scheduler = new m.CodirExchanges(), manual = deferred(), busyEntered = deferred()
  const human = scheduler.enqueue('user', async () => { busyEntered.resolve(); await manual.promise })
  const pump = m.createJobPump({ exchanges: scheduler, route: async () => 'fake', sender: () => sender, continue: async (plan, results) => { wakes++; assert.equal(plan.id, p.id); assert.equal(results.length, 21); await records.progress('Review every generated picture.', false) } })
  await busyEntered.promise; await pump(); assert.equal(wakes, 0)
  manual.resolve(); await human; await new Promise(r => setImmediate(r))
  await Promise.all([pump(), pump()]); assert.equal(wakes, 1, 'one fresh continuation, after the user, despite simultaneous polls')
  assert.equal(project().imageGens[0].takes.length, 21)
  assert.ok(listed.every(j => j.status === 'done' && j.outputs.length === 1))
  assert.ok(project().imageGens[0].takes.every(t => listed.some(j => j.id === t.appJobId)))
  assert.equal((await records.read()).jobs.length, 21, 'completion itself does not invent child renders')
  let inspected = 0
  for (let i = 0; i < 21; i += 4) {
    const pictures = await m.runToolContent('read_object', { id: genId, image_files: project().imageGens[0].takes.slice(i, i + 4).map(t => t.file) }, () => {})
    assert.ok(pictures.images.length); inspected += pictures.images.length
    assert.equal(pictures.images[0].data, png.toString('base64'))
  }
  assert.equal(inspected, 21)
  assert.match((await m.runToolContent('read_object', { id: genId, image_files: [path.join(tmp, 'private')] }, () => {})).text, /^ERROR/)
  assert.match(await run('set_timeline_clips', {}), /does not authorize/)
  await run('image_gen_take_to_library', { image_gen_id: genId, take: 1 })
  const im = project().images.at(-1)
  assert.ok(im)
  const clip = (await run('create_clip', { name: 'Story from inspected pictures' })).match(/clip_id=(\S+)/)[1]
  assert.ok(!(await run('set_clip_fields', { clip_id: clip, engine: 'h3local', duration: '5', freeform: 'The inspected subject moves through a shared surreal narrative.' })).startsWith('ERROR'))
  assert.ok(!(await run('set_clip_settings', { clip_id: clip, resolution: '480p', mode: 'ref2v' })).startsWith('ERROR'))
  await run('set_clip_refs', { clip_id: clip, image_titles: [im.title] })
  assert.match(await run('fire_render', { kind: 'clip', id: clip }), /^queued 1/)
  assert.match(await run('fire_render', { kind: 'clip', id: clip }), /^queued 1/)
  const clips = (await records.read()).jobs.filter(j => j.kind === 'clip')
  assert.equal(clips.length, 2); assert.notEqual(clips[0].id, clips[1].id)
  assert.equal(clips[0].request.args[0].images[0], im.file)
  assert.equal(clips[0].request.args[0].duration, '5'); assert.equal(clips[0].request.args[0].resolution, '480p')
  m.registerJobIpc('render:run', async (_e, r) => ({ ok: true, file: path.join(tmp, r.jobId + '.mp4') }))
  await m.dispatchCodirJobs(sender); await m.dispatchCodirJobs(sender)
  await records.progress('All pictures inspected; both narrative clips finished.', true)
  console.log('PASS Co-Di wakes after 21 pictures, inspects all, then writes and queues two distinct 5s/480p clips')

  m.setContinuationContext(null, '', '')
  for (const [channel, kind] of Object.entries(m.JOB_CHANNELS)) {
    m.registerJobIpc(channel, async () => ({ ok: true, file: path.join(tmp, kind + '.out') }))
    await ipc.get(channel)({ sender }, { engine: 'any-model' })
    const last = (await records.read()).jobs.at(-1)
    assert.equal(last.kind, kind); assert.equal(last.engine, 'any-model'); assert.equal(last.status, 'done')
  }
  await m.observeEncode('effects', async () => ({ id: 'encode' })); await records.settleInterrupted()
  assert.equal((await records.read()).jobs.at(-1).status, 'running')
  await m.finishEncode('encode', true, { ok: true, file: 'effect.mp4' }); assert.equal((await records.read()).jobs.at(-1).status, 'done')
  await assert.rejects(m.observeEncode('failed encoder', async () => { throw Error('Encoder unavailable') }), /unavailable/)
  assert.equal((await records.read()).jobs.at(-1).status, 'failed')
  const src = fs.readFileSync(path.join(main, 'index.ts'), 'utf8') + fs.readFileSync(path.join(main, 'watchIpc.ts'), 'utf8')
  for (const channel of Object.keys(m.JOB_CHANNELS)) assert.ok(new RegExp("registerJobIpc\\(\\s*'" + channel + "'").test(src), 'actual registration: ' + channel)
  console.log('PASS every registered result route and streaming encode use the shared completion protocol')

  const imageBlock = { type: 'image', source: { media_type: 'image/png', data: png.toString('base64') } }
  const body = { model: 'test', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read', content: [{ type: 'text', text: 'picture' }, imageBlock] }] }] }
  assert.equal(m.toChatCompletions(body).messages.at(-1).content[0].type, 'image_url')
  assert.ok(!JSON.stringify(m.toDeepseek({ ...body, model: 'deepseek-v4-pro' })).includes(png.toString('base64')))
  assert.match(m.topazFilters({ fps: 24, w: 640, h: 360 }, undefined, { engine: 'topaz-local', model: 'prob-4', scale: 2 }, false), /download=0/)
  console.log('PASS tool pictures on both API wire formats and no Topaz model downloads in an approved plan')
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { /* preserve temp evidence on failure */ })
