// list 52 (2026-10-01) — ENHANCE's engine, run for real where it is free: the app's own ffmpeg makes a
// 1 s test clip; the two portable programs (RIFE, Real-ESRGAN) and Topaz Video's ffmpeg are stand-ins
// that do the same job plainly (repeat frames, scale) so every pipe, folder, flag, frame count, size,
// sound rule and kill switch around them is real. fal is a stand-in: nothing is sent, nothing is paid.
// Then the copy landing in a temp project (a take, and next to the Library video) and the crash records.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), cp = require('node:child_process')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const appRequire = createRequire(path.join(root, 'package.json'))
const esbuild = appRequire('esbuild')
const FF = appRequire('ffmpeg-static')
const main = path.join(root, 'src/main').replaceAll('\\', '/')
const ui = path.resolve(root, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-enhance-test-'))
const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n)
const sh = (args) => {
  const r = cp.spawnSync(FF, args, { maxBuffer: 32e6 })
  if (r.status !== 0) throw Error(String(r.stderr))
  return r
}
// what a file really is: size, frame count, frame rate, sound
const facts = (file) => {
  const info = String(cp.spawnSync(FF, ['-hide_banner', '-i', file]).stderr)
  const size = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(info)
  const fps = /(\d+(?:\.\d+)?) fps/.exec(info)
  const count = String(cp.spawnSync(FF, ['-i', file, '-map', '0:v', '-f', 'null', '-']).stderr).split('\n').filter((l) => l.includes('frame=')).pop()
  return { w: Number(size?.[1]), h: Number(size?.[2]), fps: Number(fps?.[1]), frames: Number(/frame=\s*(\d+)/.exec(count ?? '')?.[1]), audio: /Audio:/.test(info) }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, want ${b} ±${tol}`)
// size, rate and sound exact; frames within one (the sound's last packet can end a hair early)
const looks = (f, [w, h, fps, frames, audio], what) => {
  assert.deepEqual([f.w, f.h, f.fps, f.audio], [w, h, fps, audio], what)
  near(f.frames, frames, 1, `${what} (frames)`)
}

// ---- the test clip: 64×64, 24 fps, 1 s, a tone ----
const SRC = path.join(tmp, 'src.mp4')
sh(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', SRC])
const SRC_FRAMES = facts(SRC).frames

// ---- the stand-in programs ----
const fakeRife = path.join(tmp, 'fake-rife.cjs')
fs.writeFileSync(
  fakeRife,
  `const fs=require('fs'),path=require('path');const a=process.argv.slice(2),get=(f)=>a[a.indexOf(f)+1]
if(process.env.FAKE_SLOW){setTimeout(()=>{},60000)}else{
const inDir=get('-i'),outDir=get('-o'),n=Number(get('-n'));const frames=fs.readdirSync(inDir).filter((f)=>f.endsWith('.png')).sort()
fs.mkdirSync(outDir,{recursive:true});for(let k=0;k<n;k++)fs.copyFileSync(path.join(inDir,frames[Math.min(frames.length-1,Math.floor((k*frames.length)/n))]),path.join(outDir,String(k+1).padStart(8,'0')+'.png'))}`
)
const fakeEsrgan = path.join(tmp, 'fake-esrgan.cjs')
fs.writeFileSync(
  fakeEsrgan,
  `const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path');const a=process.argv.slice(2),get=(f)=>a[a.indexOf(f)+1]
const s=Number(get('-s'));fs.mkdirSync(get('-o'),{recursive:true})
process.exit(spawnSync(process.env.FAKE_FFMPEG,['-v','error','-i',path.join(get('-i'),'%08d.png'),'-vf','scale=iw*'+s+':ih*'+s,path.join(get('-o'),'%08d.png')]).status)`
)
const fakeTopazFail = path.join(tmp, 'fake-topaz-fail.cjs')
fs.writeFileSync(fakeTopazFail, `process.stderr.write('[TopazAuthManager] token=SECRET-TOKEN-123 refreshed\\nrelogin needed? no\\nmodel apo-8 could not load its weights\\n');process.exit(3)`)
// Topaz's filters → plain ffmpeg ones that make the same frame counts and sizes
const plainFilter = (vf) =>
  vf
    .split(',')
    .map((part) => {
      const o = Object.fromEntries(part.replace(/^tvai_(fi|up)=/, '').split(':').map((kv) => kv.split('=')))
      if (part.startsWith('tvai_fi=')) return `setpts=${o.slowmo}*PTS,fps=${o.fps}`
      if (part.startsWith('tvai_up=')) return `scale=iw*${o.scale}:ih*${o.scale}`
      return part
    })
    .join(',')

// ---- Topaz Video "installed" in a temp Program Files, its model files in a temp ProgramData ----
const PF = path.join(tmp, 'pf'), PD = path.join(tmp, 'pd')
const TOPAZ_FF = path.join(PF, 'Topaz Labs LLC', 'Topaz Video', exe('ffmpeg'))
const TOPAZ_MODELS = path.join(PD, 'Topaz Labs LLC', 'Topaz Video', 'models')
fs.mkdirSync(path.dirname(TOPAZ_FF), { recursive: true })
fs.writeFileSync(TOPAZ_FF, '')
fs.mkdirSync(TOPAZ_MODELS, { recursive: true })
const manifest = (f, j) => fs.writeFileSync(path.join(TOPAZ_MODELS, f), typeof j === 'string' ? j : JSON.stringify(j))
manifest('apo-7.json', { shortName: 'apo', displayName: 'Apollo', modelType: 2, version: 7, enabled: 1, gui: { name: 'Apollo' } })
manifest('apo-8.json', { shortName: 'apo', displayName: 'Apollo', modelType: 2, version: 8, enabled: 1, gui: { name: 'Apollo', desc: 'slow motion, 8 frames' } })
manifest('prob-4.json', {
  shortName: 'prob',
  modelType: 1,
  version: 4,
  enabled: 1,
  gui: { name: 'Proteus' },
  parameters: [{ name: 'noise', guiName: 'Reduce Noise', min: -1, max: 1, default: 0.1 }, { name: 'details', guiName: 'Recover Detail', min: 0, max: 1, default: 0.2 }, { name: 'sharpenAmount' }]
})
manifest('est-1.json', { shortName: 'est', modelType: 3, version: 1, enabled: 1, gui: { name: 'Estimator' } })
manifest('off-2.json', { shortName: 'off', modelType: 1, version: 2, enabled: 0, gui: { name: 'Retired' } })
manifest('broken.json', '{ not json')
process.env.ProgramFiles = PF
process.env.ProgramData = PD
delete process.env.TVAI_MODEL_DIR // his PC may carry Topaz's own

// ---- the two portable programs "landed" by the Models card ----
const MODELS = path.join(tmp, 'models')
const RIFE_EXE = path.join(MODELS, 'rife-ncnn', 'rife-ncnn-vulkan-20221029-windows', exe('rife-ncnn-vulkan'))
const ESRGAN_EXE = path.join(MODELS, 'realesrgan-ncnn', exe('realesrgan-ncnn-vulkan'))

// ---- every program the engine starts goes through here ----
const calls = []
let slowRife = false, topazFail = false, encFail = false
const realSpawn = cp.spawn
const cpShim = {
  ...cp,
  spawn: (file, args = [], opts = {}) => {
    const f = String(file)
    const base = path.basename(f).toLowerCase()
    const rec = { file: f, args: [...args], env: opts.env }
    if (base.startsWith('rife-ncnn-vulkan')) {
      calls.push({ ...rec, kind: 'rife' })
      return realSpawn(process.execPath, [fakeRife, ...args], { ...opts, env: { ...(opts.env ?? process.env), FAKE_SLOW: slowRife ? '1' : '' } })
    }
    if (base.startsWith('realesrgan-ncnn-vulkan')) {
      calls.push({ ...rec, kind: 'esrgan' })
      return realSpawn(process.execPath, [fakeEsrgan, ...args], { ...opts, env: { ...(opts.env ?? process.env), FAKE_FFMPEG: FF } })
    }
    if (f === TOPAZ_FF) {
      calls.push({ ...rec, kind: 'topaz' })
      if (topazFail) return realSpawn(process.execPath, [fakeTopazFail], opts)
      const a2 = [...args]
      a2[a2.indexOf('-vf') + 1] = plainFilter(args[args.indexOf('-vf') + 1])
      return realSpawn(FF, a2, opts)
    }
    if (f === FF) calls.push({ ...rec, kind: 'ffmpeg' })
    // the app's encoder on the far side of Topaz's pipe, failing on its own (a full disk)
    if (encFail && f === FF && args.includes('libx264') && args[args.indexOf('-i') + 1] === '-') return realSpawn(process.execPath, ['-e', "process.stderr.write('No space left on device');process.exit(1)"], opts)
    return realSpawn(file, args, opts)
  }
}

// ---- fal, as a stand-in ----
const sent = [], uploads = []
let keyHeld = 0, falThrows = null
const falShim = {
  fal: {
    config: () => {},
    subscribe: async (endpoint, o) => {
      if (falThrows) throw falThrows
      const id = `req-${sent.length + 1}`
      sent.push({ endpoint, input: o.input })
      o.onEnqueue?.(id)
      o.onQueueUpdate?.({ status: 'IN_PROGRESS' })
      return { data: { video: { url: `https://fal.media/out-${id}.mp4` } } }
    }
  }
}
const falModShim = {
  acquireFalKey: () => keyHeld++,
  releaseFalKey: () => keyHeld--,
  uploadVideoCached: async (file) => (uploads.push(file), `https://fal.media/in-${uploads.length}.mp4`),
  downloadTo: async (_url, out) => fs.copyFileSync(SRC, out),
  falErrorText: (e) => `fal said: ${e instanceof Error ? e.message : e}`,
  trackJob: () => () => {},
  untrackJob: () => {}
}

async function load(contents, shims) {
  const out = await esbuild.build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['ffmpeg-static', 'electron', '@fal-ai/client'],
    logLevel: 'silent',
    plugins: [{ name: 'stand-ins', setup: (b) => b.onResolve({ filter: /^\.\/(fal|modelStore)$/ }, (a) => (a.importer.replaceAll('\\', '/').endsWith('/main/enhance.ts') ? { path: a.path, external: true } : undefined)) }]
  })
  const mod = { exports: {} }
  vm.runInThisContext(`(function(require,module,exports){${out.outputFiles[0].text}\n})`)((n) => (n in shims ? shims[n] : appRequire(n)), mod, mod.exports)
  return mod.exports
}

;(async () => {
  const E = await load(`export * from '${main}/enhance'; export * as S from '${ui}/shared/enhance'`, {
    child_process: cpShim,
    '@fal-ai/client': falShim,
    './fal': falModShim,
    './modelStore': { modelDir: (m) => path.join(MODELS, m.id) }
  })
  const S = E.S

  // ================= the numbers (shared/enhance) =================
  assert.deepEqual(S.interpPlan({ engine: 'x', times: 2, slowmo: 1 }, 24), { outFps: 48, perFrame: 2, slowmo: 1 }, '×2 smoother: 48 fps, 2 frames per frame')
  assert.deepEqual(S.interpPlan({ engine: 'x', times: 1, fps: 60, slowmo: 1 }, 24), { outFps: 60, perFrame: 2.5, slowmo: 1 }, 'to 60 fps')
  assert.deepEqual(S.interpPlan({ engine: 'x', times: 1, slowmo: 4 }, 24), { outFps: 24, perFrame: 4, slowmo: 4 }, 'slow motion ×4: same rate, 4× the frames')
  assert.deepEqual(S.upscalePlan({ engine: 'x', scale: 2 }, 1280, 720), { w: 2560, h: 1440, factor: 2 })
  assert.deepEqual(S.upscalePlan({ engine: 'x', height: 1080 }, 1280, 720), { w: 1920, h: 1080, factor: 1.5 })
  assert.deepEqual(S.upscalePlan({ engine: 'x', height: 1080 }, 853, 480), { w: 1920, h: 1080, factor: 2.25 }, 'odd sizes land even')
  const five = { w: 1280, h: 720, fps: 30, sec: 5 }
  near(S.enhanceCost({ upscale: { engine: 'topaz-fal', height: 1080 }, src: five }).usd, 0.1, 1e-9, 'Topaz on fal to 1080p: $0.02 a second')
  near(S.enhanceCost({ interp: { engine: 'topaz-fal', times: 2, slowmo: 1 }, upscale: { engine: 'topaz-fal', height: 1080 }, src: five }).usd, 0.2, 1e-9, '… twice at 60 fps, one pass for both')
  near(S.enhanceCost({ upscale: { engine: 'topaz-fal', height: 1080, model: 'Gaia 2' }, src: five }).usd, 0.05, 1e-9, 'Gaia 2 half')
  near(S.enhanceCost({ upscale: { engine: 'topaz-fal', height: 2160 }, src: five }).usd, 0.4, 1e-9, 'above 1080p: $0.08 a second')
  near(S.enhanceCost({ interp: { engine: 'topaz-fal', times: 2, slowmo: 1 }, upscale: { engine: 'seedvr-fal', height: 2160 }, src: five }).usd, 0.1 + (3840 * 2160 * 300) / 1e6 * 0.001, 1e-9, 'Topaz only interpolating is priced at the source height; SeedVR2 per megapixel after it')
  near(S.enhanceCost({ upscale: { engine: 'seedvr-fal', scale: 2 }, src: five }).usd, (2560 * 1440 * 150) / 1e6 * 0.001, 1e-9, 'SeedVR2: $0.001 per megapixel of video')
  assert.equal(S.enhanceCost({ interp: { engine: 'rife-fal', times: 2, slowmo: 1 }, src: five }).usd, undefined, 'RIFE on fal: no honest number ahead')
  assert.match(S.enhanceCost({ interp: { engine: 'rife-fal', times: 2, slowmo: 1 }, src: five }).note, /compute second/)
  assert.equal(S.enhanceCost({ interp: { engine: 'rife-local', times: 2, slowmo: 1 }, upscale: { engine: 'realesrgan-local', scale: 2 }, src: five }).usd, 0, 'this PC: free')
  // his colours and words
  const I = { engine: 'rife-local', times: 2 }, U = { engine: 'seedvr-fal', height: 1080 }
  assert.equal(S.enhanceTone({ of: 'a', interp: I }), 'var(--enh-interp)')
  assert.equal(S.enhanceTone({ of: 'a', upscale: U }), 'var(--enh-up)')
  assert.equal(S.enhanceTone({ of: 'a', interp: I, upscale: U }), 'var(--enh-both)')
  assert.equal(S.enhanceTone(undefined), undefined)
  assert.equal(S.enhanceWords({ of: 'a', interp: I, upscale: U }), 'interpolated ×2 · upscaled to 1080p')
  assert.equal(S.enhanceWords({ of: 'a', interp: { engine: 'x', times: 1, slowmo: 4 } }), 'interpolated slow motion ×4')
  assert.equal(S.enhanceWords({ of: 'a', interp: { engine: 'x', times: 1, fps: 60 } }), 'interpolated to 60 fps')
  // Optical Flow: the frames a slowed block needs
  assert.deepEqual([0.75, 0.5, 0.4, 0.25, 0.2].map(S.flowTimes), [2, 2, 4, 4, 8])
  assert.equal(S.denseEnough({ of: 'a', interp: { engine: 'x', times: 4, slowmo: 1 } }, 0.3), true)
  assert.equal(S.denseEnough({ of: 'a', interp: { engine: 'x', times: 4, slowmo: 1 } }, 0.2), false, 'needs ×8')
  assert.equal(S.denseEnough({ of: 'a', interp: { engine: 'x', times: 1, slowmo: 4 } }, 0.5), false, 'a slow-motion copy is longer: not for a block')
  assert.equal(S.denseEnough({ of: 'a', upscale: U }, 0.5), false)
  // what a crash-recovered request carries
  const both = { source: { kind: 'video', videoId: 'v' }, interp: { engine: 'rife-fal', times: 2, slowmo: 1 }, upscale: { engine: 'seedvr-fal', scale: 2 } }
  assert.deepEqual(Object.keys(S.stageDid(both, 'interp')), ['interp'], 'the first of two requests: interpolated only')
  assert.deepEqual(Object.keys(S.stageDid(both, 'upscale')), ['interp', 'upscale'], 'the second works on interpolated frames: both')
  assert.deepEqual(Object.keys(S.stageDid(both, 'both')), ['interp', 'upscale'])
  console.log('PASS the numbers: frame plans, sizes, prices where they can be worked out ahead, his colours, Optical Flow frames, recovered marks')

  // ================= the programs' flags, the filters, fal's inputs =================
  assert.deepEqual(E.rifeArgs('in', 'out', 48, 'M', { tta: true, ttaTime: true, uhd: true }), ['-i', 'in', '-o', 'out', '-n', '48', '-m', 'M', '-f', '%08d.png', '-x', '-z', '-u'])
  assert.deepEqual(E.rifeArgs('in', 'out', 48, 'M'), ['-i', 'in', '-o', 'out', '-n', '48', '-m', 'M', '-f', '%08d.png'])
  assert.deepEqual(E.esrganArgs('in', 'out', 'realesrgan-x4plus', 2, { tile: 256, tta: true }), ['-i', 'in', '-o', 'out', '-n', 'realesrgan-x4plus', '-s', '4', '-f', 'png', '-t', '256', '-x'], 'the x4 models are 4×')
  assert.deepEqual(E.esrganArgs('in', 'out', 'realesr-animevideov3', 2).slice(4, 8), ['-n', 'realesr-animevideov3', '-s', '2'], 'the video model takes 2')
  const fi = E.topazFilters({ fps: 24, w: 64, h: 64 }, { engine: 'topaz-local', model: 'apo-8', times: 2, slowmo: 1, settings: { rdt: 0.05, vram: 0.5 } })
  assert.equal(fi, 'tvai_fi=model=apo-8:slowmo=1:rdt=0.05:fps=48:device=-2:vram=0.5:instances=0')
  const up = E.topazFilters({ fps: 24, w: 64, h: 64 }, undefined, { engine: 'topaz-local', model: 'prob-4', scale: 2, settings: { noise: 0.3, details: 0.1, auto: true, grain: 0.2, bogus: 9 } })
  assert.equal(up, 'tvai_up=model=prob-4:scale=2:noise=0.3:details=0.1:estimate=8:prenoise=0:blend=0:grain=0.2:gsize=0:kcolor=1:device=-2:vram=1:instances=0', 'the model’s own sliders, auto = estimate')
  assert.match(E.topazFilters({ fps: 24, w: 64, h: 64 }, undefined, { engine: 'topaz-local', height: 96 }), /tvai_up=model=prob-4:scale=2:.*,scale=96:96:flags=lanczos$/, '1.5×: the model’s 2×, then the exact size')
  const fr = (a) => E.falInput('rife-fal', { fps: 24, w: 64, h: 64 }, 'U', a)
  assert.deepEqual(fr({ engine: 'rife-fal', times: 2, slowmo: 1, settings: { scenes: true } }), { video_url: 'U', num_frames: 1, use_scene_detection: true, loop: false, use_calculated_fps: true })
  assert.deepEqual(fr({ engine: 'rife-fal', times: 1, slowmo: 4 }), { video_url: 'U', num_frames: 3, use_scene_detection: false, loop: false, use_calculated_fps: false, fps: 24 }, 'slow motion: 3 between, the source’s rate')
  assert.deepEqual(E.falInput('seedvr-fal', { fps: 24, w: 64, h: 64 }, 'U', undefined, { engine: 'seedvr-fal', height: 1080, settings: { noise: 0.2, seed: 7 } }), { video_url: 'U', upscale_mode: 'target', target_resolution: '1080p', noise_scale: 0.2, seed: 7, output_format: 'X264 (.mp4)', output_quality: 'high' })
  assert.deepEqual(E.falInput('seedvr-fal', { fps: 24, w: 64, h: 64 }, 'U', undefined, { engine: 'seedvr-fal', scale: 4 }), { video_url: 'U', upscale_mode: 'factor', upscale_factor: 4, noise_scale: 0.1, output_format: 'X264 (.mp4)', output_quality: 'high' }, 'seed 0 = a new one: not sent')
  assert.deepEqual(
    E.falInput('topaz-fal', { fps: 24, w: 64, h: 64 }, 'U', { engine: 'topaz-fal', times: 4, slowmo: 1 }, { engine: 'topaz-fal', model: 'Nyx', scale: 2, settings: { compression: 0.4, recover: 0.3, halo: 0.1 } }),
    { video_url: 'U', model: 'Nyx', upscale_factor: 2, target_fps: 60, compression: 0.4, halo: 0.1, recover_detail: 0.3, H264_output: true },
    'Topaz on fal: both in one request, 96 fps held to their 60'
  )
  assert.deepEqual(E.falInput('topaz-fal', { fps: 24, w: 64, h: 64 }, 'U', { engine: 'topaz-fal', times: 2, slowmo: 1 }), { video_url: 'U', model: 'Proteus', upscale_factor: 1, target_fps: 48, H264_output: true }, 'interpolating only')
  // Topaz on this PC: its install and every model it carries, newest version, the enhance ones' sliders
  const found = E.findTopaz(true)
  assert.equal(found.found, true)
  assert.equal(found.detail, 'Topaz Video — 1 frame models, 1 enhance models')
  assert.deepEqual(found.interp, [{ id: 'apo-8', name: 'Apollo', desc: 'slow motion, 8 frames', sliders: [] }], 'the newest Apollo only; estimators, disabled and broken files are no choices')
  assert.deepEqual(found.upscale, [{ id: 'prob-4', name: 'Proteus', desc: undefined, sliders: [{ key: 'noise', label: 'reduce noise', min: -1, max: 1, def: 0.1 }, { key: 'details', label: 'recover detail', min: 0, max: 1, def: 0.2 }] }])
  console.log('PASS the flags each program takes, Topaz’s filter strings with each model’s sliders, fal’s inputs per model, the Topaz install read from its own model files')

  // ================= runs on this PC (real ffmpeg, stand-in programs) =================
  const out = (n) => path.join(tmp, n)
  const run = (args, o = {}) => E.runEnhance(SRC, { source: { kind: 'take', clipId: 'c', takeId: 't' }, ...args }, { outDir: out(o.dir ?? 'renders'), onProgress: () => {}, ...o })
  const rendersNow = (d) => fs.readdirSync(out(d)).filter((f) => f.endsWith('.mp4'))
  // RIFE ×2 smoother: 2× the frames, the same length, the sound kept
  fs.mkdirSync(path.dirname(RIFE_EXE), { recursive: true })
  fs.writeFileSync(RIFE_EXE, '')
  fs.mkdirSync(path.dirname(ESRGAN_EXE), { recursive: true })
  fs.writeFileSync(ESRGAN_EXE, '')
  assert.equal(E.localProgram('rife-ncnn'), RIFE_EXE, 'found inside the unpacked folder')
  assert.equal(E.localProgram('realesrgan-ncnn'), ESRGAN_EXE)
  let r = await run({ interp: { engine: 'rife-local', model: 'rife-v4.6', times: 2, slowmo: 1, settings: { tta: true } } }, { dir: 'r1' })
  let f = facts(r.file)
  let rife = calls.filter((c) => c.kind === 'rife').pop()
  assert.equal(rife.args[rife.args.indexOf('-n') + 1], String(SRC_FRAMES * 2), 'RIFE is asked for twice the frames')
  assert.equal(rife.args[rife.args.indexOf('-m') + 1], path.join(path.dirname(RIFE_EXE), 'rife-v4.6'), 'the model folder beside the program')
  assert.ok(rife.args.includes('-x'), 'TTA reaches it')
  looks(f, [64, 64, 48, SRC_FRAMES * 2, true], 'RIFE ×2: 48 fps, twice the frames, the sound')
  assert.deepEqual(Object.keys(r.did), ['interp'])
  assert.equal(r.costUsd, 0)
  assert.deepEqual(rendersNow('r1'), [path.basename(r.file)], 'only the copy is left')
  // RIFE slow motion ×2: twice as long, no sound
  r = await run({ interp: { engine: 'rife-local', times: 1, slowmo: 2 } }, { dir: 'r2' })
  f = facts(r.file)
  looks(f, [64, 64, 24, SRC_FRAMES * 2, false], 'slow motion ×2: the same rate, twice as long, no sound')
  near(r.durationSec, 2, 0.1, 'it runs 2 s')
  // Real-ESRGAN ×2 with the 4× model: the exact size asked for
  r = await run({ upscale: { engine: 'realesrgan-local', model: 'realesrgan-x4plus', scale: 2 } }, { dir: 'r3' })
  f = facts(r.file)
  const es = calls.filter((c) => c.kind === 'esrgan').pop()
  assert.equal(es.args[es.args.indexOf('-s') + 1], '4')
  assert.equal(es.args[es.args.indexOf('-m') + 1], path.join(path.dirname(ESRGAN_EXE), 'models'))
  looks(f, [128, 128, 24, SRC_FRAMES, true], 'Real-ESRGAN ×2: 128×128, the frames and sound as they were')
  // both on this PC: interpolate first, then upscale, the middle copy gone
  const before = calls.length
  r = await run({ interp: { engine: 'rife-local', times: 2, slowmo: 1 }, upscale: { engine: 'realesrgan-local', model: 'realesr-animevideov3', scale: 2 } }, { dir: 'r4' })
  const order = calls.slice(before).filter((c) => c.kind !== 'ffmpeg').map((c) => c.kind)
  assert.deepEqual(order, ['rife', 'esrgan'], 'interpolate first, then upscale (his order)')
  f = facts(r.file)
  looks(f, [128, 128, 48, SRC_FRAMES * 2, true], 'both: 128×128 at 48 fps')
  assert.deepEqual(Object.keys(r.did), ['interp', 'upscale'])
  assert.deepEqual(rendersNow('r4'), [path.basename(r.file)], 'the middle copy is not kept')
  console.log('PASS on this PC: RIFE ×2 (twice the frames, same length, sound) and slow motion (longer, silent), Real-ESRGAN to the exact size, both = interpolate first, nothing left but the copy')

  // Topaz Video on this PC: the app decodes, Topaz works on raw frames through pipes, the app encodes
  r = await run({ interp: { engine: 'topaz-local', model: 'apo-8', times: 2, slowmo: 1 }, upscale: { engine: 'topaz-local', model: 'prob-4', scale: 2 } }, { dir: 't1' })
  const tz = calls.filter((c) => c.kind === 'topaz')
  assert.equal(tz.length, 1, 'picked in both sections, Topaz runs once')
  assert.equal(tz[0].env.TVAI_MODEL_DATA_DIR, TOPAZ_MODELS, 'its model folder is handed over (proven 10-01: it fails without)')
  assert.equal(tz[0].env.TVAI_MODEL_DIR, TOPAZ_MODELS)
  assert.deepEqual(tz[0].args.slice(0, 6), ['-hide_banner', '-nostdin', '-y', '-f', 'nut', '-i'])
  assert.match(tz[0].args[tz[0].args.indexOf('-vf') + 1], /^tvai_fi=model=apo-8:slowmo=1:.*fps=48.*,tvai_up=model=prob-4:scale=2:/)
  f = facts(r.file)
  looks(f, [128, 128, 48, SRC_FRAMES * 2, true], 'Topaz both: through the pipes, 128×128 at 48 fps with the sound')
  r = await run({ interp: { engine: 'topaz-local', model: 'apo-8', times: 1, slowmo: 2 } }, { dir: 't2' })
  f = facts(r.file)
  looks(f, [64, 64, 24, SRC_FRAMES * 2, false], 'Topaz slow motion: longer, no sound')
  r = await run({ upscale: { engine: 'topaz-local', height: 96 } }, { dir: 't3' })
  assert.deepEqual([facts(r.file).w, facts(r.file).h], [96, 96], '1.5×: the exact size')
  // his license token never leaves the error
  topazFail = true
  const err = await run({ upscale: { engine: 'topaz-local', scale: 2 } }, { dir: 't4' }).then(() => null, (e) => e)
  topazFail = false
  assert.ok(err, 'a Topaz that fails says so')
  assert.match(err.message, /^Topaz Video stopped \(3\): model apo-8 could not load its weights$/, 'its own words, and nothing else: ' + err.message)
  assert.ok(!/SECRET|token|relogin/i.test(err.message), 'the token lines are dropped')
  // the far end failing: Topaz is stopped (it would wait on a full pipe forever) and the error is the encoder's
  encFail = true
  const err2 = await run({ upscale: { engine: 'topaz-local', scale: 2 } }, { dir: 't5' }).then(() => null, (e) => e)
  encFail = false
  assert.ok(err2 && /^the frames could not pass through/.test(err2.message) && err2.message.includes('No space left on device'), 'the encoder’s failure is the one said, and nothing hangs: ' + (err2 && err2.message))
  console.log('PASS Topaz Video on this PC: one run for both sections, its model folder handed over, raw frames through pipes both ways, sound kept only when the length is, the license token never shown, a failing link stops the others and the root cause is the one said')

  // the queue's ✕ stops the program
  slowRife = true
  const rifeRuns = calls.filter((c) => c.kind === 'rife').length
  const job = run({ jobId: 'j-stop', interp: { engine: 'rife-local', times: 2, slowmo: 1 } }, { dir: 'k1' }).then(() => 'finished', (e) => e.message)
  for (let i = 0; i < 200 && calls.filter((c) => c.kind === 'rife').length === rifeRuns; i++) await new Promise((res) => setTimeout(res, 50))
  await new Promise((res) => setTimeout(res, 300))
  assert.equal(E.cancelEnhance('j-stop'), true, 'the ✕ finds the running program')
  const ended = await Promise.race([job, new Promise((res) => setTimeout(() => res('still running'), 15000))])
  slowRife = false
  assert.notEqual(ended, 'finished')
  assert.notEqual(ended, 'still running', 'the run ends when its program is stopped')
  assert.equal(E.cancelEnhance('j-stop'), false, 'nothing left to stop')
  console.log('PASS the queue’s ✕ stops a running program and the run ends')

  // ================= fal (stand-in) =================
  r = await run({ interp: { engine: 'topaz-fal', times: 2, slowmo: 1 }, upscale: { engine: 'topaz-fal', model: 'Proteus', scale: 2 } }, { dir: 'f1', falKey: 'k', onRequestId: (id, ep, stage) => (sent.at(-1).stage = stage) })
  assert.equal(sent.length, 1, 'Topaz on fal in both sections: one request')
  assert.deepEqual([sent[0].endpoint, sent[0].stage, sent[0].input.upscale_factor, sent[0].input.target_fps], ['fal-ai/topaz/upscale/video', 'both', 2, 48])
  near(r.costUsd, 0.01, 0.001, '$0.01 a second at 128 px, 48 fps, 1 s')
  assert.equal(keyHeld, 0, 'the key is let go')
  const stages = []
  r = await run({ interp: { engine: 'rife-fal', times: 2, slowmo: 1 }, upscale: { engine: 'seedvr-fal', scale: 2 } }, { dir: 'f2', falKey: 'k', onRequestId: (id, ep, stage) => stages.push([id, ep, stage]) })
  assert.deepEqual(stages, [['req-2', 'fal-ai/rife/video', 'interp'], ['req-3', 'fal-ai/seedvr/upscale/video', 'upscale']], 'two requests, each recorded the moment fal takes it')
  assert.equal(path.dirname(uploads.at(-1)), out('f2'), 'the second request gets the first one’s result')
  assert.deepEqual(rendersNow('f2'), [path.basename(r.file)], 'the middle copy is not kept')
  assert.equal(r.costUsd, undefined, 'RIFE on fal has no number ahead')
  await assert.rejects(run({ upscale: { engine: 'seedvr-fal', scale: 2 } }, { dir: 'f3' }), /No fal key saved/)
  falThrows = new Error('422 upscale_factor must be ≤ 4')
  await assert.rejects(run({ upscale: { engine: 'seedvr-fal', scale: 2 } }, { dir: 'f4', falKey: 'k' }), /fal said: 422/)
  falThrows = null
  assert.equal(keyHeld, 0, 'a failed request lets the key go too')
  console.log('PASS fal: Topaz both = one request, two engines = two requests in order (the second on the first’s result), each recorded at once for a crash, no key or a refusal said plainly')

  // ================= the free preview =================
  await assert.rejects(E.previewEnhance(SRC, { source: { kind: 'take', clipId: 'c', takeId: 't' }, upscale: { engine: 'seedvr-fal', scale: 2 }, preview: { atSec: 0, sec: 2 } }, out('pv'), () => {}), /costs money/)
  const pv = await E.previewEnhance(SRC, { source: { kind: 'take', clipId: 'c', takeId: 't' }, interp: { engine: 'rife-local', times: 2, slowmo: 1 }, preview: { atSec: 0.25, sec: 0.5 } }, out('pv'), () => {})
  f = facts(pv)
  assert.equal(path.dirname(pv), out('pv'))
  near(f.frames, 24, 2, 'half a second at 48 fps')
  assert.deepEqual(fs.readdirSync(out('pv')), [path.basename(pv)], 'the cut is gone; one file, replaced by the next preview')
  console.log('PASS the preview: engines of this PC only, a few seconds at the playhead, one file in the preview folder')

  // ================= the copy lands (a temp project) =================
  const P = await load(`export * from '${main}/project'; export * as K from '${ui}/shared/keepers'`, {})
  const pend = await load(`export * from '${main}/pending'`, {})
  const proj = await P.newProject(tmp, 'Enhance')
  await P.openProject(proj.dir)
  const V = (await P.importVideoFiles([SRC])).importedIds[0]
  const C = (await P.makeClipFromVideo(V)).clipId
  const clip = () => P.getProject().clips.find((c) => c.id === C)
  const T1 = clip().takes[0]
  const W = (await P.importVideoFiles([T1.file])).importedIds[0] // the take dragged into the Library
  const copyFile = (n) => {
    const p = path.join(proj.dir, 'renders', n)
    fs.copyFileSync(SRC, p)
    return p
  }
  let landed = await P.addEnhancedCopy({ source: { kind: 'take', clipId: C, takeId: T1.id }, file: copyFile('e1.mp4'), did: { interp: S.interpStep({ engine: 'rife-local', times: 2, slowmo: 1 }) }, durationSec: 1 })
  const T2 = clip().takes.at(-1)
  assert.equal(landed.takeId, T2.id)
  assert.deepEqual(T2.enhanced, { of: T1.id, interp: { engine: 'rife-local', times: 2, slowmo: 1 } }, 'a new take, marked')
  assert.equal(clip().keeperTakeId, T2.id, 'the clip plays the copy')
  let vids = P.getProject().videos
  const Wi = vids.findIndex((v) => v.id === W)
  assert.equal(landed.videoIds.length, 1)
  assert.equal(vids[Wi + 1].id, landed.videoIds[0], 'the take was in the Library: the copy sits next to it')
  assert.deepEqual(vids[Wi + 1].enhanced, { of: W, interp: T2.enhanced.interp })
  assert.equal(fs.statSync(vids[Wi + 1].file).size, fs.statSync(T2.file).size, 'same bytes (a hard link where the disk allows)')
  assert.deepEqual(landed.delta.videosOrder, vids.map((v) => v.id), 'the order travels, so the Library shows it there')
  // a copy of a copy keeps what was done: blue upscaled = purple
  landed = await P.addEnhancedCopy({ source: { kind: 'take', clipId: C, takeId: T2.id }, file: copyFile('e2.mp4'), did: { upscale: S.upscaleStep({ engine: 'seedvr-fal', height: 1080 }) } })
  const T3 = clip().takes.at(-1)
  assert.deepEqual(Object.keys(T3.enhanced), ['of', 'interp', 'upscale'])
  assert.equal(S.enhanceTone(T3.enhanced), 'var(--enh-both)', 'purple')
  assert.equal(landed.videoIds.length, 0, 'T2 was never in the Library: no Library copy')
  // flagged keepers: the copy is flagged last and plays
  await P.setKeeperFlags('clip', C, [T1.id], true)
  await P.addEnhancedCopy({ source: { kind: 'take', clipId: C, takeId: T1.id }, file: copyFile('e3.mp4'), did: { upscale: S.upscaleStep({ engine: 'realesrgan-local', scale: 2 }) } })
  const T4 = clip().takes.at(-1)
  assert.equal(clip().keeperTakeId, T4.id, 'flagged last, it plays')
  assert.ok(P.K.isKeeper(clip(), T4.id) && P.K.isKeeper(clip(), T1.id), 'the old flag stays')
  // Optical Flow: the clip's playing take stays; only the blocks switch (the store does that)
  await P.addEnhancedCopy({ source: { kind: 'take', clipId: C, takeId: T1.id }, file: copyFile('e4.mp4'), did: { interp: S.interpStep({ engine: 'rife-local', times: 4, slowmo: 1 }) }, forBlocks: true })
  assert.equal(clip().keeperTakeId, T4.id, 'an Optical Flow copy does not take over the clip')
  // a Library video: its copy next to it, no take
  landed = await P.addEnhancedCopy({ source: { kind: 'video', videoId: V }, file: copyFile('e5.mp4'), did: { upscale: S.upscaleStep({ engine: 'topaz-local', height: 1080 }) } })
  vids = P.getProject().videos
  assert.equal(landed.takeId, undefined)
  assert.equal(vids[vids.findIndex((v) => v.id === V) + 1].id, landed.videoIds[0], 'next to the original')
  assert.equal(vids.find((v) => v.id === landed.videoIds[0]).title, 'src · upscaled to 1080p')
  await assert.rejects(P.addEnhancedCopy({ source: { kind: 'take', clipId: C, takeId: 'gone' }, file: copyFile('e6.mp4'), did: {} }), /the take it was made from is gone/)
  const disk = JSON.parse(fs.readFileSync(path.join(proj.dir, 'project.json'), 'utf8'))
  assert.ok(disk.clips.find((c) => c.id === C).takes.some((t) => t.id === T3.id && t.enhanced?.upscale), 'saved')
  console.log('PASS the copy lands: a marked take the clip plays (flagged last when it has flags), next to the Library video it came from (or the take dragged there), a copy of a copy keeps both marks, an Optical Flow copy leaves the clip alone')

  // a request fal took is recorded until its copy lands (crash recovery)
  const entry = { requestId: 'req-9', endpoint: 'fal-ai/seedvr/upscale/video', jobId: 'j9', createdAt: 1, stage: 'upscale', args: both }
  await pend.addPendingEnhance(proj.dir, entry)
  assert.deepEqual(await pend.listPendingEnhances(proj.dir), [entry])
  await pend.removePendingEnhance(proj.dir, { requestId: 'req-9' })
  assert.deepEqual(await pend.listPendingEnhances(proj.dir), [])
  console.log('PASS a request fal took stays recorded until its copy lands. Fixtures: ' + tmp)
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
