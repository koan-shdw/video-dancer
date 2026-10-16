// list 16 (2026-09-30) — LTX with ONLY the full (dev bf16) size installed renders: the render ladder
// lands on it as its last rung (its recipe was proven 08-27), a distilled size still wins when one
// is installed, and the renderer's gate no longer blocks it. Dummy files stand in for the weights.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ltx-full-'))
const root = path.resolve(__dirname, '..').replaceAll('\\', '/')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0', isPackaged: false }, session: { defaultSession: { on: () => {} } }, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const load = async (contents, extra = {}) => {
  const out = await require('esbuild').build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron'], logLevel: 'silent', plugins: [raw], define: { 'import.meta.hot': 'undefined' } })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : extra[n] ?? require(n)), mod, mod.exports)
  return mod.exports
}

;(async () => {
  const main = await load(`export { pickInstalledVariant, ltxWeightsDir } from '${root}/src/main/ltxLocal'; export { LOCAL_MODELS } from '@koan/vidancer-ui/shared/localModels'`)
  const dir = main.ltxWeightsDir()
  fs.mkdirSync(dir, { recursive: true })
  const put = (id) => { for (const f of main.LOCAL_MODELS.find((m) => m.id === id).files) fs.writeFileSync(path.join(dir, f.file), 'x') }
  assert.throws(() => main.pickInstalledVariant(), /no LTX size is installed/)
  put('ltx-2.5-full')
  const v = main.pickInstalledVariant()
  assert.deepEqual({ row: v.row, dev: v.dev }, { row: 'ltx-2.5-full', dev: true }, 'only full installed: the ladder lands on it, with the dev recipe')
  assert.equal(main.pickInstalledVariant('ltx-2.5-quality').row, 'ltx-2.5-full', 'a pinned size that is missing falls to it too')
  assert.equal(main.pickInstalledVariant('ltx-2.5-quality').requestedMissing, true, '… and says so')
  put('ltx-2.5-quality')
  assert.equal(main.pickInstalledVariant().row, 'ltx-2.5-quality', 'a distilled size still wins the auto pick')
  assert.equal(main.pickInstalledVariant('ltx-2.5-full').dev, true, 'full stays an explicit pick beside it')

  // the renderer's gate
  const ui2 = await load(`import { setVidancerApi } from '${ui}/api'; export { refreshLtxReady, ltxReady, ltxGateReason } from '${ui}/lib/ltxReady'; export { setVidancerApi }`)
  const rows = (ids) => ({ rows: ids.map((id) => ({ id, status: 'ready', bytes: 1, pct: 0 })), envs: [], gpu: null })
  let list = rows(['ltx-2.5-full'])
  ui2.setVidancerApi({ modelsList: async () => list, onModelsDone: () => () => {} })
  ui2.refreshLtxReady(); await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual({ ready: ui2.ltxReady().renderReady, dev: ui2.ltxReady().devReady, why: ui2.ltxGateReason() }, { ready: true, dev: true, why: null }, 'full only: ready, no block')
  list = rows([])
  ui2.refreshLtxReady(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(ui2.ltxGateReason(), 'LTX is not installed — download a size in the Models card')
  console.log('PASS LTX full-only: the ladder ends on full (dev bf16), distilled sizes still win, the render gate lets it through')
})().catch((e) => { console.error(e); process.exitCode = 1 })
