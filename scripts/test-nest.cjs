// NEST (list 3, 2026-09-29) — the live nest's one rule, checked without a project on disk:
// flattenNests swaps a nest block for what plays inside its window, so playback and export only
// ever see ordinary blocks. Same esbuild harness as the lane test.
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
  const u = await load(path.join(root, '../koan-shared/vidancer-ui/src/lib/timelineUtils.ts'))
  const env = await load(path.join(root, '../koan-shared/vidancer-ui/src/shared/audioEnv.ts'))
  const take = (id, dur) => ({ id, file: `${id}.mp4`, createdAt: 0, durationSec: dur })
  const clip = (id, dur) => ({ id, name: id, promptData: { beats: [], freeform: '', duration: String(dur) }, takes: [take(`${id}t`, dur)], keeperTakeId: `${id}t` })
  const clips = [clip('a', 10), clip('b', 10), clip('l', 2)]
  const tlOf = (id, items, extra = {}) => ({ id, name: id, aspectRatio: '16:9', items, ...extra })
  const nestBlock = (id, nestId, extra = {}) => ({ id, clipId: '', nestId, startSec: 20, track: 1, inSec: 2, outSec: 8, ...extra })

  // 1 — a nest plays its inside, windowed: inner A (0-10) through window [2,8) at parent 20 on V2
  const inner = tlOf('in', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }])
  const parent = tlOf('par', [{ id: 'P', clipId: 'b', startSec: 0, track: 0 }, nestBlock('N', 'in')])
  const p1 = { timelines: [parent, inner], clips, audio: [] }
  const f1 = u.flattenNests(parent, p1)
  const piece = f1.items.find((x) => x.id === 'N>A')
  assert.ok(piece, 'the inner block comes out as a plain block')
  assert.equal(piece.startSec, 20, 'at the nest block\'s start')
  assert.equal(piece.inSec, 2, 'from the window\'s in-point')
  assert.equal(piece.outSec, 8, 'to the window\'s out-point')
  assert.equal(piece.track, 1.01, 'just above the nest\'s track')
  const wall = f1.items.find((x) => x.id === 'N')
  assert.equal(wall.disabled, true, 'the nest\'s own ground stays, as an invisible wall')
  assert.equal(u.itemAt(f1.items, clips, 23, new Set())?.id, 'N>A', 'playback sees the inner clip at 23s')
  assert.equal(u.sourceTimeAt(piece, clips, 23), 5, 'and plays its 5th second (window starts at 2)')
  assert.equal(u.itemAt(f1.items, clips, 23, new Set([1])), undefined, 'hiding V2 hides the whole nest (whole-track key)')
  assert.equal(u.sourceDurOf(nestBlock('N', 'in'), clips), 8, 'a nest block\'s length is its own window')

  // 2 — inner tracks keep their order; an inner hidden track stays hidden
  const inner2 = tlOf('in2', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }, { id: 'B', clipId: 'b', startSec: 3, track: 1 }])
  const par2 = tlOf('par2', [nestBlock('N', 'in2', { startSec: 0, track: 0, inSec: 0, outSec: 10 })])
  const f2 = u.flattenNests(par2, { timelines: [par2, inner2], clips, audio: [] })
  assert.equal(u.itemAt(f2.items, clips, 5, new Set())?.id, 'N>B', 'inner V2 wins over inner V1 inside the nest')
  assert.equal(u.itemAt(f2.items, clips, 1, new Set())?.id, 'N>A', 'inner V1 shows where V2 is empty')
  const f2h = u.flattenNests(par2, { timelines: [par2, { ...inner2, mutedTracks: ['v1'] }], clips, audio: [] })
  assert.equal(f2h.items.some((x) => x.id === 'N>B'), false, 'a track hidden inside the nest stays hidden')

  // 3 — the inside's sound: lane audio onto the nest's lane, scores keyed to that lane, both clipped
  const inner3 = tlOf('in3', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }], {
    audioItems: [{ id: 'm', lane: 2, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 10 }, { id: 'q', lane: 1, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 10 }],
    mutedTracks: ['a1'],
    scoreItems: [{ id: 's', scoreClipId: 'sc', startSec: 0, spanSec: 10, lane: 0 }]
  })
  const par3 = tlOf('par3', [nestBlock('N', 'in3')])
  const f3 = u.flattenNests(par3, { timelines: [par3, inner3], clips, audio: [{ id: 'song', durationSec: 60 }] })
  const m = f3.audioItems.find((x) => x.id === 'N>m')
  assert.equal(m.lane, 1, 'inner lane audio plays on the nest\'s paired lane (A2 for V2)')
  assert.equal(m.startSec, 20, 'clipped to the window start')
  assert.equal(m.inSec, 2, 'from 2s into its source')
  assert.equal(m.outSec, 8, 'to the window end')
  assert.equal(m.link, undefined, 'free — its link lived inside')
  assert.equal(f3.audioItems.some((x) => x.id === 'N>q'), false, 'a lane muted inside the nest stays silent')
  const sc = f3.scoreItems.find((x) => x.id === 'N>s')
  assert.equal(sc.nestLane, 1, 'a score inside answers to the nest\'s lane')
  assert.equal(env.scoreKeyOf(sc), 'a1', '… by that lane\'s key')
  assert.equal(env.scoreKeyOf({ lane: 2 }), 's2', 'a plain score keeps its S track')
  assert.equal(sc.inSec, 2, 'the score clips to the window like everything else')
  assert.equal(sc.spanSec, 6, '6s of it play')
  const f3m = u.flattenNests(tlOf('par3m', [nestBlock('N', 'in3', { muted: true })]), { timelines: [inner3], clips, audio: [] })
  assert.ok(f3m.items.find((x) => x.id === 'N>A').muted && f3m.audioItems.find((x) => x.id === 'N>m').muted && f3m.scoreItems.find((x) => x.id === 'N>s').muted, 'muting the nest mutes everything inside')

  // 4 — a nest inside a nest flattens all the way; a timeline can never play inside itself
  const deep = tlOf('deep', [{ id: 'D', clipId: 'b', startSec: 0, track: 0 }])
  const mid = tlOf('mid', [{ id: 'M', clipId: '', nestId: 'deep', startSec: 1, track: 0, inSec: 0, outSec: 5 }])
  const top = tlOf('top', [{ id: 'T', clipId: '', nestId: 'mid', startSec: 10, track: 0, inSec: 0, outSec: 6 }])
  const f4 = u.flattenNests(top, { timelines: [top, mid, deep], clips, audio: [] })
  const d = f4.items.find((x) => x.id === 'T>M>D')
  assert.ok(d, 'the deepest clip surfaces')
  assert.equal(d.startSec, 11, 'at mid\'s offset inside top\'s nest')
  assert.equal(u.itemAt(f4.items, clips, 12, new Set())?.id, 'T>M>D', 'and plays')
  assert.equal(u.nestReaches([top, mid, deep], 'top', 'deep'), true, 'top reaches deep')
  assert.equal(u.nestReaches([top, mid, deep], 'deep', 'top'), false, 'deep never reaches top')
  const loopA = tlOf('la', [{ id: 'x', clipId: '', nestId: 'lb', startSec: 0, track: 0, inSec: 0, outSec: 5 }])
  const loopB = tlOf('lb', [{ id: 'y', clipId: '', nestId: 'la', startSec: 0, track: 0, inSec: 0, outSec: 5 }, { id: 'Y', clipId: 'a', startSec: 0, track: 1 }])
  const f4c = u.flattenNests(loopA, { timelines: [loopA, loopB], clips, audio: [] })
  assert.ok(f4c.items.some((x) => x.id === 'x>Y'), 'a cycle still plays what it can')
  assert.equal(f4c.items.some((x) => x.id.startsWith('x>y>')), false, 'and the loop back into itself is cut (black)')

  // 5 — the window's edges: a dissolve on the nest rides the piece at its end; a loop tail bakes
  const inner5 = tlOf('in5', [{ id: 'L', clipId: 'l', startSec: 0, track: 0, loop: true, loopTailSec: 4 }])
  const par5 = tlOf('par5', [nestBlock('N', 'in5', { startSec: 0, track: 0, inSec: 0, outSec: 6, transitionOutSec: 1 })])
  const f5 = u.flattenNests(par5, { timelines: [par5, inner5], clips, audio: [] })
  const cyc = f5.items.filter((x) => x.id.startsWith('N>L~')).sort((x, y) => x.startSec - y.startSec)
  assert.equal(cyc.length, 3, 'a 2s loop with a 4s tail = 3 plain cycles')
  assert.deepEqual(cyc.map((x) => [x.startSec, x.inSec, x.outSec]), [[0, 0, 2], [2, 0, 2], [4, 0, 2]], 'each cycle replays the source')
  assert.equal(cyc[2].transitionOutSec, 1, 'the nest\'s dissolve rides the piece at its end')
  assert.equal(cyc[0].transitionOutSec, undefined, 'and only that one')
  assert.equal(u.nestLenOf({ timelines: [inner5], clips, audio: [] }, 'in5'), 6, 'the inside runs 6s (block + tail)')

  // 6 — no nests = the very same timeline back (no copies on the hot path)
  const plain = tlOf('plain', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }])
  assert.equal(u.flattenNests(plain, { timelines: [plain], clips, audio: [] }), plain, 'a timeline without nests passes through untouched')

  console.log('nest: ok (6 groups)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
