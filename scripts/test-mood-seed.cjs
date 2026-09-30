// list 30 (2026-09-30) — the four new MOODS (first drafts for him to fix: 90s dark fantasy CGI,
// retro OVA, SHDW, KOAN) and how shipped moods reach a library: each one once, a deleted one stays
// deleted, a mood added in a later version still arrives, and a draft stays out of a packaged
// release. The real moods.ts against temp folders.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const DRAFTS = ['90s-dark-fantasy-cgi', 'koan', 'retro-ova', 'shdw'], FIRST = ['80s-dark-fantasy', 'hardcore-anime']

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/moods'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent', plugins: [raw] })
  // a fresh copy of the module per "install": its own userData folder, packaged or not
  const install = (dir, isPackaged) => {
    const mod = { exports: {} }
    vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { app: { getPath: () => dir, isPackaged }, shell: {} } : require(n)), mod, mod.exports)
    return mod.exports
  }
  const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vd-mood-seed-'))
  const files = (dir) => fs.readdirSync(path.join(dir, 'moods')).filter((f) => f.endsWith('.vmd')).map((f) => f.slice(0, -4)).sort()

  // ---- the app he runs from source: all six arrive, the four drafts switched off like any mood ----
  const dev = fresh()
  let m = install(dev, false)
  const list = await m.listMoods()
  assert.deepEqual(list.map((x) => x.slug), [...FIRST, ...DRAFTS].sort())
  assert.ok(list.every((x) => x.shipped))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dev, 'moods', '.seeded'), 'utf8')).sort(), [...FIRST, ...DRAFTS].sort(), 'the stamp lists what was seeded')

  // ---- each draft is a whole mood: a header, a locked closing line, both halves, and the line is in its own examples ----
  for (const slug of DRAFTS) {
    const mood = await m.readMood(slug)
    assert.ok(mood, slug)
    assert.equal(mood.vmd, 1)
    assert.equal(mood.version, '0.1', slug + ' is marked a first draft')
    assert.match(mood.description, /^FIRST DRAFT for the director to fix/, slug)
    assert.ok(mood.triggers.length >= 5 && mood.notFor.length >= 3 && mood.tags.includes('draft'), slug)
    assert.ok(mood.suffix.length > 120, slug + ' has its locked closing line')
    assert.ok(mood.howToWrite.includes(mood.suffix) && mood.whatToKnow.split(mood.suffix).length >= 3, slug + ': the closing line is taught word for word and closes both examples')
    assert.ok(mood.howToWrite.includes('ANTI-ARTIFACT RULES') && mood.howToWrite.includes('OUTPUT RULES') && mood.whatToKnow.includes('PULL-BANK') && mood.whatToKnow.includes('EXAMPLES'), slug)
    assert.ok(mood.tokens < 8000, slug + ' stays light: ' + mood.tokens)
    assert.ok(!mood.text.includes('—'), slug + ' has no em-dash')
  }
  for (const slug of ['shdw', 'koan']) assert.match((await m.readMood(slug)).description, /this is his own style, written down by the app's builder/, slug + ' says whose style it is and who guessed it')

  // ---- a deleted shipped mood stays deleted ----
  fs.unlinkSync(path.join(dev, 'moods', 'retro-ova.vmd'))
  m = install(dev, false)
  assert.ok(!(await m.listMoods()).some((x) => x.slug === 'retro-ova'), 'his delete holds across restarts')

  // ---- a library from before this version (its stamp is a bare date): the new ones arrive, nothing of his is touched ----
  const old = fresh()
  fs.mkdirSync(path.join(old, 'moods'))
  fs.writeFileSync(path.join(old, 'moods', '.seeded'), '2026-09-10T08:00:00.000Z')
  fs.writeFileSync(path.join(old, 'moods', 'hardcore-anime.vmd'), '---\nvmd: 1\nname: "HIS EDIT"\n---\n\n## How to write\nmine\n\n## What to know\nmine\n')
  m = install(old, false)
  await m.listMoods()
  assert.deepEqual(files(old), ['hardcore-anime', ...DRAFTS].sort(), 'the four new ones arrive; the one he deleted before (80s) does not come back')
  assert.match(fs.readFileSync(path.join(old, 'moods', 'hardcore-anime.vmd'), 'utf8'), /HIS EDIT/, 'a mood he edited is never overwritten')

  // ---- a packaged release: the drafts stay home until he says they are his ----
  const pub = fresh()
  m = install(pub, true)
  assert.deepEqual((await m.listMoods()).map((x) => x.slug), FIRST)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pub, 'moods', '.seeded'), 'utf8')).sort(), FIRST)

  console.log('PASS MOODS: four first drafts (90s dark fantasy CGI, retro OVA, SHDW, KOAN), each a whole mood with its locked closing line; shipped moods seed once each, a delete holds, a later version’s moods still arrive, an edited mood is never overwritten, drafts stay out of a packaged release')
})().catch((e) => { console.error(e); process.exitCode = 1 })
