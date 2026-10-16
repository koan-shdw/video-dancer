const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-additions-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Foldered} from '${ui}/panels/Foldered'; import {DissolveModal} from '${ui}/panels/DissolveModal';
    import {ImageGenPanel} from '${ui}/panels/ImageGen';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    import {applyDissolves,dissolveTargets} from '${ui}/lib/dissolves';
    import {selectionMenu} from '${ui}/lib/selectionMenu';
    import {dropImageGenReference} from '${ui}/lib/imageGenReferenceDrop';
    import {MIME_IMAGE,MIME_GENTAKE} from '${ui}/lib/dragDrop';
    const tick=()=>new Promise(r=>setTimeout(r,65)),check=(v,m)=>{if(!v)throw Error(m)};
    const button=s=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===s);
    const menu=s=>[...document.querySelectorAll('div')].find(b=>b.textContent.trim()===s);
    const click=(el,ctrlKey=false)=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey}));
    const context=el=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:150,clientY:150}));
    export async function run(){
      const root=createRoot(document.getElementById('root'));let deletes=[],patches=[];
      const noop=()=>()=>{};
      const api={projectRecents:async()=>[],assetsDelete:async s=>{deletes.push(s);return null},imageGenStatus:async()=>({official:[],civit:[],running:false}),onModelsDone:noop,onImageGenProgress:noop,imageGenLoras:async()=>[],onImageGenLoraScan:noop,onLorasDone:noop,onImageGenDlDone:noop,imageGenFolders:async()=>[],getSettings:async()=>({}),onImageGenDlProgress:noop,onImageGenFolders:noop};
      // every event listener the renderer subscribes to (onX) answers with a no-op unsubscribe, so a
      // panel growing a new listener never breaks this harness again (onLorasDone, onLorasProgress, 2026-09-29)
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:(typeof k==='string'&&/^on[A-Z]/.test(k)?noop:undefined)}));
      const clips=['c1','c2','c3'].map(id=>({id,name:id,promptData:{duration:'2',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'sample.mp4',durationSec:2}]}));
      const tl={id:'tl',name:'Timeline',items:clips.map((c,i)=>({id:c.id,clipId:c.id,startSec:i*2,inSec:0,outSec:2})),audioItems:[],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips,images:[{id:'i1',file:'one.png',title:'one'},{id:'i2',file:'two.png',title:'two'}],audio:[{id:'a1'},{id:'a2'}],videos:[{id:'v1'},{id:'v2'}],charSheets:[],scoreClips:[],voiceClips:[{id:'voice1'},{id:'voice2'}],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'tl',folders:[]};
      useStore.setState({project,multiSel:null});
      const single=()=>[{label:'rename one',onClick:()=>{}},{label:'delete one',danger:true,onClick:()=>{}}];
      root.render(<><Foldered kind="bin" items={clips} renderItem={x=><span data-id={x.id}>{x.name}</span>} itemMenu={single}/><Foldered kind="lib" items={project.images} renderItem={x=><span data-id={x.id}>{x.title}</span>} itemMenu={single}/></>);await tick();
      const item=id=>document.querySelector('[data-id="'+id+'"]');
      click(item('c1'));await tick();click(item('c2'),true);await tick();context(item('c1'));await tick();
      check(!!menu('delete 2 selected'),'same-kind multi-delete visible');check(!menu('rename one'),'single rename excluded');
      menu('delete 2 selected').click();await tick();button('Delete 2').click();await tick();
      check(JSON.stringify(deletes[0])===JSON.stringify({clipIds:['c1','c2']}),'both selected clips passed in one call');
      click(item('c1'));await tick();click(item('i1'),true);await tick();context(item('i1'));await tick();
      check(!!menu('delete 2 selected'),'mixed multi-delete visible');menu('delete 2 selected').click();await tick();button('Delete 2').click();await tick();
      check(deletes[1].clipIds[0]==='c1'&&deletes[1].imageIds[0]==='i1','cross-section selection preserved');
      click(item('c1'));await tick();click(item('c2'),true);await tick();context(item('c3'));await tick();check(!!menu('delete one')&&!menu('delete 2 selected'),'right-click outside resets to single');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));root.render(null);await tick();
      for(const [kind,ids] of [['audio',['a1','a2']],['video',['v1','v2']],['voice',['voice1','voice2']]]){useStore.getState().setMultiSel(kind,ids);const entries=selectionMenu(kind,ids[0],single());check(entries.some(e=>e.label==='delete 2 selected')&&!entries.some(e=>e.label==='rename one'),kind+' bulk selection');}
      const applied=applyDissolves(project,tl,['c1','c2','c3'],.75);check(applied.changed===2&&applied.items[0].transitionOutSec===.75&&!applied.items[2].transitionOutSec,'two adjacent cuts only');
      check(tl.items.every(i=>!i.transitionOutSec),'input not mutated');
      check(applyDissolves(project,tl,['c1'],99).items[0].transitionOutSec===2,'duration clamped');
      check(applyDissolves(project,{...tl,lockedTracks:['v0']},['c1'],.5).changed===0,'locked track protected');
      check(applyDissolves(project,{...tl,items:[tl.items[0],{...tl.items[1],startSec:3}]},['c1'],.5).changed===0,'gap excluded');
      check(applyDissolves(project,{...tl,items:applied.items},['c1','c2'],null).changed===2,'remove both');
      useStore.setState({project,setTimelineItems:async(items,id)=>{patches.push({items,id})}});
      root.render(<DissolveModal project={project} timeline={tl} itemIds={['c1','c2','c3']} onClose={()=>root.render(null)}/>);await tick();
      check(document.body.textContent.includes('2 of 3 selected'),'eligibility shown');button('1s').click();await tick();button('Apply dissolves').click();await tick();
      check(patches.length===1&&patches[0].id==='tl'&&patches[0].items[1].transitionOutSec===1,'modal saves batch once to intended timeline');
      const recipe={model:'krea2',prompt:'Keep this prompt',aspect:'1:1',megapixels:'1',batch:1,steps:20,guidance:3,refOn:true,refBoost:1,refBoostB:1,loraOn:false,loras:[],unleashedOn:false,unleashedWeight:1};
      const gen={id:'g',name:'Image gen',recipe,takes:[{id:'take',file:'take.png',snapshot:recipe}]};
      project.imageGens=[gen,{...gen,id:'other',takes:[{id:'otherTake',file:'other.png',snapshot:recipe}]}];
      let copies=0,saves=[];
      const save=async(id,patch)=>{saves.push({id,patch});useStore.setState(s=>({project:{...s.project,imageGens:s.project.imageGens.map(g=>g.id===id?{...g,recipe:{...g.recipe,...patch.recipe}}:g)}}))};
      useStore.setState({project,editorImageGenId:'g',saveImageGen:save,imageGenToLibrary:async(g,t)=>{copies++;return g==='g'?'i1':'i2'}});
      root.render(<ImageGenPanel/>);await tick();
      const data=new DataTransfer();const takeCard=[...document.querySelectorAll('[draggable=true]')].find(el=>el.title?.includes('seed'));
      check(!!takeCard,'actual take card exists: '+document.body.textContent);takeCard.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      check(JSON.parse(data.getData(MIME_GENTAKE)).takeId==='take','actual take drag payload');
      const refA=document.querySelector('[title^="ref A —"]');check(!!refA,'reference drop target');
      refA.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));refA.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));await tick();
      check(copies===1&&saves.some(s=>s.patch.recipe.refA==='i1'),'take dropped onto reference A');
      const libData=new DataTransfer();libData.setData(MIME_IMAGE,'two.png');document.querySelector('[title^="ref B —"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:libData}));await tick();
      check(saves.some(s=>s.patch.recipe.refB==='i2')&&copies===1,'library drop onto reference B still works');
      check(useStore.getState().project.imageGens[0].recipe.prompt==='Keep this prompt','reference assignment preserves prompt');
      const other=new DataTransfer();other.setData(MIME_GENTAKE,JSON.stringify({imageGenId:'other',takeId:'otherTake'}));await dropImageGenReference('g','refA',other);check(copies===2&&saves.at(-1).patch.recipe.refA==='i2','take from another image gen');
      await window.saveScreenshot();root.render(null);await tick();
      const malformed=new DataTransfer();malformed.setData(MIME_GENTAKE,'bad json');let rejected=false;try{await dropImageGenReference('g','refA',malformed)}catch{rejected=true}check(rejected,'malformed take rejected');
      let release;useStore.setState({imageGenToLibrary:()=>new Promise(r=>release=r)});const pending=dropImageGenReference('g','refA',other);useStore.setState({project:{...project,dir:'another-project'}});release('i2');rejected=false;try{await pending}catch{rejected=true}check(rejected,'project change protected');
      root.unmount();return 'selection menus and batch request; dissolve constraints and controls; actual Image Gen take drag and A/B drops; project ownership';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:45000,windowsHide:true})
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('saveScreenshot',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...args)=>console.log('PAGE',...args)); ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'image-references.png'),(await win.webContents.capturePage()).toPNG()))
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../koan-shared/styles/koan.css'),'utf8'))
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    console.log('Screenshot: '+path.join(tmp,'image-references.png'));app.exit(0)
  }catch(e){console.error(e);app.exit(1)}})
}
