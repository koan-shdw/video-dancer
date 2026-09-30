// list 14 stage 3 (2026-09-30) — the Bridge panel's KEY row (Venice): "key set · N credits" and a
// settings button when the key is saved, "no key yet" and set key when it isn't, its credit in the
// pool beside the logins; the login rows keep login / logout. The real panel, offscreen Electron.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bridge-key-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BridgePanel} from '${ui}/panels/BridgePanel';
    import {setVidancerApi} from '${ui}/api'; import {setSettingsOpener} from '${ui}/panelBus';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const rowOf=label=>[...document.querySelectorAll('.vd-scroll > div')].find(d=>d.textContent.includes(label));
    export async function run(){
      let rows=[
        {id:'higgsfield',label:'Higgsfield',site:'https://higgsfield.ai',kind:'video',creditUnit:'credits',loggedIn:true,busy:false,balance:500,toolCount:84},
        {id:'runway',label:'Runway',site:'https://runwayml.com',kind:'video',creditUnit:'credits',loggedIn:false,busy:false},
        {id:'venice',label:'Venice',site:'https://venice.ai/settings/api',kind:'video',creditUnit:'credits',loggedIn:true,busy:false,balance:1240,auth:'key'}
      ];
      let opened=0,logins=[];
      if(typeof setSettingsOpener==='function')setSettingsOpener(()=>{opened++});
      setVidancerApi(new Proxy({bridgeList:async()=>rows,bridgeRefresh:async()=>rows,getSettings:async()=>({codirEngine:'bridge'}),appBoot:async()=>Date.now(),bridgeLogin:async id=>{logins.push(id);return rows},bridgeLogout:async id=>{logins.push('out:'+id);return rows}},{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const root=createRoot(document.getElementById('root'));root.render(<div style={{width:900,height:900}}><BridgePanel/></div>);await tick(300);
      const v=rowOf('Venice');check(v,'the Venice row shows');
      check(v.textContent.includes('● key set')&&v.textContent.includes('1,240 credits'),'key set + its credits: '+v.textContent);
      const vb=[...v.querySelectorAll('.btn')].pop();check(vb.textContent.trim()==='settings','its button = settings: '+vb.textContent);
      vb.click();await tick();
      check(logins.length===0,'a key row never starts a browser login');
      check(rowOf('Higgsfield').textContent.includes('● logged in')&&[...rowOf('Higgsfield').querySelectorAll('.btn')].pop().textContent.trim()==='logout','a login row keeps logout');
      check([...rowOf('Runway').querySelectorAll('.btn')].pop().textContent.trim()==='login','a logged-out login row keeps login');
      check(document.body.textContent.includes('VENICE'),'Venice is in the ledger');
      check(!v.querySelector('img')&&v.textContent.includes('V'),'no mark file = its initial on a tile');
      root.unmount();
      rows=rows.map(r=>r.id==='venice'?{...r,loggedIn:false,balance:undefined}:r);
      const root2=createRoot(document.getElementById('root'));root2.render(<div style={{width:900,height:900}}><BridgePanel/></div>);await tick(300);
      const v2=rowOf('Venice');
      check(v2.textContent.includes('○ no key yet'),'no key: '+v2.textContent);
      check([...v2.querySelectorAll('.btn')].pop().textContent.trim()==='set key','its button = set key');
      check(document.body.textContent.includes('no key — set it in Settings'),'the ledger says where the key goes');
      root2.unmount();return 'the Venice key row: key set + credits + settings, or no key yet + set key; login rows unchanged'+(opened?' (settings opened)':'');
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1000, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
