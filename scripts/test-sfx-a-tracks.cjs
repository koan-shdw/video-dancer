// v24 (his 10-02: "of course theyre clip effect not score"): a sound fx is an A-track block. The one resolver
// plays its take (the one named, else the keeper, else the newest; none yet = silent), and a render from
// the footage (Sonilo) reads its span off the A block: where it starts (a linked block rides its clip) and
// how long it runs; with several blocks, the selected one.
const path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src')
const load = (file) => {
  const code = buildSync({ entryPoints: [path.join(ui, file)], platform: 'node', format: 'cjs', bundle: true, write: false, logLevel: 'silent' }).outputFiles[0].text
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports)
  return mod.exports
}
const { resolveAudioSource } = load('shared/audioSource.ts')
const { scoreSpan, scoreRenderRequest } = load('shared/scoreRequest.ts')

const fx = { id: 'fx', kind: 'sfx', name: 'Door', beats: [], recipe: { engine: 'sonilo-sfx' }, takes: [{ id: 't1', file: 'door1.wav', durationSec: 1.5 }, { id: 't2', file: 'door2.wav', durationSec: 2 }], keeperTakeId: 't1' }
const bare = { id: 'bare', kind: 'sfx', name: 'Boing', beats: [], recipe: { engine: 'sonilo-sfx' }, takes: [] }
const block = (src) => ({ id: 'a', lane: 0, source: src, startSec: 0, inSec: 0, outSec: 3 })
const play = (src) => resolveAudioSource(block(src), [], [], [fx, bare])
assert.deepEqual(play({ sfxId: 'fx' }), { kind: 'sfx', file: 'door1.wav', durationSec: 1.5, name: 'Door' }, 'no take named: the keeper')
assert.equal(play({ sfxId: 'fx', takeId: 't2' }).file, 'door2.wav', 'the take it names')
assert.equal(play({ sfxId: 'fx', takeId: 'gone' }).file, 'door1.wav', 'a take that is gone: the keeper again')
assert.deepEqual(play({ sfxId: 'bare' }), { kind: 'sfx', file: undefined, durationSec: undefined, name: 'Boing' }, 'not rendered yet: silent, named')

const clip = { id: 'c', name: 'c', promptData: { duration: '10', beats: [], freeform: '', imageIds: [] }, takes: [{ id: 'ct', file: 'c.mp4', durationSec: 10 }], keeperTakeId: 'ct' }
const tl = { id: 'tl', name: 'T', aspectRatio: '16:9', items: [{ id: 'v', clipId: 'c', startSec: 4, track: 0 }], scoreItems: [],
  audioItems: [{ id: 'free', lane: 1, source: { sfxId: 'fx' }, startSec: 2, inSec: 0.5, outSec: 3.5 }, { id: 'linked', lane: 2, source: { sfxId: 'fx' }, startSec: 0, inSec: 0, outSec: 2, speed: 2, link: { itemId: 'v', offset: 1 } }] }
const p = { dir: 'x', clips: [clip], images: [], audio: [], videos: [], scoreClips: [fx, bare], voiceClips: [], timelines: [tl], activeTimelineId: 'tl' }
assert.throws(() => scoreSpan(p, { scoreClipId: 'fx' }), /several spans/, 'two blocks and none selected: it asks which')
const free = scoreSpan(p, { scoreClipId: 'fx', scoreItemId: 'free' }).span
assert.deepEqual([free.startSec, free.spanSec], [2, 3], 'a free block: its start and its length')
const linked = scoreSpan(p, { scoreClipId: 'fx', scoreItemId: 'linked' }).span
assert.deepEqual([linked.startSec, linked.spanSec], [5, 1], 'a linked block rides its clip (4 s + 1 s); at 2x its 2 s of sound run 1 s')
assert.equal(scoreRenderRequest(fx, p, 'linked').scoreItemId, 'linked', 'the render aims at the selected A block')
assert.equal(scoreRenderRequest(fx, p, 'nope').scoreItemId, undefined, 'a selection that is not this sound fx aims at nothing')
assert.throws(() => scoreSpan(p, { scoreClipId: 'bare' }), /stretch the score over the timeline/, 'a sound fx with no block: it says to put it on the timeline')
console.log('SFX ON A TRACKS OK: the resolver plays the named take, else the keeper, silent before a render; Sonilo reads its span off the A block (free or riding its clip, its speed counted), the selected one when there are several')
