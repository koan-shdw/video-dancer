// Isolated audit probes. No user projects, settings, provider calls, or source edits.
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function main() {
  const temp = await fs.mkdtemp(path.join(__dirname, 'fixtures-'))
  let failWrites = false
  let copyGate = null
  const io = {
    ...fs,
    writeFile: async (...args) => {
      if (failWrites && String(args[0]).endsWith('project.json.tmp')) throw new Error('AUDIT: simulated disk full')
      return fs.writeFile(...args)
    },
    copyFile: async (...args) => {
      if (copyGate) await copyGate()
      return fs.copyFile(...args)
    }
  }
  const load = async (file) => {
    const result = await esbuild.build({
      entryPoints: [path.join(root, file)], bundle: true, platform: 'node', format: 'cjs',
      write: false, external: ['ffmpeg-static'], logLevel: 'silent'
    })
    const mod = { exports: {} }
    const wrapped = vm.runInThisContext(`(function(require,module,exports){${result.outputFiles[0].text}\n})`, { filename: file })
    wrapped((name) => name === 'fs/promises' ? io : appRequire(name), mod, mod.exports)
    return mod.exports
  }
  const p = await load('src/main/project.ts')
  const pending = await load('src/main/pending.ts')
  const a = await p.newProject(temp, 'Project A')
  const b = await p.newProject(temp, 'Project B')
  await p.openProject(a.dir)
  let notified = false
  p.onSaveFailure((message) => { if (message) notified = true })
  failWrites = true
  let rejected = false
  try {
    await p.addTake({ name: 'Paid render', promptData: p.emptyPromptData(), takeFile: path.join(a.dir, 'renders', 'paid.mp4') })
  } catch { rejected = true }
  failWrites = false
  const disk = JSON.parse(await fs.readFile(path.join(a.dir, 'project.json'), 'utf8'))
  const saveResult = { operationRejected: rejected, failureNotification: notified, memoryClips: p.getProject().clips.length, diskClips: disk.clips.length }
  assert.equal(rejected, false)
  assert.equal(notified, true)
  assert.equal(disk.clips.length, 0)

  await p.openProject(a.dir)
  const source = path.join(temp, 'reference.png')
  await fs.writeFile(source, 'audit fixture; no image decoding needed')
  let started
  const entered = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  copyGate = async () => { started(); await gate }
  const importing = p.importImage(source)
  await entered
  await p.openProject(b.dir)
  release()
  const imported = await importing
  copyGate = null
  const switchResult = { activeProject: p.getProject().name, registeredInB: p.getProject().images.some((x) => x.id === imported.id), fileWrittenUnderA: imported.file.startsWith(a.dir + path.sep) }
  assert.equal(switchResult.registeredInB, true)
  assert.equal(switchResult.fileWrittenUnderA, true)

  await fs.writeFile(path.join(a.dir, 'pending-renders.json'), '{"pending":[{"requestId":"paid-existing"}')
  const seen = await pending.listPendingRenders(a.dir)
  await pending.addPendingRender(a.dir, { requestId: 'new-job', endpoint: 'audit', createdAt: 0, req: {} })
  const ledger = JSON.parse(await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8'))
  const pendingResult = { unreadableLedgerReportedAs: seen, requestsAfterNewSubmission: ledger.pending.map((x) => x.requestId) }
  assert.deepEqual(pendingResult.requestsAfterNewSubmission, ['new-job'])
  const results = { saveFailure: saveResult, projectSwitch: switchResult, corruptPendingLedger: pendingResult }
  await fs.writeFile(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify(results, null, 2))
  console.log('Fixtures retained in: ' + temp)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
