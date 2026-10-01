// list 48 (09-29) — "text and inuse should wrap under when its made this short": in the real LoRA
// sidebar, a narrow column puts a row's text and its "in use" button under the picture (nothing runs
// off the edge, a trigger chip keeps whole words); a wide one keeps them beside it. Same offscreen
// Electron harness as the other browser tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-lora-wrap-ui-'))
  const ui=path.resolve(__dirname,'../../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const code=require('esbuild').buildSync({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {setVidancerApi} from '${ui}/api';
    import {LoraSidebar, LORA_FAMILIES} from '${ui}/panels/ImageGenSidebar';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));
      const rows=[{root:'C:/loras',rel:'ink.safetensors',file:'ink.safetensors',name:'Ink Wash Painting Style Pro',bytes:180<<20,triggerWords:['inkwash style'],baseModel:'Krea 2',looked:true}];
      setVidancerApi(new Proxy({imageGenLoras:async()=>rows,imageGenFolders:async()=>[{path:'C:/loras',family:'krea2'}],getSettings:async()=>({})},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const mount=w=>{const el=document.createElement('div');el.style.cssText='width:'+w+'px;height:400px;display:flex;flex-direction:column';document.body.appendChild(el);createRoot(el).render(<LoraSidebar family={LORA_FAMILIES.krea2} picks={[{name:'ink.safetensors',weight:1}]} onUse={()=>{}} onUnuse={()=>{}}/>);return el};
      const narrow=mount(200),wide=mount(520);await tick(400);
      const parts=el=>{const body=el.querySelector('[data-lora-body]');const row=body.parentElement;const pic=row.firstElementChild;const btn=[...body.querySelectorAll('.btn')].find(b=>b.textContent.trim()==='in use');return {row:row.getBoundingClientRect(),pic:pic.getBoundingClientRect(),body:body.getBoundingClientRect(),btn:btn.getBoundingClientRect(),chip:[...body.querySelectorAll('span')].find(s=>s.textContent==='inkwash style').getBoundingClientRect()}};
      const n=parts(narrow),w=parts(wide);
      check(n.body.top>=n.pic.bottom-0.5,'narrow: the text and button sit under the picture '+JSON.stringify({pic:n.pic.bottom,body:n.body.top}));
      check(n.btn.right<=n.row.right+0.5,'narrow: "in use" stays inside the row '+JSON.stringify({btn:n.btn.right,row:n.row.right}));
      check(n.chip.height<20,'narrow: the trigger chip keeps its words on one line ('+n.chip.height+'px)');
      check(w.body.left>=w.pic.right&&w.body.top<w.pic.bottom,'wide: the text and button sit beside the picture');
      check(w.btn.right<=w.row.right+0.5,'wide: "in use" inside the row');
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'narrow column: text and "in use" under the picture, nothing off the edge, the chip whole; wide: beside it';
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
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../../koan-shared/vidancer-ui/src/styles.css'),'utf8')+'\n'+fs.readFileSync(path.resolve(__dirname,'../../koan-shared/styles/koan.css'),'utf8'))
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
