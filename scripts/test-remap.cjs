// list 56 (SPEED-RAMPS-SPEC-2026-10-01) — time remapping: the math of a speed line (pieces, lengths,
// source seconds both ways and past either end, rates, ramps, edits), and every reader of a block's
// clock on a remapped block: its length, the source second under the playhead, the rate, trims'
// windows, a carve's remnants, an unlinked sound at normal speed, a nest that holds one (times the
// nest's speed), a dissolve's handles, and main's mirrors (the load length, a slice's right half).
// The real shared code; no app, no network.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const near = (a, b, eps, m) => assert.ok(Math.abs(a - b) <= eps, `${m}: ${a} vs ${b}`)

;(async () => {
  const out = await require('esbuild').build({
    stdin: {
      contents: `export * as R from '${ui}/shared/remap'
        export { effDur, sourceTimeAt, rateAt, srcAtRel, relAtSrc, lenOfWindow, remapAudioOut, carveVideo, detachCompanion, flattenNests } from '${ui}/lib/timelineUtils'
        export { transitionSource } from '${ui}/shared/transitions'
        export { newProject, getProject, mainEffDur, sliceTimelineItem } from '${main}/project'`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts'
    },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', '@fal-ai/client', 'ffmpeg-static', './runtime'], logLevel: 'silent', plugins: [raw]
  })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-remap-'))
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { app: { getPath: () => tmp, getVersion: () => '0' }, shell: {}, ipcMain: { handle: () => {} } } : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? {} : require(n)), mod, mod.exports)
  const m = mod.exports
  const R = m.R

  // ================= the math =================
  const step = { keys: [{ at: 2 }], speeds: [1, 0.5] } // 100 % until 2 s of the take, then 50 %
  assert.deepEqual(R.remapPieces(step, 0, 4).map((p) => [p.s0, p.s1, p.v]), [[0, 2, 1], [2, 4, 0.5]])
  near(R.remapLen(step, 0, 4), 6, 1e-9, '2 s at 100 % + 2 s at 50 % = 6 s')
  near(R.remapSrcAt(step, 0, 3), 2.5, 1e-9, 'a second into the slow part')
  near(R.remapRelAt(step, 0, 3), 4, 1e-9, 'the inverse')
  near(R.remapSrcAt(step, 0, 10), 6, 1e-9, 'past the end the last speed carries on')
  near(R.remapSrcAt(step, 2, -1), 1, 1e-9, 'before the start the first speed carries on')
  near(R.remapRelAt(step, 2, 1), -1, 1e-9, '… and back')
  assert.equal(R.remapRateAt(step, 0, 1), 1)
  assert.equal(R.remapRateAt(step, 0, 3), 0.5)
  const ramp = { keys: [{ at: 2, ramp: 1 }], speeds: [1, 0.5] }
  const rp = R.remapPieces(ramp, 0, 4)
  assert.equal(rp.length, 2 + R.RAMP_STEPS, 'a ramp plays as its steps')
  assert.ok(rp.slice(1, -1).every((p, i, a) => i === 0 || p.v <= a[i - 1].v), 'the ramp eases down, step by step')
  const rl = R.remapLen(ramp, 0, 4)
  assert.ok(rl > 1.5 + 1 + 3 && rl < 1.5 + 2 + 3, 'the ramp’s second runs between its two speeds: ' + rl)
  near(R.remapSrcAt(ramp, 0, R.remapRelAt(ramp, 0, 2.2)), 2.2, 1e-9, 'inside a ramp the two ways agree')
  assert.deepEqual(R.remapRange(ramp, 0, 4), [0.5, 1])
  // edits
  let r = R.remapNew(1)
  r = R.remapAddKey(r, 1)
  r = R.remapAddKey(r, 3)
  assert.deepEqual(r, { keys: [{ at: 1 }, { at: 3 }], speeds: [1, 1, 1] }, 'keys split their segment, both sides at its speed')
  assert.equal(R.remapAddKey(r, 3.01), r, 'on a key: nothing new')
  r = R.remapSetSpeed(r, 1, 25)
  assert.equal(r.speeds[1], R.REMAP_MAX, 'speeds stop at 1000 %')
  r = R.remapSetSpeed(r, 1, 0.01)
  assert.equal(r.speeds[1], R.REMAP_MIN, '… and 10 %')
  r = R.remapMoveKey(r, 0, 5)
  near(r.keys[0].at, 2.98, 1e-9, 'a key stops before its neighbour')
  r = R.remapMoveKey(r, 0, 1)
  r = R.remapSetRamp(r, 0, 10)
  near(r.keys[0].ramp, 1.98, 1e-9, 'a ramp widens until it meets its neighbour (or the take’s start)')
  r = R.remapSetRamp(r, 0, 0)
  assert.deepEqual(r.keys[0], { at: 1 }, 'a closed ramp is a step again')
  r = R.remapDeleteKey(R.remapSetSpeed(r, 0, 2), 0)
  assert.deepEqual(r, { keys: [{ at: 3 }], speeds: [2, 1] }, 'a key goes: its two segments become one at the left speed')
  assert.deepEqual(R.remapScale({ keys: [], speeds: [8] }, 2).speeds, [16], 'a nest’s speed scales it, past the dial’s range')
  console.log('PASS the math: pieces, lengths, source seconds both ways and past the ends, rates, a ramp’s eased steps, the edits and their limits')

  // ================= every reader of a block's clock =================
  const clips = [{ id: 'c', name: 'c', promptData: { duration: '4', beats: [], freeform: '' }, takes: [{ id: 't', file: 'c.mp4', durationSec: 4 }], keeperTakeId: 't' }]
  const B = { id: 'B', clipId: 'c', startSec: 10, track: 0, inSec: 0, outSec: 4, remap: step }
  near(m.effDur(B, clips), 6, 1e-9, 'the block runs 6 s')
  near(m.sourceTimeAt(B, clips, 13), 2.5, 1e-9, 'the playhead 3 s in shows 2.5 s of the take')
  assert.equal(m.rateAt(B, clips, 11), 1)
  assert.equal(m.rateAt(B, clips, 14), 0.5, 'the rate where the line is')
  near(m.srcAtRel(B, 7), 4.5, 1e-9, 'a trim past the end reaches on at the end speed')
  near(m.relAtSrc(B, 3), 4, 1e-9)
  near(m.lenOfWindow(B, 1, 3), 3, 1e-9, 'a trim’s preview: 1 s at 100 % + 1 s at 50 %')
  near(m.effDur({ ...B, speed: 3 }, clips), 6, 1e-9, 'with a line, the old speed is not read')
  near(m.effDur({ ...B, remap: undefined, speed: 2 }, clips), 2, 1e-9, 'without one, it is')
  // a block dropped into the middle carves it: the remnants keep their own seconds
  const carved = m.carveVideo([B, { id: 'X', clipId: 'c', startSec: 0, track: 0, inSec: 0, outSec: 1 }], new Map([['X', { startSec: 12, track: 0 }]]), clips, new Set())
  const [l, rr] = carved.filter((x) => x.clipId === 'c' && x.id !== 'X')
  near(l.outSec, 2, 1e-9, 'the left remnant ends at the take second the carve began')
  near(rr.inSec, 2.5, 1e-9, 'the right one starts where 3 s in the line has reached (2 + 1 × 50 %)')
  near(rr.startSec, 13, 1e-9)
  assert.deepEqual(rr.remap, step, 'both keep the line')
  // an unlinked sound plays at normal speed: its window, or the block, whichever ends first
  const d = m.detachCompanion(B, clips)
  assert.equal(d.audio.speed, undefined, 'no speed on the sound')
  near(d.audio.outSec, 4, 1e-9, 'the take’s 4 s (the block runs 6)')
  near(m.remapAudioOut({ ...B, remap: { keys: [], speeds: [4] } }, clips), 1, 1e-9, 'a fast block cuts its sound at its own end')
  // a dissolve's handle walks the line
  const plan = { outgoing: B, incoming: B, cut: 16, start: 15, end: 17, repeated: false }
  near(m.transitionSource({ clips, timelines: [], audio: [] }, plan, B, 16.5).raw, 4.25, 1e-9, 'half a second past the end at 50 %')
  // a nest at 2× holding a remapped block: the line plays at twice each speed
  const inner = { id: 'in', name: 'in', aspectRatio: '16:9', items: [{ ...B, startSec: 0 }], audioItems: [], scoreItems: [] }
  const outer = { id: 'out', name: 'out', aspectRatio: '16:9', items: [{ id: 'N', clipId: '', nestId: 'in', startSec: 0, track: 0, inSec: 0, outSec: 6, speed: 2 }], audioItems: [], scoreItems: [] }
  const flat = m.flattenNests(outer, { clips, timelines: [inner, outer], audio: [] })
  const piece = flat.items.find((x) => x.clipId === 'c')
  assert.deepEqual(piece.remap.speeds, [2, 1], 'the nest’s speed on the line')
  near(m.effDur(piece, clips), 3, 1e-9, 'half the length')
  assert.equal(piece.speed, 2, 'its sound plays at the nest’s speed (the line is the picture’s only)')
  near(m.remapAudioOut(piece, clips), 4, 1e-9, '… for the take’s 4 s (3 s of block at 2×, capped by the window)')
  near(m.effDur({ ...B, speed: 2 }, clips), 6, 1e-9, 'the sound’s speed never changes the picture’s length')
  console.log('PASS every reader: the length, the playhead’s source second, the rate, trims past the ends, a carve’s remnants, the sound at normal speed, a dissolve’s handles, a nest at 2×')

  // ================= main's mirrors =================
  await m.newProject(tmp, 'Remap')
  const P = m.getProject()
  P.clips.push(clips[0])
  near(m.mainEffDur(B, P.clips), 6, 1e-9, 'main reads the same length')
  P.timelines[0].items = [{ ...B }]
  await m.sliceTimelineItem(P.timelines[0].id, 'B', 3)
  const halves = P.timelines[0].items
  near(halves[1].startSec, 14, 1e-9, 'a slice at 3 s of the take: the right half starts where the line reaches it (10 + 2 + 2)')
  assert.ok(halves.every((x) => x.remap), 'both halves keep the line')
  near(m.mainEffDur(halves[0], P.clips) + m.mainEffDur(halves[1], P.clips), 6, 1e-9, 'and still run 6 s together')
  console.log('PASS main mirrors: the load length, a slice’s right half on the line')
})().catch((e) => { console.error(e); process.exitCode = 1 })
