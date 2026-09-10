// Real project persistence and uploader bytes, with the provider boundary mocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-primary-images-')),uploads=new Map(),inputs=[]
const fal={config:()=>{},storage:{upload:async file=>{const url='https://fixture.test/upload/'+uploads.size;uploads.set(url,Buffer.from(await file.arrayBuffer()));return url}},subscribe:async(endpoint,args)=>{inputs.push(args.input);return {data:{video:{url:'https://fixture.test/result'},images:[{url:'https://fixture.test/result'}]}}}}
function load(file){const code=require('esbuild').buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false,external:['@fal-ai/client','ffmpeg-static','./runtime']}).outputFiles[0].text;const mod={exports:{}};vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(n=>n==='@fal-ai/client'?{fal}:n==='./runtime'?{streamBodyToFile:async(body,file)=>{const bytes=Buffer.from(await new Response(body).arrayBuffer());fs.writeFileSync(file,bytes);return bytes.length}}:require(n),mod,mod.exports);return mod.exports}
const p=load(path.resolve(__dirname,'../src/main/project.ts')),sources=load(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/shared/imageSources.ts')),video=load(path.resolve(__dirname,'../src/main/fal.ts')),image=load(path.resolve(__dirname,'../src/main/falImage.ts'))
const originalFetch=global.fetch;global.fetch=async()=>new Response('fixture result')
;(async()=>{try{
  await p.newProject(tmp,'Primary');const project=p.getProject();
  const files={};for(const name of ['original','first','second','copy']){files[name]=path.join(project.dir,'images',name+'.png');fs.writeFileSync(files[name],name+' pixel fixture')}
  project.images=[{id:'image',title:'@image',file:files.original},{id:'copy',title:'@copy',file:files.copy}];project.editSessions=[{id:'tree',rootImageId:'image',nodes:['first','second'].map(id=>({id,parentId:null,file:files[id],prompt:id,refIds:[],createdAt:1}))}];await p.saveProject();
  const queued={images:[files.original],imageAssetIds:['image'],endImage:files.original,endImageAssetId:'image'};
  const base={engine:'seedance2',mode:'i2v',prompt:'fixture',duration:'4',resolution:'720p',aspectRatio:'16:9',generateAudio:false,falKey:'fake',outDir:path.join(tmp,'out')};
  for(const primary of ['first','second']){
    await p.setPrimaryNode('tree',primary);const resolved=sources.resolveRenderImages(p.getProject(),queued);assert.equal(resolved.images[0],files[primary]);assert.equal(sources.resolveRenderImages(p.getProject(),{images:[files.original]}).images[0],files[primary]);
    await video.runRender({...base,...resolved});const input=inputs.at(-1);assert.deepEqual(uploads.get(input.image_url),fs.readFileSync(files[primary]));assert.deepEqual(uploads.get(input.end_image_url),fs.readFileSync(files[primary]));
    await image.runImageGen({prompt:'fixture',baseImage:sources.imageEditSource(p.getProject(),'image',primary),refImages:[sources.primaryImageFile(p.getProject(),'image')],numImages:1,aspectRatio:'auto',falKey:'fake',outDir:base.outDir});assert.ok(inputs.at(-1).image_urls.every(url=>uploads.get(url).equals(fs.readFileSync(files[primary]))));
  }
  const cropBytes=Buffer.from('exact crop pixel fixture');const crop=await p.saveLocalEditNode({rootImageId:'image',parentId:'second',bytes:cropBytes,label:'crop'});assert.equal(p.getProject().editSessions[0].primaryNodeId,crop.nodeId);
  await video.runRender({...base,...sources.resolveRenderImages(p.getProject(),queued)});assert.deepEqual(uploads.get(inputs.at(-1).image_url),cropBytes);
  await p.undo();assert.equal(sources.primaryImageFile(p.getProject(),'image'),files.second);assert.equal(sources.imageEditSource(p.getProject(),'image',null),files.original);assert.equal(sources.imageEditSource(p.getProject(),'image','first'),files.first);
  assert.equal(sources.resolveRenderImages(p.getProject(),{images:[files.copy]}).images[0],files.copy);
  await p.setPrimaryNode('tree',null);assert.equal(sources.resolveRenderImages(p.getProject(),queued).images[0],files.original);
  await p.setPrimaryNode('tree','first');await p.openProject(p.getProject().dir);assert.equal(sources.primaryImageFile(p.getProject(),'image'),files.first);
  const broken=structuredClone(p.getProject());broken.editSessions[0].primaryNodeId='missing';assert.throws(()=>sources.resolveRenderImages(broken,queued),/primary.*missing/);assert.throws(()=>sources.imageEditSource(broken,'image','missing'),/no longer exists/);
  console.log('PASS primary switches, queued start/end and legacy paths, real uploaded bytes, image edits and refs, crop primary, undo, original, independent copies, reopen and missing-primary refusal')
}finally{global.fetch=originalFetch}})().catch(e=>{console.error(e);process.exitCode=1})
