// Offline regression: real adapter and progress callback, synthetic replies; no paid calls or files.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.resolve(root, file), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(text, context) {
  const exports = {}
  vm.runInNewContext(compile(text), { exports, ...context })
  return exports
}
const hunt = load(source('src/main/providers/mcp/hunt.ts'), { require })
let replies, polls, downloads
const bridge = {
  bridgeReady: () => true,
  onBestLogin: (_service, opts, run) => run(opts),
  bridgeToolCall: async (_service, tool) => {
    if (tool === 'generate_video') return { structuredContent: { results: [{ id: 'test-job' }] } }
    assert.equal(tool, 'job_status')
    polls++
    assert.ok(replies.length, 'polled again after the final reply')
    return { structuredContent: { generation: { id: 'test-job', ...replies.shift() } } }
  }
}
const hf = load(source('src/main/providers/mcp/higgsfieldMcp.ts'), {
  require: name => {
    if (name === '../../bridge') return bridge
    if (name === '../../bridge/interpreter') return {}
    if (name === '../../jobNotifications') return { markProviderAccepted() {}, assertNotStopped() {} }
    if (name === './hunt') return hunt
    if (name === '../../fal') return { downloadTo: async (url, file) => downloads.push({ url, file }) }
    if (name === '@koan/vidancer-ui/shared/models') return { modelFor: () => ({ endpoints: { ref2v: 'test-model' } }) }
    if (['fs/promises', 'path', 'crypto'].includes(name)) return require(name)
    throw Error('Unexpected dependency: ' + name)
  },
  setTimeout: fn => { assert.ok(replies.length, 'must not wait after a terminal reply'); fn() }
})
function reset(...values) { replies = values; polls = 0; downloads = [] }

async function terminalStates() {
  const messages = []
  const opts = { engine: 'test', mode: 'ref2v', images: [], prompt: 'test', duration: '5', resolution: '720p', outDir: __dirname, onProgress: msg => messages.push(msg) }
  for (const status of ['ip_detected', 'rejected', 'failed', 'nsfw', 'cancelled']) {
    reset({ status })
    await assert.rejects(hf.runHfMcpRender(opts), new RegExp('error @ higgsfield/job: ' + status))
    assert.equal(polls, 1)
    assert.equal(downloads.length, 0)
    reset({ status })
    assert.equal((await hf.fetchHfMcpResult('test-job', __dirname)).state, 'gone')
    assert.equal(polls, 1)
  }
  assert.ok(!messages.includes('Higgsfield: ip_detected…'))
  for (const status of ['pending', 'running', 'unrecognised-status']) {
    reset({ status })
    assert.equal((await hf.fetchHfMcpResult('test-job', __dirname)).state, 'running')
  }
  const video_url = 'https://example.invalid/result.mp4'
  reset({ status: 'pending' }, { status: 'running' }, { status: 'completed', video_url })
  const rendered = await hf.runHfMcpRender(opts)
  assert.equal(polls, 3)
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].url, video_url)
  assert.equal(downloads[0].file, rendered.file)
  assert.ok(messages.includes('Higgsfield: running…'))
  reset({ status: 'completed', video_url })
  assert.equal((await hf.fetchHfMcpResult('test-job', __dirname)).state, 'done')
  assert.equal(downloads.length, 1)
}

function progressIsolation() {
  const store = source('../koan-shared/vidancer-ui/src/store.ts')
  const start = store.indexOf('  setRunningJobMsg: (msg, pct, jobId) => {')
  const end = store.indexOf('  consumeJob:', start)
  assert.ok(start > 0 && end > start)
  const state = { queue: [
    { id: 'old-hf', inFlight: true, status: 'cancelled', msg: 'cancelling…' },
    { id: 'new-ark', inFlight: true, status: 'running', msg: 'ModelArk running…' }
  ] }
  const { actions } = load('export const actions = {\n' + store.slice(start, end) + '\n}', { set: fn => Object.assign(state, fn(state)) })
  const main = source('src/main/index.ts')
  const commonStart = main.indexOf('const common = {', main.indexOf("registerJobIpc('render:run'"))
  const commonEnd = main.indexOf('const rendered =', commonStart)
  assert.ok(commonStart > 0 && commonEnd > commonStart)
  const makeProgress = jobId => load('export ' + main.slice(commonStart, commonEnd), {
    req: { jobId }, videoFiles: [], audioFiles: [], proj: { dir: root }, join: path.join, e: { sender: {} },
    safeSend: (_sender, channel, p) => {
      assert.equal(channel, 'render:progress')
      actions.setRunningJobMsg(p.msg, p.pct, p.jobId)
    }
  }).common.onProgress
  const hfProgress = makeProgress('old-hf')
  const arkProgress = makeProgress('new-ark')
  hfProgress('old Higgsfield update')
  assert.equal(state.queue[0].msg, 'old Higgsfield update')
  assert.equal(state.queue[1].msg, 'ModelArk running…')
  arkProgress('ModelArk downloading…')
  assert.equal(state.queue[0].msg, 'old Higgsfield update')
  assert.equal(state.queue[1].msg, 'ModelArk downloading…')
  state.queue[0].inFlight = false
  hfProgress('late Higgsfield update')
  assert.equal(state.queue[0].msg, 'old Higgsfield update')
  assert.equal(state.queue[1].msg, 'ModelArk downloading…')
  assert.match(source('../koan-shared/vidancer-ui/src/App.tsx'), /setRunningJobMsg\(p\.msg, p\.pct, p\.jobId\)/)
}

;(async () => {
  let failed = false
  for (const [name, check] of Object.entries({ terminalStates, progressIsolation })) {
    try { await check(); console.log('PASS ' + name) }
    catch (e) { failed = true; console.error('FAIL ' + name, e) }
  }
  if (failed) process.exitCode = 1
})()
