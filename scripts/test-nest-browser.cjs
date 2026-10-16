// NEST part 2 (list 3, 2026-09-29) — the real Timeline and Effects panels with nests in them: the
// block's right-click reaches dissolve / speed / effects / unlink (no loop), its face shows the
// clips inside, its sound strip carries the waveform parts, an unlinked nest's lane block shows,
// the Effects panel opens on a nest, and unlink asks main for the nest's block. Same offscreen
// Electron harness as the editor-additions test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-nest-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline'; import {EffectsPanel} from '${ui}/panels/EffectsPanel';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const has=s=>document.body.textContent.includes(s);
    const context=el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));
    const escape=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      const unlinks=[];
      // every API the panels reach answers: listeners with a no-op unsubscribe, calls with null
      const api={projectRecents:async()=>[],timelineUnlinkAudio:async(tl,id)=>{unlinks.push([tl,id]);return null},modelsList:async()=>({rows:[]}),fxSidecars:async()=>({})};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip=(id,n)=>({id,name:n,promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:id+'t',file:id+'.mp4',durationSec:4}],keeperTakeId:id+'t'});
      const clips=[clip('c1','red'),clip('c2','blue')];
      const inner={id:'in',name:'Montage',aspectRatio:'16:9',items:[{id:'a',clipId:'c1',startSec:0,track:0},{id:'b',clipId:'c2',startSec:4,track:0}],audioItems:[],scoreItems:[]};
      const par={id:'par',name:'Main',aspectRatio:'16:9',audioTracks:3,items:[
        {id:'N',clipId:'',nestId:'in',startSec:0,track:0,inSec:0,outSec:8,gain:.5,fadeInSec:1},
        {id:'N2',clipId:'',nestId:'in',startSec:10,track:0,inSec:0,outSec:8,muted:true,audioDetachedId:'L'}
      ],audioItems:[{id:'L',lane:1,source:{nestId:'in'},startSec:10,inSec:0,outSec:8}],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips,images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[par,inner],activeTimelineId:'par',folders:[]};
      useStore.setState({project,selectedTlItemId:'N'});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',height:900}}><div style={{width:1100,height:900}}><TimelinePanel/></div><div style={{width:300}}><EffectsPanel/></div></div>);await tick(400);
      check(!errors.length,'no render errors: '+errors.join(' | '));
      // the blocks and their faces
      const blocks=[...document.querySelectorAll('[title^="⧉ nest"]')];
      check(blocks.length===2,'both nest blocks render ('+blocks.length+')');
      check(document.querySelectorAll('[data-nest-part]').length===4,'each nest shows its two clips inside ('+document.querySelectorAll('[data-nest-part]').length+')');
      // sound: the linked nest's strip + the unlinked nest's lane block, each with two wave parts
      check(has('🔗 ⧉ Montage'),"the linked nest's sound strip is on its lane");
      check(document.querySelectorAll('[data-nest-wave]').length===4,'two wave parts on the strip, two on the lane block ('+document.querySelectorAll('[data-nest-wave]').length+')');
      check([...document.querySelectorAll('[title]')].some(el=>el.title.startsWith("⧉ Montage · the nest's sound")),'the lane block is named for its timeline');
      // the right-click: dissolve, speed, effects, unlink — no loop
      context(blocks[0]);await tick();
      for(const s of ['cross-dissolve','speed / duration…','effects…','unlink audio','open nest'])check(has(s),'menu has '+s);
      check(!has('⟲ loop'),'no loop on a nest');
      const unlink=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='♪ unlink audio').pop();
      unlink.click();await tick();
      check(unlinks.length===1&&unlinks[0][0]==='par'&&unlinks[0][1]==='N','unlink asks main for the nest block');
      escape();await tick();
      context(blocks[1]);await tick();
      check(has('speed / duration…')&&!has('unlink audio'),'an unlinked nest offers no second unlink');
      escape();await tick();
      // the Effects panel on a nest
      check(has('effects · this nest'),'the Effects panel opens on the nest');
      check(has("its effects run on every clip inside it"),"the nest's AI data covers its clips");
      check(!errors.length,'no errors: '+errors.join(' | '));
      await window.saveScreenshot();
      root.unmount();return 'nest blocks, faces, sound strip + lane block waves, right-click (dissolve/speed/effects/unlink, no loop), unlink call, Effects panel on a nest';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('saveScreenshot',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...args)=>console.log('PAGE',...args)); ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'nest.png'),(await win.webContents.capturePage()).toPNG()))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../koan-shared/styles/koan.css'),'utf8'))
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    console.log('Screenshot: '+path.join(tmp,'nest.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
