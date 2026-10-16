// list 12 (2026-09-30) — Clip Gen's MODEL list: a shut-down model (Sora 2) is out of the picker,
// except on a clip that still pins it; the Co-Director's engine list leaves it out the same way.
const path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src')
const code = buildSync({ stdin: { contents: `export * from '${ui.replaceAll('\\', '/')}/lib/engineOptions'; export { MODELS } from '${ui.replaceAll('\\', '/')}/shared/models'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, platform: 'node', format: 'cjs', bundle: true, write: false, logLevel: 'silent', define: { 'import.meta.hot': 'undefined' } }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports)
const { modelOptions, viaOptions, MODELS } = mod.exports
const values = (engine) => modelOptions(engine).map((o) => o.value)
assert.ok(!values().includes('sora2'), 'Sora 2 is not offered')
assert.ok(!values('seedance2').includes('sora2'), 'nor on a clip that uses another model')
assert.ok(values('sora2').includes('sora2'), 'a clip that still pins Sora 2 keeps its row')
assert.ok(values().includes('seedance2') && values().includes('omniflash'), 'the live families stay')
assert.ok(viaOptions('sora2', 'sora2').some((o) => o.value === 'sora2'), 'and its VIA row')
assert.equal(MODELS.sora2.hidden, true)
assert.ok(values().indexOf('omniflash11') >= 0 && values().indexOf('omniflash11') < values().indexOf('omniflash'), 'list 13: Omni Flash 1.1 is listed, before 1.0')
console.log('PASS engine options: Sora 2 is out of the MODEL list unless a clip still pins it')
// list 14: Venice joins the key lanes, the quality row before the fast one, before the Bridge rows
const vias = (fam) => viaOptions(fam).map((o) => o.label)
assert.deepEqual(vias('seedance2').slice(0, 5), ['fal', 'ModelArk', 'Astria', 'Venice', 'Venice (fast)'])
assert.deepEqual(vias('seedance25').slice(0, 3), ['fal', 'ModelArk', 'Venice'])
assert.equal(mod.exports.engineForFamily('seedance2'), 'seedance2', 'fal stays the first pick')
assert.equal(MODELS.seedance2venice.provider, 'venice')
console.log('PASS engine options: Venice rows sit with the key lanes')
