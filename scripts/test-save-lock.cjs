// Cloud-sync lock on project.json (field 2026-09-19: Dropbox held the file, the swap was refused
// with EPERM, one try and the save gave up). Isolated: temp projects only, the lock is simulated at
// the fs seam — same harness as test-project-safety.cjs.
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function main() {
  const temp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'vd-savelock-'))
  let renameRefusals = 0 // how many swaps onto project.json the "sync client" still refuses
  let renameCode = 'EPERM'
  let refuseInPlace = false
  let renameCalls = 0
  const isProjectJson = (p) => path.basename(String(p)) === 'project.json'
  const io = {
    ...fs,
    rename: async (from, to) => {
      if (isProjectJson(to)) {
        renameCalls++
        if (renameRefusals > 0) {
          renameRefusals--
          throw Object.assign(new Error(`${renameCode}: operation not permitted, rename`), { code: renameCode })
        }
      }
      return fs.rename(from, to)
    },
    writeFile: async (file, ...rest) => {
      if (refuseInPlace && isProjectJson(file)) throw Object.assign(new Error('EPERM: in-place write refused'), { code: 'EPERM' })
      return fs.writeFile(file, ...rest)
    }
  }
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/project.ts')], bundle: true, platform: 'node', format: 'cjs',
    write: false, external: ['ffmpeg-static'], logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { filename: 'project.ts' })(
    (name) => (name === 'fs/promises' ? io : appRequire(name)), mod, mod.exports
  )
  const p = mod.exports
  const proj = await p.newProject(temp, 'Locked')
  await p.openProject(proj.dir)
  const jp = path.join(proj.dir, 'project.json')
  const onDisk = async () => JSON.parse(await fs.readFile(jp, 'utf8')).name
  let failures = 0
  let recoveries = 0
  p.onSaveFailure((m) => (m ? failures++ : recoveries++))
  const out = {}

  // A — the holder lets go after three refusals: the swap lands by retry, nobody is alarmed
  renameRefusals = 3
  renameCalls = 0
  let t = Date.now()
  assert.equal(await p.renameCurrentProject('after a short lock'), true)
  assert.equal(await onDisk(), 'after a short lock')
  assert.equal(renameCalls, 4)
  assert.equal(failures, 0)
  out.shortLock = { renameCalls, ms: Date.now() - t, landed: 'swap', failures }

  // B — the holder never lets go: the save still lands, in place, and the .tmp safety copy stays
  renameRefusals = Infinity
  renameCalls = 0
  t = Date.now()
  await p.renameCurrentProject('through a long lock')
  assert.equal(await onDisk(), 'through a long lock')
  assert.equal(failures, 0)
  assert.equal(JSON.parse(await fs.readFile(jp + '.tmp', 'utf8')).name, 'through a long lock')
  out.longLock = { renameCalls, ms: Date.now() - t, landed: 'in place', tmpKept: true, failures }

  // C — the next clean swap replaces the kept .tmp (nothing piles up)
  renameRefusals = 0
  await p.renameCurrentProject('clean again')
  assert.equal(await onDisk(), 'clean again')
  await assert.rejects(fs.access(jp + '.tmp'))
  out.cleanAgain = { tmpGone: true }

  // D — both lanes refused: the save REJECTS and the user is told (the red bar)
  renameRefusals = Infinity
  refuseInPlace = true
  await assert.rejects(p.renameCurrentProject('never lands'))
  assert.equal(failures, 1)
  assert.equal(await onDisk(), 'clean again')
  refuseInPlace = false
  renameRefusals = 0
  await p.renameCurrentProject('recovered')
  assert.equal(recoveries, 1)
  out.bothRefused = { rejected: true, failures, recoveredAfter: true }

  // E — a non-lock error (disk full) is NOT retried: it fails at once
  renameRefusals = Infinity
  renameCode = 'ENOSPC'
  renameCalls = 0
  t = Date.now()
  await assert.rejects(p.renameCurrentProject('disk full'))
  assert.equal(renameCalls, 1)
  out.notALock = { renameCalls, ms: Date.now() - t }

  await fs.rm(temp, { recursive: true, force: true })
  console.log(JSON.stringify(out, null, 2))
  console.log('save-lock: all checks passed')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
