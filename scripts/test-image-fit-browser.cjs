// list 11 (10-11) — "make the preview monitor automatically max to the height of the image", "no
// black bars": the Image Editor's canvas box takes the image's height at its width (a wide image, a
// tall one up to the handle's ceiling), a drag on the handle (real input) stays, a width change refits.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-image-fit-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ImageEditorPanel} from '${ui}/panels/ImageEditor';
    import {useStore} from '${ui}/store';import {setVidancerApi} from '${ui}/api';import {setMediaBase} from '${ui}/media';
    const tick=(ms=120)=>new Promise(r=>setTimeout(r,ms));const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const pic=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#f00';x.fillRect(0,0,w,h);return c.toDataURL()};
    export async function run(){
      const files={wide:pic(300,200),tall:pic(200,600)};setMediaBase(f=>files[f]+'#');
      setVidancerApi(new Proxy({},{get:(t,k)=>typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const project={dir:'synthetic',name:'Fit',images:[{id:'w',title:'wide',file:'wide'},{id:'t',title:'tall',file:'tall'}],clips:[],editSessions:[],audio:[],styles:[],timelines:[],folders:[]};
      useStore.setState({project,editorImageId:'w',previewH:{...useStore.getState().previewH,imageEdit:360}});
      const host=document.getElementById('root');host.style.width='900px';
      createRoot(host).render(<ImageEditorPanel/>);await tick(400);
      const img=()=>document.querySelector('img[crossorigin]');const box=()=>img().parentElement;
      // the painted picture inside the object-fit: contain element
      const bars=()=>{const i=img(),s=Math.min(i.offsetWidth/i.naturalWidth,i.offsetHeight/i.naturalHeight);return {box:box().clientHeight,w:box().clientWidth,ph:Math.round(i.naturalHeight*s),pw:Math.round(i.naturalWidth*s)}};
      let b=bars();
      check(Math.abs(b.box-Math.round(b.w*200/300))<=1&&Math.abs(b.ph-b.box)<=1&&Math.abs(b.pw-b.w)<=1,'wide image (300 px, smaller than the box): grows to fill it, no bars '+JSON.stringify(b));
      useStore.setState({editorImageId:'t'});await tick(400);b=bars();const cap=box().parentElement.clientHeight-160;
      check(Math.abs(b.box-cap)<=1&&Math.abs(b.ph-b.box)<=1,'tall image: box at the ceiling ('+cap+'), picture fills its height '+JSON.stringify(b));
      [...document.querySelectorAll('.btn')].find(e=>e.textContent.trim().startsWith('draw')).click();await tick(300);
      const ov=[...box().querySelectorAll('canvas')].find(c=>c.style.cursor==='crosshair').getBoundingClientRect(),ir=img().getBoundingClientRect();
      check(Math.abs(ov.height-b.ph)<=1&&Math.abs(ov.width-b.pw)<=1&&Math.abs(ov.left-(ir.left+(ir.width-b.pw)/2))<=1,'the draw layer sits on the picture, not the element '+JSON.stringify({ov:[ov.left,ov.width,ov.height],pic:[ir.left+(ir.width-b.pw)/2,b.pw,b.ph]}));
      [...document.querySelectorAll('.btn')].find(e=>e.textContent.trim().startsWith('draw')).click();await tick(100);
      useStore.setState({editorImageId:'w'});await tick(400);const fit=bars().box;
      const handle=[...document.querySelectorAll('[title="drag to resize the canvas"]')][0];const r=handle.getBoundingClientRect();
      await window.realDrag(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),-80);await tick(300);
      check(Math.abs(bars().box-(fit-80))<=2,'a drag on the handle stays: '+bars().box+' vs '+(fit-80));
      host.style.width='700px';await tick(400);b=bars();
      check(Math.abs(b.box-Math.round(b.w*200/300))<=1&&Math.abs(b.ph-b.box)<=1,'width change refits '+JSON.stringify(b));
      return 'a small wide image grows to fill the box with no bars, a tall one stops at the handle ceiling, the draw layer sits on the picture, a handle drag (real input) stays, a width change refits';
    }
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'checks',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'checks.js'),code);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|Error)/.test(l)).join('\n')+'\n');if(r.status!==0)process.stderr.write((r.stderr||'').slice(-2000));process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,ipcMain}=require('electron'),tmp=process.argv[2];app.setPath('userData',path.join(tmp,'profile'))
  const preload=path.join(tmp,'preload.js');fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('realDrag',(x,y,dy)=>ipcRenderer.invoke('drag',x,y,dy))")
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{preload,sandbox:true,backgroundThrottling:false,offscreen:true}})
    const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
    ipcMain.handle('drag',async(_e,x,y,dy)=>{const s=(type,yy,extra={})=>win.webContents.sendInputEvent({type,x,y:yy,button:'left',clickCount:1,...extra});s('mouseMove',y);s('mouseDown',y);await wait(30);for(let i=1;i<=8;i++){s('mouseMove',y+Math.round(dy*i/8),{modifiers:['leftButtonDown']});await wait(15)}s('mouseUp',y+dy);await wait(30)})
    await win.loadURL('data:text/html,<div id="root" style="height:100vh"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
