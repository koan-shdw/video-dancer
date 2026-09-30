// list 5 (2026-09-30) — export several timelines at once: the Bin's right-click on a picked set
// offers "export N timelines…", the run asks main for ONE folder and exports each (non-empty)
// timeline into it in order (batch), a cancel stops the rest; Settings' export card picks and
// clears the default folder. Same offscreen Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-export-many-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BinPanel} from '${ui}/panels/Bin'; import {SettingsModal} from '${ui}/panels/SettingsModal';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const has=s=>document.body.textContent.includes(s);
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      const runs=[],settings=[];let picks=0,cancelAt=-1;
      const api={projectRecents:async()=>[],getSettings:async()=>({exportDir:''}),setSettings:async p=>{settings.push(p);return {}},
        exportPickDir:async()=>{picks++;return 'D:/exports'},codirGuides:async()=>[],codirModels:async()=>[],codirBridgeModels:async()=>[],codirBridgeStatus:async()=>({}),settingsPickExportDir:async()=>'D:/chosen',
        exportRun:async(id,bakes,opts)=>{runs.push([id,opts]);return runs.length-1===cancelAt?{ok:false,error:'cancelled'}:{ok:true,file:'D:/exports/'+id+'.mp4'}}};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip={id:'c1',name:'c1',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'};
      const tl=(id,n)=>({id,name:id,aspectRatio:'16:9',items:Array.from({length:n},(_,i)=>({id:id+i,clipId:'c1',startSec:i*4,track:0}))});
      const project={dir:'synthetic',name:'Test',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl('One',1),tl('Two',2),tl('Empty',0)],activeTimelineId:'One',folders:[]};
      useStore.setState({project,multiSel:null});
      const root=createRoot(document.getElementById('root'));
      root.render(<div style={{width:900,height:900}}><BinPanel/></div>);await tick(400);
      // pick all three timeline tiles (ctrl-click), right-click one
      const tile=name=>[...document.querySelectorAll('[title^="click = show in Timeline"]')].find(d=>d.textContent.includes(name));
      check(tile('One')&&tile('Two')&&tile('Empty'),'the three timeline tiles show');
      tile('One').dispatchEvent(new MouseEvent('click',{bubbles:true}));await tick();
      for(const n of ['Two','Empty'])tile(n).dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));await tick();
      tile('Two').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}));await tick();
      const entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='export 3 timelines…').pop();
      check(!!entry,'right-click on the picked set offers export 3 timelines…');
      entry.click();await tick(300);
      check(picks===1,'one folder for the lot');
      check(JSON.stringify(runs)===JSON.stringify([['One',{batch:true}],['Two',{batch:true}]]),'each non-empty timeline exports into it, in order: '+JSON.stringify(runs));
      check(!useStore.getState().exportState.busy&&/exported 2 of 2/.test(useStore.getState().exportState.msg),'done: '+useStore.getState().exportState.msg);
      // a cancel stops the rest
      runs.length=0;cancelAt=0;
      await useStore.getState().startExportMany(['One','Two']);
      check(runs.length===1,'a cancel stops the rest');
      root.render(null);await tick();
      // Settings: the export card picks and clears the default folder
      root.render(<SettingsModal onClose={()=>{}}/>);await tick(300);
      const card=[...document.querySelectorAll('[data-fold]')].find(el=>el.textContent.replace(/[▸▾]/g,'').trim()==='export');
      check(!!card,'Settings has an export card: '+JSON.stringify([...document.querySelectorAll('[data-fold]')].map(el=>el.textContent))+' body: '+document.body.textContent.slice(0,300));card.click();await tick();
      check(has('ask each time'),'no folder yet: ask each time');
      [...document.querySelectorAll('span.btn')].find(b=>b.textContent.trim()==='choose…').click();await tick(150);
      check(has('D:/chosen'),'choose… shows the picked folder');
      [...document.querySelectorAll('span.btn')].find(b=>b.textContent.trim()==='ask each time').click();await tick(150);
      check(settings.some(p=>p.exportDir==='')&&!has('D:/chosen'),'ask each time clears it');
      check(!errors.length,'no errors: '+errors.join(' | '));
      root.unmount();return 'Bin: export N timelines… on a picked set, one folder, each non-empty timeline in order, cancel stops the rest; Settings export folder choose / clear';
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
    const win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...a)=>console.log('PAGE',...a))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
