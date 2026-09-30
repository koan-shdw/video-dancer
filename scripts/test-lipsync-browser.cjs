// list 23 (2026-09-30) — lip-sync in the Video Editor: the two re-timing doors are engine rows, the
// composer asks for the voice (a Bin voice or a Library track) instead of words, sync-3 has the
// mismatch rule and VEED greys it, the price follows the video's length, and a timeline block opened
// "to lip-sync" arrives with its sound and windows set. The real panel in an offscreen Electron
// window; the render is caught before it leaves the page.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-lipsync-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditorPanel} from '${ui}/panels/VideoEditor';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api';
    const tick=(ms=60)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const lab=e=>e.textContent.replace('✓','').replace('▾','').trim();
    const dial=name=>{const l=[...document.querySelectorAll('.lb')].find(e=>e.textContent.trim()===name);check(l,'dial '+name);return l.nextElementSibling};
    const shown=name=>[...dial(name).querySelectorAll('span')].filter(s=>s.style.gridArea&&s.style.visibility!=='hidden').map(s=>s.textContent.trim())[0];
    const open=async name=>{dial(name).click();await tick();return [...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px')};
    const close=async()=>{document.querySelector('div[style*="inset: 0"]')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick()};
    const pick=async(name,label)=>{const els=await open(name);const el=els.find(e=>lab(e)===label);check(el,'option '+label+' in '+name+': '+els.map(lab).join(','));el.click();await tick()};
    export async function run(){
      setVidancerApi(new Proxy({},{get:(t,k)=>typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const jobs=[];
      const voice={id:'kai',name:'Kai',recipe:{engine:'gemini-38-tts'},takes:[{id:'vt',file:'kai.wav',createdAt:1,durationSec:6.5}],keeperTakeId:'vt'};
      const silent={id:'mute',name:'No take yet',recipe:{engine:'gemini-38-tts'},takes:[]};
      const clip={id:'c',name:'Alley',promptData:{},takes:[{id:'t',file:'t.mp4',createdAt:1,durationSec:8}]};
      const project={dir:'synthetic',name:'T',images:[],clips:[clip],videos:[{id:'v',title:'@vid',file:'v.mp4',durationSec:8}],audio:[{id:'a1',title:'line 04',file:'l.wav',durationSec:12}],voiceClips:[voice,silent],styles:[],timelines:[],folders:[],editSessions:[],videoEditSessions:[]};
      useStore.setState({project,editorVideoRoot:{videoId:'v'},renderNow:j=>{jobs.push(j)}});
      const root=createRoot(document.getElementById('root'));root.render(<div style={{width:900,height:1400}}><VideoEditorPanel/></div>);await tick(300);
      const go=()=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Generate now')).click();
      const engines=(await open('engine')).map(lab);await close();
      check(engines.includes('sync-3 — lip-sync')&&engines.includes('VEED Lipsync v2 — lip-sync'),'the two doors are engine rows: '+engines.join(' | '));
      check(!document.querySelector('[data-lipsync]'),'a true edit shows no voice row');

      // ---- sync-3: the voice instead of words ----
      await pick('engine','sync-3 — lip-sync');
      check(!!document.querySelector('[data-lipsync]'),'lip-sync shows the voice row');
      check(document.querySelector('textarea').disabled&&[...document.querySelectorAll('.lb')].some(e=>e.textContent.trim()==='instruction · not sent'),'the words box is greyed: nothing is sent');
      check(document.body.textContent.includes('✕ pick the voice the mouths follow'),'no voice: said on the panel');
      go();await tick(150);check(jobs.length===0,'… and nothing is queued');
      const voices=(await open('voice')).map(lab);await close();
      check(JSON.stringify(voices)==='["pick the voice…","🎤 Kai","♪ line 04 · 12.0s"]','the voice list = Bin voices that have a take, then Library tracks: '+JSON.stringify(voices));
      await pick('voice','🎤 Kai');
      check(document.body.textContent.includes('the video is 8.0s, the voice 6.5s'),'a length mismatch is said plainly');
      check(shown('when lengths differ')==='cut off — the video’s length wins','sync-3 starts on its default rule: '+shown('when lengths differ'));
      await pick('when lengths differ','silence — keep the whole video');
      go();await tick(150);
      let x=jobs.at(-1);
      check(jobs.length===1&&x.kind==='vedit'&&x.label.endsWith('· lip-sync')&&x.engineLabel==='sync-3','a lip-sync job: '+JSON.stringify([x&&x.label,x&&x.engineLabel]));
      check(x.payload.engine==='sync3'&&JSON.stringify(x.payload.lipAudio)==='{"voiceId":"kai"}'&&x.payload.syncMode==='silence'&&x.payload.prompt==='lip-sync to Kai','it carries the voice and the rule, and names its node: '+JSON.stringify(x.payload));
      check(Math.abs(x.estCost-8*8/60)<1e-9,'8 s at $8 a minute: '+x.estCost);
      check(!('resolution' in x.payload)&&!('imageRefIds' in x.payload),'no dials, no refs');

      // ---- VEED: no rule to pick ----
      await pick('engine','VEED Lipsync v2 — lip-sync');
      check((await open('when lengths differ')).length===0,'VEED greys the rule: it has none');
      await pick('voice','♪ line 04 · 12.0s');
      const from=document.querySelector('[data-lipsync] input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(from,'2.5');from.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      go();await tick(150);
      x=jobs.at(-1);
      check(x.payload.engine==='veedlipsync'&&!('syncMode' in x.payload)&&JSON.stringify(x.payload.lipAudio)==='{"audioId":"a1","inSec":2.5}','VEED: the track with its start, no rule: '+JSON.stringify(x.payload));
      check(Math.abs(x.estCost-8*0.07)<1e-9,'8 s at $0.07 a second: '+x.estCost);

      // ---- opened from the timeline "to lip-sync": the sound and the windows arrive set ----
      useStore.setState({editorVideoRoot:{takeRef:{clipId:'c',takeId:'t'},inSec:1,outSec:5,lip:{audioId:'a1',inSec:3,outSec:7}}});await tick(250);
      check(shown('engine')==='VEED Lipsync v2 — lip-sync'||shown('engine')==='sync-3 — lip-sync','it stays on a lip-sync engine: '+shown('engine'));
      check(shown('voice')==='♪ line 04 · 12.0s','the sound under the block is picked: '+shown('voice'));
      go();await tick(150);
      x=jobs.at(-1);
      check(JSON.stringify(x.payload.root)==='{"takeRef":{"clipId":"c","takeId":"t"}}'&&Math.abs(x.payload.inSec-1)<0.01&&Math.abs(x.payload.outSec-5)<0.01,'the block’s window is what is sent: '+JSON.stringify([x.payload.root,x.payload.inSec,x.payload.outSec]));
      check(JSON.stringify(x.payload.lipAudio)==='{"audioId":"a1","inSec":3,"outSec":7}','with the stretch of sound that lies under it: '+JSON.stringify(x.payload.lipAudio));
      // from a true-edit engine, the same door switches to sync-3
      await pick('engine','Gemini Omni Flash 1.1 — true edit');
      useStore.setState({editorVideoRoot:{takeRef:{clipId:'c',takeId:'t'},inSec:0,outSec:4,lip:{audioId:'a1'}}});await tick(250);
      check(shown('engine')==='sync-3 — lip-sync','opened to lip-sync from another engine = sync-3: '+shown('engine'));
      // a true edit still wants words and sends none of this
      await pick('engine','Gemini Omni Flash 1.1 — true edit');
      check(!document.querySelector('textarea').disabled,'a true edit takes words again');
      root.unmount();return 'lip-sync in the Video Editor: sync-3 and VEED are engine rows; the voice (Bin voices with a take, Library tracks) replaces the words; sync-3 carries its mismatch rule, VEED greys it; priced by the video’s seconds; opened from a timeline block it arrives on a lip-sync engine with the sound and both windows set';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1500, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
