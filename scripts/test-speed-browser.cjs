// list 51 (2026-09-30) — Premiere's Clip Speed / Duration in the real Timeline panel: Ctrl+R opens
// it on the selection, the chain ties speed to duration (and lets go), Reverse Speed makes the
// take's reversed copy before anything is written, OK writes once with the ripple, right-click
// has it, a nest can't reverse. Same offscreen Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-speed-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const has=s=>document.body.textContent.includes(s);
    const field=label=>document.querySelector('[aria-label="'+label+'"]');
    const setVal=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
    const box=t=>[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===t)?.querySelector('input');
    const ctrlR=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'r',ctrlKey:true,bubbles:true,cancelable:true}));
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      const reversed=[],writes=[];
      const api={projectRecents:async()=>[],mediaReverse:async f=>{reversed.push(f);return {ok:true,made:true}}};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip=(id)=>({id,name:id,promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:id+'t',file:id+'.mp4',durationSec:4}],keeperTakeId:id+'t'});
      const inner={id:'in',name:'Montage',aspectRatio:'16:9',items:[{id:'x',clipId:'c1',startSec:0,track:0}]};
      const tl={id:'par',name:'Main',aspectRatio:'16:9',items:[{id:'A',clipId:'c1',startSec:0,track:0},{id:'B',clipId:'c2',startSec:4,track:0},{id:'N',clipId:'',nestId:'in',startSec:8,track:0,inSec:0,outSec:4}],audioItems:[],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips:[clip('c1'),clip('c2')],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl,inner],activeTimelineId:'par',folders:[]};
      useStore.setState({project,selectedTlItemId:'A',setTimelineBoth:async(items,audio,id)=>{writes.push({items,audio,id})}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:1100,height:700}}><TimelinePanel/></div>);await tick(400);
      // Ctrl+R — Premiere's key — on the selected block
      ctrlR();await tick();
      check(has('Clip Speed / Duration'),'Ctrl+R opens the dialog');
      check(field('Speed percent').value==='100'&&field('Duration').value==='00:00:04:00','it starts at 100 % and 4s');
      setVal(field('Speed percent'),'50');await tick();
      check(field('Duration').value==='00:00:08:00','the chain: 50 % = 8s');
      setVal(field('Duration'),'00:00:02:00');await tick();
      check(field('Speed percent').value==='200','… and 2s = 200 %');
      document.querySelector('[aria-label="speed and duration linked"]').click();await tick();
      setVal(field('Speed percent'),'50');await tick();
      check(field('Duration').value==='00:00:02:00','unlinked: the duration holds');
      document.querySelector('[aria-label="speed and duration unlinked"]').click();await tick();
      setVal(field('Speed percent'),'25');await tick();
      check(field('Duration').value==='00:00:16:00','linked again: 25 % = 16s');
      setVal(field('Speed percent'),'50');await tick();
      check(box('Ripple Edit, Shifting Trailing Clips').checked&&box('Maintain Audio Pitch').checked&&!box('Reverse Speed').checked,'Premiere defaults: ripple on, pitch kept, forward');
      box('Reverse Speed').click();await tick();
      await window.saveScreenshot();
      button('OK').click();await tick(300);
      check(reversed.length===1&&reversed[0]==='c1.mp4','the reversed copy is made first');
      check(writes.length===1,'one write');
      const A=writes[0].items.find(x=>x.id==='A'),B=writes[0].items.find(x=>x.id==='B');
      check(A.speed===.5&&A.reverse===true&&B.startSec===8,'A 50 % reversed, B rippled to 8s: '+JSON.stringify([A,B]));
      check(!has('Clip Speed / Duration'),'OK closes it');
      // right-click: the entry, and a nest can't reverse
      const nestBlock=[...document.querySelectorAll('[title^="⧉ nest"]')][0];
      nestBlock.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:200}));await tick();
      const entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim().startsWith('⚡ speed / duration… (100%')).pop();
      check(!!entry,'right-click has speed / duration…');
      entry.click();await tick();
      check(has('Clip Speed / Duration')&&box('Reverse Speed').disabled,'on a nest, Reverse Speed is greyed');
      button('Cancel').click();await tick();
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();return 'Ctrl+R, the chain both ways, Premiere defaults, reverse copy before the write, one write with ripple, right-click entry, a nest can\\'t reverse';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|Error|\[Error)/.test(l)).join('\n')+'\n');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('saveScreenshot',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'speed-dialog.png'),(await win.webContents.capturePage()).toPNG()))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    console.log('PASS screenshot: '+path.join(tmp,'speed-dialog.png'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
