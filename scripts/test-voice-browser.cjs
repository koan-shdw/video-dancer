// Real Voice card, mocked project and queue. No supplier traffic or profile edits.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-voice-ui-'))
 const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
 const code=require('esbuild').buildSync({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {VoicesCardPanel} from '${ui}/panels/VoicesCard';import {useStore} from '${ui}/store';
  const tick=()=>new Promise(r=>setTimeout(r,80));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
  export async function run(){
   let queued;
   const voice={id:'voice',name:'Demonette Voice',recipe:{engine:'seed-audio-1',desc:'A smooth, regal voice with a low echo.',testLine:'Take this away.'},takes:[]};
   const project={id:'test',name:'Test',voiceClips:[voice],images:[],audio:[],charSheets:[],clips:[],timelines:[]};
   useStore.setState({project,editorVoiceId:'voice',enqueueRender:job=>{queued=job},saveVoiceClip:async()=>{}});
   const root=createRoot(document.getElementById('root'));root.render(<VoicesCardPanel/>);await tick();
   const via=document.querySelector('[title="Uses your fal API key and fal credits."]');
   check(!!via&&via.textContent.includes('fal'),'fal VIA displayed');
   via.click();await tick();check(!document.querySelector('[data-cur]'),'single-provider VIA does not offer unsupported routes');
   check(document.body.textContent.includes('Uses your fal API key and fal credits.'),'billing source visible');
   const queue=[...document.querySelectorAll('.btn')].find(el=>el.textContent.trim()==='＋ Queue');queue.click();
   check(queued.engineLabel==='Seed Audio 1.0 · via fal'&&queued.payload.engine==='seed-audio-1','queue identifies actual supplier without changing routing');
   await window.captureVoice();
   useStore.setState({project:{...project,voiceClips:[{...voice,recipe:{...voice.recipe,engine:'chatterbox-local'}}]}});await tick();
   const local=document.querySelector('[title="Runs on this computer; the local voice runtime is not available yet."]');
   check(!!local&&local.textContent.includes('Local'),'VIA updates with model provider');
   check(!document.body.textContent.includes('Uses your fal API key and fal credits.'),'old billing source removed');
   root.unmount();return 'VIA, supplier billing, fixed route, queue label and provider changes';
  }
 `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
 fs.writeFileSync(path.join(tmp,'checks.js'),code)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',windowsHide:true,timeout:30000})
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error.message);process.exitCode=r.status===0?0:1
}else{
 const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2]
 app.setPath('userData',path.join(tmp,'profile'))
 const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('captureVoice',()=>require('electron').ipcRenderer.invoke('capture'))")
 app.whenReady().then(async()=>{try{
  const win=new BrowserWindow({show:false,width:690,height:830,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
  ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'voice.png'),(await win.webContents.capturePage()).toPNG()))
  await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>')
  await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'))
  console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
  console.log('Screenshot: '+path.join(tmp,'voice.png'));app.exit(0)
 }catch(e){console.error(e);app.exit(1)}})
}
