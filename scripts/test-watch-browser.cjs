// Test the real React controls in hidden Electron, without provider traffic or a user profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-watch-ui-test-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {WatchTimelineModal} from '${ui}/panels/WatchTimelineModal';
    import {SettingsModal} from '${ui}/panels/SettingsModal';
    import {installWatchBridge} from '${ui}/watchBridge';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=()=>new Promise(r=>setTimeout(r,60));
    const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label);
    const change=(input,value)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,value);input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));};
    export async function run(){
      const root=createRoot(document.getElementById('root')); let calls=[],resolveWatch,progress,cancelled=0;
      setVidancerApi({watchTimeline:args=>{calls.push(args);return new Promise(r=>resolveWatch=r)},watchCancel:async()=>{cancelled++;resolveWatch({ok:false,error:'Timeline watch cancelled.'})},onWatchProgress:cb=>{progress=cb;return()=>{progress=null}}});
      const tl={id:'tl',name:'Opulent',rangeInSec:16,rangeOutSec:21};
      root.render(<WatchTimelineModal timeline={tl} onClose={()=>root.render(null)}/>);await tick();
      check(document.querySelector('[aria-label="Watch scope"]').value==='full','default full timeline');
      change(document.querySelector('textarea'),'Check the ending');await tick();
      change(document.querySelector('select'),'selection');await tick();button('Watch cut').click();await tick();
      check(calls[0].timelineId==='tl'&&calls[0].range==='selection'&&calls[0].question==='Check the ending','range and question submitted');
      check(button('Watch cut').disabled&&document.querySelector('textarea').disabled,'no duplicate request or edits during work');
      progress('Watching the assembled cut…');await tick();check(document.body.textContent.includes('Watching the assembled cut'),'progress visible');
      resolveWatch({ok:true,via:'frames',warning:'Google unavailable; reviewed still frames.',text:'The knight is lying in the nave.',startSec:16,durationSec:5});await tick();
      check(document.body.textContent.includes('Still-frame review — no motion or sound'),'fallback clearly labelled');
      check(document.body.textContent.includes('Google unavailable')&&document.body.textContent.includes('16.00s'),'warning and time offset visible');
      await window.saveScreenshot();
      button('Watch cut').click();await tick();button('Cancel').click();await tick();check(cancelled===1&&document.querySelector('[role=alert]').textContent.includes('cancelled'),'cancel result');
      button('Watch cut').click();await tick();root.render(null);await tick();check(cancelled===2,'closing cancels work');
      root.render(<WatchTimelineModal timeline={{id:'empty-range',name:'No range'}} onClose={()=>{}}/>);await tick();check(document.querySelector('option[value=selection]').disabled,'missing range unavailable');root.render(null);await tick();
      let saved=[];
      useStore.setState({refreshCredit:async()=>{}});
      setVidancerApi(new Proxy({getSettings:async()=>({googleKey:'masked'}),setSettings:async p=>{saved.push(p);return p},codirModels:async()=>[],codirBridgeModels:async()=>[],codirBridgeStatus:async()=>({found:false,detail:''}),codirGuides:async()=>[]},{get:(o,k)=>k in o?o[k]:/^on[A-Z]/.test(String(k))?()=>()=>{}:async()=>null}));
      root.render(<SettingsModal onClose={()=>{}}/>);await tick();[...document.querySelectorAll('.vd-settings-nav button')].find(b=>b.textContent.trim()==='Watch').click();await tick();
      const model=document.querySelector('[aria-label="Watch model"]');check(model.value==='gemini-3.8-flash','model default visible');check(document.body.textContent.includes('Default: gemini-3.8-flash.')&&document.body.textContent.includes('gemini-3.6-flash'),'the one before stays named');
      change(model,'models/custom-video-model');await tick();
      const save=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Apply model');
      check(!!save,'settings save control');save.click();await tick();
      check(saved.some(p=>p.googleWatchModel==='custom-video-model'),'custom model saved');
      check(saved.every(p=>!('googleKey' in p)),'untouched secret not overwritten');
      root.unmount();
      let bake,finish,reply;
      useStore.setState({exportState:{busy:false,msg:''},refreshSpend:async()=>{}});
      setVidancerApi({onWatchBake:cb=>{bake=cb;return()=>{}},onWatchFinished:cb=>{finish=cb;return()=>{}},onWatchBakeCancel:()=>()=>{},watchBakeReply:r=>{reply=r}});
      const off=installWatchBridge();
      const request={id:'job',project:{clips:[],images:[],audio:[]},timeline:{id:'tl',items:[]},plan:{W:480,H:480,fps:24}};
      await bake(request);check(reply.id==='job'&&reply.bakes.length===0&&useStore.getState().exportState.busy,'renderer bake handoff stays locked until main finishes');
      await bake({...request,id:'second'});check(!!reply.error,'concurrent export/bake refused');
      finish();check(!useStore.getState().exportState.busy,'main completion releases renderer');off();
      return 'scope, question, progress, fallback, cancel, close, range validation, model settings and renderer handoff';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},loader:{'.css':'empty'},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:45000,windowsHide:true})
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error.message);process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('saveScreenshot',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:900,height:720,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    ipcMain.handle('capture',async()=>{fs.writeFileSync(path.join(tmp,'watch.png'),(await win.webContents.capturePage()).toPNG())})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../koan-shared/styles/koan.css'),'utf8'))
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    console.log('Screenshot: '+path.join(tmp,'watch.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
