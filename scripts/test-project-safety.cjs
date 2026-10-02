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

  // v24 (his 10-02: "of course theyre clip effect not score"): a pre-v24 file's sound fx leave the S tracks
  // for A tracks, each on the first one free over its stretch (a clip's own sound holds its V track's A
  // track), with its take, level, fades, volume line; a muted S track keeps it silent; the music stays on S
  const sfxFile = async (name, schemaVersion) => {
    const dir = path.join(temp, name)
    await fs.mkdir(dir, { recursive: true })
    const clip = { id: 'c', name: 'c', promptData: { duration: '10', beats: [], freeform: '', imageIds: [] }, takes: [{ id: 't', file: 'c.mp4', durationSec: 10 }], keeperTakeId: 't' }
    const tl = { id: 'tl', name: 'T', aspectRatio: '16:9', videoTracks: 1, audioTracks: 2, items: [{ id: 'v', clipId: 'c', startSec: 0, track: 0 }],
      audioItems: [{ id: 'f', lane: 1, source: { audioId: 'au' }, startSec: 2, inSec: 0, outSec: 4 }],
      scoreItems: [{ id: 'm', scoreClipId: 'music', startSec: 0, spanSec: 20 }, { id: 'x', scoreClipId: 'fx', takeId: 'ft', startSec: 3, spanSec: 1.5, inSec: 0.2, lane: 1, gain: 0.5, fadeInSec: 0.1, volume: [{ at: 0.5, gain: 0.8 }] }, { id: 'y', scoreClipId: 'fx', startSec: 12, spanSec: 2, lane: 1 }],
      mutedTracks: ['s1'] }
    const scoreClips = [{ id: 'music', name: 'Theme', beats: [], recipe: { engine: 'minimax-music-3' }, takes: [] }, { id: 'fx', kind: 'sfx', name: 'Door', beats: [], recipe: { engine: 'eleven-sfx' }, takes: [{ id: 'ft', file: 'door.wav', durationSec: 1.5 }], keeperTakeId: 'ft' }]
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ schemaVersion, name, clips: [clip], audio: [], scoreClips, timelines: [tl], activeTimelineId: 'tl' }))
    return (await p.openProject(dir)).timelines[0]
  }
  const v23 = await sfxFile('sfx-v23', 23)
  assert.deepEqual(v23.scoreItems.map((x) => x.id), ['m'], 'the music stays on its S track, the sound fx leave')
  const x = v23.audioItems.find((a) => a.id === 'x'), y = v23.audioItems.find((a) => a.id === 'y')
  assert.deepEqual(x, { id: 'x', lane: 2, source: { sfxId: 'fx', takeId: 'ft' }, startSec: 3, inSec: 0.2, outSec: 1.7, gain: 0.5, volume: [{ at: 0.5, gain: 0.8 }], fadeInSec: 0.1, fadeInShape: 'gain', muted: true }, 'over the clip (A1) and the file (A2): a new A3, everything carried, silent like its muted S2')
  assert.equal(v23.audioTracks, 3, 'the new A track counts')
  assert.equal(y.lane, 0, 'past the clip, A1 is free: it goes there')
  assert.deepEqual(y.source, { sfxId: 'fx' }, 'no take named = it plays the keeper')
  const v24 = await sfxFile('sfx-v24', 24)
  assert.equal(v24.scoreItems.length, 3, 'a v24 file is left exactly as saved')
  // deleting the sound fx takes its A blocks with it (timelines that only have A blocks too)
  await sfxFile('sfx-delete', 23)
  await p.deleteScoreClip('fx')
  assert.deepEqual(p.getProject().timelines[0].audioItems.map((a) => a.id), ['f'], 'its blocks went, the Library file stayed')
  // a timeline sent to another project brings its sound fx along (once for all its blocks), playing its keeper there
  const srcDir = path.join(temp, 'sfx-send-src'), dstDir = path.join(temp, 'sfx-send-dst')
  await fs.mkdir(srcDir, { recursive: true }); await fs.mkdir(dstDir, { recursive: true })
  const doorWav = path.join(srcDir, 'door.wav'); await fs.writeFile(doorWav, 'RIFF fixture')
  const fxClip = { id: 'fx', kind: 'sfx', name: 'Door', beats: [], recipe: { engine: 'eleven-sfx' }, takes: [{ id: 'ft', file: doorWav, durationSec: 1.5 }], keeperTakeId: 'ft' }
  const sendTl = { id: 'tl', name: 'Send', aspectRatio: '16:9', items: [], audioItems: [{ id: 'a1', lane: 0, source: { sfxId: 'fx', takeId: 'ft' }, startSec: 1, inSec: 0, outSec: 1.5 }, { id: 'a2', lane: 1, source: { sfxId: 'fx' }, startSec: 4, inSec: 0, outSec: 2 }] }
  await fs.writeFile(path.join(srcDir, 'project.json'), JSON.stringify({ schemaVersion: 24, name: 'src', clips: [], audio: [], scoreClips: [fxClip], timelines: [sendTl], activeTimelineId: 'tl' }))
  await fs.writeFile(path.join(dstDir, 'project.json'), JSON.stringify({ schemaVersion: 24, name: 'dst', clips: [], audio: [], scoreClips: [], timelines: [{ id: 'd', name: 'D', aspectRatio: '16:9', items: [] }], activeTimelineId: 'd' }))
  await p.openProject(srcDir)
  const sent = await p.sendAssetsTo(dstDir, { timelineIds: ['tl'] })
  assert.equal(sent.ok, true, sent.error)
  const dst = JSON.parse(await fs.readFile(path.join(dstDir, 'project.json'), 'utf8'))
  const dfx = (dst.scoreClips ?? []).filter((x) => x.kind === 'sfx')
  const dtl = dst.timelines.find((t) => t.name.startsWith('Send'))
  assert.equal(dfx.length, 1, 'the sound fx came along once for its two blocks')
  assert.deepEqual(dtl.audioItems.map((x) => x.source), [{ sfxId: dfx[0].id }, { sfxId: dfx[0].id }], 'both blocks play it there (its keeper)')
  assert.equal(dfx[0].takes.length, 1)
  await fs.access(path.resolve(dstDir, dfx[0].takes[0].file)) // its take was copied into the other project (saved relative to it)
  const sfxResult = { movedToATracks: true, v24Untouched: true, deleteTakesBlocks: true, sendBringsIt: true }

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
  // part 2: the nest's sound unlinks into a lane block that plays the same timeline
  assert.ok(await p.unlinkAudioFromItem('par', 'N'), 'a nest block unlinks its sound')
  const laneNest = (nowPar().audioItems ?? []).find((a) => a.source.nestId === 'inner')
  const nBlock = nowPar().items.find((x) => x.id === 'N')
  assert.ok(laneNest && nBlock.audioDetachedId === laneNest.id && nBlock.muted, 'into a lane nest block; the block goes silent')
  assert.deepEqual([laneNest.inSec, laneNest.outSec, laneNest.lane], [0, 5, 0], 'same window, on its paired lane')
  assert.equal(await p.unlinkAudioFromItem('par', 'N'), null, 'twice does nothing')
  const del = await p.deleteTimeline('inner')
  assert.deepEqual(nowPar().items.map((x) => x.id), ['B'], 'deleting the nested timeline takes its nest block out')
  assert.equal((nowPar().audioItems ?? []).some((a) => 'nestId' in a.source), false, '… and its unlinked sound')
  assert.ok(del.timelines.some((t) => t.id === 'par'), 'and says so in the delta')
  const nestResult = { oneUndo: true, deleteCleansUp: true, unlinks: true }

  // list 6 (KEEPERS-SPEC-2026-09-29): a keeper is a flag, many per take set; the one flagged last
  // plays; renders land unflagged; an old project's keeper is its one flag
  const kDir = path.join(temp, 'keepers')
  await fs.mkdir(kDir, { recursive: true })
  const take = (id, extra = {}) => ({ id, file: path.join(kDir, `${id}.mp4`), createdAt: 0, ...extra })
  const kClip = { id: 'k', name: 'k', promptData: p.emptyPromptData(), takes: [take('t1'), take('t2'), take('t3')], keeperTakeId: 't1' } // an old project: t1 saved as THE keeper
  await fs.writeFile(path.join(kDir, 'project.json'), JSON.stringify({ schemaVersion: 23, name: 'keepers', clips: [kClip], timelines: [{ id: 'tl', name: 'T', aspectRatio: '16:9', items: [] }], activeTimelineId: 'tl' }))
  await p.openProject(kDir)
  const kNow = () => p.getProject().clips.find((c) => c.id === 'k')
  await p.setKeeperTake('k', 't3') // a click on t3
  assert.deepEqual([kNow().keeperIds, kNow().keeperTakeId], [['t1', 't3'], 't3'], "a click flags t3 and it plays; the old keeper t1 stays flagged")
  await p.setKeeperFlags('clip', 'k', ['t3'], false) // a lit ★ clicked
  assert.deepEqual([kNow().keeperIds, kNow().keeperTakeId], [['t1'], 't1'], 'unflag t3: the keeper flagged before it plays')
  await p.setKeeperFlags('clip', 'k', ['t1', 't2'], null) // ~ on a mixed selection
  assert.deepEqual(kNow().keeperIds, ['t1', 't2'], '~ on a mixed selection turns them all on')
  await p.setKeeperFlags('clip', 'k', ['t1', 't2'], null)
  assert.deepEqual([kNow().keeperIds, kNow().keeperTakeId], [[], 't3'], '… and again all off: nothing flagged, the newest take plays')
  await p.setTakeMeta('k', 't3', { disabled: true })
  assert.equal(kNow().keeperTakeId, 't2', 'the newest take that is not disabled plays')
  await p.setKeeperTake('k', 't1')
  await p.addTake({ clipId: 'k', name: 'k', promptData: p.emptyPromptData(), takeFile: path.join(kDir, 't4.mp4') })
  assert.equal(kNow().keeperTakeId, 't1', 'a new render lands unflagged — the flagged keeper keeps playing')
  await p.deleteTake('k', 't1')
  assert.deepEqual(kNow().keeperIds, [], "a deleted keeper's flag goes with it")
  assert.equal(kNow().keeperTakeId, kNow().takes[kNow().takes.length - 1].id, '… and with nothing flagged the newest take plays')
  const keepersResult = { flags: true, lastFlaggedPlays: true, rendersUnflagged: true }

  // ---- duplicating a timeline carries ALL of it (it used to keep only the clips and audio blocks) ----
  const dDir = path.join(temp, 'duplicate')
  await fs.mkdir(dDir, { recursive: true })
  const full = {
    id: 'tl', name: 'Cut', aspectRatio: '9:16', rev: 7,
    items: [{ id: 'i1', clipId: 'c', track: 0, audioDetachedId: 'a1' }, { id: 'i2', clipId: 'c', track: 1 }],
    audioItems: [{ id: 'a1', lane: 1, source: { clipId: 'c', takeId: 't' }, startSec: 0, inSec: 0, outSec: 2, link: { itemId: 'i1', offset: 0.5 } }, { id: 'a2', lane: 2, source: { audioId: 'x' }, startSec: 4, inSec: 0, outSec: 1, link: { itemId: 'gone', offset: 0 } }],
    scoreItems: [{ id: 's1', scoreClipId: 'sc', startSec: 0, spanSec: 8, lane: 1 }],
    markers: [{ id: 'm1', at: 3, name: 'drop' }],
    videoTracks: 2, audioTracks: 4, scoreTracks: 2, lockedTracks: ['v1'], mutedTracks: ['s1'], soloTracks: ['a0'],
    rangeInSec: 1, rangeOutSec: 6, videoMuted: true, exportRes: '720', exportFps: '24', exportQuality: 'high'
  }
  await fs.writeFile(path.join(dDir, 'project.json'), JSON.stringify({ schemaVersion: 23, name: 'duplicate', clips: [], timelines: [full], activeTimelineId: 'tl' }))
  await p.openProject(dDir)
  const dup = await p.duplicateTimeline('tl')
  const made = p.getProject().timelines.find((t) => t.id === dup.timelineId)
  const { id: _i, name: madeName, items: mi, audioItems: ma, scoreItems: ms, markers: mm, ...madeRest } = made
  const { id: _j, name: _n, rev: _r, items: _a, audioItems: _b, scoreItems: _c, markers: _d, ...srcRest } = p.getProject().timelines.find((t) => t.id === 'tl')
  assert.equal(madeName, 'Cut ·copy')
  assert.deepEqual(madeRest, srcRest, 'tracks, locks, mutes, solos, the work range and the export settings ride; the save counter starts fresh')
  assert.deepEqual(ms.map(({ id, ...s }) => s), [{ scoreClipId: 'sc', startSec: 0, spanSec: 8, lane: 1 }], 'its scores come along')
  assert.deepEqual(mm.map(({ id, ...m }) => m), [{ at: 3, name: 'drop' }], 'its markers come along')
  assert.deepEqual(mi.map((it) => it.track), [0, 1], 'every track keeps its clips')
  const ids = [...mi, ...ma, ...ms, ...mm].map((x) => x.id)
  assert.ok(new Set(ids).size === ids.length && !ids.some((x) => ['i1', 'i2', 'a1', 'a2', 's1', 'm1'].includes(x)), 'every block gets a fresh id')
  assert.deepEqual(ma[0].link, { itemId: mi[0].id, offset: 0.5 }, 'a linked sound follows the copied clip')
  assert.equal(mi[0].audioDetachedId, ma[0].id, 'and the clip points at its copied sound')
  assert.equal(ma[1].link, undefined, 'a link to a block that is gone goes absolute')
  const duplicateResult = { wholeTimeline: true, freshIds: true, linksFollow: true }
  const results = { saveFailure: saveResult, projectSwitch: switchResult, corruptPendingLedger: pendingResult, scoreTracks: scoreTracksResult, soundFxOnATracks: sfxResult, nest: nestResult, keepers: keepersResult, duplicate: duplicateResult }
  console.log(JSON.stringify(results, null, 2))
  console.log('Fixtures retained in: ' + temp)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
