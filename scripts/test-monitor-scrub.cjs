// Actual Monitor A/B presentation while seeking; isolated synthetic media only.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-scrub-'))
  const sources = {}
  for (const color of ['red', 'green', 'blue']) {
    const file = path.join(tmp, color + '.mp4')
    const r = spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i',`color=c=${color}:s=128x128:r=24:d=3`,'-c:v','libx264','-pix_fmt','yuv420p','-y',file])
    if (r.status !== 0) throw Error(String(r.stderr))
    sources[color] = 'data:video/mp4;base64,' + fs.readFileSync(file).toString('base64')
  }
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  let monitor=ui+'/panels/Monitor'
  if(process.env.VD_SCRUB_BASELINE){
    const old=spawnSync('git',['-c','safe.directory=C:/Claude/koan-shared','-C',path.resolve(ui,'../..'),'show','5f4d4fa:vidancer-ui/src/panels/Monitor.tsx'],{encoding:'utf8'})
    if(old.status!==0)throw Error(old.stderr)
    monitor=path.join(tmp,'Monitor.tsx').replaceAll('\\','/')
    fs.writeFileSync(monitor,old.stdout.replace(/(['"])(\.\.?\/[^'"]+)\1/g,(_m,q,p)=>q+path.resolve(ui,'panels',p).replaceAll('\\','/')+q))
  }
  const code = require('esbuild').buildSync({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MonitorPanel} from '${monitor}';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api'; import {setMediaBase} from '${ui}/media';
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const frame=()=>new Promise(r=>requestAnimationFrame(r));
    export async function run(){
      const sources=${JSON.stringify(sources)};
      setMediaBase(f=>sources[f]);setVidancerApi({mirrorState:()=>{}});
      const colors=['red','green','blue'];
      const clips=colors.map(c=>({id:c,name:c,promptData:{duration:'3',beats:[],freeform:'',imageIds:[]},takes:[{id:c,file:c,durationSec:3}]}));
      const items=colors.map((c,i)=>({id:c,clipId:c,takeId:c,startSec:i*2,inSec:0,outSec:2,track:0}));
      const tl={id:'tl',items,videoTracks:1,videoMuted:true,audioItems:[],scoreItems:[]};
      useStore.setState({project:{dir:'synthetic',clips,timelines:[tl],activeTimelineId:'tl',audio:[],images:[],scoreClips:[],voiceClips:[]},tlTime:.2,tlPlaying:false});
      const root=createRoot(document.getElementById('root'));root.render(<MonitorPanel/>);await wait(600);
      const players=[...document.querySelectorAll('video')].slice(0,2);
      const visible=()=>players.filter(v=>v.style.visibility==='visible'&&Number(v.style.opacity)>0&&v.readyState>=2);
      if(!visible().length)throw Error('initial frame missing');
      const seek=t=>useStore.setState(s=>({tlTime:t,seekTick:s.seekTick+1}));
      const results={};
      for(const [label,times] of Object.entries({within:[.4,.8,1.3,.7],crossing:[2.4,4.6,.6,4.3,2.7,.4]})){
        let blanks=0,frames=0;
        for(const t of times){seek(t);for(let n=0;n<10;n++){await frame();frames++;if(!visible().length)blanks++;}
          const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.drawImage(visible()[0],0,0,16,16);const rgb=ctx.getImageData(8,8,1,1).data;
          if(rgb[Math.floor(t/2)]<80)throw Error('Wrong decoded clip after seek to '+t+': '+[...rgb]);
        }
        results[label]={blanks,frames};
      }
      for(let n=0;n<24;n++){seek([.3,2.7,4.3][n%3]);await frame();}
      seek(2.5);await wait(200);if(!visible().length)throw Error('Rapid scrubbing failed to settle');
      // This offscreen runtime suspends continuous video after about half a
      // second on both the baseline and corrected monitor. Keep the optional
      // diagnostic separate from seek/presentation assertions.
      if(${!!process.env.VD_SCRUB_PLAYTHROUGH}){
        seek(.2);await wait(200);useStore.setState({tlPlaying:true});await wait(6400);
        if(useStore.getState().tlTime<5.9)throw Error('Playback stopped early: '+useStore.getState().tlTime);
      }
      root.unmount();return results;
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:45000,windowsHide:true})
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status===0?0:1
} else {
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
  app.commandLine.appendSwitch('disable-background-media-suspend')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:900,height:720,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root" style="width:900px;height:700px"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'))
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    win.webContents.on('console-message',(_e,...args)=>console.log('PAGE',...args))
    const result=await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()')
    console.log(JSON.stringify(result));app.exit(Object.values(result).some(r=>r.blanks)?1:0)
  }catch(e){console.error(e);app.exit(1)}})
}
