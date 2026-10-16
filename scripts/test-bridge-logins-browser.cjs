// list 33 (2026-09-30) — several logins per bridge, in the Bridge panel: every login its own row
// and credit bar ("Higgsfield 1, 2, 3"), the ＋ that adds one and says what their login page does,
// the two ways in (their login in the browser, or the link for a private window), a row renamed
// by double-click, logout per login, an ended login that can be signed in again or taken away.
// The real panel, offscreen Electron; the app's side is a stand-in.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bridge-logins-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BridgePanel} from '${ui}/panels/BridgePanel';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const row=key=>document.querySelector('[data-login="'+key+'"]');
    const btn=(el,text)=>[...el.querySelectorAll('.btn')].find(b=>b.textContent.trim()===text);
    const type=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    export async function run(){
      const hf=(slot,label,balance,more={})=>({id:'higgsfield',slot,key:slot>1?'higgsfield#'+slot:'higgsfield',service:'Higgsfield',label,site:'https://higgsfield.ai',kind:'video',creditUnit:'credits',loggedIn:true,busy:false,balance,toolCount:84,...more});
      let rows=[
        hf(1,'Higgsfield 1',100),hf(2,'Higgsfield 2',900),
        {id:'runway',slot:1,key:'runway',service:'Runway',label:'Runway',site:'https://runwayml.com',kind:'video',creditUnit:'credits',loggedIn:false,busy:false},
        {id:'venice',slot:1,key:'venice',service:'Venice',label:'Venice',site:'https://venice.ai/settings/api',kind:'video',creditUnit:'credits',loggedIn:true,busy:false,balance:1240,auth:'key'}
      ];
      const calls=[];let answer=null;
      setVidancerApi(new Proxy({
        bridgeList:async()=>rows,bridgeRefresh:async()=>rows,getSettings:async()=>({codirEngine:'bridge'}),appBoot:async()=>Date.now(),
        bridgeLogin:async(id,slot)=>{calls.push(['login',id,slot]);return rows},
        bridgeLogout:async(id,slot)=>{calls.push(['logout',id,slot]);return rows},
        bridgeAdd:(id,copy)=>{calls.push(['add',id,copy]);return new Promise(r=>{answer=r})},
        bridgeRename:async(id,slot,name)=>{calls.push(['rename',id,slot,name]);rows=rows.map(r=>r.id===id&&r.slot===slot?{...r,name:name||undefined,label:name||'Higgsfield '+slot}:r);return rows}
      },{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const root=createRoot(document.getElementById('root'));root.render(<div style={{width:900,height:1000}}><BridgePanel/></div>);await tick(300);

      // every login its own row and its own credit bar
      check(row('higgsfield').textContent.includes('Higgsfield 1')&&row('higgsfield#2').textContent.includes('Higgsfield 2'),'two Higgsfield rows, numbered');
      check(row('higgsfield').textContent.includes('100 credits')&&row('higgsfield#2').textContent.includes('900 credits'),'each with its own credits');
      const ledger=k=>document.querySelector('[data-ledger="'+k+'"]').textContent;
      check(ledger('higgsfield').includes('HIGGS 1')&&ledger('higgsfield').includes('100 credits'),'the ledger numbers them: '+ledger('higgsfield'));
      check(ledger('higgsfield#2').includes('HIGGS 2')&&ledger('higgsfield#2').includes('900 credits'),'and gives each its bar: '+ledger('higgsfield#2'));
      check(ledger('runway').includes('RUNWAY')&&!ledger('runway').includes('RUNWAY 1'),'one login: no number');
      check(document.body.textContent.includes('3 accounts live'),'the pool counts every login');

      // the ＋ sits on a login that works; never on a key row or a logged-out one
      check(row('higgsfield').querySelector('[data-add]')&&row('higgsfield#2').querySelector('[data-add]'),'a ＋ on every logged-in login');
      check(!row('venice').querySelector('[data-add]')&&!row('runway').querySelector('[data-add]'),'none on a key row, none on a logged-out row');
      check(btn(row('runway'),'login')&&!btn(row('runway'),'✕'),'a logged-out supplier keeps its one login button');

      // the ＋ says what their page does, where he adds the login, before anything opens
      row('higgsfield').querySelector('[data-add]').click();await tick();
      const strip=()=>document.querySelector('[data-adding]');
      check(strip()&&strip().dataset.adding==='higgsfield','the strip opens under the row he clicked');
      check(strip().textContent.includes('Higgsfield signs out the browser’s current account before opening sign-in. Continue with Google to choose an account.'),'it says it: '+strip().textContent);
      check(calls.length===0,'nothing is opened by the ＋ itself');

      // their login in the browser
      btn(strip(),'open their login').click();await tick();
      check(JSON.stringify(calls)==='[["add","higgsfield",false]]','the browser login: '+JSON.stringify(calls));
      check(strip().textContent.includes('waiting for the browser login…')&&!btn(strip(),'open their login'),'it waits, with no second start');
      rows=[rows[0],rows[1],hf(3,'Higgsfield 3',400),rows[2],rows[3]];answer({rows});await tick();
      check(!strip()&&row('higgsfield#3').textContent.includes('400 credits'),'the new login is a new row, the strip closes');
      check(document.body.textContent.includes('4 accounts live'),'and it is in the pool');

      // the link, for a private window; a refusal is said in the strip and nothing is added
      row('higgsfield#3').querySelector('[data-add]').click();await tick();
      btn(strip(),'copy the link').click();await tick();
      check(JSON.stringify(calls[1])==='["add","higgsfield",true]','the link: '+JSON.stringify(calls[1]));
      check(strip().textContent.includes('the login link is on your clipboard in a moment — paste it into a private window and sign in there…'),'it says where the link went');
      answer({rows,error:'login timed out after 5 minutes — press LOGIN to try again'});await tick();
      check(strip().textContent.includes('login timed out after 5 minutes')&&btn(strip(),'open their login'),'the refusal shows where he clicked, with both ways in again');
      btn(strip(),'✕').click();await tick();check(!strip(),'the strip closes');

      // a row is renamed by double-click
      const name=()=>row('higgsfield#2').querySelector('span[title*="double-click"]');
      name().dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await tick();
      const input=row('higgsfield#2').querySelector('input');check(input&&input.placeholder==='Higgsfield 2','the name opens as a box');
      type(input,'Friend');await tick();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
      check(JSON.stringify(calls[2])==='["rename","higgsfield",2,"Friend"]','renamed: '+JSON.stringify(calls[2]));
      check(row('higgsfield#2').textContent.includes('Friend')&&ledger('higgsfield#2').includes('Friend'),'the row and the ledger carry his name');
      check(!row('venice').querySelector('span[title*="double-click"]'),'a key row has no name to change');

      // logout is per login
      btn(row('higgsfield#2'),'logout').click();await tick();
      check(JSON.stringify(calls[3])==='["logout","higgsfield",2]','logout names the login: '+JSON.stringify(calls[3]));

      // a login the supplier ended: sign it in again, or take the row away
      root.unmount();
      rows=[rows[0],hf(3,'Higgsfield 3',undefined,{loggedIn:false,toolCount:undefined,error:'session expired — log in again'})];
      const root2=createRoot(document.getElementById('root'));root2.render(<div style={{width:900,height:1000}}><BridgePanel/></div>);await tick(300);
      const gone=row('higgsfield#3');
      check(gone.textContent.includes('session expired — log in again'),'it says why: '+gone.textContent);
      btn(gone,'login').click();await tick();btn(gone,'✕').click();await tick();
      check(JSON.stringify(calls.slice(4))==='[["login","higgsfield",3],["logout","higgsfield",3]]','its own login, and a way to take it away: '+JSON.stringify(calls.slice(4)));
      root2.unmount();
      return 'several logins in the Bridge panel: a row and a credit bar per login, numbered; the ＋ on a working login says what their page does before anything opens; their login in the browser or the link for a private window; a refusal shown where he clicked; rename by double-click; logout per login; an ended login signs in again or goes';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, loader: { '.png': 'dataurl', '.css': 'empty' }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1000, height: 1100, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
