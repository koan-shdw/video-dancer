// Audit 2026-10-09 batch 11, the testable core. The real project, MOODS and timeline-watch code in temp
// folders; nothing leaves this machine.
// M2  deleting one Library music track takes its A blocks off every timeline
// M7  save_mood and a dropped .vmd never write over an installed MOOD of the same name unasked
// L15 a timeline watch never starts beside a running export
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-standalone-'))
  const raw = { name: 'raw', setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await fs.readFile(a.path, 'utf8'), loader: 'text' }))
  } }
  const out = await appRequire('esbuild').build({
    stdin: { contents: `export * from './src/main/project'; export { saveMood, importMoodPaths, moodsDir } from './src/main/moods'; export { watchTimeline, setExportBusyCheck } from './src/main/watchTimeline'`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['ffmpeg-static', 'electron'], plugins: [raw], logLevel: 'silent'
  })
  const mod = { exports: {} }
  const electron = { app: { getPath: () => temp, isPackaged: false, on: () => {} }, BrowserWindow: class {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n === 'electron' ? electron : appRequire(n)), mod, mod.exports)
  const m = mod.exports

  // ---- M2 ----
  const proj = await m.newProject(temp, 'Music')
  await m.openProject(proj.dir)
  const cur = m.getProject()
  cur.audio.push({ id: 'song', title: 'Song', file: path.join(proj.dir, 'audio', 'song.mp3') }, { id: 'other', title: 'Other', file: path.join(proj.dir, 'audio', 'other.mp3') })
  const tl = cur.timelines[0]
  tl.audioItems = [{ id: 'a1', lane: 0, source: { audioId: 'song' }, startSec: 0, inSec: 0, outSec: 10 }, { id: 'a2', lane: 1, source: { audioId: 'other' }, startSec: 0, inSec: 0, outSec: 10 }]
  const delta = await m.deleteAudio('song')
  assert.deepEqual(delta.removedAudioIds, ['song'])
  assert.deepEqual(m.getProject().timelines[0].audioItems.map((x) => x.id), ['a2'], 'its A block left the timeline; the other track stays')
  assert.ok(delta.timelines.some((t) => t.id === tl.id), 'and the window is told')
  await m.pendingSaves?.()
  console.log('PASS M2: deleting a Library music track takes its A blocks off the timelines')

  // ---- M7 ----
  const mood = (how) => ({ name: 'KOAN TEST', triggers: ['koan test'], howToWrite: how, whatToKnow: 'w' })
  await m.saveMood(mood('first'))
  await assert.rejects(() => m.saveMood(mood('second')), /already in the library: ask the user, then send replace: true/, 'the Co-Director cannot write over it unasked')
  const file = path.join(m.moodsDir(), 'koan-test.vmd')
  assert.match(await fs.readFile(file, 'utf8'), /first/, 'the installed text is untouched')
  await m.saveMood(mood('second'), true)
  assert.match(await fs.readFile(file, 'utf8'), /second/, 'told to: replaced')
  const dropped = path.join(temp, 'koan-test.vmd')
  await fs.writeFile(dropped, (await fs.readFile(file, 'utf8')).replace('second', 'third'))
  let r = await m.importMoodPaths([dropped])
  assert.deepEqual([r.slugs, r.existing.map((x) => x.slug)], [[], ['koan-test']], 'a dropped .vmd of that name comes back to ask')
  assert.match(await fs.readFile(file, 'utf8'), /second/, 'and has not written over it')
  r = await m.importMoodPaths([dropped], true)
  assert.deepEqual(r.slugs, ['koan-test'])
  assert.match(await fs.readFile(file, 'utf8'), /third/, 'he said replace: replaced')
  r = await m.importMoodPaths([dropped])
  assert.deepEqual([r.slugs, r.existing], [['koan-test'], []], 'the same text again just installs (nothing to lose)')
  console.log('PASS M7: an installed MOOD is never written over unasked (save_mood and a dropped .vmd)')

  // ---- L15 ----
  let exporting = true
  m.setExportBusyCheck(() => exporting)
  const w = await m.watchTimeline({ timelineId: tl.id }, { googleKey: 'k' })
  assert.deepEqual(w, { ok: false, error: 'An export is running: watch the cut when it is done.' })
  exporting = false
  const w2 = await m.watchTimeline({ timelineId: tl.id }, { googleKey: 'k' })
  assert.notEqual(w2.error, w.error, 'no export: the watch goes on to its own checks')
  console.log('PASS L15: a timeline watch never starts beside a running export')

  await m.pendingSaves?.()
  await fs.rm(temp, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
