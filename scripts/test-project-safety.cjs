// Isolated audit probes. No user projects, settings, provider calls, or source edits.
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function main() {
  const temp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'vd-safety-'))
  let failWrites = false
  let denyLedgerRead = false
  let copyGate = null
  const io = {
    ...fs,
    readFile: async (...args) => {
      if (denyLedgerRead && String(args[0]).endsWith('pending-renders.json')) throw Object.assign(new Error('simulated access denied'), { code: 'EACCES' })
      return fs.readFile(...args)
    },
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
    await p.addTake({ requestId: 'paid-request', name: 'Paid render', promptData: p.emptyPromptData(), takeFile: path.join(a.dir, 'renders', 'paid.mp4') })
  } catch { rejected = true }
  failWrites = false
  const disk = JSON.parse(await fs.readFile(path.join(a.dir, 'project.json'), 'utf8'))
  const saveResult = { operationRejected: rejected, failureNotification: notified, memoryClips: p.getProject().clips.length, diskClips: disk.clips.length }
  assert.equal(rejected, true)
  assert.equal(notified, true)
  assert.equal(disk.clips.length, 0)
  await p.addTake({ requestId: 'paid-request', name: 'Paid render', promptData: p.emptyPromptData(), takeFile: path.join(a.dir, 'renders', 'recovered.mp4') })
  assert.equal(p.getProject().clips.length, 1)
  assert.equal(p.getProject().clips[0].takes.length, 1)
  assert.equal(JSON.parse(await fs.readFile(path.join(a.dir, 'project.json'), 'utf8')).clips[0].takes.length, 1)

  await p.openProject(a.dir)
  const source = path.join(temp, 'reference.png')
  await fs.writeFile(source, 'audit fixture; no image decoding needed')
  let started
  const entered = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  copyGate = async () => { started(); await gate }
  const importing = p.importImage(source).then(() => false, () => true)
  await entered
  await p.openProject(b.dir)
  release()
  const importRejected = await importing
  copyGate = null
  const switchResult = { activeProject: p.getProject().name, registeredInB: p.getProject().images.length, importRejected }
  assert.equal(switchResult.registeredInB, 0)
  assert.equal(importRejected, true)
  const oldSession = p.captureProjectSession()
  await p.openProject(a.dir)
  await p.openProject(b.dir)
  assert.throws(() => p.assertProjectSession(oldSession), /project changed/i)

  // Exercise the complete audio and external-take import paths across A -> B -> A.
  for (const kind of ['audio', 'take']) {
    await p.openProject(a.dir)
    const clipId = p.getProject().clips[0].id
    const before = p.getProject().clips[0].takes.length
    let begin, finish
    const begun = new Promise(r => { begin = r })
    const held = new Promise(r => { finish = r })
    copyGate = async () => { begin(); await held }
    const work = (kind === 'audio' ? p.importAudioFiles([source]) : p.addTakeFromFile(clipId, source)).then(() => false, () => true)
    await begun
    await p.openProject(b.dir); await p.openProject(a.dir)
    finish(); assert.equal(await work, true)
    copyGate = null
    assert.equal(p.getProject().audio.length, 0)
    assert.equal(p.getProject().clips[0].takes.length, before)
  }

  await fs.writeFile(path.join(a.dir, 'pending-renders.json'), '{"pending":[{"requestId":"paid-existing"}')
  const original = await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8')
  await assert.rejects(pending.listPendingRenders(a.dir), /original file was preserved/)
  await assert.rejects(pending.addPendingRender(a.dir, { requestId: 'new-job', endpoint: 'audit', createdAt: 0, req: {} }), /original file was preserved/)
  assert.equal(await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8'), original)
  denyLedgerRead = true
  await assert.rejects(pending.listPendingRenders(a.dir), /original file was preserved/)
  await assert.rejects(pending.addPendingRender(a.dir, {requestId:'new-job'}), /original file was preserved/)
  denyLedgerRead = false
  assert.equal(await fs.readFile(path.join(a.dir, 'pending-renders.json'), 'utf8'), original)
  const pendingResult = { malformedLedgerPreserved: true }
  const results = { saveFailure: saveResult, projectSwitch: switchResult, corruptPendingLedger: pendingResult }
  console.log(JSON.stringify(results, null, 2))
  console.log('Fixtures retained in: ' + temp)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
