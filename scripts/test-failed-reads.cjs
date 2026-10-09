// Audit 2026-10-09 batch 1: a file that exists but can't be read is never treated as empty and
// saved over. Only a MISSING file reads as empty; a lock waits; damage or a lock that never lets go
// refuses the save and leaves the bytes on disk as they were. Temp files only; locks are simulated
// at the fs seam, waits are shortened.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

const realSetTimeout = setTimeout
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms ?? 0, 2), ...a) // the retry waits, fast

async function load(entry, temp, io) {
  const raw = { name: 'raw', setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: a.path, namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, () => ({ contents: 'export default "the shipped text"', loader: 'js' }))
  } }
  const r = await esbuild.build({ stdin: { contents: entry, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['electron', 'ffmpeg-static'], plugins: [raw], logLevel: 'silent' })
  const electron = { app: { getPath: () => temp }, shell: { openPath: async () => '' } }
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${r.outputFiles[0].text}\n})`, { filename: 'bundle.js' })(
    (n) => (n === 'fs/promises' ? io : n === 'electron' ? electron : appRequire(n)), mod, mod.exports)
  return mod.exports
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-failed-reads-'))
  const locked = new Map() // file name -> reads still refused (Infinity = for good)
  const io = { ...fs, readFile: async (file, ...rest) => {
    const n = locked.get(path.basename(String(file))) ?? 0
    if (n > 0) { locked.set(path.basename(String(file)), n - 1); throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }) }
    return fs.readFile(file, ...rest)
  } }
  const m = await load(`export * from './src/main/fileSave'; export * from './src/main/project'; export * from './src/main/guides'; export { JobNotifications } from './src/main/jobNotifications'; export { modelsRoot, defaultModelsRoot } from './src/main/imagePaths'`, temp, io)

  // the door: missing = null, a short lock waits, a lock for good throws
  const f = path.join(temp, 'x.json')
  assert.equal(await m.readIfExists(f), null)
  await fs.writeFile(f, 'hello')
  locked.set('x.json', 3)
  assert.equal(await m.readIfExists(f), 'hello')
  locked.set('x.json', Infinity)
  await assert.rejects(m.readIfExists(f), /EBUSY/)
  locked.delete('x.json')

  // H1 spend ledger: a damaged or locked spend.json refuses the next entry and stays as it was
  const proj = await m.newProject(temp, 'Spend')
  await m.openProject(proj.dir)
  const spend = path.join(proj.dir, 'spend.json')
  await m.addSpend({ label: 'a', kind: 'gen', cost: 1 })
  assert.equal((await m.addSpend({ label: 'b', kind: 'gen', cost: 2 })).total, 3)
  const good = await fs.readFile(spend, 'utf8')
  locked.set('spend.json', Infinity)
  await assert.rejects(m.addSpend({ label: 'c', kind: 'gen', cost: 4 }))
  locked.delete('spend.json')
  assert.equal(await fs.readFile(spend, 'utf8'), good, 'a locked ledger is never written over')
  const damaged = '{"entries": [{"cost": 1}, {"co'
  await fs.writeFile(spend, damaged)
  await assert.rejects(m.addSpend({ label: 'd', kind: 'gen', cost: 8 }))
  assert.equal(await fs.readFile(spend, 'utf8'), damaged, 'a damaged ledger is never written over')
  assert.deepEqual((await m.listSpend()).entries, [], 'the display shows empty, writing nothing')
  await fs.writeFile(spend, good)
  assert.equal((await m.addSpend({ label: 'e', kind: 'gen', cost: 5 })).total, 8, 'readable again = booked onto the real ledger')

  // H3 learned rules + his guide: an unreadable file refuses the edit, the exchange still loads
  assert.equal(await m.appendLearned('first rule'), 'saved')
  assert.equal(await m.appendLearned('second rule'), 'saved')
  const learned = path.join(temp, 'guides', 'learned.md')
  const rules = await fs.readFile(learned, 'utf8')
  locked.set('learned.md', Infinity)
  await assert.rejects(m.appendLearned('third rule'))
  await assert.rejects(m.changeLearned(1, 'changed'))
  assert.match(await m.buildSystemGuides(), /GUIDE FILE/, 'the exchange still gets its guides')
  locked.delete('learned.md')
  assert.equal(await fs.readFile(learned, 'utf8'), rules, 'his rules are never replaced by one')
  await m.updateGuideText('master', undefined, 'my own section')
  const own = path.join(temp, 'guides', 'seedance-master-knowledge.md')
  const mine = await fs.readFile(own, 'utf8')
  assert.match(mine, /my own section/)
  locked.set('seedance-master-knowledge.md', Infinity)
  await assert.rejects(m.updateGuideText('master', undefined, 'another section'))
  locked.delete('seedance-master-knowledge.md')
  assert.equal(await fs.readFile(own, 'utf8'), mine, 'his guide is never replaced by the shipped one')

  // L6 job record: a damaged codir-jobs.json is set aside and a fresh record starts; a lock still refuses
  const jobsFile = path.join(proj.dir, 'codir-jobs.json')
  await fs.writeFile(jobsFile, '{"version": 1, "jobs": [')
  const jobs = new m.JobNotifications({ projectDir: () => proj.dir, enabled: async () => true, notify: () => {}, cancel: async () => {}, recover: async () => [] })
  assert.deepEqual((await jobs.read(proj.dir)).jobs, [])
  const aside = (await fs.readdir(proj.dir)).filter((n) => n.startsWith('codir-jobs.damaged-'))
  assert.equal(aside.length, 1)
  assert.equal(await fs.readFile(path.join(proj.dir, aside[0]), 'utf8'), '{"version": 1, "jobs": [', 'the damaged record is kept')

  // L7 models folder: an unreadable settings.json is not cached for the whole run
  const settings = path.join(temp, 'settings.json')
  await fs.writeFile(settings, '{"modelsFolder": ')
  assert.equal(m.modelsRoot(), m.defaultModelsRoot())
  await fs.writeFile(settings, JSON.stringify({ modelsFolder: 'D:\\models' }))
  assert.equal(m.modelsRoot(), 'D:\\models', 'read again once the file is readable')

  // the settings callers that rebuild lists read the file inside the save, and bookkeeping never fails an action
  const main = await fs.readFile(path.join(root, 'src/main/index.ts'), 'utf8')
  assert.match(main, /const noteRecent = \(dir: string\): Promise<unknown> =>\s*noteSettings\(\(s\) =>/)
  assert.match(main, /if \(windowSettingsBlind\) throw/)
  assert.doesNotMatch(main, /patchSettings\(\{\s*(recentProjects|loraFolders|externalEditors|lastExportDirs)/, 'lists are built inside the save, never from an earlier read')

  globalThis.setTimeout = realSetTimeout
  await fs.rm(temp, { recursive: true, force: true })
  console.log('FAILED READS OK — spend ledger, learned rules, his guide, the job record and the models folder: missing = empty, a short lock waits, damage or a lock for good refuses and leaves the file as it was')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
