// list 6 (2026-09-30) — keepers are flags, in the real Clip Gen takes row: every keeper wears a lit ★,
// a click on a lit ★ unflags it, ~ flags / unflags the selected take, right-click has ★ keeper / ☆ not
// a keeper, ★ only shows just the keepers. Same offscreen Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-keepers-ui-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const stars=()=>document.querySelectorAll('[aria-label="keeper — click to take the flag off"]');
    const cards=()=>[...document.querySelectorAll('[data-nav]')].map(el=>el.getAttribute('data-nav')).filter(id=>/^t\\d$/.test(id));
    const card=id=>document.querySelector('[data-nav="'+id+'"]');
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      const calls=[];
      const api={projectRecents:async()=>[],keepersSet:async(kind,owner,ids,on)=>{calls.push([kind,owner,ids,on]);return null},getSettings:async()=>({}),modelsList:async()=>({rows:[]}),localStatus:async()=>({}),ltxStatus:async()=>({})};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const take=id=>({id,file:id+'.mp4',createdAt:0,durationSec:4,engine:'seedance2'});
      const clip={id:'k',name:'Kick',promptData:{engine:'seedance2',mode:'ref2v',freeform:'',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'4',resolution:'720p',aspectRatio:'auto',generateAudio:true},takes:[take('t1'),take('t2'),take('t3')],keeperIds:['t1','t3'],keeperTakeId:'t3'};
      const project={dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[{id:'tl',name:'T',aspectRatio:'16:9',items:[]}],activeTimelineId:'tl',folders:[]};
      useStore.setState({project,selectedClipId:'k'});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:900,height:1400}}><RenderPanel/></div>);await tick(500);
      check(JSON.stringify(cards())==='["t1","t2","t3"]','the three takes show: '+JSON.stringify(cards()));
      check(stars().length===2,'two keepers wear a lit ★ ('+stars().length+')');
      // ★ only
      const only=document.querySelector('[aria-label="keepers only"]');only.click();await tick();
      check(JSON.stringify(cards())==='["t1","t3"]','★ only shows just the keepers: '+JSON.stringify(cards()));
      only.click();await tick();
      check(cards().length===3,'★ only off: every take again');
      // a lit ★ clicked = its flag goes
      card('t1').querySelector('[aria-label="keeper — click to take the flag off"]').click();await tick();
      check(JSON.stringify(calls.pop())==='["clip","k",["t1"],false]','a click on T1\\'s lit ★ unflags it');
      // ~ on the selected take (Ctrl-click selects without flagging)
      card('t2').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));await tick();
      const box=card('t2').closest('[data-nav-box]');box.dispatchEvent(new KeyboardEvent('keydown',{key:'~',bubbles:true,cancelable:true}));await tick();
      check(JSON.stringify(calls.pop())==='["clip","k",["t2"],null]','~ toggles the selected take\\'s flag');
      // right-click: ★ keeper on an unflagged take
      card('t2').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));await tick();
      const entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='★ keeper').pop();
      check(!!entry,'right-click offers ★ keeper');entry.click();await tick();
      check(JSON.stringify(calls.pop())==='["clip","k",["t2"],true]','… and flags it');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();return 'lit ★ on every keeper, click a lit ★ = unflag, ~ = toggle the selection, right-click ★ keeper, ★ only';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|Error)/.test(l)||(r.status!==0&&/^PAGE/.test(l))).join('\n')+'\n');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1000,height:1500,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...a)=>console.log('PAGE',...a))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
