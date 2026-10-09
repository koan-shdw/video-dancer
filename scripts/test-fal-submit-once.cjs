// Audit 2026-10-09 L12: fal's own client re-sends a queue SUBMIT on 502/503/504. fal may have taken
// the first one, so the re-send would be a second paid job nobody tracks. The app's fetch hook stops
// a submit that gets a gateway error after ONE send, marked taken. Status polls and a 429 refusal
// keep fal's own retries. The real @fal-ai/client runs here; fetch is a stand-in, nothing leaves.
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export { acquireFalKey, releaseFalKey } from './src/main/fal'; export { JobNotifications } from './src/main/jobNotifications'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'electron' ? { app: { getPath: () => root } } : n === './runtime' ? {} : appRequire(n)), mod, mod.exports)
  const m = mod.exports
  const { fal } = appRequire('@fal-ai/client')

  let posts = 0, statuses = 0, submitStatus = 503
  global.fetch = async (url, init = {}) => {
    const u = String(url)
    if (init.method === 'POST' && u.startsWith('https://queue.fal.run/')) {
      posts++
      return submitStatus ? new Response('bad gateway', { status: submitStatus }) : new Response(JSON.stringify({ request_id: 'r-1', status_url: 'https://queue.fal.run/fal-ai/x/requests/r-1/status', response_url: 'https://queue.fal.run/fal-ai/x/requests/r-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/requests/r-1/status')) return ++statuses < 2 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/requests/r-1')) return new Response(JSON.stringify({ video: { url: 'x' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  }
  const realSetTimeout = setTimeout
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms ?? 0, 5), ...a) // fal's backoff, fast

  // inside a job, as every render runs: one POST, an error naming the status, the job marked taken
  const jobs = new m.JobNotifications({ projectDir: () => undefined, enabled: async () => true, notify() {}, cancel: async () => {}, recover: async () => [] })
  const job = { id: 'j', projectDir: '', status: 'queued', attempt: 0, kind: 'clip', targetId: '', engine: 'x', label: 'x', deadlineMs: 1000 }
  jobs.save = async () => {}
  jobs.assert = async () => {}
  m.acquireFalKey('k')
  for (const code of [502, 503, 504]) {
    posts = 0; submitStatus = code; job.providerAccepted = false
    const r = await jobs.execute(job, () => fal.subscribe('fal-ai/x', { input: { prompt: 'p' } }).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message, status: e.status })), (x) => ({ result: x, outputs: [] }))
    assert.equal(posts, 1, `a ${code} on submit is sent once, never re-sent`)
    assert.equal(r.status, code)
    assert.match(r.error, /may have it/)
    assert.equal(job.providerAccepted, true, 'and the job is marked taken')
  }
  // a 429 refusal still gets fal's own retries (fal took nothing); a status poll's 503 is retried too
  posts = 0; submitStatus = 429
  await assert.rejects(fal.subscribe('fal-ai/x', { input: {} }))
  assert.equal(posts, 4, 'a 429 is refused, nothing taken: fal retries it as before')
  posts = 0; submitStatus = 0; statuses = 0
  await fal.subscribe('fal-ai/x', { input: {}, pollInterval: 1 })
  assert.equal(posts, 1)
  assert.ok(statuses >= 2, 'a busy status poll is asked again, as before')
  m.releaseFalKey()
  global.setTimeout = realSetTimeout
  console.log('FAL SUBMIT ONCE OK — a submit that gets 502/503/504 is sent once and marked taken; a 429 refusal and busy status polls keep fal’s retries')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
