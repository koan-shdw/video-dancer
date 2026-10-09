// Audit 2026-10-09 batch 8, the testable core. The real GPU line (runtime.withGpu) and job records;
// nothing is spawned.
// M18 a job ✕'d while it waits for the GPU never runs, and the line moves on
// M20 a job he started has no clock; a Co-Director plan job's clock never runs while it waits
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-local-'))
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export { withGpu } from './src/main/runtime'; export { JobNotifications, requestStop } from './src/main/jobNotifications'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron', 'ffmpeg-static'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  const electron = { app: { getPath: () => temp, on: () => {} }, BrowserWindow: class {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'electron' ? electron : appRequire(n)), mod, mod.exports)
  const m = mod.exports
  let clock = 0
  const jobs = new m.JobNotifications({ projectDir: () => temp, enabled: async () => true, now: () => clock, notify() {}, cancel: async (j) => cancels.push(j.id), recover: async () => [] })
  const cancels = []
  const summary = (r) => ({ result: r, outputs: [] })

  // ---- M18 ----
  let freeGpu
  const busy = m.withGpu(() => new Promise((r) => { freeGpu = r })) // a render holds the GPU
  const waiting = await jobs.add({ projectDir: temp, kind: 'clip', targetId: '', engine: 'ltx25', label: 'second', deadlineMs: 60_000, cancelId: 'row-2' })
  let ran = false
  const second = jobs.execute(waiting, () => m.withGpu(async () => { ran = true; return { ok: true } }), summary).then(() => 'ok', (e) => e.message)
  await new Promise((r) => setTimeout(r, 20))
  m.requestStop('row-2') // ✕ while it waits in the GPU line
  freeGpu()
  await busy
  assert.match(await second, /cancelled/, 'it ends cancelled')
  assert.equal(ran, false, 'and never ran')
  assert.equal((await m.withGpu(async () => 'next')), 'next', 'the line moves on')
  console.log('PASS M18: a local job ✕d while it waits for the GPU never runs; the line moves on')

  // ---- M20 ----
  let finish
  const userJob = await jobs.add({ projectDir: temp, kind: 'enhance', targetId: '', engine: 'topaz', label: 'long', deadlineMs: 100 })
  const userRun = jobs.execute(userJob, () => new Promise((r) => { finish = r }), summary)
  await new Promise((r) => setTimeout(r, 10))
  clock = 10_000 // far past its deadline
  await jobs.settleInterrupted(temp)
  assert.equal(userJob.status, 'running', 'a job he started is never declared lost on a clock')
  assert.deepEqual(cancels, [], 'and never cancelled')
  finish({ ok: true }); await userRun
  console.log('PASS M20: a job he started has no clock')

  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
