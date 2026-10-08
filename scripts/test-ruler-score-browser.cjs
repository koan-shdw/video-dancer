// his asks of 10-01, in the real Timeline and Monitor panels: (1) the ruler stays at the top while the
// tracks scroll down, still scrubs and still shows the playhead; (2) a score gives the timeline its
// length, alone or running past the video (the readout, and play runs on in black to the score's
// end); (3) the S tracks are orange. Offscreen Electron, a stand-in API: nothing else runs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ruler-score-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {MonitorPanel} from '${ui}/panels/Monitor';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const near=(a,b,d=1.5)=>Math.abs(a-b)<=d;
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[],getSettings:async()=>({}),modelsList:async()=>({rows:[]}),mirrorState:()=>{}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const sc={id:'sa',name:'Opening theme',beats:[],recipe:{engine:'minimax-music-3',options:{durationSec:20}},takes:[]};
      const clip={id:'c1',name:'c1',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'};
      const tl={id:'tl',name:'Main',aspectRatio:'16:9',videoTracks:4,audioTracks:3,scoreTracks:2,items:[{id:'V',clipId:'c1',startSec:0,track:0}],audioItems:[],scoreItems:[{id:'S1',scoreClipId:'sa',startSec:2,spanSec:20}]};
      const project=(t)=>({dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[sc],voiceClips:[],styles:[],imageGens:[],timelines:[t],activeTimelineId:'tl',folders:[]});
      useStore.setState({project:project(tl),tlTime:0,tlPlaying:false});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',width:1100,height:260}}><div style={{width:1100}}><TimelinePanel/></div></div>);await tick(400);
      const ruler=document.querySelector('[title^="click or drag to scrub"]');
      const corner=document.querySelector('[title="right-click below for track actions (add / delete / lock)"]');
      check(ruler&&corner,'the ruler and the rail’s corner');
      let scroller=ruler.parentElement;while(scroller&&getComputedStyle(scroller).overflowY!=='auto')scroller=scroller.parentElement;
      check(scroller&&scroller.scrollHeight>scroller.clientHeight+100,'the tracks overflow the panel: '+(scroller&&scroller.scrollHeight)+' / '+(scroller&&scroller.clientHeight));
      const top=()=>scroller.getBoundingClientRect().top;
      check(near(ruler.getBoundingClientRect().top,top()),'at rest the ruler is at the top');
      const xAt=t=>{const r=document.querySelector('.vd-clip').getBoundingClientRect();return r.left+t*r.width/4};

      // ---- (1) scrolled down: the ruler and the corner stay at the top, on top ----
      scroller.scrollTop=140;await tick(150);
      check(scroller.scrollTop>100,'scrolled: '+scroller.scrollTop);
      check(near(ruler.getBoundingClientRect().top,top())&&near(corner.getBoundingClientRect().top,top()),'scrolled down, the ruler and the corner stay at the top: '+ruler.getBoundingClientRect().top+' / '+corner.getBoundingClientRect().top+' / '+top());
      const hit=document.elementFromPoint(xAt(2.5),top()+9);
      check(hit&&ruler.contains(hit),'the ruler is on top of the tracks scrolled under it: '+(hit&&hit.outerHTML.slice(0,80)));
      const pd=(type,x)=>ruler.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:top()+9,button:0,pointerId:1,pointerType:'mouse'}));
      pd('pointerdown',xAt(3));await tick();
      check(near(useStore.getState().tlTime,3,0.05),'a click on it moves the playhead: '+useStore.getState().tlTime);
      pd('pointermove',xAt(1));await tick();pd('pointerup',xAt(1));await tick();
      check(near(useStore.getState().tlTime,1,0.05),'a drag on it scrubs: '+useStore.getState().tlTime);
      const ph=[...ruler.children].find(d=>d.style.background==='var(--amber)'&&d.style.width==='2px');
      check(ph&&near(ph.getBoundingClientRect().left,xAt(1),2)&&near(ph.getBoundingClientRect().top,top()),'the playhead shows on the pinned ruler: '+(ph&&ph.getBoundingClientRect().left)+' vs '+xAt(1));
      scroller.scrollTop=0;await tick(150);
      check(near(ruler.getBoundingClientRect().top,top())&&ruler.style.transform==='translateY(0px)','scrolled back, it is where it was');

      // ---- (2) the timeline's length: a score past the video, then a score alone ----
      const readout=()=>[...document.querySelectorAll('.vd-tc')].map(e=>e.textContent).join(' | ');
      check(readout().includes('/ 00:00:22:00'),'a score running past the video gives the length (2 s + 20 s): '+readout());
      useStore.setState({project:project({...tl,items:[],scoreItems:[{id:'S1',scoreClipId:'sa',startSec:0,spanSec:20}]})});await tick(200);
      check(readout().includes('/ 00:00:20:00'),'a score alone gives the timeline its length: '+readout());

      // ---- (3) the S tracks are orange, apart from the amber accent and the green music ----
      const css=getComputedStyle(document.documentElement);
      check(css.getPropertyValue('--score').trim()==='#f5781e','the score colour: '+css.getPropertyValue('--score'));
      const block=document.querySelector('[title^="Opening theme · 20s span"]');
      check(block&&block.style.border.includes('var(--score)')&&block.style.background.includes('var(--score)')&&!block.style.cssText.includes('--music'),'the score block is drawn in the score colour: '+(block&&block.style.cssText.slice(0,200)));
      const sLabel=[...document.querySelectorAll('span')].find(e=>e.textContent==='S1');
      check(sLabel&&getComputedStyle(sLabel).color==='rgb(245, 120, 30)','its S label is orange: '+(sLabel&&getComputedStyle(sLabel).color));
      const aLabel=[...document.querySelectorAll('span')].find(e=>e.textContent==='A1');
      check(aLabel&&getComputedStyle(aLabel).color!=='rgb(245, 120, 30)','the A labels are not');
      root.unmount();

      // ---- (2b) play runs on past the last video to the score's end (the Monitor) ----
      useStore.setState({project:project({...tl,items:[],scoreItems:[{id:'S1',scoreClipId:'sa',startSec:0,spanSec:2.5}]}),tlTime:0,tlPlaying:false,tlLoop:false});
      const mroot=createRoot(document.getElementById('root'));mroot.render(<div style={{width:640,height:400}}><MonitorPanel/></div>);await tick(500);
      useStore.setState({tlPlaying:true});await tick(1600);
      check(useStore.getState().tlPlaying&&useStore.getState().tlTime>1.2,'a score alone plays past 1 s: '+useStore.getState().tlTime);
      await tick(1700);
      const st=useStore.getState();
      check(!st.tlPlaying&&near(st.tlTime,2.5,0.05),'… and stops at the score’s end: '+st.tlTime+' playing='+st.tlPlaying);
      mroot.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'the ruler stays at the top while the tracks scroll (the rail corner too), sits on top of them, scrubs, and shows the playhead; a score gives the timeline its length, past the video (22 s) or alone (20 s), and play runs on in black to its end; the S tracks are orange (#f5781e), their blocks and labels, the A labels not';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 90000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
