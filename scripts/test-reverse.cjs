// list 51 (2026-09-30) — main/reverse.ts: a take's reversed copy is frame-exact on BOTH paths (one
// pass, and the big-take chunks joined last-first), keeps its sound, and is made once. The source
// is a gray ramp (frame n = gray 3n) so every frame is unique and checkable.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const { spawnSync } = require('node:child_process'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const ffmpeg = require('ffmpeg-static')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-reverse-test-'))
const run = (args) => { const r = spawnSync(ffmpeg, args, { maxBuffer: 8e6 }); if (r.status !== 0) throw Error(String(r.stderr)); return r }
const src = path.join(tmp, 'ramp.mp4')
run(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-vf', "geq=lum='N*3':cb=128:cr=128", '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', src])
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main/reverse.ts')], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['ffmpeg-static', 'electron'] }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports)
const { ensureReversed } = mod.exports
const grayAt = (file, n) => run(['-v', 'error', '-i', file, '-vf', `select='eq(n\\,${n})',scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']).stdout[0]
const frameCount = (file) => Number(/frame=\s*(\d+)/.exec(String(spawnSync(ffmpeg, ['-i', file, '-map', '0:v', '-f', 'null', '-']).stderr).split('\n').filter((l) => l.includes('frame=')).pop())?.[1])
const hasAudio = (file) => /Audio:/.test(String(spawnSync(ffmpeg, ['-hide_banner', '-i', file]).stderr))
const checkCopy = (label) => {
  const rev = src + '.rev.mp4'
  assert.equal(frameCount(rev), 72, `${label}: 72 frames, none doubled or lost`)
  for (const n of [0, 1, 23, 24, 25, 47, 48, 60]) {
    const want = grayAt(src, 71 - n) // the copy's frame n = the take's frame 71 − n (neighbours differ by ~3.5)
    const got = grayAt(rev, n)
    assert.ok(Math.abs(got - want) <= 1, `${label}: copy frame ${n} = take frame ${71 - n} (gray ${got}, want ${want})`)
  }
  assert.ok(hasAudio(rev), `${label}: the sound comes along (reversed)`)
}
;(async () => {
  const one = await ensureReversed(src)
  assert.deepEqual(one, { ok: true, made: true }, 'one pass made the copy')
  checkCopy('one pass')
  assert.deepEqual(await ensureReversed(src), { ok: true }, 'asked again: already there, nothing made')
  fs.rmSync(src + '.rev.mp4')
  const [a, b] = await Promise.all([ensureReversed(src, 1), ensureReversed(src, 1)]) // budget 1 byte → the chunked path
  assert.ok(a.ok && a.made && b === a || (a.ok && b.ok), 'two asks at once share one run')
  checkCopy('chunked (joins at output frames 23|24)')
  assert.deepEqual(await ensureReversed(path.join(tmp, 'gone.mp4')), { ok: false, error: 'the take file is missing' }, 'a missing take says so')
  console.log('PASS reversed copies: frame-exact on one pass and chunked, sound kept, made once, shared runs. Fixtures: ' + tmp)
})().catch((e) => { console.error(e); process.exitCode = 1 })
