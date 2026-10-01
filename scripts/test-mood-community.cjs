// list 43 (COMMUNITY-MOODS-SPEC-2026-10-01) — the community MOODS: the list read from the repo's
// index.json (a missing repo, no connection and bad entries said or dropped), one click installs a
// checked file into the library (a MOOD of that name replaced only when told), share = the file with
// his name as its maker, Explorer showing it and the repo's upload page opened (never someone else's
// MOOD, never one made from someone else's skill), and the repo's own index builder. The real
// moods.ts and moodsCommunity.ts against temp folders; GitHub is a stand-in: nothing is fetched.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const vmd = (name, author, version = '1.0') => `---\nvmd: 1\nname: "${name}"\ndescription: "a quiet look"\ntriggers: [noir]\nnot-for: []\ntags: [image, noir]\nauthor: "${author}"\nversion: "${version}"\nsuffix: ""\n---\n\n## How to write\n\nWrite it dark.\n\n## What to know\n\nShadows.\n`

;(async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/moodsCommunity'; export { listMoods, saveMood, readMood } from '${main}/moods'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent', plugins: [raw] })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-mood-community-'))
  const shown = [], opened = []
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { app: { getPath: () => tmp, isPackaged: true }, shell: { showItemInFolder: (f) => shown.push(f), openExternal: async (u) => opened.push(u) } } : require(n)), mod, mod.exports)
  const m = mod.exports
  const RAW = 'https://raw.githubusercontent.com/koan-shdw/vidancer-moods/main'
  const asked = []
  const site = (files) => async (url) => {
    asked.push(url)
    const f = files[url.slice(RAW.length + 1)]
    if (f instanceof Error) throw f
    return f == null ? new Response('404: Not Found', { status: 404 }) : new Response(typeof f === 'string' ? f : JSON.stringify(f), { status: 200, headers: f.headers ?? {} })
  }

  // ---- the list ----
  assert.deepEqual(await m.communityList(site({})), { ok: false, error: 'the community repo is not up yet' })
  assert.deepEqual(await m.communityList(site({ 'index.json': new Error('offline') })), { ok: false, error: 'no connection to GitHub' })
  assert.equal(asked[0], `${RAW}/index.json`, 'it reads the repo’s index.json')
  const index = { v: 1, moods: [{ slug: 'quiet-noir', name: 'QUIET NOIR', author: 'mira', description: 'x'.repeat(900), tags: ['noir', 7], version: '1.2', bytes: 4800 }, { slug: '../../evil', name: 'EVIL' }, { slug: 'arcade-dreams', name: 'ARCADE DREAMS', author: 'kai' }, null] }
  const l = await m.communityList(site({ 'index.json': index }))
  assert.ok(l.ok)
  assert.deepEqual(l.moods.map((x) => x.slug), ['arcade-dreams', 'quiet-noir'], 'a bad slug is dropped, the rest sorted by name')
  assert.equal(l.moods[1].description.length, 600, 'long text is cut')
  assert.deepEqual(l.moods[1].tags, ['noir'], 'only text tags')
  assert.equal(l.moods[0].version, '1.0', 'no version reads as 1.0')

  // ---- one click installs, checked ----
  const files = { 'moods/quiet-noir.vmd': vmd('QUIET NOIR', 'mira', '1.2'), 'moods/big.vmd': Object.assign('x', { headers: { 'content-length': String(3 * 1024 * 1024) } }), 'moods/not-a-mood.vmd': '# just markdown' }
  assert.deepEqual(await m.communityInstall('../x', false, site(files)), { ok: false, error: 'not a MOOD name' })
  assert.deepEqual(await m.communityInstall('gone', false, site(files)), { ok: false, error: 'that MOOD is gone from the community list' })
  assert.deepEqual(await m.communityInstall('not-a-mood', false, site(files)), { ok: false, error: 'that file is not a MOOD (no vmd header)' })
  assert.deepEqual(await m.communityInstall('big', false, site(files)), { ok: false, error: 'too big to be a MOOD (over 2 MB)' })
  const ins = await m.communityInstall('quiet-noir', false, site(files))
  assert.ok(ins.ok && !ins.replaced, 'installed: ' + JSON.stringify(ins))
  const got = (await m.listMoods()).find((x) => x.slug === 'quiet-noir')
  assert.ok(got && got.author === 'mira' && got.version === '1.2', 'in the library, its maker credited')
  const again = await m.communityInstall('quiet-noir', false, site(files))
  assert.ok(!again.ok && /already in the library/.test(again.error), 'a MOOD of that name is not replaced unasked')
  files['moods/quiet-noir.vmd'] = vmd('QUIET NOIR', 'mira', '1.3')
  const up = await m.communityInstall('quiet-noir', true, site(files))
  assert.ok(up.ok && up.replaced && (await m.readMood('quiet-noir')).version === '1.3', 'update = replaced when told')

  // ---- share = a pull request ----
  await m.saveMood({ name: 'Arcade Dreams', author: '', howToWrite: 'neon', whatToKnow: 'cabinets' })
  assert.deepEqual(await m.communityShare('arcade-dreams', ''), { ok: false, error: 'set your name on MOODS in Settings first: the community credits the maker' })
  assert.deepEqual(await m.communityShare('quiet-noir', 'Koan'), { ok: false, error: 'QUIET NOIR is by mira: only its maker shares it' })
  assert.deepEqual(await m.communityShare('hardcore-anime', 'Koan'), { ok: false, error: "HARDCORE ANIME was made from someone else's skill: it is not yours to share" })
  assert.equal((await m.listMoods()).find((x) => x.slug === 'hardcore-anime').foreign, true, 'the list marks it')
  assert.deepEqual(shown, [], 'nothing shown for a refused share')
  const sh = await m.communityShare('arcade-dreams', 'Koan')
  assert.ok(sh.ok, JSON.stringify(sh))
  assert.equal(sh.file, path.join(tmp, 'moods-share', 'arcade-dreams.vmd'))
  assert.match(fs.readFileSync(sh.file, 'utf8'), /\nauthor: "Koan"\n/, 'his name is written in as the maker')
  assert.deepEqual(shown, [sh.file], 'Explorer shows the file')
  assert.deepEqual(opened, ['https://github.com/koan-shdw/vidancer-moods/upload/main/moods'], 'the repo’s upload page opens')
  assert.ok(!/author: "Koan"/.test(fs.readFileSync((await m.readMood('arcade-dreams')).file, 'utf8')), 'the library copy is untouched')
  assert.ok((await m.communityShare('quiet-noir', 'MIRA')).ok, 'its maker shares it (any case)')

  // ---- the repo's index builder ----
  const builder = path.resolve(__dirname, '../../vidancer-moods/scripts/build-index.mjs')
  if (fs.existsSync(builder)) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-moods-repo-'))
    fs.mkdirSync(path.join(repo, 'scripts')); fs.mkdirSync(path.join(repo, 'moods'))
    fs.copyFileSync(builder, path.join(repo, 'scripts', 'build-index.mjs'))
    fs.writeFileSync(path.join(repo, 'moods', 'quiet-noir.vmd'), vmd('QUIET NOIR', 'mira', '1.2'))
    const run = (...a) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'build-index.mjs'), ...a], { encoding: 'utf8' })
    let r = run('--check')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!fs.existsSync(path.join(repo, 'index.json')), '--check writes nothing')
    r = run()
    assert.equal(r.status, 0, r.stderr)
    const ix = JSON.parse(fs.readFileSync(path.join(repo, 'index.json'), 'utf8'))
    assert.deepEqual(ix.moods.map((x) => [x.slug, x.name, x.author, x.version, x.tags.join('|')]), [['quiet-noir', 'QUIET NOIR', 'mira', '1.2', 'image|noir']], 'index.json from the headers')
    assert.ok((await m.communityList(site({ 'index.json': ix }))).moods[0].bytes > 0, 'the app reads what the builder writes')
    fs.writeFileSync(path.join(repo, 'moods', 'Bad Name.vmd'), vmd('X', 'y'))
    fs.writeFileSync(path.join(repo, 'moods', 'anon.vmd'), vmd('ANON', ''))
    r = run('--check')
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Bad Name\.vmd: name the file by its slug/)
    assert.match(r.stderr, /anon\.vmd: the header has no author \(the maker is credited\)/)
  } else console.log('(the community repo folder is not beside vi-dancer: its builder is not checked here)')

  console.log('PASS community MOODS: the list from the repo’s index (not up yet, no connection, bad entries dropped), one click installs a checked file credited to its maker (replaced only when told), share writes his name in as the maker, shows the file and opens the repo’s upload page (never someone else’s, never one made from someone else’s skill), the repo’s builder writes index.json from the headers and --check stops a file without a slug name or a maker')
})().catch((e) => { console.error(e); process.exitCode = 1 })
