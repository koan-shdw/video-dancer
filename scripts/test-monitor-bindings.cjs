// Deterministic media-event races: no user projects or paid provider calls.
const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const { buildSync } = require('esbuild')
const result = buildSync({ entryPoints: [path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/lib/prepareVideoFrame.ts')], bundle: true, platform: 'node', format: 'cjs', write: false })
const mod = { exports: {} }
vm.runInThisContext(`(function(module,exports){${result.outputFiles[0].text}\n})`)(mod, mod.exports)
const { prepareVideoFrame } = mod.exports

class Player extends EventTarget {
  readyState = 4
  seeking = false
  paused = false
  style = { visibility: 'visible', opacity: '1' }
  src = 'old.mp4'
  currentSrc = 'old.mp4'
  time = 9
  frames = new Map()
  nextFrame = 1
  get currentTime() { return this.time }
  set currentTime(value) { this.time = value; this.seeking = true }
  pause() { this.paused = true }
  requestVideoFrameCallback(fn) { const id = this.nextFrame++; this.frames.set(id, fn); return id }
  cancelVideoFrameCallback(id) { this.frames.delete(id) }
  event(name) { if (name === 'loadedmetadata') this.currentSrc = this.src; this.dispatchEvent(new Event(name)) }
  frame(mediaTime) { const callbacks = [...this.frames.values()]; this.frames.clear(); for (const fn of callbacks) fn(0, { mediaTime }) }
  sought() { this.seeking = false; this.event('seeked') }
}
let passed = 0
function test(name, fn) { fn(); passed++; console.log('PASS ' + name) }
test('new source cannot reveal old readyState or loadeddata before its metadata', () => {
  const el = new Player(); let ready = 0
  prepareVideoFrame(el, { url: 'next.mp4', target: 2, sourceChanged: true, gate: true, onReady: () => ready++ })
  assert.equal(el.style.visibility, 'hidden'); assert.equal(el.paused, true)
  el.event('loadeddata'); assert.equal(ready, 0); assert.equal(el.currentTime, 9)
  el.event('loadedmetadata'); el.frame(9); el.sought(); assert.equal(ready, 0)
  el.frame(2); assert.equal(ready, 1)
})
test('cancelled next-next binding cannot seek the replacement clip', () => {
  const el = new Player(); let staleReady = 0; let ready = 0
  const cancel = prepareVideoFrame(el, { url: 'third.mp4', target: 7, sourceChanged: true, gate: true, onReady: () => staleReady++ })
  cancel()
  prepareVideoFrame(el, { url: 'second.mp4', target: 1, sourceChanged: true, gate: true, onReady: () => ready++ })
  el.event('loadedmetadata'); assert.equal(el.currentTime, 1)
  el.sought(); el.frame(1)
  assert.equal(staleReady, 0); assert.equal(ready, 1)
})
test('same-file clip change waits for its decoded seek frame', () => {
  const el = new Player(); let ready = 0
  prepareVideoFrame(el, { url: el.src, target: 3, sourceChanged: false, gate: true, onReady: () => ready++ })
  el.sought(); assert.equal(ready, 0)
  el.frame(9); assert.equal(ready, 0)
  el.frame(3); assert.equal(ready, 1)
})
test('effect restart during source load still waits for the new source metadata', () => {
  const el = new Player(); let ready = 0
  const cancel = prepareVideoFrame(el, { url: 'next.mp4', target: 9, sourceChanged: true, gate: true, onReady: () => {} })
  cancel()
  prepareVideoFrame(el, { url: 'next.mp4', target: 9, sourceChanged: false, gate: true, onReady: () => ready++ })
  assert.equal(ready, 0)
  el.event('loadedmetadata')
  assert.equal(ready, 1)
})
test('frame-before-seeked event ordering still completes', () => {
  const el = new Player(); let ready = 0
  prepareVideoFrame(el, { url: el.src, target: 3, sourceChanged: false, gate: true, onReady: () => ready++ })
  el.frame(3); assert.equal(ready, 0)
  el.sought(); assert.equal(ready, 1); assert.equal(el.frames.size, 0)
})
test('effect cleanup cancels queued frame and media callbacks', () => {
  const el = new Player(); let ready = 0
  const cancel = prepareVideoFrame(el, { url: el.src, target: 3, sourceChanged: false, gate: true, onReady: () => ready++ })
  cancel(); el.sought(); el.frame(3); el.event('loadedmetadata')
  assert.equal(ready, 0); assert.equal(el.frames.size, 0)
})
test('same-block scrub keeps the previous picture visible', () => {
  const el = new Player()
  prepareVideoFrame(el, { url: el.src, target: 3, sourceChanged: false, gate: false, onReady: () => {} })
  assert.equal(el.style.visibility, 'visible')
})
test('unchanged source already at exact target does not wait for another frame', () => {
  const el = new Player(); let ready = 0
  prepareVideoFrame(el, { url: el.src, target: 9, sourceChanged: false, gate: true, onReady: () => ready++ })
  assert.equal(ready, 1); assert.equal(el.frames.size, 0)
})
console.log(`${passed} monitor binding tests passed`)
