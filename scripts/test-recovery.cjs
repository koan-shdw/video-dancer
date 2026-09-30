// Exercise the actual recovery function with delayed, non-billing provider doubles.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript'), { transformSync } = require('esbuild')
const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
const names = ['resumePendingRenders', 'schedulePendingResume']
const code = transformSync(ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n'), { loader: 'ts' }).code
async function test() {
  let session = 1, p = { dir: 'A', scoreClips: [], voiceClips: [] }
  let ledger = [{ requestId: 'paid', endpoint: 'fal', req: { images: [], name: 'recovered' } }]
  let state = 'running', landings = 0, calls = 0, block = null, busy = false
  let timer = null
  const ctx = vm.createContext({
    resumeRunning: false, recoveryState: {}, recoverySchedule: 0, recoveryTimer: undefined,
    getProject: () => p, captureProjectSession: () => session,
    assertProjectSession: (s) => { if (s !== session) throw Error('changed project') },
    hasMediaWrites: () => busy, beginMediaWrite: () => {}, endMediaWrite: () => {},
    listPendingRenders: async () => [...ledger], listPendingScores: async () => [], listPendingVoices: async () => [],
    loadSettings: async () => ({ falKey: 'test' }),
    fetchRenderResult: async () => { calls++; if (block) await block; return { state, file: 'A/render.mp4' } },
    removePendingRender: async () => { ledger = [] },
    addTake: async () => { landings++; return { delta: {} } }, pushProjectDelta: () => {}, draftOf: () => undefined,
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
}
test().catch(e => { console.error(e); process.exitCode = 1 })
