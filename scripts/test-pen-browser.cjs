// list 4 (2026-09-30) — Premiere's audio keyframe tools in the real Timeline panel: P = Pen (a click on
// the volume line adds a keyframe; a drag on a clip never moves it), V = Selection (Ctrl-click the line
// adds), Ctrl-click a keyframe = Linear ↔ Auto Bezier, double-click the line = back to 0 dB. Same
// offscreen Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-pen-ui-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const key=k=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[]},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const tl={id:'par',name:'Main',aspectRatio:'16:9',audioTracks:3,items:[{id:'V',clipId:'c1',startSec:0,track:0}],audioItems:[{id:'L',lane:1,source:{audioId:'song'},startSec:0,inSec:0,outSec:8,gain:.5}],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips:[{id:'c1',name:'c1',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'}],images:[],audio:[{id:'song',title:'song',file:'song.mp3',durationSec:60}],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'par',folders:[]};
      const writes=[],moves=[];
      // lane writes land on the project so the band redraws from them
      const setAudio=async(items,id)=>{writes.push(items);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,audioItems:items}:t)}}))};
      useStore.setState({project,expandedAudioLanes:[1],setTimelineAudioItems:setAudio,setTimelineAll:async()=>{moves.push('all')},setTimelineItems:async()=>{moves.push('items')},setTimelineBoth:async()=>{moves.push('both')}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:1100,height:700}}><TimelinePanel/></div>);await tick(400);
      const band=()=>[...document.querySelectorAll('svg polyline')].map(p=>p.closest('div')).find(d=>d&&d.getBoundingClientRect().height>=40);
      check(!!band(),'the tall lane shows the volume line');
      // where the line sits at a fraction of the block, from the drawn polyline itself
      const lineAt=f=>{const b=band().getBoundingClientRect();const pts=band().querySelector('polyline').getAttribute('points').split(' ').map(s=>s.split(',').map(Number));const q=pts[Math.round(f*(pts.length-1))];return {x:b.left+q[0]/100*b.width,y:b.top+q[1]/100*b.height}};
      const press=(el,p,opts={})=>{el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:p.x,clientY:p.y,button:0,...opts}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:p.x,clientY:p.y}))};
      const pts=()=>(useStore.getState().project.timelines[0].audioItems.find(a=>a.id==='L').volume??[]);
      // P — the Pen: a click on the line = a keyframe
      key('p');await tick();
      check(useStore.getState().tlTool==='pen','P picks the Pen');
      press(band(),lineAt(.5));await tick();
      check(pts().length===1,'a Pen click on the line adds a keyframe ('+pts().length+')');
      // the Pen never moves a clip
      const clip=document.querySelector('.vd-clip');const cb=clip.getBoundingClientRect();
      clip.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:cb.left+20,clientY:cb.top+20,button:0}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:cb.left+220,clientY:cb.top+20}));window.dispatchEvent(new MouseEvent('mouseup',{clientX:cb.left+220,clientY:cb.top+20}));await tick();
      check(!moves.length,'dragging a clip with the Pen moves nothing');
      // V — back to Selection: Ctrl-click the line adds (a plain click doesn't)
      key('v');await tick();
      check(useStore.getState().tlTool==='select','V picks Selection');
      press(band(),lineAt(.2));await tick();
      check(pts().length===1,'a plain Selection click adds nothing');
      press(band(),lineAt(.2),{ctrlKey:true});await tick();
      check(pts().length===2,'Ctrl-click the line adds a keyframe');
      // Ctrl-click a keyframe: Linear → Auto Bezier → (click) Linear
      const kf=()=>{const b=band().getBoundingClientRect();const p=pts().find(x=>Math.abs(x.at-.2*8)<.2);const dot=[...band().querySelectorAll('div[title]')].find(d=>d.title.includes(p.at.toFixed(2)+'s'));const r=dot.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}};
      press(band(),kf(),{ctrlKey:true});await tick();
      check((pts().find(x=>Math.abs(x.at-1.6)<.2).interp)==='auto','Ctrl-click a Linear keyframe = Auto Bezier');
      press(band(),kf(),{ctrlKey:true});await tick();
      check((pts().find(x=>Math.abs(x.at-1.6)<.2).interp)==='linear','Ctrl-click an Auto Bezier = Linear again');
      // double-click the line = back to 0 dB (the segment under it)
      const p0=lineAt(.35);band().dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:p0.x,clientY:p0.y}));await tick();
      check(pts().every(x=>Math.abs(x.gain-1)<1e-6),'double-click the line snaps its keyframes to 0 dB: '+JSON.stringify(pts().map(x=>x.gain)));
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();return 'P Pen (click = keyframe, clips stay put), V Selection (ctrl-click adds), Ctrl-click Linear ↔ Auto Bezier, double-click = 0 dB';
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
    const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
