// Audit 2026-10-09 batch 6: forms keep what you typed. The real Clip Gen in offscreen Electron with a
// mock app API: nothing renders, nothing is spent. The store's saves are recorded and echoed back the
// way main's deltas would land.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-forms-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      let sendGate=null;const sends=[];
      const api={projectRecents:async()=>[],getSettings:async()=>({}),setSettings:async()=>true,modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({}),moodList:async()=>[],spendList:async()=>({total:0,entries:[]}),
        codirSend:async(req)=>{sends.push(req);if(sendGate)await sendGate;return{ok:true}}};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const pd=(freeform,extra={})=>({engine:'seedance2',mode:'t2v',freeform,scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'5',resolution:'720p',aspectRatio:'16:9',generateAudio:true,...extra});
      const clip=(id,name,freeform,extra)=>({id,name,promptData:pd(freeform,extra),takes:[]});
      const beat={id:'b1',name:'a',length:3,camera:'close',action:'he turns',lighting:''};
      const project={dir:'synthetic',name:'Test',clips:[clip('a','Alley','A-TEXT',{beats:[beat]}),clip('b','Rooftop','B-TEXT'),clip('s','Seeded','S-TEXT',{seed:1234})],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],codir:{log:[],brief:''}};
      const saves=[];
      // a save lands in the store the way main's delta does
      const echo=(id,patch)=>useStore.setState(s=>({project:{...s.project,clips:s.project.clips.map(c=>c.id===id?{...c,promptData:{...c.promptData,...patch}}:c)}}));
      useStore.setState({project,selectedClipId:'a',saveClipPromptData:async(id,p)=>{saves.push([id,p]);echo(id,p)},enqueueRender:()=>{}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:640,height:1400}}><RenderPanel/></div>);await tick(600);
      const box=()=>document.querySelector('textarea[placeholder="your prompt — @ for refs"]');
      const type=(v)=>{const el=box();if(!el)throw Error('no prompt box when typing: '+v+' · selected '+useStore.getState().selectedClipId+' · errors: '+errors.join(' | ').slice(0,600));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      const val=()=>{const b=box();if(!b)throw Error('no prompt box · selected '+useStore.getState().selectedClipId+' · errors: '+errors.join(' | ').slice(0,400));return b.value};
      const savedFor=(id)=>saves.filter(x=>x[0]===id).map(x=>x[1]);
      check(box()&&val()==='A-TEXT','clip A is in the form');

      // ---- M3: a clip switch inside 600 ms sends the last edit, never drops it ----
      type('A-TEXT edited');await tick(30);
      useStore.getState().selectClip('b');await tick(200);
      check(savedFor('a').some(p=>p.freeform==='A-TEXT edited'),'the edit to A went out on the switch: '+JSON.stringify(saves.map(x=>[x[0],x[1].freeform])));
      check(val()==='B-TEXT','and B loaded');

      // ---- M3: a Co-Director write elsewhere never reloads over his typing; one to THIS clip's other field lands ----
      type('B typing');await tick(30);
      useStore.setState(s=>({undoTick:s.undoTick+1,project:{...s.project,clips:s.project.clips.map(c=>c.id==='a'?{...c,promptData:{...c.promptData,freeform:'CODIR WROTE A'}}:c)}}));await tick(60);
      check(val()==='B typing','a write to another clip leaves the typing alone: '+val());
      type('B typing more');await tick(30);
      useStore.setState(s=>({undoTick:s.undoTick+1,project:{...s.project,clips:s.project.clips.map(c=>c.id==='b'?{...c,promptData:{...c.promptData,negative:'no rain'}}:c)}}));await tick(60);
      check(val()==='B typing more','a write to another field of this clip leaves the typing alone too');
      await tick(800);
      const lastB=savedFor('b').at(-1);
      check(lastB&&lastB.freeform==='B typing more'&&lastB.negative==='no rain','the save carries his typing AND the outside write: '+JSON.stringify(lastB&&[lastB.freeform,lastB.negative]));
      // an undo that changes the field he typed in (no typing pending) still lands
      useStore.setState(s=>({undoTick:s.undoTick+1,project:{...s.project,clips:s.project.clips.map(c=>c.id==='b'?{...c,promptData:{...c.promptData,freeform:'UNDONE'}}:c)}}));await tick(100);
      check(val()==='UNDONE','an undo still reaches the form');

      // ---- M36: the clip keeps its seed ----
      useStore.getState().selectClip('s');await tick(200);
      type('S-TEXT edited');await tick(800);
      check(savedFor('s').at(-1)?.seed===1234,'the clip’s seed loads and is saved with it: '+JSON.stringify(savedFor('s').at(-1)?.seed));
      useStore.getState().selectClip('b');await tick(200);type('B again');await tick(800);
      check(savedFor('b').at(-1)?.seed===undefined,'another clip keeps its own (none): '+JSON.stringify(savedFor('b').at(-1)?.seed));

      // ---- H16 + M43: a new-clip render that lands keeps what he typed meanwhile, beats included ----
      useStore.getState().selectClip('a');await tick(200);
      useStore.getState().selectClip(null);await tick(100);
      type('NEXT TRY typed while it rendered');await tick(50);
      useStore.setState(s=>({project:{...s.project,clips:[...s.project.clips,clip('n','New render','THE RENDER-TIME TEXT')]},queue:[{id:'j1',kind:'gen',status:'done',label:'x',engineLabel:'x',resultClipId:'n',resultFile:'',payload:{},projectDir:'synthetic'}]}));
      await tick(200);
      check(useStore.getState().selectedClipId==='n','the new clip is selected');
      check(val()==='NEXT TRY typed while it rendered','and the form kept his typing: '+val());
      await tick(800);
      const n=savedFor('n').at(-1);
      check(n&&n.freeform==='NEXT TRY typed while it rendered','the new clip got it: '+JSON.stringify(n&&n.freeform));
      check(n&&Array.isArray(n.beats)&&n.beats.length===1&&n.beats[0].action==='he turns','with the beats too: '+JSON.stringify(n&&n.beats));

      // ---- L31: a project switch with nothing selected clears EVERY field ----
      useStore.getState().selectClip(null);await tick(50);
      useStore.setState(s=>({project:{...s.project,clips:s.project.clips.map(c=>c.id==='n'?c:c)},}));
      echo('n',{videoRefs:[{videoId:'v1'}],promptLink:{clipId:'a',pos:'before'}});
      useStore.getState().selectClip('n');await tick(200);useStore.getState().selectClip(null);await tick(100);
      useStore.setState({project:{...project,dir:'other',clips:[clip('z','Other','Z-TEXT')]},selectedClipId:null});await tick(200);
      check(!box(),'nothing is left in the form: Clip Gen shows its empty state');
      check(!document.body.textContent.includes('not in the Bin yet'),'no leftover refs or links keep a "not in the Bin yet" form');

      // ---- M40: a message typed while the Co-Director is busy goes with the clip it was typed on ----
      useStore.setState({project:{...project},selectedClipId:'a'});await tick(100);
      let release;sendGate=new Promise(r=>{release=r});
      const first=useStore.getState().codirSendText('first');await tick(20);
      useStore.getState().selectClip('a');await useStore.getState().codirSendText('make THIS darker');
      useStore.getState().selectClip('b');await tick(20);
      sendGate=null;release();await first;await tick(100);
      const darker=sends.find(x=>x.text.includes('make THIS darker'));
      check(darker&&darker.selectedClipId==='a','sent with the clip it was typed on: '+JSON.stringify(darker&&darker.selectedClipId));

      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();
      return 'forms: a clip switch sends the last edit; a Co-Director write never reloads over typing, an undo still lands; the seed is the clip’s; a new-clip render keeps the typed form and its beats; a project switch clears every field; a queued Co-Director message keeps its clip'
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
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
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8')) // the house button (amber)
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
