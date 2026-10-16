// list 10 (10-11) — "lets default the civit lora for image gen to favorites": Image Gen's civit tab
// asks Civitai for his ★ favorites first; H3's side panel, a missing key and the PNG reader's
// "search civit" (a named lora) ask all of Civitai. Same offscreen Electron harness as lora-wrap.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-lora-fav-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {setVidancerApi} from '${ui}/api';
    import {LoraSidebar, ImageGenSidebar, LORA_FAMILIES} from '${ui}/panels/ImageGenSidebar';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      let key='k',calls=[];
      setVidancerApi(new Proxy({imageGenLoras:async()=>[],imageGenFolders:async()=>[],getSettings:async()=>({civitaiKey:key}),imageGenCivit:async(a)=>{calls.push(a);return {ok:true,items:[]}}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const p={picks:[],onUse:()=>{},onUnuse:()=>{}};
      const open=async(el)=>{const host=document.createElement('div');host.style.cssText='width:320px;height:400px;display:flex;flex-direction:column';document.body.appendChild(host);const root=createRoot(host);root.render(el);await tick(300);calls=[];[...host.querySelectorAll('*')].find(n=>n.textContent.trim()==='civit'&&!n.children.length).click();await tick(300);const star=[...host.querySelectorAll('span')].find(s=>s.textContent.includes('favorites'));const lit=getComputedStyle(star).color;root.unmount();host.remove();return {fav:calls[0]&&calls[0].favorites,lit}};
      const amber=(()=>{const s=document.createElement('span');s.style.color='var(--amber)';document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c})();
      const ig=await open(<ImageGenSidebar {...p}/>);
      check(ig.fav===true,'Image Gen: the civit tab asks for favorites first ('+ig.fav+')');
      check(ig.lit===amber,'Image Gen: ★ favorites shows lit ('+ig.lit+' vs '+amber+')');
      const h3=await open(<LoraSidebar family={LORA_FAMILIES.h3} {...p}/>);
      check(h3.fav===false,'H3: the civit tab stays on all of Civitai ('+h3.fav+')');
      key='';const nokey=await open(<ImageGenSidebar {...p}/>);key='k';
      check(nokey.fav===false,'no key: all of Civitai, favorites need the key ('+nokey.fav+')');
      calls=[];const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
      root.render(<ImageGenSidebar {...p} searchSeed="ink wash"/>);await tick(800);root.unmount();
      const seeded=calls.filter(c=>c.query==='ink wash');
      check(seeded.length&&seeded.every(c=>c.favorites===false),'search civit by name: all of Civitai '+JSON.stringify(calls));
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'Image Gen civit opens on favorites (lit); H3, no key and a named search ask all of Civitai';
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
    const win=new BrowserWindow({show:false,width:900,height:900,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../koan-shared/styles/koan.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
