// Audit 2026-10-09 batch 5: results land in the project that asked. The real project, import, duplicate
// and Assembly code in temp projects; the AI calls are stand-ins held at a gate. Nothing leaves.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-wrong-project-'))
  let copyGate = null
  const io = { ...fs, copyFile: async (...a) => { if (copyGate) await copyGate(); return fs.copyFile(...a) }, link: async (...a) => { if (copyGate) await copyGate(); return fs.link(...a) } }
  let subcallGate = null
  const stubs = { name: 'stubs', setup(b) {
    b.onResolve({ filter: /^\.\/(subcall|watch)$/ }, (a) => ({ path: a.path, namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const runSubCalls = (...a) => globalThis.__subcall(...a); export const watchVideo = async () => ({ ok: true, text: "watched" })', loader: 'js' }))
  } }
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export * from './src/main/project'; export { assemblyConcept } from './src/main/assembly'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static', 'electron'], plugins: [stubs], logLevel: 'silent'
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'fs/promises' ? io : n === 'electron' ? { app: { getPath: () => temp } } : appRequire(n)), mod, mod.exports)
  const p = mod.exports
  globalThis.__subcall = async () => { if (subcallGate) await subcallGate; return { results: [{ ok: true, text: 'THE OUTLINE' }] } }
  const hold = () => { let open, entered; const inside = new Promise((r) => { entered = r }); const gate = new Promise((r) => { open = r }); return { inside, open, wait: async () => { entered(); await gate } } }

  // project A holds a clip with a take; B and C are other projects
  const a = await p.newProject(temp, 'A')
  await p.openProject(a.dir)
  const takeFile = path.join(a.dir, 'renders', 't.mp4')
  await fs.mkdir(path.dirname(takeFile), { recursive: true }); await fs.writeFile(takeFile, 'x')
  const { clipId } = await p.addTake({ name: 'Roof', promptData: p.emptyPromptData(), takeFile })
  const b = await p.newProject(temp, 'B')
  const c = await p.newProject(temp, 'C')
  const disk = async (dir) => JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'))

  // ---- M5: Ctrl+Z during a clip import: the clips land in the live project and are saved ----
  await p.openProject(b.dir)
  await p.renameCurrentProject('B edited')
  let h = hold(); copyGate = h.wait
  let importing = p.importClipsFrom(a.dir, [clipId])
  await h.inside
  await p.undo()
  copyGate = null; h.open()
  const imported = await importing
  assert.equal(imported.imported, 1)
  assert.equal(p.getProject().clips.length, 1, 'the clip is in the live project')
  assert.equal((await disk(b.dir)).clips.length, 1, 'and saved, not only on screen')
  // another project opened during the import: nothing lands in it
  await p.openProject(c.dir)
  h = hold(); copyGate = h.wait
  importing = p.importClipsFrom(a.dir, [clipId])
  await h.inside
  await p.openProject(b.dir)
  copyGate = null; h.open()
  assert.equal(await importing, null, 'the import is refused')
  assert.equal(p.getProject().clips.length, 1, 'B got nothing more')
  assert.equal((await disk(c.dir)).clips.length, 0, 'C, which asked, was not written behind its back either')
  console.log('PASS M5: a clip import lands in the live project it was asked for; a switch meanwhile lands nothing')

  // ---- M6: Assembly Concept that finishes after a switch writes nothing into the other project ----
  await p.openProject(a.dir)
  p.getProject().timelines[0].items.push({ id: 'i1', clipId, takeId: p.getProject().clips[0].takes[0].id, inSec: 0, outSec: 1, startSec: 0, track: 0 })
  await p.saveProject()
  let release; subcallGate = new Promise((r) => { release = r })
  const concept = p.assemblyConcept(undefined, { synthModel: 'x', watch: {} })
  await new Promise((r) => setTimeout(r, 20))
  await p.openProject(b.dir)
  release(); subcallGate = null
  const res = await concept
  assert.equal(res.ok, false); assert.match(res.error, /another project was opened/)
  assert.equal(p.getProject().assembly?.outline, undefined, 'B’s outline untouched')
  await p.openProject(a.dir)
  assert.equal((await p.assemblyConcept(undefined, { synthModel: 'x', watch: {} })).ok, true, 'without a switch it writes as before')
  console.log('PASS M6: Assembly that finishes after a switch writes nothing into the other project')

  // ---- L1: a brief that arrives after a switch is refused ----
  await p.openProject(b.dir)
  const briefBefore = p.getProject().codir.brief
  assert.equal(await p.codirSetBrief('typed in A', a.dir), null)
  assert.equal(p.getProject().codir.brief, briefBefore, 'B’s brief untouched')
  assert.ok(await p.codirSetBrief('typed in B', b.dir))
  console.log('PASS L1: a brief typed in one project is never written into another')

  // ---- H14: a duplicate leaves the run state behind ----
  for (const f of ['codir-jobs.json', 'queue.json', 'pending-renders.json', 'codir-jobs.damaged-1.json']) await fs.writeFile(path.join(a.dir, f), '{}')
  await fs.writeFile(path.join(a.dir, 'spend.json'), '{"entries":[]}')
  const dup = path.join(temp, 'A copy')
  await p.copyProjectFolder(a.dir, dup)
  const names = await fs.readdir(dup)
  for (const f of ['codir-jobs.json', 'queue.json', 'pending-renders.json', 'codir-jobs.damaged-1.json']) assert.ok(!names.includes(f), 'left behind: ' + f)
  for (const f of ['project.json', 'spend.json', 'renders']) assert.ok(names.includes(f), 'copied: ' + f)
  assert.ok(await fs.readFile(path.join(dup, 'renders', 't.mp4')), 'media included')
  console.log('PASS H14: a duplicate copies the project and its media, never an approved plan, the queue or recovery entries')

  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
