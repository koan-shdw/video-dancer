// Saved curation across take types, plus the real shared audio-row DOM after keeper changes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict')
if(!process.versions.electron){
  ;(async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-take-colors-'))
    const code=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/main/project.ts')],bundle:true,platform:'node',format:'cjs',write:false,external:['ffmpeg-static']}).outputFiles[0].text
    const mod={exports:{}};vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(require,mod,mod.exports)
    const p=mod.exports;await p.newProject(tmp,'Colors');const project=p.getProject(),file=path.join(project.dir,'fixture.wav');fs.writeFileSync(file,'fixture')
    const takes=()=>['a','b'].map(id=>({id,file,createdAt:1}))
    project.scoreClips=[{id:'score',name:'Score',recipe:{engine:'minimax-music-3'},beats:[],takes:takes()}]
    project.voiceClips=[{id:'voice',name:'Voice',recipe:{engine:'seed-audio-1'},takes:takes()}]
    project.clips=[{id:'clip',name:'Clip',promptData:{beats:[],duration:'5'},takes:takes()}]
    project.imageGens=[{id:'image',name:'Image',recipe:{},takes:takes()}]
    for(const [set,owner] of [[p.setScoreTakeMeta,'score'],[p.setVoiceTakeMeta,'voice'],[p.setTakeMeta,'clip'],[p.setImageGenTakeMeta,'image']]){
      await set(owner,'a',{color:'#d9534f'});await set(owner,'a',{disabled:true});await set(owner,'b',{color:'#5cb85c'});await set(owner,'a',{disabled:false})
    }
    await p.setScoreKeeper('score','a');await p.setScoreKeeper('score','b');await p.setVoiceKeeper('voice','a');await p.setVoiceKeeper('voice','b')
    await p.openProject(project.dir)
    for(const list of ['scoreClips','voiceClips','clips','imageGens']){
      assert.equal(p.getProject()[list][0].takes[0].color,'#d9534f',list);assert.equal(p.getProject()[list][0].takes[1].color,'#5cb85c',list)
    }
    console.log('PASS Score, Voice, Clip and Image Gen colors persist through metadata edits and reopen')
    const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
    const browser=require('esbuild').buildSync({stdin:{contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';import {AudioTakeRow} from '${ui}/panels/shared/takeRows';
      const tick=()=>new Promise(r=>setTimeout(r,40));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      export async function run(){
        const root=createRoot(document.getElementById('root'));
        for(const kind of ['score','voice']){
          const draw=async(keeper,color='#d9534f',selected=false,disabled=false)=>{root.render(<AudioTakeRow take={{id:'a',file:'',color,disabled}} keeper={keeper} selected={selected} index={0} dragMime={'vd/'+kind+'-take'} dragPayload="{}" dragHint="fixture" onKeeper={()=>{}} onMenu={()=>{}}/>);await tick()};
          const stripe=()=>{const css=getComputedStyle(document.querySelector('[draggable="true"]'));return css.borderLeftColor+' '+css.borderLeftWidth};
          await draw(false);check(stripe()==='rgb(217, 83, 79) 4px',kind+' initial color');
          await draw(true);check(stripe()==='rgb(217, 83, 79) 4px',kind+' color survives becoming keeper: '+stripe());
          await draw(false);check(stripe()==='rgb(217, 83, 79) 4px',kind+' color survives losing keeper: '+stripe());
          await draw(true,'#5cb85c',true,true);check(stripe()==='rgb(92, 184, 92) 4px',kind+' recolor with selection and disabled');
          await draw(false,null);check(getComputedStyle(document.querySelector('[draggable="true"]')).borderLeftWidth==='1px',kind+' clear removes stripe');
          await draw(true,null);check(getComputedStyle(document.querySelector('[draggable="true"]')).borderLeftColor==='rgb(231, 169, 60)',kind+' unmarked keeper border');
        }
        root.unmount();return 'Score and Voice stripe survives keeper switches, selection, disable, recolor and clear';
      }
    `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
    fs.writeFileSync(path.join(tmp,'checks.js'),browser);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',windowsHide:true,timeout:30000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1
  })().catch(e=>{console.error(e);process.exitCode=1})
}else{
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2];app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:700,height:400,webPreferences:{sandbox:true,offscreen:true,backgroundThrottling:false}});await win.loadURL('data:text/html,<style>:root{--amber:rgb(231,169,60);--line:rgb(60,60,60)}</style><div id="root"></div>');console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'));app.exit(0)}catch(e){console.error(e);app.exit(1)}})
}
