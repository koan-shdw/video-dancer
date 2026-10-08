// list 64 (10-02): Premiere's J/K/L shuttle. In the real Monitor on synthetic media (a clip that is red,
// then green, then blue, 1 s each, and a tone under it as a score): J plays backward (the picture
// walks back frame by frame, the sound is silent), J again twice as fast, backward to the start stops
// there (or goes round from the end with loop on); L plays at normal speed with sound, L again twice
// as fast (silent); K stops and puts the speed back. In the real Timeline: the keys themselves, up to
// 8×. Offscreen Electron, the remap Monitor test's harness.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-shuttle-'))
  const ff = (args) => { const r = spawnSync(require('ffmpeg-static'), args); if (r.status !== 0) throw Error(String(r.stderr)) }
  const vid = path.join(tmp, 'tri.mp4'), tone = path.join(tmp, 'tone.wav')
  ff(['-v', 'error', ...['red', 'green', 'blue'].flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=128x128:r=24:d=1`]), '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-g', '1', '-pix_fmt', 'yuv420p', '-y', vid])
  ff(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-y', tone])
  const sources = { tri: 'data:video/mp4;base64,' + fs.readFileSync(vid).toString('base64'), tone: 'data:audio/wav;base64,' + fs.readFileSync(tone).toString('base64') }
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MonitorPanel} from '${ui}/panels/Monitor';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api'; import {setMediaBase} from '${ui}/media';
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const sources=${JSON.stringify(sources)};
      setMediaBase(f=>sources[f]);setVidancerApi(new Proxy({projectRecents:async()=>[],getSettings:async()=>({}),modelsList:async()=>({rows:[]}),mirrorState:()=>{}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clips=[{id:'c',name:'c',promptData:{duration:'3',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'tri',durationSec:3}],keeperTakeId:'t'}];
      const scoreClips=[{id:'sc',name:'tone',beats:[],recipe:{engine:'minimax-music-3',options:{durationSec:3}},takes:[{id:'st',file:'tone',durationSec:3}],keeperTakeId:'st'}];
      const tl={id:'tl',name:'Main',items:[{id:'V',clipId:'c',takeId:'t',startSec:0,track:0}],videoTracks:1,audioItems:[],scoreItems:[{id:'S',scoreClipId:'sc',startSec:0,spanSec:3}]};
      useStore.setState({project:{dir:'synthetic',name:'T',clips,timelines:[tl],activeTimelineId:'tl',audio:[],images:[],videos:[],charSheets:[],scoreClips,voiceClips:[],styles:[],imageGens:[],folders:[]},tlTime:2.6,tlPlaying:false,tlLoop:false});
      const root=createRoot(document.getElementById('root'));root.render(<MonitorPanel/>);await wait(900);
      const st=()=>useStore.getState();
      const players=[...document.querySelectorAll('video')].slice(0,2);
      const visible=()=>players.find(v=>v.style.visibility==='visible'&&Number(v.style.opacity)>0);
      const pixel=async()=>{const v=visible();if(!v)return [0,0,0];const r=v.getBoundingClientRect();return window.monitorPixel({x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1});};
      const is=(rgb,ch)=>rgb[ch]>=80&&rgb[ch]>Math.max(...[0,1,2].filter(i=>i!==ch).map(i=>rgb[i]))*1.5;
      const sounds=()=>[...document.querySelectorAll('audio')];
      const out={};

      // ---- J: backward ----
      st().tlShuttle(-1);await wait(900);
      check(st().tlPlaying&&st().tlRate===-1,'J plays backward: '+st().tlRate);
      const t1=st().tlTime;out.after900msBack=t1.toFixed(2);
      check(t1>1.4&&t1<2.05,'the playhead walks back at normal speed (2.6 → about 1.7): '+t1);
      await wait(150);
      check(is(await pixel(),1),'the picture is the frame the playhead reached (green, second 1-2): '+[...await pixel()]);
      check(visible()&&visible().paused&&visible().muted,'the player is set frame by frame, not played forward, and silent');
      check(sounds().length&&sounds().every(a=>a.paused),'no sound plays backward');
      st().tlShuttle(-1);
      check(st().tlRate===-2,'J again: twice as fast: '+st().tlRate);
      await wait(450);
      const t2=st().tlTime;out.after450msAt2x=t2.toFixed(2);
      check(t2<t1-0.85&&t2>0,'twice as fast backward: '+t1+' → '+t2);
      await wait(150);
      check(is(await pixel(),0),'red by then (second 0-1): '+[...await pixel()]);
      await wait(900);
      check(!st().tlPlaying&&st().tlTime===0&&st().tlRate===1,'backward to the start stops there, the speed back to normal: '+st().tlTime+' '+st().tlPlaying+' '+st().tlRate);

      // ---- L: forward with sound, L again twice as fast and silent ----
      st().tlShuttle(1);await wait(700);
      check(st().tlRate===1&&st().tlTime>0.45&&st().tlTime<1.0,'L plays forward at normal speed: '+st().tlTime);
      check(visible()&&!visible().paused&&visible().playbackRate===1,'the player plays at 1×');
      check(sounds().some(a=>!a.paused),'with its sound');
      const t3=st().tlTime;
      st().tlShuttle(1);await wait(500);
      const t4=st().tlTime;out.forward2xIn500ms=(t4-t3).toFixed(2);
      check(st().tlRate===2&&t4-t3>0.75,'L again: twice as fast: '+t3+' → '+t4);
      check(visible()&&visible().playbackRate===2&&visible().muted&&sounds().every(a=>a.paused),'the player runs at 2×, silent');
      st().tlPause();await wait(100);
      check(!st().tlPlaying&&st().tlRate===1,'K stops and the speed is normal again');

      // ---- loop on: backward past the start goes round from the end ----
      useStore.setState(s=>({tlLoop:true,tlTime:0.3,seekTick:s.seekTick+1}));await wait(200);
      st().tlShuttle(-1);await wait(800);
      check(st().tlPlaying&&st().tlTime>2.2&&st().tlTime<3,'loop on: round again from the end: '+st().tlTime);
      st().tlPause();useStore.setState({tlLoop:false});
      root.unmount();await wait(100);

      // ---- the keys, in the real Timeline ----
      const troot=createRoot(document.getElementById('root'));troot.render(<div style={{display:'flex',width:900,height:300}}><div style={{width:900}}><TimelinePanel/></div></div>);await wait(400);
      const key=k=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
      const seq=[];
      for(const k of ['j','j','j','j','j','l','l','l','l','l','k']){key(k);await wait(20);seq.push(st().tlPlaying?st().tlRate:0)}
      out.keys=seq.join(',');
      check(seq.join(',')==='-1,-2,-4,-8,-8,1,2,4,8,8,0','J ×5, L ×5, K: '+seq.join(','));
      check(st().tlRate===1,'K leaves the speed at normal');
      troot.unmount();
      return out;
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 90000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron'), tmp = process.argv[2]
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.commandLine.appendSwitch('disable-background-media-suspend')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const preload = path.join(tmp, 'preload.js'); fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('monitorPixel',rect=>require('electron').ipcRenderer.invoke('monitor-pixel',rect))")
    const win = new BrowserWindow({ show: false, width: 900, height: 720, webPreferences: { preload, sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    ipcMain.handle('monitor-pixel', async (_e, rect) => { const bytes = (await win.webContents.capturePage(rect)).toBitmap(); return [bytes[2], bytes[1], bytes[0]] })
    await win.loadURL('data:text/html,<div id="root" style="width:900px;height:700px"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    const res = await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()')
    console.log('PASS J/K/L: J walks the picture back frame by frame (silent), J again twice as fast, backward to the start stops there (loop on: round from the end); L forward with sound, L again twice as fast (silent); K stops and resets; the keys double up to 8× ' + JSON.stringify(res))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
