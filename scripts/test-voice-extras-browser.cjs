// list 44 (VOICE-EXTRAS-SPEC-2026-10-01) — voice slots in the real Clip Gen: linking a sheet bound to
// a voice adds a 🎤 slot tagged with the sheet, the role pill flips timbre ↔ dialogue (dialogue locks
// the length: 🔒 on the duration box, another length raises the ⚑), the prompt preview says each
// slot's role, "🎤 dialogue" queues a voice render of the beats' lines for that slot, unlinking the
// sheet takes the slot away, the ＋ box lists the Bin's voices, a Library track cycles ref → timbre →
// dialogue. Offscreen Electron, the app's API mocked, the queue caught: nothing renders.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-voice-extras-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {setVoicesCardOpener} from '${ui}/panelBus';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const durDial=()=>{const l=[...document.querySelectorAll('.lb')].find(e=>e.textContent.trim().startsWith('duration'));check(l,'the duration dial');return l};
    const shown=()=>[...durDial().nextElementSibling.querySelectorAll('span')].filter(s=>s.style.gridArea&&s.style.visibility!=='hidden').map(s=>s.textContent.trim())[0];
    const rows=()=>[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px');
    const btn=t=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes(t));
    const slot=i=>document.querySelector('[data-aslot="'+i+'"]');
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const api={projectRecents:async()=>[],getSettings:async()=>({}),setSettings:async()=>true,modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],moodList:async()=>[]};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      let voiceCard=0;setVoicesCardOpener(()=>voiceCard++);
      const pd={engine:'seedance2',mode:'ref2v',freeform:'Kai answers the door.',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[{id:'b1',name:'a',length:3,camera:'close',action:'Kai turns to the door',lighting:'',dialogue:'"Who is there?"'},{id:'b2',name:'b',length:2,camera:'wide',action:'the door opens',lighting:'',dialogue:'Come in'}],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'5',resolution:'720p',aspectRatio:'16:9',generateAudio:true};
      const sheet={id:'sh',name:'Kai',character:{name:'Kai',referenceLabel:'',base:'a tall man',features:'',physics:''},voiceId:'v1'};
      const voice={id:'v1',name:'Kai voice',recipe:{engine:'chatterbox-api',desc:'a low warm voice'},takes:[{id:'vt',file:'k.mp3',createdAt:1,durationSec:6.2}],keeperTakeId:'vt'};
      const project={dir:'synthetic',name:'Test',clips:[{id:'a',name:'The door',promptData:pd,takes:[]}],images:[],audio:[{id:'au',title:'theme',file:'t.mp3',durationSec:12}],videos:[],charSheets:[sheet],scoreClips:[],voiceClips:[voice],styles:[],imageGens:[],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],editSessions:[],videoEditSessions:[]};
      const jobs=[];
      useStore.setState({project,selectedClipId:'a',enqueueRender:j=>{jobs.push(j)}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:900,height:1800}}><RenderPanel/></div>);await tick(600);
      btn('▸ fields').click();await tick();

      // ---- 1. link the sheet: its voice comes along as a slot ----
      btn('from clip').click();await tick();
      const pick=[...document.querySelectorAll('div')].filter(d=>d.textContent.includes('⛉ Kai')&&d.style.cursor==='pointer').pop();
      check(pick,'the picker lists the sheet');
      pick.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));await tick(200);
      check(slot(0),'linking the sheet added a slot');
      check(slot(0).textContent.includes('🎤')&&slot(0).textContent.includes('@audio1')&&slot(0).textContent.includes('Kai voice')&&slot(0).textContent.includes('⛉ Kai'),'the slot: 🎤 @audio1 Kai voice ⛉ Kai: '+slot(0).textContent);
      check(slot(0).querySelector('[data-role]').textContent==='timbre','a voice slot starts as timbre');
      check(!slot(0).querySelector('span[title]').title.includes('mention @audio1'),'its role line binds it: no mention warning');
      check(document.body.textContent.includes("@audio1 is Kai's voice: Kai speaks in it"),'the preview says it is Kai’s voice');
      check(document.body.textContent.includes('a low warm voice'),'the voice’s description is Kai’s voice line');

      // ---- 2. dialogue: the length locks, another length is flagged ----
      slot(0).querySelector('[data-role]').click();await tick(150);
      check(slot(0).querySelector('[data-role]').textContent==='dialogue','click = dialogue');
      check(shown()==='7','the length locked to the dialogue (6.2s → 7): '+shown());
      check(document.querySelector('[data-dlock]'),'the duration box wears the lock');
      check(document.body.textContent.includes("@audio1 is Kai's dialogue, word for word"),'the preview says it is Kai’s dialogue');
      durDial().nextElementSibling.click();await tick();
      rows().find(r=>r.textContent.trim()==='10').click();await tick(150);
      check(document.body.textContent.includes('@audio1 is dialogue (6.2s): the clip is 10s, so it runs on 3.8s past the words (7s fits them)'),'another length: the ⚑ says so');
      slot(0).querySelector('[data-role]').click();await tick(150);
      check(slot(0).querySelector('[data-role]').textContent==='timbre'&&!document.querySelector('[data-dlock]'),'back to timbre: no lock');

      // ---- 3. render dialogue: the beats' lines for Kai, queued as a voice render ----
      const rd=slot(0).querySelector('[data-render-dialogue]');
      check(rd&&rd.textContent.includes('🎤 dialogue')&&rd.textContent.includes('$0.001'),'the button, priced at chatterbox’s rate: '+(rd&&rd.textContent));
      check(rd.title.includes('“Who is there? Come in.”'),'one voice slot: Kai’s line and the unclaimed one: '+rd.title);
      rd.click();await tick();
      const j=jobs.at(-1);
      check(j&&j.kind==='voice'&&j.label==='Kai voice · dialogue','a voice row in the queue: '+JSON.stringify(j));
      check(JSON.stringify(j.payload)===JSON.stringify({voiceClipId:'v1',engine:'chatterbox-api',text:'Who is there? Come in.',dialogueFor:{clipId:'a',voiceId:'v1',fromSheetId:'sh'}}),'… with the lines and the slot it lands on: '+JSON.stringify(j.payload));
      slot(0).querySelector('span[title]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await tick();
      check(voiceCard===1&&useStore.getState().editorVoiceId==='v1','double-click opens the voice in the Voice card');

      // ---- 4. unlink the sheet: its slot goes ----
      [...document.querySelectorAll('span')].find(s=>s.title.startsWith('unlink this character')).click();await tick(150);
      check(!slot(0),'unlinking the sheet took its slot away');

      // ---- 5. the ＋ box lists the Bin's voices; a Library track cycles ref → timbre → dialogue → ref ----
      const addBox=()=>[...document.querySelectorAll('.vd-slot')].find(e=>e.title.startsWith('add an audio reference'));
      addBox().click();await tick();
      check(document.querySelector('[data-pick-voice="v1"]'),'the ＋ box lists the voice');
      document.querySelector('[data-pick-voice="v1"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));await tick(150);
      check(slot(0)&&slot(0).textContent.includes('Kai voice')&&!slot(0).textContent.includes('⛉'),'a voice picked by hand: no sheet tag');
      addBox().click();await tick();
      [...document.querySelectorAll('div')].filter(d=>d.textContent.includes('theme')&&d.style.cursor==='pointer').pop().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));await tick(150);
      const role1=()=>slot(1).querySelector('[data-role]');
      check(role1().textContent==='ref'&&!slot(1).querySelector('[data-render-dialogue]'),'a Library track: ref, no dialogue button');
      role1().click();await tick();check(role1().textContent==='timbre','ref → timbre');
      role1().click();await tick(150);check(role1().textContent==='dialogue'&&shown()==='12','timbre → dialogue, the length locks to the 12s track');
      role1().click();await tick();check(role1().textContent==='ref','dialogue → ref');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();setVoicesCardOpener(null);
      return 'a sheet’s voice comes with its link (🎤 ⛉ timbre) and goes with it, dialogue locks the length (🔒, another length ⚑), the preview says each role, 🎤 dialogue queues the beats’ lines for that slot, double-click opens the voice, the ＋ box lists voices, a track cycles ref → timbre → dialogue';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
