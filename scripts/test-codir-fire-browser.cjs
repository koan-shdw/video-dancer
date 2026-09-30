// list 27 (2026-09-30) — the render switch, and the Co-Director pressing a panel's OWN render
// button. The real Co-Director panel, Clip Gen and Image Gen in offscreen Electron; the app's API
// is a mock, so nothing renders and nothing is spent. Main's two gates (the switch, his go) are
// tested in test-codir-fire.cjs — this is the window's half: the button that flips the switch, and
// what gets queued when main says "press".
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-fire-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {ImageGenPanel} from '${ui}/panels/ImageGen';
    import {CoDirectorPanel} from '${ui}/panels/CoDirector';
    import {listenForFire} from '${ui}/lib/codirFire';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const settings={},replies=[],gens=[],saves=[];let ask=null;
      const api={projectRecents:async()=>[],getSettings:async()=>({...settings}),setSettings:async p=>{Object.assign(settings,p);return true},
        modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({}),codirModels:async()=>[{id:'m',label:'Model'}],codirBridgeModels:async()=>[],codirVeniceModels:async()=>[],
        imageGenStatus:async()=>({engine:true,essentials:true,pack:true,official:['krea-2-quality'],civit:[]}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],moodList:async()=>[],
        imageGenRender:async a=>{gens.push(a);return{ok:true,takeIds:[]}},imageGenSet:async(id,patch)=>{saves.push([id,patch]);return null},
        onCodirFire:cb=>{ask=cb;return()=>{}},codirFireDone:async(reqId,r)=>{replies.push([reqId,r])}};
      const unknown=new Set();window.__unknown=unknown;setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:(unknown.add(String(k)),async()=>null)}));
      const pd=(freeform)=>({engine:'seedance2',mode:'t2v',freeform,scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'5',resolution:'720p',aspectRatio:'16:9',generateAudio:true});
      const clip=(id,name,freeform)=>({id,name,promptData:pd(freeform),takes:[]});
      const gen=(id,name,prompt)=>({id,name,takes:[],recipe:{prompt,model:'krea-2-quality',aspect:'1:1',megapixels:1,batch:2,seed:0,refOn:false,refBoost:2.1,refBoostB:1,loraOn:false,loras:[],unleashedOn:false,unleashedWeight:1}});
      const project={dir:'synthetic',name:'Test',clips:[clip('a','Alley','A-TEXT a man walks down a wet alley at night'),clip('b','Rooftop','B-TEXT a woman stands on a rooftop at dawn'),clip('c','Empty','')],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[gen('g1','Poster','a neon poster'),gen('g2','Blank','')],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],codir:{log:[],brief:''}};
      const jobs=[];
      useStore.setState({project,selectedClipId:'a',enqueueRender:j=>{jobs.push(j)}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',width:1500,height:1400}}><div style={{width:340}}><CoDirectorPanel/></div><div style={{width:600}}><RenderPanel/></div><div style={{width:560}}><ImageGenPanel/></div></div>);
      const off=listenForFire();await tick(600);unknown.clear();
      check(typeof ask==='function','the window listens for main’s fire requests');

      // ---- the switch: off until he turns it on, and it is saved ----
      const sw=()=>document.querySelector('[role=switch]');
      check(sw()&&sw().textContent.trim()==='renders off','the Co-Director panel shows the switch, off: '+(sw()&&sw().textContent));
      check(sw().getAttribute('aria-checked')==='false'&&/^OFF:/.test(sw().title),'off says what off means');
      sw().click();await tick();
      check(settings.codirFire===true,'a click switches it on and saves it');
      check(sw().textContent.trim()==='renders on'&&sw().getAttribute('aria-checked')==='true'&&/single word go/.test(sw().title),'on says the go rule: '+sw().title.slice(0,40));
      sw().click();await tick();
      check(settings.codirFire===false&&sw().textContent.trim()==='renders off','a second click switches it off again');

      // ---- main says press: a clip that is NOT the open one. It opens, loads, and its own text is what queues ----
      const press=async(reqId,kind,id)=>{ask({reqId,kind,id});for(let i=0;i<60&&!replies.some(r=>r[0]===reqId);i++)await tick(50);const r=replies.find(x=>x[0]===reqId);check(r,'the panel answered '+reqId+' (unanswered app calls: '+[...unknown].join(',')+')');return r[1]};
      const rb=await press('r1','clip','b');
      check(rb.ok===true&&/^queued → watch the Queue panel · /.test(rb.line),'the clip queued: '+JSON.stringify(rb));
      check(useStore.getState().selectedClipId==='b','the clip opened in Clip Gen, as a click on it would');
      check(jobs.length===1&&jobs[0].kind==='gen'&&jobs[0].payload.clipId==='b'&&jobs[0].label==='Rooftop','one job, for that clip: '+JSON.stringify(jobs.map(j=>[j.kind,j.label,j.payload.clipId])));
      check(jobs[0].payload.prompt.includes('B-TEXT')&&!jobs[0].payload.prompt.includes('A-TEXT'),'it sends THAT clip’s prompt, never the one that was open: '+jobs[0].payload.prompt.slice(0,60));
      // the open clip fires without a reload
      const rb2=await press('r2','clip','b');
      check(rb2.ok===true&&jobs.length===2&&jobs[1].payload.clipId==='b','the open clip fires again');
      // a clip the form refuses: the panel's own words come back, nothing queues
      const rc=await press('r3','clip','c');
      check(rc.ok===false&&/^fix first: /.test(rc.line)&&jobs.length===2,'a clip that fails the form’s check is not queued: '+JSON.stringify(rc));

      // ---- an image gen job: the same, through Image Gen's own queue button ----
      const rg=await press('r4','image_gen','g1');
      check(rg.ok===true&&rg.line==='queued in Image Gen · 2 images on this GPU','the image gen queued: '+JSON.stringify(rg));
      await tick(200);
      check(gens.length===1&&gens[0].imageGenId==='g1','Image Gen rendered that job: '+JSON.stringify(gens));
      check(!saves.some(s=>s[0]==='g1'),'and its prompt was not overwritten by the box');
      const rg2=await press('r5','image_gen','g2');
      check(rg2.ok===false&&rg2.line==='write a prompt first'&&gens.length===1,'a job with no prompt is refused in the panel’s words: '+JSON.stringify(rg2));
      // ---- a render whose recipe came with the request (a score, a voice, an image edit, a video edit): it joins the Queue as sent ----
      const before=jobs.length;ask({reqId:'r6',kind:'job',job:{kind:'voice',label:'Kai',engineLabel:'Gemini 3.8 Flash TTS · via Google',payload:{voiceClipId:'v1',engine:'gemini-38-tts'}}});
      for(let i=0;i<40&&!replies.some(r=>r[0]==='r6');i++)await tick(50);
      const rj=replies.find(x=>x[0]==='r6');
      check(rj&&rj[1].ok===true&&rj[1].line==='queued → watch the Queue panel','the job request is answered: '+JSON.stringify(rj));
      check(jobs.length===before+1&&jobs.at(-1).kind==='voice'&&jobs.at(-1).label==='Kai'&&jobs.at(-1).payload.voiceClipId==='v1','and the job is in the Queue exactly as main built it: '+JSON.stringify(jobs.at(-1)));
      check(!errors.length,'no errors: '+errors.join(' | '));
      off();root.unmount();
      return 'the render switch: off by default, a click flips and saves it, the tooltip states the go rule; a fire request opens that clip in Clip Gen and queues ITS prompt through the panel’s own button; a clip the form refuses is not queued; an image gen job runs through Image Gen’s own queue, a promptless one is refused; a job that carries its own recipe joins the Queue as sent';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 90000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1600, height: 1500, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
