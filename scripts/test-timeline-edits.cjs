// Audit 2026-10-09 batch 7, the main + shared half. The real project and timeline code in a temp project.
// M8  a timeline write answers with its new rev before the disk write ends: the next gesture is not stale
// M24 a cut gives each half the envelope it plays and a fade only on its original edge
// M34 a head trim keeps the linked sound under the frames it belongs to
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-tl-edits-'))
  let hold = null
  const io = { ...fs, writeFile: async (...a) => { if (hold && String(a[0]).endsWith('project.json.tmp')) await hold; return fs.writeFile(...a) } }
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export * from './src/main/project'; export { envHead, envTail, envGainAt } from './koan-shared/vidancer-ui/src/shared/audioEnv'; export { carveVideo } from './koan-shared/vidancer-ui/src/lib/timelineUtils'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static', 'electron'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'fs/promises' ? io : n === 'electron' ? { app: { getPath: () => temp } } : appRequire(n)), mod, mod.exports)
  const p = mod.exports
  const proj = await p.newProject(temp, 'Edits')
  await p.openProject(proj.dir)
  const take = path.join(proj.dir, 'renders', 't.mp4')
  await fs.mkdir(path.dirname(take), { recursive: true }); await fs.writeFile(take, 'x')
  const { clipId, takeId } = await p.addTake({ name: 'Roof', promptData: { ...p.emptyPromptData(), duration: '8' }, takeFile: take, durationSec: 8 })
  const tl = () => p.getProject().timelines.find((t) => t.id === p.getProject().activeTimelineId)
  const tlId = tl().id
  const block = (extra = {}) => ({ id: 'A', clipId, takeId, startSec: 0, track: 0, inSec: 0, outSec: 8, ...extra })

  // ---- M8: the answer comes before the disk ----
  let release; hold = new Promise((r) => { release = r })
  let answered = false
  const first = p.setTimelineItems(tlId, [block()], tl().rev ?? 0).then((d) => { answered = true; return d })
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(answered, 'the write answered while project.json was still being written')
  const d1 = await first
  const rev1 = d1.timelines[0].rev
  const d2 = await p.setTimelineItems(tlId, [block({ startSec: 1 / 24 })], rev1)
  assert.equal(d2.timelines[0].items[0].startSec, 1 / 24, 'the next nudge built on that rev lands')
  release(); hold = null
  await p.pendingSaves()
  console.log('PASS M8: a timeline write answers with its new rev before the disk write ends; the next gesture lands')

  // ---- M24: the razor splits the envelope and the fades ----
  const volume = [{ id: 'k1', at: 1, gain: 1 }, { id: 'k2', at: 3, gain: 0.25 }, { id: 'k3', at: 4, gain: 1 }]
  await p.setTimelineItems(tlId, [block({ volume, fadeInSec: 0.5, fadeOutSec: 0.5 })], tl().rev)
  await p.sliceTimelineItem(tlId, 'A', 2)
  const [L, R] = tl().items
  assert.deepEqual(L.volume.map((v) => v.at), [1, 2], 'the head keeps its own keyframes and ends at the cut')
  assert.equal(L.fadeInSec, 0.5); assert.equal(L.fadeOutSec, undefined, 'no fade-out at the cut')
  assert.deepEqual(R.volume.map((v) => v.at), [0, 1, 2], 'the tail starts at its own zero: 3 → 1, 4 → 2')
  assert.ok(Math.abs(R.volume[0].gain - p.envGainAt(volume, 2)) < 1e-9, 'holding the level at the cut')
  assert.equal(R.fadeInSec, undefined, 'no fade-in at the cut'); assert.equal(R.fadeOutSec, 0.5)
  // the same for an overwrite carving the middle out of a block
  const mover = { id: 'M', clipId, takeId, startSec: 2, track: 0, inSec: 0, outSec: 3 }
  const carved = p.carveVideo([block({ volume }), mover], new Map([['M', { startSec: 2, track: 0 }]]), p.getProject().clips, new Set())
  const right = carved.find((x) => x.startSec === 5)
  assert.ok(right && right.volume[0].at === 0 && right.volume.every((v) => v.at >= 0), 'an overwrite remnant keeps the envelope it plays: ' + JSON.stringify(right && right.volume))
  console.log('PASS M24: a cut (razor or overwrite) gives each piece the envelope it plays, a fade only on its own edge')

  // ---- M34: a head trim keeps the linked sound in sync ----
  const rider = { id: 'R1', lane: 0, source: { clipId, takeId }, startSec: 2, inSec: 0, outSec: 3, link: { itemId: 'A', offset: 2 } }
  await p.setTimelineAll(tlId, [block()], [rider], null, tl().rev)
  await p.setTimelineItems(tlId, [block({ inSec: 1, startSec: 1 })], tl().rev) // drag the head in 1 s
  let a = tl().audioItems[0]
  assert.equal(a.link.offset, 1, 'the sound stays at the same timeline second (offset 2 → 1)')
  assert.equal(a.startSec, 2); assert.equal(a.inSec, 0)
  await p.setTimelineItems(tlId, [block({ inSec: 3, startSec: 3 })], tl().rev) // past the sound's start
  a = tl().audioItems[0]
  assert.equal(a.link.offset, 0); assert.equal(a.inSec, 1, 'a sound that now starts before the block loses that head')
  await p.setTimelineItems(tlId, [block({ inSec: 3, startSec: 6 })], tl().rev) // a MOVE: the sound rides along
  assert.equal(tl().audioItems[0].link.offset, 0); assert.equal(tl().audioItems[0].startSec, 6)
  console.log('PASS M34: a head trim keeps the linked sound under its frames; a move still carries it')

  await p.pendingSaves() // timeline writes answer before their save: let the last ones finish
  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
