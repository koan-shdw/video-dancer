// list 7 (2026-09-30) — Shift-click on a Bin folder chip lights every folder from the last one clicked
// (Premiere's range); Ctrl-click still adds one. Same offscreen Electron harness as the other tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-folders-ui-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Foldered} from '${ui}/panels/Foldered';
    import {useStore} from '${ui}/store';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const folders=['A','B','C','D'].map(id=>({id,name:'Folder '+id,kind:'bin',parent:null}));
      const clips=['A','B','C','D'].map(f=>({id:'c'+f,name:'clip in '+f,folder:f,promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[]}));
      useStore.setState({project:{dir:'synthetic',name:'T',clips,images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[],activeTimelineId:'',folders},multiSel:null});
      const root=createRoot(document.getElementById('root'));
      root.render(<Foldered kind="bin" items={clips} renderItem={x=><span data-id={x.id}>{x.name}</span>}/>);await tick(200);
      const chip=n=>[...document.querySelectorAll('span[title^="Folder '+n+' ·"]')][0];
      const shown=()=>[...document.querySelectorAll('[data-id]')].map(el=>el.getAttribute('data-id')).sort().join(',');
      check(chip('A')&&chip('D'),'the four folder chips show');
      chip('A').dispatchEvent(new MouseEvent('click',{bubbles:true}));await tick();
      check(shown()==='cA','a click opens A: '+shown());
      chip('C').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await tick();
      check(shown()==='cA,cB,cC','Shift-click C = A through C: '+shown());
      chip('D').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));await tick();
      check(shown()==='cA,cB,cC,cD','Ctrl-click still adds one: '+shown());
      chip('B').dispatchEvent(new MouseEvent('click',{bubbles:true}));await tick();
      chip('D').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await tick();
      check(shown()==='cB,cC,cD','the range runs from the last folder clicked: '+shown());
      root.unmount();return 'shift-click = the range from the last folder clicked; ctrl-click adds one';
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
    const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    win.webContents.on('console-message',(_e,...a)=>console.log('PAGE',...a))
    await win.loadURL('data:text/html,<div id="root"></div>')
    console.log('PASS '+await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp,'checks.js'),'utf8')+'\nchecks.run()'))
    app.exit(0)
  }catch(e){console.log('Error '+(e&&e.message));app.exit(1)}})
}
