// list 22, his test note 10-02: "This needs to be added as a caragoty to the bin, cannot be dragged into
// timeline". Sound fx get their own Bin card with their own folders, and they drop onto the timeline's S
// tracks from that card and straight out of the SFX card (a take). The real Bin and Timeline panels in
// offscreen Electron; the app's API is a stand-in, so nothing is written anywhere.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-sfx-bin-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BinPanel} from '${ui}/panels/Bin';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      setVidancerApi(new Proxy({projectRecents:async()=>[],getSettings:async()=>({})},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const music={id:'music',name:'Theme',beats:[],recipe:{engine:'minimax-music-3'},takes:[]};
      const fx={id:'fx',kind:'sfx',name:'Door',beats:[],recipe:{engine:'sonilo-sfx'},takes:[{id:'ft',file:'door.wav',durationSec:1.5}],keeperTakeId:'ft'};
      const clip={id:'c1',name:'c1',promptData:{duration:'10',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:10}],keeperTakeId:'t'};
      const tl={id:'tl',name:'Main',aspectRatio:'16:9',videoTracks:1,audioTracks:1,scoreTracks:1,items:[{id:'V',clipId:'c1',startSec:0,track:0}],audioItems:[],scoreItems:[]};
      let folders=[{id:'fs',name:'Foley',kind:'sfx',parent:null},{id:'fm',name:'Themes',kind:'score',parent:null}];
      const project={dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[music,fx],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'tl',folders};
      const made=[],added=[],moved=[],writes=[];
      useStore.setState({project,tlTime:0,
        createScoreClip:async(name,kind)=>{made.push(kind??'music');return null},
        addFolder:async(kind,name,parent)=>{added.push([kind,name]);folders=[...folders,{id:'new',name,kind,parent}];useStore.setState(s=>({project:{...s.project,folders}}));return 'new'},
        moveItems:async(kind,ids,folder)=>{moved.push([kind,ids,folder])},
        setTimelineScoreItems:async(id,items)=>{writes.push(items);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,scoreItems:items}:t)}}))}});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{display:'flex',width:1340,height:760}}><div style={{width:420,height:760,overflow:'auto'}}><BinPanel/></div><div style={{width:900}}><TimelinePanel/></div></div>);await tick(500);
      const cards=()=>[...document.querySelectorAll('[title="drag the card to reorder · click the title to fold"]')];
      const card=t=>cards().find(c=>c.textContent.trim().replace(/^[▾▸]/,'').startsWith(t));
      // ---- its own card, beside scores, with its own folders ----
      const sfxCard=card('sound fx'),scoreCard=card('scores');
      check(sfxCard&&scoreCard,'a sound fx card and the scores card: '+cards().map(c=>c.textContent.trim().slice(0,12)).join(' | '));
      check(cards().indexOf(sfxCard)===cards().indexOf(scoreCard)+1,'the sound fx card sits right after scores');
      check(sfxCard.textContent.includes('Door')&&!sfxCard.textContent.includes('Theme'),'the sound fx card holds the sound fx, not the music: '+sfxCard.textContent.slice(0,80));
      check(scoreCard.textContent.includes('Theme')&&!scoreCard.textContent.includes('Door'),'the scores card holds only music');
      check(sfxCard.textContent.includes('Foley')&&!sfxCard.textContent.includes('Themes')&&scoreCard.textContent.includes('Themes')&&!scoreCard.textContent.includes('Foley'),'each card shows only its own folders');
      [...sfxCard.querySelectorAll('.btn')].find(b=>b.textContent.trim()==='sound fx').click();await tick();
      check(made.join()==='sfx','its ＋ makes a sound fx: '+made.join());
      // a tile's right-click → new folder…: a sound fx folder, the sound fx moved into it
      const tile=()=>[...sfxCard.querySelectorAll('[draggable="true"]')].find(d=>d.title&&d.title.startsWith('sound fx'));
      check(tile(),'the Door tile');
      const tr=tile().getBoundingClientRect();
      tile().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:tr.left+10,clientY:tr.top+10}));await tick(150);
      const entry=[...document.querySelectorAll('div')].filter(d=>/^new folder/.test(d.textContent.trim())).pop();
      check(entry,'the right-click offers a new folder');
      entry.click();await tick(150);
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='OK').click();await tick(200);
      check(JSON.stringify(added)==='[["sfx","New Folder"]]'&&moved.length===1&&moved[0][0]==='sfx'&&moved[0][1].join()==='fx','new folder = a sound fx folder holding it: '+JSON.stringify({added,moved}));
      // ---- drag onto the timeline: the Bin tile, then a take straight out of the SFX card ----
      const lane=[...document.querySelectorAll('span')].find(s=>s.textContent==='♪ scores').parentElement;
      const lr=lane.getBoundingClientRect();
      const drop=async(dt,x)=>{for(const t of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:lr.top+6}));await tick(200)};
      let dt=new DataTransfer();tile().dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
      await drop(dt,lr.left+lr.width*0.2);
      let last=writes[writes.length-1]||[];
      check(last.length===1&&last[0].scoreClipId==='fx'&&Math.abs(last[0].spanSec-1.5)<0.01,'the Bin tile lands on the S track, as long as its take: '+JSON.stringify(last));
      dt=new DataTransfer();dt.setData('vd/score-take',JSON.stringify({scoreClipId:'fx',takeId:'ft'}));
      await drop(dt,lr.left+lr.width*0.6);
      last=writes[writes.length-1]||[];
      const fromCard=last.find(x=>x.takeId==='ft');
      check(last.length===2&&fromCard&&fromCard.scoreClipId==='fx'&&Math.abs(fromCard.spanSec-1.5)<0.01,'a take dragged out of the SFX card lands too, playing that take: '+JSON.stringify(last));
      // ---- his 10-02 retry: dropped on an A or a V track it still lands, on an S track (Premiere routes media
      // to its own kind of track), on the first one free at that second, never carving the music there ----
      const metas=[];useStore.setState({setTimelineMeta:async(m,id)=>{metas.push(m);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,...m}:t)}}))}});
      await useStore.getState().setTimelineScoreItems('tl',[{id:'M',scoreClipId:'music',startSec:0,spanSec:30}]);await tick(250);
      const laneEl=()=>[...document.querySelectorAll('span')].find(x=>x.textContent==='♪ scores').parentElement;
      const rowY=t=>{const b=[...document.querySelectorAll('span')].find(x=>x.textContent===t).getBoundingClientRect();return b.top+b.height/2};
      const dropAt=async(row,f)=>{const R=laneEl().getBoundingClientRect(),x=R.left+R.width*f,y=rowY(row),el=document.elementFromPoint(x,y);check(el,'something under '+row);
        const d=new DataTransfer();tile().dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:d}));
        let accepted=false;for(const t of ['dragenter','dragover','drop']){const ev=new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:d,clientX:x,clientY:y});el.dispatchEvent(ev);if(t==='dragover')accepted=ev.defaultPrevented}
        await tick(250);return accepted};
      check(await dropAt('A1',0.3),'an A track takes the drag (no “no drop” cursor)');
      last=writes[writes.length-1]||[];
      const onA=last.find(x=>x.scoreClipId==='fx'),M=last.find(x=>x.id==='M');
      check(onA&&(onA.lane??0)===1&&JSON.stringify(metas)==='[{"scoreTracks":2}]','dropped on A1 over the music: a new S track below it: '+JSON.stringify({onA,metas}));
      check(M&&M.startSec===0&&M.spanSec===30&&!(M.lane),'the music on S1 is not carved: '+JSON.stringify(M));
      check(await dropAt('V1',0.6),'a V track takes the drag too');
      last=writes[writes.length-1]||[];
      const onV=last.filter(x=>x.scoreClipId==='fx').pop();
      check(onV&&onV!==onA&&(onV.lane??0)>=1&&last.find(x=>x.id==='M').spanSec===30,'dropped on V1: on the first free S track, the music untouched: '+JSON.stringify(last));
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();
      return 'sound fx have their own Bin card after scores, with their own folders (a right-click new folder makes a sound fx folder); the music stays in scores; a sound fx drops onto the S track from its Bin tile and as a take straight out of the SFX card, as long as its take; dropped on an A or V track it lands on the first free S track (a new one when none), never carving the music';
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
    const win=new BrowserWindow({show:false,width:1400,height:820,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
