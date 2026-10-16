// list 22, his test note 10-02: "This needs to be added as a caragoty to the bin, cannot be dragged into
// timeline", then "of course theyre clip effect not score" (v24). Sound fx get their own Bin card with their
// own folders, and they land on the A tracks: where dropped on an A track, else the first A track free there;
// from the Bin tile or straight out of the SFX card (a take). Pink, hatched until rendered; a click on one
// points the SFX card at it. The real Bin and Timeline panels in
// offscreen Electron; the app's API is a stand-in, so nothing is written anywhere.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-sfx-bin-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
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
      const bare={id:'bare',kind:'sfx',name:'Boing',beats:[],recipe:{engine:'sonilo-sfx'},takes:[]};
      const clip={id:'c1',name:'c1',promptData:{duration:'10',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:10}],keeperTakeId:'t'};
      const tl={id:'tl',name:'Main',aspectRatio:'16:9',videoTracks:1,audioTracks:1,scoreTracks:1,items:[{id:'V',clipId:'c1',startSec:0,track:0}],audioItems:[],scoreItems:[]};
      let folders=[{id:'fs',name:'Foley',kind:'sfx',parent:null},{id:'fm',name:'Themes',kind:'score',parent:null}];
      const project={dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[music,fx,bare],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'tl',folders};
      const made=[],added=[],moved=[],writes=[],alls=[],metas=[];
      useStore.setState({project,tlTime:0,
        createScoreClip:async(name,kind)=>{made.push(kind??'music');return null},
        addFolder:async(kind,name,parent)=>{added.push([kind,name]);folders=[...folders,{id:'new',name,kind,parent}];useStore.setState(s=>({project:{...s.project,folders}}));return 'new'},
        moveItems:async(kind,ids,folder)=>{moved.push([kind,ids,folder])},
        setTimelineScoreItems:async(id,items)=>{writes.push(items);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,scoreItems:items}:t)}}))},
        setTimelineAll:async(items,audioItems,scoreItems,id)=>{alls.push(audioItems);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,items,audioItems,scoreItems}:t)}}))},
        setTimelineMeta:async(m,id)=>{metas.push(m);useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,...m}:t)}}))}});
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
      // ---- v24: onto the A tracks. The music sits on S1 the whole time and never moves ----
      await useStore.getState().setTimelineScoreItems('tl',[{id:'M',scoreClipId:'music',startSec:0,spanSec:30}]);await tick(250);
      const scoreWrites=writes.length;
      const laneEl=()=>[...document.querySelectorAll('span')].find(x=>x.textContent==='♪ scores').parentElement;
      const rowY=t=>{const b=[...document.querySelectorAll('span')].find(x=>x.textContent===t).getBoundingClientRect();return b.top+b.height/2};
      const tileOf=name=>[...card('sound fx').querySelectorAll('[draggable="true"]')].find(d=>d.title&&d.title.startsWith('sound fx')&&d.textContent.includes(name));
      // a drag from a Bin tile, or a take straight out of the SFX card, dropped at f across the row's track
      const dropAt=async(row,f,from)=>{const R=laneEl().getBoundingClientRect(),x=R.left+R.width*f,y=rowY(row),el=document.elementFromPoint(x,y);check(el,'something under '+row);
        const d=new DataTransfer();if(typeof from==='string')tileOf(from).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:d}));else d.setData('vd/score-take',JSON.stringify(from));
        let accepted=false;for(const t of ['dragenter','dragover','drop']){const ev=new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:d,clientX:x,clientY:y});el.dispatchEvent(ev);if(t==='dragover')accepted=ev.defaultPrevented}
        await tick(250);return accepted};
      const fxBlocks=()=>(alls[alls.length-1]||[]).filter(a=>a.source&&a.source.sfxId);
      // on the S track, over the clip: A1 holds the clip's own sound, so a new A2
      check(await dropAt('S1',0.2,'Door'),'an S track takes the drag');
      let b=fxBlocks();
      check(b.length===1&&b[0].lane===1&&Math.abs(b[0].outSec-b[0].inSec-1.5)<0.01&&JSON.stringify(b[0].source)==='{"sfxId":"fx"}'&&JSON.stringify(metas)==='[{"audioTracks":2}]','dropped on S1 over the clip: on a new A2, as long as its take: '+JSON.stringify({b,metas}));
      // a take straight out of the SFX card, on the V track past the clip: A1 is free there
      check(await dropAt('V1',0.6,{scoreClipId:'fx',takeId:'ft'}),'a V track takes the drag');
      b=fxBlocks();
      const fromCard=b.find(a=>a.source.takeId==='ft');
      check(b.length===2&&fromCard&&fromCard.lane===0,'a take from the SFX card, dropped on V1 past the clip: on A1, playing that take: '+JSON.stringify(b));
      // on an A track: exactly there (A2 here, though A1 is free at that second)
      check(await dropAt('A2',0.75,'Boing'),'an A track takes the drag');
      b=fxBlocks();
      const boing=b.find(a=>a.source.sfxId==='bare');
      check(boing&&boing.lane===1&&Math.abs(boing.outSec-boing.inSec-5)<0.01,'dropped on A2: on A2, not rendered yet = 5 s to stretch over the footage: '+JSON.stringify(boing));
      check(writes.length===scoreWrites&&useStore.getState().project.timelines[0].scoreItems.map(x=>x.id).join()==='M','no sound fx ever went to the S tracks; the music stayed');
      // ---- the block: pink; hatched while nothing is rendered; a click points the SFX card at it ----
      await tick(200);
      const blockOf=name=>[...document.querySelectorAll('[title]')].find(e=>e.title.startsWith(name+' · sound fx'));
      const door=blockOf('Door'),boingEl=blockOf('Boing');
      check(door&&boingEl,'both sound fx blocks draw on the A tracks');
      const rgbOf=c=>c.startsWith('color(srgb ')?c.slice(11).split(' ').slice(0,3).map(x=>Math.round(Number(x)*255)).join(','):c.replace('rgba(','').replace('rgb(','').split(',').slice(0,3).map(x=>x.trim()).join(',');
      check(rgbOf(getComputedStyle(door).borderTopColor)==='232,96,156','pink (the sound fx colour): '+getComputedStyle(door).borderTopColor);
      check(boingEl.querySelector('[data-sfx-hatch]')&&!door.querySelector('[data-sfx-hatch]'),'hatched until rendered (Boing), a rendered one as long as its take is not (Door)');
      const db=door.getBoundingClientRect();
      door.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:db.left+db.width/2,clientY:db.top+5,button:0}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:db.left+db.width/2,clientY:db.top+5}));await tick(150);
      check(useStore.getState().editorSfxId==='fx'&&useStore.getState().selectedAudioItemId,'a click selects it and points the SFX card at it: '+useStore.getState().editorSfxId);
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();
      return 'sound fx have their own Bin card after scores, with their own folders; the music stays in scores; a sound fx lands on the A tracks (v24): where dropped on an A track, else the first A track free there (a new one when none), from its Bin tile or as a take out of the SFX card; pink, hatched until rendered; a click points the SFX card at it; the music never moves';
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
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
