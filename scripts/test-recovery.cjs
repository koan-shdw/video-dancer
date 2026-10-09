// Exercise the actual recovery function with delayed, non-billing provider doubles.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript'), { transformSync } = require('esbuild')
const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
const names = ['resumePendingRenders', 'schedulePendingResume', 'bookRecovered', 'landVeditNode', 'landEditTake', 'runV2vEngine']
const code = transformSync(ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n'), { loader: 'ts' }).code
// list 52: the real stageDid (what a recovered ENHANCE request carries)
const enh = (() => { const m = { exports: {} }; new Function('module', 'exports', 'require', require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../../koan-shared/vidancer-ui/src/shared/enhance.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(m, m.exports, require); return m.exports })()
async function test() {
  let session = 1, p = { dir: 'A', scoreClips: [], voiceClips: [] }
  let ledger = [{ requestId: 'paid', endpoint: 'fal', req: { images: [], name: 'recovered' } }]
  let enhLedger = [], enhLanded = [], pushed = 0
  let editLedger = [], nodes = [], editTakes = [], spends = [], fetched = [], files = new Set()
  let state = 'running', landings = 0, calls = 0, block = null, busy = false
  let timer = null, settings = { falKey: 'test' }
  const ctx = vm.createContext({
    resumeRunning: false, recoveryState: {}, recoverySchedule: 0, recoveryTimer: undefined,
    getProject: () => p, captureProjectSession: () => session,
    assertProjectSession: (s) => { if (s !== session) throw Error('changed project') },
    hasMediaWrites: () => busy, beginMediaWrite: () => {}, endMediaWrite: () => {},
    listPendingRenders: async () => [...ledger], listPendingScores: async () => [], listPendingVoices: async () => [],
    listPendingEnhances: async () => [...enhLedger], removePendingEnhance: async (_d, m) => { enhLedger = enhLedger.filter((e) => e.requestId !== m.requestId) },
    listPendingEdits: async () => [...editLedger], removePendingEdit: async (_d, m) => { editLedger = editLedger.filter((e) => e.requestId !== m.requestId) },
    appendVideoEditNode: async (o) => { nodes.push(o); return { delta: {}, nodeId: 'n' } }, emptyPromptData: () => ({}),
    addSpend: async (entry, dir) => { spends.push([dir, entry.label, entry.kind, entry.cost]); return { total: 0 } },
    fetchHfResult: async (id) => { fetched.push(['hf', id]); return { state: 'done', file: 'A/hf.mp4' } },
    fetchVeniceResult: async (id, model) => { fetched.push(['venice', id, model]); return { state: 'done', file: 'A/venice.mp4' } },
    existsSync: (f) => files.has(f), mkdir: async () => {}, probeVideo: async () => ({ duration: 4 }), importImage: async () => ({}),
    addEnhancedCopy: async (o) => { enhLanded.push(o); return { delta: { clips: [] } } }, stageDid: enh.stageDid,
    loadSettings: async () => settings,
    fetchRenderResult: async () => { calls++; if (block) await block; return { state, file: 'A/render.mp4' } },
    removePendingRender: async () => { ledger = [] },
    addTake: async (o) => { landings++; editTakes.push(o); return { delta: {} } }, pushProjectDelta: () => { pushed++ }, draftOf: () => undefined,
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

  // ---- audit 2026-10-09 batch 3 ----
  enhLedger = []; state = 'done'; spends = []; p = { ...p, dir: 'A', clips: [] } // the project these jobs belong to is the open one
  // H7: a Video Editor job fal took lands as a node of its tree, booked in ITS project
  const vreq = { engine: 'omni', prompt: 'make it rain', root: { videoId: 'v1' }, parentId: 'n0', inSec: 1, outSec: 3, spend: { label: 'Rain · edit', estCost: 0.8 } }
  editLedger = [{ requestId: 've-1', endpoint: 'fal-ai/omni/edit', provider: 'fal', createdAt: 1, channel: 'vedit', req: vreq }]
  await ctx.resumePendingRenders()
  assert.equal(nodes.length, 1, 'the paid video edit lands')
  assert.deepEqual([nodes[0].root, nodes[0].parentId, nodes[0].file, nodes[0].inSec, nodes[0].outSec, nodes[0].durationSec], [{ videoId: 'v1' }, 'n0', 'A/render.mp4', 1, 3, 4], 'under the node it was made from, with its window')
  assert.equal(editLedger.length, 0, 'its record goes once it is in')
  assert.deepEqual(spends, [['A', 'Rain · edit (recovered)', 'edit', 0.8]], 'M12: booked in the project that paid')
  // a clip edit whose result was already downloaded (the project changed): landed from disk, nothing fetched
  files.add('A/edit.mp4'); settings = {}; editTakes = []; spends = []
  const ereq = { prompt: 'slower', source: { clipId: 'c', takeId: 't' }, svFile: 'renders/t.mp4', spend: { label: 'Walk · edit', estCost: 0.5 } }
  editLedger = [{ requestId: 'ed-1', endpoint: 'x', provider: 'venice', createdAt: 1, channel: 'edit', req: ereq, file: 'A/edit.mp4' }]
  await ctx.resumePendingRenders()
  assert.equal(editTakes.length, 1); assert.equal(editTakes[0].takeFile, 'A/edit.mp4')
  assert.equal(editTakes[0].promptData.sourceVideo.file, 'renders/t.mp4', 'the source pin survives')
  assert.equal(fetched.length, 0, 'no key needed, nothing fetched')
  // a Venice video edit still cooking is kept; a Higgsfield one is asked on its own key
  settings = { veniceKey: 'v', hfKey: 'h' }
  editLedger = [{ requestId: 'hf-1', endpoint: 'x', provider: 'higgsfield', createdAt: 1, channel: 'vedit', req: vreq }]
  await ctx.resumePendingRenders()
  assert.deepEqual(fetched, [['hf', 'hf-1']])
  console.log('PASS H7: a Video Editor job or clip edit a supplier took lands after a crash or a project switch, booked in its own project')
  // M4: a local render that finished after a project switch lands from disk, with no key at all
  settings = {}; files.add('A/renders/ltx.mp4'); landings = 0; editTakes = []
  ledger = [{ requestId: 'local:1', endpoint: 'A/renders/ltx.mp4', provider: 'local', createdAt: 1, req: { images: [], name: 'Dance' } }]
  await ctx.resumePendingRenders()
  assert.equal(landings, 1); assert.equal(editTakes[0].takeFile, 'A/renders/ltx.mp4'); assert.equal(ledger.length, 0)
  console.log('PASS M4: a local render that finished after a project switch is added when its project opens')
  // H13: Bridge (auto) sent it to Venice: asked on the Venice key, never Higgsfield's
  settings = { veniceKey: 'v' }; fetched = []; landings = 0; spends = []
  ledger = [{ requestId: 'q-9', endpoint: 'venice:seedance-2-5-text-to-video-basic', provider: 'mcp', createdAt: 1, req: { images: [], name: 'Roof', spend: { label: 'Roof', estCost: 1.2 } } }]
  await ctx.resumePendingRenders()
  assert.deepEqual(fetched, [['venice', 'q-9', 'seedance-2-5-text-to-video-basic']])
  assert.equal(landings, 1)
  assert.deepEqual(spends, [['A', 'Roof (recovered)', 'gen', 1.2]], 'M12: a recovered render is booked')
  console.log('PASS H13: a Bridge (auto) render that went to Venice is recovered from Venice, and booked')
  // H7, the live half: the Video Editor's engine runner says who took the job, for every supplier it uses
  const took = []
  Object.assign(ctx, {
    modelFor: (id) => (id === 'omni' ? { label: 'Omni', v2v: { endpoint: 'fal-ai/omni/edit' } } : { label: 'Seedance', provider: { 'sd-hf': 'higgsfield', 'sd-ven': 'venice' }[id] ?? 'fal' }),
    runEdit: async (o) => { o.onRequestId('fal-1', 'fal-ai/omni/edit'); return { file: 'f.mp4' } },
    runHfRender: async (o) => { o.onRequestId('hf-1', 'hf-ep'); return { file: 'h.mp4' } },
    runVeniceRender: async (o) => { o.onRequestId('ven-1', 'ven-model'); return { file: 'v.mp4' } },
    runRender: async (o) => { o.onRequestId('fal-2', 'fal-ep'); return { file: 'r.mp4' } },
    resolveRefMedia: async () => ({ videos: [], audios: [] }), unknownEngineError: () => null, veniceLane: () => ({}), ensureInstallId: async () => 'id', primaryImageFile: () => 'x'
  })
  const v2v = (engine, keys) => ctx.runV2vEngine({}, keys, { engine, prompt: 'p', sendFile: 's', cacheKey: 's', outDir: 'o', onRequestId: (...a) => took.push(a) }, () => {})
  await v2v('omni', { falKey: 'k' }); await v2v('sd-hf', { hfKey: 'k' }); await v2v('sd-ven', { veniceKey: 'k' }); await v2v('sd-fal', { falKey: 'k' })
  assert.deepEqual(took, [['fal-1', 'fal-ai/omni/edit', 'fal'], ['hf-1', 'hf-ep', 'higgsfield'], ['ven-1', 'ven-model', 'venice'], ['fal-2', 'fal-ep', 'fal']], 'each supplier is named with the job it took')
  console.log('PASS H7: the Video Editor reports every job a supplier takes (fal edits, Higgsfield, Venice and fal re-gens)')
}
test().catch(e => { console.error(e); process.exitCode = 1 })
