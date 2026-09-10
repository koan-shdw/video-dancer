const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const { spawnSync } = require('node:child_process'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const ffmpeg = require('ffmpeg-static')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-export-test-'))
const run = (args) => { const r = spawnSync(ffmpeg, args, { maxBuffer: 8e6 }); if (r.status !== 0) throw Error(String(r.stderr)); return r }
const src = path.join(tmp, 'three-colors.mp4')
run(['-v', 'error', ...['red','green','blue'].flatMap(c => ['-f','lavfi','-i',`color=c=${c}:s=64x64:r=24:d=1`]), '-f','lavfi','-i','sine=frequency=440:duration=3', '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map','[v]', '-map','3:a', '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',src])
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/main/export.ts')], platform: 'node', format: 'cjs', bundle: true, write: false, external: ['ffmpeg-static'] }).outputFiles[0].text
const mod = { exports: {} }
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((name) => name === 'fs/promises' ? { ...require(name), writeFile: async (file, data, ...args) => {
  if (String(file).endsWith('.filters.txt')) fs.writeFileSync(path.join(tmp, 'last-graph.txt'), data)
  return require('fs/promises').writeFile(file, data, ...args)
} } : require(name), mod, mod.exports)
const { exportTimeline, probeFile } = mod.exports
const recipe = { duration: '3', beats: [], imageIds: [], freeform: '' }
const project = { dir: tmp, clips: [{ id:'clip', promptData:recipe, takes:[{id:'take', file:src, durationSec:3}] }], images:[], audio:[], scoreClips:[], voiceClips:[] }
const base = { id:'tl',name:'Test',aspectRatio:'1:1',exportRes:'64',exportFps:'24',exportQuality:'draft',items:[0,1,2].map(i => ({id:`item${i}`,clipId:'clip',startSec:i,inSec:i,outSec:i+1,transitionOutSec:i<2?0.5:0})) }
const pixel = (file,t) => [...run(['-v','error','-ss',String(t),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']).stdout]
const near = (got,want,label) => { assert.equal(got.length,3); for(let i=0;i<3;i++) assert.ok(Math.abs(got[i]-want[i])<24, `${label}: got ${got}, expected ${want}`) }
const rms = (file,t) => { const r=run(['-hide_banner','-ss',String(t),'-t','0.1','-i',file,'-vn','-af','astats=metadata=0:reset=0','-f','null','-']); return Number(String(r.stderr).match(/RMS level dB: (-?[\d.]+)/)?.[1]) }
async function check(name, timeline, bakes, checks, duration) {
  const out = path.join(tmp,name+'.mp4')
  const r=await exportTimeline(project,timeline,out,()=>{},bakes)
  assert.equal(r.ok,true,r.error)
  for(const [t,color] of checks) near(pixel(out,t),color,name+' @ '+t)
  assert.ok(Math.abs((await probeFile(out)).duration-duration)<0.12)
  console.log('PASS '+name)
  return out
}
(async()=>{
  const out=await check('two-dissolves',base,undefined,[[0.25,[255,0,0]],[0.75,[255,0,0]],[1.25,[0,128,0]],[1.75,[0,128,0]],[2.25,[0,0,255]]],3)
  assert.ok(Math.abs(rms(out,0.25)-rms(out,0.75))<1,'visual dissolve must not add an audio fade')
  await check('range-through-transition',{...base,rangeInSec:0.5,rangeOutSec:2.5},undefined,[[0.25,[255,0,0]],[1.25,[0,128,0]]],2)
  await check('fx-bake-transition',{...base},[{file:src,start:0,end:1}],[[0.75,[255,0,0]],[1.75,[0,128,0]]],3)
  await check('speed-and-trims',{...base,items:[{...base.items[0],speed:2,outSec:1,startSec:0,transitionOutSec:0.25},{...base.items[1],startSec:0.5,transitionOutSec:0}]},undefined,[[0.375,[255,0,0]],[0.75,[0,128,0]]],1.5)
  await check('gap-does-not-dissolve',{...base,items:[base.items[0],{...base.items[1],startSec:2,transitionOutSec:0}]},undefined,[[0.75,[255,0,0]],[1.25,[0,0,0]],[2.25,[0,128,0]]],3)
  await check('underlying-track-continues',{...base,items:[{...base.items[0],track:1},{...base.items[1],track:0,startSec:0,outSec:3,transitionOutSec:0}]},undefined,[[0.75,[127,64,0]],[1.25,[0,0,255]]],2)
  // Two different moving sources, both with unused handles around a centered cut.
  const incomingFile=path.join(tmp,'incoming.mp4')
  run(['-v','error','-f','lavfi','-i','color=c=green:s=64x64:r=24:d=1','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-y',incomingFile])
  project.clips.push({id:'incoming',promptData:recipe,takes:[{id:'incomingTake',file:incomingFile,durationSec:3}]})
  const centered={...base,items:[{id:'out',clipId:'clip',startSec:0,inSec:.5,outSec:1.5,transitionOutSec:1,transitionAlignment:.5},{id:'in',clipId:'incoming',startSec:1,inSec:1,outSec:2}]}
  await check('centered-moving-handles',centered,undefined,[[.75,[0,128,0]],[1.25,[0,32,191]]],2)
  await check('centered-range',{...centered,rangeInSec:.5,rangeOutSec:1.5},undefined,[[.25,[0,128,0]],[.75,[0,32,191]]],1)
  await check('start-at-cut',{...centered,items:[{...centered.items[0],transitionAlignment:1},centered.items[1]]},undefined,[[1.25,[0,96,64]],[1.75,[0,0,255]]],2)
  await check('insufficient-handles',{...centered,items:[{...centered.items[0],inSec:2,outSec:3},{...centered.items[1],inSec:0,outSec:1}]},undefined,[[.75,[0,32,191]],[1.25,[0,96,64]]],2)
  console.log('Export pixel, duration and audio checks passed. Fixtures: '+tmp)
})().catch(e=>{console.error(e);process.exitCode=1})
