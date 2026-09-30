// list 22 (2026-09-30) — the SFX card: sound effects in their own card beside Score and Voice. A
// sound-fx clip is a score clip of kind 'sfx'; one setter points either card at the right clip.
// From the footage (Sonilo) it needs a span on the timeline; from words (ElevenLabs) it needs the
// words. The real card in offscreen Electron; the app's API is a mock and the queue is caught, so
// nothing renders and nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sfx-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SfxCardPanel} from '${ui}/panels/SfxCard'; import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api';
    import {setScoreCardOpener,setSfxCardOpener,openScoreCard} from '${ui}/panelBus';
    const tick=(ms=70)=>new Promise(r=>setTimeout(r,ms));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const type=async(el,v)=>{Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));await tick()};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      let settings={falKey:'masked'};const made=[],queued=[];let raised=[];
      setVidancerApi(new Proxy({getSettings:async()=>settings},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      setScoreCardOpener(()=>raised.push('score'));setSfxCardOpener(()=>raised.push('sfx'));
      const music={id:'music',name:'Theme',beats:[],recipe:{engine:'minimax-music-3'},takes:[]};
      const fx={id:'fx',kind:'sfx',name:'Door',beats:[],recipe:{engine:'sonilo-sfx'},takes:[]};
      const tl={id:'tl',items:[],scoreItems:[]};
      const project={dir:'fixture',name:'Test',scoreClips:[music],images:[],clips:[],audio:[],timelines:[tl],activeTimelineId:'tl'};
      useStore.setState({project,enqueueRender:j=>queued.push(j),renderNow:j=>queued.push(j),saveScoreClip:async()=>{},createScoreClip:async(name,kind)=>{made.push([name,kind]);return null}});
      const root=createRoot(document.getElementById('root'));root.render(<SfxCardPanel/>);await tick();await tick();
      const button=text=>[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim().startsWith(text));

      // ---- no sound yet: the card makes one ----
      check(document.body.textContent.includes('no sound open — make one here'),'the empty card says what to do');
      button('＋ new sound fx').click();await tick();
      check(JSON.stringify(made)==='[[null,"sfx"]]'||JSON.stringify(made)==='[[undefined,"sfx"]]'||(made.length===1&&made[0][1]==='sfx'),'＋ new sound fx makes a clip of kind sfx: '+JSON.stringify(made));

      // ---- one setter, two cards: a sound fx lands in the SFX card, a score in Score ----
      useStore.setState({project:{...project,scoreClips:[music,fx]}});await tick();
      useStore.getState().setEditorScore('fx');openScoreCard();
      check(useStore.getState().editorSfxId==='fx'&&useStore.getState().editorScoreId===null,'a sound fx is the SFX card’s target, not Score’s');
      useStore.getState().setEditorScore('music');openScoreCard();
      check(useStore.getState().editorScoreId==='music'&&useStore.getState().editorSfxId==='fx','a score is Score’s target; the SFX card keeps its own');
      check(JSON.stringify(raised)==='["sfx","score"]','each raises its own card: '+JSON.stringify(raised));
      await tick();await tick();

      // ---- from the footage: it needs a span on the timeline ----
      check(document.querySelector('input[placeholder="sound name"]').value==='Door','the sound fx is open in the card');
      document.querySelector('div[tabindex="0"]').click();await tick();
      const models=[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px').map(e=>e.textContent.replace('✓','').trim());
      check(JSON.stringify(models)==='["Sonilo v1.1 (from the footage)","ElevenLabs Sound Effects (from words)"]','the model list is the two sound engines, no music: '+JSON.stringify(models));
      document.querySelector('div[style*="inset: 0"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick();
      check(document.body.textContent.includes('✕ drag this sound from the Bin onto a score track'),'no span: the reason is on the card');
      button('＋ Queue').click();await tick();check(queued.length===0,'… and nothing is queued');
      useStore.setState({project:{...project,scoreClips:[music,fx],timelines:[{...tl,scoreItems:[{id:'span',scoreClipId:'fx',startSec:2,spanSec:8,lane:1}]}]}});await tick();await tick();
      check(!document.body.textContent.includes('✕ drag this sound'),'a span lifts the block');
      await type(document.querySelector('textarea'),'dry, close');
      button('moment').click();await tick();
      await type(document.querySelector('input[placeholder^="a door slams"]'),'a door slams');
      button('＋ Queue').click();await tick();
      let j=queued.at(-1);
      check(queued.length===1&&j.kind==='score'&&j.engineLabel==='Sonilo v1.1 (from the footage) · via fal','the sound queues as a score job on fal: '+(j&&j.engineLabel));
      check(j.payload.engine==='sonilo-sfx'&&j.payload.scoreClipId==='fx'&&j.payload.snapshot.recipe.options.styleText==='dry, close'&&j.payload.snapshot.beats[0].text==='a door slams','it carries the words and the moment: '+JSON.stringify(j.payload.snapshot));
      [...document.querySelectorAll('div')].find(e=>e.textContent.includes('generated from fields')&&e.style.cursor==='pointer').click();await tick();
      check(document.body.textContent.includes('"prompt": "a door slams"')&&document.body.textContent.includes('(the rendered span video uploads here)'),'the proof block shows what is sent');
      check([...document.querySelectorAll('input[type=number]')].find(e=>e.placeholder==='auto').disabled,'the length dial is greyed: the footage is the length');

      // ---- from words: no span needed, the words are ----
      document.querySelector('div[tabindex="0"]').click();await tick();
      [...document.querySelectorAll('div')].find(e=>e.style.padding==='6px 10px'&&e.textContent.trim()==='ElevenLabs Sound Effects (from words)').click();await tick();await tick();
      check(document.body.textContent.includes('✕ Add your ElevenLabs API key in Settings first.'),'no ElevenLabs key: said before the click');
      settings={...settings,elevenKey:'masked'};useStore.setState(s=>({settingsRev:s.settingsRev+1}));await tick();await tick();
      check(!document.body.textContent.includes('Add your ElevenLabs API key'),'the key arrives: the gate lifts');
      check(document.body.textContent.includes('moments · not sent'),'moments are not sent to a words engine, and it says so');
      await type(document.querySelector('textarea'),'');
      check(document.body.textContent.includes('✕ write what the sound is'),'words engine, no words: the reason');
      await type(document.querySelector('textarea'),'a heavy door slams');
      const len=[...document.querySelectorAll('input[type=number]')].find(e=>e.placeholder==='auto');check(!len.disabled,'the length dial is live');
      await type(len,'3');
      useStore.setState({project:{...project,scoreClips:[music,fx]}});
      button('＋ Queue').click();await tick();
      j=queued.at(-1);
      check(queued.length===2&&j.engineLabel==='ElevenLabs Sound Effects (from words) · via ElevenLabs'&&j.payload.engine==='eleven-sfx','the sound queues on ElevenLabs with no span: '+(j&&j.engineLabel));
      check(j.payload.snapshot.recipe.options.styleText==='a heavy door slams'&&j.payload.snapshot.recipe.options.sfxSec===3,'with its words and length: '+JSON.stringify(j.payload.snapshot.recipe.options));
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();setScoreCardOpener(null);setSfxCardOpener(null);
      return 'the SFX card: makes a sound-fx clip; one setter sends a sound fx to the SFX card and a score to Score; from the footage it needs a span, carries words and moments, shows what is sent; from words it needs the words and the ElevenLabs key, length and loop dials live';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="height:100vh"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 760, height: 1200, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
