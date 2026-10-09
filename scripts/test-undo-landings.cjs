// Audit 2026-10-09 batch 4: deletes and undo. The real project code in a temp project; nothing else.
// H15 a result that lands in the background (a render's take, a recovered job) is no undo step: Ctrl+Z
//     never takes it away, and redo survives it. M29 the timeline in view is no undo step. L3 undo
//     and redo carry no global switch a failed save could leave stuck. H2 deletes keep the files, so
//     Ctrl+Z brings them back whole. L4 Cleanup keeps a live take's reversed copy.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-undo-'))
  let failWrites = false
  const io = { ...fs, writeFile: async (...a) => { if (failWrites && String(a[0]).endsWith('project.json.tmp')) throw new Error('simulated disk full'); return fs.writeFile(...a) } }
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export * from './src/main/project'; export { JobNotifications } from './src/main/jobNotifications'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'fs/promises' ? io : appRequire(n)), mod, mod.exports)
  const p = mod.exports
  const proj = await p.newProject(temp, 'Undo')
  await p.openProject(proj.dir)
  const cur = () => p.getProject()
  const media = async (name) => { const f = path.join(proj.dir, 'renders', name); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, 'x'); return f }
  const exists = (f) => fs.access(f).then(() => true, () => false)
  const takeIds = () => cur().clips.flatMap((c) => c.takes.map((t) => t.file))

  // ---- H15: a render lands between two edits; Ctrl+Z undoes the edits, never the take ----
  await p.renameCurrentProject('one')
  const f1 = await media('t1.mp4')
  const landed = await p.asLanding(() => p.addTake({ name: 'Roof', promptData: p.emptyPromptData(), takeFile: f1 }))
  await p.renameCurrentProject('two')
  await p.undo()
  assert.equal(cur().name, 'one'); assert.deepEqual(takeIds(), [f1], 'Ctrl+Z undoes the edit, the take stays')
  await p.undo()
  assert.equal(cur().name, 'Undo'); assert.deepEqual(takeIds(), [f1], 'even the snapshot from before it landed gets it back')
  await p.redo(); await p.redo()
  assert.equal(cur().name, 'two'); assert.deepEqual(takeIds(), [f1], 'redo runs as before')
  // a take he deletes himself is a step: undo brings it back, redo takes it again (never resurrected)
  await p.deleteTake(landed.clipId, landed.takeId)
  assert.deepEqual(takeIds(), [])
  await p.undo(); assert.deepEqual(takeIds(), [f1])
  await p.redo(); assert.deepEqual(takeIds(), [], 'his own delete stays deleted on redo')
  await p.undo()
  // a landing never wipes redo
  await p.renameCurrentProject('three'); await p.undo()
  const f2 = await media('t2.mp4')
  await p.asLanding(() => p.addTake({ clipId: landed.clipId, name: 'Roof', promptData: p.emptyPromptData(), takeFile: f2 }))
  await p.redo()
  assert.equal(cur().name, 'three', 'redo survives a landing'); assert.deepEqual(takeIds(), [f1, f2])
  // the same through a real render job (a job of kind clip is a landing)
  const jobs = new p.JobNotifications({ projectDir: () => proj.dir, enabled: async () => true, notify() {}, cancel: async () => {}, recover: async () => [] })
  const job = await jobs.add({ projectDir: proj.dir, kind: 'clip', targetId: '', engine: 'x', label: 'x', deadlineMs: 60000 })
  const f3 = await media('t3.mp4')
  await jobs.execute(job, () => p.addTake({ clipId: landed.clipId, name: 'Roof', promptData: p.emptyPromptData(), takeFile: f3 }), () => ({ result: { ok: true }, outputs: [] }))
  await p.renameCurrentProject('four'); await p.undo(); await p.undo()
  assert.ok(takeIds().includes(f3), 'a take a render job landed survives Ctrl+Z')
  console.log('PASS H15: a render that lands is no undo step; Ctrl+Z keeps it, redo survives it, his own deletes stay his')

  // ---- M29: the timeline in view is no undo step and never wipes redo ----
  await p.renameCurrentProject('five')
  const added = await p.addTimeline('Second')
  const first = cur().timelines.find((t) => t.id !== added.timelineId).id
  await p.renameCurrentProject('six'); await p.undo() // redo now holds 'six'
  await p.setActiveTimeline(first)
  await p.redo()
  assert.equal(cur().name, 'six', 'switching timelines kept redo')
  assert.equal(cur().activeTimelineId, first, 'and undo/redo keep the timeline in view')
  await p.undo(); assert.equal(cur().activeTimelineId, first)
  console.log('PASS M29: switching timelines is no undo step, keeps redo, and undo never flips the timeline in view')

  // ---- L3: a save that fails during Ctrl+Z leaves history working ----
  await p.renameCurrentProject('seven')
  failWrites = true
  await p.undo().catch(() => undefined)
  failWrites = false
  await p.renameCurrentProject('eight')
  await p.undo()
  assert.notEqual(cur().name, 'eight', 'the next edit was still recorded as a step')
  console.log('PASS L3: a failed save during undo leaves history on')

  // ---- H2: the four deletes keep the files; Ctrl+Z brings them back whole ----
  const g1 = await media('gen1.png'), n1 = await media('node1.png'), v1 = await media('vnode1.mp4')
  cur().imageGens = [{ id: 'g', name: 'Poster', takes: [{ id: 'gt', file: g1 }], recipe: {} }]
  cur().editSessions.push({ id: 'es', rootImageId: '', nodes: [{ id: 'en', parentId: null, file: n1 }] })
  cur().videoEditSessions.push({ id: 'vs', rootVideoId: 'v', nodes: [{ id: 'vn', parentId: null, file: v1 }] })
  await p.saveProject()
  await p.deleteImageGenTake('g', 'gt'); await p.deleteEditBranch('es', 'en'); await p.deleteVideoEditBranch('vs', 'vn'); await p.deleteImageGen('g')
  for (const f of [g1, n1, v1]) assert.ok(await exists(f), 'a delete keeps the file: ' + path.basename(f))
  await p.undo(); await p.undo(); await p.undo(); await p.undo()
  assert.equal(cur().imageGens[0].takes[0].file, g1)
  assert.equal(cur().editSessions.find((s) => s.id === 'es').nodes[0].file, n1)
  assert.equal(cur().videoEditSessions.find((s) => s.id === 'vs').nodes[0].file, v1)
  console.log('PASS H2: Image Gen, Image Editor and Video Editor deletes keep the files; Ctrl+Z brings them back whole')

  // ---- L4: Cleanup keeps a live take's reversed copy, and still reclaims a real orphan ----
  const rev = f1 + '.rev.mp4'
  await fs.writeFile(rev, 'x')
  const orphan = await media('orphan.mp4')
  const swept = await p.cleanupProject(true)
  assert.ok(await exists(rev), 'the reversed copy of a live take stays')
  assert.ok(!(await exists(orphan)), 'a file nothing uses still goes')
  assert.ok(swept.files >= 1)
  console.log('PASS L4: Cleanup keeps a live take’s reversed copy')

  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
