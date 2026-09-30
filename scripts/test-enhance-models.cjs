// list 52 (2026-10-01) — the Models card lands ENHANCE's two portable programs: a row carries one zip
// per system (only this system's counts), the zip unpacks where it lands, goes, and a mark says it
// landed; a corrupt zip is kept as .bad and never trusted. The real modelStore inside Electron
// (Chromium owns the wire), a local server as the mirror — nothing is fetched from the internet.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-enhance-models-'))
  const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `export * as store from '${main}/modelStore'; export { LOCAL_MODELS } from '@koan/vidancer-ui/shared/localModels'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent' }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'store.cjs'), code)
  // the zip a release would carry: a folder with the program and its model beside it
  const pack = path.join(tmp, 'pack', 'prog-20221029-windows')
  fs.mkdirSync(path.join(pack, 'rife-v4.6'), { recursive: true })
  fs.writeFileSync(path.join(pack, 'rife-ncnn-vulkan.exe'), 'MZ stand-in')
  fs.writeFileSync(path.join(pack, 'rife-v4.6', 'flownet.bin'), Buffer.alloc(4096, 1))
  const r0 = require('node:child_process').spawnSync(process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar', ['-a', '-c', '-f', path.join(tmp, 'prog.zip'), '-C', path.join(tmp, 'pack'), 'prog-20221029-windows'], { encoding: 'utf8' })
  if (r0.status !== 0) throw Error('could not make the test zip: ' + r0.stderr)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 90000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2500)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  const assert = require('node:assert/strict')
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const { store, LOCAL_MODELS } = require(path.join(tmp, 'store.cjs'))
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    const ZIP = fs.readFileSync(path.join(tmp, 'prog.zip'))
    let serve = ZIP, hits = 0
    const server = http.createServer((_q, res) => { hits++; res.writeHead(200, { 'content-length': serve.length, 'content-type': 'application/zip' }); res.end(serve) })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${server.address().port}/prog.zip`
    const row = async (id) => (await store.list()).find((r) => r.id === id)
    LOCAL_MODELS.push({ id: 'test-prog', category: 'enhance', label: 'test program', blurb: '', usedBy: 'Enhance', homepage: '', license: 'MIT', sizeNote: '', files: [
      { file: 'prog.zip', url, bytes: ZIP.length, unpack: true, platform: process.platform },
      { file: 'prog-elsewhere.zip', url: url + '?other', bytes: 999, unpack: true, platform: process.platform === 'linux' ? 'darwin' : 'linux' }
    ] })
    const m = LOCAL_MODELS.at(-1)
    const dir = store.modelDir(m)
    assert.deepEqual(store.fileTargets(m).map((t) => t.file), ['prog.zip'], 'only this system’s build counts')
    assert.equal((await row('test-prog')).status, 'none')

    await store.download('test-prog', win.webContents)
    assert.equal(hits, 1, 'one fetch: the other system’s zip is never fetched')
    assert.ok(fs.existsSync(path.join(dir, 'unpacked', 'prog-20221029-windows', 'rife-ncnn-vulkan.exe')), 'the program is unpacked where the row lands')
    assert.ok(fs.existsSync(path.join(dir, 'unpacked', 'prog-20221029-windows', 'rife-v4.6', 'flownet.bin')), 'its model folder beside it')
    assert.ok(!fs.existsSync(path.join(dir, 'prog.zip')), 'the zip goes')
    const mark = JSON.parse(fs.readFileSync(path.join(dir, 'prog.zip.landed'), 'utf8'))
    assert.deepEqual([mark.file, mark.bytes], ['prog.zip', ZIP.length], 'a mark says it landed')
    assert.deepEqual([(await row('test-prog')).status, (await row('test-prog')).bytes], ['ready', ZIP.length], 'the row is ready, with its size')
    await store.download('test-prog', win.webContents)
    assert.equal(hits, 1, 'asked again: already there, nothing fetched')

    // a row with only another system's build: not offered, and a download says why
    LOCAL_MODELS.push({ id: 'test-prog-elsewhere', category: 'enhance', label: 'elsewhere', blurb: '', usedBy: 'Enhance', homepage: '', license: 'MIT', sizeNote: '', files: [{ file: 'x.zip', url, bytes: 1, unpack: true, platform: 'plan9' }] })
    assert.equal(await row('test-prog-elsewhere'), undefined, 'no row for a program this system can’t run')
    await assert.rejects(store.download('test-prog-elsewhere', win.webContents), /has no build for this system/)

    // a corrupt zip: kept as .bad, never marked, a retry fetches again
    LOCAL_MODELS.push({ id: 'test-prog-bad', category: 'enhance', label: 'bad', blurb: '', usedBy: 'Enhance', homepage: '', license: 'MIT', sizeNote: '', files: [{ file: 'bad.zip', url, bytes: 3000, unpack: true, platform: process.platform }] })
    serve = Buffer.alloc(3000, 0x41)
    await assert.rejects(store.download('test-prog-bad', win.webContents), /corrupt/)
    const bdir = store.modelDir(LOCAL_MODELS.at(-1))
    assert.ok(fs.existsSync(path.join(bdir, 'bad.zip.bad')), 'the corrupt zip is kept for a look')
    assert.ok(!fs.existsSync(path.join(bdir, 'bad.zip.landed')), 'never marked as landed')
    assert.equal((await row('test-prog-bad')).status, 'none')

    // the real rows: one pinned zip per system, from each project's own releases
    for (const [id, repo] of [['rife-ncnn', 'github.com/nihui/rife-ncnn-vulkan/releases/download/'], ['realesrgan-ncnn', 'github.com/xinntao/Real-ESRGAN/releases/download/']]) {
      const rm = LOCAL_MODELS.find((x) => x.id === id)
      assert.equal(rm.category, 'enhance')
      assert.deepEqual(rm.files.map((f) => f.platform).sort(), ['darwin', 'linux', 'win32'], `${id}: a build per system`)
      assert.ok(rm.files.every((f) => f.unpack && f.bytes > 1e6 && f.url.startsWith('https://' + repo) && f.url.endsWith('/' + f.file)), `${id}: pinned sizes, their own release pages`)
    }
    server.close()
    console.log('PASS the Models card lands a portable program: this system’s zip only, unpacked in place, the zip gone, a landed mark, ready with its size, never fetched twice; another system’s build is no row; a corrupt zip is kept as .bad and never marked; RIFE and Real-ESRGAN pin one release zip per system')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.stack || e)); app.exit(1) } })
}
