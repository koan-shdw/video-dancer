// list 57 (10-01) — "create beat in score" from the timeline's right-click, in the real Timeline panel
// and Score card: the new blank beat lands at the spot's second of the score's span, the card opens on
// it with the row's text box focused; greyed with the reason off any score; a submenu when two
// scores play there; no entry with no score on the timeline. Same offscreen Electron harness.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-score-beat-ui-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {ScoreCardPanel} from '${ui}/panels/ScoreCard';
    import {setScoreCardOpener} from '${ui}/panelBus';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[],getSettings:async()=>({}),modelsList:async()=>({rows:[]})},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      let opened=0;setScoreCardOpener(()=>opened++);
      const sc=(id,name)=>({id,name,beats:[{id:id+'0',at:0,text:'Strings'}],recipe:{engine:'minimax-music-3',options:{durationSec:20}},takes:[]});
      const tl={id:'tl',name:'Main',aspectRatio:'16:9',items:[{id:'V',clipId:'c1',startSec:0,track:0}],audioItems:[],scoreItems:[{id:'S1',scoreClipId:'sa',startSec:2,spanSec:20}]};
      const project={dir:'synthetic',name:'Test',clips:[{id:'c1',name:'c1',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'}],images:[],audio:[],videos:[],charSheets:[],scoreClips:[sc('sa','Opening theme'),sc('sb','Drums')],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'tl',folders:[]};
      // the store's write lands on the project, sorted by time like main's
      const saveScoreClip=async(id,patch)=>useStore.setState(s=>({project:{...s.project,scoreClips:s.project.scoreClips.map(x=>x.id===id?{...x,...patch,beats:[...(patch.beats??x.beats)].sort((a,b)=>a.at-b.at)}:x)}}));
      useStore.setState({project,saveScoreClip});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',width:1500,height:700}}><div style={{width:1100}}><TimelinePanel/></div><div style={{width:400}}><ScoreCardPanel/></div></div>);await tick(400);
      const block=id=>[...document.querySelectorAll('div[title]')].find(d=>d.title.startsWith(id));
      // the scale from the 4 s clip on V1 (it starts at 0)
      const xAt=t=>{const r=document.querySelector('.vd-clip').getBoundingClientRect();return r.left+t*r.width/4};
      const row=[...document.querySelectorAll('div')].find(d=>d.style.borderBottom.includes('dashed')&&d.querySelector('.vd-clip'));
      check(row,'the V1 track row');
      const menuRow=label=>[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()===label).pop();
      const closeMenus=()=>[...document.querySelectorAll('div')].filter(d=>d.style.zIndex==='2500').forEach(d=>d.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
      const ctx=(el,x)=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:el.getBoundingClientRect().top+10}));
      const beats=id=>useStore.getState().project.scoreClips.find(x=>x.id===id).beats;
      // 1. the empty video track at 12 s: a blank beat at 10 s of the span
      ctx(row,xAt(12));await tick();
      const e1=menuRow('♪ create beat in score');check(e1,'the track’s right-click has create beat in score');
      e1.click();await tick(400);
      const nb=beats('sa').find(b=>!b.text);
      check(nb&&Math.abs(nb.at-10)<0.11,'a blank beat at the spot’s second of the span: '+JSON.stringify(beats('sa')));
      check(useStore.getState().editorScoreId==='sa'&&opened===1,'the Score card opens on that score');
      check(document.activeElement&&document.activeElement.getAttribute('data-beat-text')===nb.id,'its new row takes the keys');
      check(document.querySelectorAll('[data-beat-text]').length===2,'the card lists both beats');
      // 2. the score block's own right-click: at 7 s → 5 s
      ctx(block('Opening theme'),xAt(7));await tick();
      menuRow('♪ create beat in score').click();await tick(300);
      check(beats('sa').some(b=>!b.text&&Math.abs(b.at-5)<0.11),'the score block’s right-click adds one where clicked: '+JSON.stringify(beats('sa')));
      // 3. before the score starts: greyed, with the reason
      ctx(row,xAt(1));await tick();
      const g=menuRow('♪ create beat in score');
      check(g&&g.title.startsWith('no score under this spot')&&g.style.cursor==='default','off any score: greyed and says why');
      closeMenus();await tick();
      // 4. two scores stacked at 12 s (S1 and S2): a submenu names each, the pick gets the beat
      useStore.setState(s=>({project:{...s.project,timelines:[{...tl,scoreTracks:2,scoreItems:[...tl.scoreItems,{id:'S2',scoreClipId:'sb',startSec:8,spanSec:10,lane:1}]}]}}));await tick(200);
      ctx(row,xAt(12));await tick();
      const e4=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='♪ create beat in score▸').pop();
      check(e4,'two scores play here: a submenu');
      e4.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));await tick(200);
      const pick=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='Drums · S2').pop();
      check(pick,'the submenu names each score and its track');
      pick.click();await tick(300);
      check(beats('sb').some(b=>!b.text&&Math.abs(b.at-4)<0.11),'the picked score gets the beat at its own second: '+JSON.stringify(beats('sb')));
      check(useStore.getState().editorScoreId==='sb','… and the card follows it');
      // 5. no score on the timeline: no entry
      useStore.setState(s=>({project:{...s.project,timelines:[{...tl,scoreItems:[]}]}}));await tick(200);
      ctx(row,400);await tick();
      check(menuRow('◈ marker here')&&!menuRow('♪ create beat in score'),'no score on the timeline: no entry');
      closeMenus();
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();setScoreCardOpener(null);return 'right-click the track, a score block or empty ground: a blank beat at that second of the span, the card opens with the row focused; greyed off a score; a submenu for stacked scores; none without a score';
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
    const win=new BrowserWindow({show:false,width:1600,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
