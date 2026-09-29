// Isolated audit probes. No user projects, settings, provider calls, or source edits.
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function main() {
  const temp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'vd-safety-'))
  let failWrites = false
  let denyLedgerRead = false
  let copyGate = null
  const io = {
    ...fs,
    readFile: async (...args) => {
      if (denyLedgerRead && String(args[0]).endsWith('pending-renders.json')) throw Object.assign(new Error('simulated access denied'), { code: 'EACCES' })
      return fs.readFile(...args)
    },
    writeFile: async (...args) => {
      if (failWrites && String(args[0]).endsWith('project.json.tmp')) throw new Error('AUDIT: simulated disk full')
      return fs.writeFile(...args)
    },
    copyFile: async (...args) => {
      if (copyGate) await copyGate()
      return fs.copyFile(...args)
    }
  }
  const load = async (file) => {
    const result = await esbuild.build({
      entryPoints: [path.join(root, file)], bundle: true, platform: 'node', format: 'cjs',
      write: false, external: ['ffmpeg-static'], logLevel: 'silent'
    })
    const mod = { exports: {} }
    const wrapped = vm.runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { filename: file })
    wrapped((name) => name === 'fs/promises' ? io : appRequire(name), mod, mod.exports)
    return mod.exports
  }
  const p = await load('src/main/project.ts')
  const pending = await load('src/main/pending.ts')
  const a = await p.newProject(temp, 'Project A')
  const b = await p.newProject(temp, 'Project B')
  await p.openProject(a.dir)
  let notified = false
  p.onSaveFailure((message) => { if (message) notified = true })
  failWrites = true
  let rejected = false
  try {
    await p.addTake({ requestId: 'paid-request', name: 'Paid render', promptData: p.emptyPromptData(), takeFile: path.join(a.dir, 'renders', 'paid.mp4') })
  } catch { rejected = true }
  failWrites = false
  const disk = JSON.parse(await fs.readFile(path.join(a.dir, 'project.json'), 'utf8'))
  const saveResult = { operationRejected: rejected, failureNotification: notified, memoryClips: p.getProject().clips.length, diskClips: disk.clips.length }
  assert.equal(rejected, true)
  assert.equal(notified, true)
  assert.equal(disk.clips.length, 0)
  await p.addTake({ requestId: 'paid-request', name: 'Paid render', promptData: p.emptyPromptData(), takeFile: path.join(a.dir, 'renders', 'recovered.mp4') })
  assert.equal(p.getProject().clips.length, 1)
  assert.equal(p.getProject().clips[0].takes.length, 1)
  assert.equal(JSON.parse(await fs.readFile(path.join(a.dir, 'project.json'), 'utf8')).clips[0].takes.length, 1)

  await p.openProject(a.dir)
  const source = path.join(temp, 'reference.png')
  await fs.writeFile(source, 'audit fixture; no image decoding needed')
  let started
  const entered = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  copyGate = async () => { started(); await gate }
  const importing = p.importImage(source).then(() => false, () => true)
  await entered
  await p.openProject(b.dir)
  release()
  const importRejected = await importing
  copyGate = null
  const switchResult = { activeProject: p.getProject().name, registeredInB: p.getProject().images.length, importRejected }
  assert.equal(switchResult.registeredInB, 0)
  assert.equal(importRejected, true)
  const oldSession = p.captureProjectSession()
  await p.openProject(a.dir)
  await p.openProject(b.dir)
  assert.throws(() => p.assertProjectSession(oldSession), /project changed/i)

  // Exercise the complete audio and external-take import paths across A -> B -> A.
  for (const kind of ['audio', 'take']) {
    await p.openProject(a.dir)
    const clipId = p.getProject().clips[0].id
    const before = p.getProject().clips[0].takes.length
    let begin, finish
    const begun = new Promise(r => { begin = r })
    const held = new Promise(r => { finish = r })
    copyGate = async () => { begin(); await held }
    const work = (kind === 'audio' ? p.importAudioFiles([source]) : p.addTakeFromFile(clipId, source)).then(() => false, () => true)
    await begun
    await p.openProject(b.dir); await p.openProject(a.dir)
    finish(); assert.equal(await work, true)
    copyGate = null
    assert.equal(p.getProject().audio.length, 0)
    assert.equal(p.getProject().clips[0].takes.length, before)
  }

  await fs.writeFile(path.join(a.dir, 'pending-renders.json'), '{"pending":[{"requestId":"paid-existing"}')
  const original = await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8')
  await assert.rejects(pending.listPendingRenders(a.dir), /original file was preserved/)
  await assert.rejects(pending.addPendingRender(a.dir, { requestId: 'new-job', endpoint: 'audit', createdAt: 0, req: {} }), /original file was preserved/)
  assert.equal(await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8'), original)
  denyLedgerRead = true
  await assert.rejects(pending.listPendingRenders(a.dir), /original file was preserved/)
  await assert.rejects(pending.addPendingRender(a.dir, {requestId:'new-job'}), /original file was preserved/)
  denyLedgerRead = false
  assert.equal(await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8'), original)
  const pendingResult = { malformedLedgerPreserved: true }

  // list 2 (v22): a pre-v22 file's score moves to the S track of the same number, carrying that
  // lane's mute / solo / lock; a v22 file is left exactly as saved
  const oldFile = async (name, schemaVersion) => {
    const dir = path.join(temp, name)
    await fs.mkdir(dir, { recursive: true })
    const tl = { id: 'tl', name: 'T', aspectRatio: '16:9', items: [], scoreItems: [{ id: 's', scoreClipId: 'sc', startSec: 0, spanSec: 10, lane: 1 }], mutedTracks: ['a1', 'a2'], soloTracks: ['a1'], lockedTracks: ['a1'] }
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ schemaVersion, name, clips: [], timelines: [tl], activeTimelineId: 'tl' }))
    return (await p.openProject(dir)).timelines[0]
  }
  const v21 = await oldFile('score-v21', 21)
  assert.deepEqual(v21.mutedTracks, ['a1', 'a2', 's1'], 'A2 muted with a score on it → S2 muted too (A3 held no score)')
  assert.deepEqual(v21.soloTracks, ['a1', 's1'], 'solo carries')
  assert.deepEqual(v21.lockedTracks, ['a1', 's1'], 'lock carries')
  const v22 = await oldFile('score-v22', 22)
  assert.deepEqual(v22.mutedTracks, ['a1', 'a2'], 'a v22 file is never re-carried')
  const scoreTracksResult = { carriedFromV21: true, v22Untouched: true }

  // list 3 (v23): a nest is ONE save (one Ctrl+Z restores the clips); deleting the nested timeline
  // takes its nest blocks out of every other timeline
  const nestDir = path.join(temp, 'nest')
  await fs.mkdir(nestDir, { recursive: true })
  const parentTl = { id: 'par', name: 'Main', aspectRatio: '16:9', items: [{ id: 'A', clipId: 'c', startSec: 0, track: 0 }, { id: 'B', clipId: 'c', startSec: 5, track: 0 }], audioItems: [{ id: 'r', lane: 0, source: { clipId: 'c', takeId: 't' }, startSec: 0, inSec: 0, outSec: 5, link: { itemId: 'A', offset: 0 } }] }
  await fs.writeFile(path.join(nestDir, 'project.json'), JSON.stringify({ schemaVersion: 23, name: 'nest', clips: [], timelines: [parentTl], activeTimelineId: 'par' }))
  await p.openProject(nestDir)
  const innerTl = { id: 'inner', name: 'Nest 1', aspectRatio: '16:9', items: [{ id: 'A', clipId: 'c', startSec: 0, track: 0 }], audioItems: [parentTl.audioItems[0]] }
  const nestItem = { id: 'N', clipId: '', nestId: 'inner', startSec: 0, track: 0, inSec: 0, outSec: 5 }
  const d = await p.createNest('par', innerTl, [nestItem, parentTl.items[1]], [])
  assert.deepEqual(d.timelines.map((t) => t.id).sort(), ['inner', 'par'], 'both timelines come back in one delta')
  const nowPar = () => p.getProject().timelines.find((t) => t.id === 'par')
  assert.deepEqual(nowPar().items.map((x) => x.id), ['N', 'B'], 'the nest block took the clip\'s place')
  assert.equal(nowPar().audioItems, undefined, 'its linked sound went inside with it')
  assert.equal(await p.createNest('par', innerTl, [], []), null, 'the same inner id twice is refused')
  await p.undo()
  assert.deepEqual(nowPar().items.map((x) => x.id), ['A', 'B'], 'ONE undo brings the clips back')
  assert.equal(p.getProject().timelines.some((t) => t.id === 'inner'), false, '… and removes the nest\'s timeline')
  await p.redo()
  assert.equal(p.getProject().timelines.some((t) => t.id === 'inner'), true, 'redo nests again')
  const del = await p.deleteTimeline('inner')
  assert.deepEqual(nowPar().items.map((x) => x.id), ['B'], 'deleting the nested timeline takes its nest block out')
  assert.ok(del.timelines.some((t) => t.id === 'par'), 'and says so in the delta')
  const nestResult = { oneUndo: true, deleteCleansUp: true }
  const results = { saveFailure: saveResult, projectSwitch: switchResult, corruptPendingLedger: pendingResult, scoreTracks: scoreTracksResult, nest: nestResult }
  console.log(JSON.stringify(results, null, 2))
  console.log('Fixtures retained in: ' + temp)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
