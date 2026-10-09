// Audit 2026-10-09 batch 9, the testable core: the real ref-tag rewrite and the real job record.
// H17 refs titled @imageN in any order: every mention still points at its own picture on the wire
// L10 ✕ or the clock on a one-request supplier (ElevenLabs, Google): marked taken, never sent again
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-lanes-'))
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export { applyRefTags } from '../koan-shared/vidancer-ui/src/shared/compile'; export { JobNotifications, lostWait } from './src/main/jobNotifications'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'ffmpeg-static'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  const electron = { app: { getPath: () => temp, on: () => {} }, BrowserWindow: class {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'electron' ? electron : appRequire(n)), mod, mod.exports)
  const m = mod.exports

  // ---- H17 ----
  assert.equal(m.applyRefTags('@image2 walks toward @image1', ['@image2', '@image1'], 'imageN'), '@image1 walks toward @image2', 'two refs out of order: each mention keeps its own picture')
  assert.equal(m.applyRefTags('@image3 and @image1 meet @image2', ['@image3', '@image1', '@image2'], 'imageN'), '@image1 and @image2 meet @image3')
  assert.equal(m.applyRefTags('@image1 by @image10', ['@image10', '@image1'], 'imageN'), '@image2 by @image1', '@image10 is never read as @image1')
  assert.equal(m.applyRefTags('@hero at @roof, @hero again', ['@roof', '@hero'], 'IMAGE_REF'), '<IMAGE_REF_1> at <IMAGE_REF_0>, <IMAGE_REF_1> again')
  assert.equal(m.applyRefTags('@heroine stays', ['@hero'], 'ImageN'), '@heroine stays', 'a longer name is not a mention')
  assert.equal(m.applyRefTags('no refs', ['', ''], 'imageN'), 'no refs')
  console.log('PASS H17: refs titled @imageN in any order keep every mention on its own picture')

  // ---- L10 ----
  const jobs = new m.JobNotifications({ projectDir: () => temp, enabled: async () => true, now: () => 0, notify() {}, cancel: async () => {}, recover: async () => [] })
  const run = async (fail) => {
    const job = await jobs.add({ projectDir: temp, kind: 'score', targetId: '', engine: 'eleven-music', label: 'song', deadlineMs: 60_000 })
    const r = await jobs.execute(job, async () => { throw fail() }, (x) => ({ result: x, outputs: [] })).catch((e) => e)
    return { job, r }
  }
  const stopped = new AbortController(); stopped.abort()
  let { job, r } = await run(() => m.lostWait('ElevenLabs', new DOMException('aborted', 'AbortError'), stopped.signal))
  assert.match(r.message, /^cancelled after ElevenLabs got it$/)
  assert.equal(job.providerAccepted, true, '✕ after it was sent: taken, never sent again')
  ;({ job, r } = await run(() => m.lostWait('Google', new DOMException('timed out', 'TimeoutError'), new AbortController().signal)))
  assert.match(r.message, /^Google sent no answer in time$/)
  assert.equal(job.providerAccepted, true, 'the clock ran out: taken too (it may still finish and bill)')
  const refused = new Error('ElevenLabs 400: bad prompt')
  ;({ job, r } = await run(() => m.lostWait('ElevenLabs', refused, new AbortController().signal)))
  assert.equal(r, refused, 'a refusal is passed on as it is')
  assert.ok(!job.providerAccepted, 'and is not marked taken')
  console.log('PASS L10: ✕ or the clock on an ElevenLabs / Google request marks it taken and says so; a refusal does not')

  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
