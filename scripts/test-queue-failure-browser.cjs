// list 47 (2026-09-30) — the queue row of a failed render shows one plain line; the supplier's full
// reply rides the row's tooltip, goes to the log, and lands in the project's failure list. The real
// store and the real Queue panel in offscreen Electron; the app's API is a mock, nothing renders.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-queue-failure-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueuePanel} from '${ui}/panels/Queue';
    import {Toasts} from '${ui}/ui/Toast';
    import {KeyWizard} from '${ui}/ui/KeyWizard';
    import {useStore} from '${ui}/store';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const ARK='error (404) @ modelark/submit: {"error":{"code":"ModelNotOpen","message":"Your account 2100000000 has not activated the model dreamina-seedance-2-5-260628. Please activate the model service in the Ark Console. Request id: 021727"}} :: sent fields: model, content';
    const PLAIN="Seedance 2.5 isn't switched on for this ModelArk account. Activate it in the Ark Console.";
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const failures=[],logs=[],saves=[];let answer={ok:false,error:ARK},sends=0,loads=0;
      setVidancerApi(new Proxy({render:async()=>(sends++,answer),projectOpenPath:async d=>({dir:d,name:d,images:[],clips:[]}),queueLoad:async()=>(loads++,[{kind:'gen',label:'Old',engineLabel:'x',payload:{clipId:'Old'}}]),spendList:async()=>({total:0,entries:[]}),failureAdd:async f=>{failures.push(f);return true},logRenderer:async m=>{logs.push(m)},queueSave:async(d,rows)=>(saves.push([d,rows.map(r=>r.label)]),true),getRecoveryStatus:async()=>null},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      useStore.setState({project:{dir:'synthetic',name:'P',images:[],clips:[]},refreshSpend:async()=>{},refreshCredit:async()=>{},addSpend:async()=>{}});
      createRoot(document.getElementById('root')).render(<><QueuePanel/><Toasts/><KeyWizard/></>);await tick(200);
      const go=async(label)=>{useStore.getState().enqueueRender({kind:'gen',label,engineLabel:'Seedance 2.5 (ModelArk)',payload:{clipId:label}});await tick(400);return useStore.getState().queue.find(j=>j.label===label)};
      const row=await go('Rooftop');
      check(row.status==='error','the job ends as an error row: '+row.status);
      check(row.error===PLAIN,'the row holds one plain line: '+row.error);
      check(row.errorRaw===ARK,'and keeps the supplier’s full reply beside it');
      const line=[...document.querySelectorAll('div')].find(d=>d.childElementCount===0&&d.textContent===PLAIN)||[...document.querySelectorAll('div')].find(d=>d.textContent===PLAIN);
      check(line,'the Queue row shows the plain line');
      check(line.title===ARK,'its tooltip is the full reply: '+line.title.slice(0,60));
      check(!document.body.textContent.includes('ModelNotOpen'),'no raw code on screen');
      check(JSON.stringify(failures)===JSON.stringify([{label:'Rooftop',kind:'gen',engine:'Seedance 2.5 (ModelArk)',plain:PLAIN,raw:ARK}]),'the failure lands in the project’s list: '+JSON.stringify(failures).slice(0,160));
      check(logs.includes('[render failed] Rooftop · Seedance 2.5 (ModelArk): '+ARK),'and the full reply is in the log');
      check(document.body.textContent.includes('Rooftop: failed — '+PLAIN),'the toast says the same plain line');
      // a missing key keeps its own words on the row, and opens that supplier's key steps
      answer={ok:false,error:'No ModelArk key saved — paste your BytePlus ModelArk API key in Settings first.'};
      const nokey=await go('Alley');
      check(nokey.error==='No ModelArk key saved — paste your BytePlus ModelArk API key in Settings first.','a missing key stays in its own words: '+nokey.error);
      check(document.querySelector('[role=dialog]')?.textContent.startsWith('BytePlus ModelArk key needed'),'and its key steps open');
      // a cancelled job is not a failure
      check(failures.length===2&&failures[1].label==='Alley','one record per failed job');
      // audit 2026-10-09 H4: a NOW job the supplier took, whose status checks then hit 503s, is sent once
      const BUSY='error (503) @ modelark/tasks/t-1: service unavailable';
      sends=0;answer={ok:false,error:BUSY,accepted:true};
      useStore.getState().renderNow({kind:'gen',label:'Taken',engineLabel:'Seedance 2.5 (ModelArk)',payload:{clipId:'Taken'}});await tick(600);
      const taken=useStore.getState().queue.find(j=>j.label==='Taken');
      check(sends===1,'a job the supplier took is sent once: '+sends);
      check(taken.status==='error'&&!taken.autoQueued,'and never moved back to the queue: '+taken.status);
      check(/is not sent again/.test(taken.error)&&!/Run it again/.test(taken.error),'its row says it is not sent again: '+taken.error);
      // a busy refusal at submit (nothing taken) still moves to the queue once, as before
      sends=0;answer={ok:false,error:BUSY};
      useStore.getState().renderNow({kind:'gen',label:'Refused',engineLabel:'Seedance 2.5 (ModelArk)',payload:{clipId:'Refused'}});await tick(600);
      check(useStore.getState().queue.find(j=>j.label==='Refused').autoQueued===true,'a refusal at submit still goes to the queue once');
      // H9: last session's rows are offered once per project per session; A, B, back to A = no second offer
      answer={ok:true};
      await useStore.getState().openPath('A');await tick(100);await useStore.getState().openPath('B');await tick(100);await useStore.getState().openPath('A');await tick(100);
      check(loads===2,'A and B are each offered once, A again is not: '+loads);
      // H9 + M14: each project's rows go to its own queue file, named by the window; a cancel while
      // another project is open clears the row from its own file
      useStore.setState({queuePaused:true});
      useStore.getState().enqueueRender({kind:'gen',label:'A1',engineLabel:'x',payload:{clipId:'A1'}});await tick(50);
      useStore.setState(s=>({queue:s.queue.map(j=>j.label==='A1'?{...j,projectDir:'A'}:j)}));
      await useStore.getState().openPath('B');saves.length=0;
      useStore.getState().cancelJob(useStore.getState().queue.find(j=>j.label==='A1').id);await tick(700);
      const toA=saves.filter(x=>x[0]==='A').at(-1);
      check(toA&&!toA[1].includes('A1'),'the cancel reaches A’s own file: '+JSON.stringify(saves));
      check(!saves.some(x=>x[0]==='B'&&x[1].includes('A1')),'A’s row is never written into B');
      useStore.setState({queuePaused:false});
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'queue: a failed render shows one plain line, its tooltip the supplier’s full reply; the failure is logged and kept in the project; a missing key opens its key steps; a job the supplier took is never sent twice; last session’s rows are offered once per project; each project’s rows go to its own file';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 700, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
