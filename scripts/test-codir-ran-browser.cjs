// list 31, 08-27 brief item 9 (2026-09-30) — the write log he can read. Under each Co-Director
// reply, the tools it ran in that reply, as the app recorded them; a reply that ran nothing, and
// his own messages, show none. The real panel, offscreen Electron, the app's API mocked.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-ran-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {CoDirectorPanel} from '${ui}/panels/CoDirector';
    import {useStore} from '${ui}/store';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const models=[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 — recommended balance ($2 / $10 per MTok)'}];
      const api={getSettings:async()=>({codirEngine:'api',anthropicKey:'••••1234',codirEffort:'max'}),codirModels:async()=>models,codirVeniceModels:async()=>models,codirBridgeModels:async()=>models,codirBridgeStatus:async()=>({found:false}),moodList:async()=>[]};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const log=[
        {role:'user',text:'save that, and set the brief',at:1},
        {role:'assistant',text:'Saved: never call it a mask.',at:1,tools:['save_rule → saved to your instructions (Learned section): never call it a mask','update_brief → brief updated']},
        {role:'user',text:'thanks',at:2},
        {role:'assistant',text:'Any time.',at:2}
      ];
      useStore.setState({project:{dir:'synthetic',name:'P',images:[],clips:[],codir:{log,brief:'',moodsPinned:[]}},refreshSpend:async()=>{},codirQueue:[]});
      createRoot(document.getElementById('root')).render(<CoDirectorPanel/>);await tick(400);
      const bubbles=[...document.querySelectorAll('.vd-copy')];
      check(bubbles.length===4,'four bubbles: '+bubbles.length);
      const ran=b=>b.querySelector('[title^="what it ran in this reply"]');
      check(ran(bubbles[1]),'the reply that wrote shows its write log');
      check(ran(bubbles[1]).textContent==='ran save_rule → saved to your instructions (Learned section): never call it a mask\\nran update_brief → brief updated','each call on its own line, as recorded: '+ran(bubbles[1]).textContent);
      check(bubbles[1].textContent.startsWith('Saved: never call it a mask.'),'under the reply, not instead of it');
      check(!ran(bubbles[0])&&!ran(bubbles[2])&&!ran(bubbles[3]),'his messages and a reply that ran nothing show none');
      check(document.body.textContent.includes('Sonnet 5.5 · max'),'the header names the thinking level beside the model: '+document.body.textContent.slice(0,120));
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'Co-Director panel: a reply shows the tools it ran under it (the write log); the header names model and thinking level';
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
    const win = new BrowserWindow({ show: false, width: 520, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
