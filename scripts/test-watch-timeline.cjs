// Real ffmpeg assembly, mocked reader. Verify what is actually handed to the provider.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process'), { buildSync } = require('esbuild')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-watch-timeline-test-'))
const ffmpeg = require('ffmpeg-static')
const run = args => { const r = spawnSync(ffmpeg, args, { maxBuffer: 8e6 }); assert.equal(r.status, 0, String(r.stderr)); return r }
const src = path.join(tmp, 'source.mp4')
run(['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=24:d=1','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=1','-f','lavfi','-i','sine=frequency=440:duration=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',src])
const tl = { id:'tl',name:'Story',aspectRatio:'1:1',exportRes:'1080',exportFps:'24',exportQuality:'high',rangeInSec:1,rangeOutSec:2,items:[{id:'blue',clipId:'clip',startSec:0,inSec:1,outSec:2},{id:'red',clipId:'clip',startSec:1,inSec:0,outSec:1}] }
const project = { dir:tmp,timelines:[tl],clips:[{id:'clip',promptData:{duration:'2',beats:[],imageIds:[]},takes:[{id:'take',file:src,durationSec:2}]}],images:[],audio:[],scoreClips:[],voiceClips:[] }
let session=1, writes=0, reads=0, observed, inspect, finishCount=0
const code = buildSync({ entryPoints:[path.join(__dirname,'../src/main/watchTimeline.ts')],platform:'node',format:'cjs',bundle:true,write:false,external:['./project','./watch','ffmpeg-static'] }).outputFiles[0].text
const mod = {exports:{}}
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name => {
  if (name === './project') return {getProject:()=>project,captureProjectSession:()=>({dir:tmp,id:session}),assertProjectSession:o=>{if(o.id!==session)throw Error('Project changed')},beginMediaWrite:()=>writes++,endMediaWrite:()=>writes--}
  if (name === './watch') return {watchVideo:async(file,question,opts)=>{reads++;observed=file;assert.ok(fs.existsSync(file));await inspect(file,question,opts);return {ok:true,text:'The blue shot cuts to red.',via:'gemini',model:'test'}}}
  return require(name)
},mod,mod.exports)
const {watchTimeline,setWatchBaker,cancelTimelineWatch,timelineWatchBusy,setWatchFinished}=mod.exports
setWatchFinished(()=>finishCount++)
const pixel=(file,t)=>[...run(['-v','error','-ss',String(t),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']).stdout]
const opts={googleKey:'fake'}
async function check(name,fn){await fn();assert.equal(writes,0);assert.equal(timelineWatchBusy(),false);console.log('PASS '+name)}
;(async()=>{
  await check('full cut follows timeline order, retains audio and cleans temporary video',async()=>{
    setWatchBaker(async(p,t)=>{assert.notEqual(p,project);assert.equal(t.rangeInSec,undefined);assert.equal(t.exportRes,'480');return []})
    inspect=async(file,q)=>{assert.ok(pixel(file,.25)[2]>220);assert.ok(pixel(file,1.25)[0]>220);assert.match(q,/timeline time 0.000/);const audio=run(['-i',file,'-map','0:a','-f','null','-']);assert.ok(audio.stderr.length)}
    const r=await watchTimeline({timelineId:'tl'},opts);assert.equal(r.ok,true,r.error);assert.ok(Math.abs(r.durationSec-2)<.1);assert.equal(fs.existsSync(observed),false)
    assert.equal(tl.exportRes,'1080');assert.equal(tl.rangeInSec,1)
  })
  await check('marked range uses correct trim and timeline timestamp offset',async()=>{
    setWatchBaker(async(_p,t)=>{assert.equal(t.rangeInSec,1);return []})
    inspect=async(file,q)=>{assert.ok(pixel(file,.25)[0]>220);assert.match(q,/timeline time 1.000/);assert.match(q,/Check the ending/)}
    const r=await watchTimeline({timelineId:'tl',range:'selection',question:'Check the ending'},opts);assert.equal(r.ok,true,r.error);assert.equal(r.startSec,1);assert.ok(Math.abs(r.durationSec-1)<.1)
  })
  await check('effect preparation failure does not send an incomplete cut',async()=>{
    const before=reads
    const scratch=path.join(tmp,'exports','.fxbake','partial.mp4');fs.mkdirSync(path.dirname(scratch),{recursive:true});fs.writeFileSync(scratch,'partial')
    setWatchBaker(async()=>{throw Object.assign(Error('FX unavailable'),{bakes:[{file:scratch,start:0,end:1}]})})
    const r=await watchTimeline({timelineId:'tl'},opts);assert.equal(r.ok,false);assert.match(r.error,/FX unavailable/);assert.equal(reads,before);assert.equal(fs.existsSync(scratch),false)
  })
  await check('cancellation and duplicate requests',async()=>{
    const before=reads
    setWatchBaker(async(_p,_t,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})))
    const first=watchTimeline({timelineId:'tl'},opts);assert.equal(timelineWatchBusy(),true)
    assert.match((await watchTimeline({timelineId:'tl'},opts)).error,/already running/)
    assert.equal(cancelTimelineWatch(),true);assert.equal((await first).ok,false);assert.equal(reads,before)
  })
  await check('project switch cancels before any provider submission',async()=>{
    const before=reads
    setWatchBaker(async()=>{session++;return []})
    const r=await watchTimeline({timelineId:'tl'},opts);assert.equal(r.ok,false);assert.match(r.error,/Project changed/);assert.equal(reads,before)
  })
  await check('invalid selection and missing reader are actionable',async()=>{
    assert.match((await watchTimeline({timelineId:'tl'},{})).error,/Settings/)
    delete tl.rangeOutSec
    assert.match((await watchTimeline({timelineId:'tl',range:'selection'},opts)).error,/in\/out/)
  })
  assert.equal(finishCount,5)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}))
