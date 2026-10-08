// list 46 (MODELARK-SPEND-SPEC-2026-10-01): the BytePlus Access Key boxes in Settings (a changed pair
// is checked first; half a pair or a refused pair is never saved, the rest of the card still is;
// both empty = removed) and the ARK chip (this month's spend with the Access Key, the console link
// without it, the refusal in red, click = read again). The real SettingsModal and ArkChip, offscreen
// Electron, a stand-in API: nothing reaches BytePlus.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ark-spend-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ArkChip} from '${ui}/ui/ArkChip';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const setVal=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    const box=ph=>[...document.querySelectorAll('input')].find(i=>i.placeholder===ph);
    const btn=t=>[...document.querySelectorAll('.btn')].find(b=>b.textContent.trim()===t);
    const bpStatus=()=>document.querySelector('[data-bp-status]')?.textContent??'';
    const saveStatus=()=>btn('Save').parentElement.lastElementChild.textContent;
    const SECRET='good-secret';
    function stub(saved,extra={}){
      const calls={sets:[],checks:[],spend:0};
      const api={getSettings:async()=>saved,setSettings:async p=>{calls.sets.push(p);return {}},
        arkSpendCheck:async(ak,sk)=>{calls.checks.push([ak,sk]);return sk===SECRET||(sk==='••••cret'&&ak!=='••••')?{ok:true,period:'2026-10',total:3,currency:'USD',products:[],balance:{available:20}}:{ok:false,error:'BytePlus refused it: SignatureDoesNotMatch (the signature does not match)'}},
        codirGuides:async()=>[],codirModels:async()=>[],codirBridgeModels:async()=>[],codirBridgeStatus:async()=>({found:false,detail:''}),codirVeniceModels:async()=>[],
        codirCliStatus:async()=>({found:false,detail:''}),codirCliModels:async()=>[],codirDeepseekModels:async()=>[],...extra(calls)};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      return calls;
    }
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      // Credential editing is covered by test-settings-connections.cjs.
      // ---- the ARK chip ----
      const spent={ok:true,period:'2026-10',total:13.75,currency:'USD',products:[{name:'ModelArk',amount:12.75},{name:'CDN',amount:1}]};
      let answer={...spent,balance:{available:41.2,cash:41.2,credit:0,frozen:0,arrears:0}};
      const c=stub({},calls=>({arkSpend:async()=>{calls.spend++;return answer}}));
      const host=document.getElementById('root');let root=createRoot(host);
      root.render(<ArkChip spend={false}/>);await tick();
      check(host.textContent==='ARK ↗'&&c.spend===0,'no Access Key: the console link, nothing read');
      root.render(<ArkChip spend={true} again={1}/>);await tick();
      const chip=()=>document.querySelector('[data-ark-spend]');
      check(chip().textContent==='ARK $41.20'&&c.spend===1,'with it: what is left, like fal: '+chip().textContent);
      check(chip().title==='ModelArk: $41.20 left (BytePlus’s available balance) · cash $41.20 · spent this month (2026-10): $13.75 (ModelArk $12.75 · CDN $1.00) · click to refresh','the tooltip: left, its parts, and this month’s spend: '+chip().title);
      answer={...spent,balance:{available:-3.5,cash:0,credit:50,frozen:1.25,arrears:3.5}};
      chip().click();await tick();
      check(chip().textContent==='ARK -$3.50'&&chip().title.startsWith('ModelArk: -$3.50 left (BytePlus’s available balance) · cash $0.00 · credit limit $50.00 · frozen $1.25 · owed $3.50 · spent'),'credit, frozen and owed are named when there are any: '+chip().title);
      answer={...spent,balanceError:'BytePlus refused it: AccessDenied (no permission)'};
      chip().click();await tick();
      check(chip().textContent==='ARK $13.75 this month','balance refused: this month’s spend: '+chip().textContent);
      check(chip().title==='ModelArk spent this month (2026-10): $13.75 (ModelArk $12.75 · CDN $1.00): what BytePlus billed, not what is left · no balance: BytePlus refused it: AccessDenied (no permission) · click to refresh','… and the tooltip says why there is no balance: '+chip().title);
      answer={ok:true,period:'2026-10',currency:'USD',spendError:'BytePlus refused it: AccessDenied (no bills)',balance:{available:9}};
      chip().click();await tick();
      check(chip().textContent==='ARK $9.00'&&chip().title.includes('this month’s spend: BytePlus refused it: AccessDenied (no bills)'),'bill refused: the balance, and why the spend is missing: '+chip().title);
      answer={ok:false,error:'BytePlus refused it: InvalidAccessKey (the key is gone)'};
      chip().click();await tick();
      check(c.spend===5&&chip().textContent==='ARK ⚠'&&chip().style.color==='var(--bad)'&&chip().title==='BytePlus refused it: InvalidAccessKey (the key is gone) · click to retry','click reads again; a refusal is red, in BytePlus’s words: '+chip().title);
      answer={ok:true,period:'2026-10',total:7.5,currency:'SGD',products:[{name:'ModelArk',amount:7.5}],balance:{available:12}};
      root.render(<ArkChip spend={true} again={2}/>);await tick();
      check(c.spend===6&&chip().textContent==='ARK 12.00 SGD'&&chip().style.color==='var(--muted)','Settings closing reads again; another currency is named: '+chip().textContent);
      root.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'ARK chip: balances, spend, provider refusals, currencies and refresh';
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
    const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
