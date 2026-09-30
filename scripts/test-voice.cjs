// Exercise voice submission and the real typed uploader without network traffic or API credit.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-voice-test-'))
let uploads=[],submissions=[],uploadError,renderError,credentials=[]
const fal={config:o=>credentials.push(o.credentials),storage:{upload:async file=>{if(uploadError)throw uploadError;uploads.push({name:file.name,type:file.type});return 'https://fixture.test/'+file.name}},subscribe:async(endpoint,args)=>{submissions.push({endpoint,input:args.input});if(renderError)throw renderError;args.onEnqueue?.('test-request');return {data:{audio:{url:'https://fixture.test/result.mp3'}}}}}
const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/main/voiceRender.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['@fal-ai/client','./runtime','electron','ffmpeg-static']}).outputFiles[0].text
const mod={exports:{}}
vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(name=>name==='@fal-ai/client'?{fal}:name==='electron'?{}:name==='./runtime'?{streamBodyToFile:async(body,file)=>{const bytes=Buffer.from(await new Response(body).arrayBuffer());fs.writeFileSync(file,bytes);return bytes.length}}:require(name),mod,mod.exports)
const originalFetch=global.fetch;global.fetch=async()=>new Response('audio fixture')
const source=name=>{const file=path.join(tmp,name);fs.writeFileSync(file,'source fixture');return file}
const base={engine:'seed-audio-1',mode:'design',text:'A test line.',desc:'A clear voice',options:{},falKey:'fake',outDir:tmp}
async function check(name,fn){await fn();assert.equal(credentials.at(-1),'','fal credentials released');console.log('PASS '+name)}
;(async()=>{
 await check('character images retain their real file type',async()=>{
  for(const [ext,type] of [['png','image/png'],['JPG','image/jpeg'],['webp','image/webp']]){
   const r=await mod.exports.runVoiceRender({...base,imagePath:source('character.'+ext)})
   assert.equal(uploads.at(-1).type,type);assert.ok(fs.existsSync(r.file));assert.ok(submissions.at(-1).input.image_url);assert.equal(submissions.at(-1).input.audio_urls,undefined)
  }
 })
 await check('clone samples retain their audio type and exclude images',async()=>{
  for(const [ext,type] of [['wav','audio/wav'],['mp3','audio/mpeg'],['ogg','audio/ogg'],['m4a','audio/mp4'],['flac','audio/flac']]){
   await mod.exports.runVoiceRender({...base,mode:'clone',refAudioPath:source('sample.'+ext),imagePath:source('ignored.png')})
   assert.equal(uploads.at(-1).type,type);assert.equal(submissions.at(-1).input.image_url,undefined);assert.equal(submissions.at(-1).input.audio_urls.length,1)
  }
 })
 await check('repeat renders reuse the correctly typed upload',async()=>{
  const before=uploads.length
  await mod.exports.runVoiceRender({...base,imagePath:path.join(tmp,'character.png')})
  assert.equal(uploads.length,before)
 })
 await check('image upload rejection names stage, provider, credits and key',async()=>{
  const before=submissions.length;uploadError={status:403,message:'Forbidden'}
  await assert.rejects(()=>mod.exports.runVoiceRender({...base,imagePath:source('rejected.png')}),e=>/403/.test(e.message)&&/fal storage.*character image upload/.test(e.message)&&/key or credit/.test(e.message))
  assert.equal(submissions.length,before);uploadError=undefined
 })
 await check('audio upload rejection also prevents a paid submission',async()=>{
  const before=submissions.length;uploadError={status:403,message:'Forbidden'}
  await assert.rejects(()=>mod.exports.runVoiceRender({...base,mode:'clone',refAudioPath:source('rejected.wav')}),/voice sample upload.*key or credit/)
  assert.equal(submissions.length,before);uploadError=undefined
 })
 await check('model rejection stays distinct from an upload failure',async()=>{
  renderError={status:403,message:'Forbidden'}
  await assert.rejects(()=>mod.exports.runVoiceRender(base),e=>/bytedance\/seed-audio-1.0/.test(e.message)&&!/upload/.test(e.message))
  renderError=undefined
 })
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.fetch=originalFetch;fs.rmSync(tmp,{recursive:true,force:true})})
