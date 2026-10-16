// list 49 (2026-09-30) — Premiere's sequence tabs in the real Timeline panel: a timeline shown opens as
// a tab, a tab click shows it, × closes the tab (never the timeline), a tab dragged out of the strip
// opens its own window, and with two timeline panels a press makes that panel's timeline active and
// gives it the keys. Same offscreen Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-tabs-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    import {setTimelineWindowOpener} from '${ui}/panelBus';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const tabs=()=>[...document.querySelectorAll('[data-tltab]')].map(t=>t.dataset.tltab);
    const tab=id=>document.querySelector('[data-tltab="'+id+'"]');
    const press=(el,x,y,opts={})=>el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,...opts}));
    const up=(x,y)=>window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y}));
    const mv=(x,y)=>window.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:y}));
    const center=el=>{const r=el.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[],timelineSetActive:async()=>null},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip={id:'c1',name:'c1',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'};
      const tl=(id,n)=>({id,name:'TL '+id,aspectRatio:'16:9',items:Array.from({length:n},(_,i)=>({id:id+i,clipId:'c1',startSec:i*4,track:0}))});
      const project={dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl('A',1),tl('B',2),tl('C',3)],activeTimelineId:'A',folders:[]};
      useStore.setState({project,tlTabs:[],tlTabCurrent:null,tlWindows:[],tlFocus:'main'});
      const opened=[];setTimelineWindowOpener((id,name,at)=>opened.push([id,name,!!at]));
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',flexDirection:'column'}}><div id="main" style={{width:1100,height:420}}><TimelinePanel/></div><div id="win" style={{width:1100,height:380}}><TimelinePanel timelineId="C"/></div></div>);await tick(400);
      const clips=host=>document.querySelectorAll('#'+host+' .vd-clip').length;
      check(JSON.stringify(tabs())==='["A"]'&&clips('main')===1,'the active timeline is the first tab: '+JSON.stringify(tabs()));
      check(clips('win')===3,'the window panel shows its own timeline (C, 3 clips)');
      // a timeline shown from elsewhere (the Bin) opens as a tab and shows
      await useStore.getState().selectTimeline('B');await tick();
      check(JSON.stringify(tabs())==='["A","B"]'&&clips('main')===2,'B opens as a tab and shows');
      // a tab click shows it (and makes it active)
      let [x,y]=center(tab('A'));press(tab('A'),x,y);up(x,y);await tick();
      check(useStore.getState().project.activeTimelineId==='A'&&clips('main')===1,'clicking the A tab shows A');
      // drag B along the strip before A = reorder
      [x,y]=center(tab('B'));const [ax,ay]=center(tab('A'));press(tab('B'),x,y);mv(ax-20,ay);up(ax-20,ay);await tick();
      check(JSON.stringify(tabs())==='["B","A"]','dragging along the strip reorders: '+JSON.stringify(tabs()));
      // drag B out of the strip = its own window
      [x,y]=center(tab('B'));press(tab('B'),x,y);mv(x,y+200);up(x,y+200);await tick();
      check(opened.length===1&&opened[0][0]==='B'&&opened[0][1]==='TL B'&&opened[0][2],'dragging a tab out opens it in its own window');
      check(JSON.stringify(tabs())==='["A"]','… and its tab leaves the strip');
      // the × closes a tab, never the timeline — the last tab stays
      await useStore.getState().selectTimeline('B');await tick();
      document.querySelector('[aria-label="close the TL B tab"]').click();await tick();
      check(JSON.stringify(tabs())==='["A"]'&&useStore.getState().project.timelines.length===3,'× closes the tab; the timeline stays');
      check(!document.querySelector('[aria-label="close the TL A tab"]'),'the last tab has no ×');
      // two panels: a press in the window panel makes C active and gives it the keys
      const winClip=document.querySelector('#win .vd-clip');[x,y]=center(winClip);press(winClip,x,y);up(x,y);await tick();
      check(useStore.getState().project.activeTimelineId==='C'&&useStore.getState().tlFocus==='C','a press in the C window: C is active, and has the keys');
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true,cancelable:true}));await tick();
      const sliceOn=host=>[...document.querySelectorAll('#'+host+' .vd-loop')].some(el=>el.textContent.includes('slice')&&getComputedStyle(el).color==='rgb(255, 0, 0)'||(el.textContent.includes('slice')&&el.style.color==='var(--bad)'));
      check(sliceOn('win')&&!sliceOn('main'),'C only toggles the slice tool in the focused panel');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();return 'tabs open / show / reorder / close (timeline kept, last tab stays), drag out = own window, a press moves the active timeline + the keys to that panel';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|Error)/.test(l)||(r.status!==0&&/^PAGE/.test(l))).join('\n')+'\n');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...a)=>console.log('PAGE',...a))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
