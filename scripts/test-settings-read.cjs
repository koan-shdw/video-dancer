// Settings must never be wiped by a save that merged onto a failed read (audit 2026-10-08, Part 1 #1:
// any failed read of settings.json used to come back as {}, and the boot save wrote {} over it).
// readSettingsFile: missing = {}, a brief lock retries, damaged or locked-for-good THROWS and the
// bytes on disk stay as they were. Temp files only; the lock is simulated at the fs seam.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-settings-read-'))
  let busy = 0 // how many reads the "scanner" still refuses
  const io = {
    ...fs,
    readFile: async (...args) => {
      if (busy > 0) {
        busy--
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return fs.readFile(...args)
    }
  }
  const result = await esbuild.build({
    stdin: { contents: `export * from './src/main/settingsFile'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { filename: 'settingsFile.ts' })(
    (name) => (name === 'fs/promises' ? io : appRequire(name)), mod, mod.exports
  )
  const { readSettingsFile, SettingsUnreadable } = mod.exports
  const file = path.join(temp, 'settings.json')

  // first run: no file = empty settings
  assert.deepEqual(await readSettingsFile(file), {})
  // a good file reads as itself
  await fs.writeFile(file, JSON.stringify({ falKey: 'enc:abc', theme: 'deck' }))
  assert.equal((await readSettingsFile(file)).theme, 'deck')
  // a lock that lets go after three tries still reads
  busy = 3
  assert.equal((await readSettingsFile(file)).falKey, 'enc:abc')
  // a lock that never lets go refuses instead of returning {}
  busy = Infinity
  await assert.rejects(readSettingsFile(file), SettingsUnreadable)
  busy = 0
  // damaged JSON, null, an array: all refuse, and the file is untouched
  for (const bad of ['{"falKey": "enc:abc", "the', 'null', '[1,2]']) {
    await fs.writeFile(file, bad)
    await assert.rejects(readSettingsFile(file), SettingsUnreadable)
    assert.equal(await fs.readFile(file, 'utf8'), bad)
  }

  // the app's own loader and its boot save go through that door (a revert would bring the wipe back)
  const main = await fs.readFile(path.join(root, 'src/main/index.ts'), 'utf8')
  assert.match(main, /async function loadRawSettings\(\): Promise<Settings> \{\s*return readSettingsFile<Settings>\(settingsFile\(\)\)/)
  assert.match(main, /void patchSettings\(\{\}\)\.catch\(/)

  await fs.rm(temp, { recursive: true, force: true })
  console.log('settings read: missing = {}, short lock retried, damaged / null / array / locked-for-good refuse with the file untouched')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
