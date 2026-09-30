// list 15 (2026-09-30) — a model file the app no longer pins (Lightricks re-issued the LTX encoders):
// the row stays ready and says an update is out; a plain download never touches the file; update
// fetches the new one, verifies it, and only then swaps it in (a bad fetch leaves the old file
// working). The real modelStore inside Electron (Chromium owns the wire), a local server as the mirror.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-model-update-'))
  const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `export * as store from '${main}/modelStore'; export { LOCAL_MODELS } from '@koan/vidancer-ui/shared/localModels'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent' }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'store.cjs'), code)
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
    const NEW = Buffer.alloc(300_000, 7), OLD = Buffer.alloc(300_123, 3)
    let serve = NEW
    const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-length': serve.length, 'content-type': 'application/octet-stream' }); res.end(serve) })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${server.address().port}/enc.bin`
    LOCAL_MODELS.push({ id: 'test-enc', category: 'video', folder: 'video/test', label: 'test encoder', blurb: '', usedBy: '', homepage: '', license: '', sizeNote: '', files: [{ file: 'enc.bin', url, bytes: NEW.length, sha256: crypto.createHash('sha256').update(NEW).digest('hex') }] })
    const dest = path.join(store.modelsRoot(), 'video', 'test', 'enc.bin')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, OLD) // the install still holds the older file
    const row = async () => (await store.list()).find((r) => r.id === 'test-enc')

    assert.deepEqual({ status: (await row()).status, updateBytes: (await row()).updateBytes }, { status: 'ready', updateBytes: NEW.length }, 'the row stays ready and says an update is out')
    await store.download('test-enc', win.webContents)
    assert.equal(fs.readFileSync(dest).length, OLD.length, 'a plain download never touches a present file')

    // a fetch that fails its check leaves the old file working
    serve = Buffer.alloc(NEW.length, 9)
    await assert.rejects(store.download('test-enc', win.webContents, { update: true }), /integrity check/)
    assert.equal(fs.readFileSync(dest).length, OLD.length, 'a bad fetch leaves the old file in place')
    assert.ok(!fs.existsSync(dest + '.part'), 'and leaves no partial behind')

    // the update: fetched, verified, then swapped in through main's swap step
    serve = NEW
    let swapped = 0
    await store.download('test-enc', win.webContents, { update: true, swap: async (replace) => { swapped++; assert.equal(fs.readFileSync(dest).length, OLD.length, 'the old file is still there when the swap starts'); await replace() } })
    assert.equal(swapped, 1)
    assert.ok(fs.readFileSync(dest).equals(NEW), 'the new file is in')
    assert.ok(fs.readFileSync(dest + '.prev').equals(OLD), 'the file it replaced is kept beside it until a render proves the new one')
    await store.dropPrev('test-')
    assert.ok(!fs.existsSync(dest + '.prev'), 'a proven update drops the old copy')
    assert.equal((await row()).updateBytes, undefined, 'nothing left to update')
    await store.download('test-enc', win.webContents, { update: true }) // nothing stale = a no-op
    assert.ok(fs.readFileSync(dest).equals(NEW))

    // the real manifest: both LTX encoders are the 08-17 files, off the gated repo and the old mirror
    const enc = LOCAL_MODELS.flatMap((m) => m.files ?? []).filter((f) => f.file.startsWith('gemma4-12b-with-proj-ltx-2.5'))
    assert.equal(enc.length, 6)
    assert.ok(enc.every((f) => !/comfyicu|Lightricks\//.test(f.url) && /\/resolve\/[0-9a-f]{40}\//.test(f.url)), 'every encoder comes from an open mirror pinned by commit')
    assert.deepEqual([...new Set(enc.map((f) => f.sha256))].sort(), ['6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f', 'ef7243612fdae7a75cb4d5cee9433e81380675fb6c213bd98ae74a9cd16561d1'])
    server.close()
    console.log('PASS model update: an older file keeps the row ready and offers update; a plain download leaves it; update verifies before it swaps; both LTX encoders pin the 08-17 files')
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.stack || e)); app.exit(1) } })
}
