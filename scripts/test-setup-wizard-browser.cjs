// list 36 (2026-09-30 answers, built 10-01) — THE SETUP WIZARD, on screen. It shows on the first
// run and from a button in Settings, lists every service with what it gives and its own way in
// (a key's steps, a Bridge login, a command-line tool's sign-in, the Models card), and takes the
// Welcome card's place. The real wizard and the real Settings card, offscreen Electron; the app's
// side is a stand-in.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-setup-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SetupWizard} from '${ui}/panels/SetupWizard';
    import {SettingsModal} from '${ui}/panels/SettingsModal';
    import {setVidancerApi} from '${ui}/api'; import {setSetupOpener} from '${ui}/panelBus';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const svc=id=>document.querySelector('[data-service="'+id+'"]');
    const btn=(el,text)=>[...el.querySelectorAll('button,.btn')].find(b=>b.textContent.trim()===text);
    const pageId=()=>document.querySelector('[data-setup-page]').dataset.setupPage;
    const type=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const settings={anthropicKey:'••••1',falKey:'••••2'};
      const calls=[];
      const hf=(slot,more={})=>({id:'higgsfield',slot,key:slot>1?'higgsfield#'+slot:'higgsfield',service:'Higgsfield',label:'Higgsfield '+slot,site:'https://higgsfield.ai',kind:'video',creditUnit:'credits',loggedIn:true,busy:false,balance:100,...more});
      let rows=[hf(1),hf(2),
        {id:'runway',slot:1,key:'runway',service:'Runway',label:'Runway',site:'https://runwayml.com',kind:'video',creditUnit:'credits',loggedIn:false,busy:false},
        {id:'artlist',slot:1,key:'artlist',service:'Artlist',label:'Artlist',site:'https://artlist.io',kind:'video',creditUnit:'credits',loggedIn:false,busy:false,error:'Artlist’s login reads Video Dancer’s public page, and that page is not up yet'},
        {id:'magnific',slot:1,key:'magnific',service:'Magnific',label:'Magnific',site:'https://www.magnific.com',kind:'video',creditUnit:'credits',loggedIn:false,busy:false,blocked:'their login only lets known web apps in'}];
      let claude={found:true,detail:'2.1.300 — native install — NOT LOGGED IN',loggedIn:false};
      const api={
        getSettings:async()=>({...settings}),setSettings:async p=>{calls.push(['set',p]);Object.assign(settings,p);return {...settings}},
        openExternal:async u=>{calls.push(['open',u])},
        bridgeList:async()=>rows,bridgeLogin:async(id,slot)=>{calls.push(['bridgeLogin',id]);rows=rows.map(r=>r.id===id?{...r,loggedIn:true,balance:40}:r);return rows},
        codirBridgeStatus:async refresh=>{calls.push(['claudeStatus',!!refresh]);return claude},
        codirBridgeLogin:async()=>{calls.push(['claudeLogin']);claude={found:true,detail:'2.1.300 — native install',loggedIn:true,ok:true,out:''};return claude},
        codirCliStatus:async(k,refresh)=>{calls.push(['cliStatus',k,!!refresh]);return k==='codex'?{found:true,detail:'codex-cli 0.159.2 — the Codex app’s own copy — Logged in using ChatGPT',loggedIn:true}:{found:false,detail:'Gemini CLI not found on this machine'}},
        arkValidate:async k=>k==='good'?{ok:true}:{ok:false,error:'Invalid key'},
        // the Settings card's own reads
        codirGuides:async()=>[],codirModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5'}],codirBridgeModels:async()=>[],codirVeniceModels:async()=>[],codirCliModels:async()=>[],codirDeepseekModels:async()=>[]};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      let route='';
      const root=createRoot(document.getElementById('root'));
      root.render(<SetupWizard onClose={()=>{route='closed'}} onOpenSettings={()=>{route='settings'}} onOpenBridge={()=>{route='bridge'}} onOpenModels={()=>{route='models'}}/>);await tick(300);

      // ---- the start page: storyboard with no account, and what the pages are ----
      check(pageId()==='start','it opens on the start page');
      check(document.querySelector('[role=dialog]').textContent.includes('Set up Video Dancer'),'its name');
      check(document.body.textContent.includes('No account or API key required')&&btn(document.body,'start storyboarding'),'storyboarding needs nothing');
      const pills=[...document.querySelectorAll('[data-setup-pill]')].map(p=>p.textContent.trim());
      check(JSON.stringify(pills)==='["start","co-director","video","image","voice and music","watching"]','the pages: '+pills.join(' | '));
      check(!/recommended/i.test(document.body.textContent),'no recommended tag');
      const next=()=>document.querySelector('[data-setup-next]');
      check(next().textContent.trim()==='next: co-director','next says where it goes');

      // ---- the co-director page: six ways to run it, each with its state and its own way in ----
      next().click();await tick();
      check(pageId()==='codir'&&document.querySelectorAll('[data-service]').length===7,'seven engines');
      check(svc('api').textContent.includes('Anthropic API')&&svc('api').textContent.includes('key saved')&&svc('api').textContent.includes('runs the Co-Director on your Anthropic key, billed per token'),'a saved key: connected, and what it gives: '+svc('api').textContent);
      check(btn(svc('api'),'Replace')&&!svc('api').querySelector('input'),'a saved key is not retyped; it can be changed');
      check(svc('venice').textContent.includes('○ not set')&&svc('venice').querySelector('input[type=password]').placeholder==='paste Venice key'&&btn(svc('venice'),'Get a key ↗'),'a missing key: its three steps in the row');
      check(svc('codex').textContent.includes('Logged in')&&svc('codex').textContent.includes('ChatGPT'),'Codex: found and signed in: '+svc('codex').textContent);
      check(svc('gemini').textContent.includes('Gemini CLI is required')&&svc('gemini').textContent.includes('npm install -g @google/gemini-cli')&&btn(svc('gemini'),'Check'),'Gemini CLI: how it gets here: '+svc('gemini').textContent);
      check(svc('bridge').textContent.includes('Not logged in to Video Dancer'),'Claude Code: found, signed out');
      btn(svc('bridge'),'Log in with Claude').click();await tick(200);
      check(calls.some(c=>c[0]==='claudeLogin')&&svc('bridge').textContent.includes('Logged in'),'its own sign-in runs, and the row turns');
      btn(svc('gemini'),'Check').click();await tick(200);
      check(calls.some(c=>JSON.stringify(c)==='["cliStatus","gemini",true]'),'re-check looks again');

      // ---- the video page: keys, Bridge logins, this PC ----
      next().click();await tick();
      check(pageId()==='video','video is next');
      check(svc('fal').textContent.includes('key saved')&&svc('fal').querySelector('[data-gives]').textContent.includes('Seedance 2.5'),'fal: connected, and its engines: '+svc('fal').textContent);
      check(svc('bridge-higgsfield').textContent.includes('● 2 logins')&&!btn(svc('bridge-higgsfield'),'login'),'a supplier with two logins says so, and offers no login');
      check(svc('bridge-runway').textContent.includes('○ not connected'),'a login that is not there');
      btn(svc('bridge-runway'),'login').click();await tick(200);
      check(calls.some(c=>c[0]==='bridgeLogin'&&c[1]==='runway')&&svc('bridge-runway').textContent.includes('● logged in'),'login runs the Bridge login, and the row turns');
      check(svc('bridge-artlist').textContent.includes('that page is not up yet')&&svc('bridge-artlist').textContent.includes('a login only: no engine in the app runs on it yet'),'a refused login says why; a login with no engine says so');
      check(svc('bridge-magnific').textContent.includes('○ not open to apps yet')&&btn(svc('bridge-magnific'),'login').style.opacity==='0.5','a supplier that lets no app in: greyed, with the reason');
      check(svc('local').textContent.includes('On this PC')&&svc('local').textContent.includes('○ no account')&&svc('local').textContent.includes('LTX 2.5'),'this PC: no account');
      btn(svc('local'),'open the models card').click();check(route==='models','the Models card is its way in');
      btn(svc('bridge-runway'),'open the bridge panel').click();check(route==='bridge','the Bridge panel is one click away');
      // a key: refused = never saved; good = saved under its own setting, and the row turns
      type(svc('ark').querySelector('input'),'bad');await tick();btn(svc('ark'),'Check and save').click();await tick(150);
      check(!calls.some(c=>c[0]==='set')&&svc('ark').textContent.includes('Invalid key'),'a refused key is never saved');
      type(svc('ark').querySelector('input'),'good');await tick();btn(svc('ark'),'Check and save').click();await tick(200);
      check(JSON.stringify(calls.find(c=>c[0]==='set'))==='["set",{"arkKey":"good"}]'&&svc('ark').textContent.includes('key saved')&&svc('ark').textContent.includes('Verified'),'a good key is checked, saved and shown: '+svc('ark').textContent);
      btn(svc('astria'),'Get a key ↗').click();
      check(JSON.stringify(calls.at(-1))==='["open","https://www.astria.ai/users/edit#api"]','get a key opens their key page');

      // ---- the rest of the pages, in order, to done ----
      next().click();await tick();
      check(pageId()==='image'&&svc('ark').textContent.includes('key saved')&&svc('civitai')&&svc('local').textContent.includes('Krea 2'),'image: the key saved on the last page is connected here too');
      next().click();await tick();
      check(pageId()==='audio'&&svc('eleven').textContent.includes('music: ')&&svc('eleven').textContent.includes('sound fx: ')&&svc('eleven').textContent.includes('voice: '),'voice and music, grouped: '+svc('eleven').textContent);
      next().click();await tick();
      check(pageId()==='watch'&&svc('google').textContent.includes('Gemini watches your takes and cuts')&&!next(),'watching is the last page');
      btn(document.body,'back').click();await tick();check(pageId()==='audio','back goes back');
      document.querySelector('[data-setup-pill="4"]').click();await tick();
      document.querySelector('[data-setup-done]').click();check(route==='closed','done closes it');
      btn(document.body,'all settings').click();check(route==='settings','all settings is always there');
      root.unmount();

      // ---- its button in Settings ----
      let opened=0;setSetupOpener(()=>{opened++});
      const root2=createRoot(document.getElementById('root'));root2.render(<SettingsModal onClose={()=>{}}/>);await tick(400);
      const open=document.querySelector('[data-setup-open]');
      check(open&&open.textContent.trim()==='Setup wizard','Settings has the button');
      open.click();check(opened===1,'and it opens the wizard');
      root2.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'the setup wizard: a start page (storyboard with no account), then co-director, video, image, voice and music, watching; every service a row with its state, what it gives and its own way in (a key checked before it is saved, a Bridge login, a tool’s own sign-in, the Models card); no recommended tag; next / back / done; its button in Settings';
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
    const win = new BrowserWindow({ show: false, width: 1000, height: 1000, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
