// list 56 with REAL input (10-02: he found nothing worked; the older test dispatched events straight
// at the line and so skipped the browser's own hit-testing and pointer events). The real Timeline
// panel in an offscreen Electron window, driven by webContents.sendInputEvent: right-click a block →
// time remapping ▸ speed, drag the line, Ctrl-click it, select a keyframe, pull its handle, Delete.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-remap-input-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms));
    window.__log=[];
    const what=e=>{const t=e.target;if(!t||!t.closest)return String(t&&t.nodeName);if(t.closest('[data-speedline]'))return 'LINE';if(t.closest('[data-remapkey]'))return 'KEY';if(t.closest('[data-ramphandle]'))return 'HANDLE';if(t.closest('[data-speedband]'))return 'BAND';if(t.closest('.vd-clip'))return 'BLOCK';return t.nodeName};
    export async function setup(){
      window.addEventListener('error',e=>window.__log.push('error '+e.message));
      setVidancerApi(new Proxy({projectRecents:async()=>[]},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip=(id,d)=>({id,name:id,promptData:{duration:String(d),beats:[],freeform:'',imageIds:[]},takes:[{id:id+'t',file:id+'.mp4',durationSec:d}],keeperTakeId:id+'t'});
      const tl={id:'par',name:'Main',aspectRatio:'16:9',items:[{id:'P',clipId:'c2',startSec:0,track:0},{id:'A',clipId:'c1',startSec:4,track:0,inSec:0.25},{id:'B',clipId:'c2',startSec:20,track:0}],audioItems:[],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips:[clip('c1',10.054),clip('c2',4)],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'par',folders:[]};
      const setItems=async(items)=>{window.__log.push('write');const id=useStore.getState().project.activeTimelineId;useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,items}:t)}}))};
      const own=window.__own;
      if(own){const tl0=own.timelines.find(t=>t.items.some(i=>i.remap));for(const i of tl0.items)if(i.remap){delete i.remap;i.id='A'}own.activeTimelineId=tl0.id;own.dir='synthetic';Object.assign(project,own);tl.id=tl0.id}
      useStore.setState({project,setTimelineItems:setItems});
      for (const t of ['pointerdown','mousedown','mouseup','click','contextmenu']) window.addEventListener(t,e=>window.__log.push(t+' '+what(e)+(e.defaultPrevented?' (prevented)':'')),true);
      for (const t of ['pointerdown','mousedown']) window.addEventListener(t,e=>{if(e.defaultPrevented)window.__log.push('  '+t+' was prevented on the way')},false);
      createRoot(document.getElementById('root')).render(<div style={{width:1300,height:700}}><TimelinePanel/></div>);await tick(500);
      return true
    }
    const r=el=>{if(!el)return null;const b=el.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height}};
    export const blockA=()=>{const all=[...document.querySelectorAll('.vd-clip')];return r(window.__own?all.reduce((a,b)=>b.getBoundingClientRect().left>a.getBoundingClientRect().left?b:a):all[1])};
    export const band=()=>r(document.querySelector('[data-speedband]'));
    export const row=t=>r([...document.querySelectorAll('div')].filter(d=>d.textContent.trim()===t).pop());
    export const key=i=>r(document.querySelector('[data-remapkey="'+i+'"]'));
    export const handle=s=>r(document.querySelector('[data-ramphandle="'+s+'"]'));
    export const A=()=>{const p=useStore.getState().project;const a=p.timelines.find(t=>t.id===p.activeTimelineId).items.find(x=>x.id==='A');return JSON.stringify({remap:a.remap,startSec:a.startSec,inSec:a.inSec,outSec:a.outSec})};
    export const log=()=>{const l=window.__log.join(' | ');window.__log=[];return l};
    export const lineY=f=>{const pl=document.querySelector('[data-speedline]');if(!pl)return null;const b=document.querySelector('[data-speedband]').getBoundingClientRect();const x=f*b.width;const pts=pl.getAttribute('points').trim().split(' ').filter(Boolean).map(q=>q.split(',').map(Number));for(let i=0;i+1<pts.length;i++){const[a,b2]=[pts[i],pts[i+1]];if(x>=a[0]-0.01&&x<=b2[0]+0.01){const t=b2[0]===a[0]?0:(x-a[0])/(b2[0]-a[0]);return b.top+a[1]+(b2[1]-a[1])*t}}return b.top+pts[pts.length-1][1]};
    export const setTool=t=>useStore.setState({tlTool:t});
    export const hit=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.outerHTML.slice(0,160)):'none'};
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:90000,windowsHide:true})
  process.stdout.write(r.stdout||'');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1400,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    const js=s=>win.webContents.executeJavaScript(s)
    if(process.env.VD_PROJECT)await js('window.__own='+fs.readFileSync(process.env.VD_PROJECT,'utf8')+';0')
    await js(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.setup()')
    const wait=ms=>new Promise(r=>setTimeout(r,ms))
    const ev=async(type,x,y,o={})=>{win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:o.button||'left',clickCount:1,modifiers:o.mods||[]});await wait(40)}
    const click=async(x,y,o={})=>{await ev('mouseMove',x,y,o);await ev('mouseDown',x,y,o);await ev('mouseUp',x,y,o)}
    const dragTo=async(x0,y0,x1,y1,o={})=>{await ev('mouseMove',x0,y0);await ev('mouseDown',x0,y0,o);for(let i=1;i<=6;i++)await ev('mouseMove',x0+(x1-x0)*i/6,y0+(y1-y0)*i/6,{...o,mods:[...(o.mods||[]),'leftButtonDown']});await ev('mouseUp',x1,y1,o)}
    const check=(v,m)=>{if(!v)throw Error(m)}
    const st=async()=>JSON.parse(await js('checks.A()'))
    const ly=async f=>js(`checks.lineY(${f})`)
    const b=await js('checks.blockA()')
    // right-click → time remapping ▸ speed
    await click(b.l+20,b.t+b.h/2,{button:'right'});await wait(150)
    const tr=await js('checks.row("time remapping▸")');check(tr,'the menu has time remapping')
    await ev('mouseMove',tr.l+10,tr.t+tr.h/2);await wait(250)
    const sp=await js('checks.row("speed")');check(sp,'… and its speed entry')
    await click(sp.l+10,sp.t+sp.h/2);await wait(250)
    check(JSON.stringify((await st()).remap)==='{"keys":[],"speeds":[1]}','speed puts the line on the block: '+JSON.stringify((await st()).remap))
    let bd=await js('checks.band()'),y=await ly(0.75)
    check((await js(`checks.hit(${bd.l+bd.w*0.75},${y})`)).includes('data-speedline'),'the mouse lands on the line')
    // the Selection tool: drag the line down = slower
    await dragTo(bd.l+bd.w*0.75,y,bd.l+bd.w*0.75,y+4);await wait(300)
    let a1=await st();check(a1.remap.speeds.length===1&&a1.remap.speeds[0]<0.9,'a drag down slows it: '+JSON.stringify(a1.remap))
    // Ctrl-click on the line = a keyframe
    bd=await js('checks.band()');y=await ly(0.5)
    await click(bd.l+bd.w*0.5,y,{mods:['control']});await wait(250)
    a1=await st();check(a1.remap.keys.length===1&&a1.remap.speeds.length===2,'Ctrl-click = a keyframe: '+JSON.stringify(a1.remap))
    // click the keyframe = selected, its handles show; pull one = a ramp
    let k=await js('checks.key(0)');await click(k.l+k.w/2,k.t+3);await wait(200)
    const h=await js('checks.handle("right")');check(h,'a clicked keyframe shows its handles')
    await dragTo(h.l+3,h.t+3,h.l+40,h.t+3);await wait(250)
    a1=await st();check(a1.remap.keys[0].ramp>0.2,'a handle pulled = a ramp: '+JSON.stringify(a1.remap.keys[0]))
    // drag the right part up = faster
    bd=await js('checks.band()');y=await ly(0.92)
    await dragTo(bd.l+bd.w*0.92,y,bd.l+bd.w*0.92,y-6);await wait(300)
    a1=await st();check(a1.remap.speeds[1]>a1.remap.speeds[0]*1.3,'a drag up speeds that part up: '+JSON.stringify(a1.remap.speeds))
    // Delete removes the selected keyframe, never the block
    k=await js('checks.key(0)');await click(k.l+k.w/2,k.t+3);await wait(150)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Delete'});await wait(40);win.webContents.sendInputEvent({type:'keyUp',keyCode:'Delete'});await wait(300)
    a1=await st();check(a1.remap&&a1.remap.keys.length===0,'Delete removes the keyframe and keeps the block: '+JSON.stringify(a1.remap))
    // the Pen (P, left on from the volume line): a drag is still the line, a click is a keyframe
    await js(`checks.setTool('pen')`);await wait(100)
    const before=a1.remap.speeds[0]
    bd=await js('checks.band()');y=await ly(0.3)
    await dragTo(bd.l+bd.w*0.3,y,bd.l+bd.w*0.3,y-8);await wait(300)
    a1=await st();check(a1.remap.keys.length===0&&a1.remap.speeds[0]>before*1.3,'with the Pen a drag changes the speed (no keyframe): '+JSON.stringify(a1.remap))
    bd=await js('checks.band()');y=await ly(0.4)
    await click(bd.l+bd.w*0.4,y);await wait(250)
    a1=await st();check(a1.remap.keys.length===1,'with the Pen a click = a keyframe: '+JSON.stringify(a1.remap))
    const errs=await js('checks.log()');check(!/error /.test(errs),'no errors: '+errs)
    console.log('PASS real mouse input'+(process.env.VD_PROJECT?' on '+process.env.VD_PROJECT:'')+': time remapping ▸ speed shows the line; a drag down slows it, a drag up speeds it; Ctrl-click = a keyframe; a clicked keyframe shows its handles and one pulled = a ramp; Delete = the keyframe, never the block; with the Pen a drag still changes the speed and a click adds a keyframe')
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.stack));app.exit(1)}})
}
