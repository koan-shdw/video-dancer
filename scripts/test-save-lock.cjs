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
  let lockedName = 'project.json'
  const isLockedFile = (p) => path.basename(String(p)) === lockedName
  const io = {
    ...fs,
    rename: async (from, to) => {
      if (isLockedFile(to)) {
        renameCalls++
        if (renameRefusals > 0) {
          renameRefusals--
          throw Object.assign(new Error(`${renameCode}: operation not permitted, rename`), { code: renameCode })
        }
      }
      return fs.rename(from, to)
    },
    writeFile: async (file, ...rest) => {
      if (refuseInPlace && isLockedFile(file)) throw Object.assign(new Error('EPERM: in-place write refused'), { code: 'EPERM' })
      return fs.writeFile(file, ...rest)
    }
  }
  const result = await esbuild.build({
    stdin: { contents: `export * from './src/main/project'; export { JobNotifications } from './src/main/jobNotifications'`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs',
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

  // Job records use the same protection, for GO, manual renders and plan continuations.
  lockedName = 'codir-jobs.json'; renameRefusals = 0; renameCode = 'EPERM'
  const jobs = new p.JobNotifications({ projectDir: () => proj.dir, enabled: async () => true,
    recover: async () => [], cancel: async () => {}, notify: (dir, state) => {
      assert.deepEqual(JSON.parse(require('node:fs').readFileSync(path.join(dir, lockedName))), state, 'notify only after the job state is saved')
    } })
  const plan = await jobs.propose({ text: 'Render the saved clip.', renders: [{ kind: 'clip', engine: 'fake', maxJobs: 4, settings: {}, cost: 'free' }], tools: ['fire_render'], maxExchanges: 4, aiRoute: 'fake', aiCost: 'free' })
  renameRefusals = 3
  await jobs.approve(plan.id, plan.revision, 'fake')
  const jobInput = { projectDir: proj.dir, kind: 'clip', targetId: 'clip', engine: 'fake', label: 'Test clip', deadlineMs: 1000 }
  let submissions = 0
  for (const [i, code] of ['EPERM', 'EBUSY', 'EACCES'].entries()) {
    renameCode = code; renameRefusals = 2
    const job = await jobs.add({ ...jobInput, ...(i ? { planId: plan.id } : {}) })
    renameRefusals = 2
    await jobs.execute(job, async () => { submissions++; renameRefusals = 2; return { ok: true, file: 'saved.mp4' } }, result => ({ result, outputs: [{ file: result.file }] }))
    assert.equal(job.status, 'done')
  }
  assert.equal(submissions, 3, 'file-lock retries never resubmit the render')
  renameCode = 'EPERM'; renameRefusals = Infinity
  await jobs.progress('Three jobs finished.', false, 'Inspect their results.')
  const jobsPath = path.join(proj.dir, lockedName)
  const jobState = JSON.parse(await fs.readFile(jobsPath, 'utf8'))
  assert.equal(jobState.plan.next, 'Inspect their results.')
  const backups = (await fs.readdir(proj.dir)).filter(n => n.startsWith(lockedName + '.') && n.endsWith('.tmp'))
  assert.equal(backups.length, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(proj.dir, backups[0]), 'utf8')), jobState, 'long lock retains a complete backup')
  refuseInPlace = true
  await assert.rejects(jobs.progress('Cannot save this yet.', false), /in-place write refused/)
  assert.deepEqual(JSON.parse(await fs.readFile(jobsPath, 'utf8')), jobState, 'a refused save preserves the previous job record')
  refuseInPlace = false; renameRefusals = 0
  await jobs.progress('Recovered.', false)
  out.jobLocks = { goSaved: true, submissions, completed: jobState.jobs.length, longLockBackup: true, failedSavePreserved: true }

  // A real Windows handle: allow reads/writes, deny replacement, as a sync client can do.
  if (process.platform === 'win32') {
    const { spawn } = require('node:child_process')
    const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=[Console]::ReadLine(); $h=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); [Console]::WriteLine("locked"); [Console]::ReadLine() | Out-Null; $h.Dispose()'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const closed = new Promise(resolve => holder.once('close', resolve))
    try {
      const ready = new Promise((resolve, reject) => { holder.stdout.once('data', data => data.toString().includes('locked') ? resolve() : reject(Error('Unexpected lock helper output'))); holder.once('error', reject); holder.once('exit', code => reject(Error('Lock helper exited: ' + code))) })
      holder.stdin.write(jobsPath + '\n')
      await ready
      t = Date.now()
      await jobs.progress('Saved through a real Windows replacement lock.', false)
      assert.equal(JSON.parse(await fs.readFile(jobsPath, 'utf8')).plan.progress, 'Saved through a real Windows replacement lock.')
      out.windowsHandle = { savedWhileLocked: true, ms: Date.now() - t }
    } finally { holder.stdin.end('\n'); await closed }
  }

  await fs.rm(temp, { recursive: true, force: true })
  console.log(JSON.stringify(out, null, 2))
  console.log('save-lock: all checks passed')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
