const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-transitions-')), {spawnSync}=require('node:child_process')
  const sources={}
  for(const [name,colors] of Object.entries({a:['red','green','blue'],b:['green','blue','blue']})){
    const file=path.join(tmp,name+'.mp4')
    const r=spawnSync(require('ffmpeg-static'),['-v','error',...colors.flatMap(c=>['-f','lavfi','-i',`color=c=${c}:s=64x64:r=24:d=1`]),'-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-y',file]);if(r.status!==0)throw Error(String(r.stderr))
    sources[name]='data:video/mp4;base64,'+fs.readFileSync(file).toString('base64')
  }
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {TimelineTransitions} from '${ui}/panels/TimelineTransitions';
    import {MonitorPanel} from '${ui}/panels/Monitor';
    import {createTransitionPreview} from '${ui}/fx/transitionPreview';
    import {bakeFxSpans} from '${ui}/fx/baker';
    import {dissolvePlans} from '${ui}/shared/transitions';
    import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';import {setMediaBase} from '${ui}/media';
    const tick=ms=>new Promise(r=>setTimeout(r,ms??50));
    const check=(ok,m)=>{if(!ok)throw Error(m)};
    const near=(a,b,m)=>check(a.slice(0,3).every((v,i)=>Math.abs(v-b[i])<24),m+': '+a+' expected '+b);
    export async function run(){
      const sources=${JSON.stringify(sources)};setMediaBase(file=>sources[file]);
      const clips=['a','b'].map(id=>({id,name:id,promptData:{duration:'3',beats:[],imageIds:[],freeform:''},takes:[{id:'take',file:id,durationSec:3}]}));
      const tl={id:'tl',name:'Test',exportFps:'24',videoTracks:1,items:[{id:'out',clipId:'a',startSec:0,inSec:.5,outSec:1.5,transitionOutSec:1,transitionAlignment:.5},{id:'in',clipId:'b',startSec:1,inSec:1,outSec:2}]};
      const project={dir:'synthetic',clips,audio:[],images:[],timelines:[tl],activeTimelineId:'tl'};
      let writes=[];useStore.setState({project,setTimelineItems:async(items,id)=>{writes.push({items,id})}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{position:'relative',width:800,height:100,marginTop:60,background:'#181a20'}}><div style={{position:'absolute',left:0,width:400,height:90,background:'#454a57',borderRight:'1px solid white'}}>Outgoing clip</div><div style={{position:'absolute',left:400,width:400,height:90,background:'#39475b'}}>Incoming clip</div><TimelineTransitions project={project} timeline={tl} track={0} total={2} onEdit={()=>{}}/></div>);await tick();
      const start=document.querySelector('[aria-label="Dissolve start handle"]');check(!!start,'left handle');check(!!document.querySelector('[aria-label="Dissolve end handle"]'),'right handle');
      start.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:200}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:100}));await tick();
      check(document.body.textContent.includes('1.25s'),'duration updates while dragging');window.dispatchEvent(new MouseEvent('mouseup'));await tick();
      check(writes.length===1&&writes[0].items[0].transitionOutSec===1.25,'one save on release');check(writes[0].items[0].startSec===0&&writes[0].items[1].startSec===1,'clip positions unchanged');
      const end=document.querySelector('[aria-label="Dissolve end handle"]');end.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:600}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:700}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new MouseEvent('mouseup'));await tick();check(writes.length===1,'Escape cancels drag');
      await window.capture();
      document.querySelector('[aria-label="Cross dissolve a"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));await tick();check(writes.length===2&&!writes[1].items[0].transitionOutSec,'Delete removes only transition');
      const empty={...tl,items:tl.items.map(it=>({...it,transitionOutSec:undefined}))};useStore.setState({project:{...project,timelines:[empty]}});
      root.render(<div style={{position:'relative',width:800,height:80}}><TimelineTransitions project={project} timeline={empty} track={0} total={2} onEdit={()=>{}}/></div>);await tick();
      document.querySelector('[aria-label="Add cross dissolve after a"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:400}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:350}));window.dispatchEvent(new MouseEvent('mouseup'));await tick();check(writes.length===3&&writes[2].items[0].transitionOutSec===.25&&writes[2].items[0].transitionAlignment===.5,'create centered transition by dragging cut marker');
      const locked={...tl,lockedTracks:['v0']};useStore.setState({project:{...project,timelines:[locked]}});root.render(<div style={{position:'relative',width:800,height:80}}><TimelineTransitions project={project} timeline={locked} track={0} total={2} onEdit={()=>{}}/></div>);await tick();
      const lockedHandle=document.querySelector('[aria-label="Dissolve end handle"]');check(!!lockedHandle,'locked transition indicator stays visible');lockedHandle.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:600}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:700}));window.dispatchEvent(new MouseEvent('mouseup'));await tick();check(writes.length===3,'locked handles cannot change transition');root.unmount();useStore.setState({project});
      const canvas=document.createElement('canvas');canvas.style.width='64px';canvas.style.height='64px';document.body.appendChild(canvas);
      let preview=createTransitionPreview(canvas,project,dissolvePlans(project,tl));
      const read=async(T)=>{for(let i=0;i<12;i++){preview.draw(T,false);await tick(20)}preview.draw(T,false);const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0);return [...ctx.getImageData(32,32,1,1).data]};
      near(await read(.75),[0,128,0],'moving pre-roll');near(await read(1.25),[0,32,191],'centered outgoing post-roll');near(await read(.5),[0,128,0],'scrub backwards');preview.dispose();
      const withFx={...tl,items:[{...tl.items[0],fx:{v:2,stack:[],blend:{mode:'normal',opacity:0}}},tl.items[1]]};
      preview=createTransitionPreview(canvas,project,dissolvePlans(project,withFx));near(await read(1.1),[0,0,255],'outgoing effects retained in transition');preview.dispose();
      const layered={...tl,videoTracks:2,items:[{...withFx.items[0],track:1},{...withFx.items[1],track:1,fx:withFx.items[0].fx},{id:'under',clipId:'a',track:0,startSec:0,inSec:0,outSec:1,speed:.25}]};const layeredProject={...project,timelines:[layered]};
      preview=createTransitionPreview(canvas,layeredProject,dissolvePlans(layeredProject,layered));near(await read(1.1),[255,0,0],'lower track remains behind transparent transition sources');preview.dispose();canvas.remove();
      const frames=[];setVidancerApi({fxBakeStart:async()=>({ok:true,id:'bake',file:'bake.mp4'}),fxEncodeFrame:async(id,rgba)=>{frames.push([...rgba.slice((32*64+32)*4,(32*64+32)*4+4)]);return true},fxEncodeEnd:async()=>({ok:true,file:'bake.mp4'}),fxSidecars:async()=>({})});
      const baked=await bakeFxSpans(project,tl,()=>{},{plan:{W:64,H:64,fps:24},signal:new AbortController().signal,onBake:()=>{}});
      check(baked.length===1&&frames.length===24,'entire centered transition baked');near(frames[18],[0,29,197],'baked moving overlap matches preview');
      frames.length=0;await bakeFxSpans(project,withFx,()=>{},{plan:{W:64,H:64,fps:24},signal:new AbortController().signal,onBake:()=>{}});near(frames[26],[0,0,255],'baked effects retained across cut');
      const noHandles={...tl,items:[{...tl.items[0],inSec:2,outSec:3},{...tl.items[1],inSec:0,outSec:1}]};check(dissolvePlans(project,noHandles)[0].repeated,'insufficient handles detected');check(!dissolvePlans(project,tl)[0].repeated,'valid handles not warned');
      const monitorRoot=createRoot(document.getElementById('root'));document.getElementById('root').style.height='280px';useStore.setState({project,tlTime:1.25,tlPlaying:false});monitorRoot.render(<MonitorPanel/>);await tick(500);
      const monitorCanvas=document.querySelector('[data-transition-preview]');check(monitorCanvas?.style.visibility==='visible','actual Monitor uses transition renderer');
      const sample=document.createElement('canvas');sample.width=sample.height=64;const ctx=sample.getContext('2d');ctx.drawImage(monitorCanvas,0,0,64,64);near([...ctx.getImageData(32,32,1,1).data],[0,32,191],'actual Monitor blend');
      useStore.setState(s=>({tlTime:1.75,seekTick:s.seekTick+1}));await tick(250);check(monitorCanvas.style.visibility==='hidden','transition surface clears after the overlap');monitorRoot.unmount();
      return 'drag duration / single save / Escape / Delete; actual GPU preview pixels; baked overlap pixels; source-handle warnings';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:50000,windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2];app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('capture',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:900,height:340,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>');await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'));win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'transition-handles.png'),(await win.webContents.capturePage()).toPNG()))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'));console.log('Screenshot: '+path.join(tmp,'transition-handles.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
