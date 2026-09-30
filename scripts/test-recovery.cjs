// Exercise the actual recovery function with delayed, non-billing provider doubles.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript'), { transformSync } = require('esbuild')
const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
const names = ['resumePendingRenders', 'schedulePendingResume']
const code = transformSync(ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n'), { loader: 'ts' }).code
// list 52: the real stageDid (what a recovered ENHANCE request carries)
const enh = (() => { const m = { exports: {} }; new Function('module', 'exports', 'require', require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../../koan-shared/vidancer-ui/src/shared/enhance.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(m, m.exports, require); return m.exports })()
async function test() {
  let session = 1, p = { dir: 'A', scoreClips: [], voiceClips: [] }
  let ledger = [{ requestId: 'paid', endpoint: 'fal', req: { images: [], name: 'recovered' } }]
  let enhLedger = [], enhLanded = [], pushed = 0
  let state = 'running', landings = 0, calls = 0, block = null, busy = false
  let timer = null
  const ctx = vm.createContext({
    resumeRunning: false, recoveryState: {}, recoverySchedule: 0, recoveryTimer: undefined,
    getProject: () => p, captureProjectSession: () => session,
    assertProjectSession: (s) => { if (s !== session) throw Error('changed project') },
    hasMediaWrites: () => busy, beginMediaWrite: () => {}, endMediaWrite: () => {},
    listPendingRenders: async () => [...ledger], listPendingScores: async () => [], listPendingVoices: async () => [],
    listPendingEnhances: async () => [...enhLedger], removePendingEnhance: async (_d, m) => { enhLedger = enhLedger.filter((e) => e.requestId !== m.requestId) },
    addEnhancedCopy: async (o) => { enhLanded.push(o); return { delta: { clips: [] } } }, stageDid: enh.stageDid,
    loadSettings: async () => ({ falKey: 'test' }),
    fetchRenderResult: async () => { calls++; if (block) await block; return { state, file: 'A/render.mp4' } },
    removePendingRender: async () => { ledger = [] },
    addTake: async () => { landings++; return { delta: {} } }, pushProjectDelta: () => { pushed++ }, draftOf: () => undefined,
    mainWindow: { webContents: { send: () => {} } }, console: { error: () => {} },
    setTimeout: (fn) => { timer = fn; return { unref() {} } }, clearTimeout: () => { timer = null },
    recoveryError: () => {}, join: path.join, Date
  })
  vm.runInContext(code, ctx)
  const flush = () => new Promise(resolve => setImmediate(resolve))
  ctx.schedulePendingResume()
  timer(); await flush(); assert.equal(landings, 0); assert.equal(calls, 1)
  state = 'done'
  timer(); await flush(); assert.equal(landings, 1); assert.equal(ledger.length, 0)
  timer(); await flush(); assert.equal(landings, 1)
  console.log('PASS running job is collected automatically without reopening or duplicating')
  ledger = [{ requestId: 'other-paid', req: { images: [] } }]
  let release
  block = new Promise(resolve => { release = resolve })
  const first = ctx.resumePendingRenders()
  await flush()
  const before = calls
  await ctx.resumePendingRenders()
  assert.equal(calls, before)
  session++; p = { ...p, dir: 'B' }; release(); await first
  assert.equal(landings, 1); assert.equal(ledger.length, 1)
  console.log('PASS concurrent recovery is excluded and a project switch preserves the pending job')
  block = null; busy = true
  await ctx.resumePendingRenders(); assert.equal(calls, before)
  console.log('PASS recovery leaves live submissions alone')
  // list 52: an ENHANCE request fal took lands its copy after a crash, marked with all it carries
  busy = false; ledger = []; state = 'done'
  const args = { source: { kind: 'take', clipId: 'c', takeId: 't' }, interp: { engine: 'rife-fal', times: 2, slowmo: 1 }, upscale: { engine: 'seedvr-fal', scale: 2 }, adoptItemIds: ['blk'] }
  enhLedger = [{ requestId: 'enh-2', endpoint: 'fal-ai/seedvr/upscale/video', jobId: 'j', createdAt: 1, stage: 'upscale', args }]
  await ctx.resumePendingRenders()
  assert.equal(enhLanded.length, 1)
  assert.deepEqual(Object.keys(enhLanded[0].did), ['interp', 'upscale'], 'the upscale request worked on interpolated frames: both marks')
  assert.equal(enhLanded[0].forBlocks, true, 'an Optical Flow copy stays out of the clip’s playing take')
  assert.equal(enhLedger.length, 0, 'the record goes once the copy is in')
  assert.ok(pushed > 0, 'the window hears of it')
  state = 'running'; enhLedger = [{ requestId: 'enh-3', endpoint: 'fal-ai/rife/video', stage: 'interp', args }]
  await ctx.resumePendingRenders()
  assert.equal(enhLanded.length, 1); assert.equal(enhLedger.length, 1, 'still running on fal: kept for the next look')
  console.log('PASS a crashed ENHANCE job’s paid request lands its copy on the next look, marked right, its record then dropped')
}
test().catch(e => { console.error(e); process.exitCode = 1 })
