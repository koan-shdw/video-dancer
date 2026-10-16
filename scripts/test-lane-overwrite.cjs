// 41 · AUDIO-LINK-CUT-PASTE-SPEC-2026-09-23: the overwrite grammar shared by the panel and the
// store (timelineUtils). Pure functions, no project on disk — the same esbuild harness as the
// other scripts. Checks: a video landing carves the block under it; a lane span trims, splits
// and swallows free audio; a linked rider's right remnant keeps riding; a ♪ score splits with
// its in-point carried; a companion under a landing is detached (lane = its track) then carved;
// key n flips track n's pair (V-n hide + A-n mute) together; scores live on their own S tracks
// (an A-lane landing never touches one) and share one solo group with the A lanes.
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
  const clip = { id: 'c1', name: 'shot', promptData: { beats: [], freeform: '' }, takes: [{ id: 't1', file: 'x.mp4', createdAt: 0, durationSec: 10 }], keeperTakeId: 't1' }
  const clips = [clip]
  const none = new Set()

  // 1 — a block landing mid-way through another on the same track splits it into two remnants
  const under = { id: 'u', clipId: 'c1', startSec: 0, track: 0 }
  const mover = { id: 'm', clipId: 'c1', startSec: 3, track: 0, inSec: 0, outSec: 4 }
  const carved = u.carveVideo([under, mover], new Map([['m', { startSec: 3, track: 0 }]]), clips, none)
  const rem = carved.filter((x) => x.id !== 'm').sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
  assert.equal(rem.length, 2, 'two remnants')
  assert.equal(rem[0].outSec, 3, 'left remnant ends at the landing')
  assert.equal(rem[1].startSec, 7, 'right remnant starts where the landing ends')
  assert.equal(rem[1].inSec, 7, 'right remnant plays from 7s of the source')

  // 2 — a lane span trims the edges of free audio, swallows what it covers, splits a straddler
  const a = (id, lane, startSec, len, extra = {}) => ({ id, lane, source: { audioId: 'f' }, startSec, inSec: 0, outSec: len, ...extra })
  const st2 = u.overwriteLanes(
    { items: [], audioItems: [a('L', 0, 0, 5), a('C', 0, 4.5, 1), a('R', 0, 5.5, 5), a('S', 1, 0, 20), a('other', 0, 30, 2)], scoreItems: [] },
    clips,
    [{ lane: 0, start: 4, end: 8 }],
    new Set(['none']),
    none
  )
  const byId = Object.fromEntries(st2.audioItems.map((x) => [x.id, x]))
  assert.equal(byId.L.outSec, 4, 'left neighbour trimmed to the span start')
  assert.equal(byId.C, undefined, 'a covered item vanishes')
  assert.equal(byId.R.startSec, 8, 'right neighbour starts at the span end')
  assert.equal(byId.R.inSec, 2.5, 'right neighbour skips what the span covered')
  assert.equal(byId.S.outSec, 20, 'another lane is untouched')
  assert.equal(byId.other.startSec, 30, 'clear ground is untouched')
  const st2b = u.overwriteLanes({ items: [], audioItems: [a('big', 0, 0, 20, { fadeInSec: 1, fadeOutSec: 1 })], scoreItems: [] }, clips, [{ lane: 0, start: 5, end: 8 }], none, none)
  assert.equal(st2b.audioItems.length, 2, 'a straddler splits in two')
  const [b1, b2] = st2b.audioItems.sort((x, y) => x.startSec - y.startSec)
  assert.equal(b1.outSec, 5, 'left piece ends at the span')
  assert.equal(b1.fadeOutSec, undefined, 'the cut edge loses its fade')
  assert.equal(b2.startSec, 8, 'right piece starts at the span end')
  assert.equal(b2.inSec, 8, 'right piece keeps the source in step with the timeline')
  assert.notEqual(b1.id, b2.id, 'the right piece is a new item')

  // 3 — a linked rider's right remnant keeps riding its block, offset shifted by the carve
  const host = { id: 'h', clipId: 'c1', startSec: 10, track: 0, muted: true, audioDetachedId: 'rid' }
  const rider = { id: 'rid', lane: 0, source: { clipId: 'c1', takeId: 't1' }, startSec: 10, inSec: 0, outSec: 10, link: { itemId: 'h', offset: 0 } }
  const st3 = u.overwriteLanes({ items: [host], audioItems: [rider], scoreItems: [] }, clips, [{ lane: 0, start: 9, end: 12 }], none, none)
  assert.equal(st3.audioItems.length, 1, 'the rider keeps one remnant (the right)')
  assert.equal(st3.audioItems[0].link.offset, 2, 'the remnant rides 2s later than its block start')
  assert.equal(st3.audioItems[0].inSec, 2, 'and plays from 2s of its source')

  // 4 — list 2: a ♪ score lives on its own S track, so an A-lane landing never touches it; a score
  // landing on a score (carveScores) splits it, the right piece carrying its in-point
  const score = { id: 's', scoreClipId: 'sc', startSec: 0, spanSec: 30, lane: 2 }
  const st4a = u.overwriteLanes({ items: [], audioItems: [], scoreItems: [score] }, clips, [{ lane: 2, start: 10, end: 15 }], none, none)
  assert.deepEqual(st4a.scoreItems, [score], 'an A-lane span leaves the score alone')
  assert.equal(u.carveScores([score], [{ lane: 2, start: 10, end: 15 }], none, new Set(['s2'])).length, 1, 'a locked S track is untouchable')
  assert.equal(u.carveScores([score], [{ lane: 2, start: 10, end: 15 }], none, new Set(['a2'])).length, 2, 'the A lane lock is not the S track lock')
  const sc = u.carveScores([score], [{ lane: 2, start: 10, end: 15 }], none, none).sort((x, y) => x.startSec - y.startSec)
  assert.equal(sc.length, 2, 'score split in two')
  assert.equal(sc[0].spanSec, 10, 'left piece spans to the landing')
  assert.equal(sc[1].startSec, 15, 'right piece starts at the span end')
  assert.equal(sc[1].spanSec, 15, 'right piece spans the rest')
  assert.equal(sc[1].inSec, 15, 'right piece plays from 15s of the take')

  // 5 — a companion (a block's embedded sound) under a landing is detached onto ITS track's lane,
  //     then carved like any item; the block mutes and points at the new item
  const vid = { id: 'v', clipId: 'c1', startSec: 0, track: 1, gain: 0.5 }
  assert.ok(u.hasCompanion(vid, clips), 'a block with a take carries a companion')
  assert.deepEqual(u.companionSpan(vid, clips), { lane: 1, start: 0, end: 10 }, 'the companion sits on A2 for V2')
  const st5 = u.overwriteLanes({ items: [vid], audioItems: [], scoreItems: [] }, clips, [{ lane: 1, start: 6, end: 20 }], none, none)
  assert.equal(st5.items[0].muted, true, 'the block muted')
  assert.equal(st5.items[0].gain, undefined, 'its level moved to the lane item')
  assert.equal(st5.audioItems.length, 1, 'one lane item carries the sound')
  const det = st5.audioItems[0]
  assert.equal(st5.items[0].audioDetachedId, det.id, 'the block points at it')
  assert.equal(det.lane, 1, 'on the lane that pairs with the track')
  assert.equal(det.gain, 0.5, 'the level rode along')
  assert.equal(det.outSec, 6, 'and it was carved to the landing')
  assert.equal(det.link, undefined, 'born free (one-step unlink)')
  // a companion NOT under the span stays embedded
  const st5b = u.overwriteLanes({ items: [vid], audioItems: [], scoreItems: [] }, clips, [{ lane: 0, start: 0, end: 20 }], none, none)
  assert.equal(st5b.items[0].muted, undefined, 'another lane leaves the block alone')
  // a locked lane is untouchable
  const st5c = u.overwriteLanes({ items: [vid], audioItems: [], scoreItems: [] }, clips, [{ lane: 1, start: 0, end: 20 }], none, new Set(['a1']))
  assert.equal(st5c.items[0].muted, undefined, 'a locked lane rejects the carve')

  // 6 — list 1: key n flips V-n's hide and A-n's mute together, whichever of the pair exists
  const tl6 = { videoTracks: 2, audioTracks: 3, mutedTracks: ['a2'] }
  assert.deepEqual(u.toggleTrackPair(tl6, 0).sort(), ['a0', 'a2', 'v0'], 'key 1 hides V1 and mutes A1, A3 untouched')
  assert.deepEqual(u.toggleTrackPair({ ...tl6, mutedTracks: ['v0', 'a0'] }, 0), [], 'key 1 again brings both back')
  assert.deepEqual(u.toggleTrackPair({ ...tl6, mutedTracks: ['v1'] }, 1), [], 'V2 leads: a hidden V2 brings the pair back')
  assert.deepEqual(u.toggleTrackPair({ ...tl6, mutedTracks: [] }, 2), ['a2'], 'key 3 with no V3 mutes only A3')
  assert.equal(u.toggleTrackPair(tl6, 3), null, 'key 4: no track 4 at all')
  assert.deepEqual(u.toggleTrackPair({ videoTracks: 4, audioTracks: 2 }, 3).sort(), ['a3', 'v3'], 'lanes never fewer than video tracks (41)')

  // 7 — list 2: S tracks count, and ONE solo group across the A lanes and the S tracks
  assert.equal(u.scoreTrackCount({}), 3, 'three S tracks by default')
  assert.equal(u.scoreTrackCount({ scoreTracks: 1, scoreItems: [{ lane: 4 }] }), 5, 'never fewer than the highest score needs')
  const env = await load(path.join(root, './koan-shared/vidancer-ui/src/shared/audioEnv.ts'))
  assert.equal(env.audioKeyMuted({ mutedTracks: ['s0'] }, 's0'), true, 'an S track mutes')
  assert.equal(env.audioKeyMuted({ mutedTracks: ['s0'] }, 'a0'), false, 'its A lane does not')
  assert.equal(env.audioKeyMuted({ soloTracks: ['s1'] }, 'a0'), true, 'an S solo silences the A lanes')
  assert.equal(env.audioKeyMuted({ soloTracks: ['a2'] }, 's1'), true, 'an A solo silences the S tracks')
  assert.equal(env.audioKeyMuted({ soloTracks: ['a2', 's1'], mutedTracks: ['s1'] }, 's1'), false, 'a soloed track plays even when muted (solo wins)')
  assert.equal(env.audioKeyMuted({ soloTracks: ['v0'] }, 's1'), false, 'a video solo never touches audio')

  console.log('lane overwrite: ok (7 groups)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
