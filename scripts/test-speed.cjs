// list 51 (2026-09-30) — Premiere's Clip Speed / Duration rules (lib/speed applySpeed), checked
// without a project on disk. Same esbuild harness as the nest test.
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function load(file) {
  const r = await esbuild.build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${r.outputFiles[0].text}\n})`, { filename: path.basename(file) })((name) => appRequire(name), mod, mod.exports)
  return mod.exports
}

async function main() {
  const s = await load(path.join(root, './koan-shared/vidancer-ui/src/lib/speed.ts'))
  const u = await load(path.join(root, './koan-shared/vidancer-ui/src/lib/timelineUtils.ts'))
  const clip = (id, dur) => ({ id, name: id, promptData: { beats: [], freeform: '', duration: String(dur) }, takes: [{ id: `${id}t`, file: `${id}.mp4`, createdAt: 0, durationSec: dur }], keeperTakeId: `${id}t` })
  const clips = [clip('a', 10), clip('b', 10)]
  const p = { clips, timelines: [], audio: [] }
  const tl = (items, extra = {}) => ({ id: 'tl', name: 'tl', aspectRatio: '16:9', items, ...extra })
  const base = [{ id: 'A', clipId: 'a', startSec: 0, track: 0, inSec: 0, outSec: 4 }, { id: 'B', clipId: 'b', startSec: 4, track: 0, inSec: 0, outSec: 4 }]
  const opts = (o) => ({ speed: 1, reverse: false, keepPitch: true, blend: false, ripple: true, ...o })
  const at = (r, id) => r.items.find((x) => x.id === id)
  const len = (it) => u.effDur(it, clips)

  // 1 — the chain ON, 50 %, ripple: A runs twice as long, everything after it moves along
  let r = s.applySpeed(p, tl(base, { audioItems: [{ id: 'free', lane: 1, source: { audioId: 'x' }, startSec: 4, inSec: 0, outSec: 2 }, { id: 'rider', lane: 0, source: { clipId: 'b', takeId: 'bt' }, startSec: 4, inSec: 0, outSec: 1, link: { itemId: 'B', offset: 0 } }] }), ['A'], opts({ speed: 0.5 }))
  assert.deepEqual([at(r, 'A').speed, len(at(r, 'A')), at(r, 'B').startSec], [0.5, 8, 8], '50 % doubles A and ripples B to 8s')
  assert.equal(r.audioItems.find((a) => a.id === 'free').startSec, 8, 'free lane audio after it rides the ripple')
  assert.equal(r.audioItems.find((a) => a.id === 'rider').startSec, 4, 'a linked rider keeps its link (it follows B by itself)')

  // 2 — 200 %, ripple: A halves, B pulls in
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 2 }))
  assert.deepEqual([len(at(r, 'A')), at(r, 'B').startSec], [2, 2], '200 % halves A and closes up')

  // 3 — ripple OFF: longer only into free room (the out-point stops at B), shorter leaves a gap
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 0.5, ripple: false }))
  assert.deepEqual([len(at(r, 'A')), at(r, 'A').outSec, at(r, 'B').startSec], [4, 2, 4], 'slowed without ripple: stops at B, its out-point moves in')
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 2, ripple: false }))
  assert.deepEqual([len(at(r, 'A')), at(r, 'B').startSec], [2, 4], 'sped up without ripple: a gap, B stays')

  // 4 — the chain OFF: the duration stays what was typed, the out-point moves
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 1, duration: 2 }))
  assert.deepEqual([at(r, 'A').outSec, len(at(r, 'A')), at(r, 'B').startSec], [2, 2, 2], '100 % for 2s: out-point at 2, ripple closes up')
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 2, duration: 4 }))
  assert.deepEqual([at(r, 'A').outSec, len(at(r, 'A'))], [8, 4], '200 % kept at 4s reaches 8s of source')
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 2, duration: 9 }))
  assert.equal(at(r, 'A').outSec, 10, 'never past the end of the take')

  // 5 — Reverse Speed: the window mirrors into the reversed copy (the same frames), and back
  r = s.applySpeed(p, tl([{ id: 'A', clipId: 'a', startSec: 0, track: 0, inSec: 1, outSec: 3 }]), ['A'], opts({ reverse: true }))
  assert.deepEqual([at(r, 'A').reverse, at(r, 'A').inSec, at(r, 'A').outSec], [true, 7, 9], 'source 1..3 of a 10s take = the reversed copy\'s 7..9')
  const back = s.applySpeed(p, tl(r.items), ['A'], opts({ reverse: false }))
  assert.deepEqual([at(back, 'A').reverse, at(back, 'A').inSec, at(back, 'A').outSec], [undefined, 1, 3], 'reverse off mirrors back')
  const nest = { id: 'N', clipId: '', nestId: 'x', startSec: 0, track: 0, inSec: 0, outSec: 4 }
  assert.equal(s.canReverse(nest, clips), false, 'a nest can\'t reverse yet')
  assert.equal(s.canReverse({ id: 'S', clipId: 'a', useRecipe: true }, clips), false, 'nor a storyboard block')
  r = s.applySpeed({ ...p, timelines: [tl([], { id: 'x' })] }, tl([nest]), ['N'], opts({ reverse: true, speed: 2 }))
  assert.deepEqual([at(r, 'N').reverse, at(r, 'N').speed], [undefined, 2], 'a nest takes the speed, never the reverse')

  // 6 — pitch + blending ride along; locked tracks and lanes stay put
  r = s.applySpeed(p, tl(base), ['A'], opts({ speed: 0.5, keepPitch: false, blend: true }))
  assert.deepEqual([at(r, 'A').pitchShift, at(r, 'A').interp], [true, 'blend'], 'Maintain Audio Pitch off + Frame Blending')
  r = s.applySpeed(p, tl(base, { lockedTracks: ['v0'] }), ['A'], opts({ speed: 0.5 }))
  assert.equal(r.changed, 0, 'a block on a locked track is left alone')
  r = s.applySpeed(p, tl([...base.slice(0, 1), { ...base[1], track: 1 }], { lockedTracks: ['v1', 'a1'], audioItems: [{ id: 'free', lane: 1, source: { audioId: 'x' }, startSec: 4, inSec: 0, outSec: 2 }] }), ['A'], opts({ speed: 0.5 }))
  assert.deepEqual([at(r, 'B').startSec, r.audioItems], [4, null], 'the ripple skips locked tracks and lanes')

  // 7 — several blocks, left to right: each ripple carries the ones after it
  r = s.applySpeed(p, tl([...base, { id: 'C', clipId: 'a', startSec: 8, track: 0, inSec: 0, outSec: 2 }]), ['B', 'A'], opts({ speed: 0.5 }))
  assert.deepEqual(['A', 'B', 'C'].map((id) => at(r, id).startSec), [0, 8, 16], 'A 0-8, B 8-16, C after both')

  console.log('speed: ok (7 groups)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
