// Real Score card and React events, with isolated settings/project/queue fixtures.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-score-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ScoreCardPanel} from '${ui}/panels/ScoreCard'; import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api';
    import {setModelsCardOpener} from '${ui}/panelBus'; import {modelWizard} from '${ui}/lib/modelWizard';
    const tick=()=>new Promise(r=>setTimeout(r,60));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    export async function run(){
      let queued=[],composed=[],saved=false,finishSave;let settings={anthropicKey:'masked'};
      let modelStatus='ready',raised=0,diskChecks=0;setModelsCardOpener(()=>raised++);
      setVidancerApi({getSettings:async()=>settings,modelsList:async()=>({rows:[{id:'ace-step-1.5',status:modelStatus,weightsBytes:2**34}]}),modelsDiskFree:async()=>{diskChecks++;return 2**40},onModelsDone:()=>()=>{}});
      const score={id:'score',name:'Fixture score',beats:[{id:'beat',at:0,text:'Strings'}],recipe:{engine:'minimax-music-3',options:{durationSec:60,styleText:'Original style'}},takes:[]};
      const tl={id:'timeline',items:[],scoreItems:[{id:'first',scoreClipId:'score',startSec:0,spanSec:10},{id:'chosen',scoreClipId:'score',startSec:12,spanSec:20}]};
      const project={dir:'fixture',name:'Test',scoreClips:[score],images:[],clips:[],audio:[],timelines:[tl],activeTimelineId:tl.id};
      useStore.setState({project,editorScoreId:'score',selectedScoreItemId:'chosen',enqueueRender:job=>queued.push(job),renderNow:job=>queued.push(job),saveScoreClip:async()=>{await new Promise(r=>finishSave=r);saved=true},composeScore:async(id,opts)=>{check(saved,'compose waits for the edited fields to save');composed.push({id,opts})}});
      const root=createRoot(document.getElementById('root'));root.render(<ScoreCardPanel/>);await tick();await tick();
      const button=text=>[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===text);
      check(document.body.textContent.includes('Add your fal API key'),'missing-key reason');button('＋ Queue').click();check(queued.length===0,'missing key blocks generation');
      settings={...settings,falKey:'masked',elevenKey:'masked'};useStore.setState({settingsRev:1});await tick();
      check(!!document.querySelector('[title="Uses your fal API key and fal credits."]'),'VIA fal displayed');
      const prompt=document.querySelector('textarea[placeholder^="e.g. sparse"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(prompt,'NEW STYLE');prompt.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      button('＋ Queue').click();check(queued.length===1,'queue click');check(queued[0].engineLabel.endsWith('via fal'),'supplier in queue');check(queued[0].payload.snapshot.recipe.options.styleText==='NEW STYLE','immediate click queues current draft');check(queued[0].payload.scoreItemId==='chosen'&&queued[0].payload.timelineId==='timeline','chosen span captured');finishSave();await tick();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(prompt,'COMPOSE STYLE');prompt.dispatchEvent(new Event('input',{bubbles:true}));await tick();saved=false;
      button('✨ compose').click();await tick();check(composed.length===0,'compose waits');finishSave();await tick();check(composed[0].opts.scoreItemId==='chosen','compose uses selected span');
      // audit 2026-10-09 M38: the length clamps when he is DONE typing — typing 30 gave 50 (3 → min 5, then 0)
      const len=[...document.querySelectorAll('input[type=number]')].find(el=>!el.disabled&&el.min==='5');const setLen=v=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(len,v);len.dispatchEvent(new Event('input',{bubbles:true}))};
      setLen('3');await tick();setLen('30');await tick();len.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
      check(len.value==='30','typing 30 leaves 30: '+len.value);finishSave&&finishSave();await tick();
      queued.length=0;button('＋ Queue').click();check(queued[0].payload.snapshot.recipe.options.durationSec===30,'and 30 s is what renders: '+queued[0].payload.snapshot.recipe.options.durationSec);finishSave&&finishSave();await tick();
      await window.captureScore();
      useStore.setState({project:{...project,scoreClips:[{...score,recipe:{engine:'eleven-music-v2',options:{durationSec:60,isInstrumental:false}}}]}});await tick();await tick();
      check(document.body.textContent.includes('Uses your ElevenLabs API key'),'ElevenLabs billing');check([...document.querySelectorAll('textarea')].some(el=>!el.disabled&&el.placeholder.startsWith('[verse]')),'ElevenLabs lyrics available');
      // list 24: a music ref. Greyed with the reason on an engine that takes none; on ElevenLabs Music: pick a Library track, one strength dial
      const mref=()=>document.querySelector('[data-musicref]');
      check(mref().style.opacity==='1'&&mref().textContent.includes('＋ a track'),'ElevenLabs Music takes a track: the box is live');
      mref().querySelector('.vd-slot').click();await tick();check(!mref().textContent.includes('♪ theme'),'no Library audio: the click opens the Library, nothing to list');
      const elevenScore={...score,recipe:{engine:'eleven-music-v2',options:{durationSec:60,isInstrumental:false}}};
      useStore.setState({project:{...project,audio:[{id:'trk',title:'theme',file:'theme.mp3',durationSec:95}],scoreClips:[elevenScore]}});await tick();await tick();
      mref().querySelector('.vd-slot').click();await tick();
      [...mref().querySelectorAll('div')].find(e=>e.style.cursor==='pointer'&&e.textContent.includes('♪ theme')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick();
      check(mref().querySelector('.vd-slot').textContent.trim()==='♪ theme · 95s','the picked track shows on the box: '+mref().querySelector('.vd-slot').textContent);
      check(mref().textContent.includes('only the style ↔ keep the tune · 0.80'),'the dial starts on keep-the-tune: '+mref().textContent);
      const dialEl=mref().querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(dialEl,'0.3');dialEl.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      const qr=queued.length;button('＋ Queue').click();await tick();
      check(queued.length===qr+1&&queued.at(-1).payload.snapshot.recipe.musicRefId==='trk'&&queued.at(-1).payload.snapshot.recipe.options.musicRefStrength===0.3,'the queued score carries the track and the dial: '+JSON.stringify(queued.at(-1)?.payload.snapshot.recipe));
      [...document.querySelectorAll('div')].find(e=>e.textContent.includes('generated from fields')&&e.style.cursor==='pointer').click();await tick();
      check(document.body.textContent.includes('"condition_strength": "medium"')&&document.body.textContent.includes('(the reference track)'),'the proof block shows the ref in the plan');
      mref().querySelector('[title^="take the track off"]').click();await tick();
      check(mref().textContent.includes('＋ a track'),'✕ takes the track off');
      await new Promise(r=>setTimeout(r,650));
      useStore.setState({project:{...project,scoreClips:[{...score,recipe:{engine:'minimax-music-3',options:{durationSec:60}}}]}});await tick();await tick();
      check(mref().title==='off — ACE-Step or ElevenLabs Music only'&&mref().style.opacity==='0.4','greyed with the reason on MiniMax');
      useStore.setState({project:{...project,scoreClips:[elevenScore]}});await tick();await tick();
      // list 20: pictures the music follows. Greyed with the reason off Lyria; on Lyria: pick from the Library, ten at most
      const pics=()=>document.querySelector('[data-pictures]');
      check(pics().title==='off — Lyria only'&&pics().style.opacity==='0.4','the pictures strip is greyed with the reason on another engine');
      pics().querySelector('.vd-slot').click();await tick();check(!pics().querySelector('img'),'… and its ＋ does nothing there');
      const lib=[{id:'i1',title:'@sunset',file:'a.png'},{id:'i2',title:'@storm',file:'b.png'}];
      settings={...settings,googleKey:'masked'};
      useStore.setState({settingsRev:2,project:{...project,images:lib,scoreClips:[{...score,recipe:{engine:'lyria-35',options:{durationSec:60}}}]}});await tick();await tick();
      check(pics().textContent.includes('pictures · 0/10')&&pics().style.opacity==='1','Lyria: the strip is live, 0 of 10');
      pics().querySelector('.vd-slot').click();await tick();
      const rows=[...pics().querySelectorAll('div')].filter(e=>e.textContent.trim()==='@storm'||e.textContent.trim()==='@sunset');
      check(rows.length>=2,'＋ lists the Library pictures');
      [...pics().querySelectorAll('div')].find(e=>e.style.cursor==='pointer'&&e.textContent.trim()==='@storm').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick();
      check(pics().textContent.includes('pictures · 1/10')&&pics().querySelectorAll('img').length===1,'a pick lands as a thumbnail');
      const q0=queued.length;button('＋ Queue').click();await tick();
      check(queued.length===q0+1&&JSON.stringify(queued.at(-1).payload.snapshot.recipe.imageIds)==='["i2"]'&&queued.at(-1).engineLabel==='Lyria 3.5 · via Google','the queued score carries its pictures: '+JSON.stringify(queued.at(-1)?.payload.snapshot.recipe));
      pics().querySelector('[title="remove @storm"]').click();await tick();
      check(pics().textContent.includes('pictures · 0/10')&&!pics().querySelector('img'),'✕ takes a picture off');
      await new Promise(r=>setTimeout(r,650));
      const picker=document.querySelector('div[tabindex="0"]');picker.click();await tick();
      const ace=[...document.querySelectorAll('div')].find(el=>el.textContent.trim()==='ACE-Step 1.5 (local)'&&el.style.cursor==='pointer');check(!!ace,'ACE option');ace.click();await tick();await tick();
      check(raised===0&&!document.querySelector('[role="dialog"]'),'selecting installed model leaves Score in front');check(diskChecks===0,'ready model skips setup checks');
      check(document.body.textContent.includes('Runs on this computer.'),'local VIA');check(document.body.textContent.includes('free'),'installed local render available');
      modelStatus='downloading';await modelWizard('ace-step-1.5');check(raised===1,'running download still opens progress');
      modelStatus='none';const setup=modelWizard('ace-step-1.5');await tick();check(!!document.querySelector('[role="dialog"]'),'missing model offers setup');button('Cancel').click();check(await setup===false,'setup can be cancelled');check(raised===1,'cancelled setup does not steal focus');
      root.unmount();setModelsCardOpener(null);return 'VIA, key gate, frozen queue, span, compose save order, lyrics, a music ref (ElevenLabs / ACE-Step: a Library track, one dial, in the proof block), the pictures strip (Lyria only, from the Library, carried by the queued score); installed local selection stays in Score, downloading opens progress, missing offers setup';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); if (r.error) console.error(r.error); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  const preload = path.join(tmp, 'preload.js'); fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('captureScore',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 690, height: 900, webPreferences: { preload, sandbox: true, backgroundThrottling: false, offscreen: true } })
    ipcMain.handle('capture', async () => fs.writeFileSync(path.join(tmp, 'score.png'), (await win.webContents.capturePage()).toPNG()))
    await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    console.log('Screenshot: ' + path.join(tmp, 'score.png')); app.exit(0)
  } catch (e) { console.error(e); app.exit(1) } })
}
