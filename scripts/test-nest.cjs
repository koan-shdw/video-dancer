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
  const u = await load(path.join(root, './koan-shared/vidancer-ui/src/lib/timelineUtils.ts'))
  const env = await load(path.join(root, './koan-shared/vidancer-ui/src/shared/audioEnv.ts'))
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

  // ---- PART 2: the nest block's own speed, effects, dissolve and level ride every piece ----
  // 7 — speed: a 2× nest plays its inside twice as fast (pieces, lane audio, scores, dissolves)
  const inner7 = tlOf('in7', [{ id: 'A', clipId: 'a', startSec: 0, track: 0, outSec: 4, transitionOutSec: 1 }, { id: 'B', clipId: 'b', startSec: 4, track: 0 }], {
    audioItems: [{ id: 'm', lane: 0, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 8 }],
    scoreItems: [{ id: 's', scoreClipId: 'sc', startSec: 0, spanSec: 8 }]
  })
  const par7 = tlOf('par7', [nestBlock('N', 'in7', { startSec: 10, track: 0, inSec: 2, outSec: 8, speed: 2 })])
  const p7 = { timelines: [par7, inner7], clips, audio: [{ id: 'song', durationSec: 60 }] }
  const f7 = u.flattenNests(par7, p7)
  const a7 = f7.items.find((x) => x.id === 'N>A')
  const b7 = f7.items.find((x) => x.id === 'N>B')
  assert.equal(u.effDur(par7.items[0], clips), 3, 'a 6s window at 2× is 3s long')
  assert.equal(a7.startSec, 10, 'A starts where the nest does')
  assert.equal(a7.speed, 2, 'and plays at 2×')
  assert.equal(u.effDur(a7, clips), 1, 'its 2s inside the window take 1s')
  assert.equal(b7.startSec, 11, 'B (inner 4s) lands at 10 + (4 − 2) / 2')
  assert.equal(u.effDur(b7, clips), 2, 'B runs to the window end at 2×')
  assert.equal(a7.transitionOutSec, 0.5, 'an inner dissolve halves with the speed')
  const m7 = f7.audioItems.find((x) => x.id === 'N>m')
  assert.equal(m7.speed, 2, 'lane audio speeds up too')
  assert.equal(u.audioLenOf(m7), 3, 'and fits the window')
  const s7 = f7.scoreItems.find((x) => x.id === 'N>s')
  assert.deepEqual([s7.startSec, s7.spanSec, s7.inSec, s7.speed], [10, 3, 2, 2], 'a score inside plays its 2..8 at 2× over 3s')
  assert.equal(u.itemAt(f7.items, clips, 10.5, new Set())?.id, 'N>A', 'playback sees A at 10.5')
  assert.equal(u.sourceTimeAt(a7, clips, 10.5), 3, '… showing its 3rd second (2 + 0.5 × 2)')

  // 8 — effects: the nest's stack runs after each piece's own, every entry keeps its block's arc
  const inner8 = tlOf('in8', [{ id: 'A', clipId: 'a', startSec: 0, track: 0, outSec: 5, fx: { v: 2, stack: [{ id: 'e1', type: 'push', params: {} }], blend: { mode: 'screen', opacity: 0.5 } } }, { id: 'B', clipId: 'b', startSec: 5, track: 0 }])
  const nest8 = nestBlock('N', 'in8', { startSec: 20, track: 0, inSec: 0, outSec: 10, fx: { v: 2, stack: [{ id: 'g', type: 'grid', params: {} }], blend: { mode: 'normal', opacity: 0.5 } } })
  const f8 = u.flattenNests(tlOf('par8', [nest8]), { timelines: [inner8], clips, audio: [] })
  const a8 = f8.items.find((x) => x.id === 'N>A')
  const b8 = f8.items.find((x) => x.id === 'N>B')
  assert.deepEqual(a8.fx.stack.map((e) => e.type), ['push', 'grid'], "the piece's own effect first, then the nest's")
  assert.deepEqual(a8.fx.stack[0].span, [20, 5], "A's push keeps A's own arc")
  assert.deepEqual(a8.fx.stack[1].span, [20, 10], "the nest's grid runs over the whole nest")
  assert.deepEqual(b8.fx.stack[0].span, [20, 10], '… on every piece (one arc across the cut)')
  assert.deepEqual(a8.fx.blend, { mode: 'screen', opacity: 0.25 }, "blends meet: the piece's mode, both opacities")
  assert.deepEqual(b8.fx.blend, { mode: 'normal', opacity: 0.5 }, "a plain piece takes the nest's blend")
  assert.equal(b8.nestFx.of, 'N', 'a piece remembers its nest (the live effects draft finds it)')
  assert.equal(u.joinNestFx(undefined, null, 'N', [0, 1]), undefined, 'no effects anywhere = none')

  // 9 — level: the nest's gain, fades and band reach every sound inside, folded into ONE band
  const inner9 = tlOf('in9', [{ id: 'A', clipId: 'a', startSec: 0, track: 0, fadeInSec: 2 }], { audioItems: [{ id: 'm', lane: 1, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 10, gain: 0.5 }] })
  const nest9 = nestBlock('N', 'in9', { startSec: 0, track: 0, inSec: 1, outSec: 10, gain: 0.5, fadeInSec: 1, fadeInShape: 'gain' })
  const f9 = u.flattenNests(tlOf('par9', [nest9]), { timelines: [inner9], clips, audio: [{ id: 'song', durationSec: 60 }] })
  const a9 = f9.items.find((x) => x.id === 'N>A')
  const m9 = f9.audioItems.find((x) => x.id === 'N>m')
  assert.equal(m9.gain, 0.25, "gains multiply (0.5 inside × the nest's 0.5)")
  assert.equal(env.envGainAt(m9.volume, 0), 0, "the nest's fade-in starts in silence")
  assert.ok(Math.abs(env.envGainAt(m9.volume, 0.5) - 0.5) < 0.02, '… halfway at 0.5s (constant gain)')
  assert.ok(Math.abs(env.envGainAt(m9.volume, 3) - 1) < 1e-6, '… and done after 1s')
  assert.equal(a9.fadeInSec, undefined, "A's own fade-in is cut by the window (it starts 1s in)…")
  const aAt = (t) => (a9.gain ?? 1) * env.envGainAt(a9.volume, t) * env.fadesAt(a9, t, u.effDur(a9, clips))
  assert.equal(a9.gain, 0.5, "the nest's gain reaches the clip's own sound")
  assert.ok(Math.abs(aAt(0.5) - 0.5 * Math.sin((0.75 * Math.PI) / 2) * 0.5) < 0.005, '… so it carries on where the window cut it (75% in at 0.5s), under the nest fade')
  assert.ok(Math.abs(aAt(4) - 0.5) < 1e-6, 'both fades done = the gain alone')

  // 10 — unlink: the block keeps its picture silent; a lane block plays the inside's sound
  const inner10 = tlOf('in10', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }, { id: 'B', clipId: 'b', startSec: 0, track: 1, muted: true }], { audioItems: [{ id: 'm', lane: 2, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 6 }], scoreItems: [{ id: 's', scoreClipId: 'sc', startSec: 0, spanSec: 6 }] })
  const nest10 = nestBlock('N', 'in10', { startSec: 0, track: 0, inSec: 0, outSec: 6, muted: true, audioDetachedId: 'L' })
  const lane10 = { id: 'L', lane: 3, source: { nestId: 'in10' }, startSec: 2, inSec: 0, outSec: 6, gain: 0.5 }
  const f10 = u.flattenNests(tlOf('par10', [nest10], { audioItems: [lane10] }), { timelines: [inner10], clips, audio: [{ id: 'song', durationSec: 60 }] })
  assert.ok(f10.items.find((x) => x.id === 'N>A').muted, "the unlinked block's pieces are silent")
  assert.equal(f10.audioItems.some((x) => x.id.startsWith('N>')), false, 'and the block sends no sound of its own')
  const la = f10.audioItems.find((x) => x.id === 'L>A')
  assert.deepEqual(la && [la.lane, la.startSec, la.source.clipId, la.gain], [3, 2, 'a', 0.5], "the lane block plays A's own sound on its lane, from its own spot, at its level")
  assert.equal(f10.audioItems.some((x) => x.id === 'L>B'), false, 'a muted clip inside stays silent')
  assert.equal(f10.audioItems.find((x) => x.id === 'L>m')?.lane, 3, 'inner lane audio rides the lane block')
  assert.equal(f10.scoreItems.find((x) => x.id === 'L>s')?.nestLane, 3, 'scores answer to its lane')
  assert.equal(f10.items.some((x) => x.id.startsWith('L>')), false, 'a lane block never shows picture')
  assert.equal(u.nestReaches([tlOf('x', [], { audioItems: [lane10] }), inner10], 'x', 'in10'), true, 'a lane block counts for the no-cycles gate')

  // 11 — sound dropped onto a nest's sound cuts into it like a clip's (Premiere overwrite)
  const nest11 = nestBlock('N', 'in10', { startSec: 0, track: 0, inSec: 0, outSec: 6 })
  const st11 = u.overwriteLanes({ items: [nest11], audioItems: [], scoreItems: [] }, clips, [{ lane: 0, start: 2, end: 4 }], new Set(), new Set())
  const n11 = st11.items[0]
  assert.ok(n11.muted && n11.audioDetachedId, "the nest's sound leaves the block (unlinked)…")
  const parts11 = st11.audioItems.map((x) => [x.source.nestId, x.startSec, x.inSec, x.outSec])
  assert.deepEqual(parts11, [['in10', 0, 0, 2], ['in10', 4, 4, 6]], '… and the landing carves it: 0-2 and 4-6 stay')

  // 12 — dissolves reach a nest: out of one into a clip, and the handles run as far as its timeline
  const tr = await load(path.join(root, './koan-shared/vidancer-ui/src/shared/transitions.ts'))
  const dz = await load(path.join(root, './koan-shared/vidancer-ui/src/lib/dissolves.ts'))
  const inner12 = tlOf('in12', [{ id: 'A', clipId: 'a', startSec: 0, track: 0 }])
  const par12 = tlOf('par12', [nestBlock('N', 'in12', { startSec: 0, track: 0, inSec: 0, outSec: 4, transitionOutSec: 1, transitionAlignment: 0.5 }), { id: 'C', clipId: 'b', startSec: 4, track: 0, inSec: 2 }])
  const p12 = { timelines: [par12, inner12], clips, audio: [] }
  const t12 = dz.dissolveTargets(p12, par12, ['N'])[0]
  assert.equal(t12.reason, undefined, 'a nest can take a dissolve into the next clip')
  assert.equal(t12.name, 'in12', "… and is named for its timeline")
  const plan12 = tr.dissolvePlans(p12, par12).find((x) => x.outgoing.id === 'N')
  assert.deepEqual(plan12 && [plan12.start, plan12.cut, plan12.end], [3.5, 4, 4.5], 'the Timeline draws it centered on the cut')
  assert.equal(tr.transitionSource(p12, plan12, par12.items[0], 4.4).repeated, false, "the nest's handle is its timeline running on (10s inside)")
  const flat12 = tr.dissolvePlans(p12, u.flattenNests(par12, p12)).find((x) => x.incoming.id === 'C')
  assert.equal(flat12?.outgoing.id, 'N>A', 'playback dissolves the clip inside the nest into the next one')

  console.log('nest: ok (12 groups)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
