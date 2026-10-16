// list 56 (SPEED-RAMPS-SPEC-2026-10-01) — a time-remapped block in the real Monitor: the picture under
// the playhead is the source second its speed line reaches (red 0–1 s of the take at 50 % = the
// block's first 2 s, then green and blue at 200 %), the player's rate is the line's speed there, and
// its own sound never comes from the retimed picture (the player stays muted; a normal-speed player
// sings it). Isolated synthetic media in offscreen Electron, the scrub test's harness.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-remap-mon-'))
  const ff = (args) => { const r = spawnSync(require('ffmpeg-static'), args); if (r.status !== 0) throw Error(String(r.stderr)) }
  const file = path.join(tmp, 'tri.mp4')
  ff(['-v', 'error', ...['red', 'green', 'blue'].flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=128x128:r=24:d=1`]), '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file])
  const sources = { tri: 'data:video/mp4;base64,' + fs.readFileSync(file).toString('base64') }
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MonitorPanel} from '${ui}/panels/Monitor';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api'; import {setMediaBase} from '${ui}/media';
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const frame=()=>new Promise(r=>requestAnimationFrame(r));
    export async function run(){
      const sources=${JSON.stringify(sources)};
      setMediaBase(f=>sources[f]);setVidancerApi(new Proxy({mirrorState:()=>{}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clips=[{id:'c',name:'c',promptData:{duration:'3',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'tri',durationSec:3}],keeperTakeId:'t'}];
      const tl={id:'tl',items:[{id:'R',clipId:'c',takeId:'t',startSec:0,inSec:0,outSec:3,track:0,remap:{keys:[{at:1}],speeds:[.5,2]}}],videoTracks:1,audioItems:[],scoreItems:[]};
      useStore.setState({project:{dir:'synthetic',clips,timelines:[tl],activeTimelineId:'tl',audio:[],images:[],scoreClips:[],voiceClips:[]},tlTime:.2,tlPlaying:false});
      const root=createRoot(document.getElementById('root'));root.render(<MonitorPanel/>);await wait(700);
      const players=[...document.querySelectorAll('video')].slice(0,2);
      const visible=()=>players.find(v=>v.style.visibility==='visible'&&Number(v.style.opacity)>0);
      const pixel=async()=>{const v=visible();if(!v)return [0,0,0];const r=v.getBoundingClientRect();return window.monitorPixel({x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1});};
      const seek=async t=>{useStore.setState(s=>({tlTime:t,seekTick:s.seekTick+1}));for(let n=0;n<14;n++)await frame();await wait(120)};
      const out={};
      for(const [t,ch,rate] of [[1.5,0,.5],[2.25,1,2],[2.75,2,2],[.5,0,.5]]){
        await seek(t);
        const rgb=await pixel();
        const v=visible();
        if(!v)throw Error('nothing on screen at '+t);
        if(rgb[ch]<80||rgb[ch]<Math.max(...[0,1,2].filter(i=>i!==ch).map(i=>rgb[i]))*1.5)throw Error('wrong picture at '+t+' (the line puts source '+(t<2?t/2:1+(t-2)*2)+' s there): '+[...rgb]);
        if(Math.abs(v.playbackRate-rate)>1e-6)throw Error('the player rate at '+t+' is '+v.playbackRate+', the line says '+rate);
        if(!v.muted)throw Error('the retimed picture must not sing at '+t);
        out[t]=[...rgb].join(',')+' @'+v.playbackRate;
      }
      root.unmount();return out;
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron'), tmp = process.argv[2]
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.commandLine.appendSwitch('disable-background-media-suspend')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const preload = path.join(tmp, 'preload.js'); fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('monitorPixel',rect=>require('electron').ipcRenderer.invoke('monitor-pixel',rect))")
    const win = new BrowserWindow({ show: false, width: 900, height: 720, webPreferences: { preload, sandbox: true, backgroundThrottling: false, offscreen: true } })
    ipcMain.handle('monitor-pixel', async (_e, rect) => { const bytes = (await win.webContents.capturePage(rect)).toBitmap(); return [bytes[2], bytes[1], bytes[0]] })
    await win.loadURL('data:text/html,<div id="root" style="width:900px;height:700px"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../koan-shared/vidancer-ui/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../koan-shared/styles/koan.css'), 'utf8'))
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    const res = await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()')
    console.log('PASS the Monitor on a remapped block: the picture the line reaches, the rate the line is at, a muted picture (its sound plays at normal speed) ' + JSON.stringify(res))
    app.exit(0)
  } catch (e) { console.error(e); app.exit(1) } })
}
