// list 36 (2026-09-30 answers, built 10-01) — THE SETUP WIZARD'S MAP. "A install and login wizard
// that lets users log into all the servies in a single login wizard the LLM, the video the image
// it outlines all the serves that each will provide and guies them for the login". His answers:
// every service the app has, no "recommended" tag. The map is read off the registries the pickers
// read, so this test holds it to them: nothing the app can use is missing, nothing is invented.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const out = require('esbuild').buildSync({ stdin: { contents: `
  export { setupPages } from '${ui}/lib/setupServices'
  export { KEY_SUPPLIERS } from '${ui}/lib/keySuppliers'
  export { MODELS, CODIR_ENGINES } from '${ui}/shared/models'
  export { PICKABLE_IMAGE_MODELS } from '${ui}/shared/imageModels'
  export { AUDIO_MODELS, VOICE_MODELS } from '${ui}/shared/audioModels'
  export { BRIDGE_SERVICES } from '${main}/bridge/services'
`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', define: { 'import.meta.hot': 'undefined' }, external: ['electron'] })
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? {} : require(n)), mod, mod.exports)
const m = mod.exports

const pages = m.setupPages()
const page = (id) => pages.find((p) => p.id === id)
const svc = (pid, id) => page(pid).services.find((s) => s.id === id)
const all = pages.flatMap((p) => p.services)

// ---- a page per kind of work, in his order: the LLM, the video, the image, then sound and watching ----
assert.deepEqual(pages.map((p) => [p.id, p.title]), [['codir', 'co-director'], ['video', 'video'], ['image', 'image'], ['audio', 'voice and music'], ['watch', 'watching']])
for (const p of pages) assert.ok(p.about && p.services.length, p.id + ' says what it is and lists services')

// ---- every service the app has ----
const keys = new Set(all.filter((s) => s.via.key).map((s) => s.via.key))
assert.deepEqual([...keys].sort(), m.KEY_SUPPLIERS.map((k) => k.id).filter((k) => k !== 'higgsfield').sort(), 'every key the app can hold is on a page (Higgsfield’s platform key has no engine left in the pickers)')
const logins = new Set(all.filter((s) => s.via.bridge).map((s) => s.via.bridge))
assert.deepEqual([...logins].sort(), m.BRIDGE_SERVICES.filter((b) => b.auth !== 'key').map((b) => b.id).sort(), 'every Bridge login is on a page (Venice’s Bridge row is its key)')
assert.deepEqual(page('codir').services.map((s) => s.id), m.CODIR_ENGINES.map((e) => e.id), 'every Co-Director engine, in the engine pick’s own order')
assert.deepEqual(page('codir').services.map((s) => s.via.cli ?? s.via.key), ['anthropic', 'claude', 'venice', 'codex', 'gemini', 'deepseek', 'openai'])
assert.deepEqual(['video', 'image', 'audio'].map((p) => !!svc(p, 'local')), [true, true, true], 'what runs on this PC is on its page, with no account')

// ---- no "recommended" tag, anywhere ----
assert.ok(!/recommend/i.test(JSON.stringify(pages)), 'no service is called recommended')

// ---- what each one gives is what the pickers offer ----
const engines = Object.values(m.MODELS).filter((x) => !x.hidden)
const bare = (l) => l.replace(/\s*\([^)]*\)\s*$/, '')
assert.deepEqual(svc('video', 'fal').gives, [...new Set(engines.filter((x) => (x.provider ?? 'fal') === 'fal').map((x) => bare(x.label)))])
assert.ok(svc('video', 'fal').gives.includes('Seedance 2') && svc('video', 'fal').gives.includes('Seedance 2.5') && !svc('video', 'fal').gives.some((g) => /Sora/.test(g)), 'fal: its live video engines, a retired one left out: ' + svc('video', 'fal').gives.join(', '))
assert.deepEqual(svc('video', 'ark').gives, ['Seedance 2', 'Seedance 2.5'], 'a supplier’s name is not repeated in what it gives')
assert.deepEqual(svc('video', 'google').gives, ['Gemini Omni Flash 1.1'])
assert.deepEqual([svc('video', 'bridge-runway').gives, svc('video', 'bridge-pika').gives], [['Seedance 2', 'Seedance 2.5'], ['Seedance 2']])
assert.deepEqual(svc('video', 'bridge-artlist').gives, ['a login only: no engine in the app runs on it yet'], 'a login that gives nothing yet says so')
assert.deepEqual(svc('video', 'local').gives, ['LTX 2.5', 'MiniMax H3'])
assert.equal(svc('video', 'higgsfield'), undefined, 'a key with no engine left is not offered')
for (const im of m.PICKABLE_IMAGE_MODELS) for (const v of im.vias) {
  const id = v.bridge ? 'bridge-' + v.bridge : v.id
  assert.ok(svc('image', id)?.gives.includes(im.label), `${im.label} is listed under ${id}`)
}
assert.deepEqual(svc('image', 'local').gives, ['Krea 2'])
assert.deepEqual(svc('image', 'civitai').gives, ['LoRA downloads for the LoRA shelf'])
const sound = [...Object.values(m.AUDIO_MODELS), ...Object.values(m.VOICE_MODELS)].filter((x) => !x.hidden)
for (const a of sound) {
  const id = a.provider === 'local' ? 'local' : a.provider === 'elevenlabs' ? 'eleven' : a.provider
  assert.ok(svc('audio', id).gives.some((g) => g.includes(bare(a.label))), `${a.label} is listed under ${id}`)
}
assert.deepEqual(svc('audio', 'eleven').gives.map((g) => g.split(':')[0]), ['music', 'sound fx', 'voice'], 'sound is grouped by what it makes')
assert.deepEqual(svc('watch', 'google').via, { key: 'google' })
for (const s of all) assert.ok(s.name && s.gives.length && s.gives.every(Boolean), s.id + ' names itself and says what it gives')

console.log(`PASS the setup wizard’s map: five pages (co-director, video, image, voice and music, watching); ${all.length} rows covering every key, every Bridge login, every Co-Director engine and what runs on this PC; what each gives is read off the pickers’ own registries (retired engines left out, a login with no engine says so); no "recommended" tag`)
