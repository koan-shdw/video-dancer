// list 13 (2026-09-30) — the Video Editor with Gemini Omni Flash 1.1: it is the first pick, a true
// edit whose resolution dial works (360p to 4k), the estimate follows the size, the render carries
// it; Omni 1.0 keeps its dial greyed and sends none; a size another engine can't make snaps back.
// The real panel in an offscreen Electron window; the render is caught before it leaves the page.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-vedit-omni11-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
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
    const mode=()=>document.querySelector('.vd-mode.on')?.textContent;const toMode=async m=>{[...document.querySelectorAll('.vd-mode')].find(e=>e.textContent===m).click();await tick()};
    export async function run(){
      setVidancerApi(new Proxy({},{get:(t,k)=>typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const jobs=[];
      useStore.setState({project:{dir:'synthetic',name:'T',images:[],clips:[],videos:[{id:'v',title:'@vid',file:'v.mp4',durationSec:8}],audio:[],styles:[],timelines:[],folders:[],editSessions:[],videoEditSessions:[]},editorVideoRoot:{videoId:'v'},renderNow:j=>{jobs.push(j)}});
      const root=createRoot(document.getElementById('root'));root.render(<div style={{width:900,height:1400}}><VideoEditorPanel/></div>);await tick(300);
      check(shown('model')==='Gemini Omni Flash 1.1'&&mode()==='edit'&&shown('via')==='fal','Omni 1.1 via fal is the first pick, an edit: '+shown('model')+' · '+mode());
      const sizes=(await open('resolution')).map(lab);await close();
      check(JSON.stringify(sizes)==='["360p","720p","1080p","4k"]','its resolution dial lists 360p to 4k: '+JSON.stringify(sizes));
      await pick('resolution','1080p');
      const ta=document.querySelector('textarea');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,'make it night');ta.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      const go=()=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Generate now')).click();
      go();await tick(150);
      check(jobs.length===1,'one edit sent: '+jobs.length+' · '+document.body.textContent.slice(0,300));
      check(jobs[0].payload.engine==='omniflash11'&&jobs[0].payload.resolution==='1080p','the edit = Omni 1.1 at 1080p: '+JSON.stringify(jobs[0].payload));
      check(Math.abs(jobs[0].estCost-8*0.15)<1e-9,'8 s at 1080p = $1.20: '+jobs[0].estCost);
      // Omni 1.0: the dial is greyed and no size is sent
      await pick('model','Gemini Omni Flash');
      check((await open('resolution')).length===0,'Omni 1.0: the resolution dial does not open');
      go();await tick(150);
      check(jobs[1].payload.engine==='omniflash'&&!('resolution' in jobs[1].payload),'Omni 1.0 sends no size: '+JSON.stringify(jobs[1].payload));
      // 4k on Omni 1.1, then a Seedance re-gen: the size snaps to one Seedance makes
      await pick('model','Gemini Omni Flash 1.1');await pick('resolution','4k');
      await pick('model','Seedance 2');check(mode()==='re-gen'&&[...document.querySelectorAll('.vd-mode')].find(e=>e.textContent==='extend').style.opacity==='0.45','Seedance 2 lights re-gen, extend greyed: '+mode());
      check(shown('resolution')==='720p','4k snaps to 720p on Seedance 2: '+shown('resolution'));
      // list 13: EXTEND on the Google key — its own engine row; Omni 1.1 on fal stays a true edit (its video refs are Clip Gen's)
      await pick('model','Gemini Omni Flash 1.1');await toMode('extend');check(mode()==='extend'&&shown('via')==='Google','Omni 1.1 extend runs via Google: '+shown('via'));
      check([...document.querySelectorAll('.lb')].some(e=>e.textContent.trim()==='what happens next'),'the prompt box asks what happens next');
      go();await tick(150);
      let x=jobs.at(-1);
      check(x.payload.engine==='omniextend'&&x.label.endsWith('· extend')&&!('inSec' in x.payload)&&!('resolution' in x.payload),'an 8 s video goes whole, no dials: '+JSON.stringify(x.payload));
      check(Math.abs(x.estCost-(8*0.0087+10*0.1))<1e-9,'the estimate is the most one extend can cost: '+x.estCost);
      // a 25 s video: only its last 10 s can be sent, and that is the window it opens on
      const long={dir:'synthetic',name:'T',images:[],clips:[],videos:[{id:'w',title:'@long',file:'w.mp4',durationSec:25}],audio:[],styles:[],timelines:[],folders:[],editSessions:[],
        videoEditSessions:[{id:'s',rootVideoId:'w',nodes:[{id:'n1',parentId:null,file:'n1.mp4',prompt:'KEEPS RISING',engine:'omniextend',durationSec:25,createdAt:1,googleInteractionId:'v1_x'},{id:'n2',parentId:'n1',file:'n2.mp4',prompt:'FORTY',engine:'omniextend',durationSec:40,createdAt:2,googleInteractionId:'v1_y'}]}]};
      useStore.setState({project:long,editorVideoRoot:{videoId:'w'}});await tick(200);
      go();await tick(150);
      x=jobs.at(-1);
      check(x.payload.parentId===null&&Math.abs(x.payload.inSec-15)<0.01&&Math.abs(x.payload.outSec-25)<0.01,'a 25 s original sends its last 10 s: '+JSON.stringify({in:x.payload.inSec,out:x.payload.outSec}));
      // a node an earlier extend made: sent whole, it continues from its Google session
      const row=t=>[...document.querySelectorAll('div,span')].filter(e=>e.childElementCount===0&&e.textContent.includes(t)).pop();
      check(row('KEEPS RISING'),'the extend node is in the tree');row('KEEPS RISING').click();await tick(200);
      go();await tick(150);
      x=jobs.at(-1);
      check(x.payload.parentId==='n1'&&!('inSec' in x.payload),'a 25 s extend node goes whole, from its session: '+JSON.stringify(x.payload));
      check(Math.abs(x.estCost-10*0.1)<1e-9,'nothing is uploaded, so only the added seconds are priced: '+x.estCost);
      // 40 s is the end of the road
      const before=jobs.length;row('FORTY').click();await tick(200);
      go();await tick(150);
      check(jobs.length===before&&document.body.textContent.includes('already 40s'),'a 40 s video is not extended again');
      root.unmount();return 'Video Editor: Omni 1.1 first, its resolution dial live and priced, the edit carries it; Omni 1.0 sends none; sizes snap across engines; extend (Google) sends the tail of a long video, a video it made whole, and stops at 40 s';
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
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
