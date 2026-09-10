const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-image-crop-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ImageEditorPanel} from '${ui}/panels/ImageEditor';
    import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';import {setMediaBase} from '${ui}/media';
    import {resizeCropLayer,moveCropLayer,zoomCropLayer,cropSrcRect} from '${ui}/lib/imageCrop';
    const tick=()=>new Promise(r=>setTimeout(r,40));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const click=text=>{const el=[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===text);check(!!el,'button '+text+'; page: '+document.body.textContent.slice(0,600));el.click();};
    export async function run(){
      const initial={lx:0,ly:0,lw:300,lh:200};
      for(const h of ['n','s','e','w','nw','ne','sw','se']){const l=resizeCropLayer(initial,300,200,h,h.includes('w')?-90:90,h.includes('n')?-60:60);check(Math.abs(l.lw/l.lh-1.5)<1e-8,'proportions '+h);const moved=moveCropLayer(l,300,200,9999,-9999);check(moved.lx<=0&&moved.ly<=0&&moved.lx+moved.lw>=300&&moved.ly+moved.lh>=200,'coverage '+h);}
      const zoom=zoomCropLayer(initial,300,200,2);const back=resizeCropLayer(zoom,300,200,'se',-20,0);check(back.lw<zoom.lw,'inward corner can zoom out with horizontal movement');
      check(zoomCropLayer(zoom,300,200,.01).lw===300,'zoom floor');check(zoomCropLayer(zoom,300,200,100).lw===3000,'zoom ceiling');
      const source=document.createElement('canvas');source.width=300;source.height=200;const ctx=source.getContext('2d');for(const [i,c] of ['#ff0000','#00ff00','#0000ff'].entries()){ctx.fillStyle=c;ctx.fillRect(i*100,0,100,200)}
      const files={original:source.toDataURL()};setMediaBase(f=>files[f]+'#');
      let saved=[],fail=false;setVidancerApi({onImageProgress:()=>()=>{},imageCropSave:async req=>{saved.push(req);if(fail)throw Error('fixture save failure');const url=URL.createObjectURL(new Blob([req.bytes],{type:'image/png'}));files.crop=url;return {nodeId:'crop',delta:{images:[{id:'image',title:'@fixture',file:'crop'}],editSessions:[{id:'session',rootImageId:'image',originalFile:'original',primaryNodeId:'crop',nodes:[{id:'crop',parentId:null,file:'crop',prompt:req.label,refIds:[],createdAt:1}]}]}}}});
      const project={dir:'synthetic',name:'Crop',images:[{id:'image',title:'@fixture',file:'original'}],clips:[],editSessions:[],audio:[],styles:[],timelines:[],folders:[]};
      useStore.setState({project,editorImageId:'image',previewH:{...useStore.getState().previewH,imageEdit:300}});
      const root=createRoot(document.getElementById('root'));root.render(<ImageEditorPanel/>);await tick();await tick();click('crop');await tick();
      const canvas=()=>document.querySelector('[aria-label="Crop image position"]');check(!!canvas(),'crop opens');
      const wheel=async()=>{const r=canvas().getBoundingClientRect();canvas().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-Math.log(2)/.002,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));await tick();};
      const drag=async(el,dx,dy,cancel=false)=>{el.setPointerCapture=()=>{};const r=el.getBoundingClientRect();const args={bubbles:true,pointerId:1,button:0,clientX:r.x+r.width/2,clientY:r.y+r.height/2};el.dispatchEvent(new PointerEvent('pointerdown',args));el.dispatchEvent(new PointerEvent('pointermove',{...args,clientX:args.clientX+dx,clientY:args.clientY+dy}));await tick();el.dispatchEvent(new PointerEvent(cancel?'pointercancel':'pointerup',args));await tick();};
      const pix=()=>[...canvas().getContext('2d').getImageData(30,100,1,1).data];
      await wheel();check(document.body.textContent.includes('200%'),'wheel zoom');await drag(canvas(),-1000,0);check(pix()[1]===255,'pan reaches right half of source');const after=pix();await drag(canvas(),1000,0,true);check(JSON.stringify(pix())===JSON.stringify(after),'cancel restores pan');
      click('reset');await tick();check(document.querySelector('[aria-label="Crop zoom"]').textContent==='100%','reset');await drag(document.querySelector('[aria-label="Crop e handle"]'),100,0);check(document.querySelector('[aria-label="Crop zoom"]').textContent!=='100%','side resize zooms: '+document.body.textContent.slice(0,500));
      await wheel();await drag(canvas(),1000,0);check(pix()[0]===255,'drag image right exposes source left');
      await window.captureCrop();const expected=canvas().getContext('2d').getImageData(0,0,300,200).data;
      fail=true;click('apply');await tick();await tick();check(!!canvas()&&document.body.textContent.includes('fixture save failure'),'failed save preserves editable crop');
      fail=false;click('apply');click('apply');await tick();await tick();check(saved.length===2,'duplicate apply does not duplicate crop');check(!canvas(),'successful apply closes crop');
      const img=new Image();img.src=files.crop;await img.decode();check(img.naturalWidth===300&&img.naturalHeight===200,'output size retained');const out=document.createElement('canvas');out.width=300;out.height=200;out.getContext('2d').drawImage(img,0,0);const actual=out.getContext('2d').getImageData(0,0,300,200).data;check(actual.every((v,i)=>Math.abs(v-expected[i])<=1),'saved PNG matches preview within one channel level of canvas/PNG rounding; max channel difference '+actual.reduce((m,v,i)=>Math.max(m,Math.abs(v-expected[i])),0)+'; first mismatch '+actual.findIndex((v,i)=>v!==expected[i]));
      check(useStore.getState().project.editSessions[0].primaryNodeId==='crop','crop becomes primary');root.unmount();return 'all handles preserve aspect; zoom, pan bounds, pointer cancel, reset, retry, one save, primary and saved pixels';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:30000,windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)console.error(r.error);process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2];app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"require('electron').contextBridge.exposeInMainWorld('captureCrop',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}});win.webContents.on('console-message',(_e,...args)=>console.log('PAGE',...args));ipcMain.handle('capture',async()=>fs.writeFileSync(path.join(tmp,'crop.png'),(await win.webContents.capturePage()).toPNG()));await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>');await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'));console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'));console.log('Screenshot: '+path.join(tmp,'crop.png'));app.exit(0)}catch(e){console.error(e);app.exit(1)}})
}
