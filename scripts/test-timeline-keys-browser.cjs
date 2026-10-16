// his report 2026-09-29: "copy/cut paste in timeline doesnt work". A block press cancels its
// default (drags need it), which also cancelled the focus move — a text box clicked earlier kept
// the keys and Ctrl+C / X / V went into it. REAL input here (sendInputEvent, not synthetic
// events): click a text box, click a block, Ctrl+C, move the playhead, Ctrl+V, Ctrl+X — with the
// app's Edit-menu roles installed like the real app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-tl-keys-'))
  const ui=path.resolve(__dirname,'../koan-shared/vidancer-ui/src').replaceAll('\\','/')
  const bootstrap=path.join(tmp,'bootstrap.ts').replaceAll('\\','/')
  fs.writeFileSync(bootstrap,`import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code=require('esbuild').buildSync({stdin:{contents:`
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store';
    import {tlClipboardKey} from '${ui}/lib/tlClipboardKeys';
    import {setActivePanelGetter} from '${ui}/panelBus';
    export const activePanel=id=>setActivePanelGetter(()=>id);
    export const writes=[];
    export async function setup(){
      setVidancerApi(new Proxy({projectRecents:async()=>[]},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const clip={id:'c1',name:'red',promptData:{duration:'4',beats:[],freeform:'',imageIds:[]},takes:[{id:'t',file:'c1.mp4',durationSec:4}],keeperTakeId:'t'};
      const tl={id:'par',name:'Main',aspectRatio:'16:9',items:[{id:'A',clipId:'c1',startSec:0,track:0}],audioItems:[],scoreItems:[]};
      const project={dir:'x',name:'T',clips:[clip],images:[],audio:[],videos:[],charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'par',folders:[]};
      // the one write paste and cut make — applied to the project so the panel follows
      const setTimelineAll=async(items,audioItems,scoreItems,id)=>{writes.push(items.map(x=>[x.id,x.startSec]));useStore.setState(s=>({project:{...s.project,timelines:s.project.timelines.map(t=>t.id===id?{...t,items,audioItems,scoreItems}:t)}}))};
      useStore.setState({project,setTimelineAll});
      // the app's own gate, then its clipboard keys (App.tsx)
      window.addEventListener('keydown',e=>{const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;if(e.ctrlKey||e.metaKey)tlClipboardKey(e)});
      createRoot(document.getElementById('root')).render(<div><input id="probe" style={{width:200}}/><div style={{width:1100,height:700}}><TimelinePanel/></div></div>);
      await new Promise(r=>setTimeout(r,400));
      const r=el=>{const b=el.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}};
      return JSON.stringify({input:r(document.getElementById('probe')),block:r(document.querySelector('.vd-clip'))});
    }
    export const seek=t=>useStore.setState({tlTime:t});
    export const state=()=>JSON.stringify({writes,focus:document.activeElement.id||document.activeElement.tagName,typed:document.getElementById('probe').value,clip:!!useStore.getState().tlClipboard});
  `,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom')},bundle:true,format:'iife',globalName:'keys',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}}).outputFiles[0].text
  fs.writeFileSync(path.join(tmp,'keys.js'),code)
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const r=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:60000,windowsHide:true})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|FAIL)/.test(l)).join('\n')+'\n');if(r.status!==0)process.stderr.write(r.stderr||'');process.exitCode=r.status===0?0:1
}else{
  const {app,BrowserWindow,Menu}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'delete'},{role:'selectAll'}]}]))
    const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname,'../koan-shared/vidancer-ui/src/styles.css'),'utf8'))
    const js=s=>win.webContents.executeJavaScript(s)
    const pos=JSON.parse(await js(fs.readFileSync(path.join(tmp,'keys.js'),'utf8')+'\nkeys.setup()'))
    win.webContents.focus()
    const wait=ms=>new Promise(r=>setTimeout(r,ms))
    const click=async(p)=>{win.webContents.sendInputEvent({type:'mouseDown',x:p.x,y:p.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:p.x,y:p.y,button:'left',clickCount:1});await wait(150)}
    const key=async(c)=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:c,modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:c,modifiers:['control']});await wait(150)}
    const check=(v,m)=>{if(!v)throw Error(m)}
    await click(pos.input) // a text box has the keys first (the case that broke)
    await click(pos.block)
    await key('C')
    let s=JSON.parse(await js('keys.state()'))
    check(s.clip,'Ctrl+C copied the clicked block (focus was: '+s.focus+')')
    await js('keys.seek(6)')
    await key('V')
    s=JSON.parse(await js('keys.state()'))
    check(s.writes.length===1&&s.writes[0].length===2&&s.writes[0][1][1]===6,'Ctrl+V pasted a copy at the playhead (6s): '+JSON.stringify(s.writes))
    check(s.typed==='','nothing landed in the text box')
    await key('X') // the pasted copy is selected after a paste — cut takes it back out
    s=JSON.parse(await js('keys.state()'))
    check(s.writes.length===2&&s.writes[1].length===1&&s.writes[1][0][0]==='A','Ctrl+X cut the selected block: '+JSON.stringify(s.writes))
    // audit 2026-10-09 M33: with another panel active (the Library), Ctrl+V is that panel's paste, never a
    // timeline block dropped over the footage
    await key('C')
    await js('keys.activePanel("library")')
    await js('keys.seek(2)')
    const before=JSON.parse(await js('keys.state()')).writes.length
    await key('V')
    s=JSON.parse(await js('keys.state()'))
    check(s.writes.length===before,'Ctrl+V in the Library pasted nothing onto the timeline: '+JSON.stringify(s.writes.slice(before)))
    await js('keys.activePanel("timeline")')
    await key('V')
    s=JSON.parse(await js('keys.state()'))
    check(s.writes.length===before+1,'and with the timeline active it pastes again')
    console.log('PASS a text box clicked first no longer eats the keys: Ctrl+C copies, Ctrl+V pastes at the playhead, Ctrl+X cuts (real clicks + keys, Edit menu installed)')
    app.exit(0)
  }catch(e){console.log('FAIL '+(e&&e.message));app.exit(1)}})
}
