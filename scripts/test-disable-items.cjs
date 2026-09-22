// DISABLE-ITEMS-SPEC-2026-09-19: benching Library / Bin items. Isolated: temp project only, the same
// esbuild harness as test-project-safety.cjs. Checks the flag's round trip, that a whole selection is
// ONE undo step, that nothing which USES a benched item changes, and the @ picker / pick-list rules.
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')

async function load(file, shims = {}) {
  const r = await esbuild.build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static', 'electron'], logLevel: 'silent' })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${r.outputFiles[0].text}\n})`, { filename: path.basename(file) })((name) => shims[name] ?? appRequire(name), mod, mod.exports)
  return mod.exports
}

async function main() {
  const temp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'vd-disable-'))
  const p = await load(path.join(root, 'src/main/project.ts'))
  const proj = await p.newProject(temp, 'Bench')
  await p.openProject(proj.dir)
  const jp = path.join(proj.dir, 'project.json')
  const disk = async () => JSON.parse(await fs.readFile(jp, 'utf8'))

  // two images + a style + a clip that USES image A as a ref
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex')
  const fa = path.join(temp, 'a.png')
  const fb = path.join(temp, 'b.png')
  await fs.writeFile(fa, png)
  await fs.writeFile(fb, png)
  const imp = await p.importImages([fa, fb])
  const [idA, idB] = imp.importedIds
  const st = await p.newStyle('Look')
  const made = await p.newClipsFromImages([idA])
  const clip = p.getProject().clips[0]
  assert.ok(made && clip, 'a clip was made from image A')
  const refsBefore = JSON.stringify(clip.promptData.imageIds)
  const out = {}

  // 1 — a selection across kinds benches in ONE save; the delta carries exactly what changed
  const d1 = await p.setItemsDisabled({ imageIds: [idA], styleIds: [st.styleId], clipIds: [clip.id] }, true)
  assert.equal(d1.images.length, 1)
  assert.equal(d1.styles.length, 1)
  assert.equal(d1.clips.length, 1)
  let dj = await disk()
  assert.equal(dj.images.find((i) => i.id === idA).disabled, true)
  assert.equal(dj.images.find((i) => i.id === idB).disabled, undefined)
  assert.equal(dj.styles[0].disabled, true)
  out.benched = { images: 1, styles: 1, clips: 1, onDisk: true }

  // 2 — "its still ther and still functions": what USES the benched image is untouched
  assert.equal(JSON.stringify(p.getProject().clips[0].promptData.imageIds), refsBefore)
  assert.equal(p.getProject().images.length, 2)
  out.stillWorks = { clipRefsUnchanged: true, nothingRemoved: true }

  // 3 — idempotent: benching what is already benched changes nothing (no save, no undo step)
  assert.equal(await p.setItemsDisabled({ imageIds: [idA] }, true), null)

  // 4 — ONE undo brings the whole selection back; redo benches it again
  await p.undo()
  assert.equal(p.getProject().images.find((i) => i.id === idA).disabled, undefined)
  assert.equal(p.getProject().styles[0].disabled, undefined)
  assert.equal(p.getProject().clips[0].disabled, undefined)
  await p.redo()
  assert.equal(p.getProject().images.find((i) => i.id === idA).disabled, true)
  out.oneUndo = true

  // 5 — enable removes the key from disk (absent = enabled; old app versions read the file unchanged)
  const d2 = await p.setItemsDisabled({ imageIds: [idA], styleIds: [st.styleId], clipIds: [clip.id] }, false)
  assert.equal(d2.images.length, 1)
  dj = await disk()
  assert.equal('disabled' in dj.images.find((i) => i.id === idA), false)
  out.enabled = { keyRemoved: true }

  // 6 — timelines are NOT part of it (his call): a timeline id in the selection is ignored
  assert.equal(await p.setItemsDisabled({ timelineIds: [p.getProject().timelines[0].id] }, true), null)
  assert.equal(p.getProject().timelines[0].disabled, undefined)
  out.timelinesIgnored = true

  // 7 — the list rules (the renderer's one helper file): @ picker skips, pick lists put it last
  const li = await load(path.join(root, '../koan-shared/vidancer-ui/src/lib/disabledItems.ts'))
  const imgs = [{ title: '@robot_old', disabled: true }, { title: '@robot_new' }, { title: '@robot_alt' }]
  assert.deepEqual(li.mentionMatches(imgs, 'robot').map((i) => i.title), ['@robot_new', '@robot_alt'])
  assert.deepEqual(li.disabledLast(imgs).map((i) => i.title), ['@robot_new', '@robot_alt', '@robot_old'])
  out.lists = { atPickerSkips: true, pickListLast: true }

  await fs.rm(temp, { recursive: true, force: true })
  console.log(JSON.stringify(out, null, 2))
  console.log('PASS disable items: one save, one undo, users untouched, key removed on enable, timelines ignored, list rules')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
