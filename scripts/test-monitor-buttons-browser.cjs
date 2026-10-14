// Both monitors' button rows, driven by REAL mouse input (sendInputEvent) in hidden Electron with the
// real stylesheets: the Clip Monitor's ▶ button plays and pauses its take, and at every panel width the
// two rows fold instead of piling buttons on top of each other (his reports 2026-10-14: the Clip
// Monitor's play button did nothing; on a narrow Timeline Monitor volume, loop, camera and details overlapped).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-monitor-buttons-'))
  const r0 = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(tmp, 'take.mp4')])
  if (r0.status !== 0) throw new Error(String(r0.stderr))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {SourceMonitor} from '${ui}/panels/SourceMonitor';import {MonitorPanel} from '${ui}/panels/Monitor';
    import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';import {setMediaBase} from '${ui}/media';
    const tick=(ms=60)=>new Promise(r=>setTimeout(r,ms));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const pd={engine:'seedance2',mode:'ref2v',freeform:'',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'4',resolution:'720p',aspectRatio:'4:3',generateAudio:true};
    export async function open(which,src){
      setMediaBase(()=>src);
      const api={projectRecents:async()=>[],getSettings:async()=>({})};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip={id:'c',name:'strokes',promptData:pd,takes:[{id:'t1',file:'take.mp4',createdAt:0,durationSec:4,engine:'seedance2'}],keeperTakeId:'t1'};
      const project={dir:'synthetic',name:'T',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],editSessions:[],timelines:[{id:'tl',name:'T',aspectRatio:'4:3',items:[{id:'i1',clipId:'c',takeId:'t1',startSec:0}]}],activeTimelineId:'tl',folders:[]};
      useStore.setState({project,selectedClipId:'c',editTimelineIndex:null,tlTime:0,tlPlaying:false});
      window.__root?.unmount();window.__root=createRoot(document.getElementById('root'));
      window.__root.render(which==='clip'?<SourceMonitor/>:<MonitorPanel/>);
      for(let i=0;i<60&&!(document.querySelector('video')?.readyState>=2);i++)await tick();
      return state();
    }
    export function width(px){document.getElementById('root').style.width=px+'px';return tick(120).then(state)}
    // the transport row = the first row that holds the details button
    export function state(){
      const det=[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('details'));
      const row=det.closest('[style*="flex-wrap"]');
      const btns=[...row.querySelectorAll('.btn')].map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim()||b.title,x:r.x,y:r.y,w:r.width,h:r.height,c:[r.x+r.width/2,r.y+r.height/2]}});
      const rr=row.getBoundingClientRect();
      const hit=btns.map(b=>{const el=document.elementFromPoint(b.c[0],b.c[1]);return {t:b.t,top:!!el&&[...row.querySelectorAll('.btn')].find(x=>x.contains(el))?.textContent.trim()===b.t||el?.closest('.btn')?.title===b.t}});
      const overlaps=[];for(let i=0;i<btns.length;i++)for(let j=i+1;j<btns.length;j++){const a=btns[i],b=btns[j];if(a.x<b.x+b.w-0.5&&b.x<a.x+a.w-0.5&&a.y<b.y+b.h-0.5&&b.y<a.y+a.h-0.5)overlaps.push(a.t+' × '+b.t)}
      const outside=btns.filter(b=>b.x<rr.x-0.5||b.x+b.w>rr.x+rr.width+0.5).map(b=>b.t);
      const v=document.querySelector('video');
      const play=btns.find(b=>b.t===''||/play \\/ pause/.test(b.t))??btns.find(b=>b.t.startsWith('play'));
      return {btns,hit,overlaps,outside,rowW:Math.round(rr.width),paused:v?.paused,ready:v?.readyState,play:document.querySelector('.btn[title^="play / pause"]')?.getBoundingClientRect().toJSON()};
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 90000, windowsHide: true })
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); if (r.error) console.error(r.error); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]; app.setPath('userData', path.join(tmp, 'profile'))
  const assert = (ok, msg) => { if (!ok) throw Error(msg) }
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true, autoplayPolicy: 'no-user-gesture-required' } })
      win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
      await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>')
      await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8'))
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8'))
      const src = 'data:video/mp4;base64,' + fs.readFileSync(path.join(tmp, 'take.mp4')).toString('base64')
      const page = async (js) => JSON.parse(JSON.stringify(await win.webContents.executeJavaScript(js)))
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra })
      const click = async ([x, y]) => { send('mouseMove', x, y); await wait(20); send('mouseDown', x, y, { button: 'left', clickCount: 1 }); await wait(20); send('mouseUp', x, y, { button: 'left', clickCount: 1 }); await wait(250) }
      const done = []

      // the Clip Monitor's ▶ button, real clicks
      let s = await page(`checks.open('clip',${JSON.stringify(src)})`)
      assert(s.ready >= 2 && s.paused, 'the take loads, paused: ' + JSON.stringify({ ready: s.ready, paused: s.paused }))
      const pb = s.play
      assert(pb, 'the play / pause button is there')
      await click([pb.x + pb.width / 2, pb.y + pb.height / 2])
      s = await page('checks.state()')
      assert(s.paused === false, 'a click on ▶ plays the take: ' + JSON.stringify({ paused: s.paused, hit: s.hit }))
      await click([pb.x + pb.width / 2, pb.y + pb.height / 2])
      s = await page('checks.state()')
      assert(s.paused === true, 'a second click pauses it')
      done.push('Clip Monitor ▶ plays and pauses on real clicks')

      // both rows at every width: no button on top of another, none outside the row, each one clickable
      for (const which of ['clip', 'timeline']) {
        await page(`checks.open('${which}',${JSON.stringify(src)})`)
        for (let w = 700; w >= 160; w -= 20) {
          s = await page(`checks.width(${w})`)
          assert(!s.overlaps.length, `${which} monitor at ${w}px: buttons on top of each other: ${s.overlaps.join(', ')}`)
          assert(!s.outside.length, `${which} monitor at ${w}px: buttons outside the row: ${s.outside.join(', ')}`)
          assert(s.hit.every((h) => h.top), `${which} monitor at ${w}px: a button is covered: ${JSON.stringify(s.hit.filter((h) => !h.top))}`)
        }
        done.push(`${which} monitor row folds cleanly from 700 to 160 px`)
      }
      console.log('PASS ' + done.join(' · '))
      app.exit(0)
    } catch (e) { console.error(e); app.exit(1) }
  })
}
