// Real Voice card, mocked project and queue. No supplier traffic or profile edits.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-voice-ui-'))
 const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
 const code=require('esbuild').buildSync({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {VoicesCardPanel} from '${ui}/panels/VoicesCard';import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';
  const tick=()=>new Promise(r=>setTimeout(r,80));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
  export async function run(){
   let queued;
   // the card reads which supplier keys are saved, and (ElevenLabs) the account's voices
   let saved={falKey:'••••1111',googleKey:'',elevenKey:'••••3333'};
   setVidancerApi(new Proxy({getSettings:async()=>saved,voiceVoices:async()=>({ok:true,voices:[{id:'a1',label:'Rachel · premade'},{id:'b2',label:'Elder · generated'}]})},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
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
   // list 18: Gemini 3.8 on the Google key — its voices, a style line, and the key gate
   const setEngine=async(engine,extra={})=>{useStore.setState({project:{...project,voiceClips:[{...voice,...extra,recipe:{...voice.recipe,engine,...(extra.recipe??{})}}]}});await tick();await tick()};
   const btn=t=>[...document.querySelectorAll('.btn')].find(el=>el.textContent.trim().startsWith(t));
   const opts=async sel=>{document.querySelector(sel).click();await tick();const o=[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px').map(e=>e.textContent.replace('✓','').trim());[...document.querySelectorAll('div[style*="inset: 0"]')].pop()?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick();return o};
   await setEngine('gemini-38-tts');
   check(!!document.querySelector('[title^="Uses your Google AI key"]'),'Gemini: VIA Google');
   check(document.body.textContent.includes('add your Google API key in Settings first'),'no Google key: the reason is on the card');
   queued=undefined;btn('＋ Queue').click();await tick();check(queued===undefined,'… and nothing is queued');
   saved={...saved,googleKey:'••••2222'};useStore.setState(st=>({settingsRev:st.settingsRev+1}));await tick();await tick();
   check(!document.body.textContent.includes('add your Google API key'),'the key arrives: the gate lifts');
   const gv=await opts('[title="which voice speaks the test line"]');
   check(gv.length===31&&gv[0]==='new — designed from the description'&&gv[1]==='Zephyr — bright','Gemini lists "new" + its 30 voices: '+gv.length+' '+gv.slice(0,2).join(' | '));
   check(!!document.querySelector('input[placeholder="e.g. whispered urgently"]'),'the style line is there');
   check(document.body.textContent.includes('clone sample (not used)'),'the clone sample says Gemini does not use it');
   btn('＋ Queue').click();await tick();
   check(queued.engineLabel==='Gemini 3.8 Flash TTS · via Google'&&queued.payload.engine==='gemini-38-tts','Gemini queues on Google: '+queued.engineLabel);
   // a voice with no description but a ready voice picked still renders
   await setEngine('gemini-38-tts',{recipe:{desc:undefined,options:{voice:'Kore'}}});
   check(!document.body.textContent.includes('✕ describe the voice'),'a picked voice needs no description');
   // list 19: Eleven v4 — the voices of his ElevenLabs account
   await setEngine('eleven-v4');
   check(!!document.querySelector('[title^="Uses your ElevenLabs key"]'),'Eleven v4: VIA ElevenLabs');
   const ev=await opts('[title="which voice speaks the test line"]');
   check(JSON.stringify(ev)==='["new — from the description or sample","Rachel · premade","Elder · generated"]','Eleven v4 lists his account voices: '+JSON.stringify(ev));
   // a take designed on ElevenLabs is the kept voice
   await setEngine('eleven-v4',{takes:[{id:'t1',file:'t1.mp3',createdAt:1,engine:'eleven-v4',voiceId:'v-new'}],keeperTakeId:'t1',recipe:{desc:undefined}});
   const kv=await opts('[title="which voice speaks the test line"]');
   check(kv[0]==='this voice (kept from its takes)','a designed take keeps its voice: '+kv[0]);
   check(!document.body.textContent.includes('✕ describe the voice'),'the kept voice needs no description');
   root.unmount();return 'VIA, supplier billing, fixed route, queue label and provider changes; Gemini 3.8 (30 voices, style, key gate) and Eleven v4 (account voices, kept voice)';
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
