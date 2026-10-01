// list 56 (SPEED-RAMPS-SPEC-2026-10-01) — Premiere's Time Remapping in the real Timeline panel:
// right-click → time remapping ▸ speed puts the speed line on the block; Ctrl-click the line = a
// keyframe; dragging the line = that part's speed, the block growing live and stopping at the next
// block (its end trimmed there, nothing moved); a keyframe selects, its handles pulled apart = a
// ramp; Delete removes the keyframe and never the block; remove = one speed again; a reversed block
// greys it; the speed dialog greys Speed, Duration and Reverse for it. Offscreen Electron harness.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-remap-ui-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const has=s=>document.body.textContent.includes(s);
    const near=(a,b,e)=>Math.abs(a-b)<=e;
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[]},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip=(id)=>({id,name:id,promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:id+'t',file:id+'.mp4',durationSec:4}],keeperTakeId:id+'t'});
      const tl={id:'par',name:'Main',aspectRatio:'16:9',items:[{id:'A',clipId:'c1',startSec:0,track:0},{id:'B',clipId:'c2',startSec:6,track:0},{id:'R',clipId:'c2',startSec:12,track:0,reverse:true}],audioItems:[],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips:[clip('c1'),clip('c2')],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'par',folders:[]};
      const writes=[];
      const setItems=async(items)=>{writes.push(items);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id==='par'?{...t,items}:t)}}))};
      useStore.setState({project,selectedTlItemId:'A',setTimelineItems:setItems});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:1300,height:700}}><TimelinePanel/></div>);await tick(400);
      const A=()=>useStore.getState().project.timelines[0].items.find(x=>x.id==='A');
      const blockEl=id=>[...document.querySelectorAll('.vd-clip')][['A','B','R'].indexOf(id)];
      const wrapW=()=>blockEl('A').parentElement.getBoundingClientRect().width;
      const menuRow=t=>[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()===t).pop();
      const ctx=async id=>{const b=blockEl(id).getBoundingClientRect();blockEl(id).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+20,clientY:b.top+30}));await tick()};
      const sub=async()=>{menuRow('time remapping▸').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));await tick(150)};

      // ---- right-click → time remapping ▸ speed ----
      await ctx('A');await sub();
      menuRow('speed').click();await tick(200);
      check(JSON.stringify(A().remap)==='{"keys":[],"speeds":[1]}'&&A().speed===undefined,'the speed line, at the block’s speed: '+JSON.stringify(A().remap));
      check(document.querySelector('[data-speedband]')&&document.querySelector('[data-speedline]'),'the line shows on the block');
      check(blockEl('A').textContent.includes('remap 100–100%'),'the label says it is remapped');
      const w4=wrapW();
      // ---- Ctrl-click the line: a keyframe there (the middle = 2 s of the take) ----
      const band=()=>document.querySelector('[data-speedband]').getBoundingClientRect();
      const line=()=>document.querySelector('[data-speedline]');
      const midY=()=>{const r=band();return r.top+8+3+0.5*(r.height-8-3-5)}; // 100 % sits in the middle of the band
      let r=band();
      line().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:midY(),button:0,ctrlKey:true}));await tick(200);
      check(A().remap.keys.length===1&&near(A().remap.keys[0].at,2,0.1)&&JSON.stringify(A().remap.speeds)==='[1,1]','Ctrl-click = a keyframe, both sides at 100 %: '+JSON.stringify(A().remap));
      check(document.querySelector('[data-remapkey="0"]'),'its tick on the strip');
      // ---- drag the right part down: slower, the block grows live, then stops at B ----
      r=band();
      const yFor=v=>r.top+8+3+((1-Math.log10(v))/2)*(r.height-8-3-5);
      line().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:r.left+r.width*0.75,clientY:midY(),button:0}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+r.width*0.75,clientY:yFor(0.4)}));await tick(150);
      check(wrapW()>w4*1.4,'the block grows as the line drags: '+wrapW()+' vs '+w4);
      const tipTxt=[...document.querySelectorAll('div')].map(d=>d.textContent.trim()).find(t=>/^[0-9]+ %$/.test(t));
      check(tipTxt&&Math.abs(parseInt(tipTxt)-40)<=3,'the tooltip says the speed: '+tipTxt);
      window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+r.width*0.75,clientY:yFor(0.4)}));await tick(250);
      const v1=A().remap.speeds[1];
      check(near(v1,0.4,0.03)&&A().remap.speeds[0]===1,'that part plays at 40 %: '+JSON.stringify(A().remap.speeds));
      check(near(A().outSec,2+4*v1,0.02),'2 s + 4 s at that speed meets B at 6 s: its end is trimmed there ('+A().outSec+')');
      check(useStore.getState().project.timelines[0].items.find(x=>x.id==='B').startSec===6,'nothing after it moved');
      // ---- a keyframe: select, pull its handles apart = a ramp ----
      document.querySelector('[data-remapkey="0"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:band().left,clientY:band().top+3,button:0}));
      window.dispatchEvent(new MouseEvent('mouseup',{}));await tick(150);
      check(document.querySelector('[data-remapkey="0"]').style.background==='var(--amber)','the keyframe is selected (amber)');
      const hr=document.querySelector('[data-ramphandle="right"]');
      check(hr,'a selected keyframe shows its handles');
      const hb=hr.getBoundingClientRect();
      hr.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:hb.left+3,clientY:hb.top+3,button:0}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:hb.left+3+60,clientY:hb.top+3}));await tick(100);
      window.dispatchEvent(new MouseEvent('mouseup',{}));await tick(250);
      check(A().remap.keys[0].ramp>0.2,'the handle pulled = a ramp: '+JSON.stringify(A().remap.keys[0]));
      // ---- Delete: the keyframe goes, the block stays ----
      document.querySelector('[data-remapkey="0"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:band().left,clientY:band().top+3,button:0}));
      window.dispatchEvent(new MouseEvent('mouseup',{}));await tick(120);
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));await tick(250);
      check(A()&&JSON.stringify(A().remap)==='{"keys":[],"speeds":[1]}','Delete removes the keyframe (the parts become one at the left speed) and never the block: '+JSON.stringify(A()?.remap));
      // ---- the speed dialog greys what the line decides ----
      useStore.setState({selectedTlItemId:'A'});await tick();
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'r',ctrlKey:true,bubbles:true,cancelable:true}));await tick(200);
      check(has('Clip Speed / Duration')&&document.querySelector('[aria-label="Speed percent"]').disabled&&document.querySelector('[aria-label="Duration"]').disabled,'the speed dialog greys Speed and Duration');
      check(document.querySelector('[data-remapnote]')?.textContent.includes('Time remapping is on'),'… and says why');
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel').click();await tick();
      // ---- remove: one speed again ----
      await ctx('A');await sub();
      menuRow('remove').click();await tick(200);
      check(A().remap===undefined&&!document.querySelector('[data-speedband]'),'remove = the block plays at one speed again');
      // ---- a reversed block: greyed, with the reason ----
      await ctx('R');await sub();
      const g=menuRow('speed');
      check(g&&g.title.startsWith('a reversed block')&&g.style.cursor==='default','a reversed block greys it and says why');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();
      return 'time remapping ▸ speed puts the line on the block; Ctrl-click = a keyframe; dragging the line sets that part’s speed with a tooltip, the block grows live and stops at the next one (its end trimmed, nothing moved); a keyframe’s handles = a ramp; Delete = the keyframe, never the block; the speed dialog greys Speed and Duration and says why; remove = one speed; a reversed block greys it';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|Error)/.test(l)).join('\n')+'\n');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1400,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
