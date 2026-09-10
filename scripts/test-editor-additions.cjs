const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm')
const { buildSync } = require('esbuild')
function load(file) {
  const code = buildSync({entryPoints:[path.resolve(__dirname,'..',file)],bundle:true,platform:'node',format:'cjs',write:false,external:['ffmpeg-static']}).outputFiles[0].text
  const mod={exports:{}};vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(require,mod,mod.exports);return mod.exports
}
async function main() {
  const p=load('src/main/project.ts'), temp=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'vd-selection-'))
  await p.newProject(temp,'Selection test');const project=p.getProject()
  const file=path.join(project.dir,'renders','keep.png');await fs.writeFile(file,'original-media')
  const recipe={...p.emptyPromptData(),imageIds:['image'],endImageId:'image',audioRefs:[{audioId:'audio'},{voiceId:'voice'}],videoRefs:[{videoId:'video'}]}
  project.clips=[{id:'clip',name:'delete',promptData:p.emptyPromptData(),takes:[]},{id:'keep',name:'keep',promptData:recipe,takes:[]}]
  for(const field of ['images','audio','videos','charSheets','scoreClips','voiceClips','styles'])project[field]=[{id:{images:'image',audio:'audio',videos:'video',charSheets:'sheet',scoreClips:'score',voiceClips:'voice',styles:'style'}[field],file,takes:[]}]
  project.imageGens=[{id:'gen',name:'gen',recipe:{prompt:''},takes:[{id:'take',file,takes:[]}]}]
  project.timelines=[{id:'stay',items:[{id:'block',clipId:'clip'}],audioItems:[{id:'linked',source:{clipId:'clip'}},{id:'music',source:{audioId:'audio'}}],scoreItems:[{id:'scoreBlock',scoreClipId:'score'}],music:{audioId:'audio'}},{id:'deleteTl',items:[]}];project.activeTimelineId='deleteTl'
  await p.saveProject();const before=JSON.parse(JSON.stringify(project))
  const selection={clipIds:['clip'],imageIds:['image'],audioIds:['audio'],videoIds:['video'],sheetIds:['sheet'],scoreIds:['score'],voiceIds:['voice'],styleIds:['style'],imageGenIds:['gen'],timelineIds:['deleteTl']}
  const delta=await p.deleteAssetSelection(selection)
  assert.equal(delta.activeTimelineId,'stay');assert.deepEqual(delta.removedImageGenIds,['gen'])
  assert.deepEqual(p.getProject().timelines[0].items,[]);assert.deepEqual(p.getProject().timelines[0].audioItems,[]);assert.deepEqual(p.getProject().timelines[0].scoreItems,[])
  assert.equal(p.getProject().timelines[0].music,undefined);assert.equal(p.getProject().clips.length,1)
  assert.deepEqual(p.getProject().clips[0].promptData.imageIds,[]);assert.deepEqual(p.getProject().clips[0].promptData.audioRefs,[])
  assert.deepEqual(p.getProject().clips[0].promptData.videoRefs,[])
  const restored=await p.undo();for(const field of ['clips','images','audio','videos','charSheets','scoreClips','voiceClips','styles','imageGens','timelines'])assert.deepEqual(restored[field],before[field],field+' restored with ONE undo')
  assert.equal(await fs.readFile(file,'utf8'),'original-media')
  await p.redo();assert.equal(p.getProject().imageGens.length,0)
  await p.deleteAssetSelection({timelineIds:['stay']});assert.equal(p.getProject().timelines.length,1);assert.equal(p.getProject().activeTimelineId,p.getProject().timelines[0].id)
  console.log('PASS mixed deletion: ten asset types, live reference cleanup, one undo, redo, source media preserved, final timeline retained')
}
main().catch(e=>{console.error(e);process.exitCode=1})
