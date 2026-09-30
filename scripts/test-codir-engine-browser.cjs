// list 14 stage 4 (2026-09-30) — Settings → Co-Director: the engine is a three-way pick (Anthropic
// API · Claude Code bridge · Venice API). Venice picked = its own model list, the badge says venice
// (or that the key is missing), and the choice is saved. The real Settings modal, offscreen Electron.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codir-engine-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SettingsModal} from '${ui}/panels/SettingsModal';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const lab=e=>e.textContent.replace('✓','').replace('▾','').trim();
    const ENGINE='[title^="who runs the Co-Director"]';
    const open=async sel=>{document.querySelector(sel).click();await tick();return [...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px')};
    const close=async()=>{[...document.querySelectorAll('div[style*="inset: 0"]')].pop()?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick()};
    const pick=async(sel,label)=>{const els=await open(sel);const el=els.find(e=>lab(e)===label);check(el,'option '+label+': '+els.map(lab).join(','));el.click();await tick()};
    async function mount(saved){
      const sets=[];
      const api={getSettings:async()=>saved,setSettings:async p=>{sets.push(p);return {}},codirGuides:async()=>[],codirModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 — recommended balance ($2 / $10 per MTok)'},{id:'claude-haiku-4-5',label:'Haiku 4.5 — fastest & cheapest ($1 / $5)'}],
        codirBridgeModels:async()=>[{id:'claude-fable-5',label:'Fable 5 — the strongest'}],codirBridgeStatus:async()=>({found:true,detail:'Claude Code 2.1.300',version:'2.1.300'}),
        codirVeniceModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 — recommended balance ($3.75 / $18.75 per MTok on Venice)'},{id:'claude-opus-5-5',label:'Opus 5.5 — strongest writing ($4.80 / $24)'}]};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      const root=createRoot(document.getElementById('root'));root.render(<SettingsModal onClose={()=>{}}/>);await tick(400);
      const fold=[...document.querySelectorAll('[data-fold]')].find(el=>/co-director/i.test(el.textContent));
      check(fold,'the Co-Director card shows');
      if(!document.querySelector(ENGINE)){fold.click();await tick(200)}
      check(document.querySelector(ENGINE),'the engine pick shows');
      return {sets,root,fold};
    }
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      // a Venice key is saved, the engine still on the API
      let s=await mount({codirEngine:'api',veniceKey:'••••1234',anthropicKey:''});
      const opts=(await open(ENGINE)).map(e=>({label:lab(e),dim:e.style.color==='var(--dim)'}));await close();
      check(JSON.stringify(opts)==='[{"label":"Anthropic API","dim":false},{"label":"Claude Code bridge","dim":false},{"label":"Venice API","dim":false}]','three engines: '+JSON.stringify(opts));
      await pick(ENGINE,'Venice API');
      check(JSON.stringify(s.sets.at(-1))==='{"codirEngine":"venice"}','the pick is saved: '+JSON.stringify(s.sets.at(-1)));
      check(s.fold.textContent.includes('● venice'),'the badge says venice: '+s.fold.textContent);
      check(document.body.textContent.includes('uses the Venice key above'),'the line under the model says whose key');
      const MODEL='[title^="Claude through Venice"]';
      const models=(await open(MODEL)).map(lab);await close();
      check(models.length===2&&models[1].startsWith('Opus 5.5'),'Venice picked = Venice’s own model list: '+models.join(' | '));
      await pick(MODEL,models[1]);
      check(JSON.stringify(s.sets.at(-1))==='{"codirVeniceModel":"claude-opus-5-5"}','its model is saved apart: '+JSON.stringify(s.sets.at(-1)));
      s.root.unmount();
      // the engine is Venice but no key is saved: it says so, twice
      s=await mount({codirEngine:'venice',veniceKey:'',anthropicKey:'••••9999'});
      check(s.fold.textContent.includes('○ needs the Venice key'),'no key: the badge says it needs one: '+s.fold.textContent);
      check(document.body.textContent.includes('⚠ needs the Venice key'),'… and the line under the model says where it goes');
      await pick(ENGINE,'Anthropic API');
      check(s.fold.textContent.includes('● api'),'back on the API with its key: '+s.fold.textContent);
      // list 26: how hard it thinks, beside the model — five levels and auto, saved as picked
      const THINK='[title^="how hard it thinks"]';
      const cur=e=>e.firstElementChild.lastElementChild.textContent; // the trigger also holds a hidden copy of every option (stable width)
      const levels=(await open(THINK)).map(lab);await close();
      check(JSON.stringify(levels)===JSON.stringify(['thinking: auto','thinking: low — fastest','thinking: medium','thinking: high','thinking: xhigh — long, hard work','thinking: max — the top']),'the levels: '+levels.join(' | '));
      await pick(THINK,'thinking: max — the top');
      check(JSON.stringify(s.sets.at(-1))==='{"codirEffort":"max"}','the level is saved: '+JSON.stringify(s.sets.at(-1)));
      check(cur(document.querySelector(THINK))==='thinking: max — the top','… and shown: '+cur(document.querySelector(THINK)));
      s.root.unmount();
      // a saved level comes back; Haiku has no levels, so the pick greys and says why
      s=await mount({codirEngine:'api',anthropicKey:'••••9999',codirModel:'claude-sonnet-5-5',codirEffort:'xhigh'});
      check(cur(document.querySelector(THINK))==='thinking: xhigh — long, hard work','the saved level loads: '+cur(document.querySelector(THINK)));
      s.root.unmount();
      s=await mount({codirEngine:'api',anthropicKey:'••••9999',codirModel:'claude-haiku-4-5',codirEffort:'xhigh'});
      const grey=document.querySelector('[title="Haiku 4.5 has no thinking levels"]');
      check(grey&&cur(grey)==='thinking: auto'&&grey.style.opacity==='0.5','Haiku: the level greys, with the reason: '+(grey&&cur(grey)));
      check((await open('[title="Haiku 4.5 has no thinking levels"]')).length===0,'… and does not open');
      s.root.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'Settings: the Co-Director engine is a three-way pick; Venice = its own models, a venice badge, the key named; the choice is saved; the thinking level sits beside the model (auto + five, greyed on Haiku)';
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
    const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
