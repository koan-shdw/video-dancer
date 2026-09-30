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
   let queued;const asked=[];
   // the card reads which supplier keys are saved, and (ElevenLabs) the account's voices
   let saved={falKey:'••••1111',googleKey:'',elevenKey:'••••3333'};
   setVidancerApi(new Proxy({getSettings:async()=>saved,voiceVoices:async(engine,search)=>{asked.push([engine,search]);return engine.startsWith('eleven')?{ok:true,voices:[{id:'a1',label:'Rachel · premade'},{id:'b2',label:'Elder · generated'}]}:search?{ok:true,voices:[{id:'voice_mine',label:'Elder — male',title:'my saved voice'},{id:'lib_warm',label:'Warm Brit — male · british',title:'A warm British narrator'}]}:{ok:false,error:'no answer'}}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
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
   check(document.body.textContent.includes('clone sample (needs the consent clip)'),'the clone sample says what Gemini needs to copy it');
   btn('＋ Queue').click();await tick();
   check(queued.engineLabel==='Gemini 3.8 Flash TTS · via Google'&&queued.payload.engine==='gemini-38-tts','Gemini queues on Google: '+queued.engineLabel);
   // a voice with no description but a ready voice picked still renders
   await setEngine('gemini-38-tts',{recipe:{desc:undefined,options:{voice:'Kore'}}});
   check(!document.body.textContent.includes('✕ describe the voice'),'a picked voice needs no description');
   // ---- list 18, the rest: the library search, two speakers, copying a sample with the consent clip ----
   const type=async(el,v)=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));await tick()};
   const pickOpt=async(sel,label)=>{document.querySelector(sel).click();await tick();const el=[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px').find(e=>e.textContent.replace('✓','').trim()===label);check(el,'option '+label);el.click();await tick()};
   let savedRecipe;useStore.setState({saveVoiceClip:async(id,patch)=>{savedRecipe=patch.recipe}});
   const mira={id:'mira',name:'Mira',recipe:{engine:'gemini-38-tts',options:{voice:'Kore'}},takes:[]};
   const lib=[{id:'s1',title:'kai sample',file:'s1.wav',durationSec:18},{id:'c1',title:'kai consent',file:'c1.wav',durationSec:7}];
   const open=async(recipe={},name='Kai')=>{useStore.setState({project:{...project,audio:lib,voiceClips:[{...voice,name,recipe:{...voice.recipe,engine:'gemini-38-tts',...recipe}},mira]}});await tick();await tick()};
   await open();
   const search=()=>document.querySelector('input[placeholder="e.g. warm british"]');
   check(!!search(),'Gemini has the library search box');
   check(asked.some(a=>a[0]==='gemini-38-tts'&&a[1]===''),'the library is asked for on the Google key');
   check((await opts('[title="which voice speaks the test line"]')).length===31,'no answer from the library = the 30 stay');
   await type(search(),'warm');await new Promise(r=>setTimeout(r,500));
   check(asked.some(a=>a[0]==='gemini-38-tts'&&a[1]==='warm'),'his words search the library');
   const found=await opts('[title="which voice speaks the test line"]');
   check(JSON.stringify(found)==='["new — designed from the description","Elder — male","Warm Brit — male · british"]','the matches fill the voice list, his own saved voice first: '+JSON.stringify(found));
   // two speakers
   const two=await opts('[title^="who else speaks in this take"]');
   check(two[0]==='none — one speaker'&&two[1]==='🎤 Mira'&&two.includes('Warm Brit — male · british'),'the second speaker: none, this project’s other voices, the ready voices: '+JSON.stringify(two.slice(0,4)));
   await pickOpt('[title^="who else speaks in this take"]','🎤 Mira');
   check(document.body.textContent.includes('no line for Mira yet — start its lines with “Mira:”'),'a second speaker with no line is said plainly');
   check(document.body.textContent.includes('two speakers: start each line with Kai: or Mira:'),'the test line teaches the grammar');
   queued=undefined;btn('＋ Queue').click();await tick();check(queued===undefined,'… and nothing is queued');
   await type(document.querySelectorAll('textarea')[1],'Kai: Take this away.\\nMira (dryly): No.');await new Promise(r=>setTimeout(r,650));
   check(!document.body.textContent.includes('no line for Mira'),'a line for her lifts the block');
   check(savedRecipe.options.voice2==='clip:mira'&&savedRecipe.testLine.includes('Mira (dryly): No.'),'the pick and the dialogue are saved with the voice: '+JSON.stringify(savedRecipe.options));
   btn('＋ Queue').click();await tick();check(queued&&queued.payload.engine==='gemini-38-tts','the two-speaker take queues');
   await open({options:{voice2:'Kore',voice2Name:'Kore'},testLine:'Hello.'},'Kore');
   check(document.body.textContent.includes('the two speakers are both called “Kore”'),'two speakers with one name are refused with the reason');
   // copying a sample: Google's statement, the consent clip, and what happens next
   await open({desc:undefined});
   check(document.querySelector('[data-consent]').textContent==='“I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.”','the statement the speaker reads is on the card');
   check(document.body.textContent.includes('✕ describe the voice, pick a ready voice, or add a sample with its consent clip'),'no description, no sample: the three ways are named');
   await pickOpt('[title="the language the speaker reads the statement in"]','Japanese');
   check(document.querySelector('[data-consent]').textContent.startsWith('“私はこの音声の所有者であり'),'the statement follows the language');await new Promise(r=>setTimeout(r,650));
   await open({desc:undefined,refAudioId:'s1'});
   check(document.body.textContent.includes('clone sample (needs the consent clip)')&&document.body.textContent.includes('✕ describe the voice'),'a sample alone copies nothing');
   await open({desc:undefined,refAudioId:'s1',consentAudioId:'c1'});
   check(document.body.textContent.includes('clone sample (optional)')&&document.body.textContent.includes('the next take copies the sample’s voice and saves it in your Google project'),'sample + consent = the next take copies the voice');
   check(!document.body.textContent.includes('✕ describe the voice'),'… and no description is needed');
   await open({desc:undefined,refAudioId:'s1',consentAudioId:'c1',options:{voice:'Kore'}});
   check(document.body.textContent.includes('a voice is already picked or kept'),'a picked voice wins over the copy, and the card says so');
   useStore.setState({project:{...project,voiceClips:[voice]}});await tick();
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
   root.unmount();return 'VIA, supplier billing, fixed route, queue label and provider changes; Gemini 3.8 (30 voices, style, key gate, the library search, a second speaker and its line grammar, the consent statement and clip) and Eleven v4 (account voices, kept voice)';
  }
 `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
 fs.writeFileSync(path.join(tmp,'checks.js'),code)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',windowsHide:true,timeout:60000})
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
