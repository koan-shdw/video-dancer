// list 17 (2026-09-30) — Seedance 2.5's Draft in Clip Gen: the draft switch beside resolution (greyed
// with the reason on engines without the mode), a Draft renders and is priced at 480p, and a Draft
// take's right-click finishes it at 1080p as its own queue row. The real panel in offscreen
// Electron; the app's API is a mock and the queue is caught, so nothing renders and nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-draft-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const lab=e=>e.textContent.replace('✓','').replace('▾','').trim();
    const dial=name=>{const l=[...document.querySelectorAll('.lb')].find(e=>e.textContent.trim()===name);check(l,'dial '+name);return l.nextElementSibling};
    const shown=name=>[...dial(name).querySelectorAll('span')].filter(s=>s.style.gridArea&&s.style.visibility!=='hidden').map(s=>s.textContent.trim())[0];
    const rows=()=>[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px');
    const open=async name=>{dial(name).click();await tick();return rows()};
    const close=async()=>{document.querySelector('div[style*="inset: 0"]')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick()};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const api={projectRecents:async()=>[],getSettings:async()=>({}),setSettings:async()=>true,modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],moodList:async()=>[]};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const pd=(engine,over={})=>({engine,mode:'t2v',freeform:'a dancer turns',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'6',resolution:'720p',aspectRatio:'16:9',generateAudio:true,...over});
      const DAY=86400000,now=Date.now();
      const snap=pd('seedance25',{mode:'ref2v',resolution:'480p',draft:true});
      const takes=[{id:'t1',file:'t1.mp4',createdAt:now,engine:'seedance25',durationSec:6,snapshot:snap,draft:{id:'draft_abc',via:'fal',at:now-2*DAY}},{id:'t2',file:'t2.mp4',createdAt:now,engine:'seedance25',durationSec:6,snapshot:snap,draft:{id:'old',via:'fal',at:now-8*DAY}},{id:'t3',file:'t3.mp4',createdAt:now,engine:'seedance25',durationSec:6,snapshot:pd('seedance25')}];
      const project={dir:'synthetic',name:'Test',clips:[{id:'a',name:'Turn',promptData:pd('seedance25'),takes,keeperTakeId:'t1'},{id:'b',name:'Old engine',promptData:pd('seedance2',{draft:true}),takes:[]},{id:'c',name:'Silent',promptData:pd('seedance2',{generateAudio:false,freeform:'a dancer turns like @ghost',production:{audioDesign:'wind and bells',lighting:'',subtext:'',criticalConstraint:'',avoid:''}}),takes:[]}],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[],editSessions:[],videoEditSessions:[]};
      const jobs=[];
      useStore.setState({project,selectedClipId:'a',enqueueRender:j=>{jobs.push(j)}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:700,height:1400}}><RenderPanel/></div>);await tick(600);
      const box=()=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='draft');
      const queue=async()=>{[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Queue')).click();await tick(150);return jobs.at(-1)};

      // ---- Seedance 2.5: 1080p on the dial, the draft switch live ----
      check(JSON.stringify((await open('resolution')).map(lab))==='["480p","720p","1080p"]','the resolution dial lists 1080p');await close();
      check(box()&&!box().querySelector('input').disabled&&!box().querySelector('input').checked,'the draft switch is there, off');
      check(box().title.startsWith('draft = a cheap 480p version first')&&box().title.includes('$1.16 a second')&&box().title.includes('within 7 days'),'it says what a draft is: '+box().title);
      let j=await queue();
      check(j.payload.draft===undefined&&j.payload.resolution==='720p'&&j.label==='Turn','off = a normal render: '+JSON.stringify([j.label,j.payload.resolution,j.payload.draft]));
      check(Math.abs(j.estCost-6*0.473)<1e-9,'priced at 720p: '+j.estCost);

      box().querySelector('input').click();await tick(150);
      check(shown('resolution')==='480p','a draft shows the size it really renders: '+shown('resolution'));
      check((await open('resolution')).length===0,'and the size dial does not open while drafting');
      check(dial('resolution').title.startsWith('a draft is always 480p'),'the dial says why: '+dial('resolution').title);
      j=await queue();
      check(j.payload.draft===true&&j.label==='Turn · draft','a draft render, named so in the queue: '+JSON.stringify([j.label,j.payload.draft]));
      check(Math.abs(j.estCost-6*0.2205)<1e-9,'priced at 480p: '+j.estCost);
      check(j.payload.resolution==='720p','the dial keeps its own pick for when the switch goes off');
      box().querySelector('input').click();await tick(150);
      check(shown('resolution')==='720p','switch off = the dial is back');

      // ---- a Draft take: the badge, and the finish on right-click ----
      const card=n=>[...document.querySelectorAll('[data-nav]')].find(e=>e.getAttribute('data-nav')==='t'+n);
      check(card(1).textContent.includes('DRAFT')&&card(2).textContent.includes('DRAFT')&&!card(3).textContent.includes('DRAFT'),'draft takes wear the badge');
      check(/draft \\(480p\\) · [56] day\\(s\\) left to finish it at 1080p/.test(card(1).title),'the card says how long is left: '+card(1).title.split('\\n').find(l=>l.startsWith('draft')));
      check(card(2).title.includes('its 7 days are over'),'an old draft says it is over');
      const menu=async n=>{card(n).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));await tick(150);return rows()};
      let fin=(await menu(1)).find(e=>e.textContent.includes('finish T1 at 1080p'));
      check(fin&&fin.textContent.includes('~$6.96'),'the menu offers the finish with its price (6 s × $1.16): '+(fin&&fin.textContent));
      const before=jobs.length;fin.click();await tick(150);
      j=jobs.at(-1);
      check(jobs.length===before+1&&JSON.stringify(j.payload.finishDraft)==='{"clipId":"a","takeId":"t1"}','the finish is its own queue row, naming the take: '+JSON.stringify(j.payload.finishDraft));
      check(j.label==='Turn · T1 at 1080p'&&Math.abs(j.estCost-6.96)<1e-9&&j.payload.engine==='seedance25'&&j.payload.resolution==='1080p'&&j.payload.prompt==='','named and priced: '+JSON.stringify([j.label,j.estCost]));
      fin=(await menu(2)).find(e=>e.textContent.includes('finish T2 at 1080p'));
      check(fin&&fin.title.includes('a draft can be finished for 7 days'),'an old draft still lists the finish, greyed with the reason: '+(fin&&fin.title));
      const b2=jobs.length;fin.click();await tick(150);
      check(jobs.length===b2,'and a click on it queues nothing');
      await close();
      check(!(await menu(3)).some(e=>e.textContent.includes('finish T3')),'a normal take has no finish');
      await close();

      // ---- an engine without the mode: the switch is greyed with the reason, the flag never leaves ----
      useStore.setState({selectedClipId:'b'});await tick(400);
      check(box().querySelector('input').disabled&&!box().querySelector('input').checked,'greyed on Seedance 2');
      check(box().title.includes('has no draft mode'),'with the reason: '+box().title);
      j=await queue();
      check(j.payload.clipId==='b'&&j.payload.draft===undefined&&j.label==='Old engine','no draft flag on another engine: '+JSON.stringify([j.label,j.payload.draft]));
      // list 31: the preflight — facts about what the render will send, above the render button, before the money leaves
      check(document.querySelectorAll('[data-flag]').length===0,'a clip that checks out shows no flags');
      useStore.setState({selectedClipId:'c'});await tick(400);
      const fl=[...document.querySelectorAll('[data-flag]')].map(e=>e.textContent);
      check(fl.length===2&&fl[0]==='⚑ sound is OFF, but the clip describes sound (audio_design) — it will render silent'&&fl[1]==='⚑ @ghost is named in freeform, but no Library image has that title (deleted or renamed?)','the flags are on the panel: '+JSON.stringify(fl));
      j=await queue();
      check(j.payload.clipId==='c','a flag is a fact, not a block: the render still queues');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();
      return 'Clip Gen draft mode: Seedance 2.5 lists 1080p and a draft switch; a draft renders and is priced at 480p and the dial says so; a draft take wears a badge and its days left; right-click finishes it at 1080p as its own priced queue row; an old draft is greyed with the reason; other engines grey the switch and never send the flag; the preflight flags show above the render button and never block';
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
    const win = new BrowserWindow({ show: false, width: 1000, height: 1500, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
